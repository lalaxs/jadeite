import {
  MINING_CLUE_TARGET,
  MINING_MAX_MINERS,
  MINING_MAX_SURVEY_REPORTS,
  MINING_RECRUIT_REFRESH_COST,
  MINING_TUNING_OBSERVATION_MAX_RECORDS,
  MINING_TUNING_OBSERVATION_ROUNDS,
  MINING_TUNING_SCENARIOS,
  MINER_FATIGUE_WORK_LIMIT,
  MINER_INJURY_MS,
  MINER_CARE_OPTIONS,
  MINER_CONTRACT_MAX_SHIFTS,
  MINER_CONTRACT_RENEWAL_SHIFTS,
  MINER_MAX_TIER,
  MINER_REST_MIN_FATIGUE,
  MINER_INITIAL_CONTRACT_SHIFTS,
  MINER_INITIAL_MORALE,
  MINER_MORALE_CARE_THRESHOLD,
  MINER_MENTORSHIP_COMPLETION_EXP,
  MINER_MENTORSHIP_REQUIRED_SHIFTS,
  MINER_MENTORSHIP_ROLE_EXP,
  MINER_MENTOR_SHIFT_MORALE,
  MINER_APPRENTICE_SHIFT_MORALE,
  MINER_MENTOR_COMPLETION_MORALE,
  MINER_APPRENTICE_COMPLETION_MORALE,
  MINER_PERSONAL_LEAVE_MORALE_THRESHOLD,
  MINER_PERSONAL_LEAVE_MS,
  MINER_RESIGNATION_MORALE_THRESHOLD,
  MINER_RETENTION_CHOICES,
  MINER_SKILL_MAX_LEVEL,
  MINER_SPECIALIZATION_BONUS,
  MINER_SHIFT_FATIGUE,
  MINER_TRAINING_PROGRAMS,
  MINER_TRAIT_EFFECTS,
  miningFacilityLevels,
  miningCrewKey,
  miningMineById,
  miningMinerContractInfo,
  miningMinerFatigueAt,
  miningMinerMoraleInfo,
  miningMinerRetentionChoiceQuote,
  miningMinerRetentionInfo,
  miningMentorshipEligibility,
  miningMinerPromotionInfo,
  miningMinerShiftMoraleDelta,
  miningMinerSkillExpTarget,
  miningMinerSpecializationById,
  miningMinerSpecializationEligibility
} from "../../shared/domain/mining/mining-rules.js";

const MINER_RECRUIT_REFRESH_COOLDOWN_MS = 1_000;

export const MAX_MINERS = MINING_MAX_MINERS;
export const MINER_RECRUIT_REFRESH_COST = MINING_RECRUIT_REFRESH_COST;

export const MINER_BASE_WAGES = Object.freeze([360, 480, 630, 820, 1050, 1320]);
export const MINER_RECRUIT_PRICES = Object.freeze([3200, 5400, 8500, 12_500, 18_000, 25_500]);

const TIER_WEIGHTS = Object.freeze([
  Object.freeze([1, 0.55]),
  Object.freeze([3, 0.32]),
  Object.freeze([5, 0.13])
]);

const NAMES = Object.freeze([
  "岩叔", "阿磊", "石生", "老孔", "小岭", "青禾",
  "陆川", "山魁", "阿岚", "古师傅", "水根", "林野"
]);

const POSITIVE_TRAITS = Object.freeze(["识脉", "耐劳", "谨慎", "稳手"]);
const NEGATIVE_TRAITS = Object.freeze(["冒进", "怕潮", "手松", "贪深"]);

