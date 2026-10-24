/**
 * Live Socket.IO check: the same persisted request id cannot charge twice,
 * including after a reconnect with the player's resume token.
 */
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { ASSET_LISTINGS } from "../server/services/assets-service.js";

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

async function connect(session = {}) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    autoConnect: false,
    auth: session.playerId ? session : {}
  });
  const helloPromise = once(socket, "hello");
  const statePromise = once(socket, "state");
  socket.connect();
  await once(socket, "connect");
  return {
    socket,
    hello: await helloPromise,
    state: await statePromise
  };
}

function emitWithAck(socket, event, payload, ms = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event} ack`)), ms);
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

const requestId = "e2e-buy-permit-once";
const permitPrice = ASSET_LISTINGS.find((listing) => listing.id === "livestream-permit")?.price;
assert.ok(Number(permitPrice) > 0, "livestream permit must have a positive catalog price");
let first = await connect();
const cashBefore = Number(first.state.me.cash);
const uniqueSuffix = String(first.hello.playerId).replace(/[^A-Za-z0-9]/g, "").slice(-6);
const expectedName = `防重-${uniqueSuffix}`;
const expectedChat = `防重消息-${uniqueSuffix}`;
assert.equal(first.state.me.assets.livestreamPermitOwned, false);

const boughtStatePromise = once(first.socket, "state");
first.socket.emit("buyAssetListing", {
  listingId: "livestream-permit",
  requestId
});
const boughtState = await boughtStatePromise;
assert.equal(boughtState.me.assets.livestreamPermitOwned, true);
assert.equal(Number(boughtState.me.cash), cashBefore - permitPrice);

const duplicateToastPromise = once(first.socket, "toast");
first.socket.emit("buyAssetListing", {
  listingId: "livestream-permit",
  requestId
});
const duplicateToast = await duplicateToastPromise;
assert.match(String(duplicateToast?.text || duplicateToast), /已处理|重复/);

const renameRequestId = "e2e-rename-once";
const renamedStatePromise = once(first.socket, "state");
first.socket.emit("setName", {
  value: expectedName,
  requestId: renameRequestId
});
const renamedState = await renamedStatePromise;
assert.equal(renamedState.me.name, expectedName);

const chatRequestId = "e2e-chat-once";
const chatResult = await emitWithAck(first.socket, "sendWorldChat", {
  text: expectedChat,
  requestId: chatRequestId
});
assert.equal(chatResult.ok, true);

const session = {
  playerId: first.hello.playerId,
  resumeToken: first.hello.resumeToken
};
first.socket.close();

const resumed = await connect(session);
assert.equal(resumed.hello.playerId, session.playerId);
assert.equal(Number(resumed.state.me.cash), cashBefore - permitPrice);
assert.equal(resumed.state.me.name, expectedName);
assert.equal(
  resumed.state.news.filter((entry) => String(entry.text || "").includes(`${expectedName} 换上了新招牌`)).length,
  1
);
assert.equal(resumed.state.worldChat.filter((entry) => entry.text === expectedChat).length, 1);
const reconnectDuplicatePromise = once(resumed.socket, "toast");
resumed.socket.emit("buyAssetListing", {
  listingId: "livestream-permit",
  requestId
});
const reconnectDuplicateToast = await reconnectDuplicatePromise;
assert.match(
  String(reconnectDuplicateToast?.text || reconnectDuplicateToast),
  /已处理|重复/
);
const duplicateRenameToastPromise = once(resumed.socket, "toast");
resumed.socket.emit("setName", {
  value: "不应生效的名称",
  requestId: renameRequestId
});
const duplicateRenameToast = await duplicateRenameToastPromise;
assert.match(String(duplicateRenameToast?.text || duplicateRenameToast), /已处理|重复/);

const duplicateChatResult = await emitWithAck(resumed.socket, "sendWorldChat", {
  text: "不应重复出现",
  requestId: chatRequestId
});
assert.equal(duplicateChatResult.ok, false);
assert.equal(duplicateChatResult.duplicate, true);
resumed.socket.close();

console.log("mutation-idempotency-socket-e2e: ok");
process.exit(0);
