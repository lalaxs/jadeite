import assert from "node:assert/strict";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "1";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "4000";
process.env.JADE_MINING_SHIFT_MS = "500";
process.env.JADE_MINING_BASIC_MODE = "1";

const { __testHooks: H } = await import(`../server.js?mining-job-recovery=${Date.now()}`);

const startedAt = 1_950_000_000_000;
const player = H.makePlayer("mining-job-recovery-player");
player.name = "任务退款测试掌柜";
player.cash = 100_000;
player.lastSeenAt = startedAt;
H.normalizePlayer(player);
H.world.setPlayer(player);

assert.equal(H.processMiningWorld(startedAt).unlocked, true);
assert.equal(H.submitMiningApplication(player, ["mist-01"], startedAt + 10).ok, true);
H.processMiningWorld(startedAt + 100);
const lease = H.state.mining.currentRound.leases.find((entry) => entry.playerId === player.id);
const leaseHistory = player.mining.leaseHistory.find((entry) => entry.id === lease.id);
const originalMineId = lease.mineId;

const cashBeforeShift = player.cash;
const roughsBeforeShift = player.rough.length;
const completedBeforeShift = player.mining.stats.shifts;
const shift = H.startMiningShift(player, {
  minerIds: [player.mining.miners[0].id]
}, startedAt + 110);
assert.equal(shift.ok, true);
assert.equal(player.cash, cashBeforeShift - shift.fee);
assert.equal(lease.shiftsStarted, 1);
assert.ok(player.ledger.some((entry) => (
  entry.source === "miningShift"
  && entry.itemId === shift.job.id
  && entry.amount === -shift.fee
)), "new shifts should link their exact debit to the job id");

shift.job.cost = 9_999_999;
shift.job.wageCost = 9_999_999;
player.mining.jobs.push(structuredClone(shift.job));
H.state.mining.currentRound.leases = H.state.mining.currentRound.leases
  .filter((entry) => entry.id !== lease.id);
const recovery = H.processMiningJobs(shift.job.readyAt, { rng: () => 0.9 });

assert.equal(recovery.changed, true);
assert.equal(recovery.refundedJobs, 1,
  "one invalid shift should produce exactly one refund");
assert.equal(recovery.deduplicatedJobs, 1,
  "a duplicated persisted job id should be discarded without a second refund");
assert.equal(recovery.results.length, 1);
assert.equal(recovery.results[0].status, "refunded");
assert.equal(recovery.results[0].failureReason, "invalid_mining_job_lease");
assert.equal(recovery.results[0].refund, shift.fee);
assert.equal(recovery.results[0].refundBasis, "ledger");
assert.equal(recovery.results[0].shiftSlotRestored, true);
assert.equal(player.cash, cashBeforeShift,
  "an unsettleable shift must return all wages and supplies");
assert.equal(player.rough.length, roughsBeforeShift,
  "a refunded shift must not create rough stones");
assert.equal(player.mining.stats.shifts, completedBeforeShift,
  "a refunded shift must not count as completed production");
assert.equal(leaseHistory.shiftsStarted, 0,
  "the player's lease history must reflect the restored slot");
assert.equal(player.mining.jobs.length, 0);
assert.equal(player.mining.history.filter((entry) => entry.id === shift.job.id).length, 1);
assert.equal(player.mining.history[0].status, "refunded");
assert.match(player.mining.history[0].note, /全额退回/);
assert.equal(player.ledger.filter((entry) => (
  entry.source === "miningShiftRefund" && entry.itemId === shift.job.id
)).length, 1);
lease.shiftsStarted = leaseHistory.shiftsStarted;
H.state.mining.currentRound.leases.push(lease);

const crewFailureStartedAt = shift.job.readyAt + 10;
const crewFailure = H.startMiningShift(player, {
  minerIds: [player.mining.miners[0].id]
}, crewFailureStartedAt);
assert.equal(crewFailure.ok, true);
crewFailure.job.minerIds = ["missing-miner"];
const crewRecovery = H.processMiningJobs(crewFailure.job.readyAt, { rng: () => 0.9 });
assert.equal(crewRecovery.refundedJobs, 1);
assert.equal(crewRecovery.results[0].status, "refunded");
assert.equal(crewRecovery.results[0].failureReason, "invalid_mining_job_crew");
assert.equal(crewRecovery.results[0].shiftSlotRestored, true);
assert.match(crewRecovery.results[0].note, /班组资料异常/);
assert.equal(player.cash, cashBeforeShift,
  "a shift with a missing crew member must refund instead of producing without miners");
