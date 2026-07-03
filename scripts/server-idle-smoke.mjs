import assert from "node:assert/strict";
import { __testHooks } from "../server.js";

const {
  makePlayer,
  normalizePlayer,
  spendCash,
  earnCash,
  settleOfflinePlayer,
  submitAuctionBidForPlayer,
  settleAuctionIfDue,
  snapshotFor,
  processPolishingJobs,
  playerSocketCount,
  isPlayerOnline,
  state
} = __testHooks;

function resetState() {
  state.players.clear();
  state.sockets.clear();
  state.roughPool.length = 0;
  state.listings.length = 0;
  state.news.length = 0;
  state.auction = null;
}

function testRough(id = "rough-1") {
  return {
    id,
    type: "rough",
    name: "测试木那料",
    price: 12000,
    mass: 1.6,
    trueQualityKey: "icy",
    visual: { seed: 7, vein: "#58a984", skin: "#6f756b" },
    windows: []
  };
}

function auctionRough(id, overrides = {}) {
  return {
    ...testRough(id),
    price: 12000,
    trueValue: 7000,
    value: 7000,
    ...overrides
  };
}

function makeAuctionRound(roughs, overrides = {}) {
  state.roughPool.push(...roughs);
  state.auction = {
    id: overrides.id || `round-${roughs[0]?.id || "empty"}`,
    status: "bidding",
    startsAt: 1_000,
    biddingEndsAt: 2_000,
    settlesAt: 2_000,
    roughs,
    bids: [],
    results: [],
    ...overrides
  };
  return state.auction;
}

resetState();

assert.equal(typeof submitAuctionBidForPlayer, "function", "submitAuctionBidForPlayer should be testable");
assert.equal(typeof snapshotFor, "function", "snapshotFor should be testable");

const cashPlayer = makePlayer("cash-player");
normalizePlayer(cashPlayer);
assert.equal(cashPlayer.cash, 30000);

assert.equal(spendCash(cashPlayer, 10000, "公盘测试", { source: "auction", itemId: "auction-1", at: 100 }), true);
assert.equal(earnCash(cashPlayer, 15000, "直播测试", { source: "livestream", itemId: "live-1", at: 200 }), 15000);
assert.equal(cashPlayer.cash, 35000);
assert.equal(cashPlayer.ledger.length, 2);
assert.equal(cashPlayer.ledger[0].amount, 15000);
assert.equal(cashPlayer.ledger[1].amount, -10000);
assert.equal(cashPlayer.rep, 20);
assert.equal(cashPlayer.reports[0].income, 15000);
assert.equal(cashPlayer.reports[0].expense, 10000);
assert.equal(cashPlayer.reports[0].net, 5000);

const offlinePlayer = makePlayer("offline-player");
normalizePlayer(offlinePlayer);
const offlineNow = 10_000;
offlinePlayer.lastSeenAt = 4_000;
offlinePlayer.polishingJobs.push({
  id: "offline-job",
  rough: testRough("offline-rough"),
  readyAt: 7_000,
  startedAt: 2_000
});

const offlineEvents = settleOfflinePlayer(offlinePlayer, offlineNow);
assert.equal(offlineEvents.length, 1);
assert.equal(offlinePlayer.polishingJobs.length, 0);
assert.equal(offlinePlayer.rough.length, 1);
assert.equal(offlinePlayer.offlineSummary.count, 1);
assert.equal(offlinePlayer.lastSeenAt, offlineNow);
assert.equal(offlinePlayer.reports.length, 1);

const duplicateEvents = settleOfflinePlayer(offlinePlayer, offlineNow + 1);
assert.equal(duplicateEvents.length, 0);
assert.equal(offlinePlayer.rough.length, 1);
assert.equal(offlinePlayer.offlineSummary, null);

const realtimePlayer = makePlayer("realtime-player");
normalizePlayer(realtimePlayer);
realtimePlayer.polishingJobs.push({
  id: "realtime-job",
  rough: testRough("realtime-rough"),
  readyAt: Date.now() - 1,
  startedAt: Date.now() - 500
});
state.players.set(realtimePlayer.id, realtimePlayer);

processPolishingJobs();
assert.equal(realtimePlayer.polishingJobs.length, 1);
assert.equal(realtimePlayer.rough.length, 0);

state.sockets.set("socket-a", realtimePlayer.id);
state.sockets.set("socket-b", realtimePlayer.id);
assert.equal(playerSocketCount(realtimePlayer.id), 2);
assert.equal(isPlayerOnline(realtimePlayer), true);

processPolishingJobs();
assert.equal(realtimePlayer.polishingJobs.length, 0);
assert.equal(realtimePlayer.rough.length, 1);

resetState();

const aiWonRough = { ...testRough("ai-won-rough"), trueValue: 30000, value: 30000 };
state.roughPool.push(aiWonRough);
state.auction = {
  id: "ai-round",
  status: "bidding",
  startsAt: 1_000,
  biddingEndsAt: 2_000,
  settlesAt: 2_000,
  roughs: [aiWonRough],
  bids: [],
  results: []
};

assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(state.auction.results[0].status, "aiWon");
assert.equal(state.roughPool.some((rough) => rough.id === aiWonRough.id), false);

resetState();

