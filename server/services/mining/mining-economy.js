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
} from "../../../shared/domain/mining/mining-rules.js";
import { QUALITIES, ROUGH_PRICE_NOISE } from "../rough-pool-service.js";

function healthPercent(rate) {
  return `${Math.round(Math.max(0, Number(rate) || 0) * 1000) / 10}%`;
}

function signedHealthPercent(rate) {
  return `${Math.round((Number(rate) || 0) * 1000) / 10}%`;
}

export function miningCompetitionHealth(insights = {}, { leaseMs = MINING_LEASE_MS } = {}) {
  const alerts = [];
  const recentRoundCount = Math.max(0, Number(insights.recentRoundCount) || 0);
  const recentParticipationRate = Math.max(0, Number(insights.recentParticipationRate) || 0);
  const recentReleaseRate = Math.max(0, Number(insights.recentReleaseRate) || 0);
  const currentApplicantCount = Math.max(0, Number(insights.currentApplicantCount) || 0);
  const waitlistCount = Math.max(0, Number(insights.waitlistCount) || 0);
  const averageWaitMs = Math.max(0, Number(insights.averageWaitMs) || 0);
  const normalizedLeaseMs = Math.max(1, Number(leaseMs) || MINING_LEASE_MS);
  const maxHealthyWaitMs = normalizedLeaseMs * MINING_HEALTH_MAX_WAIT_LEASES;
  const hottestMine = Array.isArray(insights.mineHeat) ? insights.mineHeat[0] : null;
  const hottestMineApplicants = Math.max(0, Number(hottestMine?.applicantCount) || 0);
  const hottestMineShare = currentApplicantCount
    ? hottestMineApplicants / currentApplicantCount
    : 0;

  if (
    recentRoundCount >= MINING_HEALTH_MIN_OBSERVED_ROUNDS
    && recentParticipationRate < MINING_HEALTH_MIN_PARTICIPATION_RATE
  ) {
    alerts.push({
      id: "low-participation",
      severity: recentParticipationRate < 0.5 ? "critical" : "warning",
      title: "近期报名率偏低",
      metricLabel: `近期 ${recentRoundCount} 轮报名率 ${healthPercent(recentParticipationRate)}，健康线 ${healthPercent(MINING_HEALTH_MIN_PARTICIPATION_RATE)}`,
      detail: "竞租席位没有被充分使用，矿洞可能连续空置，也会放大少数活跃玩家的优势。",
      recommendation: "建议先把申请期延长约 20%，并强化截止前提醒；观察 3 轮后仍未恢复，再评估席位规模。"
    });
  }

  if (waitlistCount > 0 && averageWaitMs > maxHealthyWaitMs) {
    const waitedLeases = Math.round((averageWaitMs / normalizedLeaseMs) * 10) / 10;
    alerts.push({
      id: "long-waitlist",
      severity: waitedLeases > MINING_HEALTH_MAX_WAIT_LEASES * 2 ? "critical" : "warning",
      title: "候补等待时间偏长",
      metricLabel: `平均等待约 ${waitedLeases} 个租期，建议上限 ${MINING_HEALTH_MAX_WAIT_LEASES} 个租期`,
      detail: `当前有 ${waitlistCount} 名候补玩家，长时间无法参赛会削弱公平感和参与意愿。`,
      recommendation: "优先检查闲置席位释放是否及时；若连续 3 轮超标，可将竞租席位增加 5 个，或缩短非活跃判定周期。"
    });
  }

  if (
    insights.currentTargetRound
    && currentApplicantCount >= MINING_HEALTH_MIN_CONCENTRATION_APPLICANTS
    && hottestMineShare > MINING_HEALTH_MAX_MINE_CONCENTRATION
  ) {
    alerts.push({
      id: "mine-concentration",
      severity: hottestMineShare > 0.8 ? "critical" : "warning",
      title: "志愿过度集中",
      metricLabel: `最热门矿洞覆盖 ${healthPercent(hottestMineShare)} 的报名玩家，建议上限 ${healthPercent(MINING_HEALTH_MAX_MINE_CONCENTRATION)}`,
      detail: "大量玩家挤向同一矿洞，会让抽签结果的随机挫败感过强，而冷门矿洞持续无人选择。",
      recommendation: "建议把冷门矿洞的预期净收益提高 3%–5%，先观察 2–3 轮；不要一次性削弱热门矿洞超过 3%。"
    });
  }

  if (
    recentRoundCount >= MINING_HEALTH_MIN_OBSERVED_ROUNDS
    && recentReleaseRate > MINING_HEALTH_MAX_RELEASE_RATE
  ) {
    alerts.push({
      id: "high-release-rate",
      severity: recentReleaseRate > 0.2 ? "critical" : "warning",
      title: "竞租席位释放率偏高",
      metricLabel: `近期释放率 ${healthPercent(recentReleaseRate)}，建议上限 ${healthPercent(MINING_HEALTH_MAX_RELEASE_RATE)}`,
      detail: "较多玩家因连续未报名或长期不活跃离开名单，现有参与门槛可能与游戏节奏不匹配。",
      recommendation: "建议先延长申请期 20%–30%；若仍连续 3 轮超标，再把连续未报名上限由 3 轮调为 4 轮。"
    });
  }

  return alerts;
}

const MINING_QUALITY_ECONOMICS = new Map(QUALITIES.map((quality) => [quality.key, quality]));

export function miningExpectedStoneValue(mineOrId, observedMass = null) {
  const mine = typeof mineOrId === "object"
    ? mineOrId
    : MINES.find((entry) => entry.id === String(mineOrId || ""));
  if (!mine) return 0;
  const weights = Array.isArray(mine.weights) ? mine.weights : [];
  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(0, Number(weight) || 0), 0);
  if (!totalWeight) return 0;
  const meanMass = Number.isFinite(Number(observedMass)) && Number(observedMass) > 0
    ? Number(observedMass)
    : (Math.max(0, Number(mine.massMin) || 0) + Math.max(0, Number(mine.massMax) || 0)) / 2;
  const meanNoise = (ROUGH_PRICE_NOISE.min + ROUGH_PRICE_NOISE.max) / 2;
  return Math.round(weights.reduce((sum, weight, index) => {
    const quality = MINING_QUALITY_ECONOMICS.get(MINING_QUALITY_KEYS[index]);
    if (!quality) return sum;
    const basePrice = 900 + quality.score * quality.score * 720 + meanMass * 620;
    return sum + (Math.max(0, Number(weight) || 0) / totalWeight)
      * basePrice
      * meanNoise
      * quality.value;
  }, 0));
}

export function miningMineEconomyBenchmark(mine) {
  const plan = miningBasicShiftPlan(mine, [{ id: "economy-baseline", tier: 1 }]);
  const expectedCount = (plan.baseYieldMin + plan.baseYieldMax) / 2
    + plan.extraYieldChance
    - plan.risk;
  const expectedOutputValue = Math.round(miningExpectedStoneValue(mine) * expectedCount);
  const rentPerShift = Math.round((Number(mine.rent) || 0) / MINING_MAX_SHIFTS_PER_LEASE);
  const operatingCost = Math.max(0, Math.round(Number(plan.total) || 0));
  const allInCost = rentPerShift + operatingCost;
  const expectedNet = expectedOutputValue - allInCost;
  return {
    mineId: mine.id,
    mineName: mine.name,
    beltId: mine.beltId,
    beltLabel: mine.beltLabel,
    expectedOutputValue,
    rentPerShift,
    operatingCost,
    allInCost,
    expectedNet,
    margin: expectedOutputValue ? expectedNet / expectedOutputValue : 0
  };
}

