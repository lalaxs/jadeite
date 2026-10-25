import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { io } from "socket.io-client";
import { loadRuntimeConfig, originAllowed } from "../server/config/runtime-config.js";
import { serverProcessArgs, serverProcessStdio, stopTestServer } from "./fixtures/test-server-process.mjs";

assert.throws(() => loadRuntimeConfig({ NODE_ENV: "production" }), /PUBLIC_ORIGIN/);
const parsed = loadRuntimeConfig({
  NODE_ENV: "production",
  PUBLIC_ORIGIN: "https://jade.example.com",
  ADMIN_TOKEN: "production-readiness-config-token",
  JADE_DEBUG_TOOLS: "1",
  JADE_WORLD_PERSIST: "0",
  JADE_ALLOW_VOLATILE_PRODUCTION: "1"
});
assert.equal(parsed.debugToolsEnabled, false);
assert.equal(originAllowed(parsed, "https://jade.example.com"), true);
assert.equal(originAllowed(parsed, "https://evil.example.com"), false);
assert.throws(() => loadRuntimeConfig({
  NODE_ENV: "production",
  PUBLIC_ORIGIN: "https://jade.example.com",
  JADE_WORLD_PERSIST: "0",
  JADE_ALLOW_VOLATILE_PRODUCTION: "1"
}), /ADMIN_TOKEN/);
assert.throws(() => loadRuntimeConfig({
  NODE_ENV: "production",
  PUBLIC_ORIGIN: "https://jade.example.com",
  ADMIN_TOKEN: "production-readiness-config-token",
  JADE_WORLD_PERSIST: "1",
  JADE_WORLD_PERSIST_DRIVER: "json"
}), /must use postgres/);

const port = 32000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
const adminToken = "production-readiness-admin-token";
const child = spawn(process.execPath, serverProcessArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PUBLIC_ORIGIN: origin,
    ADMIN_TOKEN: adminToken,
    JADE_WORLD_PERSIST: "0",
    JADE_ALLOW_VOLATILE_PRODUCTION: "1",
    JADE_DEBUG_TOOLS: "1",
    PORT: String(port),
    APP_VERSION: "readiness-smoke"
  },
  stdio: serverProcessStdio
});
let childOutput = "";
let stage = "boot";
child.stdout.on("data", (chunk) => { childOutput += chunk; });
child.stderr.on("data", (chunk) => { childOutput += chunk; });

function once(socket, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${stage}:${event}\n${childOutput}`)), ms);
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function waitReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health/ready`);
      if (response.ok) return response;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready\n${childOutput}`);
}

try {
  const ready = await waitReady();
  assert.equal(ready.headers.has("content-security-policy"), true);
  assert.equal((await fetch(`${origin}/main.js`)).status, 404, "production static files belong to the web service");
  const pollingUrl = `${origin}/socket.io/?EIO=4&transport=polling`;
  const polling = await fetch(pollingUrl, { headers: { "Sec-Fetch-Site": "same-origin" } });
  assert.equal(polling.status, 200, "same-origin browser polling does not send an Origin header");
  const handshake = JSON.parse((await polling.text()).slice(1));
  await fetch(`${pollingUrl}&sid=${handshake.sid}`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: "1"
  });
  for (const headers of [{}, { "Sec-Fetch-Site": "cross-site" }]) {
    const denied = await fetch(pollingUrl, { headers });
    assert.notEqual(denied.status, 200, "polling still requires an allowed browser origin");
    await denied.text();
  }
  const hostDenied = await new Promise((resolve, reject) => {
    const request = httpRequest(pollingUrl, { headers: { Host: "other.example", "Sec-Fetch-Site": "same-origin" } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
  assert.notEqual(hostDenied, 200, "polling cannot infer an origin outside the whitelist");
  assert.equal((await fetch(`${origin}/metrics`)).status, 404);
  assert.equal((await fetch(`${origin}/metrics`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  })).status, 200);
  assert.equal((await fetch(`${origin}/api/account/session`)).status, 401);
  assert.equal((await fetch(`${origin}/api/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "blocked", password: "blocked-password" })
  })).status, 403);

  const socket = io(origin, {
    transports: ["websocket"],
    autoConnect: false,
    extraHeaders: { Origin: origin },
    auth: { capabilities: { statePatchV1: true } }
  });
  stage = "initial-connect";
  const helloPromise = once(socket, "hello");
  const statePromise = once(socket, "state");
  socket.connect();
  await once(socket, "connect");
  const hello = await helloPromise;
  const initial = await statePromise;
  assert.ok(hello.playerId);
  assert.ok(hello.resumeToken);

  socket.emit("debugGrant", { cash: 999999 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  stage = "request-resync";
  const refreshedPromise = once(socket, "state");
  socket.emit("requestState");
  const refreshed = await refreshedPromise;
  assert.equal(refreshed.me.cash, initial.me.cash, "production must not register debug mutations");

  const invalidToastPromise = once(socket, "toast");
  stage = "invalid-mutation";
  socket.emit("setName", { value: "非法改名" });
  const invalidToast = await invalidToastPromise;
  assert.match(String(invalidToast), /请求编号/);
  socket.close();

  const denied = io(origin, {
    transports: ["websocket"],
    autoConnect: false,
    reconnection: false,
    timeout: 1500,
    extraHeaders: { Origin: "https://evil.example.com" }
  });
  denied.connect();
  stage = "denied-origin";
  const deniedError = await once(denied, "connect_error");
  assert.ok(deniedError);
  denied.close();
} finally {
  await stopTestServer(child);
}

assert.equal(child.exitCode, 0, childOutput);
console.log("production-readiness-smoke: origin + headers + debug lock + graceful shutdown ok");
