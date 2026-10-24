import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createMetrics } from "../server/observability/metrics.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createDurableMutationCoordinator } from "../server/services/durable-mutation-coordinator.js";
import { createServerContext } from "../server/shell/server-context.js";

const metrics = createMetrics();
for (const value of [0, 1, 8, 30, 70000]) metrics.observe("fixture_milliseconds", { phase: "queue" }, value);
for (const value of [-1, Infinity, NaN]) metrics.observe("fixture_milliseconds", { phase: "queue" }, value);
metrics.observe("fixture_milliseconds", { phase: 'quote"line\n' }, 5);
const histogram = metrics.render();
assert.match(histogram, /# TYPE fixture_milliseconds histogram/);
assert.match(histogram, /fixture_milliseconds_bucket\{phase="queue",le="10"\} 3/);
assert.match(histogram, /fixture_milliseconds_bucket\{phase="queue",le="\+Inf"\} 5/);
assert.match(histogram, /fixture_milliseconds_sum\{phase="queue"\} 70039/);
assert.match(histogram, /fixture_milliseconds_count\{phase="queue"\} 5/);
assert.ok(histogram.includes('phase="quote\\"line\\n"'), "labels must remain valid Prometheus text");
assert.match(metrics.render(), /fixture_milliseconds_count\{phase="queue"\} 5/, "scrapes must not reset cumulative histogram observations");

const world = createMemoryWorldStore();
world.setPlayer({ id: "metrics-player", cash: 100 });
let release;
let entered;
const holding = new Promise((resolve) => { release = resolve; });
const held = new Promise((resolve) => { entered = resolve; });
const queue = createDurableMutationCoordinator({ world, metrics, logger: { error() {} },
  flush: async ({ action }) => { await delay(2); if (action === "failure") throw new Error("fixture database failure"); }
});
const blockedRead = queue.read(async () => { entered(); await holding; }, { label: "held-read" });
await held;
const mutation = queue.run("purchase", () => { world.getPlayer("metrics-player").cash -= 10; });
await delay(20);
release();
await blockedRead; await mutation;
await assert.rejects(queue.run("failure", () => { world.getPlayer("metrics-player").cash -= 50; }), /database failure/);
assert.equal(world.getPlayer("metrics-player").cash, 90);
const rows = metrics.render();
for (const event of ["purchase", "failure"]) {
  for (const phase of ["queue", "compute", "commit"]) assert.ok(rows.includes(
    `jade_operation_phase_milliseconds_count{event="${event}",phase="${phase}"} 1`
  ), `${event}: ${phase} must be observed even when persistence fails`);
  assert.ok(rows.includes(`jade_operation_milliseconds_count{event="${event}"} 1`));
}
assert.ok(Number(rows.match(/jade_operation_phase_milliseconds_sum\{event="purchase",phase="queue"\} ([\d.]+)/)?.[1]) >= 15,
  "blocked queue wait must be measured separately from compute and commit");
await queue.close();

world.bindSocket("metrics-socket", "metrics-player");
const socket = { id: "metrics-socket", emit() {}, handshake: { auth: { capabilities: { statePatchV1: true } } } };
const context = createServerContext({ world, metrics, getState: () => world.raw,
  randomUUID: () => "fixture", io: { sockets: { sockets: new Map([[socket.id, socket]]) } }
});
context.bindSnapshotFor((player, _now, options) => ({ ...options.sharedSnapshot, me: { cash: player.cash } }), () => ({ news: [] }));
context.broadcast();
const broadcastRows = metrics.render();
assert.match(broadcastRows, /jade_broadcast_milliseconds_count 1/);
assert.match(broadcastRows, /jade_broadcast_phase_milliseconds_count\{phase="shared_snapshot"\} 1/);
assert.match(broadcastRows, /jade_broadcast_phase_milliseconds_count\{phase="personalize_and_emit"\} 1/);
console.log("phase-metrics-smoke: cumulative Prometheus histograms + queue isolation + failed-commit timing + broadcast phases ok");
