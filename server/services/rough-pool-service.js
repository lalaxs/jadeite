/**
 * Rough pool — jade qualities, stone generation, public pool refresh, starter stock.
 * Use createRoughPoolService(deps) after money/clamp/pick and getState exist.
 */
import { randomUUID } from "node:crypto";
import { buildOpeningStone, evaluateOpeningKit, scaleForOpeningKit } from "../../shared/domain/jade/jade-opening-engine.js";

export const STARTER_ROUGH_COUNT = 1;
export const ROUGH_POOL_TARGET = 8;
export const ROUGH_PRICE_NOISE = Object.freeze({ min: 0.82, max: 1.22 });
export const ROUGH_QUALITY_WEIGHTS = Object.freeze([
  Object.freeze({ key: "bean", weight: 0.38 }),
  Object.freeze({ key: "glutinous", weight: 0.30 }),
  Object.freeze({ key: "stickyIce", weight: 0.18 }),
  Object.freeze({ key: "ice", weight: 0.09 }),
  Object.freeze({ key: "highIce", weight: 0.04 }),
  Object.freeze({ key: "glass", weight: 0.01 })
]);
export const STARTER_ROUGH_PROFILES = Object.freeze([
  Object.freeze({ qualityKey: "glutinous", weight: 0.70 }),
  Object.freeze({ qualityKey: "bean", weight: 0.30 })
]);
export const STARTER_ROUGH_MASS = Object.freeze({ min: 0.8, max: 1.1 });
export const STARTER_ROUGH_PRICE_NOISE = Object.freeze({ min: 0.90, max: 1.05 });
export function starterQualityForRoll(roll) {
  return Math.max(0, Math.min(0.999999, Number(roll) || 0)) < STARTER_ROUGH_PROFILES[0].weight ? "glutinous" : "bean";
}

/** 种水六档（高→低：玻璃种＞高冰＞正冰＞糯冰＞糯种＞豆种）。帝王绿是「色」不是「种」。 */
export const QUALITIES = [
  { key: "bean", name: "豆种", score: 1, color: "灰绿", rep: 1, value: 0.75 },
  { key: "glutinous", name: "糯种", score: 2, color: "青白", rep: 4, value: 1.0 },
  { key: "stickyIce", name: "糯冰", score: 3, color: "浅绿", rep: 10, value: 1.3 },
  { key: "ice", name: "正冰", score: 4, color: "晴水", rep: 22, value: 1.7 },
  { key: "highIce", name: "高冰", score: 5, color: "飘花绿", rep: 45, value: 2.4 },
  { key: "glass", name: "玻璃种", score: 6, color: "阳绿", rep: 80, value: 3.4 }
];

/** 旧档兼容：icy→正冰，imperial 不再是种（按玻璃种处理，色另判） */
export const QUALITY_KEY_ALIASES = {
  icy: "ice",
  imperial: "glass",
  冰种: "ice",
  正冰: "ice",
  糯冰: "stickyIce",
  高冰: "highIce",
  高冰种: "highIce",
  玻璃种帝王绿: "glass"
};

export function normalizeQualityKey(key, qualities = QUALITIES) {
  const raw = String(key || "");
  const aliased = QUALITY_KEY_ALIASES[raw] || raw;
  return qualities.some((q) => q.key === aliased) ? aliased : null;
}

/** 高档种水有小概率出帝王绿色（色≠种） */
export function rollQualityColor(quality, rng = Math.random, options = {}) {
  const score = Number(quality?.score) || 1;
  const multiplier = Math.max(0, Number(options.imperialMultiplier) || 1);
  if (score >= 6 && rng() < Math.min(0.6, 0.15 * multiplier)) return "帝王绿";
  if (score >= 5 && rng() < Math.min(0.2, 0.03 * multiplier)) return "帝王绿";
  return quality?.color || "青白";
}

