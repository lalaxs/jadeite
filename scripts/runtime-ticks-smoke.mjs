import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createRuntimeTicks,
  applyReputationDecay,
  REPUTATION_DECAY_INTERVAL_MS,
  REPUTATION_DECAY_FLOOR,
  MINING_HEALTH_CHECK_INTERVAL_MS
} from "../server/shell/runtime-ticks.js";
import { __testHooks as H } from "../server.js";

const ticks = createRuntimeTicks({
  httpServer: { listen: () => ({}) },
  PORT: 0,
  getState: () => H.state,
  startMaterialPriceTicker: () => {},
  refreshRoughPool: () => {},
  addNews: () => {},
  normalizePlayer: H.normalizePlayer,
  isPlayerOnline: H.isPlayerOnline,
  settleProductionJobsForPlayer: H.settleProductionJobsForPlayer || (() => []),
  broadcast: () => {},
  processAuctionLifecycle: () => false,
  reconcileAuctionEscrows: () => ({ changed: false, count: 0, refunded: 0 }),
  reconcileMarketReferences: () => ({ changed: false }),
  reconcileBlackmarketReferences: () => ({ changed: false }),
  processExpiredWants: () => false,
  refillOrders: H.refillOrders,
  processProductionJobs: H.processProductionJobs,
  processLivestreamRooms: H.processLivestreamRooms,
  randomUUID: () => "tick-test-id",
  qualityByKey: H.qualityByKey,
  clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
  money: (v) => Math.max(0, Math.round(Number(v) || 0)),
  earnCash: H.earnCash,
  markInventoryItemNew: H.markInventoryItemNew,
  angleDistance: H.angleDistance || ((a, b) => Math.abs(a - b)),
  cutAngleName: H.cutAngleName || ((a) => `${a}°`)
});

assert.equal(typeof ticks.processPolishingJobs, "function");
assert.equal(typeof ticks.reconcileWorld, "function");
assert.equal(typeof ticks.checkMiningHealth, "function");
assert.equal(typeof ticks.reportMiningRecovery, "function");
assert.equal(typeof ticks.startServer, "function");
assert.equal(typeof H.processPolishingJobs, "function");
assert.equal(typeof H.reconcileWorld, "function");

const decayPlayer = { rep: 30, repHistory: [], lastRepDecayAt: 1_000 };
assert.equal(REPUTATION_DECAY_INTERVAL_MS, 10 * 60 * 1_000);
assert.equal(applyReputationDecay(decayPlayer, 1_000 + REPUTATION_DECAY_INTERVAL_MS - 1).applied, false);
assert.equal(applyReputationDecay(decayPlayer, 1_000 + REPUTATION_DECAY_INTERVAL_MS).amount, 0.5);
assert.equal(decayPlayer.rep, 29.5);
decayPlayer.rep = REPUTATION_DECAY_FLOOR;
assert.equal(applyReputationDecay(decayPlayer, 1_000 + REPUTATION_DECAY_INTERVAL_MS * 2).applied, false);
assert.equal(decayPlayer.rep, REPUTATION_DECAY_FLOOR);

const offlinePlayer = H.makePlayer("tick-offline");
H.state.players.set(offlinePlayer.id, offlinePlayer);
assert.equal(ticks.processPolishingJobs(1000), false);

let broadcastCount = 0;
const coalescedTicks = createRuntimeTicks({
  getState: () => ({ players: new Map([["online", { id: "online" }]]) }),
  normalizePlayer: () => {},
  isPlayerOnline: () => true,
  settleProductionJobsForPlayer: () => [{ type: "complete" }],
  broadcast: () => { broadcastCount += 1; }
});
assert.equal(coalescedTicks.processPolishingJobs(1000, { broadcast: false }), true);
assert.equal(broadcastCount, 0, "coalesced tick must defer its broadcast");
assert.equal(coalescedTicks.processPolishingJobs(1001), true);
assert.equal(broadcastCount, 1, "standalone processing still broadcasts once");

const reconcileCalls = [];
let reconcileBroadcasts = 0;
const recoveryTicks = createRuntimeTicks({
  getState: () => ({ players: new Map() }),
  normalizePlayer: () => {},
  broadcast: () => { reconcileBroadcasts += 1; },
  processProductionJobs: () => false,
  processLivestreamRooms: () => false,
  processAuctionLifecycle: () => {
    reconcileCalls.push("auction-lifecycle");
    return false;
  },
  reconcileAuctionEscrows: () => {
    reconcileCalls.push("auction-escrow");
    return { changed: true };
  },
  reconcileMarketReferences: () => {
    reconcileCalls.push("market-references");
    return { changed: true };
  },
  reconcileBlackmarketReferences: () => {
    reconcileCalls.push("blackmarket-references");
    return { changed: true };
  },
  processExpiredWants: () => {
    reconcileCalls.push("expired-wants");
    return false;
  },
  processMarketLiquidity: () => ({ changed: false }),
  processExpiredBlackServiceOrders: () => false,
  refreshBlackServiceOrderStates: () => false,
  processExpiredBlindDraws: () => false,
  sweepEmptyBlackGoodsStalls: () => false,
  ensureDailyOrderRefresh: () => false
});
assert.equal(recoveryTicks.reconcileWorld(1234), true);
assert.deepEqual(reconcileCalls, [
  "auction-lifecycle",
  "auction-escrow",
  "market-references",
  "expired-wants",
  "blackmarket-references"
]);
assert.equal(reconcileBroadcasts, 1);

