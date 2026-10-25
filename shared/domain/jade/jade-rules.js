import {
  KIND_LABELS,
  isSmallPieceKind,
  placementRadiusForKind
} from "./jade-categories.js";
import { collectRepFromValue } from "../progression/player-progression.js";
import { bangleFinishRecord, normalizeBangleOrderRequirements } from "../workshop/bangle-finish.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function money(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function placementRadius(placement = {}) {
  return placementRadiusForKind(placement.layout || placement.kind || "bracelet", placement);
}

function isNearWindow(rough = {}, placement = {}, radius) {
  return (rough.windows || rough.visual?.windows || []).some((win) => (
    Math.hypot(Number(placement.x || 50) - Number(win.x || 50), Number(placement.y || 50) - Number(win.y || 50)) < radius + Number(win.r || 10)
  ));
}

function colorLineHit(rough = {}, placement = {}) {
  const visual = rough.visual || {};
  if (!visual.belt) return false;
  const angle = Number(visual.beltAngle || 18) * Math.PI / 180;
  const dx = (Number(placement.x || 50) - 50) / 50;
  const dy = (Number(placement.y || 50) - 50) / 50;
  const cross = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
  return cross < 0.24 || isNearWindow(rough, placement, placementRadius(placement));
}

function crackHit(rough = {}, placement = {}) {
  const visual = rough.visual || {};
  if (!visual.crack) return false;
  const x = Number(placement.x || 50);
  const y = Number(placement.y || 50);
  return Math.abs(x - 50) < 9 && Math.abs(y - 50) < 20;
}

export function analyzeRoughPlacement(rough = {}, placement = {}) {
  const radius = placementRadius(placement);
  const x = Number(placement.x || 50);
  const y = Number(placement.y || 50);
  const reasons = [];
  let score = 82;

  if (x - radius < 7 || x + radius > 93 || y - radius < 7 || y + radius > 93) {
    score -= 22;
    reasons.push("靠边取件，损耗偏高");
  }

  if (colorLineHit(rough, placement)) {
    score += 18;
    reasons.push("吃色位，成品颜色更容易出彩");
  }

  if (isNearWindow(rough, placement, radius)) {
    score += 8;
    reasons.push("靠近开窗，判断可信度更高");
  }

  if ((placement.layout || placement.kind) === "bracelet" && Number(placement.ringSize || 56) >= 58) {
    score += 5;
    reasons.push("大圈口，销售溢价更好");
  }

  if (isSmallPieceKind(placement.layout || placement.kind)) {
    score += 5;
    reasons.push("小件路线，适合避裂保料");
  }

  if (crackHit(rough, placement)) {
    score -= 30;
    reasons.push("压裂风险，可能拉低净度");
  }

  const normalized = clamp(Math.round(score), 45, 122);
  const tone = normalized >= 100 ? "profit" : normalized < 78 || reasons.some((reason) => reason.includes("压裂")) ? "danger" : "info";
  return {
    score: normalized,
    tone,
    reasons: reasons.length ? reasons : ["常规位置，收益主要看料性"]
  };
}

export const ORDER_SIZE_BANDS = {
  S: { id: "S", label: "小" },
  M: { id: "M", label: "中" },
  L: { id: "L", label: "大" }
};

const DULL_COLOR_RE = /灰|油青|闷|暗|黑灰/;

/** 成品尺寸档：挂件看 S/M/L，手镯按圈口映射到大中小。 */
export function productSizeBand(product = {}) {
  const raw = product.size ?? product.templateSize ?? product.pendantSize;
  const asText = String(raw || "").toUpperCase();
  if (asText === "S" || asText === "M" || asText === "L") return asText;

  const ring = Number(product.ringSize);
  if (Number.isFinite(ring) && ring > 0) {
    if (ring <= 54) return "S";
    if (ring <= 58) return "M";
    return "L";
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 50) {
    if (numeric <= 54) return "S";
    if (numeric <= 58) return "M";
    return "L";
  }
  return "M";
}

