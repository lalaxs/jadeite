import assert from "node:assert/strict";
import {
  MINING_FOREMAN_BONUS,
  MINING_INCIDENT_REVEAL_RATIO,
  MINING_RECRUIT_REFRESH_COST,
  MINING_ROLE_EXPERIENCE,
  MINER_PERSONAL_LEAVE_MS,
  MINER_MENTORSHIP_REQUIRED_SHIFTS,
  MINER_MENTORSHIP_ROLE_EXP,
  miningAutoRoleAssignments,
  miningForemanInfo,
  miningMinerContractInfo,
  miningMinerEffectiveSkill,
  miningMinerMoraleInfo,
  miningMinerPromotionInfo,
  miningMinerRetentionInfo,
  miningShiftIncidentById,
  miningShiftIncidentChoice
} from "../shared/domain/mining/mining-rules.js";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "1";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "4000";
process.env.JADE_MINING_SHIFT_MS = "500";
process.env.JADE_MINING_BASIC_MODE = "0";

const { __testHooks } = await import(`../server.js?mining-smoke=${Date.now()}`);

const {
  world,
  state,
  makePlayer,
  normalizePlayer,
  processMiningWorld,
  submitMiningApplication,
  cancelMiningApplication,
  saveMiningTuningExperiment,
  refreshMinerRecruitCandidates,
  recruitMiner,
  dismissMiner,
  trainMiner,
  careForMiner,
  resolveMinerRetention,
  formMinerMentorship,
  endMinerMentorship,
  specializeMiner,
  renewMinerContract,
  promoteMiner,
  upgradeMiningFacility,
  startMiningShift,
  resolveMiningIncident,
  settleMiningJob,
  processMiningJobs,
  minerReadiness,
  applyMinerShiftCondition,
  applyMinerRetentionAfterShift,
  applyMinerMentorshipsForShift,
  snapshotFor,
  spendCash
} = __testHooks;

const startedAt = 1_800_000_000_000;
const player = makePlayer("mining-player");
player.name = "矿山测试掌柜";
player.cash = 500_000;
player.lastSeenAt = startedAt;
normalizePlayer(player);
world.setPlayer(player);

const ordinaryWorkerIds = player.workshop.workers.map((worker) => worker.id);
const unlock = processMiningWorld(startedAt);
assert.equal(unlock.unlocked, true);
assert.equal(state.mining.unlockedAt, startedAt);
assert.equal(player.mining.licenseAt, startedAt);
assert.equal(state.mining.currentRound.number, 1);

const tuningObservation = saveMiningTuningExperiment(player, { mist: "rent-5" }, startedAt + 1);
assert.equal(tuningObservation.ok, true);
assert.equal(player.mining.tuningExperiments.length, 1);
assert.equal(tuningObservation.experiment.status, "collecting");
assert.equal(tuningObservation.experiment.rows[0].scenarioId, "rent-5");
assert.match(tuningObservation.message, /不会修改正式数值/);
const duplicateTuningObservation = saveMiningTuningExperiment(player, { mist: "rent-5" }, startedAt + 2);
assert.equal(duplicateTuningObservation.ok, false);
assert.match(duplicateTuningObservation.message, /无需重复保存/);
const broadTuningObservation = saveMiningTuningExperiment(player, {
  mist: "rent-5",
  ridge: "output+5",
  glacier: "output+5"
}, startedAt + 2);
assert.equal(broadTuningObservation.ok, false);
assert.match(broadTuningObservation.message, /最多记录两个矿带/);
const initialMiningSnapshot = snapshotFor(player, startedAt + 3).mining;
assert.equal(initialMiningSnapshot.tuningExperiments.length, 1);
assert.equal(initialMiningSnapshot.tuningExperiments[0].observedRoundCount, 0);
assert.equal(initialMiningSnapshot.tuningExperiments[0].assessment.id, "collecting");

const application = submitMiningApplication(player, ["mist-01", "mist-02"], startedAt + 10);
assert.equal(application.ok, true);
assert.deepEqual(application.application.preferences, ["mist-01", "mist-02"]);
assert.equal(application.application.allowFallback, true);
assert.ok(application.application.escrow >= 12_000);
assert.equal(application.application.revision, 1);

const revisedApplication = submitMiningApplication(
  player,
  ["mist-02"],
  startedAt + 11,
  { expectedRevision: application.application.revision }
);
assert.equal(revisedApplication.ok, true);
assert.equal(revisedApplication.application.revision, 2);
const cashAfterApplicationRevision = player.cash;
const staleApplication = submitMiningApplication(
  player,
  ["core-06"],
  startedAt + 12,
  { expectedRevision: application.application.revision }
);
assert.equal(staleApplication.ok, false);
assert.equal(staleApplication.stale, true);
assert.equal(player.cash, cashAfterApplicationRevision,
  "a stale application edit must be rejected before changing escrow");
assert.deepEqual(staleApplication.application.preferences, ["mist-02"]);
const staleCancellation = cancelMiningApplication(
  player,
  startedAt + 13,
  { expectedRevision: application.application.revision }
);
assert.equal(staleCancellation.ok, false);
assert.equal(staleCancellation.stale, true);
assert.equal(player.cash, cashAfterApplicationRevision,
  "a stale cancellation must not release the current application escrow");

processMiningWorld(startedAt + 100);
const lease = state.mining.currentRound.leases.find((entry) => entry.playerId === player.id);
assert.ok(lease);
assert.ok(["mist-01", "mist-02"].includes(lease.mineId));
assert.equal(lease.allocationMode, "preference");

const firstCandidates = refreshMinerRecruitCandidates(player, {
  rng: () => 0.1,
  makeId: (() => {
    let index = 0;
    return () => `miner-candidate-${++index}`;
  })(),
  spendCash,
  now: startedAt + 1_000
});
assert.equal(firstCandidates.ok, true);
assert.equal(firstCandidates.free, true);
assert.equal(player.mining.recruitCandidates.length, 3);
assert.equal(new Set(player.mining.recruitCandidates.map((candidate) => candidate.name)).size, 3);

const originalCandidateIds = player.mining.recruitCandidates.map((candidate) => candidate.id);
const cashBeforePaidRefresh = player.cash;
let refreshedCandidateIndex = 0;
const paidRefresh = refreshMinerRecruitCandidates(player, {
  rng: () => 0.2,
  makeId: () => `paid-refresh-candidate-${++refreshedCandidateIndex}`,
  spendCash,
  expectedCandidateIds: originalCandidateIds,
  now: startedAt + 2_001
});
assert.equal(paidRefresh.ok, true);
assert.equal(player.cash, cashBeforePaidRefresh - MINING_RECRUIT_REFRESH_COST);
const cashAfterPaidRefresh = player.cash;
const refreshedCandidateIds = player.mining.recruitCandidates.map((candidate) => candidate.id);
const rapidRefresh = refreshMinerRecruitCandidates(player, {
  rng: () => 0.25,
  makeId: () => `rapid-refresh-candidate-${++refreshedCandidateIndex}`,
  spendCash,
  expectedCandidateIds: refreshedCandidateIds,
  now: startedAt + 2_002
});
assert.equal(rapidRefresh.ok, false);
assert.equal(rapidRefresh.cooldown, true);
assert.match(rapidRefresh.message, /本次未扣费/);
assert.equal(player.cash, cashAfterPaidRefresh,
  "a rapid second refresh must be rejected before charging again");