export function miningEconomyInsights({ history = [], leaseHistory = [] } = {}) {
  const benchmarkMines = MINES.map(miningMineEconomyBenchmark);
  const benchmarkNets = benchmarkMines.map((entry) => entry.expectedNet).filter((value) => value > 0);
  const weakestExpectedNet = benchmarkNets.length ? Math.min(...benchmarkNets) : 0;
  const strongestExpectedNet = benchmarkNets.length ? Math.max(...benchmarkNets) : 0;
  const netSpread = weakestExpectedNet ? strongestExpectedNet / weakestExpectedNet : 0;
  const beltOrder = [...new Set(MINES.map((mine) => mine.beltId))];
  const benchmarkBands = beltOrder.map((beltId) => {
    const rows = benchmarkMines.filter((entry) => entry.beltId === beltId);
    const total = rows.reduce((sum, entry) => ({
      output: sum.output + entry.expectedOutputValue,
      operatingCost: sum.operatingCost + entry.operatingCost,
      rent: sum.rent + entry.rentPerShift,
      cost: sum.cost + entry.allInCost,
      net: sum.net + entry.expectedNet
    }), { output: 0, operatingCost: 0, rent: 0, cost: 0, net: 0 });
    const count = Math.max(1, rows.length);
    const expectedOutputValue = Math.round(total.output / count);
    const allInCost = Math.round(total.cost / count);
    const expectedNet = Math.round(total.net / count);
    return {
      beltId,
      beltLabel: rows[0]?.beltLabel || beltId,
      mineCount: rows.length,
      expectedOutputValue,
      operatingCost: Math.round(total.operatingCost / count),
      rentPerShift: Math.round(total.rent / count),
      allInCost,
      expectedNet,
      margin: expectedOutputValue ? expectedNet / expectedOutputValue : 0
    };
  });

  const recentShifts = (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.status !== "refunded")
    .map((entry) => {
      const mine = miningMineById(entry?.mineId);
      if (!mine) return null;
      const roughCount = Math.max(0, Math.round(Number(entry.roughCount) || 0));
      const totalMass = Math.max(0, Number(entry.totalMass) || 0);
      const observedMass = roughCount ? totalMass / roughCount : null;
      const estimatedOutputValue = Math.round(miningExpectedStoneValue(mine, observedMass) * roughCount);
      const operatingCost = Math.max(0, Math.round(Number(entry.cost ?? entry.wageCost) || 0));
      const rentPerShift = Math.round((Number(mine.rent) || 0) / MINING_MAX_SHIFTS_PER_LEASE);
      const allInCost = operatingCost + rentPerShift;
      const estimatedNet = estimatedOutputValue - allInCost;
      return {
        mineId: mine.id,
        mineName: mine.name,
        beltId: mine.beltId,
        beltLabel: mine.beltLabel,
        completedAt: Number(entry.completedAt) || null,
        roughCount,
        totalMass,
        estimatedOutputValue,
        operatingCost,
        rentPerShift,
        allInCost,
        estimatedNet,
        margin: estimatedOutputValue ? estimatedNet / estimatedOutputValue : -1
      };
    })
    .filter(Boolean)
    .slice(0, MINING_ECONOMY_RECENT_SHIFT_LIMIT);
  const recentTotals = recentShifts.reduce((totals, entry) => ({
    output: totals.output + entry.estimatedOutputValue,
    operatingCost: totals.operatingCost + entry.operatingCost,
    rent: totals.rent + entry.rentPerShift,
    allInCost: totals.allInCost + entry.allInCost,
    net: totals.net + entry.estimatedNet,
    losses: totals.losses + (entry.estimatedNet < 0 ? 1 : 0)
  }), { output: 0, operatingCost: 0, rent: 0, allInCost: 0, net: 0, losses: 0 });
  const recentMargin = recentTotals.output
    ? recentTotals.net / recentTotals.output
    : recentTotals.allInCost
      ? -1
      : 0;
  const lossShiftRate = recentShifts.length ? recentTotals.losses / recentShifts.length : 0;
  const recentBands = beltOrder.map((beltId) => {
    const rows = recentShifts.filter((entry) => entry.beltId === beltId);
    if (!rows.length) return null;
    const totals = rows.reduce((sum, entry) => ({
      output: sum.output + entry.estimatedOutputValue,
      cost: sum.cost + entry.allInCost,
      net: sum.net + entry.estimatedNet
    }), { output: 0, cost: 0, net: 0 });
    return {
      beltId,
      beltLabel: rows[0].beltLabel,
      shiftCount: rows.length,
      estimatedOutputValue: totals.output,
      allInCost: totals.cost,
      estimatedNet: totals.net,
      averageNet: Math.round(totals.net / rows.length),
      margin: totals.output ? totals.net / totals.output : 0
    };
  }).filter(Boolean);

  const settledLeases = (Array.isArray(leaseHistory) ? leaseHistory : [])
    .filter((entry) => entry?.status !== "active" && Number(entry?.maxShifts) > 0)
    .slice(0, MINING_ECONOMY_RECENT_LEASE_LIMIT);
  const leaseUsage = settledLeases.reduce((totals, entry) => ({
    used: totals.used + Math.max(0, Math.min(Number(entry.maxShifts) || 0, Number(entry.shiftsStarted) || 0)),
    capacity: totals.capacity + Math.max(0, Number(entry.maxShifts) || 0)
  }), { used: 0, capacity: 0 });
  const leaseUtilization = leaseUsage.capacity ? leaseUsage.used / leaseUsage.capacity : null;
  const alerts = [];

  if (netSpread > MINING_ECONOMY_MAX_NET_SPREAD) {
    alerts.push({
      id: "excessive-mine-spread",
      severity: netSpread > MINING_ECONOMY_MAX_NET_SPREAD * 1.25 ? "critical" : "warning",
      title: "矿洞基准净收益差距过大",
      metricLabel: `最强与最弱矿洞相差 ${Math.round(netSpread * 10) / 10} 倍，建议上限 ${MINING_ECONOMY_MAX_NET_SPREAD} 倍`,
      recommendation: "建议把最弱矿洞的预期产值提高 5%–8%，或下调租金 5%；单次不要削弱最强矿洞超过 3%。"
    });
  }
  if (recentShifts.length >= 3 && recentMargin < MINING_ECONOMY_MIN_MARGIN) {
    alerts.push({
      id: "thin-net-margin",
      severity: recentMargin < 0 ? "critical" : "warning",
      title: recentMargin < 0 ? "近期估算净收益为负" : "近期净收益率偏低",
      metricLabel: `近 ${recentShifts.length} 班估算净收益率 ${signedHealthPercent(recentMargin)}，建议下限 ${healthPercent(MINING_ECONOMY_MIN_MARGIN)}`,
      recommendation: "先检查租期是否开满及高成本班次配置；若全服样本连续 6 轮偏低，再下调对应矿带租金 5%–8%。"
    });
  }
  if (recentShifts.length >= 4 && lossShiftRate > MINING_ECONOMY_MAX_LOSS_SHIFT_RATE) {
    alerts.push({
      id: "high-loss-shift-rate",
      severity: lossShiftRate > 0.6 ? "critical" : "warning",
      title: "亏损班次占比偏高",
      metricLabel: `近 ${recentShifts.length} 班中 ${recentTotals.losses} 班估算亏损，建议上限 ${healthPercent(MINING_ECONOMY_MAX_LOSS_SHIFT_RATE)}`,
      recommendation: "建议先降低高风险矿洞事故率 2–3 个百分点；若问题集中在单一矿带，再提高该矿带基础产出约 5%。"
    });
  }
  if (settledLeases.length >= 2 && leaseUtilization < MINING_ECONOMY_MIN_LEASE_UTILIZATION) {
    alerts.push({
      id: "low-lease-utilization",
      severity: leaseUtilization < 0.35 ? "critical" : "warning",
      title: "租期班次利用率偏低",
      metricLabel: `近 ${settledLeases.length} 个结束租期仅使用 ${leaseUsage.used}/${leaseUsage.capacity} 班，建议下限 ${healthPercent(MINING_ECONOMY_MIN_LEASE_UTILIZATION)}`,
      recommendation: "优先把租期延长约 20%；若利用率仍低于 60%，再将租金下调 8%–12%，避免玩家为闲置班次买单。"
    });
  }

  return {
    recentShiftCount: recentShifts.length,
    estimatedOutputValue: Math.round(recentTotals.output),
    operatingCost: Math.round(recentTotals.operatingCost),
    allocatedRent: Math.round(recentTotals.rent),
    allInCost: Math.round(recentTotals.allInCost),
    estimatedNet: Math.round(recentTotals.net),
    margin: recentMargin,
    lossShiftCount: recentTotals.losses,
    lossShiftRate,
    settledLeaseCount: settledLeases.length,
    leaseUsedShifts: leaseUsage.used,
    leaseCapacityShifts: leaseUsage.capacity,
    leaseUtilization,
    benchmarkNetSpread: Math.round(netSpread * 10) / 10,
    benchmarkMaxNetSpread: MINING_ECONOMY_MAX_NET_SPREAD,
    benchmarkBands,
    recentBands,
    alerts,
    estimationNote: "估算产值采用矿洞公开概率、出料数量与总重量计算，不读取原石隐藏品质；租金按每租期 5 班分摊。"
  };
}

