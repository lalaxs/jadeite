import assert from "node:assert/strict";
import {
  MARKET_LIQUIDITY_MAX_PURCHASES,
  MARKET_LIQUIDITY_STALE_MS,
  MARKET_LIQUIDITY_VALUE_RATE,
  createMarketLiquidityService,
  marketMakerOffer,
  remainingMarketLiquidity, bookMarketLiquidity
} from "../server/services/market-liquidity-service.js";

assert.equal(MARKET_LIQUIDITY_STALE_MS, 10 * 60 * 1000);
assert.equal(MARKET_LIQUIDITY_VALUE_RATE, 0.65);
assert.equal(MARKET_LIQUIDITY_MAX_PURCHASES, 2);

const seller = { id: "seller", name: "卖家", payouts: [], soldCount: 0 };
const listing = {
  id: "listing-1",
  ownerId: seller.id,
  price: 2_000,
  createdAt: 1_000,
  item: { id: "item-1", name: "测试成品", type: "bracelet", value: 4_000 }
};
const state = {
  players: new Map([[seller.id, seller]]),
  sockets: new Map(),
  listings: [listing],
  news: []
};
const money = (value) => Math.max(0, Math.round(Number(value) || 0));
const service = createMarketLiquidityService({
  getState: () => state,
  money,
  itemValue: (item) => item.value,
  randomUUID: () => "payout-1",
  addNews: (text) => state.news.push(text),
  refreshPlayerReport() {}
});

assert.equal(marketMakerOffer(listing, { money, itemValue: (item) => item.value }), 2_000);
assert.equal(
  marketMakerOffer({ ...listing, price: 9_000 }, { money, itemValue: (item) => item.value }),
  2_600
);
assert.equal(service.processMarketLiquidity(1_000 + MARKET_LIQUIDITY_STALE_MS - 1).changed, false);
const result = service.processMarketLiquidity(1_000 + MARKET_LIQUIDITY_STALE_MS);
assert.equal(result.changed, true);
assert.equal(state.listings.length, 1, "quotes must not consume stock without seller acceptance");
assert.equal(state.listings[0].npcOffer.amount, 2_000);
assert.equal(seller.payouts.length, 0);
state.listings.length = 0;

state.sockets.set("s1", "p1");
state.sockets.set("s2", "p2");
state.sockets.set("s3", "p3");
state.listings.push({ ...listing, id: "listing-2" });
assert.equal(service.processMarketLiquidity(2_000 + MARKET_LIQUIDITY_STALE_MS).changed, false);
assert.equal(state.listings.length, 1);

state.listings = [1, 2, 3].map((i) => ({ ...listing, id: `finished-${i}`, price: 9_000,
  npcOffer: undefined, item: { ...listing.item, materialStage: "finished" } }));
const quoteAt = 3_000 + MARKET_LIQUIDITY_STALE_MS;
assert.equal(service.processMarketLiquidity(quoteAt).purchases.length, 2,
  "finished products must receive quotes with three players online");
assert.equal(service.processMarketLiquidity(quoteAt).purchases.length, 0,
  "outstanding offers reserve the daily budget; a smaller remainder must not discount the next item");
assert.equal(state.listings[2].npcOffer, undefined);
bookMarketLiquidity(seller, 2_600, quoteAt);
assert.deepEqual(remainingMarketLiquidity(structuredClone(seller), quoteAt), { cash: 3400, count: 3 });
assert.deepEqual(remainingMarketLiquidity(seller, quoteAt + 86_400_000), { cash: 6000, count: 4 });
console.log("market-liquidity-service-smoke: low-population stocks, finished products, reserved quota and daily reset ok");
