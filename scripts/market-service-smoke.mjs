import { buyListingForPlayer } from "../server/services/market-service.js";
import { readTradingServiceSource } from "./load-trading-service-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import {
  MARKET_LISTING_GLOBAL_CAP,
  MARKET_LISTING_PER_PLAYER_CAP,
  MARKET_TAX,
  bindMarketApi,
  collectMarketPayoutForPlayer
} from "../server/services/market-service.js";

function reset() {
  H.state.players.clear();
  H.state.sockets.clear();
  H.state.roughPool.length = 0;
  H.state.listings.length = 0;
  H.state.wants.length = 0;
  H.state.news.length = 0;
  H.state.auction = null;
  H.state.latestAuctionResults = [];
  H.state.auctionHistory = [];
}

function installPlayer(id, cash) {
  const player = H.makePlayer(id);
  H.normalizePlayer(player);
  player.id = id;
  player.cash = cash;
  player.achievementPoints = Math.max(Number(player.achievementPoints) || 0, 100);
  player.achievementPointsBonus = Math.max(Number(player.achievementPointsBonus) || 0, 100);
  H.state.players.set(id, player);
  return player;
}

reset();
assert.equal(MARKET_TAX, 0.02);
assert.equal(MARKET_LISTING_PER_PLAYER_CAP, 10);
assert.equal(MARKET_LISTING_GLOBAL_CAP, 80);
assert.equal(H.wantEscrowAmountForBudget(10000), 10200);
assert.equal(typeof H.settleWantInternal, "function");
assert.equal(typeof H.processExpiredWants, "function");
assert.equal(typeof H.listItemForPlayer, "function");
assert.equal(typeof H.buyListingForPlayer, "function");

const seller = installPlayer("mkt-seller", 5000);
const buyer = installPlayer("mkt-buyer", 50000);
const item = {
  id: "bracelet-m1",
  type: "bracelet",
  name: "测试镯",
  value: 2000,
  materialStage: "finished",
  score: 3
};
seller.bracelets.push({ ...item });

const listResult = H.listItemForPlayer(seller, { type: "bracelet", itemId: item.id, price: 2500 });
assert.equal(listResult.ok, true, listResult.message);
assert.equal(H.state.listings.length, 1);
assert.equal(seller.bracelets.find((b) => b.id === item.id), undefined);

const sellerCashBeforeTrade = seller.cash;
const buyResult = H.buyListingForPlayer(buyer, H.state.listings[0].id);
assert.equal(buyResult.ok, true, buyResult.message);
assert.equal(H.state.listings.length, 0);
assert.ok(buyer.bracelets.some((b) => b.id === item.id));
assert.ok(buyer.cash < 50000);

assert.equal(seller.cash, sellerCashBeforeTrade + 2500);
assert.deepEqual(seller.payouts, []);
// Older deferred proceeds are still claimable once, including on reconnect.
seller.payouts = [{ id: "legacy-payout", amount: 2500 }];
const sellerCashBeforePayout = seller.cash;
const payoutResult = collectMarketPayoutForPlayer(seller);
assert.equal(payoutResult.ok, true, payoutResult.message);
assert.equal(payoutResult.total, 2500);
assert.equal(seller.cash, sellerCashBeforePayout + 2500);
assert.deepEqual(seller.payouts, []);

seller.payouts = [{ id: "bad-payout", amount: Infinity }];
const sellerCashBeforeInvalidPayout = seller.cash;
const invalidPayoutResult = collectMarketPayoutForPlayer(seller);
assert.equal(invalidPayoutResult.ok, false);
assert.equal(invalidPayoutResult.code, "INVALID_PAYOUT");
assert.equal(seller.cash, sellerCashBeforeInvalidPayout);
assert.equal(seller.payouts.length, 1, "invalid payout rows must remain recoverable");
seller.payouts = [];

const staleBuyerCash = buyer.cash;
H.state.listings.push({
  id: "stale-buy-listing",
  ownerId: "missing-live-seller",
  ownerName: "失效卖家",
  type: "bracelet",
  item: { ...item, id: "stale-buy-item" },
  price: 500,
  createdAt: Date.now()
});
const staleBuy = H.buyListingForPlayer(buyer, "stale-buy-listing");
assert.equal(staleBuy.ok, false);
assert.equal(staleBuy.code, "STALE_LISTING");
assert.equal(buyer.cash, staleBuyerCash, "stale listing must be rejected before charging buyer");
assert.equal(H.state.listings.some((entry) => entry.id === "stale-buy-listing"), false);
assert.equal(buyer.bracelets.some((entry) => entry.id === "stale-buy-item"), false);

H.state.listings.push(...Array.from({ length: MARKET_LISTING_PER_PLAYER_CAP }, (_, index) => ({
  id: `seller-cap-${index}`,
  ownerId: seller.id,
  item: { id: `seller-cap-item-${index}`, type: "bracelet", name: "栏位占位", value: 100 },
  type: "bracelet",
  price: 100,
  createdAt: Date.now()
})));
const perPlayerPreserved = { ...item, id: "preserved-on-player-cap" };
seller.bracelets.push(perPlayerPreserved);
const playerFullResult = H.listItemForPlayer(seller, {
  type: "bracelet",
  itemId: perPlayerPreserved.id,
  price: 500
});
assert.equal(playerFullResult.ok, false);
assert.equal(playerFullResult.code, "PLAYER_MARKET_FULL");
assert.ok(seller.bracelets.some((entry) => entry.id === perPlayerPreserved.id));
H.state.listings.length = 0;

