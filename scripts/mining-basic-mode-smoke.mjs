import assert from "node:assert/strict";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "1";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "4000";
process.env.JADE_MINING_SHIFT_MS = "500";
process.env.JADE_MINING_BASIC_MODE = "1";

const { __testHooks } = await import(`../server.js?mining-basic-smoke=${Date.now()}`);
const {
  world,
  state,
  makePlayer,
  normalizePlayer,
  processMiningWorld,
  submitMiningApplication,
  refreshMinerRecruitCandidates,
  recruitMiner,
  dismissMiner,
  upgradeMiningFacility,
  startMiningShift,
  processMiningJobs,
  snapshotFor,
  spendCash
} = __testHooks;

const startedAt = 1_900_000_000_000;
const player = makePlayer("basic-mining-player");
player.name = "基础矿山测试掌柜";
player.cash = 100_000;
player.lastSeenAt = startedAt;
normalizePlayer(player);
world.setPlayer(player);

assert.equal(processMiningWorld(startedAt).unlocked, true);
assert.equal(player.mining.starterMinerGranted, true);
assert.equal(player.mining.miners.length, 1, "basic mode should grant one starter miner with the license");
const starterMiner = player.mining.miners[0];
assert.equal(starterMiner.tier, 1);
assert.equal(starterMiner.price, undefined);
processMiningWorld(startedAt + 1);
assert.equal(player.mining.miners.length, 1, "the starter miner grant must be idempotent");
const cashBeforeInvalidApplication = player.cash;
player.cash -= 5_000;
state.mining.applications.push(
  null,
  {
    id: "invalid-preference-application",
    playerId: player.id,
    playerName: player.name,
    targetRound: 1,
    preferences: ["missing-mine"],
    escrow: 5_000,
    allowFallback: true,
    submittedAt: startedAt + 1
  }
);
assert.equal(processMiningWorld(startedAt + 2).changed, true);
assert.equal(state.mining.applications.length, 0,
  "invalid pending applications should be removed before allocation");
assert.equal(player.cash, cashBeforeInvalidApplication,
  "a discarded pending application should return its recorded escrow");
const blockedDismissal = dismissMiner(player, starterMiner.id, { minimumRoster: 1 });
assert.equal(blockedDismissal.ok, false);
assert.match(blockedDismissal.message, /至少需要保留 1 名矿工/);
assert.equal(player.mining.miners.length, 1, "basic mode must protect the last playable miner");

const recoveryPlayer = makePlayer("basic-mining-recovery-player");
recoveryPlayer.lastSeenAt = startedAt;
normalizePlayer(recoveryPlayer);
recoveryPlayer.mining.licenseAt = startedAt;
recoveryPlayer.mining.starterMinerGranted = true;
recoveryPlayer.mining.miners = [];
world.setPlayer(recoveryPlayer);
processMiningWorld(startedAt + 2);
assert.equal(recoveryPlayer.mining.miners.length, 1,
  "legacy saves with an empty basic roster should automatically recover one starter miner");
const application = submitMiningApplication(player, ["mist-01"], startedAt + 10);
assert.equal(application.ok, true);
assert.match(application.message, /接受空闲矿山调剂/);
const cashBeforeDuplicateRepair = player.cash;
state.mining.applications.push({
  ...structuredClone(application.application),
  id: "duplicate-application",
  submittedAt: application.application.submittedAt + 1
});
assert.equal(processMiningWorld(startedAt + 11).changed, true);
assert.equal(state.mining.applications.length, 1,
  "duplicate applications from the same player and round should collapse to one record");
assert.equal(player.cash, cashBeforeDuplicateRepair,
  "deduplicating one held application must not refund its escrow twice");
processMiningWorld(startedAt + 100);
const lease = state.mining.currentRound.leases.find((entry) => entry.playerId === player.id);
assert.ok(lease);
assert.equal(lease.maxShifts, 5);
assert.equal(lease.rent, 28_000);
const activeLeaseHistory = player.mining.leaseHistory.find((entry) => entry.id === lease.id);
delete lease.maxShifts;
lease.shiftsStarted = -5;
lease.rent = 0;
lease.startsAt = state.mining.currentRound.startsAt + 1;
lease.endsAt = state.mining.currentRound.endsAt + 50_000;
delete activeLeaseHistory.maxShifts;
activeLeaseHistory.shiftsStarted = -5;
activeLeaseHistory.rent = 0;
activeLeaseHistory.startsAt = lease.startsAt;
activeLeaseHistory.endsAt = lease.endsAt;
state.mining.currentRound.leases.push(
  null,
  {},
  { ...structuredClone(lease), id: "duplicate-player-and-mine-lease" },
  { id: "invalid-mine-lease", playerId: player.id, mineId: "missing-mine" }
);
assert.equal(processMiningWorld(startedAt + 101).changed, true);
assert.equal(state.mining.currentRound.leases.length, 1,
  "invalid or duplicate legacy leases should be removed before they can break mining access");
