// Instance-owned implementation; legacy entry points remain one directory above.
import { canonicalizeFinishPlan, finishCapabilities, inlayCatalog } from "../../../systems/inlay-system.js";
import { finishGemPolicy, finishPieceRestriction } from "../../../../shared/domain/workshop/finished-product-design.js";
import { BANGLE_POLISHES, BANGLE_REFINEMENTS, isBangle, bangleStepScore } from "../../../../shared/domain/workshop/bangle-finish.js";
import { WORKER_SKILL_DEFS, PROCESS_SKILLS, stepScore, overallScore, craftGrade, gradeMult, applyCraftValue, PROCESS_BONUS_CAP } from "../../../../shared/domain/workshop/workshop-craft-scoring.js";

export function createNpcFinishPlans({
  
}) {
const catalog = inlayCatalog();

const STYLE_WEIGHTS = { finished: { cord: 35, metal: 45, gem: 20 }, traveler: { cord: 15, metal: 45, gem: 40 } };

const POLISH_WEIGHTS = { bright: 45, soft: 40, matte: 15 };

const REFINEMENT_WEIGHTS = { basic: 25, standard: 55, artisan: 20 };

const METAL_WEIGHTS = {
  finished: { silver925: 5, gold18k: 3, goldPure: 1, platinum: 1 },
  traveler: { silver925: 1, gold18k: 4, goldPure: 2, platinum: 3 }
};

function choose(values, rng, weights = {}) {
  const total = values.reduce((sum, value) => sum + (weights[value] ?? 1), 0);
  let roll = rng() * total;
  for (const value of values) {
    roll -= weights[value] ?? 1;
    if (roll < 0) return value;
  }
  return values.at(-1);
}

function npcFinishStyle(item) {
  if (isBangle(item)) return "bangle";
  if (!item?.inlay) return null;
  if (item.inlay.gemCount > 0) return "gem";
  return item.inlay.settingId === "cord" ? "cord" : "metal";
}

function npcFinishSignature(item, plan = item?.finish || item?.inlay) {
  if (!plan) return null;
  return [item.jadePiece?.kind || item.kind, plan.productType || item.productType, plan.refinementId,
    plan.settingId, plan.metalId, plan.gemId, plan.polishId, plan.backingId].join(":");
}

function finishOptions(item) {
  const capabilities = finishCapabilities(item.jadePiece?.kind || item.kind);
  const options = [];
  for (const productType of capabilities?.products || []) {
    if (finishPieceRestriction(item, productType)) continue;
    for (const settingId of capabilities.settings) {
      if (settingId === "cord") {
        if (productType === "pendant") options.push({ productType, settingId, style: "cord" });
        continue;
      }
      const policy = finishGemPolicy({ productType, settingId });
      if (!policy.required) options.push({ productType, settingId, style: "metal" });
      if (policy.supports) options.push({ productType, settingId, style: "gem" });
    }
  }
  return options;
}

function createNpcFinishPlan(item, rng, { supplierRole = "finished", avoidSignatures = [], preferredStyles = [] } = {}) {
  const options = isBangle(item) ? [] : finishOptions(item);
  if (!isBangle(item) && !options.length) throw new Error("NPC jade has no player-reachable finish plan");
  const avoid = new Set(avoidSignatures);
  let fallback;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    let raw;
    if (isBangle(item)) {
      raw = { process: "bangle", productType: "bangle",
        refinementId: choose(Object.keys(BANGLE_REFINEMENTS), rng, REFINEMENT_WEIGHTS),
        polishId: choose(Object.keys(BANGLE_POLISHES), rng, { bright: 55, soft: 45 }) };
    } else {
      let styles = [...new Set(options.map((option) => option.style))];
      const preferred = styles.filter((style) => preferredStyles.includes(style));
      if (preferred.length) styles = preferred;
      const style = choose(styles, rng, STYLE_WEIGHTS[supplierRole] || STYLE_WEIGHTS.finished);
      const styleOptions = options.filter((option) => option.style === style);
      const productType = choose([...new Set(styleOptions.map((option) => option.productType))], rng);
      const selected = choose(styleOptions.filter((option) => option.productType === productType), rng);
      raw = { productType, settingId: selected.settingId,
        metalId: style === "cord" ? null : choose(catalog.settings[selected.settingId].metals, rng, METAL_WEIGHTS[supplierRole] || METAL_WEIGHTS.finished),
        gemId: style === "gem" ? choose(Object.keys(catalog.gems), rng) : null,
        gemCount: 0, polishId: choose(Object.keys(catalog.polishes), rng, POLISH_WEIGHTS),
        backingId: productType === "ring" ? choose(Object.keys(catalog.backings), rng, { open: 80, closed: 20 }) : null };
    }
    // Canonicalization computes the exact current stone-seat count and validates
    // dimensions, metal compatibility and every other authoritative constraint.
    const canonical = canonicalizeFinishPlan(item, raw);
    if (!canonical.ok) throw new Error(`NPC finish plan rejected: ${canonical.message}`);
    fallback = canonical.plan;
    if (!avoid.has(npcFinishSignature(item, fallback))) return fallback;
  }
  // Variety must never make an otherwise legal restock fail.
  return fallback;
}

function applyNpcCraftScore(item, rng, finishPlan, premium = false) {
  const worker = { tier: (premium ? 3 : 1) + Math.floor(rng() * 3), flaws: [], skills: { cut: {}, set: {}, finish: {} } };
  for (const key of PROCESS_SKILLS) {
    worker.skills[WORKER_SKILL_DEFS[key].dir][key] = { level: (premium ? 6 : 4) + Math.floor(rng() * (premium ? 3 : 4)), exp: 0 };
  }
  item.craftScores = { open: stepScore(worker, "open"), plan: stepScore(worker, "plan") };
  if (finishPlan) item.craftScores.finish = isBangle(item)
    ? bangleStepScore(worker, finishPlan.refinementId) : stepScore(worker, "finish");
  item.craftScore = Math.round(overallScore(item));
  item.craftGrade = craftGrade(item.craftScore);
  applyCraftValue(item, item.craftScore / 100 * PROCESS_BONUS_CAP, gradeMult(item.craftScore), worker);
}

  return {
    npcFinishStyle,
    npcFinishSignature,
    createNpcFinishPlan,
    applyNpcCraftScore
  };
}