function normalizeTuningObservationMetrics(value = {}) {
  const outputPerShift = Math.max(0, Math.round(Number(value.outputPerShift) || 0));
  const allInCost = Math.max(0, Math.round(Number(value.allInCost) || 0));
  const estimatedNet = Math.round(Number(value.estimatedNet) || 0);
  return {
    outputPerShift,
    allInCost,
    estimatedNet,
    margin: Number.isFinite(Number(value.margin))
      ? Number(value.margin)
      : outputPerShift > 0 ? estimatedNet / outputPerShift : 0
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pick(list, rng) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function weightedTier(rng) {
  let roll = rng();
  for (const [tier, weight] of TIER_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return tier;
  }
  return 5;
}

export function minerBaseWage(tier) {
  const normalized = clamp(Math.round(Number(tier) || 1), 1, MINER_BASE_WAGES.length);
  return MINER_BASE_WAGES[normalized - 1];
}

export function minerRecruitPrice(tier) {
  const normalized = clamp(Math.round(Number(tier) || 1), 1, MINER_RECRUIT_PRICES.length);
  return MINER_RECRUIT_PRICES[normalized - 1];
}

function skill(level) {
  return { level: clamp(Math.round(Number(level) || 1), 1, MINER_SKILL_MAX_LEVEL), exp: 0 };
}

function normalizeSkillState(entry, fallbackLevel = 1) {
  const normalized = entry && typeof entry === "object" && !Array.isArray(entry)
    ? entry
    : skill(fallbackLevel);
  normalized.level = clamp(Math.round(Number(normalized.level) || fallbackLevel), 1, MINER_SKILL_MAX_LEVEL);
  normalized.exp = Math.max(0, Math.round(Number(normalized.exp) || 0));
  while (
    normalized.level < MINER_SKILL_MAX_LEVEL
    && normalized.exp >= miningMinerSkillExpTarget(normalized.level)
  ) {
    normalized.exp -= miningMinerSkillExpTarget(normalized.level);
    normalized.level += 1;
  }
  if (normalized.level >= MINER_SKILL_MAX_LEVEL) normalized.exp = 0;
  return normalized;
}

function uniqueMinerName(player, rng, reservedNames = []) {
  const used = new Set([
    ...(player?.mining?.miners || []),
    ...(player?.mining?.recruitCandidates || []),
    ...reservedNames
  ].map((entry) => String(entry?.name ?? entry ?? "")).filter(Boolean));
  const available = NAMES.filter((name) => !used.has(name));
  if (available.length) return pick(available, rng);
  const base = pick(NAMES, rng);
  let suffix = 2;
  while (used.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

function makeMinerCandidate(player, { rng = Math.random, makeId, reservedNames = [], tierOverride = null }) {
  const tier = tierOverride == null
    ? weightedTier(rng)
    : clamp(Math.round(Number(tierOverride) || 1), 1, MINER_MAX_TIER);
  const main = Math.min(10, tier + 1 + randomInt(rng, 0, 2));
  return {
    id: makeId(),
    name: uniqueMinerName(player, rng, reservedNames),
    tier,
    trait: pick(POSITIVE_TRAITS, rng),
    flaw: pick(NEGATIVE_TRAITS, rng),
    baseWage: minerBaseWage(tier),
    price: minerRecruitPrice(tier),
    morale: MINER_INITIAL_MORALE,
    fatigue: 0,
    fatigueAt: null,
    injuredUntil: null,
    leaveUntil: null,
    retentionCase: null,
    contractShiftsRemaining: MINER_INITIAL_CONTRACT_SHIFTS,
    contractRenewals: 0,
    lastContractRenewedAt: null,
    promotions: 0,
    lastPromotedAt: null,
    shiftsWorked: 0,
    specializationId: null,
    specializedAt: null,
    skills: {
      prospecting: skill(main),
      extraction: skill(Math.max(1, main - randomInt(rng, 0, 2))),
      safety: skill(Math.max(1, main - randomInt(rng, 0, 2)))
    }
  };
}

function makeMinerCandidateBatch(player, count, deps) {
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    candidates.push(makeMinerCandidate(player, {
      ...deps,
      reservedNames: candidates.map((entry) => entry.name)
    }));
  }
  return candidates;
}

function normalizeMinerState(miner) {
  if (!miner || typeof miner !== "object") return miner;
  miner.tier = clamp(Math.round(Number(miner.tier) || 1), 1, MINER_MAX_TIER);
  miner.baseWage = minerBaseWage(miner.tier);
  miner.morale = clamp(
    miner.morale == null ? MINER_INITIAL_MORALE : Math.round(Number(miner.morale) || 0),
    0,
    100
  );
  miner.fatigue = clamp(Number(miner.fatigue) || 0, 0, 100);
  miner.fatigueAt = Number(miner.fatigueAt) > 0 ? Number(miner.fatigueAt) : null;
  miner.injuredUntil = Number(miner.injuredUntil) > 0 ? Number(miner.injuredUntil) : null;
  miner.leaveUntil = Number(miner.leaveUntil) > 0 ? Number(miner.leaveUntil) : null;
  const retentionCase = miner.retentionCase && typeof miner.retentionCase === "object" && !Array.isArray(miner.retentionCase)
    ? miner.retentionCase
    : null;
  miner.retentionCase = retentionCase
    ? {
        id: String(retentionCase.id || `${miner.id || "miner"}:${Number(retentionCase.createdAt) || 0}`),
        createdAt: Number(retentionCase.createdAt) > 0 ? Number(retentionCase.createdAt) : Date.now(),
        moraleAtNotice: clamp(Math.round(Number(retentionCase.moraleAtNotice) || miner.morale), 0, 100)
      }
    : null;
  miner.lastTrainedAt = Number(miner.lastTrainedAt) > 0 ? Number(miner.lastTrainedAt) : null;
  miner.lastCaredAt = Number(miner.lastCaredAt) > 0 ? Number(miner.lastCaredAt) : null;
  miner.lastRetentionAt = Number(miner.lastRetentionAt) > 0 ? Number(miner.lastRetentionAt) : null;
  miner.contractShiftsRemaining = miner.contractShiftsRemaining == null
    ? MINER_INITIAL_CONTRACT_SHIFTS
    : clamp(Math.round(Number(miner.contractShiftsRemaining) || 0), 0, MINER_CONTRACT_MAX_SHIFTS);
  miner.contractRenewals = Math.max(0, Math.round(Number(miner.contractRenewals) || 0));
  miner.lastContractRenewedAt = Number(miner.lastContractRenewedAt) > 0
    ? Number(miner.lastContractRenewedAt)
    : null;
  miner.promotions = Math.max(0, Math.round(Number(miner.promotions) || 0));
  miner.lastPromotedAt = Number(miner.lastPromotedAt) > 0 ? Number(miner.lastPromotedAt) : null;
  miner.shiftsWorked = Math.max(0, Math.round(Number(miner.shiftsWorked) || 0));
  miner.specializationId = miningMinerSpecializationById(miner.specializationId)?.id || null;
  miner.specializedAt = miner.specializationId && Number(miner.specializedAt) > 0
    ? Number(miner.specializedAt)
    : null;
  miner.skills = miner.skills && typeof miner.skills === "object" && !Array.isArray(miner.skills)
    ? miner.skills
    : {};
  miner.skills.prospecting = normalizeSkillState(miner.skills.prospecting);
  miner.skills.extraction = normalizeSkillState(miner.skills.extraction);
  miner.skills.safety = normalizeSkillState(miner.skills.safety);
  return miner;
}

export function normalizeMiningPlayer(player) {
  if (!player) return null;
  const mining = player.mining && typeof player.mining === "object" && !Array.isArray(player.mining)
    ? player.mining
    : {};
  mining.licenseAt = Number(mining.licenseAt) > 0 ? Number(mining.licenseAt) : null;
  mining.starterMinerGranted = mining.starterMinerGranted === true;
  mining.miners = Array.isArray(mining.miners) ? mining.miners : [];
  mining.recruitCandidates = Array.isArray(mining.recruitCandidates) ? mining.recruitCandidates : [];
  mining.miners.forEach(normalizeMinerState);
  mining.recruitCandidates.forEach((candidate) => {
    normalizeMinerState(candidate);
    candidate.price = minerRecruitPrice(candidate.tier);
  });
  mining.mentorships = (Array.isArray(mining.mentorships) ? mining.mentorships : [])
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      id: String(entry.id || ""),
      mentorId: String(entry.mentorId || ""),
      apprenticeId: String(entry.apprenticeId || ""),
      mentorName: String(entry.mentorName || ""),
      apprenticeName: String(entry.apprenticeName || ""),
      status: ["active", "completed", "ended"].includes(entry.status) ? entry.status : "active",
      sharedShifts: Math.max(0, Math.min(
        MINER_MENTORSHIP_REQUIRED_SHIFTS,
        Math.round(Number(entry.sharedShifts) || 0)
      )),
      createdAt: Number(entry.createdAt) > 0 ? Number(entry.createdAt) : null,
      lastWorkedAt: Number(entry.lastWorkedAt) > 0 ? Number(entry.lastWorkedAt) : null,
      completedAt: Number(entry.completedAt) > 0 ? Number(entry.completedAt) : null,
      endedAt: Number(entry.endedAt) > 0 ? Number(entry.endedAt) : null
    }))
    .filter((entry) => entry.id && entry.mentorId && entry.apprenticeId)
    .slice(0, 20);
  mining.recruitCandidatesInitialized = mining.recruitCandidatesInitialized === true;
  mining.lastRecruitRefreshAt = Number(mining.lastRecruitRefreshAt) > 0
    ? Number(mining.lastRecruitRefreshAt)
    : null;
  mining.jobs = (Array.isArray(mining.jobs) ? mining.jobs : [])
    .filter((job) => job && typeof job === "object" && !Array.isArray(job));
  mining.history = Array.isArray(mining.history) ? mining.history.slice(0, 20) : [];
  mining.leaseHistory = Array.isArray(mining.leaseHistory) ? mining.leaseHistory.slice(0, 20) : [];
  mining.applicationHistory = (Array.isArray(mining.applicationHistory) ? mining.applicationHistory : [])
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      id: String(entry.id || ""),
      applicationId: entry.applicationId ? String(entry.applicationId) : null,
      roundNumber: Math.max(1, Math.round(Number(entry.roundNumber) || 1)),
      submittedAt: Number(entry.submittedAt) > 0 ? Number(entry.submittedAt) : null,
      settledAt: Number(entry.settledAt) > 0 ? Number(entry.settledAt) : null,
      preferences: [...new Set((Array.isArray(entry.preferences) ? entry.preferences : [])
        .map(String)
        .filter((mineId) => miningMineById(mineId)))],
      allowFallback: entry.allowFallback !== false,
      escrow: Math.max(0, Math.round(Number(entry.escrow) || 0)),
      status: ["won", "missed", "cancelled", "failed", "skipped"].includes(entry.status)
        ? entry.status
        : "missed",
      mineId: miningMineById(entry.mineId)?.id || null,
      rent: Math.max(0, Math.round(Number(entry.rent) || 0)),
      refund: Math.max(0, Math.round(Number(entry.refund) || 0)),
      allocationMode: ["preference", "adjusted", "automatic"].includes(entry.allocationMode)
        ? entry.allocationMode
        : null,
      preferenceRank: Number(entry.preferenceRank) > 0 ? Math.round(Number(entry.preferenceRank)) : null,
      priorityAllocation: entry.priorityAllocation === true,
      priorityGranted: entry.priorityGranted === true,
      reason: entry.reason ? String(entry.reason) : "",
      rosterReleased: entry.rosterReleased === true
    }))
    .filter((entry) => entry.id)
    .slice(0, 30);
  const validTuningScenarioIds = new Set(MINING_TUNING_SCENARIOS.map((scenario) => scenario.id));
  mining.tuningExperiments = (Array.isArray(mining.tuningExperiments) ? mining.tuningExperiments : [])
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      id: String(entry.id || ""),
      createdAt: Number(entry.createdAt) > 0 ? Number(entry.createdAt) : null,
      baselineRoundNumber: Math.max(0, Math.round(Number(entry.baselineRoundNumber) || 0)),
      targetRoundCount: Math.max(1, Math.min(
        MINING_TUNING_OBSERVATION_ROUNDS,
        Math.round(Number(entry.targetRoundCount) || MINING_TUNING_OBSERVATION_ROUNDS)
      )),
      sampleReadyAtStart: entry.sampleReadyAtStart === true,
      basis: entry.basis === "observed" ? "observed" : "benchmark",
      draftStatus: ["benchmark-only", "needs-review", "ready"].includes(entry.draftStatus)
        ? entry.draftStatus
        : "benchmark-only",
      draftIssues: (Array.isArray(entry.draftIssues) ? entry.draftIssues : [])
        .filter((issue) => issue && typeof issue === "object" && !Array.isArray(issue))
        .map((issue) => ({
          id: String(issue.id || ""),
          severity: ["info", "warning", "critical"].includes(issue.severity) ? issue.severity : "info",
          title: String(issue.title || "")
        }))
        .filter((issue) => issue.id && issue.title)
        .slice(0, 6),
      rows: (Array.isArray(entry.rows) ? entry.rows : [])
        .filter((row) => row && typeof row === "object" && !Array.isArray(row))
        .map((row) => ({
          beltId: String(row.beltId || ""),
          beltLabel: String(row.beltLabel || row.beltId || "未知矿带"),
          scenarioId: validTuningScenarioIds.has(row.scenarioId) ? row.scenarioId : "hold",
          scenarioLabel: String(row.scenarioLabel || "维持现状"),
          rentDelta: Number(row.rentDelta) || 0,
          outputDelta: Number(row.outputDelta) || 0,
          baseline: normalizeTuningObservationMetrics(row.baseline),
          projected: normalizeTuningObservationMetrics(row.projected),
          netDelta: Math.round(Number(row.netDelta) || 0)
        }))
        .filter((row) => row.beltId && row.scenarioId !== "hold")
        .slice(0, 2),
      forecast: {
        projectedSpread: Math.max(0, Number(entry.forecast?.projectedSpread) || 0),
        baselineSpread: Math.max(0, Number(entry.forecast?.baselineSpread) || 0)
      }
    }))
    .filter((entry) => entry.id && entry.createdAt && entry.rows.length)
    .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
    .slice(0, MINING_TUNING_OBSERVATION_MAX_RECORDS);
  const sourceCrewRecords = mining.crewRecords && typeof mining.crewRecords === "object" && !Array.isArray(mining.crewRecords)
    ? mining.crewRecords
    : {};
  mining.crewRecords = Object.fromEntries(Object.entries(sourceCrewRecords)
    .filter(([crewKey, record]) => crewKey && record && typeof record === "object" && !Array.isArray(record))
    .map(([crewKey, record]) => {
      const minerIds = miningCrewKey(record.minerIds || crewKey.split("|")).split("|").filter(Boolean);
      return [miningCrewKey(minerIds), {
        shifts: Math.max(0, Math.round(Number(record.shifts) || 0)),
        minerIds,
        minerNames: Array.isArray(record.minerNames) ? record.minerNames.map(String).filter(Boolean) : [],
        lastWorkedAt: Number(record.lastWorkedAt) > 0 ? Number(record.lastWorkedAt) : null
      }];
    })
    .filter(([crewKey]) => Boolean(crewKey)));
  const sourceMineRecords = mining.mineRecords && typeof mining.mineRecords === "object" && !Array.isArray(mining.mineRecords)
    ? mining.mineRecords
    : {};
  mining.mineRecords = Object.fromEntries(Object.entries(sourceMineRecords)
    .filter(([mineId, record]) => miningMineById(mineId) && record && typeof record === "object" && !Array.isArray(record))
    .map(([mineId, record]) => [mineId, {
      shifts: Math.max(0, Math.round(Number(record.shifts) || 0)),
      roughs: Math.max(0, Math.round(Number(record.roughs) || 0)),
      totalMass: Math.round(Math.max(0, Number(record.totalMass) || 0) * 10) / 10,
      accidents: Math.max(0, Math.round(Number(record.accidents) || 0)),
      clueProgress: Math.max(0, Math.min(MINING_CLUE_TARGET - 1, Math.round(Number(record.clueProgress) || 0))),
      surveyReports: Math.max(0, Math.min(MINING_MAX_SURVEY_REPORTS, Math.round(Number(record.surveyReports) || 0))),
      reportsCompleted: Math.max(0, Math.round(Number(record.reportsCompleted) || 0)),
      lastMinedAt: Number(record.lastMinedAt) > 0 ? Number(record.lastMinedAt) : null,
      lastConditionId: typeof record.lastConditionId === "string" && record.lastConditionId
        ? record.lastConditionId
        : null
    }]));
  mining.missedRounds = Math.max(0, Math.round(Number(mining.missedRounds) || 0));
  mining.priorityRound = Number(mining.priorityRound) > 0
    ? Math.round(Number(mining.priorityRound))
    : null;
  mining.skippedApplicationRounds = Math.max(0, Math.round(Number(mining.skippedApplicationRounds) || 0));
  mining.competitionSuspendedUntil = Number(mining.competitionSuspendedUntil) > 0
    ? Number(mining.competitionSuspendedUntil)
    : null;
  mining.competitionQueueAt = Number(mining.competitionQueueAt) > 0
    ? Number(mining.competitionQueueAt)
    : mining.licenseAt;
  mining.lastRosterReleaseRound = Number(mining.lastRosterReleaseRound) > 0
    ? Math.round(Number(mining.lastRosterReleaseRound))
    : null;
  mining.facilities = miningFacilityLevels(mining.facilities);
  mining.stats = mining.stats && typeof mining.stats === "object" && !Array.isArray(mining.stats)
    ? mining.stats
    : {};
  mining.stats.shifts = Math.max(0, Math.round(Number(mining.stats.shifts) || 0));
  mining.stats.roughs = Math.max(0, Math.round(Number(mining.stats.roughs) || 0));
  mining.stats.accidents = Math.max(0, Math.round(Number(mining.stats.accidents) || 0));
  mining.stats.totalMass = Math.max(0, Number(mining.stats.totalMass) || 0);
  mining.stats.spent = Math.max(0, Math.round(Number(mining.stats.spent) || 0));
  mining.stats.facilitySpent = Math.max(0, Math.round(Number(mining.stats.facilitySpent) || 0));
  mining.stats.preparationSpent = Math.max(0, Math.round(Number(mining.stats.preparationSpent) || 0));
  mining.stats.incentiveSpent = Math.max(0, Math.round(Number(mining.stats.incentiveSpent) || 0));
  mining.stats.trainingSpent = Math.max(0, Math.round(Number(mining.stats.trainingSpent) || 0));
  mining.stats.trainingSessions = Math.max(0, Math.round(Number(mining.stats.trainingSessions) || 0));
  mining.stats.careSpent = Math.max(0, Math.round(Number(mining.stats.careSpent) || 0));
  mining.stats.careActions = Math.max(0, Math.round(Number(mining.stats.careActions) || 0));
  mining.stats.moraleRecovered = Math.max(0, Math.round(Number(mining.stats.moraleRecovered) || 0));
  mining.stats.personalLeaves = Math.max(0, Math.round(Number(mining.stats.personalLeaves) || 0));
  mining.stats.retentionCases = Math.max(0, Math.round(Number(mining.stats.retentionCases) || 0));
  mining.stats.retentionSuccesses = Math.max(0, Math.round(Number(mining.stats.retentionSuccesses) || 0));
  mining.stats.retentionSpent = Math.max(0, Math.round(Number(mining.stats.retentionSpent) || 0));
  mining.stats.minerDepartures = Math.max(0, Math.round(Number(mining.stats.minerDepartures) || 0));
  mining.stats.mentorshipsFormed = Math.max(0, Math.round(Number(mining.stats.mentorshipsFormed) || 0));
  mining.stats.mentorshipsCompleted = Math.max(0, Math.round(Number(mining.stats.mentorshipsCompleted) || 0));
  mining.stats.mentorshipSpent = Math.max(0, Math.round(Number(mining.stats.mentorshipSpent) || 0));
  mining.stats.contractSpent = Math.max(0, Math.round(Number(mining.stats.contractSpent) || 0));
  mining.stats.contractRenewals = Math.max(0, Math.round(Number(mining.stats.contractRenewals) || 0));
  mining.stats.promotionSpent = Math.max(0, Math.round(Number(mining.stats.promotionSpent) || 0));
  mining.stats.promotions = Math.max(0, Math.round(Number(mining.stats.promotions) || 0));
  player.mining = mining;
  return mining;
}