const staleRefresh = refreshMinerRecruitCandidates(player, {
  rng: () => 0.3,
  makeId: () => `stale-refresh-candidate-${++refreshedCandidateIndex}`,
  spendCash,
  expectedCandidateIds: originalCandidateIds,
  now: startedAt + 3_002
});
assert.equal(staleRefresh.ok, false);
assert.equal(staleRefresh.stale, true);
assert.match(staleRefresh.message, /本次未扣费/);
assert.equal(player.cash, cashAfterPaidRefresh,
  "two windows refreshing the same candidate version must only charge once");

const firstRecruit = recruitMiner(player, player.mining.recruitCandidates[0].id, { spendCash });
const secondRecruit = recruitMiner(player, player.mining.recruitCandidates[0].id, { spendCash });
assert.equal(firstRecruit.ok, true);
assert.equal(secondRecruit.ok, true);
assert.equal(player.mining.miners.length, 2);
assert.deepEqual(player.workshop.workers.map((worker) => worker.id), ordinaryWorkerIds);
assert.ok(player.mining.miners.every((miner) => miner.contractShiftsRemaining === 6));
assert.ok(player.mining.miners.every((miner) => miner.morale === 70));
assert.ok(player.mining.miners.every((miner) => miningMinerMoraleInfo(miner).name === "稳定"));

const trainee = player.mining.miners[0];
const unspecializedMiner = player.mining.miners[1];
const prospectingBefore = { ...trainee.skills.prospecting };
const cashBeforeTraining = player.cash;
const training = trainMiner(player, trainee.id, "prospecting", startedAt + 110, { spendCash });
assert.equal(training.ok, true);
assert.equal(training.fee, 1_600);
assert.equal(player.cash, cashBeforeTraining - 1_600);
assert.equal(trainee.skills.prospecting.level, prospectingBefore.level);
assert.equal(trainee.skills.prospecting.exp, prospectingBefore.exp + 25);
assert.equal(trainee.fatigue, 8);
assert.equal(trainee.morale, 71);
assert.equal(player.mining.stats.trainingSpent, 1_600);
assert.equal(player.mining.stats.trainingSessions, 1);
assert.deepEqual(player.workshop.workers.map((worker) => worker.id), ordinaryWorkerIds);

const levelBeforeTraining = trainee.skills.prospecting.level;
trainee.skills.prospecting.exp = (50 * levelBeforeTraining) - 10;
const levelTraining = trainMiner(player, trainee.id, "prospecting", startedAt + 111, { spendCash });
assert.equal(levelTraining.ok, true);
assert.equal(levelTraining.progress.leveled, true);
assert.equal(trainee.skills.prospecting.level, levelBeforeTraining + 1);
assert.equal(trainee.skills.prospecting.exp, 15);
assert.equal(trainee.morale, 72);
assert.equal(player.mining.stats.trainingSpent, 3_200);
assert.equal(player.mining.stats.trainingSessions, 2);

const cashBeforeRest = player.cash;
const restCare = careForMiner(player, trainee.id, "rest", startedAt + 112, { spendCash });
assert.equal(restCare.ok, true);
assert.equal(restCare.fatigueBefore, 16);
assert.equal(restCare.fatigueAfter, 0);
assert.equal(restCare.moraleBefore, 72);
assert.equal(restCare.moraleAfter, 76);
assert.equal(player.cash, cashBeforeRest - 1_200);
assert.equal(player.mining.stats.careSpent, 1_200);
assert.equal(player.mining.stats.careActions, 1);
const unnecessaryRest = careForMiner(player, trainee.id, "rest", startedAt + 113, { spendCash });
assert.equal(unnecessaryRest.ok, false);
assert.match(unnecessaryRest.message, /不需要/);
trainee.morale = 40;
assert.equal(miningMinerContractInfo(trainee).moraleMultiplier, 1.25);
const moraleCare = careForMiner(player, trainee.id, "support", startedAt + 113, { spendCash });
assert.equal(moraleCare.ok, true);
assert.equal(moraleCare.moraleBefore, 40);
assert.equal(moraleCare.moraleAfter, 60);
assert.equal(player.mining.stats.careSpent, 3_000);
assert.equal(player.mining.stats.careActions, 2);
assert.equal(player.mining.stats.moraleRecovered, 24);
trainee.morale = 80;
assert.equal(careForMiner(player, trainee.id, "support", startedAt + 113, { spendCash }).ok, false);
trainee.morale = 60;

const prematurePromotion = promoteMiner(player, unspecializedMiner.id, startedAt + 114, { spendCash });
assert.equal(prematurePromotion.ok, false);
assert.match(prematurePromotion.message, /还需完成 2 个矿山班次/);
trainee.shiftsWorked = 2;
for (const skillState of Object.values(trainee.skills)) {
  skillState.level = 3;
  skillState.exp = 0;
}
const cashBeforePromotion = player.cash;
const promotion = promoteMiner(player, trainee.id, startedAt + 115, { spendCash });
assert.equal(promotion.ok, true);
assert.equal(promotion.previousTier, 1);
assert.equal(promotion.targetTier, 2);
assert.equal(promotion.fee, 1_800);
assert.equal(player.cash, cashBeforePromotion - 1_800);
assert.equal(trainee.tier, 2);
assert.equal(trainee.baseWage, 480);
assert.equal(trainee.promotions, 1);
assert.equal(trainee.lastPromotedAt, startedAt + 115);
assert.equal(trainee.morale, 70);
assert.equal(player.mining.stats.promotions, 1);
assert.equal(player.mining.stats.promotionSpent, 1_800);
assert.equal(miningMinerPromotionInfo(trainee).ready, false, "each assessment should advance only one tier");
assert.equal(promoteMiner(player, trainee.id, startedAt + 116, { spendCash }).ok, false);
assert.deepEqual(player.workshop.workers.map((worker) => worker.id), ordinaryWorkerIds);

const facilityUpgrades = ["survey", "drill", "support", "haulage", "haulage"]
  .map((facilityId, index) => upgradeMiningFacility(player, facilityId, startedAt + 120 + index));
assert.ok(facilityUpgrades.every((result) => result.ok));
assert.deepEqual(player.mining.facilities, { survey: 1, drill: 1, support: 1, haulage: 2 });
assert.equal(player.mining.stats.facilitySpent, 114_000);
assert.deepEqual(player.workshop.workers.map((worker) => worker.id), ordinaryWorkerIds);

trainee.shiftsWorked = 2;
trainee.skills.prospecting.level = 5;
trainee.skills.prospecting.exp = 0;
const prematureSpecialization = specializeMiner(player, trainee.id, "veinReader", startedAt + 130);
assert.equal(prematureSpecialization.ok, false);
assert.match(prematureSpecialization.message, /还需完成 1 个矿山班次/);
trainee.shiftsWorked = 3;
trainee.skills.prospecting.level = 4;
const undertrainedSpecialization = specializeMiner(player, trainee.id, "veinReader", startedAt + 131);
assert.equal(undertrainedSpecialization.ok, false);
assert.match(undertrainedSpecialization.message, /Lv\.5/);
trainee.skills.prospecting.level = 5;
const specialization = specializeMiner(player, trainee.id, "veinReader", startedAt + 132);
assert.equal(specialization.ok, true);
assert.equal(trainee.specializationId, "veinReader");
assert.equal(trainee.specializedAt, startedAt + 132);
assert.equal(miningMinerEffectiveSkill(trainee, "prospecting"), 6.9);
assert.equal(specializeMiner(player, trainee.id, "rockBreaker", startedAt + 133).ok, false);
assert.deepEqual(player.workshop.workers.map((worker) => worker.id), ordinaryWorkerIds);
unspecializedMiner.shiftsWorked = 3;
unspecializedMiner.skills.safety.level = 5;
unspecializedMiner.skills.safety.exp = 0;
const cashBeforeFirstRenewal = player.cash;
const firstRenewal = renewMinerContract(player, trainee.id, startedAt + 134, { spendCash });
assert.equal(firstRenewal.ok, true);
assert.equal(trainee.contractShiftsRemaining, 12);
assert.equal(firstRenewal.fee, trainee.baseWage * 2);
assert.equal(trainee.morale, 78);
assert.equal(player.cash, cashBeforeFirstRenewal - firstRenewal.fee);
assert.equal(renewMinerContract(player, trainee.id, startedAt + 135, { spendCash }).ok, false);

