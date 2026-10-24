/**
 * Validation for shared mining rounds, leases, applications and tuning history.
 */
import {
  MINING_CLUE_TARGET,
  MINING_BASIC_MAX_CREW,
  MINING_BASIC_MIN_CREW,
  MINING_BASIC_MINE_GRADES,
  MINING_CREW_BOND_MAX_LEVEL,
  MINING_FACILITY_IDS,
  MINING_FACILITY_MAX_LEVEL,
  MINING_FOREMAN_BONUS,
  MINING_MASTERY_MAX_LEVEL,
  MINER_SKILL_MAX_LEVEL,
  MINING_MAX_SURVEY_REPORTS,
  MINING_MAX_PREPARATIONS,
  MINING_TUNING_MULTIPLIER_MAX,
  MINING_TUNING_MULTIPLIER_MIN,
  MINING_TUNING_VERSION_MAX_RECORDS,
  MINING_SHIFT_INCIDENTS,
  MINING_SHIFT_INCENTIVES,
  MINING_SHIFT_ROLES,
  MINER_CONTRACT_MAX_SHIFTS,
  MINER_MENTORSHIP_REQUIRED_SHIFTS,
  MINER_MAX_TIER,
  MINER_SPECIALIZATIONS,
  MINER_SPECIALIZATION_REQUIRED_LEVEL,
  MINER_SPECIALIZATION_REQUIRED_SHIFTS,
  miningCrewKey,
  miningMineById,
  miningShiftIncidentChoice
} from "../../shared/domain/mining/mining-rules.js";


import {
  requireCanonicalId,
  validateUniqueRecordIds,
  validateUniqueRecordField,
  requireArrayField,
  normalizeNonNegativeNumber,
  normalizeNonNegativeInteger,
  normalizeOptionalTimestamp,
  validateTimeOrder
} from "./world-schema-utils.js";

function validateMiningCompetitionStats(stats, label) {
  if (stats == null) return;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    throw new Error(`world-store: ${label} must be an object`);
  }
  const rosterSize = normalizeNonNegativeInteger(stats, "rosterSize", label);
  const applicantCount = normalizeNonNegativeInteger(stats, "applicantCount", label);
  const winnerCount = normalizeNonNegativeInteger(stats, "winnerCount", label);
  const missedCount = normalizeNonNegativeInteger(stats, "missedCount", label);
  const skippedCount = normalizeNonNegativeInteger(stats, "skippedCount", label);
  normalizeNonNegativeInteger(stats, "priorityApplicantCount", label);
  normalizeNonNegativeInteger(stats, "priorityWinnerCount", label);
  normalizeNonNegativeInteger(stats, "fallbackWinnerCount", label);
  const releasedCount = normalizeNonNegativeInteger(stats, "rosterReleasedCount", label);
  normalizeOptionalTimestamp(stats, "settledAt", label);
  if (applicantCount > rosterSize || winnerCount > applicantCount || missedCount > applicantCount) {
    throw new Error(`world-store: ${label} contains impossible applicant totals`);
  }
  if (skippedCount > rosterSize || releasedCount > rosterSize) {
    throw new Error(`world-store: ${label} contains impossible roster totals`);
  }
}

