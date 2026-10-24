import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createGameLifecycle } from "../server/boot/game-lifecycle.js";
import { installProcessLifecycle } from "../server/boot/process-lifecycle.js";
import { createMaterialPriceRuntime } from "../server/services/materials-service.js";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const checks = [];
function fixture(overrides = {}) {
  const events = [];
  const listener = new EventEmitter();
  const player = { employeePayroll: { version: 0 } };
  const deps = {
    world: { allPlayers: () => [player] },
    persister: {
      filePath: "synthetic-only", loadIfPresent: async () => ({ loaded: true, players: 1 }),
      startAutoSave: () => events.push("autosave"), stop: options => events.push(["persist-stop", options]),
      close: () => events.push("persist-close")
    },
    normalizePlayer: () => { events.push("normalize"); player.employeePayroll.version = 1; },
    checkMiningHealth: () => events.push("inspect"),
    reconcileWorld: (_now, options) => { events.push(["reconcile", options]); return false; },
    flushPersistence: () => events.push("flush"),
    durableMutations: { close: () => events.push("queue-drain"), checkpoint: fn => fn() },
    startHttpServer: () => { events.push("listen"); queueMicrotask(() => listener.emit("listening")); return listener; },
    stopHttpServer: () => events.push("http-stop"),
    stopSocketSecurity: () => events.push("security-stop"),
    io: { disconnectSockets: () => events.push("disconnect"), close: callback => { events.push("io-close"); callback(); } },
    health: { markReady: () => events.push("ready"), markError: () => events.push("error"), markShuttingDown: () => events.push("unready") },
    metrics: { set() {} }, logger: { info() {}, error() {} }, ...overrides
  };
  return { game: createGameLifecycle(deps), events, deps, listener };
}

