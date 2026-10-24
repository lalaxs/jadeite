// Instance-owned implementation; legacy entry points remain one directory above.
import { buildOpeningStone, scaleForOpeningKit } from "../../../../shared/domain/jade/jade-opening-engine.js";
import { captureExtractedJadePiece } from "../../../../shared/domain/workshop/finished-product-design.js";
import { jadePieceFor } from "../../../../shared/domain/jade/jade-piece.js";
import { canonicalizeFinishPlan, quoteFinishPlan, applyInlay } from "../../../systems/inlay-system.js";
import { createBangleFinishDraft, isBangle } from "../../../../shared/domain/workshop/bangle-finish.js";

export function createNpcJadeFinish({
  
}) {
function completeNpcJadeAppearance(item, { preserveValue = true, finishPlan = null } = {}) {
  if (item?.type !== "bracelet" || !["carved", "finished"].includes(item.materialStage)) return false;
  const source = item.sourceMaterial;
  const placement = source?.placement;
  if (!source?.visual || !placement?.openingTpl) return false;
  const finished = item.materialStage === "finished";
  if (jadePieceFor(item) && (!finished || item.components?.length)) return false;
  let changed = false;
  if (!jadePieceFor(item)) {
    item.baseName ||= String(item.name || "翡翠").replace(/(?:精雕毛坯|毛坯)$/u, "");
    // The first NPC version stored percentage coordinates with svgSpace=true.
    // Its evaluator used x*6/y*6; keep that exact sample, rather than crop at 40px.
    if (Number(placement.x) <= 100 && Number(placement.y) <= 100) {
      placement.svgSpace = false;
      if (item.plan) item.plan.svgSpace = false;
    }
    const roughId = source.roughId || item.sourceRoughId;
    const seed = source.openingSeed || source.visual.openingSeed || source.visual.seed || roughId;
    const stone = buildOpeningStone({ seed: `${roughId}:${seed}`, roughId,
      qualityKey: source.qualityKey || item.qualityKey, quality: source.quality || item.quality, color: source.color || item.color });
    const percent = !placement.svgSpace && Number(placement.x) <= 100 && Number(placement.y) <= 100;
    const kit = { tpl: placement.openingTpl, x: Number(placement.x) * (percent ? 6 : 1), y: Number(placement.y) * (percent ? 6 : 1),
      rot: Number(placement.rot || 0), scale: Number(placement.scale) || scaleForOpeningKit(placement.openingTpl, item.ringSize || item.size) };
    item.jadePiece = captureExtractedJadePiece(item, stone, kit);
    changed = true;
  }
  if (finished && !item.components?.length) {
    // New stock supplies a sampled plan. Legacy appearance repairs retain the
    // original default and never reroll an existing complete or purchased item.
    const canonical = canonicalizeFinishPlan(item, finishPlan || (isBangle(item) ? createBangleFinishDraft() : {
      productType: "pendant", settingId: "cord",
      metalId: null, gemId: null, gemCount: 0, polishId: "bright", backingId: null
    }));
    if (!canonical.ok) throw new Error(`NPC finish plan rejected: ${canonical.message}`);
    const quote = quoteFinishPlan(item, canonical.plan);
    if (quote?.ok === false) throw new Error(`NPC finish quote rejected: ${quote.message}`);
    const valueBefore = item.value;
    applyInlay(item, canonical.plan, preserveValue ? { ...quote, valueBonus: 0, valueMultiplier: 1 } : quote);
    if (preserveValue) item.value = valueBefore;
    changed = true;
  }
  if (changed) item.npcOrigin = "blackmarket";
  return changed;
}

function repairPurchasedNpcJade(item, purchaseIds) {
  const source = item?.sourceMaterial;
  const oldNpcShape = !item?.debugSpawn && !item?.inlaid && !jadePieceFor(item)
    && source?.placement?.svgSpace === true && item?.craftScores?.open != null && item?.craftScores?.plan != null;
  if (item?.npcOrigin !== "blackmarket" && !(oldNpcShape && purchaseIds.has(item.id))) return false;
  return completeNpcJadeAppearance(item);
}

  return {
    completeNpcJadeAppearance,
    repairPurchasedNpcJade
  };
}
