export const MINING_BASIC_MODE = true;
export const MINING_REQUIRED_REP = 100;
export const MINING_REQUIRED_PLAYERS = 50;
export const MINING_ACTIVE_PLAYER_MS = 30 * 24 * 60 * 60 * 1000;
export const MINING_ROSTER_INACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
export const MINING_MAX_SKIPPED_APPLICATION_ROUNDS = 3;
export const MINING_HEALTH_MIN_OBSERVED_ROUNDS = 3;
export const MINING_HEALTH_MIN_PARTICIPATION_RATE = 0.65;
export const MINING_HEALTH_MAX_WAIT_LEASES = 2;
export const MINING_HEALTH_MAX_MINE_CONCENTRATION = 0.6;
export const MINING_HEALTH_MIN_CONCENTRATION_APPLICANTS = 5;
export const MINING_HEALTH_MAX_RELEASE_RATE = 0.12;
export const MINING_ECONOMY_RECENT_SHIFT_LIMIT = 12;
export const MINING_ECONOMY_RECENT_LEASE_LIMIT = 6;
export const MINING_ECONOMY_MIN_MARGIN = 0.2;
export const MINING_ECONOMY_MAX_LOSS_SHIFT_RATE = 0.35;
export const MINING_ECONOMY_MIN_LEASE_UTILIZATION = 0.6;
export const MINING_ECONOMY_MAX_NET_SPREAD = 5;
export const MINING_WORLD_ECONOMY_RECENT_ROUND_LIMIT = 6;
export const MINING_WORLD_ECONOMY_MIN_ROUNDS = 3;
export const MINING_WORLD_ECONOMY_MIN_SHIFTS = 30;
export const MINING_WORLD_ECONOMY_MIN_PLAYERS = 5;
export const MINING_WORLD_ECONOMY_MIN_BELT_SHIFTS = 8;
export const MINING_WORLD_ECONOMY_MAX_PERFORMANCE_SPREAD = 1.35;
export const MINING_TUNING_OBSERVATION_ROUNDS = 3;
export const MINING_TUNING_OBSERVATION_MAX_RECORDS = 6;
export const MINING_TUNING_OBSERVATION_MAX_NET_ERROR_RATE = 0.1;
export const MINING_TUNING_OBSERVATION_MAX_MARGIN_ERROR = 0.03;
export const MINING_TUNING_VERSION_MAX_RECORDS = 12;
export const MINING_TUNING_MULTIPLIER_MIN = 0.8;
export const MINING_TUNING_MULTIPLIER_MAX = 1.2;
export const MINING_TUNING_EFFECT_ROUNDS = 3;
export const MINING_TUNING_EFFECT_MAX_NET_DECLINE_RATE = 0.1;
export const MINING_TUNING_EFFECT_MAX_PROJECTION_ERROR_RATE = 0.2;
export const MINING_TUNING_SCENARIOS = Object.freeze([
  Object.freeze({ id: "hold", label: "维持现状", rentDelta: 0, outputDelta: 0 }),
  Object.freeze({ id: "rent-5", label: "租金 -5%", rentDelta: -0.05, outputDelta: 0 }),
  Object.freeze({ id: "output+5", label: "产出 +5%", rentDelta: 0, outputDelta: 0.05 }),
  Object.freeze({ id: "balanced", label: "租金 -3% · 产出 +3%", rentDelta: -0.03, outputDelta: 0.03 }),
  Object.freeze({ id: "output-3", label: "产出 -3%", rentDelta: 0, outputDelta: -0.03 })
]);

function miningTuningSpread(values = []) {
  const normalized = values.map((value) => Number(value) || 0);
  if (!normalized.length) return 0;
  const highest = Math.max(...normalized);
  const lowest = Math.min(...normalized);
  if (highest <= 0) return 1;
  return Number((highest / Math.max(1, lowest)).toFixed(2));
}

export function miningTuningDraftProjection(sandbox = {}, selections = {}) {
  const bands = Array.isArray(sandbox.bands) ? sandbox.bands : [];
  const rows = bands.map((band) => {
    const scenarios = Array.isArray(band.scenarios) ? band.scenarios : [];
    const selectedId = String(selections?.[band.beltId] || "hold");
    const hold = scenarios.find((scenario) => scenario.id === "hold");
    const scenario = scenarios.find((entry) => entry.id === selectedId) || hold || {};
    const outputPerShift = Number(band.outputPerShift) || 0;
    const operatingCostPerShift = Number(band.operatingCostPerShift) || 0;
    const rentPerShift = Number(band.rentPerShift) || 0;
    const allInCost = Number(band.allInCost) || operatingCostPerShift + rentPerShift;
    const estimatedNet = Number(band.estimatedNet) || outputPerShift - allInCost;
    const projectedOutput = Number(scenario.outputPerShift ?? outputPerShift) || 0;
    const projectedOperatingCost = Number(scenario.operatingCostPerShift ?? operatingCostPerShift) || 0;
    const projectedRent = Number(scenario.rentPerShift ?? rentPerShift) || 0;
    const projectedCost = Number(scenario.allInCost ?? (projectedOperatingCost + projectedRent)) || 0;
    const projectedNet = Number(scenario.estimatedNet ?? (projectedOutput - projectedCost)) || 0;
    const scenarioId = String(scenario.id || "hold");
    return {
      beltId: band.beltId,
      beltLabel: band.beltLabel || band.beltId,
      source: band.source || "benchmark",
      recommendedScenarioId: band.recommendedScenarioId || null,
      scenarioId,
      scenarioLabel: scenario.label || "维持现状",
      rentDelta: Number(scenario.rentDelta) || 0,
      outputDelta: Number(scenario.outputDelta) || 0,
      changed: scenarioId !== "hold",
      baseline: {
        outputPerShift,
        operatingCostPerShift,
        rentPerShift,
        allInCost,
        estimatedNet,
        margin: outputPerShift > 0 ? estimatedNet / outputPerShift : 0
      },
      projected: {
        outputPerShift: projectedOutput,
        operatingCostPerShift: projectedOperatingCost,
        rentPerShift: projectedRent,
        allInCost: projectedCost,
        estimatedNet: projectedNet,
        margin: projectedOutput > 0 ? projectedNet / projectedOutput : 0
      },
      netDelta: projectedNet - estimatedNet
    };
  });
  const changedRows = rows.filter((row) => row.changed);
  const total = (path) => rows.reduce((sum, row) => sum + Number(path(row) || 0), 0);
  const baselineOutput = total((row) => row.baseline.outputPerShift);
  const baselineNet = total((row) => row.baseline.estimatedNet);
  const projectedOutput = total((row) => row.projected.outputPerShift);
  const projectedNet = total((row) => row.projected.estimatedNet);
  const baseline = {
    outputPerShift: baselineOutput,
    operatingCostPerShift: total((row) => row.baseline.operatingCostPerShift),
    rentPerShift: total((row) => row.baseline.rentPerShift),
    allInCost: total((row) => row.baseline.allInCost),
    estimatedNet: baselineNet,
    margin: baselineOutput > 0 ? baselineNet / baselineOutput : 0,
    spread: miningTuningSpread(rows.map((row) => row.baseline.estimatedNet))
  };
  const projected = {
    outputPerShift: projectedOutput,
    operatingCostPerShift: total((row) => row.projected.operatingCostPerShift),
    rentPerShift: total((row) => row.projected.rentPerShift),
    allInCost: total((row) => row.projected.allInCost),
    estimatedNet: projectedNet,
    margin: projectedOutput > 0 ? projectedNet / projectedOutput : 0,
    spread: miningTuningSpread(rows.map((row) => row.projected.estimatedNet))
  };
  const netGrowthRate = baselineNet > 0 ? (projectedNet - baselineNet) / baselineNet : 0;
  const issues = [];
  if (changedRows.length && !sandbox.sampleReady) {
    issues.push({
      id: "sample-immature",
      severity: "info",
      title: "样本尚未成熟",
      message: "当前只能作为基准草案，至少积累 3 轮、30 班和 5 名玩家后再进入正式观察。"
    });
  }
  if (changedRows.length > 2) {
    issues.push({
      id: "too-many-bands",
      severity: "warning",
      title: "单次调整范围过大",
      message: `本草案同时改动 ${changedRows.length} 个矿带；建议每次最多调整 2 个，以便判断真实影响。`
    });
  }
  if (netGrowthRate > 0.1) {
    issues.push({
      id: "portfolio-injection",
      severity: "warning",
      title: "整体收益放宽过快",
      message: `代表性组合净收益预计增加 ${Math.round(netGrowthRate * 100)}%，超过单次 10% 的安全线。`
    });
  }
  const maxNetSpread = Number(sandbox.maxNetSpread) || MINING_ECONOMY_MAX_NET_SPREAD;
  if (changedRows.length && projected.spread > maxNetSpread) {
    issues.push({
      id: "spread-over-limit",
      severity: "critical",
      title: "矿带差距仍然过大",
      message: `调整后净收益差距为 ${projected.spread} 倍，仍高于 ${maxNetSpread} 倍上限。`
    });
  }
  const healthyChanges = changedRows.filter((row) => (
    row.source === "observed" && row.recommendedScenarioId === "hold"
  ));
  if (healthyChanges.length) {
    issues.push({
      id: "healthy-band-adjustment",
      severity: "warning",
      title: "正在改动健康矿带",
      message: `${healthyChanges.map((row) => row.beltLabel).join("、")}的近期表现无需调整；如仍要改动，建议先说明设计目标。`
    });
  }
  let status = "empty";
  let statusLabel = "尚未选择调整";
  if (changedRows.length && !sandbox.sampleReady) {
    status = "benchmark-only";
    statusLabel = "仅基准草案";
  } else if (changedRows.length && issues.some((issue) => ["warning", "critical"].includes(issue.severity))) {
    status = "needs-review";
    statusLabel = "需要复核";
  } else if (changedRows.length) {
    status = "ready";
    statusLabel = "可进入观察期";
  }
  return {
    status,
    statusLabel,
    sampleReady: Boolean(sandbox.sampleReady),
    changedCount: changedRows.length,
    rows,
    changedRows,
    baseline,
    projected,
    netDelta: projectedNet - baselineNet,
    marginDelta: projected.margin - baseline.margin,
    spreadDelta: projected.spread - baseline.spread,
    netGrowthRate,
    maxNetSpread,
    issues,
    note: "组合草案只用于对比和观察期评审，不会自动写入正式租金或产出数值。"
  };
}
// Temporary rapid-test cadence. Restore the production durations here after playtesting.
export const MINING_LEASE_MS = 10 * 60 * 1000;
export const MINING_APPLICATION_MS = 1 * 60 * 1000;
export const MINING_SHIFT_MS = 1 * 60 * 1000;
export const MINING_MAX_SHIFTS_PER_LEASE = 5;
export const MINING_MAX_PREFERENCES = 3;
export const MINING_BASIC_MIN_CREW = 1;
export const MINING_BASIC_MAX_CREW = 3;
export const MINING_BASIC_EXTRA_YIELD_PER_POWER = 0.08;
export const MINING_BASIC_EXTRA_YIELD_MAX = 0.45;
export const MINING_BASIC_RISK_MIN = 0.03;
export const MINING_BASIC_RISK_MAX = 0.25;
export const MINING_BASIC_RISK_MULTIPLIER = 0.75;
export const MINING_MAX_MINERS = 6;
export const MINING_RECRUIT_REFRESH_COST = 500;

