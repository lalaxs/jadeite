import { buyGoodsFromStallForPlayer } from "../server/services/blackmarket-service.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";
import {
  BLACKMARKET_MIN_PRICE,
  BLACKMARKET_GOODS_CAP,
  BLACKMARKET_BLIND_MIN,
  BLACKMARKET_BLIND_CAP,
  BLACKMARKET_BLIND_DRAW_COUNT,
  BLACKMARKET_BLIND_EXTRA_RATES,
  BLACKMARKET_RATING_TTL_MS,
  bindBlackmarketApi,
  blackMaskForPlayerId,
  buildServiceSnapshot,
  buildOfferCapabilityRefs,
  normalizeServiceProfile,
  updateServiceProfileForPlayer,
  applyServiceCuration,
  defaultServiceProfile,
  buildServiceProof,
  buildRatingDisplay,
  BM_RATING_MIN_SAMPLES,
  bmRatingSampleCountForPlayer,
  publicServiceOrdersForPlayer
} from "../server/services/blackmarket-service.js";

function reset() {
  H.state.players.clear();
  H.state.sockets.clear();
  H.state.roughPool.length = 0;
  H.state.listings.length = 0;
  H.state.blackListings.length = 0;
  H.state.blackStalls = H.state.blackStalls || [];
  H.state.blackStalls.length = 0;
  H.state.blackServiceOrders = H.state.blackServiceOrders || [];
  H.state.blackServiceOrders.length = 0;
  H.state.wants.length = 0;
  H.state.news.length = 0;
  H.state.auction = null;
  H.state.latestAuctionResults = [];
  H.state.auctionHistory = [];
}

function installPlayer(id, cash) {
  const player = installOwnedWorkshopFixture(H.makePlayer(id));
  H.normalizePlayer(player);
  player.id = id;
  player.name = `掌柜-${id}`;
  player.cash = cash;
  player.exp = 0;
  player.rep = 0;
  player.achievementPoints = Math.max(Number(player.achievementPoints) || 0, 680);
  player.achievementPointsBonus = Math.max(Number(player.achievementPointsBonus) || 0, 680);
  H.state.players.set(id, player);
  return player;
}

function makeRough(id, name = id) {
  return {
    id,
    type: "rough",
    name,
    price: 1200,
    value: 1200,
    score: 2,
    quality: "豆种",
    qualityKey: "bean",
    color: "晴绿",
    revealed: false,
    materialStage: "rough"
  };
}

function makeBracelet(id, name = id, value = 2000) {
  return {
    id,
    type: "bracelet",
    name,
    value,
    price: value,
    materialStage: "finished",
    score: 3
  };
}

function findEscrowItem(seller, orderId) {
  for (const bucket of [seller.rough, seller.materials, seller.slices, seller.bracelets]) {
    const item = (bucket || []).find((row) => row.escrowOrderId === orderId);
    if (item) return item;
  }
  return null;
}

reset();
assert.equal(BLACKMARKET_MIN_PRICE, 100);
assert.equal(BLACKMARKET_BLIND_MIN, 6);
assert.equal(BLACKMARKET_BLIND_CAP, 50);
assert.equal(BLACKMARKET_BLIND_DRAW_COUNT, 3);
assert.equal(BM_RATING_MIN_SAMPLES, 5);
assert.equal(blackMaskForPlayerId("a").maskName, blackMaskForPlayerId("a").maskName);

const seller = installPlayer("bm-seller", 5000);
const buyer = installPlayer("bm-buyer", 50000);

const legacyRatingOwner = installPlayer("bm-legacy-rating", 5000);
legacyRatingOwner.satisfaction = 76;
legacyRatingOwner.stats.orderCount = BM_RATING_MIN_SAMPLES;
delete legacyRatingOwner.orderSat;
delete legacyRatingOwner.bmSat;
delete legacyRatingOwner.buyerCredit;
const legacyRatingOwnerBeforeRead = structuredClone(legacyRatingOwner);
assert.equal(buildRatingDisplay(H.state, legacyRatingOwner.id).visible, true);
assert.deepEqual(
  legacyRatingOwner,
  legacyRatingOwnerBeforeRead,
  "public rating reads must not migrate persisted player fields"
);
H.state.players.delete(legacyRatingOwner.id);

const timedPublicOrder = {
  id: "timed-public-order",
  buyerId: buyer.id,
  buyerName: buyer.name,
  sellerId: seller.id,
  sellerName: seller.name,
  status: "pending",
  acceptExpiresAt: 5000,
  createdAt: 1000
};
H.state.blackServiceOrders.push(timedPublicOrder);
assert.equal(
  publicServiceOrdersForPlayer(H.state, buyer.id, buyer.id, 4999).some((row) => row.id === timedPublicOrder.id),
  true,
  "service-order snapshots must use their supplied clock before expiry"
);
assert.equal(
  publicServiceOrdersForPlayer(H.state, buyer.id, buyer.id, 5001).some((row) => row.id === timedPublicOrder.id),
  false,
  "service-order snapshots must use their supplied clock after expiry"
);
H.state.blackServiceOrders.splice(H.state.blackServiceOrders.indexOf(timedPublicOrder), 1);

// One stall only — setup until first publish
const openGoods = H.openBlackStallForPlayer(seller, { type: "goods", title: "料子摊", anonymous: false });
assert.equal(openGoods.ok, true, openGoods.message);
assert.equal(H.state.blackStalls[0].status, "setup");
assert.equal(H.publicBlackStall(H.state.blackStalls[0], buyer.id, (x) => x), null);
assert.equal(H.openBlackStallForPlayer(seller, { type: "blindbox" }).ok, false);

seller.bracelets.push(makeBracelet("g1", "货1"));
const listed = H.addGoodsToStallForPlayer(seller, { type: "bracelet", itemId: "g1", price: 100 });
assert.equal(listed.ok, true, listed.message);
assert.equal(listed.activated, true);
assert.equal(H.state.blackStalls[0].status, "open");
assert.equal(H.state.blackStalls[0].items.length, 1);

const pub = H.publicBlackStall(H.state.blackStalls[0], buyer.id, (x) => x);
assert.equal(pub.type, "goods");
assert.equal(pub.ownerId, seller.id);
assert.equal(pub.ratingDisplay.visible, false);
assert.equal(pub.ratingDisplay.label, "暂无评级");
assert.equal(pub.ratingDisplay.sampleCount, 0);
assert.equal(pub.satisfaction, null);
assert.equal(pub.items.length, 1);

const listingId = H.state.blackStalls[0].items[0].id;
const stallTitleBeforeBuy = H.state.blackStalls[0].title;
const sellerCashBefore = seller.cash;
const buy = H.buyGoodsFromStallForPlayer(buyer, H.state.blackStalls[0].id, listingId);
assert.equal(buy.ok, true, buy.message);
assert.equal(buy.tax, 0);
assert.equal(buy.stallClosed, true, "last item sold should auto-close stall");
assert.equal(H.state.blackStalls.find((s) => s.ownerId === seller.id), undefined);
assert.equal(seller.cash, sellerCashBefore + 100, "sale proceeds should credit seller cash immediately");
assert.equal((seller.pendingBmRatings || []).length, 1);
assert.equal((buyer.pendingBmRatings || []).length, 1);
assert.equal(buyer.pendingBmRatings[0].price, 100);
assert.equal(buyer.pendingBmRatings[0].itemName, "货1");
assert.equal(buyer.pendingBmRatings[0].stallTitle, stallTitleBeforeBuy);
assert.equal(buyer.pendingBmRatings[0].tradeKind, "goods");

