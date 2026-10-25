import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { __testHooks as H } from "../server.js";
import { bindMarketApi, listItemForPlayer, withdrawListingForPlayer, buyListingForPlayer } from "../server/services/market-service.js";
import { createDeviceInstance } from "../server/systems/equipment-system.js";
import { takeItem, addItem } from "../server/services/inventory-service.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { marketMakerOffer } from "../server/services/market-liquidity-service.js";
import { equipmentResaleValue } from "../shared/domain/economy/equipment-trading.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

H.state.players.clear();
H.state.listings.length = 0;
H.state.news.length = 0;
H.state.blackStalls.length = 0;
H.state.blackServiceOrders.length = 0;
let failNews = false;
bindMarketApi({ getState: () => H.state, money: (value) => Math.max(0, Math.round(Number(value) || 0)), randomUUID, takeItem, addItem,
  spendCash: H.spendCash, earnCash: H.earnCash, advanceTask: H.advanceTask, uiMoney: (value) => String(value),
  addNews: (...args) => { if (failNews) throw new Error("injected news failure"); return H.addNews(...args); }
});
function player(id, cash = 100000) {
  const row = installOwnedWorkshopFixture(H.makePlayer(id));
  row.cash = cash;
  H.state.players.set(id, row);
  return row;
}
const seller = player("equipment-seller");
const buyer = player("equipment-buyer");
const original = seller.workshop.devices.find((device) => device.stage === "opening");
const list = (device = original, price = 4000) => listItemForPlayer(seller, { type: "equipment", itemId: device.id, price });
assert.equal(list().ok, true, "the last device of a production stage can be listed");
assert.equal(withdrawListingForPlayer(seller, H.state.listings[0].id).ok, true);
const extra = createDeviceInstance("opening", original.modelKey, randomUUID());
extra.condition = 37;
seller.workshop.devices.push(extra);
extra.blackmarketListingId = "reserved-blackmarket-listing";
assert.match(list(extra).message, /黑市挂牌/);
delete extra.blackmarketListingId;
seller.workshop.selectedDeviceId = extra.id;
for (const price of [NaN, Infinity, -100, 99]) assert.equal(list(extra, price).ok, false);
seller.jobs.push({ id: "busy-job", deviceId: extra.id });
assert.match(list(extra).message, /加工/);
seller.jobs.length = 0;
H.state.blackStalls.push({ id: "reserved-stall", offers: [{ id: "reserved-offer", capabilityRefs: { equipmentIds: [extra.id] } }] });
H.state.blackServiceOrders.push({ sellerId: seller.id, stallId: "reserved-stall", offerId: "reserved-offer", status: "escrow" });
assert.match(list(extra).message, /订单占用/);
H.state.blackServiceOrders.length = H.state.blackStalls.length = 0;
const deviceBefore = structuredClone(extra);
const workerIds = seller.workshop.workers.map((row) => row.id);
failNews = true;
assert.equal(list(extra).code, "TRANSACTION_ABORTED");
assert.deepEqual(seller.workshop.devices.find((row) => row.id === extra.id), deviceBefore);
assert.equal(seller.workshop.selectedDeviceId, extra.id);
assert.equal(H.state.listings.length, 0);
failNews = false;
assert.equal(list(extra).ok, true);
let listing = H.state.listings[0];
assert.equal(listing.item.condition, 37);
assert.equal(listing.item.workerId, null);
assert.equal(seller.workshop.devices.some((row) => row.id === extra.id), false);
assert.deepEqual(seller.workshop.workers.map((row) => row.id), workerIds);
assert.notEqual(seller.workshop.selectedDeviceId, extra.id);
assert.equal(list(extra).ok, false, "same device cannot be listed twice");
assert.equal(marketMakerOffer(listing), 0, "jade wholesaler must not buy equipment at a fallback jade value");
assert.equal(buyListingForPlayer(seller, listing.id).ok, false);
assert.equal(withdrawListingForPlayer(buyer, listing.id).ok, false);
buyer.cash = 0;
assert.equal(buyListingForPlayer(buyer, listing.id).ok, false);
assert.equal(H.state.listings.length, 1);

// Validate restart ownership while the device is held by the market.
const store = createMemoryWorldStore({ players: H.state.players, listings: H.state.listings });
const snapshot = store.exportSnapshot();
const restored = createMemoryWorldStore();
restored.importSnapshot(snapshot);
assert.equal(restored.raw.listings[0].item.condition, 37);
assert.equal(restored.getPlayer(seller.id).workshop.devices.some((row) => row.id === extra.id), false);
const duplicate = structuredClone(snapshot);
duplicate.players.find(([id]) => id === seller.id)[1].workshop.devices.push(structuredClone(listing.item));
assert.throws(() => restored.importSnapshot(duplicate), /duplicate owned item/);

