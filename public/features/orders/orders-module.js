// orders-module.js — persona orders UI (confirm on mismatch, paid refresh)
import { inlaySummary } from "../../product-meta.js";
import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { evaluateOrderFit, estimateOrderSettlement, finishedProductKind, productSizeBand, ORDER_SIZE_BANDS } from "../../jade-rules.js";
import { KIND_LABELS } from "../../jade-categories.js";
import { collectRepLabel, collectRepFromValue, MAX_COLLECTION_SIZE } from "../../player-progression.js";
import { inventoryPreviewHtml } from "../../inventory-preview.js";
import { finishedProductCardEntry, finishedProductCardContent } from "../../finished-product-card-view.js";
import { typeName } from "../inventory-helpers.js";
import { inventoryDetailStats } from "../inventory/item-detail-model.js";
import { inventoryItemDetailHtml } from "../inventory/item-detail-view.js";
import { quoteSystemDemand, systemSalePriceCap } from "../../../shared/domain/economy/system-demand.js";
import { lazyPreviewMarkup, observeLazyPreviews } from "../../lazy-preview.js";
import {
  ORDER_SINGLE_REFRESH_DAILY_CAP,
  ORDER_BATCH_REFRESH_DAILY_CAP,
  orderSingleRefreshFeeForCount,
  orderBatchRefreshFeeForCount
} from "../../order-refresh.js";

let socketRef, getState, elsRef, getActiveView;

let finishedProducts, matchingBracelets, productMatchesOrder, productName, productCanvas, formatMoney, escapeHtml, empty, routeRecommendation, liveSaleRange, productOrderFitReasons, button, viewButton, showToast, openGameModal, closeGameModal;

let mismatchModalEl = null;
let mismatchModalTeardown = null;
let orderPickModalEl = null;
let orderPickModalTeardown = null;
let pendingRefreshOrderId = null;
let orderPickQuery = "";
let orderPickTier = "full";
let orderPickSort = "fit";
let orderPickDetailId = "";
let orderPickScrollTop = 0;
/** @type {{ orderId: string, slot: string, draftId: string } | null} */
let pendingOrderPick = null;
/** 用户确认过的槽位选择，跨重绘保留 */
const orderSlotSelections = new Map();
let orderMenusBound = false;

export function initOrdersModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ finishedProducts, matchingBracelets, productMatchesOrder, productName, productCanvas, formatMoney, escapeHtml, empty, routeRecommendation, liveSaleRange, productOrderFitReasons, button, viewButton, showToast, openGameModal, closeGameModal } = deps.helpers);
  if (!orderMenusBound && globalThis.document?.addEventListener) {
    document.addEventListener("click", (event) => {
      const current = event.target.closest?.(".order-actions-menu");
      for (const menu of elsRef.orders?.querySelectorAll?.(".order-actions-menu[open]") || []) {
        if (menu !== current) menu.open = false;
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      for (const menu of elsRef.orders?.querySelectorAll?.(".order-actions-menu[open]") || []) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    });
    orderMenusBound = true;
  }
  const register = deps.registerAction;
  if (typeof register === "function") {
    register("completeOrder", ({ target, payload }) => ordersComplete(target, payload));
    register("refreshOrderSlot", ({ target, payload }) => {
      const menu = target?.closest?.(".order-actions-menu");
      if (menu) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
      openRefreshSlotConfirm(payload);
    });
    register("confirmRefreshOrderSlot", () => {
      const orderId = pendingRefreshOrderId;
      pendingRefreshOrderId = null;
      if (typeof closeGameModal === "function") closeGameModal();
      if (orderId) socketRef.emit("refreshOrderSlot", { orderId });
    });
    register("confirmOrdersBatchRefresh", () => {
      if (typeof closeGameModal === "function") closeGameModal();
      socketRef.emit("refreshOrders");
    });
    register("openOrderProductPicker", ({ target, payload }) => {
      const orderId = payload || target?.dataset?.payload;
      const slot = target?.dataset?.slot || "0";
      openOrderProductPicker(orderId, slot);
    });
    register("pickOrderProductOption", ({ target }) => {
      const productId = target?.dataset?.productId ?? "";
      selectOrderPickDraft(productId);
    });
    register("confirmOrderProductPick", () => confirmOrderProductPick());
    register("inspectOrderPickProduct", ({ target }) => openOrderPickDetails(target?.dataset?.productId));
    register("backToOrderPickProducts", () => returnToOrderPickProducts());
    register("showAllOrderPickProducts", () => {
      orderPickQuery = "";
      orderPickTier = "all";
      renderOrderPickPicker();
    });
  }
}

function openRefreshSlotConfirm(orderId) {
  if (!orderId) return;
  const counts = refreshCounts();
  if (counts.single >= ORDER_SINGLE_REFRESH_DAILY_CAP) {
    showToast?.({ text: "今日单槽刷新次数已用尽。", tone: "warn" });
    return;
  }
  const fee = singleRefreshFee();
  if (Number(getState()?.me?.cash || 0) < fee) {
    showToast?.({ text: `刷新需要 ${formatMoney(fee)}。`, tone: "warn" });
    return;
  }
  pendingRefreshOrderId = orderId;
  if (typeof openGameModal !== "function") {
    socketRef.emit("refreshOrderSlot", { orderId });
    return;
  }
  openGameModal({
    title: "刷新订单",
    tone: "warn",
    body: [
      `花费 ${formatMoney(fee)} 刷新该订单？`,
      "当前客人需求会被替换为新订单。"
    ],
    actions: [
      { label: "确认刷新", variant: "warn", clientAction: "confirmRefreshOrderSlot" },
      { label: "取消", variant: "secondary" }
    ]
  });
}

