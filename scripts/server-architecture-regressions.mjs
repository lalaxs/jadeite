import assert from "node:assert/strict";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createDurableMutationCoordinator } from "../server/services/durable-mutation-coordinator.js";
import { createRuntimeHealth } from "../server/observability/runtime-health.js";
import { installAdminRoutes } from "../server/gateway/admin-routes.js";
import { createMiningService } from "../server/services/mining-service.js";

const quiet = { error() {}, warn() {} };
function gate() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const world = createMemoryWorldStore();
for (let i = 0; i < 1000; i++) world.setPlayer({ id: `p${i}`, name: `玩家${i}`, cash: 100 });
world.bindSocket("socket-1", "p0");
const entered = gate();
const release = gate();
let failNext = true;
let lastDelta = null;
let lastBefore = null;
const queue = createDurableMutationCoordinator({ world, logger: quiet, flush: async (options) => {
  lastDelta = options.delta;
  lastBefore = options.beforeSnapshot;
  if (failNext) {
    failNext = false;
    entered.resolve();
    await release.promise;
    throw new Error("injected database outage");
  }
} });

const failed = queue.run("trade", () => {
  world.getPlayer("p0").cash -= 10;
  world.getPlayer("p1").cash += 10;
  world.raw.news.push({ id: "failed-news", text: "交易" });
});
const failureCheck = assert.rejects(failed, /database outage/);
await entered.promise;
world.unbindSocket("socket-1");
let readCompleted = false;
let checkpointCompleted = false;
const read = queue.read(() => { readCompleted = true; return world.getPlayer("p0").cash; });
const checkpoint = queue.checkpoint(() => { checkpointCompleted = true; return world.exportSnapshot(); });
// The next HTTP/admin mutation obtains the restored root at execution time.
const routes = new Map();
installAdminRoutes({ app: { use() {}, get() {}, post: (path, handler) => routes.set(path, handler) },
  config: {}, world, durableMutations: queue, io: {}, logger: quiet });
const response = { status() { return this; }, json(value) { this.value = value; } };
const admin = routes.get("/api/admin/players/:playerId/moderation")(
  { params: { playerId: "p0" }, body: { action: "mute", durationMs: 60_000 } }, response
);
await Promise.resolve();
assert.equal(readCompleted, false, "read must wait for an in-flight commit");
assert.equal(checkpointCompleted, false, "checkpoint must wait for an in-flight commit");
release.resolve();
await failureCheck;
assert.equal(await read, 100, "failed state must never escape through a read");
assert.equal((await checkpoint).players.find(([id]) => id === "p0")[1].cash, 100);
await admin;
assert.equal(world.getPlayer("p1").cash, 100, "both trade participants roll back");
assert.equal(world.raw.news.length, 0);
assert.equal(world.raw.sockets.size, 0, "rollback must not resurrect a disconnected transport");
assert.equal(response.value.ok, true);
assert.ok(world.getPlayer("p0").moderation.mutedUntil > Date.now(), "queued HTTP route must modify the restored player root");
assert.equal(lastBefore.players.length, 1, "ordinary commands copy participants, not 1000 stored players");
assert.equal(lastDelta.players.upsert.length, 1);
await assert.rejects(queue.run("invalid", () => { world.getPlayer("p0").cash = NaN; }), /finite|number/i);
assert.equal(world.getPlayer("p0").cash, 100);
await queue.close();

const blocker = gate();
const bounded = createDurableMutationCoordinator({ world, logger: quiet, flush: async () => {}, maxPending: 2 });
const first = bounded.read(() => blocker.promise);
let ticks = 0;
const tick1 = bounded.run("tick", () => { ticks++; }, { key: "tick" });
const tick2 = bounded.run("tick", () => { ticks++; }, { key: "tick" });
assert.equal(tick1, tick2, "overlapping ticks share one queued task");
await assert.rejects(bounded.read(() => {}), (error) => error.code === "SERVER_BUSY");
blocker.resolve();
await Promise.all([first, tick1]);
assert.equal(ticks, 1);
await bounded.close();

const health = createRuntimeHealth();
health.markReady("postgres");
health.markPersistenceError(new Error("writes denied"), { consecutiveFailures: 3 });
health.setReadinessProbe(async () => ({ ok: true, consecutiveFailures: 3 }));
assert.equal((await health.checkReadiness({ maxAgeMs: 0 })).ready, false);
health.setReadinessProbe(async () => ({ ok: true, consecutiveFailures: 0 }));
assert.equal((await health.checkReadiness({ maxAgeMs: 0 })).ready, false, "SELECT 1 cannot clear a write failure");
health.markPersistenceSuccess();
assert.equal((await health.checkReadiness({ maxAgeMs: 0 })).ready, true);

const miningState = createMemoryWorldStore().raw;
const founder = { id: "founder", name: "普通玩家", rep: 100, cash: 1000 };
miningState.players.set(founder.id, founder);
const mining = createMiningService({ getState: () => miningState, money: (value) => Math.round(Number(value) || 0), normalizePlayer() {}, addNews() {}, allowFounderTuning: false });
mining.ensureMiningWorld();
miningState.mining.founderPlayerIds = [founder.id];
miningState.mining.tuningReviewerPlayerId = founder.id;
assert.equal(mining.reviewMiningTuningExperiment(founder, "missing").ok, false);
assert.equal(mining.miningSnapshotForPlayer(founder).tuningGovernance.canManage, false);
const trustedMining = createMiningService({ getState: () => miningState, money: Math.round,
  normalizePlayer() {}, addNews() {}, allowFounderTuning: false, tuningReviewerPlayerIds: [founder.id] });
assert.equal(trustedMining.miningSnapshotForPlayer(founder).tuningGovernance.canManage, true);
console.log("server-architecture-regressions: read/checkpoint isolation, disconnect rollback, queued roots, scoped copies, bounded queue, readiness and production authority ok");
