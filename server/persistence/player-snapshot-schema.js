/**
 * Validation for persisted player state and player-owned mining state.
 */
import { isValidScratchReveal } from "../../shared/domain/workshop/delivery-scratch.js";
import { validatePlayerEconomy } from "./economy-snapshot-schema.js";
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
  validateTimeOrder,
  validateAmountRows,
  registerOwnedItem
} from "./world-schema-utils.js";

function validateMinerSkills(miner, label) {
  if (miner.skills == null) return;
  if (!miner.skills || typeof miner.skills !== "object" || Array.isArray(miner.skills)) {
    throw new Error(`world-store: ${label}.skills must be an object`);
  }
  for (const skillId of ["prospecting", "extraction", "safety"]) {
    const skill = miner.skills[skillId];
    if (skill == null) continue;
    if (!skill || typeof skill !== "object" || Array.isArray(skill)) {
      throw new Error(`world-store: ${label}.skills.${skillId} must be an object`);
    }
    const skillLabel = `${label}.skills.${skillId}`;
    const level = normalizeNonNegativeInteger(skill, "level", skillLabel, {
      optional: true,
      max: MINER_SKILL_MAX_LEVEL
    });
    if (level != null && level < 1) {
      throw new Error(`world-store: ${skillLabel}.level must be between 1 and ${MINER_SKILL_MAX_LEVEL}`);
    }
    normalizeNonNegativeInteger(skill, "exp", skillLabel, { optional: true });
  }
}

function validateMinerSpecialization(miner, label, { candidate = false } = {}) {
  const shiftsWorked = normalizeNonNegativeInteger(miner, "shiftsWorked", label, { optional: true }) ?? 0;
  const rawSpecializationId = miner.specializationId;
  if (rawSpecializationId == null) {
    if (miner.specializedAt != null) {
      throw new Error(`world-store: ${label}.specializedAt requires a specializationId`);
    }
    return;
  }
  if (candidate) {
    throw new Error(`world-store: ${label} cannot have a specialization before recruitment`);
  }
  const specializationId = requireCanonicalId(rawSpecializationId, `${label}.specializationId`);
  const specialization = MINER_SPECIALIZATIONS[specializationId];
  if (!specialization) {
    throw new Error(`world-store: ${label}.specializationId is invalid`);
  }
  if (shiftsWorked < MINER_SPECIALIZATION_REQUIRED_SHIFTS) {
    throw new Error(`world-store: ${label}.shiftsWorked is below its specialization requirement`);
  }
  const skillLevel = Number(miner.skills?.[specialization.skill]?.level) || 0;
  if (skillLevel < MINER_SPECIALIZATION_REQUIRED_LEVEL) {
    throw new Error(`world-store: ${label}.skills.${specialization.skill}.level is below its specialization requirement`);
  }
  const specializedAt = normalizeOptionalTimestamp(miner, "specializedAt", label);
  if (!specializedAt) {
    throw new Error(`world-store: ${label}.specializedAt is required for a specialization`);
  }
}

function validateMinerContract(miner, label, { candidate = false } = {}) {
  normalizeNonNegativeInteger(miner, "contractShiftsRemaining", label, {
    optional: true,
    max: MINER_CONTRACT_MAX_SHIFTS
  });
  const renewals = normalizeNonNegativeInteger(miner, "contractRenewals", label, { optional: true }) ?? 0;
  const renewedAt = normalizeOptionalTimestamp(miner, "lastContractRenewedAt", label);
  if (candidate && (renewals > 0 || renewedAt != null)) {
    throw new Error(`world-store: ${label} cannot have contract renewals before recruitment`);
  }
}

function validateMinerPromotion(miner, label, { candidate = false } = {}) {
  const tier = normalizeNonNegativeInteger(miner, "tier", label, {
    optional: true,
    max: MINER_MAX_TIER
  });
  if (tier != null && tier < 1) {
    throw new Error(`world-store: ${label}.tier must be between 1 and ${MINER_MAX_TIER}`);
  }
  const promotions = normalizeNonNegativeInteger(miner, "promotions", label, { optional: true }) ?? 0;
  const promotedAt = normalizeOptionalTimestamp(miner, "lastPromotedAt", label);
  if (candidate && (promotions > 0 || promotedAt != null)) {
    throw new Error(`world-store: ${label} cannot have promotions before recruitment`);
  }
  if (promotions > 0 && promotedAt == null) {
    throw new Error(`world-store: ${label}.lastPromotedAt is required after a promotion`);
  }
  if (promotions === 0 && promotedAt != null) {
    throw new Error(`world-store: ${label}.lastPromotedAt requires at least one promotion`);
  }
  if (tier != null && promotions > tier - 1) {
    throw new Error(`world-store: ${label}.promotions cannot exceed its tier progression`);
  }
}

function validateMinerRetention(miner, label, { candidate = false } = {}) {
  normalizeOptionalTimestamp(miner, "leaveUntil", label);
  normalizeOptionalTimestamp(miner, "lastRetentionAt", label);
  if (miner.retentionCase == null) return;
  if (candidate) throw new Error(`world-store: ${label} cannot have a retention case before recruitment`);
  if (!miner.retentionCase || typeof miner.retentionCase !== "object" || Array.isArray(miner.retentionCase)) {
    throw new Error(`world-store: ${label}.retentionCase must be an object`);
  }
  requireCanonicalId(miner.retentionCase.id, `${label}.retentionCase.id`);
  normalizeNonNegativeInteger(miner.retentionCase, "createdAt", `${label}.retentionCase`);
  normalizeNonNegativeInteger(miner.retentionCase, "moraleAtNotice", `${label}.retentionCase`, { max: 100 });
}

