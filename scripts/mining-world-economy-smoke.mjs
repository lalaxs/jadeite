import assert from "node:assert/strict";
import {
  MINES,
  MINING_WORLD_ECONOMY_MAX_PERFORMANCE_SPREAD,
  MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS,
  MINING_WORLD_ECONOMY_MIN_PLAYERS,
  MINING_WORLD_ECONOMY_MIN_ROUNDS,
  MINING_WORLD_ECONOMY_MIN_SHIFTS,
  MINING_TUNING_SCENARIOS,
  miningTuningDraftProjection
} from "../shared/domain/mining/mining-rules.js";
import {
  miningEconomyTuningSandbox,
  miningEconomyInsights,
  miningTuningAdjustedMine,
  miningTuningObservationAssessment,
  miningTuningObservationReport,
  miningTuningRulesFromRows,
  miningTuningVersionEffectReport,
  miningWorldEconomyReport
} from "../server/services/mining-service.js";

const empty = miningWorldEconomyReport();
assert.equal(empty.sampleReady, false);
assert.equal(empty.recentRoundCount, 0);
assert.equal(empty.shiftCount, 0);
assert.equal(empty.alerts.length, 0, "insufficient samples must not produce tuning alerts");
const emptySandbox = miningEconomyTuningSandbox(empty);
assert.equal(emptySandbox.basis, "benchmark");
assert.equal(emptySandbox.bands.length, 5);
assert.equal(emptySandbox.scenarios.length, MINING_TUNING_SCENARIOS.length);
assert.ok(emptySandbox.bands.every((band) => band.recommendedScenarioId == null));
const emptyDraft = miningTuningDraftProjection(emptySandbox);
assert.equal(emptyDraft.status, "empty");
assert.equal(emptyDraft.changedCount, 0);
assert.equal(emptyDraft.issues.length, 0, "an untouched draft should not raise guardrail warnings");
const benchmarkDraft = miningTuningDraftProjection(emptySandbox, { mist: "rent-5" });
assert.equal(benchmarkDraft.status, "benchmark-only");
assert.equal(benchmarkDraft.changedCount, 1);
assert.ok(benchmarkDraft.issues.some((issue) => issue.id === "sample-immature"));
assert.match(benchmarkDraft.note, /不会自动写入正式租金或产出数值/);
const adjustedRules = miningTuningRulesFromRows([
  { beltId: "mist", rentDelta: -0.05, outputDelta: 0 },
  { beltId: "ridge", rentDelta: 0, outputDelta: 0.05 }
]);
assert.equal(adjustedRules.mist.rentMultiplier, 0.95);
assert.equal(adjustedRules.ridge.outputMultiplier, 1.05);
assert.equal(adjustedRules.glacier.rentMultiplier, 1);
const adjustedMist = miningTuningAdjustedMine(MINES.find((mine) => mine.beltId === "mist"), adjustedRules);
assert.equal(adjustedMist.rent, Math.round(adjustedMist.baseRent * 0.95));
assert.equal(adjustedMist.outputMultiplier, 1);
const compoundedRules = miningTuningRulesFromRows([
  { beltId: "mist", rentDelta: -0.05, outputDelta: 0.05 }
], adjustedRules);
assert.equal(compoundedRules.mist.rentMultiplier, 0.9025);
assert.equal(compoundedRules.mist.outputMultiplier, 1.05);

const benchmarks = new Map(miningEconomyInsights().benchmarkBands.map((entry) => [entry.beltId, entry]));
const representativeMines = [...new Map(MINES.map((mine) => [mine.beltId, mine])).values()];

