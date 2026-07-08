import assert from "node:assert/strict";
import { __testHooks } from "../server.js";

const {
  makePlayer,
  normalizePlayer,
  spendCash,
  earnCash,
  settleOfflinePlayer,
  submitAuctionBidForPlayer,
  joinAuctionForPlayer,
  requestAuctionWindowForPlayer,
  ensureAuctionRound,
  settleAuctionIfDue,
  snapshotFor,
  startProductionJob,
  processProductionJobs,
  scheduleLivestream,
  sellLivestreamNow,
  processLivestreamJobs,
  processPolishingJobs,
  playerSocketCount,
  isPlayerOnline,
  revealPolishedRough,
  normalizeExtractionKits,
  expandKitPlacements,
  placementsOverlap,
  refreshPlayerReport,
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

function testProduct(id = "product-1", overrides = {}) {
  return {
    id,
    type: "bracelet",
    kind: "bracelet",
    name: "测试冰种手镯",
    quality: "冰种",
    score: 3,
    color: "晴水",
    value: 10000,
    rep: 20,
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

function makeEmptyPlayer(playerId) {
  const player = makePlayer(playerId);
  player.rough = [];
  player.starterRoughGranted = true;
  return player;
}

resetState();

assert.equal(typeof submitAuctionBidForPlayer, "function", "submitAuctionBidForPlayer should be testable");
assert.equal(typeof joinAuctionForPlayer, "function", "joinAuctionForPlayer should be testable");
assert.equal(typeof requestAuctionWindowForPlayer, "function", "requestAuctionWindowForPlayer should be testable");
assert.equal(typeof snapshotFor, "function", "snapshotFor should be testable");
assert.equal(typeof sellLivestreamNow, "function", "sellLivestreamNow should preserve legacy livestreamSell compatibility");

const starterPlayer = makePlayer("starter-player");
assert.equal(starterPlayer.rough.length, 3);
assert.equal(starterPlayer.starterRoughGranted, true);
assert.equal(new Set(starterPlayer.rough.map((rough) => rough.id)).size, 3);
assert.ok(starterPlayer.rough.every((rough) => rough.type === "rough" && rough.owner === starterPlayer.id && rough.revealed === false));
const starterSnapshot = snapshotFor(starterPlayer, 10);
assert.equal(starterSnapshot.me.rough.length, 3);
assert.equal(Object.hasOwn(starterSnapshot.me.rough[0], "trueValue"), false);
assert.equal(Object.hasOwn(starterSnapshot.me.rough[0], "trueQualityKey"), false);

const existingEmptyPlayer = {
  id: "existing-empty-player",
  name: "旧账号",
  cash: 30000,
  rep: 0,
  satisfaction: 72,
  rough: []
};
normalizePlayer(existingEmptyPlayer);
assert.equal(existingEmptyPlayer.rough.length, 3);
assert.equal(existingEmptyPlayer.starterRoughGranted, true);
existingEmptyPlayer.rough.length = 0;
normalizePlayer(existingEmptyPlayer);
assert.equal(existingEmptyPlayer.rough.length, 0);

resetState();

const uiAuctionPlayer = makeEmptyPlayer("ui-auction-player");
normalizePlayer(uiAuctionPlayer);
state.players.set(uiAuctionPlayer.id, uiAuctionPlayer);
const uiRound = ensureAuctionRound(100_000);
assert.equal(uiRound.status, "registration");
assert.equal(uiRound.startsAt, 400_000);
assert.equal(uiRound.biddingEndsAt, 700_000);
assert.equal(uiRound.settlementEndsAt, 730_000);
const uiAuctionSnapshot = snapshotFor(uiAuctionPlayer, 100_100);
assert.equal(uiAuctionSnapshot.auction.phase, "registration");
assert.equal(uiAuctionSnapshot.auction.registered, false);
assert.equal(uiAuctionSnapshot.auctionHalls.length, 5);
assert.deepEqual(uiAuctionSnapshot.auctionHalls.map((hall) => hall.id), ["novice", "regular", "premium", "special", "legendary"]);
assert.equal(uiAuctionSnapshot.auctionHalls[0].label, "新手公盘");
const joinResult = joinAuctionForPlayer(uiAuctionPlayer, { hallId: "novice" }, 100_200);
assert.equal(joinResult.ok, true);
assert.equal(joinResult.deposit, 5000);
assert.equal(uiAuctionPlayer.cash, 25000);
const joinedAuctionSnapshot = snapshotFor(uiAuctionPlayer, 100_300);
assert.equal(joinedAuctionSnapshot.auction.registered, true);
assert.equal(joinedAuctionSnapshot.auction.registeredCount, 1);
const blockedBid = submitAuctionBidForPlayer(uiAuctionPlayer, {
  roughId: uiRound.roughs[0].id,
  amount: uiRound.roughs[0].price
}, uiRound.startsAt - 1);
assert.equal(blockedBid.ok, false);
assert.match(blockedBid.message, /竞价尚未开始/);

resetState();

const cashPlayer = makeEmptyPlayer("cash-player");
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

const offlinePlayer = makeEmptyPlayer("offline-player");
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

const realtimePlayer = makeEmptyPlayer("realtime-player");
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

const stagedOfflinePlayer = makeEmptyPlayer("staged-offline-player");
normalizePlayer(stagedOfflinePlayer);
stagedOfflinePlayer.lastSeenAt = 4_000;
const stagedOfflineJob = startProductionJob(stagedOfflinePlayer, "rough", testRough("staged-offline-rough"), { label: "粗加工" });
assert.ok(stagedOfflineJob);
stagedOfflineJob.startedAt = 2_000;
stagedOfflineJob.readyAt = 7_000;
const stagedOfflineEvents = settleOfflinePlayer(stagedOfflinePlayer, offlineNow);
assert.equal(stagedOfflineEvents.length, 1);
assert.equal(stagedOfflinePlayer.jobs.length, 0);
assert.equal(stagedOfflinePlayer.rough.length, 1);
assert.equal(stagedOfflinePlayer.rough[0].revealed, true);
assert.equal(stagedOfflinePlayer.offlineSummary.count, 1);

resetState();

const stagedRealtimePlayer = makeEmptyPlayer("staged-realtime-player");
normalizePlayer(stagedRealtimePlayer);
state.players.set(stagedRealtimePlayer.id, stagedRealtimePlayer);
const stagedRealtimeJob = startProductionJob(stagedRealtimePlayer, "rough", testRough("staged-realtime-rough"), { label: "粗加工" });
stagedRealtimeJob.readyAt = Date.now() - 1;
assert.ok(refreshPlayerReport(stagedRealtimePlayer).inventoryValue >= stagedRealtimeJob.item.price);
processProductionJobs();
assert.equal(stagedRealtimePlayer.jobs.length, 1);
assert.equal(stagedRealtimePlayer.rough.length, 0);
state.sockets.set("socket-staged", stagedRealtimePlayer.id);
processProductionJobs();
assert.equal(stagedRealtimePlayer.jobs.length, 0);
assert.equal(stagedRealtimePlayer.rough.length, 1);

resetState();

const refinePlayer = makeEmptyPlayer("refine-player");
normalizePlayer(refinePlayer);
state.players.set(refinePlayer.id, refinePlayer);
state.sockets.set("socket-refine", refinePlayer.id);
const revealedRough = revealPolishedRough(testRough("refine-rough"));
const firstRefineKit = { id: "kit-a", type: "bangle", x: 50, y: 50, ringSize: 56 };
const refineJob = startProductionJob(refinePlayer, "refine", revealedRough, {
  label: "精加工",
  kits: [firstRefineKit]
});
assert.ok(refineJob);
revealedRough.extractionKits = [firstRefineKit];
revealedRough.braceletPlacements = revealedRough.extractionKits;
refineJob.readyAt = Date.now() - 1;
processProductionJobs();
assert.equal(refinePlayer.jobs.length, 0);
assert.equal(refinePlayer.rough.length, 1);
assert.equal(refinePlayer.rough[0].id, revealedRough.id);
assert.equal(refinePlayer.rough[0].extractionKits.length, 1);
assert.equal(refinePlayer.rough[0].braceletPlacements.length, 1);
assert.equal(refinePlayer.bracelets.length, 1);
assert.equal(refinePlayer.bracelets[0].sourceRoughId, revealedRough.id);
assert.equal(refinePlayer.reports.length, 1);
assert.equal(typeof normalizeExtractionKits, "function", "normalizeExtractionKits should be testable");
assert.equal(typeof expandKitPlacements, "function", "expandKitPlacements should be testable");
assert.equal(typeof placementsOverlap, "function", "placementsOverlap should be testable");
const existingVisualKit = { id: "existing-bangle", type: "bangle", x: 50, y: 50, ringSize: 56 };
const distantVisualKit = { id: "distant-cabochon", type: "cabochon", x: 70, y: 50, ringSize: 56 };
assert.equal(
  placementsOverlap(expandKitPlacements(normalizeExtractionKits([existingVisualKit, distantVisualKit]))),
  false,
  "server overlap detection should match the UI-scaled kit footprint"
);
const secondRefineJob = startProductionJob(refinePlayer, "refine", refinePlayer.rough[0], {
  label: "精加工",
  kits: [{ id: "kit-b", type: "cabochon", x: 76, y: 76, ringSize: 56 }]
});
assert.ok(secondRefineJob);
secondRefineJob.readyAt = Date.now() - 1;
processProductionJobs();
assert.equal(refinePlayer.rough.filter((rough) => rough.id === revealedRough.id).length, 1);
assert.equal(refinePlayer.bracelets.length, 2);
assert.equal(refinePlayer.bracelets[1].sourceRoughId, revealedRough.id);

resetState();

const jobPrivacyPlayer = makeEmptyPlayer("job-privacy-player");
normalizePlayer(jobPrivacyPlayer);
state.players.set(jobPrivacyPlayer.id, jobPrivacyPlayer);
const privateJob = startProductionJob(jobPrivacyPlayer, "rough", testRough("private-job-rough"), { label: "粗加工" });
assert.ok(privateJob);
const privateJobSnapshot = snapshotFor(jobPrivacyPlayer);
assert.equal(privateJobSnapshot.me.jobs.length, 1);
assert.equal(Object.hasOwn(privateJobSnapshot.me.jobs[0].item, "trueQualityKey"), false);
assert.equal(Object.hasOwn(privateJobSnapshot.me.jobs[0].item, "trueValue"), false);

resetState();

const livestreamPlayer = makeEmptyPlayer("livestream-player");
normalizePlayer(livestreamPlayer);
state.players.set(livestreamPlayer.id, livestreamPlayer);
const liveProduct = testProduct("live-product");
livestreamPlayer.bracelets.push(liveProduct);
const liveJob = scheduleLivestream(livestreamPlayer, liveProduct.id, "autoBalanced");
assert.ok(liveJob);
assert.equal(livestreamPlayer.bracelets.length, 0);
assert.equal(livestreamPlayer.livestreamJobs.length, 1);
assert.ok(refreshPlayerReport(livestreamPlayer).inventoryValue >= liveProduct.value);
liveJob.readyAt = 1;
processLivestreamJobs(2);
assert.equal(livestreamPlayer.livestreamJobs.length, 1);
assert.equal(livestreamPlayer.ledger.length, 0);
state.sockets.set("socket-live", livestreamPlayer.id);
processLivestreamJobs(2);
assert.equal(livestreamPlayer.livestreamJobs.length, 0);
assert.equal(livestreamPlayer.livestreamHistory.length, 1);
assert.equal(livestreamPlayer.livestreamHistory[0].outcome.sold, true);
assert.equal(livestreamPlayer.ledger[0].source, "livestream");
assert.equal(livestreamPlayer.ledger[0].amount, livestreamPlayer.livestreamHistory[0].outcome.price);

resetState();

const unsoldLivestreamPlayer = makeEmptyPlayer("unsold-livestream-player");
normalizePlayer(unsoldLivestreamPlayer);
state.players.set(unsoldLivestreamPlayer.id, unsoldLivestreamPlayer);
state.sockets.set("socket-unsold-live", unsoldLivestreamPlayer.id);
const unsoldProduct = testProduct("unsold-live-product");
unsoldLivestreamPlayer.bracelets.push(unsoldProduct);
const unsoldLiveJob = scheduleLivestream(unsoldLivestreamPlayer, unsoldProduct.id, "autoBalanced");
unsoldLiveJob.readyAt = 8;
processLivestreamJobs(9);
assert.equal(unsoldLivestreamPlayer.livestreamJobs.length, 0);
assert.equal(unsoldLivestreamPlayer.bracelets.length, 1);
assert.equal(unsoldLivestreamPlayer.bracelets[0].id, unsoldProduct.id);
assert.equal(unsoldLivestreamPlayer.livestreamHistory[0].outcome.sold, false);

resetState();

const offlineLivestreamPlayer = makeEmptyPlayer("offline-livestream-player");
normalizePlayer(offlineLivestreamPlayer);
offlineLivestreamPlayer.lastSeenAt = 4_000;
state.players.set(offlineLivestreamPlayer.id, offlineLivestreamPlayer);
const offlineLiveProduct = testProduct("offline-live-product");
offlineLivestreamPlayer.bracelets.push(offlineLiveProduct);
const offlineLiveJob = scheduleLivestream(offlineLivestreamPlayer, offlineLiveProduct.id, "autoBalanced");
offlineLiveJob.readyAt = 4_500;
const offlineLiveEvents = settleOfflinePlayer(offlineLivestreamPlayer, 5_000);
assert.equal(offlineLiveEvents.length, 1);
assert.equal(offlineLiveEvents[0].type, "livestream");
assert.equal(offlineLivestreamPlayer.livestreamJobs.length, 0);
assert.equal(offlineLivestreamPlayer.livestreamHistory.length, 1);
assert.equal(offlineLivestreamPlayer.offlineSummary.count, 1);
assert.equal(offlineLivestreamPlayer.offlineSummary.income, offlineLiveEvents[0].income);

resetState();

const manualLivestreamPlayer = makeEmptyPlayer("manual-livestream-player");
normalizePlayer(manualLivestreamPlayer);
const manualProduct = testProduct("manual-live-product");
const cashBeforeManualSale = manualLivestreamPlayer.cash;
manualLivestreamPlayer.bracelets.push(manualProduct);
const manualSale = sellLivestreamNow(manualLivestreamPlayer, manualProduct.id, 12);
assert.ok(manualSale);
assert.equal(manualSale.outcome.sold, true);
assert.equal(manualLivestreamPlayer.bracelets.length, 0);
assert.equal(manualLivestreamPlayer.cash, cashBeforeManualSale + manualSale.outcome.price);
assert.equal(manualLivestreamPlayer.ledger[0].source, "livestream");
assert.equal(manualLivestreamPlayer.ledger[0].itemId, manualProduct.id);
assert.equal(manualLivestreamPlayer.livestreamHistory.length, 1);
assert.equal(manualLivestreamPlayer.livestreamHistory[0].outcome.sold, true);

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

const depositPlayer = makeEmptyPlayer("deposit-player");
normalizePlayer(depositPlayer);
depositPlayer.cash = 100000;
state.players.set(depositPlayer.id, depositPlayer);
const depositRough = auctionRough("deposit-rough", { price: 1000, trueValue: 1000, value: 1000 });
makeAuctionRound([depositRough]);

let bidResult = submitAuctionBidForPlayer(depositPlayer, { roughId: depositRough.id, amount: 1000, proxyMax: 60000 }, 1_200);
assert.equal(bidResult.ok, true);
assert.equal(depositPlayer.rep, 0);
assert.equal(depositPlayer.cash, 88000);
assert.equal(state.auction.bids[0].amount, 1000);
assert.equal(state.auction.bids[0].proxyMax, 60000);
assert.equal(snapshotFor(depositPlayer, 1_300).auction.myBids[0].deposit, 12000);
bidResult = submitAuctionBidForPlayer(depositPlayer, { roughId: depositRough.id, amount: 1000, proxyMax: 1000 }, 1_300);
assert.equal(bidResult.ok, true);
assert.equal(depositPlayer.rep, 0);
assert.equal(depositPlayer.cash, 99800);

resetState();

const unaffordableProxyPlayer = makeEmptyPlayer("unaffordable-proxy-player");
normalizePlayer(unaffordableProxyPlayer);
unaffordableProxyPlayer.cash = 30000;
state.players.set(unaffordableProxyPlayer.id, unaffordableProxyPlayer);
const unaffordableProxyRough = auctionRough("unaffordable-proxy-rough", { price: 1000, trueValue: 1000, value: 1000 });
makeAuctionRound([unaffordableProxyRough]);
const cashBeforeUnaffordableProxy = unaffordableProxyPlayer.cash;
bidResult = submitAuctionBidForPlayer(unaffordableProxyPlayer, { roughId: unaffordableProxyRough.id, amount: 1000, proxyMax: 200000 }, 1_200);
assert.equal(bidResult.ok, false);
assert.equal(unaffordableProxyPlayer.cash, cashBeforeUnaffordableProxy);
assert.equal(state.auction.bids.length, 0);

resetState();

const closedPlayer = makeEmptyPlayer("closed-bid-player");
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

const settledRejectPlayer = makeEmptyPlayer("settled-reject-player");
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

const successPlayer = makeEmptyPlayer("auction-success-player");
normalizePlayer(successPlayer);
successPlayer.cash = 50000;
state.players.set(successPlayer.id, successPlayer);
const successRough = auctionRough("success-rough", { price: 12000, trueValue: 7000, value: 7000 });
makeAuctionRound([successRough]);
bidResult = submitAuctionBidForPlayer(successPlayer, { roughId: successRough.id, amount: 14000, proxyMax: 16000 }, 1_200);
assert.equal(bidResult.ok, true);
assert.equal(successPlayer.cash, 46800);
assert.equal(successPlayer.rep, 0);
assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(state.auction.results[0].status, "won");
assert.equal(successPlayer.rough.some((rough) => rough.id === successRough.id), true);
assert.equal(state.roughPool.some((rough) => rough.id === successRough.id), false);
assert.equal(successPlayer.cash, 50000 - state.auction.results[0].price);
assert.ok(successPlayer.reports[0].inventoryValue >= (successRough.value || successRough.price));

resetState();

const surplusDepositPlayer = makeEmptyPlayer("surplus-deposit-player");
normalizePlayer(surplusDepositPlayer);
surplusDepositPlayer.cash = 100000;
state.players.set(surplusDepositPlayer.id, surplusDepositPlayer);
const surplusDepositRough = auctionRough("surplus-deposit-rough", { price: 1000, trueValue: 1000, value: 1000 });
makeAuctionRound([surplusDepositRough]);
bidResult = submitAuctionBidForPlayer(surplusDepositPlayer, { roughId: surplusDepositRough.id, amount: 1000, proxyMax: 100000 }, 1_200);
assert.equal(bidResult.ok, true);
assert.equal(surplusDepositPlayer.cash, 80000);
assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(state.auction.results[0].status, "won");
assert.equal(state.auction.results[0].price, 1000);
assert.equal(state.auction.results[0].depositUsed, 1000);
assert.equal(state.auction.results[0].balanceDue, 0);
assert.equal(surplusDepositPlayer.cash, 99000);

resetState();

const shortPlayer = makeEmptyPlayer("short-tail-player");
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

const lowAiRough = auctionRough("low-ai-rough", { price: 20000, trueValue: 1000, value: 1000 });
makeAuctionRound([lowAiRough]);
assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(state.auction.results[0].status, "passed");
assert.equal(state.auction.results[0].winnerId, undefined);
assert.equal(state.roughPool.some((rough) => rough.id === lowAiRough.id), true);

resetState();

const offlineAuctionWinner = makeEmptyPlayer("offline-auction-winner");
normalizePlayer(offlineAuctionWinner);
offlineAuctionWinner.cash = 50000;
offlineAuctionWinner.lastSeenAt = 1_000;
state.players.set(offlineAuctionWinner.id, offlineAuctionWinner);
const offlineAuctionRough = auctionRough("offline-auction-rough", { price: 1000, trueValue: 1000, value: 1000 });
makeAuctionRound([offlineAuctionRough], { biddingEndsAt: 2_000, settlesAt: 2_000 });
bidResult = submitAuctionBidForPlayer(offlineAuctionWinner, { roughId: offlineAuctionRough.id, amount: 1000, proxyMax: 1000 }, 1_200);
assert.equal(bidResult.ok, true);
const offlineAuctionEvents = settleOfflinePlayer(offlineAuctionWinner, 3_000);
assert.equal(offlineAuctionEvents.length, 1);
assert.equal(offlineAuctionEvents[0].type, "auction");
assert.match(offlineAuctionEvents[0].text, /公盘/);
assert.equal(offlineAuctionWinner.offlineSummary.count, 1);
assert.match(offlineAuctionWinner.offlineSummary.lines[0], /公盘/);
assert.equal(offlineAuctionWinner.rough.some((rough) => rough.id === offlineAuctionRough.id), true);
assert.equal(offlineAuctionWinner.cash, 49000);
const duplicateOfflineAuctionEvents = settleOfflinePlayer(offlineAuctionWinner, 3_001);
assert.equal(duplicateOfflineAuctionEvents.length, 0);
assert.equal(offlineAuctionWinner.offlineSummary, null);

resetState();

const rotatedOfflineAuctionWinner = makeEmptyPlayer("rotated-offline-auction-winner");
normalizePlayer(rotatedOfflineAuctionWinner);
rotatedOfflineAuctionWinner.cash = 50000;
rotatedOfflineAuctionWinner.lastSeenAt = 1_000;
state.players.set(rotatedOfflineAuctionWinner.id, rotatedOfflineAuctionWinner);
const rotatedOfflineAuctionRough = auctionRough("rotated-offline-auction-rough", { price: 1000, trueValue: 1000, value: 1000 });
makeAuctionRound([rotatedOfflineAuctionRough], { biddingEndsAt: 2_000, settlesAt: 2_000 });
bidResult = submitAuctionBidForPlayer(rotatedOfflineAuctionWinner, { roughId: rotatedOfflineAuctionRough.id, amount: 1000, proxyMax: 1000 }, 1_200);
assert.equal(bidResult.ok, true);
assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(rotatedOfflineAuctionWinner.rough.some((rough) => rough.id === rotatedOfflineAuctionRough.id), true);
assert.equal(rotatedOfflineAuctionWinner.cash, 49000);
state.auction = null;
const rotatedOfflineAuctionEvents = settleOfflinePlayer(rotatedOfflineAuctionWinner, 5_000);
assert.equal(rotatedOfflineAuctionEvents.length, 1);
assert.equal(rotatedOfflineAuctionEvents[0].type, "auction");
assert.match(rotatedOfflineAuctionEvents[0].text, /公盘/);
assert.equal(rotatedOfflineAuctionWinner.offlineSummary.count, 1);
assert.match(rotatedOfflineAuctionWinner.offlineSummary.lines[0], /公盘/);
const duplicateRotatedOfflineAuctionEvents = settleOfflinePlayer(rotatedOfflineAuctionWinner, 5_001);
assert.equal(duplicateRotatedOfflineAuctionEvents.length, 0);
assert.equal(rotatedOfflineAuctionWinner.offlineSummary, null);

resetState();

const listedReportPlayer = makeEmptyPlayer("listed-report-player");
normalizePlayer(listedReportPlayer);
const listedReportItem = testProduct("listed-report-product", { value: 15000 });
state.players.set(listedReportPlayer.id, listedReportPlayer);
state.listings.push({
  id: "listed-report-listing",
  ownerId: listedReportPlayer.id,
  ownerName: listedReportPlayer.name,
  type: "bracelet",
  item: listedReportItem,
  price: 20000,
  createdAt: 1_000
});
assert.ok(refreshPlayerReport(listedReportPlayer, 2_000).inventoryValue >= listedReportItem.value);

resetState();

const generatedViewer = makeEmptyPlayer("generated-viewer");
normalizePlayer(generatedViewer);
state.players.set(generatedViewer.id, generatedViewer);
const generatedRound = ensureAuctionRound(50_000);
const generatedIds = generatedRound.roughs.map((rough) => rough.id);
assert.equal(generatedIds.length, 8);
const generatedSnapshot = snapshotFor(generatedViewer, generatedRound.startsAt + 1);
for (const rough of [...generatedSnapshot.roughPool, ...generatedSnapshot.auction.roughs]) {
  assert.equal(Object.hasOwn(rough, "trueValue"), false);
}
assert.equal(settleAuctionIfDue(generatedRound.biddingEndsAt), true);
assert.ok(state.auction.results.some((result) => result.status === "aiWon"));
state.auction = null;
const nextGeneratedRound = ensureAuctionRound(generatedRound.biddingEndsAt + 10_000);
const nextGeneratedIds = nextGeneratedRound.roughs.map((rough) => rough.id);
assert.ok(generatedIds.some((id) => !nextGeneratedIds.includes(id)));

resetState();

const snapshotPlayer = makeEmptyPlayer("snapshot-player");
normalizePlayer(snapshotPlayer);
state.players.set(snapshotPlayer.id, snapshotPlayer);
const snapshotRough = auctionRough("snapshot-rough", { price: 10000, trueValue: 30000, value: 30000 });
makeAuctionRound([snapshotRough], { biddingEndsAt: Date.now() - 1, settlesAt: Date.now() - 1 });
const snapshot = snapshotFor(snapshotPlayer);
assert.notEqual(snapshot.auction.phase === "settlement" && state.auction.results.length === 0, true);
assert.equal(snapshot.auction.phase, "settlement");
assert.equal(state.auction.results[0].status, "aiWon");
assert.equal(snapshot.auction.results[0].status, "aiWon");
assert.equal(snapshot.auction.results[0].winnerId, undefined);

resetState();

const windowPlayer = makeEmptyPlayer("window-player");
normalizePlayer(windowPlayer);
windowPlayer.cash = 100000;
state.players.set(windowPlayer.id, windowPlayer);
const windowRough = auctionRough("window-rough", { price: 10000, trueValue: 30000, value: 30000 });
makeAuctionRound([windowRough]);
let windowResult = requestAuctionWindowForPlayer(windowPlayer, { roughId: windowRough.id, x: 50, y: 50 }, 1_200);
assert.equal(windowResult.ok, true);
assert.equal(windowRough.windows.length, 1);
const cashAfterWindow = windowPlayer.cash;
windowResult = requestAuctionWindowForPlayer(windowPlayer, { roughId: windowRough.id, x: 55, y: 55 }, 2_000);
assert.equal(windowResult.ok, false);
assert.equal(windowRough.windows.length, 1);
assert.equal(windowPlayer.cash, cashAfterWindow);

resetState();

console.log("Server idle behavior checks passed");