function miningWorldRoundForShift(entry, leaseHistory, roundById, roundByNumber) {
  const directById = entry?.roundId ? roundById.get(String(entry.roundId)) : null;
  if (directById) return directById;
  const directByNumber = Number(entry?.roundNumber) > 0
    ? roundByNumber.get(Math.round(Number(entry.roundNumber)))
    : null;
  if (directByNumber) return directByNumber;
  const completedAt = Number(entry?.completedAt) || 0;
  const leaseId = String(entry?.leaseId || "");
  const mineId = String(entry?.mineId || "");
  const lease = (Array.isArray(leaseHistory) ? leaseHistory : []).find((candidate) => (
    (leaseId && String(candidate?.id || "") === leaseId)
    || (
      mineId
      && String(candidate?.mineId || "") === mineId
      && completedAt >= Number(candidate?.startsAt || 0)
      && completedAt <= Number(candidate?.endsAt || 0)
    )
  ));
  if (!lease) return null;
  return (lease.roundId ? roundById.get(String(lease.roundId)) : null)
    || (Number(lease.roundNumber) > 0
      ? roundByNumber.get(Math.round(Number(lease.roundNumber)))
      : null)
    || null;
}

export function miningWorldEconomyReport({ players = [], rounds = [], mineRules = {} } = {}) {
  const playerRows = players instanceof Map
    ? [...players.values()]
    : Array.isArray(players)
      ? players
      : [...players || []];
  const seenRounds = new Set();
  const recentRounds = (Array.isArray(rounds) ? rounds : [])
    .filter((round) => round && Number(round.number) > 0)
    .sort((left, right) => Number(right.number) - Number(left.number))
    .filter((round) => {
      const key = String(round.id || `number:${Math.round(Number(round.number))}`);
      if (seenRounds.has(key)) return false;
      seenRounds.add(key);
      return true;
    })
    .slice(0, MINING_WORLD_ECONOMY_RECENT_ROUND_LIMIT);
  const roundById = new Map(recentRounds
    .filter((round) => round.id)
    .map((round) => [String(round.id), round]));
  const roundByNumber = new Map(recentRounds
    .map((round) => [Math.round(Number(round.number)), round]));
  const roundKey = (round) => String(round?.id || `number:${Math.round(Number(round?.number) || 0)}`);
  const seenLeaseIds = new Set();
  const leases = recentRounds.flatMap((round) => (Array.isArray(round.leases) ? round.leases : [])
    .flatMap((lease, index) => {
      const mine = miningMineById(lease?.mineId);
      if (!mine) return [];
      const id = String(lease?.id || `${roundKey(round)}:${mine.id}:${index}`);
      if (seenLeaseIds.has(id)) return [];
      seenLeaseIds.add(id);
      return [{
        id,
        roundKey: roundKey(round),
        roundNumber: Math.max(1, Math.round(Number(round.number) || 1)),
        playerId: String(lease?.playerId || ""),
        mineId: mine.id,
        beltId: mine.beltId,
        beltLabel: mine.beltLabel,
        rent: Math.max(0, Math.round(Number(lease?.rent ?? mine.rent) || 0)),
        usedShifts: Math.max(0, Math.min(
          Math.max(1, Math.round(Number(lease?.maxShifts) || MINING_MAX_SHIFTS_PER_LEASE)),
          Math.round(Number(lease?.shiftsStarted) || 0)
        )),
        capacityShifts: Math.max(1, Math.round(Number(lease?.maxShifts) || MINING_MAX_SHIFTS_PER_LEASE))
      }];
    }));
  const leaseById = new Map(leases.map((lease) => [lease.id, lease]));
  const persistedShifts = recentRounds.flatMap((round) => (
    Array.isArray(round.economyShifts) ? round.economyShifts : []
  ).flatMap((entry) => {
    const mine = miningMineById(entry?.mineId);
    if (!mine || !entry?.id) return [];
    return [{
      id: String(entry.id),
      roundKey: roundKey(round),
      roundNumber: Math.max(1, Math.round(Number(round.number) || 1)),
      playerId: String(entry.playerId || ""),
      mineId: mine.id,
      beltId: mine.beltId,
      beltLabel: mine.beltLabel,
      tuningVersionId: entry.tuningVersionId ? String(entry.tuningVersionId) : null,
      tuningOutputMultiplier: normalizedTuningMultiplier(entry.tuningOutputMultiplier),
      estimatedOutputValue: Math.max(0, Math.round(Number(entry.estimatedOutputValue) || 0)),
      benchmarkOutputValue: Math.max(1, Math.round(
        Number(entry.benchmarkOutputValue) || miningMineEconomyBenchmark(mine).expectedOutputValue
      )),
      operatingCost: Math.max(0, Math.round(Number(entry.operatingCost) || 0)),
      allocatedRent: Math.max(0, Math.round(Number(entry.allocatedRent) || 0)),
      estimatedNet: Math.round(Number(entry.estimatedNet) || 0)
    }];
  }));
  const seenShiftIds = new Set(persistedShifts.map((shift) => shift.id));
  const historicalShifts = playerRows.flatMap((player) => {
    const playerId = String(player?.id || "");
    const mining = player?.mining && typeof player.mining === "object" ? player.mining : {};
    const leaseHistory = Array.isArray(mining.leaseHistory) ? mining.leaseHistory : [];
    return (Array.isArray(mining.history) ? mining.history : [])
      .filter((entry) => entry?.status !== "refunded")
      .flatMap((entry, index) => {
      const round = miningWorldRoundForShift(entry, leaseHistory, roundById, roundByNumber);
      const mine = miningMineById(entry?.mineId);
      if (!round || !mine) return [];
      const id = `${playerId}:${String(entry?.id || `${entry?.completedAt || 0}:${mine.id}:${index}`)}`;
      if (seenShiftIds.has(id)) return [];
      seenShiftIds.add(id);
      const roughCount = Math.max(0, Math.round(Number(entry?.roughCount) || 0));
      const totalMass = Math.max(0, Number(entry?.totalMass) || 0);
      const observedMass = roughCount ? totalMass / roughCount : null;
      const estimatedOutputValue = Math.round(miningExpectedStoneValue(mine, observedMass) * roughCount);
      const benchmarkOutputValue = Math.max(1, Math.round(
        Number(entry?.benchmarkOutputValue)
          || miningMineEconomyBenchmark(mine).expectedOutputValue
            * normalizedTuningMultiplier(entry?.tuningOutputMultiplier)
      ));
      const operatingCost = Math.max(0, Math.round(Number(entry?.cost ?? entry?.wageCost) || 0));
      const matchedLease = leaseById.get(String(entry?.leaseId || ""))
        || leases.find((lease) => (
          lease.roundKey === roundKey(round)
          && lease.playerId === playerId
          && lease.mineId === mine.id
        ));
      const allocatedRent = Math.round(
        Math.max(0, Number(matchedLease?.rent ?? mine.rent) || 0)
        / Math.max(1, Number(matchedLease?.capacityShifts) || MINING_MAX_SHIFTS_PER_LEASE)
      );
      const estimatedNet = estimatedOutputValue - operatingCost - allocatedRent;
      return [{
        id,
        roundKey: roundKey(round),
        roundNumber: Math.max(1, Math.round(Number(round.number) || 1)),
        playerId,
        mineId: mine.id,
        beltId: mine.beltId,
        beltLabel: mine.beltLabel,
        estimatedOutputValue,
        benchmarkOutputValue,
        operatingCost,
        allocatedRent,
        estimatedNet
      }];
    });
  });
  const shifts = [...persistedShifts, ...historicalShifts];
  const summarize = (roundLeases, roundShifts) => {
    const totals = roundShifts.reduce((sum, shift) => ({
      output: sum.output + shift.estimatedOutputValue,
      operatingCost: sum.operatingCost + shift.operatingCost,
      lossShifts: sum.lossShifts + (shift.estimatedNet < 0 ? 1 : 0)
    }), { output: 0, operatingCost: 0, lossShifts: 0 });
    const rent = roundLeases.reduce((sum, lease) => sum + lease.rent, 0);
    const usedShifts = roundLeases.reduce((sum, lease) => sum + lease.usedShifts, 0);
    const capacityShifts = roundLeases.reduce((sum, lease) => sum + lease.capacityShifts, 0);
    const allInCost = totals.operatingCost + rent;
    const net = totals.output - allInCost;
    return {
      leaseCount: roundLeases.length,
      shiftCount: roundShifts.length,
      playerCount: new Set(roundShifts.map((shift) => shift.playerId).filter(Boolean)).size,
      estimatedOutputValue: Math.round(totals.output),
      operatingCost: Math.round(totals.operatingCost),
      rentCost: Math.round(rent),
      allInCost: Math.round(allInCost),
      estimatedNet: Math.round(net),
      margin: totals.output ? net / totals.output : allInCost ? -1 : 0,
      lossShiftCount: totals.lossShifts,
      lossShiftRate: roundShifts.length ? totals.lossShifts / roundShifts.length : 0,
      usedShifts,
      capacityShifts,
      utilization: capacityShifts ? usedShifts / capacityShifts : null
    };
  };
  const roundRows = recentRounds.map((round) => ({
    roundNumber: Math.max(1, Math.round(Number(round.number) || 1)),
    startsAt: Number(round.startsAt) || null,
    endsAt: Number(round.endsAt) || null,
    ...summarize(
      leases.filter((lease) => lease.roundKey === roundKey(round)),
      shifts.filter((shift) => shift.roundKey === roundKey(round))
    )
  }));
  const totals = summarize(leases, shifts);
  const uniqueShiftPlayers = new Set(shifts.map((shift) => shift.playerId).filter(Boolean)).size;
  const sampleReady = recentRounds.length >= MINING_WORLD_ECONOMY_MIN_ROUNDS
    && shifts.length >= MINING_WORLD_ECONOMY_MIN_SHIFTS
    && uniqueShiftPlayers >= MINING_WORLD_ECONOMY_MIN_PLAYERS;
  const sampleProgress = Math.max(0, Math.min(1,
    recentRounds.length / MINING_WORLD_ECONOMY_MIN_ROUNDS,
    shifts.length / MINING_WORLD_ECONOMY_MIN_SHIFTS,
    uniqueShiftPlayers / MINING_WORLD_ECONOMY_MIN_PLAYERS
  ));
  const benchmarkBands = miningEconomyInsights().benchmarkBands.map((benchmark) => {
    const rule = mineRules?.[benchmark.beltId] || {};
    const outputMultiplier = normalizedTuningMultiplier(rule.outputMultiplier);
    const rentMultiplier = normalizedTuningMultiplier(rule.rentMultiplier);
    const expectedOutputValue = Math.round((Number(benchmark.expectedOutputValue) || 0) * outputMultiplier);
    const rentPerShift = Math.round((Number(benchmark.rentPerShift) || 0) * rentMultiplier);
    const operatingCost = Math.max(0, Math.round(Number(benchmark.operatingCost) || 0));
    const allInCost = operatingCost + rentPerShift;
    const expectedNet = expectedOutputValue - allInCost;
    return {
      ...benchmark,
      expectedOutputValue,
      rentPerShift,
      allInCost,
      expectedNet,
      margin: expectedOutputValue ? expectedNet / expectedOutputValue : 0
    };
  });
  const beltRows = benchmarkBands.map((benchmark) => {
    const beltLeases = leases.filter((lease) => lease.beltId === benchmark.beltId);
    const beltShifts = shifts.filter((shift) => shift.beltId === benchmark.beltId);
    const beltTotals = summarize(beltLeases, beltShifts);
    const averageOutputPerShift = beltShifts.length
      ? Math.round(beltTotals.estimatedOutputValue / beltShifts.length)
      : 0;
    const benchmarkOutputPerShift = beltShifts.length
      ? Math.round(beltShifts.reduce((sum, shift) => sum + shift.benchmarkOutputValue, 0) / beltShifts.length)
      : Number(benchmark.expectedOutputValue) || 0;
    const performanceIndex = beltShifts.length && benchmarkOutputPerShift > 0
      ? averageOutputPerShift / benchmarkOutputPerShift
      : null;
    const qualifiedForTuning = sampleReady && beltShifts.length >= MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS;
    let tuningAdvice = `再积累 ${Math.max(0, MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS - beltShifts.length)} 班后评估该矿带。`;
    if (qualifiedForTuning && performanceIndex < 0.85) {
      tuningAdvice = "实际产值持续低于同档基准；建议优先下调租金 5%，再观察 3 轮。";
    } else if (qualifiedForTuning && performanceIndex > 1.15) {
      tuningAdvice = "实际产值持续高于同档基准；先观察物价流向，必要时仅下调产出 3%。";
    } else if (qualifiedForTuning && beltTotals.margin < MINING_ECONOMY_MIN_MARGIN) {
      tuningAdvice = "产出接近基准但全租金口径利润偏低；建议检查空置班次，再考虑下调租金 5%。";
    } else if (qualifiedForTuning) {
      tuningAdvice = "该矿带产出、租金与利用率暂无需调整。";
    }
    return {
      beltId: benchmark.beltId,
      beltLabel: benchmark.beltLabel,
      benchmarkOutputPerShift,
      benchmarkOperatingCostPerShift: Math.max(0, Math.round(Number(benchmark.operatingCost) || 0)),
      benchmarkRentPerShift: Math.max(0, Math.round(Number(benchmark.rentPerShift) || 0)),
      benchmarkAllInCostPerShift: Math.max(0, Math.round(Number(benchmark.allInCost) || 0)),
      benchmarkNetPerShift: Math.round(Number(benchmark.expectedNet) || 0),
      benchmarkMargin: Number(benchmark.margin) || 0,
      averageOutputPerShift,
      performanceIndex,
      qualifiedForTuning,
      tuningAdvice,
      ...beltTotals
    };
  });
  const comparableBands = beltRows
    .filter((belt) => belt.shiftCount >= MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS && belt.performanceIndex > 0);
  const performanceIndexes = comparableBands.map((belt) => belt.performanceIndex);
  const performanceSpread = performanceIndexes.length >= 2
    ? Math.max(...performanceIndexes) / Math.min(...performanceIndexes)
    : null;
  const alerts = [];
  if (sampleReady && totals.margin < MINING_ECONOMY_MIN_MARGIN) {
    alerts.push({
      id: "world-thin-margin",
      severity: totals.margin < 0 ? "critical" : "warning",
      title: totals.margin < 0 ? "全服近期估算亏损" : "全服近期利润率偏低",
      metricLabel: `近 ${recentRounds.length} 轮全租金口径净收益率 ${signedHealthPercent(totals.margin)}，建议下限 ${healthPercent(MINING_ECONOMY_MIN_MARGIN)}`,
      recommendation: "先检查租期利用率；若利用率健康仍连续 3 轮偏低，再统一下调矿洞租金 5%，不要同时提高产出。"
    });
  }
  if (sampleReady && totals.utilization < MINING_ECONOMY_MIN_LEASE_UTILIZATION) {
    alerts.push({
      id: "world-low-utilization",
      severity: totals.utilization < 0.35 ? "critical" : "warning",
      title: "全服租期利用率偏低",
      metricLabel: `近 ${recentRounds.length} 轮仅使用 ${totals.usedShifts}/${totals.capacityShifts} 班，建议下限 ${healthPercent(MINING_ECONOMY_MIN_LEASE_UTILIZATION)}`,
      recommendation: "优先延长租期或缩短单班时长约 20%；利用率仍偏低时，再下调租金 8%–12%。"
    });
  }
  if (sampleReady && performanceSpread > MINING_WORLD_ECONOMY_MAX_PERFORMANCE_SPREAD) {
    alerts.push({
      id: "world-belt-performance-spread",
      severity: performanceSpread > MINING_WORLD_ECONOMY_MAX_PERFORMANCE_SPREAD * 1.25 ? "critical" : "warning",
      title: "矿带实际表现偏离不均",
      metricLabel: `按各自基准归一后，最强与最弱矿带相差 ${Math.round(performanceSpread * 100) / 100} 倍，建议上限 ${MINING_WORLD_ECONOMY_MAX_PERFORMANCE_SPREAD} 倍`,
      recommendation: "只调整低于自身基准的矿带：先减租 5%或增产 3%–5%，至少观察 3 轮后再做第二次调整。"
    });
  }
  return {
    sampleReady,
    sampleProgress,
    minimumRounds: MINING_WORLD_ECONOMY_MIN_ROUNDS,
    minimumShifts: MINING_WORLD_ECONOMY_MIN_SHIFTS,
    minimumPlayers: MINING_WORLD_ECONOMY_MIN_PLAYERS,
    minimumBeltShifts: MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS,
    recentRoundCount: recentRounds.length,
    uniquePlayerCount: uniqueShiftPlayers,
    performanceSpread: performanceSpread == null ? null : Math.round(performanceSpread * 100) / 100,
    maxPerformanceSpread: MINING_WORLD_ECONOMY_MAX_PERFORMANCE_SPREAD,
    ...totals,
    rounds: roundRows,
    belts: beltRows,
    alerts,
    estimationNote: "全服报表按矿洞公开概率与实际出料数量、重量估算产值，不读取隐藏品质；成本计入每轮全部已支付租金，空置班次不会被忽略。"
  };
}

