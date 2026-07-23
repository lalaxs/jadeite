import assert from "node:assert/strict";
import { __testHooks } from "../server.js";

const {
  makePlayer,
  normalizePlayer,
  spendCash,
  consumeRequestId,
  earnCash,
  settleOfflinePlayer,
  enterAuctionForPlayer,
  submitAuctionBidForPlayer,
  joinAuctionForPlayer,
  requestAuctionWindowForPlayer,
  ensureAuctionRound,
  settleAuctionIfDue,
  snapshotFor,
  startRoughOpeningForPlayer,
  startProductionJob,
  processProductionJobs,
  scheduleLivestream,
  sellLivestreamNow,
  assetListingsForPlayer,
  buyAssetListingForPlayer,
  playerOwnsWorkshop,
  playerCanLivestream,
  processLivestreamJobs,
  processPolishingJobs,
  playerSocketCount,
  isPlayerOnline,
  revealPolishedRough,
  normalizeExtractionKits,
  normalizeWorkshop,
  materialStageFor,
  workshopDevicesForPlayer,
  workshopDeviceForPlayer,
  workshopJobsForDevice,
  workshopProcessableItems,
  startWorkshopJobForPlayer,
  equipmentCatalog,
  buyEquipment,
  repairEquipment,
  repairQuote,
  ensureRecruitCandidates,
  recruitWorker,
  isWorkerBusy,
  grantActivityExperience,
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
  state.latestAuctionResults = [];
  state.auctionHistory = [];
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
    hallId: "novice",
    hallLabel: "新手公盘",
    status: "live",
    startsAt: 1_000,
    endsAt: 2_000,
    entryFee: 5000,
    entries: [],
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
  player.assets.workshopOwned = false;
  return player;
}

resetState();

assert.equal(typeof submitAuctionBidForPlayer, "function", "submitAuctionBidForPlayer should be testable");
assert.equal(typeof enterAuctionForPlayer, "function", "enterAuctionForPlayer should be testable");
assert.equal(typeof joinAuctionForPlayer, "function", "joinAuctionForPlayer should be testable");
assert.equal(typeof requestAuctionWindowForPlayer, "function", "requestAuctionWindowForPlayer should be testable");
assert.equal(typeof snapshotFor, "function", "snapshotFor should be testable");
assert.equal(typeof sellLivestreamNow, "function", "sellLivestreamNow should preserve legacy livestreamSell compatibility");
assert.equal(typeof startRoughOpeningForPlayer, "function", "startRoughOpeningForPlayer should be testable");
assert.equal(typeof normalizeWorkshop, "function", "normalizeWorkshop should be testable");
assert.equal(typeof materialStageFor, "function", "materialStageFor should be testable");
assert.equal(typeof workshopDevicesForPlayer, "function", "workshopDevicesForPlayer should be testable");
assert.equal(typeof workshopProcessableItems, "function", "workshopProcessableItems should be testable");
assert.equal(typeof startWorkshopJobForPlayer, "function", "startWorkshopJobForPlayer should be testable");
assert.equal(typeof buyEquipment, "function", "buyEquipment should be testable");
assert.equal(typeof repairEquipment, "function", "repairEquipment should be testable");
assert.equal(typeof recruitWorker, "function", "recruitWorker should be testable");