assert.equal(player.rough.length, roughsBeforeShift);
assert.equal(lease.shiftsStarted, 0);
assert.equal(leaseHistory.shiftsStarted, 0);

const cashAfterRecovery = player.cash;
const historyAfterRecovery = structuredClone(player.mining.history);
assert.equal(H.processMiningJobs(crewFailure.job.readyAt + 1).changed, false,
  "reprocessing must not refund a completed recovery twice");
assert.equal(player.cash, cashAfterRecovery);
assert.deepEqual(player.mining.history, historyAfterRecovery);

const snapshot = H.world.exportSnapshot({ savedAt: crewFailure.job.readyAt + 2 });
H.world.clear({ keepStartedAt: false });
H.world.importSnapshot(snapshot);
const reloaded = H.state.players.get(player.id);
assert.equal(H.processMiningJobs(crewFailure.job.readyAt + 3).changed, false);
assert.equal(reloaded.cash, cashAfterRecovery,
  "a recovered shift must remain idempotent after restart");
assert.equal(reloaded.mining.history.filter((entry) => entry.status === "refunded").length, 2);

const economy = H.snapshotFor(reloaded, crewFailure.job.readyAt + 4).mining.economyInsights;
assert.equal(economy.recentShiftCount, 0,
  "refunded failures must not distort mining economy samples");

const validShiftStartedAt = crewFailure.job.readyAt + 10;
const validShift = H.startMiningShift(reloaded, {
  minerIds: [reloaded.mining.miners[0].id]
}, validShiftStartedAt);
assert.equal(validShift.ok, true);
const validFee = validShift.fee;
validShift.job.cost = 9_999_999;
validShift.job.wageCost = 9_999_999;
validShift.job.leaseId = "damaged-lease-id";
validShift.job.mineId = originalMineId === "ridge-01" ? "mist-01" : "ridge-01";
validShift.job.mineName = "错误矿山";
const validSettlement = H.processMiningJobs(validShift.job.readyAt, { rng: () => 0.9 });
assert.equal(validSettlement.recoveredCosts, 1,
  "a valid shift with corrupted cost fields should be repaired from its debit");
assert.equal(validSettlement.recoveredLeaseLinks, 1,
  "a damaged lease link should be restored from the player's round allocation");
assert.equal(validSettlement.results.length, 1);
assert.notEqual(validSettlement.results[0].status, "refunded");
assert.equal(validSettlement.results[0].cost, validFee);
assert.equal(validSettlement.results[0].wageCost, validFee);
assert.equal(validSettlement.results[0].leaseId, lease.id);
assert.equal(validSettlement.results[0].mineId, originalMineId,
  "settlement must use the mine actually awarded by the lease");
assert.equal(reloaded.mining.stats.spent, validFee,
  "normal production statistics must use the actual amount paid");
const repairedEconomy = H.snapshotFor(reloaded, validShift.job.readyAt + 1).mining.economyInsights;
assert.equal(repairedEconomy.recentShiftCount, 1);
assert.equal(repairedEconomy.operatingCost, validFee,
  "economy reporting must use the repaired real debit");

const liveLease = H.state.mining.currentRound.leases.find((entry) => entry.playerId === reloaded.id);
const liveLeaseHistory = reloaded.mining.leaseHistory.find((entry) => entry.id === liveLease.id);
const concurrentStartedAt = validShift.job.readyAt + 10;
const primaryShift = H.startMiningShift(reloaded, {
  minerIds: [reloaded.mining.miners[0].id]
}, concurrentStartedAt);
assert.equal(primaryShift.ok, true);
const cashAfterPrimaryDebit = reloaded.cash;
const duplicateRow = structuredClone(primaryShift.job);
reloaded.mining.jobs.push(duplicateRow);
const extraJob = {
  ...structuredClone(primaryShift.job),
  id: "concurrent-extra-job",
  startedAt: primaryShift.job.startedAt + 1,
  readyAt: primaryShift.job.readyAt + 1
};
const unverifiedExtraJob = {
  ...structuredClone(primaryShift.job),
  id: "concurrent-unverified-job",
  startedAt: primaryShift.job.startedAt - 100,
  readyAt: primaryShift.job.readyAt - 100,
  cost: 88_888
};
assert.equal(H.spendCash(reloaded, primaryShift.fee, "矿山开采：并发恢复测试", {
  source: "miningShift",
  itemId: extraJob.id,
  at: extraJob.startedAt,
  repEligible: false
}), true);
reloaded.mining.jobs.push(extraJob);
reloaded.mining.jobs.push(unverifiedExtraJob);
liveLease.shiftsStarted += 1;
liveLeaseHistory.shiftsStarted = liveLease.shiftsStarted;
const concurrentRecovery = H.processMiningJobs(concurrentStartedAt + 2, { rng: () => 0.9 });
assert.equal(concurrentRecovery.recoveredConcurrentJobs, 2);
assert.equal(concurrentRecovery.deduplicatedJobs, 1,
  "a same-id persisted copy should be removed without another refund");