export const MINER_BASIC_GRADES = Object.freeze([
  Object.freeze({ id: "ordinary", name: "普通矿工", maxTier: 2, power: 1, wage: 400 }),
  Object.freeze({ id: "skilled", name: "熟练矿工", maxTier: 4, power: 2, wage: 900 }),
  Object.freeze({ id: "veteran", name: "资深矿工", maxTier: 6, power: 3, wage: 1_500 })
]);

export const MINING_BASIC_MINE_GRADES = Object.freeze([
  Object.freeze({ id: "mist", name: "浅层矿山", count: 6, rent: 28_000, yieldMin: 2, yieldMax: 4 }),
  Object.freeze({ id: "ridge", name: "青岭矿山", count: 6, rent: 45_000, yieldMin: 2, yieldMax: 4 }),
  Object.freeze({ id: "glacier", name: "冰河矿山", count: 6, rent: 70_000, yieldMin: 2, yieldMax: 3 }),
  Object.freeze({ id: "deep", name: "深层矿山", count: 6, rent: 95_000, yieldMin: 1, yieldMax: 3 }),
  Object.freeze({ id: "core", name: "核心矿山", count: 6, rent: 110_000, yieldMin: 1, yieldMax: 2 })
]);

function basicMineGradeAt(index) {
  const normalizedIndex = Math.max(0, Math.round(Number(index) || 0));
  let offset = 0;
  for (const grade of MINING_BASIC_MINE_GRADES) {
    offset += grade.count;
    if (normalizedIndex < offset) return grade;
  }
  return MINING_BASIC_MINE_GRADES[MINING_BASIC_MINE_GRADES.length - 1];
}
export const MINER_FATIGUE_RECOVERY_PER_HOUR = 8;
export const MINER_FATIGUE_WORK_LIMIT = 75;
export const MINER_INJURY_MS = 6 * 60 * 60 * 1000;
export const MINING_FACILITY_MAX_LEVEL = 3;
export const MINING_MAX_PREPARATIONS = 2;
export const MINING_MASTERY_MAX_LEVEL = 3;
export const MINING_MASTERY_THRESHOLDS = Object.freeze([1, 3, 6]);
export const MINING_CREW_BOND_MAX_LEVEL = 2;
export const MINING_CREW_BOND_THRESHOLDS = Object.freeze([2, 5]);
export const MINING_FOREMAN_BONUS = 0.6;
export const MINING_ROLE_SKILL_BONUS = 0.8;
export const MINING_ROLE_EXPERIENCE = 15;
export const MINING_INCIDENT_REVEAL_RATIO = 0.42;
export const MINING_CLUE_TARGET = 100;
export const MINING_MAX_SURVEY_REPORTS = 2;
export const MINER_SKILL_MAX_LEVEL = 10;
export const MINER_REST_MIN_FATIGUE = 10;
export const MINER_SPECIALIZATION_REQUIRED_SHIFTS = 3;
export const MINER_SPECIALIZATION_REQUIRED_LEVEL = 5;
export const MINER_SPECIALIZATION_BONUS = 0.7;
export const MINER_INITIAL_CONTRACT_SHIFTS = 6;
export const MINER_CONTRACT_RENEWAL_SHIFTS = 6;
export const MINER_CONTRACT_MAX_SHIFTS = 12;
export const MINER_CONTRACT_RENEWAL_WAGE_MULTIPLIER = 2;
export const MINER_MAX_TIER = 6;
export const MINER_PROMOTION_FEE_WAGE_MULTIPLIER = 5;
export const MINER_TIER_SKILL_BONUS = 0.2;
export const MINER_INITIAL_MORALE = 70;
export const MINER_MORALE_CARE_THRESHOLD = 80;
export const MINER_PERSONAL_LEAVE_MORALE_THRESHOLD = 35;
export const MINER_RESIGNATION_MORALE_THRESHOLD = 15;
export const MINER_PERSONAL_LEAVE_MS = 4 * 60 * 60 * 1000;
export const MINER_MENTOR_REQUIRED_TIER = 3;
export const MINER_MENTOR_REQUIRED_SHIFTS = 3;
export const MINER_MENTORSHIP_REQUIRED_SHIFTS = 3;
export const MINER_MENTORSHIP_ROLE_EXP = 10;
export const MINER_MENTORSHIP_COMPLETION_EXP = 30;
export const MINER_MENTORSHIP_FEE_WAGE_MULTIPLIER = 2;
export const MINER_MENTOR_SHIFT_MORALE = 1;
export const MINER_APPRENTICE_SHIFT_MORALE = 2;
export const MINER_MENTOR_COMPLETION_MORALE = 4;
export const MINER_APPRENTICE_COMPLETION_MORALE = 8;
export const MINER_PROMOTION_REQUIREMENTS = Object.freeze({
  2: Object.freeze({ targetTier: 2, requiredShifts: 2, requiredAverageSkill: 3 }),
  3: Object.freeze({ targetTier: 3, requiredShifts: 4, requiredAverageSkill: 4 }),
  4: Object.freeze({ targetTier: 4, requiredShifts: 7, requiredAverageSkill: 5 }),
  5: Object.freeze({ targetTier: 5, requiredShifts: 11, requiredAverageSkill: 6 }),
  6: Object.freeze({ targetTier: 6, requiredShifts: 16, requiredAverageSkill: 8 })
});

export const MINING_SURVEY_REPORT = Object.freeze({
  id: "veinSurvey",
  name: "矿脉勘探成果",
  description: "消耗一份长期勘探成果，为本班提供更准确的矿脉路线与避险图。",
  prospectingBonus: 1.2,
  riskDelta: -0.03
});

export const MINER_TRAINING_PROGRAMS = Object.freeze({
  prospecting: Object.freeze({
    id: "prospecting",
    name: "勘脉研习",
    skillLabel: "勘脉",
    description: "复盘岩芯、皮壳与矿带记录，提高高档料判断。",
    cost: 1_600,
    exp: 25,
    fatigue: 8
  }),
  extraction: Object.freeze({
    id: "extraction",
    name: "采掘实训",
    skillLabel: "采掘",
    description: "练习破岩、取料与装运配合，提高产量和块重。",
    cost: 1_800,
    exp: 25,
    fatigue: 12
  }),
  safety: Object.freeze({
    id: "safety",
    name: "安全演练",
    skillLabel: "安全",
    description: "演练支护、排水与撤离流程，降低井下事故风险。",
    cost: 1_400,
    exp: 25,
    fatigue: 6
  })
});

export const MINER_SPECIALIZATIONS = Object.freeze({
  veinReader: Object.freeze({
    id: "veinReader",
    name: "寻脉师",
    skill: "prospecting",
    skillLabel: "勘脉",
    description: "专注矿脉走向、皮壳与种水判断，更适合担任勘探员或勘脉班长。"
  }),
  rockBreaker: Object.freeze({
    id: "rockBreaker",
    name: "破岩手",
    skill: "extraction",
    skillLabel: "采掘",
    description: "专注破岩取料与装运节奏，更适合担任主采手或采掘班长。"
  }),
  supportLead: Object.freeze({
    id: "supportLead",
    name: "支护师",
    skill: "safety",
    skillLabel: "安全",
    description: "专注支护、排水与撤离预案，更适合担任安全员或安全班长。"
  })
});

export const MINER_CARE_OPTIONS = Object.freeze({
  rest: Object.freeze({
    id: "rest",
    name: "恢复理疗",
    description: "安排矿区理疗与营养补给，立即恢复 30 点疲劳。",
    cost: 1_200,
    fatigueRecovery: 30,
    injuryReductionMs: 0,
    moraleRecovery: 4
  }),
  treatment: Object.freeze({
    id: "treatment",
    name: "伤停救治",
    description: "转送矿区医护站，缩短 6 小时伤停并恢复 10 点疲劳。",
    cost: 4_800,
    fatigueRecovery: 10,
    injuryReductionMs: MINER_INJURY_MS,
    moraleRecovery: 8
  }),
  support: Object.freeze({
    id: "support",
    name: "班组关怀",
    description: "安排家书、热食与班后谈心，立即恢复 20 点士气。",
    cost: 1_800,
    fatigueRecovery: 0,
    injuryReductionMs: 0,
    moraleRecovery: 20
  })
});