function refreshCounts() {
  const me = getState().me || {};
  const counts = me.orderRefreshCounts || { single: 0, batch: 0 };
  return {
    single: Number(counts.single || 0),
    batch: Number(counts.batch || 0)
  };
}

function singleRefreshFee() {
  return orderSingleRefreshFeeForCount(refreshCounts().single);
}

function batchRefreshFee() {
  return orderBatchRefreshFeeForCount(refreshCounts().batch);
}

export function msUntilNextOrderDailyRefresh(now = Date.now()) {
  const d = new Date(now);
  const next = new Date(d);
  next.setHours(5, 0, 0, 0);
  if (d.getHours() >= 5) next.setDate(next.getDate() + 1);
  return Math.max(0, next.getTime() - now);
}

function formatCountdown(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh <= 0) return `${mm} 分钟`;
  return `${hh} 小时 ${mm} 分`;
}

export function selectedByDefault(order, bracelet) {
  const candidates = matchingBracelets(order).slice(0, order.quantity).map((item) => item.id);
  return candidates.includes(bracelet.id) ? "selected" : "";
}

export function orderFitList(order, candidates) {
  if (!candidates.length) {
    return `
      <div class="fit-list muted">
        <div>暂无完全匹配的成品</div>
        <div class="fit-hint">可试交部分符合货，预计折价；硬条件不符会被拒收</div>
      </div>
    `;
  }
  return `
    <div class="fit-list">
      ${candidates.slice(0, 3).map((product) => {
        const summary = inlaySummary(product);
        return `
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            <span>${productOrderFitReasons(product, order).map(escapeHtml).join(" · ")}</span>
            ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

export function salesRouteMeta(item) {
  const route = routeRecommendation(item, getState().me.orders, getState().me.rep);
  const range = liveSaleRange(item, getState().me.rep);
  return `
    <div class="route-meta ${route.route}">
      <strong>${escapeHtml(route.label)}</strong>
      <span>${escapeHtml(route.detail)} · 直播 ${formatMoney(range.low)}-${formatMoney(range.high)}</span>
    </div>
  `;
}

export function braceletRow(item) {
  const route = salesRouteMeta(item);
  const summary = inlaySummary(item);
  return `
    <div class="item-row product-row">
      ${productCanvas(item)}
      <div>
        <div class="item-title"><span>${escapeHtml(item.name)}</span><span class="pill">${formatMoney(item.value)}</span></div>
        <p class="item-meta">${escapeHtml(productName(item))} · ${escapeHtml(item.quality)} · ${escapeHtml(collectRepLabel(item.value, { alreadyGranted: Boolean(item.collectedRepGranted) }))}</p>
        ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
        ${route}
        <div class="row-actions">
          ${button("收藏", "collectBracelet", item.id)}
          ${viewButton("去直播", "livestream", "secondary")}
        </div>
      </div>
    </div>
  `;
}

/** 题材作标题，种/色/尺寸放在单独的规格行。 */
const HERO_REQ_TYPES = new Set(["minScore", "requireBrightColor", "forbidDullColor"]);

function heroMetaBits(order) {
  const bits = [];
  const hard = order.hard || {};
  const reqs = Array.isArray(order.requirements) ? order.requirements : [];
  const minScore = reqs.find((req) => req.type === "minScore");
  if (minScore?.label) bits.push(String(minScore.label).replace(/^种水[：:]/, ""));
  const colorReq = reqs.find((req) => req.type === "requireBrightColor" || req.type === "forbidDullColor");
  if (colorReq?.label) bits.push(String(colorReq.label).replace(/^色泽[：:]/, ""));
  if (hard.sizeBand) {
    const sizeLabel = ORDER_SIZE_BANDS[hard.sizeBand]?.label || hard.sizeBand;
    bits.push(`尺寸${sizeLabel}`);
  }
  return bits;
}

function orderHeroBlock(order, status, refreshUsage) {
  const hard = order.hard || {};
  const kindLabel = hard.kindLabel || KIND_LABELS[hard.kind] || hard.kind || "成品";
  const fee = singleRefreshFee();
  const exhausted = refreshUsage.single >= ORDER_SINGLE_REFRESH_DAILY_CAP;
  const affordable = Number(getState().me.cash || 0) >= fee;
  return `
    <div class="order-card-heading">
      <h3 class="order-hero-main">${escapeHtml(kindLabel)}<span class="order-quantity">× ${Number(order.quantity || 1)} 件</span></h3>
      <div class="order-card-heading-actions">
        <span class="order-status ${status.tone}"><i aria-hidden="true"></i>${status.label}</span>
        <details class="order-actions-menu" name="order-card-actions">
          <summary aria-label="${escapeHtml(kindLabel)}订单的更多操作">···</summary>
          <div class="order-actions-popover">
            <button type="button" class="secondary" data-action="refreshOrderSlot" data-payload="${escapeHtml(order.id)}"
              ${exhausted || !affordable ? "disabled" : ""} title="${exhausted ? "今日单槽刷新次数已用尽" : !affordable ? `现金不足，需要 ${formatMoney(fee)}` : "替换当前客人需求"}">${exhausted ? "今日刷新已用尽" : `刷新订单 ${formatMoney(fee)}`}</button>
          </div>
        </details>
      </div>
    </div>
  `;
}

function orderPersonaBlock(order) {
  const personality = order.persona?.personality
    ? `<span class="order-persona-trait">· ${escapeHtml(order.persona.personality)}</span>`
    : "";
  return `
    <div class="order-persona"><span class="order-persona-name">客人：${escapeHtml(order.client || "街坊客人")}</span>${personality}</div>
  `;
}

function requirementsBlock(order, product) {
  const hard = order.hard || {};
  const reqs = (Array.isArray(order.requirements) ? order.requirements : []).filter(Boolean);
  const qualityReq = reqs.filter(req => req.type === "minScore")
    .sort((a, b) => Number(b.minScore || 1) - Number(a.minScore || 1))[0];
  const minScore = Number(qualityReq?.minScore || order.minScore || 0);
  const qualityNames = ["", "豆种", "糯种", "糯冰", "正冰", "高冰", "玻璃种"];
  const qualityTarget = qualityReq?.label?.replace(/^种水\s*[：:]?\s*/, "")
    || (minScore ? `${qualityNames[minScore] || minScore}及以上` : "不限");
  const size = product ? productSizeBand(product) : "";
  const row = (name, target, actual = "", tone = "pass") => `
    <div class="order-demand-row"><dt>${escapeHtml(name)}</dt><dd><span class="order-demand-target">${escapeHtml(target)}</span>${actual ? `<span class="order-demand-actual is-${tone}">${tone === "pass" ? "✓" : tone === "warn" ? "!" : "×"} ${escapeHtml(actual)}</span>` : ""}</dd></div>`;
  const rows = [];
  if (product && hard.kind && finishedProductKind(product) !== hard.kind) {
    rows.push(row("题材", hard.kindLabel || KIND_LABELS[hard.kind] || hard.kind,
      KIND_LABELS[finishedProductKind(product)] || finishedProductKind(product), "fail"));
  }
  if (qualityReq || minScore > 1) rows.push(row("种水", qualityTarget, product ? product.quality || "未标注" : "", !minScore || Number(product?.score || 0) >= minScore ? "pass" : "warn"));
  if (hard.sizeBand) rows.push(row("尺寸", ORDER_SIZE_BANDS[hard.sizeBand]?.label || hard.sizeBand,
    product ? ORDER_SIZE_BANDS[size]?.label || size : "", !hard.sizeBand || size === hard.sizeBand ? "pass" : "fail"));
  const names = { requireBrightColor: "色泽", forbidDullColor: "色泽", forbidCrack: "净度",
    requireMetal: "金属", requireFineMetal: "金属", forbidCheapMetal: "金属",
    requireSetting: "镶法", forbidFlashySetting: "镶法", requirePolish: "抛光", requireKind: "题材" };
  const fallbacks = { requireBrightColor: "要明艳正色", forbidDullColor: "避免灰闷色", forbidCrack: "无纹裂",
    requireMetal: "指定金属", requireFineMetal: "18K金、足金或铂金", forbidCheapMetal: "不用925银",
    requireSetting: "指定镶法", forbidFlashySetting: "素雅镶法", requirePolish: "指定抛光" };
  for (const req of reqs) {
    if (req.type === "minScore" || req.type === "requireKind" && req.kind === hard.kind) continue;
    const target = String(req.label || fallbacks[req.type] || "按客人要求")
      .replace(/^(种水|色泽|净度|镶嵌金属|金属|镶法|抛光|题材)\s*[：:]?\s*/, "").replace(/[。；;]+$/, "");
    rows.push(row(names[req.type] || "其他偏好", target));
  }
  if (!rows.length) return "";
  return `
    <section class="order-demand" aria-label="客人具体要求">
      ${product ? `<div class="order-demand-heading"><span>客人要求</span><span>本件成品</span></div>` : ""}
      <dl>${rows.join("")}</dl>
    </section>
  `;
}

function slotSelectionKey(orderId, slotIndex) {
  return `${orderId}:${slotIndex}`;
}

function getSlotSelection(order, slotIndex) {
  const key = slotSelectionKey(order.id, slotIndex);
  if (orderSlotSelections.has(key)) return orderSlotSelections.get(key) || "";
  return matchingBracelets(order).slice(0, order.quantity || 1)[slotIndex]?.id || "";
}

function setSlotSelection(orderId, slotIndex, productId) {
  orderSlotSelections.set(slotSelectionKey(orderId, slotIndex), productId || "");
}

function pruneOrderSlotSelections(orders = []) {
  const alive = new Set((orders || []).map((order) => String(order.id)));
  for (const key of [...orderSlotSelections.keys()]) {
    const orderId = String(key).split(":")[0];
    if (!alive.has(orderId)) orderSlotSelections.delete(key);
  }
}

function orderPickRequirements(order) {
  const hard = order.hard || {};
  const kindLabel = hard.kindLabel || KIND_LABELS[hard.kind] || hard.kind || "成品";
  const bits = [kindLabel, ...heroMetaBits(order)];
  if (!hard.budgetUnlimited && Number(hard.budgetMax) > 0) bits.push(`预算≤${formatMoney(hard.budgetMax)}`);
  if (Number(order.quantity || 1) > 1) bits.push(`${order.quantity}件`);
  for (const req of Array.isArray(order.requirements) ? order.requirements : []) {
    if (req?.label && req.type !== "requireKind" && !HERO_REQ_TYPES.has(req.type)) bits.push(req.label);
  }
  return [...new Set(bits)];
}

function sortedPickProducts(order, bracelets, sort = orderPickSort) {
  const tierRank = { full: 0, partial: 1, hard_fail: 2 };
  return [...bracelets].sort((a, b) => {
    if (sort === "valueDesc") return Number(b.value || b.price || 0) - Number(a.value || a.price || 0);
    if (sort === "valueAsc") return Number(a.value || a.price || 0) - Number(b.value || b.price || 0);
    if (sort === "name") return String(a.name || "").localeCompare(String(b.name || ""), "zh");
    const ta = tierRank[evaluateOrderFit(a, order).tier] ?? 9;
    const tb = tierRank[evaluateOrderFit(b, order).tier] ?? 9;
    if (ta !== tb) return ta - tb;
    return String(a.name || "").localeCompare(String(b.name || ""), "zh");
  });
}

function fitPillLabel(tier) {
  if (tier === "full") return "完全符合";
  if (tier === "partial") return "部分不符";
  if (tier === "hard_fail") return "客人拒收";
  return "";
}

function closeOrderPickModal() {
  pendingOrderPick = null;
  orderPickDetailId = "";
  if (!orderPickModalEl) return;
  orderPickModalEl.classList.add("is-hidden");
  orderPickModalEl.setAttribute("aria-hidden", "true");
  if (typeof orderPickModalTeardown === "function") {
    orderPickModalTeardown();
    orderPickModalTeardown = null;
  }
}

function ensureOrderPickModal() {
  if (orderPickModalEl) return orderPickModalEl;
  const el = document.createElement("div");
  el.className = "modal-overlay is-hidden";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="modal order-pick-modal" role="dialog" aria-modal="true" aria-labelledby="orderPickTitle"></div>
  `;
  document.body.appendChild(el);
  orderPickModalEl = el;
  el.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-order-pick-close]")) closeOrderPickModal();
  });
  el.addEventListener("input", (event) => {
    if (!event.target.matches?.("[data-order-pick-search]")) return;
    orderPickQuery = event.target.value;
    renderOrderPickList();
  });
  el.addEventListener("change", (event) => {
    if (event.target.matches?.("[data-order-pick-tier]")) orderPickTier = event.target.value;
    else if (event.target.matches?.("[data-order-pick-sort]")) orderPickSort = event.target.value;
    else return;
    renderOrderPickList();
  });
  return el;
}

function renderOrderPickPicker() {
  const order = (getState()?.me?.orders || []).find((item) => item.id === pendingOrderPick?.orderId);
  if (!order || !orderPickModalEl) return;
  orderPickDetailId = "";
  const dialog = orderPickModalEl.querySelector('[role="dialog"]');
  dialog.className = "modal order-pick-modal";
  dialog.setAttribute("aria-labelledby", "orderPickTitle");
  dialog.innerHTML = `
      <div class="modal-head">
        <h3 id="orderPickTitle">选择交付成品</h3>
        <button class="modal-close" type="button" aria-label="关闭选择窗口" data-order-pick-close>×</button>
      </div>
      <div class="order-pick-requirements" aria-label="客人要求">
        <span class="order-pick-req-label">客人要求</span>
        ${orderPickRequirements(order).map((bit) => `<span>${escapeHtml(bit)}</span>`).join("")}
      </div>
        <div class="item-picker-tools order-pick-tools">
          <input type="search" data-order-pick-search value="${escapeHtml(orderPickQuery)}" placeholder="搜索名称、种水或不符原因" aria-label="搜索成品">
          <select data-order-pick-tier aria-label="筛选匹配状态">
            <option value="full">完全符合</option>
            <option value="all">全部状态</option>
            <option value="partial">部分不符</option>
            <option value="hard_fail">客人拒收</option>
          </select>
          <select data-order-pick-sort aria-label="成品排序">
            <option value="fit">匹配优先</option>
            <option value="valueDesc">估值从高到低</option>
            <option value="valueAsc">估值从低到高</option>
            <option value="name">名称</option>
          </select>
        </div>
      <span class="item-picker-result order-pick-result" data-order-pick-result aria-live="polite"></span>
      <div class="modal-body order-pick-body">
        <div class="order-pick-list" role="list" aria-label="库存成品"></div>
      </div>
      <div class="modal-foot order-pick-foot">
        <div class="order-pick-foot-main">
          <button class="modal-cancel" type="button" data-order-pick-close>取消</button>
          <button class="modal-confirm" type="button" data-action="confirmOrderProductPick">确认选择</button>
        </div>
      </div>
  `;
  dialog.querySelector("[data-order-pick-tier]").value = orderPickTier;
  dialog.querySelector("[data-order-pick-sort]").value = orderPickSort;
  renderOrderPickList();
  dialog.querySelector(".order-pick-body").scrollTop = orderPickScrollTop;
}

function orderPickInventoryEntry(product) {
  return finishedProductCardEntry(product);
}

function renderOrderPickList() {
  const el = orderPickModalEl;
  const pending = pendingOrderPick;
  if (!el || !pending) return;
  const order = (getState()?.me?.orders || []).find((item) => item.id === pending.orderId);
  const list = el.querySelector(".order-pick-list");
  const confirmBtn = el.querySelector("[data-action='confirmOrderProductPick']");
  if (!order || !list) return;
  const allProducts = finishedProducts();
  const query = orderPickQuery.trim().toLocaleLowerCase("zh-CN");
  const products = sortedPickProducts(order, allProducts).filter((product) => {
    const fit = evaluateOrderFit(product, order);
    if (orderPickTier !== "all" && fit.tier !== orderPickTier) return false;
    if (!query) return true;
    const haystack = [
      product.name,
      product.quality,
      product.color,
      inlaySummary(product),
      ...productOrderFitReasons(product, order)
    ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
    return haystack.includes(query);
  });
  const result = el.querySelector("[data-order-pick-result]");
  if (result) result.textContent = `显示 ${products.length}/${allProducts.length} 件`;
  if (confirmBtn) confirmBtn.disabled = !allProducts.some((product) => product.id === pending.draftId);
  if (!products.length) {
    list.innerHTML = `<div class="order-pick-empty modal-empty-state">
      <strong>${!allProducts.length ? "暂无可交付成品" : orderPickTier === "full" && !query ? "暂无完全符合的成品" : "筛选下没有匹配成品"}</strong>
      <p>${allProducts.length ? "可切换筛选查看其他成品。" : "先在工坊完成一件成品，再回到订单页交付。"}</p>
      ${allProducts.length ? `<button type="button" class="secondary" data-action="showAllOrderPickProducts">查看全部成品</button>` : ""}
    </div>`;
    return;
  }
  list.innerHTML = products.map((product) => {
    const fit = evaluateOrderFit(product, order);
    const selected = product.id === pending.draftId;
    const pill = fitPillLabel(fit.tier);
    const reasons = fit.tier === "full" ? "题材、种水、尺寸与货值均符合" : productOrderFitReasons(product, order).slice(0, 2).join(" · ");
    return `
      <article class="inventory-slot order-pick-card${selected ? " is-selected" : ""}" role="listitem">
        <button type="button" class="order-pick-inspect" data-action="inspectOrderPickProduct" data-product-id="${escapeHtml(product.id)}" aria-label="查看${escapeHtml(product.name)}详情">
          ${finishedProductCardContent(product, { escapeHtml, formatMoney, renderProduct: productCanvas,
            selectionHtml: selected ? '<span class="order-pick-selected">✓ 已选择</span>' : ""
          })}
        </button>
        <div class="order-pick-fit">${pill ? `<span class="order-pick-pill tier-${escapeHtml(fit.tier)}">${escapeHtml(pill)}</span>` : ""}${reasons ? `<p>${escapeHtml(reasons)}</p>` : ""}</div>
        <div class="order-pick-card-actions"><button type="button" class="secondary" data-action="pickOrderProductOption" data-product-id="${escapeHtml(product.id)}" aria-pressed="${selected ? "true" : "false"}" aria-label="${selected ? "取消选择" : "选择"}${escapeHtml(product.name)}">${selected ? "✓ 已选择" : "选择此件"}</button></div>
      </article>
    `;
  }).join("");
  observeLazyPreviews(el);
}

function openOrderPickDetails(productId) {
  const product = finishedProducts().find((item) => item.id === productId);
  if (!pendingOrderPick || !product || !orderPickModalEl) return;
  orderPickScrollTop = orderPickModalEl.querySelector(".order-pick-body")?.scrollTop || 0;
  orderPickDetailId = productId;
  const entry = orderPickInventoryEntry(product);
  const stats = inventoryDetailStats(entry, { formatMoney, typeName });
  if (!entry.isEscrow && !entry.isPlanned && (getState().me?.collection || []).length < MAX_COLLECTION_SIZE) {
    const rep = collectRepFromValue(entry.totalValue, { alreadyGranted: Boolean(product.collectedRepGranted) });
    stats.push({ label: "入库声望", value: rep > 0 ? `+${rep}` : product.collectedRepGranted ? "已领取" : "不加" });
  }
  const dialog = orderPickModalEl.querySelector('[role="dialog"]');
  dialog.className = "game-modal inventory-detail-modal order-pick-detail-modal";
  dialog.setAttribute("aria-labelledby", "orderPickDetailTitle");
  dialog.innerHTML = `
    <div class="game-modal-head"><div class="game-modal-title"><h3 id="orderPickDetailTitle">${escapeHtml(entry.name)}</h3><p>${escapeHtml(entry.typeLabel)}</p></div><button type="button" class="modal-close" data-action="backToOrderPickProducts" aria-label="关闭成品详情">×</button></div>
    <div class="game-modal-body">${inventoryItemDetailHtml(entry, { previewHtml: inventoryPreviewHtml(entry, { eager: true, size: "finished", renderProduct: productCanvas }), stats })}</div>
    <div class="game-modal-actions"><button type="button" class="secondary" data-action="backToOrderPickProducts">返回列表</button><button type="button" data-action="pickOrderProductOption" data-product-id="${escapeHtml(product.id)}">${pendingOrderPick.draftId === product.id ? "使用此件" : "选择此件"}</button></div>
  `;
  observeLazyPreviews(dialog);
  dialog.focus({ preventScroll: true });
  if (entry.unseen) socketRef.emit("markInventorySeen", { ids: [entry.id] });
}

function returnToOrderPickProducts() {
  const viewedId = orderPickDetailId;
  renderOrderPickPicker();
  orderPickModalEl?.querySelector(`[data-action="inspectOrderPickProduct"][data-product-id="${CSS.escape(viewedId)}"]`)?.focus({ preventScroll: true });
}

function selectOrderPickDraft(productId) {
  if (!pendingOrderPick) return;
  if (!finishedProducts().some((product) => product.id === productId)) return;
  const fromDetails = Boolean(orderPickDetailId);
  pendingOrderPick = { ...pendingOrderPick, draftId: !fromDetails && pendingOrderPick.draftId === productId ? "" : productId };
  if (fromDetails) returnToOrderPickProducts();
  else {
    renderOrderPickList();
    orderPickModalEl?.querySelector(`[data-action="pickOrderProductOption"][data-product-id="${CSS.escape(productId)}"]`)?.focus({ preventScroll: true });
  }
}

function confirmOrderProductPick() {
  const pending = pendingOrderPick;
  if (!pending) return;
  const { orderId, slot, draftId } = pending;
  if (!draftId || !finishedProducts().some((product) => product.id === draftId)) {
    renderOrderPickList();
    return;
  }
  setSlotSelection(orderId, slot, draftId);
  closeOrderPickModal();
  renderOrders();
  elsRef.orders?.querySelector?.(`[data-order-picker="${CSS.escape(orderId)}"][data-slot="${CSS.escape(slot)}"] .order-picker-btn`)?.focus();
}

function openOrderProductPicker(orderId, slot = "0") {
  if (!orderId) return;
  const order = (getState()?.me?.orders || []).find((item) => item.id === orderId);
  if (!order) return;
  const el = ensureOrderPickModal();
  orderPickQuery = "";
  orderPickTier = "full";
  orderPickSort = "fit";
  orderPickDetailId = "";
  orderPickScrollTop = 0;
  const current = getSlotSelection(order, Number(slot) || 0);
  pendingOrderPick = { orderId, slot: String(slot), draftId: current || "" };
  renderOrderPickPicker();
  el.classList.remove("is-hidden");
  el.setAttribute("aria-hidden", "false");
  if (typeof orderPickModalTeardown === "function") orderPickModalTeardown();
  orderPickModalTeardown = activateModalLifecycle({
    root: el,
    dialog: el.querySelector('[role="dialog"]'),
    onClose: () => orderPickDetailId ? returnToOrderPickProducts() : closeOrderPickModal()
  });
}

/** Open the best order for a product and carry it into the picker as a draft. */
export function focusOrdersForProduct(rawProductId) {
  const productId = String(rawProductId || "").trim();
  const product = finishedProducts().find((item) => String(item.id) === productId);
  const orders = getState()?.me?.orders || [];
  if (!product || !orders.length) {
    showToast?.({ text: "当前没有可承接这件成品的订单。", tone: "warn" });
    return false;
  }
  const tierRank = { full: 0, partial: 1, hard_fail: 2 };
  const order = [...orders].sort((a, b) => (
    (tierRank[evaluateOrderFit(product, a).tier] ?? 9)
    - (tierRank[evaluateOrderFit(product, b).tier] ?? 9)
  ))[0];
  openOrderProductPicker(order.id, "0");
  // A product carried in from inventory must remain visible even when it needs negotiation.
  orderPickTier = evaluateOrderFit(product, order).tier;
  pendingOrderPick = { ...pendingOrderPick, draftId: productId };
  renderOrderPickPicker();
  return true;
}

function orderProductPicker(order, bracelets, slotIndex) {
  const orderId = order.id;
  const qty = order.quantity || 1;
  const selectedId = getSlotSelection(order, slotIndex);
  const selected = bracelets.find((item) => item.id === selectedId);
  const emptyLabel = qty > 1 ? `选择成品 ${slotIndex + 1}/${qty}` : "选择成品";
  const selectedSummary = selected ? selected.name : emptyLabel;
  return `
    <div class="order-picker${selected ? " has-selection" : ""}" data-order-picker="${escapeHtml(orderId)}" data-slot="${slotIndex}">
      <input type="hidden" data-order-select="${escapeHtml(orderId)}" data-slot="${slotIndex}" value="${escapeHtml(selected?.id || "")}" />
      <button type="button" class="order-picker-btn" data-action="openOrderProductPicker" data-payload="${escapeHtml(orderId)}" data-slot="${slotIndex}">
        <span class="order-picker-copy"><span class="order-picker-label">${escapeHtml(selectedSummary)}</span>${selected && qty > 1 ? `<span class="order-picker-meta">第 ${slotIndex + 1} / ${qty} 件</span>` : ""}</span>
        <span class="order-picker-hint"${selected ? "" : " hidden"}>更换</span>
      </button>
    </div>
  `;
}

function closeMismatchModal() {
  if (!mismatchModalEl) return;
  mismatchModalEl.classList.add("is-hidden");
  mismatchModalEl.setAttribute("aria-hidden", "true");
  if (typeof mismatchModalTeardown === "function") {
    mismatchModalTeardown();
    mismatchModalTeardown = null;
  }
}

function ensureMismatchModal() {
  if (mismatchModalEl) return mismatchModalEl;
  const el = document.createElement("div");
  el.className = "modal-overlay is-hidden";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="modal order-mismatch-modal" role="dialog" aria-modal="true" aria-labelledby="orderMismatchTitle">
      <button class="modal-close" type="button" aria-label="关闭">×</button>
      <div class="modal-head">
        <div>
          <h3 id="orderMismatchTitle">订单不完全符合</h3>
          <p class="modal-sub order-mismatch-sub"></p>
        </div>
      </div>
      <div class="modal-body">
        <p class="modal-desc">当前成品未完全满足客人要求，交付后可能被打差评。</p>
        <p class="card-meta order-mismatch-temper"></p>
        <ul class="order-req-list order-mismatch-list"></ul>
      </div>
      <div class="modal-foot">
        <button class="modal-cancel" type="button">取消</button>
        <button class="modal-confirm" type="button">仍要交付</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  mismatchModalEl = el;
  el.querySelector(".modal-close").addEventListener("click", closeMismatchModal);
  el.querySelector(".modal-cancel").addEventListener("click", closeMismatchModal);
  return el;
}

export function previewOrderIncome(player, order, products, fit, now = Date.now()) {
  const estimate = estimateOrderSettlement(fit, order);
  const late = Number(order.expiresAt || 0) > 0 && now > Number(order.expiresAt);
  const basePay = Math.min(Number(order.pay || 0), systemSalePriceCap(player, products));
  const amount = Math.round(basePay * Number(estimate.payMult || 0) * (late ? 0.72 : 1));
  return { amount, late, estimate, demand: quoteSystemDemand(player, products, amount, now, { exempt: order.starterOrder === true }) };
}

function openMismatchConfirm({ order, fit, products, onConfirm }) {
  const el = ensureMismatchModal();
  const { estimate, amount: expectedPay, late } = previewOrderIncome(getState().me, order, products, fit);
  const settleHint = late
    ? `${estimate.payHint}；已超时，结算再打七二折，差评风险上升。`
    : estimate.payHint;
  el.querySelector("#orderMismatchTitle").textContent = fit.tier === "full" ? "确认交付" : "订单不完全符合";
  el.querySelector(".order-mismatch-sub").textContent = order.client || "";
  el.querySelector(".modal-desc").textContent =
    `${settleHint} 预计收入 ${formatMoney(expectedPay)}（${estimate.label}，已计系统客户限价，小费另计）`;
  el.querySelector(".order-mismatch-temper").textContent =
    `性格：${order.persona?.personality || "—"}（越计较越容易差评）`;
  const list = el.querySelector(".order-mismatch-list");
  const clauses = fit.clauses?.length
    ? fit.clauses
    : (fit.tier === "full" ? ["完全符合客人要求"] : ["订单要求未完全满足"]);
  list.innerHTML = clauses.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const confirmBtn = el.querySelector(".modal-confirm");
  const nextConfirm = confirmBtn.cloneNode(true);
  nextConfirm.textContent = fit.tier === "full" ? "确认交付" : "仍要交付";
  confirmBtn.parentNode.replaceChild(nextConfirm, confirmBtn);
  nextConfirm.addEventListener("click", () => {
    closeMismatchModal();
    onConfirm();
  });
  el.classList.remove("is-hidden");
  el.setAttribute("aria-hidden", "false");
  if (typeof mismatchModalTeardown === "function") mismatchModalTeardown();
  mismatchModalTeardown = activateModalLifecycle({
    root: el,
    dialog: el.querySelector('[role="dialog"]'),
    onClose: closeMismatchModal
  });
}

export function renderOrders() {
  const bracelets = finishedProducts();
  const me = getState().me;
  pruneOrderSlotSelections(me.orders);
  if (pendingOrderPick) {
    const stillThere = (me.orders || []).some((order) => order.id === pendingOrderPick.orderId);
    if (!stillThere) {
      closeOrderPickModal();
      if (typeof showToast === "function") showToast({ text: "订单已更新", tone: "info" });
    }
  }
  const completable = getState().me.orders.filter((order) => matchingBracelets(order).length >= (order.quantity || 1)).length;
  const dailyLeft = formatCountdown(msUntilNextOrderDailyRefresh());
  const refreshUsage = refreshCounts();
  const batchFee = batchRefreshFee();
  const batchExhausted = refreshUsage.batch >= ORDER_BATCH_REFRESH_DAILY_CAP;
  const batchAffordable = Number(me.cash || 0) >= batchFee;
  if (elsRef.orderBrief) {
    elsRef.orderBrief.innerHTML = `
      <span>可完成 ${completable}/${me.orders.length}</span>
      <span>成品库存 ${bracelets.length}</span>
    `;
  }
  if (elsRef.orderRefreshCountdown) {
    elsRef.orderRefreshCountdown.textContent = `距刷新 ${dailyLeft}`;
  }
  if (elsRef.refreshOrders) {
    elsRef.refreshOrders.disabled = batchExhausted || !batchAffordable;
    elsRef.refreshOrders.textContent = batchExhausted
      ? "今日整批刷新已用尽"
      : `全部刷新 ${formatMoney(batchFee)}`;
    elsRef.refreshOrders.title = batchExhausted
      ? `每日最多 ${ORDER_BATCH_REFRESH_DAILY_CAP} 次整批刷新`
      : batchAffordable
        ? `花费 ${formatMoney(batchFee)} 整池替换订单（今日 ${refreshUsage.batch}/${ORDER_BATCH_REFRESH_DAILY_CAP}）`
        : `现金不足，需要 ${formatMoney(batchFee)}`;
  }

  elsRef.orders.innerHTML = me.orders.map((order) => {
    const qty = order.quantity || 1;
    const slots = Array.from({ length: qty }, (_, index) => ({
      product: bracelets.find((item) => item.id === getSlotSelection(order, index)),
      html: orderProductPicker(order, bracelets, index)
    }));
    const selected = slots.filter((slot) => slot.product);
    const fits = selected.map((slot) => evaluateOrderFit(slot.product, order));
    const allSelected = selected.length === qty;
    const rejected = fits.some((fit) => fit.rejected || fit.tier === "hard_fail");
    const partial = fits.some((fit) => fit.tier === "partial");
    const worst = fits.reduce((acc, fit) => (!acc || (fit.tier === "hard_fail" ? 2 : fit.tier === "partial" ? 1 : 0) > (acc.tier === "hard_fail" ? 2 : acc.tier === "partial" ? 1 : 0) ? fit : acc), null);
    const preview = allSelected && !rejected ? previewOrderIncome(me, order, selected.map(slot => slot.product), worst) : null;
    const status = rejected ? { label: "条件不符", tone: "is-blocked" }
      : !allSelected ? { label: "待备货", tone: "is-waiting" }
      : partial ? { label: "可折价交付", tone: "is-partial" }
      : { label: "可交付", tone: "is-ready" };
    const canDeliver = bracelets.length >= qty && (!preview || preview.demand.ok);
    const reqHtml = requirementsBlock(order, qty === 1 ? selected[0]?.product : null);
    const feedback = rejected ? (worst.hardFails || worst.clauses || []).slice(0, 2).join("；")
      : partial ? (worst.aversionHits || worst.clauses || []).slice(0, 2).join("；")
      : "";
    const actions = !allSelected ? slots.filter((slot) => !slot.product).map((slot) => slot.html).join("")
      : rejected ? `<button type="button" class="secondary" data-action="openOrderProductPicker" data-payload="${escapeHtml(order.id)}" data-slot="${fits.findIndex((fit) => fit.rejected || fit.tier === "hard_fail")}">重新选择成品</button>`
      : `<button type="button" data-action="completeOrder" data-payload="${escapeHtml(order.id)}" aria-label="交付订单，预计收入 ${formatMoney(preview?.amount ?? order.pay)}，声望 +${Number(order.rep || 0)}" ${canDeliver ? "" : "disabled"}>${partial ? "折价交付" : "交付订单"}</button>`;
    return `
      <article class="order-card ${status.tone}" data-order-card="${escapeHtml(order.id)}">
        <div class="order-card-main">
          ${orderHeroBlock(order, status, refreshUsage)}
          <div class="order-budget"><span>${qty > 1 ? "单件预算" : "客人预算"}</span><strong>${order.hard?.budgetUnlimited ? "不限" : formatMoney(order.hard?.budgetMax ?? order.pay)}</strong></div>
          ${reqHtml}
        </div>
        <div class="order-card-foot">
          <div class="order-delivery-choice">
            <div class="order-selects">${selected.map((slot) => slot.html).join("")}</div>
            ${!allSelected && selected.length ? `<p class="order-stock-note">已选 ${selected.length}/${qty} 件</p>` : ""}
            ${feedback ? `<p class="order-fit-feedback ${status.tone}">${rejected ? "×" : partial ? "!" : "✓"} ${escapeHtml(feedback)}</p>` : ""}
            ${preview && !preview.demand.ok ? `<p class="order-stock-note">${escapeHtml(preview.demand.message)}</p>` : ""}
          </div>
          <div class="order-card-meta">
            ${orderPersonaBlock(order)}
            <span class="order-reputation">声望 +${Number(order.rep || 0)}</span>
          </div>
          ${preview ? `<div class="order-settlement" aria-label="订单回报">
            <div class="order-settlement-primary">
              <span>预计收入</span>
              <strong>${formatMoney(preview.amount)}</strong>
            </div>
          </div>` : ""}
          <div class="card-actions order-card-actions">
            ${actions}
          </div>
        </div>
      </article>
    `;
  }).join("") || `
    <div class="game-empty-state order-empty-state">
      <span class="game-empty-state-mark" aria-hidden="true">单</span>
      <strong>当前没有客户订单</strong>
      <p>等待订单池刷新期间，可以先在工坊准备成品。</p>
      <button type="button" data-view-link="workshop">去工坊准备</button>
    </div>`;
  observeLazyPreviews(elsRef.orders);
}

export function ordersComplete(target, payload) {
  const values = [...document.querySelectorAll(`[data-order-select="${CSS.escape(payload)}"]`)]
    .map((select) => select.value)
    .filter(Boolean);
  const order = (getState().me.orders || []).find((item) => item.id === payload);
  if (!order) return;
  if (values.length < (order.quantity || 1)) {
    if (typeof showToast === "function") showToast("请先选择要交付的成品。");
    return;
  }
  const products = values
    .map((id) => finishedProducts().find((item) => item.id === id))
    .filter(Boolean);
  if (products.length < values.length) return;

  const fits = products.map((item) => evaluateOrderFit(item, order));
  const tierRank = { full: 0, partial: 1, hard_fail: 2 };
  const worst = fits.reduce((acc, fit) => (tierRank[fit.tier] > tierRank[acc.tier] ? fit : acc), fits[0]);

  const emit = () => socketRef.emit("completeOrder", { orderId: payload, braceletIds: values });
  if (worst.tier === "hard_fail" || worst.rejected) {
    const reason = (worst.hardFails || worst.clauses || []).slice(0, 2).join("；") || "硬条件不符";
    if (typeof showToast === "function") showToast(`无法交付：${reason}`);
    return;
  }
  const preview = previewOrderIncome(getState().me, order, products, worst);
  if (!preview.demand.ok) { showToast?.(preview.demand.message); return; }
  openMismatchConfirm({
    order,
    fit: worst,
    products,
    onConfirm: emit
  });
}

export function confirmBatchRefreshOrders() {
  const counts = refreshCounts();
  if (counts.batch >= ORDER_BATCH_REFRESH_DAILY_CAP) {
    showToast?.({ text: "今日批量刷新次数已用尽。", tone: "warn" });
    return;
  }
  const fee = batchRefreshFee();
  if (Number(getState()?.me?.cash || 0) < fee) {
    showToast?.({ text: `批量刷新需要 ${formatMoney(fee)}。`, tone: "warn" });
    return;
  }
  if (typeof openGameModal !== "function") {
    socketRef.emit("refreshOrders");
    return;
  }
  openGameModal({
    title: "全部刷新",
    tone: "warn",
    body: [
      `花费 ${formatMoney(fee)} 刷新全部订单？`,
      "当前订单池会被整批替换。"
    ],
    actions: [
      { label: "确认刷新", variant: "warn", clientAction: "confirmOrdersBatchRefresh" },
      { label: "取消", variant: "secondary" }
    ]
  });
}
