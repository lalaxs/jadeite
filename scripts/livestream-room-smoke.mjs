import assert from "node:assert/strict";
import {
  LIVESTREAM_MAX_ITEMS,
  LIVESTREAM_MIN_ITEMS,
  LIVESTREAM_MIN_PRICE,
  LIVESTREAM_BASE_DURATION_MS,
  LIVESTREAM_MAX_DURATION_MS,
  LIVESTREAM_SALE_EXTENSION_MS,
  LIVESTREAM_AI_TUNING,
  aiBasePurchaseChance,
  aiPurchaseChance,
  aiReputationBoost,
  closeLivestreamRoom,
  normalizeLivestreamRoom,
  processAiLivestreamRooms,
  publicLivestreamRoom,
  purchaseLivestreamRoomItem,
  replenishLivestreamRoom,
  startLivestreamRoom
} from "../server/systems/livestream-room-system.js";

function product(id, overrides = {}) {
  return {
    id,
    type: "bracelet",
    kind: "bracelet",
    materialStage: "finished",
    name: `测试成品 ${id}`,
    value: 10_000,
    costBasis: { amount: 10_000, complete: true },
    score: 3,
    rep: 20,
    ...overrides
  };
}

function player(id, count = 0) {
  return {
    id,
    name: `掌柜 ${id}`,
    cash: 100_000,
    level: 10, // Lifecycle fixtures have an established customer base; daily limits are tested separately.
    rep: 80,
    assets: { livestreamPermitOwned: true },
    bracelets: Array.from({ length: count }, (_, index) => product(`${id}-${index + 1}`)),
    livestreamRoom: null,
    livestreamHistory: [],
    ledger: [],
    tasksAdvanced: 0
  };
}

let idSequence = 0;
function makeDependencies(overrides = {}) {
  let now = overrides.now ?? 1_000;
  return {
    now,
    host: {
      id: "worker-host",
      name: "测试主播",
      job: "streamer",
      tier: 3,
      skills: {
        speak: {
          huashu: { level: 3, exp: 0 },
          kongchang: { level: 2, exp: 0 },
          cuidan: { level: 2, exp: 0 }
        }
      }
    },
    makeId: () => `generated-${++idSequence}`,
    rng: () => 0,
    isFinishedProduct: (item) => item?.materialStage === "finished",
    spendCash: (buyer, amount) => {
      if (buyer.cash < amount) return false;
      buyer.cash -= amount;
      buyer.ledger.unshift({ kind: "expense", amount, source: "livestream-buy" });
      return true;
    },
    earnCash: (seller, amount) => {
      seller.cash += amount;
      seller.ledger.unshift({ kind: "income", amount, source: "livestream" });
      return amount;
    },
    addItem: (buyer, item) => buyer.bracelets.push(item),
    advanceTask: (seller) => {
      seller.tasksAdvanced += 1;
    },
    recordSale: (seller, sale) => seller.livestreamHistory.unshift(sale),
    addNews: () => {},
    publicProduct: (item) => {
      const { trueQualityKey, trueValue, ...safe } = item;
      return safe;
    },
    setNow(value) {
      now = value;
      this.now = value;
    },
    ...overrides
  };
}

function listingsFor(owner, count, price = 10_000) {
  return owner.bracelets.slice(0, count).map((item) => ({
    productId: item.id,
    price
  }));
}

assert.equal(LIVESTREAM_MIN_ITEMS, 3);
assert.equal(LIVESTREAM_MAX_ITEMS, 12);
assert.equal(LIVESTREAM_MIN_PRICE, 1);
assert.equal(LIVESTREAM_BASE_DURATION_MS, 12 * 60 * 1000);
assert.equal(LIVESTREAM_MAX_DURATION_MS, 15 * 60 * 1000);
assert.equal(LIVESTREAM_SALE_EXTENSION_MS, 60 * 1000);
assert.equal(LIVESTREAM_AI_TUNING.visitMinMs, 18_000);
assert.equal(LIVESTREAM_AI_TUNING.visitSpreadMs, 14_000);
assert.equal(LIVESTREAM_AI_TUNING.maxPriceRatio, 1.25);

{
  assert.equal(aiBasePurchaseChance(0.85), 0.64);
  assert.equal(aiBasePurchaseChance(0.95), 0.50);
  assert.equal(aiBasePurchaseChance(1.05), 0.36);
  assert.equal(aiBasePurchaseChance(1.20), 0.16);
  assert.equal(aiBasePurchaseChance(1.25), 0.10);
  assert.equal(aiBasePurchaseChance(1.26), 0);
  assert.ok(aiBasePurchaseChance(1.151) < aiBasePurchaseChance(1.15));
  assert.ok(aiBasePurchaseChance(1.151) > aiBasePurchaseChance(1.15) - 0.01, "demand falls smoothly at the price boundary");
  assert.equal(aiReputationBoost(0), 0);
  assert.equal(aiReputationBoost(375), 0.04);
  assert.equal(aiReputationBoost(1500), 0.08);
  const seller = player("chance", 0);
  seller.rep = 0;
  const roomItem = { price: 10_500, product: product("chance-item", { value: 10_000, score: 0 }) };
  assert.equal(aiPurchaseChance(seller, roomItem, null), 0.36);
  assert.equal(aiPurchaseChance(seller, { ...roomItem, price: 18_001 }, null), 0);
}

