function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function createFinishPlanDraft(shape, catalog) {
  const productType = catalog.productTypes?.[shape]?.[0] || null;
  const settingId = catalog.shapeSettings?.[shape]?.[0] || null;
  return normalizeFinishPlanDraft(shape, {
    productType,
    settingId,
    metalId: null,
    gemId: null,
    gemCount: 0,
    polishId: Object.keys(catalog.polishes || {})[0] || "bright",
    backingId: shape === "cabochon" && productType === "ring" ? "open" : null
  }, catalog);
}

export function normalizeFinishPlanDraft(shape, draft, catalog) {
  const productTypes = catalog.productTypes?.[shape] || [];
  const settings = catalog.shapeSettings?.[shape] || [];
  if (!productTypes.includes(draft.productType)) draft.productType = productTypes[0] || null;
  if (!settings.includes(draft.settingId)) draft.settingId = settings[0] || null;

  const allowedMetals = catalog.settings?.[draft.settingId]?.metals || [];
  if (draft.metalId && !allowedMetals.includes(draft.metalId)) draft.metalId = null;

  if (draft.gemId && !catalog.gems?.[draft.gemId]) draft.gemId = null;
  draft.gemCount = draft.gemId
    ? clamp(Math.round(Number(draft.gemCount) || 1), 1, 12)
    : 0;

  if (!catalog.polishes?.[draft.polishId]) {
    draft.polishId = Object.keys(catalog.polishes || {})[0] || null;
  }

  const backingAllowed = shape === "cabochon" && draft.productType === "ring";
  draft.backingId = backingAllowed && catalog.backings?.[draft.backingId]
    ? draft.backingId
    : backingAllowed ? "open" : null;
  return draft;
}

export function quoteFinishPlanDraft(draft, catalog) {
  const setting = catalog.settings?.[draft.settingId];
  const polish = catalog.polishes?.[draft.polishId];
  const backing = draft.backingId ? catalog.backings?.[draft.backingId] : { labor: 0, value: 0 };
  if (!setting || !polish || !backing) return null;
  const metalAmount = draft.metalId
    ? Number((Number(setting.grams || 0) * (1 + Number(draft.gemCount || 0) * .05)).toFixed(2))
    : 0;
  return {
    metalId: draft.metalId,
    metalAmount,
    gemId: draft.gemId,
    gemCount: Number(draft.gemCount || 0),
    laborFee: Number(setting.labor || 0)
      + Number(draft.gemCount || 0) * 80
      + Number(polish.labor || 0)
      + Number(backing.labor || 0),
    valueMultiplier: Number((
      1
      + Number(draft.metalId ? catalog.metalValues?.[draft.metalId] || 0 : 0)
      + Number(draft.gemCount || 0) * .05
      + Number(polish.value || 0)
      + Number(backing.value || 0)
    ).toFixed(2))
  };
}

export function validateFinishPlanDraft({ shape, draft, catalog, materials = {}, cash = 0 }) {
  normalizeFinishPlanDraft(shape, draft, catalog);
  const quote = quoteFinishPlanDraft(draft, catalog);
  const reasons = [];
  const allowedMetals = catalog.settings?.[draft.settingId]?.metals || [];
  if (allowedMetals.length && !draft.metalId) reasons.push("请选择金属种类");
  if (draft.gemId && draft.gemCount < 1) reasons.push("请选择配石数量");

  const metalHeld = draft.metalId ? Number(materials[draft.metalId] || 0) : 0;
  const gemHeld = draft.gemId ? Number(materials[draft.gemId] || 0) : 0;
  if (quote && draft.metalId && metalHeld < quote.metalAmount) reasons.push("金属库存不足");
  if (quote && draft.gemId && gemHeld < quote.gemCount) reasons.push("配石库存不足");
  if (quote && Number(cash || 0) < quote.laborFee) reasons.push("现金不足");
  if (!quote) reasons.push("当前方案无法报价");

  return {
    quote,
    reasons,
    canStart: reasons.length === 0,
    metalHeld,
    gemHeld,
    showMetalInventory: Boolean(draft.metalId),
    showGemInventory: Boolean(draft.gemId)
  };
}
