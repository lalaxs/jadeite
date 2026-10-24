/**
 * Customer orders — persona generation, negative-filter requirements,
 * mismatch bad-review dice, daily 05:00 pool replace, paid refresh.
 */
import { randomUUID } from "node:crypto";
import { recordFinanceSale } from "../../shared/domain/economy/finance-book.js";
import { evaluateOrderFit, productMatchesOrder, finishedProductKind, ORDER_SIZE_BANDS } from "../../shared/domain/jade/jade-rules.js";
import { orderPayoutCap, orderValueFloor } from "../../shared/domain/economy/new-player-economy.js";
import { bookSystemDemand, quoteSystemDemand, systemSalePriceCap } from "../../shared/domain/economy/system-demand.js";
import { KIND_LABELS, PRODUCT_CATEGORIES } from "../../shared/domain/jade/jade-categories.js";
import { normalizeBangleOrderRequirements } from "../../shared/domain/workshop/bangle-finish.js";
import { grantPlayerExp } from "../../shared/domain/progression/player-progression.js";
import { settlePlayerAchievements as legacySettlePlayerAchievements } from "./achievement-rewards.js";
import {
  applyRepDelta,
  applySatisfactionDelta,
  customerRatingTierInfo,
  ensureCustomerRatingTracks
} from "../../shared/domain/economy/metric-history.js";
import {
  ORDER_SINGLE_REFRESH_DAILY_CAP,
  ORDER_BATCH_REFRESH_DAILY_CAP,
  orderSingleRefreshFeeForCount,
  orderBatchRefreshFeeForCount
} from "../../shared/domain/economy/order-refresh.js";

export {
  ORDER_SINGLE_REFRESH_DAILY_CAP,
  ORDER_BATCH_REFRESH_DAILY_CAP,
  orderSingleRefreshFeeForCount,
  orderBatchRefreshFeeForCount
};

export const ORDER_SLOT_CAP = 4;
export const ORDER_DAILY_REFRESH_HOUR = 5;

/** @deprecated Kept for smoke/compat; generation no longer uses static profiles. */
export const NPC_PROFILES = [
  { name: "普通市民", minRep: 0 },
  { name: "富商太太", minRep: 35 },
  { name: "收藏家", minRep: 100 },
  { name: "珠宝商", minRep: 65 }
];

const PERSONALITIES = [
  { id: "宽和", weight: 35, temper: 0.45, nDist: [50, 35, 15, 0, 0] },
  { id: "大方", weight: 40, temper: 0.75, nDist: [25, 40, 25, 10, 0] },
  { id: "计较", weight: 25, temper: 1.15, nDist: [8, 22, 35, 25, 10] }
];

const MOTIVES = [
  { id: "喜欢", weight: 40 },
  { id: "撑场面", weight: 25 },
  { id: "装样子", weight: 22 },
  { id: "炫富", weight: 13 }
];

const WEALTHS = [
  { id: "贫穷", weight: 30, budget: [300, 2500] },
  { id: "小康", weight: 45, budget: [2000, 12000] },
  { id: "富有", weight: 25, budget: [8000, 45000] }
];

/** 财富——目标货值中位与报价相对倍率（第 2 批：pay 锚定货值带。*/
const WEALTH_VALUE_BAND = {
  贫穷: { mid: 1400, payMul: [1.02, 1.18], absFloor: 400, absCeil: 5000 },
  小康: { mid: 5600, payMul: [1.08, 1.28], absFloor: 1800, absCeil: 22000 },
  富有: { mid: 17000, payMul: [1.12, 1.38], absFloor: 7000, absCeil: 68000 }
};

/** 题材相对货值系数（相对同档中位。*/
const KIND_VALUE_FACTOR = {
  cabochon: 0.65,
  dropPendant: 0.82,
  fuBeanPendant: 0.88,
  peacePendant: 0.95,
  buddhaPendant: 1.05,
  plaque: 1.12,
  bracelet: 1.35
};

/** 客户评级档位对报价的软抬（按称号档，不再用连续小数） */
function satisfactionPayBoost(satisfaction) {
  return customerRatingTierInfo(satisfaction).payBoost;
}

function naturalReviewText(value, fallback) {
  const cleaned = String(value ?? "")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/[A-Za-z_][A-Za-z0-9_.-]*/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s·,，。:：;；/|()-]+|[\s·,，。:：;；/|()-]+$/g, "")
    .trim();
  return cleaned || fallback;
}

function orderReviewScore(kind, tier, late) {
  if (kind === "great") return 5;
  if (kind === "good") return 4;
  if (kind === "late_full" || kind === "mid") return 3;
  if (tier === "partial" || late) return 2;
  return 1;
}

function orderReviewComment(score, { late, tier, tipped }) {
  if (score === 5) return tipped
    ? "成品与要求十分契合，做工细致，交付及时，我愿意为这份用心多付一些。"
    : "成品与要求十分契合，做工细致，交付也很及时，值得再次光顾。";
  if (score === 4) return "成品符合订单要求，细节处理稳妥，整体令人满意。";
  if (score === 3) return late
    ? "成品本身符合要求，但交付时间比约定稍晚，希望下次更准时。"
    : "订单已经完成，成品整体尚可，细节还有提升空间。";
  if (score === 2) return tier === "partial"
    ? "成品与订单要求有一些差距，希望下次能更仔细核对细节。"
    : "本次交付未达到预期，希望在成品与时效上继续改进。";
  return "本次交付与订单要求差距较大，整体体验不理想。";
}

