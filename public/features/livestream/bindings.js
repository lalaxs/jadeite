import { LIVESTREAM_MAX_ITEMS as MAX_ROOM_ITEMS } from "../../livestream-rules.js";

export function createLivestreamBindings({ elsRef, scope, ui, helpers, ports }) {
  const { selectedProductIds, priceDrafts } = ui;
  const { finishedProducts, showToast } = helpers;
  const { visibleStockProducts, moveSlide, selectSlide, applySelectAll, enterHallRoom, setLivestreamTab, applyPricePreset, emitStart, emitReplenish, emitClose, emitBuy, syncSelectionControls, renderLivestream } = ports;

function bindLivestreamOnce() {
  if (!elsRef.livestream || ui.boundRoot === elsRef.livestream) return;
  ui.boundRoot = elsRef.livestream;
  scope.listen(ui.boundRoot, "change", (event) => {
    const stockFilter = event.target.closest("[data-livestream-stock-filter]");
    const stockSort = event.target.closest("[data-livestream-stock-sort]");
    if (stockFilter || stockSort) {
      if (stockFilter) ui.stockPickerFilter = stockFilter.value || "all";
      if (stockSort) ui.stockPickerSort = stockSort.value || "valueDesc";
      ui.lastLivestreamRenderFp = "";
      renderLivestream();
      return;
    }
    const selectAll = event.target.closest("[data-livestream-select-all]");
    if (selectAll) {
      const picker = selectAll.closest(".livestream-stock-picker");
      const capacity = Math.max(0, Number(picker?.dataset?.capacity || MAX_ROOM_ITEMS));
      applySelectAll(visibleStockProducts(finishedProducts()), capacity, selectAll.checked);
      syncSelectionControls();
      return;
    }
    const checkbox = event.target.closest("[data-livestream-select]");
    if (!checkbox) return;
    const productId = checkbox.dataset.livestreamSelect;
    if (checkbox.checked) selectedProductIds.add(productId);
    else selectedProductIds.delete(productId);
    syncSelectionControls();
  });
  scope.listen(ui.boundRoot, "input", (event) => {
    const search = event.target.closest("[data-livestream-stock-search]");
    if (search) {
      ui.stockPickerQuery = search.value;
      const cursor = search.selectionStart;
      ui.lastLivestreamRenderFp = "";
      renderLivestream();
      const next = elsRef.livestream?.querySelector("[data-livestream-stock-search]");
      next?.focus?.();
      if (next && cursor != null) next.setSelectionRange?.(cursor, cursor);
      return;
    }
    const input = event.target.closest("[data-livestream-price]");
    if (!input) return;
    priceDrafts.set(input.dataset.livestreamPrice, Number(input.value));
    syncSelectionControls();
  });
  scope.listen(ui.boundRoot, "wheel", (event) => {
    const scroller = event.target.closest("[data-livestream-shelf-scroll]");
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) return;
    // 竖向滚轮转到横向，方便货盘滑动
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    if (!delta) return;
    const before = scroller.scrollLeft;
    scroller.scrollLeft += delta;
    if (scroller.scrollLeft !== before) event.preventDefault();
  }, { passive: false });

  let shelfDrag = null;
  const endShelfDrag = () => {
    if (!shelfDrag) return;
    const { scroller, pointerId, moved } = shelfDrag;
    shelfDrag = null;
    scroller.classList.remove("is-dragging");
    try { scroller.releasePointerCapture?.(pointerId); } catch (_) { /* ignore */ }
    if (moved) {
      const suppress = (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        stopSuppress();
      };
      const stopSuppress = scope.listen(scroller, "click", suppress, true);
      scope.setTimeout(stopSuppress, 0);
    }
  };
  scope.addCleanup(() => {
    if (!shelfDrag) return;
    const { scroller, pointerId } = shelfDrag;
    shelfDrag = null;
    scroller.classList.remove("is-dragging");
    try { scroller.releasePointerCapture?.(pointerId); } catch (_) { /* ignore */ }
  });
  scope.listen(ui.boundRoot, "pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    const scroller = event.target.closest("[data-livestream-shelf-scroll]");
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) return;
    shelfDrag = {
      scroller,
      pointerId: event.pointerId,
      startX: event.clientX,
      startLeft: scroller.scrollLeft,
      moved: false
    };
    scroller.classList.add("is-dragging");
    try { scroller.setPointerCapture?.(event.pointerId); } catch (_) { /* ignore */ }
  });
  scope.listen(ui.boundRoot, "pointermove", (event) => {
    if (!shelfDrag || shelfDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - shelfDrag.startX;
    if (Math.abs(dx) > 3) shelfDrag.moved = true;
    shelfDrag.scroller.scrollLeft = shelfDrag.startLeft - dx;
    if (shelfDrag.moved) event.preventDefault();
  });
  scope.listen(ui.boundRoot, "pointerup", endShelfDrag);
  scope.listen(ui.boundRoot, "pointercancel", endShelfDrag);

  scope.listen(ui.boundRoot, "keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-livestream-action='enter-hall-room']");
    if (!card || event.target !== card) return;
    event.preventDefault();
    card.click();
  });

  scope.listen(ui.boundRoot, "click", (event) => {
    const stockRow = event.target.closest(".livestream-stock-row");
    if (stockRow) {
      const checkbox = stockRow.querySelector("[data-livestream-select]");
      const productId = checkbox?.dataset?.livestreamSelect;
      const picker = stockRow.closest("[data-capacity]");
      const capacity = Math.max(0, Number(picker?.dataset?.capacity || MAX_ROOM_ITEMS));
      // 已满档时 checkbox 为 disabled，点击无 change；在此补飘字提示
      if (checkbox?.disabled && productId && !selectedProductIds.has(productId)) {
        event.preventDefault();
        showToast?.({
          text: capacity > 0
            ? `已选满 ${capacity} 件，无法继续添加`
            : "货盘已满，无法继续添加",
          tone: "warn"
        });
        return;
      }
    }
    const tabBtn = event.target.closest("[data-livestream-tab]");
    if (tabBtn) {
      setLivestreamTab(tabBtn.dataset.livestreamTab);
      return;
    }
    const sortBtn = event.target.closest("[data-hall-sort]");
    if (sortBtn) {
      ui.hallSort = sortBtn.dataset.hallSort || "newest";
      renderLivestream();
      return;
    }
    const button = event.target.closest("[data-livestream-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.livestreamAction;
    if (action === "goto-mine-tab") {
      setLivestreamTab("mine");
      return;
    }
    if (action === "enter-hall-room") {
      enterHallRoom(button.dataset.roomId, button.dataset.ownerId || "");
      return;
    }
    if (action === "goto-hall-tab") {
      setLivestreamTab("hall");
      return;
    }
    if (action === "previous") moveSlide(button.dataset.roomId, -1);
    if (action === "next") moveSlide(button.dataset.roomId, 1);
    if (action === "select-slide") selectSlide(button.dataset.roomId, button.dataset.slideIndex);
    if (action === "select-host") {
      ui.draftHostId = button.dataset.workerId || null;
      renderLivestream();
      return;
    }
    if (action === "clear-host") {
      ui.draftHostId = null;
      renderLivestream();
      return;
    }
    if (action === "open-host-modal") {
      ui.modalHostId = ui.draftHostId;
      ui.hostModalOpen = true;
      renderLivestream();
      return;
    }
    if (action === "close-host-modal") {
      ui.hostModalOpen = false;
      ui.modalHostId = null;
      renderLivestream();
      return;
    }
    if (action === "select-modal-host") {
      ui.modalHostId = button.dataset.workerId || null;
      renderLivestream();
      return;
    }
    if (action === "clear-modal-host") {
      ui.modalHostId = null;
      renderLivestream();
      return;
    }
    if (action === "confirm-host-modal") {
      ui.draftHostId = ui.modalHostId;
      ui.hostModalOpen = false;
      ui.modalHostId = null;
      renderLivestream();
      return;
    }
    if (action === "toggle-host-details") {
      ui.hostDetailsOpen = !ui.hostDetailsOpen;
      renderLivestream();
      return;
    }
    if (action === "price-preset") {
      applyPricePreset(button.dataset.priceMult);
      return;
    }
    if (action === "open-replenish-modal") {
      ui.replenishOpen = true;
      renderLivestream();
      return;
    }
    if (action === "close-replenish-modal") {
      ui.replenishOpen = false;
      selectedProductIds.clear();
      renderLivestream();
      return;
    }
    if (action === "start") emitStart();
    if (action === "replenish") emitReplenish();
    if (action === "close") {
      ui.closeConfirmOpen = true;
      renderLivestream();
      return;
    }
    if (action === "cancel-close") {
      ui.closeConfirmOpen = false;
      renderLivestream();
      return;
    }
    if (action === "confirm-close") emitClose();
    if (action === "buy") {
      ui.buyConfirm = { roomId: button.dataset.roomId, itemId: button.dataset.itemId };
      renderLivestream();
      return;
    }
    if (action === "cancel-buy") {
      ui.buyConfirm = null;
      renderLivestream();
      return;
    }
    if (action === "confirm-buy") emitBuy(button.dataset.roomId, button.dataset.itemId);
  });
}

  return { bindLivestreamOnce };
}