const starterPlayer = makePlayer("starter-player");
assert.equal(starterPlayer.rough.length, 3);
assert.equal(starterPlayer.starterRoughGranted, true);
assert.equal(starterPlayer.assets.workshopOwned, true);
assert.equal(playerOwnsWorkshop(starterPlayer), true);
assert.equal(new Set(starterPlayer.rough.map((rough) => rough.id)).size, 3);
assert.ok(starterPlayer.rough.every((rough) => rough.type === "rough" && rough.owner === starterPlayer.id && rough.revealed === false));
const starterSnapshot = snapshotFor(starterPlayer, 10);
assert.equal(starterSnapshot.me.rough.length, 3);
assert.equal(Object.hasOwn(starterSnapshot.me.rough[0], "trueValue"), false);
assert.equal(Object.hasOwn(starterSnapshot.me.rough[0], "trueQualityKey"), false);
const starterDevices = starterSnapshot.me.workshop.devices;
assert.equal(starterDevices.length, 3);
assert.deepEqual(starterDevices.map((device) => device.stage), ["opening", "carving", "finishing"]);
assert.equal(starterSnapshot.me.workshop.workers.length, 4);
assert.equal(starterSnapshot.me.recruitCandidates.length, 3);
assert.equal(starterSnapshot.me.workshop.workers.every((worker) => worker.busy === false), true);
assert.equal(starterSnapshot.equipmentCatalog.length, 9);
assert.equal(equipmentCatalog().every((entry) => entry.tier === 1), true);
assert.equal(starterDevices.every((device) => device.capacity === 1), true);
assert.equal(starterDevices.every((device) => device.workerId), true);
assert.equal(starterDevices.every((device) => !Object.hasOwn(device, "queue")), true);
const starterOpeningDevice = starterDevices.find((device) => device.stage === "opening");
const starterCarvingDevice = starterDevices.find((device) => device.stage === "carving");
const starterFinishingDevice = starterDevices.find((device) => device.stage === "finishing");
assert.ok(starterOpeningDevice && starterCarvingDevice && starterFinishingDevice);
assert.equal(starterPlayer.rough.every((rough) => materialStageFor(rough) === "rough"), true);
assert.equal(workshopProcessableItems(starterPlayer, starterOpeningDevice.id).length, 3);
assert.equal(workshopProcessableItems(starterPlayer, starterCarvingDevice.id).length, 0);

const instantOpeningPlayer = makePlayer("instant-opening-player");
const instantOpeningRoughId = instantOpeningPlayer.rough[0].id;
const instantOpeningCash = instantOpeningPlayer.cash;
const instantOpeningResult = startRoughOpeningForPlayer(instantOpeningPlayer, instantOpeningRoughId);
assert.equal(instantOpeningResult.ok, true);
assert.equal(instantOpeningPlayer.cash, instantOpeningCash - 620);
assert.equal(instantOpeningPlayer.jobs.length, 1, "opening should now queue a workshop device job");
assert.equal(instantOpeningPlayer.jobs[0].stage, "opening");
assert.equal(instantOpeningPlayer.jobs[0].deviceId, instantOpeningResult.device.id);
assert.equal(instantOpeningPlayer.jobs[0].workerId, "worker-opening");
assert.equal(instantOpeningPlayer.jobs[0].outputStage, "opened");
assert.equal(instantOpeningPlayer.rough.some((rough) => rough.id === instantOpeningRoughId), false);
const blockedSecondOpening = startWorkshopJobForPlayer(instantOpeningPlayer, instantOpeningResult.device.id, { itemId: instantOpeningPlayer.rough[0].id });
assert.equal(blockedSecondOpening.ok, false);
assert.match(blockedSecondOpening.message, /正在加工|容量/);
assert.equal(instantOpeningPlayer.jobs.filter((job) => job.deviceId === instantOpeningResult.device.id).length, 1);
state.players.set(instantOpeningPlayer.id, instantOpeningPlayer);
const instantOpeningCondition = workshopDeviceForPlayer(instantOpeningPlayer, instantOpeningResult.device.id).condition;
const openingSkillExpBefore = instantOpeningPlayer.workshop.workers
  .find((worker) => worker.id === "worker-opening").skills.cut.jieliao.exp;
instantOpeningPlayer.jobs[0].readyAt = 0;
processProductionJobs(Date.now(), { onlineOnly: false });
assert.equal(instantOpeningPlayer.jobs.length, 0);
assert.equal(instantOpeningPlayer.rough.length, 3);
const instantOpenedRough = instantOpeningPlayer.rough.find((rough) => rough.id === instantOpeningRoughId);
assert.equal(instantOpenedRough.revealed, true);
assert.equal(instantOpenedRough.polished, true);
assert.equal(instantOpenedRough.materialStage, "opened");
const instantOpeningConditionAfter = workshopDeviceForPlayer(instantOpeningPlayer, instantOpeningResult.device.id).condition;
assert.ok(instantOpeningConditionAfter < instantOpeningCondition, "completion should consume device durability exactly once");
assert.equal(
  instantOpeningPlayer.workshop.workers.find((worker) => worker.id === "worker-opening").skills.cut.jieliao.exp,
  openingSkillExpBefore + 10
);
const instantCarvingDevice = workshopDevicesForPlayer(instantOpeningPlayer).find((device) => device.stage === "carving");
assert.ok(instantCarvingDevice);
assert.equal(workshopProcessableItems(instantOpeningPlayer, instantCarvingDevice.id).some((rough) => rough.id === instantOpeningRoughId), true);

