import assert from "node:assert/strict";
import { MINES } from "../shared/domain/mining/mining-rules.js";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "1";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "4000";
process.env.JADE_MINING_SHIFT_MS = "100";
process.env.JADE_MINING_TUNING_REVIEWER_IDS = "tuning-governance-player";

const { __testHooks } = await import(`../server.js?mining-tuning-governance=${Date.now()}`);
const {
  world,
  state,
  makePlayer,
  normalizePlayer,
  processMiningWorld,
  submitMiningApplication,
  saveMiningTuningExperiment,
  reviewMiningTuningExperiment,
  cancelMiningTuningVersion,
  rollbackMiningTuningVersion,
  inspectMiningHealth,
  snapshotFor
} = __testHooks;

const startedAt = 1_900_000_000_000;
const player = makePlayer("tuning-governance-player");
player.name = "数值审核员";
player.cash = 1_000_000;
player.lastSeenAt = startedAt;
normalizePlayer(player);
world.setPlayer(player);
processMiningWorld(startedAt);

const saved = saveMiningTuningExperiment(player, { mist: "rent-5" }, startedAt + 1);
assert.equal(saved.ok, true);
const experiment = player.mining.tuningExperiments[0];
const sandboxBands = snapshotFor(player, startedAt + 2).mining.economyTuningSandbox.bands;
const representativeMines = MINES.filter((mine, index, rows) => (
  rows.findIndex((entry) => entry.beltId === mine.beltId) === index
));

state.mining.history = Array.from({ length: 3 }, (_, roundIndex) => {
  const number = roundIndex + 1;
  const leases = representativeMines.map((mine, beltIndex) => ({
    id: `governance-lease-${number}-${mine.id}`,
    roundId: `governance-round-${number}`,
    roundNumber: number,
    playerId: `sample-player-${beltIndex}`,
    playerName: `样本玩家${beltIndex + 1}`,
    mineId: mine.id,
    rent: mine.rent,
    startsAt: startedAt - (4 - number) * 10_000,
    endsAt: startedAt - (4 - number) * 10_000 + 9_000,
    shiftsStarted: 5,
    maxShifts: 5
  }));
  const economyShifts = leases.flatMap((lease) => {
    const mine = MINES.find((entry) => entry.id === lease.mineId);
    const forecastRow = experiment.rows.find((row) => row.beltId === mine.beltId);
    const baselineBand = sandboxBands.find((band) => band.beltId === mine.beltId);
    const outputPerShift = Math.round(forecastRow?.projected?.outputPerShift || baselineBand.outputPerShift);
    const allInCost = Math.round(forecastRow?.projected?.allInCost || baselineBand.allInCost);
    const allocatedRent = Math.round(lease.rent / 5);
    const operatingCost = Math.max(0, allInCost - allocatedRent);
    return Array.from({ length: 5 }, (_, shiftIndex) => ({
      id: `governance-shift-${number}-${mine.id}-${shiftIndex}`,
      playerId: lease.playerId,
      mineId: mine.id,
      estimatedOutputValue: outputPerShift,
      benchmarkOutputValue: outputPerShift,
      operatingCost,
      allocatedRent,
      estimatedNet: outputPerShift - operatingCost - allocatedRent
    }));
  });
  return {
    id: `governance-round-${number}`,
    number,
    startsAt: leases[0].startsAt,
    endsAt: leases[0].endsAt,
    allocatedAt: leases[0].startsAt,
    leases,
    economyShifts
  };
});
state.mining.currentRound = {
  id: "governance-current-round",
  number: 4,
  startsAt: startedAt,
  endsAt: startedAt + 4_000,
  leaseMs: 4_000,
  applicationMs: 100,
  allocatedAt: startedAt,
  leases: []
};

const readySnapshot = snapshotFor(player, startedAt + 1_000).mining;
assert.equal(readySnapshot.tuningExperiments[0].assessment.id, "review-ready");
assert.equal(readySnapshot.tuningExperiments[0].canEnterReview, true);