function makeRounds({ utilizationShifts = 3, outputMultipliers = {} } = {}) {
  return Array.from({ length: 3 }, (_, roundIndex) => {
    const number = roundIndex + 1;
    const leases = representativeMines.map((mine, playerIndex) => ({
      id: `lease-${number}-${mine.id}`,
      roundId: `round-${number}`,
      roundNumber: number,
      playerId: `player-${playerIndex + 1}`,
      mineId: mine.id,
      rent: mine.rent,
      maxShifts: 5,
      shiftsStarted: utilizationShifts,
      startsAt: number * 10_000,
      endsAt: number * 10_000 + 9_000
    }));
    const economyShifts = leases.flatMap((lease) => Array.from({ length: 3 }, (_, shiftIndex) => {
      const mine = MINES.find((entry) => entry.id === lease.mineId);
      const benchmark = benchmarks.get(mine.beltId);
      const output = Math.round(benchmark.expectedOutputValue * Number(outputMultipliers[mine.beltId] ?? 1));
      const operatingCost = 400;
      const allocatedRent = Math.round(lease.rent / lease.maxShifts);
      return {
        id: `${lease.playerId}:shift-${number}-${mine.id}-${shiftIndex}`,
        playerId: lease.playerId,
        mineId: mine.id,
        estimatedOutputValue: output,
        benchmarkOutputValue: benchmark.expectedOutputValue,
        operatingCost,
        allocatedRent,
        estimatedNet: output - operatingCost - allocatedRent
      };
    }));
    return {
      id: `round-${number}`,
      number,
      startsAt: number * 10_000,
      endsAt: number * 10_000 + 9_000,
      leases,
      economyShifts
    };
  });
}

const healthyRounds = makeRounds();
const healthy = miningWorldEconomyReport({ rounds: healthyRounds });
assert.equal(healthy.sampleReady, true);
assert.equal(healthy.recentRoundCount, MINING_WORLD_ECONOMY_MIN_ROUNDS);
assert.equal(healthy.shiftCount, 45);
assert.ok(healthy.shiftCount >= MINING_WORLD_ECONOMY_MIN_SHIFTS);
assert.equal(healthy.uniquePlayerCount, MINING_WORLD_ECONOMY_MIN_PLAYERS);
assert.equal(healthy.leaseCount, 15);
assert.equal(healthy.utilization, 0.6);
assert.ok(healthy.margin > 0.2);
assert.equal(healthy.alerts.length, 0);
assert.equal(healthy.belts.length, 5);
assert.ok(healthy.belts.every((belt) => belt.shiftCount >= MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS));
assert.ok(healthy.belts.every((belt) => Math.abs(belt.performanceIndex - 1) < 0.001));
assert.equal(healthy.performanceSpread, 1);
assert.equal(
  healthy.allInCost,
  healthy.operatingCost + healthy.rentCost,
  "world reporting must count every paid lease in full"
);
assert.doesNotMatch(JSON.stringify(healthy), /playerName|玩家一/, "public aggregates must not expose player names");
const healthySandbox = miningEconomyTuningSandbox(healthy);
assert.equal(healthySandbox.basis, "observed");
assert.ok(healthySandbox.bands.every((band) => band.recommendedScenarioId === "hold"));
const healthyMist = healthySandbox.bands.find((band) => band.beltId === "mist");
const healthyMistRentCut = healthyMist.scenarios.find((scenario) => scenario.id === "rent-5");
assert.equal(healthyMistRentCut.outputPerShift, healthyMist.outputPerShift);
assert.ok(healthyMistRentCut.rentPerShift < healthyMist.rentPerShift);
assert.ok(healthyMistRentCut.netDelta > 0);
assert.ok(healthyMistRentCut.margin > healthyMist.margin);
assert.ok(healthyMistRentCut.projectedSpread <= healthySandbox.baselineSpread,
  "cutting rent for the weakest benchmark band should not widen the expected net spread");
const healthyDraft = miningTuningDraftProjection(healthySandbox, { mist: "rent-5" });
assert.equal(healthyDraft.status, "needs-review",
  "a manual change to a healthy observed band should require an explicit review");
