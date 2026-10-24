import { distributeItemCost } from "../../shared/domain/economy/item-cost.js";
import { playersMatching, playersForRead, peekPlayer } from "../persistence/mutation-scope.js";
import {
  MINES,
  MINING_ACTIVE_PLAYER_MS,
  MINING_APPLICATION_MS,
  MINING_BASIC_MAX_CREW,
  MINING_BASIC_MIN_CREW,
  MINING_BASIC_MODE,
  MINING_CLUE_TARGET,
  MINING_ECONOMY_MAX_LOSS_SHIFT_RATE,
  MINING_ECONOMY_MAX_NET_SPREAD,
  MINING_ECONOMY_MIN_LEASE_UTILIZATION,
  MINING_ECONOMY_MIN_MARGIN,
  MINING_ECONOMY_RECENT_LEASE_LIMIT,
  MINING_ECONOMY_RECENT_SHIFT_LIMIT,
  MINING_WORLD_ECONOMY_MAX_PERFORMANCE_SPREAD,
  MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS,
  MINING_WORLD_ECONOMY_MIN_PLAYERS,
  MINING_WORLD_ECONOMY_MIN_ROUNDS,
  MINING_WORLD_ECONOMY_MIN_SHIFTS,
  MINING_WORLD_ECONOMY_RECENT_ROUND_LIMIT,
  MINING_TUNING_OBSERVATION_MAX_RECORDS,
  MINING_TUNING_OBSERVATION_MAX_MARGIN_ERROR,
  MINING_TUNING_OBSERVATION_MAX_NET_ERROR_RATE,
  MINING_TUNING_OBSERVATION_ROUNDS,
  MINING_TUNING_MULTIPLIER_MAX,
  MINING_TUNING_MULTIPLIER_MIN,
  MINING_TUNING_EFFECT_MAX_NET_DECLINE_RATE,
  MINING_TUNING_EFFECT_MAX_PROJECTION_ERROR_RATE,
  MINING_TUNING_EFFECT_ROUNDS,
  MINING_TUNING_SCENARIOS,
  MINING_TUNING_VERSION_MAX_RECORDS,
  MINING_FACILITY_MAX_LEVEL,
  MINING_FOREMAN_BONUS,
  MINING_HEALTH_MAX_MINE_CONCENTRATION,
  MINING_HEALTH_MAX_RELEASE_RATE,
  MINING_HEALTH_MAX_WAIT_LEASES,
  MINING_HEALTH_MIN_CONCENTRATION_APPLICANTS,
  MINING_HEALTH_MIN_OBSERVED_ROUNDS,
  MINING_HEALTH_MIN_PARTICIPATION_RATE,
  MINING_INCIDENT_REVEAL_RATIO,
  MINING_LEASE_MS,
  MINING_MAX_SURVEY_REPORTS,
  MINING_MAX_PREPARATIONS,
  MINING_MAX_PREFERENCES,
  MINING_MAX_SKIPPED_APPLICATION_ROUNDS,
  MINING_MAX_SHIFTS_PER_LEASE,
  MINING_QUALITY_KEYS,
  MINING_REQUIRED_PLAYERS,
  MINING_REQUIRED_REP,
  MINING_ROSTER_INACTIVE_MS,
  MINING_ROLE_EXPERIENCE,
  MINING_SHIFT_MS,
  MINING_SHIFT_INCENTIVES,
  MINING_SHIFT_ROLES,
  MINING_SURVEY_REPORT,
  MINER_MENTORSHIP_REQUIRED_SHIFTS,
  miningFacilityById,
  miningFacilityUpgradeCost,
  miningForemanInfo,
  miningAutoRoleAssignments,
  miningBasicMineProfile,
  miningBasicShiftPlan,
  miningCrewBondInfo,
  miningCrewBondLevel,
  miningCrewKey,
  miningMineById,
  miningMineMasteryInfo,
  miningMineMasteryLevel,
  miningMinerContractInfo,
  miningMinerMoraleInfo,
  miningMinerSpecializationInfo,
  miningPreparationById,
  miningPreparationEffects,
  miningRoleAssignmentDetails,
  miningShiftIncidentById,
  miningShiftIncidentChoice,
  miningShiftIncidentFor,
  miningShiftIncentiveById,
  miningShiftPerformance,
  miningShiftWageQuote,
  miningShiftDuration,
  miningSiteConditionById,
  miningSiteConditionFor,
  miningStrategyById,
  miningTuningDraftProjection
} from "../../shared/domain/mining/mining-rules.js";
import {
  applyMinerShiftCondition,
  applyMinerShiftMorale,
  applyMinerRetentionAfterShift,
  applyMinerMentorshipsForShift,
  grantMiningExperience,
  grantMiningRoleExperience,
  ensureBasicStarterMiner,
  isMinerBusy,
  minerReadiness,
  normalizeMiningPlayer,
  recordMinerShift,
  refreshMinerCondition
} from "../systems/miner-system.js";
import { QUALITIES, ROUGH_PRICE_NOISE } from "./rough-pool-service.js";

import {
  miningCompetitionHealth,
  miningExpectedStoneValue,
  miningEconomyInsights,
  miningWorldEconomyReport,
  miningEconomyTuningSandbox,
  miningTuningObservationReport,
  miningTuningObservationAssessment,
  miningTuningVersionEffectReport,
  miningTuningRulesFromRows,
  miningTuningAdjustedMine,
  miningMineEconomyBenchmark,
  miningTuningMetricSnapshot,
  nullableMiningTuningMetricSnapshot,
  normalizeMiningTuningEffectResult,
  normalizedTuningMultiplier
} from "./mining/mining-economy.js";
export {
  miningCompetitionHealth,
  miningExpectedStoneValue,
  miningEconomyInsights,
  miningWorldEconomyReport,
  miningEconomyTuningSandbox,
  miningTuningObservationReport,
  miningTuningObservationAssessment,
  miningTuningVersionEffectReport,
  miningTuningRulesFromRows,
  miningTuningAdjustedMine
} from "./mining/mining-economy.js";

const REP_STAGE_TARGETS = Object.freeze([20, 50, 100, 200, 400, 800, 1500]);
const MINING_HEALTH_JOB_GRACE_MS = 5_000;
const MINING_RECOVERY_NOTICE_MS = 24 * 60 * 60 * 1_000;
const MINING_SHIFT_REFUND_FALLBACK_CAP = 100_000;

function positiveInteger(value, fallback, min = 1) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= min ? number : fallback;
}

function unitHash(text) {
  let hash = 2166136261;
  for (const char of String(text || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) + 1) / 4294967297;
}

function pickWeightedIndex(weights, rng = Math.random) {
  const total = weights.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  if (total <= 0) return 0;
  let roll = rng() * total;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= Math.max(0, Number(weights[index]) || 0);
    if (roll <= 0) return index;
  }
  return weights.length - 1;
}

function shiftedQualityWeights(mine, strategy, condition = {}) {
  const weights = [...mine.weights];
  const shift = (Number(strategy.highGradeShift) || 0) + (Number(condition.highGradeShift) || 0);
  if (shift > 0) {
    const available = Math.min(shift, weights[0] + weights[1] + weights[2]);
    let remaining = available;
    for (const index of [0, 1, 2]) {
      const take = Math.min(weights[index], remaining / (3 - index));
      weights[index] -= take;
      remaining -= take;
    }
    weights[4] += available * 0.65;
    weights[5] += available * 0.35;
  } else if (shift < 0) {
    const amount = Math.min(Math.abs(shift), weights[4] + weights[5]);
    const fromGlass = Math.min(weights[5], amount * 0.35);
    const fromHigh = Math.min(weights[4], amount - fromGlass);
    weights[5] -= fromGlass;
    weights[4] -= fromHigh;
    weights[2] += fromGlass + fromHigh;
  }
  return weights;
}

function roleAssignmentsForShift(miners, requestedAssignments) {
  if (requestedAssignments == null) {
    const assignments = miningAutoRoleAssignments(miners);
    return { ok: true, assignments, details: miningRoleAssignmentDetails(assignments, miners) };
  }
  if (!requestedAssignments || typeof requestedAssignments !== "object" || Array.isArray(requestedAssignments)) {
    return { ok: false, message: "井下岗位分工格式不正确。" };
  }
  const minerIds = new Set(miners.map((miner) => String(miner.id)));
  const roleKeys = Object.keys(requestedAssignments);
  const assignedIds = roleKeys.map((roleKey) => String(requestedAssignments[roleKey] || ""));
  if (
    roleKeys.length !== miners.length
    || roleKeys.some((roleKey) => !MINING_SHIFT_ROLES[roleKey])
    || assignedIds.some((minerId) => !minerIds.has(minerId))
    || new Set(assignedIds).size !== miners.length
  ) {
    return { ok: false, message: "每名当班矿工必须负责一个不同的井下岗位。" };
  }
  const assignments = Object.fromEntries(roleKeys.map((roleKey) => [roleKey, String(requestedAssignments[roleKey])]));
  return { ok: true, assignments, details: miningRoleAssignmentDetails(assignments, miners) };
}

function mineRecordFor(mining, mineId) {
  if (!mining.mineRecords[mineId]) {
    mining.mineRecords[mineId] = {
      shifts: 0,
      roughs: 0,
      totalMass: 0,
      accidents: 0,
      clueProgress: 0,
      surveyReports: 0,
      reportsCompleted: 0,
      lastMinedAt: null,
      lastConditionId: null
    };
  }
  return mining.mineRecords[mineId];
}

function orderedApplicationMines(entry, mines, seed) {
  const preferences = Array.isArray(entry.preferences) ? entry.preferences : [];
  const preferredBelts = new Set(preferences
    .map((mineId) => miningMineById(mineId)?.beltId)
    .filter(Boolean));
  const budget = Math.max(0, Number(entry.assignmentBudget) || 0);
  return mines
    .filter((mine) => (
      mine.id !== entry.previousMineId
      && mine.rent <= budget
      && (entry.allowFallback !== false || preferences.includes(mine.id))
    ))
    .sort((left, right) => {
      const leftRank = preferences.indexOf(left.id);
      const rightRank = preferences.indexOf(right.id);
      const leftScore = leftRank >= 0 ? leftRank : MINING_MAX_PREFERENCES + 1;
      const rightScore = rightRank >= 0 ? rightRank : MINING_MAX_PREFERENCES + 1;
      return leftScore - rightScore
        || Number(preferredBelts.has(right.beltId)) - Number(preferredBelts.has(left.beltId))
        || right.rent - left.rent
        || unitHash(`${seed}:${entry.playerId}:${left.id}`) - unitHash(`${seed}:${entry.playerId}:${right.id}`)
        || left.id.localeCompare(right.id);
    });
}

function matchMiningApplicants(entries, mines, seed) {
  const mineOwners = new Map();
  const candidateMines = new Map(entries.map((entry) => [
    entry.playerId,
    orderedApplicationMines(entry, mines, seed)
  ]));
  const orderedEntries = [...entries].sort((left, right) => (
    Number(right.priorityEligible) - Number(left.priorityEligible)
    || unitHash(`${seed}:draw:${left.playerId}`) - unitHash(`${seed}:draw:${right.playerId}`)
    || String(left.playerId).localeCompare(String(right.playerId))
  ));

  function tryAssign(entry, visitedMineIds) {
    for (const mine of candidateMines.get(entry.playerId) || []) {
      if (visitedMineIds.has(mine.id)) continue;
      visitedMineIds.add(mine.id);
      const currentOwner = mineOwners.get(mine.id);
      if (!currentOwner || tryAssign(currentOwner, visitedMineIds)) {
        mineOwners.set(mine.id, entry);
        return true;
      }
    }
    return false;
  }

  for (const entry of orderedEntries) tryAssign(entry, new Set());
  const assignments = new Map();
  for (const [mineId, entry] of mineOwners) {
    const mine = mines.find((candidate) => candidate.id === mineId);
    if (!mine) continue;
    const preferenceIndex = entry.preferences.indexOf(mine.id);
    assignments.set(entry.playerId, {
      mine,
      allocationMode: preferenceIndex >= 0
        ? "preference"
        : "adjusted",
      preferenceRank: preferenceIndex >= 0 ? preferenceIndex + 1 : null,
      priorityAllocation: entry.priorityEligible === true
    });
  }
  return assignments;
}