// Live transaction guards reject stale sellers before any money/item mutation.
const staleBmCash = buyer.cash;
H.state.blackStalls.push({
  id: "stale-goods-stall",
  ownerId: "missing-goods-seller",
  ownerName: "失效摊主",
  title: "失效货摊",
  type: "goods",
  status: "open",
  items: [{ id: "stale-goods-row", type: "bracelet", item: makeBracelet("stale-goods-item"), price: 100 }]
});
const staleGoodsBuy = H.buyGoodsFromStallForPlayer(buyer, "stale-goods-stall", "stale-goods-row");
assert.equal(staleGoodsBuy.ok, false);
assert.equal(staleGoodsBuy.code, "STALE_STALL");
assert.equal(buyer.cash, staleBmCash);
assert.equal(buyer.bracelets.some((row) => row.id === "stale-goods-item"), false);
assert.equal(H.state.blackStalls.some((row) => row.id === "stale-goods-stall"), false);

H.state.blackStalls.push({
  id: "stale-blind-stall",
  ownerId: "missing-blind-seller-live",
  ownerName: "失效摊主",
  title: "失效盲盒",
  type: "blindbox",
  status: "open",
  blindPrice: 100,
  pool: Array.from({ length: BLACKMARKET_BLIND_MIN }, (_, index) => ({
    id: `stale-blind-row-${index}`,
    type: "bracelet",
    item: makeBracelet(`stale-blind-item-${index}`)
  }))
});
const staleBlindBuy = H.startBlindboxDrawForPlayer(buyer, "stale-blind-stall");
assert.equal(staleBlindBuy.ok, false);
assert.equal(staleBlindBuy.code, "STALE_STALL");
assert.equal(buyer.cash, staleBmCash);
assert.equal(H.state.blackStalls.some((row) => row.id === "stale-blind-stall"), false);

const staleServiceItem = makeRough("stale-service-item", "失效技术单料");
buyer.rough.push(staleServiceItem);
H.state.blackStalls.push({
  id: "stale-service-stall",
  ownerId: "missing-service-seller",
  ownerName: "失效摊主",
  title: "失效技术摊",
  type: "service",
  status: "open",
  offers: [{ id: "stale-service-offer", templateId: "open-window", title: "代开料", price: 100, etaMinutes: 30 }]
});
const staleServiceBuy = H.orderBlackServiceForPlayer(buyer, "stale-service-stall", "stale-service-offer", {
  itemType: "rough",
  itemId: staleServiceItem.id
});
assert.equal(staleServiceBuy.ok, false);
assert.equal(staleServiceBuy.code, "STALE_STALL");
assert.equal(buyer.cash, staleBmCash);
assert.ok(buyer.rough.some((row) => row.id === staleServiceItem.id));
assert.equal(H.state.blackStalls.some((row) => row.id === "stale-service-stall"), false);

assert.equal(BLACKMARKET_RATING_TTL_MS, 7 * 24 * 60 * 60 * 1000);
{
  const created = Number(buyer.pendingBmRatings[0].createdAt || 0);
  const expires = Number(buyer.pendingBmRatings[0].expiresAt || 0);
  assert.ok(Math.abs((expires - created) - BLACKMARKET_RATING_TTL_MS) < 5_000, "rating TTL should be 7 days");
}
// Expired pending ratings drop on normalize
{
  const stale = { ...buyer.pendingBmRatings[0], id: "stale-rate", expiresAt: Date.now() - 1 };
  buyer.pendingBmRatings.push(stale);
  H.normalizePlayer(buyer);
  assert.equal(buyer.pendingBmRatings.some((r) => r.id === "stale-rate"), false);
}

// Batch list + last withdraw auto-close
assert.equal(H.openBlackStallForPlayer(seller, { type: "goods", title: "货摊二" }).ok, true);
seller.bracelets.push(makeBracelet("g2", "货2"), makeBracelet("g3", "货3"));
const batch = H.addGoodsBatchToStallForPlayer(seller, [
  { type: "bracelet", itemId: "g2", price: 120 },
  { type: "bracelet", itemId: "g3", price: 130 }
]);
assert.equal(batch.ok, true, batch.message);
assert.equal(batch.count, 2);
assert.equal(H.state.blackStalls[0].items.length, 2);
const wd1 = H.withdrawGoodsFromStallForPlayer(seller, H.state.blackStalls[0].items[0].id);
assert.equal(wd1.ok, true);
assert.equal(wd1.stallClosed, false);
const wdLast = H.withdrawGoodsFromStallForPlayer(seller, H.state.blackStalls[0].items[0].id);
assert.equal(wdLast.ok, true);
assert.equal(wdLast.stallClosed, true);
assert.equal(H.state.blackStalls.find((s) => s.ownerId === seller.id), undefined);

// Leftover empty open goods stall (e.g. race) should be swept
assert.equal(H.openBlackStallForPlayer(seller, { type: "goods", title: "空货架" }).ok, true);
seller.bracelets.push(makeBracelet("ghost", "幽灵货"));
assert.equal(H.addGoodsToStallForPlayer(seller, { type: "bracelet", itemId: "ghost", price: 115 }).ok, true);
H.state.blackStalls[0].items = [];
assert.equal(H.state.blackStalls[0].status, "open");
assert.equal(H.publicBlackStall(H.state.blackStalls[0], buyer.id, (x) => x), null, "empty open stall hidden from plaza");
assert.equal(H.sweepEmptyBlackGoodsStalls(H.state), true);
assert.equal(H.state.blackStalls.find((s) => s.ownerId === seller.id), undefined, "sweep removes empty goods stall");

const rateId = buyer.pendingBmRatings[0].id;
const beforeSat = seller.satisfaction;
const rated = H.submitBlackmarketRatingForPlayer(buyer, { ratingId: rateId, stars: 5 });
assert.equal(rated.ok, true, rated.message);
assert.equal(seller.satisfaction, beforeSat == null ? 72 : beforeSat + 2);
assert.equal(bmRatingSampleCountForPlayer(H.state, seller.id), 1);
assert.equal(buildRatingDisplay(H.state, seller.id).visible, false, "一条评价时不应开分");
assert.equal(buildRatingDisplay(H.state, seller.id).sampleCount, 1);

// Close and reopen as blindbox
assert.equal(H.openBlackStallForPlayer(seller, {
  type: "blindbox",
  title: "盲盒柜",
  anonymous: true
}).ok, true);
assert.equal(H.state.blackStalls[0].status, "setup");
H.updateBlackStallMetaForPlayer(seller, { blindPrice: 500, blindDescription: "随机好货" });

const entries = [];
for (let i = 0; i < BLACKMARKET_BLIND_MIN; i++) {
  const piece = makeBracelet(`b${i}`, `盲${i}`);
  seller.bracelets.push(piece);
  entries.push({ type: "bracelet", itemId: piece.id });
}
const stock = H.addBlindboxItemsForPlayer(seller, entries, { blindPrice: 880 });
assert.equal(stock.ok, true, stock.message);
assert.equal(stock.activated, true);
assert.equal(stock.blindPrice, 880);
assert.equal(H.state.blackStalls[0].blindPrice, 880, "adding items should apply unified blindPrice");
assert.equal(H.state.blackStalls[0].status, "open");
assert.equal(H.state.blackStalls[0].pool.length, BLACKMARKET_BLIND_MIN);
assert.notEqual(H.state.blackStalls[0].blindPrice, BLACKMARKET_MIN_PRICE, "activated stall must not keep placeholder price");

const anonPub = H.publicBlackStall(H.state.blackStalls[0], buyer.id, (x) => x);
assert.equal(anonPub.anonymous, true);
assert.equal(anonPub.ownerId, undefined);
assert.equal(anonPub.poolCount, BLACKMARKET_BLIND_MIN);
assert.equal(anonPub.pool, undefined);