const equipmentPlayer = makePlayer("equipment-player");
equipmentPlayer.cash = 100000;
const equipmentCountBefore = workshopDevicesForPlayer(equipmentPlayer).length;
const equipmentCashBefore = equipmentPlayer.cash;
const equipmentPurchase = buyEquipment(equipmentPlayer, "rough", {
  spendCash,
  makeId: () => "equipment-extra-opening"
});
assert.equal(equipmentPurchase.ok, true);
assert.equal(equipmentPlayer.cash, equipmentCashBefore - 9000);
assert.equal(workshopDevicesForPlayer(equipmentPlayer).length, equipmentCountBefore + 1);
assert.equal(equipmentPurchase.device.capacity, 1);
const firstOpeningDevice = workshopDevicesForPlayer(equipmentPlayer).find(
  (device) => device.stage === "opening" && device.id !== equipmentPurchase.device.id
);
const parallelOne = startWorkshopJobForPlayer(equipmentPlayer, firstOpeningDevice.id, {
  itemId: equipmentPlayer.rough[0].id
});
const blockedBusyWorker = startWorkshopJobForPlayer(equipmentPlayer, equipmentPurchase.device.id, {
  itemId: equipmentPlayer.rough[0].id
});
assert.equal(blockedBusyWorker.ok, false);
assert.equal(blockedBusyWorker.code, "WORKER_BUSY");
workshopDeviceForPlayer(equipmentPlayer, equipmentPurchase.device.id).workerId = "worker-carving";
const parallelTwo = startWorkshopJobForPlayer(equipmentPlayer, equipmentPurchase.device.id, {
  itemId: equipmentPlayer.rough[0].id
});
assert.equal(parallelOne.ok, true);
assert.equal(parallelTwo.ok, true);
assert.equal(workshopJobsForDevice(equipmentPlayer, firstOpeningDevice.id).length, 1);
assert.equal(workshopJobsForDevice(equipmentPlayer, equipmentPurchase.device.id).length, 1);
assert.equal(startWorkshopJobForPlayer(equipmentPlayer, equipmentPurchase.device.id, {
  itemId: equipmentPlayer.rough[0].id
}).ok, false, "a device must reject a second job instead of queuing it");

const brokenDevice = workshopDevicesForPlayer(starterPlayer).find((device) => device.stage === "opening");
brokenDevice.condition = 0;
assert.equal(startWorkshopJobForPlayer(starterPlayer, brokenDevice.id, {
  itemId: starterPlayer.rough[0].id
}).ok, false, "zero-condition equipment must reject new work");
const repairCost = repairQuote(brokenDevice);
const repairCashBefore = starterPlayer.cash;
const repairResult = repairEquipment(starterPlayer, brokenDevice.id, { spendCash });
assert.equal(repairResult.ok, true);
assert.equal(workshopDeviceForPlayer(starterPlayer, brokenDevice.id).condition, 100);
assert.equal(starterPlayer.cash, repairCashBefore - repairCost);

const poorEquipmentPlayer = makePlayer("poor-equipment-player");
poorEquipmentPlayer.cash = 0;
const poorDeviceCount = workshopDevicesForPlayer(poorEquipmentPlayer).length;
assert.equal(buyEquipment(poorEquipmentPlayer, "rough", {
  spendCash,
  makeId: () => "should-not-exist"
}).ok, false);
assert.equal(workshopDevicesForPlayer(poorEquipmentPlayer).length, poorDeviceCount);
assert.equal(consumeRequestId(equipmentPlayer, "equipment-request-1"), true);
assert.equal(consumeRequestId(equipmentPlayer, "equipment-request-1"), false);

