/**
 * Workshop craft scoring — single source of truth for client preview + server settle.
 * Pure isomorphic module (no DOM / socket). Keep numeric behavior identical when editing.
 */

export const TIER_MULT = {
  1: 1.0, 2: 1.07, 3: 1.15, 4: 1.24, 5: 1.35,
  6: 1.47, 7: 1.6, 8: 1.72, 9: 1.85, 10: 2.0
};

/** Client duration preview only; settlement uses speedTimeScale. */
export const TIER_BASE_TIME = {
  1: 1.0, 2: 0.98, 3: 0.96, 4: 0.94, 5: 0.92,
  6: 0.90, 7: 0.88, 8: 0.86, 9: 0.84, 10: 0.82
};

/** Level → efficacy k; index 0 unused. Lv1=12% … Lv10=100%. */
export const K_CURVE = [0, 0.12, 0.24, 0.37, 0.5, 0.63, 0.74, 0.83, 0.9, 0.95, 1.0];

export const WORKER_SKILL_DEFS = {
  jieliao:   { name: "解料", attr: "完整度",     full: 18, dir: "cut" },
  damo:      { name: "打磨", attr: "光泽度",     full: 15, dir: "cut" },
  qieliao:   { name: "切料", attr: "瑕疵控制",   full: 12, dir: "set" },
  xiuxing:   { name: "修形", attr: "造型精度",   full: 14, dir: "set" },
  diaozhuo:  { name: "雕琢", attr: "雕琢精细度", full: 22, dir: "finish" },
  xiangqian: { name: "镶嵌", attr: "镶嵌贴合度", full: 16, dir: "finish" },
  huashu:    { name: "话术", attr: "溢价力",     full: 12, dir: "speak" },
  kongchang: { name: "控场", attr: "控场流速",   full: 10, dir: "speak" },
  cuidan:    { name: "催单", attr: "逼单转化",   full: 10, dir: "speak" }
};

export const PROCESS_SKILLS = ["jieliao", "damo", "qieliao", "xiuxing", "diaozhuo", "xiangqian"];

export const STEP_ATTRS = {
  open: ["jieliao", "damo"],
  plan: ["qieliao", "xiuxing"],
  finish: ["diaozhuo", "xiangqian"],
  bangleFinish: ["damo", "xiuxing"]
};

export const FLAW_DEFS = {
  易裂: -0.08, 易出绵: -0.06, 易脏: -0.05, 手重: -0.04,
  巧手: 0.05, 净料: 0.06, 稳手: 0.04, 心细: 0.04
};

/** Display tag pool (legacy); flaw tags now use FLAW_TAG_MAP. */
export const FLAW_POOL = ["裂", "绵", "棉", "脏点", "崩口"];

export const SHATTER_SKILLS = ["jieliao", "qieliao", "xiuxing"];
/** Per shatter skill at full level/tier: −2pp shatter chance (placeholder). */
export const SHATTER_SKILL_UNIT = 0.02;

export const SHATTER_STAGE_RULES = Object.freeze({
  open: { base: 0.012, riskScale: 0.10, cap: 0.12 },
  plan: { base: 0.008, riskScale: 0.10, cap: 0.10 },
  finish: { base: 0.004, riskScale: 0.10, cap: 0.06 }
});

export const PERFECT_SCORE = 100;
export const FLAW_SCORE = 35;
export const FLAW_TAG_MAP = { 易裂: "裂", 易出绵: "绵", 易脏: "脏点", 手重: "崩口" };

export const STEP_ATTR_WEIGHTS = {
  open:   { jieliao: 0.55, damo: 0.45 },
  plan:   { qieliao: 0.40, xiuxing: 0.60 },
  finish: { diaozhuo: 0.55, xiangqian: 0.45 },
  bangleFinish: { damo: 0.60, xiuxing: 0.40 }
};

export const STEP_OVERALL_WEIGHTS = { open: 0.30, plan: 0.35, finish: 0.35 };

/** Craft score 100 ≈ +30% process value share of finished price. */
export const PROCESS_BONUS_CAP = 0.3;
export const PROCESS_STEP_VALUE_CAP = 1_800;
export const DEFAULT_EQUIPMENT_VALUE_CAP = 250;

/** Equipment adds a bounded amount; expensive jade cannot repay a machine in one job. */
export function equipmentCraftBonus(baseValue, deviceAttrs = {}) {
  const base = Math.max(0, Number(baseValue) || 0);
  const rate = Math.max(0, Number(deviceAttrs.quality) || 0) / 100;
  const cap = Number.isFinite(Number(deviceAttrs.valueBonusCap))
    ? Math.max(0, Number(deviceAttrs.valueBonusCap)) : DEFAULT_EQUIPMENT_VALUE_CAP;
  return Math.max(0, Math.min(base * rate, cap));
}