{
  const { game, events } = fixture();
  const start = game.startServer();
  assert.equal(game.startServer(), start, "concurrent starts share one operation");
  await start;
  assert.equal(game.status().phase, "running");
  assert.deepEqual(events.slice(0, 7), ["normalize", "inspect", ["reconcile", { broadcast: false, livestreamCatchUpMaxVisits: 60 }], "flush", "autosave", "listen", "ready"]);
  const stop = game.shutdown();
  assert.equal(game.shutdown(), stop, "concurrent stops share one operation");
  await stop;
  assert.deepEqual(events.slice(7), ["unready", "security-stop", "disconnect", "queue-drain", "http-stop", ["persist-stop", { flush: true }], "persist-close", "io-close"]);
  assert.equal(game.status().phase, "stopped");
  await assert.rejects(game.startServer(), { code: "ERR_GAME_CLOSED" });
  checks.push("single startup, migration checkpoint, original shutdown order, idempotent disposal");
}
{
  const { game, events } = fixture();
  await game.shutdown();
  assert.ok(!events.includes("listen"));
  assert.ok(events.some(row => Array.isArray(row) && row[0] === "persist-stop" && row[1].flush === false));
  await assert.rejects(game.startServer(), { code: "ERR_GAME_CLOSED" });
  checks.push("dispose before start never overwrites an unopened save");
}
for (const point of ["load", "reconcile", "listen"]) {
  const { game, deps, events, listener } = fixture();
  if (point === "load") deps.persister.loadIfPresent = async () => { throw new Error("broken save"); };
  // The closures below are supplied to a fresh lifecycle, since dependencies are captured.
  const failing = createGameLifecycle({ ...deps,
    ...(point === "reconcile" ? { reconcileWorld: () => { throw new Error("broken reconcile"); } } : {}),
    ...(point === "listen" ? { startHttpServer: () => { queueMicrotask(() => listener.emit("error", new Error("occupied port"))); return listener; } } : {})
  });
  await assert.rejects(failing.startServer(), /broken|occupied/);
  assert.equal(failing.status().phase, "failed");
  assert.ok(events.includes("persist-close") && events.includes("io-close") && events.includes("http-stop"));
  assert.ok(events.some(row => Array.isArray(row) && row[0] === "persist-stop" && !row[1].flush));
  await failing.shutdown();
  assert.equal(events.filter(row => row === "io-close").length, 1);
  checks.push(`${point} failure disposes every resource without writing a partial world`);
  void game;
}
{
  const loading = deferred();
  const { deps, events } = fixture();
  deps.persister.loadIfPresent = () => loading.promise;
  const game = createGameLifecycle(deps);
  const startup = assert.rejects(game.startServer(), { code: "ERR_GAME_CLOSED" });
  const shutdown = game.shutdown();
  loading.resolve({ loaded: false });
  await Promise.all([startup, shutdown]);
  assert.ok(!events.includes("listen") && !events.includes("autosave") && !events.includes("ready"));
  checks.push("shutdown during load prevents a late listener or autosave");
}
{
  const { deps, events } = fixture();
  const draining = deferred();
  deps.durableMutations.close = () => draining.promise;
  deps.stopHttpServer = () => { events.push("http-stop"); throw new Error("http cleanup failed"); };
  const game = createGameLifecycle(deps);
  await game.startServer();
  const stopped = assert.rejects(game.shutdown(), /http cleanup failed/);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.ok(!events.includes("persist-close"), "save close waits for the mutation queue");
  draining.resolve();
  await stopped;
  assert.ok(events.includes("persist-close") && events.includes("io-close"), "one close error must not skip other resources");
  checks.push("queue drain and cleanup-error continuation");
}
{
  const a = createMaterialPriceRuntime(), b = createMaterialPriceRuntime();
  assert.deepEqual(a.getMaterialPriceHistory("goldPure"), b.getMaterialPriceHistory("goldPure"));
  a.recordMaterialPriceTick();
  assert.equal(a.getMaterialPriceHistory("goldPure").length, 15);
  assert.equal(b.getMaterialPriceHistory("goldPure").length, 14);
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  const cleared = [], timers = [];
  try {
    globalThis.setInterval = (callback, ms) => { const timer = { callback, ms, unref() {} }; timers.push(timer); return timer; };
    globalThis.clearInterval = timer => cleared.push(timer);
    assert.equal(a.startMaterialPriceTicker(), a.startMaterialPriceTicker());
    b.startMaterialPriceTicker();
    a.stopMaterialPriceTicker(); a.stopMaterialPriceTicker();
    assert.deepEqual(cleared, [timers[0]]);
    timers[1].callback();
    assert.equal(b.getMaterialPriceHistory("goldPure").length, 15);
    b.stopMaterialPriceTicker();
    assert.deepEqual(cleared, timers);
  } finally { globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
  checks.push("per-game material history and timer ownership");
}
for (const failure of [false, true]) {
  const host = new EventEmitter(), exits = [], stopped = [], complete = deferred();
  host.exit = code => exits.push(code);
  const dispose = installProcessLifecycle({ host, game: {
    logger: { error() {} }, runtimeConfig: { shutdownGraceMs: 1000 },
    shutdown: signal => { stopped.push(signal); return failure ? Promise.reject(new Error("close failed")) : complete.promise; }
  } });
  host.emit("SIGTERM"); host.emit("SIGINT");
  complete.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(stopped, ["SIGTERM"]);
  assert.deepEqual(exits, [failure ? 1 : 0]);
  assert.equal(host.listenerCount("SIGINT") + host.listenerCount("SIGTERM"), 0);
  dispose();
}
checks.push("CLI signals exit once, propagate close failure, remove handlers");
{
  const host = new EventEmitter(), exits = [], complete = deferred();
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let deadline, cleared = false;
  host.exit = code => exits.push(code);
  try {
    globalThis.setTimeout = (callback, ms) => { assert.equal(ms, 1250); deadline = callback; return { unref() {} }; };
    globalThis.clearTimeout = () => { cleared = true; };
    const dispose = installProcessLifecycle({ host, game: { logger: { error() {} }, runtimeConfig: { shutdownGraceMs: 1250 }, shutdown: () => complete.promise } });
    host.emit("SIGTERM"); deadline();
    assert.deepEqual(exits, [1], "the CLI host enforces its shutdown deadline");
    dispose(); assert.ok(cleared);
    assert.equal(host.listenerCount("SIGINT") + host.listenerCount("SIGTERM"), 0);
    complete.resolve(); await Promise.resolve(); await Promise.resolve();
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
  checks.push("CLI deadline and explicit signal-adapter disposal");
}
console.log(JSON.stringify({ ok: true, checks }));
