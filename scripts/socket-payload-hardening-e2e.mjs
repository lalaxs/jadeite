/** Live Socket.IO check: explicit null payloads cannot break mutation handlers. */
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

async function emitAndWaitForToast(socket, event, payload) {
  const toast = once(socket, "toast");
  socket.emit(event, payload);
  return toast;
}

const socket = io(baseUrl, {
  transports: ["websocket"],
  autoConnect: false
});
const hello = once(socket, "hello");
const state = once(socket, "state");
socket.connect();
await once(socket, "connect");
await hello;
const initialState = await state;

socket.emit("markInventorySeen", null);
for (const event of [
  "buyMaterialPack",
  "completeOrder",
  "bmAddBlindItems",
  "task:claim",
  "startCut",
  "scheduleLivestream"
]) {
  const toast = await emitAndWaitForToast(socket, event, null);
  assert.ok(toast != null, `${event} should reject or safely acknowledge null payloads`);
  assert.equal(socket.connected, true, `${event} must not disconnect the client`);
}

const chatResult = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout waiting for sendWorldChat ack")), 10_000);
  socket.emit("sendWorldChat", null, (result) => {
    clearTimeout(timer);
    resolve(result);
  });
});
assert.equal(chatResult.ok, false);
assert.match(chatResult.message, /不能为空|修改|发送失败/);

const plannedParent = [...(initialState.me?.rough || []), ...(initialState.me?.materials || [])][0];
assert.ok(plannedParent?.id, "new player should have a source item for planned recycle hardening");
let latestCash = Number(initialState.me.cash);
for (const [index, kitId] of ["forged-kit-a", "forged-kit-b"].entries()) {
  const resultPromise = once(socket, "inventoryRecycleResult");
  const nextStatePromise = once(socket, "state");
  socket.emit("recycleInventoryItem", {
    requestId: `e2e-planned-recycle-${index + 1}`,
    kind: "planned",
    parentId: plannedParent.id,
    kitId
  });
  const result = await resultPromise;
  const nextState = await nextStatePromise;
  assert.equal(result.ok, true);
  assert.equal(result.payout, 0, "client-only planning drafts must never mint server cash");
  assert.equal(Number(nextState.me.cash), latestCash);
  latestCash = Number(nextState.me.cash);
}

const debugToast = await emitAndWaitForToast(socket, "debugGrant", null);
assert.match(String(debugToast?.text || debugToast), /调试/);
assert.equal(socket.connected, true);

socket.close();
console.log("socket-payload-hardening-e2e: ok");
process.exit(0);
