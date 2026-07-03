import { jadeCanvasMarkup, paintJadeCanvases } from "./jade-renderer.js";
import { reportSummary } from "./jade-loop.js";
import {
  analyzeRoughPlacement,
  productMatchesOrder,
  productOrderFitReasons,
  liveSaleRange,
  routeRecommendation
} from "./jade-rules.js";

const playerId = sessionStorage.getItem("jade-player-id");
const socket = io({ auth: { playerId } });

const tabs = [
  ["overview", "工坊总览", "盘"],
  ["auction", "公盘竞拍", "石"],
  ["workshop", "加工坊", "作"],
  ["market", "库存交易", "市"],
  ["livestream", "直播卖货", "播"],
  ["orders", "客户订单", "单"],
  ["collection", "声望殿堂", "誉"],
  ["reports", "经营报告", "报"]
];

let state = null;
let activeView = "overview";
let activeDragKit = null;
const auctionWindowTargets = new Map();
const roughKits = new Map();

const KIT_TEMPLATES = {
  bangle: {
    label: "手镯套件",
    short: "镯",
    w: 34,
    h: 34
  },
  cabochon: {
    label: "蛋面套件",
    short: "蛋",
    w: 22,
    h: 28
  },
  peacePendant: {
    label: "平安扣挂件",
    short: "扣",
    w: 30,
    h: 30
  },
  ruyiPendant: {
    label: "如意挂件",
    short: "如",
    w: 32,
    h: 30
  },
  leafPendant: {
    label: "叶子挂件",
    short: "叶",
    w: 24,
    h: 36
  }
};

const KIT_DEFAULT_POSITIONS = {
  bangle: { x: 50, y: 16 },
  cabochon: { x: 64, y: 68 },
  peacePendant: { x: 24, y: 84 },
  ruyiPendant: { x: 76, y: 84 },
  leafPendant: { x: 84, y: 26 }
};

const KIT_FALLBACK_POSITIONS = Object.values(KIT_DEFAULT_POSITIONS);

const els = {
  tabs: document.querySelector("#tabs"),
  title: document.querySelector("#viewTitle"),
  connection: document.querySelector("#connectionText"),
  nameInput: document.querySelector("#nameInput"),
  saveNameBtn: document.querySelector("#saveNameBtn"),
  rank: document.querySelector("#rankText"),
  cash: document.querySelector("#cashText"),
  cashSignal: document.querySelector("#cashSignal"),
  rep: document.querySelector("#repText"),
  repSignal: document.querySelector("#repSignal"),
  sat: document.querySelector("#satText"),
  satSignal: document.querySelector("#satSignal"),
  collection: document.querySelector("#collectionText"),
  collectionSignal: document.querySelector("#collectionSignal"),
  offlineSummary: document.querySelector("#offlineSummary"),
  nextActions: document.querySelector("#nextActions"),
  pipeline: document.querySelector("#pipelineList"),
  players: document.querySelector("#playersList"),
  news: document.querySelector("#newsList"),
  auctionBrief: document.querySelector("#auctionBrief"),
  roughPool: document.querySelector("#roughPool"),
  roughInventory: document.querySelector("#roughInventory"),
  materialInventory: document.querySelector("#materialInventory"),
  braceletInventory: document.querySelector("#braceletInventory"),
  roughCount: document.querySelector("#roughCount"),
  materialCount: document.querySelector("#materialCount"),
  braceletCount: document.querySelector("#braceletCount"),
  orders: document.querySelector("#ordersList"),
  orderBrief: document.querySelector("#orderBrief"),
  refreshOrders: document.querySelector("#refreshOrdersBtn"),
  marketBrief: document.querySelector("#marketBrief"),
  mySellables: document.querySelector("#mySellables"),
  marketListings: document.querySelector("#marketListings"),
  listingCount: document.querySelector("#listingCount"),
  livestream: document.querySelector("#livestreamPanel"),
  reports: document.querySelector("#reportsPanel"),
  collectionList: document.querySelector("#collectionList"),
  toast: document.querySelector("#toast")
};

