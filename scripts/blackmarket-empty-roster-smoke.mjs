import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import {
  bindBlackmarketApi, openBlackStallForPlayer, addGoodsBatchToStallForPlayer,
  buyGoodsFromStallForPlayer, withdrawGoodsFromStallForPlayer,
  reconcileBlackmarketReferences, maintainNpcBlackmarket
} from "../server/services/blackmarket-service.js";
import { requireApi } from "../server/services/blackmarket/context.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

const api = requireApi();
H.state.players.clear(); H.state.blackStalls.length = 0; H.state.blackServiceOrders.length = 0;
function player(id, legacyOwned = false) {
  const p = H.makePlayer(id);
  if (legacyOwned) installOwnedWorkshopFixture(p);
  H.normalizePlayer(p);
  p.cash = 1_000_000; p.assets.workshopOwned = true;
  H.state.players.set(p.id, p);
  return p;
}
const fresh = player("fresh-empty");
assert.equal(fresh.workshop.devices.length, 0, "new accounts begin without gifted machines");
assert.equal(fresh.workshop.workers.length, 0, "new accounts are self-run without gifted paid employees");
assert.deepEqual(H.workshopDevicesForPlayer(fresh), []);
const seller = player("sell-empty", true), neighbor = player("sell-neighbor", true), buyer = player("buy-starters", true);
const sourceWorkers = structuredClone(seller.workshop.workers);
const sourceDevices = structuredClone(seller.workshop.devices);
assert.equal(sourceWorkers.length, 4); assert.equal(sourceDevices.length, 3);
for (const p of [seller, neighbor]) assert.equal(openBlackStallForPlayer(p, { type: "goods" }).ok, true);
const stallFor = (p) => H.state.blackStalls.find((stall) => stall.ownerId === p.id);
const entries = [
  ...sourceWorkers.map((item) => ({ type: "employee", itemId: item.id, price: 2000 })),
  ...sourceDevices.map((item) => ({ type: "equipment", itemId: item.id, price: 2000 }))
];
assert.equal(addGoodsBatchToStallForPlayer(seller, entries).ok, true, "all initial resources may be listed together");
assert.equal(addGoodsBatchToStallForPlayer(neighbor, [entries[0]]).ok, true, "another owner may list the same local starter ID");

const snapshot = () => createMemoryWorldStore({ players: H.state.players, blackStalls: H.state.blackStalls }).exportSnapshot();
const roundtrip = () => {
  const restored = createMemoryWorldStore();
  restored.importSnapshot(structuredClone(snapshot()));
  return restored;
};
const listed = roundtrip();
bindBlackmarketApi({ ...api, getState: () => listed.raw });
reconcileBlackmarketReferences(listed.raw);
assert.ok(listed.raw.players.get(seller.id).workshop.workers.every((worker) => worker.blackmarketListingId));
assert.ok(listed.raw.players.get(neighbor.id).workshop.workers[0].blackmarketListingId);
bindBlackmarketApi(api);
const duplicate = snapshot();
const duplicateStall = duplicate.blackStalls.find((stall) => stall.ownerId === seller.id);
duplicateStall.items.push({ ...structuredClone(duplicateStall.items.find((row) => row.type === "employee")), id: "duplicate-starter-listing" });
assert.throws(() => createMemoryWorldStore().importSnapshot(duplicate), /duplicate owned item/);

const stallId = stallFor(seller).id;
const firstRow = stallFor(seller).items.find((row) => row.type === "employee");
const before = structuredClone({ seller, buyer, stalls: H.state.blackStalls });
try {
  bindBlackmarketApi({ ...api, earnCash() { throw new Error("injected starter payout failure"); } });
  assert.equal(buyGoodsFromStallForPlayer(buyer, stallId, firstRow.id).ok, false);
  assert.deepEqual({ seller, buyer, stalls: H.state.blackStalls }, before, "failed transfer restores money, roster, departure markers and shelf");
} finally { bindBlackmarketApi(api); }

const acquiredIds = [];
for (const row of [...stallFor(seller).items]) {
  const result = buyGoodsFromStallForPlayer(buyer, stallId, row.id, row.price);
  assert.equal(result.ok, true, result.message);
  if (row.type === "employee") {
    const acquired = buyer.workshop.workers.find((worker) => worker.tradeHistory?.at(-1)?.sellerId === seller.id && !acquiredIds.includes(worker.id));
    assert.ok(acquired); assert.notEqual(acquired.id, row.item.id);
    assert.deepEqual(acquired.skills, sourceWorkers.find((worker) => worker.id === row.item.id).skills);
    assert.deepEqual(acquired.traits, row.item.traits);
    acquiredIds.push(acquired.id);
  }
}
assert.equal(new Set(acquiredIds).size, 4);
H.normalizePlayer(buyer);
assert.equal(buyer.workshop.workers.length, 8, "buyer retains their own four starters and receives four distinct employees");
assert.equal(seller.workshop.workers.length, 0); assert.equal(seller.workshop.devices.length, 0);
assert.deepEqual([...seller.workshop.dismissedStarterIds].sort(), sourceWorkers.map((worker) => worker.id).sort());
for (let i = 0; i < 2; i++) H.normalizePlayer(seller);
assert.equal(seller.workshop.workers.length, 0); assert.equal(seller.workshop.devices.length, 0);
const empty = roundtrip();
const restoredSeller = empty.raw.players.get(seller.id);
H.normalizePlayer(restoredSeller);
H.normalizePlayer(empty.raw.players.get(buyer.id));
assert.equal(restoredSeller.workshop.workers.length, 0, "save/restore must not regrant sold starter employees");
assert.equal(restoredSeller.workshop.devices.length, 0, "save/restore must not regrant sold starter devices");
assert.deepEqual(empty.raw.players.get(buyer.id).workshop.workers.slice(4).map((worker) => worker.id).sort(), acquiredIds.sort());

const neighborRow = stallFor(neighbor).items[0];
assert.equal(withdrawGoodsFromStallForPlayer(neighbor, neighborRow.id).ok, true);
assert.equal(neighbor.workshop.workers.length, 4);
assert.equal(neighbor.workshop.workers.find((worker) => worker.id === neighborRow.item.id).blackmarketListingId, undefined);

maintainNpcBlackmarket();
for (const role of ["employee", "equipment"]) {
  const npc = H.state.blackStalls.find((stall) => stall.npcRole === role);
  assert.equal(buyGoodsFromStallForPlayer(seller, npc.id, npc.items[0].id).ok, true, "empty business can buy resources again");
}
H.normalizePlayer(seller);
assert.equal(seller.workshop.workers.length, 1); assert.equal(seller.workshop.devices.length, 1);
roundtrip();
console.log("blackmarket-empty-roster-smoke: initial resource transfers, local ID collisions, rollback, zero-roster save/restore and repurchase ok");