export function ensureBasicStarterMiner(player, { rng = Math.random, makeId } = {}) {
  const mining = normalizeMiningPlayer(player);
  if (mining.starterMinerGranted && mining.miners.length) {
    return { changed: false, granted: false, miner: null };
  }
  const recoveringEmptyRoster = mining.starterMinerGranted;
  mining.starterMinerGranted = true;
  if (typeof makeId !== "function") {
    throw new Error("ensureBasicStarterMiner: makeId is required");
  }
  const miner = makeMinerCandidate(player, { rng, makeId, tierOverride: 1 });
  delete miner.price;
  mining.miners.push(miner);
  return { changed: true, granted: true, recovered: recoveringEmptyRoster, miner };
}

export function isMinerBusy(player, minerId) {
  const id = String(minerId || "");
  if (!id) return false;
  return (player?.mining?.jobs || []).some((job) => (
    job?.status === "active" && (job.minerIds || []).includes(id)
  ));
}

export function refreshMinerCondition(miner, now = Date.now()) {
  normalizeMinerState(miner);
  miner.fatigue = miningMinerFatigueAt(miner, now);
  miner.fatigueAt = now;
  if (miner.injuredUntil && miner.injuredUntil <= now) miner.injuredUntil = null;
  if (miner.leaveUntil && miner.leaveUntil <= now) miner.leaveUntil = null;
  return miner;
}