export function validateMiningWorld(mining) {
  if (mining == null) return;
  if (!mining || typeof mining !== "object" || Array.isArray(mining)) {
    throw new Error("world-store: snapshot.mining must be an object");
  }
  normalizeOptionalTimestamp(mining, "unlockedAt", "snapshot.mining");
  requireArrayField(mining, "founderPlayerIds", "snapshot.mining");
  if (mining.tuningReviewerPlayerId != null) {
    mining.tuningReviewerPlayerId = requireCanonicalId(
      mining.tuningReviewerPlayerId,
      "snapshot.mining.tuningReviewerPlayerId"
    );
  }
  const applications = requireArrayField(mining, "applications", "snapshot.mining");
  validateUniqueRecordIds(applications, "snapshot.mining.applications");
  for (let index = 0; index < applications.length; index += 1) {
    const label = `snapshot.mining.applications[${index}]`;
    normalizeNonNegativeNumber(applications[index], "escrow", label);
    normalizeNonNegativeInteger(applications[index], "targetRound", label);
    normalizeOptionalTimestamp(applications[index], "submittedAt", label);
    requireArrayField(applications[index], "preferences", label);
  }
  const history = requireArrayField(mining, "history", "snapshot.mining");
  for (let index = 0; index < history.length; index += 1) {
    const historyRound = history[index];
    if (!historyRound || typeof historyRound !== "object" || Array.isArray(historyRound)) continue;
    validateMiningCompetitionStats(
      historyRound.competitionStats,
      `snapshot.mining.history[${index}].competitionStats`
    );
  }
  const tuningVersionIds = new Set();
  if (mining.tuningVersions != null) {
    const versions = requireArrayField(mining, "tuningVersions", "snapshot.mining");
    if (versions.length > MINING_TUNING_VERSION_MAX_RECORDS) {
      throw new Error("world-store: snapshot.mining.tuningVersions exceeds the audit history limit");
    }
    validateUniqueRecordIds(versions, "snapshot.mining.tuningVersions");
    for (let index = 0; index < versions.length; index += 1) {
      const version = versions[index];
      const label = `snapshot.mining.tuningVersions[${index}]`;
      tuningVersionIds.add(String(version.id));
      normalizeNonNegativeInteger(version, "number", label);
      normalizeNonNegativeInteger(version, "scheduledRoundNumber", label);
      normalizeOptionalTimestamp(version, "createdAt", label);
      normalizeOptionalTimestamp(version, "activatedAt", label);
      normalizeOptionalTimestamp(version, "cancelledAt", label);
      if (!["scheduled", "active", "superseded", "cancelled"].includes(version.status)) {
        throw new Error(`world-store: ${label}.status is invalid`);
      }
      if (!version.rules || typeof version.rules !== "object" || Array.isArray(version.rules)) {
        throw new Error(`world-store: ${label}.rules must be an object`);
      }
      if (version.effectResult != null) {
        const effect = version.effectResult;
        const effectLabel = `${label}.effectResult`;
        if (!effect || typeof effect !== "object" || Array.isArray(effect)) {
          throw new Error(`world-store: ${effectLabel} must be an object`);
        }
        if (!["complete", "insufficient", "interrupted"].includes(effect.status)) {
          throw new Error(`world-store: ${effectLabel}.status is invalid`);
        }
        normalizeOptionalTimestamp(effect, "finalizedAt", effectLabel);
        normalizeNonNegativeInteger(effect, "observedRoundCount", effectLabel);
        normalizeNonNegativeInteger(effect, "observedShiftCount", effectLabel);
        requireArrayField(effect, "observedRoundNumbers", effectLabel);
        requireArrayField(effect, "rows", effectLabel);
        if (!effect.assessment || typeof effect.assessment !== "object" || Array.isArray(effect.assessment)) {
          throw new Error(`world-store: ${effectLabel}.assessment must be an object`);
        }
      }
      for (const [beltId, rule] of Object.entries(version.rules)) {
        requireCanonicalId(beltId, `${label}.rules belt id`);
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
          throw new Error(`world-store: ${label}.rules.${beltId} must be an object`);
        }
        for (const key of ["rentMultiplier", "outputMultiplier"]) {
          const value = Number(rule[key]);
          if (!Number.isFinite(value) || value < MINING_TUNING_MULTIPLIER_MIN || value > MINING_TUNING_MULTIPLIER_MAX) {
            throw new Error(`world-store: ${label}.rules.${beltId}.${key} is outside the safe range`);
          }
        }
      }
    }
  }
  if (mining.activeTuningVersionId != null) {
    const activeVersionId = requireCanonicalId(mining.activeTuningVersionId, "snapshot.mining.activeTuningVersionId");
    if (!tuningVersionIds.has(activeVersionId)) {
      throw new Error("world-store: snapshot.mining.activeTuningVersionId must reference a retained version");
    }
  }
  const round = mining.currentRound;
  if (round == null) return;
  if (!round || typeof round !== "object" || Array.isArray(round)) {
    throw new Error("world-store: snapshot.mining.currentRound must be an object");
  }
  validateTimeOrder(round, "startsAt", "endsAt", "snapshot.mining.currentRound");
  normalizeOptionalTimestamp(round, "allocatedAt", "snapshot.mining.currentRound");
  normalizeNonNegativeInteger(round, "number", "snapshot.mining.currentRound");
  if (round.tuningVersionId != null) {
    const tuningVersionId = requireCanonicalId(round.tuningVersionId, "snapshot.mining.currentRound.tuningVersionId");
    if (!tuningVersionIds.has(tuningVersionId)) {
      throw new Error("world-store: snapshot.mining.currentRound.tuningVersionId must reference a retained version");
    }
  }
  validateMiningCompetitionStats(round.competitionStats, "snapshot.mining.currentRound.competitionStats");
  const leases = requireArrayField(round, "leases", "snapshot.mining.currentRound");
  validateUniqueRecordIds(leases, "snapshot.mining.currentRound.leases");
  validateUniqueRecordField(leases, "mineId", "snapshot.mining.currentRound.leases");
  for (let index = 0; index < leases.length; index += 1) {
    const label = `snapshot.mining.currentRound.leases[${index}]`;
    validateTimeOrder(leases[index], "startsAt", "endsAt", label);
    normalizeNonNegativeNumber(leases[index], "rent", label);
    normalizeNonNegativeInteger(leases[index], "shiftsStarted", label);
    normalizeNonNegativeInteger(leases[index], "maxShifts", label);
  }
}


