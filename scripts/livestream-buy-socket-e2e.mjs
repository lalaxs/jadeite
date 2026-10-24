/**
 * Live socket E2E: player A opens livestream → player B buys an item.
 * Usage: node scripts/livestream-buy-socket-e2e.mjs [baseUrl]
 */
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { randomUUID } from "node:crypto";

const baseUrl = process.argv[2] || "http://localhost:3000";

function once(socket, event, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

function connectPlayer() {
  const socket = io(baseUrl, { transports: ["websocket"], autoConnect: false });
  const statePromise = once(socket, "state", 12000);
  socket.connect();
  return { socket, statePromise };
}

function emitAck(socket, event, payload, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ack ${event}`)), ms);
    socket.emit(event, payload, (result) => {
      clearTimeout(t);
      resolve(result);
    });
  });
}

const sellerConn = connectPlayer();
await once(sellerConn.socket, "connect");
let sellerState = await sellerConn.statePromise;
assert.ok(sellerState.me?.id, "seller me");

if (sellerState.me?.livestreamRoom) {
  const closed = once(sellerConn.socket, "state");
  sellerConn.socket.emit("closeLivestreamRoom", { requestId: randomUUID() });
  sellerState = await closed;
}

if (!sellerState.me?.assets?.livestreamPermitOwned) {
  const afterPermit = once(sellerConn.socket, "state");
  sellerConn.socket.emit("buyAssetListing", "livestream-permit");
  sellerState = await afterPermit;
  assert.equal(sellerState.me.assets.livestreamPermitOwned, true, "need livestream permit");
}

const finished = (sellerState.me.bracelets || []).filter(
  (item) => item.materialStage === "finished" || item.type === "bracelet"
);
if (finished.length < 3) {
  const afterSpawn = once(sellerConn.socket, "state");
  sellerConn.socket.emit("debugSpawnFinished", { count: 8 });
  sellerState = await afterSpawn;
}

const products = (sellerState.me.bracelets || [])
  .filter((item) => item.materialStage === "finished" || item.type === "bracelet")
  .slice(0, 3);
assert.equal(products.length, 3, "seller needs 3 finished products");

const afterStart = once(sellerConn.socket, "state");
const startAck = await emitAck(sellerConn.socket, "startLivestreamRoom", {
  items: products.map((item, index) => ({ productId: item.id, price: 11_000 + index * 500 })),
  workerId: null,
  talkStyle: "balanced",
  requestId: randomUUID()
});
assert.equal(startAck?.ok, true, `start failed: ${startAck?.message}`);
sellerState = await afterStart;
const room = sellerState.me.livestreamRoom;
assert.ok(room?.id, "seller room after start");
assert.ok(room.items?.length >= 3, "room should have items");

const buyerConn = connectPlayer();
await once(buyerConn.socket, "connect");
let buyerState = await buyerConn.statePromise;
assert.ok(buyerState.me?.id, "buyer me");
assert.notEqual(buyerState.me.id, sellerState.me.id, "two distinct players");

const publicRoom = (buyerState.livestreamRooms || []).find((entry) => entry.id === room.id)
  || (buyerState.livestreamRooms || []).find((entry) => entry.ownerId === sellerState.me.id);
assert.ok(publicRoom, "buyer must see seller room in livestreamRooms");
assert.ok(publicRoom.items?.length >= 1, "public room has items");

const target = publicRoom.items[0];
const buyerCashBefore = Number(buyerState.me.cash || 0);
const buyerBraceletsBefore = (buyerState.me.bracelets || []).length;
assert.ok(buyerCashBefore >= target.price, `buyer cash ${buyerCashBefore} < price ${target.price}`);

const sellerAfterBuy = once(sellerConn.socket, "state");
const afterBuy = once(buyerConn.socket, "state");
const buyAck = await emitAck(buyerConn.socket, "buyLivestreamRoomItem", {
  roomId: publicRoom.id,
  itemId: target.id,
  requestId: randomUUID()
});
assert.equal(buyAck?.ok, true, `buy failed: ${buyAck?.message}`);
buyerState = await afterBuy;
const sellerStateAfterBuy = await sellerAfterBuy;

assert.equal(Number(buyerState.me.cash), buyerCashBefore - target.price);
assert.equal((buyerState.me.bracelets || []).length, buyerBraceletsBefore + 1);
const owned = (buyerState.me.bracelets || []).some((item) => item.id === target.product?.id);
assert.ok(owned, "bought product must land in buyer bracelets");

const sellerStock = sellerStateAfterBuy.me?.livestreamRoom?.items?.length;
assert.equal(sellerStock, room.items.length - 1, "seller stock should drop by 1");
const hallAfter = (buyerState.livestreamRooms || []).find((entry) => entry.id === publicRoom.id);
if (hallAfter) assert.equal(hallAfter.items.length, publicRoom.items.length - 1);

sellerConn.socket.emit("closeLivestreamRoom", { requestId: randomUUID() });
sellerConn.socket.close();
buyerConn.socket.close();
console.log("livestream-buy-socket-e2e: ok");
process.exit(0);