export function minerReadiness(miner, now = Date.now()) {
  const fatigue = miningMinerFatigueAt(miner, now);
  const injuredUntil = Number(miner?.injuredUntil) || 0;
  const retention = miningMinerRetentionInfo(miner, now);
  if (retention.pending) {
    return { ok: false, fatigue, injuredUntil: null, leaveUntil: retention.leaveUntil, reason: "已提出离职申请，需先处理留任" };
  }
  if (retention.leaveUntil > now) {
    return { ok: false, fatigue, injuredUntil: null, leaveUntil: retention.leaveUntil, reason: "个人请假中" };
  }
  if (injuredUntil > now) {
    return { ok: false, fatigue, injuredUntil, leaveUntil: null, reason: "伤停休养中" };
  }
  if (fatigue >= MINER_FATIGUE_WORK_LIMIT) {
    return { ok: false, fatigue, injuredUntil: null, leaveUntil: null, reason: "疲劳过高，需要休整" };
  }
  return { ok: true, fatigue, injuredUntil: null, leaveUntil: null, reason: "状态良好" };
}

export function applyMinerShiftCondition(miner, strategyId, completedAt, settledAt = completedAt, options = {}) {
  normalizeMinerState(miner);
  const baseFatigue = Math.max(0, Number(miner.fatigue) || 0);
  const traitDelta = Number(MINER_TRAIT_EFFECTS[miner.trait]?.fatigueDelta) || 0;
  const shiftFatigue = Math.max(5,
    (Number(MINER_SHIFT_FATIGUE[strategyId]) || MINER_SHIFT_FATIGUE.standard)
    + traitDelta
    + (Number(options.fatigueDelta) || 0)
  );
  const fatigueAtCompletion = clamp(baseFatigue + shiftFatigue, 0, 100);
  miner.fatigue = miningMinerFatigueAt({
    fatigue: fatigueAtCompletion,
    fatigueAt: completedAt
  }, settledAt);
  miner.fatigueAt = settledAt;
  if (options.injured) {
    const injuryDuration = strategyId === "deep" ? Math.round(MINER_INJURY_MS * 1.5) : MINER_INJURY_MS;
    miner.injuredUntil = Math.max(Number(miner.injuredUntil) || 0, completedAt + injuryDuration);
  } else if (miner.injuredUntil && miner.injuredUntil <= settledAt) {
    miner.injuredUntil = null;
  }
  return { fatigue: miner.fatigue, shiftFatigue, injuredUntil: miner.injuredUntil };
}