function orderRequirementsForReview(order) {
  const hard = order?.hard || {};
  const parts = [
    `品类：${naturalReviewText(hard.kindLabel || KIND_LABELS[hard.kind], "翡翠成品")}`
  ];
  if (hard.sizeBand) {
    parts.push(`尺寸：${naturalReviewText(ORDER_SIZE_BANDS[hard.sizeBand]?.label, "按订单尺寸")}`);
  }
  if (hard.budgetUnlimited) parts.push("预算：不设上限");
  else if (Number(hard.budgetMax) > 0) parts.push(`预算：不超过 ${Math.round(hard.budgetMax)} 元`);
  for (const requirement of Array.isArray(order?.requirements) ? order.requirements : []) {
    const label = naturalReviewText(requirement?.label, "");
    if (label) parts.push(label);
  }
  return [...new Set(parts)];
}

function submittedItemsForReview(items = []) {
  return items.map((item) => ({
    name: naturalReviewText(item?.name, "翡翠成品"),
    kind: naturalReviewText(KIND_LABELS[item?.kind], "翡翠成品"),
    quality: naturalReviewText(item?.quality, "品质合格"),
    color: naturalReviewText(item?.color, "天然玉色")
  }));
}

/** 客户评级抬高优质客人（小—富有）出现权。*/
function wealthWeightsForSatisfaction(satisfaction) {
  const t = customerRatingTierInfo(satisfaction).wealthT;
  return WEALTHS.map((item) => {
    let weight = item.weight;
    if (item.id === "富有") weight *= 1 + t * 1.1;
    else if (item.id === "小康") weight *= 1 + t * 0.35;
    else if (item.id === "贫穷") weight *= Math.max(0.35, 1 - t * 0.55);
    return { ...item, weight };
  });
}

function kindValueFactor(kind) {
  return KIND_VALUE_FACTOR[kind] || 1;
}

function targetValueMid(wealthId, kind) {
  const band = WEALTH_VALUE_BAND[wealthId] || WEALTH_VALUE_BAND["小康"];
  return band.mid * kindValueFactor(kind);
}

const BODIES = [
  { id: "娇小", sizeBand: "S", weight: 30 },
  { id: "中等", sizeBand: "M", weight: 45 },
  { id: "高大", sizeBand: "L", weight: 25 }
];

const AGE_BANDS = [
  { id: "young", min: 18, max: 25, weight: 22 },
  { id: "adult", min: 26, max: 40, weight: 35 },
  { id: "mid", min: 41, max: 60, weight: 28 },
  { id: "elder", min: 61, max: 99, weight: 15 }
];

