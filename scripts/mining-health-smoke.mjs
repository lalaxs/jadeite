import assert from "node:assert/strict";
import { MINES } from "../shared/domain/mining/mining-rules.js";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "2";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "4000";
process.env.JADE_MINING_SHIFT_MS = "500";
process.env.JADE_MINING_BASIC_MODE = "1";

const { __testHooks: H } = await import(`../server.js?mining-health=${Date.now()}`);

const startedAt = 1_950_000_000_000;
const players = ["health-a", "health-b"].map((id, index) => {
  const player = H.makePlayer(id);
  player.name = `巡检玩家${index + 1}`;
  player.cash = 200_000;
  player.lastSeenAt = startedAt;
  H.normalizePlayer(player);
  H.world.setPlayer(player);
  return player;
});

assert.equal(H.processMiningWorld(startedAt).unlocked, true);
assert.equal(H.inspectMiningHealth(startedAt + 1).ok, true);

for (const [index, player] of players.entries()) {
  const application = H.submitMiningApplication(
    player,
    [MINES[index].id, MINES[index + 2].id],
    startedAt + 10 + index
  );
  assert.equal(application.ok, true);
}

let report = H.inspectMiningHealth(startedAt + 20);
assert.equal(report.ok, true);
assert.deepEqual(report.counts, { roster: 2, applications: 2, leases: 0, activeJobs: 0 });

const beforeAudit = JSON.stringify({
  mining: H.state.mining,
  players: players.map((player) => [player.id, player.mining])
});
H.inspectMiningHealth(startedAt + 20);
assert.equal(JSON.stringify({
  mining: H.state.mining,
  players: players.map((player) => [player.id, player.mining])
}), beforeAudit, "health inspection must not normalize or mutate mining data");

H.state.mining.applications[0].escrow += 1;
report = H.inspectMiningHealth(startedAt + 20);
assert.equal(report.ok, false);
assert.ok(report.issues.some((issue) => issue.code === "application_escrow_mismatch"));
H.state.mining.applications[0].escrow -= 1;

H.processMiningWorld(startedAt + 100);
report = H.inspectMiningHealth(startedAt + 101);
assert.equal(report.ok, true);
assert.deepEqual(report.counts, { roster: 2, applications: 0, leases: 2, activeJobs: 0 });

const firstPlayer = players[0];
const firstLease = H.state.mining.currentRound.leases.find((lease) => lease.playerId === firstPlayer.id);
assert.ok(firstLease);
const shiftStartedAt = startedAt + 110;
const shift = H.startMiningShift(firstPlayer, {
  minerIds: [firstPlayer.mining.miners[0].id]
}, shiftStartedAt);
assert.equal(shift.ok, true);

report = H.inspectMiningHealth(shiftStartedAt + 1);
assert.equal(report.ok, true);
assert.equal(report.counts.activeJobs, 1);

shift.job.cost += 1;
report = H.inspectMiningHealth(shiftStartedAt + 1);
assert.ok(report.issues.some((issue) => issue.code === "job_cost_mismatch"));
assert.ok(report.issues.some((issue) => issue.code === "job_cost_breakdown_mismatch"));
shift.job.cost -= 1;
assert.equal(H.inspectMiningHealth(shiftStartedAt + 1).ok, true);

H.state.mining.currentRound.leases.push({ ...firstLease, id: "duplicate-health-lease" });
report = H.inspectMiningHealth(shiftStartedAt + 1);
assert.equal(report.ok, false);
assert.ok(report.issues.some((issue) => issue.code === "duplicate_lease_player"));
assert.ok(report.issues.some((issue) => issue.code === "duplicate_lease_mine"));
H.state.mining.currentRound.leases.pop();

H.state.mining.competitionPlayerIds.push("missing-health-player");
report = H.inspectMiningHealth(shiftStartedAt + 1);
assert.ok(report.issues.some((issue) => issue.code === "unknown_roster_player"));
assert.ok(report.issues.some((issue) => issue.code === "roster_over_capacity"));
H.state.mining.competitionPlayerIds.pop();

assert.equal(H.inspectMiningHealth(shift.job.readyAt).ok, true, "normal settlement boundary needs a scheduler grace period");
report = H.inspectMiningHealth(shift.job.readyAt + 5_000);
assert.ok(report.issues.some((issue) => issue.code === "overdue_active_job"));
assert.equal(H.inspectMiningHealth(shiftStartedAt + 1).ok, true);

console.log("mining-health-smoke: read-only audit detects roster, escrow, lease and overdue-job faults");
process.exit(0);