export function productHasCrack(product = {}) {
  const ratio = Number(product.openingEval?.crackRatio ?? product.crackRatio ?? 0);
  if (ratio >= 0.02) return true;
  if (product.visual?.crack) return true;
  if (Number(product.crackPct || 0) >= 2) return true;
  return false;
}

function isPersonaOrder(order = {}) {
  return Boolean(order?.persona || order?.hard || Array.isArray(order?.requirements));
}

/**
 * 人设订单符合度：hard 为预算/尺寸/题材；requirements 为具体忌讳条款。
 * tier: full | partial | hard_fail
 * - 略超预算（≤110%）→ partial（议价）
 * - 明显超预算 / 尺寸题材不符 → hard_fail（拒收）
 */
export function evaluateOrderFit(product = {}, order = {}) {
  if (!isPersonaOrder(order)) {
    const ok = legacyProductMatchesOrder(product, order);
    return {
      hardOk: ok,
      hardFails: ok ? [] : ["未达旧版订单要求"],
      aversionHits: [],
      aversionTotal: 0,
      mismatch: ok ? 0 : 1,
      tier: ok ? "full" : "hard_fail",
      budgetSoftOver: false,
      rejected: !ok,
      craftTipBoost: 0,
      craftMismatch: 0,
      craftNotes: [],
      clauses: []
    };
  }

  const hard = order.hard || {};
  const hardFails = [];
  const softHits = [];
  let budgetSoftOver = false;
  const value = Number(product.value || product.price || 0);
  if (hard.itemId && product.id !== hard.itemId) hardFails.push("请选择本单指定的新手成品");

  if (!hard.budgetUnlimited && hard.budgetMax != null) {
    const cap = Number(hard.budgetMax);
    if (Number.isFinite(cap) && value > cap) {
      if (value <= cap * 1.1) {
        budgetSoftOver = true;
        softHits.push(`略超预算（上限 ${Math.round(cap)}），需议价`);
      } else {
        hardFails.push(`超出预算（上限 ${Math.round(cap)}）`);
      }
    }
  }

  if (hard.sizeBand) {
    const band = productSizeBand(product);
    if (band !== hard.sizeBand) {
      const want = ORDER_SIZE_BANDS[hard.sizeBand]?.label || hard.sizeBand;
      const got = ORDER_SIZE_BANDS[band]?.label || band;
      hardFails.push(`尺寸不符（要${want}，实际${got}）`);
    }
  }

  if (hard.kind) {
    const kind = finishedProductKind(product);
    if (kind !== hard.kind) {
      const want = hard.kindLabel || KIND_LABELS[hard.kind] || hard.kind;
      const got = KIND_LABELS[kind] || kind;
      hardFails.push(`题材不符（要${want}，实际${got}）`);
    }
  }

  const rawRequirements = Array.isArray(order.requirements) ? order.requirements : [];
  const requirements = hard.kind === "bracelet" ? normalizeBangleOrderRequirements(rawRequirements) : rawRequirements;
  const aversionHits = [];
  for (const req of requirements) {
    const hit = describeRequirementMiss(product, req);
    if (hit) aversionHits.push(hit);
  }

  const motive = order.persona?.motive;
  const personality = order.persona?.personality;

  // 工分 soft：不计硬条件；高工分小费加成，极低工分抬差评风险
  let craftTipBoost = 0;
  let craftMismatch = 0;
  const craftNotes = [];
  const craftScoreRaw = Number(product.craftScore);
  const hasCraft = Number.isFinite(craftScoreRaw) || Boolean(product.craftGrade);
  if (hasCraft) {
    const craftScore = Number.isFinite(craftScoreRaw) ? craftScoreRaw : 0;
    const craftGrade = String(product.craftGrade || (
      craftScore >= 100 ? "S" : craftScore >= 85 ? "A" : craftScore >= 70 ? "B" : craftScore >= 55 ? "C" : "D"
    ));
    const picky = personality === "计较" || motive === "炫富" || motive === "撑场面";
    if (picky && (craftGrade === "S" || craftGrade === "A" || craftScore >= 85)) {
      craftTipBoost = craftGrade === "S" || craftScore >= 100 ? 0.06 : 0.04;
      craftNotes.push(`做工${craftGrade}级，客人更满意`);
    }
    if ((motive === "装样子" || motive === "炫富") && (craftGrade === "D" || (Number.isFinite(craftScoreRaw) && craftScore < 55))) {
      craftMismatch = 0.2;
      craftNotes.push("做工偏低，影响体面观感");
    }
  }

  const aversionTotal = Math.max(requirements.length, 1);
  const mismatch = clamp(
    (requirements.length ? aversionHits.length / aversionTotal : 0)
      + softHits.length * 0.12
      + hardFails.length * 0.35
      + craftMismatch,
    0,
    1
  );

  let tier = "full";
  if (hardFails.length) tier = "hard_fail";
  else if (aversionHits.length || softHits.length) tier = "partial";

  return {
    hardOk: hardFails.length === 0,
    hardFails,
    aversionHits: [...aversionHits, ...softHits],
    aversionTotal: requirements.length,
    mismatch,
    tier,
    budgetSoftOver,
    rejected: hardFails.length > 0,
    craftTipBoost,
    craftMismatch,
    craftNotes,
    clauses: [...hardFails, ...aversionHits, ...softHits, ...craftNotes]
  };
}