const SCORE_LABEL = {
  2: "种水：糯种及以上",
  3: "种水：糯冰及以上",
  4: "种水：正冰及以上",
  5: "种水：高冰及以上",
  6: "种水：玻璃种及以上" };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function weightedPick(items, rng = Math.random) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  let roll = rng() * (total || 1);
  for (const item of items) {
    roll -= Math.max(0, Number(item.weight) || 0);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function pickNDist(dist, rng = Math.random) {
  const total = dist.reduce((a, b) => a + b, 0) || 1;
  let roll = rng() * total;
  for (let i = 0; i < dist.length; i += 1) {
    roll -= dist[i];
    if (roll <= 0) return i;
  }
  return 0;
}

function randInt(min, max, rng = Math.random) {
  return Math.floor(min + rng() * (max - min + 1));
}

/** 店铺满意度长期均衡点；结算后向该值缓慢回。*/
export const ORDER_SAT_EQUILIBRIUM = 72;
export const ORDER_SAT_REGRESSION = 0.02;
export const ORDER_SAT_BASELINE = 70;

export function orderGenerationSatisfaction(value) {
  if (value == null || value === "") return ORDER_SAT_BASELINE;
  return clamp(Number(value) || 0, 0, 100);
}

/**
 * 订单本单评价档位（展示用文案 + 内部 kind）— * @returns {{ label: string, kind: "great"|"good"|"late_full"|"mid"|"bad" }}
 */
export function resolveOrderCustomerRating({
  tier,
  late = false,
  badReview = false,
  tipped = false,
  craftTipBoost = 0
} = {}) {
  if (badReview) return { label: "差评", kind: "bad" };
  if (tier === "full" && !late) {
    if (tipped || Number(craftTipBoost) > 0) return { label: "好评+", kind: "great" };
    return { label: "好评", kind: "good" };
  }
  if (tier === "full" && late) return { label: "中评", kind: "late_full" };
  return { label: "中评", kind: "mid" };
}

function orderSatisfactionEventDelta(kind, rng = Math.random) {
  switch (kind) {
    case "great":
      return 3;
    case "good":
      return 2;
    case "late_full":
      return -1;
    case "mid":
      return 0;
    case "bad":
      return -6;
    default:
      return 0;
  }
}

/** 好评边际：高分减速、低分加速恢。*/
function scaleOrderSatisfactionEventDelta(delta, sat) {
  if (delta <= 0) return delta;
  if (sat >= 90) return Math.max(1, Math.round(delta * 0.5));
  if (sat <= 40) return Math.round(delta * 1.5);
  return delta;
}

/**
 * 计算一单对店铺满意度的净变化（包含向 72 分均衡值回归）。
 * @returns {{ label: string, kind: string, delta: number, eventDelta: number, pull: number, satBefore: number }}
 */
export function computeOrderSatisfactionDelta(
  satisfaction,
  { tier, late = false, badReview = false, tipped = false, craftTipBoost = 0 } = {},
  rng = Math.random
) {
  const satBefore = satisfaction == null || satisfaction === ""
    ? ORDER_SAT_BASELINE
    : clamp(Number(satisfaction) || 0, 0, 100);
  const rating = resolveOrderCustomerRating({ tier, late, badReview, tipped, craftTipBoost });
  let eventDelta = orderSatisfactionEventDelta(rating.kind, rng);
  eventDelta = scaleOrderSatisfactionEventDelta(eventDelta, satBefore);
  const pull = (ORDER_SAT_EQUILIBRIUM - satBefore) * ORDER_SAT_REGRESSION;
  let delta = Math.round(eventDelta + pull);
  // 好评在高分段仍至少+1，避免「给了好评但数字不动
  if (eventDelta > 0) delta = Math.max(1, delta);
  // 差评在低分段仍至少

  if (rating.kind === "bad") delta = Math.min(-1, delta);
  return {
    label: rating.label,
    kind: rating.kind,
    delta,
    eventDelta,
    pull,
    satBefore
  };
}

/** Game-day key: before 05:00 counts as previous calendar day (server local). */
export function orderGameDayKey(now = Date.now()) {
  const d = new Date(now);
  if (d.getHours() < ORDER_DAILY_REFRESH_HOUR) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function msUntilNextOrderDailyRefresh(now = Date.now()) {
  const d = new Date(now);
  const next = new Date(d);
  next.setHours(ORDER_DAILY_REFRESH_HOUR, 0, 0, 0);
  if (d.getHours() >= ORDER_DAILY_REFRESH_HOUR) next.setDate(next.getDate() + 1);
  return Math.max(0, next.getTime() - now);
}

function ensureRefreshCounts(player, now = Date.now()) {
  const dayKey = orderGameDayKey(now);
  if (!player.orderRefreshCounts || player.orderRefreshCounts.dayKey !== dayKey) {
    player.orderRefreshCounts = { dayKey, single: 0, batch: 0 };
  }
  return player.orderRefreshCounts;
}

export function orderSingleRefreshFee(player, now = Date.now()) {
  const counts = ensureRefreshCounts(player, now);
  return orderSingleRefreshFeeForCount(counts.single);
}

export function orderBatchRefreshFee(player, now = Date.now()) {
  const counts = ensureRefreshCounts(player, now);
  return orderBatchRefreshFeeForCount(counts.batch);
}

function rollAge(rng) {
  const band = weightedPick(AGE_BANDS, rng);
  return randInt(band.min, band.max, rng);
}

function ageBandOf(age) {
  if (age <= 25) return "young";
  if (age <= 40) return "adult";
  if (age <= 60) return "mid";
  return "elder";
}

/** 人设融合成称呼，避免直白展示年龄/家境/目的。*/
export function personaDisplayTitle(persona = {}) {
  const ageBand = persona.ageBand || ageBandOf(Number(persona.age) || 30);
  const wealth = persona.wealth || "小康";
  const motive = persona.motive || "喜欢";
  const key = `${ageBand}|${wealth}|${motive}`;
  const table = {
    "elder|富有|撑场面": "贵妇",
    "elder|富有|炫富": "贵妇",
    "elder|富有|装样子": "名门长辈",
    "elder|富有|喜欢": "雅致长辈",
    "elder|小康|撑场面": "体面长辈",
    "elder|小康|炫富": "爱面子长辈",
    "elder|小康|装样子": "客气长辈",
    "elder|小康|喜欢": "和气街坊",
    "elder|贫穷|撑场面": "硬撑长辈",
    "elder|贫穷|炫富": "虚荣长辈",
    "elder|贫穷|装样子": "充面长辈",
    "elder|贫穷|喜欢": "邻里长辈",
    "mid|富有|撑场面": "阔太太",
    "mid|富有|炫富": "富家太太",
    "mid|富有|装样子": "体面太太",
    "mid|富有|喜欢": "雅客",
    "mid|小康|撑场面": "门面人",
    "mid|小康|炫富": "爱面子客",
    "mid|小康|装样子": "装体面客",
    "mid|小康|喜欢": "寻常客",
    "mid|贫穷|撑场面": "硬撑客",
    "mid|贫穷|炫富": "显摆客",
    "mid|贫穷|装样子": "充面子",
    "mid|贫穷|喜欢": "街坊邻里",
    "adult|富有|撑场面": "名媛",
    "adult|富有|炫富": "富家小姐",
    "adult|富有|装样子": "体面人",
    "adult|富有|喜欢": "雅客",
    "adult|小康|撑场面": "门面人",
    "adult|小康|炫富": "爱面子客",
    "adult|小康|装样子": "装体面客",
    "adult|小康|喜欢": "热心街坊",
    "adult|贫穷|撑场面": "硬撑客",
    "adult|贫穷|炫富": "显摆客",
    "adult|贫穷|装样子": "充面子",
    "adult|贫穷|喜欢": "街坊邻里",
    "young|富有|撑场面": "阔少",
    "young|富有|炫富": "富家千金",
    "young|富有|装样子": "潮人",
    "young|富有|喜欢": "年轻雅客",
    "young|小康|撑场面": "爱面子青年",
    "young|小康|炫富": "显摆青年",
    "young|小康|装样子": "装潮青年",
    "young|小康|喜欢": "年轻街坊",
    "young|贫穷|撑场面": "硬撑青年",
    "young|贫穷|炫富": "显摆青年",
    "young|贫穷|装样子": "充面青年",
    "young|贫穷|喜欢": "邻里后生"
  };
  return table[key] || "街坊客人";
}

function rollPersona(rng, { allowUnlimited = true, satisfaction = 0 } = {}) {
  const personality = weightedPick(PERSONALITIES, rng);
  const motive = weightedPick(MOTIVES, rng);
  let wealthPool = wealthWeightsForSatisfaction(satisfaction);
  if (motive.id === "炫富") {
    wealthPool = wealthPool.map((item) => ({
      ...item,
      weight: item.id === "富有" ? item.weight * 2.5 : item.id === "贫穷" ? item.weight * 0.15 : item.weight
    }));
  }
  const wealth = weightedPick(wealthPool, rng);
  const body = weightedPick(BODIES, rng);
  const age = rollAge(rng);
  const ageBand = ageBandOf(age);

  let budgetUnlimited = false;
  if (
    allowUnlimited
    && wealth.id === "富有"
    && (motive.id === "炫富" || motive.id === "撑场面")
    && rng() < 0.04 + clamp(Number(satisfaction) || 0, 0, 100) / 100 * 0.03
  ) {
    budgetUnlimited = true;
  }

  const persona = {
    age,
    ageBand,
    body: body.id,
    sizeBand: body.sizeBand,
    wealth: wealth.id,
    personality: personality.id,
    temper: personality.temper,
    nDist: personality.nDist,
    motive: motive.id,
    budgetUnlimited
  };
  persona.title = personaDisplayTitle(persona);
  persona.label = persona.title;
  return persona;
}

function rollRequirementCount(persona, rng) {
  let n = pickNDist(persona.nDist, rng);
  if (persona.motive === "喜欢") n = Math.max(0, n - 1);
  if (persona.motive === "炫富") n = Math.min(4, n + 1);
  return n;
}

const ORDER_KIND_KEYS = Object.keys(PRODUCT_CATEGORIES);
const FINE_METALS = [
  { id: "gold18k", label: "18K。" },
  { id: "goldPure", label: "足金24K" },
  { id: "platinum", label: "铂金PT950" }
];
const PLAIN_SETTINGS = [
  { id: "claw", label: "爪镶" },
  { id: "bezel", label: "包镶" },
  { id: "channel", label: "槽镶" },
  { id: "cord", label: "编绳/配链" }
];

function pickOne(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length) % list.length];
}

