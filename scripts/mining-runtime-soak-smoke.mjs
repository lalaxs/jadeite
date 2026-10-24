import assert from "node:assert/strict";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "50";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "60000";
process.env.JADE_MINING_LEASE_MS = String(6 * 60 * 60 * 1000);
process.env.JADE_MINING_SHIFT_MS = "60000";

const { __testHooks } = await import(`../server.js?mining-runtime-soak=${Date.now()}`);
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

const PLAYER_COUNT = 50;
const ROUND_COUNT = 60;
const openingCash = 20_000_000;
const startedAt = 1_850_000_000_000;
const playerIds = [];

function assertFiniteNumbers(value, location = "mining-world") {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${location} contains a non-finite number`);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteNumbers(entry, `${location}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assertFiniteNumbers(entry, `${location}.${key}`);
  }
}

function submitRoundApplications(targetRound, submittedAt) {
  for (const playerId of playerIds) {
    const player = state.players.get(playerId);
    player.lastSeenAt = submittedAt;
    const result = submitMiningApplication(
      player,
      ["core-06", "core-05", "core-04"],
      submittedAt,
      { allowFallback: true }
    );
    assert.equal(result.ok, true, `round ${targetRound}: ${playerId} should be able to apply`);
    assert.equal(result.application.targetRound, targetRound);
  }
}

for (let index = 0; index < PLAYER_COUNT; index += 1) {
  const sequence = String(index + 1).padStart(2, "0");
  const player = makePlayer(`mining-soak-${sequence}`);
  player.name = `矿区耐久掌柜${sequence}`;
  player.cash = openingCash;
  player.lastSeenAt = startedAt;
  normalizePlayer(player);
  world.setPlayer(player);
  playerIds.push(player.id);
}

processMiningWorld(startedAt);
submitRoundApplications(1, state.mining.currentRound.startsAt - 1);
processMiningWorld(state.mining.currentRound.startsAt);

let totalRent = 0;
let totalWages = 0;
let completedShifts = 0;

for (let expectedRound = 1; expectedRound <= ROUND_COUNT; expectedRound += 1) {
  const round = state.mining.currentRound;
  assert.equal(round.number, expectedRound);
  assert.ok(round.allocatedAt, `round ${expectedRound} should already be allocated`);
  assert.equal(round.leases.length, 30);
  assert.equal(new Set(round.leases.map((lease) => lease.playerId)).size, 30);
  assert.equal(new Set(round.leases.map((lease) => lease.mineId)).size, 30);
  totalRent += round.leases.reduce((sum, lease) => sum + lease.rent, 0);

  const shiftStartedAt = round.startsAt + 1;
  for (const lease of round.leases) {
    const player = state.players.get(lease.playerId);
    const starterMiner = player.mining.miners[0];
    const result = startMiningShift(player, { minerIds: [starterMiner.id] }, shiftStartedAt);
    assert.equal(result.ok, true, `round ${expectedRound}: ${player.id} should start one shift`);
    totalWages += result.fee;
  }
  const shiftResult = processMiningJobs(shiftStartedAt + 60_000, { rng: () => 0.9 });
  assert.equal(shiftResult.results.length, 30);
  completedShifts += shiftResult.results.length;
  assert.ok(playerIds.every((playerId) => state.players.get(playerId).mining.jobs.length === 0));

  if (expectedRound < ROUND_COUNT) {
    const submittedAt = round.endsAt - 1;
    submitRoundApplications(expectedRound + 1, submittedAt);
    processMiningWorld(round.endsAt);
  }

  if (expectedRound % 10 === 0) {
    const snapshot = world.exportSnapshot({ savedAt: round.endsAt });
    assertFiniteNumbers(snapshot);
    world.clear({ keepStartedAt: false });
    world.importSnapshot(snapshot);
    assert.equal(state.players.size, PLAYER_COUNT);
    assert.equal(state.mining.applications.length, 0);
    assert.equal(state.mining.currentRound.leases.length, 30);
    assert.ok(playerIds.every((playerId) => state.players.get(playerId).mining.jobs.length === 0));
  }
}

const totalCash = playerIds.reduce((sum, playerId) => sum + state.players.get(playerId).cash, 0);
assert.equal((PLAYER_COUNT * openingCash) - totalCash, totalRent + totalWages,
  "only awarded rent and completed shift wages should leave the player economy");
assert.equal(completedShifts, ROUND_COUNT * 30);
assert.ok(state.mining.history.length <= 12, "world round history must remain bounded");
for (const playerId of playerIds) {
  const mining = state.players.get(playerId).mining;
  assert.ok(mining.applicationHistory.length <= 30);
  assert.ok(mining.leaseHistory.length <= 20);
  assert.ok(mining.history.length <= 20);
}

console.log("mining-runtime-soak-smoke: 50 players, 60 rounds, 1800 shifts and 6 restart cycles ok");
