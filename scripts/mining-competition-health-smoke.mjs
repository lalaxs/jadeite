import assert from "node:assert/strict";

import { miningCompetitionHealth } from "../server/services/mining-service.js";

const leaseMs = 10 * 60 * 1000;
const healthyInsights = {
  currentTargetRound: 12,
  currentApplicantCount: 10,
  waitlistCount: 0,
  averageWaitMs: 0,
  recentRoundCount: 3,
  recentParticipationRate: 0.8,
  recentReleaseRate: 0.05,
  mineHeat: [{ mineId: "mist-01", applicantCount: 4 }]
};

assert.deepEqual(
  miningCompetitionHealth(healthyInsights, { leaseMs }),
  [],
  "healthy competition data should not produce tuning warnings"
);

const lowParticipation = miningCompetitionHealth({
  ...healthyInsights,
  recentParticipationRate: 0.4
}, { leaseMs });
assert.deepEqual(lowParticipation.map((entry) => entry.id), ["low-participation"]);
assert.equal(lowParticipation[0].severity, "critical");
assert.match(lowParticipation[0].metricLabel, /40%.*65%/);
assert.match(lowParticipation[0].recommendation, /延长约 20%/);

const longWait = miningCompetitionHealth({
  ...healthyInsights,
  waitlistCount: 7,
  averageWaitMs: leaseMs * 2.5
}, { leaseMs });
assert.deepEqual(longWait.map((entry) => entry.id), ["long-waitlist"]);
assert.match(longWait[0].metricLabel, /2\.5 个租期.*2 个租期/);
assert.match(longWait[0].recommendation, /增加 5 个/);

const concentrated = miningCompetitionHealth({
  ...healthyInsights,
  currentApplicantCount: 10,
  mineHeat: [{ mineId: "core-01", applicantCount: 7 }]
}, { leaseMs });
assert.deepEqual(concentrated.map((entry) => entry.id), ["mine-concentration"]);
assert.match(concentrated[0].metricLabel, /70%.*60%/);
assert.match(concentrated[0].recommendation, /3%–5%/);

const highRelease = miningCompetitionHealth({
  ...healthyInsights,
  recentReleaseRate: 0.15
}, { leaseMs });
assert.deepEqual(highRelease.map((entry) => entry.id), ["high-release-rate"]);
assert.match(highRelease[0].metricLabel, /15%.*12%/);
assert.match(highRelease[0].recommendation, /3 轮调为 4 轮/);

assert.deepEqual(miningCompetitionHealth({
  ...healthyInsights,
  recentRoundCount: 2,
  recentParticipationRate: 0,
  recentReleaseRate: 1
}, { leaseMs }), [], "trend warnings should wait for three settled rounds");

assert.deepEqual(miningCompetitionHealth({
  ...healthyInsights,
  recentParticipationRate: 0.65,
  recentReleaseRate: 0.12,
  waitlistCount: 1,
  averageWaitMs: leaseMs * 2,
  currentApplicantCount: 10,
  mineHeat: [{ mineId: "mist-01", applicantCount: 6 }]
}, { leaseMs }), [], "values exactly on a health threshold should not be reported");

const combined = miningCompetitionHealth({
  ...healthyInsights,
  recentParticipationRate: 0.4,
  recentReleaseRate: 0.25,
  waitlistCount: 4,
  averageWaitMs: leaseMs * 5,
  currentApplicantCount: 10,
  mineHeat: [{ mineId: "core-01", applicantCount: 9 }]
}, { leaseMs });
assert.deepEqual(combined.map((entry) => entry.id), [
  "low-participation",
  "long-waitlist",
  "mine-concentration",
  "high-release-rate"
]);
assert.ok(combined.every((entry) => (
  entry.title && entry.metricLabel && entry.detail && entry.recommendation
)), "every health alert should explain the metric and provide a tuning recommendation");

console.log("mining-competition-health-smoke: four tuning warnings and thresholds ok");