/** 必选题材：按人设先排除一类忌讳，再从剩余种类里抽一个正向题材。*/
function rollRequiredKind(persona, rng = Math.random) {
  let forbidKind = "cabochon";
  if (persona.ageBand === "elder") forbidKind = pickOne(["cabochon", "dropPendant"], rng);
  else if (persona.ageBand === "young") forbidKind = pickOne(["bracelet", "plaque", "buddhaPendant"], rng);
  else if (persona.motive === "炫富" || persona.motive === "撑场面") {
    forbidKind = pickOne(["cabochon", "fuBeanPendant"], rng);
  } else {
    forbidKind = pickOne(["bracelet", "cabochon"], rng);
  }
  const allowed = ORDER_KIND_KEYS.filter((kind) => kind !== forbidKind);
  const kind = pickOne(allowed.length ? allowed : ORDER_KIND_KEYS, rng);
  return {
    kind,
    label: KIND_LABELS[kind] || kind
  };
}

/** 内部按「不要什么」抽样，对外写成「要什么」的正向条款。*/
function materializeRequirement(raw, rng) {
  if (raw.type === "forbidCheapMetal" || raw.type === "requireFineMetal") {
    const metal = pickOne(FINE_METALS, rng);
    return {
      type: "requireMetal",
      metalId: metal.id,
      label: `镶嵌金属${metal.label}`
    };
  }
  if (raw.type === "forbidFlashySetting") {
    const setting = pickOne(PLAIN_SETTINGS, rng);
    return {
      type: "requireSetting",
      settingId: setting.id,
      label: `镶法${setting.label}`
    };
  }
  if (raw.type === "forbidDullColor") {
    return {
      type: "requireBrightColor",
      label: "色泽：要明艳正色"
    };
  }
  return {
    type: raw.type,
    label: raw.label,
    ...(raw.minScore != null ? { minScore: raw.minScore } : {})
  };
}

