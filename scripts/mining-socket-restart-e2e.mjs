import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const applicationMs = 20_000;
const shiftMs = 15_000;
const debugCashGrant = 100_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function startServer(port, worldPath) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      JADE_WORLD_PERSIST: "1",
      JADE_WORLD_PATH: worldPath,
      JADE_WORLD_SAVE_MS: "5000",
      JADE_MINING_REQUIRED_PLAYERS: "1",
      JADE_MINING_REQUIRED_REP: "0",
      JADE_MINING_APPLICATION_MS: String(applicationMs),
      JADE_MINING_LEASE_MS: "60000",
      JADE_MINING_SHIFT_MS: String(shiftMs),
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout starting mining restart server${output ? `: ${output.trim()}` : ""}`));
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
        reject(new Error(`mining restart server exited with code ${code}${output ? `: ${output.trim()}` : ""}`));
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
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5_000);
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
      reject(new Error("timeout waiting for matching restart state"));
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

async function waitForSaveContaining(worldPath, id, ms = 12_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const text = await readFile(worldPath, "utf8");
      if (text.includes(id)) return JSON.parse(text);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await delay(100);
  }
  throw new Error(`timeout waiting for persisted mining record ${id}`);
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jade-mining-restart-"));
const worldPath = path.join(tempRoot, "world.json");
let server = null;
let client = null;

try {
  server = await startServer(port, worldPath);
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

  const applicationStatePromise = waitForState(client.socket, (snapshot) => (
    snapshot.mining?.myApplication?.preferences?.includes("mist-01")
  ));
  const applicationResult = await emitWithAck(client.socket, "miningApply", {
    preferences: ["mist-01"],
    allowFallback: true,
    expectedRevision: 0,
    requestId: "restart-e2e-application"
  });
  assert.equal(applicationResult?.ok, true);
  const applicationState = await applicationStatePromise;
  const application = applicationState.mining.myApplication;
  assert.ok(application?.id);
  assert.equal(application.revision, 1);
  assert.equal(Number(applicationState.me.cash), Number(readyState.me.cash) - Number(application.escrow));
  await waitForSaveContaining(worldPath, application.id);

  client.socket.close();
  client = null;
  await stopServer(server);
  server = await startServer(port, worldPath);
  client = await connect(baseUrl, session);
  assert.equal(client.hello.playerId, session.playerId);
  assert.equal(client.state.mining?.myApplication?.id, application.id,
    "pending application should survive a real server restart");
  assert.equal(client.state.mining?.myApplication?.revision, application.revision);
  assert.equal(Number(client.state.me.cash), Number(applicationState.me.cash),
    "pending escrow must not be charged again after restart");

  const allocatedState = await waitForState(client.socket, (snapshot) => (
    snapshot.mining?.myLease?.mineId === "mist-01"
      && !snapshot.mining?.myApplication
  ), applicationMs + 15_000);
  const starterMinerId = String(allocatedState.me.mining.miners?.[0]?.id || "");
  assert.ok(starterMinerId);
  const cashBeforeShift = Number(allocatedState.me.cash);
  const roughBeforeShift = allocatedState.me.rough.length;
  const shiftsBefore = Number(allocatedState.me.mining.stats?.shifts || 0);
  const activeStatePromise = waitForState(client.socket, (snapshot) => (
    (snapshot.me?.mining?.jobs || []).filter((job) => job.status === "active").length === 1
  ));
  const shiftResult = await emitWithAck(client.socket, "miningStartShift", {
    minerIds: [starterMinerId],
    requestId: "restart-e2e-shift"
  });
  assert.equal(shiftResult?.ok, true);
  const activeState = await activeStatePromise;
  const activeJob = activeState.me.mining.jobs.find((job) => job.status === "active");
  assert.ok(activeJob?.id);
  assert.equal(Number(activeState.me.cash), cashBeforeShift - Number(shiftResult.fee));
  await waitForSaveContaining(worldPath, activeJob.id);

  client.socket.close();
  client = null;
  await stopServer(server);
  server = await startServer(port, worldPath);
  client = await connect(baseUrl, session);
  assert.equal(client.hello.playerId, session.playerId);
  const restartedJob = (client.state.me.mining.jobs || []).find((job) => job.id === activeJob.id);
  assert.equal(restartedJob?.status, "active",
    "an unfinished shift should remain active after a real server restart");
  assert.equal(Number(client.state.me.cash), Number(activeState.me.cash),
    "an active shift must not be charged again after restart");

  const completedState = await waitForState(client.socket, (snapshot) => (
    !(snapshot.me?.mining?.jobs || []).some((job) => job.id === activeJob.id)
      && (snapshot.me?.mining?.history || []).some((entry) => entry.id === activeJob.id)
  ), shiftMs + 15_000);
  const matchingHistory = completedState.me.mining.history.filter((entry) => entry.id === activeJob.id);
  assert.equal(matchingHistory.length, 1, "restarted shift must settle exactly once");
  assert.equal(Number(completedState.me.mining.stats?.shifts || 0), shiftsBefore + 1);
  assert.equal(
    completedState.me.rough.length - roughBeforeShift,
    Number(matchingHistory[0].roughCount),
    "restarted settlement inventory must match its single history record"
  );
  assert.equal(Number(completedState.me.cash), Number(activeState.me.cash));

  console.log("mining-socket-restart-e2e: pending escrow and active shift survive two real server restarts with one settlement");
} finally {
  client?.socket?.close();
  await stopServer(server);
  const resolvedTempRoot = path.resolve(tempRoot);
  const resolvedSystemTemp = path.resolve(os.tmpdir());
  const relativeTempPath = path.relative(resolvedSystemTemp, resolvedTempRoot);
  if (
    relativeTempPath
    && !relativeTempPath.startsWith("..")
    && !path.isAbsolute(relativeTempPath)
    && path.basename(resolvedTempRoot).startsWith("jade-mining-restart-")
  ) {
    await rm(resolvedTempRoot, { recursive: true, force: true });
  }
}
