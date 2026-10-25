import { LIVESTREAM_MAX_ITEMS as MAX_ROOM_ITEMS, LIVESTREAM_MIN_PRICE, LIVESTREAM_MIN_ITEMS as MIN_ROOM_ITEMS } from "../../livestream-rules.js";
import { employeePayrollStatus } from "../../worker-economy.js";
import { nowMs as payrollNowMs } from "../../shell/format-utils.js";
import { payrollWorkNotice } from "../../payroll-work-notice.js";
import { HALL_SORTS, sortHallRooms, trimLivestreamSelection } from "./catalog.js";

export function createLivestreamView({ getState, elsRef, observeLazyPreviews, ui, helpers, ports }) {
  const { selectedProductIds, priceDrafts, shelfScrollByRoom } = ui;
  const { finishedProducts, formatMoney, escapeHtml, paintProductCanvases } = helpers;
  const { roomForId, availableHosts, resolveSelectedHost, selectionSummary, visibleStockProducts, pruneChatFeeds, captureChatScroll, restoreChatScroll, startWizardMarkup, ownerDashboardMarkup, visitorRoomCardMarkup, visitorWatchMarkup, tabsMarkup, mineEntryCardMarkup, captureShelfScroll, restoreShelfScroll, capturePreservedShelves, restorePreservedShelves, reconcileSelection, clearWatchingRoom } = ports;

function syncSelectionControls() {
  const picker = elsRef.livestream?.querySelector(".livestream-stock-picker:not(.is-empty)");
  if (!picker) return;
  const isStart = picker.dataset.pickerMode === "start";
  const capacity = Math.max(0, Number(picker.dataset.capacity || MAX_ROOM_ITEMS));
  trimLivestreamSelection(selectedProductIds, capacity);
  const selected = [...selectedProductIds];
  const validPrices = selected.every((productId) => {
    const price = Number(priceDrafts.get(productId));
    return Number.isInteger(price) && price >= LIVESTREAM_MIN_PRICE;
  });
  const minimum = isStart ? MIN_ROOM_ITEMS : 1;
  const canSubmit = selected.length >= minimum && selected.length <= capacity && validPrices;
  const count = picker.querySelector("[data-livestream-selected-count]");
  if (count) count.textContent = `${selected.length}/${capacity}`;

  const products = finishedProducts();
  const summary = selectionSummary(products);
  const summaryEl = picker.querySelector(".livestream-stock-summary span");
  if (summaryEl) {
    summaryEl.innerHTML = `${summary.count} 件 · 总标价 <b>${formatMoney(summary.totalPrice)}</b> · 均价相对估值 ${escapeHtml(summary.pctLabel)}`;
  }

  picker.querySelectorAll(".livestream-stock-row, .livestream-stock-card").forEach((card) => {
    const productId = card.dataset.productId;
    const isSelected = selectedProductIds.has(productId);
    const checkbox = card.querySelector("[data-livestream-select]");
    card.classList.toggle("is-selected", isSelected);
    if (checkbox) {
      checkbox.checked = isSelected;
      checkbox.disabled = !isSelected && selected.length >= capacity;
    }
  });

  const selectAll = picker.querySelector("[data-livestream-select-all]");
  if (selectAll) {
    const selectable = visibleStockProducts(products).slice(0, capacity);
    const allOn = selectable.length > 0
      && selectable.every((item) => selectedProductIds.has(item.id));
    selectAll.checked = allOn;
    selectAll.closest(".livestream-select-all")?.classList.toggle("is-checked", allOn);
  }

  if (isStart) {
    const startBtn = picker.querySelector('[data-livestream-action="start"]');
    if (startBtn) {
      startBtn.disabled = !canSubmit;
      startBtn.textContent = canSubmit ? `开启直播（${selected.length} 件）` : "至少选择 3 件";
    }
    return;
  }

  const button = picker.querySelector('[data-livestream-action="replenish"]');
  if (button) {
    button.disabled = !canSubmit;
    button.textContent = canSubmit ? `确认补货（${selected.length} 件）` : "选择要补货的成品";
  }
}

function renderLivestream() {
  const state = getState();
  if (!state?.me || !elsRef.livestream) return;
  const products = finishedProducts();
  const myRoom = state.me.livestreamRoom;
  const capacity = myRoom ? Math.max(0, MAX_ROOM_ITEMS - myRoom.items.length) : MAX_ROOM_ITEMS;
  if (myRoom) {
    if (capacity <= 0) ui.replenishOpen = false;
  } else {
    ui.replenishOpen = false;
    ui.closeConfirmOpen = false;
  }
  const hallRoomMap = new Map();
  for (const room of state.livestreamRooms || []) {
    if (room?.id) hallRoomMap.set(room.id, room);
  }
  // 自己的房间以 me.livestreamRoom 为准，确保开播后一定出现在大厅列表
  if (myRoom?.id) hallRoomMap.set(myRoom.id, myRoom);
  const publicRooms = sortHallRooms([...hallRoomMap.values()], ui.hallSort);
  let watchedRoom = ui.watchingRoomId ? hallRoomMap.get(ui.watchingRoomId) || roomForId(ui.watchingRoomId) : null;
  if (ui.watchingRoomId && !watchedRoom) {
    clearWatchingRoom();
    watchedRoom = null;
  }
  const hasPermit = Boolean(state.me.assets?.livestreamPermitOwned);
  reconcileSelection(products, capacity);
  const hosts = availableHosts();
  const selectedHost = resolveSelectedHost();
  const fp = [
    hasPermit ? 1 : 0,
    employeePayrollStatus(state.me, payrollNowMs()), state.me.employeePayroll?.debt || 0,
    ui.activeLivestreamTab,
    ui.watchingRoomId || "",
    ui.draftHostId || "",
    ui.modalHostId || "",
    ui.hostModalOpen ? 1 : 0,
    ui.draftTalkStyle,
    ui.hostDetailsOpen ? 1 : 0,
    ui.replenishOpen ? 1 : 0,
    ui.closeConfirmOpen ? 1 : 0,
    ui.hallSort,
    ui.stockPickerQuery,
    ui.stockPickerFilter,
    ui.stockPickerSort,
    ui.buyConfirm ? `${ui.buyConfirm.roomId}:${ui.buyConfirm.itemId}` : "",
    [...selectedProductIds].join(","),
    [...priceDrafts.entries()].map(([id, price]) => `${id}:${price}`).join("|"),
    products.map((item) => `${item.id}:${item.value ?? item.price ?? ""}`).join("|"),
    JSON.stringify(state.me.systemDemand || {}),
    myRoom
      ? `${myRoom.id}:${(myRoom.items || []).map((item) => `${item.id}:${item.price ?? ""}`).join(",")}:${myRoom.totalSales}:${myRoom.likes}:${myRoom.nextAiVisitAt || ""}:${myRoom.endsAt || ""}:${myRoom.hardEndsAt || ""}:${(myRoom.sales || []).map((s) => s.id).join(",")}`
      : "",
    publicRooms.map((room) => `${room.id}:${room.ownerId}:${(room.items || []).length}:${room.hostName || ""}:${room.likes}:${room.totalSales}:${(room.sales || []).map((s) => s.id || s.soldAt || "").join(",")}`).join("|"),
    watchedRoom
      ? `${watchedRoom.id}:${(watchedRoom.items || []).map((item) => `${item.id}:${item.price ?? ""}`).join(",")}:${watchedRoom.totalSales}:${watchedRoom.likes}`
      : "",
    (state.me.livestreamHistory || []).length,
    hosts.map((host) => `${host.id}:${host.busy ? 1 : 0}`).join(",")
  ].join("::");
  if (fp === ui.lastLivestreamRenderFp && elsRef.livestream.childElementCount) {
    syncSelectionControls();
    return;
  }
  ui.lastLivestreamRenderFp = fp;
  captureChatScroll();
  captureShelfScroll();
  const preservedShelves = capturePreservedShelves();
  pruneChatFeeds([
    myRoom?.id,
    ...publicRooms.map((room) => room.id)
  ].filter(Boolean));
  for (const id of [...shelfScrollByRoom.keys()]) {
    if (id !== myRoom?.id && !publicRooms.some((room) => room.id === id)) {
      shelfScrollByRoom.delete(id);
    }
  }

  const ownerSection = myRoom
    ? `
      <section class="livestream-owner-section">
        <div class="livestream-section-title">
          <div><p class="eyebrow">我的摊位</p><h3>本场营业中</h3></div>
        </div>
        ${ownerDashboardMarkup(myRoom, products, capacity)}
        <button type="button" class="ghost livestream-switch-tab"
          data-livestream-action="goto-hall-tab">去翡翠街看看别人</button>
      </section>
    `
    : hasPermit
      ? `
      <section class="livestream-owner-section" id="livestream-owner-wizard">
        ${startWizardMarkup(hosts, selectedHost, products)}
      </section>
      `
      : `
      <section class="livestream-locked-panel">
        <span class="livestream-live-badge"><i></i> LOCKED</span>
        <h3>还不能开启自己的直播间</h3>
        <p>购买经营许可后，可选 ${MIN_ROOM_ITEMS}–${MAX_ROOM_ITEMS} 件成品开播，主播可稍后安排；逛直播间和购买商品无需许可。</p>
        <button type="button" data-view-link="shop">前往商铺</button>
      </section>
    `;

  const hallSection = `
    <section class="livestream-hall-section">
      <div class="livestream-section-title">
        <div><p class="eyebrow">翡翠街摊位</p><h3>营业中的房间</h3></div>
      </div>
      ${mineEntryCardMarkup({ live: Boolean(myRoom), myRoom })}
      <div class="livestream-hall-toolbar">
        <div class="livestream-hall-sort" role="group" aria-label="大厅排序">
          ${HALL_SORTS.map((entry) => `
            <button type="button" class="${ui.hallSort === entry.id ? "is-active" : ""}"
              data-hall-sort="${entry.id}">${escapeHtml(entry.label)}</button>
          `).join("")}
        </div>
        <span class="livestream-hall-count">${publicRooms.length} 个直播间营业中</span>
      </div>
      <div class="livestream-room-grid">
        ${publicRooms.length
          ? publicRooms.map((room) => visitorRoomCardMarkup(room)).join("")
          : `
            <div class="livestream-hall-empty game-empty-state">
              <span class="game-empty-state-mark" aria-hidden="true">播</span>
              <strong>暂时没有其他直播间营业</strong>
              <p>${myRoom
                ? "你的房间正在营业，可以回到本场摊位查看轮播和成交。"
                : hasPermit
                  ? `准备至少 ${MIN_ROOM_ITEMS} 件成品后，就能开设自己的直播间。`
                  : "逛直播无需许可；若想自己开播，可以先到商铺购买经营许可。"}</p>
              ${myRoom
                ? '<button type="button" data-livestream-action="goto-mine-tab">回到我的摊位</button>'
                : hasPermit
                  ? '<button type="button" data-livestream-action="goto-mine-tab">去准备开播</button>'
                  : '<button type="button" data-view-link="shop">查看经营许可</button>'}
            </div>
          `}
      </div>
    </section>
  `;

  const tabBody = ui.activeLivestreamTab === "mine"
    ? ownerSection
    : watchedRoom
      ? visitorWatchMarkup(watchedRoom)
      : hallSection;

  elsRef.livestream.innerHTML = `
    ${payrollWorkNotice(state.me, { now: payrollNowMs(), formatMoney })}
    <div class="livestream-layout">
      ${tabsMarkup()}
      ${tabBody}
    </div>
  `;
  restorePreservedShelves(preservedShelves);
  syncSelectionControls();
  observeLazyPreviews(elsRef.livestream);
  paintProductCanvases?.();
  restoreChatScroll();
  restoreShelfScroll();
}

  return { syncSelectionControls, renderLivestream };
}