const anonOff = H.updateBlackStallMetaForPlayer(seller, { anonymous: false });
assert.equal(anonOff.ok, true, anonOff.message);
assert.equal(H.state.blackStalls[0].anonymous, false);
const namedPub = H.publicBlackStall(H.state.blackStalls[0], buyer.id, (x) => x);
assert.equal(namedPub.anonymous, false);
assert.equal(namedPub.ownerId, seller.id);
const anonOn = H.updateBlackStallMetaForPlayer(seller, { anonymous: true });
assert.equal(anonOn.ok, true, anonOn.message);
assert.equal(H.state.blackStalls[0].anonymous, true);
assert.ok(H.state.blackStalls[0].maskName);

const draw = H.buyBlindboxFromStallForPlayer(buyer, H.state.blackStalls[0].id);
assert.equal(draw.ok, true, draw.message);
assert.equal(H.state.blackStalls[0].status, "paused");
assert.equal((H.state.blackStalls[0].pool || []).length, BLACKMARKET_BLIND_MIN - 1);

assert.equal(H.closeBlackStallForPlayer(seller).ok, true);

// 客户端漏传 / 仍传占位 1 时，服务端应按池内货均价兜底（开摊后价格不得仍为 1）
{
  const autoSeller = installPlayer("blind-auto-price", 50000);
  assert.equal(H.openBlackStallForPlayer(autoSeller, {
    type: "blindbox",
    title: "均价兜底摊",
    anonymous: false
  }).ok, true);
  assert.equal(H.state.blackStalls[0].blindPrice, BLACKMARKET_MIN_PRICE);
  const autoEntries = [];
  const values = [];
  for (let i = 0; i < BLACKMARKET_BLIND_MIN; i++) {
    const value = 2000 + i * 200;
    values.push(value);
    const piece = makeBracelet(`auto-${i}`, `均价${i}`, value);
    autoSeller.bracelets.push(piece);
    autoEntries.push({ type: "bracelet", itemId: piece.id });
  }
  const expectedAvg = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const missing = H.addBlindboxItemsForPlayer(autoSeller, autoEntries);
  assert.equal(missing.ok, true, missing.message);
  assert.equal(missing.activated, true);
  assert.equal(H.state.blackStalls[0].status, "open");
  assert.equal(H.state.blackStalls[0].blindPrice, expectedAvg, "missing blindPrice should fall back to pool average");
  assert.ok(H.state.blackStalls[0].blindPrice > BLACKMARKET_MIN_PRICE, "fallback price must exceed the placeholder");
  assert.equal(H.closeBlackStallForPlayer(autoSeller).ok, true);

  const oneSeller = installPlayer("blind-one-price", 50000);
  assert.equal(H.openBlackStallForPlayer(oneSeller, {
    type: "blindbox",
    title: "占位1兜底摊",
    anonymous: false
  }).ok, true);
  const oneEntries = [];
  const oneValues = [];
  for (let i = 0; i < BLACKMARKET_BLIND_MIN; i++) {
    const value = 3500 + i * 50;
    oneValues.push(value);
    const piece = makeBracelet(`one-${i}`, `占位${i}`, value);
    oneSeller.bracelets.push(piece);
    oneEntries.push({ type: "bracelet", itemId: piece.id });
  }
  const expectedOneAvg = Math.round(oneValues.reduce((sum, value) => sum + value, 0) / oneValues.length);
  const withOne = H.addBlindboxItemsForPlayer(oneSeller, oneEntries, { blindPrice: BLACKMARKET_MIN_PRICE });
  assert.equal(withOne.ok, true, withOne.message);
  assert.equal(withOne.activated, true);
  assert.equal(H.state.blackStalls[0].blindPrice, expectedOneAvg, "blindPrice=1 should fall back to pool average on activate");
  assert.notEqual(H.state.blackStalls[0].blindPrice, BLACKMARKET_MIN_PRICE);
  const pubAuto = H.publicBlackStall(H.state.blackStalls[0], buyer.id, (x) => x);
  assert.equal(pubAuto.blindPrice, expectedOneAvg, "public stall must expose non-1 activated price");

  // 占位 1 写入 meta 不得抹掉已激活的有效定价
  const metaOne = H.updateBlackStallMetaForPlayer(oneSeller, { blindPrice: BLACKMARKET_MIN_PRICE });
  assert.equal(metaOne.ok, true, metaOne.message);
  assert.equal(H.state.blackStalls[0].blindPrice, expectedOneAvg, "meta blindPrice=1 must keep existing valid price");
  assert.equal(H.closeBlackStallForPlayer(oneSeller).ok, true);
}

// Blind pool capacity cap
{
  const capSeller = installPlayer("seller-blind-cap", 50_000);
  assert.equal(H.openBlackStallForPlayer(capSeller, {
    type: "blindbox",
    title: "容量柜",
    anonymous: false
  }).ok, true);
  H.updateBlackStallMetaForPlayer(capSeller, { blindPrice: 500 });
  const seed = [];
  for (let i = 0; i < BLACKMARKET_BLIND_MIN; i++) {
    const piece = makeBracelet(`caps${i}`, `底${i}`);
    capSeller.bracelets.push(piece);
    seed.push({ type: "bracelet", itemId: piece.id });
  }
  assert.equal(H.addBlindboxItemsForPlayer(capSeller, seed).ok, true);
  const overflowEntries = [];
  for (let i = 0; i < BLACKMARKET_BLIND_CAP - BLACKMARKET_BLIND_MIN + 1; i++) {
    const piece = makeBracelet(`capo${i}`, `超${i}`);
    capSeller.bracelets.push(piece);
    overflowEntries.push({ type: "bracelet", itemId: piece.id });
  }
  const overflow = H.addBlindboxItemsForPlayer(capSeller, overflowEntries);
  assert.equal(overflow.ok, false, "blind pool should reject over-cap batch");
  assert.match(String(overflow.message || ""), /剩余|已满|最多/);
  const fillEntries = overflowEntries.slice(0, BLACKMARKET_BLIND_CAP - BLACKMARKET_BLIND_MIN);
  const fill = H.addBlindboxItemsForPlayer(capSeller, fillEntries);
  assert.equal(fill.ok, true, fill.message);
  assert.equal(H.state.blackStalls[0].pool.length, BLACKMARKET_BLIND_CAP);
  const fullAgain = H.addBlindboxItemsForPlayer(capSeller, [{
    type: "bracelet",
    itemId: overflowEntries[overflowEntries.length - 1].itemId
  }]);
  assert.equal(fullAgain.ok, false);
  assert.equal(H.closeBlackStallForPlayer(capSeller).ok, true);
}

// Blind pool withdraw + auto-pause under min
{
  const wSeller = installPlayer("seller-blind-withdraw", 50_000);
  assert.equal(H.openBlackStallForPlayer(wSeller, {
    type: "blindbox",
    title: "下架柜",
    anonymous: false
  }).ok, true);
  H.updateBlackStallMetaForPlayer(wSeller, { blindPrice: 80 });
  const seed = [];
  for (let i = 0; i < BLACKMARKET_BLIND_MIN; i++) {
    const piece = makeBracelet(`wd${i}`, `撤${i}`);
    wSeller.bracelets.push(piece);
    seed.push({ type: "bracelet", itemId: piece.id });
  }
  assert.equal(H.addBlindboxItemsForPlayer(wSeller, seed).ok, true);
  assert.equal(H.state.blackStalls[0].status, "open");
  assert.equal(H.state.blackStalls[0].pool.length, BLACKMARKET_BLIND_MIN);
  const poolRow = H.state.blackStalls[0].pool[0];
  assert.ok(poolRow.id, "pool row should have id");
  const beforeInv = wSeller.bracelets.length;
  const withdrawn = H.withdrawBlindboxItemForPlayer(wSeller, poolRow.id);
  assert.equal(withdrawn.ok, true, withdrawn.message);
  assert.equal(H.state.blackStalls[0].pool.length, BLACKMARKET_BLIND_MIN - 1);
  assert.equal(H.state.blackStalls[0].status, "paused");
  assert.equal(wSeller.bracelets.length, beforeInv + 1);
  assert.equal(H.closeBlackStallForPlayer(wSeller).ok, true);
}