{
  const owner = player("normalize", 0);
  delete owner.livestreamRoom;
  normalizeLivestreamRoom(owner);
  assert.equal(owner.livestreamRoom, null);
}

{
  const owner = player("gated", 3);
  owner.assets.livestreamPermitOwned = false;
  const result = startLivestreamRoom(owner, listingsFor(owner, 3), makeDependencies());
  assert.equal(result.ok, false);
  assert.match(result.message, /直播经营许可/);
  assert.equal(owner.bracelets.length, 3);
}

{
  const owner = player("no-host", 3);
  const result = startLivestreamRoom(owner, listingsFor(owner, 3), makeDependencies({ host: null }));
  assert.equal(result.ok, true);
  assert.equal(result.room.hostWorkerId, null);
  assert.equal(result.room.hostSnapshot, null);
  assert.equal(result.room.nextAiVisitAt, 19_000);
  assert.equal(owner.bracelets.length, 0);
  assert.equal(owner.livestreamRoom.items.length, 3);
}

{
  const owner = player("small", 3);
  const result = startLivestreamRoom(owner, listingsFor(owner, 2), makeDependencies());
  assert.equal(result.ok, false);
  assert.match(result.message, /至少 3 件/);
  assert.equal(owner.bracelets.length, 3);
}

{
  const owner = player("large", 13);
  const result = startLivestreamRoom(owner, listingsFor(owner, 13), makeDependencies());
  assert.equal(result.ok, false);
  assert.match(result.message, /最多 12 件/);
  assert.equal(owner.bracelets.length, 13);
}

{
  const owner = player("duplicate", 3);
  const repeated = [
    { productId: owner.bracelets[0].id, price: 10_000 },
    { productId: owner.bracelets[0].id, price: 11_000 },
    { productId: owner.bracelets[1].id, price: 12_000 }
  ];
  const result = startLivestreamRoom(owner, repeated, makeDependencies());
  assert.equal(result.ok, false);
  assert.match(result.message, /重复/);
  assert.equal(owner.bracelets.length, 3);
}

for (const price of [0, -1, 1.5, NaN, Infinity]) {
  const owner = player(`price-${price}`, 3);
  const invalid = listingsFor(owner, 3);
  invalid[1].price = price;
  const result = startLivestreamRoom(owner, invalid, makeDependencies());
  assert.equal(result.ok, false);
  assert.match(result.message, /售价/);
  assert.equal(owner.bracelets.length, 3);
}

{
  const owner = player("low-price", 4);
  for (const item of owner.bracelets) {
    item.value = 15;
    item.costBasis.amount = 15;
  }
  const deps = makeDependencies({ host: null });
  const listings = listingsFor(owner, 3).map((listing, index) => ({ ...listing, price: [1, 16, 100][index] }));
  assert.equal(startLivestreamRoom(owner, listings, deps).ok, true);
  assert.deepEqual(owner.livestreamRoom.items.map(item => item.price), [1, 16, 100]);
  assert.equal(replenishLivestreamRoom(owner, listingsFor(owner, 1, 17), deps).ok, true);
  assert.equal(owner.livestreamRoom.items.at(-1).price, 17);
  for (const item of owner.livestreamRoom.items.filter(item => item.price < 100)) {
    assert.ok(aiPurchaseChance(owner, item, owner.livestreamRoom, deps.now) > 0, `AI can buy a ¥15 product at ¥${item.price}`);
  }
  const affordable = owner.livestreamRoom.items.find(item => item.price === 16);
  const cashBefore = owner.cash;
  assert.equal(purchaseLivestreamRoomItem({ seller: owner, itemId: affordable.id, buyerType: "ai" }, deps).ok, true);
  assert.equal(owner.cash, cashBefore + 16);
  const overpriced = owner.livestreamRoom.items.find(item => item.price === 100);
  assert.equal(aiPurchaseChance(owner, overpriced, owner.livestreamRoom, deps.now), 0);
  assert.equal(purchaseLivestreamRoomItem({ seller: owner, itemId: overpriced.id, buyerType: "ai" }, deps).code, "SYSTEM_PRICE_LIMIT");
  const buyer = player("low-price-buyer");
  assert.equal(purchaseLivestreamRoomItem({ seller: owner, buyer, itemId: overpriced.id }, deps).ok, true);
  assert.equal(buyer.bracelets[0].value, 15);
}