const review = reviewMiningTuningExperiment(player, experiment.id, startedAt + 1_000);
assert.equal(review.ok, true);
assert.equal(review.version.status, "scheduled");
assert.equal(review.version.scheduledRoundNumber, 5);
assert.equal(review.version.rules.mist.rentMultiplier, 0.95);
assert.equal(review.version.effectBaseline.actualRows.length, 1);
assert.ok(review.version.effectBaseline.actual.estimatedNet > 0);
assert.ok(review.version.rows[0].projected.estimatedNet > 0);
assert.match(review.message, /正式版本 V1/);
assert.equal(reviewMiningTuningExperiment(player, experiment.id, startedAt + 1_001).ok, false);

const pendingSnapshot = snapshotFor(player, startedAt + 1_002).mining;
assert.equal(pendingSnapshot.tuningGovernance.pendingVersion.number, 1);
assert.equal(pendingSnapshot.tuningGovernance.activeVersion, null);
assert.equal(pendingSnapshot.tuningGovernance.canManage, true);
assert.equal(pendingSnapshot.tuningGovernance.reviewerMode, "configured");
assert.equal(pendingSnapshot.tuningExperiments[0].governance.status, "scheduled");
assert.equal(pendingSnapshot.tuningExperiments[0].canEnterReview, false);
assert.equal(pendingSnapshot.effectiveMines.find((mine) => mine.id === "mist-01").rent, 28_000,
  "a scheduled version must not rewrite the current round");
const unauthorizedPlayer = makePlayer("unauthorized-reviewer");
unauthorizedPlayer.name = "普通玩家";
normalizePlayer(unauthorizedPlayer);
world.setPlayer(unauthorizedPlayer);
const unauthorizedCancel = cancelMiningTuningVersion(
  unauthorizedPlayer,
  review.version.id,
  startedAt + 1_003
);
assert.equal(unauthorizedCancel.ok, false);
assert.match(unauthorizedCancel.message, /只有矿务数值审核员/);

processMiningWorld(startedAt + 4_000);
assert.equal(state.mining.currentRound.number, 5);
assert.equal(state.mining.tuningVersions[0].status, "active");
assert.equal(state.mining.currentRound.tuningVersionId, review.version.id);
const activeSnapshot = snapshotFor(player, startedAt + 4_001).mining;
assert.equal(activeSnapshot.tuningGovernance.activeVersion.number, 1);
assert.equal(activeSnapshot.tuningGovernance.activeVersion.effectReport.status, "collecting");
assert.equal(activeSnapshot.tuningGovernance.activeVersion.effectReport.observedRoundCount, 0);
assert.equal(activeSnapshot.tuningGovernance.activeVersion.effectReport.assessment.id, "collecting");
assert.equal(activeSnapshot.effectiveMines.find((mine) => mine.id === "mist-01").rent, 26_600);
assert.equal(inspectMiningHealth(startedAt + 4_001).ok, true,
  "the operational audit must accept the version-adjusted rent");
const overlappingExperiment = {
  ...structuredClone(experiment),
  id: "overlapping-adjustment-observation",
  createdAt: startedAt + 4_001
};
player.mining.tuningExperiments.unshift(overlappingExperiment);
const blockedOverlap = reviewMiningTuningExperiment(
  player,
  overlappingExperiment.id,
  startedAt + 4_001
);
assert.equal(blockedOverlap.ok, false);
assert.match(blockedOverlap.message, /观察期.*不能叠加普通调整/);

const rollback = rollbackMiningTuningVersion(player, review.version.id, startedAt + 4_002);
assert.equal(rollback.ok, true);
assert.equal(rollback.version.kind, "rollback");
assert.equal(rollback.version.scheduledRoundNumber, 6);
assert.equal(rollback.version.rules.mist.rentMultiplier, 1);
assert.match(rollback.message, /恢复初始数值/);