function miningSandboxNetSpread(models) {
  const nets = models.map((model) => Number(model?.estimatedNet) || 0);
  if (!nets.length) return 0;
  return Math.round((Math.max(...nets) / Math.max(1, Math.min(...nets))) * 100) / 100;
}

export function miningEconomyTuningSandbox(report = {}) {
  const sourceBelts = Array.isArray(report?.belts) ? report.belts : [];
  const models = sourceBelts.map((belt) => {
    const useObserved = belt?.qualifiedForTuning === true && Number(belt.shiftCount) > 0;
    const outputPerShift = useObserved
      ? Math.max(0, Math.round(Number(belt.averageOutputPerShift) || 0))
      : Math.max(0, Math.round(Number(belt.benchmarkOutputPerShift) || 0));
    const operatingCostPerShift = useObserved
      ? Math.max(0, Math.round((Number(belt.operatingCost) || 0) / Math.max(1, Number(belt.shiftCount) || 0)))
      : Math.max(0, Math.round(Number(belt.benchmarkOperatingCostPerShift) || 0));
    const rentPerShift = useObserved
      ? Math.max(0, Math.round((Number(belt.rentCost) || 0) / Math.max(1, Number(belt.shiftCount) || 0)))
      : Math.max(0, Math.round(Number(belt.benchmarkRentPerShift) || 0));
    const allInCost = operatingCostPerShift + rentPerShift;
    const estimatedNet = outputPerShift - allInCost;
    return {
      beltId: String(belt?.beltId || ""),
      beltLabel: String(belt?.beltLabel || belt?.beltId || "未知矿带"),
      source: useObserved ? "observed" : "benchmark",
      shiftCount: Math.max(0, Number(belt?.shiftCount) || 0),
      utilization: belt?.utilization == null ? null : Math.max(0, Number(belt.utilization) || 0),
      performanceIndex: belt?.performanceIndex == null ? null : Number(belt.performanceIndex),
      outputPerShift,
      operatingCostPerShift,
      rentPerShift,
      allInCost,
      estimatedNet,
      margin: outputPerShift ? estimatedNet / outputPerShift : allInCost ? -1 : 0
    };
  }).filter((model) => model.beltId);
  const baselineSpread = miningSandboxNetSpread(models);
  const bands = models.map((model) => {
    let recommendedScenarioId = null;
    let recommendationReason = report?.sampleReady
      ? "该矿带样本仍不足，暂不生成调整建议。"
      : "全服样本尚未达标，当前仅按公开基准演算。";
    if (model.source === "observed") {
      if (model.utilization != null && model.utilization < MINING_ECONOMY_MIN_LEASE_UTILIZATION) {
        recommendedScenarioId = "hold";
        recommendationReason = "租期利用率偏低，先优化开工率，暂不改产出或租金。";
      } else if (model.performanceIndex != null && model.performanceIndex > 1.15) {
        recommendedScenarioId = "output-3";
        recommendationReason = "归一后产值高于自身基准 15% 以上，建议只做 3% 的温和回收。";
      } else if (
        (model.performanceIndex != null && model.performanceIndex < 0.85)
        || model.margin < MINING_ECONOMY_MIN_MARGIN
      ) {
        recommendedScenarioId = "rent-5";
        recommendationReason = "利润或产值偏低，优先减租 5%，避免直接增产造成原石通胀。";
      } else {
        recommendedScenarioId = "hold";
        recommendationReason = "该矿带当前处于健康区间，建议维持现状继续观察。";
      }
    }
    const scenarios = MINING_TUNING_SCENARIOS.map((scenario) => {
      const outputPerShift = Math.max(0, Math.round(model.outputPerShift * (1 + scenario.outputDelta)));
      const rentPerShift = Math.max(0, Math.round(model.rentPerShift * (1 + scenario.rentDelta)));
      const allInCost = model.operatingCostPerShift + rentPerShift;
      const estimatedNet = outputPerShift - allInCost;
      const projectedModels = models.map((entry) => entry.beltId === model.beltId
        ? { ...entry, estimatedNet }
        : entry);
      const projectedSpread = miningSandboxNetSpread(projectedModels);
      return {
        id: scenario.id,
        label: scenario.label,
        rentDelta: scenario.rentDelta,
        outputDelta: scenario.outputDelta,
        outputPerShift,
        operatingCostPerShift: model.operatingCostPerShift,
        rentPerShift,
        allInCost,
        estimatedNet,
        margin: outputPerShift ? estimatedNet / outputPerShift : allInCost ? -1 : 0,
        netDelta: estimatedNet - model.estimatedNet,
        marginDelta: outputPerShift
          ? estimatedNet / outputPerShift - model.margin
          : 0,
        projectedSpread,
        spreadDelta: projectedSpread - baselineSpread
      };
    });
    return {
      ...model,
      recommendedScenarioId,
      recommendationReason,
      scenarios
    };
  });
  return {
    sampleReady: report?.sampleReady === true,
    basis: bands.some((band) => band.source === "observed") ? "observed" : "benchmark",
    baselineSpread,
    maxNetSpread: MINING_ECONOMY_MAX_NET_SPREAD,
    scenarios: MINING_TUNING_SCENARIOS.map((scenario) => ({ ...scenario })),
    bands,
    note: report?.sampleReady
      ? "达标矿带使用近期全服表现演算，未达标矿带仍使用公开基准；结果仅供比较，不会自动修改正式数值。"
      : "全服样本未达标，全部方案暂按公开矿洞基准演算；结果仅供比较，不会自动修改正式数值。"
  };
}