// Blind draw lock + 3-pick settle
{
  const seller2 = installPlayer("seller-blind-draw", 50_000);
  const buyer2 = installPlayer("buyer-blind-draw", 50_000);
  assert.equal(H.openBlackStallForPlayer(seller2, {
    type: "blindbox",
    title: "三选柜",
    anonymous: false
  }).ok, true);
  H.updateBlackStallMetaForPlayer(seller2, { blindPrice: 100, blindDescription: "三选一" });
  for (let i = 0; i < BLACKMARKET_BLIND_MIN; i++) {
    const piece = makeBracelet(`bd${i}`, `抽${i}`);
    seller2.bracelets.push(piece);
  }
  assert.equal(H.addBlindboxItemsForPlayer(seller2, seller2.bracelets.map((b) => ({
    type: "bracelet",
    itemId: b.id
  }))).ok, true);
  const started = H.startBlindboxDrawForPlayer(buyer2, H.state.blackStalls[0].id);
  assert.equal(started.ok, true, started.message);
  assert.equal(started.draw.candidates.length, 3);
  assert.equal(H.state.blackStalls[0].blindDraw?.buyerId, buyer2.id);
  const locked = H.startBlindboxDrawForPlayer(installPlayer("buyer-wait", 50_000), H.state.blackStalls[0].id);
  assert.equal(locked.ok, false);
  assert.match(locked.message, /正在抽取/);
  const ids = started.draw.candidates.map((c) => c.itemId);
  const cashBefore = buyer2.cash;
  const settled = H.settleBlindboxDrawForPlayer(buyer2, {
    stallId: H.state.blackStalls[0].id,
    drawId: started.draw.id,
    selectedItemIds: ids
  });
  assert.equal(settled.ok, true, settled.message);
  assert.equal(settled.items.length, 3);
  assert.equal(
    settled.extra,
    Math.round(started.draw.price * BLACKMARKET_BLIND_EXTRA_RATES[1])
      + Math.round(started.draw.price * BLACKMARKET_BLIND_EXTRA_RATES[2])
  );
  assert.equal(buyer2.cash, cashBefore - settled.extra);
  assert.equal(H.state.blackStalls[0].blindDraw, null);
  assert.equal(H.closeBlackStallForPlayer(seller2).ok, true);
}

// Blind draw multi-pick must degrade to the guaranteed first item when the buyer cannot pay extras.
{
  const seller = installPlayer("seller-blind-poor", 50_000);
  const buyer = installPlayer("buyer-blind-poor", 50_000);
  assert.equal(H.openBlackStallForPlayer(seller, {
    type: "blindbox",
    title: "保底柜",
    anonymous: false
  }).ok, true);
  H.updateBlackStallMetaForPlayer(seller, { blindPrice: 100, blindDescription: "余额兜底" });
  for (let i = 0; i < BLACKMARKET_BLIND_MIN; i++) {
    seller.bracelets.push(makeBracelet(`poor${i}`, `保底${i}`));
  }
  assert.equal(H.addBlindboxItemsForPlayer(seller, seller.bracelets.map((item) => ({
    type: "bracelet",
    itemId: item.id
  }))).ok, true);
  const started = H.startBlindboxDrawForPlayer(buyer, H.state.blackStalls[0].id);
  assert.equal(started.ok, true, started.message);
  buyer.cash = 0;
  const settled = H.settleBlindboxDrawForPlayer(buyer, {
    stallId: H.state.blackStalls[0].id,
    drawId: started.draw.id,
    selectedItemIds: started.draw.candidates.map((candidate) => candidate.itemId)
  });
  assert.equal(settled.ok, true, settled.message);
  assert.equal(settled.degraded, true);
  assert.equal(settled.items.length, 1);
  assert.equal(settled.extra, 0);
  assert.equal(H.closeBlackStallForPlayer(seller).ok, true);
}

// Blind draw must not false-pause when pool briefly dips below min during lock
{
  const seller3 = installPlayer("seller-blind-repurchase", 50_000);
  const buyer3 = installPlayer("buyer-blind-repurchase", 50_000);
  assert.equal(H.openBlackStallForPlayer(seller3, {
    type: "blindbox",
    title: "复购柜",
    anonymous: false
  }).ok, true);
  H.updateBlackStallMetaForPlayer(seller3, { blindPrice: 100, blindDescription: "可连抽" });
  const seedN = BLACKMARKET_BLIND_MIN + 2; // 12: draw lock leaves 9 free, but 9+3 locked still meets min
  for (let i = 0; i < seedN; i++) {
    const piece = makeBracelet(`rp${i}`, `复${i}`);
    seller3.bracelets.push(piece);
  }
  assert.equal(H.addBlindboxItemsForPlayer(seller3, seller3.bracelets.map((b) => ({
    type: "bracelet",
    itemId: b.id
  }))).ok, true);
  assert.equal(H.state.blackStalls[0].status, "open");
  const first = H.startBlindboxDrawForPlayer(buyer3, H.state.blackStalls[0].id);
  assert.equal(first.ok, true, first.message);
  assert.equal(H.state.blackStalls[0].status, "open", "active draw must not auto-pause while locked candidates still fill the min");
  assert.equal(H.state.blackStalls[0].pool.length, seedN - BLACKMARKET_BLIND_DRAW_COUNT);
  const firstSettle = H.settleBlindboxDrawForPlayer(buyer3, {
    stallId: H.state.blackStalls[0].id,
    drawId: first.draw.id,
    selectedItemIds: [first.draw.candidates[0].itemId]
  });
  assert.equal(firstSettle.ok, true, firstSettle.message);
  assert.equal(H.state.blackStalls[0].pool.length, seedN - 1);
  assert.equal(H.state.blackStalls[0].status, "open", "settle must leave stall open when pool still meets min");
  const second = H.startBlindboxDrawForPlayer(buyer3, H.state.blackStalls[0].id);
  assert.equal(second.ok, true, second.message || "buyer should be able to draw again");
  assert.equal(H.settleBlindboxDrawForPlayer(buyer3, {
    stallId: H.state.blackStalls[0].id,
    drawId: second.draw.id,
    selectedItemIds: [second.draw.candidates[0].itemId]
  }).ok, true);
  assert.equal(H.closeBlackStallForPlayer(seller3).ok, true);
}

// Legacy false-pause (stocked + paused without ownerPaused) heals on tick
{
  const seller4 = installPlayer("seller-blind-heal", 50_000);
  assert.equal(H.openBlackStallForPlayer(seller4, {
    type: "blindbox",
    title: "修复柜",
    anonymous: false
  }).ok, true);
  H.updateBlackStallMetaForPlayer(seller4, { blindPrice: 80 });
  for (let i = 0; i < BLACKMARKET_BLIND_MIN + 1; i++) {
    const piece = makeBracelet(`hl${i}`, `愈${i}`);
    seller4.bracelets.push(piece);
  }
  assert.equal(H.addBlindboxItemsForPlayer(seller4, seller4.bracelets.map((b) => ({
    type: "bracelet",
    itemId: b.id
  }))).ok, true);
  const stall4 = H.state.blackStalls[0];
  stall4.status = "paused";
  delete stall4.ownerPaused;
  assert.equal(H.processExpiredBlindDraws(H.state), true);
  assert.equal(stall4.status, "open");
  assert.equal(H.setBlackStallPausedForPlayer(seller4, true).ok, true);
  assert.equal(stall4.status, "paused");
  assert.equal(stall4.ownerPaused, true);
  assert.equal(H.processExpiredBlindDraws(H.state), false);
  assert.equal(stall4.status, "paused", "owner pause must survive stock sync");
  assert.equal(H.closeBlackStallForPlayer(seller4).ok, true);
}