export function applyMinerShiftMorale(miner, options = {}) {
  normalizeMinerState(miner);
  const beforeInfo = miningMinerMoraleInfo(miner);
  const before = beforeInfo.morale;
  const delta = miningMinerShiftMoraleDelta(options);
  miner.morale = clamp(before + delta, 0, 100);
  const after = miningMinerMoraleInfo(miner);
  return {
    moraleBefore: before,
    moraleBeforeLabel: beforeInfo.name,
    moraleAfter: after.morale,
    moraleDelta: after.morale - before,
    moraleLabel: after.name
  };
}

export function applyMinerRetentionAfterShift(miner, completedAt = Date.now(), options = {}) {
  normalizeMinerState(miner);
  const completedTimestamp = Math.max(1, Math.round(Number(completedAt) || Date.now()));
  if (miner.retentionCase) {
    return { type: "resignation", created: false, retentionCase: miner.retentionCase };
  }
  const morale = miningMinerMoraleInfo(miner).morale;
  if (morale < MINER_RESIGNATION_MORALE_THRESHOLD) {
    miner.leaveUntil = null;
    miner.retentionCase = {
      id: `${String(miner.id || "miner")}:${completedTimestamp}`,
      createdAt: completedTimestamp,
      moraleAtNotice: morale
    };
    return { type: "resignation", created: true, retentionCase: miner.retentionCase };
  }
  if (morale < MINER_PERSONAL_LEAVE_MORALE_THRESHOLD && !options.injured) {
    const leaveUntil = Math.max(Number(miner.leaveUntil) || 0, completedTimestamp + MINER_PERSONAL_LEAVE_MS);
    miner.leaveUntil = leaveUntil;
    return { type: "leave", created: true, leaveUntil };
  }
  return { type: "none", created: false };
}

export function ensureMinerRecruitCandidates(player, deps) {
  const mining = normalizeMiningPlayer(player);
  if (!mining.recruitCandidates.length) {
    mining.recruitCandidates = makeMinerCandidateBatch(player, 3, deps);
  }
  mining.recruitCandidatesInitialized = true;
  return mining.recruitCandidates;
}

export function refreshMinerRecruitCandidates(player, {
  rng = Math.random,
  makeId,
  spendCash,
  expectedCandidateIds = null,
  now = Date.now()
}) {
  const mining = normalizeMiningPlayer(player);
  const refreshedAt = Number(now) > 0 ? Number(now) : Date.now();
  if (mining.miners.length >= MAX_MINERS) {
    return { ok: false, message: `矿工人数已经达到 ${MAX_MINERS} 人上限，无需刷新候选人。` };
  }
  if (Array.isArray(expectedCandidateIds)) {
    const expectedKey = expectedCandidateIds.map((id) => String(id || "")).filter(Boolean).join("|");
    const currentKey = mining.recruitCandidates.map((candidate) => String(candidate.id || "")).filter(Boolean).join("|");
    if (expectedKey !== currentKey) {
      return {
        ok: false,
        stale: true,
        message: "候选名单已经更新，本次未扣费，请按最新名单操作。"
      };
    }
  }
  if (!mining.recruitCandidatesInitialized) {
    mining.recruitCandidates = makeMinerCandidateBatch(player, 3, { rng, makeId });
    mining.recruitCandidatesInitialized = true;
    mining.lastRecruitRefreshAt = refreshedAt;
    return { ok: true, message: "首批矿工候选人已经到场。", candidates: mining.recruitCandidates, free: true };
  }
  const elapsedSinceRefresh = refreshedAt - Number(mining.lastRecruitRefreshAt || 0);
  if (elapsedSinceRefresh >= 0 && elapsedSinceRefresh < MINER_RECRUIT_REFRESH_COOLDOWN_MS) {
    return {
      ok: false,
      cooldown: true,
      retryAfterMs: MINER_RECRUIT_REFRESH_COOLDOWN_MS - elapsedSinceRefresh,
      message: "刷新操作过快，本次未扣费，请稍后再试。"
    };
  }
  if (!spendCash(player, MINER_RECRUIT_REFRESH_COST, "刷新矿工候选人", {
    source: "minerRecruitRefresh",
    repEligible: false
  })) {
    return { ok: false, message: `刷新矿工需要 ¥${MINER_RECRUIT_REFRESH_COST}。` };
  }
  mining.recruitCandidates = makeMinerCandidateBatch(player, 3, { rng, makeId });
  mining.recruitCandidatesInitialized = true;
  mining.lastRecruitRefreshAt = refreshedAt;
  return { ok: true, message: "矿工候选人已经刷新。", candidates: mining.recruitCandidates };
}

export function recruitMiner(player, candidateId, { spendCash }) {
  const mining = normalizeMiningPlayer(player);
  if (mining.miners.length >= MAX_MINERS) {
    return { ok: false, message: `矿工人数已经达到 ${MAX_MINERS} 人上限。` };
  }
  const id = String(candidateId || "");
  const candidate = mining.recruitCandidates.find((entry) => entry.id === id);
  if (!candidate) return { ok: false, message: "矿工候选人不存在。" };
  if (!spendCash(player, candidate.price, `招聘矿工：${candidate.name}`, {
    source: "minerRecruit",
    itemId: candidate.id,
    repEligible: false
  })) {
    return { ok: false, message: `招聘 ${candidate.name} 需要 ¥${candidate.price}。` };
  }
  const miner = structuredClone(candidate);
  delete miner.price;
  mining.miners.push(miner);
  mining.recruitCandidates = mining.recruitCandidates.filter((entry) => entry.id !== id);
  return { ok: true, message: `${miner.name} 已加入采矿队。`, miner };
}

function removeMinerFromRoster(mining, minerId) {
  const id = String(minerId || "");
  mining.miners = mining.miners.filter((entry) => entry.id !== id);
  mining.crewRecords = Object.fromEntries(Object.entries(mining.crewRecords || {}).filter(([crewKey, record]) => (
    !(record.minerIds || crewKey.split("|")).includes(id)
  )));
  mining.mentorships = (mining.mentorships || []).filter((entry) => (
    entry.mentorId !== id && entry.apprenticeId !== id
  ));
}

export function dismissMiner(player, minerId, { minimumRoster = 0 } = {}) {
  const mining = normalizeMiningPlayer(player);
  const id = String(minerId || "");
  const miner = mining.miners.find((entry) => entry.id === id);
  if (!miner) return { ok: false, message: "矿工不存在。" };
  const requiredRoster = Math.max(0, Math.round(Number(minimumRoster) || 0));
  if (mining.miners.length <= requiredRoster) {
    return { ok: false, message: `基础开采至少需要保留 ${requiredRoster} 名矿工。` };
  }
  if (isMinerBusy(player, id)) return { ok: false, message: "该矿工正在井下作业，无法解雇。" };
  if (miner.retentionCase) return { ok: false, message: "该矿工已提出离职申请，请通过留任事件办理离队。" };
  removeMinerFromRoster(mining, id);
  return { ok: true, message: `已解雇矿工 ${miner.name}。`, miner };
}

