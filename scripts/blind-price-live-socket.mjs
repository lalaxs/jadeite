/**
 * Live socket refresh: same playerId reconnect must keep healed blindPrice (not ¥1).
 */
import assert from "node:assert/strict";
import { io } from "socket.io-client";

const baseUrl = process.argv[2] || "http://localhost:3000";

function once(socket, event, ms = 12000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

async function connect(session = {}) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    autoConnect: false,
    auth: session.playerId ? session : {}
  });
  const helloP = once(socket, "hello", 12000);
  const stateP = once(socket, "state", 12000);
  socket.connect();
  await once(socket, "connect");
  const hello = await helloP;
  const state = await stateP;
  return {
    socket,
    state,
    playerId: hello.playerId,
    resumeToken: hello.resumeToken
  };
}

async function waitState(socket) {
  return once(socket, "state", 12000);
}

let { socket, state, playerId, resumeToken } = await connect();
assert.ok(playerId);

if (Number(state.me?.achievementPoints || 0) < 680) {
  const unlockedP = waitState(socket);
  socket.emit("debugGrant", { ap: 680 - Number(state.me?.achievementPoints || 0) });
  state = await unlockedP;
}

if ((state.blackStalls || []).some((s) => s.isMine)) {
  const p = waitState(socket);
  socket.emit("bmCloseStall");
  state = await p;
}

const openP = waitState(socket);
socket.emit("bmOpenStall", {
  type: "blindbox",
  title: "刷新定价同人",
  anonymous: false
});
state = await openP;

const roughs = state.me?.rough || [];
assert.ok(roughs.length >= 1, "need rough");
const prices = roughs.map((r) => Number(r.price || r.value || 0)).filter((n) => n > 0);
const expectedAvg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

const putP = once(socket, "bmListResult", 10000);
const afterPutP = waitState(socket);
socket.emit("bmAddBlindItems", {
  entries: roughs.map((r) => ({ type: "rough", itemId: r.id })),
  blindPrice: 1
});
const putRes = await putP;
state = await afterPutP;
assert.equal(putRes.ok, true, putRes.message);
assert.equal(Number(putRes.blindPrice), expectedAvg);

let mine = (state.blackStalls || []).find((s) => s.isMine);
assert.equal(Number(mine.blindPrice), expectedAvg);

// Force stuck-at-1 then let next snapshot heal (covers old data after upgrade)
socket.emit("bmUpdateStallMeta", { blindPrice: 1, blindDescription: "" });
state = await waitState(socket);
mine = (state.blackStalls || []).find((s) => s.isMine);
assert.equal(Number(mine.blindPrice), expectedAvg, "meta=1 must keep/heal avg before refresh");

socket.close();

// Browser refresh equivalent: reconnect with same playerId
const resumed = await connect({ playerId, resumeToken });
assert.equal(resumed.playerId, playerId);
mine = (resumed.state.blackStalls || []).find((s) => s.isMine);
assert.ok(mine, "stall must survive refresh");
assert.equal(
  Number(mine.blindPrice),
  expectedAvg,
  `after refresh blindPrice must be ${expectedAvg}, got ${mine.blindPrice}`
);
assert.notEqual(Number(mine.blindPrice), 1);

resumed.socket.close();
console.log(`blind-price-refresh-live: ok (¥${expectedAvg} survives same-player refresh)`);
process.exit(0);