assert.ok(healthyDraft.issues.some((issue) => issue.id === "healthy-band-adjustment"));
const broadDraft = miningTuningDraftProjection(healthySandbox, {
  mist: "output+5",
  ridge: "output+5",
  glacier: "output+5"
});
assert.equal(broadDraft.changedCount, 3);
assert.ok(broadDraft.issues.some((issue) => issue.id === "too-many-bands"));
const safeSandbox = structuredClone(healthySandbox);
safeSandbox.bands.find((band) => band.beltId === "mist").recommendedScenarioId = "rent-5";
const safeDraft = miningTuningDraftProjection(safeSandbox, { mist: "rent-5" });
assert.equal(safeDraft.status, "ready");
assert.equal(safeDraft.issues.length, 0);

const lowUtilization = miningWorldEconomyReport({
  rounds: makeRounds({ utilizationShifts: 1 })
});
assert.equal(lowUtilization.sampleReady, true);
assert.equal(lowUtilization.utilization, 0.2);
assert.ok(lowUtilization.alerts.some((alert) => alert.id === "world-low-utilization"));
assert.ok(miningEconomyTuningSandbox(lowUtilization).bands
  .every((band) => band.recommendedScenarioId === "hold"),
"low utilization should be corrected before changing rent or output");

const uneven = miningWorldEconomyReport({
  rounds: makeRounds({ outputMultipliers: { mist: 1.5, ridge: 0.6 } })
});
assert.ok(uneven.performanceSpread > MINING_WORLD_ECONOMY_MAX_PERFORMANCE_SPREAD);
assert.ok(uneven.alerts.some((alert) => alert.id === "world-belt-performance-spread"));
const unevenSandbox = miningEconomyTuningSandbox(uneven);
assert.equal(unevenSandbox.bands.find((band) => band.beltId === "mist").recommendedScenarioId, "output-3");
assert.equal(unevenSandbox.bands.find((band) => band.beltId === "ridge").recommendedScenarioId, "rent-5");
assert.match(unevenSandbox.note, /不会自动修改正式数值/);
const recommendedDraft = miningTuningDraftProjection(unevenSandbox, {
  mist: "output-3",
  ridge: "rent-5"
});
assert.equal(recommendedDraft.changedCount, 2);
assert.equal(recommendedDraft.status, "needs-review",
  "a conservative recommendation must still be reviewed if the remaining absolute spread is unsafe");
assert.ok(recommendedDraft.projected.spread <= recommendedDraft.baseline.spread,
  "the combined recommended draft should not widen the belt net spread");