{
  const owner = player("atomic", 3);
  const invalid = listingsFor(owner, 2);
  invalid.push({ productId: "missing-product", price: 10_000 });
  const result = startLivestreamRoom(owner, invalid, makeDependencies());
  assert.equal(result.ok, false);
  assert.match(result.message, /不在可售成品库存/);
  assert.equal(owner.bracelets.length, 3);
  assert.equal(owner.livestreamRoom, null);
}

{
  const owner = player("minimum", 3);
  const result = startLivestreamRoom(owner, listingsFor(owner, 3), makeDependencies());
  assert.equal(result.ok, true);
  assert.equal(owner.bracelets.length, 0);
  assert.equal(owner.livestreamRoom.items.length, 3);
  assert.equal(owner.livestreamRoom.status, "live");
}

{
  const owner = player("maximum", 12);
  const result = startLivestreamRoom(owner, listingsFor(owner, 12), makeDependencies());
  assert.equal(result.ok, true);
  assert.equal(owner.livestreamRoom.items.length, 12);
  assert.equal(owner.bracelets.length, 0);
}

{
  const owner = player("replenish", 13);
  const deps = makeDependencies();
  assert.equal(startLivestreamRoom(owner, listingsFor(owner, 11), deps).ok, true);
  assert.equal(replenishLivestreamRoom(owner, listingsFor(owner, 2), deps).ok, false);
  assert.equal(owner.livestreamRoom.items.length, 11);
  assert.equal(owner.bracelets.length, 2);
  assert.equal(replenishLivestreamRoom(owner, listingsFor(owner, 1), deps).ok, true);
  assert.equal(owner.livestreamRoom.items.length, 12);
  assert.equal(owner.bracelets.length, 1);
}

{
  const owner = player("timeout", 3);
  let autoClosed = null;
  const deps = makeDependencies({
    onRoomAutoClosed: (_seller, payload) => { autoClosed = payload; }
  });
  assert.equal(startLivestreamRoom(owner, listingsFor(owner, 3), deps).ok, true);
  const endsAt = owner.livestreamRoom.endsAt;
  assert.equal(endsAt, owner.livestreamRoom.startedAt + LIVESTREAM_BASE_DURATION_MS);
  assert.equal(processAiLivestreamRooms([owner], { ...deps, now: endsAt + 1 }), true);
  assert.equal(owner.livestreamRoom, null);
  assert.equal(owner.bracelets.length, 3);
  assert.equal(autoClosed?.settleReport?.reason, "timeout");
}

{
  const owner = player("close", 5);
  const deps = makeDependencies();
  startLivestreamRoom(owner, listingsFor(owner, 3), deps);
  const startedAt = owner.livestreamRoom.startedAt;
  const result = closeLivestreamRoom(owner, { ...deps, now: startedAt + 90_000 });
  assert.equal(result.ok, true);
  assert.equal(owner.livestreamRoom, null);
  assert.equal(owner.bracelets.length, 5);
  assert.equal(result.returnedCount, 3);
  assert.ok(result.settleReport);
  assert.equal(result.settleReport.reason, "manual");
  assert.equal(result.settleReport.returnedCount, 3);
  assert.equal(result.settleReport.soldCount, 0);
  assert.equal(result.settleReport.durationMs, 90_000);
  assert.equal(result.settleReport.revenueTotal, 0);
  assert.equal(result.settleReport.netProfit, 0);
}

{
  const seller = player("seller", 3);
  const buyer = player("buyer", 0);
  const deps = makeDependencies();
  startLivestreamRoom(seller, listingsFor(seller, 3, 11_000), deps);
  const roomItemId = seller.livestreamRoom.items[0].id;
  const sellerCash = seller.cash;
  const buyerCash = buyer.cash;
  const result = purchaseLivestreamRoomItem({
    seller,
    buyer,
    itemId: roomItemId,
    buyerType: "player",
    buyerName: buyer.name
  }, deps);
  assert.equal(result.ok, true);
  assert.equal(buyer.cash, buyerCash - 11_000);
  assert.equal(seller.cash, sellerCash + 11_000);
  assert.equal(buyer.bracelets.length, 1);
  assert.equal(seller.livestreamRoom.items.length, 2);
  assert.equal(seller.livestreamHistory[0].buyerType, "player");
  assert.equal(seller.tasksAdvanced, 1);
}

{
  const seller = player("self", 3);
  const deps = makeDependencies();
  startLivestreamRoom(seller, listingsFor(seller, 3), deps);
  const result = purchaseLivestreamRoomItem({
    seller,
    buyer: seller,
    itemId: seller.livestreamRoom.items[0].id,
    buyerType: "player",
    buyerName: seller.name
  }, deps);
  assert.equal(result.ok, false);
  assert.match(result.message, /自己的商品/);
}

