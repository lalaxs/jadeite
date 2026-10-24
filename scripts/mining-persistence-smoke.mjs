import assert from "node:assert/strict";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "31";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "1000";
process.env.JADE_MINING_SHIFT_MS = "200";

const { __testHooks } = await import(`../server.js?mining-persistence=${Date.now()}`);
const {
  world,
  state,
  makePlayer,
  normalizePlayer,
  processMiningWorld,
  submitMiningApplication,
  startMiningShift,
  processMiningJobs
} = __testHooks;

const startedAt = 1_830_000_000_000;
const openingCash = 500_000;
const players = Array.from({ length: 31 }, (_, index) => {
  const sequence = String(index + 1).padStart(2, "0");
  const player = makePlayer(`mining-persist-${sequence}`);
  player.name = `重启竞租测试掌柜${sequence}`;
  player.cash = openingCash;
  player.lastSeenAt = startedAt;
  normalizePlayer(player);
  world.setPlayer(player);
  return player;
});

processMiningWorld(startedAt);
for (const player of players) {
  const result = submitMiningApplication(
    player,
    ["core-06", "core-05", "core-04"],
    startedAt + 10,
    { allowFallback: true }
  );
  assert.equal(result.ok, true);
}

assert.equal(state.mining.applications.length, 31);
assert.equal(state.mining.activeApplicationRound, 1);
assert.ok(players.every((player) => player.cash < openingCash),
  "every pending application should have its maximum rent frozen before persistence");

const pendingSnapshot = world.exportSnapshot({ savedAt: startedAt + 20 });
world.clear({ keepStartedAt: false });
world.importSnapshot(pendingSnapshot);

assert.equal(state.mining.applications.length, 31,
  "pending mining applications must survive a world reload");
assert.equal(state.mining.activeApplicationRound, 1,
  "the active application window marker must survive a world reload");
assert.ok([...state.players.values()].every((player) => player.cash < openingCash),
  "reloading must not release or duplicate frozen application funds");

processMiningWorld(startedAt + 100);
assert.equal(state.mining.currentRound.number, 1);
assert.equal(state.mining.currentRound.leases.length, 30);
assert.equal(state.mining.currentRound.competitionStats.applicantCount, 31);
assert.equal(state.mining.currentRound.competitionStats.winnerCount, 30);
assert.equal(state.mining.applications.length, 0);
assert.equal(state.mining.activeApplicationRound, null);

const winnerIds = new Set(state.mining.currentRound.leases.map((lease) => lease.playerId));
const losers = [...state.players.values()].filter((player) => !winnerIds.has(player.id));
assert.equal(losers.length, 1);
assert.equal(losers[0].cash, openingCash,
  "the sole loser must receive the complete frozen amount after restart-time allocation");
assert.equal(losers[0].mining.priorityRound, 2);
assert.ok([...state.players.values()].every((player) => player.mining.applicationHistory.length === 1),
  "every settled application result must be written before persistence");

const totalRent = state.mining.currentRound.leases.reduce((sum, lease) => sum + lease.rent, 0);
const totalCash = [...state.players.values()].reduce((sum, player) => sum + player.cash, 0);
assert.equal(players.length * openingCash - totalCash, totalRent,
  "post-restart settlement must remove only awarded rent from the economy");

const settledLeaseSignature = state.mining.currentRound.leases
  .map((lease) => `${lease.id}:${lease.playerId}:${lease.mineId}:${lease.rent}`)
  .sort();
const settledCompetitionStats = structuredClone(state.mining.currentRound.competitionStats);
const settledCashByPlayer = new Map(
  [...state.players.values()].map((player) => [player.id, player.cash])
);
const settledApplicationHistoryByPlayer = new Map(
  [...state.players.values()].map((player) => [player.id, structuredClone(player.mining.applicationHistory)])
);
const settledSnapshot = world.exportSnapshot({ savedAt: startedAt + 101 });
world.clear({ keepStartedAt: false });
world.importSnapshot(settledSnapshot);

assert.equal(processMiningWorld(startedAt + 102).changed, false,
  "reprocessing an already-settled round after restart must be idempotent");
assert.deepEqual(
  state.mining.currentRound.leases
    .map((lease) => `${lease.id}:${lease.playerId}:${lease.mineId}:${lease.rent}`)
    .sort(),
  settledLeaseSignature,
  "restart must preserve the exact lease allocation"
);
assert.deepEqual(state.mining.currentRound.competitionStats, settledCompetitionStats,
  "restart must preserve per-round competition analytics");
assert.deepEqual(
  new Map([...state.players.values()].map((player) => [player.id, player.cash])),
  settledCashByPlayer,
  "restart-time reconciliation must not charge rent or refund escrow twice"
);
assert.deepEqual(
  new Map([...state.players.values()].map((player) => [player.id, player.mining.applicationHistory])),
  settledApplicationHistoryByPlayer,
  "competition result history must survive restart without duplicate settlement entries"
);

const workingLease = state.mining.currentRound.leases[0];
const workingPlayer = state.players.get(workingLease.playerId);
const workingMiner = workingPlayer.mining.miners[0];
const shiftStartedAt = startedAt + 200;
const startedShift = startMiningShift(workingPlayer, {
  minerIds: [workingMiner.id]
}, shiftStartedAt);
assert.equal(startedShift.ok, true);
assert.equal(workingPlayer.mining.jobs.length, 1);
const cashAfterShiftStarted = workingPlayer.cash;
const roughCountBeforeShift = workingPlayer.rough.length;

const activeShiftSnapshot = world.exportSnapshot({ savedAt: shiftStartedAt + 50 });
world.clear({ keepStartedAt: false });
world.importSnapshot(activeShiftSnapshot);
const reloadedWorkingPlayer = state.players.get(workingPlayer.id);
assert.equal(reloadedWorkingPlayer.mining.jobs.length, 1,
  "an active mining shift must survive a world reload");
assert.equal(processMiningJobs(shiftStartedAt + 199, { rng: () => 0.9 }).results.length, 0,
  "a reloaded mining shift must not settle before its locked completion time");
const reloadedSettlement = processMiningJobs(shiftStartedAt + 200, { rng: () => 0.9 });
assert.equal(reloadedSettlement.results.length, 1,
  "a reloaded mining shift should settle when its locked completion time arrives");
assert.equal(reloadedWorkingPlayer.mining.jobs.length, 0);
assert.equal(reloadedWorkingPlayer.cash, cashAfterShiftStarted,
  "reloading and settling a shift must not charge its wages twice");
assert.ok(reloadedWorkingPlayer.rough.length > roughCountBeforeShift,
  "the reloaded mining shift should still deliver its rough stones");

const settledShiftRoughCount = reloadedWorkingPlayer.rough.length;
const settledShiftHistoryCount = reloadedWorkingPlayer.mining.history.length;
const completedShiftSnapshot = world.exportSnapshot({ savedAt: shiftStartedAt + 201 });
world.clear({ keepStartedAt: false });
world.importSnapshot(completedShiftSnapshot);
const twiceReloadedWorkingPlayer = state.players.get(workingPlayer.id);
assert.equal(processMiningJobs(shiftStartedAt + 500, { rng: () => 0.1 }).results.length, 0,
  "an already-settled mining shift must not settle again after another reload");
assert.equal(twiceReloadedWorkingPlayer.rough.length, settledShiftRoughCount);
assert.equal(twiceReloadedWorkingPlayer.mining.history.length, settledShiftHistoryCount);

console.log("mining-persistence-smoke: pending escrow and active shifts survive restart with idempotent settlement");
