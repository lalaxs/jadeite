import { initializeInventory } from "./inventory-items.js";
/**
 * Dev-only helpers: spawn varied finished products into inventory.
 */
import { randomUUID } from "node:crypto";
import {
  PRODUCT_CATEGORIES,
  SMALL_PIECE_KINDS,
  productMetaForKind,
  templateSizeForKind
} from "../../shared/domain/jade/jade-categories.js";
import { QUALITIES, rollQualityColor } from "./rough-pool-service.js";
import {
  inlayCatalog,
  validateFinishPlan,
  quoteFinishPlan,
  applyInlay
} from "../systems/inlay-system.js";
import { addItem } from "./inventory-service.js";
import { BANGLE_REFINEMENTS, BANGLE_POLISHES } from "../../shared/domain/workshop/bangle-finish.js";

const RING_SIZES = [52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62];
const PIECE_SIZES = ["S", "M", "L"];
const CRAFT_GRADES = [
  { grade: "S", score: 108 },
  { grade: "A", score: 92 },
  { grade: "B", score: 76 },
  { grade: "C", score: 60 },
  { grade: "D", score: 42 }
];

function pick(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function shuffle(list, rng = Math.random) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shapeForJadeKind(kind) {
  if (kind === "cabochon") return "cabochon";
  if (kind === "peacePendant" || kind === "plaque") return "pierced";
  if (kind === "bracelet") return "bangle";
  return "carving";
}

function makeDebugVisual(quality, color, rng = Math.random) {
  const seed = Math.floor(rng() * 100000);
  const green = quality.score >= 5 ? "#18a66d" : quality.score >= 4 ? "#4fb58a" : "#789d7b";
  const beltAngle = Math.round(8 + rng() * 26);
  return {
    seed,
    skin: "#8c907a",
    vein: color === "帝王绿" ? "#0d8a4f" : green,
    window: true,
    crack: rng() > 0.7,
    belt: rng() > 0.4,
    beltAngle,
    crackAngle: Math.round(82 + rng() * 52),
    bestAngle: beltAngle,
    suggestedAngle: beltAngle,
    shape: pick(["round", "long", "chunk"], rng),
    grain: Math.round(30 + rng() * 70),
    translucency: Math.min(0.92, Math.max(0.12, quality.score * 0.16 + 0.2)),
    cotton: Math.min(0.78, Math.max(0.08, 1 - quality.score * 0.13)),
    speckles: Math.round(80 + rng() * 120),
    skinRoughness: 0.55
  };
}

function buildSizeVariants(kind) {
  if (kind === "bracelet") {
    return RING_SIZES.map((ringSize) => ({ kind, ringSize, size: undefined }));
  }
  return PIECE_SIZES.map((size) => ({ kind, ringSize: undefined, size }));
}

function buildFinishPlanPool(jadeKind) {
  if (jadeKind === "bracelet") return Object.keys(BANGLE_REFINEMENTS).flatMap((refinementId) => Object.keys(BANGLE_POLISHES).map((polishId) => ({ process: "bangle", productType: "bangle", refinementId, polishId })));
  const catalog = inlayCatalog();
  const shape = shapeForJadeKind(jadeKind);
  const productTypes = catalog.productTypes[shape] || [];
  const settings = catalog.shapeSettings[shape] || [];
  const polishes = Object.keys(catalog.polishes || {});
  const plans = [];
  for (const productType of productTypes) {
    for (const settingId of settings) {
      const setting = catalog.settings[settingId];
      const metalOptions = settingId === "cord" ? [null] : (setting?.metals || []);
      for (const metalId of metalOptions) {
        for (const polishId of polishes) {
          const gemOptions = [
            { gemId: null, gemCount: 0 },
            { gemId: "diamond", gemCount: 2 },
            { gemId: "ruby", gemCount: 1 }
          ];
          for (const gem of gemOptions) {
            const needsBacking = shape === "cabochon" && productType === "ring";
            const backingOptions = needsBacking ? ["open", "closed"] : [null];
            for (const backingId of backingOptions) {
              const plan = {
                productType,
                settingId,
                metalId,
                polishId,
                gemId: gem.gemId,
                gemCount: gem.gemCount,
                backingId
              };
              const check = validateFinishPlan({ kind: jadeKind }, plan);
              if (check.ok) plans.push(plan);
            }
          }
        }
      }
    }
  }
  return plans;
}

function fingerprintOf(spec) {
  const plan = spec.plan || (spec.jadeKind === "bracelet" ? { productType: "bangle", refinementId: "standard", polishId: "bright" } : null);
  return [
    spec.jadeKind,
    spec.ringSize ?? "",
    spec.size ?? "",
    plan ? "inlay" : "plain",
    plan?.productType || "",
    plan?.refinementId || "",
    plan?.settingId || "",
    plan?.metalId || "",
    plan?.polishId || "",
    plan?.gemId || "",
    plan?.gemCount ?? "",
    plan?.backingId || "",
    spec.qualityKey
  ].join("|");
}

function buildCandidateSpecs(rng = Math.random) {
  const kinds = Object.keys(PRODUCT_CATEGORIES);
  const candidates = [];
  for (const kind of kinds) {
    const sizeVariants = buildSizeVariants(kind);
    const plans = buildFinishPlanPool(kind);
    for (const sizeVar of sizeVariants) {
      for (const quality of QUALITIES) {
        candidates.push({
          ...sizeVar,
          jadeKind: kind,
          qualityKey: quality.key,
          plan: null
        });
      }
      const planSample = shuffle(plans, rng).slice(0, 8);
      for (const plan of planSample) {
        const quality = pick(QUALITIES, rng);
        candidates.push({
          ...sizeVar,
          jadeKind: kind,
          qualityKey: quality.key,
          plan: { ...plan }
        });
      }
    }
  }
  return candidates;
}

function materializeFinishedProduct(spec, rng = Math.random) {
  const quality = QUALITIES.find((item) => item.key === spec.qualityKey) || QUALITIES[0];
  const color = rollQualityColor(quality, rng);
  const meta = productMetaForKind(spec.jadeKind, {
    ringSize: spec.ringSize,
    size: spec.size
  });
  const craft = pick(CRAFT_GRADES, rng);
  const tpl = templateSizeForKind(spec.jadeKind);
  const category = PRODUCT_CATEGORIES[spec.jadeKind] || PRODUCT_CATEGORIES.bracelet;
  const visual = makeDebugVisual(quality, color, rng);
  const baseValue = Math.round(1800 * quality.value * meta.mult * (0.85 + rng() * 0.4));
  const placement = {
    id: randomUUID(),
    layout: spec.jadeKind,
    openingTpl: category.kitType,
    kitType: category.kitType,
    x: 300,
    y: 300,
    rot: 0,
    scale: 1,
    size: spec.size,
    ringSize: spec.ringSize,
    templateSize: { w: tpl.w, h: tpl.h },
    svgSpace: true
  };
  const baseName = `${quality.name}${color}${meta.label}`;
  const product = {
    id: randomUUID(),
    type: "bracelet",
    kind: spec.jadeKind,
    jadeKind: spec.jadeKind,
    name: baseName,
    baseName,
    design: meta.label,
    qualityKey: quality.key,
    quality: quality.name,
    color,
    score: quality.score,
    ringSize: spec.ringSize,
    size: spec.size,
    value: baseValue,
    baseValue,
    price: baseValue,
    rep: Math.max(1, Math.round(quality.rep * meta.rep)),
    count: 1,
    craftScore: craft.score,
    craftGrade: craft.grade,
    craftScores: { open: craft.score, plan: craft.score, finish: craft.score },
    polished: true,
    inlaid: false,
    materialStage: "finished",
    stage: "finished",
    sourceRoughId: `debug-${randomUUID()}`,
    plan: placement,
    sourceMaterial: {
      roughId: `debug-rough`,
      roughName: "调试。", visual,
      windows: [],
      placement,
      openingTpl: category.kitType,
      templateSize: { w: tpl.w, h: tpl.h },
      qualityKey: quality.key,
      color
    },
    debugSpawn: true
  };

  const plan = spec.plan || (spec.jadeKind === "bracelet" ? { process: "bangle", productType: "bangle", refinementId: "standard", polishId: "bright" } : null);
  if (plan) {
    const quote = quoteFinishPlan(product, plan, 0);
    if (quote.ok === false) return null;
    applyInlay(product, plan, quote);
    product.name = spec.jadeKind === "bracelet" ? baseName : `${baseName}${product.inlay?.productTypeName || "成品"}`;
  }

  return product;
}

/**
 * Spawn `count` mutually distinct finished products into player.bracelets.
 * Distinctness covers kind, size/ringSize, finish plan, and quality.
 */
export function spawnDebugFinishedProducts(player, { count = 50, rng = Math.random } = {}) {
  if (!player) return { ok: false, message: "未找到玩家。", items: [] };
  initializeInventory(player, "bracelet");
  const target = Math.max(1, Math.min(200, Math.floor(Number(count) || 50)));
  const candidates = shuffle(buildCandidateSpecs(rng), rng);
  const seen = new Set();
  const items = [];
  for (const spec of candidates) {
    if (items.length >= target) break;
    const key = fingerprintOf(spec);
    if (seen.has(key)) continue;
    const product = materializeFinishedProduct(spec, rng);
    if (!product) continue;
    seen.add(key);
    addItem(player, product, { type: "bracelet" });
    items.push(product);
  }
  // If the combinatorial pool was somehow exhausted, pad with plain size/kind variants
  // that only differ by craft grade / color roll.
  let guard = 0;
  while (items.length < target && guard < target * 4) {
    guard += 1;
    const kind = pick(Object.keys(PRODUCT_CATEGORIES), rng);
    const sizeVar = pick(buildSizeVariants(kind), rng);
    const quality = pick(QUALITIES, rng);
    const spec = {
      ...sizeVar,
      jadeKind: kind,
      qualityKey: quality.key,
      plan: null,
      pad: guard
    };
    const key = `${fingerprintOf(spec)}|pad:${guard}|craft:${pick(CRAFT_GRADES, rng).grade}`;
    if (seen.has(key)) continue;
    const product = materializeFinishedProduct(spec, rng);
    if (!product) continue;
    seen.add(key);
    addItem(player, product, { type: "bracelet" });
    items.push(product);
  }
  return { ok: true, count: items.length, items };
}

export const DEBUG_SPAWN_KIND_COUNT = Object.keys(PRODUCT_CATEGORIES).length;
export const DEBUG_SPAWN_SMALL_KIND_COUNT = SMALL_PIECE_KINDS.length;