const preShiftSnapshot = snapshotFor(player, startedAt + 149, { includeStaticCatalogs: false });
assert.ok(preShiftSnapshot.mining.myNextCondition?.id);

const tooManyPreparations = startMiningShift(player, {
  minerIds: player.mining.miners.map((miner) => miner.id),
  strategyId: "standard",
  preparationIds: ["sampling", "drainage", "bracing"]
}, startedAt + 149);
assert.equal(tooManyPreparations.ok, false);
assert.match(tooManyPreparations.message, /最多携带 2 项/);

const duplicateRoleShift = startMiningShift(player, {
  minerIds: player.mining.miners.map((miner) => miner.id),
  strategyId: "standard",
  roleAssignments: {
    prospecting: player.mining.miners[0].id,
    extraction: player.mining.miners[0].id
  }
}, startedAt + 149);
assert.equal(duplicateRoleShift.ok, false);
assert.match(duplicateRoleShift.message, /每名当班矿工/);

unspecializedMiner.contractShiftsRemaining = 0;
const expiredContractShift = startMiningShift(player, {
  minerIds: player.mining.miners.map((miner) => miner.id),
  strategyId: "standard"
}, startedAt + 149);
assert.equal(expiredContractShift.ok, false);
assert.match(expiredContractShift.message, /合约班次已经用尽/);
const secondRenewal = renewMinerContract(player, unspecializedMiner.id, startedAt + 149, { spendCash });
assert.equal(secondRenewal.ok, true);
assert.equal(unspecializedMiner.contractShiftsRemaining, 6);
assert.equal(player.mining.stats.contractRenewals, 2);
assert.equal(player.mining.stats.contractSpent, firstRenewal.fee + secondRenewal.fee);

const skillExpBeforeShift = Object.fromEntries(player.mining.miners.map((miner) => [
  miner.id,
  Object.fromEntries(Object.entries(miner.skills).map(([key, value]) => [key, value.exp]))
]));

const invalidIncentiveShift = startMiningShift(player, {
  minerIds: player.mining.miners.map((miner) => miner.id),
  strategyId: "standard",
  incentiveId: "forged-incentive"
}, startedAt + 149);
assert.equal(invalidIncentiveShift.ok, false);
assert.match(invalidIncentiveShift.message, /激励方案不存在/);

const shift = startMiningShift(player, {
  minerIds: player.mining.miners.map((miner) => miner.id),
  strategyId: "standard",
  incentiveId: "safety",
  preparationIds: ["sampling", "bracing"]
}, startedAt + 150);
assert.equal(shift.ok, true);
assert.equal(player.mining.jobs.length, 1);
assert.equal(player.jobs.length, 0);
assert.equal(shift.job.durationMs, 450);
assert.equal(shift.job.readyAt - shift.job.startedAt, 450);
assert.equal(shift.job.facilities.survey, 1);
assert.equal(shift.job.conditionId, preShiftSnapshot.mining.myNextCondition.id);
assert.deepEqual(shift.job.preparationIds, ["sampling", "bracing"]);
assert.equal(shift.job.preparationCost, 3_400);
assert.equal(shift.job.incentiveId, "safety");
assert.equal(shift.job.incentiveLabel, "安全津贴");
assert.equal(shift.job.wageCost, 1_512);
assert.equal(shift.job.incentivePremium, 252);
assert.equal(shift.job.mineMasteryLevel, 0);
assert.equal(shift.job.crewKey, player.mining.miners.map((miner) => miner.id).sort().join("|"));
assert.equal(shift.job.crewBondLevel, 0);
assert.equal(shift.job.surveyReportUsed, false);
const expectedForeman = miningForemanInfo(player.mining.miners[0]);
assert.equal(shift.job.foremanId, expectedForeman.minerId, "legacy clients should default to the first selected miner");
assert.equal(shift.job.foremanFocus, expectedForeman.focus);
assert.equal(shift.job.foremanLabel, expectedForeman.label);
assert.equal(shift.job.foremanBonus, MINING_FOREMAN_BONUS);
const expectedRoles = miningAutoRoleAssignments(player.mining.miners);
assert.deepEqual(shift.job.roleAssignments, expectedRoles, "legacy clients should receive a skill-matched role plan");
assert.equal(shift.job.roleLabels.length, player.mining.miners.length);
assert.equal(
  shift.job.incidentAt,
  shift.job.startedAt + Math.round(shift.job.durationMs * MINING_INCIDENT_REVEAL_RATIO)
);
assert.equal(shift.job.incidentId, undefined, "incident details should stay hidden before the reveal point");
assert.ok(shift.job.estimate.yieldMax >= shift.job.estimate.yieldMin);
assert.ok(shift.job.estimate.risk >= 0.01 && shift.job.estimate.risk <= 0.65);
assert.ok(shift.job.estimate.extraYieldChance >= 0 && shift.job.estimate.extraYieldChance <= 0.55);
assert.ok(shift.job.estimate.upgradeChance >= 0 && shift.job.estimate.upgradeChance <= 0.2);
assert.ok(shift.job.estimate.clueGain > 0);

const busyTraining = trainMiner(player, trainee.id, "safety", startedAt + 180, { spendCash });
assert.equal(busyTraining.ok, false);
assert.match(busyTraining.message, /井下作业/);
const busyCare = careForMiner(player, trainee.id, "rest", startedAt + 180, { spendCash });
assert.equal(busyCare.ok, false);
assert.match(busyCare.message, /井下作业/);
const busySpecialization = specializeMiner(player, unspecializedMiner.id, "supportLead", startedAt + 180);
assert.equal(busySpecialization.ok, false);
assert.match(busySpecialization.message, /井下作业/);
const busyRenewal = renewMinerContract(player, unspecializedMiner.id, startedAt + 180, { spendCash });
assert.equal(busyRenewal.ok, false);
assert.match(busyRenewal.message, /井下作业/);
const busyPromotion = promoteMiner(player, unspecializedMiner.id, startedAt + 180, { spendCash });
assert.equal(busyPromotion.ok, false);
assert.match(busyPromotion.message, /井下作业/);

const duringShiftUpgrade = upgradeMiningFacility(player, "survey", startedAt + 200);
assert.equal(duringShiftUpgrade.ok, true);
assert.equal(player.mining.facilities.survey, 2);
assert.equal(shift.job.facilities.survey, 1);