export const MINER_MORALE_LEVELS = Object.freeze([
  Object.freeze({
    id: "low",
    name: "低落",
    min: 0,
    max: 24,
    tone: "hurt",
    skillBonus: -0.8,
    riskDelta: 0.03,
    renewalMultiplier: 1.5
  }),
  Object.freeze({
    id: "shaken",
    name: "动摇",
    min: 25,
    max: 49,
    tone: "warn",
    skillBonus: -0.4,
    riskDelta: 0.015,
    renewalMultiplier: 1.25
  }),
  Object.freeze({
    id: "steady",
    name: "稳定",
    min: 50,
    max: 79,
    tone: "good",
    skillBonus: 0,
    riskDelta: 0,
    renewalMultiplier: 1
  }),
  Object.freeze({
    id: "high",
    name: "高昂",
    min: 80,
    max: 100,
    tone: "high",
    skillBonus: 0.4,
    riskDelta: -0.01,
    renewalMultiplier: 0.9
  })
]);

export const MINER_RETENTION_CHOICES = Object.freeze({
  conversation: Object.freeze({
    id: "conversation",
    name: "留任恳谈",
    description: "由掌柜与班长共同复盘排班和安全问题，恢复基本信任。",
    costMultiplier: 2,
    moraleFloor: 45,
    contractShifts: 0
  }),
  bonus: Object.freeze({
    id: "bonus",
    name: "稳岗奖金",
    description: "发放专项奖金并补充两班保障合约，使矿工恢复稳定状态。",
    costMultiplier: 5,
    moraleFloor: 70,
    contractShifts: 2
  }),
  release: Object.freeze({
    id: "release",
    name: "同意离队",
    description: "尊重矿工决定并办理离队，不产生额外费用。",
    costMultiplier: 0,
    moraleFloor: 0,
    contractShifts: 0
  })
});

export const MINING_MASTERY_LEVELS = Object.freeze([
  Object.freeze({
    level: 0,
    name: "未踏勘",
    prospectingBonus: 0,
    extractionBonus: 0,
    riskDelta: 0
  }),
  Object.freeze({
    level: 1,
    name: "初探",
    prospectingBonus: 0,
    extractionBonus: 0,
    riskDelta: -0.01
  }),
  Object.freeze({
    level: 2,
    name: "熟悉",
    prospectingBonus: 0.4,
    extractionBonus: 0,
    riskDelta: -0.02
  }),
  Object.freeze({
    level: 3,
    name: "精研",
    prospectingBonus: 0.8,
    extractionBonus: 0.4,
    riskDelta: -0.03
  })
]);

export const MINING_CREW_BOND_LEVELS = Object.freeze([
  Object.freeze({
    level: 0,
    name: "临时班组",
    safetyBonus: 0,
    extractionBonus: 0,
    fatigueDelta: 0
  }),
  Object.freeze({
    level: 1,
    name: "熟练搭档",
    safetyBonus: 0.5,
    extractionBonus: 0,
    fatigueDelta: -2
  }),
  Object.freeze({
    level: 2,
    name: "老班底",
    safetyBonus: 1,
    extractionBonus: 0.5,
    fatigueDelta: -4
  })
]);

export const MINING_FACILITIES = Object.freeze({
  survey: Object.freeze({
    id: "survey",
    name: "地质勘探室",
    description: "整理矿脉样本与掌子面记录，提高高档料判断。",
    costs: Object.freeze([12_000, 32_000, 78_000]),
    skill: "prospecting",
    bonusPerLevel: 0.6
  }),
  drill: Object.freeze({
    id: "drill",
    name: "液压钻机组",
    description: "改善破岩与取料效率，提高追加出料和原石块重。",
    costs: Object.freeze([18_000, 45_000, 105_000]),
    skill: "extraction",
    bonusPerLevel: 0.6
  }),
  support: Object.freeze({
    id: "support",
    name: "通风支护站",
    description: "加固巷道并持续通风，降低塌方与作业事故风险。",
    costs: Object.freeze([14_000, 36_000, 88_000]),
    skill: "safety",
    bonusPerLevel: 0.8
  }),
  haulage: Object.freeze({
    id: "haulage",
    name: "矿车轨道",
    description: "缩短井下运输往返时间，让每个开采班次更快完成。",
    costs: Object.freeze([20_000, 50_000, 120_000]),
    durationReductionPerLevel: 0.05
  })
});

export const MINING_FACILITY_IDS = Object.freeze(Object.keys(MINING_FACILITIES));

export const MINING_PREPARATIONS = Object.freeze({
  sampling: Object.freeze({
    id: "sampling",
    name: "岩芯取样箱",
    description: "班前加密取样，提高本班高档料判断。",
    cost: 1_200,
    prospectingBonus: 0.8
  }),
  drainage: Object.freeze({
    id: "drainage",
    name: "便携排水泵",
    description: "降低常规风险，遇到渗水环境时效果显著。",
    cost: 1_600,
    riskDelta: -0.01,
    seepageRiskDelta: -0.05
  }),
  bracing: Object.freeze({
    id: "bracing",
    name: "预制支护架",
    description: "额外加固工作面，稳定降低本班事故风险。",
    cost: 2_200,
    riskDelta: -0.05
  })
});

export const MINING_SITE_CONDITIONS = Object.freeze({
  stable: Object.freeze({
    id: "stable",
    name: "岩层稳定",
    description: "掌子面结构完整，适合按计划推进。",
    summary: "事故风险 -2%",
    tone: "good",
    weight: 30,
    riskDelta: -0.02,
    yieldDelta: 0,
    massMultiplier: 1,
    highGradeShift: 0
  }),
  seepage: Object.freeze({
    id: "seepage",
    name: "裂隙渗水",
    description: "地下水沿裂隙涌入，排水准备会非常关键。",
    summary: "事故风险 +5% · 排水泵可额外抵消 5%",
    tone: "warn",
    weight: 22,
    riskDelta: 0.05,
    yieldDelta: 0,
    massMultiplier: 1,
    highGradeShift: 0
  }),
  fractured: Object.freeze({
    id: "fractured",
    name: "碎裂夹层",
    description: "出料点增多，但原石更碎且工作面不稳定。",
    summary: "基础出料 +1 · 块重 -15% · 风险 +4%",
    tone: "warn",
    weight: 18,
    riskDelta: 0.04,
    yieldDelta: 1,
    massMultiplier: 0.85,
    highGradeShift: 0
  }),
  hardRock: Object.freeze({
    id: "hardRock",
    name: "致密硬岩",
    description: "破岩推进缓慢，但完整大料更容易保留下来。",
    summary: "基础出料 -1 · 块重 +12% · 风险 +1%",
    tone: "neutral",
    weight: 16,
    riskDelta: 0.01,
    yieldDelta: -1,
    massMultiplier: 1.12,
    highGradeShift: 0
  }),
  richVein: Object.freeze({
    id: "richVein",
    name: "富矿露头",
    description: "新露出的矿脉表现活跃，收益与冒险同时上升。",
    summary: "基础出料 +1 · 高档权重 +3.5% · 风险 +3%",
    tone: "rare",
    weight: 14,
    riskDelta: 0.03,
    yieldDelta: 1,
    massMultiplier: 1,
    highGradeShift: 0.035
  })
});

export const MINER_TRAIT_EFFECTS = Object.freeze({
  "识脉": Object.freeze({ label: "勘脉结算 +1", skill: "prospecting", bonus: 1 }),
  "耐劳": Object.freeze({ label: "班后疲劳 -8", fatigueDelta: -8 }),
  "谨慎": Object.freeze({ label: "安全结算 +1", skill: "safety", bonus: 1 }),
  "稳手": Object.freeze({ label: "采掘结算 +1", skill: "extraction", bonus: 1 })
});

export const MINER_FLAW_EFFECTS = Object.freeze({
  "冒进": Object.freeze({ label: "事故风险 +2%", riskDelta: 0.02 }),
  "怕潮": Object.freeze({ label: "湿润矿带风险 +3%", wetRiskDelta: 0.03 }),
  "手松": Object.freeze({ label: "采掘结算 -1", skill: "extraction", bonus: -1 }),
  "贪深": Object.freeze({ label: "深掘风险 +4%", deepRiskDelta: 0.04 })
});

export const MINING_FOREMAN_SPECIALTIES = Object.freeze({
  prospecting: Object.freeze({ key: "prospecting", label: "勘脉指挥", skillLabel: "勘脉" }),
  extraction: Object.freeze({ key: "extraction", label: "采掘指挥", skillLabel: "采掘" }),
  safety: Object.freeze({ key: "safety", label: "安全指挥", skillLabel: "安全" })
});

export const MINING_SHIFT_ROLES = Object.freeze({
  prospecting: Object.freeze({
    key: "prospecting",
    label: "勘探员",
    skillLabel: "勘脉",
    description: "负责岩芯、皮壳与矿脉走向判断，提高升档与线索收益。"
  }),
  extraction: Object.freeze({
    key: "extraction",
    label: "主采手",
    skillLabel: "采掘",
    description: "负责破岩、取料与装运衔接，提高追加出料与原石块重。"
  }),
  safety: Object.freeze({
    key: "safety",
    label: "安全员",
    skillLabel: "安全",
    description: "负责支护、排水和撤离观察，降低当班事故风险。"
  })
});

