import { lazyPreviewMarkup } from "./lazy-preview.js";
import { cutoutPreviewSignature } from "./preview-bitmap-cache.js";
import { materialSwatchHtml } from "./inlay-product-renderer.js";

function isRoughLikeInventoryItem(entry, materialStageForClient) {
  const item = entry.item || {};
  const stage = entry.stage || materialStageForClient?.(item);
  return entry.category === "rough"
    || entry.source === "materials"
    || entry.source === "slices"
    || item.type === "rough"
    || item.type === "material"
    || item.type === "slice"
    || stage === "rough"
    || stage === "opened";
}

export function inventoryPreviewHtml(entry, {
  eager = false, size = "inventory", productCanvas, renderProduct = productCanvas,
  materialStageForClient, openingStoneSvg, openingKitsForRender, escapeHtml
} = {}) {
  if (entry.category === "external") {
    return materialSwatchHtml(entry.item, { escapeHtml });
  }
  // 原石、明料与片料走开料 SVG；取件后的毛坯、成品使用成品轮廓。
  let inner;
  let revealed = false;
  let kitsSig = 0;
  if (isRoughLikeInventoryItem(entry, materialStageForClient)) {
    revealed = (entry.stage || materialStageForClient?.(entry.item)) !== "rough";
    const kits = typeof openingKitsForRender === "function"
      ? openingKitsForRender(entry.item).filter((kit) => kit.extracted)
      : [];
    kitsSig = cutoutPreviewSignature(Array.isArray(kits) ? kits : []);
    inner = `<div class="inventory-rough-art">${openingStoneSvg(entry.item, { revealed, kits })}</div>`;
  } else {
    inner = renderProduct(entry.item, size);
  }
  const windows = Array.isArray(entry.item?.windows) ? entry.item.windows.length : 0;
  return lazyPreviewMarkup(inner, {
    eager,
    tint: entry.item?.visual?.skin || entry.item?.visual?.vein || "",
    cacheKey: `inv:${entry.id}:${entry.stage || ""}:${revealed ? 1 : 0}:${windows}:${kitsSig}:${entry.item?.jadePiece?.signature || ""}:${entry.item?.components?.length || 0}:${entry.item?.finish?.polishId || entry.item?.inlay?.polishId || ""}:${entry.item?.finish?.refinementId || ""}`
  });
}