const activeShiftSnapshot = world.exportSnapshot({ savedAt: startedAt + 300 });
const activeShiftWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
activeShiftWorld.importSnapshot(activeShiftSnapshot);
const restoredActiveShift = activeShiftWorld.getPlayer(player.id).mining.jobs[0];
assert.equal(restoredActiveShift.conditionId, shift.job.conditionId);
assert.deepEqual(restoredActiveShift.preparationIds, ["sampling", "bracing"]);
assert.equal(restoredActiveShift.preparationCost, 3_400);
assert.equal(restoredActiveShift.incentiveId, "safety");
assert.equal(restoredActiveShift.incentiveLabel, "安全津贴");
assert.equal(restoredActiveShift.wageCost, 1_512);
assert.equal(restoredActiveShift.incentivePremium, 252);
assert.equal(restoredActiveShift.mineMasteryLevel, 0);
assert.equal(restoredActiveShift.crewKey, shift.job.crewKey);
assert.equal(restoredActiveShift.crewBondLevel, 0);
assert.equal(restoredActiveShift.surveyReportUsed, false);
assert.equal(restoredActiveShift.foremanId, expectedForeman.minerId);
assert.equal(restoredActiveShift.foremanFocus, expectedForeman.focus);
assert.equal(restoredActiveShift.foremanBonus, MINING_FOREMAN_BONUS);
assert.deepEqual(restoredActiveShift.roleAssignments, expectedRoles);
assert.deepEqual(restoredActiveShift.roleLabels, shift.job.roleLabels);
assert.deepEqual(restoredActiveShift.estimate, shift.job.estimate);
assert.equal(restoredActiveShift.incidentAt, shift.job.incidentAt);
assert.equal(restoredActiveShift.incidentId, undefined);
const restoredSpecialist = activeShiftWorld.getPlayer(player.id).mining.miners.find((miner) => miner.id === trainee.id);
assert.equal(restoredSpecialist.specializationId, "veinReader");
assert.equal(restoredSpecialist.shiftsWorked, 3);
assert.equal(restoredSpecialist.contractShiftsRemaining, 12);
assert.equal(restoredSpecialist.tier, 2);
assert.equal(restoredSpecialist.promotions, 1);
assert.equal(restoredSpecialist.lastPromotedAt, startedAt + 115);
assert.equal(restoredSpecialist.morale, 78);
const invalidContractSnapshot = structuredClone(activeShiftSnapshot);
invalidContractSnapshot.players.find(([playerId]) => playerId === player.id)[1]
  .mining.miners.find((miner) => miner.id === trainee.id).contractShiftsRemaining = 13;
const invalidContractWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
assert.throws(
  () => invalidContractWorld.importSnapshot(invalidContractSnapshot),
  /between 0 and 12/,
  "persisted miner contracts must stay within the maximum shift reserve"
);
const invalidPromotionSnapshot = structuredClone(activeShiftSnapshot);
invalidPromotionSnapshot.players.find(([playerId]) => playerId === player.id)[1]
  .mining.miners.find((miner) => miner.id === trainee.id).tier = 7;
const invalidPromotionWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
assert.throws(
  () => invalidPromotionWorld.importSnapshot(invalidPromotionSnapshot),
  /between 0 and 6/,
  "persisted miner tiers must stay within the promotion ceiling"
);
const invalidMoraleSnapshot = structuredClone(activeShiftSnapshot);
invalidMoraleSnapshot.players.find(([playerId]) => playerId === player.id)[1]
  .mining.miners.find((miner) => miner.id === trainee.id).morale = 101;
const invalidMoraleWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
assert.throws(
  () => invalidMoraleWorld.importSnapshot(invalidMoraleSnapshot),
  /between 0 and 100/,
  "persisted miner morale must stay within its supported range"
);
const invalidRetentionSnapshot = structuredClone(activeShiftSnapshot);
invalidRetentionSnapshot.players.find(([playerId]) => playerId === player.id)[1]
  .mining.miners.find((miner) => miner.id === trainee.id).retentionCase = {
    id: "forged-retention",
    createdAt: startedAt,
    moraleAtNotice: 101
  };
const invalidRetentionWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
assert.throws(
  () => invalidRetentionWorld.importSnapshot(invalidRetentionSnapshot),
  /between 0 and 100/,
  "persisted retention notices must retain a valid morale snapshot"
);
const invalidMentorshipSnapshot = structuredClone(activeShiftSnapshot);
invalidMentorshipSnapshot.players.find(([playerId]) => playerId === player.id)[1].mining.mentorships = [{
  id: "invalid-mentorship",
  mentorId: trainee.id,
  apprenticeId: trainee.id,
  mentorName: trainee.name,
  apprenticeName: trainee.name,
  status: "active",
  sharedShifts: 0,
  createdAt: startedAt
}];
const invalidMentorshipWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
assert.throws(
  () => invalidMentorshipWorld.importSnapshot(invalidMentorshipSnapshot),
  /cannot mentor the same miner/,
  "persisted mentorships must link two distinct miners"
);
const invalidIncentiveSnapshot = structuredClone(activeShiftSnapshot);
invalidIncentiveSnapshot.players.find(([playerId]) => playerId === player.id)[1]
  .mining.jobs[0].incentiveId = "forged-incentive";
const invalidIncentiveWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
assert.throws(
  () => invalidIncentiveWorld.importSnapshot(invalidIncentiveSnapshot),
  /known shift incentive/,
  "persisted shifts must reject forged wage incentive effects"
);
const invalidSpecializationSnapshot = structuredClone(activeShiftSnapshot);
const invalidSpecialist = invalidSpecializationSnapshot.players.find(([playerId]) => playerId === player.id)[1]
  .mining.miners.find((miner) => miner.id === trainee.id);
invalidSpecialist.shiftsWorked = 2;
const invalidSpecializationWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
assert.throws(
  () => invalidSpecializationWorld.importSnapshot(invalidSpecializationSnapshot),
  /below its specialization requirement/,
  "persisted specializations must retain their completed-shift requirement"
);
const invalidRoleSnapshot = structuredClone(activeShiftSnapshot);
const invalidRoleJob = invalidRoleSnapshot.players.find(([playerId]) => playerId === player.id)[1].mining.jobs[0];
invalidRoleJob.roleAssignments = {
  prospecting: player.mining.miners[0].id,
  extraction: player.mining.miners[0].id
};
const invalidRoleWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
assert.throws(
  () => invalidRoleWorld.importSnapshot(invalidRoleSnapshot),
  /distinct assigned crew members/,
  "persisted shifts must not reuse one miner across multiple underground roles"
);

const earlyIncidentChoice = resolveMiningIncident(
  player,
  shift.job.id,
  "hold",
  shift.job.incidentAt - 1
);
assert.equal(earlyIncidentChoice.ok, false);
assert.match(earlyIncidentChoice.message, /尚未传回/);
const estimateBeforeIncident = { ...shift.job.estimate };
const revealedIncident = processMiningJobs(shift.job.incidentAt);
assert.equal(revealedIncident.changed, true);
assert.equal(revealedIncident.incidentsRevealed, 1);
assert.equal(revealedIncident.results.length, 0);
const incident = miningShiftIncidentById(shift.job.incidentId);
assert.ok(incident);
const riskyIncidentChoice = incident.choices.at(-1);
const incidentDecision = resolveMiningIncident(
  player,
  shift.job.id,
  riskyIncidentChoice.id,
  shift.job.incidentAt + 1
);
assert.equal(incidentDecision.ok, true);
assert.equal(shift.job.incidentChoiceId, riskyIncidentChoice.id);
assert.equal(shift.job.incidentAutomatic, false);
assert.ok(shift.job.estimate.risk > estimateBeforeIncident.risk);
assert.ok(shift.job.estimate.extraYieldChance > estimateBeforeIncident.extraYieldChance);
const duplicateIncidentDecision = resolveMiningIncident(
  player,
  shift.job.id,
  incident.defaultChoiceId,
  shift.job.incidentAt + 2
);
assert.equal(duplicateIncidentDecision.ok, false);
assert.match(duplicateIncidentDecision.message, /不能重复更改/);