export const MINING_SHIFT_INCIDENTS = Object.freeze({
  roofCrack: Object.freeze({
    id: "roofCrack",
    name: "顶板出现新裂缝",
    description: "支护区传来连续脆响，裂缝正朝掌子面延伸。",
    defaultChoiceId: "hold",
    choices: Object.freeze([
      Object.freeze({
        id: "reinforce",
        label: "停机加固",
        description: "牺牲一部分进度，先补强顶板。",
        effectLabel: "事故风险 -8% · 预计出料 -1",
        riskDelta: -0.08,
        yieldDelta: -1
      }),
      Object.freeze({
        id: "hold",
        label: "按预案推进",
        description: "保持当前节奏，由安全员持续观察裂缝。",
        effectLabel: "维持原定收益与风险"
      }),
      Object.freeze({
        id: "rush",
        label: "抢采后撤",
        description: "在裂缝扩大前加快取料并提前撤出。",
        effectLabel: "事故风险 +7% · 追加出料 +12%",
        riskDelta: 0.07,
        extraYieldChanceDelta: 0.12
      })
    ])
  }),
  veinFork: Object.freeze({
    id: "veinFork",
    name: "矿脉出现分岔",
    description: "新露出的亮色矿脉分成两路，短时间内无法全部跟进。",
    defaultChoiceId: "hold",
    choices: Object.freeze([
      Object.freeze({
        id: "sample",
        label: "取样辨脉",
        description: "减慢推进速度，先确认种水表现与矿脉方向。",
        effectLabel: "预计出料 -1 · 升档 +6% · 线索 +12",
        yieldDelta: -1,
        upgradeChanceDelta: 0.06,
        clueDelta: 12
      }),
      Object.freeze({
        id: "hold",
        label: "沿主脉推进",
        description: "维持原方案，不为支脉改变当班节奏。",
        effectLabel: "维持原定收益与风险"
      }),
      Object.freeze({
        id: "chase",
        label: "追进亮色支脉",
        description: "临时改变掌子面方向，争取更多出料。",
        effectLabel: "事故风险 +6% · 追加出料 +12%",
        riskDelta: 0.06,
        extraYieldChanceDelta: 0.12
      })
    ])
  }),
  waterBurst: Object.freeze({
    id: "waterBurst",
    name: "裂隙突然涌水",
    description: "排水沟水位快速上涨，矿车轨道附近开始积水。",
    defaultChoiceId: "hold",
    choices: Object.freeze([
      Object.freeze({
        id: "pump",
        label: "停机排水",
        description: "暂停破岩，集中设备清理积水。",
        effectLabel: "事故风险 -10% · 预计出料 -1",
        riskDelta: -0.10,
        yieldDelta: -1
      }),
      Object.freeze({
        id: "hold",
        label: "按排水预案作业",
        description: "维持当前节奏，持续监控水位。",
        effectLabel: "维持原定收益与风险"
      }),
      Object.freeze({
        id: "bypass",
        label: "绕水抢进",
        description: "绕开积水区，从侧面继续扩大作业面。",
        effectLabel: "事故风险 +5% · 追加出料 +8%",
        riskDelta: 0.05,
        extraYieldChanceDelta: 0.08
      })
    ])
  })
});

export const MINER_SHIFT_FATIGUE = Object.freeze({
  steady: 25,
  standard: 32,
  deep: 42
});

export const MINING_QUALITY_KEYS = Object.freeze([
  "bean",
  "glutinous",
  "stickyIce",
  "ice",
  "highIce",
  "glass"
]);

export const MINING_STRATEGIES = Object.freeze({
  steady: Object.freeze({
    id: "steady",
    label: "稳采",
    description: "降低事故与裂纹风险，优先保证产量。",
    yieldDelta: 0,
    accidentDelta: -0.05,
    highGradeShift: -0.04
  }),
  standard: Object.freeze({
    id: "standard",
    label: "标准",
    description: "按矿脉常规方案开采，产量与风险均衡。",
    yieldDelta: 0,
    accidentDelta: 0,
    highGradeShift: 0
  }),
  deep: Object.freeze({
    id: "deep",
    label: "深掘",
    description: "减少产量，换取更高档种水机会，同时提高事故风险。",
    yieldDelta: -1,
    accidentDelta: 0.08,
    highGradeShift: 0.09
  })
});

export const MINING_SHIFT_INCENTIVES = Object.freeze({
  standard: Object.freeze({
    id: "standard",
    label: "标准班薪",
    description: "按正常班薪组织作业，不追加额外奖惩。",
    effectLabel: "工资不变",
    wageMultiplier: 1,
    riskDelta: 0,
    extraYieldChanceDelta: 0,
    fatigueDelta: 0,
    moraleDelta: 0
  }),
  safety: Object.freeze({
    id: "safety",
    label: "安全津贴",
    description: "提高当班保障与轮休补贴，适合高风险矿层。",
    effectLabel: "工资 +20% · 风险 -4% · 疲劳 -4 · 士气 +4",
    wageMultiplier: 1.2,
    riskDelta: -0.04,
    extraYieldChanceDelta: 0,
    fatigueDelta: -4,
    moraleDelta: 4
  }),
  piecework: Object.freeze({
    id: "piecework",
    label: "计件奖金",
    description: "按额外出料计奖，鼓励班组加快推进。",
    effectLabel: "工资 +35% · 追加出料 +10% · 风险 +2% · 疲劳 +5 · 士气 +2",
    wageMultiplier: 1.35,
    riskDelta: 0.02,
    extraYieldChanceDelta: 0.10,
    fatigueDelta: 5,
    moraleDelta: 2
  })
});

const BELTS = Object.freeze({
  mist: Object.freeze({
    id: "mist", label: "雾溪浅层", crew: 2, rent: 28_000, rentMax: 36_000, supplies: 1_500,
    yield: [2, 4], mass: [0.9, 3.5], risk: 0.06,
    weights: [0.45, 0.35, 0.15, 0.04, 0.01, 0]
  }),
  ridge: Object.freeze({
    id: "ridge", label: "青岭矿带", crew: 2, rent: 45_000, rentMax: 60_000, supplies: 2_300,
    yield: [2, 4], mass: [0.8, 3.3], risk: 0.09,
    weights: [0.15, 0.35, 0.30, 0.15, 0.04, 0.01]
  }),
  glacier: Object.freeze({
    id: "glacier", label: "冰河矿带", crew: 3, rent: 70_000, rentMax: 95_000, supplies: 3_400,
    yield: [2, 3], mass: [0.8, 3.0], risk: 0.12,
    weights: [0.05, 0.15, 0.32, 0.30, 0.15, 0.03]
  }),
  deep: Object.freeze({
    id: "deep", label: "苍岫深层", crew: 3, rent: 95_000, rentMax: 125_000, supplies: 4_800,
    yield: [1, 3], mass: [0.7, 3.2], risk: 0.17,
    weights: [0.02, 0.08, 0.20, 0.34, 0.28, 0.08]
  }),
  core: Object.freeze({
    id: "core", label: "天游核心", crew: 3, rent: 110_000, rentMax: 140_000, supplies: 6_500,
    yield: [1, 2], mass: [0.7, 2.8], risk: 0.22,
    weights: [0, 0.04, 0.12, 0.28, 0.38, 0.18]
  })
});

let mineSequence = 0;

function mine(beltId, index, name, focus, adjustments = {}) {
  const belt = BELTS[beltId];
  const rentRate = Number(adjustments.rentRate) || 1;
  const rent = Math.min(belt.rentMax, Math.round(belt.rent * rentRate));
  const basicGrade = basicMineGradeAt(mineSequence);
  mineSequence += 1;
  const weights = Array.isArray(adjustments.weights) ? adjustments.weights : belt.weights;
  return Object.freeze({
    id: `${beltId}-${String(index).padStart(2, "0")}`,
    beltId,
    beltLabel: belt.label,
    name,
    focus,
    crewRequired: belt.crew,
    rent,
    legacyRent: rent,
    basicGradeId: basicGrade.id,
    supplies: Math.round(belt.supplies * (Number(adjustments.suppliesRate) || 1)),
    yieldMin: Math.max(1, Math.round(Number(adjustments.yieldMin) || belt.yield[0])),
    yieldMax: Math.max(1, Math.round(Number(adjustments.yieldMax) || belt.yield[1])),
    massMin: Number(adjustments.massMin ?? belt.mass[0]),
    massMax: Number(adjustments.massMax ?? belt.mass[1]),
    risk: Math.max(0, Math.min(0.8, Number(adjustments.risk ?? belt.risk))),
    confidenceBonus: Number(adjustments.confidenceBonus || 0),
    imperialMultiplier: Math.max(0, Number(adjustments.imperialMultiplier) || 1),
    weights: Object.freeze(weights.map((value) => Math.max(0, Number(value) || 0)))
  });
}

