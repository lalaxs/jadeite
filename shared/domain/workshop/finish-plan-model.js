import { SETTING_GEMS, finishGemPolicy, normalizeFinishGemLayout, finishMetalScale, finishPieceRestriction } from "./finished-product-design.js";
import { isBangle, createBangleFinishDraft, normalizeBangleFinishDraft, quoteBangleFinish } from "./bangle-finish.js";
import { inlayValueBreakdown } from "./inlay-value.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function createFinishPlanDraft(shape, catalog, item = { kind: shape }) {
  if (shape === "bangle" || isBangle(item)) return createBangleFinishDraft();
  const productType = catalog.productTypes?.[shape]?.[0] || null;
  const settingId = catalog.shapeSettings?.[shape]?.[0] || null;
  return normalizeFinishPlanDraft(shape, {
    productType,
    settingId,
    metalId: null,
    gemId: null,
    gemCount: 0,
    gemLayout: SETTING_GEMS,
    polishId: Object.keys(catalog.polishes || {})[0] || "bright",
    backingId: shape === "cabochon" && productType === "ring" ? "open" : null
  }, catalog, item);
}

export function normalizeFinishPlanDraft(shape, draft, catalog, item = { kind: shape }) {
  if (shape === "bangle" || isBangle(item)) return normalizeBangleFinishDraft(draft);
  const productTypes = (catalog.productTypes?.[shape] || []).filter((type) => !finishPieceRestriction(item, type));
  const settings = catalog.shapeSettings?.[shape] || [];
  if (!productTypes.includes(draft.productType)) draft.productType = productTypes[0] || null;
  if (!settings.includes(draft.settingId)) draft.settingId = settings[0] || null;

  const allowedMetals = catalog.settings?.[draft.settingId]?.metals || [];
  if (draft.metalId && !allowedMetals.includes(draft.metalId)) draft.metalId = null;

  if (draft.gemId && !catalog.gems?.[draft.gemId]) draft.gemId = null;
  draft.gemCount = draft.gemId
    ? clamp(Math.round(Number(draft.gemCount) || 1), 1, 12)
    : 0;
  normalizeFinishGemLayout(item, draft);

  if (!catalog.polishes?.[draft.polishId]) {
    draft.polishId = Object.keys(catalog.polishes || {})[0] || null;
  }

  const backingAllowed = shape === "cabochon" && draft.productType === "ring";
  draft.backingId = backingAllowed && catalog.backings?.[draft.backingId]
    ? draft.backingId
    : backingAllowed ? "open" : null;
  return draft;
}

export function quoteFinishPlanDraft(draft, catalog, workerFee = 0, itemValue = 0, item = null) {
  if (draft.process === "bangle") return quoteBangleFinish(item || { value: itemValue }, draft);
  const setting = catalog.settings?.[draft.settingId];
  const polish = catalog.polishes?.[draft.polishId];
  const backing = draft.backingId ? catalog.backings?.[draft.backingId] : { labor: 0, value: 0 };
  if (!setting || !polish || !backing) return null;
  const metalAmount = draft.metalId
    ? Number((Number(setting.grams || 0) * finishMetalScale(item) * (1 + Number(draft.gemCount || 0) * .05)).toFixed(2))
    : 0;
  const craftLaborFee = Number(setting.labor || 0)
    + Number(draft.gemCount || 0) * 80
    + Number(polish.labor || 0)
    + Number(backing.labor || 0);
  const nominalValueMultiplier = Number((
    1
    + Number(setting.value || 0)
    + Number(draft.metalId ? catalog.metalValues?.[draft.metalId] || 0 : 0)
    + Number(draft.gemCount || 0) * Number(catalog.gemValues?.[draft.gemId] ?? .05)
    + Number(polish.value || 0)
    + Number(backing.value || 0)
  ).toFixed(2));
  const baseValue = Math.max(0, Number(itemValue) || 0);
  const valueBreakdown = inlayValueBreakdown({ baseValue, metalId: draft.metalId, metalAmount,
    gemId: draft.gemId, gemCount: Number(draft.gemCount || 0),
    craftValueRate: Number(setting.value || 0) + Number(polish.value || 0) + Number(backing.value || 0),
    craftLabor: craftLaborFee, valueBonusBase: Number(catalog.valueBonusBase ?? 1200),
    valueBonusLaborRate: Number(catalog.valueBonusLaborRate ?? 0.6), materialUnitValues: catalog.materialUnitValues });
  return {
    metalId: draft.metalId,
    metalAmount,
    gemId: draft.gemId,
    gemCount: Number(draft.gemCount || 0),
    workerFee: 0,
    craftLaborFee: 0,
    laborFee: 0,
    nominalValueMultiplier,
    ...valueBreakdown
  };
}

export function validateFinishPlanDraft({
  shape,
  draft,
  catalog,
  materials = {},
  cash = 0,
  workerFee = 0,
  itemValue = 0,
  item = { kind: shape }
}) {
  normalizeFinishPlanDraft(shape, draft, catalog, item);
  const quote = quoteFinishPlanDraft(draft, catalog, workerFee, itemValue, item);
  const reasons = [];
  if (draft.process === "bangle" && !catalog.productTypes?.bangle?.includes("bangle")) {
    reasons.push("当前游戏服务尚未加载手镯精修规则，请重启游戏服务并刷新页面。");
  }
  const allowedMetals = catalog.settings?.[draft.settingId]?.metals || [];
  if (allowedMetals.length && !draft.metalId) reasons.push("请选择金属种类");
  if (draft.gemLayout === SETTING_GEMS && finishGemPolicy(draft).required && !draft.gemId) reasons.push("微镶需选择配石种类");
  if (draft.gemId && draft.gemCount < 1) reasons.push("请选择配石数量");

  const metalHeld = draft.metalId ? Number(materials[draft.metalId] || 0) : 0;
  const gemHeld = draft.gemId ? Number(materials[draft.gemId] || 0) : 0;
  const stockShortages = [];
  if (quote && draft.metalId && metalHeld < quote.metalAmount) {
    reasons.push("金属库存不足");
    stockShortages.push({ kind: "metal", materialId: draft.metalId });
  }
  if (quote && draft.gemId && gemHeld < quote.gemCount) {
    reasons.push("配石库存不足");
    stockShortages.push({ kind: "gem", materialId: draft.gemId });
  }
  if (!quote) reasons.push("当前方案无法报价");

  return {
    quote,
    reasons,
    stockShortages,
    canStart: reasons.length === 0,
    metalHeld,
    gemHeld,
    showMetalInventory: Boolean(draft.metalId),
    showGemInventory: Boolean(draft.gemId)
  };
}