seller.workers = [{
  id: "w1",
  name: "阿成",
  craftJob: "cutter",
  skills: {
    opening: {
      jieliao: { level: 6, exp: 0 },
      kaipi: { level: 5, exp: 0 },
      xiupi: { level: 4, exp: 0 },
      zhaoxia: { level: 5, exp: 0 }
    }
  }
}];
seller.devices = [{
  id: "d1",
  name: "开窗机",
  category: "开料",
  stage: "opening",
  durability: 100
}];

// Service stall
const openSvc = H.openBlackStallForPlayer(seller, { type: "service", title: "代工" });
assert.equal(openSvc.ok, true, openSvc.message);
assert.equal(H.state.blackStalls[0].status, "setup");
const offer = H.addServiceOfferForPlayer(seller, {
  templateId: "open-window",
  title: "代开料",
  desc: "快速开料",
  price: 200,
  etaMinutes: 20
});
assert.equal(offer.ok, true, offer.message);
assert.equal(offer.activated, true);
assert.equal(H.state.blackStalls[0].status, "open");
assert.equal(offer.offer.templateId, "open-window");
assert.ok((offer.offer.capabilityRefs?.bindLabels || []).length >= 1);
const svcSnap = buildServiceSnapshot(seller, H.state);
assert.ok(svcSnap);
assert.ok(svcSnap.skillPeaks.jieliao >= 6);
assert.ok(svcSnap.topSkills.length >= 1);
assert.ok(svcSnap.headlineTags.some((tag) => tag.id === "open-window"));
assert.ok(svcSnap.topDevices.length >= 1);
const svcPub = H.publicBlackStall(H.state.blackStalls[0], buyer.id, (x) => x);
assert.ok(svcPub.serviceSnapshot);
assert.equal(JSON.stringify(svcPub.serviceSnapshot).includes("阿成"), false);
assert.equal(svcPub.offers[0].templateId, "open-window");
assert.ok((svcPub.offers[0].capabilityLabels || []).length >= 1);
assert.ok(svcPub.offers[0].capabilityBasis);
const secondOffer = H.addServiceOfferForPlayer(seller, {
  templateId: "carve-plan",
  title: "代规划取镯",
  desc: "",
  price: 150,
  etaMinutes: 40
});
assert.equal(secondOffer.ok, true);
const duplicateOpenWindow = H.addServiceOfferForPlayer(seller, {
  templateId: "open-window",
  title: "代开料",
  price: 180,
  etaMinutes: 25
});
assert.equal(duplicateOpenWindow.ok, false, "same template must be rejected");
assert.match(String(duplicateOpenWindow.message || ""), /不能重复添加/);
const invalidCustom = H.addServiceOfferForPlayer(seller, {
  templateId: "custom",
  title: "杂项代工",
  price: 150,
  etaMinutes: 40
});
assert.equal(invalidCustom.ok, false);
const pubAfter = H.publicBlackStall(H.state.blackStalls[0], buyer.id, (x) => x);
assert.equal(pubAfter.offers.length, 2);
assert.equal(pubAfter.offers[0].templateId, "open-window");
assert.equal(pubAfter.offers[pubAfter.offers.length - 1].templateId, "carve-plan");
const refs = buildOfferCapabilityRefs(seller, "open-window");
assert.ok(refs.bindLabels.length >= 1);
assert.ok(refs.skillKeys.includes("jieliao"));

const autoSnap = buildServiceSnapshot(seller, H.state);
const curated = normalizeServiceProfile({
  headlineTagIds: ["open-window", "fake-tag"],
  acceptScopes: ["sealed", "opened", "bogus"],
  featuredWorkerIds: [(seller.workshop?.workers || [])[0]?.id, "fake-worker"].filter(Boolean),
  featuredEquipmentIds: [(seller.workshop?.devices || [])[0]?.id].filter(Boolean),
  showcaseItems: seller.bracelets.slice(0, 1).map((item) => ({ type: "bracelet", itemId: item.id }))
}, seller, autoSnap);
assert.ok(curated.headlineTagIds.includes("open-window"));
assert.equal(curated.headlineTagIds.includes("fake-tag"), false);
assert.equal(curated.acceptScopes.includes("bogus"), false);
assert.ok(curated.acceptScopes.includes("sealed"));
const profileUpdate = H.updateServiceProfileForPlayer(seller, curated);
assert.equal(profileUpdate.ok, true, profileUpdate.message);
assert.equal(H.state.blackStalls[0].serviceProfile.headlineTagIds[0], "open-window");
const pubCurated = H.publicBlackStall(H.state.blackStalls[0], buyer.id, (x) => x);
assert.ok(pubCurated.serviceSnapshot.curated);
assert.ok((pubCurated.serviceSnapshot.acceptScopes || []).length >= 1);
assert.equal(pubCurated.serviceProfile, undefined);
const pubMine = H.publicBlackStall(H.state.blackStalls[0], seller.id, (x) => x);
assert.ok(pubMine.serviceProfile);
assert.ok(pubMine.serviceProfileOptions?.eligibleHeadlineTags?.length >= 1);
if ((curated.featuredWorkerIds || []).length) {
  const anonSnap = applyServiceCuration(autoSnap, {
    ...H.state.blackStalls[0],
    serviceProfile: curated
  }, seller, true, (x) => x);
  assert.equal(JSON.stringify(anonSnap.featuredWorkers || []).includes(seller.name || "掌柜"), false);
}

const stallId = H.state.blackStalls[0].id;
const offerId = offer.offer.id;
buyer.rough.push(makeRough("svc-rough", "代开料料"));
const buyerCashBefore = buyer.cash;
const ordered = H.orderBlackServiceForPlayer(buyer, stallId, offerId, {
  itemType: "rough",
  itemId: "svc-rough",
  note: "急单"
});
assert.equal(ordered.ok, true, ordered.message);
assert.equal(ordered.order.status, "pending");
assert.equal(buyer.cash, buyerCashBefore - 200);
assert.equal(buyer.rough.some((row) => row.id === "svc-rough"), false);
assert.equal(findEscrowItem(seller, ordered.order.id), null, "item stays held until accept");
assert.ok(ordered.order.heldItem?.item?.id === "svc-rough");
const accepted = H.acceptBlackServiceForPlayer(seller, ordered.order.id);
assert.equal(accepted.ok, true, accepted.message);
assert.equal(accepted.order.status, "escrow");
assert.ok(accepted.order.expiresAt);
const escrowItem = findEscrowItem(seller, ordered.order.id);
assert.ok(escrowItem, "seller should hold escrow item after accept");
assert.ok(ordered.order.inputItem);
assert.equal(ordered.order.inputItem.itemId, "svc-rough");
assert.ok(ordered.order.capabilitySnapshot);
assert.equal(ordered.order.capabilitySnapshot.templateId, "open-window");
assert.ok((ordered.order.capabilitySnapshot.bindLabels || []).length >= 1);
assert.ok(ordered.order.capabilitySnapshot.serviceSnapshot);
const earlyBlocked = H.submitBlackServiceForPlayer(seller, ordered.order.id, { forceEarly: false });
assert.equal(earlyBlocked.ok, false);
assert.equal(earlyBlocked.needConfirm, true);
escrowItem.materialStage = "opened";
escrowItem.stage = "material";
escrowItem.type = "material";
seller.rough = (seller.rough || []).filter((row) => row.id !== escrowItem.id);
seller.materials = seller.materials || [];
seller.materials.push(escrowItem);
assert.equal(H.computeOrderFinished(ordered.order, seller), true);
assert.equal(H.submitBlackServiceForPlayer(seller, ordered.order.id).ok, true);
assert.equal(H.confirmBlackServiceForPlayer(buyer, ordered.order.id).ok, true);
const svcRatingId = buyer.pendingBmRatings.find((r) => r.tradeId === ordered.order.id)?.id
  || buyer.pendingBmRatings[0]?.id;