function miningTuningObservationAggregate(rows = [], key = "projected") {
  const values = rows.map((row) => row?.[key] || {});
  const outputPerShift = values.reduce((sum, value) => sum + (Number(value.outputPerShift) || 0), 0);
  const allInCost = values.reduce((sum, value) => sum + (Number(value.allInCost) || 0), 0);
  const estimatedNet = values.reduce((sum, value) => sum + (Number(value.estimatedNet) || 0), 0);
  return {
    outputPerShift: Math.round(outputPerShift),
    allInCost: Math.round(allInCost),
    estimatedNet: Math.round(estimatedNet),
    margin: outputPerShift > 0 ? estimatedNet / outputPerShift : 0
  };
}

export function miningTuningObservationReport(experiment = {}, { players = [], rounds = [] } = {}) {
  const baselineRoundNumber = Math.max(0, Math.round(Number(experiment.baselineRoundNumber) || 0));
  const targetRoundCount = Math.max(1, Math.round(
    Number(experiment.targetRoundCount) || MINING_TUNING_OBSERVATION_ROUNDS
  ));
  const observationRounds = (Array.isArray(rounds) ? rounds : [])
    .filter((round) => round && Number(round.number) > baselineRoundNumber)
    .sort((left, right) => Number(left.number) - Number(right.number))
    .slice(0, targetRoundCount);
  const report = miningWorldEconomyReport({ players, rounds: observationRounds });
  const rows = Array.isArray(experiment.rows) ? experiment.rows : [];
  const actualRows = rows.map((row) => {
    const belt = report.belts.find((entry) => entry.beltId === row.beltId);
    const shiftCount = Math.max(0, Math.round(Number(belt?.shiftCount) || 0));
    const outputPerShift = shiftCount
      ? Math.round((Number(belt?.estimatedOutputValue) || 0) / shiftCount)
      : 0;
    const allInCost = shiftCount
      ? Math.round((Number(belt?.allInCost) || 0) / shiftCount)
      : 0;
    const estimatedNet = outputPerShift - allInCost;
    return {
      beltId: row.beltId,
      beltLabel: row.beltLabel,
      shiftCount,
      outputPerShift,
      allInCost,
      estimatedNet,
      margin: outputPerShift > 0 ? estimatedNet / outputPerShift : 0
    };
  });
  const actualAvailable = actualRows.length > 0 && actualRows.every((row) => row.shiftCount > 0);
  const selectedSampleReady = actualRows.length > 0 && actualRows.every((row) => (
    row.shiftCount >= MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS
  ));
  const roundsComplete = observationRounds.length >= targetRoundCount;
  const status = roundsComplete
    ? selectedSampleReady ? "complete" : "insufficient"
    : "collecting";
  const statusLabel = status === "complete"
    ? "观察完成"
    : status === "insufficient"
      ? "样本不足"
      : "观察中";
  const forecast = miningTuningObservationAggregate(rows, "projected");
  const actual = actualAvailable
    ? miningTuningObservationAggregate(actualRows.map((row) => ({ projected: row })), "projected")
    : null;
  const allBeltNets = report.belts
    .filter((belt) => Number(belt.shiftCount) > 0)
    .map((belt) => (
      (Number(belt.estimatedOutputValue) - Number(belt.allInCost))
      / Math.max(1, Number(belt.shiftCount) || 0)
    ));
  const actualSpread = allBeltNets.length === report.belts.length
    ? miningSandboxNetSpread(allBeltNets.map((estimatedNet) => ({ estimatedNet })))
    : null;
  const forecastSpread = Number(experiment.forecast?.projectedSpread) || 0;
  const observation = {
    id: String(experiment.id || ""),
    createdAt: Number(experiment.createdAt) || null,
    baselineRoundNumber,
    targetRoundCount,
    status,
    statusLabel,
    observedRoundCount: observationRounds.length,
    observedRoundNumbers: observationRounds.map((round) => Math.round(Number(round.number) || 0)),
    observedShiftCount: report.shiftCount,
    minimumSelectedBeltShifts: actualRows.length
      ? Math.min(...actualRows.map((row) => row.shiftCount))
      : 0,
    requiredSelectedBeltShifts: MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS,
    sampleReadyAtStart: experiment.sampleReadyAtStart === true,
    basis: experiment.basis === "observed" ? "observed" : "benchmark",
    draftStatus: String(experiment.draftStatus || "benchmark-only"),
    draftIssues: Array.isArray(experiment.draftIssues) ? experiment.draftIssues : [],
    rows,
    actualRows,
    forecast,
    actual,
    forecastSpread,
    actualSpread,
    netDelta: actual ? actual.estimatedNet - forecast.estimatedNet : null,
    marginDelta: actual ? actual.margin - forecast.margin : null,
    spreadDelta: actualSpread == null ? null : actualSpread - forecastSpread,
    note: status === "complete"
      ? "后续实况已达到观察口径；由于草案参数未实际套用，该对比只反映预测与自然实况的偏差，不代表调参造成的因果效果。"
      : status === "insufficient"
        ? "观察窗口已结束，但所选矿带班次不足，不能据此判断方案效果。"
        : "正在等待后续结束轮次；影子观察不会修改正式租金或产出规则。"
  };
  observation.assessment = miningTuningObservationAssessment(observation);
  return observation;
}

