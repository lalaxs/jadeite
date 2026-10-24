import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import { preparePostgresTestEnvironment } from "./fixtures/postgres-test-environment.mjs";
import { serverProcessArgs, serverProcessStdio, stopTestServer } from "./fixtures/test-server-process.mjs";

const databaseTest = await preparePostgresTestEnvironment("account");

const port = 34000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, serverProcessArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PUBLIC_ORIGIN: origin,
    ADMIN_TOKEN: "account-e2e-admin-token-32-chars-minimum",
    JADE_WORLD_PERSIST: "0",
    JADE_ALLOW_VOLATILE_PRODUCTION: "1",
    ...databaseTest.env,
    PORT: String(port),
    LOG_LEVEL: "warn"
  },
  stdio: serverProcessStdio
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

function once(socket, event, ms = 5000) {
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
  throw new Error(output);
}

async function connect(options = {}) {
  const socket = io(origin, {
    transports: ["websocket"],
    autoConnect: false,
    reconnection: false,
    extraHeaders: { Origin: origin, ...(options.headers || {}) },
    auth: options.auth || {}
  });
  const helloPromise = once(socket, "hello");
  const statePromise = once(socket, "state");
  socket.connect();
  await once(socket, "connect");
  return { socket, hello: await helloPromise, state: await statePromise };
}

try {
  await waitReady();
  const guest = await connect();
  const username = `jade_${String(process.pid).slice(-6)}`;
  const password = "correct-horse-jade-account";
  const bind = await fetch(`${origin}/api/account/bind`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      playerId: guest.hello.playerId,
      resumeToken: guest.hello.resumeToken,
      username,
      password
    })
  });
  assert.equal(bind.status, 201);
  assert.equal((await bind.json()).account.username, username);
  guest.socket.close();

  const rejected = await fetch(`${origin}/api/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ username, password: "incorrect-password" })
  });
  assert.equal(rejected.status, 401);

  const login = await fetch(`${origin}/api/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.status, 200);
  const sessionCookie = login.headers.get("set-cookie").split(";")[0];
  const loggedIn = await connect({ headers: { Cookie: sessionCookie } });
  assert.equal(loggedIn.hello.playerId, guest.hello.playerId);
  assert.equal(loggedIn.state.me.id, guest.hello.playerId);
  const another = await connect({ auth: { playerId: guest.hello.playerId, resumeToken: guest.hello.resumeToken } });
  const loggedOut = once(loggedIn.socket, "disconnect");
  const logout = await fetch(`${origin}/api/account/logout`, {
    method: "POST", headers: { Origin: origin, Cookie: sessionCookie }
  });
  assert.equal(logout.status, 200);
  await loggedOut;
  assert.equal(another.socket.connected, true, "single logout preserves another session");
  const allOut = once(another.socket, "disconnect");
  const logoutAll = await fetch(`${origin}/api/account/logout-all`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ playerId: guest.hello.playerId, resumeToken: guest.hello.resumeToken })
  });
  assert.equal(logoutAll.status, 200);
  await allOut;
  const hijack = io(origin, { transports: ["websocket"], autoConnect: false, reconnection: false,
    extraHeaders: { Origin: origin }, auth: { playerId: guest.hello.playerId } });
  const denied = once(hijack, "session:error");
  hijack.connect();
  assert.equal((await denied).code, "INVALID_PLAYER_SESSION", "public id cannot claim a revoked account");
  hijack.close();
  const relogin = await fetch(`${origin}/api/account/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ username, password })
  });
  assert.equal(relogin.status, 200, "password login still works after revoking all sessions");
  const recovered = await connect({ headers: { Cookie: relogin.headers.get("set-cookie").split(";")[0] } });
  assert.equal(recovered.state.me.id, guest.hello.playerId);
  recovered.socket.close();
} finally {
  await stopTestServer(child);
  await databaseTest.cleanup();
}

assert.equal(child.exitCode, 0, output);
console.log("account-http-e2e: guest bind + password login + HttpOnly cookie resume + live revocation + public-id denial + relogin ok");
