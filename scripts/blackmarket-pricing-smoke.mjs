import assert from "node:assert/strict";
import {
  NPC_PRICING_VERSION,
  NPC_PRICE_RANGES,
  npcPriceReference,
  quoteNpcGoods
} from "../shared/domain/blackmarket/npc-pricing.js";
import { NPC_STALLS, NPC_TARGET_STALLS, npcRuleForStall } from "../shared/domain/blackmarket/npc-rules.js";
import { equipmentCatalog, createDeviceInstance } from "../server/systems/equipment-system.js";
import { equipmentRepairQuote } from "../shared/domain/economy/equipment-maintenance.js";
import { recruitPrice, workerDailyWage } from "../shared/domain/economy/worker-economy.js";
import { repriceNpcGoodsRow } from "../server/services/blackmarket/npc-catalog.js";
import { registerBlackmarketCommands } from "../server/shell/commands/blackmarket-commands.js";

// These bounds are the approved gameplay contract, including repair costs for equipment.
const ranges = {
  stone: { ordinary: [.85, .92], discount: [.75, .82] },
  offcut: { ordinary: [.75, .85], discount: [.68, .75] },
  finished: { ordinary: [.85, .95], discount: [.75, .85] },
  traveler: { ordinary: [.95, 1], discount: [.90, .95] },
  employee: { ordinary: [.85, .92], discount: [.75, .80] },
  equipment: { ordinary: [.70, .75], discount: [.60, .65] }
};
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1, `${label}: ${actual} vs ${expected}`);
assert.equal(NPC_PRICING_VERSION, 1);
for (const [role, rule] of Object.entries(ranges)) {
  assert.deepEqual(NPC_PRICE_RANGES[role].ordinary, rule.ordinary);
  assert.deepEqual(NPC_PRICE_RANGES[role].discount, rule.discount);
}

for (const [role, item] of [
  ["stone", { type: "rough", price: 10_000, trueValue: 999_999 }],
  ["offcut", { type: "material", value: 10_000, remainingRatio: .25, npcOffcut: { sourceValue: 40_000 } }],
  ["finished", { type: "bracelet", kind: "cabochon", value: 10_000, price: 12_000 }],
  ["traveler", { type: "bracelet", kind: "cabochon", qualityKey: "glass", value: 10_000 }]
]) {
  const before = structuredClone(item);
  assert.equal(npcPriceReference(item.type, item), 10_000, `${role}: use the actual item basis, not hidden value or the uncut stone`);
  for (const discount of [false, true]) for (const roll of [0, 1]) {
    const quote = quoteNpcGoods(role, item.type, item, { discount, roll });
    near(quote.price, 10_000 * ranges[role][discount ? "discount" : "ordinary"][roll], `${role} price boundary`);
    assert.equal(quote.referencePrice, 10_000);
    assert.equal(quote.repairCost, 0);
    assert.equal(quote.totalCost, quote.price);
    assert.equal(quote.savings, 10_000 - quote.totalCost);
  }
  assert.deepEqual(item, before, "quoting must not change intrinsic jade value or appearance");
}
assert.equal(quoteNpcGoods("offcut", "material", { value: 125 }, { discount: true, roll: 0 }).price, 100, "respect the existing minimum listing price");

for (let tier = 1; tier <= 10; tier++) {
  const worker = { tier, baseWage: 1, skills: { cut: { jieliao: { level: 3, exp: 29 } } } };
  const before = structuredClone(worker);
  const wage = workerDailyWage(worker);
  assert.equal(npcPriceReference("employee", worker), recruitPrice(tier));
  for (const discount of [false, true]) for (const roll of [0, 1]) {
    const quote = quoteNpcGoods("employee", "employee", worker, { discount, roll });
    near(quote.price, recruitPrice(tier) * ranges.employee[discount ? "discount" : "ordinary"][roll], "employee recruitment discount");
    assert.equal(quote.referencePrice, recruitPrice(tier));
    assert.equal(quote.totalCost, quote.price);
    assert.equal(workerDailyWage(worker), wage, "a discounted signing price does not alter daily wages");
  }
  assert.deepEqual(worker, before, "quoting must preserve worker tier and accumulated skills");
}

