import { stepScore, applyCraftStepValue } from "./workshop-craft-scoring.js";

export const BANGLE_REFINEMENTS = {
  basic: { name: "基础出光", description: "去毛边、基础细磨与抛光，适合快速出货。", timeMultiplier: .75, scoreMultiplier: .9, value: .03, valueCap: 700 },
  standard: { name: "标准精修", description: "内外圈修整、边缘收口与均匀细磨。", timeMultiplier: 1, scoreMultiplier: 1, value: .055, valueCap: 1000 },
  artisan: { name: "匠心精修", description: "更细致的收口与表面处理，适合精品。", timeMultiplier: 1.5, scoreMultiplier: 1.06, value: .07, valueCap: 1200 }
};
export const BANGLE_POLISHES = { bright: "亮光", soft: "柔光" };

export function isBangle(item = {}) {
  if (!item || typeof item !== "object") return false;
  const kind = item.jadePiece?.kind || item.motifKind || item.sourceMaterial?.placement?.layout || item.plan?.layout || item.kind || item.design;
  return ["bracelet", "bangle", "手镯"].includes(kind);
}

export function bangleRingSize(item) {
  return item.jadePiece?.ringSize || item.ringSize || item.sourceMaterial?.placement?.ringSize || item.plan?.ringSize || null;
}

export function bangleFinishRecord(item) {
  if (!isBangle(item)) return null;
  const record = item.finish || item.inlay;
  if (!record && item.materialStage !== "finished") return null;
  return {
    refinementId: record?.refinementId || "standard",
    refinementName: BANGLE_REFINEMENTS[record?.refinementId]?.name || "标准精修",
    polishId: record?.polishId || "bright",
    polishName: { ...BANGLE_POLISHES, matte: "哑光" }[record?.polishId] || "亮光"
  };
}

export function createBangleFinishDraft() {
  return { process: "bangle", productType: "bangle", refinementId: "standard", polishId: "bright" };
}

export function normalizeBangleFinishDraft(draft) {
  const normalized = {
    ...createBangleFinishDraft(),
    refinementId: Object.hasOwn(BANGLE_REFINEMENTS, draft.refinementId) ? draft.refinementId : "standard",
    polishId: Object.hasOwn(BANGLE_POLISHES, draft.polishId) ? draft.polishId : "bright"
  };
  for (const key of Object.keys(draft)) delete draft[key];
  return Object.assign(draft, normalized);
}

export function validateBangleFinishPlan(plan) {
  return plan?.process === "bangle" && plan.productType === "bangle"
    && Object.hasOwn(BANGLE_REFINEMENTS, plan.refinementId) && Object.hasOwn(BANGLE_POLISHES, plan.polishId)
    && ["settingId", "metalId", "gemId", "backingId"].every((key) => plan[key] == null)
    && (plan.gemCount == null || plan.gemCount === 0);
}

export function quoteBangleFinish(item, plan) {
  const refinement = BANGLE_REFINEMENTS[plan.refinementId];
  if (!refinement) return null;
  const base = Math.max(0, Number(item?.value ?? item?.price) || 0);
  const valueBonus = Math.min(Math.round(base * refinement.value), refinement.valueCap);
  return { metalId: null, metalAmount: 0, gemId: null, gemCount: 0, workerFee: 0, craftLaborFee: 0, laborFee: 0,
    materialCost: 0, materialValue: 0, processingValue: valueBonus, processingValueCap: refinement.valueCap,
    valueBonus, valueBonusCap: refinement.valueCap, nominalValueMultiplier: 1 + refinement.value,
    valueMultiplier: base > 0 ? Number((1 + valueBonus / base).toFixed(4)) : 1,
    timeMultiplier: refinement.timeMultiplier, trustModifier: 0 };
}

export function bangleStepScore(worker, refinementId = "standard") {
  return Math.min(120, stepScore(worker, "bangleFinish")
    * (BANGLE_REFINEMENTS[refinementId]?.scoreMultiplier || 1));
}

// Same calculation as workshop settlement, including prior-stage scores and
// device contributions. Polish is a visual preference, not a price upgrade.
export function previewBangleFinish(item, plan, worker, deviceAttrs = {}) {
  const result = structuredClone(item);
  applyCraftStepValue(result, { step: "finish", score: bangleStepScore(worker, plan.refinementId),
    worker, deviceAttrs, previousValue: item.value ?? item.price });
  const bonus = quoteBangleFinish(item, plan).valueBonus;
  const oldBonus = Math.max(0, Number(result.finishValueBonus) || 0);
  result.value += Math.max(oldBonus, bonus) - oldBonus;
  result.finishValueBonus = Math.max(oldBonus, bonus);
  return result;
}

export function applyBangleFinish(product, plan, quote = {}) {
  const refinement = BANGLE_REFINEMENTS[plan.refinementId] || BANGLE_REFINEMENTS.standard;
  const polishId = plan.polishId || "bright";
  const base = Number(product.value || 0);
  const oldBonus = Math.max(0, Number(product.finishValueBonus) || 0);
  const nextBonus = Number.isFinite(Number(quote.valueBonus)) ? Math.max(0, Number(quote.valueBonus))
    : Math.max(0, Math.round(base * (Number(quote.valueMultiplier ?? 1) - 1)));
  product.value = Math.round(base + Math.max(oldBonus, nextBonus) - oldBonus);
  product.finishValueBonus = Math.max(oldBonus, nextBonus);
  product.productType = "bangle";
  product.kind = "bracelet";
  product.motifKind = "bracelet";
  product.polished = true;
  product.inlaid = false;
  delete product.inlay;
  product.finish = { process: "bangle", refinementId: plan.refinementId || "standard", refinementName: refinement.name,
    polishId, polishName: { ...BANGLE_POLISHES, matte: "哑光" }[polishId], timeMultiplier: refinement.timeMultiplier };
  product.components = [{ type: "jade", role: "mainStone", kind: "bracelet", pieceId: product.jadePiece?.id || product.id,
    polishId, sourceMaterial: product.sourceMaterial ? structuredClone(product.sourceMaterial) : null, templateSize: product.templateSize }];
  return product;
}

export function normalizeBangleOrderRequirements(requirements = []) {
  const entries = Array.isArray(requirements) ? requirements.filter((entry) => entry && typeof entry === "object") : [];
  return entries.map((requirement) => {
    if (["requireMetal", "requireFineMetal", "forbidCheapMetal"].includes(requirement.type)) {
      return { type: "minCraftScore", minCraftScore: 70, label: "工艺：至少B级（70分）" };
    }
    if (["requireSetting", "forbidFlashySetting"].includes(requirement.type)) {
      const polishId = requirement.type === "forbidFlashySetting" || requirement.settingId === "cord" ? "soft" : "bright";
      return { type: "requirePolish", polishId, label: `抛光：${BANGLE_POLISHES[polishId]}` };
    }
    return requirement;
  }).filter((requirement, index, all) => all.findIndex((entry) => entry.type === requirement.type) === index);
}
