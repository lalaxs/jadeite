// extra-module.js — 从 main.js 解耦（依赖注入模式）
// state→getState()、els→elsRef、socket→socketRef，共享 helper 经 deps.helpers 注入。
// 后端 server.js 不受影响。

let socketRef, getState, elsRef, getActiveView;
let activeShopTab = "building";

let currentReportSummary, formatMoney, escapeHtml, empty, productCanvas, formatNumber;

export function initExtraModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ currentReportSummary, formatMoney, escapeHtml, empty, productCanvas, formatNumber } = deps.helpers);
  initShopTabs();
}

// ---- 以下函数原定义于 main.js ----

export function renderOfflineSummary() {
  const summary = getState()?.me?.offlineSummary;
  if (!summary || !Number(summary.count)) return "";
  const lines = Array.isArray(summary.lines) ? summary.lines : [];
  return `
    <section class="offline-summary">
      <div class="offline-head"><h3>离线结算</h3><span>${Number(summary.count)} 件事已完成</span></div>
      <div class="offline-totals">
        <span>收入 ${formatMoney(summary.income)}</span>
        <span>支出 ${formatMoney(summary.expense)}</span>
      </div>
      <div class="offline-lines">
        ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      </div>
    </section>
  `;
}

export function renderShop() {
  try {
    if (!elsRef.shopListings || !getState()) {
      if (elsRef.shopListings) elsRef.shopListings.innerHTML = empty("等待商铺数据…");
      if (elsRef.materialInventory) elsRef.materialInventory.innerHTML = `<div class="mat-empty">等待商铺数据…<br>若长时间未加载，请重启服务器并强制刷新浏览器(Ctrl+Shift+R)。</div>`;
      return;
    }
    const assetListings = getState().assetListings || [];
    elsRef.shopBrief.innerHTML = `<span>可购内容 ${assetListings.length}</span><span>工坊 ${getState().me.assets?.workshopOwned ? "已拥有" : "未拥有"}</span><span>直播许可 ${getState().me.assets?.livestreamPermitOwned ? "已拥有" : "未拥有"}</span>`;
    elsRef.shopListings.innerHTML = assetListings.map((listing) => `
      <div class="item-row asset-listing">
        <div class="item-title"><span>${escapeHtml(listing.name)}</span><span class="pill">${formatMoney(listing.price)}</span></div>
        <p class="item-meta">${escapeHtml(listing.description)}</p>
        <div class="card-actions"><button data-action="buyAssetListing" data-payload="${listing.id}">购买</button></div>
      </div>
    `).join("") || empty("商铺暂无可购买内容。");

    // ---- 镶嵌材料（§20 / 设计案 §3）：竖排条目 + 购买弹窗 + 历史趋势 ----
    if (!elsRef.materialInventory) return;
    const cat = getState().materialCatalog || [];
    const inv = getState().me.externalMaterials || {};
    if (!cat.length) {
      elsRef.materialInventory.innerHTML = `<div class="mat-empty">商铺材料目录未加载。<br>常见原因：① 服务器未重启；② 浏览器缓存旧 JS。<br>请重启服务器后按 Ctrl+Shift+R 强制刷新。</div>`;
      return;
    }
    const rowHtml = (m) => {
      const held = Math.round(Number(inv[m.key] || 0));
      return `
        <article class="mat-card" data-material-id="${m.id}">
          <div class="mat-art" style="--tint:${escapeHtml(m.tint || "#30a669")}">
            <span class="mat-art-tag">${escapeHtml(m.unitLabel)}</span>
          </div>
          <div class="mat-info">
            <div class="mat-title-row">
              <h3 class="mat-name">${escapeHtml(m.name)}</h3>
              <button class="mat-buy-btn" data-material-id="${m.id}">购买</button>
            </div>
            <p class="mat-sub">持有 ${formatNumber(held)}${m.unitLabel} · 当前单价 ${formatMoney(m.price)}</p>
            <div class="mat-prices">
              <div class="mat-price">
                <span>当前单价</span>
                <strong>${formatMoney(m.price)}<i>/${m.unitLabel}</i></strong>
              </div>
              <div class="mat-price">
                <span>我的持有</span>
                <strong>${formatNumber(held)}<i>${m.unitLabel}</i></strong>
              </div>
            </div>
            <button class="mat-history-btn secondary" data-material-id="${m.id}">历史价格趋势</button>
          </div>
        </article>
      `;
    };
    elsRef.materialInventory.innerHTML = `<div class="mat-list">${cat.map(rowHtml).join("")}</div>`;
    applyShopTab();
  } catch (err) {
    console.error("[renderShop] 渲染失败:", err);
    if (elsRef.materialInventory) {
      elsRef.materialInventory.innerHTML = `<div class="mat-empty" style="color:#c76046">商铺渲染出错：${escapeHtml(String(err?.message || err))}<br>请按 F12 → Console 查看详情。</div>`;
    }
  }
}