assert.ok(svcRatingId, "service rating pending");
const svcRated = H.submitBlackmarketRatingForPlayer(buyer, { ratingId: svcRatingId, stars: 5 });
assert.equal(svcRated.ok, true, svcRated.message);
assert.equal(H.state.blackServiceOrders.find((o) => o.id === ordered.order.id)?.buyerRating?.stars, 5);
seller.stats.orderCount = 3;
const proofPub = H.publicBlackStall(H.state.blackStalls[0], buyer.id, (x) => x);
assert.ok(proofPub.serviceProof);
assert.equal(proofPub.serviceProof.completedCount, 1);
assert.equal(proofPub.serviceProof.recent[0].stars, 5);
assert.equal(JSON.stringify(proofPub.serviceProof).includes(buyer.name), false);
assert.equal(proofPub.ratingDisplay.visible, true);
assert.ok(proofPub.satisfaction != null);
assert.equal(bmRatingSampleCountForPlayer(H.state, seller.id), 2);
assert.equal(H.publicBlackStall(H.state.blackStalls[0], seller.id, (x) => x).ratingDisplay.visible, true);
assert.ok(H.publicBlackStall(H.state.blackStalls[0], seller.id, (x) => x).satisfaction != null);
assert.ok(Number(seller.satisfaction) >= 74);
assert.ok(ordered.order.capabilitySnapshot.serviceSnapshot?.headlineTags?.length >= 0);
const sellerCashAfterService = seller.cash;
assert.ok(sellerCashAfterService >= 200, "service fee should credit on buyer confirm");
const collect = H.collectBlackmarketPayoutForPlayer(seller);
assert.equal(collect.ok, false, "no pending payout queue after instant credit");
assert.equal(seller.cash, sellerCashAfterService);

seller.blackPayouts = [{ id: "legacy-valid-payout", amount: "75" }];
const legacyPayout = H.collectBlackmarketPayoutForPlayer(seller);
assert.equal(legacyPayout.ok, true);
assert.equal(legacyPayout.total, 75);
assert.equal(seller.cash, sellerCashAfterService + 75);
seller.blackPayouts = [{ id: "legacy-invalid-payout", amount: NaN }];
const cashBeforeInvalidLegacyPayout = seller.cash;
const invalidLegacyPayout = H.collectBlackmarketPayoutForPlayer(seller);
assert.equal(invalidLegacyPayout.ok, false);
assert.equal(invalidLegacyPayout.code, "INVALID_PAYOUT");
assert.equal(seller.cash, cashBeforeInvalidLegacyPayout);
assert.equal(seller.blackPayouts.length, 1, "invalid legacy payouts must remain recoverable");
seller.blackPayouts = [];

// Typeless bracelet must still transfer into seller inventory (addItem used to drop silently)
assert.equal(H.closeBlackStallForPlayer(seller).ok, true);
H.openBlackStallForPlayer(seller, { type: "service", title: "精工摊" });
const inlayOffer = H.addServiceOfferForPlayer(seller, {
  templateId: "inlay-finish",
  title: "代镶嵌",
  price: 180,
  etaMinutes: 25
});
assert.equal(inlayOffer.ok, true, inlayOffer.message);
const typeless = {
  id: "typeless-bangle",
  name: "无 type 镯子",
  value: 2600,
  materialStage: "carved",
  stage: "carved",
  score: 3
};
buyer.bracelets.push(typeless);
const typedOrder = H.orderBlackServiceForPlayer(buyer, H.state.blackStalls[0].id, inlayOffer.offer.id, {
  itemType: "bracelet",
  itemId: "typeless-bangle",
  note: "补 type"
});
assert.equal(typedOrder.ok, true, typedOrder.message);
assert.equal(buyer.bracelets.some((row) => row.id === "typeless-bangle"), false);
assert.equal(typedOrder.order.status, "pending");
assert.equal(H.acceptBlackServiceForPlayer(seller, typedOrder.order.id).ok, true);
const typedEscrow = findEscrowItem(seller, typedOrder.order.id);
assert.ok(typedEscrow, "typeless bracelet must land in seller inventory");
assert.equal(typedEscrow.type, "bracelet");
assert.equal(typedEscrow.escrowOrderId, typedOrder.order.id);
assert.equal(typedEscrow.seen, false);
assert.equal(H.cancelBlackServiceForPlayer(seller, typedOrder.order.id).ok, true);

// Accept timeout auto-cancels pending orders and hides them from public lists
let openOfferId = (H.state.blackStalls[0].offers || []).find((o) => o.templateId === "open-window")?.id;
if (!openOfferId) {
  const restored = H.addServiceOfferForPlayer(seller, {
    templateId: "open-window",
    title: "代开料",
    price: 200,
    etaMinutes: 30
  });
  assert.equal(restored.ok, true, restored.message || "restore open-window offer");
  openOfferId = restored.offer?.id;
}
assert.ok(openOfferId, "open-window offer should already exist");
buyer.rough.push(makeRough("pending-timeout", "待确认料"));
const cashBeforeTimeout = buyer.cash;
const timeoutOrder = H.orderBlackServiceForPlayer(buyer, H.state.blackStalls[0].id, openOfferId, {
  itemType: "rough",
  itemId: "pending-timeout"
});
assert.equal(timeoutOrder.ok, true, timeoutOrder.message);
assert.equal(timeoutOrder.order.status, "pending");
timeoutOrder.order.acceptExpiresAt = Date.now() - 1000;
assert.equal(H.processExpiredBlackServiceOrders(H.state, Date.now()), true);
assert.equal(timeoutOrder.order.status, "cancelled");
assert.equal(timeoutOrder.order.submitMode, "accept_timeout");
assert.ok(buyer.rough.some((row) => row.id === "pending-timeout"), "item returned after accept timeout");
assert.equal(buyer.cash, cashBeforeTimeout, "deposit released after accept timeout");
const pubAfterTimeout = publicServiceOrdersForPlayer(H.state, seller.id, seller.id);
assert.equal(pubAfterTimeout.some((o) => o.id === timeoutOrder.order.id), false, "cancelled order hidden from list");

// Delivery ETA timeout cancels escrow orders and hides them
buyer.rough.push(makeRough("escrow-timeout", "交割超时料"));
const lateOrder = H.orderBlackServiceForPlayer(buyer, H.state.blackStalls[0].id, openOfferId, {
  itemType: "rough",
  itemId: "escrow-timeout"
});
assert.equal(lateOrder.ok, true, lateOrder.message);
assert.equal(H.acceptBlackServiceForPlayer(seller, lateOrder.order.id).ok, true);
lateOrder.order.expiresAt = Date.now() - 1000;
assert.equal(H.processExpiredBlackServiceOrders(H.state, Date.now()), true);
assert.equal(lateOrder.order.status, "cancelled");
assert.equal(lateOrder.order.submitMode, "timeout");
assert.ok(buyer.rough.some((row) => row.id === "escrow-timeout"));
assert.equal(
  publicServiceOrdersForPlayer(H.state, seller.id, seller.id).some((o) => o.id === lateOrder.order.id),
  false
);

