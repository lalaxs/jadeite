import assert from "node:assert/strict";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "50";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "4000";

const { __testHooks } = await import(`../server.js?mining-allocation=${Date.now()}`);
const {
  world,
  state,
  makePlayer,
  normalizePlayer,
  processMiningWorld,
  submitMiningApplication,
  miningSnapshotForPlayer
} = __testHooks;

const startedAt = 1_810_000_000_000;
const players = Array.from({ length: 51 }, (_, index) => {
  const sequence = String(index + 1).padStart(2, "0");
  const player = makePlayer(`mining-allocation-${sequence}`);
  player.name = `竞租测试掌柜${sequence}`;
  player.cash = 500_000;
  player.lastSeenAt = startedAt;
  normalizePlayer(player);
  world.setPlayer(player);
  return player;
});

processMiningWorld(startedAt);
const competitors = players.slice(0, 50);
const outsider = players[50];
assert.deepEqual(state.mining.competitionPlayerIds, competitors.map((player) => player.id),
  "the first 50 active qualified players should occupy the competition roster");
assert.equal(miningSnapshotForPlayer(competitors[0], startedAt).playerQualified, true);
assert.equal(miningSnapshotForPlayer(outsider, startedAt).playerQualified, false);
assert.equal(miningSnapshotForPlayer(outsider, startedAt).waitlistPosition, 1);
assert.equal(submitMiningApplication(outsider, ["core-06"], startedAt + 10).ok, false,
  "a waitlisted player must not enter the draw while all 50 seats are occupied");

const broadPreferences = ["core-06", "core-05", "core-04"];
for (const player of competitors) {
  const application = submitMiningApplication(player, broadPreferences, startedAt + 10, {
    allowFallback: true
  });
  assert.equal(application.ok, true);
}

const concentratedApplicationInsights = miningSnapshotForPlayer(
  competitors[0],
  startedAt + 10
).competitionInsights;
assert.equal(concentratedApplicationInsights.currentApplicantCount, 50);
assert.ok(concentratedApplicationInsights.healthAlerts.some((entry) => (
  entry.id === "mine-concentration" && entry.severity === "critical"
)), "a live preference window should flag a mine selected by nearly every applicant");

processMiningWorld(startedAt + 100);
const firstRoundLeases = state.mining.currentRound.leases;
assert.deepEqual(state.mining.currentRound.competitionStats, {
  rosterSize: 50,
  applicantCount: 50,
  winnerCount: 30,
  missedCount: 20,
  skippedCount: 0,
  priorityApplicantCount: 0,
  priorityWinnerCount: 0,
  fallbackWinnerCount: 27,
  rosterReleasedCount: 0,
  settledAt: startedAt + 100
});
assert.equal(firstRoundLeases.length, 30, "50 applicants should compete for exactly 30 mines");
assert.equal(new Set(firstRoundLeases.map((lease) => lease.playerId)).size, 30);
assert.equal(new Set(firstRoundLeases.map((lease) => lease.mineId)).size, 30);
const firstRoundWinnerIds = new Set(firstRoundLeases.map((lease) => lease.playerId));
const firstRoundLosers = competitors.filter((player) => !firstRoundWinnerIds.has(player.id));
assert.equal(firstRoundLosers.length, 20);
assert.ok(firstRoundLosers.every((player) => player.cash === 500_000),
  "every first-round loser should receive the full escrow refund");
assert.ok(firstRoundLosers.every((player) => player.mining.priorityRound === 2),
  "system losers who accepted fallback should receive next-round priority");
assert.ok(firstRoundLeases.every((lease) => lease.priorityAllocation === false),
  "the opening round should not mark ordinary lottery winners as priority allocations");
assert.ok(competitors.every((player) => player.mining.applicationHistory.length === 1),
  "every applicant should receive a durable first-round competition result");
assert.ok(competitors
  .filter((player) => firstRoundWinnerIds.has(player.id))
  .every((player) => player.mining.applicationHistory[0].status === "won"));
assert.ok(firstRoundLosers.every((player) => (
  player.mining.applicationHistory[0].status === "missed"
  && player.mining.applicationHistory[0].refund > 0
  && player.mining.applicationHistory[0].priorityGranted === true
)));
const firstInsights = miningSnapshotForPlayer(competitors[0], startedAt + 100).competitionInsights;
assert.equal(firstInsights.recentRoundCount, 1);
assert.equal(firstInsights.recentParticipationRate, 1);
assert.equal(firstInsights.recentWinRate, 0.6);
assert.equal(firstInsights.waitlistCount, 1);
assert.equal(firstInsights.recentRounds[0].missedCount, 20);