const recruitPlayer = makePlayer("recruit-player");
recruitPlayer.cash = 100000;
normalizePlayer(recruitPlayer);
const recruitCandidateCount = ensureRecruitCandidates(recruitPlayer, {
  rng: () => 0.2,
  makeId: () => "unused-candidate"
}).length;
assert.equal(recruitCandidateCount, 3);
const recruitWorkerCount = recruitPlayer.workshop.workers.length;
const recruitResult = recruitWorker(recruitPlayer, recruitPlayer.recruitCandidates[0].id, { spendCash });
assert.equal(recruitResult.ok, true);
normalizePlayer(recruitPlayer);
assert.equal(recruitPlayer.workshop.workers.length, recruitWorkerCount + 1);
assert.equal(recruitPlayer.workshop.workers.some((worker) => worker.id === recruitResult.worker.id), true);
recruitPlayer.jobs.push({ workerId: recruitResult.worker.id });
assert.equal(isWorkerBusy(recruitPlayer, recruitResult.worker.id), true);

const chainPlayer = makePlayer("workshop-chain-player");
state.players.set(chainPlayer.id, chainPlayer);
const chainOpeningDevice = workshopDevicesForPlayer(chainPlayer).find((device) => device.stage === "opening");
const chainCarvingDevice = workshopDevicesForPlayer(chainPlayer).find((device) => device.stage === "carving");
const chainFinishingDevice = workshopDevicesForPlayer(chainPlayer).find((device) => device.stage === "finishing");
assert.ok(chainOpeningDevice && chainCarvingDevice && chainFinishingDevice);
const chainRoughId = chainPlayer.rough[0].id;
const chainOpeningStart = startWorkshopJobForPlayer(chainPlayer, chainOpeningDevice.id, { itemId: chainRoughId });
assert.equal(chainOpeningStart.ok, true);
chainPlayer.jobs[0].readyAt = 0;
processProductionJobs(Date.now(), { onlineOnly: false });
const chainOpenedRough = chainPlayer.rough.find((rough) => rough.id === chainRoughId);
assert.equal(chainOpenedRough.materialStage, "opened");
const chainKits = normalizeExtractionKits([{ id: "chain-bangle", type: "bangle", x: 42, y: 52, ringSize: 56 }]);
const carvingStart = startWorkshopJobForPlayer(chainPlayer, chainCarvingDevice.id, { itemId: chainOpenedRough.id, kits: chainKits });
assert.equal(carvingStart.ok, true);
assert.equal(chainPlayer.jobs[0].deviceId, chainCarvingDevice.id);
assert.equal(chainPlayer.jobs[0].outputStage, "carved");
chainPlayer.jobs[0].readyAt = 0;
processProductionJobs(Date.now(), { onlineOnly: false });
const carvedProduct = chainPlayer.bracelets.find((item) => item.materialStage === "carved");
assert.ok(carvedProduct);
assert.equal(carvedProduct.sourceRoughId, chainOpenedRough.id);
assert.equal(workshopProcessableItems(chainPlayer, chainFinishingDevice.id).some((item) => item.id === carvedProduct.id), true);
const finishStart = startWorkshopJobForPlayer(chainPlayer, chainFinishingDevice.id, { itemId: carvedProduct.id });
assert.equal(finishStart.ok, true);
assert.equal(chainPlayer.jobs[0].outputStage, "finished");
chainPlayer.jobs[0].readyAt = 0;
processProductionJobs(Date.now(), { onlineOnly: false });
const finishedProduct = chainPlayer.bracelets.find((item) => item.materialStage === "finished");
assert.ok(finishedProduct);
assert.equal(finishedProduct.inlaid, true);

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

const assetPlayer = makeEmptyPlayer("asset-player");
normalizePlayer(assetPlayer);
assert.equal(assetPlayer.assets.workshopOwned, false);
assert.equal(assetPlayer.assets.livestreamPermitOwned, false);
assert.equal(playerOwnsWorkshop(assetPlayer), false);
assert.equal(playerCanLivestream(assetPlayer), false);
let assetListings = assetListingsForPlayer(assetPlayer);
assert.deepEqual(assetListings.map((listing) => listing.id), ["starter-workshop", "livestream-permit"]);