const resolvedShiftSnapshot = world.exportSnapshot({ savedAt: shift.job.incidentAt + 2 });
const resolvedShiftWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
resolvedShiftWorld.importSnapshot(resolvedShiftSnapshot);
const restoredResolvedShift = resolvedShiftWorld.getPlayer(player.id).mining.jobs[0];
assert.equal(restoredResolvedShift.incidentId, shift.job.incidentId);
assert.equal(restoredResolvedShift.incidentChoiceId, riskyIncidentChoice.id);
assert.deepEqual(restoredResolvedShift.estimate, shift.job.estimate);
const invalidIncidentSnapshot = structuredClone(resolvedShiftSnapshot);
invalidIncidentSnapshot.players.find(([playerId]) => playerId === player.id)[1]
  .mining.jobs[0].incidentChoiceId = "unknown-choice";
const invalidIncidentWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
assert.throws(
  () => invalidIncidentWorld.importSnapshot(invalidIncidentSnapshot),
  /choice from its incident/,
  "persisted shifts must not accept a forged incident outcome"
);

const automaticPlayer = structuredClone(player);
automaticPlayer.id = "mining-automatic-incident-player";
const automaticJob = automaticPlayer.mining.jobs[0];
delete automaticJob.incidentChoiceId;
delete automaticJob.incidentResolvedAt;
delete automaticJob.incidentAutomatic;
const automaticSettlement = settleMiningJob(automaticPlayer, automaticJob, automaticJob.readyAt + 1, () => 0.5);
assert.equal(automaticSettlement.incidentAutomatic, true);
assert.equal(
  automaticSettlement.incidentChoiceId,
  miningShiftIncidentById(automaticJob.incidentId).defaultChoiceId
);
assert.ok(miningShiftIncidentChoice(automaticSettlement.incidentId, automaticSettlement.incidentChoiceId));

const settlement = processMiningJobs(startedAt + 700, { rng: () => 0.5 });
assert.equal(settlement.changed, true);
assert.equal(player.mining.jobs.length, 0);
assert.ok(player.rough.some((rough) => rough.source === "mining"));
assert.ok(player.rough.some((rough) => rough.miningOrigin?.mineId === lease.mineId));
assert.ok(player.rough.some((rough) => rough.miningOrigin?.conditionId === shift.job.conditionId));
assert.equal(player.mining.stats.shifts, 1);
assert.ok(player.mining.stats.roughs >= 1);
assert.ok(player.mining.stats.totalMass > 0);
assert.equal(player.mining.stats.spent, shift.fee);
assert.equal(player.mining.stats.preparationSpent, 3_400);
assert.equal(player.mining.stats.incentiveSpent, 252);
assert.equal(player.mining.mineRecords[lease.mineId].shifts, 1);
assert.equal(player.mining.mineRecords[lease.mineId].roughs, player.mining.stats.roughs);
assert.equal(player.mining.mineRecords[lease.mineId].totalMass, player.mining.stats.totalMass);
assert.equal(player.mining.mineRecords[lease.mineId].lastConditionId, shift.job.conditionId);
assert.ok(player.mining.mineRecords[lease.mineId].clueProgress > 0);
assert.equal(settlement.results[0].mineMasteryBefore, 0);
assert.equal(settlement.results[0].mineMasteryAfter, 1);
assert.equal(settlement.results[0].mineMasteryLeveled, true);
assert.equal(settlement.results[0].crewBondBefore, 0);
assert.equal(settlement.results[0].crewBondAfter, 0);
assert.equal(settlement.results[0].crewBondLeveled, false);
assert.equal(player.mining.crewRecords[shift.job.crewKey].shifts, 1);
assert.ok(settlement.results[0].clueGain > 0);
assert.equal(settlement.results[0].surveyReportUsed, false);
assert.equal(settlement.results[0].incentiveId, "safety");
assert.equal(settlement.results[0].incentiveLabel, "安全津贴");
assert.equal(settlement.results[0].incentivePremium, 252);
assert.ok(settlement.results[0].minerConditions.every((condition) => condition.shiftFatigue === 28));
assert.ok(settlement.results[0].minerConditions.every((condition) => condition.moraleDelta === 3));
assert.ok(settlement.results[0].minerMorales.every((condition) => condition.before === 78 && condition.after === 81));
assert.equal(settlement.results[0].foremanId, expectedForeman.minerId);
assert.equal(settlement.results[0].foremanLabel, expectedForeman.label);
assert.deepEqual(settlement.results[0].roleAssignments, expectedRoles);
assert.equal(settlement.results[0].roleProgress.length, player.mining.miners.length);
assert.equal(settlement.results[0].incidentId, incident.id);
assert.equal(settlement.results[0].incidentChoiceId, riskyIncidentChoice.id);
assert.equal(settlement.results[0].incidentAutomatic, false);
assert.deepEqual(settlement.results[0].crewSpecializations, [`${trainee.name} · 寻脉师`]);
assert.equal(settlement.results[0].accidentChance, shift.job.estimate.risk,
  "the locked shift risk shown underground should match settlement");
const baseShiftExperience = { prospecting: 6, extraction: 8, safety: 6 };
for (const miner of player.mining.miners) {
  for (const skillKey of Object.keys(baseShiftExperience)) {
    const assignedRole = Object.entries(expectedRoles)
      .some(([roleKey, minerId]) => roleKey === skillKey && minerId === miner.id);
    assert.equal(
      miner.skills[skillKey].exp,
      skillExpBeforeShift[miner.id][skillKey] + baseShiftExperience[skillKey] + (assignedRole ? MINING_ROLE_EXPERIENCE : 0),
      `${miner.name} should gain base shift experience plus targeted role experience`
    );
  }
}
assert.ok(player.mining.history[0].totalMass > 0);
assert.ok(player.mining.history[0].note);
assert.ok(player.mining.history[0].accidentChance > 0);
assert.equal(player.mining.history[0].facilities.survey, 1);
assert.equal(player.mining.history[0].conditionId, shift.job.conditionId);
assert.deepEqual(player.mining.history[0].preparationNames, ["岩芯取样箱", "预制支护架"]);
assert.equal(player.mining.history[0].minerMorales.length, 2);
assert.equal(player.mining.history[0].foremanId, expectedForeman.minerId);
assert.ok(player.rough.some((rough) => rough.miningOrigin?.foremanId === expectedForeman.minerId));
assert.ok(player.rough.some((rough) => rough.miningOrigin?.foremanLabel === expectedForeman.label));
assert.ok(player.rough.some((rough) => rough.miningOrigin?.roleLabels?.length === player.mining.miners.length));
assert.ok(player.rough.some((rough) => rough.miningOrigin?.incidentName === incident.name));
assert.ok(player.rough.some((rough) => rough.miningOrigin?.incidentChoiceLabel === riskyIncidentChoice.label));
assert.ok(player.rough.some((rough) => rough.miningOrigin?.incentiveLabel === "安全津贴"));
assert.ok(player.rough.some((rough) => rough.miningOrigin?.crewSpecializations?.includes(`${trainee.name} · 寻脉师`)));
assert.equal(player.mining.leaseHistory[0].shiftsStarted, 1);
assert.ok(player.mining.miners.every((miner) => miner.fatigue > 0));
assert.equal(trainee.shiftsWorked, 4);
assert.equal(unspecializedMiner.shiftsWorked, 4);
assert.equal(miningMinerContractInfo(trainee).remaining, 11);
assert.equal(miningMinerContractInfo(unspecializedMiner).remaining, 5);
assert.deepEqual(settlement.results[0].minerContracts.map((entry) => entry.remaining), [11, 5]);