const applicationWindowOpened = processMiningWorld(startedAt + 4_000);
assert.equal(applicationWindowOpened.changed, true,
  "opening the next-round application window should emit a world-state change immediately");
assert.equal(state.mining.activeApplicationRound, 2);
assert.equal(processMiningWorld(startedAt + 4_001).changed, false,
  "an already-open application window should not emit duplicate state changes");

for (const player of competitors) {
  const application = submitMiningApplication(player, broadPreferences, startedAt + 4_050, {
    allowFallback: true
  });
  assert.equal(application.ok, true);
}

processMiningWorld(startedAt + 4_100);
const secondRoundLeases = state.mining.currentRound.leases;
const secondRoundByPlayer = new Map(secondRoundLeases.map((lease) => [lease.playerId, lease]));
assert.equal(state.mining.currentRound.number, 2);
assert.equal(state.mining.activeApplicationRound, null,
  "allocating the new round should close the tracked application window");
assert.equal(secondRoundLeases.length, 30);
assert.equal(state.mining.currentRound.competitionStats.priorityWinnerCount, 20);
assert.ok(firstRoundLosers.every((player) => secondRoundByPlayer.has(player.id)),
  "all 20 system losers should be protected in the next round when they accept fallback");
assert.ok(firstRoundLosers.every((player) => secondRoundByPlayer.get(player.id).priorityAllocation === true));
assert.ok(secondRoundLeases.every((lease) => (
  !firstRoundWinnerIds.has(lease.playerId)
  || firstRoundLeases.find((previous) => previous.playerId === lease.playerId)?.mineId !== lease.mineId
)), "a returning winner must not receive the same mine in consecutive rounds");

competitors[0].lastSeenAt = startedAt - (8 * 24 * 60 * 60 * 1000);
processMiningWorld(startedAt + 4_200);
const inactiveRosterSnapshot = miningSnapshotForPlayer(competitors[0], startedAt + 4_200);
assert.equal(inactiveRosterSnapshot.playerQualified, false,
  "a roster player inactive for more than seven days should vacate the active seat");
assert.match(inactiveRosterSnapshot.accessMessage, /连续 7 天未活跃.*竞租席位已释放/,
  "an inactive player should receive a persistent roster-release reason");
assert.equal(inactiveRosterSnapshot.rosterReleaseNotice?.reason, "inactive_roster_release");
assert.equal(state.mining.currentRound.competitionStats.rosterReleasedCount, 1,
  "mid-round inactivity replacements should contribute to the release-rate metric");
assert.equal(miningSnapshotForPlayer(outsider, startedAt + 4_200).playerQualified, true,
  "the first active waitlisted player should fill a vacated competition seat");

const departingCompetitor = competitors[1];
const cashBeforePendingApplication = departingCompetitor.cash;
const pendingApplication = submitMiningApplication(
  departingCompetitor,
  broadPreferences,
  startedAt + 8_050,
  { allowFallback: true }
);
assert.equal(pendingApplication.ok, true);
assert.ok(departingCompetitor.cash < cashBeforePendingApplication,
  "a pending application should freeze its maximum rent");
departingCompetitor.lastSeenAt = startedAt - (8 * 24 * 60 * 60 * 1000);
processMiningWorld(startedAt + 8_060);
assert.equal(state.mining.applications.some((entry) => entry.playerId === departingCompetitor.id), false,
  "leaving the competition roster should cancel any pending application");
assert.equal(departingCompetitor.cash, cashBeforePendingApplication,
  "leaving the competition roster should immediately return the full escrow");
const refundedRosterSnapshot = miningSnapshotForPlayer(departingCompetitor, startedAt + 8_060);
assert.match(refundedRosterSnapshot.accessMessage, /冻结款 .* 已全额退回/,
  "a removed applicant should be told that the frozen rent was refunded");
assert.equal(refundedRosterSnapshot.rosterReleaseNotice?.refund, pendingApplication.application.escrow,
  "the persistent roster-release notice should expose the exact refund amount");

console.log("mining-allocation-smoke: competition, priority, replacement and roster-exit feedback ok");