assert.ok(recommendedDraft.issues.some((issue) => issue.id === "spread-over-limit"));
const experiment = {
  id: "observation-1",
  createdAt: 1_800_000_000_000,
  baselineRoundNumber: 0,
  targetRoundCount: 3,
  sampleReadyAtStart: true,
  basis: "observed",
  draftStatus: recommendedDraft.status,
  draftIssues: recommendedDraft.issues.map(({ id, severity, title }) => ({ id, severity, title })),
  rows: recommendedDraft.changedRows.map((row) => ({
    beltId: row.beltId,
    beltLabel: row.beltLabel,
    scenarioId: row.scenarioId,
    scenarioLabel: row.scenarioLabel,
    rentDelta: row.rentDelta,
    outputDelta: row.outputDelta,
    baseline: row.baseline,
    projected: row.projected,
    netDelta: row.netDelta
  })),
  forecast: {
    baselineSpread: recommendedDraft.baseline.spread,
    projectedSpread: recommendedDraft.projected.spread
  }
};
const collectingObservation = miningTuningObservationReport(experiment, {
  rounds: healthyRounds.slice(0, 2)
});
assert.equal(collectingObservation.status, "collecting");
assert.equal(collectingObservation.observedRoundCount, 2);
assert.ok(collectingObservation.actual, "partial rounds should expose a clearly labeled stage result");
const completedObservation = miningTuningObservationReport(experiment, { rounds: healthyRounds });
assert.equal(completedObservation.status, "complete");
assert.equal(completedObservation.observedRoundCount, 3);
assert.equal(completedObservation.minimumSelectedBeltShifts, 9);
assert.ok(completedObservation.actual);
assert.ok(completedObservation.actualSpread > 0);
assert.ok(["review-ready", "extend-observation", "recalibrate"].includes(
  completedObservation.assessment.id
));
assert.match(completedObservation.note, /不代表调参造成的因果效果/);
assert.doesNotMatch(JSON.stringify(completedObservation), /playerName|玩家一/);
const thinObservationRounds = healthyRounds.map((round) => ({
  ...round,
  economyShifts: round.economyShifts.filter((shift) => !["mist", "ridge"].includes(
    MINES.find((mine) => mine.id === shift.mineId)?.beltId
  ))
}));
const insufficientObservation = miningTuningObservationReport(experiment, {
  rounds: thinObservationRounds
});
assert.equal(insufficientObservation.status, "insufficient");
assert.equal(insufficientObservation.actual, null);
assert.equal(insufficientObservation.assessment.id, "insufficient");
assert.match(insufficientObservation.note, /班次不足/);
const reviewReadyAssessment = miningTuningObservationAssessment({
  status: "complete",
  observedRoundCount: 3,
  targetRoundCount: 3,
  forecast: { estimatedNet: 100_000 },
  actual: { estimatedNet: 105_000, margin: 0.61 },
  netDelta: 5_000,
  marginDelta: 0.01,
  forecastSpread: 3.2,
  actualSpread: 3.4
});
assert.equal(reviewReadyAssessment.id, "review-ready");
assert.match(reviewReadyAssessment.summary, /不代表调参方案已经验证有效/);
const extendedAssessment = miningTuningObservationAssessment({
  status: "complete",
  forecast: { estimatedNet: 100_000 },
  actual: { estimatedNet: 115_000, margin: 0.64 },
  netDelta: 15_000,
  marginDelta: 0.04,
  forecastSpread: 3.2,
  actualSpread: null
});
assert.equal(extendedAssessment.id, "extend-observation");
const recalibrateAssessment = miningTuningObservationAssessment({
  status: "complete",
  forecast: { estimatedNet: 100_000 },
  actual: { estimatedNet: 140_000, margin: 0.72 },
  netDelta: 40_000,
  marginDelta: 0.12,
  forecastSpread: 4,
  actualSpread: 6
});
assert.equal(recalibrateAssessment.id, "recalibrate");

function effectMetricForBelt(report, beltId) {
  const belt = report.belts.find((entry) => entry.beltId === beltId);
  const shiftCount = Number(belt.shiftCount) || 0;
  const outputPerShift = Math.round(Number(belt.estimatedOutputValue) / Math.max(1, shiftCount));
  const allInCost = Math.round(Number(belt.allInCost) / Math.max(1, shiftCount));
  const estimatedNet = outputPerShift - allInCost;
  return {
    beltId,
    beltLabel: belt.beltLabel,
    shiftCount,
    outputPerShift,
    allInCost,
    estimatedNet,
    margin: outputPerShift ? estimatedNet / outputPerShift : 0
  };
}

const effectBaselineRows = ["mist", "ridge"].map((beltId) => effectMetricForBelt(healthy, beltId));
const effectVersion = {
  id: "effect-version-1",
  activatedRoundNumber: 1,
  rules: miningTuningRulesFromRows([]),
  rows: effectBaselineRows.map((row) => ({
    beltId: row.beltId,
    beltLabel: row.beltLabel,
    scenarioId: "rent-5",
    scenarioLabel: "租金 -5%",
    rentDelta: -0.05,
    outputDelta: 0,
    baseline: row,
    projected: row
  })),
  effectBaseline: {
    capturedAt: 1_800_000_000_000,
    observedRoundNumbers: [1, 2, 3],
    actualRows: effectBaselineRows,
    actual: effectBaselineRows.reduce((aggregate, row) => ({
      outputPerShift: aggregate.outputPerShift + row.outputPerShift,
      allInCost: aggregate.allInCost + row.allInCost,
      estimatedNet: aggregate.estimatedNet + row.estimatedNet,
      margin: 0
    }), { outputPerShift: 0, allInCost: 0, estimatedNet: 0, margin: 0 }),
    actualSpread: healthy.performanceSpread
  }
};
effectVersion.effectBaseline.actual.margin = effectVersion.effectBaseline.actual.estimatedNet
  / effectVersion.effectBaseline.actual.outputPerShift;
