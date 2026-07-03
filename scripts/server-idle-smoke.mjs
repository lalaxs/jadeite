import assert from "node:assert/strict";
import { __testHooks } from "../server.js";

const {
  makePlayer,
  normalizePlayer,
  spendCash,
  earnCash,
  settleOfflinePlayer,
  settleAuctionIfDue,
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

resetState();

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

console.log("Server idle behavior checks passed");