const healthWarnings = [];
const healthInfo = [];
let healthReport = {
  ok: false,
  issues: [{ code: "duplicate_lease_mine", scope: "lease:test" }]
};
const healthTicks = createRuntimeTicks({
  inspectMiningHealth: () => healthReport,
  logMiningWarning: (message) => healthWarnings.push(message),
  logMiningInfo: (message) => healthInfo.push(message)
});
assert.equal(healthTicks.checkMiningHealth(1000), healthReport);
assert.equal(healthWarnings.length, 1);
assert.match(healthWarnings[0], /duplicate_lease_mine@lease:test/);
healthTicks.checkMiningHealth(1001);
assert.equal(healthWarnings.length, 1, "unchanged health faults must be log-deduplicated");
healthReport = { ok: true, issues: [] };
healthTicks.checkMiningHealth(1002);
assert.deepEqual(healthInfo, ["[mining-health] recovered"]);

const miningRecoveryInfo = [];
const miningRecoveryTicks = createRuntimeTicks({
  logMiningInfo: (message) => miningRecoveryInfo.push(message)
});
const recoverySummary = {
  recoveredTimings: 2,
  recoveredCosts: 1,
  recoveredLeaseLinks: 1,
  refundedJobs: 1,
  deduplicatedJobs: 3,
  recoveredConcurrentJobs: 2,
  prunedJobs: 1
};
assert.match(miningRecoveryTicks.reportMiningRecovery(recoverySummary), /timing=2/);
assert.match(miningRecoveryInfo[0], /cost=1/);
assert.match(miningRecoveryInfo[0], /lease-link=1/);
assert.match(miningRecoveryInfo[0], /refunded=1/);
assert.match(miningRecoveryInfo[0], /deduplicated=3/);
assert.match(miningRecoveryInfo[0], /concurrent=2/);
assert.match(miningRecoveryInfo[0], /pruned=1/);
assert.equal(miningRecoveryTicks.reportMiningRecovery(recoverySummary), null,
  "an unchanged recovery summary should not spam logs");
assert.equal(miningRecoveryTicks.reportMiningRecovery({}), null);
assert.match(miningRecoveryTicks.reportMiningRecovery(recoverySummary), /timing=2/,
  "a clean tick should reset recovery-log deduplication for later events");
assert.equal(miningRecoveryInfo.length, 2);

// Exercise the actual scheduled callbacks without starting a listener or waiting 15 seconds.
const scheduled = new Map();
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
let inspections = 0;
let readInspections = 0;
let durableTicks = 0;
const scheduledTicks = createRuntimeTicks({
  httpServer: { listen: () => ({ listening: false }) }, PORT: 0,
  getState: () => ({ players: new Map() }),
  startMaterialPriceTicker() {}, stopMaterialPriceTicker() {}, refreshRoughPool() {}, addNews() {},
  inspectMiningHealth: () => { inspections++; return { ok: true, issues: [] }; },
  runReadOperation: async (label, operation) => {
    assert.equal(label, "inspection:mining"); readInspections++; return operation();
  },
  runDurableMutation: async (_label, operation) => { durableTicks++; return operation(); },
  processProductionJobs: () => false, processLivestreamRooms: () => false,
  processAuctionLifecycle: () => false, processExpiredWants: () => false,
  processExpiredBlackServiceOrders: () => false, refreshBlackServiceOrderStates: () => false
});
try {
  globalThis.setInterval = (callback, interval) => {
    const timer = { unref() {} }; scheduled.set(interval, callback); return timer;
  };
  globalThis.clearInterval = () => {};
  scheduledTicks.startServer();
  assert.equal(MINING_HEALTH_CHECK_INTERVAL_MS, 15_000);
  assert.equal(inspections, 1, "boot still checks mining health immediately");
  scheduled.get(1000)();
  await Promise.resolve();
  assert.equal(inspections, 1, "settlement must not perform a global health scan");
  assert.equal(durableTicks, 1);
  scheduled.get(MINING_HEALTH_CHECK_INTERVAL_MS)();
  await Promise.resolve();
  assert.equal(readInspections, 1);
  assert.equal(inspections, 2);
  assert.equal(durableTicks, 1, "inspection must not enter the durable mutation path");
  await scheduledTicks.stopServer();
} finally {
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
}

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
const runtimeSource = readFileSync("server/shell/runtime-ticks.js", "utf8");
assert.match(bootSource, /runtime-ticks\.js/);
assert.match(bootSource, /createRuntimeTicks/);
assert.doesNotMatch(serverSource, /function processPolishingJobs\(/);
assert.doesNotMatch(serverSource, /function startServer\(/);
assert.doesNotMatch(serverSource, /function resolveCuttingJob\(/);
assert.match(readFileSync("server/boot/game-lifecycle.js", "utf8"), /function startServer\(/, "game lifecycle owns persistence restore before runtime start");

assert.match(runtimeSource, /function processPolishingJobs/);
assert.match(runtimeSource, /function startServer/);
assert.match(runtimeSource, /function checkMiningHealth/);
assert.match(runtimeSource, /function reportMiningRecovery/);
assert.match(runtimeSource, /processPolishingJobs\(now, \{ broadcast: false \}\)/);
assert.match(runtimeSource, /if \(!isPlayerOnline\(player\)\) continue/);
assert.match(runtimeSource, /processProductionJobs\(now, \{ broadcast: false \}\)/);
assert.match(runtimeSource, /processLivestreamRooms\(now, \{ broadcast: false \}\)/);
assert.match(runtimeSource, /reconcileAuctionEscrows\(\)\.changed/);
assert.match(runtimeSource, /reconcileMarketReferences\(\)\.changed/);
assert.match(runtimeSource, /reconcileBlackmarketReferences\(state, now\)\.changed/);
assert.match(wireSource, /reconcileAuctionEscrows,/);

console.log("runtime-ticks-smoke: ok");
process.exit(0);