function formatMoney(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function button(label, action, payload = "", className = "") {
  return `<button class="${className}" data-action="${action}" data-payload="${escapeHtml(payload)}">${label}</button>`;
}

function viewButton(label, view, className = "") {
  return `<button class="${className}" data-view-link="${view}">${label}</button>`;
}

function typeName(type, item = {}) {
  if (type === "bracelet") return {
    bracelet: "手镯",
    cabochon: "蛋面",
    peacePendant: "平安扣挂件",
    ruyiPendant: "如意挂件",
    leafPendant: "叶子挂件"
  }[item.kind] || "成品";
  return { rough: "原石", material: "明料", slice: "片料" }[type] || type;
}

function sumValue(items) {
  return items.reduce((sum, item) => sum + Number(item.value || item.price || 0), 0);
}

function productionJobsFor(me) {
  return [
    ...(me.jobs || []),
    ...(me.polishingJobs || []).map((job) => ({
      ...job,
      stage: "rough",
      item: job.item || job.rough,
      options: { label: "粗加工", ...(job.options || {}) }
    }))
  ].filter((job) => job.item);
}

function currentReportSummary() {
  const me = state?.me || {};
  return me.reports?.[0] || reportSummary(me.ledger || [], [
    ...(me.rough || []),
    ...(me.materials || []),
    ...(me.slices || []),
    ...(me.bracelets || []),
    ...(me.livestreamJobs || []).map((job) => job.product).filter(Boolean)
  ]);
}

function renderOfflineSummary() {
  const summary = state?.me?.offlineSummary;
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

function repTier(rep) {
  if (rep >= 160) return "名店";
  if (rep >= 80) return "熟行";
  if (rep >= 30) return "起势";
  return "新人";
}

function riskTone(risk) {
  if (risk >= 80) return "高危";
  if (risk >= 55) return "谨慎";
  return "稳妥";
}

function matchingBracelets(order) {
  return state.me.bracelets.filter((product) => productMatchesOrder(product, order));
}

function selectedByDefault(order, bracelet) {
  const candidates = matchingBracelets(order).slice(0, order.quantity).map((item) => item.id);
  return candidates.includes(bracelet.id) ? "selected" : "";
}

function productName(item) {
  return {
    bracelet: "手镯",
    cabochon: "蛋面",
    peacePendant: "平安扣挂件",
    ruyiPendant: "如意挂件",
    leafPendant: "叶子挂件"
  }[item.kind] || item.design || "成品";
}

function windowCount(rough) {
  return rough.visual?.windows?.length || rough.windows?.length || 0;
}

function windowTargetFor(roughId) {
  if (!auctionWindowTargets.has(roughId)) auctionWindowTargets.set(roughId, { x: 50, y: 50 });
  return auctionWindowTargets.get(roughId);
}

function setWindowTarget(roughId, x, y) {
  auctionWindowTargets.set(roughId, { x: clampClient(Math.round(x), 16, 84), y: clampClient(Math.round(y), 16, 84) });
  renderAuction();
  paintJades();
}

function windowTargetMarker(rough) {
  const target = windowTargetFor(rough.id);
  return `<span class="window-target-marker" style="left:${target.x}%;top:${target.y}%;" title="开窗位置"></span>`;
}

function auctionStoneBoard(rough) {
  return `
    <div class="auction-window-board" data-window-board="${rough.id}" title="点击选择开窗位置">
      ${stoneSvg(rough)}
      ${windowTargetMarker(rough)}
    </div>
  `;
}

function myBidFor(roughId) {
  return (state.auction?.myBids || []).find((bid) => bid.roughId === roughId);
}

function renderAuctionBidControls(rough) {
  const bid = myBidFor(rough.id);
  const canBid = state.auction?.phase === "bidding";
  const disabled = canBid ? "" : "disabled";
  const amount = bid?.amount || rough.price;
  const proxyMax = bid?.proxyMax || bid?.amount || Math.round(rough.price * 1.18);
  return `
    <div class="bid-controls">
      <label>密封投标
        <input data-bid-amount="${escapeHtml(rough.id)}" type="number" min="${rough.price}" step="100" value="${amount}" ${disabled}>
      </label>
      <label>代理上限
        <input data-proxy-max="${escapeHtml(rough.id)}" type="number" min="${rough.price}" step="100" value="${proxyMax}" ${disabled}>
      </label>
      <button data-action="submitAuctionBid" data-payload="${escapeHtml(rough.id)}" ${disabled}>${bid ? "修改暗标" : "提交暗标"}</button>
    </div>
  `;
}

function expertClueChips(rough) {
  const clues = Array.isArray(rough.expertClues) ? rough.expertClues : [];
  if (!clues.length) return "";
  return `<div class="expert-clues">${clues.map((clue) => `<span>${escapeHtml(clue)}</span>`).join("")}</div>`;
}

function placementAnalysisRows(rough, kits) {
  if (!kits.length) return `<div class="placement-analysis muted">选择套件后显示吃色、压裂和边缘风险。</div>`;
  return `
    <div class="placement-analysis">
      ${kits.map((kit) => {
        const template = KIT_TEMPLATES[kit.type] || KIT_TEMPLATES.bangle;
        const analysis = analyzeRoughPlacement(rough, {
          layout: kitLayout(kit.type),
          x: kit.x,
          y: kit.y,
          ringSize: kit.ringSize
        });
        return `
          <div class="analysis-row ${analysis.tone}">
            <strong>${template.label} ${analysis.score}</strong>
            <span>${analysis.reasons.map(escapeHtml).join(" · ")}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function orderFitList(order, candidates) {
  if (!candidates.length) return `<div class="fit-list muted">暂无完全匹配的成品。</div>`;
  return `
    <div class="fit-list">
      ${candidates.slice(0, 3).map((product) => `
        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <span>${productOrderFitReasons(product, order).map(escapeHtml).join(" · ")}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function salesRouteMeta(item) {
  const route = routeRecommendation(item, state.me.orders, state.me.rep);
  const range = liveSaleRange(item, state.me.rep);
  return `
    <div class="route-meta ${route.route}">
      <strong>${escapeHtml(route.label)}</strong>
      <span>${escapeHtml(route.detail)} · 直播 ${formatMoney(range.low)}-${formatMoney(range.high)}</span>
    </div>
  `;
}

function clampClient(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stoneSvg(item, size = "large") {
  return jadeCanvasMarkup("rough", item, size);
}

function productCanvas(item, size = "finished") {
  return jadeCanvasMarkup("product", item, size);
}

function kitLayout(type) {
  return {
    bangle: "bracelet",
    cabochon: "cabochon",
    peacePendant: "peacePendant",
    ruyiPendant: "ruyiPendant",
    leafPendant: "leafPendant"
  }[type] || "bracelet";
}

function kitPreviewCanvas(rough, kit, template) {
  const layout = kitLayout(kit.type);
  const placement = {
    id: kit.id,
    layout,
    x: kit.x,
    y: kit.y,
    templateSize: { w: template.w, h: template.h },
    ringSize: layout === "bracelet" ? kit.ringSize || 56 : undefined
  };
  return jadeCanvasMarkup("product", {
    id: `${rough.id}-${kit.id}-preview`,
    name: `${template.label}预览`,
    kind: layout,
    preview: true,
    plan: placement,
    sourceMaterial: {
      roughId: rough.id,
      roughName: rough.name,
      visual: rough.visual,
      windows: rough.windows || [],
      placement,
      templateSize: { w: template.w, h: template.h },
      mass: rough.mass,
      qualityKey: rough.qualityKey,
      color: rough.color
    }
  }, "kit-preview");
}

function kitsFor(roughId) {
  if (!roughKits.has(roughId)) roughKits.set(roughId, []);
  return roughKits.get(roughId);
}

function defaultKitPosition(type, current) {
  const preferred = KIT_DEFAULT_POSITIONS[type] || KIT_FALLBACK_POSITIONS[current.length % KIT_FALLBACK_POSITIONS.length];
  const isOpen = (position) => !current.some((kit) => Math.hypot(kit.x - position.x, kit.y - position.y) < 18);
  if (isOpen(preferred)) return preferred;
  return KIT_FALLBACK_POSITIONS.find(isOpen) || preferred;
}

function addRoughKit(roughId, type) {
  const current = kitsFor(roughId);
  const position = defaultKitPosition(type, current);
  const kit = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: KIT_TEMPLATES[type] ? type : "bangle",
    x: position.x,
    y: position.y,
    ringSize: 56
  };
  roughKits.set(roughId, [...current, kit].slice(0, 10));
  renderWorkshop();
  paintJades();
}

function clearRoughKits(roughId) {
  roughKits.set(roughId, []);
  renderWorkshop();
  paintJades();
}

function moveRoughKit(roughId, kitId, x, y) {
  roughKits.set(roughId, kitsFor(roughId).map((kit) => (
    kit.id === kitId ? { ...kit, x: clampClient(Math.round(x), 16, 84), y: clampClient(Math.round(y), 16, 84) } : kit
  )));
  renderWorkshop();
  paintJades();
}

function kitOverlay(rough) {
  const saved = (rough.extractionKits || rough.braceletPlacements || []).map((kit) => ({ ...kit, saved: true }));
  const active = kitsFor(rough.id);
  return [...saved, ...active].map((kit) => {
    const template = KIT_TEMPLATES[kit.type] || KIT_TEMPLATES.bangle;
    const dragAttrs = kit.saved ? "" : `data-kit-id="${escapeHtml(kit.id)}" data-rough-id="${escapeHtml(rough.id)}"`;
    const width = Number(template.w) || 28;
    const height = Number(template.h) || 28;
    return `
      <div class="kit-placement ${kit.saved ? "saved" : ""}" style="left:${kit.x}%;top:${kit.y}%;width:${width}%;height:${height}%;" ${dragAttrs}>
        ${kitPreviewCanvas(rough, kit, template)}
      </div>
    `;
  }).join("");
}

function roughBoard(rough) {
  return `
    <div class="rough-board-wrap" data-rough-board="${rough.id}" aria-label="${escapeHtml(rough.name)}取镯规划">
      ${stoneSvg(rough, "planner")}
      <div class="kit-board-overlay rough-overlay" aria-hidden="true">${kitOverlay(rough)}</div>
    </div>
  `;
}

function roughPlannerControls(rough) {
  const kits = kitsFor(rough.id);
  const savedCount = (rough.extractionKits || rough.braceletPlacements || []).length;
  return `
    <div class="layout-tools">
      <div class="kit-choice-row">
        ${Object.entries(KIT_TEMPLATES).map(([type, template]) => `<button class="kit-choice" data-kit-choice="${type}" data-rough="${rough.id}">${template.label}</button>`).join("")}
      </div>
      <div class="placement-summary">
        <span>本次 ${kits.length} 件 · 已取 ${savedCount} 件</span>
        <button class="secondary" data-action="clearRoughKits" data-payload="${rough.id}" ${kits.length ? "" : "disabled"}>清空</button>
      </div>
    </div>
  `;
}

function setView(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  const tab = tabs.find(([key]) => key === view);
  els.title.textContent = tab ? tab[1] : "经营总览";
  if (state) paintJades();
}

function initTabs() {
  els.tabs.innerHTML = tabs.map(([key, label, icon]) => `
    <button class="tab" data-view="${key}" title="${label}">
      <span class="tab-icon" aria-hidden="true">${icon}</span>
      <span>${label}</span>
    </button>
  `).join("");
  els.tabs.addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) setView(tab.dataset.view);
  });
  setView(activeView);
}

function render() {
  if (!state) return;
  const { me } = state;
  els.nameInput.value = me.name;
  els.cash.textContent = formatMoney(me.cash);
  els.rep.textContent = Math.round(me.rep);
  els.sat.textContent = `${Math.round(me.satisfaction)}%`;
  els.collection.textContent = `${me.collection.length} 件`;
  const rankIndex = state.players.findIndex((player) => player.id === me.id);
  els.rank.textContent = rankIndex >= 0 ? `同行第 ${rankIndex + 1}` : "未入榜";
  const cheapest = state.roughPool.reduce((best, item) => (!best || item.price < best.price ? item : best), null);
  els.cashSignal.textContent = cheapest && me.cash >= cheapest.price ? `可拍最低 ${formatMoney(cheapest.price)}` : "先回笼现金";
  els.repSignal.textContent = repTier(me.rep);
  els.satSignal.textContent = me.satisfaction >= 80 ? "客户愿回头" : me.satisfaction >= 55 ? "保持交付" : "口碑危险";
  els.collectionSignal.textContent = `门面 ${sumValue(me.collection).toLocaleString("zh-CN")}`;

  renderOverview();
  renderAuction();
  renderWorkshop();
  renderOrders();
  renderMarket();
  renderLivestream();
  renderReports();
  renderCollection();
  paintJades();
}

function paintJades() {
  paintJadeCanvases();
}

function renderOverview() {
  els.offlineSummary.innerHTML = renderOfflineSummary();
  renderNextActions();
  renderPipeline();
  els.players.innerHTML = state.players.map((player, index) => `
    <div class="rank-row">
      <div class="rank-badge">${index + 1}</div>
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <p class="rank-meta">藏品 ${player.collectionCount} · 库存 ${player.inventoryCount} · 满意度 ${player.satisfaction}%</p>
      </div>
      <strong>${player.rep}</strong>
    </div>
  `).join("") || empty("暂无玩家");
  els.news.innerHTML = state.news.map((item) => `
    <div class="news-row ${item.tone}">
      <strong>${escapeHtml(item.at)}</strong>
      <p>${escapeHtml(item.text)}</p>
    </div>
  `).join("") || empty("还没有战报");
}

function renderNextActions() {
  const { me } = state;
  const productionJobs = productionJobsFor(me);
  const sealed = me.rough.filter((rough) => !rough.revealed);
  const revealed = me.rough.filter((rough) => rough.revealed);
  const completable = me.orders.filter((order) => matchingBracelets(order).length >= order.quantity);
  const affordable = state.roughPool.filter((rough) => rough.price <= me.cash).sort((a, b) => a.price - b.price);
  const report = currentReportSummary();
  const primary = [];

  if (completable.length) {
    const best = completable.sort((a, b) => b.pay - a.pay)[0];
    primary.push({ tone: "profit", title: "先交付可完成订单", meta: `${best.client} · 收入 ${formatMoney(best.pay)} · 声望 +${best.rep}`, action: viewButton("去交付", "orders") });
  } else if (me.bracelets.length) {
    primary.push({ tone: "profit", title: "处理成品库存", meta: `${me.bracelets.length} 只手镯可接单、收藏、直播或挂牌`, action: viewButton("看成品", "workshop") });
  } else if (revealed.length) {
    primary.push({ tone: "craft", title: "在已揭露原料上取手镯", meta: `${revealed.length} 块料可直接摆放圈口取件`, action: viewButton("去取镯", "workshop") });
  } else if (productionJobs.length) {
    primary.push({ tone: "craft", title: "加工正在进行", meta: `${productionJobs.length} 件粗加工、精加工或镶嵌等待完成`, action: viewButton("看工坊", "workshop") });
  } else if (sealed.length) {
    primary.push({ tone: "risk", title: "拍下的原料还没揭露", meta: `${sealed.length} 块原料需要全料打磨`, action: viewButton("去打磨", "workshop", "warn") });
  } else if (affordable.length) {
    primary.push({ tone: "risk", title: "公盘只见轮廓，先开窗再决策", meta: `最低 ${formatMoney(affordable[0].price)}，开窗会公开信息`, action: viewButton("看公盘", "auction") });
  } else {
    primary.push({ tone: "danger", title: "现金不足，先靠订单或市场回笼", meta: "当前买不起最低价原石，避免继续冒险", action: viewButton("看市场", "market", "secondary") });
  }

  primary.push({ tone: "info", title: "开窗信息全员可见", meta: "你花钱开的窗口，会影响所有人的竞拍判断", action: viewButton("看公盘", "auction", "secondary") });
  primary.push({
    tone: report.net >= 0 ? "profit" : "risk",
    title: "轻量现金流",
    meta: `收入 ${formatMoney(report.income)} · 支出 ${formatMoney(report.expense)} · 净额 ${formatMoney(report.net)}`,
    action: ""
  });
  els.nextActions.innerHTML = primary.map((item) => `
    <article class="action-card ${item.tone}">
      <div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.meta)}</p></div>
      ${item.action}
    </article>
  `).join("");
}

function renderPipeline() {
  const { me } = state;
  const productionJobs = productionJobsFor(me);
  const sealed = me.rough.filter((rough) => !rough.revealed);
  const revealed = me.rough.filter((rough) => rough.revealed);
  const stages = [
    ["暗料", sealed.length, sumValue(sealed), "待打磨"],
    ["加工", productionJobs.length, sumValue(productionJobs.map((job) => job.item)), "粗加工/精加工/镶嵌"],
    ["明料", revealed.length, sumValue(revealed), "可取镯"],
    ["成品", me.bracelets.length, sumValue(me.bracelets), "可变现"],
    ["藏品", me.collection.length, sumValue(me.collection), "涨声望"]
  ];
  els.pipeline.innerHTML = stages.map(([name, count, value, hint]) => `
    <div class="pipeline-step">
      <span>${name}</span><strong>${count}</strong><small>${formatMoney(value)} · ${hint}</small>
    </div>
  `).join("");
}

function renderAuction() {
  const { me } = state;
  const auction = state.auction;
  const roughs = auction?.roughs?.length ? auction.roughs : state.roughPool;
  const affordable = roughs.filter((rough) => rough.price <= me.cash).length;
  const opened = roughs.reduce((sum, rough) => sum + windowCount(rough), 0);
  const phaseLabel = { preview: "预展", bidding: "密封投标", settled: "开标" }[auction?.phase] || "密封投标";
  const canRequestWindow = auction?.phase === "bidding";
  els.auctionBrief.innerHTML = `
    <span>${phaseLabel}</span>
    <span>我的暗标 ${auction?.myBids?.length || 0}</span>
    <span>可拍 ${affordable}/${roughs.length}</span>
    <span>已公开开窗 ${opened} 处</span>
    <span>开窗费为当前价 6%</span>
  `;
  els.roughPool.innerHTML = roughs.map((rough) => {
    const windowFee = Math.round(rough.price * 0.06);
    return `
      <article class="rough-card ${rough.price > me.cash ? "locked" : ""}">
        <div>
          ${auctionStoneBoard(rough)}
          <h3>${escapeHtml(rough.name)}</h3>
          <p class="card-meta">${escapeHtml(rough.hint)} · ${rough.mass}kg · 开窗 ${windowCount(rough)}/6</p>
          ${expertClueChips(rough)}
          <div class="meter"><span style="width: ${Math.min(100, rough.risk)}%"></span></div>
          <p class="card-meta">风险 ${rough.risk}% · ${riskTone(rough.risk)} · 占现金 ${me.cash ? Math.round(rough.price / me.cash * 100) : 0}%</p>
        </div>
        <div>
          <div class="price">${formatMoney(rough.price)}</div>
          <p class="card-meta">保证金参考 ${formatMoney(rough.deposit)}</p>
          <div class="card-actions">
            <button class="secondary" data-action="requestWindow" data-payload="${rough.id}" ${!canRequestWindow || windowFee > me.cash || windowCount(rough) >= 6 ? "disabled" : ""}>按点开窗 ${formatMoney(windowFee)}</button>
          </div>
          ${renderAuctionBidControls(rough)}
        </div>
      </article>
    `;
  }).join("");
}

function renderWorkshop() {
  const { me } = state;
  const productionJobs = productionJobsFor(me);
  const sealed = me.rough.filter((rough) => !rough.revealed);
  const revealed = me.rough.filter((rough) => rough.revealed);
  els.roughCount.textContent = productionJobs.length ? `${sealed.length} 原石 · ${productionJobs.length} 加工任务` : sealed.length;
  els.materialCount.textContent = revealed.length;
  els.braceletCount.textContent = me.bracelets.length;

  const productionRows = productionJobs.map((job) => {
    const remain = Math.max(0, Math.ceil((job.readyAt - Date.now()) / 1000));
    const progress = Math.min(100, Math.round((Date.now() - job.startedAt) / Math.max(1, job.readyAt - job.startedAt) * 100));
    const label = { rough: "粗加工", refine: "精加工", inlay: "镶嵌" }[job.stage] || "加工";
    return `
      <div class="item-row machine-row">
        <div class="machine-top"><div><strong>${label}</strong><p class="item-meta">${escapeHtml(job.item.name)} · 还需 ${remain} 秒</p></div></div>
        <div class="machine-track"><span style="width:${progress}%"></span></div>
      </div>
    `;
  });

  els.roughInventory.innerHTML = [
    ...sealed.map((item) => `
      <div class="item-row">
        ${stoneSvg(item, "small")}
        <div class="item-title"><span>${escapeHtml(item.name)}</span><span class="pill">${formatMoney(item.price)}</span></div>
        <p class="item-meta">${escapeHtml(item.hint)} · ${item.mass}kg · 已开窗 ${item.visual?.windows?.length || 0} 处</p>
        <div class="row-actions">
          <button class="warn" data-action="startPolish" data-payload="${item.id}">粗加工 ¥620</button>
        </div>
      </div>
    `),
    ...productionRows
  ].join("") || empty("还没有原石或加工任务，先去公盘拍一块。");

  els.materialInventory.innerHTML = revealed.map((item) => {
    const kits = kitsFor(item.id);
    const savedCount = (item.extractionKits || item.braceletPlacements || []).length;
    return `
      <div class="item-row">
        <div class="item-title"><span>${escapeHtml(item.name)}</span><span class="pill">${formatMoney(item.value)}</span></div>
        <p class="item-meta">${item.mass}kg · ${escapeHtml(item.quality || "已揭露")} · 已取 ${savedCount} 套</p>
        ${roughBoard(item)}
        ${roughPlannerControls(item)}
        ${placementAnalysisRows(item, kits)}
        <div class="row-actions">
          <button data-action="extractFromRough" data-payload="${item.id}" ${kits.length ? "" : "disabled"}>按 ${kits.length || 0} 套模板取件</button>
        </div>
      </div>
    `;
  }).join("") || empty("全料打磨完成后，会在这里直接规划取手镯。");

  els.braceletInventory.innerHTML = me.bracelets.map((item) => braceletRow(item)).join("") || empty("从已揭露原料上取手镯后，会进入成品库存。");
}

function braceletRow(item) {
  const route = salesRouteMeta(item);
  return `
    <div class="item-row product-row">
      ${productCanvas(item)}
      <div>
        <div class="item-title"><span>${escapeHtml(item.name)}</span><span class="pill">${formatMoney(item.value)}</span></div>
        <p class="item-meta">${escapeHtml(productName(item))} · ${escapeHtml(item.quality)} · 收藏声望 ${item.rep}</p>
        ${route}
        <div class="row-actions">
          ${button("收藏", "collectBracelet", item.id)}
          ${viewButton("去直播", "livestream", "secondary")}
        </div>
      </div>
    </div>
  `;
}

function renderOrders() {
  const bracelets = state.me.bracelets;
  const completable = state.me.orders.filter((order) => matchingBracelets(order).length >= order.quantity).length;
  els.orderBrief.innerHTML = `<span>可完成 ${completable}/${state.me.orders.length}</span><span>成品库存 ${bracelets.length}</span><span>满意度 ${Math.round(state.me.satisfaction)}%</span>`;
  els.orders.innerHTML = state.me.orders.map((order) => {
    const options = bracelets.map((bracelet) => {
      const matched = productMatchesOrder(bracelet, order);
      return `<option value="${bracelet.id}" ${selectedByDefault(order, bracelet)} ${matched ? "" : "disabled"}>${escapeHtml(bracelet.name)} · ${bracelet.quality}${matched ? "" : " · 不匹配"}</option>`;
    }).join("");
    const candidates = matchingBracelets(order);
    const selects = Array.from({ length: order.quantity }, (_, index) => `
      <select data-order-select="${order.id}" data-slot="${index}">
        <option value="">选择成品</option>${options}
      </select>
    `).join("");
    const minutes = Math.max(0, Math.ceil((order.expiresAt - Date.now()) / 60000));
    return `
      <article class="order-card">
        <div>
          <h3>${escapeHtml(order.client)}</h3>
          <p class="card-meta">${escapeHtml(order.urgency)} · 剩余 ${minutes} 分钟</p>
          <p>${escapeHtml(order.taste)}</p>
          <p class="card-meta">要求 ${order.quantity} 件 · 至少 ${escapeHtml(order.minQuality)} · 匹配 ${candidates.length} 件</p>
          ${orderFitList(order, candidates)}
        </div>
        <div>
          <div class="price">${formatMoney(order.pay)}</div>
          <p class="card-meta">完成声望 +${order.rep}</p>
          <div class="card-actions order-selects">${selects}</div>
          <div class="card-actions"><button data-action="completeOrder" data-payload="${order.id}" ${candidates.length < order.quantity ? "disabled" : ""}>交付订单</button></div>
        </div>
      </article>
    `;
  }).join("") || empty("当前没有订单。");
}

function renderMarket() {
  const sellables = [
    ...state.me.rough.map((item) => ({ ...item, type: "rough" })),
    ...state.me.bracelets.map((item) => ({ ...item, type: "bracelet" }))
  ];
  const ownListings = state.listings.filter((listing) => listing.ownerId === state.me.id);
  els.marketBrief.innerHTML = `<span>我的可卖 ${sellables.length}</span><span>我的挂单 ${ownListings.length}</span><span>市场挂单 ${state.listings.length}</span>`;
  els.mySellables.innerHTML = sellables.map((item) => {
    const suggested = Math.round((item.value || item.price || 1000) * 1.18);
    return `
      <div class="item-row">
        <div class="item-title"><span>${escapeHtml(item.name)}</span><span class="pill">${typeName(item.type, item)}</span></div>
        <p class="item-meta">参考价 ${formatMoney(item.value || item.price)}</p>
        <div class="sell-form">
          <input inputmode="numeric" value="${suggested}" data-price-for="${item.id}" />
          <button data-action="listItem" data-type="${item.type}" data-payload="${item.id}">挂牌</button>
        </div>
      </div>
    `;
  }).join("") || empty("暂无可挂牌物品。");
  els.listingCount.textContent = state.listings.length;
  els.marketListings.innerHTML = state.listings.map((listing) => {
    const own = listing.ownerId === state.me.id;
    return `
      <div class="item-row">
        <div class="item-title"><span>${escapeHtml(listing.item.name)}</span><span class="pill">${formatMoney(listing.price)}</span></div>
        <p class="item-meta">${escapeHtml(listing.ownerName)} · ${typeName(listing.type, listing.item)}</p>
        <div class="row-actions"><button data-action="buyListing" data-payload="${listing.id}" ${own ? "disabled" : ""}>买入</button></div>
      </div>
    `;
  }).join("") || empty("交易行还没有挂单。");
}

function renderLivestream() {
  const products = state.me.bracelets || [];
  const jobs = state.me.livestreamJobs || [];
  const modeName = {
    autoConservative: "保守",
    autoBalanced: "均衡",
    autoAggressive: "激进"
  };
  els.livestream.innerHTML = [
    ...jobs.map((job) => {
      const remain = Math.max(0, Math.ceil((job.readyAt - Date.now()) / 1000));
      return `
        <article class="rough-card livestream-job-card">
          ${productCanvas(job.product)}
          <h3>直播中</h3>
          <p>${escapeHtml(job.product.name)} · ${escapeHtml(modeName[job.mode] || job.mode)}</p>
          <p class="card-meta">预计 ${remain} 秒后自动结算，可离线完成</p>
        </article>
      `;
    }),
    ...products.map((item) => `
      <article class="rough-card">
        ${productCanvas(item)}
        <h3>${escapeHtml(item.name)}</h3>
        <p class="card-meta">估值 ${formatMoney(item.value)} · 自动直播可离线完成</p>
        <div class="card-actions">
          <button data-action="scheduleLivestream" data-payload="${item.id}" data-mode="autoConservative">保守</button>
          <button data-action="scheduleLivestream" data-payload="${item.id}" data-mode="autoBalanced">均衡</button>
          <button data-action="scheduleLivestream" data-payload="${item.id}" data-mode="autoAggressive">激进</button>
        </div>
      </article>
    `)
  ].join("") || empty("暂无可直播成品。");
}

function renderReports() {
  const report = currentReportSummary();
  const advice = Array.isArray(report.advice) ? report.advice : [];
  els.reports.innerHTML = `
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

function renderCollection() {
  els.collectionList.innerHTML = state.me.collection.map((item) => `
    <article class="treasure-card">
      ${productCanvas(item, "finished showcase")}
      <h3>${escapeHtml(item.name)}</h3>
      <p class="card-meta">${escapeHtml(item.quality)} · ${escapeHtml(item.color)} · 门面声望 ${item.rep}</p>
      <div class="price">${formatMoney(item.value)}</div>
    </article>
  `).join("") || empty("还没有藏品，把好手镯收入藏宝阁即可提升门面。");
}

function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function boardPointFromEvent(board, event) {
  const rect = board.getBoundingClientRect();
  return {
    x: clampClient((event.clientX - rect.left) / rect.width * 100, 16, 84),
    y: clampClient((event.clientY - rect.top) / rect.height * 100, 16, 84)
  };
}

document.body.addEventListener("pointerdown", (event) => {
  const kit = event.target.closest("[data-kit-id]");
  if (!kit) return;
  activeDragKit = {
    roughId: kit.dataset.roughId,
    kitId: kit.dataset.kitId
  };
  event.preventDefault();
});

document.body.addEventListener("pointermove", (event) => {
  if (!activeDragKit) return;
  const board = document.querySelector(`[data-rough-board="${CSS.escape(activeDragKit.roughId)}"]`);
  if (!board) return;
  const point = boardPointFromEvent(board, event);
  moveRoughKit(activeDragKit.roughId, activeDragKit.kitId, point.x, point.y);
});

document.body.addEventListener("pointerup", () => {
  activeDragKit = null;
});

document.body.addEventListener("pointercancel", () => {
  activeDragKit = null;
});

document.body.addEventListener("click", (event) => {
  const viewLink = event.target.closest("[data-view-link]");
  if (viewLink) {
    setView(viewLink.dataset.viewLink);
    return;
  }

  const kitChoice = event.target.closest("[data-kit-choice]");
  if (kitChoice) {
    addRoughKit(kitChoice.dataset.rough, kitChoice.dataset.kitChoice);
    return;
  }

  const windowBoard = event.target.closest("[data-window-board]");
  if (windowBoard) {
    const point = boardPointFromEvent(windowBoard, event);
    setWindowTarget(windowBoard.dataset.windowBoard, point.x, point.y);
    return;
  }

  const target = event.target.closest("[data-action]");
  if (!target || !state) return;
  const action = target.dataset.action;
  const payload = target.dataset.payload;

  if (action === "requestWindow") {
    const targetPoint = windowTargetFor(payload);
    socket.emit("requestWindow", { roughId: payload, x: targetPoint.x, y: targetPoint.y });
    return;
  }

  if (action === "extractFromRough") {
    socket.emit("extractFromRough", { roughId: payload, kits: roughKits.get(payload) || [] });
    roughKits.set(payload, []);
    return;
  }

  if (action === "clearRoughKits") {
    clearRoughKits(payload);
    return;
  }

  if (action === "listItem") {
    const input = document.querySelector(`[data-price-for="${CSS.escape(payload)}"]`);
    socket.emit("listItem", { type: target.dataset.type, itemId: payload, price: input?.value });
    return;
  }

  if (action === "completeOrder") {
    const values = [...document.querySelectorAll(`[data-order-select="${CSS.escape(payload)}"]`)]
      .map((select) => select.value)
      .filter(Boolean);
    socket.emit("completeOrder", { orderId: payload, braceletIds: values });
    return;
  }

  if (action === "scheduleLivestream") {
    socket.emit("scheduleLivestream", { productId: payload, mode: target.dataset.mode });
    return;
  }

  if (action === "submitAuctionBid") {
    const amountInput = document.querySelector(`[data-bid-amount="${CSS.escape(payload)}"]`);
    const proxyInput = document.querySelector(`[data-proxy-max="${CSS.escape(payload)}"]`);
    socket.emit("submitAuctionBid", {
      roughId: payload,
      amount: amountInput?.value,
      proxyMax: proxyInput?.value || amountInput?.value
    });
    return;
  }

  socket.emit(action, payload);
});

els.saveNameBtn.addEventListener("click", () => {
  socket.emit("setName", els.nameInput.value);
});

els.refreshOrders.addEventListener("click", () => {
  socket.emit("refreshOrders");
});

socket.on("connect", () => {
  els.connection.textContent = "已连接";
});

socket.on("disconnect", () => {
  els.connection.textContent = "离线";
});

socket.on("hello", ({ playerId }) => {
  sessionStorage.setItem("jade-player-id", playerId);
});

socket.on("state", (nextState) => {
  state = nextState;
  render();
});

socket.on("toast", showToast);

initTabs();
