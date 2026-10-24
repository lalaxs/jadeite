/**
 * Live mining socket E2E: concurrent applications, allocation, refunds,
 * multi-window shift exclusion, idempotent settlement and reconnect recovery.
 *
 * With no arguments this script starts and cleans up an isolated server.
 * To test an already-running server instead, start it with matching settings:
 *   JADE_WORLD_PERSIST=0 JADE_MINING_REQUIRED_PLAYERS=50
 *   JADE_MINING_APPLICATION_MS=8000 JADE_MINING_LEASE_MS=30000
 *   JADE_MINING_SHIFT_MS=1000 PORT=3317 node server.js
 * Then pass its address explicitly:
 *   node scripts/mining-socket-e2e.mjs http://localhost:3317 50
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";
import { io } from "socket.io-client";

const externalBaseUrl = String(process.argv[2] || "").trim();
let baseUrl = externalBaseUrl;
const clientCount = Math.max(2, Math.round(Number(process.argv[3]) || 50));
const applicationPreferences = ["core-06", "core-05", "core-04"];
const debugCashGrant = 250_000;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function startIsolatedServer() {
  const port = await availablePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      JADE_WORLD_PERSIST: "0",
      JADE_MINING_REQUIRED_PLAYERS: String(clientCount),
      JADE_MINING_APPLICATION_MS: "8000",
      JADE_MINING_LEASE_MS: "30000",
      JADE_MINING_SHIFT_MS: "1000",
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout starting isolated mining server${output ? `: ${output.trim()}` : ""}`));
      }, 15_000);
      const capture = (chunk) => {
        output += String(chunk);
        if (!output.includes(`http://localhost:${port}`)) return;
        clearTimeout(timer);
        resolve();
      };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`isolated mining server exited with code ${code}${output ? `: ${output.trim()}` : ""}`));
      });
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

function once(socket, event, ms = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, ms);
    const handler = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

function waitForState(socket, predicate, ms = 45_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("state", handler);
      reject(new Error("timeout waiting for matching mining state"));
    }, ms);
    const handler = (snapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      socket.off("state", handler);
      resolve(snapshot);
    };
    socket.on("state", handler);
  });
}

function emitWithAck(socket, event, payload, ms = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event} ack`)), ms);
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

async function connect(auth = {}) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    autoConnect: false,
    auth
  });
  const helloPromise = once(socket, "hello");
  const statePromise = once(socket, "state");
  socket.connect();
  await once(socket, "connect");
  return { socket, hello: await helloPromise, state: await statePromise };
}

const clients = [];
let ownedServer = null;
try {
  if (!externalBaseUrl) ownedServer = await startIsolatedServer();
  baseUrl = externalBaseUrl || ownedServer.baseUrl;
  clients.push(...await Promise.all(Array.from({ length: clientCount }, () => connect())));
  const requiredPlayers = Number(clients[0].state.mining?.requiredPlayers);
  assert.equal(requiredPlayers, clientCount,
    `server must use JADE_MINING_REQUIRED_PLAYERS=${clientCount} for this E2E`);

  const readyStates = clients.map(({ socket }) => waitForState(socket, (snapshot) => (
    Number(snapshot.me?.cash) >= 12_000 + debugCashGrant
      && snapshot.mining?.unlocked === true
      && snapshot.mining?.playerQualified === true
      && snapshot.mining?.acceptingApplications === true
  )));
  for (const { socket } of clients) {
    socket.emit("debugGrant", { cash: debugCashGrant, unlockMining: true });
  }
  await Promise.all(readyStates);

  const applicationResults = await Promise.all(clients.map(({ socket }, index) => (
    emitWithAck(socket, "miningApply", {
      preferences: applicationPreferences,
      allowFallback: true,
      requestId: `mining-socket-apply-${index + 1}`
    })
  )));
  assert.ok(applicationResults.every((result) => result?.ok === true),
    "all qualified socket clients should submit an application concurrently");

  const duplicate = await emitWithAck(clients[0].socket, "miningApply", {
    preferences: ["mist-01"],
    allowFallback: false,
    requestId: "mining-socket-apply-1"
  });
  assert.equal(duplicate?.ok, false);
  assert.equal(duplicate?.duplicate, true,
    "a repeated socket request id must not replace or charge an application twice");

  const settledStates = await Promise.all(clients.map(({ socket }) => waitForState(socket, (snapshot) => (
    Boolean(snapshot.mining?.currentRound?.allocatedAt)
      && (snapshot.mining?.currentRound?.leases || []).length === Math.min(30, clientCount)
      && (snapshot.me?.mining?.applicationHistory || []).some((entry) => (
        entry.status === "won" || entry.status === "missed"
      ))
  ))));

  const publicLeases = settledStates[0].mining.currentRound.leases;
  assert.equal(publicLeases.length, Math.min(30, clientCount));
  assert.equal(new Set(publicLeases.map((lease) => lease.playerId)).size, publicLeases.length,
    "one player must not receive multiple mines in one round");
  assert.equal(new Set(publicLeases.map((lease) => lease.mineId)).size, publicLeases.length,
    "one mine must not be assigned to multiple players");

  const outcomes = settledStates.map((snapshot) => snapshot.me.mining.applicationHistory[0]);
  assert.equal(outcomes.filter((entry) => entry.status === "won").length, publicLeases.length);
  assert.equal(outcomes.filter((entry) => entry.status === "missed").length, clientCount - publicLeases.length);
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    if (outcome.status !== "missed") continue;
    assert.equal(Number(settledStates[index].me.cash), 12_000 + debugCashGrant,
      "every socket-level loser should receive the full escrow refund");
  }

  const winnerIndex = outcomes.findIndex((entry) => entry.status === "won");
  assert.ok(winnerIndex >= 0, "at least one client must win a mine for the shift concurrency check");
  const winner = clients[winnerIndex];
  const winnerSession = {
    playerId: winner.hello.playerId,
    resumeToken: winner.hello.resumeToken
  };
  const secondWindow = await connect(winnerSession);
  clients.push(secondWindow);
  assert.equal(secondWindow.hello.playerId, winnerSession.playerId);
  const starterMinerId = String(settledStates[winnerIndex].me.mining.miners?.[0]?.id || "");
  assert.ok(starterMinerId, "a basic-mode winner should have a starter miner");
  const cashBeforeShift = Number(settledStates[winnerIndex].me.cash);
  const roughBeforeShift = settledStates[winnerIndex].me.rough.length;
  const shiftsBefore = Number(settledStates[winnerIndex].me.mining.stats?.shifts || 0);
  const activeStatePromise = waitForState(winner.socket, (snapshot) => (
    (snapshot.me?.mining?.jobs || []).filter((job) => job.status === "active").length === 1
  ));
  const shiftRequestIds = ["mining-shift-window-a", "mining-shift-window-b"];
  const shiftAttempts = await Promise.all([
    emitWithAck(winner.socket, "miningStartShift", {
      minerIds: [starterMinerId],
      requestId: shiftRequestIds[0]
    }),
    emitWithAck(secondWindow.socket, "miningStartShift", {
      minerIds: [starterMinerId],
      requestId: shiftRequestIds[1]
    })
  ]);
  const successfulAttemptIndex = shiftAttempts.findIndex((result) => result?.ok === true);
  assert.ok(successfulAttemptIndex >= 0);
  assert.equal(shiftAttempts.filter((result) => result?.ok === true).length, 1,
    "two windows must not start two shifts for the same player");
  const activeState = await activeStatePromise;
  const activeJobs = activeState.me.mining.jobs.filter((job) => job.status === "active");
  assert.equal(activeJobs.length, 1);
  assert.equal(Number(activeState.me.cash), cashBeforeShift - Number(shiftAttempts[successfulAttemptIndex].fee),
    "concurrent start attempts must charge exactly one shift fee");

  const duplicateShift = await emitWithAck(secondWindow.socket, "miningStartShift", {
    minerIds: [starterMinerId],
    requestId: shiftRequestIds[successfulAttemptIndex]
  });
  assert.equal(duplicateShift?.ok, false);
  assert.equal(duplicateShift?.duplicate, true,
    "a successful shift request id must remain consumed across player windows");

  const activeJob = activeJobs[0];
  const settlementTimeout = Math.max(15_000, Number(activeJob.durationMs || 0) + 12_000);
  const completedState = await waitForState(winner.socket, (snapshot) => (
    !(snapshot.me?.mining?.jobs || []).some((job) => job.id === activeJob.id)
      && (snapshot.me?.mining?.history || []).some((entry) => entry.id === activeJob.id)
  ), settlementTimeout);
  const matchingHistory = completedState.me.mining.history.filter((entry) => entry.id === activeJob.id);
  assert.equal(matchingHistory.length, 1, "one active shift must settle exactly once");
  assert.equal(Number(completedState.me.mining.stats?.shifts || 0), shiftsBefore + 1);
  assert.equal(
    completedState.me.rough.length - roughBeforeShift,
    Number(matchingHistory[0].roughCount),
    "settlement inventory gain must match its single history record"
  );
  assert.equal(Number(completedState.me.cash), Number(activeState.me.cash),
    "settlement must not charge the shift fee again");

  const resumeIndex = outcomes.findIndex((entry) => entry.status === "missed");
  const selectedIndex = resumeIndex >= 0 ? resumeIndex : 0;
  const selected = clients[selectedIndex];
  const selectedOutcome = outcomes[selectedIndex];
  const session = {
    playerId: selected.hello.playerId,
    resumeToken: selected.hello.resumeToken
  };
  selected.socket.close();
  const resumed = await connect(session);
  clients[selectedIndex] = resumed;
  assert.equal(resumed.hello.playerId, session.playerId);
  assert.equal(resumed.state.me.mining.applicationHistory[0].status, selectedOutcome.status,
    "the settled mining result should survive a real socket reconnect");
  assert.equal(Number(resumed.state.me.cash), Number(settledStates[selectedIndex].me.cash),
    "the mining balance should remain unchanged after reconnect");

  console.log(`mining-socket-e2e: ${clientCount} clients, unique allocation, refunds, two-window exclusion, one settlement and reconnect ok`);
} finally {
  for (const client of clients) client?.socket?.close();
  ownedServer?.child?.kill();
}

process.exit(0);