const rollbackRoundApplication = submitMiningApplication(player, ["mist-01"], startedAt + 7_950);
assert.equal(rollbackRoundApplication.ok, true);
assert.equal(rollbackRoundApplication.application.targetRound, 6);
assert.equal(rollbackRoundApplication.application.escrow, 28_000,
  "applications must quote the already-scheduled rollback rules for their target round");

processMiningWorld(startedAt + 8_000);
assert.equal(state.mining.currentRound.number, 6);
assert.equal(state.mining.activeTuningVersionId, rollback.version.id);
const rolledBackSnapshot = snapshotFor(player, startedAt + 8_001).mining;
assert.equal(rolledBackSnapshot.effectiveMines.find((mine) => mine.id === "mist-01").rent, 28_000);
assert.equal(rolledBackSnapshot.tuningGovernance.activeVersion.kind, "rollback");
const archivedAdjustment = rolledBackSnapshot.tuningGovernance.versions
  .find((entry) => entry.id === review.version.id);
assert.equal(archivedAdjustment.effectReport.status, "interrupted");
assert.equal(archivedAdjustment.effectReport.assessment.id, "interrupted");
assert.deepEqual(archivedAdjustment.effectReport.observedRoundNumbers, [5],
  "emergency rollback must archive only rounds that actually used the superseded version");
assert.equal(state.mining.currentRound.leases.find((lease) => lease.playerId === player.id)?.rent, 28_000);

const restorePrevious = rollbackMiningTuningVersion(player, rollback.version.id, startedAt + 8_002);
assert.equal(restorePrevious.ok, true);
assert.equal(restorePrevious.version.rules.mist.rentMultiplier, 0.95);
const cancelled = cancelMiningTuningVersion(player, restorePrevious.version.id, startedAt + 8_003);
assert.equal(cancelled.ok, true);
assert.equal(cancelled.version.status, "cancelled");

const overlapSafeRollback = rollbackMiningTuningVersion(player, rollback.version.id, startedAt + 11_950);
assert.equal(overlapSafeRollback.ok, true);
assert.equal(overlapSafeRollback.version.scheduledRoundNumber, 8,
  "an open round-7 application window must push the change to round 8");
assert.equal(cancelMiningTuningVersion(player, overlapSafeRollback.version.id, startedAt + 11_951).ok, true);

processMiningWorld(startedAt + 12_000);
processMiningWorld(startedAt + 16_000);
processMiningWorld(startedAt + 20_000);
const finalizedRollbackSnapshot = snapshotFor(player, startedAt + 20_001).mining;
assert.equal(finalizedRollbackSnapshot.tuningGovernance.activeVersion.id, rollback.version.id);
assert.equal(finalizedRollbackSnapshot.tuningGovernance.activeVersion.effectReport.status, "insufficient");
assert.deepEqual(finalizedRollbackSnapshot.tuningGovernance.activeVersion.effectReport.observedRoundNumbers, [6, 7, 8]);
assert.equal(state.mining.tuningVersions.find((entry) => entry.id === rollback.version.id)
  .effectResult.status, "insufficient", "a finished three-round report must be frozen on the version");

const persisted = world.exportSnapshot({ savedAt: startedAt + 20_002 });
const restoredWorld = (await import("../server/world-store.js")).createMemoryWorldStore();
restoredWorld.importSnapshot(persisted);
assert.equal(restoredWorld.raw.mining.activeTuningVersionId, rollback.version.id);
assert.equal(restoredWorld.raw.mining.tuningVersions.length, 4);
assert.ok(restoredWorld.raw.mining.tuningVersions.find((entry) => entry.id === review.version.id)
  .effectBaseline.actualRows.length > 0, "the pre-activation baseline must survive persistence");
assert.equal(restoredWorld.raw.mining.tuningVersions.find((entry) => entry.id === review.version.id)
  .effectResult.status, "interrupted", "the finalized effect audit must survive persistence");

console.log("mining-tuning-governance-smoke: review, safe activation, audit history and rollback ok");