export function miningTuningObservationAssessment(observation = {}) {
  const status = String(observation.status || "collecting");
  const forecast = observation.forecast || {};
  const actual = observation.actual || null;
  const netErrorRate = actual
    ? Math.abs(Number(observation.netDelta) || 0) / Math.max(1, Math.abs(Number(forecast.estimatedNet) || 0))
    : null;
  const marginError = actual ? Math.abs(Number(observation.marginDelta) || 0) : null;
  const forecastSpread = Number(observation.forecastSpread) || 0;
  const actualSpread = observation.actualSpread == null ? null : Number(observation.actualSpread);
  const spreadReady = actualSpread != null;
  const spreadSafe = spreadReady
    && forecastSpread <= MINING_ECONOMY_MAX_NET_SPREAD
    && actualSpread <= MINING_ECONOMY_MAX_NET_SPREAD;
  const metrics = {
    netErrorRate,
    marginError,
    forecastSpread,
    actualSpread,
    maximumNetErrorRate: MINING_TUNING_OBSERVATION_MAX_NET_ERROR_RATE,
    maximumMarginError: MINING_TUNING_OBSERVATION_MAX_MARGIN_ERROR,
    maximumSpread: MINING_ECONOMY_MAX_NET_SPREAD
  };
  if (status === "collecting") {
    return {
      id: "collecting",
      label: "等待观察完成",
      tone: "neutral",
      summary: "当前只有阶段数据，暂不生成模型校准结论。",
      reasons: [`已完成 ${Number(observation.observedRoundCount) || 0}/${Number(observation.targetRoundCount) || MINING_TUNING_OBSERVATION_ROUNDS} 个观察轮次。`],
      metrics
    };
  }
  if (status === "insufficient" || !actual) {
    return {
      id: "insufficient",
      label: "样本不足",
      tone: "warning",
      summary: "观察窗口内的所选矿带班次不足，不能校准预测模型。",
      reasons: [`最低矿带样本 ${Number(observation.minimumSelectedBeltShifts) || 0}/${Number(observation.requiredSelectedBeltShifts) || MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS} 班。`],
      metrics
    };
  }
  const netAccurate = netErrorRate <= MINING_TUNING_OBSERVATION_MAX_NET_ERROR_RATE;
  const marginAccurate = marginError <= MINING_TUNING_OBSERVATION_MAX_MARGIN_ERROR;
  if (netAccurate && marginAccurate && spreadSafe) {
    return {
      id: "review-ready",
      label: "可进入人工审核",
      tone: "good",
      summary: "后续自然实况与草案预测接近，预测口径可进入人工复核；这不代表调参方案已经验证有效。",
      reasons: [
        `净收益预测偏差 ${Math.round(netErrorRate * 1000) / 10}%（上限 ${Math.round(MINING_TUNING_OBSERVATION_MAX_NET_ERROR_RATE * 100)}%）。`,
        `利润率预测偏差 ${Math.round(marginError * 1000) / 10} 个百分点（上限 ${Math.round(MINING_TUNING_OBSERVATION_MAX_MARGIN_ERROR * 100)} 个百分点）。`,
        `五矿带实况差距 ${actualSpread} 倍，未超过 ${MINING_ECONOMY_MAX_NET_SPREAD} 倍。`
      ],
      metrics
    };
  }
  const moderateNetError = netErrorRate <= MINING_TUNING_OBSERVATION_MAX_NET_ERROR_RATE * 2;
  const moderateMarginError = marginError <= MINING_TUNING_OBSERVATION_MAX_MARGIN_ERROR * 2;
  if (moderateNetError && moderateMarginError && (!spreadReady || actualSpread <= MINING_ECONOMY_MAX_NET_SPREAD)) {
    return {
      id: "extend-observation",
      label: "建议追加观察",
      tone: "warning",
      summary: "预测偏差尚未失控，但当前精度或全矿带覆盖不足，建议补充一组独立观察再复核。",
      reasons: [
        `净收益预测偏差 ${Math.round(netErrorRate * 1000) / 10}%。`,
        `利润率预测偏差 ${Math.round(marginError * 1000) / 10} 个百分点。`,
        spreadReady ? `五矿带实况差距 ${actualSpread} 倍。` : "五矿带实况样本尚未齐全。"
      ],
      metrics
    };
  }
  return {
    id: "recalibrate",
    label: "需要重估模型",
    tone: "critical",
    summary: "自然实况与草案预测偏差较大，应先复核估值、成本或样本口径，不宜据此推进数值调整。",
    reasons: [
      `净收益预测偏差 ${Math.round(netErrorRate * 1000) / 10}%。`,
      `利润率预测偏差 ${Math.round(marginError * 1000) / 10} 个百分点。`,
      spreadReady
        ? `五矿带实况差距 ${actualSpread} 倍${actualSpread > MINING_ECONOMY_MAX_NET_SPREAD ? "，已超过安全线" : ""}。`
        : "五矿带实况样本尚未齐全。"
    ],
    metrics
  };
}

export function miningTuningMetricSnapshot(value = {}) {
  const outputPerShift = Math.max(0, Math.round(Number(value?.outputPerShift) || 0));
  const allInCost = Math.max(0, Math.round(Number(value?.allInCost) || 0));
  const estimatedNet = Number.isFinite(Number(value?.estimatedNet))
    ? Math.round(Number(value.estimatedNet))
    : outputPerShift - allInCost;
  return {
    outputPerShift,
    allInCost,
    estimatedNet,
    margin: Number.isFinite(Number(value?.margin))
      ? Number(value.margin)
      : outputPerShift > 0 ? estimatedNet / outputPerShift : allInCost ? -1 : 0
  };
}

export function nullableMiningTuningMetricSnapshot(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? miningTuningMetricSnapshot(value)
    : null;
}

