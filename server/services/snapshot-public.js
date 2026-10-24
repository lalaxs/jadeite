/**
 * Public item serializers — strip private fields (trueQuality, bestAngle, etc.)
 * for client snapshots. Pure; no world state.
 */

export function publicWindowReveal(win = {}) {
  const safe = {};
  for (const field of ["id", "x", "y", "r", "seed", "skin", "vein", "hasBelt", "hasCrack"]) {
    if (win[field] !== undefined) safe[field] = win[field];
  }
  return safe;
}

export function publicSourceVisual(visual = {}) {
  const safe = {};
  for (const field of ["seed", "shape", "skin", "vein", "belt", "beltAngle", "crack", "crackAngle", "grain"]) {
    if (visual[field] !== undefined) safe[field] = visual[field];
  }
  return safe;
}

export function publicSourceMaterial(sourceMaterial = {}) {
  if (!sourceMaterial || typeof sourceMaterial !== "object") return sourceMaterial;
  const safe = {};
  for (const field of ["roughId", "roughName", "placement", "templateSize", "mass", "qualityKey", "color", "openingEval"]) {
    if (sourceMaterial[field] !== undefined) safe[field] = sourceMaterial[field];
  }
  if (Array.isArray(sourceMaterial.windows)) safe.windows = sourceMaterial.windows.map(publicWindowReveal);
  if (sourceMaterial.visual && typeof sourceMaterial.visual === "object") safe.visual = publicSourceVisual(sourceMaterial.visual);
  return safe;
}

export function publicStone(item, options = {}) {
  if (!item || typeof item !== "object") return item;
  const { trueQualityKey, trueValue, imperialChanceMultiplier, visual, tradeHistory,
    costBasis, financeBatchId, financeOwnerId, financeParentItemId, financeServiceCost, ...safeItem } = item;
  if (options?.privateFinance === true) {
    for (const field of ["costBasis", "financeBatchId", "financeOwnerId", "financeParentItemId"]) {
      if (item[field] !== undefined) safeItem[field] = structuredClone(item[field]);
    }
  }
  if (Array.isArray(safeItem.windows)) safeItem.windows = safeItem.windows.map(publicWindowReveal);
  if (safeItem.sourceMaterial) safeItem.sourceMaterial = publicSourceMaterial(safeItem.sourceMaterial);
  const isRough = item.type === "rough" || Boolean(item.trueQualityKey);
  if (isRough && !item.revealed) {
    const rawWindows = item.windows ?? visual?.windows;
    const windows = Array.isArray(rawWindows) ? rawWindows.map(publicWindowReveal) : [];
    safeItem.windows = windows;
    safeItem.hint = item.publicHint || `${item.name} · 只见皮壳轮廓`;
    safeItem.visual = {
      seed: visual?.seed,
      shape: visual?.shape,
      masked: true,
      maskTone: visual?.skinRoughness > 0.72 ? "#343936" : "#5b5f59",
      windows
    };
    return safeItem;
  }
  if (visual) {
    const { bestAngle, ...safeVisual } = visual;
    if (Array.isArray(safeVisual.windows)) safeVisual.windows = safeVisual.windows.map(publicWindowReveal);
    safeItem.visual = safeVisual;
  }
  return safeItem;
}

export function publicListing(listing) {
  return {
    ...listing,
    item: publicStone(listing.item)
  };
}

export function publicWantOffer(offer) {
  return {
    ...offer,
    item: publicStone(offer.item)
  };
}

export function publicWant(want) {
  return {
    ...want,
    offers: (want.offers || []).map(publicWantOffer)
  };
}

export function publicProductionJob(job, options = {}) {
  const { item, rough, ...safeJob } = job;
  if (item) safeJob.item = publicStone(item, options);
  if (rough) safeJob.rough = publicStone(rough, options);
  return safeJob;
}

export function publicLivestreamJob(job, options = {}) {
  const { product, ...safeJob } = job;
  if (product) safeJob.product = publicStone(product, options);
  return safeJob;
}