export const MINES = Object.freeze([
  mine("mist", 1, "白雾浅坑", "低裂稳定", { risk: 0.03, rentRate: 1.00 }),
  mine("mist", 2, "黄砂缓坡", "大体量低档料", { massMin: 1.4, massMax: 3.5, rentRate: 1.08 }),
  mine("mist", 3, "会卡旧井", "松花表现丰富", { confidenceBonus: 0.04, rentRate: 1.12 }),
  mine("mist", 4, "南齐细脉", "糯冰机会较高", { weights: [0.38, 0.34, 0.21, 0.05, 0.02, 0], rentRate: 1.18 }),
  mine("mist", 5, "后江水口", "小料线索清晰", { massMax: 2.2, confidenceBonus: 0.12, rentRate: 1.04 }),
  mine("mist", 6, "蟒带边坑", "色带多、裂风险高", { risk: 0.12, imperialMultiplier: 1.35, rentRate: 1.28 }),

  mine("ridge", 1, "青岭东坑", "产量与种水均衡", { rentRate: 1.00 }),
  mine("ridge", 2, "脱砂一号", "开窗线索清晰", { confidenceBonus: 0.13, rentRate: 1.10 }),
  mine("ridge", 3, "木那白皮", "种水上限较高", { weights: [0.12, 0.31, 0.31, 0.18, 0.06, 0.02], risk: 0.12, rentRate: 1.22 }),
  mine("ridge", 4, "莫湾南坡", "大料少件", { yieldMax: 3, massMin: 1.5, massMax: 3.5, rentRate: 1.18 }),
  mine("ridge", 5, "松花长廊", "色绿与飘花倾向", { imperialMultiplier: 1.45, rentRate: 1.25 }),
  mine("ridge", 6, "雾岔矿洞", "高产但批次不均", { yieldMin: 3, yieldMax: 4, risk: 0.14, confidenceBonus: -0.08, rentRate: 1.32 }),

  mine("glacier", 1, "冰河上段", "糯冰主产", { rentRate: 1.00 }),
  mine("glacier", 2, "晴水井", "正冰晴水倾向", { weights: [0.04, 0.13, 0.29, 0.34, 0.17, 0.03], rentRate: 1.14 }),
  mine("glacier", 3, "蓝水裂谷", "正冰高裂", { risk: 0.20, weights: [0.03, 0.11, 0.28, 0.36, 0.18, 0.04], rentRate: 1.16 }),
  mine("glacier", 4, "雪脊坑", "小体量高净度", { massMax: 2.0, risk: 0.07, confidenceBonus: 0.08, rentRate: 1.10 }),
  mine("glacier", 5, "飘花廊", "飘花色带突出", { imperialMultiplier: 1.55, rentRate: 1.24 }),
  mine("glacier", 6, "冰潭深眼", "低产高冰机会", { yieldMax: 2, weights: [0.03, 0.10, 0.28, 0.31, 0.23, 0.05], rentRate: 1.35 }),

  mine("deep", 1, "苍岫深井", "正冰、高冰稳定", { rentRate: 1.00 }),
  mine("deep", 2, "墨砂黑坑", "高冰高风险", { risk: 0.24, weights: [0.01, 0.06, 0.17, 0.33, 0.33, 0.10], rentRate: 1.16 }),
  mine("deep", 3, "色根断层", "帝王色带突出", { risk: 0.20, imperialMultiplier: 1.60, rentRate: 1.24 }),
  mine("deep", 4, "雷劈老坑", "巨料裂纹并存", { risk: 0.29, massMin: 1.7, massMax: 3.5, rentRate: 1.20 }),
  mine("deep", 5, "夜河矿室", "低置信、高上限", { confidenceBonus: -0.14, weights: [0.01, 0.06, 0.18, 0.32, 0.31, 0.12], rentRate: 1.28 }),
  mine("deep", 6, "高冰南洞", "少量高档料", { yieldMax: 2, weights: [0.01, 0.05, 0.15, 0.31, 0.36, 0.12], rentRate: 1.36 }),

  mine("core", 1, "天游一号", "高冰主产", { rentRate: 1.00 }),
  mine("core", 2, "玻璃脉", "玻璃种机会突出", { weights: [0, 0.03, 0.10, 0.24, 0.40, 0.23], risk: 0.25, rentRate: 1.12 }),
  mine("core", 3, "帝王色带", "颜色上限最高", { massMax: 2.2, imperialMultiplier: 1.85, rentRate: 1.20 }),
  mine("core", 4, "龙脊巨矿", "大体量高档料", { massMin: 1.6, massMax: 3.5, risk: 0.30, rentRate: 1.28 }),
  mine("core", 5, "无灯深坑", "全矿区最高方差", { risk: 0.34, confidenceBonus: -0.18, weights: [0.02, 0.05, 0.09, 0.20, 0.38, 0.26], rentRate: 1.36 }),
  mine("core", 6, "老场核心", "低产高净度", { yieldMax: 2, risk: 0.12, confidenceBonus: 0.12, weights: [0, 0.02, 0.08, 0.25, 0.42, 0.23], rentRate: 1.42 })
]);

export function miningBasicMinerProfile(minerOrTier) {
  const tier = Math.max(1, Math.min(6, Math.round(Number(
    typeof minerOrTier === "object" ? minerOrTier?.tier : minerOrTier
  ) || 1)));
  const grade = MINER_BASIC_GRADES.find((entry) => tier <= entry.maxTier)
    || MINER_BASIC_GRADES[MINER_BASIC_GRADES.length - 1];
  return { ...grade, tier };
}

export function miningBasicMineProfile(mineOrId) {
  const mineId = String(typeof mineOrId === "object" ? mineOrId?.id : mineOrId || "");
  const index = Math.max(0, MINES.findIndex((entry) => entry.id === mineId));
  const mine = typeof mineOrId === "object"
    ? mineOrId
    : MINES.find((entry) => entry.id === mineId);
  const storedGradeId = mine?.basicGradeId;
  const grade = MINING_BASIC_MINE_GRADES.find((entry) => entry.id === storedGradeId)
    || basicMineGradeAt(index);
  const risk = Math.round(Math.max(
    MINING_BASIC_RISK_MIN,
    Math.min(MINING_BASIC_RISK_MAX, (Number(mine?.risk) || MINING_BASIC_RISK_MIN) * MINING_BASIC_RISK_MULTIPLIER)
  ) * 1000) / 1000;
  return {
    ...grade,
    index,
    rent: Math.max(0, Math.round(Number(mine?.rent) || grade.rent)),
    yieldMin: Math.max(1, Math.round(Number(mine?.yieldMin) || grade.yieldMin)),
    yieldMax: Math.max(1, Math.round(Number(mine?.yieldMax) || grade.yieldMax)),
    risk
  };
}

export function miningBasicShiftPlan(mine, miners = []) {
  const uniqueMiners = [...new Map(
    (Array.isArray(miners) ? miners : [])
      .filter((miner) => miner?.id)
      .map((miner) => [String(miner.id), miner])
  ).values()];
  const profiles = uniqueMiners.map(miningBasicMinerProfile);
  const miningPower = profiles.reduce((sum, profile) => sum + profile.power, 0);
  const wageCost = profiles.reduce((sum, profile) => sum + profile.wage, 0);
  const mineProfile = miningBasicMineProfile(mine);
  const extraYieldChance = Math.round(Math.min(
    MINING_BASIC_EXTRA_YIELD_MAX,
    Math.max(0, miningPower - 1) * MINING_BASIC_EXTRA_YIELD_PER_POWER
  ) * 100) / 100;
  return {
    miners: uniqueMiners,
    profiles,
    mineProfile,
    miningPower,
    wageCost,
    total: wageCost,
    baseYieldMin: mineProfile.yieldMin,
    baseYieldMax: mineProfile.yieldMax,
    yieldMin: mineProfile.yieldMin,
    yieldMax: mineProfile.yieldMax + (extraYieldChance > 0 ? 1 : 0),
    extraYieldChance,
    risk: mineProfile.risk
  };
}

const MINES_BY_ID = new Map(MINES.map((entry) => [entry.id, entry]));

export function miningMineById(mineId) {
  return MINES_BY_ID.get(String(mineId || "")) || null;
}

export function miningStrategyById(strategyId) {
  return MINING_STRATEGIES[String(strategyId || "")] || MINING_STRATEGIES.standard;
}

export function miningShiftIncentiveById(incentiveId) {
  return MINING_SHIFT_INCENTIVES[String(incentiveId || "")] || MINING_SHIFT_INCENTIVES.standard;
}

export function miningMinerShiftMoraleDelta({
  strategyId = "standard",
  incentiveId = "standard",
  accident = false,
  injured = false
} = {}) {
  const strategyDelta = ({ steady: 1, standard: 0, deep: -2 })[String(strategyId || "standard")] || 0;
  const incentive = miningShiftIncentiveById(incentiveId);
  return -2
    + strategyDelta
    + (accident ? -8 : 1)
    + (injured ? -8 : 0)
    + (Number(incentive.moraleDelta) || 0);
}

export function miningShiftWageQuote(miners = [], incentiveId = "standard") {
  const incentive = miningShiftIncentiveById(incentiveId);
  const members = Array.isArray(miners) ? miners.filter(Boolean) : [];
  const baseWages = members.reduce((sum, miner) => (
    sum + Math.round(Math.max(0, Number(miner?.baseWage) || 0) * 1.5)
  ), 0);
  const wages = members.reduce((sum, miner) => (
    sum + Math.round(Math.max(0, Number(miner?.baseWage) || 0) * 1.5 * incentive.wageMultiplier)
  ), 0);
  return {
    incentive,
    baseWages,
    wages,
    incentivePremium: Math.max(0, wages - baseWages)
  };
}

export function miningQualityLabel(key) {
  return ({
    bean: "豆种",
    glutinous: "糯种",
    stickyIce: "糯冰",
    ice: "正冰",
    highIce: "高冰",
    glass: "玻璃种"
  })[key] || key;
}

export function miningMinerEffectLabel(type, name) {
  const effects = type === "flaw" ? MINER_FLAW_EFFECTS : MINER_TRAIT_EFFECTS;
  return effects[String(name || "")]?.label || "无额外影响";
}

export function miningMinerSkillExpTarget(level = 1) {
  const normalized = Math.max(1, Math.min(MINER_SKILL_MAX_LEVEL, Math.round(Number(level) || 1)));
  return normalized >= MINER_SKILL_MAX_LEVEL ? 0 : 50 * normalized;
}

export function miningFacilityById(facilityId) {
  return MINING_FACILITIES[String(facilityId || "")] || null;
}

export function miningPreparationById(preparationId) {
  return MINING_PREPARATIONS[String(preparationId || "")] || null;
}

export function miningSiteConditionById(conditionId) {
  return MINING_SITE_CONDITIONS[String(conditionId || "")] || MINING_SITE_CONDITIONS.stable;
}

export function miningMineMasteryLevel(recordOrShifts = 0) {
  const shifts = Math.max(0, Math.round(Number(
    typeof recordOrShifts === "object" ? recordOrShifts?.shifts : recordOrShifts
  ) || 0));
  return MINING_MASTERY_THRESHOLDS.reduce(
    (level, threshold, index) => shifts >= threshold ? index + 1 : level,
    0
  );
}

export function miningMineMasteryInfo(recordOrLevel = 0, options = {}) {
  const level = options.level === true
    ? Math.max(0, Math.min(MINING_MASTERY_MAX_LEVEL, Math.round(Number(recordOrLevel) || 0)))
    : miningMineMasteryLevel(recordOrLevel);
  return MINING_MASTERY_LEVELS[level] || MINING_MASTERY_LEVELS[0];
}

