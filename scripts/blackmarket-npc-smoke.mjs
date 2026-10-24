import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { claimWorkshopOutputs } from "./workshop-test-utils.mjs";
import { maintainNpcBlackmarket } from "../server/services/blackmarket/npc.js";
import { bindBlackmarketApi, publicBlackStall, buyGoodsFromStallForPlayer, reconcileBlackmarketReferences, sweepEmptyBlackGoodsStalls } from "../server/services/blackmarket-service.js";
import { requireApi } from "../server/services/blackmarket/context.js";
import { NPC_STALLS, NPC_SHIFT_MS } from "../shared/domain/blackmarket/npc-rules.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { itemCost } from "../shared/domain/economy/item-cost.js";
import { BLACKMARKET_GOODS_TYPES, isBlackmarketGoodsType } from "../shared/domain/blackmarket/bm-constants.js";
import { bmSellables } from "../shared/domain/blackmarket/bm-plan-pool.js";
import { marketMakerOffer } from "../server/services/market-liquidity-service.js";
import { publicStone } from "../server/services/snapshot-public.js";
import { itemValue } from "../server/services/inventory-service.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

const api = requireApi();
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
try {
  H.state.blackStalls.length = 0;
  H.state.players.clear();
  H.state.sockets.clear();
  const buyer = installOwnedWorkshopFixture(H.makePlayer("npc-buyer"));
  H.normalizePlayer(buyer);
  buyer.cash = 100_000_000;
  buyer.achievementPoints = buyer.achievementPointsBonus = 680;
  H.state.players.set(buyer.id, buyer);
  assert.equal(maintainNpcBlackmarket(now).changed, true);
  assert.equal(H.state.players.size, 1, "NPCs must not appear as players");
  assert.equal(H.state.blackStalls.length, NPC_STALLS.length);
  assert.equal(H.state.blackStalls.filter((stall) => stall.npcRole !== "traveler").length, 5);
  assert.equal(H.state.blackStalls.reduce((n, stall) => n + stall.items.length, 0), 32);
  const flat = () => H.state.blackStalls.flatMap((stall) => stall.items);
  for (const type of BLACKMARKET_GOODS_TYPES) assert.ok(flat().some((row) => row.type === type), `missing ${type}`);
  assert.ok(flat().every((row) => isBlackmarketGoodsType(row.type)));
  assert.equal(flat().filter((row) => row.npcDiscount).length, NPC_STALLS.length);
  assert.equal(flat().filter((row) => row.npcPremium).length, 2);
  for (const row of flat()) {
    if (["employee", "equipment"].includes(row.type)) continue; // Resource pricing and usability have their own suite.
    const ratio = row.price / row.referencePrice;
    assert.ok(ratio >= 0.68 - 0.005 && ratio <= 1.00 + 0.005, `bad price: ${row.item.name} ${ratio}`);
    assert.ok(marketMakerOffer({ price: row.price, item: row.item }, { itemValue }) <= row.price, "instant NPC resale must not pay more than purchase");
  }
  const frozen = structuredClone(H.state.blackStalls);
  assert.equal(maintainNpcBlackmarket(now).changed, false);
  for (const stall of H.state.blackStalls) {
    const pub = publicBlackStall(stall, buyer.id, publicStone);
    assert.equal(pub.npc, true);
    assert.equal(pub.isMine, false);
    assert.equal(pub.ratingDisplay.label, "NPC 商贩");
    for (const row of pub.items) {
      if (row.type === "rough") { assert.equal(row.item.trueQualityKey, undefined); assert.equal(row.item.trueValue, undefined); }
    }
  }
  assert.deepEqual(H.state.blackStalls, frozen, "reads must not reroll stock or change timestamps");
  const stallFor = (role) => H.state.blackStalls.find((stall) => stall.npcRole === role);
  const buy = (stall, row) => buyGoodsFromStallForPlayer(buyer, stall.id, row.id);
  const roughStall = stallFor("stone");
  const rough = roughStall.items.find((row) => row.type === "rough");
  const valueBefore = rough.item.price;
  assert.equal(buy(roughStall, rough).ok, true);
  assert.equal(buyer.rough.at(-1).price, valueBefore);
  assert.equal(itemCost(buyer.rough.at(-1)).amount, rough.price);
  const cashAfter = buyer.cash;
  assert.equal(buy(roughStall, rough).ok, false, "the same stock ID cannot be bought twice");
  assert.equal(buyer.cash, cashAfter);

  // Legacy offers are hidden and rejected before maintenance runs as well.
  const supply = { id: "legacy-supply", type: "supply", item: { id: "legacy-supply-item", type: "supply", name: "旧18K金", materialKey: "gold18k", unitLabel: "克", amount: 2, value: 100 }, price: 100, referencePrice: 100, createdAt: now };
  const device = { id: "legacy-equipment", type: "equipment", item: { ...structuredClone(buyer.workshop.devices[0]), id: "legacy-equipment-item", type: "equipment", value: 100 }, price: 100, referencePrice: 100, createdAt: now };
  const legacyStall = (role, row) => ({ ...structuredClone(stallFor("stone")), id: `bm-npc:${role}`, ownerId: `npc:blackmarket:${role}`, npcRole: role, npcDiscountIssued: 0, npcPremiumIssued: 0, items: [structuredClone(row)] });
  const legacySupplies = legacyStall("supplies", supply);
  const legacyEquipment = legacyStall("equipment", device);
  H.state.blackStalls.push(legacySupplies, legacyEquipment);
  buyer.externalMaterials.gold18k = 7;
  const ownedBefore = structuredClone(buyer);
  assert.equal(publicBlackStall(legacySupplies, buyer.id, publicStone), null);
  assert.equal(publicBlackStall(legacyEquipment, buyer.id, publicStone), null);
  assert.equal(buy(legacySupplies, supply).ok, false);
  assert.equal(buy(legacyEquipment, device).ok, false);
  const traveler = stallFor("traveler");
  traveler.items.push(structuredClone(supply), structuredClone(device));
  const publicTraveler = publicBlackStall(traveler, buyer.id, publicStone);
  assert.ok(publicTraveler.items.every((row) => isBlackmarketGoodsType(row.type)));
  assert.equal(publicTraveler.summary.count, publicTraveler.items.length);
  assert.equal(buy(traveler, supply).ok, false);
  assert.equal(buy(traveler, device).ok, false);
  assert.deepEqual(buyer, ownedBefore, "blocked legacy purchases cannot debit cash or change owned stock");
  const playerStall = { id: "player-parity-stall", ownerId: buyer.id, type: "goods", status: "open", items: [{ id: "player-row", type: "rough", item: structuredClone(buyer.rough[0]), price: 100 }], pool: [], offers: [] };
  H.state.blackStalls.push(playerStall);
  const playerShelfBefore = structuredClone(playerStall);
  assert.equal(maintainNpcBlackmarket(now).changed, true);
  assert.equal(stallFor("supplies"), undefined);
  assert.equal(stallFor("equipment").npcResourceVersion, 1);
  assert.ok(flat().every((row) => isBlackmarketGoodsType(row.type)));
  assert.deepEqual(playerStall, playerShelfBefore);
  assert.deepEqual(buyer, ownedBefore, "retiring NPC shelves must preserve players' materials, equipment and cash");
  const selectable = bmSellables({ me: buyer });
  assert.ok(selectable.every((item) => isBlackmarketGoodsType(item._type)), "Player selection uses the same goods whitelist as NPC stock");
  assert.ok(buyer.workshop.devices.every((device) => selectable.some((item) => item.id === device.id && item._type === "equipment")), "All idle equipment, including initial grants, may be resold");
  H.state.blackStalls.splice(H.state.blackStalls.indexOf(playerStall), 1);
  assert.equal(maintainNpcBlackmarket(now).changed, false);
  for (const type of BLACKMARKET_GOODS_TYPES) {
    const seller = H.state.blackStalls.find((stall) => stall.items.some((row) => row.type === type));
    const row = seller.items.find((entry) => entry.type === type);
    assert.equal(buy(seller, row).ok, true);
    assert.equal(bmSellables({ me: buyer }).find((entry) => entry.id === row.item.id)?._type, type, "NPC purchases must be eligible for the player's own stall");
  }
  const offcut = stallFor("offcut");
  const slice = offcut.items.find((row) => row.type === "slice");
  assert.equal(buy(offcut, slice).ok, true);
  const carvingDevice = buyer.workshop.devices.find((entry) => entry.stage === "carving");
  assert.ok(H.workshopProcessableItems(buyer, carvingDevice.id).some((item) => item.id === slice.item.id), "purchased slices must be available to workshop planning");
  const sliceJob = H.startWorkshopJobForPlayer(buyer, carvingDevice.id, {
    itemId: slice.item.id, workerId: buyer.workshop.workers[0].id,
    kits: [{ type: "cabochon", x: 50, y: 50, size: "M" }]
  });
  assert.equal(sliceJob.ok, true, sliceJob.message);
  assert.ok(!buyer.slices.some((item) => item.id === slice.item.id));
  const realRandom = Math.random;
  try {
    Math.random = () => 0.99; // Isolate the successful processing path from the normal shatter chance.
    const completion = H.completeProductionJob(buyer, sliceJob.job);
    assert.equal(completion.shattered, undefined);
    claimWorkshopOutputs(H, buyer);
    assert.ok(buyer.bracelets.some((item) => item.sourceRoughId === slice.item.id && item.materialStage === "carved"));
  } finally { Math.random = realRandom; }
  buyer.jobs = buyer.jobs.filter((job) => job.id !== sliceJob.job.id);
  const remainder = offcut.items.find((row) => row.item.leftover);
  assert.ok(remainder.item.extractionKits.length > 0, "remainders must retain consumed cutouts");

  // Exhaust every discount/high-goods offer, then repeatedly drain all ordinary categories.
  for (const stall of H.state.blackStalls) {
    for (const row of [...stall.items].filter((entry) => entry.npcDiscount || entry.npcPremium)) assert.equal(buy(stall, row).ok, true);
  }
  for (let index = 0; index < 240; index += 1) {
    const jadeStalls = H.state.blackStalls.filter((entry) => !["employee", "equipment"].includes(entry.npcRole));
    const stall = jadeStalls[index % jadeStalls.length];
    if (!stall.items.length) {
      now = Math.min(stall.npcRefillAt, stall.npcRotateAt);
      maintainNpcBlackmarket(now);
    }
    assert.equal(buy(stall, stall.items[0]).ok, true);
    assert.equal(H.state.blackStalls.filter((entry) => entry.status === "open").length, NPC_STALLS.length);
    assert.ok(H.state.blackStalls.every((entry) => entry.items.length <= NPC_STALLS.find((rule) => rule.role === entry.npcRole).stock));
    assert.ok(flat().every((row) => isBlackmarketGoodsType(row.type)));
  }
  for (const stall of H.state.blackStalls) {
    for (const row of [...stall.items].filter((entry) => entry.npcDiscount || entry.npcPremium)) assert.equal(buy(stall, row).ok, true);
  }
  assert.equal(flat().filter((row) => row.npcDiscount || row.npcPremium).length, 0);
  assert.equal(buyer.pendingBmRatings.length, 0, "NPC trades must not create fake mutual reviews");
  assert.equal(H.state.players.size, 1);

  // A real save round trip and orphan reconciliation preserve depleted batch budgets.
  const store = createMemoryWorldStore({ players: H.state.players, blackStalls: H.state.blackStalls });
  const saved = store.exportSnapshot({ savedAt: now });
  const restored = createMemoryWorldStore();
  restored.importSnapshot(structuredClone(saved));
  bindBlackmarketApi({ ...api, getState: () => restored.raw });
  assert.equal(reconcileBlackmarketReferences(restored.raw, now).orphanStalls, 0);
  assert.equal(maintainNpcBlackmarket(now).changed, false);
  assert.equal(restored.raw.blackStalls.flatMap((stall) => stall.items).filter((row) => row.npcDiscount || row.npcPremium).length, 0);
  now = Math.max(...restored.raw.blackStalls.map((stall) => stall.npcRotateAt));
  maintainNpcBlackmarket(now);
  assert.equal(restored.raw.blackStalls.flatMap((stall) => stall.items).filter((row) => row.npcDiscount).length, NPC_STALLS.length);
  assert.equal(restored.raw.blackStalls.flatMap((stall) => stall.items).filter((row) => row.npcPremium).length, 2);
  now += 40 * NPC_SHIFT_MS;
  maintainNpcBlackmarket(now);
  assert.equal(restored.raw.blackStalls.flatMap((stall) => stall.items).filter((row) => row.npcDiscount).length, NPC_STALLS.length, "downtime must not accumulate old discounts");
  assert.equal(restored.raw.blackStalls.length, NPC_STALLS.length);
  restored.exportSnapshot({ savedAt: now });
  const badSave = structuredClone(saved);
  badSave.blackStalls.push(structuredClone(legacySupplies));
  badSave.blackStalls.find((stall) => stall.npcRole === "supplies").items[0].item.amount = -1;
  assert.throws(() => createMemoryWorldStore().importSnapshot(badSave), /non-negative/);
  const legacySave = structuredClone(saved);
  legacySave.blackStalls = legacySave.blackStalls.filter((stall) => stall.npcRole !== "equipment");
  legacySave.blackStalls.push(structuredClone(legacySupplies), structuredClone(legacyEquipment));
  legacySave.blackStalls.find((stall) => stall.npcRole === "traveler").items.push(
    { ...structuredClone(supply), id: "traveler-supply", item: { ...structuredClone(supply.item), id: "traveler-supply-item" } },
    { ...structuredClone(device), id: "traveler-equipment", item: { ...structuredClone(device.item), id: "traveler-equipment-item" } }
  );
  const legacyStore = createMemoryWorldStore();
  legacyStore.importSnapshot(legacySave);
  const legacyPlayers = structuredClone([...legacyStore.raw.players]);
  bindBlackmarketApi({ ...api, getState: () => legacyStore.raw });
  assert.equal(maintainNpcBlackmarket(now).changed, true);
  assert.equal(legacyStore.raw.blackStalls.length, NPC_STALLS.length);
  assert.ok(legacyStore.raw.blackStalls.flatMap((stall) => stall.items).every((row) => isBlackmarketGoodsType(row.type)));
  assert.deepEqual([...legacyStore.raw.players], legacyPlayers);
  const upgradedLegacy = structuredClone(legacyStore.raw.blackStalls);
  assert.equal(maintainNpcBlackmarket(now).changed, false);
  assert.deepEqual(legacyStore.raw.blackStalls, upgradedLegacy);
  bindBlackmarketApi(api);

  // Inventory failure rolls back both the payment and any stock/offer budget changes.
  maintainNpcBlackmarket(now);
  const failedStall = stallFor("finished");
  const beforeFailure = structuredClone({ buyer, stalls: H.state.blackStalls, news: H.state.news });
  bindBlackmarketApi({ ...api, addItem: () => { throw new Error("injected inventory failure"); } });
  assert.equal(buy(failedStall, failedStall.items[0]).code, "TRANSACTION_ABORTED");
  assert.deepEqual({ buyer, stalls: H.state.blackStalls, news: H.state.news }, beforeFailure);
  bindBlackmarketApi(api);
  buyer.cash = 0;
  assert.equal(buy(stallFor("finished"), stallFor("finished").items[0]).ok, false);
  buyer.cash = 100_000;
  const newBuyer = H.makePlayer("new-npc-buyer");
  newBuyer.cash = 0;
  assert.equal(buyGoodsFromStallForPlayer(newBuyer, stallFor("finished").id, stallFor("finished").items[0].id).ok, false);
  const empty = stallFor("stone");
  empty.items.length = 0;
  assert.equal(sweepEmptyBlackGoodsStalls(H.state), false);
  maintainNpcBlackmarket(now);
  assert.equal(empty.items.length, 0, "empty shelves wait for scheduled replenishment");
  now = Math.min(empty.npcRefillAt, empty.npcRotateAt);
  maintainNpcBlackmarket(now);
  assert.equal(empty.items.length, 6);
  assert.equal(NPC_STALLS.filter((rule) => !rule.roaming).length, 5);
  console.log("blackmarket-npc-smoke: ok (240 purchases, pricing, inventory, batch limits, save/restore, rollback)");
} finally {
  Date.now = realNow;
  bindBlackmarketApi(api);
}
