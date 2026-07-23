// 交易行系统模块（从 main.js 抽离，依赖注入解耦，复用公盘样板）
// 内部状态 marketUi / marketFiltersBound 与常量 MARKET_* 均为本模块私有，不再污染 main.js 全局。

import { inlaySummary } from "./product-meta.js";

let socketRef = null;
let getState = () => null;
let elsRef = null;
let getActiveView = () => "overview";
let formatMoney, escapeHtml, empty, showToast, typeName;

// 交易行客户端 UI 状态（筛选/排序/页签/弹窗选中）
const marketUi = {
  section: "listings", // listings（集市挂单） | mine（我的挂单） | want（求购）
  cat: "all",
  search: "",
  sort: "latest",
  q: new Set(),
  min: null,
  max: null,
  afford: false,
  buyId: null
};
let marketFiltersBound = false;
const MARKET_TAX = 0.03;

// 种水稀有度定义（key → 名称/星级/色阶；对齐 server.js qualities）
const MARKET_QUALITY = {
  bean: { name: "豆种", stars: "★", color: "var(--q-bean)", score: 1 },
  glutinous: { name: "糯种", stars: "★★", color: "var(--q-glutinous)", score: 2 },
  icy: { name: "冰种", stars: "★★★", color: "var(--q-icy)", score: 3 },
  glass: { name: "玻璃种", stars: "★★★★", color: "var(--q-glass)", score: 4 },
  imperial: { name: "帝王绿", stars: "★★★★★", color: "var(--q-imperial)", score: 5 },
  violet: { name: "紫罗兰", stars: "★★★", color: "var(--q-violet)", score: 3 },
  red: { name: "红翡", stars: "★★★", color: "var(--q-red)", score: 3 },
  ink: { name: "墨翠", stars: "★★★", color: "var(--q-ink)", score: 3 }
};
const MARKET_STALLS = [
  { id: "all", label: "全部", color: "var(--jade)" },
  { id: "rough", label: "原石", color: "var(--q-bean)" },
  { id: "material", label: "明料", color: "var(--q-glutinous)" },
  { id: "slice", label: "片料", color: "var(--q-icy)" },
  { id: "bracelet", label: "成品", color: "var(--q-imperial)" }
];
// 求购告示（规划中，前端示例数据；应征按钮仅提示）
const MARKET_WANTS_SAMPLE = [
  { id: "W1", name: "求购：冰种飘花手镯", detail: "预算 ≤ ¥50,000，无裂、圈口 56–58", by: "玲珑阁", reward: "价高者得" },
  { id: "W2", name: "求购：满绿精加工套件", detail: "需可出≥2件，种水老，私聊议价", by: "玉作工坊", reward: "长期收" },
  { id: "W3", name: "求购：紫罗兰蛋面 8mm+", detail: "颜色浓、起荧优先，价高 ¥12,000", by: "翡冷翠", reward: "价高者得" }
];
/* ---------- 交易行助手 ---------- */
// 解析种水 key：优先按颜色名识别特色种（紫罗兰/红翡/墨翠/帝王绿），否则用 qualityKey / score 映射
export function marketQualityKey(item = {}) {
  const color = String(item.color || "");
  if (color.includes("紫")) return "violet";
  if (color.includes("红")) return "red";
  if (color.includes("墨")) return "ink";
  if (item.qualityKey && MARKET_QUALITY[item.qualityKey]) return item.qualityKey;
  const byScore = { 1: "bean", 2: "glutinous", 3: "icy", 4: "glass", 5: "imperial" };
  return byScore[Number(item.score)] || "glutinous";
}
export function marketQualityMeta(item = {}) {
  return MARKET_QUALITY[marketQualityKey(item)] || MARKET_QUALITY.glutinous;
}
// 立绘颜色类
export function marketGemColor(item = {}) {
  const color = String(item.color || "");
  if (color.includes("紫")) return "violet";
  if (color.includes("红")) return "red";
  if (color.includes("墨")) return "ink";
  if (color.includes("帝王") || color.includes("黄")) return "gold";
  if (color.includes("白") || color.includes("无色")) return "white";
  const key = marketQualityKey(item);
  if (key === "icy") return "ice";
  if (key === "imperial") return "gold";
  return "green";
}
export function marketRefValue(item = {}) {
  return Number(item.value || item.price || 0);
}
export function marketPriceDelta(price, ref) {
  const diff = Number(price) - Number(ref || 0);
  if (!ref) return { cls: "flat", txt: "无参考价" };
  if (diff < -1) return { cls: "down", txt: `↓ 便宜 ${formatMoney(-diff)}` };
  if (diff > ref * 0.08) return { cls: "up", txt: `↑ 偏贵 ${formatMoney(diff)}` };
  return { cls: "flat", txt: "接近参考价" };
}
export function marketElapsed(createdAt) {
  const ms = Date.now() - Number(createdAt || Date.now());
  if (ms < 60000) return "刚刚上架";
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)} 分钟前`;
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}
// 汇总玩家可挂牌库存（原石/明料/片料/成品四桶）
export function marketSellables() {
  const me = getState().me;
  return [
    ...(me.rough || []).map((item) => ({ ...item, _type: "rough" })),
    ...(me.materials || []).map((item) => ({ ...item, _type: "material" })),
    ...(me.slices || []).map((item) => ({ ...item, _type: "slice" })),
    ...(me.bracelets || []).map((item) => ({ ...item, _type: "bracelet" }))
  ];
}
export function marketAffordable(price) {
  return Number(getState().me.cash || 0) >= Math.round(Number(price) * (1 + MARKET_TAX));
}

/* ---------- 交易行主渲染 ---------- */
export function renderMarket() {
  if (!elsRef.marketGrid || !getState()) return;
  bindMarketOnce();

  const others = getState().listings.filter((l) => l.ownerId !== getState().me.id);
  const mine = getState().listings.filter((l) => l.ownerId === getState().me.id);
  const sellables = marketSellables();

  // 头图统计
  elsRef.marketHeroStats.innerHTML = `
    <div class="jm-hero-stat"><b>${others.length}</b><span>在售挂单</span></div>
    <div class="jm-hero-stat"><b>${mine.length} / 40</b><span>我的挂单</span></div>
    <div class="jm-hero-stat"><b>${sellables.length}</b><span>可上架</span></div>
    <div class="jm-hero-stat"><b>3%</b><span>市场税</span></div>`;
  if (elsRef.marketMineCnt) elsRef.marketMineCnt.textContent = mine.length;

  renderMarketStalls();
  renderMarketFilters();
  syncMarketFilterInputs();
  renderMarketSection(others, mine);
}

// 根据当前区段（集市 / 我的挂单 / 求购）切换主区内容
export function renderMarketSection(others, mine) {
  const sec = marketUi.section;
  const isList = sec === "listings";
  if (elsRef.marketShop) elsRef.marketShop.classList.toggle("solo", !isList);
  // 头图「我的挂单」按钮高亮
  document.querySelector('[data-market-section="mine"]')?.classList.toggle("active", sec === "mine");
  if (sec === "mine") {
    elsRef.marketGrid.className = "jm-grid as-list";
    renderMarketMine(mine);
  } else if (sec === "want") {
    elsRef.marketGrid.className = "jm-grid as-wants";
    renderMarketWants();
  } else {
    elsRef.marketGrid.className = "jm-grid";
    renderMarketGrid(others);
  }
}

export function renderMarketStalls() {
  const cats = MARKET_STALLS.map((s) =>
    `<button class="jm-stall ${marketUi.section === "listings" && s.id === marketUi.cat ? "active" : ""}" data-action="marketStall" data-market-cat="${s.id}" type="button"><span class="dot" style="background:${s.color}"></span>${s.label}</button>`
  ).join("");
  const want = `<button class="jm-stall jm-stall-want ${marketUi.section === "want" ? "active" : ""}" data-action="marketSection" data-market-section="want" type="button"><span class="dot" style="background:var(--blue)"></span>求购 <span class="jm-stall-cnt">${MARKET_WANTS_SAMPLE.length}</span></button>`;
  const listBtn = `<button class="jm-stall jm-stall-list" data-action="openMarketListModal" type="button">＋ 挂牌出售</button>`;
  elsRef.marketStalls.innerHTML = cats + want + listBtn;
}

export function renderMarketFilters() {
  const order = ["imperial", "glass", "icy", "violet", "red", "ink", "glutinous", "bean"];
  elsRef.marketQFilters.innerHTML = order.map((k) => {
    const on = marketUi.q.has(k);
    return `<span class="jm-qchip ${on ? "on" : ""}" data-action="marketQ" data-market-q="${k}" style="${on ? `background:${MARKET_QUALITY[k].color}` : ""}"><span class="dot" style="background:${MARKET_QUALITY[k].color}"></span>${MARKET_QUALITY[k].name}</span>`;
  }).join("");
  if (elsRef.marketAfford) elsRef.marketAfford.classList.toggle("on", marketUi.afford);
}

export function marketFilterSort(list) {
  let arr = list.slice();
  if (marketUi.cat !== "all") arr = arr.filter((l) => l.type === marketUi.cat);
  if (marketUi.q.size) arr = arr.filter((l) => marketUi.q.has(marketQualityKey(l.item)));
  if (marketUi.min != null) arr = arr.filter((l) => l.price >= marketUi.min);
  if (marketUi.max != null) arr = arr.filter((l) => l.price <= marketUi.max);
  if (marketUi.afford) arr = arr.filter((l) => marketAffordable(l.price));
  if (marketUi.search) {
    const q = marketUi.search.toLowerCase();
    arr = arr.filter((l) =>
      String(l.item.name).toLowerCase().includes(q) ||
      String(l.ownerName).toLowerCase().includes(q) ||
      String(l.item.quality || "").toLowerCase().includes(q) ||
      String(l.item.color || "").toLowerCase().includes(q));
  }
  if (marketUi.sort === "priceAsc") arr.sort((a, b) => a.price - b.price);
  else if (marketUi.sort === "priceDesc") arr.sort((a, b) => b.price - a.price);
  else if (marketUi.sort === "deal") arr.sort((a, b) => (a.price - marketRefValue(a.item)) - (b.price - marketRefValue(b.item)));
  else arr.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return arr;
}

export function marketCardHtml(listing) {
  const item = listing.item;
  const q = marketQualityMeta(item);
  const qk = marketQualityKey(item);
  const gem = marketGemColor(item);
  const ref = marketRefValue(item);
  const d = marketPriceDelta(listing.price, ref);
  const can = marketAffordable(listing.price);
  const summary = inlaySummary(item);
  const badges = [];
  if (Date.now() - Number(listing.createdAt || 0) < 3600000) badges.push(`<span class="jm-badge new">新上</span>`);
  if (d.cls === "down") badges.push(`<span class="jm-badge deal">划算</span>`);
  return `
  <article class="jm-card ${can ? "" : "locked"} q-score-${q.score} ${q.score >= 5 ? "q-legend" : ""}" data-q="${qk}">
    <div class="jm-art">
      <div class="jm-ribbon" style="background:${q.color}">${escapeHtml(item.quality || q.name)}<span class="stars">${q.stars}</span></div>
      ${badges.length ? `<div class="jm-badges">${badges.join("")}</div>` : ""}
      <div class="jm-gem ${gem}"></div>
    </div>
    <div class="jm-body">
      <div class="jm-nm">${escapeHtml(item.name)}</div>
      <div class="jm-chips"><span class="jm-chip">${escapeHtml(typeName(listing.type, item))}</span>${item.color ? `<span class="jm-chip">${escapeHtml(item.color)}</span>` : ""}</div>
      ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
      <div class="jm-price-block">
        <span class="jm-price">${formatMoney(listing.price)}</span>
        ${ref ? `<span class="jm-ref">参考 ${formatMoney(ref)}</span>` : ""}
        <span class="jm-delta ${d.cls}">${d.txt}</span>
      </div>
      <div class="jm-seller"><span class="who">🏪 ${escapeHtml(listing.ownerName)}</span><span>${marketElapsed(listing.createdAt)}</span></div>
      <button class="jm-buy" data-action="openMarketBuy" data-payload="${listing.id}" ${can ? "" : "disabled"}>${can ? "买入" : "现金不足"}</button>
    </div>
  </article>`;
}

export function renderMarketGrid(others) {
  const arr = marketFilterSort(others);
  elsRef.marketGrid.innerHTML = arr.length
    ? arr.map(marketCardHtml).join("")
    : `<div class="jm-empty">${getState().listings.filter((l) => l.ownerId !== getState().me.id).length ? "没有符合条件的挂单，调整筛选或搜索试试。" : "玩家交易行还没有挂单，等别人上货或自己先挂一件。"}</div>`;
}

export function renderMarketMine(mine) {
  elsRef.marketGrid.innerHTML = mine.length
      ? mine.map((l) => {
        const q = marketQualityMeta(l.item);
        const summary = inlaySummary(l.item);
        return `
        <div class="jm-booth-row">
          <div class="jm-gem ${marketGemColor(l.item)}"></div>
          <div class="info">
            <b>${escapeHtml(l.item.name)}</b>
            <div class="sub">${escapeHtml(l.item.quality || q.name)} · ${formatMoney(l.price)} · ${marketElapsed(l.createdAt)}</div>
            ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
          </div>
          <div class="acts"><button class="jm-btn-withdraw" data-action="withdrawListing" data-payload="${l.id}" type="button">撤单</button></div>
        </div>`;
      }).join("")
    : `<div class="jm-empty">还没有挂单。点右上角「＋ 挂牌出售」把库存变现金流。</div>`;
}

export function renderMarketWants() {
  elsRef.marketGrid.innerHTML =
    `<div class="jm-want-note">求购系统开发中，以下为示例展示。真实求购下单/应征后续接入。</div>` +
    MARKET_WANTS_SAMPLE.map((w) => `
      <div class="jm-want">
        <b>${escapeHtml(w.name)}</b>
        <div class="detail">${escapeHtml(w.detail)}</div>
        <div class="foot"><span>${escapeHtml(w.by)}</span><span class="reward">${escapeHtml(w.reward)}</span></div>
        <button class="jm-btn-apply" data-action="marketApplyWant" type="button">应征</button>
      </div>`).join("");
}

// 只绑定一次静态控件（避免每次 render 重复绑定）
export function bindMarketOnce() {
  if (marketFiltersBound) return;
  marketFiltersBound = true;
  const regrid = () => renderMarketGrid(getState().listings.filter((l) => l.ownerId !== getState().me.id));
  elsRef.marketSearch?.addEventListener("input", (e) => { marketUi.search = e.target.value.trim(); regrid(); });
  elsRef.marketSort?.addEventListener("change", (e) => { marketUi.sort = e.target.value; regrid(); });
  elsRef.marketPriceMin?.addEventListener("input", (e) => { marketUi.min = e.target.value ? Number(e.target.value) : null; regrid(); });
  elsRef.marketPriceMax?.addEventListener("input", (e) => { marketUi.max = e.target.value ? Number(e.target.value) : null; regrid(); });
  elsRef.marketAfford?.addEventListener("click", () => { marketUi.afford = !marketUi.afford; renderMarketFilters(); regrid(); });
  elsRef.marketReset?.addEventListener("click", () => {
    marketUi.q.clear(); marketUi.min = null; marketUi.max = null; marketUi.afford = false; marketUi.search = "";
    renderMarketFilters(); syncMarketFilterInputs(); regrid();
  });
  elsRef.marketListItem?.addEventListener("change", updateMarketListModal);
  elsRef.marketListPrice?.addEventListener("input", (e) => { e.target.dataset.touched = "1"; updateMarketListModal(); });
}

export function syncMarketFilterInputs() {
  if (elsRef.marketSearch && document.activeElement !== elsRef.marketSearch) elsRef.marketSearch.value = marketUi.search;
  if (elsRef.marketSort) elsRef.marketSort.value = marketUi.sort;
  if (elsRef.marketPriceMin && document.activeElement !== elsRef.marketPriceMin) elsRef.marketPriceMin.value = marketUi.min ?? "";
  if (elsRef.marketPriceMax && document.activeElement !== elsRef.marketPriceMax) elsRef.marketPriceMax.value = marketUi.max ?? "";
}

/* ---------- 交易行弹窗 ---------- */
export function openMarketListModal() {
  const modal = elsRef.marketListModal || document.getElementById("marketListModal");
  if (!modal) { showToast("交易行弹窗未就绪，请刷新页面后重试。"); return; }
  const confirmBtn = modal.querySelector('[data-action="confirmMarketList"]');
  const sellables = marketSellables();
  if (!sellables.length) {
    showToast("暂无可挂牌物品，先去公盘拍原石或加工成品。");
    if (elsRef.marketListItem) elsRef.marketListItem.innerHTML = "";
    if (elsRef.marketListPrice) elsRef.marketListPrice.value = "";
    if (elsRef.marketListSuggest) elsRef.marketListSuggest.innerHTML = `暂无库存可寄售。去 <b>公盘</b> 拍原石、或在 <b>工坊</b> 加工出成品 / 片料 / 明料后，即可在此挂牌。`;
    if (elsRef.marketListFee) elsRef.marketListFee.innerHTML = `<div class="total"><span>可挂牌物品</span><span>0</span></div>`;
    if (confirmBtn) confirmBtn.disabled = true;
    modal.hidden = false;
    return;
  }
  if (confirmBtn) confirmBtn.disabled = false;
  elsRef.marketListItem.innerHTML = sellables.map((item) =>
    `<option value="${item.id}" data-type="${item._type}">${escapeHtml(item.name)}（${escapeHtml(item.quality || marketQualityMeta(item).name)} · 参考 ${formatMoney(marketRefValue(item))}）</option>`
  ).join("");
  elsRef.marketListPrice.dataset.touched = "";
  updateMarketListModal();
  modal.hidden = false;
}
export function updateMarketListModal() {
  const sellables = marketSellables();
  const opt = elsRef.marketListItem.selectedOptions[0];
  const item = sellables.find((i) => i.id === elsRef.marketListItem.value);
  if (!item) return;
  const suggested = Math.max(100, Math.round(marketRefValue(item) * 1.18));
  if (!elsRef.marketListPrice.dataset.touched) elsRef.marketListPrice.value = suggested;
  elsRef.marketListSuggest.innerHTML = `建议价 ≈ 参考价 ×1.18 = <b>${formatMoney(suggested)}</b>（不低于 ¥100）`;
  const p = Math.max(100, Number(elsRef.marketListPrice.value) || 0);
  elsRef.marketListFee.innerHTML = `
    <div><span>挂牌价</span><span>${formatMoney(p)}</span></div>
    <div><span>成交市场税（3%，买家付）</span><span>${formatMoney(Math.round(p * MARKET_TAX))}</span></div>
    <div class="total"><span>你（卖家）到账</span><span>${formatMoney(p)}</span></div>`;
}
export function confirmMarketList() {
  const item = marketSellables().find((i) => i.id === elsRef.marketListItem.value);
  const type = elsRef.marketListItem.selectedOptions[0]?.dataset.type;
  if (!item || !type) return;
  const price = Math.max(100, Number(elsRef.marketListPrice.value) || 0);
  socketRef.emit("listItem", { type, itemId: item.id, price });
  elsRef.marketListModal.hidden = true;
}
export function openMarketBuy(id) {
  const l = getState().listings.find((x) => x.id === id);
  if (!l) return;
  marketUi.buyId = id;
  const q = marketQualityMeta(l.item);
  const summary = inlaySummary(l.item);
  const tax = Math.round(l.price * MARKET_TAX);
  elsRef.marketBuyBody.innerHTML = `
    <div style="display:flex;gap:14px;align-items:center">
      <div class="jm-gem ${marketGemColor(l.item)}" style="width:70px;height:70px;flex:0 0 70px"></div>
      <div>
        <div class="jm-nm" style="font-size:16px">${escapeHtml(l.item.name)}</div>
        <div class="jm-chips" style="margin-top:6px"><span class="jm-chip">${escapeHtml(l.item.quality || q.name)} ${q.stars}</span><span class="jm-chip">${escapeHtml(typeName(l.type, l.item))}</span></div>
        ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
        <div style="font-size:12px;color:var(--muted);margin-top:6px">卖家：${escapeHtml(l.ownerName)}</div>
      </div>
    </div>
    <div class="jm-fee">
      <div><span>挂牌价</span><span>${formatMoney(l.price)}</span></div>
      <div><span>市场税（3%）</span><span>${formatMoney(tax)}</span></div>
      <div class="total"><span>你需支付</span><span>${formatMoney(l.price + tax)}</span></div>
    </div>
    <div class="jm-suggest">成交后：你获得物品，卖家到账 ${formatMoney(l.price)} 并 +2 声望。</div>`;
  elsRef.marketBuyModal.hidden = false;
}
export function confirmMarketBuy() {
  if (!marketUi.buyId) return;
  socketRef.emit("buyListing", marketUi.buyId);
  elsRef.marketBuyModal.hidden = true;
  marketUi.buyId = null;
}
export function closeMarketModals() {
  if (elsRef.marketListModal) elsRef.marketListModal.hidden = true;
  if (elsRef.marketBuyModal) elsRef.marketBuyModal.hidden = true;
}
// ---- 供 main.js dispatch 调用的动作包装（封装对私有 marketUi 的修改）----
export function marketSetStall(target) {
  marketUi.section = "listings";
  marketUi.cat = (target && target.dataset && target.dataset.marketCat) || "all";
  renderMarket();
}
export function marketSetSection(target) {
  marketUi.section = (target && target.dataset && target.dataset.marketSection) || "listings";
  renderMarket();
}
export function marketToggleQ(target) {
  const k = target && target.dataset && target.dataset.marketQ;
  if (!k) return;
  marketUi.q.has(k) ? marketUi.q.delete(k) : marketUi.q.add(k);
  renderMarketFilters();
  renderMarketGrid(getState().listings.filter((l) => l.ownerId !== getState().me.id));
}


export function initMarketModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ formatMoney, escapeHtml, empty, showToast, typeName } = deps.helpers);
}