const cashBeforeWorkshop = assetPlayer.cash;
const workshopPurchase = buyAssetListingForPlayer(assetPlayer, "starter-workshop");
assert.equal(workshopPurchase.ok, true);
assert.equal(assetPlayer.assets.workshopOwned, true);
assert.equal(playerOwnsWorkshop(assetPlayer), true);
assert.equal(assetPlayer.cash, cashBeforeWorkshop - 12000);
assetListings = assetListingsForPlayer(assetPlayer);
assert.deepEqual(assetListings.map((listing) => listing.id), ["livestream-permit"]);

const repeatedWorkshopPurchase = buyAssetListingForPlayer(assetPlayer, "starter-workshop");
assert.equal(repeatedWorkshopPurchase.ok, false);
assert.match(repeatedWorkshopPurchase.message, /已经拥有/);

const cashBeforePermit = assetPlayer.cash;
const permitPurchase = buyAssetListingForPlayer(assetPlayer, "livestream-permit");
assert.equal(permitPurchase.ok, true);
assert.equal(assetPlayer.assets.livestreamPermitOwned, true);
assert.equal(playerCanLivestream(assetPlayer), true);
assert.equal(assetPlayer.cash, cashBeforePermit - 8000);
assert.deepEqual(assetListingsForPlayer(assetPlayer), []);

resetState();

const uiAuctionPlayer = makeEmptyPlayer("ui-auction-player");
normalizePlayer(uiAuctionPlayer);
state.players.set(uiAuctionPlayer.id, uiAuctionPlayer);
const uiRound = ensureAuctionRound(100_000);
assert.equal(uiRound.status, "live");
assert.equal(uiRound.startsAt, 100_000);
assert.equal(uiRound.endsAt, 700_000);
const uiAuctionSnapshot = snapshotFor(uiAuctionPlayer, 100_100);
assert.equal(uiAuctionSnapshot.auction.phase, "live");
assert.equal(uiAuctionSnapshot.auction.entered, false);
assert.equal(uiAuctionSnapshot.auctionHalls.length, 5);
assert.deepEqual(uiAuctionSnapshot.auctionHalls.map((hall) => hall.id), ["novice", "regular", "premium", "special", "legendary"]);
assert.equal(uiAuctionSnapshot.auctionHalls[0].label, "新手公盘");
const blockedBid = submitAuctionBidForPlayer(uiAuctionPlayer, {
  roughId: uiRound.roughs[0].id,
  amount: uiRound.roughs[0].price
}, 100_200);
assert.equal(blockedBid.ok, false);
assert.match(blockedBid.message, /先入场/);
const enterResult = enterAuctionForPlayer(uiAuctionPlayer, { hallId: "novice" }, 100_300);
assert.equal(enterResult.ok, true);
assert.equal(enterResult.entryFee, 5000);
assert.equal(uiAuctionPlayer.cash, 25000);
const joinedAuctionSnapshot = snapshotFor(uiAuctionPlayer, 100_400);
assert.equal(joinedAuctionSnapshot.auction.entered, true);
assert.equal(joinedAuctionSnapshot.auction.myBids.length, 0);
const duplicateEnterResult = joinAuctionForPlayer(uiAuctionPlayer, { hallId: "novice" }, 100_500);
assert.equal(duplicateEnterResult.ok, true);
assert.equal(uiAuctionPlayer.cash, 25000);
assert.equal(settleAuctionIfDue(uiRound.endsAt), true);
assert.notEqual(state.auction.id, uiRound.id);
assert.deepEqual(state.auction.entries, []);
const nextRoundSnapshot = snapshotFor(uiAuctionPlayer, uiRound.endsAt + 1);
assert.equal(nextRoundSnapshot.auction.entered, false);
assert.equal(nextRoundSnapshot.auction.roughs.length, 0);
const reenterResult = enterAuctionForPlayer(uiAuctionPlayer, { hallId: "novice" }, uiRound.endsAt + 100);
assert.equal(reenterResult.ok, true);
assert.equal(uiAuctionPlayer.cash, 20000);
const reenteredSnapshot = snapshotFor(uiAuctionPlayer, uiRound.endsAt + 200);
assert.equal(reenteredSnapshot.auction.entered, true);
assert.equal(reenteredSnapshot.auction.roughs.length, 8);

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
const gatedLivestreamPlayer = makeEmptyPlayer("gated-livestream-player");
normalizePlayer(gatedLivestreamPlayer);
const gatedLiveProduct = testProduct("gated-live-product");
gatedLivestreamPlayer.bracelets.push(gatedLiveProduct);
assert.equal(scheduleLivestream(gatedLivestreamPlayer, gatedLiveProduct.id, "autoBalanced"), null);
assert.equal(gatedLivestreamPlayer.bracelets.length, 1);
gatedLivestreamPlayer.assets.livestreamPermitOwned = true;
livestreamPlayer.assets.livestreamPermitOwned = true;
const liveJob = scheduleLivestream(livestreamPlayer, liveProduct.id, "autoBalanced");
assert.ok(liveJob);
assert.equal(liveJob.workerId, "worker-finishing");
assert.equal(isWorkerBusy(livestreamPlayer, liveJob.workerId), true);
const liveSkillExpBefore = livestreamPlayer.workshop.workers
  .find((worker) => worker.id === liveJob.workerId).skills.speak.huashu.exp;
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
assert.equal(
  livestreamPlayer.workshop.workers.find((worker) => worker.id === liveJob.workerId).skills.speak.huashu.exp,
  liveSkillExpBefore + 10
);