function describeRequirementMiss(product, req = {}) {
  const type = req.type || req.id;
  if (type === "minCraftScore") return Number(product.craftScore || 0) >= req.minCraftScore ? null : req.label;
  if (type === "requirePolish") return bangleFinishRecord(product)?.polishId === req.polishId ? null : req.label;
  if (type === "minScore") {
    const need = Number(req.minScore || 1);
    if (Number(product.score || 0) < need) return req.label || `种水未达要求（需≥${need}）`;
    return null;
  }
  if (type === "forbidCrack") {
    if (productHasCrack(product)) return req.label || "存在纹裂";
    return null;
  }
  if (type === "forbidCheapMetal") {
    const metalId = product.inlay?.metalId || null;
    if (metalId === "silver925") return req.label || "镶嵌为 925银";
    return null;
  }
  if (type === "requireFineMetal") {
    const metalId = product.inlay?.metalId || null;
    const ok = metalId === "gold18k" || metalId === "goldPure" || metalId === "platinum";
    if (!ok) return req.label || "镶嵌未使用 18K/足金/铂金";
    return null;
  }
  if (type === "requireMetal") {
    const metalId = product.inlay?.metalId || null;
    if (metalId !== req.metalId) return req.label || "镶嵌金属不符";
    return null;
  }
  if (type === "forbidFlashySetting") {
    const settingId = product.inlay?.settingId || null;
    if (settingId === "micro" || settingId === "invisible") return req.label || "镶法过于花哨";
    return null;
  }
  if (type === "requireSetting") {
    const settingId = product.inlay?.settingId || null;
    if (settingId !== req.settingId) return req.label || "镶法不符";
    return null;
  }
  if (type === "forbidDullColor") {
    const color = String(product.color || "");
    if (DULL_COLOR_RE.test(color)) return req.label || "色泽灰闷";
    return null;
  }
  if (type === "requireBrightColor") {
    const color = String(product.color || "");
    if (DULL_COLOR_RE.test(color)) return req.label || "色泽不够明艳";
    return null;
  }
  if (type === "requireKind") {
    const kind = finishedProductKind(product);
    if (kind !== req.kind) {
      return req.label || `题材不符（要${KIND_LABELS[req.kind] || req.kind}）`;
    }
    return null;
  }
  return null;
}

function legacyProductMatchesOrder(product = {}, order = {}) {
  const kind = finishedProductKind(product);
  const acceptedKinds = Array.isArray(order.acceptedKinds) && order.acceptedKinds.length ? order.acceptedKinds : ["bracelet"];
  return Number(product.score || 0) >= Number(order.minScore || 1) && acceptedKinds.includes(kind);
}