export function miningMineMasteryNextAt(recordOrShifts = 0) {
  const shifts = Math.max(0, Math.round(Number(
    typeof recordOrShifts === "object" ? recordOrShifts?.shifts : recordOrShifts
  ) || 0));
  return MINING_MASTERY_THRESHOLDS.find((threshold) => threshold > shifts) ?? null;
}

export function miningMineMasteryEffectLabel(recordOrLevel = 0, options = {}) {
  const mastery = miningMineMasteryInfo(recordOrLevel, options);
  if (mastery.level === 0) return "尚未产生档案加成";
  const effects = [`事故风险 -${Math.round(Math.abs(mastery.riskDelta) * 100)}%`];
  if (mastery.prospectingBonus) effects.push(`勘脉 +${mastery.prospectingBonus}`);
  if (mastery.extractionBonus) effects.push(`采掘 +${mastery.extractionBonus}`);
  return effects.join(" · ");
}

export function miningMinerSpecializationById(specializationId) {
  return MINER_SPECIALIZATIONS[String(specializationId || "")] || null;
}

export function miningMinerSpecializationInfo(miner) {
  const specialization = miningMinerSpecializationById(miner?.specializationId);
  if (!specialization) return null;
  return {
    ...specialization,
    bonus: MINER_SPECIALIZATION_BONUS,
    effectLabel: `${specialization.skillLabel} +${MINER_SPECIALIZATION_BONUS}`
  };
}

export function miningMinerSpecializationEligibility(miner, specializationId) {
  const specialization = miningMinerSpecializationById(specializationId);
  const shiftsWorked = Math.max(0, Math.round(Number(miner?.shiftsWorked) || 0));
  const skillLevel = Math.max(1, Math.round(Number(miner?.skills?.[specialization?.skill]?.level) || 1));
  if (!specialization) {
    return { ready: false, specialization: null, shiftsWorked, skillLevel, reason: "职业专精不存在。" };
  }
  if (miningMinerSpecializationInfo(miner)) {
    return { ready: false, specialization, shiftsWorked, skillLevel, reason: "职业专精一旦确定不能更改。" };
  }
  if (shiftsWorked < MINER_SPECIALIZATION_REQUIRED_SHIFTS) {
    return {
      ready: false,
      specialization,
      shiftsWorked,
      skillLevel,
      reason: `还需完成 ${MINER_SPECIALIZATION_REQUIRED_SHIFTS - shiftsWorked} 个矿山班次。`
    };
  }
  if (skillLevel < MINER_SPECIALIZATION_REQUIRED_LEVEL) {
    return {
      ready: false,
      specialization,
      shiftsWorked,
      skillLevel,
      reason: `${specialization.skillLabel}需达到 Lv.${MINER_SPECIALIZATION_REQUIRED_LEVEL}。`
    };
  }
  return { ready: true, specialization, shiftsWorked, skillLevel, reason: "" };
}

export function miningMinerContractInfo(miner) {
  const rawContractRemaining = miner?.contractShiftsRemaining;
  const rawRemaining = Number(rawContractRemaining);
  const remaining = Math.max(0, Math.min(
    MINER_CONTRACT_MAX_SHIFTS,
    rawContractRemaining != null && Number.isFinite(rawRemaining)
      ? Math.round(rawRemaining)
      : MINER_INITIAL_CONTRACT_SHIFTS
  ));
  const baseWage = Math.max(0, Math.round(Number(miner?.baseWage) || 0));
  const morale = miningMinerMoraleInfo(miner);
  const baseRenewalCost = Math.round(baseWage * MINER_CONTRACT_RENEWAL_WAGE_MULTIPLIER);
  return {
    remaining,
    initialShifts: MINER_INITIAL_CONTRACT_SHIFTS,
    renewalShifts: MINER_CONTRACT_RENEWAL_SHIFTS,
    maxShifts: MINER_CONTRACT_MAX_SHIFTS,
    baseRenewalCost,
    renewalCost: Math.round(baseRenewalCost * morale.renewalMultiplier),
    moraleMultiplier: morale.renewalMultiplier,
    moraleLabel: morale.name,
    expired: remaining <= 0,
    low: remaining > 0 && remaining <= 2,
    canRenew: remaining <= MINER_CONTRACT_MAX_SHIFTS - MINER_CONTRACT_RENEWAL_SHIFTS
  };
}

export function miningMinerAverageSkill(miner) {
  const skillLevels = ["prospecting", "extraction", "safety"].map((skillId) => (
    Math.max(1, Math.min(MINER_SKILL_MAX_LEVEL, Math.round(Number(miner?.skills?.[skillId]?.level) || 1)))
  ));
  return Math.round((skillLevels.reduce((sum, level) => sum + level, 0) / skillLevels.length) * 10) / 10;
}

export function miningMinerTierBonus(minerOrTier) {
  const rawTier = typeof minerOrTier === "object" ? minerOrTier?.tier : minerOrTier;
  const tier = Math.max(1, Math.min(MINER_MAX_TIER, Math.round(Number(rawTier) || 1)));
  return Math.round((tier - 1) * MINER_TIER_SKILL_BONUS * 10) / 10;
}

export function miningMinerMoraleInfo(minerOrMorale = MINER_INITIAL_MORALE) {
  const rawMorale = typeof minerOrMorale === "object" ? minerOrMorale?.morale : minerOrMorale;
  const morale = Math.max(0, Math.min(100, Math.round(
    rawMorale == null || !Number.isFinite(Number(rawMorale)) ? MINER_INITIAL_MORALE : Number(rawMorale)
  )));
  const level = MINER_MORALE_LEVELS.find((entry) => morale >= entry.min && morale <= entry.max)
    || MINER_MORALE_LEVELS[2];
  const skillEffect = level.skillBonus > 0 ? `技能 +${level.skillBonus}` : level.skillBonus < 0 ? `技能 ${level.skillBonus}` : "技能不变";
  const riskEffect = level.riskDelta > 0
    ? `风险 +${Math.round(level.riskDelta * 100)}%`
    : level.riskDelta < 0
      ? `风险 ${Math.round(level.riskDelta * 100)}%`
      : "风险不变";
  const renewalEffect = level.renewalMultiplier === 1
    ? "续约费不变"
    : `续约费 ×${level.renewalMultiplier}`;
  return { ...level, morale, effectLabel: `${skillEffect} · ${riskEffect} · ${renewalEffect}` };
}

export function miningMinerRetentionChoiceQuote(miner, choiceId) {
  const choice = MINER_RETENTION_CHOICES[String(choiceId || "")];
  if (!choice) return null;
  const baseWage = Math.max(0, Math.round(Number(miner?.baseWage) || 0));
  return {
    ...choice,
    cost: Math.round(baseWage * choice.costMultiplier)
  };
}

export function miningMinerRetentionInfo(miner, now = Date.now()) {
  const morale = miningMinerMoraleInfo(miner).morale;
  const leaveUntil = Math.max(0, Number(miner?.leaveUntil) || 0);
  const pending = miner?.retentionCase && typeof miner.retentionCase === "object"
    ? miner.retentionCase
    : null;
  if (pending) {
    return {
      id: "resignation",
      name: "离职申请",
      tone: "critical",
      ready: false,
      pending: true,
      leaveUntil,
      reason: "已提出离职申请，等待掌柜处理",
      description: "需要先完成留任协商，或同意矿工离队。"
    };
  }
  if (leaveUntil > now) {
    return {
      id: "leave",
      name: "个人请假",
      tone: "leave",
      ready: false,
      pending: false,
      leaveUntil,
      reason: "个人请假中",
      description: "请假结束后会自动恢复排班资格。"
    };
  }
  if (morale < MINER_RESIGNATION_MORALE_THRESHOLD) {
    return {
      id: "critical",
      name: "离职风险",
      tone: "critical",
      ready: true,
      pending: false,
      leaveUntil: 0,
      reason: "下次完班后将提出离职",
      description: "应先安排班组关怀，或采用安全津贴改善士气。"
    };
  }
  if (morale < MINER_PERSONAL_LEAVE_MORALE_THRESHOLD) {
    return {
      id: "leaveRisk",
      name: "请假风险",
      tone: "leave",
      ready: true,
      pending: false,
      leaveUntil: 0,
      reason: "下次完班后将请假 4 小时",
      description: "班组关怀可以在开工前解除风险。"
    };
  }
  if (morale < 50) {
    return {
      id: "watch",
      name: "留任观察",
      tone: "warn",
      ready: true,
      pending: false,
      leaveUntil: 0,
      reason: "继续下降将触发请假",
      description: "矿工仍可排班，但建议改善班次安排。"
    };
  }
  return {
    id: "stable",
    name: "留任稳定",
    tone: "good",
    ready: true,
    pending: false,
    leaveUntil: 0,
    reason: "暂无请假或离职风险",
    description: "保持合理激励与休整即可。"
  };
}

export function miningMentorshipEligibility(mentor, apprentice, mentorships = []) {
  const mentorId = String(mentor?.id || "");
  const apprenticeId = String(apprentice?.id || "");
  const mentorTier = Math.max(1, Math.round(Number(mentor?.tier) || 1));
  const apprenticeTier = Math.max(1, Math.round(Number(apprentice?.tier) || 1));
  const mentorShifts = Math.max(0, Math.round(Number(mentor?.shiftsWorked) || 0));
  const active = (Array.isArray(mentorships) ? mentorships : []).filter((entry) => entry?.status === "active");
  const occupiedIds = new Set(active.flatMap((entry) => [String(entry.mentorId || ""), String(entry.apprenticeId || "")]));
  const cost = Math.max(0, Math.round((Number(mentor?.baseWage) || 0) * MINER_MENTORSHIP_FEE_WAGE_MULTIPLIER));
  let reason = "";
  if (!mentorId || !apprenticeId) reason = "师徒矿工不存在。";
  else if (mentorId === apprenticeId) reason = "矿工不能成为自己的师傅。";
  else if (mentorTier < MINER_MENTOR_REQUIRED_TIER) reason = `师傅需达到 T${MINER_MENTOR_REQUIRED_TIER}。`;
  else if (mentorShifts < MINER_MENTOR_REQUIRED_SHIFTS) reason = `师傅还需完成 ${MINER_MENTOR_REQUIRED_SHIFTS - mentorShifts} 个矿山班次。`;
  else if (apprenticeTier >= mentorTier) reason = "学徒评级必须低于师傅。";
  else if (occupiedIds.has(mentorId)) reason = "该师傅已有进行中的带教关系。";
  else if (occupiedIds.has(apprenticeId)) reason = "该学徒已有进行中的带教关系。";
  return {
    ready: !reason,
    reason,
    cost,
    mentorTier,
    apprenticeTier,
    mentorShifts,
    requiredTier: MINER_MENTOR_REQUIRED_TIER,
    requiredShifts: MINER_MENTOR_REQUIRED_SHIFTS,
    requiredSharedShifts: MINER_MENTORSHIP_REQUIRED_SHIFTS
  };
}

