import { paintJadeCanvases } from "../../jade-renderer.js";
import { lazyPreviewMarkup } from "../../lazy-preview.js";
import {
  bmSelectionConflicts,
  buildBmListEntry
} from "../../bm-plan-pool.js";
import { inlaySummary } from "../../product-meta.js";
import {
  BLACKMARKET_MIN_PRICE as BM_MIN_PRICE,
  BLACKMARKET_BLIND_MIN as BM_BLIND_MIN,
  BLACKMARKET_BLIND_CAP as BM_BLIND_CAP
} from "../../bm-constants.js";

export function createBlackmarketBlindUi({ document, scope, ui, observeLazyPreviews, socketRef, getState, bmUi, helpers, ports, productView }) {
  const { formatMoney, escapeHtml, empty, showToast, openGameModal, closeGameModal, typeName } = helpers;
  const { setLastBlindSellableKey, allBmSellables, clearBmPlanDrafts, bmStalls, bmMyStall, bmStallInSetup, bmSetupHint, bmFeatureGate, guardBmFeature, bmAffordable, renderBlackmarket } = ports;
  const { productQualityMeta, itemReferenceValue, listingElapsed, productGemColor, deriveMaterialProfile, listingItemVisual } = productView;

const bmSellables = () => allBmSellables().filter((item) => !["employee", "equipment"].includes(item._type));

function bmBlindPoolCount(mine = bmMyStall()) {
  if (!mine || mine.type !== "blindbox") return 0;
  return Number(mine.poolCount ?? mine.pool?.length ?? 0) || 0;
}

function bmBlindSelection() {
  const selected = [...bmUi.blindSelected]
    .map((id) => bmSellables().find((i) => String(i.id) === String(id)))
    .filter(Boolean);
  return { count: selected.length, selected };
}

function bmBlindCountHtml(n) {
  const low = Number(n) < BM_BLIND_MIN;
  return `<b class="bm-blind-count${low ? " is-low" : ""}">${Number(n) || 0}</b>`;
}

function bmBlindFracHtml(n) {
  return `${bmBlindCountHtml(n)}/${BM_BLIND_CAP}`;
}

function isBmBlindStockModalOpen() {
  return isBmBlindManageModalOpen() && bmUi.blindManageTab === "stock";
}

function pruneBmBlindSelection() {
  const valid = new Set(bmSellables().map((item) => String(item.id)));
  for (const id of [...bmUi.blindSelected]) {
    if (!valid.has(String(id))) bmUi.blindSelected.delete(id);
  }
  if (bmUi.blindFocusId && !valid.has(String(bmUi.blindFocusId))) {
    bmUi.blindFocusId = bmUi.blindSelected.values().next().value || null;
  }
}

function syncBmBlindStockModalIfOpen({ force = false } = {}) {
  if (!isBmBlindStockModalOpen()) return;
  const items = bmSellables();
  const key = `${bmBlindPoolCount()}|${items.map((item) => String(item.id)).join(",")}`;
  if (!force && key === ui.lastBlindSellableKey) {
    updateBmBlindConfirmBtn();
    return;
  }
  setLastBlindSellableKey(key);
  pruneBmBlindSelection();
  renderBmBlindStockGrid();
  renderBmBlindStockDetail();
  updateBmBlindConfirmBtn();
  syncBmBlindStockPriceInput();
}

function bmBlindSuggestedPrice(mine = bmMyStall()) {
  const { selected } = bmBlindSelection();
  const poolValues = bmBlindPoolRows(mine)
    .filter((row) => row?.item)
    .map((row) => itemReferenceValue(row.item));
  const selectedValues = selected.map((item) => itemReferenceValue(item));
  // 已开摊补货：建议价 = 池内货 + 本次新选中的均价（忽略无参考价）
  const values = [...poolValues, ...selectedValues]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.max(BM_MIN_PRICE, Math.round(sum / values.length));
}

function bmBlindSavedStallPrice(mine = bmMyStall()) {
  return Math.max(BM_MIN_PRICE, Math.round(Number(mine?.blindPrice) || BM_MIN_PRICE));
}

function bmBlindDisplayPrice(mine = bmMyStall()) {
  const stallPrice = bmBlindSavedStallPrice(mine);
  if (stallPrice > BM_MIN_PRICE) return stallPrice;
  const suggested = bmBlindSuggestedPrice(mine);
  if (suggested != null && suggested > BM_MIN_PRICE) return suggested;
  return stallPrice;
}

function syncBmBlindStockPriceInput({ force = false } = {}) {
  const mine = bmMyStall();
  const suggested = bmBlindSuggestedPrice(mine);
  const stallPrice = bmBlindSavedStallPrice(mine);
  const hint = document.getElementById("bmBlindStockPriceHint");
  if (hint) {
    hint.textContent = suggested != null
      ? `建议定价 ${formatMoney(suggested)}`
      : "建议定价 —";
    hint.disabled = suggested == null;
  }
  const input = document.getElementById("bmBlindStockPrice");
  if (!input) return;
  if (document.activeElement === input) return;
  // 手改 / 建议价填入后保留本地值，避免 snapshot 重绘把输入框打回旧价或默认 1
  if (bmUi.blindPriceTouched) return;
  // 已有有效摊位定价时优先回填（刷新后不会被建议价或 HTML 默认 1 盖掉）
  if (stallPrice > BM_MIN_PRICE) {
    input.value = String(stallPrice);
    return;
  }
  if (suggested != null && suggested > BM_MIN_PRICE) {
    input.value = String(suggested);
    return;
  }
  if (force) {
    input.value = String(stallPrice);
  }
}

function reconcileBmBlindPlaceholderPrice(mine = bmMyStall()) {
  if (!mine || mine.type !== "blindbox" || !socketRef) return null;
  if (bmUi.blindPriceTouched) return null;
  const stallPrice = bmBlindSavedStallPrice(mine);
  if (stallPrice > BM_MIN_PRICE) return stallPrice;
  const suggested = bmBlindSuggestedPrice(mine);
  if (suggested == null || suggested <= BM_MIN_PRICE) return null;
  mine.blindPrice = suggested;
  const input = document.getElementById("bmBlindStockPrice");
  if (input && document.activeElement !== input) input.value = String(suggested);
  socketRef.emit("bmUpdateStallMeta", {
    blindDescription: mine.blindDescription || "",
    blindPrice: suggested
  });
  return suggested;
}

function applyBmBlindSuggestedPrice() {
  const suggested = bmBlindSuggestedPrice();
  const { count } = bmBlindSelection();
  const poolCount = bmBlindPoolCount();
  if (suggested == null) {
    showToast({ text: count || poolCount ? "无法建议定价。" : "请先选中料子，或确保池内有货。", tone: "warn" });
    return;
  }
  const input = document.getElementById("bmBlindStockPrice");
  if (input) input.value = String(suggested);
  bmUi.blindPriceTouched = true;
  syncBmBlindStockPriceInput();
  const scope = count && poolCount
    ? "池内与所选均价"
    : count
      ? "所选料子均价"
      : "池内均价";
  showToast({
    text: `已填入${scope} ${formatMoney(suggested)}`,
    tone: "success"
  });
}

function readBmBlindStockPrice() {
  const input = document.getElementById("bmBlindStockPrice");
  return Math.max(BM_MIN_PRICE, Math.round(Number(input?.value) || BM_MIN_PRICE));
}

function resolveBmBlindUnifiedPrice() {
  const suggested = bmBlindSuggestedPrice();
  const input = document.getElementById("bmBlindStockPrice");
  const typedRaw = Math.round(Number(input?.value) || 0);
  const typed = Math.max(BM_MIN_PRICE, Number.isFinite(typedRaw) ? typedRaw : BM_MIN_PRICE);
  const stallPrice = bmBlindSavedStallPrice();

  if (typed > BM_MIN_PRICE) {
    return typed;
  }
  if (stallPrice > BM_MIN_PRICE) {
    if (input) input.value = String(stallPrice);
    return stallPrice;
  }
  if (suggested != null && suggested > BM_MIN_PRICE) {
    if (input) input.value = String(suggested);
    return suggested;
  }
  if (suggested != null) {
    if (input) input.value = String(suggested);
    return suggested;
  }
  return typed;
}

function confirmBmBlindStockPrice() {
  confirmBmBlindManageMeta({ priceOnly: true });
}

function confirmBmBlindManageMeta({ priceOnly = false } = {}) {
  const mine = bmMyStall();
  if (!mine || mine.type !== "blindbox") return;
  if (mine.drawing) {
    showToast({ text: "抽取进行中，暂不可改设定。", tone: "warn" });
    return;
  }
  const blindPrice = resolveBmBlindUnifiedPrice();
  const input = document.getElementById("bmBlindStockPrice");
  if (input) input.value = String(blindPrice);
  bmUi.blindPriceTouched = true;
  if (mine.type === "blindbox") mine.blindPrice = blindPrice;
  const descEl = document.getElementById("bmBlindManageDesc");
  const blindDescription = priceOnly
    ? (mine.blindDescription || "")
    : String(descEl?.value || "").trim();
  if (!priceOnly && descEl) descEl.value = blindDescription;
  socketRef.emit("bmUpdateStallMeta", { blindDescription, blindPrice });
  showToast({
    text: priceOnly
      ? `盲盒定价已设为 ${formatMoney(blindPrice)}`
      : `已保存描述与定价 ${formatMoney(blindPrice)}`,
    tone: "success"
  });
}

function openBmBlindStockModal() {
  openBmBlindManageModal({ tab: "stock" });
}

function toggleBmBlindItem(rawId) {
  if (bmUi.blindSubmitting) return;
  const id = String(rawId || "");
  if (!id) return;
  const sellables = bmSellables();
  const item = sellables.find((i) => String(i.id) === id);
  if (!item) {
    // 库存可能刚被补货结果刷新；立刻重绘，避免点到幽灵卡片
    syncBmBlindStockModalIfOpen();
    return;
  }
  if (bmUi.blindSelected.has(id)) {
    if (String(bmUi.blindFocusId) !== id) {
      bmUi.blindFocusId = id;
      renderBmBlindStockGrid();
      renderBmBlindStockDetail();
      return;
    }
    bmUi.blindSelected.delete(id);
    bmUi.blindFocusId = bmUi.blindSelected.values().next().value || null;
  } else {
    const slotsLeft = BM_BLIND_CAP - bmBlindPoolCount() - bmUi.blindSelected.size;
    if (slotsLeft <= 0) {
      showToast({ text: `盲盒池最多 ${BM_BLIND_CAP} 件，已达上限。`, tone: "warn" });
      return;
    }
    const conflicts = bmSelectionConflicts(bmUi.blindSelected, id, sellables);
    for (const conflictId of conflicts) bmUi.blindSelected.delete(String(conflictId));
    if (conflicts.length) {
      showToast({ text: "已取消互斥选项：整料与规划件/余料不能同时放入。", tone: "info" });
    }
    bmUi.blindSelected.add(id);
    bmUi.blindFocusId = id;
  }
  renderBmBlindStockGrid();
  renderBmBlindStockDetail();
  updateBmBlindConfirmBtn();
  syncBmBlindStockPriceInput();
}

function renderBmBlindStockGrid() {
  const grid = document.getElementById("bmBlindStockGrid");
  if (!grid) return;
  const items = bmSellables();
  if (!items.length) {
    grid.innerHTML = `<div class="ml-empty modal-empty-state">
      <strong>暂无可放入的货品</strong>
      <p>先去公盘或交易行备料，再回到这里补充盲盒池。</p>
    </div>`;
    return;
  }
  grid.innerHTML = items.map((item) => {
    const stage = item.materialStage || item.stage || "rough";
    const windows = Array.isArray(item.windows) ? item.windows.length : 0;
    const id = String(item.id);
    const selected = bmUi.blindSelected.has(id);
    const kitsSig = (item.extractionKits || item.braceletPlacements || item._planKitsServer || []).length;
    return `
    <button class="ml-slot bm-ml-slot${selected ? " selected" : ""}" data-action="bmToggleBlindItem" data-payload="${escapeHtml(id)}" type="button">
      <span class="bm-ml-check${selected ? " on" : ""}" aria-hidden="true"></span>
      <div class="ml-slot-visual">${lazyPreviewMarkup(listingItemVisual(item), {
        tint: item?.visual?.skin || item?.visual?.vein || "",
        cacheKey: `bm-blind:${id}:${stage}:${windows}:${kitsSig}`
      })}</div>
      <div class="ml-slot-copy">
        <div class="ml-slot-name"><strong>${escapeHtml(item.name)}</strong></div>
        <div class="ml-slot-meta">${escapeHtml(typeName(item._type, item))} · 参考 ${formatMoney(itemReferenceValue(item))}</div>
      </div>
    </button>`;
  }).join("");
  observeLazyPreviews(grid);
}

function renderBmBlindStockDetail() {
  const detail = document.getElementById("bmBlindStockDetail");
  if (!detail) return;
  const { count, selected } = bmBlindSelection();
  const poolNow = bmBlindPoolCount();
  const poolAfter = poolNow + count;
  if (count && !bmUi.blindFocusId) {
    bmUi.blindFocusId = selected[0]?.id ? String(selected[0].id) : null;
  }
  const item = bmSellables().find((i) => String(i.id) === String(bmUi.blindFocusId || ""));
  if (!item) {
    detail.innerHTML = `<div class="ml-detail-empty">点选左侧物料放入盲盒池（至少凑满 ${BM_BLIND_MIN} 件才可开卖，最多 ${BM_BLIND_CAP} 件）</div>`;
    return;
  }
  const q = productQualityMeta(item);
  const gem = productGemColor(item);
  const ref = itemReferenceValue(item);
  const profile = deriveMaterialProfile(item);
  const summary = inlaySummary(item);
  const stage = item.materialStage || item.stage || "rough";
  const isSealed = profile.sealed;
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
  const need = Math.max(0, BM_BLIND_MIN - poolAfter);
  const over = Math.max(0, poolAfter - BM_BLIND_CAP);
  const progressBar = count > 0
    ? `<div class="bm-list-selection-bar bm-blind-progress-bar">已选 <b>${count}</b> 件 · 放入后池内约 ${bmBlindFracHtml(poolAfter)}${need ? ` · 还差 <b>${need}</b> 件` : ""}${over ? ` · <b class="bm-blind-count is-low">超出 ${over}</b>` : ""}</div>`
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
        <p class="bm-blind-pool-note">选中后将放入盲盒池；买家拆盒前看不到具体货品。</p>
        ${progressBar}
      </div>
    </div>`;
  paintJadeCanvases(detail);
}

function updateBmBlindConfirmBtn() {
  const btn = document.getElementById("bmConfirmBlindStockBtn");
  const n = bmUi.blindSelected.size;
  const poolNow = bmBlindPoolCount();
  const poolAfter = poolNow + n;
  const need = Math.max(0, BM_BLIND_MIN - poolAfter);
  const over = Math.max(0, poolAfter - BM_BLIND_CAP);
  const drawing = Boolean(bmMyStall()?.drawing);
  if (!btn) return;
  btn.disabled = bmUi.blindSubmitting || drawing || n <= 0 || over > 0;
  if (bmUi.blindSubmitting) {
    btn.textContent = "放入中…";
  } else if (drawing) {
    btn.textContent = "抽取中…";
  } else if (n <= 0) {
    btn.textContent = "放入盲盒";
  } else if (over > 0) {
    btn.textContent = `超出上限 ${over} 件`;
  } else if (need > 0) {
    btn.textContent = `放入盲盒（还差 ${need} 件）`;
  } else {
    btn.textContent = `放入盲盒 ${n} 件`;
  }
}

function confirmBmBlindStock() {
  if (bmUi.blindSubmitting) return;
  const entries = [...bmUi.blindSelected]
    .map((id) => {
      const item = bmSellables().find((i) => String(i.id) === String(id));
      const entry = buildBmListEntry(item, BM_MIN_PRICE);
      if (!entry) return null;
      delete entry.price;
      return entry;
    })
    .filter(Boolean);
  if (!entries.length) {
    showToast({ text: "请至少选择一件物品。", tone: "warn" });
    return;
  }
  const poolNow = bmBlindPoolCount();
  const poolAfter = poolNow + entries.length;
  if (poolAfter > BM_BLIND_CAP) {
    const slotsLeft = Math.max(0, BM_BLIND_CAP - poolNow);
    showToast({
      text: slotsLeft
        ? `盲盒池最多 ${BM_BLIND_CAP} 件，还可放 ${slotsLeft} 件。`
        : `盲盒池已满（最多 ${BM_BLIND_CAP} 件）。`,
      tone: "warn"
    });
    return;
  }
  if (poolAfter < BM_BLIND_MIN) {
    const need = BM_BLIND_MIN - poolAfter;
    showToast({
      text: `不足 ${BM_BLIND_MIN} 件无法提交（放入后约 ${poolAfter}/${BM_BLIND_CAP}，还差 ${need} 件），请继续挑选。`,
      tone: "warn"
    });
    return;
  }
  const blindPrice = resolveBmBlindUnifiedPrice();
  const input = document.getElementById("bmBlindStockPrice");
  if (input) input.value = String(blindPrice);
  bmUi.blindPriceTouched = true;
  bmUi.blindSubmitting = true;
  updateBmBlindConfirmBtn();
  socketRef.emit("bmAddBlindItems", { entries, blindPrice });
}

function finishBlindStock(res = {}) {
  bmUi.blindSubmitting = false;
  if (!res.ok) {
    showToast({ text: res.message || "补货失败。", tone: "warn" });
    updateBmBlindConfirmBtn();
    syncBmBlindStockModalIfOpen();
    return;
  }
  if (Array.isArray(res.clearedParentIds)) clearBmPlanDrafts(res.clearedParentIds);
  bmUi.blindSelected = new Set();
  bmUi.blindFocusId = null;
  const appliedPrice = Math.max(BM_MIN_PRICE, Math.round(Number(res.blindPrice) || readBmBlindStockPrice()));
  const input = document.getElementById("bmBlindStockPrice");
  if (input) input.value = String(appliedPrice);
  bmUi.blindPriceTouched = true;
  const mine = bmMyStall();
  if (mine && mine.type === "blindbox") mine.blindPrice = appliedPrice;
  bmUi.section = "mine";
  renderBlackmarket();
  if (res.activated) {
    setBmBlindManageTab("pool");
    syncBmBlindManageModalIfOpen({ force: true });
    showToast({ text: res.message || "盲盒已可开卖。", tone: "success" });
    return;
  }
  queueMicrotask(scope.guard(() => {
    if (!isBmBlindManageModalOpen()) openBmBlindManageModal({ tab: "stock" });
    else setBmBlindManageTab("stock");
    syncBmBlindStockModalIfOpen({ force: true });
    syncBmBlindManageModalIfOpen({ force: true });
  }));
}

function bmPoolEntryId(row) {
  return String(row?.id || row?.item?.id || "");
}

function bmBlindPoolRows(mine = bmMyStall()) {
  if (!mine || mine.type !== "blindbox") return [];
  return [...(mine.pool || [])].reverse();
}

function isBmBlindManageModalOpen() {
  const modal = document.getElementById("bmBlindManageModal");
  return Boolean(modal && !modal.hidden);
}

function syncBmBlindManageModalIfOpen({ force = false } = {}) {
  if (!isBmBlindManageModalOpen() && !force) return;
  if (!isBmBlindManageModalOpen()) return;
  const mine = bmMyStall();
  if (!mine || mine.type !== "blindbox") {
    closeBmBlindManageModal({ skipSetupGuard: true });
    return;
  }
  const rows = bmBlindPoolRows(mine);
  const ids = new Set(rows.map(bmPoolEntryId).filter(Boolean));
  if (bmUi.blindManageFocusId && !ids.has(String(bmUi.blindManageFocusId))) {
    bmUi.blindManageFocusId = rows[0] ? bmPoolEntryId(rows[0]) : null;
  }
  renderBmBlindManageChrome(mine);
  applyBmBlindManageTabUi();
  if (bmUi.blindManageTab === "stock") {
    syncBmBlindStockModalIfOpen({ force: true });
  } else {
    renderBmBlindManageGrid(mine);
    renderBmBlindManageDetail(mine);
  }
}

function fillBmBlindManageSettings(mine = bmMyStall()) {
  const desc = document.getElementById("bmBlindManageDesc");
  if (desc && document.activeElement !== desc) {
    desc.value = mine?.blindDescription || "";
  }
  syncBmBlindStockPriceInput({ force: document.activeElement?.id !== "bmBlindStockPrice" });
}

function setBmBlindManageTab(tab = "pool") {
  bmUi.blindManageTab = tab === "stock" ? "stock" : "pool";
  if (bmUi.blindManageTab === "stock") {
    bmUi.blindSubmitting = false;
    setLastBlindSellableKey("");
  }
  applyBmBlindManageTabUi();
  if (!isBmBlindManageModalOpen()) return;
  if (bmUi.blindManageTab === "stock") {
    syncBmBlindStockModalIfOpen({ force: true });
  } else {
    renderBmBlindManageGrid();
    renderBmBlindManageDetail();
  }
  updateBmBlindConfirmBtn();
  fillBmBlindManageSettings();
}

function applyBmBlindManageTabUi() {
  const tab = bmUi.blindManageTab === "stock" ? "stock" : "pool";
  document.querySelectorAll("#bmBlindManageModal .bm-blind-manage-tab").forEach((btn) => {
    const on = btn.dataset.bmBlindTab === tab;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.setAttribute("tabindex", on ? "0" : "-1");
  });
  const poolPane = document.getElementById("bmBlindManagePoolPane");
  const stockPane = document.getElementById("bmBlindManageStockPane");
  if (poolPane) poolPane.hidden = tab !== "pool";
  if (stockPane) stockPane.hidden = tab !== "stock";
  const poolDetail = document.getElementById("bmBlindManageDetail");
  const stockDetail = document.getElementById("bmBlindStockDetail");
  if (poolDetail) poolDetail.hidden = tab !== "pool";
  if (stockDetail) stockDetail.hidden = tab !== "stock";
  const confirmBtn = document.getElementById("bmConfirmBlindStockBtn");
  if (confirmBtn) confirmBtn.hidden = tab !== "stock";
}

function openBmBlindManageModal({ tab } = {}) {
  const mine = bmMyStall();
  if (!mine || mine.type !== "blindbox") return;
  bmUi.blindWithdrawing = false;
  // 每次打开都从摊位快照回填统一定价，避免 HTML 默认 1 / 建议价盖住已保存定价
  bmUi.blindPriceTouched = false;
  reconcileBmBlindPlaceholderPrice(mine);
  const rows = bmBlindPoolRows(mine);
  bmUi.blindManageFocusId = rows[0] ? bmPoolEntryId(rows[0]) : null;
  const preferred = tab === "stock" || tab === "pool"
    ? tab
    : (rows.length ? "pool" : "stock");
  if (preferred === "stock") {
    bmUi.blindSelected = new Set();
    bmUi.blindFocusId = null;
    bmUi.blindSubmitting = false;
    setLastBlindSellableKey("");
  }
  bmUi.blindManageTab = preferred;
  const modal = document.getElementById("bmBlindManageModal");
  if (!modal) return;
  modal.hidden = false;
  fillBmBlindManageSettings(mine);
  syncBmBlindManageModalIfOpen({ force: true });
}

function closeBmBlindManageModal({ skipSetupGuard = false } = {}) {
  const mine = bmMyStall();
  const wasOpen = isBmBlindManageModalOpen();
  const modal = document.getElementById("bmBlindManageModal");
  if (modal) modal.hidden = true;
  bmUi.blindManageFocusId = null;
  bmUi.blindWithdrawing = false;
  bmUi.blindSelected = new Set();
  bmUi.blindFocusId = null;
  bmUi.blindSubmitting = false;
  bmUi.blindManageTab = "pool";
  if (skipSetupGuard || !wasOpen || !bmStallInSetup(mine) || !socketRef) return;
  const incomplete = (mine.poolCount ?? mine.pool?.length ?? 0) < BM_BLIND_MIN;
  if (!incomplete) return;
  bmUi.pendingSetupType = null;
  socketRef.emit("bmCloseStall");
}

function renderBmBlindManageChrome(mine = bmMyStall()) {
  const n = bmBlindPoolCount(mine);
  const hint = document.getElementById("bmBlindManageHint");
  if (hint) {
    hint.textContent = `池内 ${n}/${BM_BLIND_CAP} · 满 ${BM_BLIND_MIN} 可卖 · 当前定价 ${formatMoney(bmBlindDisplayPrice(mine))}`;
  }
  const chip = document.getElementById("bmBlindManageStatusChip");
  if (chip) {
    let chipText = "";
    let chipClass = "";
    if (mine?.drawing) {
      chipText = "抽取中";
      chipClass = "is-paused";
    } else if (mine?.status === "paused") {
      chipText = "休摊中";
      chipClass = "is-paused";
    } else if (mine?.status === "setup") {
      chipText = "开摊中";
      chipClass = "is-setup";
    }
    chip.hidden = !chipText;
    chip.textContent = chipText;
    chip.classList.toggle("is-paused", chipClass === "is-paused");
    chip.classList.toggle("is-setup", chipClass === "is-setup");
  }
  const status = document.getElementById("bmBlindManageStatus");
  if (status) {
    const bits = [];
    if (mine?.drawing) bits.push("抽取进行中，暂不可改池");
    if (mine?.status === "setup") bits.push(`请上架满 ${BM_BLIND_MIN} 件后开卖`);
    if (n < BM_BLIND_MIN) bits.push(`低于下限，买家无法拆盒`);
    if (n >= BM_BLIND_CAP) bits.push("已达上限，请先下架再补货");
    if (bits.length) {
      status.hidden = false;
      status.textContent = bits.join(" · ");
      status.classList.toggle("is-warn", Boolean(mine?.drawing) || n < BM_BLIND_MIN);
    } else {
      status.hidden = true;
      status.textContent = "";
    }
  }
  const foot = document.getElementById("bmBlindManageFootStats");
  if (foot) foot.innerHTML = `池内 ${bmBlindFracHtml(n)}`;
  const stockTab = document.getElementById("bmBlindManageTabStock");
  if (stockTab) {
    stockTab.disabled = Boolean(mine?.drawing);
  }
  const settings = document.getElementById("bmBlindManageSettings");
  if (settings) {
    settings.querySelectorAll("textarea, input, button").forEach((el) => {
      el.disabled = Boolean(mine?.drawing);
    });
  }
  fillBmBlindManageSettings(mine);
  applyBmBlindManageTabUi();
  updateBmBlindConfirmBtn();
}

function renderBmBlindManageGrid(mine = bmMyStall()) {
  const grid = document.getElementById("bmBlindManageGrid");
  if (!grid) return;
  const rows = bmBlindPoolRows(mine);
  if (!rows.length) {
    grid.innerHTML = `
      <div class="ml-empty modal-empty-state">
        <strong>盲盒池还是空的</strong>
        <p>从「库存上架」放入货品，达到最低件数后即可开卖。</p>
        <button class="jm-btn-gold" data-action="bmBlindManageTab" data-bm-blind-tab="stock" type="button" ${mine?.drawing ? "disabled" : ""}>去库存上架</button>
      </div>`;
    return;
  }
  grid.innerHTML = rows.map((row) => {
    const item = row.item || {};
    const id = bmPoolEntryId(row);
    const stage = item.materialStage || item.stage || "rough";
    const windows = Array.isArray(item.windows) ? item.windows.length : 0;
    const kitsSig = (item.extractionKits || item.braceletPlacements || []).length;
    const selected = String(bmUi.blindManageFocusId) === id;
    return `
    <button class="ml-slot bm-ml-slot${selected ? " selected" : ""}" data-action="bmSelectBlindManageItem" data-payload="${escapeHtml(id)}" type="button">
      <div class="ml-slot-visual">${lazyPreviewMarkup(listingItemVisual({ ...item, _type: row.type }), {
        tint: item?.visual?.skin || item?.visual?.vein || "",
        cacheKey: `bm-pool:${id}:${stage}:${windows}:${kitsSig}`
      })}</div>
      <div class="ml-slot-copy">
        <div class="ml-slot-name"><strong>${escapeHtml(item.name || "物品")}</strong></div>
        <div class="ml-slot-meta">${escapeHtml(typeName(row.type, item))} · 参考 ${formatMoney(itemReferenceValue(item))}</div>
      </div>
    </button>`;
  }).join("");
  observeLazyPreviews(grid);
}

function renderBmBlindManageDetail(mine = bmMyStall()) {
  const detail = document.getElementById("bmBlindManageDetail");
  if (!detail) return;
  const rows = bmBlindPoolRows(mine);
  const row = rows.find((r) => bmPoolEntryId(r) === String(bmUi.blindManageFocusId || ""));
  if (!row?.item) {
    detail.innerHTML = `<div class="ml-detail-empty">点选左侧池内物品查看详情</div>`;
    return;
  }
  const item = row.item;
  const q = productQualityMeta(item);
  const gem = productGemColor(item);
  const ref = itemReferenceValue(item);
  const profile = deriveMaterialProfile(item);
  const summary = inlaySummary(item);
  const stage = item.materialStage || item.stage || "rough";
  const isSealed = profile.sealed;
  const stateChip = isSealed
    ? `<span class="ml-info-chip sealed">暗料原石 · 未揭露</span>`
    : stage === "opened"
      ? `<span class="ml-info-chip opened">明料 · 已开窗</span>`
      : `<span class="ml-info-chip">${escapeHtml(typeName(row.type, item))}</span>`;
  const poolAfter = Math.max(0, bmBlindPoolCount(mine) - 1);
  const willPause = poolAfter < BM_BLIND_MIN;
  const drawing = Boolean(mine?.drawing);
  const created = row.createdAt
    ? `<div class="ml-info-ref">放入池内 ${escapeHtml(listingElapsed(row.createdAt))}</div>`
    : "";
  detail.innerHTML = `
    <div class="ml-detail-panels">
      <div class="ml-detail-info">
        <div class="ml-info-visual ${gem}">${listingItemVisual({ ...item, _type: row.type })}</div>
        <div class="ml-info-copy">
          <b class="ml-info-name">${escapeHtml(item.name || "物品")}</b>
          <div class="ml-info-chips">
            ${stateChip}
            ${!isSealed ? `<span class="ml-info-chip">${escapeHtml(item.quality || q.name)} ${q.stars}</span>` : ""}
            ${!isSealed && item.color ? `<span class="ml-info-chip">${escapeHtml(item.color)}</span>` : ""}
          </div>
          ${profile.hasReference ? `<div class="ml-info-ref">参考估值 <strong>${formatMoney(ref)}</strong></div>` : ""}
          ${created}
          ${summary ? `<p class="ml-info-summary">${escapeHtml(summary)}</p>` : ""}
        </div>
      </div>
      <div class="ml-detail-pricing">
        <p class="bm-blind-pool-note">${drawing
          ? "抽取进行中，暂不可下架。"
          : willPause
            ? `下架后池内约 ${poolAfter}/${BM_BLIND_CAP}，将低于开卖下限。`
            : `下架后池内约 ${poolAfter}/${BM_BLIND_CAP}，货品退回库存。`}</p>
        <button class="jm-btn-gold" data-action="bmWithdrawBlindManageItem" data-payload="${escapeHtml(bmPoolEntryId(row))}" type="button" ${drawing || bmUi.blindWithdrawing ? "disabled" : ""}>
          ${bmUi.blindWithdrawing ? "下架中…" : "下架退回库存"}
        </button>
      </div>
    </div>`;
  paintJadeCanvases(detail);
}

function selectBmBlindManageItem(rawId) {
  const id = String(rawId || "");
  if (!id) return;
  bmUi.blindManageFocusId = id;
  renderBmBlindManageGrid();
  renderBmBlindManageDetail();
}

function openBmBlindStockFromManage() {
  const mine = bmMyStall();
  if (!mine || mine.type !== "blindbox") return;
  if (mine.drawing) {
    showToast({ text: "抽取进行中，暂不可补货。", tone: "warn" });
    return;
  }
  if (bmBlindPoolCount(mine) >= BM_BLIND_CAP) {
    showToast({ text: `盲盒池已满（最多 ${BM_BLIND_CAP} 件），请先下架。`, tone: "warn" });
    return;
  }
  if (!isBmBlindManageModalOpen()) openBmBlindManageModal({ tab: "stock" });
  else setBmBlindManageTab("stock");
}

function openBmBlindMetaModal() {
  openBmBlindManageModal({ tab: bmUi.blindManageTab || "pool" });
}

function confirmBmBlindMeta() {
  confirmBmBlindManageMeta();
}

function promptBmToggleAnonymous() {
  const mine = bmMyStall();
  if (!mine) {
    showToast({ text: "你还没有摊位。", tone: "warn" });
    return;
  }
  if (bmStallInSetup(mine)) {
    showToast({ text: "请先完成摆摊后再改匿名。", tone: "warn" });
    return;
  }
  const next = mine.anonymous !== true;
  bmUi.pendingAnonymous = next;
  if (typeof openGameModal !== "function") {
    confirmBmToggleAnonymous();
    return;
  }
  openGameModal({
    title: next ? "开启匿名" : "取消匿名",
    tone: "warn",
    body: next
      ? [
          "开启后对外显示马甲名，他人无法从摊位跳转你的主页。",
          "客户评级仍会展示。确认开启匿名？"
        ]
      : [
          "取消后对外显示真实摊主名，他人可从摊位查看你的资料。",
          "确认取消匿名？"
        ],
    actions: [
      {
        label: next ? "确认开启" : "确认取消",
        variant: "warn",
        clientAction: "bmConfirmToggleAnonymous"
      },
      { label: "再想想", variant: "secondary" }
    ]
  });
}

function confirmBmToggleAnonymous() {
  const mine = bmMyStall();
  if (!mine || !socketRef) return;
  const next = bmUi.pendingAnonymous == null
    ? mine.anonymous !== true
    : bmUi.pendingAnonymous === true;
  bmUi.pendingAnonymous = null;
  if (typeof closeGameModal === "function") closeGameModal();
  // 专用事件，避免 meta 更新里 false 字段被旧服务端忽略时无反馈
  socketRef.emit("bmSetStallAnonymous", { anonymous: next });
}

function bmBlindManageBuyerPreview() {
  const mine = bmMyStall();
  if (!mine || mine.type !== "blindbox") return;
  const n = bmBlindPoolCount(mine);
  openGameModal({
    title: "买家所见预览",
    subtitle: mine.title || "盲盒摊",
    tone: "info",
    stats: [
      { label: "当前定价", value: formatMoney(bmBlindDisplayPrice(mine)) },
      { label: "池内件数", value: `${n}${n < BM_BLIND_MIN ? `（需 ≥${BM_BLIND_MIN}）` : ""}` },
      { label: "状态", value: mine.drawing ? "有人正在抽取" : mine.status === "open" ? "营业中" : "休摊中" }
    ],
    lines: [
      mine.blindDescription || "摊主未填写描述",
      "买家看不到池内具体货品。支付后抽出 3 件候选，默认带走第 1 件；加选另计。"
    ],
    actions: [{ label: "知道了" }]
  });
}

function requestBmBlindManageWithdraw(poolEntryId) {
  const mine = bmMyStall();
  if (!mine || mine.type !== "blindbox" || bmUi.blindWithdrawing) return;
  if (mine.drawing) {
    showToast({ text: "抽取进行中，暂不可下架。", tone: "warn" });
    return;
  }
  const id = String(poolEntryId || bmUi.blindManageFocusId || "");
  const row = bmBlindPoolRows(mine).find((r) => bmPoolEntryId(r) === id);
  if (!row) {
    showToast({ text: "池内找不到该货品。", tone: "warn" });
    return;
  }
  const poolAfter = Math.max(0, bmBlindPoolCount(mine) - 1);
  const name = row.item?.name || "物品";
  const warn = poolAfter < BM_BLIND_MIN
    ? `退回后池内 ${poolAfter}/${BM_BLIND_CAP}，低于 ${BM_BLIND_MIN} 件将无法开卖。`
    : `退回后池内 ${poolAfter}/${BM_BLIND_CAP}。`;
  openGameModal({
    title: "确认下架",
    subtitle: name,
    tone: "warn",
    lines: [`将「${name}」退回库存。${warn}`],
    actions: [
      { label: "确认下架", variant: "warn", socketAction: "bmWithdrawBlindItem", payload: id },
      { label: "取消", variant: "secondary" }
    ]
  });
}

function finishBmBlindManageWithdraw(res = {}) {
  bmUi.blindWithdrawing = false;
  if (!res.ok) {
    showToast({ text: res.message || "下架失败。", tone: "warn" });
    syncBmBlindManageModalIfOpen({ force: true });
    return;
  }
  bmUi.section = "mine";
  renderBlackmarket();
  queueMicrotask(scope.guard(() => syncBmBlindManageModalIfOpen({ force: true })));
}

function clearBmBlindDrawTimer() {
  if (bmUi.blindDrawTimer) {
    scope.clearTimeout(bmUi.blindDrawTimer);
    bmUi.blindDrawTimer = null;
  }
}

function bmBlindDrawExtraCost(count) {
  const draw = bmUi.blindDraw;
  if (!draw || count <= 1) return 0;
  const second = Number(draw.extraSecond || 0);
  const third = Number(draw.extraThird || 0);
  if (count === 2) return second;
  return second + third;
}

function openBmBlindDrawModal(draw, { skipAnim = false } = {}) {
  if (!draw?.candidates?.length) return;
  clearBmBlindDrawTimer();
  const firstId = String(draw.candidates[0]?.itemId || draw.candidates[0]?.item?.id || "");
  bmUi.blindDraw = {
    stallId: draw.stallId,
    drawId: draw.id,
    price: Number(draw.price) || 0,
    extraSecond: Number(draw.extraSecond) || 0,
    extraThird: Number(draw.extraThird) || 0,
    expiresAt: draw.expiresAt,
    candidates: draw.candidates,
    selectedIds: new Set(firstId ? [firstId] : []),
    phase: skipAnim ? "pick" : "shake",
    settling: false
  };
  const modal = document.getElementById("bmBlindDrawModal");
  if (!modal) return;
  modal.hidden = false;
  renderBmBlindDrawModal();
  if (!skipAnim) playBmBlindDrawReveal();
}

function playBmBlindDrawReveal() {
  const stage = document.getElementById("bmBlindDrawStage");
  if (!stage || !bmUi.blindDraw) return;
  stage.classList.remove("is-revealed", "is-cracking");
  stage.classList.add("is-shaking");
  clearBmBlindDrawTimer();
  bmUi.blindDrawTimer = scope.setTimeout(() => {
    if (!bmUi.blindDraw) return;
    stage.classList.remove("is-shaking");
    stage.classList.add("is-cracking");
    bmUi.blindDraw.phase = "crack";
    bmUi.blindDrawTimer = scope.setTimeout(() => {
      if (!bmUi.blindDraw) return;
      stage.classList.remove("is-cracking");
      stage.classList.add("is-revealed");
      bmUi.blindDraw.phase = "pick";
      renderBmBlindDrawModal();
    }, 420);
  }, 650);
}

function skipBmBlindDrawAnim() {
  if (!bmUi.blindDraw || bmUi.blindDraw.settling) return;
  clearBmBlindDrawTimer();
  bmUi.blindDraw.phase = "pick";
  const stage = document.getElementById("bmBlindDrawStage");
  stage?.classList.remove("is-shaking", "is-cracking");
  stage?.classList.add("is-revealed");
  renderBmBlindDrawModal();
}

function toggleBmBlindDrawPick(itemId) {
  const draw = bmUi.blindDraw;
  if (!draw || draw.phase !== "pick" || draw.settling) return;
  const id = String(itemId || "");
  if (!id) return;
  if (draw.selectedIds.has(id)) {
    if (draw.selectedIds.size <= 1) {
      showToast({ text: "至少带走 1 件。", tone: "warn" });
      return;
    }
    draw.selectedIds.delete(id);
  } else {
    const nextCount = draw.selectedIds.size + 1;
    const extra = bmBlindDrawExtraCost(nextCount);
    const cash = Number(getState()?.me?.cash || 0);
    if (extra > cash) {
      showToast({ text: "现金不足，无法加选。", tone: "warn" });
      return;
    }
    draw.selectedIds.add(id);
  }
  renderBmBlindDrawModal();
}

function renderBmBlindDrawModal() {
  const draw = bmUi.blindDraw;
  const cards = document.getElementById("bmBlindDrawCards");
  const summary = document.getElementById("bmBlindDrawSummary");
  const foot = document.getElementById("bmBlindDrawFootStats");
  const hint = document.getElementById("bmBlindDrawHint");
  const confirmBtn = document.getElementById("bmBlindDrawConfirmBtn");
  const skipBtn = document.getElementById("bmBlindDrawSkipBtn");
  const stage = document.getElementById("bmBlindDrawStage");
  if (!draw || !cards) return;

  const picking = draw.phase === "pick";
  if (stage) {
    stage.classList.toggle("is-revealed", picking || draw.phase === "crack");
    stage.classList.toggle("is-shaking", draw.phase === "shake");
    stage.classList.toggle("is-cracking", draw.phase === "crack");
  }
  if (skipBtn) skipBtn.hidden = picking || draw.settling;

  cards.innerHTML = draw.candidates.map((row, index) => {
    const item = row.item || {};
    const id = String(row.itemId || item.id || "");
    const selected = draw.selectedIds.has(id);
    const q = productQualityMeta(item);
    const gem = productGemColor(item);
    const ref = itemReferenceValue(item);
    const order = index + 1;
    return `
      <button class="bm-blind-card${selected ? " is-selected" : ""}${picking ? "" : " is-locked"}" data-action="bmBlindDrawToggle" data-payload="${escapeHtml(id)}" type="button" ${picking && !draw.settling ? "" : "disabled"}>
        <span class="bm-blind-card-slot">候选 ${order}</span>
        <div class="bm-blind-card-visual ${gem}">${listingItemVisual(item)}</div>
        <strong class="bm-blind-card-name">${escapeHtml(item.name || "未知货品")}</strong>
        <span class="bm-blind-card-meta">${escapeHtml(item.quality || q.name || typeName(row.type || item._type, item))} · 参考 ${formatMoney(ref)}</span>
        <span class="bm-blind-card-check" aria-hidden="true"></span>
      </button>`;
  }).join("");
  paintJadeCanvases(cards);

  const count = draw.selectedIds.size;
  const extra = bmBlindDrawExtraCost(count);
  const cash = Number(getState()?.me?.cash || 0);
  if (hint) {
    hint.textContent = picking
      ? `已付 ${formatMoney(draw.price)} · 第 2 件 +${formatMoney(draw.extraSecond)} · 第 3 件 +${formatMoney(draw.extraThird)}`
      : "匣子裂封中，请稍候…";
  }
  if (summary) {
    summary.innerHTML = picking
      ? `<p>已选 <b>${count}</b> 件 · 追加 <b>${formatMoney(extra)}</b>${extra > cash ? " · <em>现金不足加购</em>" : ""}</p>
         <p class="bm-blind-draw-note">关闭窗口将按当前勾选带走（至少 1 件）。未选货品退回摊池。</p>`
      : `<p>正在拆封…</p>`;
  }
  if (foot) {
    foot.textContent = picking
      ? `已选 ${count} 件 · 追加 ${formatMoney(extra)}`
      : "拆盒中";
  }
  if (confirmBtn) {
    confirmBtn.disabled = !picking || draw.settling || count < 1;
    confirmBtn.textContent = draw.settling
      ? "结算中…"
      : extra > 0
        ? `确认带走（+${formatMoney(extra)}）`
        : "确认带走";
  }
}

function settleBmBlindDraw() {
  const draw = bmUi.blindDraw;
  if (!draw || draw.settling) return;
  if (!draw.selectedIds.size && draw.candidates[0]) {
    const id = String(draw.candidates[0].itemId || draw.candidates[0].item?.id || "");
    if (id) draw.selectedIds.add(id);
  }
  draw.settling = true;
  bmUi.suppressBlindDrawResume = true;
  clearBmBlindDrawTimer();
  renderBmBlindDrawModal();
  if (typeof closeGameModal === "function") closeGameModal();
  socketRef.emit("bmSettleBlindDraw", {
    stallId: draw.stallId,
    drawId: draw.drawId,
    selectedItemIds: [...draw.selectedIds]
  });
}

function bmBlindDrawSelectedNames(draw = bmUi.blindDraw) {
  if (!draw) return [];
  return [...draw.selectedIds]
    .map((id) => {
      const row = (draw.candidates || []).find((entry) =>
        String(entry.itemId || entry.item?.id || "") === String(id)
      );
      return row?.item?.name || null;
    })
    .filter(Boolean);
}

function requestBmBlindDrawClose() {
  const draw = bmUi.blindDraw;
  if (!draw || draw.settling) return;
  if (draw.phase !== "pick") {
    showToast({ text: "拆封尚未结束，请稍候或点击「跳过动画」。", tone: "warn" });
    return;
  }
  if (!draw.selectedIds.size && draw.candidates[0]) {
    const id = String(draw.candidates[0].itemId || draw.candidates[0].item?.id || "");
    if (id) draw.selectedIds.add(id);
  }
  const names = bmBlindDrawSelectedNames(draw);
  const nameText = names.length
    ? names.map((name) => `「${name}」`).join("、")
    : "当前勾选物品";
  const extra = bmBlindDrawExtraCost(draw.selectedIds.size);
  const extraLine = extra > 0 ? `另需追加 ${formatMoney(extra)}。` : "";
  if (typeof openGameModal !== "function") {
    settleBmBlindDraw();
    return;
  }
  openGameModal({
    id: "bm-blind-draw-close",
    title: "确认关闭",
    tone: "warn",
    body: [
      `关闭界面将默认带走${nameText}。`,
      `${extraLine ? `${extraLine} ` : ""}未选货品会退回摊池。确认后关闭拆盲盒弹窗。`
    ],
    actions: [
      { label: "确认带走", variant: "warn", clientAction: "bmConfirmBlindDrawClose" },
      { label: "再看看", variant: "secondary" }
    ]
  });
}

function confirmBmBlindDrawClose() {
  if (typeof closeGameModal === "function") closeGameModal();
  settleBmBlindDraw();
}

function finishBmBlindDrawUi() {
  clearBmBlindDrawTimer();
  bmUi.blindDraw = null;
  const modal = document.getElementById("bmBlindDrawModal");
  if (modal) modal.hidden = true;
}

function resumeBmBlindDrawFromState() {
  if (bmUi.blindDraw || bmUi.suppressBlindDrawResume) return;
  const stalls = bmStalls();
  const mineDraw = stalls.find((s) => s.activeBlindDraw)?.activeBlindDraw;
  if (!mineDraw) {
    bmUi.suppressBlindDrawResume = false;
    return;
  }
  openBmBlindDrawModal(mineDraw, { skipAnim: true });
}

  return { bmBlindPoolCount, bmBlindSelection, bmBlindCountHtml, bmBlindFracHtml, isBmBlindStockModalOpen, pruneBmBlindSelection, syncBmBlindStockModalIfOpen, bmBlindSuggestedPrice, bmBlindSavedStallPrice, bmBlindDisplayPrice, syncBmBlindStockPriceInput, reconcileBmBlindPlaceholderPrice, applyBmBlindSuggestedPrice, readBmBlindStockPrice, resolveBmBlindUnifiedPrice, confirmBmBlindStockPrice, confirmBmBlindManageMeta, openBmBlindStockModal, toggleBmBlindItem, renderBmBlindStockGrid, renderBmBlindStockDetail, updateBmBlindConfirmBtn, confirmBmBlindStock, finishBlindStock, bmPoolEntryId, bmBlindPoolRows, isBmBlindManageModalOpen, syncBmBlindManageModalIfOpen, fillBmBlindManageSettings, setBmBlindManageTab, applyBmBlindManageTabUi, openBmBlindManageModal, closeBmBlindManageModal, renderBmBlindManageChrome, renderBmBlindManageGrid, renderBmBlindManageDetail, selectBmBlindManageItem, openBmBlindStockFromManage, openBmBlindMetaModal, confirmBmBlindMeta, promptBmToggleAnonymous, confirmBmToggleAnonymous, bmBlindManageBuyerPreview, requestBmBlindManageWithdraw, finishBmBlindManageWithdraw, clearBmBlindDrawTimer, bmBlindDrawExtraCost, openBmBlindDrawModal, playBmBlindDrawReveal, skipBmBlindDrawAnim, toggleBmBlindDrawPick, renderBmBlindDrawModal, settleBmBlindDraw, bmBlindDrawSelectedNames, requestBmBlindDrawClose, confirmBmBlindDrawClose, finishBmBlindDrawUi, resumeBmBlindDrawFromState };
}