export function productMatchesOrder(product = {}, order = {}) {
  if (isPersonaOrder(order)) return evaluateOrderFit(product, order).tier === "full";
  return legacyProductMatchesOrder(product, order);
}

/** 求购征集时长白名单（服务端只认 key，客户端用来渲染选项） */
export const WANT_DURATIONS = {
  "10m": { ms: 10 * 60 * 1000, label: "10 分钟" },
  "30m": { ms: 30 * 60 * 1000, label: "半小时" },
  "1h": { ms: 60 * 60 * 1000, label: "1 小时" },
  "6h": { ms: 6 * 60 * 60 * 1000, label: "6 小时" },
  "24h": { ms: 24 * 60 * 60 * 1000, label: "24 小时" },
  long: { ms: 0, label: "长期收" }
};

export const WANT_RULES = {
  lowest: { label: "价低者得", detail: "到期或确认时取最低合格报价" },
  manual: { label: "手选成交", detail: "由你指定应征成交；到期不自动成交" }
};

export const WANT_ITEM_TYPES = ["rough", "material", "slice", "bracelet"];

export const WANT_TYPE_LABELS = {
  rough: "原石",
  material: "明料",
  slice: "片料",
  bracelet: "成品"
};

const WANT_QUALITY_SCORE = {
  bean: 1,
  glutinous: 2,
  stickyIce: 3,
  ice: 4,
  highIce: 5,
  glass: 6,
  icy: 4,
  imperial: 6,
  violet: 3,
  red: 3,
  ink: 3
};

/** 公开种水 key（对齐交易行展示，不依赖未揭露真值） */
export function itemQualityKey(item = {}) {
  const color = String(item.color || "");
  if (color.includes("紫")) return "violet";
  if (color.includes("红")) return "red";
  if (color.includes("墨")) return "ink";
  const aliases = { icy: "ice", imperial: "glass" };
  const rawKey = item.qualityKey ? (aliases[item.qualityKey] || item.qualityKey) : "";
  if (rawKey && WANT_QUALITY_SCORE[rawKey] != null) return rawKey;
  const byScore = { 1: "bean", 2: "glutinous", 3: "stickyIce", 4: "ice", 5: "highIce", 6: "glass" };
  if (item.score != null) return byScore[Number(item.score)] || "glutinous";
  const hint = String(item.hint || item.publicHint || "");
  if (hint.includes("玻璃种")) return "glass";
  if (hint.includes("高冰")) return "highIce";
  if (hint.includes("正冰") || hint.includes("冰种")) return "ice";
  if (hint.includes("糯冰") || hint.includes("冰糯")) return "stickyIce";
  if (hint.includes("糯种")) return "glutinous";
  if (hint.includes("豆种")) return "bean";
  return "glutinous";
}

export function itemPublicScore(item = {}) {
  if (item.score != null && Number.isFinite(Number(item.score))) return Number(item.score);
  return WANT_QUALITY_SCORE[itemQualityKey(item)] || 2;
}

function inferItemType(item = {}, typeOverride) {
  if (typeOverride && WANT_ITEM_TYPES.includes(typeOverride)) return typeOverride;
  if (item.type && WANT_ITEM_TYPES.includes(item.type)) return item.type;
  if (item._type && WANT_ITEM_TYPES.includes(item._type)) return item._type;
  if (item.trueQualityKey || item.publicHint || item.materialStage === "rough") return "rough";
  return null;
}

/**
 * 求购硬匹配：品类 ∈ itemTypes；成品走 productMatchesOrder；
 * 原石/明料/片料看公开种水分；qualityKey 有值时再比对公开种水 key。note 不参与。
 */
export function wantMatchesItem(want = {}, item = {}, typeOverride) {
  const types = Array.isArray(want.itemTypes) && want.itemTypes.length
    ? want.itemTypes.filter((t) => WANT_ITEM_TYPES.includes(t))
    : ["bracelet"];
  const type = inferItemType(item, typeOverride);
  if (!type || !types.includes(type)) return false;
  const minScore = Number(want.minScore || 1);
  if (type === "bracelet") {
    return productMatchesOrder(item, {
      minScore,
      acceptedKinds: Array.isArray(want.acceptedKinds) && want.acceptedKinds.length
        ? want.acceptedKinds
        : ["bracelet"]
    });
  }
  if (itemPublicScore(item) < minScore) return false;
  if (want.qualityKey) return itemQualityKey(item) === want.qualityKey;
  return true;
}