export function createMiningService(deps) {
  const {
    getState,
    money,
    randomUUID,
    holdDeposit,
    releaseDeposit,
    spendCash,
    makeRoughStone,
    markInventoryItemNew,
    normalizePlayer,
    addNews,
    requiredRep = MINING_REQUIRED_REP,
    requiredPlayers = MINING_REQUIRED_PLAYERS,
    activePlayerMs = MINING_ACTIVE_PLAYER_MS,
    rosterInactiveMs = MINING_ROSTER_INACTIVE_MS,
    leaseMs = MINING_LEASE_MS,
    applicationMs = MINING_APPLICATION_MS,
    shiftMs = MINING_SHIFT_MS,
    basicMode = MINING_BASIC_MODE,
    allowFounderTuning = process.env.NODE_ENV !== "production",
    tuningReviewerPlayerIds = ""
  } = deps;

  const configuredTuningReviewerIds = Object.freeze([
    ...new Set((Array.isArray(tuningReviewerPlayerIds)
      ? tuningReviewerPlayerIds
      : String(tuningReviewerPlayerIds || "").split(","))
      .map((entry) => String(entry || "").trim())
      .filter(Boolean))
  ]);

  const config = Object.freeze({
    requiredRep: Math.max(0, positiveInteger(requiredRep, MINING_REQUIRED_REP, 0)),
    requiredPlayers: positiveInteger(requiredPlayers, MINING_REQUIRED_PLAYERS),
    activePlayerMs: positiveInteger(activePlayerMs, MINING_ACTIVE_PLAYER_MS),
    rosterInactiveMs: positiveInteger(rosterInactiveMs, MINING_ROSTER_INACTIVE_MS),
    leaseMs: positiveInteger(leaseMs, MINING_LEASE_MS),
    applicationMs: positiveInteger(applicationMs, MINING_APPLICATION_MS),
    shiftMs: positiveInteger(shiftMs, MINING_SHIFT_MS),
    tuningReviewerPlayerIds: configuredTuningReviewerIds,
    basicMode: typeof basicMode === "string"
      ? !["0", "false", "off"].includes(basicMode.trim().toLowerCase())
      : basicMode !== false
  });

  function revealMiningIncident(job) {
    if (!Number.isFinite(Number(job?.incidentAt))) return null;
    const existing = miningShiftIncidentById(job.incidentId);
    if (existing) return existing;
    const incident = miningShiftIncidentFor(`${job.id}:${job.mineId}:${job.roundId}`);
    job.incidentId = incident.id;
    return incident;
  }

  function selectedIncidentChoice(job) {
    return miningShiftIncidentChoice(job?.incidentId, job?.incidentChoiceId);
  }

  function autoResolveMiningIncident(job, now = Date.now()) {
    const incident = revealMiningIncident(job);
    if (!incident) return null;
    const existing = selectedIncidentChoice(job);
    if (existing) return existing;
    const choice = miningShiftIncidentChoice(incident.id, incident.defaultChoiceId);
    job.incidentChoiceId = choice.id;
    job.incidentResolvedAt = Math.min(now, Number(job.readyAt) || now);
    job.incidentAutomatic = true;
    return choice;
  }

  function lockedEstimate(performance) {
    return {
      yieldMin: performance.yieldMin,
      yieldMax: performance.yieldMax,
      risk: Math.round(performance.risk * 1000) / 1000,
      extraYieldChance: Math.round(performance.extraYieldChance * 1000) / 1000,
      upgradeChance: Math.round(performance.upgradeChance * 1000) / 1000,
      clueGain: performance.clueGain
    };
  }

  function shiftPerformanceForJob(player, job, incidentChoice = selectedIncidentChoice(job)) {
    const mining = normalizeMiningPlayer(player);
    const mine = miningMineById(job.mineId);
    const miners = (job.minerIds || [])
      .map((id) => mining.miners.find((entry) => entry.id === id))
      .filter(Boolean);
    const crewKey = job.crewKey || miningCrewKey(job.minerIds);
    const masteryLevel = job.mineMasteryLevel == null
      ? miningMineMasteryLevel(mining.mineRecords[mine?.id])
      : job.mineMasteryLevel;
    const crewBondLevel = job.crewBondLevel == null
      ? miningCrewBondLevel(mining.crewRecords[crewKey])
      : job.crewBondLevel;
    return miningShiftPerformance({
      mine,
      miners,
      strategyId: job.strategyId,
      conditionId: job.conditionId,
      preparationIds: job.preparationIds,
      facilities: job.facilities || mining.facilities,
      masteryLevel,
      crewBondLevel,
      foremanFocus: job.foremanFocus,
      foremanBonus: job.foremanBonus,
      roleAssignments: job.roleAssignments,
      incentiveId: job.incentiveId,
      useSurveyReport: Boolean(job.surveyReportUsed),
      incidentChoice
    });
  }

  function normalizeMiningTuningVersion(entry = {}) {
    const validScenarioIds = new Set(MINING_TUNING_SCENARIOS.map((scenario) => scenario.id));
    const rows = (Array.isArray(entry.rows) ? entry.rows : [])
      .filter((row) => row && typeof row === "object" && !Array.isArray(row))
      .map((row) => ({
        beltId: String(row.beltId || ""),
        beltLabel: String(row.beltLabel || row.beltId || "未知矿带"),
        scenarioId: validScenarioIds.has(row.scenarioId) ? row.scenarioId : "hold",
        scenarioLabel: String(row.scenarioLabel || "维持现状"),
        rentDelta: Number(row.rentDelta) || 0,
        outputDelta: Number(row.outputDelta) || 0,
        baseline: nullableMiningTuningMetricSnapshot(row.baseline),
        projected: nullableMiningTuningMetricSnapshot(row.projected)
      }))
      .filter((row) => row.beltId && row.scenarioId !== "hold")
      .slice(0, 2);
    const sourceEffectBaseline = entry.effectBaseline && typeof entry.effectBaseline === "object"
      && !Array.isArray(entry.effectBaseline)
      ? entry.effectBaseline
      : null;
    const effectBaseline = sourceEffectBaseline ? {
      capturedAt: Number(sourceEffectBaseline.capturedAt) > 0
        ? Number(sourceEffectBaseline.capturedAt)
        : null,
      observedRoundNumbers: (Array.isArray(sourceEffectBaseline.observedRoundNumbers)
        ? sourceEffectBaseline.observedRoundNumbers
        : [])
        .map((roundNumber) => Math.max(1, Math.round(Number(roundNumber) || 1)))
        .slice(0, MINING_TUNING_EFFECT_ROUNDS),
      actualRows: (Array.isArray(sourceEffectBaseline.actualRows)
        ? sourceEffectBaseline.actualRows
        : [])
        .filter((row) => row && typeof row === "object" && !Array.isArray(row))
        .map((row) => ({
          beltId: String(row.beltId || ""),
          beltLabel: String(row.beltLabel || row.beltId || "未知矿带"),
          shiftCount: Math.max(0, Math.round(Number(row.shiftCount) || 0)),
          ...miningTuningMetricSnapshot(row)
        }))
        .filter((row) => row.beltId)
        .slice(0, 2),
      actual: nullableMiningTuningMetricSnapshot(sourceEffectBaseline.actual),
      actualSpread: sourceEffectBaseline.actualSpread == null
        ? null
        : Math.max(0, Number(sourceEffectBaseline.actualSpread) || 0)
    } : null;
    return {
      id: String(entry.id || ""),
      number: Math.max(1, Math.round(Number(entry.number) || 1)),
      kind: entry.kind === "rollback" ? "rollback" : "adjustment",
      status: ["scheduled", "active", "superseded", "cancelled"].includes(entry.status)
        ? entry.status
        : "scheduled",
      sourceExperimentId: entry.sourceExperimentId ? String(entry.sourceExperimentId) : null,
      parentVersionId: entry.parentVersionId ? String(entry.parentVersionId) : null,
      rollbackOfVersionId: entry.rollbackOfVersionId ? String(entry.rollbackOfVersionId) : null,
      createdAt: Number(entry.createdAt) > 0 ? Number(entry.createdAt) : null,
      createdByPlayerId: String(entry.createdByPlayerId || ""),
      createdByPlayerName: String(entry.createdByPlayerName || ""),
      scheduledRoundNumber: Math.max(1, Math.round(Number(entry.scheduledRoundNumber) || 1)),
      activatedAt: Number(entry.activatedAt) > 0 ? Number(entry.activatedAt) : null,
      activatedRoundNumber: Number(entry.activatedRoundNumber) > 0
        ? Math.round(Number(entry.activatedRoundNumber))
        : null,
      cancelledAt: Number(entry.cancelledAt) > 0 ? Number(entry.cancelledAt) : null,
      rows,
      rules: miningTuningRulesFromRows([], entry.rules),
      effectBaseline,
      effectResult: normalizeMiningTuningEffectResult(entry.effectResult)
    };
  }

  function miningTuningVersionById(mining, versionId) {
    return (mining.tuningVersions || []).find((entry) => String(entry.id) === String(versionId || "")) || null;
  }

  function activeMiningTuningVersion(mining) {
    return miningTuningVersionById(mining, mining.activeTuningVersionId)
      || (mining.tuningVersions || []).find((entry) => entry.status === "active")
      || null;
  }

  function pendingMiningTuningVersion(mining) {
    return (mining.tuningVersions || [])
      .filter((entry) => entry.status === "scheduled")
      .sort((left, right) => Number(left.scheduledRoundNumber) - Number(right.scheduledRoundNumber)
      || Number(left.number) - Number(right.number))[0] || null;
  }

  function miningTuningReviewerIds(mining) {
    if (config.tuningReviewerPlayerIds.length) return config.tuningReviewerPlayerIds;
    return allowFounderTuning && mining?.tuningReviewerPlayerId ? [String(mining.tuningReviewerPlayerId)] : [];
  }

  function canPlayerGovernMiningTuning(player, mining) {
    const playerId = String(player?.id || "");
    return Boolean(playerId && miningTuningReviewerIds(mining).includes(playerId));
  }

  function refreshMiningTuningEffectResults(mining, now = Date.now()) {
    const state = getState();
    let changed = false;
    for (const version of mining.tuningVersions || []) {
      if (version.effectResult || !version.activatedRoundNumber || !["active", "superseded"].includes(version.status)) {
        continue;
      }
      const report = miningTuningVersionEffectReport(version, {
        players: state.players,
        rounds: mining.history
      });
      if (report.status === "collecting") continue;
      version.effectResult = normalizeMiningTuningEffectResult({
        ...report,
        finalizedAt: Number(now) || Date.now()
      });
      changed = true;
    }
    return changed;
  }

  function miningTuningRulesForRound(mining, roundNumber = null) {
    const normalizedRound = Math.max(0, Math.round(Number(roundNumber) || 0));
    const round = mining.currentRound;
    if (round && normalizedRound === Number(round.number) && round.tuningVersionId) {
      return miningTuningVersionById(mining, round.tuningVersionId)?.rules
        || miningTuningRulesFromRows([]);
    }
    const pending = pendingMiningTuningVersion(mining);
    if (pending && normalizedRound >= Number(pending.scheduledRoundNumber)) return pending.rules;
    return activeMiningTuningVersion(mining)?.rules || miningTuningRulesFromRows([]);
  }

  function effectiveMiningMines(mining, roundNumber = null) {
    const rules = miningTuningRulesForRound(mining, roundNumber);
    return MINES.map((mine) => miningTuningAdjustedMine(mine, rules));
  }

  function effectiveMiningMine(mining, mineId, roundNumber = null) {
    const mine = miningMineById(mineId);
    return mine ? miningTuningAdjustedMine(mine, miningTuningRulesForRound(mining, roundNumber)) : null;
  }

  function activateScheduledMiningTuningVersion(mining, roundNumber, now = Date.now()) {
    const candidates = (mining.tuningVersions || [])
      .filter((entry) => entry.status === "scheduled" && Number(entry.scheduledRoundNumber) <= Number(roundNumber))
      .sort((left, right) => Number(right.number) - Number(left.number));
    const next = candidates[0] || null;
    if (!next) return activeMiningTuningVersion(mining);
    for (const version of mining.tuningVersions) {
      if (version.status === "active") version.status = "superseded";
      if (version.status === "scheduled" && version.id !== next.id && Number(version.scheduledRoundNumber) <= Number(roundNumber)) {
        version.status = "cancelled";
        version.cancelledAt = Number(now) || Date.now();
      }
    }
    next.status = "active";
    next.activatedAt = Number(now) || Date.now();
    next.activatedRoundNumber = Math.max(1, Math.round(Number(roundNumber) || 1));
    mining.activeTuningVersionId = next.id;
    addNews(
      `采矿数值版本 V${next.number} 已于第 ${next.activatedRoundNumber} 轮生效${next.kind === "rollback" ? "（回滚版本）" : ""}。`,
      "info"
    );
    return next;
  }

  function ensureMiningWorld() {
    const state = getState();
    const existing = state.mining && typeof state.mining === "object" && !Array.isArray(state.mining)
      ? state.mining
      : {};
    existing.unlockedAt = Number(existing.unlockedAt) > 0 ? Number(existing.unlockedAt) : null;
    existing.founderPlayerIds = Array.isArray(existing.founderPlayerIds) ? existing.founderPlayerIds : [];
    existing.competitionPlayerIds = Array.isArray(existing.competitionPlayerIds)
      ? existing.competitionPlayerIds
      : [...existing.founderPlayerIds];
    existing.activeApplicationRound = Number(existing.activeApplicationRound) > 0
      ? Math.round(Number(existing.activeApplicationRound))
      : null;
    existing.applications = Array.isArray(existing.applications) ? existing.applications : [];
    existing.history = Array.isArray(existing.history) ? existing.history.slice(0, 12) : [];
    existing.currentRound = existing.currentRound && typeof existing.currentRound === "object"
      ? existing.currentRound
      : null;
    existing.tuningVersions = (Array.isArray(existing.tuningVersions) ? existing.tuningVersions : [])
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      .map(normalizeMiningTuningVersion)
      .filter((entry) => entry.id && entry.createdAt && entry.createdByPlayerId)
      .sort((left, right) => Number(right.number) - Number(left.number))
      .slice(0, MINING_TUNING_VERSION_MAX_RECORDS);
    existing.activeTuningVersionId = existing.tuningVersions.some((entry) => (
      entry.id === String(existing.activeTuningVersionId || "") && entry.status === "active"
    )) ? String(existing.activeTuningVersionId) : existing.tuningVersions.find((entry) => entry.status === "active")?.id || null;
    existing.tuningReviewerPlayerId = existing.tuningReviewerPlayerId
      ? String(existing.tuningReviewerPlayerId)
      : null;
    if (allowFounderTuning && !config.tuningReviewerPlayerIds.length && !existing.tuningReviewerPlayerId) {
      const fallbackReviewerId = [
        ...(existing.founderPlayerIds || []),
        ...(existing.competitionPlayerIds || [])
      ].map(String).find((playerId) => state.players.has(playerId));
      if (fallbackReviewerId) existing.tuningReviewerPlayerId = fallbackReviewerId;
    }
    state.mining = existing;
    return existing;
  }

  function miningWorldForRead() {
    const current = getState().mining;
    if (current && typeof current === "object" && !Array.isArray(current)) return current;
    return {
      unlockedAt: null,
      founderPlayerIds: [],
      competitionPlayerIds: [],
      activeApplicationRound: null,
      applications: [],
      history: [],
      currentRound: null,
      tuningVersions: [],
      activeTuningVersionId: null,
      tuningReviewerPlayerId: null
    };
  }

  function saveMiningTuningExperiment(player, selections = {}, now = Date.now()) {
    const access = canPlayerMine(player, now);
    if (!access.ok) return access;
    const state = getState();
    const worldMining = ensureMiningWorld();
    const worldEconomyReport = miningWorldEconomyReport({
      players: state.players,
      rounds: worldMining.history,
      mineRules: activeMiningTuningVersion(worldMining)?.rules || {}
    });
    const sandbox = miningEconomyTuningSandbox(worldEconomyReport);
    const projection = miningTuningDraftProjection(sandbox, selections);
    if (!projection.changedCount) {
      return { ok: false, message: "请先为至少一个矿带加入调参方案。" };
    }
    if (projection.changedCount > 2) {
      return { ok: false, message: "影子观察一次最多记录两个矿带，请缩小调整范围。" };
    }
    const playerMining = normalizeMiningPlayer(player);
    const baselineRoundNumber = (worldMining.history || []).reduce((highest, round) => (
      Math.max(highest, Math.round(Number(round?.number) || 0))
    ), 0);
    const rows = projection.changedRows.map((row) => ({
      beltId: row.beltId,
      beltLabel: row.beltLabel,
      scenarioId: row.scenarioId,
      scenarioLabel: row.scenarioLabel,
      rentDelta: row.rentDelta,
      outputDelta: row.outputDelta,
      baseline: { ...row.baseline },
      projected: { ...row.projected },
      netDelta: row.netDelta
    }));
    const signature = rows
      .map((row) => `${row.beltId}:${row.scenarioId}`)
      .sort()
      .join("|");
    const duplicate = playerMining.tuningExperiments.find((entry) => (
      Number(entry.baselineRoundNumber) === baselineRoundNumber
      && entry.rows.map((row) => `${row.beltId}:${row.scenarioId}`).sort().join("|") === signature
    ));
    if (duplicate) {
      return { ok: false, message: "相同草案已在本轮建立影子观察，无需重复保存。" };
    }
    const experiment = {
      id: randomUUID(),
      createdAt: Number(now) || Date.now(),
      baselineRoundNumber,
      targetRoundCount: MINING_TUNING_OBSERVATION_ROUNDS,
      sampleReadyAtStart: projection.sampleReady,
      basis: sandbox.basis === "observed" ? "observed" : "benchmark",
      draftStatus: projection.status,
      draftIssues: projection.issues.map((issue) => ({
        id: issue.id,
        severity: issue.severity,
        title: issue.title
      })),
      rows,
      forecast: {
        baselineSpread: projection.baseline.spread,
        projectedSpread: projection.projected.spread
      }
    };
    playerMining.tuningExperiments.unshift(experiment);
    playerMining.tuningExperiments = playerMining.tuningExperiments
      .slice(0, MINING_TUNING_OBSERVATION_MAX_RECORDS);
    return {
      ok: true,
      message: `影子观察已保存；将跟踪后续 ${MINING_TUNING_OBSERVATION_ROUNDS} 个结束轮次，不会修改正式数值。`,
      experiment: miningTuningObservationReport(experiment, {
        players: state.players,
        rounds: worldMining.history
      })
    };
  }

  function reviewMiningTuningExperiment(player, experimentId, now = Date.now()) {
    const state = getState();
    const worldMining = ensureMiningWorld();
    if (!canPlayerGovernMiningTuning(player, worldMining)) {
      return { ok: false, message: "只有矿务数值审核员可以生成全服正式版本。" };
    }
    const playerMining = normalizeMiningPlayer(player);
    const experiment = playerMining.tuningExperiments.find((entry) => (
      String(entry.id) === String(experimentId || "")
    ));
    if (!experiment) return { ok: false, message: "找不到这份影子观察记录。" };
    const observation = miningTuningObservationReport(experiment, {
      players: state.players,
      rounds: worldMining.history
    });
    if (observation.assessment?.id !== "review-ready") {
      return { ok: false, message: "只有校准结论为“可进入人工审核”的记录才能生成正式版本。" };
    }
    const existing = worldMining.tuningVersions.find((entry) => (
      entry.sourceExperimentId === experiment.id && entry.status !== "cancelled"
    ));
    if (existing) {
      return { ok: false, message: `该观察记录已经生成 V${existing.number}，无需重复审核。` };
    }
    const pending = pendingMiningTuningVersion(worldMining);
    if (pending) {
      return { ok: false, message: `V${pending.number} 正在等待第 ${pending.scheduledRoundNumber} 轮生效，请先完成或撤销该排期。` };
    }
    const active = activeMiningTuningVersion(worldMining);
    const activeEffect = active?.effectResult || (active
      ? miningTuningVersionEffectReport(active, {
        players: state.players,
        rounds: worldMining.history
      })
      : null);
    if (activeEffect?.status === "collecting") {
      return {
        ok: false,
        message: `V${active.number} 尚在生效后观察期（${activeEffect.observedRoundCount}/${activeEffect.targetRoundCount} 轮），完成前不能叠加普通调整。`
      };
    }
    if (activeEffect?.assessment?.id === "rollback-recommended") {
      return { ok: false, message: `V${active.number} 已触发安全线，请先安排回滚，不能继续叠加普通调整。` };
    }
    const currentRoundNumber = Math.max(0, Math.round(Number(worldMining.currentRound?.number) || 0));
    const liveApplicationRound = applicationWindow(now)?.targetRound || null;
    const scheduledRoundNumber = currentRoundNumber + (
      Number(liveApplicationRound) > currentRoundNumber ? 2 : 1
    );
    const version = normalizeMiningTuningVersion({
      id: randomUUID(),
      number: Math.max(0, ...worldMining.tuningVersions.map((entry) => Number(entry.number) || 0)) + 1,
      kind: "adjustment",
      status: "scheduled",
      sourceExperimentId: experiment.id,
      parentVersionId: active?.id || null,
      createdAt: Number(now) || Date.now(),
      createdByPlayerId: String(player.id || ""),
      createdByPlayerName: String(player.name || ""),
      scheduledRoundNumber: Math.max(1, scheduledRoundNumber),
      rows: experiment.rows,
      effectBaseline: {
        capturedAt: Number(now) || Date.now(),
        observedRoundNumbers: observation.observedRoundNumbers,
        actualRows: observation.actualRows,
        actual: observation.actual,
        actualSpread: observation.actualSpread
      },
      rules: miningTuningRulesFromRows(experiment.rows, active?.rules || {})
    });
    worldMining.tuningVersions.unshift(version);
    worldMining.tuningVersions = worldMining.tuningVersions.slice(0, MINING_TUNING_VERSION_MAX_RECORDS);
    return {
      ok: true,
      message: `人工审核已确认，正式版本 V${version.number} 将在第 ${version.scheduledRoundNumber} 轮开始时生效。`,
      version
    };
  }

  function cancelMiningTuningVersion(player, versionId, now = Date.now()) {
    const worldMining = ensureMiningWorld();
    if (!canPlayerGovernMiningTuning(player, worldMining)) {
      return { ok: false, message: "只有矿务数值审核员可以撤销正式版本排期。" };
    }
    const version = miningTuningVersionById(worldMining, versionId);
    if (!version || version.status !== "scheduled") {
      return { ok: false, message: "该版本没有可撤销的待生效排期。" };
    }
    version.status = "cancelled";
    version.cancelledAt = Number(now) || Date.now();
    return { ok: true, message: `V${version.number} 的生效排期已撤销，正式数值没有变化。`, version };
  }

  function rollbackMiningTuningVersion(player, versionId, now = Date.now()) {
    const worldMining = ensureMiningWorld();
    if (!canPlayerGovernMiningTuning(player, worldMining)) {
      return { ok: false, message: "只有矿务数值审核员可以安排全服数值回滚。" };
    }
    const active = activeMiningTuningVersion(worldMining);
    if (!active || String(active.id) !== String(versionId || "")) {
      return { ok: false, message: "只能回滚当前正在生效的正式版本。" };
    }
    const pending = pendingMiningTuningVersion(worldMining);
    if (pending) {
      return { ok: false, message: `V${pending.number} 已在等待生效，请先完成或撤销该排期。` };
    }
    const target = miningTuningVersionById(worldMining, active.parentVersionId);
    const targetRules = target?.rules || miningTuningRulesFromRows([]);
    const rows = [...new Set(MINES.map((mine) => mine.beltId))].flatMap((beltId) => {
      const currentRule = active.rules?.[beltId] || { rentMultiplier: 1, outputMultiplier: 1 };
      const targetRule = targetRules?.[beltId] || { rentMultiplier: 1, outputMultiplier: 1 };
      const rentDelta = Number(targetRule.rentMultiplier) / Math.max(0.01, Number(currentRule.rentMultiplier) || 1) - 1;
      const outputDelta = Number(targetRule.outputMultiplier) / Math.max(0.01, Number(currentRule.outputMultiplier) || 1) - 1;
      if (Math.abs(rentDelta) < 0.0001 && Math.abs(outputDelta) < 0.0001) return [];
      const sourceRow = active.rows.find((row) => row.beltId === beltId);
      return [{
        beltId,
        beltLabel: sourceRow?.beltLabel || beltId,
        scenarioId: sourceRow?.scenarioId || "balanced",
        scenarioLabel: `回滚 V${active.number}`,
        rentDelta,
        outputDelta
      }];
    }).slice(0, 2);
    const currentRoundNumber = Math.max(0, Math.round(Number(worldMining.currentRound?.number) || 0));
    const liveApplicationRound = applicationWindow(now)?.targetRound || null;
    const scheduledRoundNumber = currentRoundNumber + (
      Number(liveApplicationRound) > currentRoundNumber ? 2 : 1
    );
    const version = normalizeMiningTuningVersion({
      id: randomUUID(),
      number: Math.max(0, ...worldMining.tuningVersions.map((entry) => Number(entry.number) || 0)) + 1,
      kind: "rollback",
      status: "scheduled",
      parentVersionId: active.id,
      rollbackOfVersionId: active.id,
      createdAt: Number(now) || Date.now(),
      createdByPlayerId: String(player.id || ""),
      createdByPlayerName: String(player.name || ""),
      scheduledRoundNumber: Math.max(1, scheduledRoundNumber),
      rows,
      rules: targetRules
    });
    worldMining.tuningVersions.unshift(version);
    worldMining.tuningVersions = worldMining.tuningVersions.slice(0, MINING_TUNING_VERSION_MAX_RECORDS);
    return {
      ok: true,
      message: `回滚版本 V${version.number} 已建立，将在第 ${version.scheduledRoundNumber} 轮恢复${target ? ` V${target.number}` : "初始数值"}。`,
      version
    };
  }

  function recordWorldMiningEconomyShift(player, result, job = null) {
    const world = ensureMiningWorld();
    const targetRoundId = String(result?.roundId || "");
    const targetRoundNumber = Math.round(Number(result?.roundNumber) || 0);
    const round = [world.currentRound, ...(world.history || [])].find((entry) => (
      entry
      && (
        (targetRoundId && String(entry.id || "") === targetRoundId)
        || (targetRoundNumber > 0 && Number(entry.number) === targetRoundNumber)
      )
    ));
    const mine = miningMineById(result?.mineId);
    if (!round || !mine || !result?.id) return false;
    const id = `${String(player?.id || "")}:${String(result.id)}`;
    round.economyShifts = Array.isArray(round.economyShifts) ? round.economyShifts : [];
    if (round.economyShifts.some((entry) => String(entry?.id || "") === id)) return false;
    const roughCount = Math.max(0, Math.round(Number(result.roughCount) || 0));
    const totalMass = Math.max(0, Number(result.totalMass) || 0);
    const observedMass = roughCount ? totalMass / roughCount : null;
    const estimatedOutputValue = Math.round(miningExpectedStoneValue(mine, observedMass) * roughCount);
    const lockedEstimate = job?.estimate && typeof job.estimate === "object" ? job.estimate : null;
    const expectedCount = lockedEstimate
      ? Math.max(0,
        (Math.max(0, Number(lockedEstimate.yieldMin) || 0) + Math.max(0, Number(lockedEstimate.yieldMax) || 0)) / 2
        + Math.max(0, Number(lockedEstimate.extraYieldChance) || 0)
        - Math.max(0, Number(lockedEstimate.risk) || 0)
      )
      : 0;
    const benchmarkOutputValue = expectedCount > 0
      ? Math.max(1, Math.round(
        miningExpectedStoneValue(mine)
        * expectedCount
        * normalizedTuningMultiplier(job?.tuningOutputMultiplier)
      ))
      : miningMineEconomyBenchmark(mine).expectedOutputValue;
    const operatingCost = Math.max(0, Math.round(Number(result.cost ?? result.wageCost) || 0));
    const lease = (round.leases || []).find((entry) => (
      String(entry?.id || "") === String(result.leaseId || "")
      || (
        String(entry?.playerId || "") === String(player?.id || "")
        && String(entry?.mineId || "") === mine.id
      )
    ));
    const capacityShifts = Math.max(1, Math.round(Number(lease?.maxShifts) || MINING_MAX_SHIFTS_PER_LEASE));
    const allocatedRent = Math.round(Math.max(0, Number(lease?.rent ?? mine.rent) || 0) / capacityShifts);
    round.economyShifts.push({
      id,
      playerId: String(player?.id || ""),
      mineId: mine.id,
      estimatedOutputValue,
      benchmarkOutputValue,
      tuningVersionId: job?.tuningVersionId || null,
      tuningOutputMultiplier: normalizedTuningMultiplier(job?.tuningOutputMultiplier),
      operatingCost,
      allocatedRent,
      estimatedNet: estimatedOutputValue - operatingCost - allocatedRent
    });
    round.economyShifts = round.economyShifts.slice(-MINES.length * MINING_MAX_SHIFTS_PER_LEASE);
    return true;
  }

  function requiredRepStage() {
    const index = REP_STAGE_TARGETS.findIndex((target) => target >= config.requiredRep);
    return index < 0 ? REP_STAGE_TARGETS.length : index + 1;
  }

  function playerHasMiningMilestone(player) {
    if (Number(player?.mining?.licenseAt) > 0) return true;
    if (config.requiredRep <= 0 || Number(player?.rep) >= config.requiredRep) return true;
    const repTrack = player?.achievements?.rep || {};
    const reachedStage = Math.max(
      Number(repTrack.unlockedStage) || 0,
      Number(repTrack.claimedStage) || 0,
      Number(repTrack.apGrantedStage) || 0
    );
    return reachedStage >= requiredRepStage();
  }

  function grantMiningLicenseIfDue(player, now = Date.now()) {
    const mining = normalizeMiningPlayer(player);
    let changed = false;
    if (!mining.licenseAt) {
      if (!playerHasMiningMilestone(player)) return false;
      mining.licenseAt = now;
      changed = true;
    }
    if (!mining.competitionQueueAt) {
      mining.competitionQueueAt = mining.licenseAt;
      changed = true;
    }
    if (config.basicMode) {
      const starter = ensureBasicStarterMiner(player, { rng: Math.random, makeId: randomUUID });
      changed = starter.changed || changed;
    }
    return changed;
  }

  function playerIsActive(player, now, activeWindowMs = config.activePlayerMs) {
    const state = getState();
    const online = [...state.sockets.values()].some((playerId) => String(playerId) === String(player.id));
    if (online) return true;
    const lastSeenAt = Number(player?.lastSeenAt) || 0;
    return lastSeenAt > 0 && now - lastSeenAt <= activeWindowMs;
  }

  function qualifiedPlayers(now = Date.now()) {
    const state = getState();
    const rows = [];
    for (const player of playersForRead(state.players, (entry) => entry.mining?.licenseAt && playerIsActive(entry, now))) rows.push(player);
    return rows.sort((left, right) => (
      Number(left.mining?.competitionQueueAt || left.mining?.licenseAt || 0)
        - Number(right.mining?.competitionQueueAt || right.mining?.licenseAt || 0)
      || String(left.id).localeCompare(String(right.id))
    ));
  }

  function recordMiningApplicationHistory(player, entry = {}) {
    if (!player) return null;
    const playerMining = normalizeMiningPlayer(player);
    const record = {
      id: String(entry.id || randomUUID()),
      applicationId: entry.applicationId ? String(entry.applicationId) : null,
      roundNumber: Math.max(1, Math.round(Number(entry.roundNumber) || 1)),
      submittedAt: Number(entry.submittedAt) > 0 ? Number(entry.submittedAt) : null,
      settledAt: Number(entry.settledAt) > 0 ? Number(entry.settledAt) : Date.now(),
      preferences: [...new Set((entry.preferences || []).map(String).filter((mineId) => miningMineById(mineId)))],
      allowFallback: entry.allowFallback !== false,
      escrow: money(entry.escrow || 0),
      status: entry.status,
      mineId: miningMineById(entry.mineId)?.id || null,
      rent: money(entry.rent || 0),
      refund: money(entry.refund || 0),
      allocationMode: entry.allocationMode || null,
      preferenceRank: Number(entry.preferenceRank) > 0 ? Math.round(Number(entry.preferenceRank)) : null,
      priorityAllocation: entry.priorityAllocation === true,
      priorityGranted: entry.priorityGranted === true,
      reason: String(entry.reason || ""),
      rosterReleased: entry.rosterReleased === true
    };
    playerMining.applicationHistory = [
      record,
      ...playerMining.applicationHistory.filter((historyEntry) => historyEntry.id !== record.id)
    ].slice(0, 30);
    return record;
  }

  function ensureCompetitionPlayerIds(mining, qualified = [], now = Date.now()) {
    const state = getState();
    const limit = config.requiredPlayers;
    const ids = [];
    const existingIds = Array.isArray(mining.competitionPlayerIds) && mining.competitionPlayerIds.length
      ? mining.competitionPlayerIds
      : mining.founderPlayerIds || [];
    for (const rawId of existingIds) {
      if (ids.length >= limit) break;
      const playerId = String(rawId || "");
      const player = peekPlayer(state.players, playerId);
      const playerMining = player?.mining;
      if (
        !playerId
        || ids.includes(playerId)
        || !player
        || !playerHasMiningMilestone(player)
        || Number(playerMining?.competitionSuspendedUntil || 0) > now
        || !playerIsActive(player, now, config.rosterInactiveMs)
      ) continue;
      ids.push(playerId);
    }
    for (const player of qualified) {
      if (ids.length >= limit) break;
      const playerId = String(player?.id || "");
      const playerMining = player?.mining;
      if (
        !playerId
        || ids.includes(playerId)
        || Number(playerMining?.competitionSuspendedUntil || 0) > now
        || !playerIsActive(player, now, config.rosterInactiveMs)
      ) continue;
      ids.push(playerId);
    }
    const previousIds = Array.isArray(mining.competitionPlayerIds) ? mining.competitionPlayerIds : [];
    const changed = ids.length !== previousIds.length
      || ids.some((playerId, index) => playerId !== previousIds[index]);
    mining.competitionPlayerIds = ids;
    const activeIdSet = new Set(ids);
    const removedIdSet = new Set(previousIds
      .map((playerId) => String(playerId || ""))
      .filter((playerId) => playerId && !activeIdSet.has(playerId)));
    if (removedIdSet.size && mining.currentRound?.allocatedAt && mining.currentRound.competitionStats) {
      mining.currentRound.competitionStats.rosterReleasedCount = Math.min(
        Number(mining.currentRound.competitionStats.rosterSize) || removedIdSet.size,
        Math.max(0, Number(mining.currentRound.competitionStats.rosterReleasedCount) || 0) + removedIdSet.size
      );
    }
    const releaseHistoryPlayerIds = new Set();
    if (removedIdSet.size && mining.applications.length) {
      const retainedApplications = [];
      for (const application of mining.applications) {
        const playerId = String(application?.playerId || "");
        if (!removedIdSet.has(playerId)) {
          retainedApplications.push(application);
          continue;
        }
        const player = state.players.get(playerId);
        const escrow = money(application?.escrow || 0);
        if (player && escrow > 0) {
          releaseDeposit(player, escrow, "退出竞租名单退回矿权申请冻结", {
            source: "miningLeaseRefund",
            itemId: `mining-round-${application.targetRound}`,
            repEligible: false
          });
        }
        if (player) {
          const playerMining = normalizeMiningPlayer(player);
          playerMining.lastRosterReleaseRound = Math.max(1, Math.round(Number(application.targetRound) || 1));
          playerMining.competitionQueueAt = now;
          recordMiningApplicationHistory(player, {
            id: `${application.id}:roster-exit`,
            applicationId: application.id,
            roundNumber: application.targetRound,
            submittedAt: application.submittedAt,
            settledAt: now,
            preferences: application.preferences,
            allowFallback: application.allowFallback,
            escrow,
            status: "cancelled",
            refund: escrow,
            reason: "inactive_roster_release",
            rosterReleased: true
          });
          releaseHistoryPlayerIds.add(playerId);
        }
      }
      mining.applications = retainedApplications;
    }
    for (const playerId of removedIdSet) {
      if (releaseHistoryPlayerIds.has(playerId)) continue;
      const player = state.players.get(playerId);
      if (!player) continue;
      const playerMining = normalizeMiningPlayer(player);
      const roundNumber = Math.max(1, Math.round(Number(mining.currentRound?.number) || 1));
      playerMining.lastRosterReleaseRound = roundNumber;
      playerMining.competitionQueueAt = now;
      recordMiningApplicationHistory(player, {
        id: `${mining.currentRound?.id || `mining-round-${roundNumber}`}:${playerId}:roster-exit`,
        roundNumber,
        settledAt: now,
        status: "skipped",
        reason: "inactive_roster_release",
        rosterReleased: true
      });
    }
    const waitlistIds = qualified
      .map((player) => String(player?.id || ""))
      .filter((playerId) => playerId && !ids.includes(playerId));
    return { ids, waitlistIds, changed };
  }

  function createInitialRound(mining, now) {
    const activeVersion = activateScheduledMiningTuningVersion(mining, 1, now);
    mining.currentRound = {
      id: randomUUID(),
      number: 1,
      startsAt: now + config.applicationMs,
      endsAt: now + config.applicationMs + config.leaseMs,
      leaseMs: config.leaseMs,
      applicationMs: config.applicationMs,
      allocatedAt: null,
      tuningVersionId: activeVersion?.id || null,
      leases: []
    };
  }

  function currentRoundLeaseIdentity(lease) {
    if (!lease || typeof lease !== "object" || Array.isArray(lease)) return null;
    const id = String(lease.id || "").trim();
    const playerId = String(lease.playerId || "").trim();
    const mine = miningMineById(lease.mineId);
    if (!id || !playerId || !mine) return null;
    return { id, playerId, mine };
  }

  function normalizeCurrentRoundLeases(round) {
    if (!round) return false;
    let changed = false;
    if (!Array.isArray(round.leases)) {
      round.leases = [];
      return true;
    }
    const validLeases = [];
    const seenIds = new Set();
    const seenPlayerIds = new Set();
    const seenMineIds = new Set();
    for (const lease of round.leases) {
      const identity = currentRoundLeaseIdentity(lease);
      if (
        !identity
        || seenIds.has(identity.id)
        || seenPlayerIds.has(identity.playerId)
        || seenMineIds.has(identity.mine.id)
      ) {
        changed = true;
        continue;
      }
      seenIds.add(identity.id);
      seenPlayerIds.add(identity.playerId);
      seenMineIds.add(identity.mine.id);
      validLeases.push(lease);
    }
    if (validLeases.length !== round.leases.length) {
      round.leases = validLeases;
      changed = true;
    }
    const roundStartsAt = Number(round.startsAt);
    const roundEndsAt = Number(round.endsAt);
    const state = getState();
    for (const lease of validLeases) {
      const identity = currentRoundLeaseIdentity(lease);
      const player = peekPlayer(state.players, identity.playerId);
      const effectiveMine = effectiveMiningMine(state.mining || {}, identity.mine.id, round.number) || identity.mine;
      const canonicalFields = {
        id: identity.id,
        playerId: identity.playerId,
        mineId: identity.mine.id,
        rent: effectiveMine.rent,
        ...(String(round.id || "") ? { roundId: String(round.id) } : {}),
        ...(Number(round.number) > 0 ? { roundNumber: Math.round(Number(round.number)) } : {}),
        ...(player?.name ? { playerName: player.name } : {})
      };
      for (const [key, value] of Object.entries(canonicalFields)) {
        if (lease[key] === value) continue;
        lease[key] = value;
        changed = true;
      }
      const shiftsStarted = Math.max(0, Math.min(
        MINING_MAX_SHIFTS_PER_LEASE,
        Math.round(Number(lease.shiftsStarted) || 0)
      ));
      if (lease.shiftsStarted !== shiftsStarted) {
        lease.shiftsStarted = shiftsStarted;
        changed = true;
      }
      if (lease.maxShifts !== MINING_MAX_SHIFTS_PER_LEASE) {
        lease.maxShifts = MINING_MAX_SHIFTS_PER_LEASE;
        changed = true;
      }
      if (Number.isFinite(roundStartsAt) && roundStartsAt > 0 && lease.startsAt !== roundStartsAt) {
        lease.startsAt = roundStartsAt;
        changed = true;
      }
      if (Number.isFinite(roundEndsAt) && roundEndsAt > 0 && lease.endsAt !== roundEndsAt) {
        lease.endsAt = roundEndsAt;
        changed = true;
      }
      let history = player?.mining?.leaseHistory?.find((entry) => entry.id === lease.id);
      if (!history) continue;
      let captured = false;
      for (const key of [
        "roundId", "roundNumber", "mineId", "playerId", "playerName", "rent",
        "shiftsStarted", "maxShifts", "startsAt", "endsAt"
      ]) {
        if (history[key] === lease[key]) continue;
        if (!captured) {
          history = normalizeMiningPlayer(state.players.get(identity.playerId)).leaseHistory.find((entry) => entry.id === lease.id);
          captured = true;
        }
        history[key] = lease[key];
        changed = true;
      }
    }
    return changed;
  }

  function normalizeCurrentRoundSchedule(round, now) {
    if (!round) return false;
    let changed = false;
    const validTimestamp = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
    const recordedLeaseMs = Number(round.leaseMs) > 0 ? Number(round.leaseMs) : config.leaseMs;
    const validLeases = (Array.isArray(round.leases) ? round.leases : [])
      .filter((lease) => currentRoundLeaseIdentity(lease));
    const leaseStartsAt = validLeases.find((lease) => validTimestamp(lease.startsAt))?.startsAt;
    const leaseEndsAt = validLeases.find((lease) => validTimestamp(lease.endsAt))?.endsAt;
    const allocatedAt = validTimestamp(round.allocatedAt) ? Number(round.allocatedAt) : null;
    const hasAllocation = allocatedAt != null || validLeases.length > 0;

    let startsAt = validTimestamp(round.startsAt) ? Number(round.startsAt) : null;
    let endsAt = validTimestamp(round.endsAt) ? Number(round.endsAt) : null;
    if (startsAt == null) {
      if (validTimestamp(leaseStartsAt)) startsAt = Number(leaseStartsAt);
      else if (endsAt != null) startsAt = Math.max(1, endsAt - recordedLeaseMs);
      else if (allocatedAt != null) startsAt = allocatedAt;
      else startsAt = hasAllocation ? now : now + config.applicationMs;
    }
    if (endsAt == null) {
      endsAt = validTimestamp(leaseEndsAt) ? Number(leaseEndsAt) : startsAt + recordedLeaseMs;
    }
    if (endsAt <= startsAt) endsAt = startsAt + recordedLeaseMs;

    if (round.startsAt !== startsAt) {
      round.startsAt = startsAt;
      changed = true;
    }
    if (round.endsAt !== endsAt) {
      round.endsAt = endsAt;
      changed = true;
    }
    const normalizedAllocatedAt = hasAllocation ? (allocatedAt ?? startsAt) : null;
    if (round.allocatedAt !== normalizedAllocatedAt) {
      round.allocatedAt = normalizedAllocatedAt;
      changed = true;
    }
    return changed;
  }

  function normalizePendingApplications(mining, now) {
    if (!Array.isArray(mining.applications)) {
      mining.applications = [];
      return true;
    }
    const round = mining.currentRound;
    const expectedTargetRound = !round
      ? null
      : !round.allocatedAt
        ? Number(round.number)
        : now >= Number(round.endsAt) - config.applicationMs
          ? Number(round.number) + 1
          : null;
    const targetMines = expectedTargetRound == null
      ? MINES
      : effectiveMiningMines(mining, expectedTargetRound);
    const targetMinesById = new Map(targetMines.map((mine) => [mine.id, mine]));
    const maximumRent = Math.max(0, ...targetMines.map((mine) => money(mine.rent)));
    const selectedByPlayerRound = new Map();
    let changed = false;
    for (const application of mining.applications) {
      if (!application || typeof application !== "object" || Array.isArray(application)) {
        changed = true;
        continue;
      }
      const playerId = String(application.playerId || "").trim();
      const targetRound = Math.round(Number(application.targetRound) || 0);
      if (!playerId || targetRound <= 0) {
        changed = true;
        continue;
      }
      const key = `${playerId}:${targetRound}`;
      const existing = selectedByPlayerRound.get(key);
      if (!existing || Number(application.submittedAt) >= Number(existing.submittedAt)) {
        if (existing) changed = true;
        selectedByPlayerRound.set(key, application);
      } else {
        changed = true;
      }
    }

    const normalized = [];
    const seenApplicationIds = new Set();
    const state = getState();
    for (const application of selectedByPlayerRound.values()) {
      const playerId = String(application.playerId || "").trim();
      const player = peekPlayer(state.players, playerId);
      const targetRound = Math.round(Number(application.targetRound) || 0);
      const storedEscrow = Math.max(0, Math.min(maximumRent, money(application.escrow || 0)));
      const refundAndDiscard = (note) => {
        if (player && storedEscrow > 0) {
          releaseDeposit(state.players.get(playerId), storedEscrow, note, {
            source: "miningLeaseRefund",
            itemId: `mining-round-${targetRound || "invalid"}`,
            repEligible: false
          });
        }
        changed = true;
      };
      if (!player || expectedTargetRound == null || targetRound !== expectedTargetRound) {
        refundAndDiscard("无效矿权申请退回冻结资金");
        continue;
      }
      const preferences = [...new Set((Array.isArray(application.preferences) ? application.preferences : [])
        .map((mineId) => miningMineById(mineId)?.id)
        .filter(Boolean))]
        .slice(0, MINING_MAX_PREFERENCES)
        .filter((mineId) => money(targetMinesById.get(mineId)?.rent) <= storedEscrow);
      if (!preferences.length || storedEscrow <= 0) {
        refundAndDiscard("无有效志愿，退回矿权申请冻结资金");
        continue;
      }
      const escrow = Math.max(...preferences.map((mineId) => money(targetMinesById.get(mineId)?.rent)));
      if (storedEscrow > escrow) {
        releaseDeposit(state.players.get(playerId), storedEscrow - escrow, "修复矿权申请并退回多余冻结资金", {
          source: "miningLeaseRefund",
          itemId: `mining-round-${targetRound}`,
          repEligible: false
        });
        changed = true;
      }
      let id = String(application.id || "").trim();
      if (!id || seenApplicationIds.has(id)) {
        id = randomUUID();
        changed = true;
      }
      seenApplicationIds.add(id);
      const normalizedApplication = {
        id,
        playerId,
        playerName: player.name,
        targetRound,
        preferences,
        previousMineId: miningMineById(application.previousMineId)?.id || previousMineForPlayer(playerId),
        escrow,
        allowFallback: application.allowFallback !== false,
        revision: positiveInteger(application.revision, 1),
        submittedAt: Number(application.submittedAt) > 0 ? Number(application.submittedAt) : now
      };
      if (
        application.id !== normalizedApplication.id
        || application.playerId !== normalizedApplication.playerId
        || application.playerName !== normalizedApplication.playerName
        || application.targetRound !== normalizedApplication.targetRound
        || application.escrow !== normalizedApplication.escrow
        || application.previousMineId !== normalizedApplication.previousMineId
        || application.allowFallback !== normalizedApplication.allowFallback
        || application.revision !== normalizedApplication.revision
        || application.submittedAt !== normalizedApplication.submittedAt
        || JSON.stringify(application.preferences) !== JSON.stringify(normalizedApplication.preferences)
      ) changed = true;
      normalized.push(normalizedApplication);
    }
    if (normalized.length !== mining.applications.length) changed = true;
    mining.applications = normalized;
    return changed;
  }

  function migrateCurrentRoundCadence(mining, now) {
    const round = mining.currentRound;
    if (!round) return false;
    const scheduleNormalized = normalizeCurrentRoundSchedule(round, now);
    const leasesNormalized = normalizeCurrentRoundLeases(round);
    const actualLeaseMs = Math.max(0, Number(round.endsAt) - Number(round.startsAt));
    const recordedLeaseMs = Number(round.leaseMs) > 0 ? Number(round.leaseMs) : actualLeaseMs;
    const recordedApplicationMs = Number(round.applicationMs) > 0
      ? Number(round.applicationMs)
      : config.applicationMs;
    const leaseCadenceChanged = recordedLeaseMs !== config.leaseMs;
    const applicationCadenceChanged = recordedApplicationMs !== config.applicationMs;
    if (!leaseCadenceChanged && !applicationCadenceChanged) {
      if (Number(round.leaseMs) === config.leaseMs && Number(round.applicationMs) === config.applicationMs) {
        return scheduleNormalized || leasesNormalized;
      }
      round.leaseMs = config.leaseMs;
      round.applicationMs = config.applicationMs;
      return true;
    }

    if (!leaseCadenceChanged) {
      round.leaseMs = config.leaseMs;
      round.applicationMs = config.applicationMs;
      return true;
    }

    if (round.allocatedAt) {
      round.startsAt = now;
      round.endsAt = now + config.leaseMs;
      const state = getState();
      for (const lease of round.leases || []) {
        lease.startsAt = round.startsAt;
        lease.endsAt = round.endsAt;
        const player = state.players.get(lease.playerId);
        const history = player ? normalizeMiningPlayer(player).leaseHistory.find((entry) => entry.id === lease.id) : null;
        if (history) {
          history.startsAt = lease.startsAt;
          history.endsAt = lease.endsAt;
        }
      }
    } else {
      round.startsAt = now + config.applicationMs;
      round.endsAt = round.startsAt + config.leaseMs;
    }
    round.leaseMs = config.leaseMs;
    round.applicationMs = config.applicationMs;
    return true;
  }

  function activeLeaseForPlayer(playerId) {
    const mining = ensureMiningWorld();
    return (mining.currentRound?.leases || []).find((lease) => lease.playerId === playerId) || null;
  }

  function applicationWindow(now = Date.now()) {
    const mining = ensureMiningWorld();
    const round = mining.currentRound;
    if (!mining.unlockedAt || !round) return null;
    if (!round.allocatedAt && now < round.startsAt) {
      return { targetRound: round.number, closesAt: round.startsAt };
    }
    if (round.allocatedAt && now >= round.endsAt - config.applicationMs && now < round.endsAt) {
      return { targetRound: round.number + 1, closesAt: round.endsAt };
    }
    return null;
  }

  function applicationForPlayer(playerId, targetRound = null) {
    const mining = ensureMiningWorld();
    return mining.applications.find((entry) => (
      entry.playerId === playerId && (targetRound == null || entry.targetRound === targetRound)
    )) || null;
  }

  function previousMineForPlayer(playerId) {
    const mining = ensureMiningWorld();
    const currentMineId = (mining.currentRound?.leases || [])
      .find((lease) => lease.playerId === playerId)?.mineId;
    if (currentMineId) return currentMineId;
    for (const round of mining.history || []) {
      const previousMineId = (round?.leases || [])
        .find((lease) => lease.playerId === playerId)?.mineId;
      if (previousMineId) return previousMineId;
    }
    return null;
  }

  function allocateRound(round, now) {
    const state = getState();
    const mining = ensureMiningWorld();
    const applications = mining.applications.filter((entry) => entry.targetRound === round.number);
    const applicationsByPlayer = new Map(applications.map((application) => [application.playerId, application]));
    const competitionPlayerIds = new Set((mining.competitionPlayerIds || []).map(String));
    const rosterApplicantIds = new Set(applications
      .map((application) => String(application.playerId || ""))
      .filter((playerId) => playerId && competitionPlayerIds.has(playerId)));
    const eligible = applications.flatMap((application) => {
      const player = state.players.get(application.playerId);
      if (
        !player
        || !playerHasMiningMilestone(player)
        || !competitionPlayerIds.has(String(player.id))
      ) return [];
      const playerMining = normalizeMiningPlayer(player);
      const previousMineId = application.previousMineId || previousMineForPlayer(player.id);
      const preferences = (application.preferences || []).filter((mineId) => mineId !== previousMineId);
      if (!preferences.length) return [];
      return [{
        ...application,
        preferences,
        previousMineId,
        assignmentBudget: money(application.escrow),
        priorityEligible: application.allowFallback !== false
          && Number(playerMining.priorityRound) === Number(round.number)
      }];
    });
    const eligibleByPlayer = new Map(eligible.map((entry) => [entry.playerId, entry]));
    const roundMines = effectiveMiningMines(mining, round.number);
    const winners = matchMiningApplicants(eligible, roundMines, round.id);

    const leases = [];
    function grantLease(player, assignment) {
      const playerMining = normalizeMiningPlayer(player);
      const wonMine = assignment.mine;
      playerMining.missedRounds = 0;
      playerMining.priorityRound = null;
      const lease = {
        id: randomUUID(),
        roundId: round.id,
        roundNumber: round.number,
        mineId: wonMine.id,
        playerId: player.id,
        playerName: player.name,
        rent: wonMine.rent,
        startsAt: round.startsAt,
        endsAt: round.endsAt,
        shiftsStarted: 0,
        maxShifts: MINING_MAX_SHIFTS_PER_LEASE,
        allocationMode: assignment.allocationMode,
        preferenceRank: assignment.preferenceRank,
        priorityAllocation: assignment.priorityAllocation === true
      };
      leases.push(lease);
      playerMining.leaseHistory.unshift({ ...lease, status: "active" });
      playerMining.leaseHistory = playerMining.leaseHistory.slice(0, 20);
    }

    const settlementPlayerIds = [...new Set(applications.map((application) => application.playerId))];
    for (const playerId of settlementPlayerIds) {
      const player = state.players.get(playerId);
      if (!player) continue;
      const playerMining = normalizeMiningPlayer(player);
      playerMining.skippedApplicationRounds = 0;
      const application = applicationsByPlayer.get(player.id) || null;
      const eligibleEntry = eligibleByPlayer.get(player.id) || null;
      const assignment = winners.get(player.id);
      const wonMine = assignment?.mine;
      if (wonMine) {
        const escrow = money(application?.escrow || 0);
        const additionalRent = Math.max(0, money(wonMine.rent) - escrow);
        if (additionalRent && !spendCash(player, additionalRent, `矿权分配补缴：${wonMine.name}`, {
          source: "miningLeaseRent",
          itemId: round.id,
          repEligible: false
        })) {
          if (escrow) releaseDeposit(player, escrow, "矿权分配失败退款", {
            source: "miningLeaseRefund",
            itemId: round.id,
            repEligible: false
          });
          playerMining.missedRounds = Math.min(3, playerMining.missedRounds + 1);
          playerMining.priorityRound = null;
          recordMiningApplicationHistory(player, {
            id: `${application.id}:settled`,
            applicationId: application.id,
            roundNumber: round.number,
            submittedAt: application.submittedAt,
            settledAt: now,
            preferences: application.preferences,
            allowFallback: application.allowFallback,
            escrow,
            status: "failed",
            refund: escrow,
            reason: "insufficient_additional_rent"
          });
          continue;
        }
        const refund = Math.max(0, escrow - money(wonMine.rent));
        if (refund) releaseDeposit(player, refund, `矿权竞租差额退回：${wonMine.name}`, {
          source: "miningLeaseRefund",
          itemId: round.id,
          repEligible: false
        });
        grantLease(player, assignment);
        recordMiningApplicationHistory(player, {
          id: `${application.id}:settled`,
          applicationId: application.id,
          roundNumber: round.number,
          submittedAt: application.submittedAt,
          settledAt: now,
          preferences: application.preferences,
          allowFallback: application.allowFallback,
          escrow,
          status: "won",
          mineId: wonMine.id,
          rent: wonMine.rent,
          refund,
          allocationMode: assignment.allocationMode,
          preferenceRank: assignment.preferenceRank,
          priorityAllocation: assignment.priorityAllocation === true
        });
      } else {
        if (Number(application?.escrow) > 0) {
          releaseDeposit(player, application.escrow, "矿权竞租未中选退款", {
            source: "miningLeaseRefund",
            itemId: round.id,
            repEligible: false
          });
        }
        const systemLoss = Boolean(eligibleEntry && application?.allowFallback !== false);
        playerMining.missedRounds = systemLoss ? 1 : 0;
        playerMining.priorityRound = systemLoss ? round.number + 1 : null;
        recordMiningApplicationHistory(player, {
          id: `${application.id}:settled`,
          applicationId: application.id,
          roundNumber: round.number,
          submittedAt: application.submittedAt,
          settledAt: now,
          preferences: application.preferences,
          allowFallback: application.allowFallback,
          escrow: application.escrow,
          status: "missed",
          refund: application.escrow,
          priorityGranted: systemLoss,
          reason: eligibleEntry ? "not_selected" : "ineligible_application"
        });
      }
    }
    let rosterReleasedCount = 0;
    for (const playerId of competitionPlayerIds) {
      if (applicationsByPlayer.has(playerId)) continue;
      const player = state.players.get(playerId);
      if (!player) continue;
      const playerMining = normalizeMiningPlayer(player);
      playerMining.skippedApplicationRounds += 1;
      if (Number(playerMining.priorityRound) <= round.number) {
        playerMining.missedRounds = 0;
        playerMining.priorityRound = null;
      }
      const rosterReleased = playerMining.skippedApplicationRounds >= MINING_MAX_SKIPPED_APPLICATION_ROUNDS;
      if (rosterReleased) {
        rosterReleasedCount += 1;
        mining.competitionPlayerIds = (mining.competitionPlayerIds || [])
          .filter((entry) => String(entry) !== String(playerId));
        playerMining.skippedApplicationRounds = 0;
        playerMining.competitionSuspendedUntil = round.endsAt;
        playerMining.competitionQueueAt = now;
        playerMining.lastRosterReleaseRound = round.number;
      }
      recordMiningApplicationHistory(player, {
        id: `${round.id}:${playerId}:skipped`,
        roundNumber: round.number,
        settledAt: now,
        status: "skipped",
        reason: rosterReleased ? "repeated_non_participation" : "no_application",
        rosterReleased
      });
    }
    mining.applications = mining.applications.filter((entry) => entry.targetRound !== round.number);
    round.leases = leases;
    round.allocatedAt = now;
    round.competitionStats = {
      rosterSize: competitionPlayerIds.size,
      applicantCount: rosterApplicantIds.size,
      winnerCount: leases.length,
      missedCount: Math.max(0, rosterApplicantIds.size - leases.length),
      skippedCount: Math.max(0, competitionPlayerIds.size - rosterApplicantIds.size),
      priorityApplicantCount: eligible.filter((entry) => entry.priorityEligible).length,
      priorityWinnerCount: leases.filter((lease) => lease.priorityAllocation).length,
      fallbackWinnerCount: leases.filter((lease) => lease.allocationMode !== "preference").length,
      rosterReleasedCount,
      settledAt: now
    };
    if (leases.length) {
      const priorityCount = leases.filter((lease) => lease.priorityAllocation).length;
      addNews(`第 ${round.number} 轮矿权已经分配，${leases.length} 座矿山开始作业${priorityCount ? `，其中 ${priorityCount} 人通过上轮落选优先取得矿权` : ""}。`, "great");
    }
    return leases;
  }

  function expireRound(round) {
    const state = getState();
    for (const lease of round?.leases || []) {
      const player = state.players.get(lease.playerId);
      if (!player) continue;
      const mining = normalizeMiningPlayer(player);
      const history = mining.leaseHistory.find((entry) => entry.id === lease.id);
      if (history) history.status = "expired";
    }
  }

  function recoverMiningDowntime(mining, now) {
    const round = mining.currentRound;
    if (!round) return { recovered: false, recoveredRounds: 0, refundedApplications: 0, refundedEscrow: 0 };
    const roundEndsAt = Number(round.endsAt);
    const leaseMs = Math.max(1, Number(round.leaseMs) || config.leaseMs);
    if (!Number.isFinite(roundEndsAt) || roundEndsAt <= 0) {
      return { recovered: false, recoveredRounds: 0, refundedApplications: 0, refundedEscrow: 0 };
    }

    // A currently allocated round may cross one boundary normally. Recovery is
    // needed only once the entire following lease has also elapsed; otherwise a
    // regular delayed tick can still honor next-round applications.
    const recoveryAt = round.allocatedAt ? roundEndsAt + leaseMs : roundEndsAt;
    if (now < recoveryAt) {
      return { recovered: false, recoveredRounds: 0, refundedApplications: 0, refundedEscrow: 0 };
    }

    const state = getState();
    const refundMines = effectiveMiningMines(mining, Math.max(1, Number(round.number) + 1));
    const maximumRent = Math.max(0, ...refundMines.map((mine) => money(mine.rent)));
    const recoverableApplications = new Map();
    for (const application of Array.isArray(mining.applications) ? mining.applications : []) {
      const playerId = String(application?.playerId || "").trim();
      const targetRound = Math.round(Number(application?.targetRound) || 0);
      if (!playerId) continue;
      const key = `${playerId}:${targetRound}`;
      const existing = recoverableApplications.get(key);
      if (!existing || Number(application?.submittedAt) >= Number(existing?.submittedAt)) {
        recoverableApplications.set(key, application);
      }
    }
    let refundedApplications = 0;
    let refundedEscrow = 0;
    for (const application of recoverableApplications.values()) {
      const player = state.players.get(String(application?.playerId || ""));
      if (!player) continue;
      const escrow = Math.max(0, Math.min(maximumRent, money(application?.escrow || 0)));
      if (escrow > 0) {
        releaseDeposit(player, escrow, "停机期间申请轮次已过，退回矿权冻结资金", {
          source: "miningLeaseRefund",
          itemId: `mining-round-${application?.targetRound || "expired"}`,
          repEligible: false
        });
        refundedEscrow += escrow;
      }
      refundedApplications += 1;
      recordMiningApplicationHistory(player, {
        id: `${application?.id || randomUUID()}:downtime:${now}`,
        applicationId: application?.id,
        roundNumber: application?.targetRound || round.number + 1,
        submittedAt: application?.submittedAt,
        settledAt: now,
        preferences: application?.preferences,
        allowFallback: application?.allowFallback,
        escrow,
        status: "cancelled",
        refund: escrow,
        reason: "server_downtime_expired"
      });
    }

    expireRound(round);
    mining.history.unshift(structuredClone(round));
    mining.history = mining.history.slice(0, 12);
    mining.applications = [];
    mining.activeApplicationRound = null;
    const elapsedFullRounds = Math.floor(Math.max(0, now - roundEndsAt) / leaseMs);
    const nextRoundNumber = Math.max(1, Math.round(Number(round.number) || 1) + 1 + elapsedFullRounds);
    const activeVersion = activateScheduledMiningTuningVersion(mining, nextRoundNumber, now);
    mining.currentRound = {
      id: randomUUID(),
      number: nextRoundNumber,
      startsAt: now + config.applicationMs,
      endsAt: now + config.applicationMs + config.leaseMs,
      leaseMs: config.leaseMs,
      applicationMs: config.applicationMs,
      allocatedAt: null,
      tuningVersionId: activeVersion?.id || null,
      leases: []
    };
    addNews(
      `矿区停机恢复完成，已跳过 ${nextRoundNumber - Number(round.number || 0)} 个过期轮次${refundedApplications ? `，${refundedApplications} 份旧申请已全额退款` : ""}。`,
      "info"
    );
    return {
      recovered: true,
      recoveredRounds: nextRoundNumber - Number(round.number || 0),
      refundedApplications,
      refundedEscrow
    };
  }

  function processMiningWorld(now = Date.now()) {
    const mining = ensureMiningWorld();
    let changed = migrateCurrentRoundCadence(mining, now);
    const downtimeRecovery = recoverMiningDowntime(mining, now);
    if (downtimeRecovery.recovered) changed = true;
    if (mining.currentRound && normalizePendingApplications(mining, now)) changed = true;
    for (const player of playersMatching(getState().players, (entry) =>
      (entry.mining?.licenseAt || Number(entry.rep) >= config.requiredRep) && (
        !entry.mining?.licenseAt || !entry.mining?.competitionQueueAt
        || (config.basicMode && (!entry.mining?.starterMinerGranted || !entry.mining?.miners?.length))
      ))) {
      if (grantMiningLicenseIfDue(player, now)) changed = true;
    }
    const qualified = qualifiedPlayers(now);
    let competition = ensureCompetitionPlayerIds(mining, qualified, now);
    if (competition.changed) changed = true;
    if (!mining.unlockedAt && competition.ids.length >= config.requiredPlayers) {
      mining.unlockedAt = now;
      mining.founderPlayerIds = [...competition.ids];
      createInitialRound(mining, now);
      addNews(`玉矿联合会正式开放，首批 ${MINES.length} 座矿山开始接受竞租。`, "great");
      changed = true;
    }
    if (!mining.unlockedAt) {
      return { changed, unlocked: false, qualifiedCount: competition.ids.length, ...downtimeRecovery };
    }
    if (!mining.currentRound) {
      createInitialRound(mining, now);
      changed = true;
    }
    if (normalizePendingApplications(mining, now)) changed = true;

    let guard = 0;
    while (mining.currentRound && guard < 24) {
      const round = mining.currentRound;
      const activeVersion = activateScheduledMiningTuningVersion(mining, round.number, now);
      if (!round.tuningVersionId && activeVersion?.id) {
        round.tuningVersionId = activeVersion.id;
        changed = true;
      }
      if (!round.allocatedAt && now >= round.startsAt) {
        allocateRound(round, round.startsAt);
        competition = ensureCompetitionPlayerIds(mining, qualified, now);
        changed = true;
      }
      if (now < round.endsAt) break;
      expireRound(round);
      mining.history.unshift(structuredClone(round));
      mining.history = mining.history.slice(0, 12);
      const nextRound = {
        id: randomUUID(),
        number: round.number + 1,
        startsAt: round.endsAt,
        endsAt: round.endsAt + config.leaseMs,
        leaseMs: config.leaseMs,
        applicationMs: config.applicationMs,
        allocatedAt: null,
        tuningVersionId: activateScheduledMiningTuningVersion(mining, round.number + 1, round.endsAt)?.id || null,
        leases: []
      };
      mining.currentRound = nextRound;
      allocateRound(nextRound, nextRound.startsAt);
      competition = ensureCompetitionPlayerIds(mining, qualified, now);
      changed = true;
      guard += 1;
    }
    if (refreshMiningTuningEffectResults(mining, now)) changed = true;
    const liveApplicationRound = applicationWindow(now)?.targetRound || null;
    if (mining.activeApplicationRound !== liveApplicationRound) {
      mining.activeApplicationRound = liveApplicationRound;
      changed = true;
    }
    return { changed, unlocked: true, qualifiedCount: competition.ids.length, ...downtimeRecovery };
  }

  /** Debug/dev only: unlock the world mine and grant the current player a permanent license. */
  function debugUnlockMining(player, now = Date.now()) {
    if (!player) return { ok: false, changed: false, message: "玩家状态不可用。" };
    const unlockedAt = Number(now) > 0 ? Number(now) : Date.now();
    const mining = ensureMiningWorld();
    const playerMining = normalizeMiningPlayer(player);
    const worldUnlocked = !mining.unlockedAt;
    const licenseGranted = !playerMining.licenseAt;
    const alreadyInRoster = mining.competitionPlayerIds
      .some((playerId) => String(playerId) === String(player.id));
    const rosterPenaltyCleared = Number(playerMining.competitionSuspendedUntil || 0) > 0
      || Number(playerMining.skippedApplicationRounds || 0) > 0;
    const rosterRestored = !alreadyInRoster || rosterPenaltyCleared;
    let roundCreated = false;

    if (worldUnlocked) {
      mining.unlockedAt = unlockedAt;
      mining.founderPlayerIds = [
        String(player.id || ""),
        ...mining.founderPlayerIds.map((id) => String(id || ""))
      ].filter((id, index, list) => id && list.indexOf(id) === index);
    }
    if (licenseGranted) playerMining.licenseAt = unlockedAt;
    playerMining.competitionSuspendedUntil = null;
    playerMining.skippedApplicationRounds = 0;
    if (rosterRestored) playerMining.competitionQueueAt = unlockedAt;
    mining.competitionPlayerIds = [
      String(player.id || ""),
      ...mining.competitionPlayerIds.map((id) => String(id || ""))
    ].filter((id, index, list) => id && list.indexOf(id) === index)
      .slice(0, config.requiredPlayers);
    const starter = config.basicMode
      ? ensureBasicStarterMiner(player, { rng: Math.random, makeId: randomUUID })
      : { changed: false, granted: false };
    if (!mining.currentRound) {
      createInitialRound(mining, unlockedAt);
      roundCreated = true;
    }

    const changed = worldUnlocked || licenseGranted || rosterRestored || starter.changed || roundCreated;
    return {
      ok: true,
      changed,
      worldUnlocked,
      licenseGranted,
      rosterRestored,
      starterMinerGranted: starter.granted,
      roundCreated,
      message: changed ? "矿山与当前玩家采矿资格已解锁。" : "矿山已经解锁。"
    };
  }

  function canPlayerMine(player, now = Date.now()) {
    grantMiningLicenseIfDue(player, now);
    const mining = ensureMiningWorld();
    if (!mining.unlockedAt) {
      return { ok: false, message: `需 ${config.requiredPlayers} 名活跃玩家曾达到 ${config.requiredRep} 声望后开放矿区。` };
    }
    if (!player?.mining?.licenseAt) {
      return { ok: false, message: `声望曾达到 ${config.requiredRep} 后才能取得采矿资格。` };
    }
    if (!(mining.competitionPlayerIds || []).some((playerId) => String(playerId) === String(player.id))) {
      return { ok: false, message: `当前 ${config.requiredPlayers} 个竞租席位已满，你已进入候补队列。` };
    }
    return { ok: true, message: "" };
  }

  function submitMiningApplication(player, preferences, now = Date.now(), options = {}) {
    processMiningWorld(now);
    const access = canPlayerMine(player, now);
    if (!access.ok) return access;
    const window = applicationWindow(now);
    if (!window) return { ok: false, message: "当前不在矿权申请期。" };
    const unique = [...new Set((Array.isArray(preferences) ? preferences : [])
      .map((entry) => String(entry || ""))
      .filter((mineId) => miningMineById(mineId)))]
      .slice(0, MINING_MAX_PREFERENCES);
    if (!unique.length) return { ok: false, message: "请至少选择一座意向矿山。" };
    const previousMineId = previousMineForPlayer(player.id);
    if (unique.every((mineId) => mineId === previousMineId)) {
      return { ok: false, message: "不能连续承租同一座矿山，请选择其他矿山。" };
    }
    const mining = ensureMiningWorld();
    const targetMines = new Map(effectiveMiningMines(mining, window.targetRound)
      .map((mine) => [mine.id, mine]));
    const escrow = Math.max(...unique.map((mineId) => targetMines.get(mineId)?.rent || 0));
    const existing = applicationForPlayer(player.id, window.targetRound);
    const currentRevision = existing ? positiveInteger(existing.revision, 1) : 0;
    if (
      options.expectedRevision !== undefined
      && Math.max(0, Math.round(Number(options.expectedRevision) || 0)) !== currentRevision
    ) {
      return {
        ok: false,
        stale: true,
        application: existing || null,
        message: "矿权志愿已在其他窗口更新，本次未调整冻结资金，请按最新状态重试。"
      };
    }
    const previousEscrow = money(existing?.escrow || 0);
    if (escrow > previousEscrow && !holdDeposit(
      player,
      escrow - previousEscrow,
      `矿权竞租冻结：第 ${window.targetRound} 轮`,
      { source: "miningLeaseEscrow", itemId: `mining-round-${window.targetRound}`, repEligible: false }
    )) {
      return { ok: false, message: `申请需要冻结最高租金 ¥${money(escrow).toLocaleString("zh-CN")}。` };
    }
    if (escrow < previousEscrow) {
      releaseDeposit(player, previousEscrow - escrow, "调整矿权志愿退回差额", {
        source: "miningLeaseRefund",
        itemId: `mining-round-${window.targetRound}`,
        repEligible: false
      });
    }
    const application = {
      id: existing?.id || randomUUID(),
      playerId: player.id,
      playerName: player.name,
      targetRound: window.targetRound,
      preferences: unique,
      previousMineId,
      escrow,
      allowFallback: options.allowFallback !== false,
      revision: currentRevision + 1,
      submittedAt: now
    };
    mining.applications = mining.applications.filter((entry) => !(
      entry.playerId === player.id && entry.targetRound === window.targetRound
    ));
    mining.applications.push(application);
    const priorityEligible = application.allowFallback !== false
      && Number(normalizeMiningPlayer(player).priorityRound) === Number(window.targetRound);
    return {
      ok: true,
      message: `已提交 ${unique.length} 项矿权志愿${priorityEligible ? "，上轮落选优先已生效" : application.allowFallback ? "，接受空闲矿山调剂" : ""}。`,
      application
    };
  }

  function cancelMiningApplication(player, now = Date.now(), options = {}) {
    processMiningWorld(now);
    const window = applicationWindow(now);
    if (!window) return { ok: false, message: "当前申请期已经结束。" };
    const mining = ensureMiningWorld();
    const application = applicationForPlayer(player.id, window.targetRound);
    const currentRevision = application ? positiveInteger(application.revision, 1) : 0;
    if (
      options.expectedRevision !== undefined
      && Math.max(0, Math.round(Number(options.expectedRevision) || 0)) !== currentRevision
    ) {
      return {
        ok: false,
        stale: true,
        application: application || null,
        message: "矿权志愿已在其他窗口更新，本次未取消或退款，请按最新状态重试。"
      };
    }
    if (!application) return { ok: false, message: "当前没有待处理的矿权申请。" };
    if (application.escrow > 0) {
      releaseDeposit(player, application.escrow, "取消矿权申请退款", {
        source: "miningLeaseRefund",
        itemId: `mining-round-${window.targetRound}`,
        repEligible: false
      });
    }
    mining.applications = mining.applications.filter((entry) => entry.id !== application.id);
    recordMiningApplicationHistory(player, {
      id: `${application.id}:cancelled:${now}`,
      applicationId: application.id,
      roundNumber: application.targetRound,
      submittedAt: application.submittedAt,
      settledAt: now,
      preferences: application.preferences,
      allowFallback: application.allowFallback,
      escrow: application.escrow,
      status: "cancelled",
      refund: application.escrow,
      reason: "player_cancelled"
    });
    return { ok: true, message: "矿权申请已取消，冻结资金已经退回。" };
  }

  function miningConditionForLease(lease) {
    if (!lease) return null;
    return miningSiteConditionFor(`${lease.roundId}:${lease.mineId}:${Number(lease.shiftsStarted) + 1}`);
  }

  function miningShiftQuote(player, mine, minerIds, preparationIds = [], condition = null, incentiveId = "standard") {
    const mining = normalizeMiningPlayer(player);
    const ids = [...new Set((minerIds || []).map(String))];
    const miners = ids.map((id) => mining.miners.find((entry) => entry.id === id)).filter(Boolean);
    const wageQuote = miningShiftWageQuote(miners, incentiveId);
    const preparationEffects = miningPreparationEffects(preparationIds, condition?.id);
    return {
      miners,
      incentive: wageQuote.incentive,
      baseWages: wageQuote.baseWages,
      wages: wageQuote.wages,
      incentivePremium: wageQuote.incentivePremium,
      supplies: mine.supplies,
      preparations: preparationEffects.preparations,
      preparationCost: preparationEffects.cost,
      total: money(wageQuote.wages + mine.supplies + preparationEffects.cost)
    };
  }

  function miningShiftDurationForPlayer(player) {
    const mining = normalizeMiningPlayer(player);
    return miningShiftDuration(config.shiftMs, mining.facilities);
  }

  function tunedMiningOutputCount(count, multiplier = 1, rng = Math.random) {
    const normalizedCount = Math.max(0, Math.round(Number(count) || 0));
    const normalizedMultiplier = normalizedTuningMultiplier(multiplier);
    if (Math.abs(normalizedMultiplier - 1) < 0.0001) return normalizedCount;
    const scaled = normalizedCount * normalizedMultiplier;
    const whole = Math.floor(scaled);
    return whole + (rng() < scaled - whole ? 1 : 0);
  }

  function startBasicMiningShift(player, {
    round,
    lease,
    mine,
    playerMining,
    minerIds,
    shiftDuration,
    tuningOutputMultiplier,
    now
  }) {
    if (minerIds.length < MINING_BASIC_MIN_CREW || minerIds.length > MINING_BASIC_MAX_CREW) {
      return { ok: false, message: `每次开采请选择 ${MINING_BASIC_MIN_CREW}～${MINING_BASIC_MAX_CREW} 名矿工。` };
    }
    const miners = minerIds
      .map((id) => playerMining.miners.find((entry) => entry.id === id))
      .filter(Boolean);
    if (miners.length !== minerIds.length) return { ok: false, message: "所选矿工不存在。" };
    if (miners.some((miner) => isMinerBusy(player, miner.id))) {
      return { ok: false, message: "所选矿工中有人正在作业。" };
    }
    const plan = miningBasicShiftPlan(mine, miners);
    const jobId = randomUUID();
    if (!spendCash(player, plan.total, `矿山开采：${mine.name}`, {
      source: "miningShift",
      itemId: jobId,
      at: now,
      repEligible: false
    })) {
      return { ok: false, message: `本次矿工工资共需 ¥${plan.total.toLocaleString("zh-CN")}。` };
    }
    const job = {
      id: jobId,
      mode: "basic",
      status: "active",
      roundId: round.id,
      roundNumber: round.number,
      leaseId: lease.id,
      mineId: mine.id,
      mineName: mine.name,
      tuningVersionId: round.tuningVersionId || null,
      tuningOutputMultiplier,
      mineGradeId: plan.mineProfile.id,
      mineGradeName: plan.mineProfile.name,
      strategyId: "standard",
      strategyLabel: "基础开采",
      incentiveId: "standard",
      incentiveLabel: "固定班薪",
      wageCost: plan.wageCost,
      incentivePremium: 0,
      minerIds,
      miningPower: plan.miningPower,
      preparationIds: [],
      preparationNames: [],
      preparationCost: 0,
      estimate: {
        yieldMin: plan.yieldMin,
        yieldMax: plan.yieldMax,
        baseYieldMin: plan.baseYieldMin,
        baseYieldMax: plan.baseYieldMax,
        extraYieldChance: plan.extraYieldChance,
        risk: plan.risk,
        upgradeChance: 0,
        clueGain: 0
      },
      startedAt: now,
      readyAt: now + shiftDuration,
      durationMs: shiftDuration,
      cost: plan.total
    };
    playerMining.jobs.push(job);
    lease.shiftsStarted += 1;
    const leaseHistory = playerMining.leaseHistory.find((entry) => entry.id === lease.id);
    if (leaseHistory) leaseHistory.shiftsStarted = lease.shiftsStarted;
    return {
      ok: true,
      message: `${mine.name} 已开工，${miners.length} 名矿工将在本班结束后运回原石。`,
      job,
      fee: plan.total
    };
  }

  function upgradeMiningFacility(player, facilityId, now = Date.now()) {
    if (config.basicMode) return { ok: false, message: "基础矿山模式暂不开放矿业设施。" };
    processMiningWorld(now);
    const access = canPlayerMine(player, now);
    if (!access.ok) return access;
    const facility = miningFacilityById(facilityId);
    if (!facility) return { ok: false, message: "矿业设施不存在。" };
    const mining = normalizeMiningPlayer(player);
    const currentLevel = Number(mining.facilities[facility.id]) || 0;
    if (currentLevel >= MINING_FACILITY_MAX_LEVEL) {
      return { ok: false, message: `${facility.name}已经达到最高等级。` };
    }
    const cost = miningFacilityUpgradeCost(facility.id, currentLevel);
    if (!spendCash(player, cost, `升级矿业设施：${facility.name} Lv.${currentLevel + 1}`, {
      source: "miningFacilityUpgrade",
      itemId: facility.id,
      repEligible: false
    })) {
      return { ok: false, message: `升级${facility.name}需要 ¥${money(cost).toLocaleString("zh-CN")}。` };
    }
    const level = currentLevel + 1;
    mining.facilities[facility.id] = level;
    mining.stats.facilitySpent += cost;
    return {
      ok: true,
      message: `${facility.name}已升级至 Lv.${level}。`,
      facilityId: facility.id,
      level,
      fee: cost
    };
  }

  function startMiningShift(player, payload = {}, now = Date.now()) {
    processMiningWorld(now);
    const access = canPlayerMine(player, now);
    if (!access.ok) return access;
    const worldMining = ensureMiningWorld();
    const round = worldMining.currentRound;
    if (!round?.allocatedAt || now < round.startsAt || now >= round.endsAt) {
      return { ok: false, message: "当前没有正在进行的矿权租期。" };
    }
    const lease = activeLeaseForPlayer(player.id);
    if (!lease) return { ok: false, message: "本轮尚未取得矿山租赁权。" };
    if (lease.shiftsStarted >= lease.maxShifts) return { ok: false, message: "本轮开采班次已经用完。" };
    const shiftDuration = config.basicMode ? config.shiftMs : miningShiftDurationForPlayer(player);
    if (now + shiftDuration > lease.endsAt) return { ok: false, message: "剩余租期不足以完成一个开采班次。" };
    const playerMining = normalizeMiningPlayer(player);
    if (playerMining.jobs.some((job) => job.status === "active")) {
      return { ok: false, message: "当前已有采矿班组在井下作业。" };
    }
    const mine = miningMineById(lease.mineId);
    if (!mine) return { ok: false, message: "矿山资料不存在。" };
    const effectiveMine = effectiveMiningMine(worldMining, lease.mineId, round.number);
    const tuningOutputMultiplier = effectiveMine?.outputMultiplier || 1;
    const minerIds = [...new Set((Array.isArray(payload.minerIds) ? payload.minerIds : []).map(String))];
    if (config.basicMode) {
      return startBasicMiningShift(player, {
        round,
        lease,
        mine,
        playerMining,
        minerIds,
        shiftDuration,
        tuningOutputMultiplier,
        now
      });
    }
    if (minerIds.length !== mine.crewRequired) {
      return { ok: false, message: `${mine.name} 每班需要 ${mine.crewRequired} 名矿工。` };
    }
    const preparationIds = [...new Set((Array.isArray(payload.preparationIds) ? payload.preparationIds : []).map(String))];
    if (preparationIds.length > MINING_MAX_PREPARATIONS) {
      return { ok: false, message: `每班最多携带 ${MINING_MAX_PREPARATIONS} 项班前物资。` };
    }
    if (preparationIds.some((preparationId) => !miningPreparationById(preparationId))) {
      return { ok: false, message: "所选班前物资不存在。" };
    }
    const requestedIncentiveId = String(payload.incentiveId || "standard");
    const incentive = miningShiftIncentiveById(requestedIncentiveId);
    if (!MINING_SHIFT_INCENTIVES[requestedIncentiveId]) {
      return { ok: false, message: "所选班次激励方案不存在。" };
    }
    const condition = miningConditionForLease(lease);
    const quote = miningShiftQuote(player, mine, minerIds, preparationIds, condition, incentive.id);
    if (quote.miners.length !== mine.crewRequired) return { ok: false, message: "所选矿工不存在。" };
    if (quote.miners.some((miner) => isMinerBusy(player, miner.id))) {
      return { ok: false, message: "所选矿工中有人正在作业。" };
    }
    const expiredContractMiner = quote.miners.find((miner) => miningMinerContractInfo(miner).expired);
    if (expiredContractMiner) {
      return { ok: false, message: `${expiredContractMiner.name}的矿工合约班次已经用尽，请先续约。` };
    }
    const strategy = miningStrategyById(payload.strategyId);
    const mineMasteryLevel = miningMineMasteryLevel(playerMining.mineRecords[mine.id]);
    const crewKey = miningCrewKey(minerIds);
    const crewBondLevel = miningCrewBondLevel(playerMining.crewRecords[crewKey]);
    const requestedForemanId = String(payload.foremanId || "");
    const foreman = quote.miners.find((miner) => miner.id === requestedForemanId) || quote.miners[0];
    const foremanInfo = miningForemanInfo(foreman);
    const rolePlan = roleAssignmentsForShift(quote.miners, payload.roleAssignments);
    if (!rolePlan.ok) return rolePlan;
    const useSurveyReport = payload.useSurveyReport === true;
    if (useSurveyReport && (Number(playerMining.mineRecords[mine.id]?.surveyReports) || 0) < 1) {
      return { ok: false, message: `${mine.name}当前没有可用的矿脉勘探成果。` };
    }
    const shiftPerformance = miningShiftPerformance({
      mine,
      miners: quote.miners,
      strategyId: strategy.id,
      conditionId: condition.id,
      preparationIds,
      facilities: playerMining.facilities,
      masteryLevel: mineMasteryLevel,
      crewBondLevel,
      foremanFocus: foremanInfo.focus,
      foremanBonus: foremanInfo.bonus,
      roleAssignments: rolePlan.assignments,
      incentiveId: incentive.id,
      useSurveyReport
    });
    for (const miner of quote.miners) refreshMinerCondition(miner, now);
    const unavailable = quote.miners
      .map((miner) => ({ miner, readiness: minerReadiness(miner, now) }))
      .find((entry) => !entry.readiness.ok);
    if (unavailable) {
      return { ok: false, message: `${unavailable.miner.name}${unavailable.readiness.reason}，暂时不能下井。` };
    }
    const jobId = randomUUID();
    if (!spendCash(player, quote.total, `矿山开采：${mine.name} · ${strategy.label}`, {
      source: "miningShift",
      itemId: jobId,
      at: now,
      repEligible: false
    })) {
      return { ok: false, message: `本班工资与耗材共需 ¥${quote.total.toLocaleString("zh-CN")}。` };
    }
    if (useSurveyReport) mineRecordFor(playerMining, mine.id).surveyReports -= 1;
    const job = {
      id: jobId,
      status: "active",
      roundId: round.id,
      roundNumber: round.number,
      leaseId: lease.id,
      mineId: mine.id,
      mineName: mine.name,
      tuningVersionId: round.tuningVersionId || null,
      tuningOutputMultiplier,
      strategyId: strategy.id,
      strategyLabel: strategy.label,
      incentiveId: incentive.id,
      incentiveLabel: incentive.label,
      wageCost: quote.wages,
      incentivePremium: quote.incentivePremium,
      minerIds,
      conditionId: condition.id,
      conditionName: condition.name,
      preparationIds,
      preparationNames: quote.preparations.map((preparation) => preparation.name),
      preparationCost: quote.preparationCost,
      facilities: { ...playerMining.facilities },
      mineMasteryLevel,
      crewKey,
      crewBondLevel,
      foremanId: foremanInfo.minerId,
      foremanName: foremanInfo.minerName,
      foremanFocus: foremanInfo.focus,
      foremanLabel: foremanInfo.label,
      foremanBonus: foremanInfo.bonus,
      roleAssignments: { ...rolePlan.assignments },
      roleLabels: rolePlan.details.map((detail) => `${detail.label} ${detail.minerName}`),
      estimate: lockedEstimate(shiftPerformance),
      surveyReportUsed: useSurveyReport,
      startedAt: now,
      incidentAt: now + Math.max(1, Math.round(shiftDuration * MINING_INCIDENT_REVEAL_RATIO)),
      readyAt: now + shiftDuration,
      durationMs: shiftDuration,
      cost: quote.total
    };
    for (const miner of quote.miners) miner.fatigueAt = job.readyAt;
    playerMining.jobs.push(job);
    lease.shiftsStarted += 1;
    const leaseHistory = playerMining.leaseHistory.find((entry) => entry.id === lease.id);
    if (leaseHistory) leaseHistory.shiftsStarted = lease.shiftsStarted;
    return {
      ok: true,
      message: `${mine.name} 已开工，采用${incentive.label}，班前勘察为“${condition.name}”，${foremanInfo.minerName}担任${foremanInfo.label}；${rolePlan.details.map((detail) => `${detail.minerName}负责${detail.label}`).join("、")}${crewBondLevel ? `，${miningCrewBondInfo(crewBondLevel, { level: true }).name}已生效` : ""}${useSurveyReport ? "，已采用勘探成果" : ""}。`,
      job,
      fee: quote.total
    };
  }

  function resolveMiningIncident(player, jobId, choiceId, now = Date.now()) {
    const mining = normalizeMiningPlayer(player);
    const job = mining.jobs.find((entry) => entry.id === String(jobId || "") && entry.status === "active");
    if (!job) return { ok: false, message: "这条井下急报已经失效。" };
    if (!Number.isFinite(Number(job.incidentAt))) {
      return { ok: false, message: "该班次没有需要处理的井下急报。" };
    }
    if (now < Number(job.incidentAt)) {
      return { ok: false, message: "井下急报尚未传回，请稍后再处理。" };
    }
    if (now >= Number(job.readyAt)) {
      return { ok: false, message: "本班已经结束，急报将按预案自动处理。" };
    }
    const incident = revealMiningIncident(job);
    if (selectedIncidentChoice(job)) {
      return { ok: false, message: "这条井下急报已经处理，不能重复更改。" };
    }
    const choice = miningShiftIncidentChoice(incident.id, choiceId);
    if (!choice) return { ok: false, message: "请选择有效的井下处置方案。" };
    job.incidentChoiceId = choice.id;
    job.incidentResolvedAt = now;
    job.incidentAutomatic = false;
    job.estimate = lockedEstimate(shiftPerformanceForJob(player, job, choice));
    return {
      ok: true,
      message: `${incident.name}已按“${choice.label}”处理：${choice.effectLabel}。`,
      job,
      incident: { id: incident.id, name: incident.name },
      choice: { id: choice.id, label: choice.label, effectLabel: choice.effectLabel }
    };
  }

  function settleBasicMiningJob(player, job, now = Date.now(), rng = Math.random) {
    const mining = normalizeMiningPlayer(player);
    const mine = miningMineById(job.mineId);
    if (!mine) return null;
    const miners = (job.minerIds || [])
      .map((id) => mining.miners.find((entry) => entry.id === id))
      .filter(Boolean);
    const plan = miningBasicShiftPlan(mine, miners);
    const baseYieldMin = Math.max(0, Math.round(Number(job.estimate?.baseYieldMin) || plan.baseYieldMin));
    const baseYieldMax = Math.max(baseYieldMin, Math.round(Number(job.estimate?.baseYieldMax) || plan.baseYieldMax));
    const extraYieldChance = Math.max(0, Math.min(0.45,
      Number(job.estimate?.extraYieldChance ?? plan.extraYieldChance) || 0
    ));
    const accidentChance = Math.max(0.03, Math.min(0.25,
      Number(job.estimate?.risk ?? plan.risk) || 0.03
    ));
    const spread = baseYieldMax - baseYieldMin + 1;
    let count = baseYieldMin + Math.floor(Math.min(0.999999, Math.max(0, rng())) * spread);
    if (rng() < extraYieldChance) count += 1;
    const accident = rng() < accidentChance;
    if (accident) count = Math.max(0, count - 1);
    count = tunedMiningOutputCount(count, job.tuningOutputMultiplier, rng);
    const roughs = [];
    for (let index = 0; index < count; index += 1) {
      const qualityIndex = pickWeightedIndex(mine.weights, rng);
      const mass = Math.min(3.5, mine.massMin + rng() * (mine.massMax - mine.massMin));
      const confidence = Math.max(0.08, Math.min(0.96, rng() + mine.confidenceBonus));
      const rough = makeRoughStone({
        qualityKey: MINING_QUALITY_KEYS[qualityIndex],
        mass: Math.round(mass * 10) / 10,
        confidence,
        rng
      });
      rough.type = "rough";
      rough.owner = player.id;
      rough.revealed = false;
      rough.polished = false;
      rough.materialStage = "rough";
      rough.source = "mining";
      rough.imperialChanceMultiplier = mine.imperialMultiplier;
      rough.miningOrigin = {
        mode: "basic",
        mineId: mine.id,
        mineName: mine.name,
        beltLabel: mine.beltLabel,
        mineGradeId: job.mineGradeId || plan.mineProfile.id,
        mineGradeName: job.mineGradeName || plan.mineProfile.name,
        roundId: job.roundId,
        miningPower: Math.max(0, Number(job.miningPower) || plan.miningPower),
        crewNames: miners.map((miner) => miner.name),
        minedAt: now
      };
      roughs.push(markInventoryItemNew(rough));
    }
    distributeItemCost({ costBasis: {
      amount: Math.max(0, Math.round(Number(job.cost) || 0)),
      complete: job.cost != null && Number.isFinite(Number(job.cost))
    } }, roughs);
    player.rough.push(...roughs);
    for (const miner of miners) {
      miner.shiftsWorked = Math.max(0, Math.round(Number(miner.shiftsWorked) || 0)) + 1;
    }
    mining.stats.shifts += 1;
    mining.stats.roughs += roughs.length;
    if (accident) mining.stats.accidents += 1;
    const totalMass = Math.round(roughs.reduce((sum, rough) => sum + (Number(rough.mass) || 0), 0) * 10) / 10;
    mining.stats.totalMass = Math.round((mining.stats.totalMass + totalMass) * 10) / 10;
    mining.stats.spent += Math.max(0, Math.round(Number(job.cost) || 0));
    const mineRecord = mineRecordFor(mining, mine.id);
    mineRecord.shifts += 1;
    mineRecord.roughs += roughs.length;
    if (accident) mineRecord.accidents += 1;
    mineRecord.totalMass = Math.round((mineRecord.totalMass + totalMass) * 10) / 10;
    mineRecord.lastMinedAt = now;
    const result = {
      id: job.id,
      mode: "basic",
      roundId: job.roundId,
      roundNumber: job.roundNumber,
      leaseId: job.leaseId,
      mineId: mine.id,
      mineName: mine.name,
      tuningVersionId: job.tuningVersionId || null,
      tuningOutputMultiplier: normalizedTuningMultiplier(job.tuningOutputMultiplier),
      mineGradeId: job.mineGradeId || plan.mineProfile.id,
      mineGradeName: job.mineGradeName || plan.mineProfile.name,
      completedAt: now,
      roughCount: roughs.length,
      totalMass,
      miningPower: Math.max(0, Number(job.miningPower) || plan.miningPower),
      extraYieldChance,
      accident,
      accidentChance,
      cost: Math.max(0, Math.round(Number(job.cost) || 0)),
      wageCost: Math.max(0, Math.round(Number(job.wageCost) || 0)),
      minerNames: miners.map((miner) => miner.name),
      note: accident
        ? `${miners.map((miner) => miner.name).join("、")}完成基础开采，途中发生局部塌方减产，运回 ${roughs.length} 块原石。`
        : `${miners.map((miner) => miner.name).join("、")}完成基础开采，运回 ${roughs.length} 块原石。`,
      minerConditions: [],
      minerMorales: [],
      minerRetentionEvents: [],
      mentorshipEvents: [],
      minerContracts: [],
      roleAssignments: {},
      roleLabels: [],
      crewSpecializations: [],
      preparationIds: [],
      preparationNames: [],
      preparationCost: 0,
      incentivePremium: 0,
      facilities: {}
    };
    mining.history.unshift(result);
    mining.history = mining.history.slice(0, 20);
    recordWorldMiningEconomyShift(player, result, job);
    return result;
  }

  function settleMiningJob(player, job, now = Date.now(), rng = Math.random) {
    if (job?.mode === "basic") return settleBasicMiningJob(player, job, now, rng);
    const mining = normalizeMiningPlayer(player);
    const mine = miningMineById(job.mineId);
    if (!mine) return null;
    const strategy = miningStrategyById(job.strategyId);
    const condition = miningSiteConditionById(job.conditionId);
    const preparationEffects = miningPreparationEffects(job.preparationIds, condition.id);
    const miners = (job.minerIds || [])
      .map((id) => mining.miners.find((entry) => entry.id === id))
      .filter(Boolean);
    const facilities = job.facilities && typeof job.facilities === "object"
      ? job.facilities
      : mining.facilities;
    const mineRecord = mining.mineRecords[mine.id] || null;
    const mastery = job.mineMasteryLevel == null
      ? miningMineMasteryInfo(mineRecord)
      : miningMineMasteryInfo(job.mineMasteryLevel, { level: true });
    const surveyReport = job.surveyReportUsed ? MINING_SURVEY_REPORT : null;
    const crewKey = job.crewKey || miningCrewKey(job.minerIds);
    const crewBond = job.crewBondLevel == null
      ? miningCrewBondInfo(mining.crewRecords[crewKey])
      : miningCrewBondInfo(job.crewBondLevel, { level: true });
    const foreman = job.foremanId
      ? miners.find((miner) => miner.id === job.foremanId) || null
      : null;
    const currentForemanInfo = miningForemanInfo(foreman);
    const foremanFocus = currentForemanInfo && ["prospecting", "extraction", "safety"].includes(job.foremanFocus)
      ? job.foremanFocus
      : currentForemanInfo?.focus || "";
    const foremanBonus = currentForemanInfo
      ? Math.max(0, Math.min(MINING_FOREMAN_BONUS, Number(job.foremanBonus) || MINING_FOREMAN_BONUS))
      : 0;
    const foremanLabel = job.foremanLabel || currentForemanInfo?.label || "";
    const roleDetails = miningRoleAssignmentDetails(job.roleAssignments, miners)
      .filter((detail, index, rows) => rows.findIndex((row) => row.minerId === detail.minerId) === index);
    const incident = Number.isFinite(Number(job.incidentAt)) ? revealMiningIncident(job) : null;
    const incidentChoice = incident
      ? selectedIncidentChoice(job) || autoResolveMiningIncident(job, now)
      : null;
    const performance = miningShiftPerformance({
      mine,
      miners,
      strategyId: strategy.id,
      conditionId: condition.id,
      preparationIds: job.preparationIds,
      facilities,
      masteryLevel: mastery.level,
      crewBondLevel: crewBond.level,
      foremanFocus,
      foremanBonus,
      roleAssignments: job.roleAssignments,
      incentiveId: job.incentiveId,
      useSurveyReport: Boolean(surveyReport),
      incidentChoice
    });
    const prospecting = performance.prospecting;
    const extraction = performance.extraction;
    const extractionBonus = performance.extraYieldChance;
    const crewSpecializations = miners.flatMap((miner) => {
      const specialization = miningMinerSpecializationInfo(miner);
      return specialization ? [`${miner.name} · ${specialization.name}`] : [];
    });
    let count = performance.baseYieldMin
      + Math.floor(rng() * (performance.baseYieldMax - performance.baseYieldMin + 1));
    count = Math.max(0, count + (rng() < extractionBonus ? 1 : 0));
    const accidentChance = performance.risk;
    const accident = rng() < accidentChance;
    if (accident) count = Math.max(0, count - 1);
    count = tunedMiningOutputCount(count, job.tuningOutputMultiplier, rng);
    const weights = shiftedQualityWeights(mine, strategy, condition);
    const roughs = [];
    for (let index = 0; index < count; index += 1) {
      let qualityIndex = pickWeightedIndex(weights, rng);
      const upgradeChance = performance.upgradeChance;
      if (qualityIndex < MINING_QUALITY_KEYS.length - 1 && rng() < upgradeChance) qualityIndex += 1;
      const massBoost = 1 + Math.max(0, extraction - 1) * 0.012;
      const mass = Math.min(
        3.5,
        (mine.massMin + rng() * (mine.massMax - mine.massMin))
          * massBoost
          * (Number(condition.massMultiplier) || 1)
      );
      const confidence = Math.max(0.08, Math.min(0.96, rng() + mine.confidenceBonus + (prospecting - 1) * 0.012));
      const rough = makeRoughStone({
        qualityKey: MINING_QUALITY_KEYS[qualityIndex],
        mass: Math.round(mass * 10) / 10,
        confidence,
        rng
      });
      rough.type = "rough";
      rough.owner = player.id;
      rough.revealed = false;
      rough.polished = false;
      rough.materialStage = "rough";
      rough.source = "mining";
      rough.imperialChanceMultiplier = mine.imperialMultiplier;
      rough.miningOrigin = {
        mineId: mine.id,
        mineName: mine.name,
        beltLabel: mine.beltLabel,
        roundId: job.roundId,
        conditionId: condition.id,
        conditionName: condition.name,
        strategyLabel: strategy.label,
        incentiveLabel: miningShiftIncentiveById(job.incentiveId).label,
        mineMasteryLevel: mastery.level,
        crewBondLevel: crewBond.level,
        crewNames: miners.map((miner) => miner.name),
        foremanId: foreman?.id || null,
        foremanName: foreman?.name || null,
        foremanFocus: foremanFocus || null,
        foremanLabel: foremanLabel || null,
        foremanBonus,
        roleLabels: roleDetails.map((detail) => `${detail.label} ${detail.minerName}`),
        crewSpecializations,
        incidentName: incident?.name || null,
        incidentChoiceLabel: incidentChoice?.label || null,
        incidentEffectLabel: incidentChoice?.effectLabel || null,
        surveyReportUsed: Boolean(surveyReport),
        minedAt: now
      };
      roughs.push(markInventoryItemNew(rough));
    }
    distributeItemCost({ costBasis: {
      amount: Math.max(0, Math.round(Number(job.cost) || 0)),
      complete: job.cost != null && Number.isFinite(Number(job.cost))
    } }, roughs);
    player.rough.push(...roughs);
    const injuredMiner = accident && miners.length
      ? miners[Math.min(miners.length - 1, Math.floor(unitHash(`${job.id}:injury`) * miners.length))]
      : null;
    const incentive = miningShiftIncentiveById(job.incentiveId);
    const minerConditions = miners.map((miner) => {
      const conditionResult = applyMinerShiftCondition(miner, strategy.id, job.readyAt, now, {
        injured: miner.id === injuredMiner?.id,
        fatigueDelta: crewBond.fatigueDelta + incentive.fatigueDelta
      });
      const moraleResult = applyMinerShiftMorale(miner, {
        strategyId: strategy.id,
        incentiveId: incentive.id,
        accident,
        injured: miner.id === injuredMiner?.id
      });
      return {
        minerId: miner.id,
        name: miner.name,
        ...conditionResult,
        ...moraleResult
      };
    });
    const mentorshipEvents = applyMinerMentorshipsForShift(
      player,
      miners.map((miner) => miner.id),
      job.roleAssignments,
      job.readyAt
    );
    for (const entry of minerConditions) {
      const miner = miners.find((candidate) => candidate.id === entry.minerId);
      const moraleAfter = miningMinerMoraleInfo(miner);
      entry.moraleAfter = moraleAfter.morale;
      entry.moraleDelta = moraleAfter.morale - entry.moraleBefore;
      entry.moraleLabel = moraleAfter.name;
      const retentionResult = applyMinerRetentionAfterShift(miner, job.readyAt, {
        injured: miner.id === injuredMiner?.id
      });
      entry.retention = retentionResult;
      if (retentionResult.created && retentionResult.type === "leave") mining.stats.personalLeaves += 1;
      if (retentionResult.created && retentionResult.type === "resignation") mining.stats.retentionCases += 1;
    }
    for (const miner of miners) {
      grantMiningExperience(miner, strategy.id);
      recordMinerShift(miner);
    }
    const minerContracts = miners.map((miner) => ({
      minerId: miner.id,
      minerName: miner.name,
      remaining: miningMinerContractInfo(miner).remaining
    }));
    const roleProgress = roleDetails.map((detail) => ({
      ...detail,
      progress: grantMiningRoleExperience(
        miners.find((miner) => miner.id === detail.minerId),
        detail.key,
        MINING_ROLE_EXPERIENCE
      )
    }));
    mining.stats.shifts += 1;
    mining.stats.roughs += roughs.length;
    const totalMass = Math.round(roughs.reduce((sum, rough) => sum + (Number(rough.mass) || 0), 0) * 10) / 10;
    mining.stats.totalMass = Math.round((mining.stats.totalMass + totalMass) * 10) / 10;
    mining.stats.spent += Math.max(0, Math.round(Number(job.cost) || 0));
    mining.stats.preparationSpent += Math.max(0, Math.round(Number(job.preparationCost) || 0));
    mining.stats.incentiveSpent += Math.max(0, Math.round(Number(job.incentivePremium) || 0));
    if (accident) mining.stats.accidents += 1;
    const crewRecord = mining.crewRecords[crewKey] || {
      shifts: 0,
      minerIds: [...(job.minerIds || [])].map(String).sort((left, right) => left.localeCompare(right)),
      minerNames: miners.map((miner) => miner.name),
      lastWorkedAt: null
    };
    crewRecord.shifts += 1;
    crewRecord.minerIds = [...(job.minerIds || [])].map(String).sort((left, right) => left.localeCompare(right));
    crewRecord.minerNames = miners.map((miner) => miner.name);
    crewRecord.lastWorkedAt = now;
    mining.crewRecords[crewKey] = crewRecord;
    const crewBondAfter = miningCrewBondLevel(crewRecord);
    const crewBondLeveled = crewBondAfter > crewBond.level;
    const updatedMineRecord = mineRecordFor(mining, mine.id);
    updatedMineRecord.shifts += 1;
    updatedMineRecord.roughs += roughs.length;
    updatedMineRecord.totalMass = Math.round((updatedMineRecord.totalMass + totalMass) * 10) / 10;
    if (accident) updatedMineRecord.accidents += 1;
    updatedMineRecord.lastMinedAt = now;
    updatedMineRecord.lastConditionId = condition.id;
    const clueGain = performance.clueGain;
    let nextClueProgress = updatedMineRecord.clueProgress + clueGain;
    let surveyReportsCreated = 0;
    while (nextClueProgress >= MINING_CLUE_TARGET && updatedMineRecord.surveyReports < MINING_MAX_SURVEY_REPORTS) {
      nextClueProgress -= MINING_CLUE_TARGET;
      updatedMineRecord.surveyReports += 1;
      updatedMineRecord.reportsCompleted += 1;
      surveyReportsCreated += 1;
    }
    updatedMineRecord.clueProgress = Math.max(0, Math.min(MINING_CLUE_TARGET - 1, nextClueProgress));
    const masteryAfter = miningMineMasteryLevel(updatedMineRecord);
    const masteryLeveled = masteryAfter > mastery.level;
    const baseNote = accident
      ? `${condition.name}环境下发生局部塌方，损失了一部分出料${injuredMiner ? `，${injuredMiner.name}需要伤停休养` : ""}。`
      : roughs.length >= mine.yieldMax
        ? `${condition.name}环境下出料顺利，矿工判断当前掌子面仍有继续开采价值。`
        : `${condition.name}环境下作业平稳，未发现需要停工处理的异常。`;
    const note = [
      baseNote,
      incident && incidentChoice
        ? `${incident.name}按“${incidentChoice.label}”处理${job.incidentAutomatic ? "（自动预案）" : ""}。`
        : "",
      masteryLeveled ? `${mine.name}勘探档案提升至“${miningMineMasteryInfo(masteryAfter, { level: true }).name}”。` : "",
      crewBondLeveled ? `${miners.map((miner) => miner.name).join("、")}形成“${miningCrewBondInfo(crewBondAfter, { level: true }).name}”默契。` : "",
      surveyReportsCreated ? `矿脉线索已经整理成 ${surveyReportsCreated} 份勘探成果。` : "",
      minerConditions.some((entry) => entry.moraleBeforeLabel !== entry.moraleLabel)
        ? `班组士气状态更新为${minerConditions.map((entry) => `${entry.name}“${entry.moraleLabel}”`).join("、")}。`
        : "",
      ...mentorshipEvents.map((event) => event.completed
        ? `${event.mentorName}完成对${event.apprenticeName}的带教，学徒岗位经验与双方士气获得结业奖励。`
        : `${event.mentorName}与${event.apprenticeName}完成第 ${event.sharedShifts}/${MINER_MENTORSHIP_REQUIRED_SHIFTS} 次同班带教。`),
      ...minerConditions.map((entry) => entry.retention?.created && entry.retention.type === "resignation"
        ? `${entry.name}因士气跌至 ${entry.moraleAfter} 提出离职申请，已暂停排班并等待留任处理。`
        : entry.retention?.created && entry.retention.type === "leave"
          ? `${entry.name}因士气偏低开始 4 小时个人请假。`
          : "")
    ].filter(Boolean).join(" ");
    const result = {
      id: job.id,
      roundId: job.roundId,
      roundNumber: job.roundNumber,
      leaseId: job.leaseId,
      mineId: mine.id,
      mineName: mine.name,
      tuningVersionId: job.tuningVersionId || null,
      tuningOutputMultiplier: normalizedTuningMultiplier(job.tuningOutputMultiplier),
      strategyId: strategy.id,
      incentiveId: incentive.id,
      incentiveLabel: incentive.label,
      conditionId: condition.id,
      conditionName: condition.name,
      completedAt: now,
      roughCount: roughs.length,
      totalMass,
      accident,
      accidentChance: Math.round(accidentChance * 1000) / 1000,
      injuredMinerName: injuredMiner?.name || null,
      mineMasteryBefore: mastery.level,
      mineMasteryAfter: masteryAfter,
      mineMasteryLeveled: masteryLeveled,
      crewKey,
      crewBondBefore: crewBond.level,
      crewBondAfter,
      crewBondLeveled,
      foremanId: foreman?.id || null,
      foremanName: foreman?.name || null,
      foremanFocus: foremanFocus || null,
      foremanLabel: foremanLabel || null,
      foremanBonus,
      roleAssignments: Object.fromEntries(roleDetails.map((detail) => [detail.key, detail.minerId])),
      roleLabels: roleDetails.map((detail) => `${detail.label} ${detail.minerName}`),
      crewSpecializations,
      roleProgress,
      incidentId: incident?.id || null,
      incidentName: incident?.name || null,
      incidentChoiceId: incidentChoice?.id || null,
      incidentChoiceLabel: incidentChoice?.label || null,
      incidentEffectLabel: incidentChoice?.effectLabel || null,
      incidentAutomatic: Boolean(incident && job.incidentAutomatic),
      clueGain,
      clueProgressAfter: updatedMineRecord.clueProgress,
      surveyReportUsed: Boolean(surveyReport),
      surveyReportsCreated,
      surveyReportsAvailable: updatedMineRecord.surveyReports,
      note,
      cost: job.cost,
      wageCost: Math.max(0, Math.round(Number(job.wageCost) || 0)),
      incentivePremium: Math.max(0, Math.round(Number(job.incentivePremium) || 0)),
      preparationCost: job.preparationCost || 0,
      preparationIds: [...(job.preparationIds || [])],
      preparationNames: preparationEffects.preparations.map((preparation) => preparation.name),
      facilities: { ...facilities },
      minerNames: miners.map((miner) => miner.name),
      minerConditions,
      minerMorales: minerConditions.map((entry) => ({
        minerId: entry.minerId,
        minerName: entry.name,
        before: entry.moraleBefore,
        after: entry.moraleAfter,
        delta: entry.moraleDelta,
        label: entry.moraleLabel
      })),
      minerRetentionEvents: minerConditions
        .filter((entry) => entry.retention?.created)
        .map((entry) => ({
          minerId: entry.minerId,
          minerName: entry.name,
          type: entry.retention.type,
          morale: entry.moraleAfter,
          leaveUntil: entry.retention.leaveUntil || null
        })),
      mentorshipEvents,
      minerContracts
    };
    mining.history.unshift(result);
    mining.history = mining.history.slice(0, 20);
    recordWorldMiningEconomyShift(player, result, job);
    return result;
  }

  function miningJobSettlementFailure(player, job) {
    const leaseContext = miningJobLeaseContext(player, job);
    if (!leaseContext) {
      return { reason: "invalid_mining_job_lease", label: "矿权关联异常" };
    }
    if (String(leaseContext.lease?.mineId || "") !== String(job?.mineId || "")) {
      return { reason: "invalid_mining_job_lease", label: "矿权关联异常" };
    }
    const mine = miningMineById(leaseContext.lease.mineId);
    if (!mine) {
      return { reason: "invalid_mining_job", label: "矿山资料异常" };
    }
    const mining = normalizeMiningPlayer(player);
    const minerIds = Array.isArray(job?.minerIds) ? job.minerIds.map(String) : [];
    const ownedMinerIds = new Set(mining.miners.map((miner) => String(miner.id)));
    const expectedCrew = job?.mode === "basic"
      ? { min: MINING_BASIC_MIN_CREW, max: MINING_BASIC_MAX_CREW }
      : { min: mine.crewRequired, max: mine.crewRequired };
    if (
      minerIds.length < expectedCrew.min
      || minerIds.length > expectedCrew.max
      || new Set(minerIds).size !== minerIds.length
      || minerIds.some((minerId) => !ownedMinerIds.has(minerId))
    ) {
      return { reason: "invalid_mining_job_crew", label: "班组资料异常" };
    }
    return null;
  }

  function miningJobLeaseContext(player, job) {
    const state = getState();
    const worldMining = state?.mining && typeof state.mining === "object" ? state.mining : {};
    const rounds = [worldMining.currentRound, ...(Array.isArray(worldMining.history) ? worldMining.history : [])]
      .filter(Boolean);
    const playerId = String(player?.id || "");
    const leaseId = String(job?.leaseId || "");
    if (leaseId) {
      for (const round of rounds) {
        const lease = (Array.isArray(round?.leases) ? round.leases : []).find((entry) => (
          String(entry?.id || "") === leaseId
          && String(entry?.playerId || "") === playerId
        ));
        if (lease) return { round, lease };
      }
    }
    const roundId = String(job?.roundId || "");
    const roundNumber = Math.round(Number(job?.roundNumber) || 0);
    const round = rounds.find((entry) => (
      (roundId && String(entry?.id || "") === roundId)
      || (roundNumber > 0 && Number(entry?.number) === roundNumber)
    ));
    if (!round) return null;
    const lease = (Array.isArray(round.leases) ? round.leases : [])
      .find((entry) => String(entry?.playerId || "") === playerId);
    return lease ? { round, lease } : null;
  }

  function reconcileMiningJobLease(player, job) {
    const context = miningJobLeaseContext(player, job);
    const mine = miningMineById(context?.lease?.mineId);
    if (!context || !mine) return false;
    const canonical = {
      leaseId: context.lease.id,
      roundId: context.round.id,
      roundNumber: context.round.number,
      mineId: mine.id,
      mineName: mine.name
    };
    if (job?.mode === "basic") {
      const profile = miningBasicMineProfile(mine);
      canonical.mineGradeId = profile.id;
      canonical.mineGradeName = profile.name;
    }
    let changed = false;
    for (const [key, value] of Object.entries(canonical)) {
      if (job[key] === value) continue;
      job[key] = value;
      changed = true;
    }
    return changed;
  }

  function rollbackMiningLeaseShift(player, job) {
    const leaseId = String(job?.leaseId || "");
    if (!leaseId) return false;
    const worldLease = miningJobLeaseContext(player, job)?.lease || null;
    const playerMining = normalizeMiningPlayer(player);
    const playerLease = playerMining.leaseHistory.find((lease) => String(lease?.id || "") === leaseId);
    const sourceCount = Math.max(0, Math.round(Number(worldLease?.shiftsStarted ?? playerLease?.shiftsStarted) || 0));
    if (sourceCount <= 0) return false;
    const restoredCount = sourceCount - 1;
    if (worldLease) worldLease.shiftsStarted = restoredCount;
    if (playerLease) playerLease.shiftsStarted = restoredCount;
    return true;
  }

  function miningShiftExactLedgerAmount(player, job) {
    const jobId = String(job?.id || "");
    const expenses = (Array.isArray(player?.ledger) ? player.ledger : []).filter((candidate) => (
      candidate?.source === "miningShift" && Number(candidate?.amount) < 0
    ));
    const entry = jobId
      ? expenses.find((candidate) => String(candidate?.itemId || "") === jobId)
      : null;
    const amount = Math.round(Math.abs(Number(entry?.amount)));
    return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
  }

  function miningShiftLedgerAmount(player, job) {
    const exactAmount = miningShiftExactLedgerAmount(player, job);
    if (exactAmount != null) return exactAmount;
    const leaseId = String(job?.leaseId || "");
    const expenses = (Array.isArray(player?.ledger) ? player.ledger : []).filter((candidate) => (
      candidate?.source === "miningShift" && Number(candidate?.amount) < 0
    ));
    const entry = leaseId
      ? expenses.find((candidate) => String(candidate?.itemId || "") === leaseId)
      : null;
    const amount = Math.round(Math.abs(Number(entry?.amount)));
    return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
  }

  function repairMiningJobCost(player, job) {
    const paidCost = miningShiftLedgerAmount(player, job);
    if (paidCost == null) return false;
    let changed = false;
    if (Number(job?.cost) !== paidCost) {
      job.cost = paidCost;
      changed = true;
    }
    if (job?.mode === "basic") {
      if (Number(job.wageCost) !== paidCost) {
        job.wageCost = paidCost;
        changed = true;
      }
      for (const key of ["preparationCost", "incentivePremium"]) {
        if (Number(job[key]) === 0) continue;
        job[key] = 0;
        changed = true;
      }
      return changed;
    }
    for (const key of ["wageCost", "preparationCost", "incentivePremium"]) {
      const raw = Number(job?.[key]);
      const repaired = Number.isSafeInteger(Math.round(raw)) && raw >= 0
        ? Math.min(paidCost, Math.round(raw))
        : 0;
      if (Number(job?.[key]) === repaired) continue;
      job[key] = repaired;
      changed = true;
    }
    return changed;
  }

  function miningJobRefundAmount(player, job) {
    const ledgerAmount = miningShiftLedgerAmount(player, job);
    if (ledgerAmount != null) return { amount: ledgerAmount, basis: "ledger" };
    const lockedCost = Math.round(Number(job?.cost));
    const amount = Number.isSafeInteger(lockedCost) && lockedCost > 0
      ? Math.min(lockedCost, MINING_SHIFT_REFUND_FALLBACK_CAP)
      : 0;
    return { amount, basis: "locked_cost" };
  }

  function refundUnsettleableMiningJob(player, job, now = Date.now(), failure = null, options = {}) {
    const mining = normalizeMiningPlayer(player);
    const minerIds = Array.isArray(job?.minerIds) ? job.minerIds : [];
    const preparationIds = Array.isArray(job?.preparationIds) ? job.preparationIds : [];
    const preparationNames = Array.isArray(job?.preparationNames) ? job.preparationNames : [];
    const existing = mining.history.find((entry) => (
      String(entry?.id || "") === String(job?.id || "")
      && entry?.status === "refunded"
    ));
    if (existing) return { result: existing, alreadyRecorded: true };
    const settlementFailure = failure || { reason: "invalid_mining_job", label: "任务资料异常" };
    const overrideRefund = Math.round(Number(options.refundAmount));
    const refundQuote = Number.isSafeInteger(overrideRefund) && overrideRefund > 0
      ? { amount: overrideRefund, basis: String(options.refundBasis || "verified_debit") }
      : miningJobRefundAmount(player, job);
    const refund = refundQuote.amount;
    if (refund > 0) {
      releaseDeposit(player, refund, "采矿任务无法结算，退回本班工资与耗材", {
        source: "miningShiftRefund",
        itemId: String(job?.id || "invalid-mining-job"),
        repEligible: false
      });
    }
    const shiftSlotRestored = rollbackMiningLeaseShift(player, job);
    const result = {
      id: String(job?.id || randomUUID()),
      mode: job?.mode === "basic" ? "basic" : "advanced",
      status: "refunded",
      failureReason: settlementFailure.reason,
      roundId: job?.roundId || null,
      roundNumber: Math.max(0, Math.round(Number(job?.roundNumber) || 0)),
      leaseId: job?.leaseId || null,
      mineId: String(job?.mineId || ""),
      mineName: String(job?.mineName || "未知矿山"),
      mineGradeId: job?.mineGradeId || null,
      mineGradeName: job?.mineGradeName || null,
      completedAt: now,
      roughCount: 0,
      totalMass: 0,
      accident: false,
      cost: refund,
      wageCost: Math.min(refund, money(job?.wageCost ?? refund)),
      preparationCost: Math.min(refund, money(job?.preparationCost || 0)),
      incentivePremium: Math.min(refund, money(job?.incentivePremium || 0)),
      refund,
      refundBasis: refundQuote.basis,
      shiftSlotRestored,
      minerNames: minerIds.map((minerId) => (
        mining.miners.find((miner) => String(miner.id) === String(minerId))?.name
      )).filter(Boolean),
      note: refund > 0
        ? `${settlementFailure.label}，未生成任何原石；本班已支付的 ${refund.toLocaleString("zh-CN")} 元已全额退回${shiftSlotRestored ? "，租期班次占用已撤销" : ""}。`
        : `${settlementFailure.label}，未生成任何原石；该任务没有可退费用${shiftSlotRestored ? "，租期班次占用已撤销" : ""}。`,
      minerConditions: [],
      minerMorales: [],
      minerRetentionEvents: [],
      mentorshipEvents: [],
      minerContracts: [],
      roleAssignments: {},
      roleLabels: [],
      crewSpecializations: [],
      preparationIds: [...preparationIds],
      preparationNames: [...preparationNames],
      facilities: job?.facilities && typeof job.facilities === "object" && !Array.isArray(job.facilities)
        ? { ...job.facilities }
        : {}
    };
    mining.history.unshift(result);
    mining.history = mining.history.slice(0, 20);
    return { result, alreadyRecorded: false };
  }

  function processMiningJobs(now = Date.now(), options = {}) {
    const state = getState();
    const results = [];
    let incidentsRevealed = 0;
    let recoveredTimings = 0;
    let recoveredCosts = 0;
    let recoveredLeaseLinks = 0;
    let refundedJobs = 0;
    let deduplicatedJobs = 0;
    let recoveredConcurrentJobs = 0;
    let prunedJobs = 0;
    for (const player of playersMatching(state.players, (entry) => Boolean(entry.mining?.jobs?.length))) {
      normalizePlayer(player);
      const mining = normalizeMiningPlayer(player);
      const activeJobs = mining.jobs.filter((job) => job?.status === "active");
      if (activeJobs.length !== mining.jobs.length) {
        prunedJobs += mining.jobs.length - activeJobs.length;
        mining.jobs = activeJobs;
      }
      for (const job of mining.jobs) {
        if (job?.status === "active") {
          if (reconcileMiningJobLease(player, job)) recoveredLeaseLinks += 1;
          if (repairMiningJobCost(player, job)) recoveredCosts += 1;
          const startedAt = Number(job.startedAt);
          const durationMs = Number(job.durationMs);
          const readyAt = Number(job.readyAt);
          const finiteStartedAt = Number.isFinite(startedAt) && startedAt > 0;
          const futureStartedAt = finiteStartedAt && startedAt > now;
          const validStartedAt = Number.isFinite(startedAt) && startedAt > 0 && startedAt <= now;
          const validDuration = Number.isFinite(durationMs) && durationMs > 0 && durationMs <= config.leaseMs;
          const rebuiltReadyAt = startedAt + durationMs;
          const canRebuild = validStartedAt && validDuration && Number.isFinite(rebuiltReadyAt);
          const readyMatchesLockedDuration = canRebuild && readyAt === rebuiltReadyAt;
          const canInferDuration = validStartedAt
            && Number.isFinite(readyAt)
            && readyAt > startedAt
            && readyAt - startedAt <= config.leaseMs;
          const resetFromNow = (recoveredDuration) => {
            const incidentAt = Number(job.incidentAt);
            const incidentOffset = Number.isFinite(incidentAt) && incidentAt > startedAt && incidentAt < readyAt
              ? incidentAt - startedAt
              : null;
            job.startedAt = now;
            job.durationMs = recoveredDuration;
            job.readyAt = now + recoveredDuration;
            if (Number.isFinite(incidentAt) || job.mode !== "basic") {
              job.incidentAt = now + (
                incidentOffset && incidentOffset < recoveredDuration
                  ? incidentOffset
                  : Math.max(1, Math.round(recoveredDuration * MINING_INCIDENT_REVEAL_RATIO))
              );
            }
          };
          if (futureStartedAt && validDuration) {
            resetFromNow(durationMs);
            recoveredTimings += 1;
          } else if (canRebuild && !readyMatchesLockedDuration) {
            job.readyAt = rebuiltReadyAt;
            recoveredTimings += 1;
          } else if (!validDuration && canInferDuration) {
            job.durationMs = readyAt - startedAt;
            recoveredTimings += 1;
          } else if (!readyMatchesLockedDuration && !canInferDuration) {
            const fallbackDuration = Math.max(1, Math.min(
              config.leaseMs,
              config.basicMode ? config.shiftMs : miningShiftDurationForPlayer(player)
            ));
            resetFromNow(fallbackDuration);
            recoveredTimings += 1;
          }
        }
        if (
          job.status === "active"
          && Number.isFinite(Number(job.incidentAt))
          && now >= Number(job.incidentAt)
          && !miningShiftIncidentById(job.incidentId)
        ) {
          revealMiningIncident(job);
          incidentsRevealed += 1;
        }
      }
      const seenActiveIds = new Set();
      for (const job of [...mining.jobs]) {
        const jobId = String(job?.id || "");
        if (!jobId || !seenActiveIds.has(jobId)) {
          if (jobId) seenActiveIds.add(jobId);
          continue;
        }
        mining.jobs = mining.jobs.filter((entry) => entry !== job);
        deduplicatedJobs += 1;
      }
      const concurrentJobs = mining.jobs
        .filter((job) => job?.status === "active")
        .map((job) => {
          const exactDebit = miningShiftExactLedgerAmount(player, job);
          const legacyDebit = exactDebit == null ? miningShiftLedgerAmount(player, job) : exactDebit;
          const paymentRank = exactDebit != null ? 0 : legacyDebit != null ? 2 : 4;
          const validityRank = miningJobSettlementFailure(player, job) ? 1 : 0;
          return { job, retentionRank: paymentRank + validityRank };
        })
        .sort((left, right) => (
          left.retentionRank - right.retentionRank
          || (Number(left.job?.startedAt) || Number.MAX_SAFE_INTEGER)
            - (Number(right.job?.startedAt) || Number.MAX_SAFE_INTEGER)
          || String(left.job?.id || "").localeCompare(String(right.job?.id || ""))
        ))
        .map((entry) => entry.job);
      for (const extraJob of concurrentJobs.slice(1)) {
        const priorResult = mining.history.find((entry) => (
          String(entry?.id || "") && String(entry.id) === String(extraJob?.id || "")
        ));
        mining.jobs = mining.jobs.filter((entry) => entry !== extraJob);
        if (priorResult) {
          deduplicatedJobs += 1;
          continue;
        }
        const verifiedDebit = miningShiftExactLedgerAmount(player, extraJob);
        if (verifiedDebit == null) {
          prunedJobs += 1;
          recoveredConcurrentJobs += 1;
          continue;
        }
        const recovery = refundUnsettleableMiningJob(player, extraJob, now, {
          reason: "concurrent_mining_job",
          label: "检测到重复进行中的开采任务"
        }, {
          refundAmount: verifiedDebit,
          refundBasis: "verified_debit"
        });
        results.push({ playerId: player.id, ...recovery.result });
        if (!recovery.alreadyRecorded) refundedJobs += 1;
        recoveredConcurrentJobs += 1;
      }
      const ready = mining.jobs.filter((job) => job.status === "active" && Number(job.readyAt) <= now);
      if (!ready.length) continue;
      for (const job of ready) {
        const priorResult = mining.history.find((entry) => (
          String(entry?.id || "") && String(entry.id) === String(job?.id || "")
        ));
        if (priorResult) {
          if (priorResult.status === "refunded" && priorResult.shiftSlotRestored !== true) {
            priorResult.shiftSlotRestored = rollbackMiningLeaseShift(player, job);
          }
          mining.jobs = mining.jobs.filter((entry) => entry !== job);
          deduplicatedJobs += 1;
          continue;
        }
        const settlementFailure = miningJobSettlementFailure(player, job);
        let result = settlementFailure
          ? null
          : settleMiningJob(player, job, now, options.rng || Math.random);
        if (!result) {
          const recovery = refundUnsettleableMiningJob(player, job, now, settlementFailure);
          result = recovery.result;
          if (!recovery.alreadyRecorded) refundedJobs += 1;
        }
        mining.jobs = mining.jobs.filter((entry) => entry !== job);
        results.push({ playerId: player.id, ...result });
        if (result.status === "refunded") continue;
        const resignationNames = (result.minerRetentionEvents || [])
          .filter((event) => event.type === "resignation")
          .map((event) => event.minerName);
        const leaveNames = (result.minerRetentionEvents || [])
          .filter((event) => event.type === "leave")
          .map((event) => event.minerName);
        const mentorshipGraduates = (result.mentorshipEvents || [])
          .filter((event) => event.completed)
          .map((event) => event.apprenticeName);
        addNews(
          `${player.name} 在${result.mineName}完成一班开采，运回 ${result.roughCount} 块原石${result.accident ? `，途中发生塌方减产${result.injuredMinerName ? `，${result.injuredMinerName}伤停` : ""}` : ""}${result.mineMasteryLeveled ? `，该矿勘探档案提升至 Lv.${result.mineMasteryAfter}` : ""}${result.crewBondLeveled ? `，班组默契提升至 Lv.${result.crewBondAfter}` : ""}${result.surveyReportsCreated ? `，并整理出 ${result.surveyReportsCreated} 份矿脉勘探成果` : ""}${mentorshipGraduates.length ? `，${mentorshipGraduates.join("、")}完成师徒带教` : ""}${resignationNames.length ? `，${resignationNames.join("、")}提出离职申请` : leaveNames.length ? `，${leaveNames.join("、")}开始个人请假` : ""}。`,
          result.accident ? "bad" : "craft"
        );
      }
    }
    return {
      changed: recoveredTimings > 0
        || recoveredCosts > 0
        || recoveredLeaseLinks > 0
        || incidentsRevealed > 0
        || refundedJobs > 0
        || deduplicatedJobs > 0
        || recoveredConcurrentJobs > 0
        || prunedJobs > 0
        || results.length > 0,
      recoveredTimings,
      recoveredCosts,
      recoveredLeaseLinks,
      incidentsRevealed,
      refundedJobs,
      deduplicatedJobs,
      recoveredConcurrentJobs,
      prunedJobs,
      results
    };
  }

  /**
   * Read-only operational audit for mining state. This deliberately avoids all
   * normalizers so it can report persisted/runtime corruption before recovery
   * code silently repairs it.
   */
  function inspectMiningHealth(now = Date.now()) {
    const checkedAt = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const state = getState();
    const mining = state?.mining && typeof state.mining === "object" && !Array.isArray(state.mining)
      ? state.mining
      : null;
    const issues = [];
    const addIssue = (code, scope, message) => {
      issues.push({ code, scope, message });
    };
    const playerFor = (playerId) => state?.players instanceof Map
      ? state.players.get(String(playerId || ""))
      : null;

    if (!mining) {
      return {
        ok: true,
        checkedAt,
        counts: { roster: 0, applications: 0, leases: 0, activeJobs: 0 },
        issues
      };
    }

    const roster = Array.isArray(mining.competitionPlayerIds) ? mining.competitionPlayerIds : [];
    if (!Array.isArray(mining.competitionPlayerIds)) {
      addIssue("invalid_roster", "world", "竞租名单不是有效列表。");
    }
    if (roster.length > config.requiredPlayers) {
      addIssue("roster_over_capacity", "world", `竞租名单人数 ${roster.length} 超过上限 ${config.requiredPlayers}。`);
    }
    const rosterIds = new Set();
    for (const rawPlayerId of roster) {
      const playerId = String(rawPlayerId || "");
      const scope = `roster:${playerId || "missing"}`;
      if (!playerId) {
        addIssue("invalid_roster_player", scope, "竞租名单包含空玩家编号。");
        continue;
      }
      if (rosterIds.has(playerId)) {
        addIssue("duplicate_roster_player", scope, "同一玩家重复占用竞租席位。");
      }
      rosterIds.add(playerId);
      if (!playerFor(playerId)) {
        addIssue("unknown_roster_player", scope, "竞租名单指向不存在的玩家。");
      }
    }

    const applications = Array.isArray(mining.applications) ? mining.applications : [];
    if (!Array.isArray(mining.applications)) {
      addIssue("invalid_applications", "world", "矿权申请不是有效列表。");
    }
    const applicationIds = new Set();
    const applicationKeys = new Set();
    const currentRoundNumber = Math.max(0, Math.round(Number(mining.currentRound?.number) || 0));
    for (const application of applications) {
      const applicationId = String(application?.id || "");
      const playerId = String(application?.playerId || "");
      const targetRound = Math.round(Number(application?.targetRound) || 0);
      const scope = `application:${applicationId || `${playerId || "missing"}:${targetRound || "missing"}`}`;
      if (!applicationId) {
        addIssue("invalid_application_id", scope, "矿权申请缺少编号。");
      } else if (applicationIds.has(applicationId)) {
        addIssue("duplicate_application_id", scope, "矿权申请编号重复。");
      }
      if (applicationId) applicationIds.add(applicationId);
      const applicationKey = `${playerId}:${targetRound}`;
      if (applicationKeys.has(applicationKey)) {
        addIssue("duplicate_player_application", scope, "同一玩家在同一轮存在多份申请。");
      }
      applicationKeys.add(applicationKey);
      if (!playerId || !playerFor(playerId)) {
        addIssue("unknown_application_player", scope, "矿权申请指向不存在的玩家。");
      } else if (!rosterIds.has(playerId)) {
        addIssue("application_player_outside_roster", scope, "申请玩家不在当前竞租名单中。");
      }
      if (!currentRoundNumber || ![currentRoundNumber, currentRoundNumber + 1].includes(targetRound)) {
        addIssue("invalid_application_round", scope, "矿权申请指向无效轮次。");
      }
      const rawPreferences = Array.isArray(application?.preferences) ? application.preferences : [];
      const preferences = rawPreferences.map((mineId) => String(mineId || ""));
      const validMines = preferences.map((mineId) => miningMineById(mineId)).filter(Boolean);
      if (
        !preferences.length
        || validMines.length !== preferences.length
        || new Set(preferences).size !== preferences.length
        || preferences.length > MINING_MAX_PREFERENCES
      ) {
        addIssue("invalid_application_preferences", scope, "矿权申请的意向矿山无效或重复。");
      }
      const expectedEscrow = validMines.length
        ? Math.max(...validMines.map((mine) => money(
          effectiveMiningMine(mining, mine.id, targetRound)?.rent ?? mine.rent
        )))
        : 0;
      if (money(application?.escrow) !== expectedEscrow) {
        addIssue("application_escrow_mismatch", scope, "申请冻结款与最高意向矿山租金不一致。");
      }
    }

    const round = mining.currentRound && typeof mining.currentRound === "object"
      ? mining.currentRound
      : null;
    if (mining.unlockedAt && !round) {
      addIssue("missing_current_round", "world", "矿区已开放但当前轮次缺失。");
    }
    const leases = Array.isArray(round?.leases) ? round.leases : [];
    if (round && !Array.isArray(round.leases)) {
      addIssue("invalid_leases", `round:${round.id || "missing"}`, "当前矿权不是有效列表。");
    }
    if (leases.length > MINES.length) {
      addIssue("lease_over_capacity", `round:${round?.id || "missing"}`, `矿权数量 ${leases.length} 超过矿山数量 ${MINES.length}。`);
    }
    if (round) {
      const startsAt = Number(round.startsAt);
      const endsAt = Number(round.endsAt);
      if (!String(round.id || "") || !(Number(round.number) > 0)) {
        addIssue("invalid_round_identity", `round:${round.id || "missing"}`, "当前轮次缺少有效编号。");
      }
      if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt <= 0 || endsAt <= startsAt) {
        addIssue("invalid_round_timing", `round:${round.id || "missing"}`, "当前轮次起止时间无效。");
      }
      if (!round.allocatedAt && leases.length) {
        addIssue("unallocated_round_has_leases", `round:${round.id || "missing"}`, "尚未分配的轮次已存在矿权。");
      }
    }

    const leaseIds = new Set();
    const leasedPlayerIds = new Set();
    const leasedMineIds = new Set();
    const leaseById = new Map();
    for (const lease of leases) {
      const leaseId = String(lease?.id || "");
      const playerId = String(lease?.playerId || "");
      const mineId = String(lease?.mineId || "");
      const scope = `lease:${leaseId || `${playerId || "missing"}:${mineId || "missing"}`}`;
      if (!leaseId) addIssue("invalid_lease_id", scope, "矿权缺少编号。");
      else if (leaseIds.has(leaseId)) addIssue("duplicate_lease_id", scope, "矿权编号重复。");
      if (leaseId) {
        leaseIds.add(leaseId);
        leaseById.set(leaseId, lease);
      }
      if (!playerId || !playerFor(playerId)) {
        addIssue("unknown_lease_player", scope, "矿权指向不存在的玩家。");
      } else if (leasedPlayerIds.has(playerId)) {
        addIssue("duplicate_lease_player", scope, "同一玩家在当前轮次持有多份矿权。");
      }
      if (playerId) leasedPlayerIds.add(playerId);
      const mine = miningMineById(mineId);
      if (!mine) {
        addIssue("unknown_lease_mine", scope, "矿权指向不存在的矿山。");
      } else {
        if (leasedMineIds.has(mine.id)) {
          addIssue("duplicate_lease_mine", scope, "同一矿山在当前轮次被重复出租。");
        }
        leasedMineIds.add(mine.id);
        const expectedMine = effectiveMiningMine(mining, mine.id, round?.number);
        if (money(lease?.rent) !== money(expectedMine?.rent ?? mine.rent)) {
          addIssue("lease_rent_mismatch", scope, "矿权租金与矿山标准租金不一致。");
        }
      }
      if (round && (
        String(lease?.roundId || "") !== String(round.id || "")
        || Number(lease?.roundNumber) !== Number(round.number)
      )) {
        addIssue("lease_round_mismatch", scope, "矿权所属轮次与当前轮次不一致。");
      }
      if (round && (
        Number(lease?.startsAt) !== Number(round.startsAt)
        || Number(lease?.endsAt) !== Number(round.endsAt)
      )) {
        addIssue("lease_timing_mismatch", scope, "矿权起止时间与当前轮次不一致。");
      }
      const shiftsStarted = Number(lease?.shiftsStarted);
      const maxShifts = Number(lease?.maxShifts);
      if (
        !Number.isInteger(shiftsStarted)
        || !Number.isInteger(maxShifts)
        || shiftsStarted < 0
        || maxShifts < 1
        || shiftsStarted > maxShifts
        || maxShifts > MINING_MAX_SHIFTS_PER_LEASE
      ) {
        addIssue("invalid_lease_shift_count", scope, "矿权班次数量无效。");
      }
    }

    const jobIds = new Set();
    let activeJobs = 0;
    if (state?.players instanceof Map) {
      for (const player of state.players.values()) {
        const jobs = Array.isArray(player?.mining?.jobs) ? player.mining.jobs : [];
        if (player?.mining && !Array.isArray(player.mining.jobs)) {
          addIssue("invalid_player_jobs", `player:${player.id}`, "玩家采矿任务不是有效列表。");
        }
        let playerActiveJobs = 0;
        for (const job of jobs) {
          const jobId = String(job?.id || "");
          const scope = `job:${jobId || `${player.id}:missing`}`;
          if (job?.status !== "active") {
            addIssue("inactive_job_retained", scope, "已结束的采矿任务仍留在进行中列表。");
            continue;
          }
          activeJobs += 1;
          playerActiveJobs += 1;
          if (!jobId) addIssue("invalid_job_id", scope, "采矿任务缺少编号。");
          else if (jobIds.has(jobId)) addIssue("duplicate_job_id", scope, "采矿任务编号重复。");
          if (jobId) jobIds.add(jobId);
          const lease = leaseById.get(String(job?.leaseId || ""));
          if (
            !lease
            || String(lease.playerId || "") !== String(player.id || "")
            || String(lease.mineId || "") !== String(job?.mineId || "")
          ) {
            addIssue("orphan_active_job", scope, "进行中的采矿任务没有匹配的当前矿权。");
          }
          if (!miningMineById(job?.mineId)) {
            addIssue("unknown_job_mine", scope, "采矿任务指向不存在的矿山。");
          }
          const startedAt = Number(job?.startedAt);
          const readyAt = Number(job?.readyAt);
          const durationMs = Number(job?.durationMs);
          if (
            !Number.isFinite(startedAt)
            || !Number.isFinite(readyAt)
            || !Number.isFinite(durationMs)
            || startedAt <= 0
            || readyAt <= startedAt
            || durationMs <= 0
            || readyAt !== startedAt + durationMs
          ) {
            addIssue("invalid_job_timing", scope, "采矿任务的锁定时长或完成时间无效。");
          } else {
            if (startedAt > checkedAt) addIssue("future_active_job", scope, "采矿任务开始时间晚于当前时间。");
            if (readyAt + MINING_HEALTH_JOB_GRACE_MS <= checkedAt) {
              addIssue("overdue_active_job", scope, "采矿任务超过调度宽限后仍未结算。");
            }
          }
          const minerIds = Array.isArray(job?.minerIds) ? job.minerIds.map(String) : [];
          const ownedMinerIds = new Set((Array.isArray(player?.mining?.miners) ? player.mining.miners : [])
            .map((miner) => String(miner?.id || "")));
          if (
            !minerIds.length
            || new Set(minerIds).size !== minerIds.length
            || minerIds.some((minerId) => !ownedMinerIds.has(minerId))
          ) {
            addIssue("invalid_job_crew", scope, "采矿任务班组包含缺失或重复的矿工。");
          }
          const rawCost = Number(job?.cost);
          const jobCost = Math.round(rawCost);
          if (!Number.isFinite(rawCost) || !Number.isSafeInteger(jobCost) || jobCost <= 0) {
            addIssue("invalid_job_cost", scope, "采矿任务费用不是有效的正整数。");
          } else {
            const ledgerAmount = miningShiftLedgerAmount(player, job);
            if (ledgerAmount != null && ledgerAmount !== jobCost) {
              addIssue("job_cost_mismatch", scope, "采矿任务费用与实际扣款流水不一致。");
            }
            const wageCost = Math.round(Number(job?.wageCost));
            if (
              job?.mode === "basic"
              && (!Number.isSafeInteger(wageCost) || wageCost <= 0 || wageCost !== jobCost)
            ) {
              addIssue("job_cost_breakdown_mismatch", scope, "基础采矿任务的工资与总费用不一致。");
            }
          }
        }
        if (playerActiveJobs > 1) {
          addIssue("multiple_active_jobs", `player:${player.id}`, "同一玩家同时存在多条采矿任务。");
        }
      }
    }

    return {
      ok: issues.length === 0,
      checkedAt,
      counts: {
        roster: roster.length,
        applications: applications.length,
        leases: leases.length,
        activeJobs
      },
      issues
    };
  }

  function publicMiningTuningVersion(version, playerId = "", effectReport = null, manageableByMe = false) {
    if (!version) return null;
    const statusLabels = {
      scheduled: "等待生效",
      active: "正在生效",
      superseded: "历史版本",
      cancelled: "已撤销"
    };
    return {
      id: version.id,
      number: version.number,
      kind: version.kind,
      status: version.status,
      statusLabel: statusLabels[version.status] || "未知状态",
      sourceExperimentId: version.sourceExperimentId,
      parentVersionId: version.parentVersionId,
      rollbackOfVersionId: version.rollbackOfVersionId,
      createdAt: version.createdAt,
      createdByPlayerName: version.createdByPlayerName,
      scheduledRoundNumber: version.scheduledRoundNumber,
      activatedAt: version.activatedAt,
      activatedRoundNumber: version.activatedRoundNumber,
      cancelledAt: version.cancelledAt,
      rows: version.rows,
      rules: version.rules,
      effectReport: effectReport || version.effectResult || null,
      ownedByMe: String(version.createdByPlayerId) === String(playerId || ""),
      manageableByMe: manageableByMe === true
    };
  }

  function miningSnapshotForPlayer(player, now = Date.now(), readContext = {}) {
    const state = getState();
    // Snapshot assembly is a read boundary. A first page load must not create
    // authoritative world state merely because the client requested a view.
    const mining = miningWorldForRead();
    const competitionPlayerIds = (mining.competitionPlayerIds || []).map(String);
    const qualifiedCount = competitionPlayerIds.length;
    const milestoneQualified = playerHasMiningMilestone(player);
    const playerQualified = competitionPlayerIds.includes(String(player.id));
    const waitingPlayers = readContext.waitingPlayers ||= [...state.players.values()]
      .filter((entry) => (
        playerHasMiningMilestone(entry)
        && playerIsActive(entry, now, config.rosterInactiveMs)
        && !competitionPlayerIds.includes(String(entry.id))
      ))
      .sort((left, right) => (
        Number(left.mining?.competitionQueueAt || left.mining?.licenseAt || 0)
          - Number(right.mining?.competitionQueueAt || right.mining?.licenseAt || 0)
        || String(left.id).localeCompare(String(right.id))
      ));
    const waitlistPosition = waitingPlayers.findIndex((entry) => String(entry.id) === String(player.id)) + 1;
    const playerMining = normalizeMiningPlayer(player);
    const rosterSuspended = Number(playerMining.competitionSuspendedUntil || 0) > now;
    const latestRosterRelease = playerMining.applicationHistory
      .find((entry) => entry.rosterReleased) || null;
    const latestDowntimeRecovery = playerMining.applicationHistory
      .find((entry) => entry.reason === "server_downtime_expired") || null;
    const recoverySettledAt = Number(latestDowntimeRecovery?.settledAt) || 0;
    const recoveryNoticeActive = recoverySettledAt > 0
      && now >= recoverySettledAt
      && now - recoverySettledAt <= MINING_RECOVERY_NOTICE_MS;
    const inactiveDays = Math.max(1, Math.ceil(config.rosterInactiveMs / (24 * 60 * 60 * 1000)));
    const releaseRefund = money(latestRosterRelease?.refund || 0);
    const rosterReleaseMessage = latestRosterRelease?.reason === "inactive_roster_release"
      ? `因连续 ${inactiveDays} 天未活跃，你的竞租席位已释放${releaseRefund ? `，矿权申请冻结款 ${releaseRefund} 已全额退回` : ""}。`
      : latestRosterRelease?.reason === "repeated_non_participation"
        ? `因连续 ${MINING_MAX_SKIPPED_APPLICATION_ROUNDS} 轮未报名，你的竞租席位已释放。`
        : "";
    const accessMessage = !mining.unlockedAt
      ? `需 ${config.requiredPlayers} 个有效竞租席位达标后开放矿区。`
      : !milestoneQualified
        ? `声望曾达到 ${config.requiredRep} 后才能取得采矿资格。`
        : !playerQualified
          ? rosterSuspended
            ? `因连续 ${MINING_MAX_SKIPPED_APPLICATION_ROUNDS} 轮未报名，你的竞租席位已释放；本轮结束后按候补第 ${Math.max(1, waitlistPosition)} 位重新排队。`
            : `${rosterReleaseMessage ? `${rosterReleaseMessage} ` : ""}当前 ${config.requiredPlayers} 个竞租席位已满，你在候补队列第 ${Math.max(1, waitlistPosition)} 位。`
          : "";
    const round = mining.currentRound;
    let window = null;
    if (mining.unlockedAt && round) {
      if (!round.allocatedAt && now < round.startsAt) {
        window = { targetRound: round.number, closesAt: round.startsAt };
      } else if (round.allocatedAt && now >= round.endsAt - config.applicationMs && now < round.endsAt) {
        window = { targetRound: round.number + 1, closesAt: round.endsAt };
      }
    }
    const applications = (mining.applications || []).filter((entry) => entry.targetRound === window?.targetRound);
    const applicantCounts = {};
    for (const application of applications) {
      for (const mineId of application.preferences || []) {
        applicantCounts[mineId] = (applicantCounts[mineId] || 0) + 1;
      }
    }
    const currentApplicantCount = new Set(applications.map((entry) => String(entry.playerId || "")))
      .size;
    const recentCompetitionRounds = [round, ...(mining.history || [])]
      .filter((entry) => entry?.allocatedAt && entry?.competitionStats)
      .sort((left, right) => Number(right.number || 0) - Number(left.number || 0))
      .slice(0, 6)
      .map((entry) => {
        const stats = entry.competitionStats || {};
        const rosterSize = Math.max(0, Number(stats.rosterSize) || 0);
        const applicantCount = Math.max(0, Number(stats.applicantCount) || 0);
        const winnerCount = Math.max(0, Number(stats.winnerCount) || 0);
        return {
          roundNumber: Math.max(1, Number(entry.number) || 1),
          rosterSize,
          applicantCount,
          winnerCount,
          missedCount: Math.max(0, Number(stats.missedCount) || 0),
          skippedCount: Math.max(0, Number(stats.skippedCount) || 0),
          priorityWinnerCount: Math.max(0, Number(stats.priorityWinnerCount) || 0),
          fallbackWinnerCount: Math.max(0, Number(stats.fallbackWinnerCount) || 0),
          rosterReleasedCount: Math.max(0, Number(stats.rosterReleasedCount) || 0),
          participationRate: rosterSize ? applicantCount / rosterSize : 0,
          winRate: applicantCount ? winnerCount / applicantCount : 0,
          settledAt: Number(stats.settledAt || entry.allocatedAt) || null
        };
      });
    const competitionTotals = recentCompetitionRounds.reduce((totals, entry) => ({
      rosterSlots: totals.rosterSlots + entry.rosterSize,
      applicants: totals.applicants + entry.applicantCount,
      winners: totals.winners + entry.winnerCount,
      releases: totals.releases + entry.rosterReleasedCount
    }), { rosterSlots: 0, applicants: 0, winners: 0, releases: 0 });
    const averageWaitMs = waitingPlayers.length
      ? Math.round(waitingPlayers.reduce((sum, entry) => (
        sum + Math.max(0, now - Number(entry.mining?.competitionQueueAt || entry.mining?.licenseAt || now))
      ), 0) / waitingPlayers.length)
      : 0;
    const mineHeat = Object.entries(applicantCounts)
      .map(([mineId, count]) => ({ mineId, applicantCount: Math.max(0, Number(count) || 0) }))
      .sort((left, right) => right.applicantCount - left.applicantCount || left.mineId.localeCompare(right.mineId))
      .slice(0, 5);
    const competitionInsights = {
      currentTargetRound: window?.targetRound || null,
      currentApplicantCount,
      currentRosterSize: competitionPlayerIds.length,
      currentParticipationRate: competitionPlayerIds.length
        ? currentApplicantCount / competitionPlayerIds.length
        : 0,
      waitlistCount: waitingPlayers.length,
      averageWaitMs,
      recentRoundCount: recentCompetitionRounds.length,
      recentParticipationRate: competitionTotals.rosterSlots
        ? competitionTotals.applicants / competitionTotals.rosterSlots
        : 0,
      recentWinRate: competitionTotals.applicants
        ? competitionTotals.winners / competitionTotals.applicants
        : 0,
      recentReleaseRate: competitionTotals.rosterSlots
        ? competitionTotals.releases / competitionTotals.rosterSlots
        : 0,
      recentReleaseCount: competitionTotals.releases,
      mineHeat,
      recentRounds: recentCompetitionRounds
    };
    competitionInsights.healthAlerts = miningCompetitionHealth(competitionInsights, {
      leaseMs: config.leaseMs
    });
    const economyInsights = miningEconomyInsights({
      history: playerMining.history,
      leaseHistory: playerMining.leaseHistory
    });
    const activeTuningVersion = activeMiningTuningVersion(mining);
    const worldEconomyReport = readContext.worldEconomyReport ||= miningWorldEconomyReport({
      players: state.players,
      rounds: mining.history,
      mineRules: activeTuningVersion?.rules || {}
    });
    const economyTuningSandbox = readContext.economyTuningSandbox ||= miningEconomyTuningSandbox(worldEconomyReport);
    const pendingTuningVersion = pendingMiningTuningVersion(mining);
    const activeTuningEffectReport = readContext.activeTuningEffectReport ||= activeTuningVersion?.effectResult || (activeTuningVersion
      ? miningTuningVersionEffectReport(activeTuningVersion, {
        players: state.players,
        rounds: mining.history
      })
      : null);
    const reviewerIds = miningTuningReviewerIds(mining);
    const canManageTuning = canPlayerGovernMiningTuning(player, mining);
    const reviewerPlayerNames = reviewerIds
      .map((playerId) => state.players.get(playerId)?.name)
      .filter(Boolean);
    const activeEffectCollecting = activeTuningEffectReport?.status === "collecting";
    const activeEffectCritical = activeTuningEffectReport?.assessment?.id === "rollback-recommended";
    const formalReviewBlockedReason = !canManageTuning
      ? "只有矿务数值审核员可以生成全服正式版本。"
      : pendingTuningVersion
        ? `V${pendingTuningVersion.number} 正在等待生效，请先处理现有排期。`
        : activeEffectCollecting
          ? `V${activeTuningVersion.number} 尚在生效后观察期，完成三个独立轮次前不能叠加普通调整。`
          : activeEffectCritical
            ? `V${activeTuningVersion.number} 已触发安全线，请先安排回滚。`
            : "";
    const tuningExperiments = playerMining.tuningExperiments.map((experiment) => {
      const report = miningTuningObservationReport(experiment, {
        players: state.players,
        rounds: mining.history
      });
      const version = mining.tuningVersions.find((entry) => entry.sourceExperimentId === experiment.id) || null;
      return {
        ...report,
        governance: version ? publicMiningTuningVersion(
          version,
          player.id,
          version.effectResult,
          canManageTuning
        ) : null,
        canEnterReview: report.assessment?.id === "review-ready"
          && !version
          && !formalReviewBlockedReason,
        reviewBlockedReason: report.assessment?.id === "review-ready" && !version
          ? formalReviewBlockedReason
          : ""
      };
    });
    const publicLeases = (round?.leases || []).map((lease) => ({
      ...lease,
      // Older saves may predate the denormalized display name. Resolve it
      // from the live player record so mine ownership is still visible.
      playerName: lease.playerName || state.players.get(lease.playerId)?.name || "未知玩家"
    }));
    const myLease = publicLeases.find((lease) => lease.playerId === player.id) || null;
    const priorityEligible = Boolean(
      window
      && Number(normalizeMiningPlayer(player).priorityRound) === Number(window.targetRound)
    );
    return {
      basicMode: config.basicMode,
      unlocked: Boolean(mining.unlockedAt),
      unlockedAt: mining.unlockedAt,
      requiredRep: config.requiredRep,
      requiredPlayers: config.requiredPlayers,
      qualifiedCount,
      competitionRosterSize: qualifiedCount,
      competitionRosterLimit: config.requiredPlayers,
      milestoneQualified,
      playerQualified,
      waitlistPosition: waitlistPosition || null,
      skippedApplicationRounds: playerMining.skippedApplicationRounds,
      maxSkippedApplicationRounds: MINING_MAX_SKIPPED_APPLICATION_ROUNDS,
      competitionSuspendedUntil: playerMining.competitionSuspendedUntil,
      lastRosterReleaseRound: playerMining.lastRosterReleaseRound,
      rosterAtRisk: Boolean(playerQualified && playerMining.skippedApplicationRounds > 0),
      priorityEligible,
      accessMessage,
      rosterReleaseNotice: latestRosterRelease ? {
        roundNumber: latestRosterRelease.roundNumber,
        settledAt: latestRosterRelease.settledAt,
        reason: latestRosterRelease.reason,
        refund: releaseRefund,
        message: rosterReleaseMessage
      } : null,
      applicationRecoveryNotice: recoveryNoticeActive ? {
        roundNumber: latestDowntimeRecovery.roundNumber,
        settledAt: recoverySettledAt,
        refund: money(latestDowntimeRecovery.refund || 0),
        reason: latestDowntimeRecovery.reason,
        message: `服务器停机期间第 ${latestDowntimeRecovery.roundNumber} 轮申请已过期，冻结款 ${money(latestDowntimeRecovery.refund || 0)} 已全额退回；新的申请期已经开放，可重新选择矿山。`
      } : null,
      leaseMs: config.leaseMs,
      applicationMs: config.applicationMs,
      baseShiftMs: config.shiftMs,
      shiftMs: config.basicMode ? config.shiftMs : miningShiftDurationForPlayer(player),
      acceptingApplications: Boolean(window),
      targetRound: window?.targetRound || null,
      applicationClosesAt: window?.closesAt || null,
      applicantCounts,
      competitionInsights,
      economyInsights,
      worldEconomyReport,
      economyTuningSandbox,
      tuningExperiments,
      tuningGovernance: {
        activeVersion: publicMiningTuningVersion(
          activeTuningVersion,
          player.id,
          activeTuningEffectReport,
          canManageTuning
        ),
        pendingVersion: publicMiningTuningVersion(
          pendingTuningVersion,
          player.id,
          pendingTuningVersion?.effectResult,
          canManageTuning
        ),
        versions: mining.tuningVersions.map((version) => publicMiningTuningVersion(
          version,
          player.id,
          version.effectResult,
          canManageTuning
        )),
        canManage: canManageTuning,
        reviewerPlayerNames,
        reviewerMode: config.tuningReviewerPlayerIds.length ? "configured" : (allowFounderTuning ? "founder" : "disabled"),
        formalReviewBlockedReason,
        policyNote: "普通调整必须等待当前版本完成三个独立生效轮次；紧急回滚可随时安排。审核通过与回滚只在安全轮次边界生效，不会中途改写当前租期、已冻结申请或进行中班次。"
      },
      effectiveMines: effectiveMiningMines(mining, window?.targetRound || round?.number || 1).map((mine) => ({
        id: mine.id,
        baseRent: mine.baseRent,
        rent: mine.rent,
        rentMultiplier: mine.rentMultiplier,
        outputMultiplier: mine.outputMultiplier
      })),
      currentRound: round ? {
        id: round.id,
        number: round.number,
        startsAt: round.startsAt,
        endsAt: round.endsAt,
        allocatedAt: round.allocatedAt,
        tuningVersionId: round.tuningVersionId || null,
        leases: publicLeases
      } : null,
      myApplication: window
        ? applications.find((entry) => entry.playerId === player.id) || null
        : null,
      myLease,
      myNextCondition: !config.basicMode && myLease && myLease.shiftsStarted < myLease.maxShifts
        ? { ...miningConditionForLease(myLease) }
        : null
    };
  }

  return {
    config,
    ensureMiningWorld,
    grantMiningLicenseIfDue,
    qualifiedPlayers,
    canPlayerMine,
    applicationWindow,
    activeLeaseForPlayer,
    submitMiningApplication,
    cancelMiningApplication,
    saveMiningTuningExperiment,
    reviewMiningTuningExperiment,
    cancelMiningTuningVersion,
    rollbackMiningTuningVersion,
    miningShiftQuote,
    miningShiftDurationForPlayer,
    upgradeMiningFacility,
    startMiningShift,
    resolveMiningIncident,
    settleMiningJob,
    processMiningJobs,
    processMiningWorld,
    inspectMiningHealth,
    debugUnlockMining,
    miningSnapshotForPlayer
  };
}