// ---- 商铺页签切换 + 材料自由数量购买 ----
function initShopTabs() {
  const shopView = document.querySelector('[data-view="shop"]');
  if (!shopView) return;
  shopView.addEventListener("click", onShopClick);
}
function onShopClick(e) {
  const tabBtn = e.target.closest(".shop-tab");
  if (tabBtn) {
    activeShopTab = tabBtn.dataset.tab;
    applyShopTab();
    return;
  }
  const buyBtn = e.target.closest(".mat-buy-btn");
  if (buyBtn) {
    openBuyModal(buyBtn.dataset.materialId);
    return;
  }
  const histBtn = e.target.closest(".mat-history-btn");
  if (histBtn) {
    openHistoryModal(histBtn.dataset.materialId);
    return;
  }
}
function applyShopTab() {
  const shopView = document.querySelector('[data-view="shop"]');
  if (!shopView) return;
  shopView.querySelectorAll(".shop-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === activeShopTab);
  });
  shopView.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("is-hidden", p.dataset.tabPanel !== activeShopTab);
  });
}

// ---- 镶嵌材料：购买弹窗 / 历史价格趋势 ----
function getMaterialById(id) {
  const cat = getState().materialCatalog || [];
  return cat.find((m) => m.id === id) || null;
}
function closeShopModal() {
  const el = document.getElementById("shopModal");
  if (el) { el.classList.add("is-hidden"); el.innerHTML = ""; }
}
function ensureModalShell() {
  let el = document.getElementById("shopModal");
  if (!el) {
    el = document.createElement("div");
    el.id = "shopModal";
    el.className = "modal-overlay is-hidden";
    document.body.appendChild(el);
  }
  return el;
}
function openBuyModal(id) {
  const m = getMaterialById(id);
  if (!m) return;
  const el = ensureModalShell();
  const held = Math.round(Number((getState().me.externalMaterials || {})[m.key] || 0));
  const cash = Number(getState().me.cash || 0);
  const quick = m.unit === "g" ? [1, 5, 10, 50, 100] : [1, 5, 10, 20, 50];
  el.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-close" aria-label="关闭">×</button>
      <div class="modal-head">
        <div class="mat-thumb lg" style="--tint:${escapeHtml(m.tint || "#30a669")}"></div>
        <div>
          <h3>${escapeHtml(m.name)}</h3>
          <p class="modal-sub">商铺供货 · 现实金价</p>
        </div>
      </div>
      <div class="modal-body">
        <p class="modal-desc">${escapeHtml(m.description)}</p>
        <div class="modal-stats">
          <div><span>当前单价</span><b>${formatMoney(m.price)} / ${m.unitLabel}</b></div>
          <div><span>我的持有</span><b>${formatNumber(held)}${m.unitLabel}</b></div>
          <div><span>可用现金</span><b>${formatMoney(cash)}</b></div>
        </div>
        <div class="qty-block">
          <label>购买数量（${m.unitLabel}，≥1）</label>
          <div class="qty-input-row">
            <input type="number" class="modal-qty" min="1" step="1" value="1" />
            <span class="modal-unit">${m.unitLabel}</span>
          </div>
          <div class="quick-row">
            ${quick.map((q) => `<button class="quick-qty" data-q="${q}">${q}</button>`).join("")}
          </div>
        </div>
        <div class="modal-total">合计：<b class="total-val">${formatMoney(m.price)}</b></div>
        <div class="modal-warn is-hidden">现金不足，无法购买。</div>
      </div>
      <div class="modal-foot">
        <button class="modal-cancel">取消</button>
        <button class="modal-confirm">确认购买</button>
      </div>
    </div>
  `;
  el.classList.remove("is-hidden");
  const qtyInput = el.querySelector(".modal-qty");
  const totalVal = el.querySelector(".total-val");
  const warn = el.querySelector(".modal-warn");
  const confirmBtn = el.querySelector(".modal-confirm");
  const recompute = () => {
    const q = Math.floor(Number(qtyInput.value)) || 0;
    const total = Math.round(m.price * q);
    totalVal.textContent = formatMoney(total);
    const insufficient = q >= 1 && total > cash;
    warn.classList.toggle("is-hidden", !insufficient);
    confirmBtn.disabled = q < 1 || total > cash;
  };
  qtyInput.addEventListener("input", recompute);
  el.querySelectorAll(".quick-qty").forEach((b) => {
    b.addEventListener("click", () => { qtyInput.value = b.dataset.q; recompute(); });
  });
  confirmBtn.addEventListener("click", () => {
    const q = Math.floor(Number(qtyInput.value)) || 0;
    if (q < 1) return;
    if (socketRef) socketRef.emit("buyMaterialPack", id, q);
    closeShopModal();
  });
  el.querySelector(".modal-close").addEventListener("click", closeShopModal);
  el.querySelector(".modal-cancel").addEventListener("click", closeShopModal);
  recompute();
}
function openHistoryModal(id) {
  const m = getMaterialById(id);
  if (!m) return;
  const el = ensureModalShell();
  el.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-close" aria-label="关闭">×</button>
      <div class="modal-head">
        <div class="mat-thumb lg" style="--tint:${escapeHtml(m.tint || "#30a669")}"></div>
        <div>
          <h3>${escapeHtml(m.name)} · 历史价格趋势</h3>
          <p class="modal-sub">${m.unitLabel}单价 · 基准 ${formatMoney(m.price)}</p>
        </div>
      </div>
      <div class="modal-body">
        <div class="spark-wrap"><div class="spark-loading">加载中…</div></div>
        <div class="modal-stats hist-stats"></div>
        <p class="modal-note">注：价格引擎接入前，历史为基准价基线（含轻微波动模拟）；正式版将按游戏日记录真实买卖驱动的涨跌。</p>
      </div>
      <div class="modal-foot">
        <button class="modal-cancel">关闭</button>
      </div>
    </div>
  `;
  el.classList.remove("is-hidden");
  el.querySelector(".modal-close").addEventListener("click", closeShopModal);
  el.querySelector(".modal-cancel").addEventListener("click", closeShopModal);
  if (socketRef) {
    socketRef.emit("getMaterialHistory", m.key, (data) => {
      if (!data || !data.ok) { el.querySelector(".spark-loading").textContent = "暂无历史数据。"; return; }
      el.querySelector(".spark-wrap").innerHTML = buildSparkline(data.history, data.base);
      const prices = (data.history || []).map((h) => Number(h.p));
      const first = prices[0] || data.base;
      const last = prices[prices.length - 1] || data.current;
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const change = first ? ((last - first) / first) * 100 : 0;
      const up = last >= first;
      el.querySelector(".hist-stats").innerHTML = `
        <div><span>基准价</span><b>${formatMoney(data.base)}</b></div>
        <div><span>当前价</span><b>${formatMoney(data.current)}</b></div>
        <div><span>区间</span><b>${formatMoney(min)} ~ ${formatMoney(max)}</b></div>
        <div><span>涨跌幅</span><b style="color:${up ? "#e0556b" : "#30a669"}">${up ? "▲" : "▼"} ${Math.abs(change).toFixed(2)}%</b></div>
      `;
    });
  }
}
function buildSparkline(history, base) {
  const pts = (history || []).map((h) => Number(h.p));
  if (!pts.length) return `<div class="spark-empty">暂无数据</div>`;
  const W = 300, H = 96, pad = 10;
  const n = pts.length;
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = (max - min) || 1;
  const x = (i) => pad + (W - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1));
  const y = (p) => pad + (H - 2 * pad) * (1 - (p - min) / range);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`;
  const up = pts[n - 1] >= pts[0];
  const color = up ? "#e0556b" : "#30a669";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${area}" fill="${color}" opacity="0.12" />
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(pts[n - 1]).toFixed(1)}" r="3.5" fill="${color}" />
  </svg>`;
}
// 全局关闭：点遮罩 / 按 ESC
document.addEventListener("click", (e) => {
  if (e.target.classList && e.target.classList.contains("modal-overlay")) closeShopModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeShopModal();
});