export function finishedProductKind(product = {}) {
  // Older finishes overwrote kind with the wearing type. Recover only from
  // authoritative extraction provenance, never from a guessed display name.
  return product.motifKind
    || product.sourceMaterial?.placement?.layout
    || product.plan?.layout
    || product.kind
    || product.productType
    || "bracelet";
}

/** 交单预检：按要求符合程度计算报价倍率。 */
export function estimateOrderSettlement(fit = {}, order = {}) {
  if (fit.tier === "hard_fail" || fit.rejected) {
    return {
      label: "客人拒收",
      payMult: 0,
      payHint: "无法交付，不付款、不扣货",
      lateMult: 1
    };
  }
  if (fit.tier === "full") {
    return {
      label: "完全符合",
      payMult: 1,
      payHint: "符合客人要求，小费另计",
      lateMult: 1
    };
  }
  const payMult = 1 - clamp(Number(fit.mismatch) || 0, 0, 1) * 0.4;
  return {
    label: "部分符合",
    payMult,
    payHint: `按符合程度折算为 ${Math.round(payMult * 100)}%，可能影响评价`,
    lateMult: 1
  };
}

function careLineSeed(order = {}) {
  const raw = String(order.id || order.client || order.persona?.title || "care");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickCareLine(lines, seed) {
  const list = Array.isArray(lines) ? lines.filter(Boolean) : [];
  if (!list.length) return "";
  return list[seed % list.length];
}

function hasReqType(reqs, types) {
  const set = new Set(types);
  return reqs.some((req) => set.has(req?.type));
}

/** 订单卡「客户最在意」：只取一个高权重焦点，写成一句口语描述。 */
export function orderCareLine(order = {}) {
  const hard = order.hard || {};
  const persona = order.persona || {};
  const motive = persona.motive || "喜欢";
  const personality = persona.personality || "";
  const reqs = Array.isArray(order.requirements) ? order.requirements : [];
  const seed = careLineSeed(order);
  const strict = personality === "计较";

  let focus = "like";
  if (hasReqType(reqs, ["requireBrightColor", "forbidDullColor"])) focus = "color";
  else if (hasReqType(reqs, ["minScore"])) focus = "score";
  else if (hasReqType(reqs, ["forbidCrack"])) focus = "crack";
  else if (hasReqType(reqs, ["minCraftScore"])) focus = "craft";
  else if (hasReqType(reqs, ["requirePolish"])) focus = "polish";
  else if (hasReqType(reqs, ["requireMetal", "forbidCheapMetal", "requireFineMetal"])) focus = "metal";
  else if (hasReqType(reqs, ["requireSetting", "forbidFlashySetting"])) focus = "setting";
  else if (hard.sizeBand) focus = "size";
  else if (hard.kind || hard.kindLabel) focus = "kind";
  else if (motive === "炫富" || motive === "装样子") focus = "face";
  else if (motive === "撑场面") focus = "scene";

  const linesByFocus = {
    craft: ["内外圈要修得细致，边缘收口要舒服。", "喜欢做工精细、戴着顺手的手镯。"],
    polish: [reqs.find((req) => req.type === "requirePolish")?.polishId === "soft" ? "喜欢温润柔和的光泽。" : "喜欢明亮清晰的抛光效果。"],
    color: [
      "羡慕别人的翡翠特别绿。",
      "颜色要正、要艳，发闷的看不上。",
      "就想戴一块颜色醒目的。"
    ],
    score: [
      "最喜欢种水好的翡翠。",
      "就认水头足、看着透亮的那种。",
      strict ? "种水差一点就提不起兴趣。" : "种水差一点就少了点意思。"
    ],
    crack: [
      "最怕纹裂，干净的才安心。",
      strict ? "瑕疵多的，再便宜也不想要。" : "瑕疵多了就看着不踏实。"
    ],
    metal: [
      "镶口一定要体面，不能寒酸。",
      "金属成色差了，整件都掉价。"
    ],
    setting: [
      "镶法要稳妥好看，别花里胡哨。",
      "更喜欢规矩、耐看的镶法。"
    ],
    size: [
      "尺寸要对上手，太大太小都不行。",
      "戴着不合手，再好也不买。"
    ],
    kind: [
      "就认这路题材，别的先不看。",
      "这次就想收一件对路的成品。"
    ],
    face: [
      "就想戴出去有面子。",
      "货相要撑得住场面，不能掉价。"
    ],
    scene: [
      "这件要撑得住场子。",
      "拿得出手才算数。"
    ],
    like: [
      "看着顺眼、自己喜欢就行。",
      "最喜欢顺心的那一块翡翠。"
    ]
  };

  return pickCareLine(linesByFocus[focus] || linesByFocus.like, seed);
}

/** @deprecated 使用 orderCareLine；保留兼容旧调用。 */
export function orderCareFocus(order = {}) {
  const line = orderCareLine(order);
  return line ? [line] : [];
}

export function productOrderFitReasons(product = {}, order = {}) {
  if (isPersonaOrder(order)) {
    const fit = evaluateOrderFit(product, order);
    if (fit.tier === "full") return ["完全符合"];
    if (fit.clauses.length) return fit.clauses.slice(0, 4);
    return ["部分不符"];
  }

  const reasons = [];
  const kind = finishedProductKind(product);
  const acceptedKinds = Array.isArray(order.acceptedKinds) && order.acceptedKinds.length ? order.acceptedKinds : ["bracelet"];
  const preferredKinds = Array.isArray(order.preferredKinds) ? order.preferredKinds : [];
  const tasteTags = Array.isArray(order.tasteTags) ? order.tasteTags : [];

  if (Number(product.score || 0) >= Number(order.minScore || 1)) reasons.push("种水达标");
  else reasons.push("种水不足");

  if (acceptedKinds.includes(kind)) reasons.push(`题材匹配：${KIND_LABELS[kind] || "成品"}`);
  else reasons.push(`题材不符：客户不收${KIND_LABELS[kind] || "这类货"}`);

  if (preferredKinds.includes(kind)) reasons.push("偏好加成");
  if (tasteTags.includes("highGrade") && Number(product.score || 0) >= 4) reasons.push("高货偏好命中");
  if (tasteTags.includes("batch") && Number(product.score || 0) >= 2) reasons.push("适合稳定供货");
  if (tasteTags.includes("budget") && Number(product.value || 0) <= Number(order.pay || Infinity) * 1.35) reasons.push("预算友好");

  return reasons;
}

export function liveSaleRange(product = {}, rep = 0) {
  const value = Number(product.value || product.price || 0);
  const heat = clamp(Number(rep || 0) / 900, 0, 0.34);
  return {
    low: money(value * (0.78 + heat * 0.5)),
    high: money(value * (1.18 + heat))
  };
}

export function routeRecommendation(product = {}, orders = [], rep = 0) {
  const matchingOrders = orders.filter((order) => productMatchesOrder(product, order));
  if (matchingOrders.length) {
    const best = matchingOrders.slice().sort((a, b) => Number(b.pay || 0) - Number(a.pay || 0))[0];
    return {
      route: "order",
      label: "优先接单",
      detail: `${best.client || "客户"} 可消化，报价 ${money(best.pay)}`
    };
  }

  const collectRep = product.collectedRepGranted
    ? 0
    : collectRepFromValue(product.value);

  if (Number(product.score || 0) >= 4 && collectRep >= 6) {
    return {
      route: "collection",
      label: "适合收藏",
      detail: `入库声望 +${collectRep}`
    };
  }

  const range = liveSaleRange(product, rep);
  return {
    route: "livestream",
    label: "直播回款",
    detail: `预估 ${money(range.low)}-${money(range.high)}`
  };
}