function validateMiningFacilities(facilities, label, { optional = true } = {}) {
  if (facilities == null && optional) return;
  if (!facilities || typeof facilities !== "object" || Array.isArray(facilities)) {
    throw new Error(`world-store: ${label} must be an object`);
  }
  for (const facilityId of MINING_FACILITY_IDS) {
    normalizeNonNegativeInteger(
      facilities,
      facilityId,
      label,
      { optional: true, max: MINING_FACILITY_MAX_LEVEL }
    );
  }
}


export function validatePlayerState(player, playerId, ownedItems) {
  const playerLabel = `player ${playerId}`;
  normalizeNonNegativeNumber(player, "cash", playerLabel);
  for (const field of ["lastSeenAt", "lastRepDecayAt", "taskRefreshedAt"]) {
    normalizeOptionalTimestamp(player, field, playerLabel);
  }
  for (const field of [
    "exp",
    "achievementPoints",
    "achievementPointsBonus",
    "soldCount",
    "bmRatingSampleCount",
    "taskResetCount"
  ]) {
    normalizeNonNegativeInteger(player, field, playerLabel, { optional: true });
  }

  if (player.stats != null) {
    if (!player.stats || typeof player.stats !== "object" || Array.isArray(player.stats)) {
      throw new Error(`world-store: ${playerLabel}.stats must be an object`);
    }
    for (const field of [
      "cutCount", "sliceCount", "splitCount", "craftCount", "orderCount",
      "tradeCount", "livestreamSales", "windowOpens", "finishedMade",
      "craftDone", "hireCount", "auctionWins", "bmDeals", "badCutCount", "cashPeak"
    ]) {
      normalizeNonNegativeInteger(player.stats, field, `${playerLabel}.stats`, { optional: true });
    }
  }

  if (player.orderRefreshCounts != null) {
    if (
      !player.orderRefreshCounts
      || typeof player.orderRefreshCounts !== "object"
      || Array.isArray(player.orderRefreshCounts)
    ) {
      throw new Error(`world-store: ${playerLabel}.orderRefreshCounts must be an object`);
    }
    for (const field of ["single", "batch"]) {
      normalizeNonNegativeInteger(
        player.orderRefreshCounts,
        field,
        `${playerLabel}.orderRefreshCounts`,
        { optional: true }
      );
    }
  }

  if (player.externalMaterials != null) {
    if (
      !player.externalMaterials
      || typeof player.externalMaterials !== "object"
      || Array.isArray(player.externalMaterials)
    ) {
      throw new Error(`world-store: ${playerLabel}.externalMaterials must be an object`);
    }
    for (const materialKey of Object.keys(player.externalMaterials)) {
      normalizeNonNegativeNumber(
        player.externalMaterials,
        materialKey,
        `${playerLabel}.externalMaterials`
      );
    }
  }

  validateAmountRows(player, "payouts", playerLabel);
  validateAmountRows(player, "blackPayouts", playerLabel);
  validateAmountRows(player, "auctionEscrow", playerLabel);

  if (player.recovery != null) {
    if (!player.recovery || typeof player.recovery !== "object" || Array.isArray(player.recovery)) {
      throw new Error(`world-store: ${playerLabel}.recovery must be an object`);
    }
    for (const field of ["debt", "repaidTotal"]) {
      normalizeNonNegativeNumber(player.recovery, field, `${playerLabel}.recovery`, { optional: true });
    }
    normalizeOptionalTimestamp(player.recovery, "lastGrantedAt", `${playerLabel}.recovery`);
    normalizeNonNegativeInteger(player.recovery, "grantCount", `${playerLabel}.recovery`, {
      optional: true
    });
  }

  const tasks = requireArrayField(player, "tasks", playerLabel);
  validateUniqueRecordField(tasks, "uid", `${playerLabel}.tasks`);
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const taskLabel = `${playerLabel}.tasks[${index}]`;
    const target = normalizeNonNegativeInteger(task, "target", taskLabel);
    const progress = normalizeNonNegativeInteger(task, "progress", taskLabel);
    normalizeNonNegativeInteger(task, "reward", taskLabel);
    normalizeNonNegativeInteger(task, "exp", taskLabel, { optional: true });
    if (!["active", "complete", "claimed"].includes(task.status)) {
      throw new Error(`world-store: ${taskLabel}.status is invalid`);
    }
    if (progress > target) {
      throw new Error(`world-store: ${taskLabel}.progress must not exceed target`);
    }
    if (task.status === "active" && progress >= target) {
      throw new Error(`world-store: ${taskLabel} completed progress must not remain active`);
    }
    if (task.status !== "active" && progress < target) {
      throw new Error(`world-store: ${taskLabel} incomplete progress cannot be ${task.status}`);
    }
  }

  for (const bucket of ["rough", "materials", "slices", "bracelets", "collection"]) {
    const items = requireArrayField(player, bucket, `player ${playerId}`);
    for (let index = 0; index < items.length; index += 1) {
      registerOwnedItem(ownedItems, items[index], `player ${playerId}.${bucket}[${index}]`);
    }
  }

  for (const field of ["jobs", "polishingJobs"]) {
    const jobs = requireArrayField(player, field, `player ${playerId}`);
    validateUniqueRecordIds(jobs, `player ${playerId}.${field}`);
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      const jobLabel = `${playerLabel}.${field}[${index}]`;
      const startedAt = normalizeOptionalTimestamp(job, "startedAt", jobLabel);
      const readyAt = normalizeNonNegativeInteger(job, "readyAt", jobLabel);
      normalizeNonNegativeNumber(job, "fee", jobLabel, { optional: true });
      if (startedAt != null && readyAt < startedAt) {
        throw new Error(`world-store: ${jobLabel}.readyAt must not be before startedAt`);
      }
      const item = job.item || job.rough;
      if (item) registerOwnedItem(ownedItems, item, `player ${playerId}.${field}[${index}]`);
    }
  }

  const deliveries = requireArrayField(player, "workshopDeliveries", playerLabel);
  validateUniqueRecordIds(deliveries, `${playerLabel}.workshopDeliveries`);
  for (let index = 0; index < deliveries.length; index += 1) {
    const delivery = deliveries[index];
    const label = `${playerLabel}.workshopDeliveries[${index}]`;
    normalizeOptionalTimestamp(delivery, "completedAt", label);
    normalizeOptionalTimestamp(delivery, "revealedAt", label);
    if (!["opening", "carving", "finishing"].includes(delivery.stage)) throw new Error(`world-store: ${label}.stage is invalid`);
    for (const field of ["items", "auxiliaryItems"]) {
      for (const item of requireArrayField(delivery, field, label)) registerOwnedItem(ownedItems, item, `${label}.${field}`);
    }
    if (!delivery.items.length && !delivery.auxiliaryItems.length) throw new Error(`world-store: ${label} has no outputs`);
    if (delivery.scratchReveal != null && !isValidScratchReveal(delivery)) throw new Error(`world-store: ${label}.scratchReveal is invalid`);
  }

  const orders = requireArrayField(player, "orders", `player ${playerId}`);
  validateUniqueRecordIds(orders, `player ${playerId}.orders`);
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    const orderLabel = `${playerLabel}.orders[${index}]`;
    normalizeOptionalTimestamp(order, "expiresAt", orderLabel);
    normalizeNonNegativeNumber(order, "pay", orderLabel, { optional: true });
    normalizeNonNegativeInteger(order, "quantity", orderLabel, { optional: true });
  }

  const legacyLivestreamJobs = requireArrayField(player, "livestreamJobs", `player ${playerId}`);
  for (let index = 0; index < legacyLivestreamJobs.length; index += 1) {
    const product = legacyLivestreamJobs[index]?.product;
    if (product) {
      registerOwnedItem(
        ownedItems,
        product,
        `player ${playerId}.livestreamJobs[${index}]`
      );
    }
  }

  const room = player.livestreamRoom;
  if (room != null) {
    if (!room || typeof room !== "object" || Array.isArray(room)) {
      throw new Error(`world-store: player ${playerId}.livestreamRoom must be an object`);
    }
    const roomItems = requireArrayField(room, "items", `player ${playerId}.livestreamRoom`);
    validateUniqueRecordIds(roomItems, `player ${playerId}.livestreamRoom.items`);
    const roomLabel = `${playerLabel}.livestreamRoom`;
    const roomStartedAt = normalizeNonNegativeInteger(room, "startedAt", roomLabel);
    for (const field of ["endsAt", "hardEndsAt", "lastActivityAt", "nextAiVisitAt"]) {
      const timestamp = normalizeNonNegativeInteger(room, field, roomLabel);
      if (["endsAt", "hardEndsAt"].includes(field) && timestamp < roomStartedAt) {
        throw new Error(`world-store: ${roomLabel}.${field} must not be before startedAt`);
      }
    }
    for (const field of ["likes", "totalSales", "totalRevenue"]) {
      normalizeNonNegativeInteger(room, field, roomLabel, { optional: true });
    }
    for (let index = 0; index < roomItems.length; index += 1) {
      normalizeNonNegativeNumber(roomItems[index], "price", `${roomLabel}.items[${index}]`);
      normalizeNonNegativeNumber(roomItems[index], "costValue", `${roomLabel}.items[${index}]`, {
        optional: true
      });
      registerOwnedItem(
        ownedItems,
        roomItems[index].product,
        `player ${playerId}.livestreamRoom.items[${index}]`
      );
    }
  }

  const workshop = player.workshop;
  validatePlayerEconomy(player, playerLabel);
  let workerIds = new Set();
  if (workshop != null) {
    if (!workshop || typeof workshop !== "object" || Array.isArray(workshop)) {
      throw new Error(`world-store: player ${playerId}.workshop must be an object`);
    }
    const devices = requireArrayField(workshop, "devices", `player ${playerId}.workshop`);
    const workers = requireArrayField(workshop, "workers", `player ${playerId}.workshop`);
    validateUniqueRecordIds(devices, `player ${playerId}.workshop.devices`);
    workerIds = validateUniqueRecordIds(workers, `player ${playerId}.workshop.workers`);
    for (let index = 0; index < devices.length; index += 1) {
      const deviceLabel = `${playerLabel}.workshop.devices[${index}]`;
      // Locked black-market references are registered by the stall validator.
      if (!devices[index].blackmarketListingId) registerOwnedItem(ownedItems, devices[index], deviceLabel);
      normalizeNonNegativeNumber(devices[index], "condition", deviceLabel, { optional: true });
      if (Number(devices[index].condition) > 100) throw new Error(`world-store: ${deviceLabel}.condition must not exceed 100`);
      for (const field of ["fee", "basePrice", "capacity"]) {
        normalizeNonNegativeNumber(devices[index], field, deviceLabel, { optional: true });
      }
    }
    for (let index = 0; index < workers.length; index += 1) {
      if (!workers[index].blackmarketListingId && !/^worker-(opening|carving|polishing|finishing)$/.test(workers[index].id)) {
        registerOwnedItem(ownedItems, workers[index], `${playerLabel}.workshop.workers[${index}]`);
      }
      normalizeOptionalTimestamp(workers[index], "payrollAt", `${playerLabel}.workshop.workers[${index}]`);
      normalizeNonNegativeNumber(
        workers[index],
        "baseWage",
        `${playerLabel}.workshop.workers[${index}]`,
        { optional: true }
      );
    }
  }

  if (player.employeePayroll != null) {
    if (typeof player.employeePayroll !== "object" || Array.isArray(player.employeePayroll)) {
      throw new Error(`world-store: ${playerLabel}.employeePayroll must be an object`);
    }
    for (const field of ["debt", "accruedTotal", "paidTotal"]) {
      normalizeNonNegativeInteger(player.employeePayroll, field, `${playerLabel}.employeePayroll`);
    }
    for (const field of ["policyVersion", "sequence", "debtSince", "graceEndsAt", "stoppedAt", "businessDay", "graceDay", "migratedAt", "legacyDebtCleared", "forgivenTotal"]) {
      normalizeNonNegativeInteger(player.employeePayroll, field, `${playerLabel}.employeePayroll`, { optional: true });
    }
    if (player.employeePayroll.status != null && !["active", "grace", "stopped"].includes(player.employeePayroll.status)) {
      throw new Error(`world-store: ${playerLabel}.employeePayroll.status is invalid`);
    }
    const bill = player.employeePayroll.currentBill;
    if (bill != null) {
      const billLabel = `${playerLabel}.employeePayroll.currentBill`;
      if (typeof bill !== "object" || Array.isArray(bill)) throw new Error(`world-store: ${billLabel} must be an object`);
      normalizeNonNegativeInteger(bill, "day", billLabel);
      const entries = requireArrayField(bill, "entries", billLabel);
      const workerIds = new Set();
      for (const entry of entries) {
        if (!entry || typeof entry.workerId !== "string" || !entry.workerId || workerIds.has(entry.workerId)) {
          throw new Error(`world-store: ${billLabel} has invalid/duplicate workerId`);
        }
        workerIds.add(entry.workerId);
        for (const field of ["dailyWage", "days", "amount", "from", "through"]) normalizeNonNegativeInteger(entry, field, billLabel);
        if (entry.days !== 1 || entry.amount !== entry.dailyWage || entry.from !== bill.day
          || entry.through !== bill.day + 86400000 || typeof entry.booked !== "boolean") {
          throw new Error(`world-store: ${billLabel} has invalid daily wage snapshot`);
        }
      }
    }
  }

  const candidates = requireArrayField(player, "recruitCandidates", `player ${playerId}`);
  const candidateIds = validateUniqueRecordIds(candidates, `player ${playerId}.recruitCandidates`);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidateLabel = `${playerLabel}.recruitCandidates[${index}]`;
    normalizeNonNegativeNumber(candidates[index], "price", candidateLabel, { optional: true });
    normalizeNonNegativeNumber(candidates[index], "baseWage", candidateLabel, { optional: true });
  }
  for (const candidateId of candidateIds) {
    if (workerIds.has(candidateId)) {
      throw new Error(`world-store: recruit candidate ${candidateId} is already a hired worker`);
    }
  }

  const mining = player.mining;
  if (mining != null) {
    if (!mining || typeof mining !== "object" || Array.isArray(mining)) {
      throw new Error(`world-store: ${playerLabel}.mining must be an object`);
    }
    normalizeOptionalTimestamp(mining, "licenseAt", `${playerLabel}.mining`);
    normalizeOptionalTimestamp(mining, "competitionSuspendedUntil", `${playerLabel}.mining`);
    normalizeOptionalTimestamp(mining, "competitionQueueAt", `${playerLabel}.mining`);
    if (mining.starterMinerGranted != null && typeof mining.starterMinerGranted !== "boolean") {
      throw new Error(`world-store: ${playerLabel}.mining.starterMinerGranted must be a boolean`);
    }
    normalizeNonNegativeInteger(mining, "missedRounds", `${playerLabel}.mining`, { optional: true });
    normalizeNonNegativeInteger(mining, "skippedApplicationRounds", `${playerLabel}.mining`, { optional: true });
    if (mining.lastRosterReleaseRound != null) {
      normalizeNonNegativeInteger(mining, "lastRosterReleaseRound", `${playerLabel}.mining`);
    }
    validateMiningFacilities(mining.facilities, `${playerLabel}.mining.facilities`);
    if (mining.mineRecords != null) {
      if (!mining.mineRecords || typeof mining.mineRecords !== "object" || Array.isArray(mining.mineRecords)) {
        throw new Error(`world-store: ${playerLabel}.mining.mineRecords must be an object`);
      }
      for (const [mineId, record] of Object.entries(mining.mineRecords)) {
        requireCanonicalId(mineId, `${playerLabel}.mining.mineRecords mine id`);
        if (!miningMineById(mineId)) {
          throw new Error(`world-store: ${playerLabel}.mining.mineRecords contains unknown mine ${mineId}`);
        }
        const label = `${playerLabel}.mining.mineRecords.${mineId}`;
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          throw new Error(`world-store: ${label} must be an object`);
        }
        normalizeNonNegativeInteger(record, "shifts", label, { optional: true });
        normalizeNonNegativeInteger(record, "roughs", label, { optional: true });
        normalizeNonNegativeNumber(record, "totalMass", label, { optional: true });
        normalizeNonNegativeInteger(record, "accidents", label, { optional: true });
        normalizeNonNegativeInteger(record, "clueProgress", label, { optional: true, max: MINING_CLUE_TARGET - 1 });
        normalizeNonNegativeInteger(record, "surveyReports", label, { optional: true, max: MINING_MAX_SURVEY_REPORTS });
        normalizeNonNegativeInteger(record, "reportsCompleted", label, { optional: true });
        normalizeOptionalTimestamp(record, "lastMinedAt", label);
        if (record.lastConditionId != null) requireCanonicalId(record.lastConditionId, `${label}.lastConditionId`);
      }
    }
    if (mining.crewRecords != null) {
      if (!mining.crewRecords || typeof mining.crewRecords !== "object" || Array.isArray(mining.crewRecords)) {
        throw new Error(`world-store: ${playerLabel}.mining.crewRecords must be an object`);
      }
      for (const [crewKey, record] of Object.entries(mining.crewRecords)) {
        requireCanonicalId(crewKey, `${playerLabel}.mining.crewRecords crew key`);
        const label = `${playerLabel}.mining.crewRecords.${crewKey}`;
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          throw new Error(`world-store: ${label} must be an object`);
        }
        normalizeNonNegativeInteger(record, "shifts", label, { optional: true });
        normalizeOptionalTimestamp(record, "lastWorkedAt", label);
        const crewMinerIds = requireArrayField(record, "minerIds", label);
        const uniqueMinerIds = new Set(crewMinerIds.map((minerId, index) => (
          requireCanonicalId(minerId, `${label}.minerIds[${index}]`)
        )));
        if (uniqueMinerIds.size !== crewMinerIds.length) {
          throw new Error(`world-store: ${label}.minerIds must not contain duplicates`);
        }
        if (miningCrewKey(crewMinerIds) !== crewKey) {
          throw new Error(`world-store: ${label}.minerIds must match its crew key`);
        }
        const crewMinerNames = requireArrayField(record, "minerNames", label);
        if (crewMinerNames.some((name) => typeof name !== "string" || !name.trim())) {
          throw new Error(`world-store: ${label}.minerNames must contain non-empty strings`);
        }
      }
    }
    if (mining.stats != null) {
      if (!mining.stats || typeof mining.stats !== "object" || Array.isArray(mining.stats)) {
        throw new Error(`world-store: ${playerLabel}.mining.stats must be an object`);
      }
      normalizeNonNegativeInteger(mining.stats, "facilitySpent", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "preparationSpent", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "incentiveSpent", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "trainingSpent", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "trainingSessions", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "careSpent", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "careActions", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "moraleRecovered", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "personalLeaves", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "retentionCases", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "retentionSuccesses", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "retentionSpent", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "minerDepartures", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "mentorshipsFormed", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "mentorshipsCompleted", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "mentorshipSpent", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "contractSpent", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "contractRenewals", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "promotionSpent", `${playerLabel}.mining.stats`, { optional: true });
      normalizeNonNegativeInteger(mining.stats, "promotions", `${playerLabel}.mining.stats`, { optional: true });
    }
    const miners = requireArrayField(mining, "miners", `${playerLabel}.mining`);
    const minerIds = validateUniqueRecordIds(miners, `${playerLabel}.mining.miners`);
    for (let index = 0; index < miners.length; index += 1) {
      const label = `${playerLabel}.mining.miners[${index}]`;
      normalizeNonNegativeNumber(miners[index], "baseWage", label, { optional: true });
      normalizeNonNegativeInteger(miners[index], "morale", label, { optional: true, max: 100 });
      normalizeNonNegativeNumber(miners[index], "fatigue", label, { optional: true });
      normalizeOptionalTimestamp(miners[index], "fatigueAt", label);
      normalizeOptionalTimestamp(miners[index], "injuredUntil", label);
      normalizeOptionalTimestamp(miners[index], "lastTrainedAt", label);
      normalizeOptionalTimestamp(miners[index], "lastCaredAt", label);
      validateMinerSkills(miners[index], label);
      validateMinerSpecialization(miners[index], label);
      validateMinerContract(miners[index], label);
      validateMinerPromotion(miners[index], label);
      validateMinerRetention(miners[index], label);
    }
    const minerCandidates = requireArrayField(mining, "recruitCandidates", `${playerLabel}.mining`);
    const minerCandidateIds = validateUniqueRecordIds(minerCandidates, `${playerLabel}.mining.recruitCandidates`);
    for (let index = 0; index < minerCandidates.length; index += 1) {
      const label = `${playerLabel}.mining.recruitCandidates[${index}]`;
      normalizeNonNegativeNumber(minerCandidates[index], "baseWage", label, { optional: true });
      normalizeNonNegativeNumber(minerCandidates[index], "price", label, { optional: true });
      normalizeNonNegativeInteger(minerCandidates[index], "morale", label, { optional: true, max: 100 });
      normalizeNonNegativeNumber(minerCandidates[index], "fatigue", label, { optional: true });
      normalizeOptionalTimestamp(minerCandidates[index], "fatigueAt", label);
      normalizeOptionalTimestamp(minerCandidates[index], "injuredUntil", label);
      normalizeOptionalTimestamp(minerCandidates[index], "lastTrainedAt", label);
      normalizeOptionalTimestamp(minerCandidates[index], "lastCaredAt", label);
      validateMinerSkills(minerCandidates[index], label);
      validateMinerSpecialization(minerCandidates[index], label, { candidate: true });
      validateMinerContract(minerCandidates[index], label, { candidate: true });
      validateMinerPromotion(minerCandidates[index], label, { candidate: true });
      validateMinerRetention(minerCandidates[index], label, { candidate: true });
    }
    for (const candidateId of minerCandidateIds) {
      if (minerIds.has(candidateId)) {
        throw new Error(`world-store: miner candidate ${candidateId} is already hired`);
      }
    }
    const mentorships = requireArrayField(mining, "mentorships", `${playerLabel}.mining`);
    validateUniqueRecordIds(mentorships, `${playerLabel}.mining.mentorships`);
    const activeMentorshipMinerIds = new Set();
    for (let index = 0; index < mentorships.length; index += 1) {
      const mentorship = mentorships[index];
      const label = `${playerLabel}.mining.mentorships[${index}]`;
      const mentorId = requireCanonicalId(mentorship.mentorId, `${label}.mentorId`);
      const apprenticeId = requireCanonicalId(mentorship.apprenticeId, `${label}.apprenticeId`);
      if (typeof mentorship.mentorName !== "string" || !mentorship.mentorName.trim()
        || typeof mentorship.apprenticeName !== "string" || !mentorship.apprenticeName.trim()) {
        throw new Error(`world-store: ${label} must retain mentor and apprentice names`);
      }
      if (mentorId === apprenticeId) throw new Error(`world-store: ${label} cannot mentor the same miner`);
      if (!minerIds.has(mentorId) || !minerIds.has(apprenticeId)) {
        throw new Error(`world-store: ${label} must reference hired miners`);
      }
      if (!["active", "completed", "ended"].includes(mentorship.status)) {
        throw new Error(`world-store: ${label}.status must be active, completed, or ended`);
      }
      const sharedShifts = normalizeNonNegativeInteger(mentorship, "sharedShifts", label, {
        max: MINER_MENTORSHIP_REQUIRED_SHIFTS
      });
      normalizeNonNegativeInteger(mentorship, "createdAt", label);
      normalizeOptionalTimestamp(mentorship, "lastWorkedAt", label);
      const completedAt = normalizeOptionalTimestamp(mentorship, "completedAt", label);
      const endedAt = normalizeOptionalTimestamp(mentorship, "endedAt", label);
      if (mentorship.status === "completed" && (completedAt == null || sharedShifts < MINER_MENTORSHIP_REQUIRED_SHIFTS)) {
        throw new Error(`world-store: ${label} completed mentorship must reach its target`);
      }
      if (mentorship.status === "ended" && endedAt == null) {
        throw new Error(`world-store: ${label}.endedAt is required after termination`);
      }
      if (mentorship.status === "active") {
        for (const minerId of [mentorId, apprenticeId]) {
          if (activeMentorshipMinerIds.has(minerId)) {
            throw new Error(`world-store: ${label} miner cannot join multiple active mentorships`);
          }
          activeMentorshipMinerIds.add(minerId);
        }
      }
    }
    const miningJobs = requireArrayField(mining, "jobs", `${playerLabel}.mining`);
    validateUniqueRecordIds(miningJobs, `${playerLabel}.mining.jobs`);
    for (let index = 0; index < miningJobs.length; index += 1) {
      const label = `${playerLabel}.mining.jobs[${index}]`;
      const job = miningJobs[index];
      validateTimeOrder(miningJobs[index], "startedAt", "readyAt", label);
      normalizeNonNegativeNumber(miningJobs[index], "cost", label, { optional: true });
      normalizeNonNegativeInteger(miningJobs[index], "durationMs", label, { optional: true });
      normalizeNonNegativeInteger(miningJobs[index], "preparationCost", label, { optional: true });
      const wageCost = normalizeNonNegativeInteger(miningJobs[index], "wageCost", label, { optional: true });
      const incentivePremium = normalizeNonNegativeInteger(miningJobs[index], "incentivePremium", label, { optional: true });
      if (wageCost != null && incentivePremium != null && incentivePremium > wageCost) {
        throw new Error(`world-store: ${label}.incentivePremium must not exceed wageCost`);
      }
      if (job.incentiveId != null) {
        const incentiveId = requireCanonicalId(job.incentiveId, `${label}.incentiveId`);
        if (!MINING_SHIFT_INCENTIVES[incentiveId]) {
          throw new Error(`world-store: ${label}.incentiveId must reference a known shift incentive`);
        }
        if (typeof job.incentiveLabel !== "string" || !job.incentiveLabel.trim()) {
          throw new Error(`world-store: ${label}.incentiveLabel must be a non-empty string`);
        }
      } else if (job.incentiveLabel != null || incentivePremium != null || wageCost != null) {
        throw new Error(`world-store: ${label} cannot persist incentive costs without an incentiveId`);
      }
      normalizeNonNegativeInteger(
        miningJobs[index],
        "mineMasteryLevel",
        label,
        { optional: true, max: MINING_MASTERY_MAX_LEVEL }
      );
      normalizeNonNegativeInteger(
        miningJobs[index],
        "crewBondLevel",
        label,
        { optional: true, max: MINING_CREW_BOND_MAX_LEVEL }
      );
      if (miningJobs[index].crewKey != null) {
        requireCanonicalId(miningJobs[index].crewKey, `${label}.crewKey`);
      }
      const jobMinerIds = requireArrayField(job, "minerIds", label);
      const uniqueJobMinerIds = new Set(jobMinerIds.map((minerId, minerIndex) => (
        requireCanonicalId(minerId, `${label}.minerIds[${minerIndex}]`)
      )));
      if (uniqueJobMinerIds.size !== jobMinerIds.length) {
        throw new Error(`world-store: ${label}.minerIds must not contain duplicates`);
      }
      if (job.mode != null) {
        if (job.mode !== "basic") throw new Error(`world-store: ${label}.mode must be basic`);
        if (jobMinerIds.length < MINING_BASIC_MIN_CREW || jobMinerIds.length > MINING_BASIC_MAX_CREW) {
          throw new Error(`world-store: ${label}.minerIds must contain one to three miners in basic mode`);
        }
        const miningPower = normalizeNonNegativeInteger(job, "miningPower", label);
        if (miningPower < 1) throw new Error(`world-store: ${label}.miningPower must be positive in basic mode`);
        const mineGradeIds = new Set(MINING_BASIC_MINE_GRADES.map((entry) => entry.id));
        if (!mineGradeIds.has(job.mineGradeId)) {
          throw new Error(`world-store: ${label}.mineGradeId must reference a basic mine grade`);
        }
        if (typeof job.mineGradeName !== "string" || !job.mineGradeName.trim()) {
          throw new Error(`world-store: ${label}.mineGradeName must be a non-empty string`);
        }
      }
      if (job.crewKey != null && miningCrewKey(jobMinerIds) !== job.crewKey) {
        throw new Error(`world-store: ${label}.minerIds must match its crew key`);
      }
      if (job.foremanId != null) {
        const foremanId = requireCanonicalId(job.foremanId, `${label}.foremanId`);
        if (!uniqueJobMinerIds.has(foremanId)) {
          throw new Error(`world-store: ${label}.foremanId must belong to the assigned crew`);
        }
        if (typeof job.foremanName !== "string" || !job.foremanName.trim()) {
          throw new Error(`world-store: ${label}.foremanName must be a non-empty string`);
        }
        if (typeof job.foremanLabel !== "string" || !job.foremanLabel.trim()) {
          throw new Error(`world-store: ${label}.foremanLabel must be a non-empty string`);
        }
        if (!["prospecting", "extraction", "safety"].includes(job.foremanFocus)) {
          throw new Error(`world-store: ${label}.foremanFocus must be a known specialty`);
        }
        const foremanBonus = normalizeNonNegativeNumber(job, "foremanBonus", label);
        if (foremanBonus > MINING_FOREMAN_BONUS) {
          throw new Error(`world-store: ${label}.foremanBonus exceeds the supported bonus`);
        }
      }
      if (job.roleAssignments != null) {
        if (!job.roleAssignments || typeof job.roleAssignments !== "object" || Array.isArray(job.roleAssignments)) {
          throw new Error(`world-store: ${label}.roleAssignments must be an object`);
        }
        const roleEntries = Object.entries(job.roleAssignments);
        if (roleEntries.length !== jobMinerIds.length) {
          throw new Error(`world-store: ${label}.roleAssignments must assign every crew member exactly once`);
        }
        const roleMinerIds = new Set();
        for (const [roleKey, minerIdValue] of roleEntries) {
          if (!MINING_SHIFT_ROLES[roleKey]) {
            throw new Error(`world-store: ${label}.roleAssignments contains unknown role ${roleKey}`);
          }
          const minerId = requireCanonicalId(minerIdValue, `${label}.roleAssignments.${roleKey}`);
          if (!uniqueJobMinerIds.has(minerId) || roleMinerIds.has(minerId)) {
            throw new Error(`world-store: ${label}.roleAssignments must use distinct assigned crew members`);
          }
          roleMinerIds.add(minerId);
        }
        const roleLabels = requireArrayField(job, "roleLabels", label);
        if (roleLabels.length !== roleEntries.length || roleLabels.some((name) => typeof name !== "string" || !name.trim())) {
          throw new Error(`world-store: ${label}.roleLabels must describe every assigned role`);
        }
      }
      if (job.estimate != null) {
        if (!job.estimate || typeof job.estimate !== "object" || Array.isArray(job.estimate)) {
          throw new Error(`world-store: ${label}.estimate must be an object`);
        }
        const yieldMin = normalizeNonNegativeNumber(job.estimate, "yieldMin", `${label}.estimate`);
        const yieldMax = normalizeNonNegativeNumber(job.estimate, "yieldMax", `${label}.estimate`);
        const risk = normalizeNonNegativeNumber(job.estimate, "risk", `${label}.estimate`);
        const extraYieldChance = normalizeNonNegativeNumber(job.estimate, "extraYieldChance", `${label}.estimate`);
        const upgradeChance = normalizeNonNegativeNumber(job.estimate, "upgradeChance", `${label}.estimate`);
        normalizeNonNegativeInteger(job.estimate, "clueGain", `${label}.estimate`);
        if (yieldMax < yieldMin) {
          throw new Error(`world-store: ${label}.estimate.yieldMax must not be below yieldMin`);
        }
        if (risk > 0.65 || extraYieldChance > 0.55 || upgradeChance > 0.2) {
          throw new Error(`world-store: ${label}.estimate contains an unsupported probability`);
        }
      }
      if (job.incidentAt != null) {
        normalizeOptionalTimestamp(job, "incidentAt", label);
        if (Number(job.incidentAt) < Number(job.startedAt) || Number(job.incidentAt) > Number(job.readyAt)) {
          throw new Error(`world-store: ${label}.incidentAt must fall within the active shift`);
        }
      }
      if (job.incidentId != null) {
        const incidentId = requireCanonicalId(job.incidentId, `${label}.incidentId`);
        if (!MINING_SHIFT_INCIDENTS[incidentId] || job.incidentAt == null) {
          throw new Error(`world-store: ${label}.incidentId must reference a known scheduled incident`);
        }
      }
      if (job.incidentChoiceId != null) {
        const choiceId = requireCanonicalId(job.incidentChoiceId, `${label}.incidentChoiceId`);
        if (!miningShiftIncidentChoice(job.incidentId, choiceId)) {
          throw new Error(`world-store: ${label}.incidentChoiceId must reference a choice from its incident`);
        }
        if (job.incidentResolvedAt == null) {
          throw new Error(`world-store: ${label}.incidentResolvedAt is required for a resolved incident`);
        }
        normalizeOptionalTimestamp(job, "incidentResolvedAt", label);
        if (Number(job.incidentResolvedAt) < Number(job.incidentAt) || Number(job.incidentResolvedAt) > Number(job.readyAt)) {
          throw new Error(`world-store: ${label}.incidentResolvedAt must fall within the incident response window`);
        }
        if (typeof job.incidentAutomatic !== "boolean") {
          throw new Error(`world-store: ${label}.incidentAutomatic must be a boolean`);
        }
      } else if (job.incidentResolvedAt != null || job.incidentAutomatic != null) {
        throw new Error(`world-store: ${label} cannot resolve an incident without a choice`);
      }
      if (miningJobs[index].surveyReportUsed != null && typeof miningJobs[index].surveyReportUsed !== "boolean") {
        throw new Error(`world-store: ${label}.surveyReportUsed must be a boolean`);
      }
      if (miningJobs[index].conditionId != null) {
        requireCanonicalId(miningJobs[index].conditionId, `${label}.conditionId`);
      }
      const preparationIds = requireArrayField(miningJobs[index], "preparationIds", label);
      if (preparationIds.length > MINING_MAX_PREPARATIONS) {
        throw new Error(`world-store: ${label}.preparationIds must contain at most ${MINING_MAX_PREPARATIONS} entries`);
      }
      const uniquePreparationIds = new Set();
      for (let preparationIndex = 0; preparationIndex < preparationIds.length; preparationIndex += 1) {
        const preparationId = requireCanonicalId(
          preparationIds[preparationIndex],
          `${label}.preparationIds[${preparationIndex}]`
        );
        if (uniquePreparationIds.has(preparationId)) {
          throw new Error(`world-store: duplicate ${label}.preparationIds entry ${preparationId}`);
        }
        uniquePreparationIds.add(preparationId);
      }
      validateMiningFacilities(miningJobs[index].facilities, `${label}.facilities`);
    }
    requireArrayField(mining, "history", `${playerLabel}.mining`);
    requireArrayField(mining, "leaseHistory", `${playerLabel}.mining`);
    if (mining.applicationHistory != null) {
      const applicationHistory = requireArrayField(mining, "applicationHistory", `${playerLabel}.mining`);
      validateUniqueRecordIds(applicationHistory, `${playerLabel}.mining.applicationHistory`);
      const validStatuses = new Set(["won", "missed", "cancelled", "failed", "skipped"]);
      const validAllocationModes = new Set(["preference", "adjusted", "automatic"]);
      for (let index = 0; index < applicationHistory.length; index += 1) {
        const entry = applicationHistory[index];
        const label = `${playerLabel}.mining.applicationHistory[${index}]`;
        normalizeNonNegativeInteger(entry, "roundNumber", label);
        normalizeOptionalTimestamp(entry, "submittedAt", label);
        normalizeOptionalTimestamp(entry, "settledAt", label);
        normalizeNonNegativeNumber(entry, "escrow", label, { optional: true });
        normalizeNonNegativeNumber(entry, "rent", label, { optional: true });
        normalizeNonNegativeNumber(entry, "refund", label, { optional: true });
        if (entry.preferenceRank != null) normalizeNonNegativeInteger(entry, "preferenceRank", label);
        if (!validStatuses.has(entry.status)) {
          throw new Error(`world-store: ${label}.status must be a known application result`);
        }
        if (entry.applicationId != null) requireCanonicalId(entry.applicationId, `${label}.applicationId`);
        if (entry.mineId != null && !miningMineById(requireCanonicalId(entry.mineId, `${label}.mineId`))) {
          throw new Error(`world-store: ${label}.mineId must reference a known mine`);
        }
        if (entry.allocationMode != null && !validAllocationModes.has(entry.allocationMode)) {
          throw new Error(`world-store: ${label}.allocationMode must be a known allocation mode`);
        }
        for (const booleanField of ["allowFallback", "priorityAllocation", "priorityGranted", "rosterReleased"]) {
          if (entry[booleanField] != null && typeof entry[booleanField] !== "boolean") {
            throw new Error(`world-store: ${label}.${booleanField} must be a boolean`);
          }
        }
        const preferences = requireArrayField(entry, "preferences", label);
        const uniquePreferences = new Set(preferences.map((mineId, preferenceIndex) => {
          const canonicalMineId = requireCanonicalId(mineId, `${label}.preferences[${preferenceIndex}]`);
          if (!miningMineById(canonicalMineId)) {
            throw new Error(`world-store: ${label}.preferences contains unknown mine ${canonicalMineId}`);
          }
          return canonicalMineId;
        }));
        if (uniquePreferences.size !== preferences.length) {
          throw new Error(`world-store: ${label}.preferences must not contain duplicates`);
        }
        if (entry.reason != null && typeof entry.reason !== "string") {
          throw new Error(`world-store: ${label}.reason must be a string`);
        }
      }
    }
  }
}