const models = equipmentCatalog();
assert.deepEqual([...new Set(models.map((model) => model.techLevel))].sort(), [1, 2, 3]);
for (const model of models) for (const condition of [40, 70, 95]) {
  const device = { ...createDeviceInstance(model.stage, model.modelKey, `price-${model.modelKey}`), condition };
  const before = structuredClone(device);
  const repair = equipmentRepairQuote(device);
  assert.equal(npcPriceReference("equipment", device), model.price, "compare against the current same-model shop price");
  for (const discount of [false, true]) for (const roll of [0, 1]) {
    const quote = quoteNpcGoods("equipment", "equipment", device, { discount, roll });
    const target = model.price * ranges.equipment[discount ? "discount" : "ordinary"][roll];
    assert.ok(Number.isSafeInteger(quote.price) && quote.price >= 100);
    assert.equal(quote.referencePrice, model.price);
    assert.equal(quote.repairCost, repair);
    assert.equal(quote.totalCost, quote.price + repair);
    near(quote.totalCost, target, `${model.modelKey}/${condition}: repaired total stays discounted`);
    assert.equal(quote.savings, model.price - quote.totalCost);
  }
  assert.deepEqual(device, before, "quoting must not repair, downgrade or alter the purchased machine");
}

const legacyModel = models.find((model) => model.modelKey === "cuijie-opening-2");
const legacyEquipment = {
  id: "legacy-model-price", type: "equipment", price: 30_000, referencePrice: 30_000,
  item: { ...createDeviceInstance(legacyModel.stage, legacyModel.modelKey, "legacy-device"), basePrice: 9200, condition: 70 },
  npcDiscount: false, createdAt: 123
};
const legacyAttrs = structuredClone(legacyEquipment.item.attrs);
assert.equal(repriceNpcGoodsRow(NPC_STALLS.find((rule) => rule.role === "equipment"), legacyEquipment), true);
assert.equal(legacyEquipment.item.basePrice, legacyModel.price, "old NPC model prices migrate to the actual shop catalog");
assert.equal(legacyEquipment.referencePrice, legacyModel.price);
assert.equal(legacyEquipment.item.condition, 70);
assert.deepEqual(legacyEquipment.item.attrs, legacyAttrs);
assert.ok(legacyEquipment.price + equipmentRepairQuote(legacyEquipment.item) <= legacyModel.price * .75 + 1);

// Exercise real stock maintenance and purchasing in a memory-only world.
process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
const { maintainNpcBlackmarket, bindBlackmarketApi, buyGoodsFromStallForPlayer } = await import("../server/services/blackmarket-service.js");
const { requireApi } = await import("../server/services/blackmarket/context.js");
const { installOwnedWorkshopFixture } = await import("./fixtures/owned-workshop.mjs");
const originalApi = requireApi();
const originalNow = Date.now;
let now = originalNow();
let sequence = 0;
Date.now = () => now;
bindBlackmarketApi({ ...originalApi, randomUUID: () => `npc-price-test-${sequence++}` });

function assertStockPrices() {
  const stalls = H.state.blackStalls.filter(stall => stall.npc);
  assert.equal(stalls.length, NPC_TARGET_STALLS);
  assert.equal(new Set(stalls.map(stall => stall.id)).size, NPC_TARGET_STALLS);
  for (const stall of stalls) {
    const rule = npcRuleForStall(stall);
    assert.ok(rule, `known NPC stock rule for ${stall.id}`);
    const stock = stall.type === "blindbox" ? stall.pool : stall.items;
    assert.equal(stock.length, rule.stock);
    assert.ok(stock.filter((row) => row.npcDiscount).length <= rule.discount, "clearance offers stay within the shelf's batch quota");
    if (stall.type === "blindbox") assert.equal(stall.blindPrice, Math.max(100, Math.round(stock.reduce((sum, row) => sum + row.price, 0) / stock.length)));
    for (const row of stock) {
      const [min, max] = ranges[row.npcSupplyRole || rule.role][row.npcDiscount ? "discount" : "ordinary"];
      const repair = row.type === "equipment" ? equipmentRepairQuote(row.item) : 0;
      const total = row.price + repair;
      const reference = npcPriceReference(row.type, row.item);
      assert.equal(row.referencePrice, reference);
      assert.equal(row.npcPricingVersion, NPC_PRICING_VERSION);
      assert.ok(total >= Math.max(100 + repair, reference * min - 1));
      assert.ok(total <= Math.max(100 + repair, reference * max + 1), `${rule.role}: high goods must not add another markup`);
    }
  }
}