const masteryProbe = makePlayer("mining-mastery-probe");
normalizePlayer(masteryProbe);
masteryProbe.mining.miners = ["a", "b"].map((suffix) => ({
  id: `mastery-miner-${suffix}`,
  name: `档案矿工${suffix}`,
  tier: 1,
  trait: "",
  flaw: "",
  baseWage: 360,
  fatigue: 0,
  fatigueAt: startedAt,
  injuredUntil: null,
  skills: {
    prospecting: { level: 1, exp: 0 },
    extraction: { level: 1, exp: 0 },
    safety: { level: 1, exp: 0 }
  }
}));
masteryProbe.mining.mineRecords["mist-01"] = {
  shifts: 3,
  roughs: 8,
  totalMass: 12.4,
  accidents: 0,
  clueProgress: 90,
  surveyReports: 0,
  reportsCompleted: 0,
  lastMinedAt: startedAt,
  lastConditionId: "stable"
};
const masteryCrewKey = masteryProbe.mining.miners.map((miner) => miner.id).sort().join("|");
masteryProbe.mining.crewRecords[masteryCrewKey] = {
  shifts: 5,
  minerIds: masteryProbe.mining.miners.map((miner) => miner.id).sort(),
  minerNames: masteryProbe.mining.miners.map((miner) => miner.name),
  lastWorkedAt: startedAt
};
const masterySettlement = settleMiningJob(masteryProbe, {
  id: "mastery-job",
  status: "active",
  roundId: "mastery-round",
  leaseId: "mastery-lease",
  mineId: "mist-01",
  mineName: "白雾浅坑",
  strategyId: "standard",
  strategyLabel: "标准",
  minerIds: masteryProbe.mining.miners.map((miner) => miner.id),
  foremanId: masteryProbe.mining.miners[0].id,
  foremanName: masteryProbe.mining.miners[0].name,
  foremanFocus: "safety",
  foremanLabel: "安全指挥",
  foremanBonus: MINING_FOREMAN_BONUS,
  conditionId: "seepage",
  conditionName: "裂隙渗水",
  preparationIds: [],
  preparationNames: [],
  preparationCost: 0,
  facilities: { survey: 0, drill: 0, support: 0, haulage: 0 },
  mineMasteryLevel: 2,
  crewKey: masteryCrewKey,
  crewBondLevel: 2,
  surveyReportUsed: true,
  startedAt,
  readyAt: startedAt + 500,
  durationMs: 500,
  cost: 0
}, startedAt + 500, () => 0.99);
assert.equal(masterySettlement.mineMasteryBefore, 2);
assert.equal(masterySettlement.mineMasteryAfter, 2);
assert.equal(masterySettlement.crewBondBefore, 2);
assert.equal(masterySettlement.crewBondAfter, 2);
assert.equal(masterySettlement.crewBondLeveled, false);
assert.equal(masterySettlement.accidentChance, 0.01, "safety command should stack with old-crew safety and reach the risk floor");
assert.equal(masterySettlement.foremanFocus, "safety");
assert.equal(masterySettlement.foremanLabel, "安全指挥");
assert.ok(masterySettlement.minerConditions.every((condition) => condition.shiftFatigue === 28));
assert.ok(masterySettlement.clueGain > 0);
assert.equal(masterySettlement.surveyReportUsed, true);
assert.equal(masterySettlement.surveyReportsCreated, 1);
assert.equal(masterySettlement.surveyReportsAvailable, 1);
assert.equal(masteryProbe.mining.mineRecords["mist-01"].reportsCompleted, 1);
const masteryRoughs = masteryProbe.rough.filter((rough) => rough.source === "mining");
assert.ok(masteryRoughs.length > 0);
assert.ok(masteryRoughs.every((rough) => rough.miningOrigin?.mineMasteryLevel === 2));
assert.ok(masteryRoughs.every((rough) => rough.miningOrigin?.crewBondLevel === 2));
assert.ok(masteryRoughs.every((rough) => rough.miningOrigin?.crewNames?.length === 2));
assert.ok(masteryRoughs.every((rough) => rough.miningOrigin?.surveyReportUsed === true));
assert.ok(masteryRoughs.every((rough) => rough.miningOrigin?.foremanId === "mastery-miner-a"));
assert.ok(masteryRoughs.every((rough) => rough.miningOrigin?.foremanLabel === "安全指挥"));
assert.equal(masteryProbe.mining.crewRecords[masteryCrewKey].shifts, 6);
const dismissedCrewMiner = dismissMiner(masteryProbe, masteryProbe.mining.miners[0].id);
assert.equal(dismissedCrewMiner.ok, true);
assert.equal(masteryProbe.mining.crewRecords[masteryCrewKey], undefined, "dismissing a miner should retire their exact-crew record");

const maxHaulage = upgradeMiningFacility(player, "haulage", startedAt + 710);
assert.equal(maxHaulage.ok, true);
assert.equal(maxHaulage.level, 3);
const cashAtMax = player.cash;
const cappedHaulage = upgradeMiningFacility(player, "haulage", startedAt + 711);
assert.equal(cappedHaulage.ok, false);
assert.match(cappedHaulage.message, /最高等级/);
assert.equal(player.cash, cashAtMax);
assert.equal(player.mining.facilities.haulage, 3);

player.mining.mineRecords[lease.mineId].surveyReports = 1;
for (const miner of player.mining.miners) {
  miner.fatigue = 0;
  miner.fatigueAt = startedAt + 715;
}
const reportShift = startMiningShift(player, {
  minerIds: player.mining.miners.map((miner) => miner.id),
  strategyId: "standard",
  useSurveyReport: true
}, startedAt + 720);
assert.equal(reportShift.ok, true);
assert.equal(reportShift.job.incentiveId, "standard", "legacy clients should default to standard wages");
assert.equal(reportShift.job.incentivePremium, 0);
assert.equal(reportShift.job.mineMasteryLevel, 1);
assert.equal(reportShift.job.crewKey, shift.job.crewKey);
assert.equal(reportShift.job.crewBondLevel, 0, "the second shift should use the bond level frozen before it starts");
assert.equal(reportShift.job.surveyReportUsed, true);
assert.equal(player.mining.mineRecords[lease.mineId].surveyReports, 0, "survey report should be consumed at shift start");
const reportSettlement = processMiningJobs(startedAt + 1_200, { rng: () => 0.99 });
assert.equal(reportSettlement.changed, true);
assert.equal(reportSettlement.results[0].surveyReportUsed, true);
assert.equal(reportSettlement.results[0].crewBondBefore, 0);
assert.equal(reportSettlement.results[0].crewBondAfter, 1);
assert.equal(reportSettlement.results[0].crewBondLeveled, true);
assert.equal(player.mining.crewRecords[shift.job.crewKey].shifts, 2);
assert.ok(reportSettlement.results[0].clueGain > 0);
assert.ok(player.mining.miners.every((miner) => miner.morale === 80));

player.mining.miners[0].fatigue = 80;
player.mining.miners[0].fatigueAt = startedAt + 1_200;
const tiredShift = startMiningShift(player, {
  minerIds: player.mining.miners.map((miner) => miner.id),
  strategyId: "standard"
}, startedAt + 1_300);
assert.equal(tiredShift.ok, false);
assert.match(tiredShift.message, /疲劳/);

