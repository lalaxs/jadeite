import assert from "node:assert/strict";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "2";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "1000";
process.env.JADE_MINING_SHIFT_MS = "200";
process.env.JADE_MINING_BASIC_MODE = "1";

const { __testHooks: H } = await import(`../server.js?mining-downtime=${Date.now()}`);

const startedAt = 1_960_000_000_000;
const openingCash = 500_000;
const players = ["downtime-a", "downtime-b"].map((id, index) => {
  const player = H.makePlayer(id);
  player.name = `停机恢复玩家${index + 1}`;
  player.cash = openingCash;
  player.lastSeenAt = startedAt;
  H.normalizePlayer(player);
  H.world.setPlayer(player);
  return player;
});

H.processMiningWorld(startedAt);
for (const player of players) {
  assert.equal(H.submitMiningApplication(
    player,
    ["core-06", "core-05", "core-04"],
    startedAt + 10,
    { allowFallback: true }
  ).ok, true);
}
H.processMiningWorld(startedAt + 100);
const firstRound = structuredClone(H.state.mining.currentRound);
assert.equal(firstRound.number, 1);
assert.equal(firstRound.leases.length, 2);

const workingPlayer = H.state.players.get(firstRound.leases[0].playerId);
const shift = H.startMiningShift(workingPlayer, {
  minerIds: [workingPlayer.mining.miners[0].id]
}, startedAt + 800);
assert.equal(shift.ok, true);

const cashBeforeNextApplication = new Map(players.map((player) => [player.id, player.cash]));
const skippedBefore = new Map(players.map((player) => [
  player.id,
  player.mining.skippedApplicationRounds
]));
for (const player of players) {
  assert.equal(H.submitMiningApplication(
    player,
    ["core-06", "core-05", "core-04"],
    firstRound.endsAt - 50,
    { allowFallback: true }
  ).ok, true);
  assert.ok(player.cash < cashBeforeNextApplication.get(player.id));
}
H.state.mining.applications.push({
  ...H.state.mining.applications[0],
  id: "corrupt-duplicate-downtime-application",
  submittedAt: H.state.mining.applications[0].submittedAt - 1
});
assert.equal(H.state.mining.applications.length, 3,
  "fixture should include a duplicated persisted application without a second cash hold");

const persisted = H.world.exportSnapshot({ savedAt: firstRound.endsAt - 20 });
H.world.clear({ keepStartedAt: false });
H.world.importSnapshot(persisted);
const recoveredAt = firstRound.endsAt + 1_500;

const settledJobs = H.processMiningJobs(recoveredAt, { rng: () => 0.9 });
assert.equal(settledJobs.results.length, 1,
  "a shift completed during downtime must settle before its lease is retired");
const recovery = H.processMiningWorld(recoveredAt);
assert.equal(recovery.recovered, true);
assert.equal(recovery.recoveredRounds, 2);
assert.equal(recovery.refundedApplications, 2);
assert.ok(recovery.refundedEscrow > 0);
assert.equal(H.state.mining.currentRound.number, 3);
assert.equal(H.state.mining.currentRound.allocatedAt, null);
assert.equal(H.state.mining.currentRound.startsAt, recoveredAt + 100);
assert.equal(H.state.mining.applications.length, 0);
assert.equal(H.state.mining.activeApplicationRound, 3);

for (const player of H.state.players.values()) {
  assert.equal(player.cash, cashBeforeNextApplication.get(player.id),
    "an application for a fully expired downtime round must be refunded in full");
  assert.equal(player.mining.skippedApplicationRounds, skippedBefore.get(player.id),
    "server downtime must not count as player non-participation");
  const recoveryEntry = player.mining.applicationHistory.find((entry) => (
    entry.reason === "server_downtime_expired"
  ));
  assert.ok(recoveryEntry);
  assert.equal(recoveryEntry.status, "cancelled");
  assert.equal(recoveryEntry.refund, recoveryEntry.escrow);
  const playerNotice = H.miningSnapshotForPlayer(player, recoveredAt).applicationRecoveryNotice;
  assert.equal(playerNotice.reason, "server_downtime_expired");
  assert.equal(playerNotice.refund, recoveryEntry.refund);
  assert.match(playerNotice.message, /停机.*已全额退回.*重新选择/);
  assert.equal(
    H.miningSnapshotForPlayer(player, recoveredAt + (24 * 60 * 60 * 1_000) + 1).applicationRecoveryNotice,
    null,
    "the prominent recovery notice should expire while application history remains"
  );
}

const reloadedWorkingPlayer = H.state.players.get(workingPlayer.id);
assert.equal(reloadedWorkingPlayer.mining.jobs.length, 0);
assert.ok(reloadedWorkingPlayer.mining.history.some((entry) => entry.id === shift.job.id));
assert.equal(
  reloadedWorkingPlayer.mining.leaseHistory.find((entry) => entry.id === firstRound.leases[0].id)?.status,
  "expired"
);

assert.equal(H.processMiningWorld(recoveredAt + 1).changed, false,
  "downtime recovery must be idempotent after the fresh application round is created");
const freshApplication = H.submitMiningApplication(
  reloadedWorkingPlayer,
  ["mist-01"],
  recoveredAt + 2,
  { allowFallback: true }
);
assert.equal(freshApplication.ok, true);
assert.equal(freshApplication.application.targetRound, 3);

console.log("mining-downtime-recovery-smoke: expired applications refunded, active shift settled, fresh round reopened");
process.exit(0);