assert.equal(concurrentRecovery.refundedJobs, 1);
assert.equal(concurrentRecovery.prunedJobs, 1,
  "an unverified ghost job should be removed without minting a refund");
assert.equal(concurrentRecovery.results.length, 1);
assert.equal(concurrentRecovery.results[0].failureReason, "concurrent_mining_job");
assert.equal(concurrentRecovery.results[0].refund, primaryShift.fee);
assert.equal(concurrentRecovery.results[0].refundBasis, "verified_debit");
assert.equal(reloaded.cash, cashAfterPrimaryDebit,
  "the extra charged task should be refunded while the primary task remains paid");
assert.equal(reloaded.mining.jobs.length, 1);
assert.equal(reloaded.mining.jobs[0].id, primaryShift.job.id);
assert.ok(unverifiedExtraJob.startedAt < primaryShift.job.startedAt,
  "the unverified ghost should be earlier so payment priority is exercised");
assert.equal(reloaded.mining.history.some((entry) => entry.id === unverifiedExtraJob.id), false,
  "an uncharged ghost job should not create a misleading refund record");
assert.equal(liveLease.shiftsStarted, 2,
  "only the completed shift and retained active shift should consume lease slots");
assert.equal(liveLeaseHistory.shiftsStarted, liveLease.shiftsStarted);
const primarySettlement = H.processMiningJobs(primaryShift.job.readyAt, { rng: () => 0.9 });
assert.equal(primarySettlement.results.length, 1);
assert.equal(primarySettlement.results[0].id, primaryShift.job.id);
assert.equal(reloaded.mining.jobs.length, 0);

const priorityStartedAt = primaryShift.job.readyAt + 10;
const priorityShift = H.startMiningShift(reloaded, {
  minerIds: [reloaded.mining.miners[0].id]
}, priorityStartedAt);
assert.equal(priorityShift.ok, true);
const invalidPaidJob = {
  ...structuredClone(priorityShift.job),
  id: "concurrent-invalid-paid-job",
  minerIds: ["missing-miner"],
  startedAt: priorityShift.job.startedAt - 10,
  readyAt: priorityShift.job.readyAt - 10
};
assert.equal(H.spendCash(reloaded, priorityShift.fee, "矿山开采：有效任务优先测试", {
  source: "miningShift",
  itemId: invalidPaidJob.id,
  at: invalidPaidJob.startedAt,
  repEligible: false
}), true);
reloaded.mining.jobs.push(invalidPaidJob);
liveLease.shiftsStarted += 1;
liveLeaseHistory.shiftsStarted = liveLease.shiftsStarted;
const validityRecovery = H.processMiningJobs(priorityStartedAt + 1, { rng: () => 0.9 });
assert.equal(validityRecovery.recoveredConcurrentJobs, 1);
assert.equal(validityRecovery.results[0].id, invalidPaidJob.id);
assert.equal(validityRecovery.results[0].failureReason, "concurrent_mining_job");
assert.equal(reloaded.mining.jobs.length, 1);
assert.equal(reloaded.mining.jobs[0].id, priorityShift.job.id,
  "a complete paid task should outrank an earlier paid task with an invalid crew");
assert.equal(H.processMiningJobs(priorityShift.job.readyAt, { rng: () => 0.9 }).results[0].id, priorityShift.job.id);
assert.equal(reloaded.mining.jobs.length, 0);
reloaded.mining.jobs.push({ id: "stale-completed-job", status: "completed" });
const staleCleanup = H.processMiningJobs(primaryShift.job.readyAt + 1);
assert.equal(staleCleanup.prunedJobs, 1,
  "inactive legacy rows should be removed from the active job queue");
assert.equal(staleCleanup.results.length, 0);
assert.equal(reloaded.mining.jobs.length, 0);

console.log("mining-job-recovery-smoke: invalid jobs refund once, remain recorded, and survive restart");