export function miningMentorshipProgress(record) {
  const sharedShifts = Math.max(0, Math.round(Number(record?.sharedShifts) || 0));
  const requiredShifts = MINER_MENTORSHIP_REQUIRED_SHIFTS;
  return {
    sharedShifts,
    requiredShifts,
    remaining: Math.max(0, requiredShifts - sharedShifts),
    percent: Math.max(0, Math.min(100, Math.round((sharedShifts / requiredShifts) * 100))),
    completed: record?.status === "completed" || sharedShifts >= requiredShifts
  };
}

export function miningMinerPromotionInfo(miner) {
  const tier = Math.max(1, Math.min(MINER_MAX_TIER, Math.round(Number(miner?.tier) || 1)));
  const shiftsWorked = Math.max(0, Math.round(Number(miner?.shiftsWorked) || 0));
  const averageSkill = miningMinerAverageSkill(miner);
  const baseWage = Math.max(0, Math.round(Number(miner?.baseWage) || 0));
  if (tier >= MINER_MAX_TIER) {
    return {
      tier,
      targetTier: null,
      maxed: true,
      ready: false,
      shiftsWorked,
      averageSkill,
      requiredShifts: null,
      requiredAverageSkill: null,
      missingShifts: 0,
      missingAverageSkill: 0,
      promotionCost: 0,
      currentSkillBonus: miningMinerTierBonus(tier),
      targetSkillBonus: null,
      reason: "已达到最高评级。"
    };
  }
  const requirement = MINER_PROMOTION_REQUIREMENTS[tier + 1];
  const missingShifts = Math.max(0, requirement.requiredShifts - shiftsWorked);
  const missingAverageSkill = Math.max(0, Math.round((requirement.requiredAverageSkill - averageSkill) * 10) / 10);
  const ready = missingShifts === 0 && missingAverageSkill === 0;
  const reasons = [];
  if (missingShifts > 0) reasons.push(`还需完成 ${missingShifts} 个矿山班次`);
  if (missingAverageSkill > 0) reasons.push(`三项技能均值还差 ${missingAverageSkill}`);
  return {
    tier,
    targetTier: requirement.targetTier,
    maxed: false,
    ready,
    shiftsWorked,
    averageSkill,
    requiredShifts: requirement.requiredShifts,
    requiredAverageSkill: requirement.requiredAverageSkill,
    missingShifts,
    missingAverageSkill,
    promotionCost: Math.round(baseWage * MINER_PROMOTION_FEE_WAGE_MULTIPLIER),
    currentSkillBonus: miningMinerTierBonus(tier),
    targetSkillBonus: miningMinerTierBonus(requirement.targetTier),
    reason: reasons.length ? `${reasons.join("，")}。` : "已满足晋升条件。"
  };
}

export function miningMinerEffectiveSkill(miner, key) {
  const base = Math.max(1, Number(miner?.skills?.[key]?.level) || 1);
  const trait = MINER_TRAIT_EFFECTS[miner?.trait];
  const flaw = MINER_FLAW_EFFECTS[miner?.flaw];
  const specialization = miningMinerSpecializationInfo(miner);
  const morale = miningMinerMoraleInfo(miner);
  const modifier = (trait?.skill === key ? Number(trait.bonus) || 0 : 0)
    + (flaw?.skill === key ? Number(flaw.bonus) || 0 : 0)
    + (specialization?.skill === key ? MINER_SPECIALIZATION_BONUS : 0)
    + miningMinerTierBonus(miner)
    + morale.skillBonus;
  return Math.max(1, Math.min(MINER_SKILL_MAX_LEVEL, base + modifier));
}

export function miningForemanInfo(miner) {
  if (!miner) return null;
  const ranked = Object.keys(MINING_FOREMAN_SPECIALTIES)
    .map((key, index) => ({ key, index, skill: miningMinerEffectiveSkill(miner, key) }))
    .sort((left, right) => right.skill - left.skill || left.index - right.index);
  const specialty = MINING_FOREMAN_SPECIALTIES[ranked[0]?.key] || MINING_FOREMAN_SPECIALTIES.prospecting;
  return {
    minerId: String(miner.id || ""),
    minerName: String(miner.name || "未命名矿工"),
    focus: specialty.key,
    label: specialty.label,
    skillLabel: specialty.skillLabel,
    skill: ranked[0]?.skill || 1,
    bonus: MINING_FOREMAN_BONUS,
    effectLabel: `${specialty.skillLabel} +${MINING_FOREMAN_BONUS}`
  };
}

export function miningAutoRoleAssignments(miners = []) {
  const members = [...new Map((Array.isArray(miners) ? miners : [])
    .filter((miner) => miner?.id)
    .map((miner) => [String(miner.id), miner])).values()]
    .slice(0, Object.keys(MINING_SHIFT_ROLES).length);
  if (!members.length) return {};
  const roleKeys = Object.keys(MINING_SHIFT_ROLES);
  let best = null;
  const visit = (index, usedRoles, assignments, score) => {
    if (index >= members.length) {
      if (!best || score > best.score) best = { score, assignments: { ...assignments } };
      return;
    }
    const miner = members[index];
    for (const roleKey of roleKeys) {
      if (usedRoles.has(roleKey)) continue;
      usedRoles.add(roleKey);
      assignments[roleKey] = String(miner.id);
      visit(index + 1, usedRoles, assignments, score + miningMinerEffectiveSkill(miner, roleKey));
      delete assignments[roleKey];
      usedRoles.delete(roleKey);
    }
  };
  visit(0, new Set(), {}, 0);
  return best?.assignments || {};
}

export function miningRoleAssignmentDetails(assignments = {}, miners = []) {
  if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) return [];
  const minersById = new Map((Array.isArray(miners) ? miners : [])
    .filter((miner) => miner?.id)
    .map((miner) => [String(miner.id), miner]));
  return Object.values(MINING_SHIFT_ROLES).flatMap((role) => {
    const minerId = String(assignments[role.key] || "");
    const miner = minersById.get(minerId);
    if (!miner) return [];
    return [{
      key: role.key,
      label: role.label,
      skillLabel: role.skillLabel,
      minerId,
      minerName: String(miner.name || "未命名矿工"),
      bonus: MINING_ROLE_SKILL_BONUS,
      experience: MINING_ROLE_EXPERIENCE,
      effectLabel: `${role.skillLabel} +${MINING_ROLE_SKILL_BONUS}`
    }];
  });
}

export function miningShiftIncidentById(incidentId) {
  return MINING_SHIFT_INCIDENTS[String(incidentId || "")] || null;
}

export function miningShiftIncidentChoice(incidentId, choiceId) {
  const incident = miningShiftIncidentById(incidentId);
  return incident?.choices.find((choice) => choice.id === String(choiceId || "")) || null;
}

