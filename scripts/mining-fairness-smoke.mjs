import assert from "node:assert/strict";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "50";
process.env.JADE_MINING_REQUIRED_REP = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "1000";

const { __testHooks } = await import(`../server.js?mining-fairness=${Date.now()}`);
const {
  world,
  state,
  makePlayer,
  normalizePlayer,
  processMiningWorld,
  submitMiningApplication
} = __testHooks;

const startedAt = 1_820_000_000_000;
const openingCash = 50_000_000;
const players = Array.from({ length: 50 }, (_, index) => {
  const sequence = String(index + 1).padStart(2, "0");
  const player = makePlayer(`mining-fairness-${sequence}`);
  player.name = `长期竞租测试掌柜${sequence}`;
  player.cash = openingCash;
  player.lastSeenAt = startedAt;
  normalizePlayer(player);
  world.setPlayer(player);
  return player;
});

processMiningWorld(startedAt);

const preferences = ["core-06", "core-05", "core-04"];
const winsByPlayer = new Map(players.map((player) => [player.id, 0]));
let previousWinners = new Set();
let previousMines = new Map();
let cumulativeRent = 0;

for (let expectedRound = 1; expectedRound <= 20; expectedRound += 1) {
  const pendingRound = state.mining.currentRound;
  const closesAt = pendingRound.allocatedAt ? pendingRound.endsAt : pendingRound.startsAt;
  const submitAt = closesAt - 50;

  for (const player of players) {
    const result = submitMiningApplication(player, preferences, submitAt, { allowFallback: true });
    assert.equal(result.ok, true, `round ${expectedRound}: every active competitor should be able to apply`);
  }

  processMiningWorld(closesAt);
  const round = state.mining.currentRound;
  assert.equal(round.number, expectedRound);
  assert.equal(round.leases.length, 30, `round ${expectedRound}: all 30 mines should be allocated`);
  assert.equal(new Set(round.leases.map((lease) => lease.playerId)).size, 30,
    `round ${expectedRound}: one player must not receive two mines`);
  assert.equal(new Set(round.leases.map((lease) => lease.mineId)).size, 30,
    `round ${expectedRound}: one mine must not have two tenants`);

  const currentWinners = new Set(round.leases.map((lease) => lease.playerId));
  if (expectedRound > 1) {
    const previousLosers = players.filter((player) => !previousWinners.has(player.id));
    assert.equal(previousLosers.length, 20);
    assert.ok(previousLosers.every((player) => currentWinners.has(player.id)),
      `round ${expectedRound}: nobody should lose two consecutive rounds`);
    assert.equal(round.leases.filter((lease) => lease.priorityAllocation).length, 20,
      `round ${expectedRound}: all 20 previous-round losers should consume priority protection`);
    assert.ok(round.leases.every((lease) => previousMines.get(lease.playerId) !== lease.mineId),
      `round ${expectedRound}: winners must rotate away from their previous mine`);
  } else {
    assert.equal(round.leases.filter((lease) => lease.priorityAllocation).length, 0);
  }

  for (const lease of round.leases) {
    winsByPlayer.set(lease.playerId, winsByPlayer.get(lease.playerId) + 1);
    cumulativeRent += lease.rent;
  }
  const totalCash = players.reduce((sum, player) => sum + player.cash, 0);
  assert.equal(players.length * openingCash - totalCash, cumulativeRent,
    `round ${expectedRound}: only awarded rents should leave the player economy`);

  previousWinners = currentWinners;
  previousMines = new Map(round.leases.map((lease) => [lease.playerId, lease.mineId]));
}

const winCounts = [...winsByPlayer.values()];
assert.ok(winCounts.every((wins) => wins >= 10),
  "priority protection should guarantee every always-participating player at least one win every two rounds");
assert.equal(winCounts.reduce((sum, wins) => sum + wins, 0), 20 * 30);

console.log("mining-fairness-smoke: 20-round no-starvation, mine rotation and cash conservation ok");