resetState();

const unsoldLivestreamPlayer = makeEmptyPlayer("unsold-livestream-player");
normalizePlayer(unsoldLivestreamPlayer);
state.players.set(unsoldLivestreamPlayer.id, unsoldLivestreamPlayer);
state.sockets.set("socket-unsold-live", unsoldLivestreamPlayer.id);
const unsoldProduct = testProduct("unsold-live-product");
unsoldLivestreamPlayer.bracelets.push(unsoldProduct);
unsoldLivestreamPlayer.assets.livestreamPermitOwned = true;
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
offlineLivestreamPlayer.assets.livestreamPermitOwned = true;
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
manualLivestreamPlayer.assets.livestreamPermitOwned = true;
const manualSale = sellLivestreamNow(manualLivestreamPlayer, manualProduct.id, 12);
assert.ok(manualSale);
assert.equal(manualSale.worker.id, "worker-finishing");
assert.deepEqual(manualSale.xpResult.grants, { huashu: 10, kongchang: 7, cuidan: 5 });
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
  status: "live",
  startsAt: 1_000,
  endsAt: 2_000,
  entryFee: 5000,
  entries: [],
  roughs: [aiWonRough],
  bids: [],
  results: []
};

assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(state.latestAuctionResults[0].status, "aiWon");
assert.equal(state.roughPool.some((rough) => rough.id === aiWonRough.id), false);

resetState();

const directBidPlayer = makeEmptyPlayer("direct-bid-player");
normalizePlayer(directBidPlayer);
directBidPlayer.cash = 100000;
state.players.set(directBidPlayer.id, directBidPlayer);
const directBidRough = auctionRough("direct-bid-rough", { price: 1000, trueValue: 1000, value: 1000 });
makeAuctionRound([directBidRough]);

let bidResult = submitAuctionBidForPlayer(directBidPlayer, { roughId: directBidRough.id, amount: 1000 }, 1_100);
assert.equal(bidResult.ok, false);
assert.match(bidResult.message, /先入场/);
const directEnter = enterAuctionForPlayer(directBidPlayer, { hallId: "novice" }, 1_150);
assert.equal(directEnter.ok, true);
assert.equal(directBidPlayer.cash, 95000);
bidResult = submitAuctionBidForPlayer(directBidPlayer, { roughId: directBidRough.id, amount: 1000 }, 1_200);
assert.equal(bidResult.ok, true);
assert.equal(directBidPlayer.rep, 0);
assert.equal(directBidPlayer.cash, 95000);
assert.equal(state.auction.bids[0].amount, 1000);
assert.equal(Object.hasOwn(state.auction.bids[0], "proxyMax"), false);
assert.equal(snapshotFor(directBidPlayer, 1_300).auction.myBids[0].deposit, undefined);
bidResult = submitAuctionBidForPlayer(directBidPlayer, { roughId: directBidRough.id, amount: 1200 }, 1_300);
assert.equal(bidResult.ok, true);
assert.equal(state.auction.bids.length, 1);
assert.equal(state.auction.bids[0].amount, 1200);

