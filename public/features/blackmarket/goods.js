import { paintJadeCanvases } from "../../jade-renderer.js";
import { lazyPreviewMarkup } from "../../lazy-preview.js";
import {
  bmSelectionConflicts,
  buildBmListEntry
} from "../../bm-plan-pool.js";
import { inlaySummary } from "../../product-meta.js";
import {
  BLACKMARKET_MIN_PRICE as BM_MIN_PRICE,
  BLACKMARKET_GOODS_CAP as BM_GOODS_CAP
} from "../../bm-constants.js";
import { isBlackmarketResource, resourceReferencePrice } from "../../../shared/domain/blackmarket/bm-resources.js";
import { employeePayrollQuote } from "../../worker-economy.js";
import { nowMs } from "../../shell/format-utils.js";

export function createBlackmarketGoods({ document, scope, ui, observeLazyPreviews, socketRef, elsRef, bmUi, getState, helpers, ports, productView }) {
  const { formatMoney, escapeHtml, empty, showToast, typeName } = helpers;
  const { bmSellables, clearBmPlanDrafts, bmMyStall, bmFeatureGate, guardBmFeature, openBmSetupModal, renderBlackmarket, closeBmModals, specialGoodsVisual, specialGoodsChips, npcGoodsInfo, specialGoodsLabel, blackmarketResourceCard } = ports;
  const { productQualityMeta, itemReferenceValue, productGemColor, deriveMaterialProfile, listingItemVisual } = productView;
  let stopPriceInput = () => {};
  function bindPriceInput(target, callback) {
    stopPriceInput();
    stopPriceInput = scope.listen(target, "input", callback);
  }

function openBmListModal() {
  const mine = bmMyStall();
  if (!mine || mine.type !== "goods") {
    showToast("请先开设卖物品摊位。");
    return;
  }
  const modal = elsRef.bmListModal || document.getElementById("bmListModal");
  if (!modal) return;
  bmUi.goodsSelectedIds = new Set();
  bmUi.goodsPriceById = new Map();
  bmUi.goodsFocusId = null;
  bmUi.goodsSubmitting = false;
  bmUi.goodsPendingIds = new Set();
  const focusId = bmUi.resourceSaleFocusId;
  const focus = bmSellables().find((item) => item.id === focusId);
  if (focus) {
    bmUi.goodsFocusId = focusId;
    bmUi.goodsSelectedIds.add(focusId);
    bmUi.goodsPriceById.set(focusId, defaultGoodsPrice(focus));
  }
  bmUi.resourceSaleFocusId = null;
  renderBmListGrid();
  renderBmListDetail();
  updateBmListConfirmBtn();
  modal.hidden = false;
}

function defaultGoodsPrice(item) {
  if (isBlackmarketResource(item?._type)) return resourceReferencePrice(item._type, item);
  return Math.max(BM_MIN_PRICE, Math.round(itemReferenceValue(item) * 1.05) || BM_MIN_PRICE);
}

function bmListSlotsLeft() {
  const mine = bmMyStall();
  if (!mine || mine.type !== "goods") return 0;
  return Math.max(0, BM_GOODS_CAP - (mine.items || []).length);
}

function goodsPriceForItem(item) {
  if (!item) return BM_MIN_PRICE;
  return Math.max(
    BM_MIN_PRICE,
    Number(bmUi.goodsPriceById.get(item.id) ?? defaultGoodsPrice(item)) || BM_MIN_PRICE
  );
}

function bmSelectionTotals() {
  const selected = [...bmUi.goodsSelectedIds]
    .map((id) => bmSellables().find((i) => i.id === id))
    .filter(Boolean);
  const total = selected.reduce((sum, item) => sum + goodsPriceForItem(item), 0);
  return { count: selected.length, total, selected };
}

function toggleBmListItem(id) {
  const sellables = bmSellables();
  const item = sellables.find((i) => i.id === id);
  if (!item) return;
  if (bmUi.goodsSelectedIds.has(id)) {
    if (bmUi.goodsFocusId !== id) {
      bmUi.goodsFocusId = id;
      renderBmListGrid();
      renderBmListDetail();
      return;
    }
    bmUi.goodsSelectedIds.delete(id);
    bmUi.goodsPriceById.delete(id);
    bmUi.goodsFocusId = bmUi.goodsSelectedIds.values().next().value || null;
  } else {
    if (bmUi.goodsSelectedIds.size >= bmListSlotsLeft()) {
      showToast(`货架最多还能上 ${bmListSlotsLeft()} 件。`);
      return;
    }
    const conflicts = bmSelectionConflicts(bmUi.goodsSelectedIds, id, sellables);
    for (const conflictId of conflicts) {
      bmUi.goodsSelectedIds.delete(conflictId);
      bmUi.goodsPriceById.delete(conflictId);
    }
    if (conflicts.length) {
      showToast("已取消互斥选项：整料与规划件/余料不能同时上架。");
    }
    bmUi.goodsSelectedIds.add(id);
    bmUi.goodsPriceById.set(id, defaultGoodsPrice(item));
    bmUi.goodsFocusId = id;
  }
  renderBmListGrid();
  renderBmListDetail();
  updateBmListConfirmBtn();
}

function renderBmListGrid() {
  const grid = document.getElementById("bmMlGrid");
  if (!grid) return;
  let items = bmSellables();
  if (bmUi.goodsPendingIds.size) {
    items = items.filter((i) => !bmUi.goodsPendingIds.has(i.id));
  }
  if (!items.length) {
    grid.innerHTML = `<div class="ml-empty modal-empty-state">
      <strong>暂无可上架物品</strong>
      <p>可出售玉料、成品和空闲员工、设备，初始资源也可转售。</p>
    </div>`;
    return;
  }
  grid.innerHTML = items.map((item) => {
    const stage = item.materialStage || item.stage || "rough";
    const windows = Array.isArray(item.windows) ? item.windows.length : 0;
    const selected = bmUi.goodsSelectedIds.has(item.id);
    if (isBlackmarketResource(item._type)) return blackmarketResourceCard({ type: item._type, item }, {
      tag: "button", className: `ml-slot bm-ml-slot${selected ? " selected" : ""}`,
      attributes: `data-action="bmToggleListItem" data-payload="${escapeHtml(item.id)}" type="button" aria-pressed="${selected}"`,
      controlHtml: `<span class="bm-ml-check${selected ? " on" : ""}" aria-hidden="true"></span>`,
      footer: `<span class="inventory-slot-value"><span>参考价</span><strong>${formatMoney(resourceReferencePrice(item._type, item))}</strong></span>`
    });
    return `
    <button class="ml-slot bm-ml-slot${selected ? " selected" : ""}" data-action="bmToggleListItem" data-payload="${item.id}" type="button">
      <span class="bm-ml-check${selected ? " on" : ""}" aria-hidden="true"></span>
      <div class="ml-slot-visual">${isBlackmarketResource(item._type) ? specialGoodsVisual({ type: item._type, item }) : lazyPreviewMarkup(listingItemVisual(item), {
        tint: item?.visual?.skin || item?.visual?.vein || "",
        cacheKey: `bm-ml:${item.id}:${stage}:${windows}`
      })}</div>
      <div class="ml-slot-copy">
        <div class="ml-slot-name"><strong>${escapeHtml(item.name)}</strong></div>
        <div class="ml-slot-meta">${escapeHtml(isBlackmarketResource(item._type) ? specialGoodsLabel(item._type) : typeName(item._type, item))} · 参考 ${formatMoney(isBlackmarketResource(item._type) ? resourceReferencePrice(item._type, item) : itemReferenceValue(item))}</div>
      </div>
    </button>`;
  }).join("");
  observeLazyPreviews(grid);
}

function renderBmListDetail() {
  const detail = document.getElementById("bmMlDetail");
  if (!detail) return;
  detail.scrollTop = 0;
  const { count, total, selected } = bmSelectionTotals();
  if (count && !bmUi.goodsFocusId) {
    bmUi.goodsFocusId = selected[0]?.id || null;
  }
  const item = bmSellables().find((i) => i.id === bmUi.goodsFocusId);
  if (!item) {
    detail.innerHTML = `<div class="ml-detail-empty">可多选物品，确认后一键上架（剩余 ${bmListSlotsLeft()} 格）</div>`;
    return;
  }
  if (isBlackmarketResource(item._type)) {
    const row = { type: item._type, item, price: goodsPriceForItem(item) };
    const quote = item._type === "employee" ? employeePayrollQuote(getState()?.me, nowMs(), item.id) : null;
    const wageText = (price) => `现在转让应结工资及欠薪 ${formatMoney(quote?.totalDue || 0)}（含历史账款）；售价减应结款 ${formatMoney(Number(price) - (quote?.totalDue || 0))}。最终以成交日账单及自动抵扣为准，不足部分按现有欠薪规则处理。`;
    detail.innerHTML = `<div class="ml-detail-panels">
      ${blackmarketResourceCard(row, { className: "resource-card--compact", body: `${specialGoodsChips(row)}${npcGoodsInfo(row)}` })}
      <div class="ml-detail-pricing">
        <p class="bm-npc-note">${item._type === "employee" ? "挂牌期间继续占名额、按登录日计薪，员工暂停工作。成交时结算工资，历史欠薪留在原雇主。" : "挂牌后暂停使用和维修；按当前耐久交付，撤回可恢复使用。"}</p>
        ${quote ? `<p class="bm-npc-note" data-bm-wage-quote>${escapeHtml(wageText(row.price))}</p>` : ""}
        <label for="bmMlPrice">挂牌价（最低 ¥${BM_MIN_PRICE}，零手续费）</label>
        <input id="bmMlPrice" type="number" inputmode="numeric" min="${BM_MIN_PRICE}" step="1" value="${row.price}">
        <div class="bm-list-selection-bar">当前选择 ${count} 件 · 合计 ${formatMoney(total)}</div>
      </div></div>`;
    bindPriceInput(detail.querySelector("#bmMlPrice"), (event) => {
      bmUi.goodsPriceById.set(item.id, Math.max(BM_MIN_PRICE, Number(event.target.value) || BM_MIN_PRICE));
      const wageLine = detail.querySelector("[data-bm-wage-quote]");
      if (wageLine) wageLine.textContent = wageText(goodsPriceForItem(item));
      detail.querySelector(".bm-list-selection-bar").textContent = `当前选择 ${count} 件 · 合计 ${formatMoney(bmSelectionTotals().total)}`;
    });
    return;
  }
  const q = productQualityMeta(item);
  const gem = productGemColor(item);
  const ref = itemReferenceValue(item);
  const profile = deriveMaterialProfile(item);
  const summary = inlaySummary(item);
  const stage = item.materialStage || item.stage || "rough";
  const isSealed = profile.sealed;
  const price = goodsPriceForItem(item);
  const stateChip = item._planned
    ? `<span class="ml-info-chip opened">规划产物</span>`
    : item._leftover
      ? `<span class="ml-info-chip opened">规划余料</span>`
    : isSealed
    ? `<span class="ml-info-chip sealed">暗料原石 · 未揭露</span>`
    : stage === "opened"
      ? `<span class="ml-info-chip opened">明料 · 已开窗</span>`
      : `<span class="ml-info-chip">${escapeHtml(typeName(item._type, item))}</span>`;
  const planEval = item._planEval || item._leftoverEval;
  const planEvalHtml = planEval
    ? `<p class="ml-info-summary">${item._leftover
      ? `余料评价 ${escapeHtml(planEval.letter || "")} · 剩余约 ${planEval.remainPct ?? "—"}% · 裂 ${planEval.crackPct ?? 0}% · 废料 ${planEval.wastePct ?? 0}% · 估价 ${formatMoney(planEval.price || ref)}`
      : `套件评价 ${escapeHtml(planEval.letter || "")} · 裂 ${planEval.crackPct ?? 0}% · 废料 ${planEval.wastePct ?? 0}% · 估价 ${formatMoney(planEval.price || ref)}`}</p>`
    : (summary ? `<p class="ml-info-summary">${escapeHtml(summary)}</p>` : "");
  const selectionBar = count > 0
    ? `<div class="bm-list-selection-bar">当前选择 <b>${count}</b> 件 · 合计预计 <b>${formatMoney(total)}</b></div>`
    : "";
  detail.innerHTML = `
    <div class="ml-detail-panels">
      <div class="ml-detail-info">
        <div class="ml-info-visual ${gem}">${listingItemVisual(item)}</div>
        <div class="ml-info-copy">
          <b class="ml-info-name">${escapeHtml(item.name)}</b>
          <div class="ml-info-chips">
            ${stateChip}
            ${!isSealed ? `<span class="ml-info-chip">${escapeHtml(item.quality || q.name)} ${q.stars}</span>` : ""}
            ${!isSealed && item.color ? `<span class="ml-info-chip">${escapeHtml(item.color)}</span>` : ""}
          </div>
          ${profile.hasReference ? `<div class="ml-info-ref">参考估值 <strong>${formatMoney(ref)}</strong></div>` : ""}
          ${planEvalHtml}
        </div>
      </div>
      <div class="ml-detail-pricing">
        <div class="ml-price-row">
          <label for="bmMlPrice">挂牌价（最低 ¥${BM_MIN_PRICE}，零手续费）</label>
          <input id="bmMlPrice" type="number" inputmode="numeric" min="${BM_MIN_PRICE}" step="1" value="${price}">
        </div>
        ${selectionBar}
      </div>
    </div>`;
  paintJadeCanvases(detail);
  bindPriceInput(detail.querySelector("#bmMlPrice"), (e) => {
    const next = Math.max(BM_MIN_PRICE, Number(e.target.value) || BM_MIN_PRICE);
    bmUi.goodsPriceById.set(item.id, next);
    const bar = detail.querySelector(".bm-list-selection-bar");
    if (bar && count > 0) {
      const nextTotal = bmSelectionTotals().total;
      bar.innerHTML = `当前选择 <b>${count}</b> 件 · 合计预计 <b>${formatMoney(nextTotal)}</b>`;
    }
  });
}

function updateBmListConfirmBtn() {
  const btn = document.getElementById("bmConfirmListBtn");
  if (!btn) return;
  const n = bmUi.goodsSelectedIds.size;
  btn.disabled = bmUi.goodsSubmitting || n <= 0;
  btn.textContent = bmUi.goodsSubmitting
    ? "提交中…"
    : n > 0
      ? `确认上架 ${n} 件`
      : "确认上架";
}

function buildBmListEntries() {
  return [...bmUi.goodsSelectedIds]
    .map((id) => {
      const item = bmSellables().find((i) => i.id === id);
      return buildBmListEntry(item, goodsPriceForItem(item));
    })
    .filter(Boolean);
}

function confirmBmList() {
  if (bmUi.goodsSubmitting) return;
  const entries = buildBmListEntries();
  if (!entries.length) {
    showToast("请至少选择一件物品。");
    return;
  }
  const sellingLast = entries.some((entry) => entry.type === "equipment" && (() => {
    const devices = getState()?.me?.workshop?.devices || [];
    const device = devices.find((item) => item.id === entry.itemId);
    return device && !devices.some((item) => item.stage === device.stage && !item.blackmarketListingId && !entries.some((row) => row.type === "equipment" && row.itemId === item.id));
  })());
  if (sellingLast) showToast({ text: "本次包含该工序最后一台可用设备，挂牌后该工序暂时无法加工，可撤回或重新购入。", tone: "info" });
  bmUi.goodsSubmitting = true;
  bmUi.goodsPendingIds = new Set(entries.map((e) => e.itemId));
  updateBmListConfirmBtn();
  showToast(`正在上架 ${entries.length} 件…`);
  renderBmListGrid();
  socketRef.emit("bmListItem", { entries });
  const pending = new Set(bmUi.goodsPendingIds);
  scope.clearTimeout(ui.goodsSubmitTimer);
  ui.goodsSubmitTimer = scope.setTimeout(() => {
    if (!bmUi.goodsSubmitting) return;
    const stillThere = entries.some((e) => bmSellables().some((i) => i.id === e.itemId));
    finishGoodsList(stillThere
      ? { ok: false, message: "上架失败：服务器未确认。", itemIds: [...pending] }
      : { ok: true, message: `上架成功：${entries.length} 件已摆上货架。`, count: entries.length, itemIds: [...pending] });
  }, 6000);
}

function finishGoodsList(res = {}) {
  scope.clearTimeout(ui.goodsSubmitTimer);
  ui.goodsSubmitTimer = null;
  bmUi.goodsSubmitting = false;
  bmUi.goodsPendingIds = new Set();
  if (res.ok && Array.isArray(res.clearedParentIds)) {
    clearBmPlanDrafts(res.clearedParentIds);
  }
  showToast({
    text: res.message || (res.ok ? "上架成功。" : "上架失败。"),
    tone: res.activated ? "income" : res.ok ? "info" : "warn"
  });
  if (res.ok) {
    bmUi.goodsSelectedIds = new Set();
    bmUi.goodsPriceById = new Map();
    bmUi.goodsFocusId = null;
    const modal = document.getElementById("bmListModal");
    if (modal) modal.hidden = true;
    bmUi.section = "mine";
  } else if (Array.isArray(res.itemIds)) {
    for (const id of res.itemIds) bmUi.goodsSelectedIds.add(id);
  }
  updateBmListConfirmBtn();
  renderBmListGrid();
  renderBmListDetail();
  renderBlackmarket();
  if (res.ok && !res.activated && bmMyStall()?.status === "setup") openBmSetupModal("goods");
}

function requestBmWithdraw(listingId) {
  const mine = bmMyStall();
  if (!mine || mine.type !== "goods") return;
  const items = mine.items || [];
  const isLast = items.length === 1 && items[0]?.id === listingId;
  if (isLast) {
    bmUi.pendingWithdrawId = listingId;
    const modal = document.getElementById("bmWithdrawConfirmModal");
    if (modal) modal.hidden = false;
    return;
  }
  socketRef.emit("bmWithdrawListing", listingId);
}

function confirmBmWithdraw() {
  if (!bmUi.pendingWithdrawId) return;
  socketRef.emit("bmWithdrawListing", bmUi.pendingWithdrawId);
  bmUi.pendingWithdrawId = null;
  closeBmModals();
}

  return { openBmListModal, defaultGoodsPrice, bmListSlotsLeft, goodsPriceForItem, bmSelectionTotals, toggleBmListItem, renderBmListGrid, renderBmListDetail, updateBmListConfirmBtn, buildBmListEntries, confirmBmList, finishGoodsList, requestBmWithdraw, confirmBmWithdraw };
}
