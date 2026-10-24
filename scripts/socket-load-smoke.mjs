import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import { preparePostgresTestEnvironment } from "./fixtures/postgres-test-environment.mjs";

const databaseTest = await preparePostgresTestEnvironment("load");

const clientCount = Math.max(5, Math.min(100, Number(process.env.LOAD_CLIENTS) || 25));
const port = 33000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PUBLIC_ORIGIN: origin,
    ADMIN_TOKEN: "load-smoke-admin-token-32-chars-minimum",
    JADE_WORLD_PERSIST: "0",
    JADE_ALLOW_VOLATILE_PRODUCTION: "1",
    ...databaseTest.env,
    JADE_DEBUG_TOOLS: "0",
    PORT: String(port),
    LOG_LEVEL: "warn",
    SOCKET_CONNECTS_PER_MINUTE: String(Math.max(60, clientCount + 10))
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

function once(socket, event, ms = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function waitReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`load server not ready\n${output}`);
}

const sockets = [];
try {
  await waitReady();
  const connectLatencies = await Promise.all(Array.from({ length: clientCount }, async (_, index) => {
    const started = performance.now();
    const socket = io(origin, {
      transports: ["websocket"],
      autoConnect: false,
      reconnection: false,
      extraHeaders: { Origin: origin },
      auth: { capabilities: { statePatchV1: true } }
    });
    sockets.push(socket);
    const statePromise = once(socket, "state");
    socket.connect();
    await once(socket, "connect");
    const state = await statePromise;
    assert.ok(state.me?.id, `client ${index} missing player state`);
    return performance.now() - started;
  }));

  const mutationLatencies = await Promise.all(sockets.map(async (socket, index) => {
    const expectedName = `压测${index}`;
    const started = performance.now();
    const patch = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`client ${index} mutation timeout`)), 10_000);
      const listener = (payload) => {
        if (payload?.changes?.me?.name !== expectedName) return;
        clearTimeout(timer);
        socket.off("state:patch", listener);
        resolve(payload);
      };
      socket.on("state:patch", listener);
    });
    socket.emit("setName", { value: expectedName, requestId: randomUUID() });
    await patch;
    return performance.now() - started;
  }));

  const percentile = (values, ratio) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  };
  const connectP95 = percentile(connectLatencies, 0.95);
  const mutationP95 = percentile(mutationLatencies, 0.95);
  assert.ok(connectP95 < 5000, `connect p95 too slow: ${connectP95}ms`);
  assert.ok(mutationP95 < 5000, `mutation p95 too slow: ${mutationP95}ms`);
  console.log(`socket-load-smoke: ${clientCount} clients, connect p95=${connectP95.toFixed(1)}ms, mutation p95=${mutationP95.toFixed(1)}ms`);
} finally {
  sockets.forEach((socket) => socket.close());
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("load server shutdown timeout")), 5000))
  ]);
  await databaseTest.cleanup();
}
