import assert from "node:assert/strict";
import { createRuntimeHealth } from "../server/observability/runtime-health.js";

const health = createRuntimeHealth();
assert.equal(health.snapshot().ready, false);

let databaseAvailable = true;
health.setReadinessProbe(async () => {
  if (!databaseAvailable) throw new Error("database unavailable");
  return { latencyMs: 4, lastSuccessfulWriteAt: 123, consecutiveFailures: 0 };
});
health.markReady("postgres");

let snapshot = await health.checkReadiness({ maxAgeMs: 0 });
assert.equal(snapshot.ready, true);
assert.equal(snapshot.persistence, "ready");
assert.equal(snapshot.persistenceLatencyMs, 4);

databaseAvailable = false;
snapshot = await health.checkReadiness({ maxAgeMs: 0 });
assert.equal(snapshot.ready, false, "database probe failure must remove readiness");
assert.equal(snapshot.persistence, "error");

databaseAvailable = true;
snapshot = await health.checkReadiness({ maxAgeMs: 0 });
assert.equal(snapshot.ready, true, "successful probe must restore readiness");
assert.equal(snapshot.lastError, null);

health.markShuttingDown();
snapshot = await health.checkReadiness({ maxAgeMs: 0 });
assert.equal(snapshot.ready, false);

console.log("runtime-health-smoke: persistence failure + recovery readiness ok");
