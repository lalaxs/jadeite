import { isBangle, bangleRingSize, bangleFinishRecord } from "../workshop/bangle-finish.js";

export function inlaySummary(product) {
  if (isBangle(product)) {
    const finish = bangleFinishRecord(product);
    if (!finish) return "";
    const ring = bangleRingSize(product);
    return ["手镯", ring ? `${ring}圈口` : null, finish.refinementName, finish.polishName,
      product.craftGrade ? `工艺${product.craftGrade}级` : null].filter(Boolean).join(" · ");
  }
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

export function resolveSourceMaterialPlacement(source) {
  const placement = source?.placement;
  if (!placement || typeof placement !== "object") return null;
  // Early debug stock labelled a percentage centre (50, 50) as SVG pixels.
  // Repair only that known record shape; real extraction coordinates and
  // immutable jadePiece snapshots must keep their exact material sample.
  if (source.roughId === "debug-rough" && placement.svgSpace === true
    && Number(placement.x) === 50 && Number(placement.y) === 50) {
    return { ...placement, x: 300, y: 300 };
  }
  return placement;
}

export function resolveExactOpeningProductPlacement(source, options = {}) {
  if (!source?.visual || typeof source.visual !== "object") return null;
  const placement = resolveSourceMaterialPlacement(source);
  if (!placement) return null;

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