assert.equal(lease.maxShifts, 5, "legacy leases should recover the canonical shift limit");
assert.equal(lease.shiftsStarted, 0, "legacy lease shift usage should be clamped safely");
assert.equal(lease.rent, 28_000, "legacy lease rent should be restored from the canonical mine rules");
assert.equal(lease.startsAt, state.mining.currentRound.startsAt);
assert.equal(lease.endsAt, state.mining.currentRound.endsAt);
assert.equal(activeLeaseHistory.maxShifts, lease.maxShifts);
assert.equal(activeLeaseHistory.shiftsStarted, lease.shiftsStarted);
assert.equal(activeLeaseHistory.rent, lease.rent);
assert.equal(activeLeaseHistory.startsAt, lease.startsAt);
assert.equal(activeLeaseHistory.endsAt, lease.endsAt);

const candidates = refreshMinerRecruitCandidates(player, {
  rng: () => 0.1,
  makeId: (() => {
    let index = 0;
    return () => `basic-miner-${++index}`;
  })(),
  spendCash
});
assert.equal(candidates.ok, true);
player.mining.recruitCandidates[0].price = 0;
player.mining.recruitCandidates[0].baseWage = 0;
normalizePlayer(player);
assert.equal(player.mining.recruitCandidates[0].price, 3_200,
  "persisted candidate prices must be restored before recruitment");
assert.equal(player.mining.recruitCandidates[0].baseWage, 360,
  "persisted candidate wages must be restored before recruitment");
while (player.mining.recruitCandidates.length) {
  assert.equal(recruitMiner(player, player.mining.recruitCandidates[0].id, { spendCash }).ok, true);
}
assert.equal(player.mining.miners.length, 4);
player.mining.miners.push(
  { ...structuredClone(starterMiner), id: "full-roster-miner-1", name: "满员测试一" },
  { ...structuredClone(starterMiner), id: "full-roster-miner-2", name: "满员测试二" }
);
const cashBeforeBlockedRefresh = player.cash;
const blockedRefresh = refreshMinerRecruitCandidates(player, {
  rng: () => 0.1,
  makeId: () => "blocked-refresh-candidate",
  spendCash
});
assert.equal(blockedRefresh.ok, false);
assert.match(blockedRefresh.message, /已经达到 6 人上限/);
assert.equal(player.cash, cashBeforeBlockedRefresh,
  "a full roster must not be charged for refreshing unusable candidates");
player.mining.facilities.transport = 3;
const basicSnapshot = snapshotFor(player, startedAt + 105).mining;
assert.equal(basicSnapshot.basicMode, true);
assert.equal(basicSnapshot.shiftMs, 500, "basic-mode shift duration must follow the server config exactly");
assert.equal(basicSnapshot.economyTuningSandbox.sampleReady, false);
assert.equal(basicSnapshot.economyTuningSandbox.bands.length, 5,
  "the tuning sandbox should remain available as a benchmark preview before samples mature");
assert.equal(upgradeMiningFacility(player, "survey", startedAt + 106).ok, false);
assert.equal(startMiningShift(player, { minerIds: [] }, startedAt + 107).ok, false);

const miner = starterMiner;
const before = {
  fatigue: miner.fatigue,
  morale: miner.morale,
  contract: miner.contractShiftsRemaining,
  shiftsWorked: miner.shiftsWorked
};
const shift = startMiningShift(player, {
  minerIds: [miner.id],
  strategyId: "deep",
  incentiveId: "piecework",
  preparationIds: ["bracing"]
}, startedAt + 110);
assert.equal(shift.ok, true);
assert.equal(shift.job.mode, "basic");
assert.equal(shift.job.durationMs, 500);
assert.equal(shift.job.wageCost, 400);
assert.equal(shift.job.cost, 400);
assert.equal(shift.job.miningPower, 1);
assert.equal(shift.job.estimate.risk, 0.03);
assert.equal(shift.job.estimate.upgradeChance, 0);
assert.equal(shift.job.estimate.clueGain, 0);
assert.equal(shift.job.strategyId, "standard");
assert.equal(shift.job.preparationIds.length, 0);
assert.equal(shift.job.incidentAt, undefined);
assert.deepEqual(shift.job.roleAssignments, undefined);
assert.equal(startMiningShift(player, { minerIds: [miner.id] }, startedAt + 111).ok, false);