const injuredMiner = player.mining.miners[0];
injuredMiner.injuredUntil = startedAt + 1_300 + (9 * 60 * 60 * 1000);
const firstTreatment = careForMiner(player, injuredMiner.id, "treatment", startedAt + 1_300, { spendCash });
assert.equal(firstTreatment.ok, true);
assert.equal(firstTreatment.injuryBefore, 9 * 60 * 60 * 1000);
assert.equal(firstTreatment.injuryAfter, 3 * 60 * 60 * 1000);
assert.equal(firstTreatment.fatigueAfter, 70);
const secondTreatment = careForMiner(player, injuredMiner.id, "treatment", startedAt + 1_300, { spendCash });
assert.equal(secondTreatment.ok, true);
assert.equal(secondTreatment.injuryAfter, 0);
assert.equal(injuredMiner.injuredUntil, null);
assert.equal(injuredMiner.fatigue, 60);
assert.equal(injuredMiner.morale, 96);
assert.equal(player.mining.stats.careSpent, 12_600);
assert.equal(player.mining.stats.careActions, 4);
assert.equal(player.mining.stats.moraleRecovered, 40);

const retentionPlayer = makePlayer("retention-player");
retentionPlayer.cash = 100_000;
normalizePlayer(retentionPlayer);
const retentionMiner = structuredClone(trainee);
retentionMiner.id = "retention-miner";
retentionMiner.name = "留任测试矿工";
retentionMiner.morale = 20;
retentionMiner.leaveUntil = null;
retentionMiner.retentionCase = null;
retentionMiner.fatigue = 0;
retentionMiner.injuredUntil = null;
retentionPlayer.mining.miners = [retentionMiner];
retentionPlayer.mining.jobs = [];
const leaveEventAt = startedAt + 2_000;
const leaveEvent = applyMinerRetentionAfterShift(retentionMiner, leaveEventAt);
assert.equal(leaveEvent.type, "leave");
assert.equal(leaveEvent.created, true);
assert.equal(retentionMiner.leaveUntil, leaveEventAt + MINER_PERSONAL_LEAVE_MS);
assert.equal(miningMinerRetentionInfo(retentionMiner, leaveEventAt + 1).id, "leave");
assert.equal(minerReadiness(retentionMiner, leaveEventAt + 1).ok, false);

retentionMiner.leaveUntil = null;
retentionMiner.morale = 10;
const resignation = applyMinerRetentionAfterShift(retentionMiner, leaveEventAt + 10);
assert.equal(resignation.type, "resignation");
assert.equal(resignation.created, true);
assert.equal(miningMinerRetentionInfo(retentionMiner, leaveEventAt + 11).pending, true);
assert.equal(minerReadiness(retentionMiner, leaveEventAt + 11).ok, false);
const cashBeforeRetention = retentionPlayer.cash;
const conversation = resolveMinerRetention(
  retentionPlayer,
  retentionMiner.id,
  "conversation",
  leaveEventAt + 12,
  { spendCash }
);
assert.equal(conversation.ok, true);
assert.equal(conversation.departed, false);
assert.equal(conversation.fee, retentionMiner.baseWage * 2);
assert.equal(retentionPlayer.cash, cashBeforeRetention - conversation.fee);
assert.equal(retentionMiner.morale, 45);
assert.equal(retentionMiner.retentionCase, null);
assert.equal(retentionPlayer.mining.stats.retentionSuccesses, 1);
assert.equal(retentionPlayer.mining.stats.retentionSpent, conversation.fee);

retentionMiner.morale = 5;
applyMinerRetentionAfterShift(retentionMiner, leaveEventAt + 20);
const contractBeforeBonus = retentionMiner.contractShiftsRemaining;
const bonusRetention = resolveMinerRetention(
  retentionPlayer,
  retentionMiner.id,
  "bonus",
  leaveEventAt + 21,
  { spendCash }
);
assert.equal(bonusRetention.ok, true);
assert.equal(retentionMiner.morale, 70);
assert.equal(retentionMiner.contractShiftsRemaining, Math.min(12, contractBeforeBonus + 2));

retentionMiner.morale = 0;
applyMinerRetentionAfterShift(retentionMiner, leaveEventAt + 30);
retentionPlayer.mining.crewRecords[retentionMiner.id] = {
  shifts: 1,
  minerIds: [retentionMiner.id],
  minerNames: [retentionMiner.name],
  lastWorkedAt: leaveEventAt
};
const departure = resolveMinerRetention(
  retentionPlayer,
  retentionMiner.id,
  "release",
  leaveEventAt + 31,
  { spendCash }
);
assert.equal(departure.ok, true);
assert.equal(departure.departed, true);
assert.equal(retentionPlayer.mining.miners.length, 0);
assert.equal(retentionPlayer.mining.crewRecords[retentionMiner.id], undefined);
assert.equal(retentionPlayer.mining.stats.minerDepartures, 1);

