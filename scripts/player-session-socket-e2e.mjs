/** Live Socket.IO check for valid resume and rejected token impersonation. */
import assert from "node:assert/strict";
import { io } from "socket.io-client";

const baseUrl = process.argv[2] || "http://localhost:3000";

function once(socket, event, ms = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function connect(auth = {}) {
  const socket = io(baseUrl, { transports: ["websocket"], autoConnect: false, auth });
  const helloPromise = once(socket, "hello");
  const statePromise = once(socket, "state");
  socket.connect();
  await once(socket, "connect");
  return { socket, hello: await helloPromise, state: await statePromise };
}

const first = await connect();
assert.ok(first.hello.playerId);
assert.ok(first.hello.resumeToken);
const session = {
  playerId: first.hello.playerId,
  resumeToken: first.hello.resumeToken
};
first.socket.close();

const resumed = await connect(session);
assert.equal(resumed.hello.playerId, session.playerId);
assert.equal(resumed.state.me.id, session.playerId);
resumed.socket.close();

const rejected = io(baseUrl, {
  transports: ["websocket"],
  autoConnect: false,
  auth: { playerId: session.playerId, resumeToken: "invalid-token-value" }
});
const errorPromise = once(rejected, "session:error");
rejected.connect();
await once(rejected, "connect");
const error = await errorPromise;
assert.equal(error.code, "INVALID_PLAYER_SESSION");
rejected.close();

const fresh = await connect();
assert.notEqual(fresh.hello.playerId, session.playerId);
fresh.socket.close();

console.log("player-session-socket-e2e: ok");
process.exit(0);
