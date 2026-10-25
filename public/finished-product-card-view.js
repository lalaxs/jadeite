import { buildInventoryItems } from "./inventory-module.js";
import { inventoryPreviewHtml } from "./inventory-preview.js";
import { materialStageForClient, materialStageLabel, typeName } from "./features/inventory-helpers.js";
import { inlaySummary } from "./product-meta.js";
import { productSizeBand, ORDER_SIZE_BANDS } from "./jade-rules.js";
import { jadePieceFor, jadePieceSizeLabel } from "../shared/domain/jade/jade-piece.js";

export function finishedProductCardEntry(product) {
  return buildInventoryItems({ me: { bracelets: [product] } }, { materialStageForClient, materialStageLabel, typeName })[0];
}

// Orders and livestream stock use the same preview and intrinsic product facts.
export function finishedProductCardContent(product, { escapeHtml, formatMoney, selectionHtml = "", renderProduct }) {
  const entry = finishedProductCardEntry(product);
  const size = ORDER_SIZE_BANDS[productSizeBand(product)]?.label;
  const quality = typeof product.quality === "object" ? product.quality?.name : product.quality;
  const specs = [quality, size ? `尺寸${size}` : "", jadePieceFor(product) ? jadePieceSizeLabel(product) : product.ringSize ? `${product.ringSize}圈口` : ""].filter(Boolean).join(" · ");
  const summary = inlaySummary(product);
  return `<span class="inventory-slot-visual"><span class="inventory-slot-badge">成品</span>${inventoryPreviewHtml(entry, { renderProduct })}${selectionHtml}</span>
    <span class="inventory-slot-copy">
      <span class="inventory-slot-name"><strong>${escapeHtml(product.name)}</strong></span>
      <span class="order-pick-spec">${escapeHtml(specs)}</span>
      ${summary ? `<span class="order-pick-craft">${escapeHtml(summary)}</span>` : ""}
      <span class="inventory-slot-value"><span>估值</span><strong>${formatMoney(entry.totalValue)}</strong></span>
    </span>`;
}