export function resolveMinerRetention(player, minerId, choiceId, now = Date.now(), { spendCash } = {}) {
  const mining = normalizeMiningPlayer(player);
  const miner = mining.miners.find((entry) => entry.id === String(minerId || ""));
  if (!miner) return { ok: false, message: "矿工不存在。" };
  if (!miner.retentionCase) return { ok: false, message: `${miner.name}当前没有待处理的离职申请。` };
  if (isMinerBusy(player, miner.id)) return { ok: false, message: `${miner.name}正在井下作业，暂时无法办理留任。` };
  const choice = MINER_RETENTION_CHOICES[String(choiceId || "")];
  const quote = miningMinerRetentionChoiceQuote(miner, choice?.id);
  if (!choice || !quote) return { ok: false, message: "留任处理方案不存在。" };
  if (choice.id === "release") {
    removeMinerFromRoster(mining, miner.id);
    mining.stats.minerDepartures += 1;
    return {
      ok: true,
      departed: true,
      choice,
      miner,
      fee: 0,
      message: `${miner.name}已办理离队，相关固定班组与师徒记录同时退役。`
    };
  }
  if (typeof spendCash !== "function" || !spendCash(player, quote.cost, `矿工留任：${miner.name} · ${choice.name}`, {
    source: "minerRetention",
    itemId: miner.id,
    repEligible: false,
    retentionChoiceId: choice.id
  })) {
    return { ok: false, message: `${choice.name}需要 ¥${quote.cost.toLocaleString("zh-CN")}。`, choice, quote };
  }
  const moraleBefore = miningMinerMoraleInfo(miner).morale;
  miner.morale = Math.max(moraleBefore, choice.moraleFloor);
  miner.contractShiftsRemaining = Math.min(
    MINER_CONTRACT_MAX_SHIFTS,
    miner.contractShiftsRemaining + choice.contractShifts
  );
  miner.retentionCase = null;
  miner.leaveUntil = null;
  miner.lastRetentionAt = now;
  mining.stats.retentionSuccesses += 1;
  mining.stats.retentionSpent += quote.cost;
  return {
    ok: true,
    departed: false,
    choice,
    miner,
    fee: quote.cost,
    moraleBefore,
    moraleAfter: miner.morale,
    message: choice.id === "bonus"
      ? `${miner.name}接受稳岗奖金，士气恢复至 ${miner.morale}，并补充 ${choice.contractShifts} 个合约班次。`
      : `${miner.name}接受留任恳谈，士气恢复至 ${miner.morale}。`
  };
}

export function formMinerMentorship(player, mentorId, apprenticeId, now = Date.now(), { spendCash } = {}) {
  const mining = normalizeMiningPlayer(player);
  const mentor = mining.miners.find((entry) => entry.id === String(mentorId || ""));
  const apprentice = mining.miners.find((entry) => entry.id === String(apprenticeId || ""));
  if (!mentor || !apprentice) return { ok: false, message: "师徒矿工不存在。" };
  if (isMinerBusy(player, mentor.id) || isMinerBusy(player, apprentice.id)) {
    return { ok: false, message: "井下作业中的矿工暂时不能签订带教协议。" };
  }
  if (mentor.retentionCase || apprentice.retentionCase) {
    return { ok: false, message: "请先处理相关矿工的离职申请。" };
  }
  const eligibility = miningMentorshipEligibility(mentor, apprentice, mining.mentorships);
  if (!eligibility.ready) return { ok: false, message: eligibility.reason, eligibility };
  if (typeof spendCash !== "function" || !spendCash(player, eligibility.cost, `矿工带教：${mentor.name} · ${apprentice.name}`, {
    source: "minerMentorship",
    itemId: mentor.id,
    apprenticeId: apprentice.id,
    repEligible: false
  })) {
    return { ok: false, message: `签订带教协议需要 ¥${eligibility.cost.toLocaleString("zh-CN")}。`, eligibility };
  }
  const createdAt = Math.max(1, Math.round(Number(now) || Date.now()));
  const mentorship = {
    id: `${mentor.id}:${apprentice.id}:${createdAt}`,
    mentorId: mentor.id,
    apprenticeId: apprentice.id,
    mentorName: mentor.name,
    apprenticeName: apprentice.name,
    status: "active",
    sharedShifts: 0,
    createdAt,
    lastWorkedAt: null,
    completedAt: null,
    endedAt: null
  };
  mining.mentorships.unshift(mentorship);
  mining.mentorships = mining.mentorships.slice(0, 20);
  mining.stats.mentorshipsFormed += 1;
  mining.stats.mentorshipSpent += eligibility.cost;
  return {
    ok: true,
    fee: eligibility.cost,
    mentorship,
    mentor,
    apprentice,
    message: `${mentor.name}与${apprentice.name}签订带教协议，同班完成 ${MINER_MENTORSHIP_REQUIRED_SHIFTS} 次后结业。`
  };
}

export function endMinerMentorship(player, mentorshipId, now = Date.now()) {
  const mining = normalizeMiningPlayer(player);
  const mentorship = mining.mentorships.find((entry) => entry.id === String(mentorshipId || ""));
  if (!mentorship) return { ok: false, message: "带教记录不存在。" };
  if (mentorship.status !== "active") return { ok: false, message: "该带教关系已经结束。" };
  if (isMinerBusy(player, mentorship.mentorId) || isMinerBusy(player, mentorship.apprenticeId)) {
    return { ok: false, message: "师徒正在井下作业，暂时不能终止带教。" };
  }
  mentorship.status = "ended";
  mentorship.endedAt = Math.max(1, Math.round(Number(now) || Date.now()));
  return {
    ok: true,
    mentorship,
    message: `${mentorship.mentorName}与${mentorship.apprenticeName}的带教关系已经终止。`
  };
}