export function renderReports() {
  const report = currentReportSummary();
  const advice = Array.isArray(report.advice) ? report.advice : [];
  elsRef.reports.innerHTML = `
    <section class="panel report-card">
      <div class="panel-head"><h3>核心财务</h3><span>当前周期</span></div>
      <div class="report-metrics">
        <div><span>收入</span><strong>${formatMoney(report.income)}</strong></div>
        <div><span>支出</span><strong>${formatMoney(report.expense)}</strong></div>
        <div><span>净利润</span><strong>${formatMoney(report.net)}</strong></div>
        <div><span>库存占用</span><strong>${formatMoney(report.inventoryValue)}</strong></div>
      </div>
      <div class="fit-list">${advice.map((item) => `<div><span>${escapeHtml(item)}</span></div>`).join("")}</div>
    </section>
  `;
}

export function renderCollection() {
  elsRef.collectionList.innerHTML = getState().me.collection.map((item) => `
    <article class="treasure-card">
      ${productCanvas(item, "finished showcase")}
      <h3>${escapeHtml(item.name)}</h3>
      <p class="card-meta">${escapeHtml(item.quality)} · ${escapeHtml(item.color)} · 门面声望 ${item.rep}</p>
      <div class="price">${formatMoney(item.value)}</div>
    </article>
  `).join("") || empty("还没有藏品，把好手镯收入藏宝阁即可提升门面。");
}

// ---- dispatch 动作封装（原 main.js 内联分支迁入）----