function miningTuningVersionEffectAssessment(effect = {}) {
  const targetRoundCount = Number(effect.targetRoundCount) || MINING_TUNING_EFFECT_ROUNDS;
  const metrics = {
    actualSpread: effect.actualSpread == null ? null : Number(effect.actualSpread),
    maximumSpread: MINING_ECONOMY_MAX_NET_SPREAD,
    netDeltaFromBaseline: effect.netDeltaFromBaseline == null
      ? null
      : Number(effect.netDeltaFromBaseline),
    modelErrorRate: effect.modelErrorRate == null ? null : Number(effect.modelErrorRate),
    maximumProjectionErrorRate: MINING_TUNING_EFFECT_MAX_PROJECTION_ERROR_RATE,
    maximumNetDeclineRate: MINING_TUNING_EFFECT_MAX_NET_DECLINE_RATE
  };
  if (effect.status === "collecting") {
    return {
      id: "collecting",
      label: "持续跟踪中",
      tone: "neutral",
      summary: "正式版本已经生效，正在收集三个完整轮次的实际表现。",
      reasons: [`已完成 ${Number(effect.observedRoundCount) || 0}/${targetRoundCount} 个生效后轮次。`],
      metrics
    };
  }
  if (effect.status === "interrupted") {
    return {
      id: "interrupted",
      label: "观察提前中止",
      tone: "warning",
      summary: "该版本在完成三个独立轮次前被紧急回滚，现有数据只保留为审计记录。",
      reasons: [`仅完成 ${Number(effect.observedRoundCount) || 0}/${targetRoundCount} 个属于该版本的轮次。`],
      metrics
    };
  }
  if (effect.status === "insufficient" || !effect.actual) {
    return {
      id: "insufficient",
      label: "样本不足",
      tone: "warning",
      summary: "三轮窗口已结束，但所选矿带班次不足，暂不能评价调整效果。",
      reasons: [`最低矿带样本 ${Number(effect.minimumSelectedBeltShifts) || 0}/${Number(effect.requiredSelectedBeltShifts) || MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS} 班。`],
      metrics
    };
  }

  const rows = Array.isArray(effect.rows) ? effect.rows : [];
  const criticalReasons = [];
  const watchReasons = [];
  if (effect.actualSpread != null && Number(effect.actualSpread) > MINING_ECONOMY_MAX_NET_SPREAD) {
    criticalReasons.push(`五矿带实际净收益差距 ${effect.actualSpread} 倍，超过 ${MINING_ECONOMY_MAX_NET_SPREAD} 倍安全线。`);
  }
  const lossRow = rows.find((row) => Number(row.actual?.estimatedNet) <= 0);
  if (lossRow) criticalReasons.push(`${lossRow.beltLabel}实际单班净收益已不高于 0。`);
  const thinMarginRow = rows.find((row) => Number(row.actual?.margin) < MINING_ECONOMY_MIN_MARGIN);
  if (thinMarginRow) {
    criticalReasons.push(`${thinMarginRow.beltLabel}实际净收益率低于 ${Math.round(MINING_ECONOMY_MIN_MARGIN * 100)}% 安全线。`);
  }
  const declinedPositiveIntent = rows.find((row) => {
    const baselineNet = Number(row.baseline?.estimatedNet);
    const projectedNet = Number(row.projected?.estimatedNet);
    const actualNet = Number(row.actual?.estimatedNet);
    return baselineNet > 0
      && projectedNet > baselineNet
      && actualNet < baselineNet * (1 - MINING_TUNING_EFFECT_MAX_NET_DECLINE_RATE);
  });
  if (declinedPositiveIntent) {
    criticalReasons.push(`${declinedPositiveIntent.beltLabel}原计划改善收益，但实际较生效前下降超过 ${Math.round(MINING_TUNING_EFFECT_MAX_NET_DECLINE_RATE * 100)}%。`);
  }

  if (effect.actualSpread == null) watchReasons.push("五矿带样本尚未齐全，暂不能确认全局差距安全。");
  if (effect.modelErrorRate != null && Number(effect.modelErrorRate) > MINING_TUNING_EFFECT_MAX_PROJECTION_ERROR_RATE) {
    watchReasons.push(`实际净收益与原预测偏差 ${Math.round(Number(effect.modelErrorRate) * 1000) / 10}%，超过 ${Math.round(MINING_TUNING_EFFECT_MAX_PROJECTION_ERROR_RATE * 100)}% 观察线。`);
  }
  const directionMismatch = rows.find((row) => {
    if (!row.baseline || !row.projected || !row.actual) return false;
    const expectedDelta = Number(row.projected.estimatedNet) - Number(row.baseline.estimatedNet);
    const actualDelta = Number(row.actual.estimatedNet) - Number(row.baseline.estimatedNet);
    return Math.abs(expectedDelta) >= 1 && expectedDelta * actualDelta < 0;
  });
  if (directionMismatch && directionMismatch !== declinedPositiveIntent) {
    watchReasons.push(`${directionMismatch.beltLabel}实际变化方向与原预测相反。`);
  }

  if (criticalReasons.length) {
    return {
      id: "rollback-recommended",
      label: "建议人工回滚",
      tone: "critical",
      summary: "生效后表现已触发安全线，建议审核人安排下一安全轮次回滚；系统不会自动执行。",
      reasons: criticalReasons,
      metrics
    };
  }
  if (watchReasons.length) {
    return {
      id: "watch",
      label: "继续观察",
      tone: "warning",
      summary: "核心利润安全线尚未失守，但预测偏差或全局覆盖仍需继续留意。",
      reasons: watchReasons,
      metrics
    };
  }
  return {
    id: "stable",
    label: "表现稳定",
    tone: "good",
    summary: "三个生效后轮次未触发利润、预测偏差或矿带差距安全线。",
    reasons: ["当前仅确认短期表现稳定，仍应结合后续物价与参与率复核。"],
    metrics
  };
}

export function miningTuningVersionEffectReport(version = {}, { players = [], rounds = [] } = {}) {
  const activatedRoundNumber = Math.max(0, Math.round(Number(version?.activatedRoundNumber) || 0));
  const observedRounds = (Array.isArray(rounds) ? rounds : [])
    .filter((round) => (
      round
      && activatedRoundNumber > 0
      && Number(round.number) >= activatedRoundNumber
      && String(round.tuningVersionId || "") === String(version?.id || "")
    ))
    .sort((left, right) => Number(left.number) - Number(right.number))
    .slice(0, MINING_TUNING_EFFECT_ROUNDS);
  const report = miningWorldEconomyReport({
    players,
    rounds: observedRounds,
    mineRules: version?.rules || {}
  });
  const versionRows = Array.isArray(version?.rows) ? version.rows : [];
  const baselineRows = Array.isArray(version?.effectBaseline?.actualRows)
    ? version.effectBaseline.actualRows
    : [];
  const actualRows = versionRows.map((row) => {
    const belt = report.belts.find((entry) => entry.beltId === row.beltId);
    const shiftCount = Math.max(0, Math.round(Number(belt?.shiftCount) || 0));
    const outputPerShift = shiftCount
      ? Math.round((Number(belt?.estimatedOutputValue) || 0) / shiftCount)
      : 0;
    const allInCost = shiftCount
      ? Math.round((Number(belt?.allInCost) || 0) / shiftCount)
      : 0;
    const estimatedNet = outputPerShift - allInCost;
    return {
      beltId: row.beltId,
      beltLabel: row.beltLabel,
      shiftCount,
      outputPerShift,
      allInCost,
      estimatedNet,
      margin: outputPerShift > 0 ? estimatedNet / outputPerShift : 0
    };
  });
  const selectedSampleReady = actualRows.length > 0 && actualRows.every((row) => (
    row.shiftCount >= MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS
  ));
  const roundsComplete = observedRounds.length >= MINING_TUNING_EFFECT_ROUNDS;
  const status = !roundsComplete && version?.status === "superseded"
    ? "interrupted"
    : roundsComplete
    ? selectedSampleReady ? "complete" : "insufficient"
    : "collecting";
  const actualAvailable = actualRows.length > 0 && actualRows.every((row) => row.shiftCount > 0);
  const actual = actualAvailable
    ? miningTuningObservationAggregate(actualRows.map((row) => ({ projected: row })), "projected")
    : null;
  const baseline = nullableMiningTuningMetricSnapshot(version?.effectBaseline?.actual)
    || (versionRows.length && versionRows.every((row) => row.baseline)
      ? miningTuningObservationAggregate(versionRows, "baseline")
      : null);
  const projected = versionRows.length && versionRows.every((row) => row.projected)
    ? miningTuningObservationAggregate(versionRows, "projected")
    : null;
  const allBeltNets = report.belts
    .filter((belt) => Number(belt.shiftCount) > 0)
    .map((belt) => ({
      estimatedNet: (
        Number(belt.estimatedOutputValue) - Number(belt.allInCost)
      ) / Math.max(1, Number(belt.shiftCount) || 0)
    }));
  const actualSpread = allBeltNets.length === report.belts.length
    ? miningSandboxNetSpread(allBeltNets)
    : null;
  const rowsWithComparisons = versionRows.map((row) => {
    const baselineRow = baselineRows.find((entry) => entry.beltId === row.beltId);
    const actualRow = actualRows.find((entry) => entry.beltId === row.beltId);
    const baselineMetric = nullableMiningTuningMetricSnapshot(baselineRow || row.baseline);
    const projectedMetric = nullableMiningTuningMetricSnapshot(row.projected);
    const actualMetric = actualRow?.shiftCount
      ? miningTuningMetricSnapshot(actualRow)
      : null;
    return {
      beltId: row.beltId,
      beltLabel: row.beltLabel,
      scenarioLabel: row.scenarioLabel,
      shiftCount: actualRow?.shiftCount || 0,
      baseline: baselineMetric,
      projected: projectedMetric,
      actual: actualMetric,
      netDeltaFromBaseline: baselineMetric && actualMetric
        ? actualMetric.estimatedNet - baselineMetric.estimatedNet
        : null,
      marginDeltaFromBaseline: baselineMetric && actualMetric
        ? actualMetric.margin - baselineMetric.margin
        : null,
      modelErrorRate: projectedMetric && actualMetric
        ? Math.abs(actualMetric.estimatedNet - projectedMetric.estimatedNet)
          / Math.max(1, Math.abs(projectedMetric.estimatedNet))
        : null
    };
  });
  const effect = {
    versionId: String(version?.id || ""),
    activatedRoundNumber: activatedRoundNumber || null,
    targetRoundCount: MINING_TUNING_EFFECT_ROUNDS,
    status,
    statusLabel: status === "complete"
      ? "跟踪完成"
      : status === "insufficient"
        ? "样本不足"
        : status === "interrupted"
          ? "提前中止"
          : "跟踪中",
    observedRoundCount: observedRounds.length,
    observedRoundNumbers: observedRounds.map((round) => Math.round(Number(round.number) || 0)),
    observedShiftCount: report.shiftCount,
    minimumSelectedBeltShifts: actualRows.length
      ? Math.min(...actualRows.map((row) => row.shiftCount))
      : 0,
    requiredSelectedBeltShifts: MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS,
    baseline,
    projected,
    actual,
    rows: rowsWithComparisons,
    actualSpread,
    baselineSpread: version?.effectBaseline?.actualSpread == null
      ? null
      : Number(version.effectBaseline.actualSpread),
    netDeltaFromBaseline: baseline && actual
      ? actual.estimatedNet - baseline.estimatedNet
      : null,
    marginDeltaFromBaseline: baseline && actual
      ? actual.margin - baseline.margin
      : null,
    modelErrorRate: projected && actual
      ? Math.abs(actual.estimatedNet - projected.estimatedNet)
        / Math.max(1, Math.abs(projected.estimatedNet))
      : null,
    note: status === "complete"
      ? "结果来自正式版本生效后的三个完整轮次，可用于安全复核，但仍是观察关联，不等同于因果证明。"
      : status === "insufficient"
        ? "三轮窗口已结束，但所选矿带班次不足；系统不会据此自动回滚。"
        : status === "interrupted"
          ? "该版本因紧急回滚而提前结束，未混入其他版本轮次；阶段数据仅保留审计。"
        : "正在等待正式版本生效后的完整轮次；当前结果仅作阶段提示。"
  };
  effect.assessment = miningTuningVersionEffectAssessment(effect);
  return effect;
}