export function applyMinerMentorshipsForShift(player, minerIds = [], roleAssignments = {}, completedAt = Date.now()) {
  const mining = normalizeMiningPlayer(player);
  const crewIds = new Set((Array.isArray(minerIds) ? minerIds : []).map(String));
  const completedTimestamp = Math.max(1, Math.round(Number(completedAt) || Date.now()));
  const events = [];
  for (const mentorship of mining.mentorships.filter((entry) => entry.status === "active")) {
    if (!crewIds.has(mentorship.mentorId) || !crewIds.has(mentorship.apprenticeId)) continue;
    const mentor = mining.miners.find((entry) => entry.id === mentorship.mentorId);
    const apprentice = mining.miners.find((entry) => entry.id === mentorship.apprenticeId);
    if (!mentor || !apprentice) continue;
    const apprenticeRole = Object.entries(roleAssignments || {})
      .find(([, minerId]) => String(minerId || "") === apprentice.id)?.[0] || null;
    const shiftProgress = apprenticeRole
      ? addSkillExp(apprentice.skills?.[apprenticeRole], MINER_MENTORSHIP_ROLE_EXP)
      : null;
    mentor.morale = clamp(miningMinerMoraleInfo(mentor).morale + MINER_MENTOR_SHIFT_MORALE, 0, 100);
    apprentice.morale = clamp(miningMinerMoraleInfo(apprentice).morale + MINER_APPRENTICE_SHIFT_MORALE, 0, 100);
    mentorship.sharedShifts = Math.min(
      MINER_MENTORSHIP_REQUIRED_SHIFTS,
      Math.max(0, Number(mentorship.sharedShifts) || 0) + 1
    );
    mentorship.lastWorkedAt = completedTimestamp;
    const completed = mentorship.sharedShifts >= MINER_MENTORSHIP_REQUIRED_SHIFTS;
    let completionProgress = null;
    if (completed) {
      mentorship.status = "completed";
      mentorship.completedAt = completedTimestamp;
      mentor.morale = clamp(mentor.morale + MINER_MENTOR_COMPLETION_MORALE, 0, 100);
      apprentice.morale = clamp(apprentice.morale + MINER_APPRENTICE_COMPLETION_MORALE, 0, 100);
      completionProgress = apprenticeRole
        ? addSkillExp(apprentice.skills?.[apprenticeRole], MINER_MENTORSHIP_COMPLETION_EXP)
        : null;
      mining.stats.mentorshipsCompleted += 1;
    }
    events.push({
      mentorshipId: mentorship.id,
      mentorId: mentor.id,
      mentorName: mentor.name,
      apprenticeId: apprentice.id,
      apprenticeName: apprentice.name,
      apprenticeRole,
      sharedShifts: mentorship.sharedShifts,
      completed,
      shiftProgress,
      completionProgress,
      mentorMorale: mentor.morale,
      apprenticeMorale: apprentice.morale
    });
  }
  return events;
}

function addSkillExp(entry, amount) {
  if (!entry || entry.level >= MINER_SKILL_MAX_LEVEL) return null;
  const beforeLevel = entry.level;
  const beforeExp = entry.exp;
  entry.exp = Math.max(0, Number(entry.exp) || 0) + Math.max(0, Number(amount) || 0);
  while (entry.level < MINER_SKILL_MAX_LEVEL && entry.exp >= miningMinerSkillExpTarget(entry.level)) {
    entry.exp -= miningMinerSkillExpTarget(entry.level);
    entry.level += 1;
  }
  if (entry.level >= MINER_SKILL_MAX_LEVEL) entry.exp = 0;
  return {
    beforeLevel,
    beforeExp,
    level: entry.level,
    exp: entry.exp,
    leveled: entry.level > beforeLevel
  };
}

export function trainMiner(player, minerId, trainingId, now = Date.now(), { spendCash } = {}) {
  const mining = normalizeMiningPlayer(player);
  const miner = mining.miners.find((entry) => entry.id === String(minerId || ""));
  if (!miner) return { ok: false, message: "矿工不存在。" };
  const training = MINER_TRAINING_PROGRAMS[String(trainingId || "")];
  if (!training) return { ok: false, message: "训练项目不存在。" };
  if (isMinerBusy(player, miner.id)) return { ok: false, message: `${miner.name}正在井下作业，无法参加训练。` };
  refreshMinerCondition(miner, now);
  const readiness = minerReadiness(miner, now);
  if (!readiness.ok) return { ok: false, message: `${miner.name}${readiness.reason}，暂时不能训练。` };
  const trainedSkill = miner.skills[training.id];
  if (!trainedSkill || trainedSkill.level >= MINER_SKILL_MAX_LEVEL) {
    return { ok: false, message: `${miner.name}的${training.skillLabel}已经达到最高等级。` };
  }
  if (typeof spendCash !== "function" || !spendCash(player, training.cost, `矿工训练：${miner.name} · ${training.name}`, {
    source: "minerTraining",
    itemId: miner.id,
    repEligible: false,
    trainingId: training.id
  })) {
    return { ok: false, message: `${training.name}需要 ¥${training.cost.toLocaleString("zh-CN")}。` };
  }
  const progress = addSkillExp(trainedSkill, training.exp);
  miner.fatigue = clamp(readiness.fatigue + training.fatigue, 0, 100);
  miner.morale = clamp(miner.morale + 1, 0, 100);
  miner.fatigueAt = now;
  miner.lastTrainedAt = now;
  mining.stats.trainingSpent += training.cost;
  mining.stats.trainingSessions += 1;
  return {
    ok: true,
    fee: training.cost,
    miner,
    training,
    progress,
    message: progress.leveled
      ? `${miner.name}完成${training.name}，${training.skillLabel}提升至 Lv.${progress.level}。`
      : `${miner.name}完成${training.name}，${training.skillLabel}经验 +${training.exp}。`
  };
}

export function careForMiner(player, minerId, careId, now = Date.now(), { spendCash } = {}) {
  const mining = normalizeMiningPlayer(player);
  const miner = mining.miners.find((entry) => entry.id === String(minerId || ""));
  if (!miner) return { ok: false, message: "矿工不存在。" };
  const care = MINER_CARE_OPTIONS[String(careId || "")];
  if (!care) return { ok: false, message: "矿工休整项目不存在。" };
  if (isMinerBusy(player, miner.id)) return { ok: false, message: `${miner.name}正在井下作业，无法安排休整。` };
  if (miner.retentionCase) return { ok: false, message: `${miner.name}已提出离职申请，请先处理留任。` };
  refreshMinerCondition(miner, now);
  const fatigueBefore = Math.max(0, Number(miner.fatigue) || 0);
  const moraleBefore = miningMinerMoraleInfo(miner).morale;
  const injuryBefore = Math.max(0, (Number(miner.injuredUntil) || 0) - now);
  if (care.id === "rest" && fatigueBefore < MINER_REST_MIN_FATIGUE) {
    return { ok: false, message: `${miner.name}当前疲劳较低，不需要恢复理疗。` };
  }
  if (care.id === "treatment" && injuryBefore <= 0) {
    return { ok: false, message: `${miner.name}当前没有伤停，无需救治。` };
  }
  if (care.id === "support" && moraleBefore >= MINER_MORALE_CARE_THRESHOLD) {
    return { ok: false, message: `${miner.name}当前士气良好，无需额外安排班组关怀。` };
  }
  if (typeof spendCash !== "function" || !spendCash(player, care.cost, `矿工休整：${miner.name} · ${care.name}`, {
    source: "minerCare",
    itemId: miner.id,
    repEligible: false,
    careId: care.id
  })) {
    return { ok: false, message: `${care.name}需要 ¥${care.cost.toLocaleString("zh-CN")}。` };
  }
  miner.fatigue = Math.max(0, fatigueBefore - care.fatigueRecovery);
  miner.morale = clamp(moraleBefore + (Number(care.moraleRecovery) || 0), 0, 100);
  miner.fatigueAt = now;
  if (care.injuryReductionMs > 0) {
    const injuryAfter = Math.max(0, injuryBefore - care.injuryReductionMs);
    miner.injuredUntil = injuryAfter > 0 ? now + injuryAfter : null;
  }
  miner.lastCaredAt = now;
  mining.stats.careSpent += care.cost;
  mining.stats.careActions += 1;
  mining.stats.moraleRecovered += miner.morale - moraleBefore;
  const injuryAfter = Math.max(0, (Number(miner.injuredUntil) || 0) - now);
  return {
    ok: true,
    fee: care.cost,
    miner,
    care,
    fatigueBefore,
    fatigueAfter: miner.fatigue,
    moraleBefore,
    moraleAfter: miner.morale,
    injuryBefore,
    injuryAfter,
    message: care.id === "support"
      ? `${miner.name}完成班组关怀，士气提升至 ${miner.morale}。`
      : care.id === "treatment"
      ? injuryAfter > 0
        ? `${miner.name}完成伤停救治，休养时间缩短 6 小时。`
        : `${miner.name}完成伤停救治，已经可以重新排班。`
      : `${miner.name}完成恢复理疗，疲劳降至 ${Math.round(miner.fatigue)}。`
  };
}

