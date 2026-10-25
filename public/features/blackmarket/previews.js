

export function createBlackmarketPreviews({ document, window, scope, ui, bmUi, getActiveView, elsRef, ports, productView }) {
  const { bmStallById, isSpecialGoods } = ports;
  const { prepareItemVisual } = productView;

function prewarmBmGoodsCard(card) {
  if (!card || bmUi.section !== "plaza" || getActiveView() !== "blackmarket") return;
  const stall = bmStallById(card.dataset.payload);
  if (stall?.type !== "goods") return;
  const isCurrent = () => bmUi.section === "plaza" && getActiveView() === "blackmarket" && card.isConnected;
  // Warm the first row only. Large player stalls keep offscreen stock lazy.
  for (const row of (stall.items || []).slice(0, 6)) {
    if (!isSpecialGoods(row)) prepareItemVisual(row.item, { priority: "background", isCurrent });
  }
}

function prewarmBmVisibleStalls() {
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

function bindBmPreviewPrewarming() {
  if (!scope.active || ui.previewPrewarmingBound) return;
  ui.previewPrewarmingBound = true;
  const warmTarget = (event) => {
    const card = event.target.closest?.('.bm-stall-card[data-action="openBmStallDetail"]');
    if (card && !card.contains(event.relatedTarget)) prewarmBmGoodsCard(card);
  };
  scope.listen(elsRef.bmGrid, "pointerover", warmTarget);
  scope.listen(elsRef.bmGrid, "focusin", warmTarget);
  let warmFrame = null;
  scope.listen(document.getElementById("mainStage"), "scroll", () => {
    if (warmFrame !== null || bmUi.section !== "plaza") return;
    warmFrame = scope.requestAnimationFrame(() => { warmFrame = null; prewarmBmVisibleStalls(); });
  }, { passive: true });
}

  return { prewarmBmVisibleStalls, bindBmPreviewPrewarming };
}
