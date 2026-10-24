import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const applicationMs = 12_000;
const shiftMs = 8_000;
const debugCashGrant = 100_000;

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

async function startServer(port) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      JADE_WORLD_PERSIST: "0",
      JADE_MINING_REQUIRED_PLAYERS: "1",
      JADE_MINING_REQUIRED_REP: "0",
      JADE_MINING_APPLICATION_MS: String(applicationMs),
      JADE_MINING_LEASE_MS: "40000",
      JADE_MINING_SHIFT_MS: String(shiftMs),
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout starting mining fault server${output ? `: ${output.trim()}` : ""}`));
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
        reject(new Error(`mining fault server exited with code ${code}${output ? `: ${output.trim()}` : ""}`));
      });
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
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
      reject(new Error("timeout waiting for matching fault-injection state"));
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

async function connect(baseUrl, auth = {}) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    autoConnect: false,
    reconnection: false,
    auth
  });
  const helloPromise = once(socket, "hello");
  const statePromise = once(socket, "state");
  socket.connect();
  await once(socket, "connect");
  return { socket, hello: await helloPromise, state: await statePromise };
}

function assertDuplicate(result, label) {
  assert.equal(result?.ok, false, `${label} retry should not run as a new mutation`);
  assert.equal(result?.duplicate, true, `${label} retry should be identified as a duplicate`);
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
let server = null;
let client = null;

try {
  server = await startServer(port);
  client = await connect(baseUrl);
  const session = {
    playerId: client.hello.playerId,
    resumeToken: client.hello.resumeToken
  };
  const readyStatePromise = waitForState(client.socket, (snapshot) => (
    snapshot.mining?.unlocked === true
      && snapshot.mining?.acceptingApplications === true
      && snapshot.me?.mining?.miners?.length >= 1
      && Number(snapshot.me?.cash) >= 12_000 + debugCashGrant
  ));
  client.socket.emit("debugGrant", { cash: debugCashGrant, unlockMining: true });
  const readyState = await readyStatePromise;
  const starterMinerId = String(readyState.me.mining.miners[0]?.id || "");
  assert.ok(starterMinerId);

  const refreshRequest = {
    candidateIds: [],
    requestId: "fault-e2e-refresh"
  };
  const refreshedStatePromise = waitForState(client.socket, (snapshot) => (
    snapshot.me?.mining?.recruitCandidates?.length === 3
  ));
  client.socket.emit("miningRefreshCandidates", refreshRequest);
  const refreshedState = await refreshedStatePromise;
  const refreshedCandidateIds = refreshedState.me.mining.recruitCandidates.map((candidate) => candidate.id);
  const cashAfterRefresh = Number(refreshedState.me.cash);
  const duplicateRefresh = await emitWithAck(client.socket, "miningRefreshCandidates", refreshRequest);
  assertDuplicate(duplicateRefresh, "candidate refresh");
  assert.equal(Number(refreshedState.me.cash), cashAfterRefresh);

  const candidate = refreshedState.me.mining.recruitCandidates[0];
  const recruitRequest = {
    candidateId: candidate.id,
    requestId: "fault-e2e-recruit"
  };
  const recruitedStatePromise = waitForState(client.socket, (snapshot) => (
    snapshot.me?.mining?.miners?.some((miner) => miner.id === candidate.id)
  ));
  client.socket.emit("miningRecruitMiner", recruitRequest);
  const recruitedState = await recruitedStatePromise;
  const cashAfterRecruit = Number(recruitedState.me.cash);
  assert.equal(cashAfterRecruit, cashAfterRefresh - Number(candidate.price));
  assert.deepEqual(
    recruitedState.me.mining.recruitCandidates.map((entry) => entry.id),
    refreshedCandidateIds.filter((id) => id !== candidate.id)
  );
  const duplicateRecruit = await emitWithAck(client.socket, "miningRecruitMiner", recruitRequest);
  assertDuplicate(duplicateRecruit, "miner recruit");
  assert.equal(Number(recruitedState.me.cash), cashAfterRecruit);

  const applicationRequest = {
    preferences: ["mist-01"],
    allowFallback: true,
    expectedRevision: 0,
    requestId: "fault-e2e-application"
  };
  const applicationStatePromise = waitForState(client.socket, (snapshot) => (
    snapshot.mining?.myApplication?.preferences?.includes("mist-01")
  ));
  client.socket.emit("miningApply", applicationRequest);
  const applicationState = await applicationStatePromise;
  const application = applicationState.mining.myApplication;
  const cashAfterApplication = Number(applicationState.me.cash);
  assert.equal(cashAfterApplication, cashAfterRecruit - Number(application.escrow));
  const duplicateApplication = await emitWithAck(client.socket, "miningApply", applicationRequest);
  assertDuplicate(duplicateApplication, "mining application");
  assert.equal(Number(applicationState.me.cash), cashAfterApplication);
  assert.equal(applicationState.mining.myApplication.id, application.id);

  const allocatedState = await waitForState(client.socket, (snapshot) => (
    snapshot.mining?.myLease?.mineId === "mist-01"
      && !snapshot.mining?.myApplication
  ), applicationMs + 15_000);
  const cashBeforeShift = Number(allocatedState.me.cash);
  const roughBeforeShift = allocatedState.me.rough.length;
  const shiftsBefore = Number(allocatedState.me.mining.stats?.shifts || 0);
  const shiftRequest = {
    minerIds: [starterMinerId],
    requestId: "fault-e2e-shift"
  };
  const activeStatePromise = waitForState(client.socket, (snapshot) => (
    (snapshot.me?.mining?.jobs || []).filter((job) => job.status === "active").length === 1
  ));
  client.socket.emit("miningStartShift", shiftRequest);
  const activeState = await activeStatePromise;
  const activeJob = activeState.me.mining.jobs.find((job) => job.status === "active");
  assert.ok(activeJob?.id);
  const cashAfterShift = Number(activeState.me.cash);
  assert.ok(cashAfterShift < cashBeforeShift);

  client.socket.close();
  client = await connect(baseUrl, session);
  assert.equal(client.hello.playerId, session.playerId);
  assert.equal(
    (client.state.me.mining.jobs || []).filter((job) => job.status === "active").length,
    1,
    "lost shift acknowledgement must still leave exactly one active job after reconnect"
  );
  assert.equal(Number(client.state.me.cash), cashAfterShift);
  const duplicateShift = await emitWithAck(client.socket, "miningStartShift", shiftRequest);
  assertDuplicate(duplicateShift, "mining shift");
  assert.equal(Number(client.state.me.cash), cashAfterShift);

  const completedState = await waitForState(client.socket, (snapshot) => (
    !(snapshot.me?.mining?.jobs || []).some((job) => job.id === activeJob.id)
      && (snapshot.me?.mining?.history || []).some((entry) => entry.id === activeJob.id)
  ), shiftMs + 15_000);
  const matchingHistory = completedState.me.mining.history.filter((entry) => entry.id === activeJob.id);
  assert.equal(matchingHistory.length, 1);
  assert.equal(Number(completedState.me.mining.stats?.shifts || 0), shiftsBefore + 1);
  assert.equal(
    completedState.me.rough.length - roughBeforeShift,
    Number(matchingHistory[0].roughCount)
  );
  assert.equal(Number(completedState.me.cash), cashAfterShift);

  console.log("mining-socket-fault-e2e: lost acknowledgements and reconnect retries do not duplicate refresh, recruit, application, charge or settlement");
} finally {
  client?.socket?.close();
  await stopServer(server);
}