export function qualityByKey(key, qualities = QUALITIES) {
  const normalized = normalizeQualityKey(key, qualities) || key;
  return qualities.find((quality) => quality.key === normalized) || qualities[0];
}

export function createRoughPoolService(deps) {
  const {
    money,
    clamp,
    pick,
    getState,
    starterCount = STARTER_ROUGH_COUNT,
    poolTarget = ROUGH_POOL_TARGET
  } = deps;

  function pickWeightedQuality(rng = Math.random) {
    const roll = Math.max(0, Math.min(0.999999, Number(rng()) || 0));
    let cursor = 0;
    for (const row of ROUGH_QUALITY_WEIGHTS) {
      cursor += row.weight;
      if (roll < cursor) return qualityByKey(row.key);
    }
    return QUALITIES[QUALITIES.length - 1];
  }

  function makeExpertClues(fog, quality, confidence, mass) {
    const clues = [];
    clues.push(`${fog}皮壳`);
    clues.push(confidence > 0.62 ? "皮紧砂细" : confidence > 0.38 ? "表现不匀" : "赌性偏重");
    clues.push(quality.score >= 5 ? "色根有冲高空间" : quality.score >= 4 ? "水头可博" : "底子偏灰");
    clues.push(mass >= 2.4 ? "体量足，可多件规划" : mass >= 1.3 ? "适合稳取一件" : "小料优先避裂");
    return clues;
  }

  function makeStoneVisual(fog, quality, confidence) {
    const skinMap = {
      白雾: "#b8b7a8",
      黄雾: "#b2915a",
      黑乌砂: "#39413d",
      脱沙: "#8c907a",
      松花: "#6f8366",
      蟒带: "#5e776f"
    };
    const seed = Math.floor(Math.random() * 100000);
    const green = quality.score >= 5 ? "#18a66d" : quality.score >= 4 ? "#4fb58a" : "#789d7b";
    const beltAngle = Math.round(8 + Math.random() * 26);
    const crackAngle = Math.round(82 + Math.random() * 52);
    const bestAngle = confidence > 0.58 ? beltAngle : Math.round((beltAngle + 18 + Math.random() * 42) % 180);
    return {
      seed,
      skin: skinMap[fog] || "#73796f",
      vein: green,
      window: confidence > 0.48,
      crack: Math.random() > 0.58,
      belt: Math.random() > 0.36,
      beltAngle,
      crackAngle,
      bestAngle,
      suggestedAngle: Math.round((beltAngle + (Math.random() * 22 - 11) + 180) % 180),
      shape: pick(["round", "long", "chunk"]),
      grain: Math.round(30 + Math.random() * 70),
      translucency: clamp(quality.score * 0.16 + confidence * 0.22, 0.12, 0.92),
      cotton: clamp(1 - quality.score * 0.13 + Math.random() * 0.18, 0.08, 0.78),
      speckles: Math.round(80 + Math.random() * 120),
      skinRoughness: clamp(0.45 + Math.random() * 0.45, 0.2, 1)
    };
  }

  function makeRoughStone(options = {}) {
    const rng = typeof options.rng === "function" ? options.rng : Math.random;
    const requestedQuality = normalizeQualityKey(options.qualityKey);
    const trueQuality = requestedQuality ? qualityByKey(requestedQuality) : pickWeightedQuality(rng);
    const mass = Number.isFinite(Number(options.mass))
      ? Math.max(0.7, Math.min(3.5, Number(options.mass)))
      : Math.round(0.7 * 10 + rng() * 2.8 * 10) / 10;
    const fog = pick(["白雾", "黄雾", "黑乌砂", "脱沙", "松花", "蟒带"]);
    const confidence = Number.isFinite(Number(options.confidence))
      ? clamp(Number(options.confidence), 0, 1)
      : rng();
    const visibleScore = clamp(trueQuality.score + Math.floor(rng() * 3) - 1, 1, 6);
    const visibleQuality = QUALITIES.find((item) => item.score === visibleScore) || trueQuality;
    const basePrice = 900 + trueQuality.score * trueQuality.score * 720 + mass * 620;
    const noiseRange = options.starter === true ? STARTER_ROUGH_PRICE_NOISE : ROUGH_PRICE_NOISE;
    const noise = noiseRange.min + rng() * (noiseRange.max - noiseRange.min);
    const price = money(basePrice * noise);
    return {
      id: randomUUID(),
      name: `${fog}${pick(["木那", "莫湾基", "会卡", "南齐", "后江"])}料`,
      publicHint: `${fog}皮壳 · ${confidence > 0.55 ? "轮廓饱满" : "皮壳起伏"}`,
      hint: `${visibleQuality.name}迹象 · ${confidence > 0.55 ? "皮壳紧致" : "裂纹需细看"}`,
      mass,
      price,
      trueValue: money(price * trueQuality.value),
      deposit: money(basePrice * 0.18),
      risk: Math.round((1 - confidence + trueQuality.score * 0.07) * 100),
      expertClues: makeExpertClues(fog, trueQuality, confidence, mass),
      windows: [],
      visual: makeStoneVisual(fog, trueQuality, confidence),
      trueQualityKey: trueQuality.key,
      materialStage: "rough"
    };
  }

  function refreshRoughPool() {
    const pool = getState().roughPool;
    while (pool.length < poolTarget) pool.push(makeRoughStone());
  }

  function makeStarterRough(playerId, profile = {}) {
    const rng = typeof profile.rng === "function" ? profile.rng : Math.random;
    const qualityKey = starterQualityForRoll(rng());
    const rough = {
      ...makeRoughStone({ qualityKey, rng, starter: true,
        mass: Math.round((STARTER_ROUGH_MASS.min + rng() * (STARTER_ROUGH_MASS.max - STARTER_ROUGH_MASS.min)) * 10) / 10,
        confidence: 0.72 + rng() * 0.16 }),
      type: "rough",
      owner: playerId,
      revealed: false,
      polished: false,
      materialStage: "rough",
      starter: true,
      costBasis: { amount: 0, complete: true, components: { acquisition: 0 }, componentsComplete: true },
      starterProtection: true,
      starterOwnerId: playerId
    };
    rough.starterOriginId = rough.id;
    // Choose a usable, ordinary-colour interior without rerolling the 70/30 quality draw.
    // The saved seed is also used by the real workshop and the client's jade preview.
    for (let attempt = 0; attempt < 256; attempt += 1) {
      rough.openingSeed = `starter-${rough.visual.seed}-${attempt}`;
      const stone = buildOpeningStone({ seed: `${rough.id}:${rough.openingSeed}`,
        roughId: rough.id, qualityKey, color: qualityByKey(qualityKey).color });
      const kit = { tpl: "ping", x: 300, y: 300, rot: 0, scale: scaleForOpeningKit("ping", "M"), size: "M" };
      const evaluation = evaluateOpeningKit(kit, stone);
      if (stone.palList.every(({ pal }) => pal.rarity <= 3)
        && evaluation.price >= 250 && evaluation.wasteRatio <= 0.2 && evaluation.crackRatio <= 0.12) return rough;
    }
    throw new Error("Unable to generate a usable starter rough");
  }

  function makeStarterRoughs(playerId, count = starterCount) {
    return Array.from({ length: count }, () => (
      makeStarterRough(playerId)
    ));
  }

  return {
    QUALITIES,
    STARTER_ROUGH_COUNT: starterCount,
    ROUGH_POOL_TARGET: poolTarget,
    qualityByKey: (key) => qualityByKey(key, QUALITIES),
    pickWeightedQuality,
    makeExpertClues,
    makeStoneVisual,
    makeRoughStone,
    refreshRoughPool,
    makeStarterRough,
    makeStarterRoughs
  };
}
