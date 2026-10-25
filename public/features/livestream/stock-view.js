import { hostBonusPreview, hostBonusesFromWorker, recommendLivestreamHost } from "../../livestream-host-bonuses.js";
import { renderResourceCard } from "../../resource-card-view.js";
import { workerJobLabel } from "../../worker-detail-view.js";
import { employeePayrollStatus } from "../../worker-economy.js";
import { nowMs as payrollNowMs } from "../../shell/format-utils.js";
import { finishedProductCardContent } from "../../finished-product-card-view.js";
import { LIVESTREAM_MIN_PRICE, LIVESTREAM_MIN_ITEMS as MIN_ROOM_ITEMS, LIVESTREAM_MAX_ITEMS as MAX_ROOM_ITEMS } from "../../livestream-rules.js";
import { BASE_DURATION_MINUTES, MAX_DURATION_MINUTES, skillLevel } from "./catalog.js";

export function createLivestreamStockView({ getState, ui, helpers, ports }) {
  const { selectedProductIds, priceDrafts } = ui;
  const { formatMoney, escapeHtml, productCanvas } = helpers;
  const { draftPrice, resolveModalHost, selectionSummary, sortHostsForPicker, visibleStockProducts } = ports;

function hostRowButton(worker, { selected, recommended, action = "select-host" }) {
  const busy = Boolean(worker.busy);
  const preview = hostBonusPreview(hostBonusesFromWorker(worker).bonuses);
  return renderResourceCard({
    type: "employee", name: worker.name, tag: "button",
    badge: busy ? "忙碌中" : selected ? "已选主播" : recommended ? "推荐主播" : "可选主播",
    className: `livestream-host-row ${selected ? "is-selected" : ""} ${busy ? "is-busy" : ""} ${recommended ? "is-recommended" : ""}`,
    attributes: `type="button" role="option" aria-selected="${Boolean(selected)}" data-livestream-action="${action}" data-worker-id="${escapeHtml(worker.id)}" ${busy ? "disabled" : ""}`,
    summary: [`${workerJobLabel(worker.job)} · ${Number(worker.tier) || 1}阶`],
    body: `<span class="livestream-host-row-stats">
          <b>转化 +${preview.convertPct}%</b>
          <b>流速 +${preview.trafficPct}%</b>
        </span>
        <span class="livestream-host-row-skills">话术 Lv.${skillLevel(worker, "huashu")} · 控场 Lv.${skillLevel(worker, "kongchang")} · 催单 Lv.${skillLevel(worker, "cuidan")}</span>
    `
  });
}

function hostModalMarkup(hosts, modalHost) {
  const recommended = hosts.length ? recommendLivestreamHost(hosts) : null;
  const ordered = hosts.length ? sortHostsForPicker(hosts, recommended?.id) : [];
  return `
    <div class="jm-modal-root livestream-host-modal-root" role="dialog" aria-modal="true" aria-label="挑选带货主播">
      <div class="jm-modal jm-modal-wide livestream-host-modal">
        <div class="jm-modal-head">
          <h3>挑选带货主播</h3>
          <button class="jm-modal-x" type="button" data-livestream-action="close-host-modal" aria-label="关闭">×</button>
        </div>
        <div class="jm-modal-body">
          ${hosts.length
            ? `
              <div class="livestream-host-list" role="listbox" aria-label="可选主播">
                <button class="livestream-host-row ${modalHost ? "" : "is-selected"}"
                  type="button"
                  role="option"
                  aria-selected="${modalHost ? "false" : "true"}"
                  data-livestream-action="clear-modal-host">
                  <span class="livestream-host-radio" aria-hidden="true"></span>
                  <span class="livestream-host-row-body">
                    <span class="livestream-host-row-top">
                      <strong>不添加主播</strong>
                      <span class="livestream-host-row-job">无员工加成</span>
                    </span>
                    <span class="livestream-host-row-stats">
                      <b>转化 +0%</b>
                      <b>流速 +0%</b>
                    </span>
                    <span class="livestream-host-row-skills">先上架试水，稍后再安排主播</span>
                  </span>
                  <span class="livestream-host-row-check" aria-hidden="true">${modalHost ? "" : "✓"}</span>
                </button>
                ${ordered.map((worker) => hostRowButton(worker, {
                  selected: modalHost?.id === worker.id,
                  recommended: recommended?.id === worker.id,
                  action: "select-modal-host"
                })).join("")}
              </div>
            `
            : `<div class="game-empty-state is-compact">
                <span class="game-empty-state-mark" aria-hidden="true">人</span>
                <strong>暂时没有可用主播</strong>
                <p>可以不添加主播直接开播；若想获得主播加成，先去员工页招募。</p>
              </div>`}
        </div>
        <div class="jm-modal-foot">
          <button class="jm-btn-ghost" type="button" data-livestream-action="close-host-modal">取消</button>
          <button class="jm-btn-gold" type="button" data-livestream-action="confirm-host-modal">确认</button>
        </div>
      </div>
    </div>
  `;
}

function startHostBarMarkup(selectedHost, canStart, count) {
  const stopped = employeePayrollStatus(getState()?.me, payrollNowMs()) === "stopped";
  return `
    <div class="livestream-start-bar">
      <div class="livestream-host-status">
        <button type="button" class="ghost" data-livestream-action="open-host-modal">选择主播</button>
        ${selectedHost
          ? `<span class="livestream-host-picked">已选：${escapeHtml(selectedHost.name)}</span>`
          : `<span class="livestream-host-picked is-muted">默认不选择主播</span>`}
      </div>
      <button type="button" data-livestream-action="start" ${canStart && !stopped ? "" : "disabled"}>
        ${stopped ? "员工已停工" : canStart ? `开启直播（${count} 件）` : "至少选择 3 件"}
      </button>
    </div>
  `;
}

function stockRowMarkup(item, capacity) {
  const selected = selectedProductIds.has(item.id);
  const price = draftPrice(item);
  const atCap = !selected && selectedProductIds.size >= capacity;
  return `
    <article class="inventory-slot order-pick-card livestream-stock-row ${selected ? "is-selected" : ""}" data-product-id="${escapeHtml(item.id)}">
      <label class="order-pick-inspect livestream-stock-select">
        <input type="checkbox" data-livestream-select="${escapeHtml(item.id)}" aria-label="选择${escapeHtml(item.name || "翡翠成品")}"
          ${selected ? "checked" : ""} ${atCap ? "disabled" : ""}>
        ${finishedProductCardContent(item, { escapeHtml, formatMoney, renderProduct: productCanvas,
          selectionHtml: '<span class="livestream-stock-check" aria-hidden="true">✓</span>'
        })}
      </label>
      <div class="order-pick-fit livestream-stock-pricing">
      <label class="livestream-price-field">
        <span>直播价</span>
        <input type="number" min="${LIVESTREAM_MIN_PRICE}" step="1" inputmode="numeric"
          data-livestream-price="${escapeHtml(item.id)}"
          value="${price}" aria-label="${escapeHtml(item.name || "成品")}直播价">
      </label>
      </div>
    </article>
  `;
}

function stockPickerMarkup(products, { mode, capacity, selectedHost = null }) {
  const isStart = mode === "start";
  const action = isStart ? "start" : "replenish";
  const title = isStart ? "选择首批直播商品" : "继续补货";
  const replenishHint = isStart ? "" : `本场还可补 ${capacity} 件，补货后会直接加入轮播。`;
  const summary = selectionSummary(products);
  const visibleProducts = visibleStockProducts(products);
  const selectable = visibleProducts.slice(0, Math.max(0, capacity));
  const allSelected = selectable.length > 0
    && selectable.every((item) => selectedProductIds.has(item.id));
  const canStart = isStart && summary.count >= MIN_ROOM_ITEMS && summary.count <= capacity
    && [...selectedProductIds].every((id) => {
      const price = Number(priceDrafts.get(id));
      return Number.isInteger(price) && price >= LIVESTREAM_MIN_PRICE;
    });

  if (!products.length) {
    return `
      <section class="livestream-stock-picker is-empty" data-picker-mode="${mode}" data-capacity="${capacity}">
        <div class="livestream-picker-head">
          <div><p class="eyebrow">${isStart ? "开播准备" : "库存补充"}</p><h3>${title}</h3></div>
        </div>
        <div class="game-empty-state livestream-stock-empty">
          <span class="game-empty-state-mark" aria-hidden="true">播</span>
          <strong>还没有可上架的成品</strong>
          <p>先在工坊完成精加工，至少准备 ${MIN_ROOM_ITEMS} 件成品即可开播；单场 ${BASE_DURATION_MINUTES} 分钟，成交可延长至 ${MAX_DURATION_MINUTES} 分钟。</p>
          <button type="button" data-view-link="workshop">去工坊备货</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="livestream-wizard livestream-stock-picker" data-picker-mode="${mode}" data-capacity="${capacity}">
      <div class="livestream-picker-toolbar">
        ${!isStart
          ? `
            <div class="livestream-picker-head">
              <div>
                <p class="eyebrow">直播中可随时补货</p>
                <h3>${title}</h3>
                ${replenishHint ? `<p>${replenishHint}</p>` : ""}
              </div>
            </div>
          `
          : ""}
        <div class="livestream-price-tools" role="group" aria-label="一键定价">
          <label class="livestream-select-all${allSelected ? " is-checked" : ""}" title="全选 / 取消全选">
            <input type="checkbox" data-livestream-select-all ${allSelected ? "checked" : ""}
              aria-label="全选商品">
            <span class="livestream-stock-check" aria-hidden="true">✓</span>
          </label>
          <div class="livestream-price-tools-actions">
            <button type="button" class="ghost" data-livestream-action="price-preset" data-price-mult="1">按估值</button>
            <button type="button" class="ghost" data-livestream-action="price-preset" data-price-mult="1.05">估值+5%</button>
            <button type="button" class="ghost" data-livestream-action="price-preset" data-price-mult="1.15">估值+15%</button>
            <span>作用于已勾选商品</span>
          </div>
          <div class="livestream-picker-count">
            <strong data-livestream-selected-count>${summary.count}/${capacity}</strong>
            <span>已选择</span>
          </div>
        </div>
        <div class="item-picker-tools livestream-stock-tools">
          <input type="search" value="${escapeHtml(ui.stockPickerQuery)}" data-livestream-stock-search placeholder="搜索名称、种水或颜色" aria-label="搜索直播商品">
          <select data-livestream-stock-filter aria-label="筛选选择状态">
            <option value="all" ${ui.stockPickerFilter === "all" ? "selected" : ""}>全部状态</option>
            <option value="selected" ${ui.stockPickerFilter === "selected" ? "selected" : ""}>已选择</option>
            <option value="unselected" ${ui.stockPickerFilter === "unselected" ? "selected" : ""}>未选择</option>
          </select>
          <select data-livestream-stock-sort aria-label="直播商品排序">
            <option value="valueDesc" ${ui.stockPickerSort === "valueDesc" ? "selected" : ""}>估值从高到低</option>
            <option value="valueAsc" ${ui.stockPickerSort === "valueAsc" ? "selected" : ""}>估值从低到高</option>
            <option value="selected" ${ui.stockPickerSort === "selected" ? "selected" : ""}>已选优先</option>
            <option value="name" ${ui.stockPickerSort === "name" ? "selected" : ""}>名称</option>
          </select>
          <span class="item-picker-result" aria-live="polite">显示 ${visibleProducts.length}/${products.length} 件</span>
        </div>
      </div>
      <div class="livestream-stock-list">
        ${visibleProducts.length
          ? visibleProducts.map((item) => stockRowMarkup(item, capacity)).join("")
          : `<div class="game-empty-state livestream-filter-empty"><strong>没有符合条件的成品</strong><p>换个关键词或选择“全部状态”。</p></div>`}
      </div>
      <div class="livestream-picker-dock">
        <div class="livestream-stock-summary">
          <span>${summary.count} 件 · 总标价 <b>${formatMoney(summary.totalPrice)}</b> · 均价相对估值 ${escapeHtml(summary.pctLabel)}</span>
        </div>
        ${isStart
          ? startHostBarMarkup(selectedHost, canStart, summary.count)
          : `
            <div class="livestream-picker-actions">
              <span>已售商品不会被补货操作影响。</span>
              <button type="button" data-livestream-action="${action}" disabled>
                选择要补货的成品
              </button>
            </div>
          `}
      </div>
    </section>
  `;
}

function startWizardMarkup(hosts, selectedHost, products) {
  return `
    ${stockPickerMarkup(products, { mode: "start", capacity: MAX_ROOM_ITEMS, selectedHost })}
    ${ui.hostModalOpen ? hostModalMarkup(hosts, resolveModalHost()) : ""}
  `;
}

  return { hostRowButton, hostModalMarkup, startHostBarMarkup, stockRowMarkup, stockPickerMarkup, startWizardMarkup };
}
