import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { maintainNpcBlackmarket } from "../server/services/blackmarket/npc.js";
import { refreshBlackmarketSnapshot } from "../ops/refresh-blackmarket.mjs";

const now = Date.now();
H.state.players.clear();
H.state.blackStalls.length = 0;
H.state.blackServiceOrders.length = 0;
const seller = H.makePlayer("refresh-seller");
const observer = H.makePlayer("refresh-observer");
H.normalizePlayer(seller);
H.normalizePlayer(observer);
H.state.players.set(seller.id, seller);
H.state.players.set(observer.id, observer);
const goods = seller.rough.pop();
const blind = observer.rough.pop();
const cash = seller.cash;
H.state.blackStalls.push({
  id: "old-goods", ownerId: seller.id, type: "goods", status: "open",
  items: [{ id: "old-row", type: "rough", item: goods, price: 100 }], pool: [], offers: []
}, {
  id: "old-blind", ownerId: observer.id, type: "blindbox", status: "setup",
  items: [], pool: [{ id: "old-pool-row", type: "rough", item: blind }], offers: []
});
maintainNpcBlackmarket(now);
const original = H.world.exportSnapshot({ savedAt: now });
const frozen = structuredClone(original);
const oldIds = new Set(original.blackStalls.flatMap((stall) => stall.items.map((row) => row.id)));
const oldSequences = new Map(original.blackStalls.filter((stall) => stall.npc).map((stall) => [stall.id, stall.npcSequence]));
const refreshed = refreshBlackmarketSnapshot(original, now + 1000);
assert.deepEqual(original, frozen, "Input and original backup must remain unchanged");
assert.equal(refreshed.summary.removedStalls, 8);
assert.equal(refreshed.summary.newStalls, 6);
assert.equal(refreshed.summary.newItems, 32);
assert.equal(refreshed.summary.returned.length, 2);
assert.equal(H.state.players.get(seller.id).cash, cash);
assert.deepEqual(H.state.players.get(seller.id).rough.at(-1), goods);
assert.deepEqual(H.state.players.get(observer.id).rough.at(-1), blind);
for (const stall of refreshed.snapshot.blackStalls) {
  assert.equal(stall.status, "open");
  assert.equal(stall.createdAt, now + 1000);
  assert.ok(stall.npcSequence > oldSequences.get(stall.id));
  assert.ok(stall.items.every((row) => !oldIds.has(row.id)));
}
const active = structuredClone(original);
active.blackStalls.find((stall) => stall.id === "old-blind").blindDraw = { candidates: [], price: 100 };
assert.throws(() => refreshBlackmarketSnapshot(active), /blind draw is active/);
const missingOwner = structuredClone(original);
missingOwner.blackStalls[0].ownerId = "missing-player";
assert.throws(() => refreshBlackmarketSnapshot(missingOwner), /Missing owner/);
console.log("blackmarket-refresh-smoke: returned goods/blind stock, preserved cash, fresh 6 stalls/32 goods, and active-trade guard ok");
