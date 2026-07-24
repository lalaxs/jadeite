import assert from "node:assert/strict";
import {
  LIVESTREAM_MAX_ITEMS,
  LIVESTREAM_MIN_ITEMS,
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
assert.equal(LIVESTREAM_MAX_ITEMS, 20);

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
  const owner = player("small", 3);
  const result = startLivestreamRoom(owner, listingsFor(owner, 2), makeDependencies());
  assert.equal(result.ok, false);
  assert.match(result.message, /至少 3 件/);
  assert.equal(owner.bracelets.length, 3);
}

{
  const owner = player("large", 21);
  const result = startLivestreamRoom(owner, listingsFor(owner, 21), makeDependencies());
  assert.equal(result.ok, false);
  assert.match(result.message, /最多 20 件/);
  assert.equal(owner.bracelets.length, 21);
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

{
  const owner = player("price", 3);
  const invalid = listingsFor(owner, 3);
  invalid[1].price = 99;
  const result = startLivestreamRoom(owner, invalid, makeDependencies());
  assert.equal(result.ok, false);
  assert.match(result.message, /售价/);
  assert.equal(owner.bracelets.length, 3);
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
  const owner = player("maximum", 20);
  const result = startLivestreamRoom(owner, listingsFor(owner, 20), makeDependencies());
  assert.equal(result.ok, true);
  assert.equal(owner.livestreamRoom.items.length, 20);
  assert.equal(owner.bracelets.length, 0);
}

{
  const owner = player("replenish", 21);
  const deps = makeDependencies();
  assert.equal(startLivestreamRoom(owner, listingsFor(owner, 19), deps).ok, true);
  assert.equal(replenishLivestreamRoom(owner, listingsFor(owner, 2), deps).ok, false);
  assert.equal(owner.livestreamRoom.items.length, 19);
  assert.equal(owner.bracelets.length, 2);
  assert.equal(replenishLivestreamRoom(owner, listingsFor(owner, 1), deps).ok, true);
  assert.equal(owner.livestreamRoom.items.length, 20);
  assert.equal(owner.bracelets.length, 1);
}

{
  const owner = player("close", 5);
  const deps = makeDependencies();
  startLivestreamRoom(owner, listingsFor(owner, 3), deps);
  const result = closeLivestreamRoom(owner, deps);
  assert.equal(result.ok, true);
  assert.equal(owner.livestreamRoom, null);
  assert.equal(owner.bracelets.length, 5);
  assert.equal(result.returnedCount, 3);
}

{
  const seller = player("seller", 3);
  const buyer = player("buyer", 0);
  const deps = makeDependencies();
  startLivestreamRoom(seller, listingsFor(seller, 3, 12_000), deps);
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
  assert.equal(buyer.cash, buyerCash - 12_000);
  assert.equal(seller.cash, sellerCash + 12_000);
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
  startLivestreamRoom(seller, listingsFor(seller, 3), deps);
  for (const roomItem of [...seller.livestreamRoom.items]) {
    assert.equal(purchaseLivestreamRoomItem({
      seller,
      buyer: null,
      itemId: roomItem.id,
      buyerType: "ai",
      buyerName: "AI翠友"
    }, deps).ok, true);
  }
  assert.equal(seller.livestreamRoom, null);
  assert.equal(seller.livestreamHistory.length, 3);
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
}

console.log("Livestream room checks passed");