H.state.listings.push(...Array.from({ length: MARKET_LISTING_GLOBAL_CAP }, (_, index) => ({
  id: `full-${index}`,
  ownerId: buyer.id,
  item: { id: `full-item-${index}`, type: "bracelet", name: "占位货品", value: 100 },
  type: "bracelet",
  price: 100,
  createdAt: Date.now()
})));
const preserved = { ...item, id: "preserved-on-full" };
seller.bracelets.push(preserved);
const fullResult = H.listItemForPlayer(seller, {
  type: "bracelet",
  itemId: preserved.id,
  price: 500
});
assert.equal(fullResult.ok, false);
assert.equal(fullResult.code, "MARKET_FULL");
assert.ok(seller.bracelets.some((entry) => entry.id === preserved.id), "full market must not swallow inventory");

H.state.listings.length = 0;
H.state.wants.length = 0;
H.state.listings.push({
  id: "orphan-listing",
  ownerId: "missing-seller",
  type: "bracelet",
  item: { id: "orphan-item", type: "bracelet", name: "孤立货品" },
  price: 500
});
const returnedOfferItem = { ...item, id: "returned-orphan-want-offer" };
H.state.wants.push({
  id: "orphan-want",
  ownerId: "missing-buyer",
  title: "孤立求购",
  status: "open",
  offers: [{
    id: "returnable-offer",
    sellerId: seller.id,
    type: "bracelet",
    item: returnedOfferItem,
    price: 500
  }]
});
H.state.wants.push({
  id: "interrupted-want",
  ownerId: buyer.id,
  title: "中断求购",
  status: "settling",
  offers: [{
    id: "orphan-offer",
    sellerId: "missing-seller",
    type: "bracelet",
    item: { ...item, id: "unowned-offer-item" },
    price: 500
  }]
});
const marketRepair = H.reconcileMarketReferences();
assert.equal(marketRepair.changed, true);
assert.equal(marketRepair.orphanListings, 1);
assert.equal(marketRepair.orphanWants, 1);
assert.equal(marketRepair.orphanOffers, 1);
assert.equal(marketRepair.reopenedWants, 1);
assert.equal(H.state.listings.length, 0);
assert.ok(seller.bracelets.some((entry) => entry.id === returnedOfferItem.id));
assert.equal(H.state.wants.length, 1);
assert.equal(H.state.wants[0].status, "open");
assert.deepEqual(H.state.wants[0].offers, []);

// A downstream inventory failure must roll back both players and the listing.
H.state.listings.length = 0;
H.state.news.length = 0;
const atomicSeller = installPlayer("atomic-market-seller", 7_000);
const atomicBuyer = installPlayer("atomic-market-buyer", 20_000);
const atomicItem = { ...item, id: "atomic-market-item" };
H.state.listings.push({
  id: "atomic-market-listing",
  ownerId: atomicSeller.id,
  ownerName: atomicSeller.name,
  type: "bracelet",
  item: atomicItem,
  price: 2_000,
  createdAt: Date.now()
});
const atomicBefore = {
  buyerCash: atomicBuyer.cash,
  sellerCash: atomicSeller.cash,
  sellerPayouts: structuredClone(atomicSeller.payouts),
  sellerStats: structuredClone(atomicSeller.stats),
  news: structuredClone(H.state.news)
};
bindMarketApi({
  getState: () => H.state,
  money: (value) => Math.max(0, Math.round(Number(value) || 0)),
  spendCash: H.spendCash,
  earnCash: H.earnCash,
  randomUUID: () => "atomic-payout-id",
  addItem: () => { throw new Error("injected addItem failure"); },
  advanceTask: H.advanceTask,
  addNews: H.addNews
});
const atomicFailure = buyListingForPlayer(atomicBuyer, "atomic-market-listing");
assert.equal(atomicFailure.ok, false);
assert.equal(atomicFailure.code, "TRANSACTION_ABORTED");
assert.equal(atomicBuyer.cash, atomicBefore.buyerCash, "failed transfer must refund buyer cash");
assert.equal(atomicSeller.cash, atomicBefore.sellerCash, "failed transfer must restore seller cash");
assert.deepEqual(atomicSeller.payouts, atomicBefore.sellerPayouts, "failed transfer must remove seller payout");
assert.deepEqual(atomicSeller.stats, atomicBefore.sellerStats, "failed transfer must restore seller progression");
assert.deepEqual(H.state.news, atomicBefore.news, "failed transfer must not publish trade news");
assert.equal(H.state.listings[0]?.id, "atomic-market-listing", "failed transfer must keep listing escrowed");
assert.equal(atomicBuyer.bracelets.some((entry) => entry.id === atomicItem.id), false);

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /from "\.\.\/services\/market-service\.js"/);
assert.match(bootSource, /bindMarketApi\(/);
assert.doesNotMatch(bootSource, /function settleWantInternal\(/);
assert.doesNotMatch(bootSource, /function wantEscrowAmountForBudget\(/);

const serviceSource = readTradingServiceSource("market-service.js");
assert.match(serviceSource, /export function listItemForPlayer/);
assert.match(serviceSource, /export function postWantForPlayer/);

console.log("market-service-smoke: ok");
process.exit(0);