export function normalizeMiningTuningEffectResult(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = ["complete", "insufficient", "interrupted"].includes(value.status)
    ? value.status
    : null;
  if (!status) return null;
  const numericOrNull = (entry) => entry == null || !Number.isFinite(Number(entry))
    ? null
    : Number(entry);
  const assessment = value.assessment && typeof value.assessment === "object"
    && !Array.isArray(value.assessment)
    ? {
      id: String(value.assessment.id || status),
      label: String(value.assessment.label || value.statusLabel || "已归档"),
      tone: ["neutral", "good", "warning", "critical"].includes(value.assessment.tone)
        ? value.assessment.tone
        : "neutral",
      summary: String(value.assessment.summary || "正式版本效果记录已归档。"),
      reasons: (Array.isArray(value.assessment.reasons) ? value.assessment.reasons : [])
        .map((reason) => String(reason || ""))
        .filter(Boolean)
        .slice(0, 6),
      metrics: value.assessment.metrics && typeof value.assessment.metrics === "object"
        && !Array.isArray(value.assessment.metrics)
        ? Object.fromEntries(Object.entries(value.assessment.metrics)
          .flatMap(([key, metric]) => metric != null && Number.isFinite(Number(metric))
            ? [[key, Number(metric)]]
            : []))
        : {}
    }
    : null;
  return {
    versionId: String(value.versionId || ""),
    finalizedAt: numericOrNull(value.finalizedAt),
    activatedRoundNumber: numericOrNull(value.activatedRoundNumber),
    targetRoundCount: Math.max(1, Math.round(Number(value.targetRoundCount) || MINING_TUNING_EFFECT_ROUNDS)),
    status,
    statusLabel: String(value.statusLabel || (status === "complete" ? "跟踪完成" : status === "insufficient" ? "样本不足" : "提前中止")),
    observedRoundCount: Math.max(0, Math.round(Number(value.observedRoundCount) || 0)),
    observedRoundNumbers: (Array.isArray(value.observedRoundNumbers) ? value.observedRoundNumbers : [])
      .map((roundNumber) => Math.max(1, Math.round(Number(roundNumber) || 1)))
      .slice(0, MINING_TUNING_EFFECT_ROUNDS),
    observedShiftCount: Math.max(0, Math.round(Number(value.observedShiftCount) || 0)),
    minimumSelectedBeltShifts: Math.max(0, Math.round(Number(value.minimumSelectedBeltShifts) || 0)),
    requiredSelectedBeltShifts: Math.max(1, Math.round(Number(value.requiredSelectedBeltShifts) || MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS)),
    baseline: nullableMiningTuningMetricSnapshot(value.baseline),
    projected: nullableMiningTuningMetricSnapshot(value.projected),
    actual: nullableMiningTuningMetricSnapshot(value.actual),
    rows: (Array.isArray(value.rows) ? value.rows : [])
      .filter((row) => row && typeof row === "object" && !Array.isArray(row))
      .map((row) => ({
        beltId: String(row.beltId || ""),
        beltLabel: String(row.beltLabel || row.beltId || "未知矿带"),
        scenarioLabel: String(row.scenarioLabel || ""),
        shiftCount: Math.max(0, Math.round(Number(row.shiftCount) || 0)),
        baseline: nullableMiningTuningMetricSnapshot(row.baseline),
        projected: nullableMiningTuningMetricSnapshot(row.projected),
        actual: nullableMiningTuningMetricSnapshot(row.actual),
        netDeltaFromBaseline: numericOrNull(row.netDeltaFromBaseline),
        marginDeltaFromBaseline: numericOrNull(row.marginDeltaFromBaseline),
        modelErrorRate: numericOrNull(row.modelErrorRate)
      }))
      .filter((row) => row.beltId)
      .slice(0, 2),
    actualSpread: numericOrNull(value.actualSpread),
    baselineSpread: numericOrNull(value.baselineSpread),
    netDeltaFromBaseline: numericOrNull(value.netDeltaFromBaseline),
    marginDeltaFromBaseline: numericOrNull(value.marginDeltaFromBaseline),
    modelErrorRate: numericOrNull(value.modelErrorRate),
    note: String(value.note || "正式版本效果记录已归档。"),
    assessment
  };
}

export function normalizedTuningMultiplier(value) {
  return Math.max(
    MINING_TUNING_MULTIPLIER_MIN,
    Math.min(MINING_TUNING_MULTIPLIER_MAX, Number(value) || 1)
  );
}

export function miningTuningRulesFromRows(rows = [], baseRules = {}) {
  const beltIds = [...new Set(MINES.map((mine) => mine.beltId))];
  const rules = Object.fromEntries(beltIds.map((beltId) => {
    const source = baseRules?.[beltId] || {};
    return [beltId, {
      rentMultiplier: normalizedTuningMultiplier(source.rentMultiplier),
      outputMultiplier: normalizedTuningMultiplier(source.outputMultiplier)
    }];
  }));
  for (const row of Array.isArray(rows) ? rows : []) {
    const beltId = String(row?.beltId || "");
    if (!rules[beltId]) continue;
    rules[beltId] = {
      rentMultiplier: normalizedTuningMultiplier(
        rules[beltId].rentMultiplier * (1 + (Number(row.rentDelta) || 0))
      ),
      outputMultiplier: normalizedTuningMultiplier(
        rules[beltId].outputMultiplier * (1 + (Number(row.outputDelta) || 0))
      )
    };
  }
  return rules;
}

export function miningTuningAdjustedMine(mine, rules = {}) {
  if (!mine) return null;
  const rule = rules?.[mine.beltId] || {};
  const rentMultiplier = normalizedTuningMultiplier(rule.rentMultiplier);
  const outputMultiplier = normalizedTuningMultiplier(rule.outputMultiplier);
  return {
    ...mine,
    baseRent: Math.max(0, Math.round(Number(mine.rent) || 0)),
    rent: Math.max(0, Math.round((Number(mine.rent) || 0) * rentMultiplier)),
    rentMultiplier,
    outputMultiplier
  };
}
