import { cutoutPreviewSignature, preparePreviewBitmap, getPreviewBitmap, previewBitmapImgMarkup } from "../preview-bitmap-cache.js";
import { isEquipmentItem, equipmentVisual } from "./equipment-view.js";
import { lazyPreviewMarkup } from "../lazy-preview.js";
import { productQualityMeta, productGemColor } from "./product-catalog.js";

export function createProductView({ getDocument, helpers, isCurrent = () => true }) {
  const { formatMoney, escapeHtml, typeName, productCanvas, openingStoneSvg, openingKitsForRender, jadeCanvasMarkup } = helpers;

function openingKitsForItemVisual(item) {
  if (typeof openingKitsForRender !== "function" || !item) return [];
  try {
    const kits = openingKitsForRender(item);
    return Array.isArray(kits) ? kits : [];
  } catch {
    return [];
  }
}

function itemPreviewKey(item = {}) {
  return JSON.stringify([
    "mkt-v2", item.id, item.name, item.materialStage || item.stage || "rough", item.type, item._type,
    item.kind, item.productType, item.size, item.ringSize, item.qualityKey, item.quality, item.color,
    item.openingSeed, item.visual, item.sourceMaterial, item.jadePiece?.signature,
    item.polished, item.finish, item.inlay, item.components, item.revealed, item.windows,
    cutoutPreviewSignature(openingKitsForItemVisual(item))
  ]);
}

function prepareItemVisual(item, options = {}) {
  const key = itemPreviewKey(item);
  return preparePreviewBitmap(key, () => {
    const template = getDocument().createElement("template");
    template.innerHTML = itemVisual(item, { eager: true });
    // Legacy canvases need the connected renderer; an unpainted canvas would
    // otherwise become a permanently blank cached product.
    return template.content.querySelector("svg") ? template.content : null;
  }, { ...options, isCurrent: () => isCurrent() && (!options.isCurrent || options.isCurrent()) && itemPreviewKey(item) === key });
}

function itemVisual(item = {}, options = {}) {
  if (isEquipmentItem(item)) return equipmentVisual(item, escapeHtml);
  const eager = options.eager || options.lazy === false;
  const cacheKey = eager ? "" : itemPreviewKey(item);
  const cached = cacheKey && getPreviewBitmap(cacheKey);
  if (cached) return previewBitmapImgMarkup(cached);
  const stage = item.materialStage || item.stage || "rough";
  const isSlice = item.type === "slice" || item._type === "slice";
  const isStoneLike = isSlice || (
    stage === "rough"
    || stage === "opened"
    || stage === "material"
    || item.type === "material"
    || item._type === "material"
  );
  let inner;
  try {
    if (isStoneLike && openingStoneSvg) {
      const revealed = isSlice || stage === "opened"
        || stage === "material"
        || item.type === "material"
        || item._type === "material"
        || Boolean(item.revealed || (item.windows && item.windows.length));
      const kits = openingKitsForItemVisual(item);
      inner = openingStoneSvg(item, { revealed, kits });
    } else {
      inner = productCanvas ? productCanvas(item, "inventory") : "";
    }
  } catch (e) {
    inner = "";
  }
  const visual = inner || `<div class="jm-gem ${productGemColor(item)}"></div>`;
  const wrapped = `<div class="jm-visual">${visual}</div>`;
  if (eager) return wrapped;
  return lazyPreviewMarkup(wrapped, {
    tint: item?.visual?.skin || item?.visual?.vein || "",
    cacheKey,
    bitmapOnly: options.bitmapOnly
  });
}

function itemStageLabel(item = {}, listingType = "") {
  const stage = item.materialStage || item.stage || "rough";
  const revealed = Boolean(item.revealed || (item.windows && item.windows.length));
  if (stage === "rough" && !revealed) return "暗料原石 · 未开窗";
  if (stage === "rough" && revealed) return "原石 · 已开窗";
  if (stage === "opened" || listingType === "material") return "明料 · 已开窗";
  return typeName(listingType || item._type || item.type, item);
}

function itemAttributeChips(item = {}, listingType = "", profile = null) {
  const stageChip = `<span class="jm-chip jm-chip-stage">${escapeHtml(itemStageLabel(item, listingType))}</span>`;
  if (profile?.sealed) {
    const hint = String(item.publicHint || item.hint || "").trim();
    const mass = Number(item.mass);
    const massChip = Number.isFinite(mass) && mass > 0
      ? `<span class="jm-chip">${mass.toFixed(2)} kg</span>`
      : "";
    const hintChip = hint ? `<span class="jm-chip jm-chip-hint" title="${escapeHtml(hint)}">${escapeHtml(hint)}</span>` : "";
    return `<div class="jm-chips">${stageChip}${hintChip}${massChip}</div>`;
  }
  const q = productQualityMeta(item);
  const qLabel = escapeHtml(item.quality || q.name);
  const color = item.color ? `<span class="jm-chip">${escapeHtml(item.color)}</span>` : "";
  return `<div class="jm-chips">${stageChip}<span class="jm-chip jm-chip-q">${qLabel} ${q.stars}</span>${color}</div>`;
}

function itemProfile(item = {}, profile = null) {
  if (!profile) return "";
  if (profile.sealed) {
    return `<div class="jm-sealed-note is-compact">暗料 · 种水未揭露</div>`;
  }
  const defects = [];
  if (profile.wastePct > 0) defects.push(`<span class="jm-defect waste">废料 ${profile.wastePct}%</span>`);
  if (profile.crackPct > 0) defects.push(`<span class="jm-defect crack">裂 ${profile.crackPct}%</span>`);
  if (!defects.length) return "";
  return `<div class="jm-profile-defects">${defects.join("")}</div>`;
}

function materialProfileChips(profile) {
  if (!profile) return "";
  if (profile.sealed) {
    return `<div class="jm-sealed-note">暗料 · 种水与颜色未揭露</div>`;
  }
  const rows = (segs) => segs.map((s) => `<span class="jm-pchip"><i style="background:${s.color}"></i>${escapeHtml(s.name)} ${s.pct}%</span>`).join("");
  const defects = [];
  if (profile.wastePct > 0) defects.push(`<span class="jm-defect waste">废料 ${profile.wastePct}%</span>`);
  if (profile.crackPct > 0) defects.push(`<span class="jm-defect crack">裂 ${profile.crackPct}%</span>`);
  return `
    <div class="jm-profile">
      <div class="jm-profile-row">
        <span class="jm-profile-label">种水分布</span>
        <div class="jm-chips-line">${rows(profile.waters)}</div>
      </div>
      <div class="jm-profile-row">
        <span class="jm-profile-label">颜色分布</span>
        <div class="jm-chips-line">${rows(profile.colors)}</div>
      </div>
      ${defects.length ? `<div class="jm-profile-defects">${defects.join("")}</div>` : ""}
    </div>`;
}

function priceDelta(price, ref) {
  const diff = Number(price) - Number(ref || 0);
  if (!ref) return { cls: "flat", txt: "无参考价" };
  if (diff < -1) return { cls: "down", txt: `↓ 便宜 ${formatMoney(-diff)}` };
  if (diff > ref * 0.08) return { cls: "up", txt: `↑ 偏贵 ${formatMoney(diff)}` };
  return { cls: "flat", txt: "接近参考价" };
}

function listingItemVisual(item) {
  if (isEquipmentItem(item)) return equipmentVisual(item, escapeHtml);
  const stage = item.materialStage || item.stage || "rough";
  const isSlice = item.type === "slice" || item._type === "slice";
  const isStoneLike = isSlice || (
    stage === "rough"
    || stage === "opened"
    || stage === "material"
    || item.type === "material"
    || item._type === "material"
  );
  // 暗料/明料与库存一致：走开料 SVG（明料 revealed），并带上已取件遮罩（余料黑洞）
  if (isStoneLike) {
    const revealed = isSlice || stage === "opened"
      || stage === "material"
      || item.type === "material"
      || item._type === "material"
      || Boolean(item.revealed || (item.windows && item.windows.length));
    const kits = openingKitsForItemVisual(item);
    return openingStoneSvg
      ? openingStoneSvg(item, { revealed, kits })
      : `<div class="jm-gem ${productGemColor(item)}"></div>`;
  }
  // 挂牌弹窗左侧小卡片：不要 productCutoutPlaceholder 的默认套件虚线圈，
  // 对无具体器型的阶段产物直接画料子本体；成品仍用 productCanvas 保持套件形状。
  const hasKind = Boolean(item.kind || item.layout || item.templateSize);
  if (!hasKind && jadeCanvasMarkup) {
    return jadeCanvasMarkup("rough", item, "inventory");
  }
  return productCanvas ? productCanvas(item, "inventory") : `<div class="jm-gem ${productGemColor(item)}"></div>`;
}

  return { openingKitsForItemVisual, itemPreviewKey, prepareItemVisual, itemVisual, itemStageLabel, itemAttributeChips, itemProfile, materialProfileChips, priceDelta, listingItemVisual };
}
