import { jadePieceFor, jadePieceSizeLabel } from "../shared/domain/jade/jade-piece.js";
import { componentJewelrySvg } from "./inlay-product-renderer.js";
import { openingProductSvg } from "./features/opening/opening-render.js";
import { escapeHtml } from "./shell/format-utils.js";
import { isBangle } from "../shared/domain/workshop/bangle-finish.js";

export function jadePiecePreviewMarkup(item, afterItem = item) {
  const piece = jadePieceFor(item);
  const finishedArt = afterItem.components?.length || piece
    ? componentJewelrySvg(afterItem, "compact", { viewMode: afterItem.components?.length ? "finished" : afterItem.polished ? "jade" : "original" })
    : openingProductSvg(afterItem, "compact");
  if (!finishedArt) return "";
  const jadeOnly = piece || afterItem.components?.length
    ? componentJewelrySvg(afterItem, "compact", { viewMode: "jade" }) : finishedArt;
  const intrinsic = piece?.intrinsic || item;
  const quality = typeof intrinsic.quality === "object" ? intrinsic.quality?.name : intrinsic.quality;
  const pieceId = piece?.id || item.id || "";
  return `<div class="jade-piece-preview" data-piece-id="${escapeHtml(pieceId)}">
    <div class="jade-piece-meta">
      <span>${escapeHtml(jadePieceSizeLabel(item))}</span>
      <span>${escapeHtml([quality, intrinsic.color].filter(Boolean).join(" · "))}</span>
    </div>
    ${isBangle(item) ? "" : '<label class="jade-compare-control"><input type="checkbox" data-jade-hide-mount>仅看玉件（隐藏配件）</label>'}
    <div class="jade-preview-panels">
      <figure><figcaption>加工效果</figcaption><div class="jade-preview-art" data-jade-assembled>${finishedArt}</div><div class="jade-preview-art" data-jade-only>${jadeOnly}</div></figure>
    </div>
  </div>`;
}