const mentorshipPlayer = makePlayer("mentorship-player");
mentorshipPlayer.cash = 100_000;
normalizePlayer(mentorshipPlayer);
const mentorMiner = {
  id: "mentor-miner",
  name: "带教师傅",
  tier: 3,
  trait: "谨慎",
  flaw: "怕潮",
  baseWage: 630,
  morale: 50,
  fatigue: 0,
  fatigueAt: startedAt,
  injuredUntil: null,
  shiftsWorked: 3,
  skills: {
    prospecting: { level: 5, exp: 0 },
    extraction: { level: 5, exp: 0 },
    safety: { level: 5, exp: 0 }
  }
};
const apprenticeMiner = {
  id: "apprentice-miner",
  name: "见习矿工",
  tier: 1,
  trait: "耐劳",
  flaw: "手松",
  baseWage: 360,
  morale: 50,
  fatigue: 0,
  fatigueAt: startedAt,
  injuredUntil: null,
  shiftsWorked: 0,
  skills: {
    prospecting: { level: 1, exp: 0 },
    extraction: { level: 1, exp: 0 },
    safety: { level: 1, exp: 0 }
  }
};
mentorshipPlayer.mining.miners = [mentorMiner, apprenticeMiner];
mentorshipPlayer.mining.jobs = [];
const mentorshipCashBefore = mentorshipPlayer.cash;
const formedMentorship = formMinerMentorship(
  mentorshipPlayer,
  mentorMiner.id,
  apprenticeMiner.id,
  startedAt + 3_000,
  { spendCash }
);
assert.equal(formedMentorship.ok, true);
assert.equal(formedMentorship.fee, 1_260);
assert.equal(mentorshipPlayer.cash, mentorshipCashBefore - 1_260);
assert.equal(mentorshipPlayer.mining.stats.mentorshipsFormed, 1);
assert.equal(mentorshipPlayer.mining.stats.mentorshipSpent, 1_260);
assert.equal(formMinerMentorship(
  mentorshipPlayer,
  mentorMiner.id,
  apprenticeMiner.id,
  startedAt + 3_001,
  { spendCash }
).ok, false, "a miner cannot join two active mentorships");
for (let index = 1; index <= MINER_MENTORSHIP_REQUIRED_SHIFTS; index += 1) {
  const events = applyMinerMentorshipsForShift(
    mentorshipPlayer,
    [mentorMiner.id, apprenticeMiner.id],
    { safety: mentorMiner.id, prospecting: apprenticeMiner.id },
    startedAt + 3_000 + index
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].sharedShifts, index);
  assert.equal(events[0].completed, index === MINER_MENTORSHIP_REQUIRED_SHIFTS);
}
assert.equal(mentorshipPlayer.mining.mentorships.find((entry) => entry.id === formedMentorship.mentorship.id).status, "completed");
assert.equal(mentorshipPlayer.mining.stats.mentorshipsCompleted, 1);
assert.equal(apprenticeMiner.skills.prospecting.level, 2);
assert.equal(apprenticeMiner.skills.prospecting.exp, 10);
assert.equal(mentorMiner.morale, 57);
assert.equal(apprenticeMiner.morale, 64);
assert.equal(endMinerMentorship(mentorshipPlayer, formedMentorship.mentorship.id, startedAt + 3_010).ok, false);
const secondMentorship = formMinerMentorship(
  mentorshipPlayer,
  mentorMiner.id,
  apprenticeMiner.id,
  startedAt + 3_020,
  { spendCash }
);
assert.equal(secondMentorship.ok, true, "completed pairs may begin a new coaching cycle");
assert.equal(endMinerMentorship(mentorshipPlayer, secondMentorship.mentorship.id, startedAt + 3_021).ok, true);
assert.equal(mentorshipPlayer.mining.mentorships.find((entry) => entry.id === secondMentorship.mentorship.id).status, "ended");
const settlementMentorship = formMinerMentorship(
  mentorshipPlayer,
  mentorMiner.id,
  apprenticeMiner.id,
  startedAt + 3_030,
  { spendCash }
);
assert.equal(settlementMentorship.ok, true);
const mentorshipSettlement = settleMiningJob(mentorshipPlayer, {
  id: "mentorship-job",
  status: "active",
  roundId: "mentorship-round",
  leaseId: "mentorship-lease",
  mineId: "mist-01",
  mineName: "白雾浅坑",
  strategyId: "standard",
  strategyLabel: "标准",
  minerIds: [mentorMiner.id, apprenticeMiner.id],
  foremanId: mentorMiner.id,
  foremanName: mentorMiner.name,
  foremanFocus: "safety",
  foremanLabel: "安全指挥",
  foremanBonus: MINING_FOREMAN_BONUS,
  roleAssignments: { safety: mentorMiner.id, prospecting: apprenticeMiner.id },
  conditionId: "stable",
  conditionName: "岩层稳定",
  preparationIds: [],
  preparationNames: [],
  preparationCost: 0,
  facilities: { survey: 0, drill: 0, support: 0, haulage: 0 },
  mineMasteryLevel: 0,
  crewKey: [mentorMiner.id, apprenticeMiner.id].sort().join("|"),
  crewBondLevel: 0,
  surveyReportUsed: false,
  startedAt: startedAt + 3_030,
  readyAt: startedAt + 3_530,
  durationMs: 500,
  cost: 0
}, startedAt + 3_530, () => 0.99);
assert.equal(mentorshipSettlement.mentorshipEvents.length, 1);
assert.equal(mentorshipSettlement.mentorshipEvents[0].sharedShifts, 1);
assert.equal(mentorshipSettlement.mentorshipEvents[0].apprenticeRole, "prospecting");
assert.equal(mentorshipPlayer.mining.history[0].mentorshipEvents[0].mentorshipId, settlementMentorship.mentorship.id);

const conditionProbe = {
  id: "condition-probe",
  name: "伤停测试矿工",
  trait: "耐劳",
  fatigue: 0,
  fatigueAt: startedAt,
  injuredUntil: null
};
const changedCondition = applyMinerShiftCondition(
  conditionProbe,
  "deep",
  startedAt + 1000,
  startedAt + 1000,
  { injured: true }
);
assert.equal(changedCondition.shiftFatigue, 34);
assert.ok(changedCondition.injuredUntil > startedAt + 1000);
assert.equal(minerReadiness(conditionProbe, startedAt + 1001).ok, false);
assert.match(minerReadiness(conditionProbe, startedAt + 1001).reason, /伤停/);

const storedLeasePlayerName = lease.playerName;
delete lease.playerName;
const snapshot = snapshotFor(player, startedAt + 1_300, { includeStaticCatalogs: false });
assert.equal(snapshot.mining.unlocked, true);
assert.equal(snapshot.mining.myLease.playerId, player.id);
assert.equal(snapshot.mining.myLease.playerName, player.name);
assert.equal(
  snapshot.mining.currentRound.leases.find((entry) => entry.playerId === player.id)?.playerName,
  player.name,
  "old leases should recover the player name for the map and detail dialog"
);
assert.equal(snapshot.me.mining.miners.length, 2);
assert.equal(snapshot.me.mining.facilities.haulage, 3);
assert.equal(snapshot.mining.baseShiftMs, 500);
assert.equal(snapshot.mining.shiftMs, 425);
assert.ok(snapshot.me.rough.some((rough) => rough.miningOrigin?.mineId === lease.mineId));
assert.ok(snapshot.me.rough.some((rough) => rough.miningOrigin?.mineMasteryLevel === 0));
assert.equal(snapshot.me.mining.mineRecords[lease.mineId].shifts, 2);
assert.equal(snapshot.me.mining.crewRecords[shift.job.crewKey].shifts, 2);
assert.ok(snapshot.me.rough.every((rough) => rough.imperialChanceMultiplier === undefined));
lease.playerName = storedLeasePlayerName;

const persisted = world.exportSnapshot({ savedAt: startedAt + 1_300 });
assert.ok(persisted.mining.currentRound.leases.length >= 1);
const restoredWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
restoredWorld.importSnapshot(persisted);
assert.equal(restoredWorld.raw.mining.currentRound.number, 1);
assert.equal(restoredWorld.getPlayer(player.id).mining.miners.length, 2);
assert.equal(restoredWorld.getPlayer(player.id).mining.facilities.support, 1);
assert.equal(restoredWorld.getPlayer(player.id).mining.stats.preparationSpent, 3_400);
assert.equal(restoredWorld.getPlayer(player.id).mining.stats.incentiveSpent, 252);
assert.equal(restoredWorld.getPlayer(player.id).mining.mineRecords[lease.mineId].shifts, 2);
assert.equal(restoredWorld.getPlayer(player.id).mining.crewRecords[shift.job.crewKey].shifts, 2);
assert.equal(restoredWorld.getPlayer(player.id).mining.miners.find((miner) => miner.id === trainee.id).specializationId, "veinReader");
assert.equal(restoredWorld.getPlayer(player.id).mining.miners.find((miner) => miner.id === trainee.id).shiftsWorked, 5);
assert.equal(restoredWorld.getPlayer(player.id).mining.miners.find((miner) => miner.id === trainee.id).tier, 2);
assert.equal(restoredWorld.getPlayer(player.id).mining.miners.find((miner) => miner.id === trainee.id).promotions, 1);
assert.equal(restoredWorld.getPlayer(player.id).mining.stats.promotionSpent, 1_800);
assert.equal(restoredWorld.getPlayer(player.id).mining.miners.find((miner) => miner.id === trainee.id).contractShiftsRemaining, 10);
assert.equal(restoredWorld.getPlayer(player.id).mining.miners.find((miner) => miner.id === unspecializedMiner.id).contractShiftsRemaining, 4);
assert.equal(restoredWorld.getPlayer(player.id).mining.miners.find((miner) => miner.id === trainee.id).morale, 96);
assert.equal(restoredWorld.getPlayer(player.id).mining.miners.find((miner) => miner.id === unspecializedMiner.id).morale, 80);

console.log("mining service smoke: ok");
