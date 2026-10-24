import assert from "node:assert/strict";

import {
  miningEconomyInsights,
  miningExpectedStoneValue
} from "../server/services/mining-service.js";

assert.ok(miningExpectedStoneValue("mist-01") > 0);
assert.ok(miningExpectedStoneValue("core-06") > miningExpectedStoneValue("mist-01"));
assert.equal(miningExpectedStoneValue("missing-mine"), 0);

const empty = miningEconomyInsights();
assert.equal(empty.recentShiftCount, 0);
assert.equal(empty.benchmarkBands.length, 5);
assert.equal(empty.benchmarkNetSpread, 4.4);
assert.ok(empty.benchmarkNetSpread <= empty.benchmarkMaxNetSpread,
  "the current strongest and weakest mine should remain inside the fivefold balance band");
assert.deepEqual(empty.alerts, []);
assert.match(empty.estimationNote, /不读取原石隐藏品质/);

const profitableHistory = Array.from({ length: 4 }, (_, index) => ({
  id: `healthy-shift-${index}`,
  mineId: "mist-01",
  completedAt: 2_000_000_000_000 + index,
  roughCount: 4,
  totalMass: 8,
  cost: 400
}));
const fullLeases = Array.from({ length: 2 }, (_, index) => ({
  id: `full-lease-${index}`,
  status: "expired",
  maxShifts: 5,
  shiftsStarted: 5
}));
const healthy = miningEconomyInsights({ history: profitableHistory, leaseHistory: fullLeases });
assert.equal(healthy.recentShiftCount, 4);
assert.ok(healthy.estimatedOutputValue > healthy.allInCost);
assert.ok(healthy.margin > 0.2);
assert.equal(healthy.lossShiftCount, 0);
assert.equal(healthy.leaseUtilization, 1);
assert.equal(healthy.recentBands.length, 1);
assert.deepEqual(healthy.alerts, []);

const lossHistory = Array.from({ length: 4 }, (_, index) => ({
  id: `loss-shift-${index}`,
  mineId: "mist-01",
  completedAt: 2_100_000_000_000 + index,
  roughCount: 0,
  totalMass: 0,
  cost: 2_000
}));
const underusedLeases = Array.from({ length: 2 }, (_, index) => ({
  id: `underused-lease-${index}`,
  status: "expired",
  maxShifts: 5,
  shiftsStarted: 1
}));
const unhealthy = miningEconomyInsights({ history: lossHistory, leaseHistory: underusedLeases });
assert.equal(unhealthy.estimatedOutputValue, 0);
assert.ok(unhealthy.estimatedNet < 0);
assert.equal(unhealthy.lossShiftRate, 1);
assert.equal(unhealthy.leaseUtilization, 0.2);
assert.deepEqual(unhealthy.alerts.map((entry) => entry.id), [
  "thin-net-margin",
  "high-loss-shift-rate",
  "low-lease-utilization"
]);
assert.ok(unhealthy.alerts.every((entry) => entry.metricLabel && entry.recommendation));
assert.match(unhealthy.alerts[0].metricLabel, /-/,
  "a negative margin should remain visibly negative rather than being clamped to zero");

const activeOnly = miningEconomyInsights({
  leaseHistory: [{ id: "active-lease", status: "active", maxShifts: 5, shiftsStarted: 0 }]
});
assert.equal(activeOnly.leaseUtilization, null,
  "an unfinished lease must not create a premature low-utilization warning");
assert.ok(!activeOnly.alerts.some((entry) => entry.id === "low-lease-utilization"));

console.log("mining-economy-insights-smoke: valuation, costs, spread and tuning alerts ok");