failNews = true;
assert.equal(withdrawListingForPlayer(seller, listing.id).code, "TRANSACTION_ABORTED");
assert.equal(seller.workshop.devices.some((row) => row.id === extra.id), false);
assert.equal(H.state.listings.length, 1);
failNews = false;
assert.equal(withdrawListingForPlayer(seller, listing.id).ok, true);
assert.equal(seller.workshop.devices.find((row) => row.id === extra.id).condition, 37);
assert.equal(withdrawListingForPlayer(seller, listing.id).ok, false);
assert.equal(list(extra).ok, true);
listing = H.state.listings[0];
buyer.cash = 20000;
const balances = [seller.cash, buyer.cash];
// A failed ownership transfer after payment restores the complete transaction.
buyer.workshop.devices.push(structuredClone(listing.item));
assert.equal(buyListingForPlayer(buyer, listing.id).code, "TRANSACTION_ABORTED");
assert.deepEqual([seller.cash, buyer.cash], balances);
assert.equal(H.state.listings.length, 1);
buyer.workshop.devices = buyer.workshop.devices.filter((row) => row.id !== extra.id);
const bought = buyListingForPlayer(buyer, listing.id);
assert.equal(bought.ok, true, bought.message);
assert.equal(buyer.cash, balances[1] - 4080);
assert.equal(seller.cash, balances[0] + 4000);
const acquired = buyer.workshop.devices.find((row) => row.id === extra.id);
assert.equal(acquired.condition, 37);
assert.equal(acquired.workerId, null, "the transfer clears the former owner's staffing before normalization assigns the proprietor");
assert.equal(acquired.resourceOrigin, "market");
assert.equal(acquired.acquisitionPrice, 4080);
assert.equal(acquired.tradeHistory.at(-1).sellerId, seller.id);
assert.deepEqual(acquired.attrs, deviceBefore.attrs);
assert.equal(buyer.bracelets.some((row) => row.id === extra.id), false);
assert.equal(buyListingForPlayer(buyer, listing.id).ok, false);
assert.equal(withdrawListingForPlayer(seller, listing.id).ok, false);
H.normalizePlayer(buyer);
assert.equal(buyer.workshop.devices.find((row) => row.id === extra.id).condition, 37);
assert.equal(buyer.workshop.devices.find((row) => row.id === extra.id).workerId, "owner-operator");
// Broken devices remain sellable and recoverable, without free repairs.
buyer.workshop.devices.find((row) => row.id === acquired.id).condition = 0;
assert.equal(listItemForPlayer(buyer, { type: "equipment", itemId: acquired.id, price: 100 }).ok, true);
assert.equal(withdrawListingForPlayer(buyer, H.state.listings[0].id).ok, true);
assert.equal(buyer.workshop.devices.find((row) => row.id === extra.id).condition, 0);
assert.equal(equipmentResaleValue({ basePrice: 10000, condition: 60, techLevel: 1 }), 7000);
const empty = player("equipment-empty");
const emptiedDevices = structuredClone(empty.workshop.devices);
for (const device of emptiedDevices) {
  const listed = listItemForPlayer(empty, { type: "equipment", itemId: device.id, price: 100 });
  assert.equal(listed.ok, true, listed.message);
}
H.normalizePlayer(empty);
H.normalizePlayer(empty);
assert.deepEqual(empty.workshop.devices, [], "existing empty workshops must not receive starter equipment again");
const emptyListings = H.state.listings.filter((row) => row.ownerId === empty.id);
assert.equal(emptyListings.length, emptiedDevices.length);
const emptyStore = createMemoryWorldStore({ players: new Map([[empty.id, empty]]), listings: emptyListings });
const emptyRestored = createMemoryWorldStore();
emptyRestored.importSnapshot(emptyStore.exportSnapshot());
H.normalizePlayer(emptyRestored.getPlayer(empty.id));
assert.deepEqual(emptyRestored.getPlayer(empty.id).workshop.devices, [], "restoring a fully listed workshop must not grant equipment");
const withdrawn = emptyListings[0];
assert.equal(withdrawListingForPlayer(empty, withdrawn.id).ok, true);
assert.equal(empty.workshop.devices.length, 1);
assert.equal(listItemForPlayer(empty, { type: "equipment", itemId: withdrawn.item.id, price: 100 }).ok, true, "the only remaining device can be listed again after withdrawal");
for (const listing of H.state.listings.filter((row) => row.ownerId === empty.id)) {
  assert.equal(buyListingForPlayer(buyer, listing.id).ok, true);
}
H.normalizePlayer(empty);
assert.deepEqual(empty.workshop.devices, [], "selling every device must leave the workshop empty");
assert.equal(empty.workshop.selectedDeviceId, null);
for (const device of emptiedDevices) assert.equal(buyer.workshop.devices.filter((row) => row.id === device.id).length, 1);
console.log("market-equipment-smoke: listing all devices, occupancy, withdrawal, payment, rollback, ownership snapshots and empty workshop normalization ok");
process.exit(0);
