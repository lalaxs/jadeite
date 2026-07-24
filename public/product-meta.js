export function inlaySummary(product) {
  const inlay = product?.inlay;
  if (!inlay) return "";
  const gem = Number(inlay.gemCount) > 0
    ? `${inlay.gemName}×${inlay.gemCount}`
    : "无配石";
  return [
    inlay.productTypeName,
    inlay.settingName,
    inlay.metalName || "无金属",
    gem,
    inlay.polishName,
    inlay.backingName
  ].filter(Boolean).join(" · ");
}

function finiteMetadataNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function resolveExactOpeningProductPlacement(source, options = {}) {
  if (!source?.visual || typeof source.visual !== "object") return null;
  const placement = source.placement;
  if (!placement || typeof placement !== "object") return null;

  const validTemplateIds = options.validTemplateIds instanceof Set
    ? options.validTemplateIds
    : new Set(options.validTemplateIds || []);
  const explicitTemplate = validTemplateIds.has(placement.openingTpl) ? placement.openingTpl : null;
  const mappedTemplate = options.templateByKitType?.[placement.kitType];
  const openingTpl = explicitTemplate || (validTemplateIds.has(mappedTemplate) ? mappedTemplate : null);
  const x = finiteMetadataNumber(placement.x);
  const y = finiteMetadataNumber(placement.y);
  const scale = finiteMetadataNumber(placement.scale);
  if (!openingTpl || x === null || y === null || scale === null || scale <= 0) return null;

  return {
    ...placement,
    openingTpl,
    x,
    y,
    scale
  };
}
