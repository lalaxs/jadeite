import assert from "node:assert/strict";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "3";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "400";

const { __testHooks } = await import(`../server.js?mining-roster-participation=${Date.now()}`);
const {
  world,
  state,
  makePlayer,
  normalizePlayer,
  processMiningWorld,
  submitMiningApplication,
  cancelMiningApplication,
  miningSnapshotForPlayer
} = __testHooks;

const startedAt = 1_840_000_000_000;
const players = Array.from({ length: 4 }, (_, index) => {
  const player = makePlayer(`mining-roster-${index + 1}`);
  player.name = `席位测试掌柜${index + 1}`;
  player.cash = 500_000;
  player.lastSeenAt = startedAt;
  normalizePlayer(player);
  world.setPlayer(player);
  return player;
});

processMiningWorld(startedAt);
const [activeA, activeB, skipper, waiting] = players;
assert.deepEqual(state.mining.competitionPlayerIds, [activeA.id, activeB.id, skipper.id]);
assert.equal(miningSnapshotForPlayer(waiting, startedAt).waitlistPosition, 1);

const preferences = ["mist-01", "mist-02", "mist-03"];
assert.equal(submitMiningApplication(activeA, preferences, startedAt + 5, { allowFallback: true }).ok, true);
assert.ok(activeA.cash < 500_000);
assert.equal(cancelMiningApplication(activeA, startedAt + 6).ok, true);
assert.equal(activeA.cash, 500_000, "cancelling before the deadline should refund the complete escrow");
assert.equal(activeA.mining.applicationHistory[0].status, "cancelled");
assert.equal(activeA.mining.applicationHistory[0].refund, activeA.mining.applicationHistory[0].escrow);
for (let roundIndex = 0; roundIndex < 3; roundIndex += 1) {
  const submitAt = startedAt + 10 + roundIndex * 400;
  const settleAt = startedAt + 100 + roundIndex * 400;
  assert.equal(submitMiningApplication(activeA, preferences, submitAt, { allowFallback: true }).ok, true);
  assert.equal(submitMiningApplication(activeB, preferences, submitAt, { allowFallback: true }).ok, true);
  processMiningWorld(settleAt);
  if (roundIndex === 1) {
    const warningSnapshot = miningSnapshotForPlayer(skipper, settleAt);
    assert.equal(warningSnapshot.skippedApplicationRounds, 2);
    assert.equal(warningSnapshot.maxSkippedApplicationRounds, 3);
    assert.equal(warningSnapshot.rosterAtRisk, true,
      "a player should receive a visible warning before the final skipped round releases their seat");
  }
}

assert.deepEqual(state.mining.competitionPlayerIds, [activeA.id, activeB.id, waiting.id],
  "the first waitlisted player should fill a seat released after three skipped rounds");
assert.equal(miningSnapshotForPlayer(waiting, startedAt + 900).playerQualified, true);
assert.equal(miningSnapshotForPlayer(skipper, startedAt + 900).playerQualified, false);
assert.equal(skipper.mining.lastRosterReleaseRound, 3);
assert.equal(skipper.mining.skippedApplicationRounds, 0);
assert.equal(skipper.mining.competitionSuspendedUntil, startedAt + 1_300);
assert.equal(skipper.mining.competitionQueueAt, startedAt + 900);
assert.equal(miningSnapshotForPlayer(skipper, startedAt + 900).competitionSuspendedUntil, startedAt + 1_300);

const skippedHistory = skipper.mining.applicationHistory.filter((entry) => entry.status === "skipped");
assert.equal(skippedHistory.length, 3);
assert.deepEqual(skippedHistory.map((entry) => entry.roundNumber), [3, 2, 1]);
assert.equal(skippedHistory[0].rosterReleased, true);
assert.equal(skippedHistory[1].rosterReleased, false);
assert.match(miningSnapshotForPlayer(skipper, startedAt + 900).accessMessage, /连续 3 轮未报名/);

console.log("mining roster participation smoke ok");