function buildAversionPool(persona, rng = Math.random, satisfaction = 0) {
  const pool = [];
  const push = (item, weight) => {
    if (weight > 0) pool.push({ ...item, weight });
  };
  const satT = clamp(Number(satisfaction) || 0, 0, 100) / 100;

  let w2 = 14;
  let w3 = 10;
  let w4 = 4;
  if (persona.wealth === "贫穷") w3 *= 0.4;
  let w5 = 4;
  let w6 = 1.5;
  if (persona.wealth === "富有") {
    w3 *= 1.4;
    w4 *= 1.6;
    w5 *= 1.8;
    w6 *= 2.2;
  }
  if (persona.motive === "炫富" || persona.motive === "撑场面") {
    w3 *= 1.5;
    w4 *= 1.8;
    w5 *= 2.0;
    w6 *= 2.4;
  }
  if (persona.ageBand === "mid" || persona.ageBand === "elder") {
    w2 *= 1.2;
    w3 *= 1.2;
  }
  if (persona.wealth !== "富有" || persona.motive !== "炫富") {
    w4 *= 0.35;
    w5 *= 0.25;
    w6 *= 0.15;
  }
  // 满意度越高，种水门槛条款略偏向更高档
  w2 *= 1 - satT * 0.25;
  w3 *= 1 + satT * 0.2;
  w4 *= 1 + satT * 0.55;
  w5 *= 1 + satT * 0.8;
  w6 *= 1 + satT * 1.1;

  push({ type: "minScore", minScore: 2, label: SCORE_LABEL[2] }, w2);
  push({ type: "minScore", minScore: 3, label: SCORE_LABEL[3] }, w3);
  push({ type: "minScore", minScore: 4, label: SCORE_LABEL[4] }, w4);
  push({ type: "minScore", minScore: 5, label: SCORE_LABEL[5] }, w5);
  push({ type: "minScore", minScore: 6, label: SCORE_LABEL[6] }, w6);

  let crackW = 16;
  if (persona.motive === "装样子" || persona.motive === "撑场面") crackW *= 1.4;
  if (persona.ageBand === "mid" || persona.ageBand === "elder") crackW *= 1.2;
  push({ type: "forbidCrack", label: "净度：无纹。" }, crackW);

  let cheapW = 12;
  if (persona.motive === "炫富" || persona.motive === "撑场面") cheapW *= 1.5;
  push({ type: "forbidCheapMetal" }, cheapW);

  let fineW = 6;
  if (persona.motive === "装样子" || persona.motive === "炫富") fineW *= 1.8;
  else fineW *= 0.2;
  fineW *= 1 + satT * 0.6;
  push({ type: "requireFineMetal" }, fineW);

  let flashW = 7;
  if (persona.ageBand === "elder") flashW *= 1.6;
  if (persona.ageBand === "young") flashW *= 0.5;
  push({ type: "forbidFlashySetting" }, flashW);

  let dullW = 8;
  if (persona.motive === "炫富") dullW *= 1.5;
  push({ type: "forbidDullColor" }, dullW);

  return pool;
}

function pickRequirements(persona, rng, satisfaction = 0) {
  const n = rollRequirementCount(persona, rng);
  if (n <= 0) return [];
  const pool = buildAversionPool(persona, rng, satisfaction);
  const pickedRaw = [];
  const usedTypes = new Set();
  let guard = 0;
  while (pickedRaw.length < n && pool.length && guard < 20) {
    guard += 1;
    const item = weightedPick(pool, rng);
    const idx = pool.indexOf(item);
    if (idx >= 0) pool.splice(idx, 1);
    if (item.type === "minScore" && usedTypes.has("minScore")) continue;
    if (item.type === "forbidCheapMetal" && usedTypes.has("requireFineMetal")) continue;
    if (item.type === "requireFineMetal" && usedTypes.has("forbidCheapMetal")) continue;
    if (item.type === "forbidCheapMetal" && usedTypes.has("metal")) continue;
    if (item.type === "requireFineMetal" && usedTypes.has("metal")) continue;
    if (usedTypes.has(item.type) && item.type !== "minScore") continue;
    if (item.type === "minScore") usedTypes.add("minScore");
    else if (item.type === "forbidCheapMetal" || item.type === "requireFineMetal") usedTypes.add("metal");
    else usedTypes.add(item.type);
    pickedRaw.push(item);
  }
  let materialized = pickedRaw.map((item) => materializeRequirement(item, rng));
  const scores = materialized.filter((item) => item.type === "minScore");
  if (scores.length > 1) {
    const best = scores.sort((a, b) => b.minScore - a.minScore)[0];
    materialized = [...materialized.filter((item) => item.type !== "minScore"), best];
  }
  return materialized.filter((item) => item.type !== "requireKind");
}

function rollPay(persona, rng, money, satisfaction, kind = null) {
  const satBoost = satisfactionPayBoost(satisfaction);
  const band = WEALTH_VALUE_BAND[persona.wealth] || WEALTH_VALUE_BAND["小康"];
  const mid = targetValueMid(persona.wealth, kind);

  if (persona.budgetUnlimited) {
    const raw = mid * (1.45 + rng() * 0.9);
    const pay = money(Math.max(50_000, raw) * satBoost);
    return {
      budgetMax: null,
      budgetUnlimited: true,
      pay,
      targetMid: Math.round(mid)
    };
  }

  let [mulLo, mulHi] = band.payMul;
  if (persona.motive === "炫富") {
    mulLo = mulLo + (mulHi - mulLo) * 0.45;
  } else if (persona.motive === "喜欢") {
    mulHi = mulLo + (mulHi - mulLo) * 0.7;
  } else if (persona.motive === "撑场面" || persona.motive === "装样子") {
    mulLo = mulLo + (mulHi - mulLo) * 0.2;
  }
  const ratio = mulLo + rng() * Math.max(0.01, mulHi - mulLo);
  let pay = money(mid * ratio * satBoost);
  pay = money(clamp(pay, band.absFloor, band.absCeil));
  return {
    budgetMax: pay,
    budgetUnlimited: false,
    pay,
    targetMid: Math.round(mid)
  };
}