{
  const seller = player("poor-seller", 3);
  const buyer = player("poor-buyer", 0);
  buyer.cash = 50;
  const deps = makeDependencies();
  startLivestreamRoom(seller, listingsFor(seller, 3), deps);
  const itemId = seller.livestreamRoom.items[0].id;
  const result = purchaseLivestreamRoomItem({
    seller,
    buyer,
    itemId,
    buyerType: "player",
    buyerName: buyer.name
  }, deps);
  assert.equal(result.ok, false);
  assert.match(result.message, /资金不足/);
  assert.equal(seller.livestreamRoom.items.length, 3);
}

{
  const seller = player("stale", 3);
  const buyer = player("stale-buyer", 0);
  const deps = makeDependencies();
  startLivestreamRoom(seller, listingsFor(seller, 3), deps);
  const itemId = seller.livestreamRoom.items[0].id;
  assert.equal(purchaseLivestreamRoomItem({
    seller,
    buyer,
    itemId,
    buyerType: "player",
    buyerName: buyer.name
  }, deps).ok, true);
  const buyerCash = buyer.cash;
  const repeated = purchaseLivestreamRoomItem({
    seller,
    buyer,
    itemId,
    buyerType: "player",
    buyerName: buyer.name
  }, deps);
  assert.equal(repeated.ok, false);
  assert.match(repeated.message, /售罄/);
  assert.equal(buyer.cash, buyerCash);
}

{
  const seller = player("final", 3);
  const deps = makeDependencies();
  startLivestreamRoom(seller, listingsFor(seller, 3, 11_000), deps);
  const startedAt = seller.livestreamRoom.startedAt;
  let last = null;
  for (const roomItem of [...seller.livestreamRoom.items]) {
    last = purchaseLivestreamRoomItem({
      seller,
      buyer: null,
      itemId: roomItem.id,
      buyerType: "ai",
      buyerName: "AI翠友"
    }, { ...deps, now: startedAt + 120_000 });
    assert.equal(last.ok, true);
  }
  assert.equal(seller.livestreamRoom, null);
  assert.equal(seller.livestreamHistory.length, 3);
  assert.equal(last.autoClosed, true);
  assert.ok(last.settleReport);
  assert.equal(last.settleReport.reason, "sold_out");
  assert.equal(last.settleReport.soldCount, 3);
  assert.equal(last.settleReport.revenueTotal, 33_000);
  assert.equal(last.settleReport.costTotal, 30_000);
  assert.equal(last.settleReport.netProfit, 3_000);
  assert.equal(last.settleReport.items[0].buyerName, "AI翠友");
  assert.equal(last.settleReport.items[0].quantity, 1);
  assert.equal(last.settleReport.durationMs, 120_000);
}

{
  const seller = player("offline-ai", 3);
  seller.online = false;
  const deps = makeDependencies({ now: 20_000, rng: () => 0 });
  startLivestreamRoom(seller, listingsFor(seller, 3, 8_000), {
    ...deps,
    now: 1_000
  });
  seller.livestreamRoom.nextAiVisitAt = 2_000;
  const changed = processAiLivestreamRooms([seller], deps);
  assert.equal(changed, true);
  assert.equal(seller.livestreamRoom.items.length, 2);
  assert.ok(seller.livestreamRoom.likes > 0);
  assert.equal(seller.livestreamHistory[0].buyerType, "ai");
}

{
  const seller = player("public", 3);
  seller.bracelets[0].trueQualityKey = "imperial";
  seller.bracelets[0].trueValue = 999_999;
  const deps = makeDependencies();
  startLivestreamRoom(seller, listingsFor(seller, 3), deps);
  const room = publicLivestreamRoom(seller, deps);
  assert.equal(room.ownerId, seller.id);
  assert.equal(room.items.length, 3);
  assert.equal(Object.hasOwn(room.items[0].product, "trueQualityKey"), false);
  assert.equal(Object.hasOwn(room.items[0].product, "trueValue"), false);

  // 模拟一笔成交后：私有快照可带 sales，公开大厅不带
  const buyer = player("buyer-public", 0);
  const itemId = seller.livestreamRoom.items[0].id;
  purchaseLivestreamRoomItem({
    seller,
    buyer,
    itemId,
    buyerType: "player",
    buyerName: buyer.name
  }, deps);
  const privateView = publicLivestreamRoom(seller, { ...deps, includeSales: true });
  const hallView = publicLivestreamRoom(seller, { ...deps, includeSales: false });
  assert.equal(privateView.sales.length, 1);
  assert.equal(hallView.sales.length, 0);
  assert.equal(hallView.totalSales, 1);
}

console.log("Livestream room checks passed");