const settlement = processMiningJobs(shift.job.readyAt, { rng: () => 0.02 });
assert.equal(settlement.results.length, 1);
const result = settlement.results[0];
assert.equal(result.mode, "basic");
assert.equal(player.rough.filter((item) => item.miningOrigin?.minedAt === shift.job.readyAt)
  .reduce((sum, item) => sum + item.costBasis.amount, 0), shift.job.cost,
  "mining wages are allocated once across the produced rough stones");
assert.equal(result.roundId, lease.roundId);
assert.equal(result.roundNumber, lease.roundNumber);
assert.equal(result.leaseId, lease.id);
assert.equal(result.accident, true);
assert.equal(result.accidentChance, 0.03);
assert.equal(result.roughCount, 1);
assert.equal(result.miningPower, 1);
assert.deepEqual(result.roleAssignments, {});
assert.deepEqual(result.minerConditions, []);
assert.equal(miner.fatigue, before.fatigue);
assert.equal(miner.morale, before.morale);
assert.equal(miner.contractShiftsRemaining, before.contract);
assert.equal(miner.shiftsWorked, before.shiftsWorked + 1);
assert.equal(player.mining.stats.shifts, 1);
assert.equal(player.mining.stats.spent, 400);
assert.equal(player.mining.stats.accidents, 1);
assert.ok(player.cash > 0, "a new player budget should cover a common lease, one recruit and one shift");
assert.equal(player.mining.history[0].mode, "basic");
assert.ok(player.rough.some((rough) => rough.miningOrigin?.mode === "basic"));
assert.ok(player.rough.filter((rough) => rough.source === "mining")
  .every((rough) => !rough.miningOrigin?.roleLabels));
assert.equal(state.mining.currentRound.economyShifts.length, 1,
  "settled shifts should persist an anonymous world-round economy summary");
assert.equal(state.mining.currentRound.economyShifts[0].playerId, player.id);
assert.ok(state.mining.currentRound.economyShifts[0].benchmarkOutputValue > 0,
  "the world report should normalize results against the locked shift plan");
const economySnapshot = snapshotFor(player, shift.job.readyAt + 1).mining.economyInsights;
assert.equal(economySnapshot.recentShiftCount, 1);
assert.ok(economySnapshot.estimatedOutputValue > 0);
assert.equal(economySnapshot.operatingCost, 400);
assert.equal(economySnapshot.allocatedRent, Math.round(lease.rent / lease.maxShifts));
assert.match(economySnapshot.estimationNote, /不读取原石隐藏品质/);

const recoveryShiftStartedAt = startedAt + 200;
const recoveryShift = startMiningShift(player, {
  minerIds: [miner.id]
}, recoveryShiftStartedAt);
assert.equal(recoveryShift.ok, true);
recoveryShift.job.readyAt = null;
const recoveredTiming = processMiningJobs(recoveryShiftStartedAt + 100, { rng: () => 0.9 });
assert.equal(recoveredTiming.recoveredTimings, 1,
  "an active job with a missing completion time should be repaired");
assert.equal(recoveredTiming.results.length, 0,
  "a repaired job should retain its original remaining duration");
assert.equal(recoveryShift.job.readyAt, recoveryShiftStartedAt + 500);
const recoveredSettlement = processMiningJobs(recoveryShift.job.readyAt, { rng: () => 0.9 });
assert.equal(recoveredSettlement.results.length, 1,
  "a repaired mining job must settle instead of leaving the player permanently blocked");
assert.equal(player.mining.jobs.length, 0);

const fallbackRecoveryStartedAt = startedAt + 800;
const fallbackRecoveryShift = startMiningShift(player, {
  minerIds: [miner.id]
}, fallbackRecoveryStartedAt);
assert.equal(fallbackRecoveryShift.ok, true);
fallbackRecoveryShift.job.startedAt = null;
fallbackRecoveryShift.job.readyAt = null;
fallbackRecoveryShift.job.durationMs = null;
const fallbackRecovery = processMiningJobs(fallbackRecoveryStartedAt + 1, { rng: () => 0.9 });
assert.equal(fallbackRecovery.recoveredTimings, 1);
assert.equal(fallbackRecovery.results.length, 0,
  "an unrecoverable legacy timestamp must not grant an immediate free settlement");