function ensureLowBarrierOrder(player, makeOne) {
  const soft = (player.orders || []).filter((order) => (order.requirements || []).length <= 1 && !order.hard?.budgetUnlimited);
  if (soft.length) return;
  const forced = makeOne({ forceSparse: true });
  if (player.orders.length >= ORDER_SLOT_CAP) player.orders[player.orders.length - 1] = forced;
  else player.orders.push(forced);
}

function ensureUnlimitedCap(player) {
  const unlimited = (player.orders || []).filter((order) => order.hard?.budgetUnlimited);
  if (unlimited.length <= 1) return;
  for (let i = 1; i < unlimited.length; i += 1) {
    const idx = player.orders.indexOf(unlimited[i]);
    if (idx >= 0) player.orders[idx] = null;
  }
  player.orders = player.orders.filter(Boolean);
}

export function createOrdersService(deps) {
  const settlePlayerAchievements = deps.settlePlayerAchievements || legacySettlePlayerAchievements;
  const {
    money,
    clamp: clampFn = clamp,
    pick,
    qualities,
    takeItem,
    earnCash,
    materialStageFor,
    advanceTask,
    addNews
  } = deps;

  void pick;
  void qualities;

  function makeOrder(player, opts = {}) {
    const rng = opts.rng || Math.random;
    const satisfaction = orderGenerationSatisfaction(player?.satisfaction);
    const poolHasUnlimited = (player.orders || []).some((order) => order.hard?.budgetUnlimited);
    let persona = rollPersona(rng, {
      allowUnlimited: !poolHasUnlimited && !opts.forceSparse,
      satisfaction
    });
    if (opts.forceSparse) {
      persona = {
        ...persona,
        motive: "喜欢",
        personality: "宽和",
        temper: 0.45,
        nDist: [50, 35, 15, 0, 0],
        budgetUnlimited: false,
        wealth: persona.wealth === "富有" ? "小康" : persona.wealth
      };
      persona.title = personaDisplayTitle(persona);
      persona.label = persona.title;
    }

    const requiredKind = rollRequiredKind(persona, rng);
    const budget = rollPay(persona, rng, money, satisfaction, requiredKind.kind);
    const wantSize = opts.forceSparse
      ? rng() < 0.45
      : persona.motive === "喜欢"
        ? rng() >= 0.55
        : rng() >= 0.25;
    const sizeBand = wantSize ? persona.sizeBand : null;

    let requirements = opts.forceSparse ? [] : pickRequirements(persona, rng, satisfaction);
    if (opts.forceSparse && rng() < 0.35) {
      requirements = pickRequirements({ ...persona, nDist: [0, 100, 0, 0, 0] }, rng, satisfaction).slice(0, 1);
    }

    if (requiredKind.kind === "bracelet") requirements = normalizeBangleOrderRequirements(requirements);
    const expiresAt = Date.now() + msUntilNextOrderDailyRefresh(Date.now());
    const urgency = "日常订单";

    const difficulty = requirements.length + (budget.budgetUnlimited ? 2 : 0) + (sizeBand ? 0.5 : 0) + 0.5;
    const rep = Math.round(clampFn(4 + difficulty * 3 + (budget.pay / 8000), 4, budget.budgetUnlimited ? 28 : 18));
    const title = persona.title || personaDisplayTitle(persona);

    return {
      id: randomUUID(),
      client: title,
      persona: {
        age: persona.age,
        ageBand: persona.ageBand,
        body: persona.body,
        wealth: persona.wealth,
        personality: persona.personality,
        motive: persona.motive,
        temper: persona.temper,
        title,
        label: title
      },
      hard: {
        minValue: orderValueFloor({ pay: budget.pay }),
        budgetMax: budget.budgetMax,
        budgetUnlimited: budget.budgetUnlimited,
        sizeBand,
        kind: requiredKind.kind,
        kindLabel: requiredKind.label
      },
      requirements,
      quantity: 1,
      pay: budget.pay,
      rep,
      urgency,
      expiresAt,
      taste: persona.personality,
      minScore: requirements.find((item) => item.type === "minScore")?.minScore || 1,
      targetMid: budget.targetMid || null
    };
  }

  function refillOrders(player) {
    player.orders ||= [];
    if (player.onboarding?.starterOrderCompletedAt) player.orders = player.orders.filter((order) => !order.starterOrder);
    // Drop legacy template orders missing persona so pool migrates on refill.
    player.orders = player.orders.filter((order) => (order?.persona || order?.hard) && (!order.hard?.kind || Object.hasOwn(PRODUCT_CATEGORIES, order.hard.kind)));
    // Migrate legacy urgent slots onto the shared daily refresh deadline.
    const dailyExpiresAt = Date.now() + msUntilNextOrderDailyRefresh(Date.now());
    for (const order of player.orders) {
      if (order.hard?.kind === "bracelet") order.requirements = normalizeBangleOrderRequirements(order.requirements);
      if (order?.urgency === "加急订单") {
        order.urgency = "日常订单";
        order.expiresAt = dailyExpiresAt;
      }
    }
    while (player.orders.length < ORDER_SLOT_CAP) {
      player.orders.push(makeOrder(player));
    }
    ensureUnlimitedCap(player);
    while (player.orders.length < ORDER_SLOT_CAP) player.orders.push(makeOrder(player, { forceSparse: true }));
    ensureLowBarrierOrder(player, (opts) => makeOrder(player, opts));
    if (player.onboarding && !player.onboarding.starterOrderCompletedAt) {
      const product = (player.bracelets || []).find((item) => item.starterOriginId
        && item.starterOwnerId === player.id && materialStageFor(item) === "finished");
      if (product && !player.orders.some((order) => order.starterOrder)) {
        const value = money(product.value);
        const kind = finishedProductKind(product);
        player.orders[player.orders.length - 1] = {
          id: randomUUID(), client: "街坊试单", starterOrder: true,
          persona: { motive: "喜欢", personality: "宽和", temper: 0.45 },
          hard: { kind, kindLabel: KIND_LABELS[kind] || "成品", itemId: product.id,
            minValue: value, budgetMax: money(value * 1.25), budgetUnlimited: false },
          requirements: [], quantity: 1, pay: money(value * 1.12), rep: 4,
          expiresAt: Date.now() + msUntilNextOrderDailyRefresh(Date.now()),
          urgency: "新手试单", taste: "宽和", minScore: 1, targetMid: value
        };
      }
    }
  }

  function replaceOrdersPool(player) {
    player.orders = [];
    refillOrders(player);
  }

  function replaceOrderSlot(player, orderId) {
    player.orders ||= [];
    const idx = player.orders.findIndex((item) => item.id === orderId);
    if (idx < 0) return { ok: false, message: "订单不存在。" };
    const next = makeOrder(player);
    player.orders[idx] = next;
    ensureUnlimitedCap(player);
    ensureLowBarrierOrder(player, (opts) => makeOrder(player, opts));
    return { ok: true, order: player.orders[idx] };
  }

  function ensureDailyOrderRefresh(player, now = Date.now()) {
    const key = orderGameDayKey(now);
    if (player.orderDailyKey == null) {
      player.orderDailyKey = key;
      ensureRefreshCounts(player, now);
      return false;
    }
    if (player.orderDailyKey === key) return false;
    player.orderDailyKey = key;
    ensureRefreshCounts(player, now);
    replaceOrdersPool(player);
    return true;
  }

  function completeOrderForPlayer(player, { orderId, braceletIds } = {}) {
    if (!player) return { ok: false, message: "未找到玩家。" };
    const order = (player.orders || []).find((item) => item.id === orderId);
    if (!order) return { ok: false, message: "订单不存在。" };
    const selectedIds = [...new Set(Array.isArray(braceletIds) ? braceletIds : [])].slice(0, order.quantity || 1);
    const selected = selectedIds.map((id) => player.bracelets.find((bracelet) => bracelet.id === id)).filter(Boolean);
    if (selected.length < (order.quantity || 1)) return { ok: false, message: "交付数量不够。" };
    if (selected.some((bracelet) => materialStageFor(bracelet) !== "finished")) {
      return { ok: false, message: "只有最终成品才能交付订单。" };
    }

    const fits = selected.map((item) => evaluateOrderFit(item, order));
    const tierRank = { full: 0, partial: 1, hard_fail: 2 };
    const worst = fits.reduce((acc, fit) => (tierRank[fit.tier] > tierRank[acc.tier] ? fit : acc), fits[0]);
    let mismatch = Math.max(...fits.map((fit) => fit.mismatch));
    const now = Date.now();
    const expiresAt = Number(order.expiresAt) || 0;
    const onTime = !expiresAt || now <= expiresAt;
    const late = Boolean(expiresAt) && now > expiresAt;

    if (worst.tier === "hard_fail" || worst.rejected) {
      const reason = (worst.hardFails || worst.clauses || []).slice(0, 2).join("。") || "硬条件不。";
      return {
        ok: false,
        message: `客人拒收${reason}`,
        tier: "hard_fail",
        fit: worst
      };
    }

    const temper = Number(order.persona?.temper) || PERSONALITIES.find((item) => item.id === order.persona?.personality)?.temper || 0.75;
    let badReview = false;
    if (worst.tier !== "full" || late) {
      const lateBias = late ? 0.18 : 0;
      const badChance = clampFn(mismatch * temper * 0.85 + lateBias, 0, 0.92);
      badReview = Math.random() < badChance;
    }

    const payMult = worst.tier === "full" ? 1 : worst.budgetSoftOver ? 0.65 : 0.6;
    const timePenalty = onTime ? 1 : 0.72;
    const craftTipBoost = Math.max(0, ...fits.map((fit) => Number(fit.craftTipBoost) || 0));
    let tipMult = 1;
    let tipped = false;
    if (worst.tier === "full" && !badReview && onTime) {
      const tierInfo = customerRatingTierInfo(player.satisfaction);
      const tipChance = clampFn(
        0.08 + tierInfo.tipChanceBonus + (craftTipBoost > 0 ? 0.12 : 0),
        0.08,
        0.42
      );
      if (Math.random() < tipChance || craftTipBoost > 0) {
        tipped = true;
        tipMult = 1 + clampFn(
          (craftTipBoost > 0 ? craftTipBoost : 0.03 + tierInfo.tipMultBonus),
          0.03,
          0.08
        );
      }
    }
    const priceCap = Math.min(orderPayoutCap(selected), systemSalePriceCap(player, selected));
    let finalPay = Math.min(money(order.pay * payMult * timePenalty * tipMult), priceCap);
    let demandQuote = quoteSystemDemand(player, selected, finalPay, now, { exempt: order.starterOrder === true });
    // A random tip must not invalidate an otherwise affordable customer order.
    if (!demandQuote.ok && tipped) {
      finalPay = Math.min(money(order.pay * payMult * timePenalty), priceCap);
      demandQuote = quoteSystemDemand(player, selected, finalPay, now, { exempt: order.starterOrder === true });
      if (demandQuote.ok) { tipped = false; tipMult = 1; }
    }
    if (!demandQuote.ok) return { ok: false, code: demandQuote.code, message: demandQuote.message, demand: demandQuote };

    let repGain = 0;
    if (worst.tier === "full") repGain = order.rep + (craftTipBoost > 0 ? 1 : 0);
    else if (worst.tier === "partial") repGain = Math.round(order.rep * 0.4);
    else repGain = 0;
    if (late && repGain > 0) repGain = Math.max(1, Math.round(repGain * 0.7));
    if (badReview) {
      const penalty = -Math.max(4, Math.round(order.rep * 0.35));
      repGain = Math.min(repGain, penalty);
    }

    recordFinanceSale(player, selected, finalPay, { id: `order:${order.id}`, channel: "order", at: now });
    selectedIds.forEach((id) => takeItem(player, "bracelet", id));
    bookSystemDemand(player, demandQuote, "order");
    earnCash(player, finalPay, `订单交付${order.client}`, { source: "order", itemId: order.id });
    if (order.starterOrder && player.onboarding) player.onboarding.starterOrderCompletedAt = now;
    applyRepDelta(player, repGain, `订单交付${order.client}`, { source: "order", itemId: order.id });

    ensureCustomerRatingTracks(player);
    const satPlan = computeOrderSatisfactionDelta(player.orderSat, {
      tier: worst.tier,
      late,
      badReview,
      tipped,
      craftTipBoost
    });
    const reasonTag = badReview
      ? (late ? "超时" : worst.tier === "partial" ? "部分符合" : "未达到预期")
      : satPlan.kind === "late_full"
        ? "交付稍晚"
        : null;
    const reviewScore = orderReviewScore(satPlan.kind, worst.tier, late);
    const reviewDetail = {
      clientName: naturalReviewText(order.client, "顾客"),
      score: reviewScore,
      requirements: orderRequirementsForReview(order),
      submittedItems: submittedItemsForReview(selected),
      comment: orderReviewComment(reviewScore, { late, tier: worst.tier, tipped }),
      delivery: onTime ? "按时交付" : "超过约定时间",
      fit: worst.tier === "full" ? "符合订单要求" : "与订单要求有差距"
    };
    const satNote = badReview
      ? `订单差评 · ${reviewDetail.clientName}${reasonTag ? `（${reasonTag}）` : ""}`
      : satPlan.kind === "great" || satPlan.kind === "good"
        ? `订单好评 · ${reviewDetail.clientName}`
        : `订单评价 · ${reviewDetail.clientName}`;
    const satWasUnset = player.orderSat == null || player.orderSat === "";
    const displayBefore = player.satisfaction;
    const satApplied = applySatisfactionDelta(player, satPlan.delta, satNote, {
      source: "order_rating",
      track: "order",
      itemId: order.id,
      baseline: ORDER_SAT_BASELINE,
      reasonTag: reasonTag || undefined,
      extra: { review: reviewDetail },
      forceRecord: satPlan.delta !== 0 || satWasUnset
    });

    player.stats.orderCount += 1;
    player.orders = player.orders.filter((item) => item.id !== order.id);
    advanceTask(player, "order_complete");
    grantPlayerExp(player, worst.tier === "full" && onTime ? "order_ok" : "order_bad");
    settlePlayerAchievements(player);
    refillOrders(player);
    const qualityOk = selected.every((bracelet) => productMatchesOrder(bracelet, order));
    addNews(
      `${player.name} 完成 ${reviewDetail.clientName} 的订单，收入 ${finalPay}${tipped ? "（含小费）" : ""}，声望 ${repGain >= 0 ? "+" : ""}${repGain}${badReview ? "，收到差评" : ""}。`,
      badReview ? "bad" : qualityOk ? "trade" : "info"
    );
    return {
      ok: true,
      order,
      finalPay,
      repGain,
      qualityOk,
      tier: worst.tier,
      badReview,
      tipped,
      tipMult,
      late,
      onTime,
      fit: worst,
      customerRating: satPlan.label,
      customerRatingKind: satPlan.kind,
      satisfactionDelta: satApplied.displayBefore == null
        ? Number(satApplied.delta) || 0
        : Number(satApplied.displayAfter) - Number(satApplied.displayBefore),
      satisfactionBefore: satApplied.displayBefore ?? displayBefore,
      satisfactionAfter: satApplied.displayAfter,
      orderSatDelta: satApplied.delta,
      orderSatBefore: satApplied.before,
      orderSatAfter: satApplied.after,
      satisfaction: player.satisfaction,
      ratingTitle: customerRatingTierInfo(player.satisfaction).title
    };
  }

  return {
    makeOrder,
    refillOrders,
    replaceOrdersPool,
    replaceOrderSlot,
    ensureDailyOrderRefresh,
    completeOrderForPlayer,
    orderSingleRefreshFee,
    orderBatchRefreshFee,
    ensureRefreshCounts,
    orderGameDayKey,
    msUntilNextOrderDailyRefresh,
    NPC_PROFILES,
    ORDER_SLOT_CAP,
    ORDER_SIZE_BANDS
  };
}