const depositPlayer = makePlayer("deposit-player");
normalizePlayer(depositPlayer);
depositPlayer.cash = 100000;
state.players.set(depositPlayer.id, depositPlayer);
const depositRough = auctionRough("deposit-rough", { price: 1000, trueValue: 1000, value: 1000 });
makeAuctionRound([depositRough]);

let bidResult = submitAuctionBidForPlayer(depositPlayer, { roughId: depositRough.id, amount: 60000, proxyMax: 60000 }, 1_200);
assert.equal(bidResult.ok, true);
assert.equal(depositPlayer.rep, 0);
assert.equal(depositPlayer.cash, 88000);
bidResult = submitAuctionBidForPlayer(depositPlayer, { roughId: depositRough.id, amount: 1000, proxyMax: 1000 }, 1_300);
assert.equal(bidResult.ok, true);
assert.equal(depositPlayer.rep, 0);
assert.equal(depositPlayer.cash, 99800);

resetState();

const closedPlayer = makePlayer("closed-bid-player");
normalizePlayer(closedPlayer);
closedPlayer.cash = 100000;
state.players.set(closedPlayer.id, closedPlayer);
const closedRough = auctionRough("closed-rough", { price: 1000, trueValue: 1000, value: 1000 });
makeAuctionRound([closedRough]);
const cashAfterClose = closedPlayer.cash;
const bidsAfterClose = state.auction.bids.filter((bid) => bid.playerId === closedPlayer.id).length;
bidResult = submitAuctionBidForPlayer(closedPlayer, { roughId: closedRough.id, amount: 5000, proxyMax: 5000 }, 2_000);
assert.equal(bidResult.ok, false);
assert.equal(closedPlayer.cash, cashAfterClose);
assert.equal(closedPlayer.rep, 0);
assert.equal(state.auction.bids.filter((bid) => bid.playerId === closedPlayer.id).length, bidsAfterClose);

bidResult = submitAuctionBidForPlayer(closedPlayer, null, 2_100);
assert.equal(bidResult.ok, false);
assert.equal(closedPlayer.cash, cashAfterClose);

resetState();

const settledRejectPlayer = makePlayer("settled-reject-player");
normalizePlayer(settledRejectPlayer);
settledRejectPlayer.cash = 100000;
state.players.set(settledRejectPlayer.id, settledRejectPlayer);
const settledRejectRough = auctionRough("settled-reject-rough");
makeAuctionRound([settledRejectRough], { status: "settled", settledAt: 2_000, results: [{ roughId: settledRejectRough.id, status: "passed", price: 0, bids: 0 }] });
bidResult = submitAuctionBidForPlayer(settledRejectPlayer, { roughId: settledRejectRough.id, amount: 14000 }, 2_100);
assert.equal(bidResult.ok, false);
assert.equal(state.auction.bids.length, 0);
assert.equal(settledRejectPlayer.cash, 100000);

resetState();

const successPlayer = makePlayer("auction-success-player");
normalizePlayer(successPlayer);
successPlayer.cash = 50000;
state.players.set(successPlayer.id, successPlayer);
const successRough = auctionRough("success-rough", { price: 12000, trueValue: 7000, value: 7000 });
makeAuctionRound([successRough]);
bidResult = submitAuctionBidForPlayer(successPlayer, { roughId: successRough.id, amount: 14000, proxyMax: 16000 }, 1_200);
assert.equal(bidResult.ok, true);
assert.equal(successPlayer.cash, 47200);
assert.equal(successPlayer.rep, 0);
assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(state.auction.results[0].status, "won");
assert.equal(successPlayer.rough.some((rough) => rough.id === successRough.id), true);
assert.equal(state.roughPool.some((rough) => rough.id === successRough.id), false);
assert.equal(successPlayer.cash, 50000 - state.auction.results[0].price);

resetState();

const shortPlayer = makePlayer("short-tail-player");
normalizePlayer(shortPlayer);
shortPlayer.cash = 5000;
state.players.set(shortPlayer.id, shortPlayer);
const shortRough = auctionRough("short-tail-rough", { price: 20000, trueValue: 1000, value: 1000 });
makeAuctionRound([shortRough]);
bidResult = submitAuctionBidForPlayer(shortPlayer, { roughId: shortRough.id, amount: 20000, proxyMax: 20000 }, 1_200);
assert.equal(bidResult.ok, true);
assert.equal(shortPlayer.cash, 1000);
assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(state.auction.results[0].status, "passed");
assert.equal(shortPlayer.rough.some((rough) => rough.id === shortRough.id), false);
assert.equal(state.roughPool.some((rough) => rough.id === shortRough.id), true);

resetState();

const snapshotPlayer = makePlayer("snapshot-player");
normalizePlayer(snapshotPlayer);
state.players.set(snapshotPlayer.id, snapshotPlayer);
const snapshotRough = auctionRough("snapshot-rough", { price: 10000, trueValue: 1000, value: 1000 });
makeAuctionRound([snapshotRough], { biddingEndsAt: Date.now() - 1, settlesAt: Date.now() - 1 });
const snapshot = snapshotFor(snapshotPlayer);
assert.notEqual(snapshot.auction.phase === "settled" && state.auction.results.length === 0, true);

resetState();

console.log("Server idle behavior checks passed");