const effectHealthyRounds = healthyRounds.map((round) => ({
  ...round,
  tuningVersionId: effectVersion.id
}));
const collectingEffect = miningTuningVersionEffectReport(effectVersion, {
  rounds: effectHealthyRounds.slice(0, 2)
});
assert.equal(collectingEffect.status, "collecting");
assert.equal(collectingEffect.observedRoundCount, 2);
assert.equal(collectingEffect.assessment.id, "collecting");
const stableEffect = miningTuningVersionEffectReport(effectVersion, { rounds: effectHealthyRounds });
assert.equal(stableEffect.status, "complete");
assert.equal(stableEffect.minimumSelectedBeltShifts, 9);
assert.equal(stableEffect.assessment.id, "stable");
assert.equal(stableEffect.netDeltaFromBaseline, 0);
assert.match(stableEffect.note, /不等同于因果证明/);
const insufficientEffect = miningTuningVersionEffectReport(effectVersion, {
  rounds: thinObservationRounds.map((round) => ({ ...round, tuningVersionId: effectVersion.id }))
});
assert.equal(insufficientEffect.status, "insufficient");
assert.equal(insufficientEffect.assessment.id, "insufficient");
const unsafeEffect = miningTuningVersionEffectReport(effectVersion, {
  rounds: makeRounds({ outputMultipliers: { mist: 0.1 } })
    .map((round) => ({ ...round, tuningVersionId: effectVersion.id }))
});
assert.equal(unsafeEffect.status, "complete");
assert.equal(unsafeEffect.assessment.id, "rollback-recommended");
assert.match(unsafeEffect.assessment.summary, /不会自动执行/);
const foreignVersionEffect = miningTuningVersionEffectReport(effectVersion, {
  rounds: effectHealthyRounds.slice(0, 2).concat({
    ...effectHealthyRounds[2],
    tuningVersionId: "another-version"
  })
});
assert.equal(foreignVersionEffect.status, "collecting");
assert.deepEqual(foreignVersionEffect.observedRoundNumbers, [1, 2],
  "post-activation tracking must never mix a later version's round");
const interruptedEffect = miningTuningVersionEffectReport({
  ...effectVersion,
  status: "superseded"
}, { rounds: effectHealthyRounds.slice(0, 2) });
assert.equal(interruptedEffect.status, "interrupted");
assert.equal(interruptedEffect.assessment.id, "interrupted");

const legacyRound = structuredClone(healthyRounds[0]);
delete legacyRound.economyShifts;
const legacyPlayer = {
  id: "legacy-player",
  mining: {
    leaseHistory: [legacyRound.leases[0]],
    history: [{
      id: "legacy-shift",
      roundId: legacyRound.id,
      roundNumber: legacyRound.number,
      leaseId: legacyRound.leases[0].id,
      mineId: legacyRound.leases[0].mineId,
      completedAt: legacyRound.startsAt + 1_000,
      roughCount: 3,
      totalMass: 7.5,
      cost: 400
    }]
  }
};
const legacy = miningWorldEconomyReport({ players: [legacyPlayer], rounds: [legacyRound] });
assert.equal(legacy.shiftCount, 1, "old saves should fall back to player shift history");
assert.equal(legacy.sampleReady, false);
assert.equal(legacy.alerts.length, 0);
assert.match(legacy.estimationNote, /全部已支付租金/);

console.log("mining-world-economy-smoke: round persistence, sample gates, full rent and belt alerts ok");
