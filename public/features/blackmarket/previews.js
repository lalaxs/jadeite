// Warm only nearby stock, without mounting filtered SVGs on the plaza.
import { prepareMarketItemVisual } from "../../market-module.js";
import { bmUi, getActiveView, elsRef, bmStallById } from "./shared.js";
import { isSpecialGoods } from "./goods-display.js";

function prewarmBmGoodsCard(card) {
  if (!card || bmUi.section !== "plaza" || getActiveView() !== "blackmarket") return;
  const stall = bmStallById(card.dataset.payload);
  if (stall?.type !== "goods") return;
  const isCurrent = () => bmUi.section === "plaza" && getActiveView() === "blackmarket" && card.isConnected;
  // Warm the first row only. Large player stalls keep offscreen stock lazy.
  for (const row of (stall.items || []).slice(0, 6)) {
    if (!isSpecialGoods(row)) prepareMarketItemVisual(row.item, { priority: "background", isCurrent });
  }
}

export function prewarmBmVisibleStalls() {
  if (bmUi.section !== "plaza" || getActiveView() !== "blackmarket") return;
  const cards = elsRef.bmGrid.querySelectorAll('.bm-stall-card[data-action="openBmStallDetail"]');
  let count = 0;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight || !rect.width) continue;
    if (bmStallById(card.dataset.payload)?.type !== "goods") continue;
    prewarmBmGoodsCard(card);
    if (++count >= 4) break;
  }
}

export function bindBmPreviewPrewarming() {
  const warmTarget = (event) => {
    const card = event.target.closest?.('.bm-stall-card[data-action="openBmStallDetail"]');
    if (card && !card.contains(event.relatedTarget)) prewarmBmGoodsCard(card);
  };
  elsRef.bmGrid?.addEventListener("pointerover", warmTarget);
  elsRef.bmGrid?.addEventListener("focusin", warmTarget);
  let warmFrame = null;
  document.getElementById("mainStage")?.addEventListener("scroll", () => {
    if (warmFrame !== null || bmUi.section !== "plaza") return;
    warmFrame = requestAnimationFrame(() => { warmFrame = null; prewarmBmVisibleStalls(); });
  }, { passive: true });
}
