import { readCommerceClientSource } from "./load-commerce-client-source.mjs";
import { readTradingServiceSource } from "./load-trading-service-source.mjs";
import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFileSync } from "node:fs";
import { WANT_DURATIONS, wantMatchesItem } from "../public/jade-rules.js";
import { __testHooks as H } from "../server.js";

const market = readCommerceClientSource("market");
const mainEntry = readFileSync("public/main.js", "utf8");
const main = readClientShellSource();
const server = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const boot = `${server}\n${wireSource}`;
const marketService = readTradingServiceSource("market-service.js");
const snapshotService = readFileSync("server/services/snapshot-service.js", "utf8");
const socketHandlers = [
  "server/shell/socket-handlers.js",
  "server/shell/commands/commerce-commands.js"
].map((file) => readFileSync(file, "utf8")).join("\n");
const index = readFileSync("public/index.html", "utf8");

assert.equal(market.includes("MARKET_WANTS_SAMPLE"), false, "sample wants should be removed");
assert.equal(market.includes("求购系统开发中"), false, "dev placeholder note should be removed");
assert.match(market, /openMarketWantPost|confirmMarketWantPost|openMarketApplyWant/);
assert.match(market, /价低者得/);
assert.match(market, /冻结|escrow|mwEscrowHint/);
assert.match(market, /mwFormError|setWantPostError/);
assert.match(market, /socketRef\.emit\("postWant"/);
assert.match(market, /register\("(?:postWant|openMarketWantPost|confirmMarketWantPost|cancelWant|settleWant|withdrawWantOffer)"/);
assert.match(market, /socketRef\.emit\("(?:postWant|cancelWant|settleWant|withdrawWantOffer|applyWant)"/);
assert.match(main, /initMarketModule|registerAction/);
assert.match(boot, /state\.wants|settleWantInternal|processExpiredWants/);
assert.match(socketHandlers, /socket\.on\("postWant"/);
assert.match(boot, /wantEscrowAmountForBudget|holdDeposit|releaseWantEscrow/);
assert.match(boot, /from "\.\.\/services\/market-service\.js"/);
assert.match(socketHandlers, /acknowledge\(\{ ok:/);
// Per-viewer offer serialization is covered by snapshot-service-smoke's
// own-cost visibility and counterparty-cost privacy assertions.
assert.match(index, /id="marketWantPostModal"|id="marketWantApplyModal"/);
assert.match(index, /id="mwFormError"/);
assert.match(index, /data-mw-duration="long"|data-mw-rule="manual"/);
assert.match(market, /选此成交|手选|长期收/);
assert.match(marketService, /WANT_RULES|offerId|expiresAt <= 0/);
assert.match(marketService, /征集结束，无有效应征/);

assert.ok(WANT_DURATIONS["10m"].ms === 10 * 60 * 1000);
assert.equal(H.wantEscrowAmountForBudget(10000), 10200);

function bracelet(id, score = 3, price = 8000) {
  return {
    id,
    type: "bracelet",
    kind: "bracelet",
    name: `测试手镯 ${id}`,
    score,
    value: price,
    materialStage: "finished"
  };
}

function installPlayer(id, cash = 30000) {
  const player = H.makePlayer(id);
  H.normalizePlayer(player);
  player.cash = cash;
  player.name = id;
  H.state.players.set(player.id, player);
  return player;
}

H.state.wants.length = 0;

const buyer = installPlayer("want-buyer", 30000);
const sellerLow = installPlayer("want-seller-low", 1000);
const sellerHigh = installPlayer("want-seller-high", 1000);
sellerLow.bracelets.push(bracelet("b-low", 4, 9000));
sellerHigh.bracelets.push(bracelet("b-high", 4, 12000));
const budget = 20000;
const escrow = H.wantEscrowAmountForBudget(budget);
assert.equal(H.holdDeposit(buyer, escrow, "求购冻结测试", { source: "market-want-escrow" }), true);
assert.equal(buyer.cash, 30000 - escrow);

const want = {
  id: "want-1",
  ownerId: buyer.id,
  ownerName: buyer.name,
  title: "求购测试手镯",
  note: "",
  itemTypes: ["bracelet"],
  acceptedKinds: ["bracelet"],
  qualityKey: "",
  minScore: 3,
  budget,
  escrowAmount: escrow,
  durationKey: "10m",
  rule: "lowest",
  status: "open",
  createdAt: Date.now(),
  expiresAt: Date.now() + WANT_DURATIONS["10m"].ms,
  offers: []
};
H.state.wants.push(want);

assert.equal(wantMatchesItem(want, sellerLow.bracelets[0], "bracelet"), true);

want.offers.push({
  id: "offer-high",
  sellerId: sellerHigh.id,
  sellerName: sellerHigh.name,
  type: "bracelet",
  item: sellerHigh.bracelets.pop(),
  price: 12000,
  createdAt: Date.now() - 1000
});
want.offers.push({
  id: "offer-low",
  sellerId: sellerLow.id,
  sellerName: sellerLow.name,
  type: "bracelet",
  item: sellerLow.bracelets.pop(),
  price: 8000,
  createdAt: Date.now()
});

const cashBefore = buyer.cash;
const ok = H.settleWantInternal(want, buyer, { expired: false });
assert.equal(ok.ok, true);
assert.equal(ok.filled, true);
assert.equal(H.state.wants.find((w) => w.id === "want-1"), undefined);
assert.equal(buyer.bracelets.length, 1);
assert.equal(buyer.bracelets[0].id, "b-low");
assert.ok(sellerLow.ledger.some((p) => p.source === "market-payout" && p.amount === 8000));
assert.equal(sellerHigh.bracelets.some((b) => b.id === "b-high"), true, "losing offer returns inventory");
// 8000 + 160 tax = 8160 paid from escrow; refund = escrow - 8160
const paid = 8000 + Math.round(8000 * 0.02);
assert.equal(buyer.cash, cashBefore + (escrow - paid));
// Cancel refunds escrow
H.state.wants.length = 0;
const buyer2 = installPlayer("want-buyer-2", 20000);
const escrow2 = H.wantEscrowAmountForBudget(5000);
assert.equal(H.holdDeposit(buyer2, escrow2, "冻结2", { source: "market-want-escrow" }), true);
const want2 = {
  id: "want-2",
  ownerId: buyer2.id,
  ownerName: buyer2.name,
  title: "撤销退还",
  note: "",
  itemTypes: ["bracelet"],
  acceptedKinds: ["bracelet"],
  qualityKey: "",
  minScore: 1,
  budget: 5000,
  escrowAmount: escrow2,
  durationKey: "30m",
  rule: "lowest",
  status: "open",
  createdAt: Date.now(),
  expiresAt: Date.now() + WANT_DURATIONS["30m"].ms,
  offers: []
};
H.state.wants.push(want2);
const cash2 = buyer2.cash;
const refunded = H.releaseWantEscrow(want2, buyer2, "撤销退还");
assert.equal(refunded, escrow2);
assert.equal(buyer2.cash, cash2 + escrow2);
H.state.wants.length = 0;

// Expired empty closes + refunds escrow
const buyer3 = installPlayer("want-buyer-3", 15000);
const escrow3 = H.wantEscrowAmountForBudget(5000);
H.holdDeposit(buyer3, escrow3, "冻结3", { source: "market-want-escrow" });
const want3 = {
  id: "want-3",
  ownerId: buyer3.id,
  ownerName: buyer3.name,
  title: "到期空单",
  note: "",
  itemTypes: ["material"],
  acceptedKinds: [],
  qualityKey: "",
  minScore: 2,
  budget: 5000,
  escrowAmount: escrow3,
  durationKey: "10m",
  rule: "lowest",
  status: "open",
  createdAt: Date.now() - 1000,
  expiresAt: Date.now() - 1,
  offers: []
};
H.state.wants.push(want3);
const cash3 = buyer3.cash;
assert.equal(H.processExpiredWants(Date.now()), true);
assert.equal(H.state.wants.length, 0);
assert.equal(buyer3.cash, cash3 + escrow3);

// Manual rule: must pick offerId; can pick non-lowest
H.state.wants.length = 0;
const buyer4 = installPlayer("want-buyer-4", 30000);
const sA = installPlayer("want-sa", 0);
const sB = installPlayer("want-sb", 0);
const escrow4 = H.wantEscrowAmountForBudget(20000);
H.holdDeposit(buyer4, escrow4, "冻结4", { source: "market-want-escrow" });
const want4 = {
  id: "want-4",
  ownerId: buyer4.id,
  ownerName: buyer4.name,
  title: "手选测试",
  note: "",
  itemTypes: ["bracelet"],
  acceptedKinds: ["bracelet"],
  qualityKey: "",
  minScore: 1,
  budget: 20000,
  escrowAmount: escrow4,
  durationKey: "1h",
  rule: "manual",
  status: "open",
  createdAt: Date.now(),
  expiresAt: Date.now() + WANT_DURATIONS["1h"].ms,
  offers: [
    {
      id: "oa",
      sellerId: sA.id,
      sellerName: sA.name,
      type: "bracelet",
      item: bracelet("pick-low", 3, 5000),
      price: 5000,
      createdAt: 1
    },
    {
      id: "ob",
      sellerId: sB.id,
      sellerName: sB.name,
      type: "bracelet",
      item: bracelet("pick-high", 3, 9000),
      price: 9000,
      createdAt: 2
    }
  ]
};
H.state.wants.push(want4);
const needPick = H.settleWantInternal(want4, buyer4, { expired: false });
assert.equal(needPick.ok, false);
assert.match(needPick.reason, /选择/);
const picked = H.settleWantInternal(want4, buyer4, { expired: false, offerId: "ob" });
assert.equal(picked.ok, true);
assert.equal(picked.filled, true);
assert.equal(buyer4.bracelets[0].id, "pick-high");
assert.ok(sA.bracelets.some((b) => b.id === "pick-low"));

// Stale lowest offer is removed before escrow settlement; next valid seller wins.
H.state.wants.length = 0;
const buyerStale = installPlayer("want-buyer-stale", 30000);
const sellerStaleFallback = installPlayer("want-seller-fallback", 0);
const staleEscrow = H.wantEscrowAmountForBudget(10000);
H.holdDeposit(buyerStale, staleEscrow, "冻结失效应征测试", { source: "market-want-escrow" });
const staleWant = {
  id: "want-stale-offer",
  ownerId: buyerStale.id,
  ownerName: buyerStale.name,
  title: "失效应征测试",
  note: "",
  itemTypes: ["bracelet"],
  acceptedKinds: ["bracelet"],
  qualityKey: "",
  minScore: 1,
  budget: 10000,
  escrowAmount: staleEscrow,
  durationKey: "10m",
  rule: "lowest",
  status: "open",
  createdAt: Date.now(),
  expiresAt: Date.now() + WANT_DURATIONS["10m"].ms,
  offers: [
    {
      id: "stale-lowest",
      sellerId: "missing-want-seller",
      sellerName: "失效卖家",
      type: "bracelet",
      item: bracelet("stale-want-item", 3, 3000),
      price: 3000,
      createdAt: 1
    },
    {
      id: "valid-fallback",
      sellerId: sellerStaleFallback.id,
      sellerName: sellerStaleFallback.name,
      type: "bracelet",
      item: bracelet("valid-fallback-item", 3, 5000),
      price: 5000,
      createdAt: 2
    }
  ]
};
H.state.wants.push(staleWant);
const staleSettled = H.settleWantInternal(staleWant, buyerStale, { expired: false });
assert.equal(staleSettled.ok, true);
assert.equal(staleSettled.offerId, "valid-fallback");
assert.ok(buyerStale.bracelets.some((item) => item.id === "valid-fallback-item"));
assert.equal(buyerStale.bracelets.some((item) => item.id === "stale-want-item"), false);
assert.ok(sellerStaleFallback.ledger.some((entry) => entry.source === "market-payout" && entry.amount === 5000));

// Long-term never auto-expires
H.state.wants.length = 0;
const buyer5 = installPlayer("want-buyer-5", 20000);
const escrow5 = H.wantEscrowAmountForBudget(3000);
H.holdDeposit(buyer5, escrow5, "冻结5", { source: "market-want-escrow" });
H.state.wants.push({
  id: "want-5",
  ownerId: buyer5.id,
  ownerName: buyer5.name,
  title: "长期收",
  note: "",
  itemTypes: ["bracelet"],
  acceptedKinds: ["bracelet"],
  qualityKey: "",
  minScore: 1,
  budget: 3000,
  escrowAmount: escrow5,
  durationKey: "long",
  rule: "manual",
  status: "open",
  createdAt: Date.now() - 86400000,
  expiresAt: 0,
  offers: []
});
assert.equal(H.processExpiredWants(Date.now()), false);
assert.equal(H.state.wants.length, 1);

console.log("Market want board checks passed");
process.exit(0);