export function specializeMiner(player, minerId, specializationId, now = Date.now()) {
  const mining = normalizeMiningPlayer(player);
  const miner = mining.miners.find((entry) => entry.id === String(minerId || ""));
  if (!miner) return { ok: false, message: "矿工不存在。" };
  if (isMinerBusy(player, miner.id)) {
    return { ok: false, message: `${miner.name}正在井下作业，无法确定职业专精。` };
  }
  if (miner.retentionCase) return { ok: false, message: `${miner.name}已提出离职申请，请先处理留任。` };
  const eligibility = miningMinerSpecializationEligibility(miner, specializationId);
  if (!eligibility.ready) return { ok: false, message: eligibility.reason, eligibility };
  miner.specializationId = eligibility.specialization.id;
  miner.specializedAt = now;
  return {
    ok: true,
    miner,
    specialization: eligibility.specialization,
    message: `${miner.name}已成为${eligibility.specialization.name}，永久获得${eligibility.specialization.skillLabel} +${MINER_SPECIALIZATION_BONUS}。`
  };
}

export function renewMinerContract(player, minerId, now = Date.now(), { spendCash } = {}) {
  const mining = normalizeMiningPlayer(player);
  const miner = mining.miners.find((entry) => entry.id === String(minerId || ""));
  if (!miner) return { ok: false, message: "矿工不存在。" };
  if (isMinerBusy(player, miner.id)) {
    return { ok: false, message: `${miner.name}正在井下作业，暂时不能办理续约。` };
  }
  if (miner.retentionCase) return { ok: false, message: `${miner.name}已提出离职申请，请通过留任方案处理。` };
  const contract = miningMinerContractInfo(miner);
  if (!contract.canRenew) {
    return { ok: false, message: `${miner.name}当前仍有 ${contract.remaining} 个合约班次，无需提前续约。`, contract };
  }
  if (typeof spendCash !== "function" || !spendCash(player, contract.renewalCost, `矿工续约：${miner.name}`, {
    source: "minerContractRenewal",
    itemId: miner.id,
    repEligible: false,
    renewalShifts: MINER_CONTRACT_RENEWAL_SHIFTS
  })) {
    return { ok: false, message: `${miner.name}续约需要 ¥${contract.renewalCost.toLocaleString("zh-CN")}。`, contract };
  }
  miner.contractShiftsRemaining = Math.min(
    MINER_CONTRACT_MAX_SHIFTS,
    contract.remaining + MINER_CONTRACT_RENEWAL_SHIFTS
  );
  miner.morale = clamp(miner.morale + 8, 0, 100);
  miner.contractRenewals += 1;
  miner.lastContractRenewedAt = now;
  mining.stats.contractSpent += contract.renewalCost;
  mining.stats.contractRenewals += 1;
  return {
    ok: true,
    fee: contract.renewalCost,
    miner,
    contract: miningMinerContractInfo(miner),
    message: `${miner.name}已续约 ${MINER_CONTRACT_RENEWAL_SHIFTS} 个矿山班次，当前可工作 ${miner.contractShiftsRemaining} 班。`
  };
}

export function promoteMiner(player, minerId, now = Date.now(), { spendCash } = {}) {
  const mining = normalizeMiningPlayer(player);
  const miner = mining.miners.find((entry) => entry.id === String(minerId || ""));
  if (!miner) return { ok: false, message: "矿工不存在。" };
  if (isMinerBusy(player, miner.id)) {
    return { ok: false, message: `${miner.name}正在井下作业，暂时不能参加晋升评定。` };
  }
  if (miner.retentionCase) return { ok: false, message: `${miner.name}已提出离职申请，请先处理留任。` };
  const promotion = miningMinerPromotionInfo(miner);
  if (!promotion.ready) {
    return { ok: false, message: `${miner.name}${promotion.reason}`, promotion };
  }
  if (typeof spendCash !== "function" || !spendCash(player, promotion.promotionCost, `矿工晋升：${miner.name} · T${promotion.targetTier}`, {
    source: "minerPromotion",
    itemId: miner.id,
    targetTier: promotion.targetTier,
    repEligible: false
  })) {
    return {
      ok: false,
      message: `${miner.name}晋升评定需要 ¥${promotion.promotionCost.toLocaleString("zh-CN")}。`,
      promotion
    };
  }
  miner.tier = promotion.targetTier;
  miner.baseWage = minerBaseWage(miner.tier);
  miner.morale = clamp(miner.morale + 10, 0, 100);
  miner.promotions += 1;
  miner.lastPromotedAt = now;
  mining.stats.promotionSpent += promotion.promotionCost;
  mining.stats.promotions += 1;
  return {
    ok: true,
    fee: promotion.promotionCost,
    miner,
    previousTier: promotion.tier,
    targetTier: promotion.targetTier,
    promotion: miningMinerPromotionInfo(miner),
    message: `${miner.name}已晋升为 T${miner.tier} 矿工，三项井下能力获得 +${promotion.targetSkillBonus.toFixed(1)} 评级加成，班薪基准调整为 ¥${miner.baseWage.toLocaleString("zh-CN")}。`
  };
}

export function recordMinerShift(miner) {
  if (!miner) return 0;
  normalizeMinerState(miner);
  miner.shiftsWorked += 1;
  miner.contractShiftsRemaining = Math.max(0, miner.contractShiftsRemaining - 1);
  return miner.shiftsWorked;
}

export function grantMiningExperience(miner, strategyId = "standard") {
  if (!miner?.skills) return;
  addSkillExp(miner.skills.prospecting, strategyId === "deep" ? 9 : 6);
  addSkillExp(miner.skills.extraction, strategyId === "steady" ? 7 : 8);
  addSkillExp(miner.skills.safety, strategyId === "deep" ? 9 : 6);
}

export function grantMiningRoleExperience(miner, roleKey, amount) {
  const skill = miner?.skills?.[String(roleKey || "")];
  if (!skill) return null;
  return addSkillExp(skill, amount);
}