try {
  H.state.players.clear();
  H.state.sockets.clear();
  H.state.blackStalls.length = 0;
  H.state.blackServiceOrders.length = 0;
  const buyer = installOwnedWorkshopFixture(H.makePlayer("npc-price-buyer"));
  H.normalizePlayer(buyer);
  buyer.cash = 100_000_000;
  buyer.achievementPoints = buyer.achievementPointsBonus = 9999;
  H.state.players.set(buyer.id, buyer);
  maintainNpcBlackmarket(now);
  assertStockPrices();
  for (const stall of H.state.blackStalls) assert.equal(stall.items.filter((row) => row.npcDiscount).length, npcRuleForStall(stall).discount);

  for (const stall of H.state.blackStalls) {
    const rule = npcRuleForStall(stall);
    const stock = stall.type === "blindbox" ? stall.pool : stall.items;
    const samples = [stock.find((row) => !row.npcDiscount)];
    if (rule.discount) samples.push(stock.find((row) => row.npcDiscount));
    for (const original of samples) {
      assert.ok(original);
      const row = structuredClone(original);
      const item = row.item;
      const preserved = { id: row.id, createdAt: row.createdAt, npcDiscount: row.npcDiscount, npcPremium: row.npcPremium, item: structuredClone(item) };
      row.price = Math.round(row.referencePrice * 1.3);
      delete row.npcPricingVersion;
      assert.equal(repriceNpcGoodsRow(rule, row), true);
      assert.equal(row.item, item, "repricing retains the actual stock item");
      assert.deepEqual({ id: row.id, createdAt: row.createdAt, npcDiscount: row.npcDiscount, npcPremium: row.npcPremium, item: row.item }, preserved);
      const once = structuredClone(row);
      assert.equal(repriceNpcGoodsRow(rule, row), false, "a migrated quote must not reroll on every visit");
      assert.deepEqual(row, once);
    }
  }

  const playerStall = { id: "player-price-control", ownerId: buyer.id, type: "goods", status: "open", items: [{ id: "player-control-item", type: "rough", item: structuredClone(buyer.rough[0]), price: 7777 }], pool: [], offers: [] };
  H.state.blackStalls.push(playerStall);
  const playerShelf = structuredClone(playerStall);
  const stone = H.state.blackStalls.find((stall) => stall.npcRole === "stone");
  const stale = stone.items.find((row) => !row.npcDiscount);
  stale.price = Math.round(stale.referencePrice * 1.3);
  delete stale.npcPricingVersion;
  const oldPrice = stale.price;
  const oldCash = buyer.cash;
  const oldItems = [...buyer.rough, ...buyer.materials, ...buyer.slices, ...buyer.bracelets].map((item) => item.id);
  const handlers = new Map(), notices = [], tradeEffects = [], quoteBroadcasts = [];
  const socket = { on: (event, handler) => handlers.set(event, handler), emit: (event, payload) => notices.push({ event, payload }) };
  registerBlackmarketCommands(socket, {
    getPlayer: () => buyer,
    acceptMutation: () => true,
    buyGoodsFromStallForPlayer,
    emitUiEvent: (_socket, event) => tradeEffects.push(event),
    uiMoney: (value) => String(value),
    broadcast: () => quoteBroadcasts.push({ price: stale.price, cash: buyer.cash, stillListed: stone.items.includes(stale) })
  });
  handlers.get("bmBuyListing")({ stallId: stone.id, listingId: stale.id, expectedPrice: oldPrice });
  assert.match(notices.at(-1).payload, /报价已变化/, "an old open confirmation must ask the player to confirm the new price");
  assert.equal(quoteBroadcasts.length, 1, "publish a migrated quote immediately even though the old-price purchase failed");
  assert.deepEqual(quoteBroadcasts[0], { price: stale.price, cash: oldCash, stillListed: true });
  assert.ok(stale.price < oldPrice, "the broadcast contains the newly discounted price");
  assert.deepEqual(tradeEffects, [], "a rejected old-price confirmation cannot show a successful trade float");
  assert.equal(buyer.cash, oldCash);
  assert.deepEqual([...buyer.rough, ...buyer.materials, ...buyer.slices, ...buyer.bracelets].map((item) => item.id), oldItems);
  handlers.get("bmBuyListing")({ stallId: stone.id, listingId: "missing-stock", expectedPrice: oldPrice });
  assert.equal(quoteBroadcasts.length, 1, "an ordinary failed purchase does not add a broadcast");
  assert.deepEqual(tradeEffects, []);
  assert.equal(buyer.cash, oldCash);
  const newPrice = stale.price;
  assert.ok(newPrice < oldPrice);
  assert.equal(buyGoodsFromStallForPlayer(buyer, stone.id, stale.id, newPrice).ok, true);
  assert.equal(buyer.cash, oldCash - newPrice);
  assert.equal(buyGoodsFromStallForPlayer(buyer, stone.id, stale.id, newPrice).ok, false, "stock cannot be purchased twice");
  assert.equal(buyer.cash, oldCash - newPrice);

  const depletedBatches = new Map();
  for (const stall of H.state.blackStalls.filter(entry => entry.npc && npcRuleForStall(entry).discount > 0)) {
    const clearance = stall.items.find((row) => row.npcDiscount);
    assert.ok(clearance);
    const clearanceBuyer = H.makePlayer(`clearance-buyer-${stall.id}`);
    clearanceBuyer.cash = 100_000_000;
    H.state.players.set(clearanceBuyer.id, clearanceBuyer);
    const sale = buyGoodsFromStallForPlayer(clearanceBuyer, stall.id, clearance.id, clearance.price);
    assert.equal(sale.ok, true, sale.message);
    depletedBatches.set(stall.id, stall.npcBatch);
    assert.equal(clearanceBuyer.cash, 100_000_000 - clearance.price);
    if (clearance.type === "employee") {
      const salary = clearanceBuyer.employeePayroll.currentBill.entries.find(entry => entry.workerId === clearance.item.id);
      assert.ok(salary, "the joining employee is included in today's payroll");
      assert.equal(salary.amount, workerDailyWage(clearance.item));
      assert.equal(salary.booked, false, "joining-day salary is settled on the next login day");
    }
  }
  const refillDeadlines = H.state.blackStalls.filter(stall => stall.npc && stall.npcRefillAt != null).map(stall => stall.npcRefillAt);
  assert.ok(refillDeadlines.length > 0);
  now = Math.max(...refillDeadlines) + 1;
  maintainNpcBlackmarket(now);
  assertStockPrices();
  for (const stall of H.state.blackStalls.filter((entry) => entry.npc)) {
    const depleted = depletedBatches.get(stall.id) === stall.npcBatch;
    assert.equal(stall.items.filter((row) => row.npcDiscount).length, depleted ? 0 : npcRuleForStall(stall).discount,
      "ordinary replenishment preserves spent quotas; incoming batches receive their own quota");
  }

  for (let round = 0; round < 8; round++) {
    now = Math.max(...H.state.blackStalls.filter((stall) => stall.npc).map((stall) => stall.npcRotateAt)) + 1;
    maintainNpcBlackmarket(now);
    assertStockPrices();
    for (const stall of H.state.blackStalls.filter((entry) => entry.npc)) assert.equal(stall.items.filter((row) => row.npcDiscount).length, npcRuleForStall(stall).discount);
    const stable = structuredClone(H.state.blackStalls);
    assert.equal(maintainNpcBlackmarket(now).changed, false);
    assert.deepEqual(H.state.blackStalls, stable, "refreshing the screen does not reroll prices or offers");
    assert.deepEqual(playerStall, playerShelf, "NPC policies do not reprice player listings");
  }
  console.log("blackmarket-pricing-smoke: six price bands, repair-inclusive savings, wages, legacy quotes, stock quotas and confirmed purchases ok");
} finally {
  Date.now = originalNow;
  bindBlackmarketApi(originalApi);
}