assert.equal(fallbackRecoveryShift.job.startedAt, fallbackRecoveryStartedAt + 1);
assert.equal(fallbackRecoveryShift.job.durationMs, 500);
assert.equal(fallbackRecoveryShift.job.readyAt, fallbackRecoveryStartedAt + 501);
assert.equal(processMiningJobs(fallbackRecoveryShift.job.readyAt - 1, { rng: () => 0.9 }).results.length, 0);
assert.equal(processMiningJobs(fallbackRecoveryShift.job.readyAt, { rng: () => 0.9 }).results.length, 1,
  "a fully reset legacy job should settle after one complete configured shift");
assert.equal(player.mining.jobs.length, 0);

const mismatchedTimingStartedAt = startedAt + 1_400;
const mismatchedTimingShift = startMiningShift(player, {
  minerIds: [miner.id]
}, mismatchedTimingStartedAt);
assert.equal(mismatchedTimingShift.ok, true);
mismatchedTimingShift.job.readyAt = mismatchedTimingStartedAt + 50_000;
const mismatchedTimingRecovery = processMiningJobs(mismatchedTimingStartedAt + 100, { rng: () => 0.9 });
assert.equal(mismatchedTimingRecovery.recoveredTimings, 1);
assert.equal(mismatchedTimingRecovery.results.length, 0,
  "a mismatched future completion time should be repaired without settling early");
assert.equal(mismatchedTimingShift.job.readyAt, mismatchedTimingStartedAt + 500,
  "an active job should keep the duration that was locked when the shift started");
const mismatchedTimingSettlement = processMiningJobs(mismatchedTimingShift.job.readyAt, { rng: () => 0.9 });
assert.equal(mismatchedTimingSettlement.results.length, 1);
assert.equal(player.mining.jobs.length, 0,
  "a repaired future job should settle once and stop blocking the mining crew");

const clockRecoveryStartedAt = startedAt + 2_000;
const clockRecoveryShift = startMiningShift(player, {
  minerIds: [miner.id]
}, clockRecoveryStartedAt);
assert.equal(clockRecoveryShift.ok, true);
const clockObservedAt = clockRecoveryStartedAt + 1;
clockRecoveryShift.job.startedAt = clockObservedAt + 1_000;
clockRecoveryShift.job.readyAt = clockRecoveryShift.job.startedAt + clockRecoveryShift.job.durationMs;
const clockRecovery = processMiningJobs(clockObservedAt, { rng: () => 0.9 });
assert.equal(clockRecovery.recoveredTimings, 1);
assert.equal(clockRecovery.results.length, 0,
  "a future start time must not make an active shift settle immediately");
assert.equal(clockRecoveryShift.job.startedAt, clockObservedAt);
assert.equal(clockRecoveryShift.job.readyAt, clockObservedAt + 500,
  "clock recovery should restart the complete locked shift duration");
assert.equal(processMiningJobs(clockRecoveryShift.job.readyAt - 1, { rng: () => 0.9 }).results.length, 0);
assert.equal(processMiningJobs(clockRecoveryShift.job.readyAt, { rng: () => 0.9 }).results.length, 1);
assert.equal(player.mining.jobs.length, 0);

player.mining.jobs.push(null);
normalizePlayer(player);
assert.equal(player.mining.jobs.length, 0,
  "an invalid legacy job row should be discarded instead of breaking every mining settlement tick");

const migrationAt = startedAt + 1_000;
state.mining.currentRound = {
  id: "legacy-long-round",
  number: 8,
  startsAt: migrationAt - 1_000,
  endsAt: migrationAt + (72 * 60 * 60 * 1000),
  allocatedAt: null,
  leases: []
};
assert.equal(processMiningWorld(migrationAt).changed, true);
assert.equal(state.mining.currentRound.startsAt, migrationAt + 100);
assert.equal(state.mining.currentRound.endsAt, migrationAt + 4_100);
assert.equal(state.mining.currentRound.leaseMs, 4_000);
assert.equal(state.mining.currentRound.applicationMs, 100);

const corruptRoundRecoveredAt = migrationAt + 200;
state.mining.currentRound = {
  id: "legacy-invalid-schedule",
  number: 9,
  startsAt: null,
  endsAt: "invalid",
  allocatedAt: null,
  leaseMs: 4_000,
  applicationMs: 100,
  leases: []
};
assert.equal(processMiningWorld(corruptRoundRecoveredAt).changed, true);
assert.equal(state.mining.currentRound.startsAt, corruptRoundRecoveredAt + 100,
  "an invalid unallocated round should reopen a complete application window");
assert.equal(state.mining.currentRound.endsAt, corruptRoundRecoveredAt + 4_100,
  "an invalid round schedule should recover to one complete lease period");
assert.equal(state.mining.currentRound.allocatedAt, null);

console.log("mining-basic-mode-smoke: starter miner, balanced rent, flexible crew and basic settlement ok");