// Goods cap
assert.equal(H.closeBlackStallForPlayer(seller).ok, true);
H.openBlackStallForPlayer(seller, { type: "goods", title: "帽" });
for (let i = 0; i < BLACKMARKET_GOODS_CAP; i++) {
  const piece = makeBracelet(`cap-${i}`, `帽${i}`);
  seller.bracelets.push(piece);
  assert.equal(
    H.addGoodsToStallForPlayer(seller, { type: "bracelet", itemId: piece.id, price: BLACKMARKET_MIN_PRICE }).ok,
    true
  );
}
seller.bracelets.push(makeBracelet("cap-overflow", "溢出"));
assert.equal(
  H.addGoodsToStallForPlayer(seller, { type: "bracelet", itemId: "cap-overflow", price: BLACKMARKET_MIN_PRICE }).ok,
  false
);

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
const socketHandlersSource = [
  "server/shell/socket-handlers.js",
  "server/shell/commands/blackmarket-commands.js"
].map((file) => readFileSync(file, "utf8")).join("\n");
assert.match(bootSource, /from "\.\.\/services\/blackmarket-service\.js"/);
assert.match(socketHandlersSource, /socket\.on\("bmOpenStall"/);

const clientSource = [
  "public/features/blackmarket/shared.js",
  "public/features/blackmarket/plaza.js",
  "public/features/blackmarket/goods.js",
  "public/features/blackmarket/blind-ui.js",
  "public/features/blackmarket/service-ui.js",
  "public/features/blackmarket/actions.js",
  "public/features/blackmarket/index.js"
].map((p) => readFileSync(p, "utf8")).join("\n");
assert.match(clientSource, /bmFeatureGate\("bmBuy"\)/);
assert.match(clientSource, /leaveLockedBlackmarket/);
assert.doesNotMatch(clientSource, /可逛摊位，达标后解锁对应操作/);
assert.match(clientSource, /bmToggleListItem/);
assert.match(clientSource, /requestBmWithdraw/);
assert.match(clientSource, /bmBuyBlind/);
assert.match(clientSource, /bmStallResult/);
assert.match(clientSource, /serviceProfileHtml/);
assert.match(clientSource, /bm-service-profile/);
assert.match(clientSource, /bm-service-templates/);
assert.match(clientSource, /serviceOfferCardHtml/);
assert.match(clientSource, /bmSvcTemplate/);
assert.match(clientSource, /openBmServiceProfileModal/);
assert.match(clientSource, /bmUpdateServiceProfile/);
assert.match(clientSource, /serviceProofHtml/);
assert.match(clientSource, /bmRatingPublicHtml/);
assert.match(clientSource, /ratingDisplay/);
assert.match(clientSource, /bm-rating-muted/);
assert.match(clientSource, /bm-service-proof/);
assert.match(clientSource, /bmAcceptService/);
assert.match(clientSource, /确认接单/);
assert.match(socketHandlersSource, /bmAcceptService/);
assert.match(socketHandlersSource, /bmUpdateServiceProfile/);
assert.doesNotMatch(clientSource, /window\.confirm/);

// 规划产物 + 余料可上架货物摊 / 盲盒池
reset();
const planSeller = installPlayer("bm-plan-seller", 8000);
H.openBlackStallForPlayer(planSeller, { type: "goods", title: "规划摊" });
const parentMaterial = {
  id: "plan-parent-1",
  type: "material",
  name: "测试明料",
  value: 5000,
  price: 5000,
  materialStage: "opened",
  quality: "冰种",
  qualityKey: "icy",
  color: "晴绿",
  score: 3,
  visual: { seed: "plan-parent-1" }
};
planSeller.materials.push(parentMaterial);
const kitA = { id: "kit-a", type: "bangle", openingTpl: "bangle", x: 40, y: 45, rot: 0, scale: 1, ringSize: 56 };
const kitB = { id: "kit-b", type: "cabochon", openingTpl: "egg", x: 70, y: 60, rot: 0, scale: 1, size: "M" };
const planList = H.addGoodsBatchToStallForPlayer(planSeller, [
  {
    type: "planned",
    itemId: `planned:${parentMaterial.id}:${kitA.id}`,
    parentId: parentMaterial.id,
    parentType: "material",
    kit: kitA,
    kits: [kitA, kitB],
    price: 800
  },
  {
    type: "leftover",
    itemId: `leftover:${parentMaterial.id}`,
    parentId: parentMaterial.id,
    parentType: "material",
    kits: [kitA, kitB],
    price: 1200
  }
]);
assert.equal(planList.ok, true, planList.message || "plan split list should succeed");
assert.equal(planSeller.materials.some((row) => row.id === parentMaterial.id), false, "parent should be consumed");
assert.equal((planSeller.bracelets || []).some((row) => row.sourceRoughId === parentMaterial.id), true, "unlisteds planned kit returns as bracelet");
const stall = H.state.blackStalls.find((row) => row.ownerId === planSeller.id);
assert.ok(stall?.items?.length >= 2, "planned piece and leftover should be on stall");
assert.ok(stall.items.some((row) => row.item?.materialStage === "carved"));
assert.ok(stall.items.some((row) => String(row.item?.name || "").includes("余料")));
assert.ok(
  stall.items.find((row) => String(row.item?.name || "").includes("余料"))?.item?.value < parentMaterial.value,
  "black-market plan splitting must reduce the leftover's value"
);

H.closeBlackStallForPlayer(planSeller);
H.openBlackStallForPlayer(planSeller, { type: "blindbox", title: "规划盲盒" });
const parent2 = {
  ...parentMaterial,
  id: "plan-parent-2",
  name: "盲盒明料"
};
planSeller.materials.push(parent2);
const blindAdd = H.addBlindboxItemsForPlayer(planSeller, [
  {
    type: "planned",
    itemId: `planned:${parent2.id}:kit-c`,
    parentId: parent2.id,
    kit: { id: "kit-c", type: "bangle", openingTpl: "bangle", x: 50, y: 50, ringSize: 56 },
    kits: [{ id: "kit-c", type: "bangle", openingTpl: "bangle", x: 50, y: 50, ringSize: 56 }]
  },
  {
    type: "leftover",
    itemId: `leftover:${parent2.id}`,
    parentId: parent2.id,
    kits: [{ id: "kit-c", type: "bangle", openingTpl: "bangle", x: 50, y: 50, ringSize: 56 }]
  }
]);
assert.equal(blindAdd.ok, true, blindAdd.message || "blind plan split should succeed");
const blindStall = H.state.blackStalls.find((row) => row.ownerId === planSeller.id);
assert.ok((blindStall?.pool || []).length >= 2, "blind pool should receive planned + leftover");

const planPoolSource = readFileSync("shared/domain/blackmarket/bm-plan-pool.js", "utf8");
assert.match(planPoolSource, /export function bmSellables/);
assert.match(planPoolSource, /evaluateLeftoverMaterial/);
assert.match(planPoolSource, /buildPlanPoolExtras/);
assert.match(readFileSync("public/bm-plan-pool.js", "utf8"), /shared\/domain\/blackmarket\/bm-plan-pool/);
assert.match(clientSource, /bm-plan-pool/);
assert.match(clientSource, /buildBmListEntry/);
assert.match(clientSource, /bmSelectionConflicts/);

const openingEngine = readFileSync("shared/domain/jade/jade-opening-engine.js", "utf8");
assert.match(openingEngine, /export function evaluateLeftoverMaterial/);
assert.match(readFileSync("public/jade-opening-engine.js", "utf8"), /shared\/domain\/jade\/jade-opening-engine/);

// Persisted-reference recovery: orphan orders/stalls must not keep money or items stuck.
reset();
const recoveryBuyer = installPlayer("bm-recovery-buyer", 800);
const recoverySeller = installPlayer("bm-recovery-seller", 100);
const pendingHeld = makeRough("recovery-held", "恢复托管料");
const missingSellerPending = {
  id: "recovery-pending",
  buyerId: recoveryBuyer.id,
  sellerId: "missing-seller",
  title: "失联待接单",
  price: 200,
  status: "pending",
  heldItem: { type: "rough", item: pendingHeld },
  feeReleased: 0,
  feeRefunded: 0
};
const orphanEscrowItem = {
  ...makeRough("recovery-orphan-escrow", "失联买家委托料"),
  escrowOrderId: "recovery-escrow",
  escrowFromBuyerId: "missing-buyer"
};
recoverySeller.rough.push(orphanEscrowItem);
const missingBuyerEscrow = {
  id: "recovery-escrow",
  buyerId: "missing-buyer",
  sellerId: recoverySeller.id,
  title: "失联托管单",
  price: 250,
  status: "escrow",
  heldItem: null,
  feeReleased: 0,
  feeRefunded: 0
};
const orphanEscrowJobItem = {
  ...makeRough("recovery-orphan-job", "加工中的失联委托料"),
  escrowOrderId: "recovery-job",
  escrowFromBuyerId: "missing-job-buyer"
};
recoverySeller.jobs.push({ id: "recovery-workshop-job", item: orphanEscrowJobItem });
const missingBuyerJob = {
  id: "recovery-job",
  buyerId: "missing-job-buyer",
  sellerId: recoverySeller.id,
  title: "失联加工任务",
  price: 260,
  status: "escrow",
  heldItem: null,
  feeReleased: 0,
  feeRefunded: 0
};
const missingBuyerDelivered = {
  id: "recovery-delivered",
  buyerId: "missing-delivered-buyer",
  sellerId: recoverySeller.id,
  title: "已交付恢复单",
  price: 300,
  status: "delivered",
  feeReleased: 0,
  feeRefunded: 0
};
const validOrder = {
  id: "recovery-valid",
  buyerId: recoveryBuyer.id,
  sellerId: recoverySeller.id,
  title: "有效订单",
  price: 10,
  status: "pending",
  heldItem: { type: "rough", item: makeRough("valid-held") },
  feeReleased: 0,
  feeRefunded: 0
};
H.state.blackServiceOrders.push(
  missingSellerPending,
  missingBuyerEscrow,
  missingBuyerJob,
  missingBuyerDelivered,
  validOrder
);
H.state.blackListings.push(
  {
    id: "legacy-returnable-listing",
    ownerId: recoveryBuyer.id,
    type: "bracelet",
    item: makeBracelet("legacy-returned-item")
  },
  {
    id: "legacy-orphan-listing",
    ownerId: "missing-legacy-owner",
    type: "bracelet",
    item: makeBracelet("legacy-orphan-item")
  }
);
H.state.blackStalls.push(
  {
    id: "orphan-blind-stall",
    ownerId: "missing-blind-seller",
    title: "失联盲盒",
    type: "blindbox",
    status: "open",
    pool: [],
    blindDraw: {
      id: "orphan-draw",
      buyerId: recoveryBuyer.id,
      price: 80,
      entryPaid: true,
      candidates: [{ type: "bracelet", item: makeBracelet("recovered-blind-item") }]
    }
  },
  {
    id: "orphan-empty-blind-stall",
    ownerId: "missing-empty-blind-seller",
    title: "空抽选失联盲盒",
    type: "blindbox",
    status: "open",
    pool: [],
    blindDraw: {
      id: "orphan-empty-draw",
      buyerId: recoveryBuyer.id,
      price: 90,
      entryPaid: true,
      candidates: []
    }
  },
  {
    id: "valid-stall",
    ownerId: recoverySeller.id,
    title: "有效摊位",
    type: "goods",
    status: "setup",
    items: []
  }
);
const recoveryCashBefore = recoveryBuyer.cash;
const recoverySellerCashBefore = recoverySeller.cash;
const recoveredRefs = H.reconcileBlackmarketReferences(H.state, 123456);
assert.equal(recoveredRefs.changed, true);
assert.equal(recoveredRefs.orphanOrders, 4);
assert.equal(recoveredRefs.orphanStalls, 2);
assert.equal(recoveredRefs.refundedFees, 200);
assert.equal(recoveredRefs.releasedFees, 300);
assert.equal(recoveredRefs.recoveredBlindItems, 1);
assert.equal(recoveredRefs.refundedBlindFees, 90);
assert.equal(recoveredRefs.discardedItems, 2);
assert.equal(recoveredRefs.legacyListings, 2);
assert.equal(recoveredRefs.recoveredLegacyItems, 1);
assert.equal(recoveredRefs.discardedLegacyListings, 1);
assert.equal(missingSellerPending.status, "cancelled");
assert.equal(missingSellerPending.submitMode, "recovered_missing_seller");
assert.equal(recoveryBuyer.cash, recoveryCashBefore + 290, "orphan fees should be refunded once");
assert.ok(recoveryBuyer.rough.some((row) => row.id === pendingHeld.id), "held item should return to buyer");
assert.ok(recoveryBuyer.bracelets.some((row) => row.id === "recovered-blind-item"), "paid blind draw keeps its first item");
assert.ok(recoveryBuyer.bracelets.some((row) => row.id === "legacy-returned-item"), "legacy hidden listing returns to owner inventory");
assert.equal(H.state.blackListings.length, 0, "obsolete legacy listing storage should be drained");
assert.equal(missingBuyerEscrow.status, "cancelled");
assert.equal(recoverySeller.rough.some((row) => row.id === orphanEscrowItem.id), false, "missing buyer escrow must not remain in seller inventory");
assert.equal(recoverySeller.jobs.some((job) => job.id === "recovery-workshop-job"), false, "missing buyer escrow job must be released");
assert.equal(missingBuyerDelivered.status, "completed");
assert.equal(missingBuyerDelivered.completedAt, 123456);
assert.equal(recoverySeller.cash, recoverySellerCashBefore + 300, "delivered work still pays existing seller");
assert.equal(validOrder.status, "pending", "valid player references must remain untouched");
assert.ok(H.state.blackStalls.some((row) => row.id === "valid-stall"));
assert.equal(H.state.blackStalls.some((row) => row.id === "orphan-blind-stall"), false);
assert.equal(H.state.blackStalls.some((row) => row.id === "orphan-empty-blind-stall"), false);
assert.equal(H.reconcileBlackmarketReferences(H.state, 123457).changed, false, "recovery should be idempotent");

// A failed buyer inventory write must undo cash, seller credit, ratings and stall stock.
reset();
const atomicBmSeller = installPlayer("atomic-bm-seller", 5_000);
const atomicBmBuyer = installPlayer("atomic-bm-buyer", 10_000);
H.state.blackStalls.push({
  id: "atomic-bm-stall",
  ownerId: atomicBmSeller.id,
  ownerName: atomicBmSeller.name,
  title: "原子货摊",
  type: "goods",
  status: "open",
  items: [{
    id: "atomic-bm-listing",
    type: "bracelet",
    item: makeBracelet("atomic-bm-item"),
    price: 500
  }]
});
const atomicBmBefore = {
  buyer: structuredClone(atomicBmBuyer),
  seller: structuredClone(atomicBmSeller),
  stalls: structuredClone(H.state.blackStalls),
  news: structuredClone(H.state.news)
};
bindBlackmarketApi({
  getState: () => H.state,
  money: (value) => Math.max(0, Math.round(Number(value) || 0)),
  uiMoney: (value) => `¥${value}`,
  spendCash: H.spendCash,
  earnCash: H.earnCash,
  addItem: () => { throw new Error("injected blackmarket inventory failure"); },
  addNews: H.addNews,
  randomUUID: () => "atomic-bm-rating",
  notifyPlayerToast: () => {}
});
const atomicBmFailure = buyGoodsFromStallForPlayer(
  atomicBmBuyer,
  "atomic-bm-stall",
  "atomic-bm-listing"
);
assert.equal(atomicBmFailure.ok, false);
assert.equal(atomicBmFailure.code, "TRANSACTION_ABORTED");
assert.deepEqual(atomicBmBuyer, atomicBmBefore.buyer);
assert.deepEqual(atomicBmSeller, atomicBmBefore.seller);
assert.deepEqual(H.state.blackStalls, atomicBmBefore.stalls);
assert.deepEqual(H.state.news, atomicBmBefore.news);

console.log("blackmarket-service-smoke: ok");
process.exit(0);