resetState();

const closedPlayer = makeEmptyPlayer("closed-bid-player");
normalizePlayer(closedPlayer);
closedPlayer.cash = 100000;
state.players.set(closedPlayer.id, closedPlayer);
const closedRough = auctionRough("closed-rough", { price: 1000, trueValue: 1000, value: 1000 });
makeAuctionRound([closedRough]);
assert.equal(enterAuctionForPlayer(closedPlayer, { hallId: "novice" }, 1_100).ok, true);
const cashAfterClose = closedPlayer.cash;
const bidsAfterClose = state.auction.bids.filter((bid) => bid.playerId === closedPlayer.id).length;
bidResult = submitAuctionBidForPlayer(closedPlayer, { roughId: closedRough.id, amount: 5000 }, 2_000);
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
assert.equal(enterAuctionForPlayer(successPlayer, { hallId: "novice" }, 1_100).ok, true);
bidResult = submitAuctionBidForPlayer(successPlayer, { roughId: successRough.id, amount: 14000 }, 1_200);
assert.equal(bidResult.ok, true);
assert.equal(successPlayer.cash, 45000);
assert.equal(successPlayer.rep, 0);
assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(state.latestAuctionResults[0].status, "won");
assert.equal(successPlayer.rough.some((rough) => rough.id === successRough.id), true);
assert.equal(state.roughPool.some((rough) => rough.id === successRough.id), false);
assert.equal(successPlayer.cash, 50000 - 5000 - state.latestAuctionResults[0].price);
assert.ok(successPlayer.reports[0].inventoryValue >= (successRough.value || successRough.price));

resetState();

const shortPlayer = makeEmptyPlayer("short-tail-player");
const fallbackPlayer = makeEmptyPlayer("fallback-tail-player");
normalizePlayer(shortPlayer);
normalizePlayer(fallbackPlayer);
shortPlayer.cash = 5000;
fallbackPlayer.cash = 50000;
state.players.set(shortPlayer.id, shortPlayer);
state.players.set(fallbackPlayer.id, fallbackPlayer);
const shortRough = auctionRough("short-tail-rough", { price: 10000, trueValue: 1000, value: 1000 });
makeAuctionRound([shortRough]);
state.auction.entries.push({ playerId: shortPlayer.id, fee: 0, at: 1_100 }, { playerId: fallbackPlayer.id, fee: 0, at: 1_110 });
bidResult = submitAuctionBidForPlayer(shortPlayer, { roughId: shortRough.id, amount: 20000 }, 1_200);
assert.equal(bidResult.ok, true);
bidResult = submitAuctionBidForPlayer(fallbackPlayer, { roughId: shortRough.id, amount: 15000 }, 1_300);
assert.equal(bidResult.ok, true);
assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(state.latestAuctionResults[0].status, "won");
assert.equal(state.latestAuctionResults[0].winnerId, fallbackPlayer.id);
assert.equal(state.latestAuctionResults[0].price, 15000);
assert.equal(state.latestAuctionResults[0].skippedBids, 1);
assert.equal(shortPlayer.rough.some((rough) => rough.id === shortRough.id), false);
assert.equal(fallbackPlayer.rough.some((rough) => rough.id === shortRough.id), true);
assert.equal(fallbackPlayer.cash, 35000);

resetState();

const lowAiRough = auctionRough("low-ai-rough", { price: 20000, trueValue: 1000, value: 1000 });
makeAuctionRound([lowAiRough]);
assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(state.latestAuctionResults[0].status, "passed");
assert.equal(state.latestAuctionResults[0].winnerId, undefined);
assert.equal(state.roughPool.some((rough) => rough.id === lowAiRough.id), true);

resetState();