/**
 * New workshop settlement: only this step earns a new contribution. Historical
 * work and material value are preserved even when the next worker is less skilled.
 * The same step replaces its recorded contribution, so retries cannot compound it.
 */
export function applyCraftStepValue(item, {
  step, score = 0, worker, deviceAttrs = {}, previousValue = item?.value,
  roundMoney = (value) => Math.round(Number(value) || 0)
} = {}) {
  if (!item || !Object.hasOwn(STEP_OVERALL_WEIGHTS, step)) return item;
  const base = Math.max(0, Number(item.baseValue ?? item.value ?? item.price) || 0);
  const before = Math.max(0, Number(previousValue ?? item.value ?? item.price) || 0);
  const effectiveScore = clamp(Math.max(Number(score) || 0, (Number(deviceAttrs.perfectFloor) || 0) * 1.2), 0, 120);
  const process = roundMoney(Math.min(PROCESS_STEP_VALUE_CAP,
    base * PROCESS_BONUS_CAP * STEP_OVERALL_WEIGHTS[step] * effectiveScore / 100 * gradeMult(effectiveScore)));
  const equipment = roundMoney(equipmentCraftBonus(base, deviceAttrs));
  const previous = item.craftValueContributions?.[step];
  const oldTotal = Math.max(0, Number(previous?.process) || 0) + Math.max(0, Number(previous?.equipment) || 0);
  const usePrevious = oldTotal > process + equipment;
  const contribution = usePrevious ? { ...previous } : { process, equipment };
  item.craftValueContributions = { ...(item.craftValueContributions || {}), [step]: contribution };
  item.craftScores = { ...(item.craftScores || {}), [step]: effectiveScore };
  item.craftWorkers = { ...(item.craftWorkers || {}), [step]: worker?.name || "掌柜" };
  item.deviceQualityBonuses = { ...(item.deviceQualityBonuses || {}), [step]: Math.max(0, Number(deviceAttrs.quality) || 0) / 100 };
  item.craftPriceVersion = 2;
  item.craftScore = Math.round(overallScore(item));
  item.craftGrade = craftGrade(item.craftScore);
  item.value = roundMoney(Math.max(before, before - oldTotal + Number(contribution.process || 0) + Number(contribution.equipment || 0)));
  item.craftPerfect = item.craftScore >= PERFECT_SCORE;
  item.craftFlaw = item.craftScore <= FLAW_SCORE ? craftFlawTag(worker) : null;
  return item;
}

export const GRADE_RULES = [
  { grade: "S", min: 100, mult: 1.04 },
  { grade: "A", min: 85,  mult: 1.00 },
  { grade: "B", min: 70,  mult: 0.97 },
  { grade: "C", min: 55,  mult: 0.94 },
  { grade: "D", min: 0,   mult: 0.90 }
];

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function skillThreshold(level) {
  return 50 * level;
}

export function skillK(level, exp) {
  const L = clamp(Math.round(Number(level) || 1), 1, 10);
  const p = clamp((Number(exp) || 0) / skillThreshold(L), 0, 1);
  const k0 = K_CURVE[L];
  const k1 = L < 10 ? K_CURVE[L + 1] : K_CURVE[10];
  return k0 + p * (k1 - k0);
}

export function workerTierM(worker) {
  const base = TIER_MULT[worker?.tier] ?? 1.0;
  const tl = Number(worker?.tierLevel || 1);
  return base * (1 + 0.06 * (tl - 1));
}

export function workerSkill(worker, key) {
  const dir = WORKER_SKILL_DEFS[key]?.dir;
  return (worker?.skills?.[dir]?.[key]) || { level: 1, exp: 0 };
}

export function skillAttrValue(worker, key) {
  const sk = workerSkill(worker, key);
  return (WORKER_SKILL_DEFS[key]?.full || 0) * skillK(sk.level, sk.exp) * workerTierM(worker);
}

/** Employee shatter risk delta: flaws raise it and trained skills lower it. */
export function employeeShatterDefense(worker) {
  if (!worker) return 0;
  const flawProb = -(worker.flaws || []).reduce((s, f) => s + (FLAW_DEFS[f] || 0), 0);
  let skillProb = 0;
  for (const key of SHATTER_SKILLS) {
    const sk = workerSkill(worker, key);
    skillProb += SHATTER_SKILL_UNIT * skillK(sk.level, sk.exp) * workerTierM(worker);
  }
  return flawProb - skillProb;
}

