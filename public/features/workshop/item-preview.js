// Shared workshop item preview markup and lazy-preview policy.
import { cutoutPreviewSignature } from "../../preview-bitmap-cache.js";
import { lazyPreviewMarkup } from "../../lazy-preview.js";

export function createWorkshopItemPreview({ helpers, ports }) {
  const { materialStageForClient, productCanvas, openingStoneSvg, openingKitsForRender, kitsFor } = helpers;
  const { isWorkshopLeftoverMaterial } = ports;

function isRoughLikeWorkshopItem(item) {
  const stage = materialStageForClient(item);
  return item?.type === "rough"
    || item?.type === "material"
    || stage === "rough"
    || stage === "opened";
}

function carvingPreviewKits(item) {
  // 历史已取件遮罩（余料黑洞）+ 本次 kitsFor 草稿一并绘制
  if (typeof openingKitsForRender !== "function" || !item) return [];
  return openingKitsForRender(item);
}

function workshopItemPreview(item, device = null, options = {}) {
  let inner;
  if (isRoughLikeWorkshopItem(item)) {
    const kits = device?.stage === "carving" ? carvingPreviewKits(item) : [];
    // 非规划工序选中余料时也要画出已扣件遮罩
    const previewKits = kits.length
      ? kits
      : (isWorkshopLeftoverMaterial(item) && typeof openingKitsForRender === "function"
        ? openingKitsForRender(item)
        : []);
    inner = `<div class="rough-output-preview compact">${openingStoneSvg(item, {
      revealed: materialStageForClient(item) !== "rough",
      kits: previewKits
    })}</div>`;
  } else {
    inner = `<div class="workshop-product-preview">${productCanvas(item, "compact")}</div>`;
  }
  if (options.lazy) {
    const stage = materialStageForClient(item);
    const draftSig = cutoutPreviewSignature(typeof kitsFor === "function" ? (kitsFor(item.id) || []) : []);
    const savedSig = cutoutPreviewSignature(item.extractionKits || item.braceletPlacements || []);
    return lazyPreviewMarkup(inner, {
      tint: item?.visual?.skin || item?.visual?.vein || "",
      cacheKey: `ws:${item.id}:${stage}:${draftSig}:${savedSig}:${item.leftover ? 1 : 0}`
    });
  }
  return inner;
}

  return { isRoughLikeWorkshopItem, carvingPreviewKits, workshopItemPreview };
}