const offlineAuctionWinner = makeEmptyPlayer("offline-auction-winner");
normalizePlayer(offlineAuctionWinner);
offlineAuctionWinner.cash = 50000;
offlineAuctionWinner.lastSeenAt = 1_000;
state.players.set(offlineAuctionWinner.id, offlineAuctionWinner);
const offlineAuctionRough = auctionRough("offline-auction-rough", { price: 1000, trueValue: 1000, value: 1000 });
makeAuctionRound([offlineAuctionRough], { endsAt: 2_000 });
assert.equal(enterAuctionForPlayer(offlineAuctionWinner, { hallId: "novice" }, 1_100).ok, true);
bidResult = submitAuctionBidForPlayer(offlineAuctionWinner, { roughId: offlineAuctionRough.id, amount: 1000 }, 1_200);
assert.equal(bidResult.ok, true);
const offlineAuctionEvents = settleOfflinePlayer(offlineAuctionWinner, 3_000);
assert.equal(offlineAuctionEvents.length, 1);
assert.equal(offlineAuctionEvents[0].type, "auction");
assert.match(offlineAuctionEvents[0].text, /公盘/);
assert.equal(offlineAuctionWinner.offlineSummary.count, 1);
assert.match(offlineAuctionWinner.offlineSummary.lines[0], /公盘/);
assert.equal(offlineAuctionWinner.rough.some((rough) => rough.id === offlineAuctionRough.id), true);
assert.equal(offlineAuctionWinner.cash, 44000);
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
makeAuctionRound([rotatedOfflineAuctionRough], { endsAt: 2_000 });
assert.equal(enterAuctionForPlayer(rotatedOfflineAuctionWinner, { hallId: "novice" }, 1_100).ok, true);
bidResult = submitAuctionBidForPlayer(rotatedOfflineAuctionWinner, { roughId: rotatedOfflineAuctionRough.id, amount: 1000 }, 1_200);
assert.equal(bidResult.ok, true);
assert.equal(settleAuctionIfDue(2_000), true);
assert.equal(rotatedOfflineAuctionWinner.rough.some((rough) => rough.id === rotatedOfflineAuctionRough.id), true);
assert.equal(rotatedOfflineAuctionWinner.cash, 44000);
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
assert.equal(settleAuctionIfDue(generatedRound.endsAt), true);
assert.ok(state.latestAuctionResults.some((result) => result.status === "aiWon"));
assert.equal(state.auctionHistory.length, 1);
assert.equal(state.auctionHistory[0].hallLabel, "新手公盘");
assert.ok(state.auctionHistory[0].results.some((result) => result.status === "aiWon"));
const nextGeneratedRound = state.auction;
const nextGeneratedIds = nextGeneratedRound.roughs.map((rough) => rough.id);
assert.ok(generatedIds.some((id) => !nextGeneratedIds.includes(id)));

resetState();

const snapshotPlayer = makeEmptyPlayer("snapshot-player");
normalizePlayer(snapshotPlayer);
state.players.set(snapshotPlayer.id, snapshotPlayer);
const snapshotRough = auctionRough("snapshot-rough", { price: 10000, trueValue: 30000, value: 30000 });
makeAuctionRound([snapshotRough], { startsAt: Date.now() - 600_001, endsAt: Date.now() - 1 });
const snapshot = snapshotFor(snapshotPlayer);
assert.equal(snapshot.auction.phase, "live");
assert.equal(state.latestAuctionResults[0].status, "aiWon");
assert.equal(snapshot.auction.results[0].status, "aiWon");
assert.equal(snapshot.auction.results[0].winnerId, undefined);
assert.equal(snapshot.auctionHistory.length, 1);
assert.equal(snapshot.auctionHistory[0].hallLabel, "新手公盘");
assert.equal(snapshot.auctionHistory[0].results[0].status, "aiWon");
assert.equal(snapshot.auctionHistory[0].results[0].winnerId, undefined);

resetState();

const windowPlayer = makeEmptyPlayer("window-player");
normalizePlayer(windowPlayer);
windowPlayer.cash = 100000;
state.players.set(windowPlayer.id, windowPlayer);
const windowRough = auctionRough("window-rough", { price: 10000, trueValue: 30000, value: 30000 });
makeAuctionRound([windowRough]);
assert.equal(enterAuctionForPlayer(windowPlayer, { hallId: "novice" }, 1_100).ok, true);
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
process.exit(0);