export function stageToStep(stage) {
  if (stage === "rough" || stage === "opening") return "open";
  if (stage === "refine" || stage === "carving") return "plan";
  return "finish";
}

export function workshopShatterChance(deviceAttrs, worker, stage) {
  if (!deviceAttrs) return 0;
  const step = stageToStep(stage);
  const rule = SHATTER_STAGE_RULES[step] || SHATTER_STAGE_RULES.open;
  const deviceRisk = Number(deviceAttrs?.risk ?? 1);
  const riskDelta = (deviceRisk - 1) * rule.riskScale;
  return clamp(rule.base + riskDelta + employeeShatterDefense(worker), 0, rule.cap);
}

/** Per-step craft sub-score 0~120. */
export function stepScore(worker, step) {
  const w = STEP_ATTR_WEIGHTS[step];
  if (!w || !worker) return 0;
  let s = 0;
  for (const key in w) {
    const sk = workerSkill(worker, key);
    s += w[key] * skillK(sk.level, sk.exp) * workerTierM(worker) * 100;
  }
  let flawNet = 0;
  for (const f of (worker.flaws || [])) flawNet += (FLAW_DEFS[f] || 0);
  if (flawNet) s *= (1 + flawNet);
  return clamp(s, 0, 120);
}

/** Aggregate score from completed step scores on item.craftScores. */
export function overallScore(item) {
  const scores = (item && item.craftScores) || {};
  let wsum = 0;
  let acc = 0;
  for (const step in STEP_OVERALL_WEIGHTS) {
    if (scores[step] == null) continue;
    const w = STEP_OVERALL_WEIGHTS[step];
    wsum += w;
    acc += w * scores[step];
  }
  return wsum > 0 ? acc / wsum : 0;
}

export function craftGrade(score) {
  for (const r of GRADE_RULES) if (score >= r.min) return r.grade;
  return "D";
}

export function gradeMult(score) {
  for (const r of GRADE_RULES) if (score >= r.min) return r.mult;
  return 0.82;
}

/** Duration scale: time /= (1 + Σ 4%×k×M over process skills). */
export function speedTimeScale(worker) {
  let speed = 0;
  for (const key of PROCESS_SKILLS) {
    const sk = workerSkill(worker, key);
    speed += 0.04 * skillK(sk.level, sk.exp) * workerTierM(worker);
  }
  return 1 / (1 + speed);
}

export function craftPerfectLabel(score) {
  if (score >= PERFECT_SCORE) return "完美";
  if (score <= FLAW_SCORE) return "瑕疵";
  return "";
}

export function craftFlawTag(worker) {
  for (const f of (worker?.flaws || [])) if (FLAW_TAG_MAP[f]) return FLAW_TAG_MAP[f];
  return "绵";
}

/**
 * Apply process value + perfect/flaw tags. roundMoney injects server money().
 * Mutates and returns item.
 */
export function applyCraftValue(item, bonus, gradeMultiplier, worker, roundMoney = (v) => Math.round(Number(v) || 0)) {
  const base = Number(item.baseValue ?? item.value ?? item.price ?? 0);
  if (base <= 0) return item;
  const v = base * (1 + (bonus || 0)) * (gradeMultiplier || 1);
  item.value = roundMoney(v);
  const score = Number(item.craftScore || 0);
  item.craftPerfect = score >= PERFECT_SCORE;
  item.craftFlaw = (score <= FLAW_SCORE) ? craftFlawTag(worker) : null;
  return item;
}

/** UI preview bundle for a worker on a process step. */
export function workerStepPreview(worker, step) {
  const attrKeys = STEP_ATTRS[step] || [];
  const attrs = attrKeys.map((key) => ({
    key,
    attr: WORKER_SKILL_DEFS[key].attr,
    value: skillAttrValue(worker, key)
  }));
  const quality = stepScore(worker, step);
  const grade = craftGrade(quality);
  let speed = 0;
  for (const key of PROCESS_SKILLS) {
    const sk = workerSkill(worker, key);
    speed += 0.04 * skillK(sk.level, sk.exp) * workerTierM(worker);
  }
  return {
    attrs,
    quality,
    grade,
    speed: Math.round(speed * 100),
    perfectLabel: craftPerfectLabel(quality),
    tierTime: TIER_BASE_TIME[worker.tier] || 1
  };
}