export function miningShiftIncidentFor(seed) {
  let hash = 2166136261;
  for (const char of String(seed || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const incidents = Object.values(MINING_SHIFT_INCIDENTS);
  return incidents[(hash >>> 0) % incidents.length];
}

export function miningShiftPerformance({
  mine,
  miners = [],
  strategyId = "standard",
  conditionId = "stable",
  preparationIds = [],
  facilities = {},
  masteryLevel = 0,
  crewBondLevel = 0,
  foremanFocus = "",
  foremanBonus = 0,
  roleAssignments = {},
  incentiveId = "standard",
  useSurveyReport = false,
  incidentChoice = null
} = {}) {
  const members = Array.isArray(miners) ? miners.filter(Boolean) : [];
  const strategy = miningStrategyById(strategyId);
  const condition = miningSiteConditionById(conditionId);
  const incentive = miningShiftIncentiveById(incentiveId);
  const preparations = miningPreparationEffects(preparationIds, condition.id);
  const mastery = miningMineMasteryInfo(masteryLevel, { level: true });
  const crewBond = miningCrewBondInfo(crewBondLevel, { level: true });
  const roleDetails = miningRoleAssignmentDetails(roleAssignments, members)
    .filter((detail, index, rows) => rows.findIndex((row) => row.minerId === detail.minerId) === index);
  const assignedRoleKeys = new Set(roleDetails.map((detail) => detail.key));
  const average = (key) => members.length
    ? members.reduce((sum, miner) => sum + miningMinerEffectiveSkill(miner, key), 0) / members.length
    : 1;
  const commandBonus = Math.max(0, Math.min(MINING_FOREMAN_BONUS, Number(foremanBonus) || 0));
  const fieldProspecting = average("prospecting")
    + miningFacilitySkillBonus(facilities, "prospecting")
    + preparations.prospectingBonus
    + mastery.prospectingBonus
    + (foremanFocus === "prospecting" ? commandBonus : 0)
    + (assignedRoleKeys.has("prospecting") ? MINING_ROLE_SKILL_BONUS : 0);
  const prospecting = fieldProspecting + (useSurveyReport ? MINING_SURVEY_REPORT.prospectingBonus : 0);
  const extraction = average("extraction")
    + miningFacilitySkillBonus(facilities, "extraction")
    + mastery.extractionBonus
    + crewBond.extractionBonus
    + (foremanFocus === "extraction" ? commandBonus : 0)
    + (assignedRoleKeys.has("extraction") ? MINING_ROLE_SKILL_BONUS : 0);
  const safety = average("safety")
    + miningFacilitySkillBonus(facilities, "safety")
    + crewBond.safetyBonus
    + (foremanFocus === "safety" ? commandBonus : 0)
    + (assignedRoleKeys.has("safety") ? MINING_ROLE_SKILL_BONUS : 0);
  const wet = mine?.beltId === "mist" || mine?.beltId === "glacier";
  const flawRisk = members.length
    ? members.reduce((sum, miner) => {
      const flaw = MINER_FLAW_EFFECTS[miner?.flaw] || {};
      return sum
        + (Number(flaw.riskDelta) || 0)
        + (wet ? Number(flaw.wetRiskDelta) || 0 : 0)
        + (strategy.id === "deep" ? Number(flaw.deepRiskDelta) || 0 : 0);
    }, 0) / members.length
    : 0;
  const moraleRisk = members.length
    ? members.reduce((sum, miner) => sum + miningMinerMoraleInfo(miner).riskDelta, 0) / members.length
    : 0;
  const safetyReduction = Math.min(0.14, Math.max(0, (safety - 1) * 0.014));
  const baseRisk = Math.max(0.01, Math.min(
    0.65,
    (Number(mine?.risk) || 0)
      + strategy.accidentDelta
      + condition.riskDelta
      + preparations.riskDelta
      + mastery.riskDelta
      + incentive.riskDelta
      + (useSurveyReport ? MINING_SURVEY_REPORT.riskDelta : 0)
      + flawRisk
      + moraleRisk
      - safetyReduction
  ));
  const risk = Math.max(0.01, Math.min(
    0.65,
    baseRisk + (Number(incidentChoice?.riskDelta) || 0)
  ));
  const extraYieldChance = Math.min(0.55, Math.max(
    0,
    (extraction - 1) * 0.055
      + incentive.extraYieldChanceDelta
      + (Number(incidentChoice?.extraYieldChanceDelta) || 0)
  ));
  const upgradeChance = Math.min(0.20, Math.max(
    0,
    (prospecting - 1) * 0.018 + (Number(incidentChoice?.upgradeChanceDelta) || 0)
  ));
  const yieldDelta = Number(strategy.yieldDelta || 0)
    + Number(condition.yieldDelta || 0)
    + (Number(incidentChoice?.yieldDelta) || 0);
  const baseYieldMin = Math.max(0, (Number(mine?.yieldMin) || 0) + yieldDelta);
  const baseYieldMax = Math.max(baseYieldMin, (Number(mine?.yieldMax) || 0) + yieldDelta);
  const yieldMin = baseYieldMin;
  const yieldMax = baseYieldMax + (extraYieldChance > 0 ? 1 : 0);
  const baseClueGain = miningClueGain({
    strategyId: strategy.id,
    conditionId: condition.id,
    masteryLevel: mastery.level,
    prospecting: fieldProspecting
  });
  return {
    fieldProspecting,
    prospecting,
    extraction,
    safety,
    baseRisk,
    risk,
    safetyReduction,
    moraleRisk,
    extraYieldChance,
    upgradeChance,
    baseYieldMin,
    baseYieldMax,
    yieldMin,
    yieldMax,
    clueGain: Math.max(1, Math.min(75, baseClueGain + (Number(incidentChoice?.clueDelta) || 0)))
  };
}

export function miningCrewKey(minerIds = []) {
  return [...new Set((Array.isArray(minerIds) ? minerIds : []).map(String).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

export function miningCrewBondLevel(recordOrShifts = 0) {
  const shifts = Math.max(0, Math.round(Number(
    typeof recordOrShifts === "object" ? recordOrShifts?.shifts : recordOrShifts
  ) || 0));
  return MINING_CREW_BOND_THRESHOLDS.reduce(
    (level, threshold, index) => shifts >= threshold ? index + 1 : level,
    0
  );
}

export function miningCrewBondInfo(recordOrLevel = 0, options = {}) {
  const level = options.level === true
    ? Math.max(0, Math.min(MINING_CREW_BOND_MAX_LEVEL, Math.round(Number(recordOrLevel) || 0)))
    : miningCrewBondLevel(recordOrLevel);
  return MINING_CREW_BOND_LEVELS[level] || MINING_CREW_BOND_LEVELS[0];
}

export function miningCrewBondNextAt(recordOrShifts = 0) {
  const shifts = Math.max(0, Math.round(Number(
    typeof recordOrShifts === "object" ? recordOrShifts?.shifts : recordOrShifts
  ) || 0));
  return MINING_CREW_BOND_THRESHOLDS.find((threshold) => threshold > shifts) ?? null;
}

export function miningCrewBondEffectLabel(recordOrLevel = 0, options = {}) {
  const bond = miningCrewBondInfo(recordOrLevel, options);
  if (bond.level === 0) return "尚未形成班组加成";
  const effects = [`安全 +${bond.safetyBonus}`, `疲劳 ${bond.fatigueDelta}`];
  if (bond.extractionBonus) effects.splice(1, 0, `采掘 +${bond.extractionBonus}`);
  return effects.join(" · ");
}

export function miningClueGain({ strategyId, conditionId, masteryLevel = 0, prospecting = 1 } = {}) {
  const strategyBase = { steady: 18, standard: 24, deep: 32 }[String(strategyId || "standard")] || 24;
  const conditionBonus = {
    stable: 2,
    seepage: 0,
    fractured: 6,
    hardRock: 4,
    richVein: 12
  }[String(conditionId || "stable")] || 0;
  const masteryBonus = Math.max(0, Math.min(MINING_MASTERY_MAX_LEVEL, Math.round(Number(masteryLevel) || 0))) * 3;
  const skillBonus = Math.max(0, Math.floor((Math.max(1, Number(prospecting) || 1) - 1) * 1.5));
  return Math.max(1, Math.min(60, strategyBase + conditionBonus + masteryBonus + skillBonus));
}

export function miningSiteConditionFor(seed) {
  let hash = 2166136261;
  for (const char of String(seed || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const conditions = Object.values(MINING_SITE_CONDITIONS);
  const totalWeight = conditions.reduce((sum, condition) => sum + condition.weight, 0);
  let roll = (((hash >>> 0) + 1) / 4294967297) * totalWeight;
  for (const condition of conditions) {
    roll -= condition.weight;
    if (roll <= 0) return condition;
  }
  return conditions[conditions.length - 1];
}

export function miningPreparationEffects(preparationIds = [], conditionId = "stable") {
  const unique = [...new Set((Array.isArray(preparationIds) ? preparationIds : []).map(String))]
    .map(miningPreparationById)
    .filter(Boolean)
    .slice(0, MINING_MAX_PREPARATIONS);
  const seepage = miningSiteConditionById(conditionId).id === "seepage";
  return {
    preparations: unique,
    cost: unique.reduce((sum, preparation) => sum + preparation.cost, 0),
    prospectingBonus: unique.reduce((sum, preparation) => sum + (Number(preparation.prospectingBonus) || 0), 0),
    riskDelta: unique.reduce((sum, preparation) => (
      sum
      + (Number(preparation.riskDelta) || 0)
      + (seepage ? Number(preparation.seepageRiskDelta) || 0 : 0)
    ), 0)
  };
}

export function miningFacilityLevels(source = {}) {
  return Object.fromEntries(MINING_FACILITY_IDS.map((facilityId) => [
    facilityId,
    Math.max(0, Math.min(MINING_FACILITY_MAX_LEVEL, Math.round(Number(source?.[facilityId]) || 0)))
  ]));
}

export function miningFacilityUpgradeCost(facilityId, currentLevel = 0) {
  const facility = miningFacilityById(facilityId);
  const level = Math.max(0, Math.round(Number(currentLevel) || 0));
  return facility?.costs?.[level] ?? null;
}

export function miningFacilitySkillBonus(facilities, skill) {
  const levels = miningFacilityLevels(facilities);
  return Object.values(MINING_FACILITIES).reduce((sum, facility) => (
    facility.skill === skill
      ? sum + levels[facility.id] * (Number(facility.bonusPerLevel) || 0)
      : sum
  ), 0);
}

export function miningFacilityEffectLabel(facilityId, level = 0) {
  const facility = miningFacilityById(facilityId);
  const normalized = Math.max(0, Math.min(MINING_FACILITY_MAX_LEVEL, Math.round(Number(level) || 0)));
  if (!facility || normalized === 0) return "尚未产生设施加成";
  if (facility.id === "haulage") return `班次耗时 -${Math.round(normalized * facility.durationReductionPerLevel * 100)}%`;
  const labels = { prospecting: "勘脉结算", extraction: "采掘结算", safety: "安全结算" };
  const bonus = Math.round(normalized * facility.bonusPerLevel * 10) / 10;
  return `${labels[facility.skill] || "技能结算"} +${bonus}`;
}

export function miningShiftDuration(baseDurationMs, facilities = {}) {
  const base = Math.max(1, Math.round(Number(baseDurationMs) || MINING_SHIFT_MS));
  const level = miningFacilityLevels(facilities).haulage;
  const reduction = level * MINING_FACILITIES.haulage.durationReductionPerLevel;
  return Math.max(1, Math.round(base * (1 - reduction)));
}

export function miningMinerFatigueAt(miner, now = Date.now()) {
  const fatigue = Math.max(0, Math.min(100, Number(miner?.fatigue) || 0));
  const updatedAt = Number(miner?.fatigueAt) || 0;
  if (!updatedAt || now <= updatedAt) return fatigue;
  const recovered = ((now - updatedAt) / (60 * 60 * 1000)) * MINER_FATIGUE_RECOVERY_PER_HOUR;
  return Math.max(0, Math.round((fatigue - recovered) * 10) / 10);
}
