/**
 * Live socket E2E: open stall → list goods → expect bmListResult.
 * Usage: node scripts/blackmarket-socket-e2e.mjs [baseUrl]
 */
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { BLACKMARKET_MIN_PRICE } from "../server/services/blackmarket-service.js";

const baseUrl = process.argv[2] || "http://localhost:3000";

function once(socket, event, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

const socket = io(baseUrl, { transports: ["websocket"], autoConnect: false });
const state1Promise = once(socket, "state", 10000);
socket.connect();
await once(socket, "connect");
const state1 = await state1Promise;
const me = state1.me;
assert.ok(me?.id, "expected me in state");

let unlockedState = state1;
if (Number(me.achievementPoints || 0) < 680) {
  const unlockedPromise = once(socket, "state");
  socket.emit("debugGrant", { ap: 680 - Number(me.achievementPoints || 0) });
  unlockedState = await unlockedPromise;
}

const beforeStalls = (unlockedState.blackStalls || []).length;
const myStall = (unlockedState.blackStalls || []).find((s) => s.isMine);
if (myStall) {
  const closed = once(socket, "state");
  socket.emit("bmCloseStall");
  await closed;
}

const afterOpenPromise = once(socket, "state");
socket.emit("bmOpenStall", { type: "goods", title: "E2E摊", blurb: "测试", anonymous: false });
const afterOpen = await afterOpenPromise;
const stall = (afterOpen.blackStalls || []).find((s) => s.isMine);
assert.ok(stall, "stall should exist after open");
assert.equal(stall.type, "goods");

const item = (afterOpen.me?.rough || [])[0] || (afterOpen.me?.bracelets || [])[0];
assert.ok(item, "need an inventory item to list");

const type = item.type === "bracelet" || (afterOpen.me.bracelets || []).some((b) => b.id === item.id)
  ? "bracelet"
  : item.type || "rough";
const resultPromise = once(socket, "bmListResult", 8000);
const state2Promise = once(socket, "state", 8000);
socket.emit("bmListItem", { type, itemId: item.id, price: BLACKMARKET_MIN_PRICE });
const result = await resultPromise;
assert.equal(result.ok, true, `bmListResult failed: ${result.message}`);

const state2 = await state2Promise;
const stall2 = (state2.blackStalls || []).find((s) => s.isMine);
assert.ok(stall2?.items?.length >= 1, "goods should appear on stall");
assert.ok((state2.blackStalls || []).length >= Math.max(1, beforeStalls));

socket.close();
console.log("blackmarket-socket-e2e: ok");
process.exit(0);
