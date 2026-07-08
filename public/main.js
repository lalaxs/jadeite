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

const viewLabels = {
  overview: "翡翠街",
  auction: "公盘会场",
  workshop: "我的工坊",
  market: "玩家交易行",
  shop: "商铺",
  livestream: "直播间",
  orders: "客户茶室",
  collection: "藏宝阁",
  reports: "经营账房"
};

const locationDefinitions = [
  { id: "auction", view: "auction", label: "公盘会场", locationImage: "auction", type: "public", description: "暗标拍原石，开窗会公开信息。" },
  { id: "playerMarket", view: "market", label: "玩家交易行", locationImage: "market", type: "public", description: "玩家之间买卖翡翠中间物和成品。" },
  { id: "shop", view: "shop", label: "商铺", locationImage: "shop", type: "public", description: "购买工坊、直播许可等功能建筑。" },
  { id: "orders", view: "orders", label: "客户茶室", locationImage: "orders", type: "public", description: "接定制单，换现金和口碑。" },
  { id: "collection", view: "collection", label: "藏宝阁", locationImage: "collection", type: "public", description: "收藏精品，提高门面声望。" },
  { id: "reports", view: "reports", label: "经营账房", locationImage: "reports", type: "public", description: "查看现金流、库存占用和建议。" },
  { id: "livestream", view: "livestream", label: "直播间", locationImage: "livestream", type: "lockedPublic", description: "自动直播卖货，适合处理成品库存。", purchaseId: "livestream-permit" },
  { id: "workshop", view: "workshop", label: "我的工坊", locationImage: "workshop", type: "ownedPrivate", description: "打磨原石、取件、精加工。", ownershipKey: "workshopOwned" }
];

let state = null;
let activeView = "overview";
let activeDragKit = null;
let serverClockOffset = 0;
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
  bangle: { x: 50, y: 34 },
  cabochon: { x: 64, y: 68 },
  peacePendant: { x: 24, y: 84 },
  ruyiPendant: { x: 76, y: 84 },
  leafPendant: { x: 84, y: 26 }
};

const KIT_FALLBACK_POSITIONS = Object.values(KIT_DEFAULT_POSITIONS);
const KIT_BOARD_UNIT_PX = 1.48;

const els = {
  sidebarStatus: document.querySelector("#sidebarStatus"),
  locationCards: document.querySelector("#locationCards"),
  rankBriefList: document.querySelector("#rankBriefList"),
  title: document.querySelector("#viewTitle"),
  homeBtn: document.querySelector("#homeBtn"),
  connection: document.querySelector("#connectionText"),
  nameInput: document.querySelector("#nameInput"),
  saveNameBtn: document.querySelector("#saveNameBtn"),
  auctionHalls: document.querySelector("#auctionHalls"),
  auctionBrief: document.querySelector("#auctionBrief"),
  auctionResults: document.querySelector("#auctionResults"),
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
  shopBrief: document.querySelector("#shopBrief"),
  shopListings: document.querySelector("#shopListings"),
  livestream: document.querySelector("#livestreamPanel"),
  reports: document.querySelector("#reportsPanel"),
  collectionList: document.querySelector("#collectionList"),
  toast: document.querySelector("#toast")
};

function formatMoney(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN")}`;
}

function nowMs() {
  return Date.now() + serverClockOffset;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value) => String(value).padStart(2, "0");
  return hours ? `${two(hours)}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

function gameClock() {
  const dayLength = Number(state?.timing?.day || 20 * 60 * 1000);
  const startedAt = Number(state?.worldStartedAt || state?.auction?.registrationStartsAt || nowMs());
  const elapsed = Math.max(0, nowMs() - startedAt);
  const day = Math.floor(elapsed / dayLength) + 1;
  const dayProgress = elapsed % dayLength;
  const gameMinutes = Math.floor(dayProgress / dayLength * 24 * 60);
  const hour = Math.floor(gameMinutes / 60);
  const minute = gameMinutes % 60;
  return `第 ${day} 天 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function currentAuctionPhase(auction = state?.auction) {
  if (!auction) return "registration";
  if (auction.settledAt || (auction.results || []).length) return "settlement";
  if (nowMs() < Number(auction.startsAt || 0)) return "registration";
  if (nowMs() < Number(auction.biddingEndsAt || 0)) return "bidding";
  return "settlement";
}

function auctionPhaseMeta(auction = state?.auction) {
  const phase = currentAuctionPhase(auction);
  const meta = {
    registration: { label: "报名阶段", clock: "距报名截止", target: auction?.startsAt },
    bidding: { label: "竞价阶段", clock: "距竞价截止", target: auction?.biddingEndsAt },
    settlement: { label: "结算阶段", clock: "距下轮报名", target: auction?.settlementEndsAt }
  }[phase] || { label: "报名阶段", clock: "距报名截止", target: auction?.startsAt };
  return {
    ...meta,
    remain: Math.max(0, Number(meta.target || nowMs()) - nowMs())
  };
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

function inventoryCounts(me = {}) {
  const productionJobs = productionJobsFor(me);
  return {
    sealed: (me.rough || []).filter((rough) => !rough.revealed).length,
    revealed: (me.rough || []).filter((rough) => rough.revealed).length,
    jobs: productionJobs.length,
    products: (me.bracelets || []).length,
    collection: (me.collection || []).length
  };
}

function reminderRows() {
  if (!state?.me) return [];
  const { me } = state;
  const reminders = [];
  const jobs = productionJobsFor(me);
  const completable = (me.orders || []).filter((order) => matchingBracelets(order).length >= order.quantity);
  if (me.offlineSummary) reminders.push(["离线结算", `${me.offlineSummary.count} 件事已发生`]);
  if (!me.assets?.workshopOwned) reminders.push(["工坊未开", "去商铺买下街角小工坊"]);
  if (!me.assets?.livestreamPermitOwned && (me.bracelets || []).length) reminders.push(["直播未开", "成品可卖，先买直播许可"]);
  if (completable.length) reminders.push(["订单可交", `${completable.length} 个客户能交付`]);
  if (jobs.length) reminders.push(["加工中", `${jobs.length} 个任务等待完成`]);
  if (me.cash < 1000) reminders.push(["现金紧张", "优先回笼库存"]);
  return reminders.slice(0, 5);
}

function renderPlayerSidebar() {
  if (!els.sidebarStatus || !state?.me) return;
  const { me } = state;
  const counts = inventoryCounts(me);
  const auctionMeta = auctionPhaseMeta();
  const reminders = reminderRows();
  els.sidebarStatus.innerHTML = `
    <div class="sidebar-block">
      <p class="eyebrow">掌柜状态</p>
      <div class="status-metric"><span>现金</span><strong>${formatMoney(me.cash)}</strong></div>
      <div class="status-metric"><span>声望</span><strong>${Math.round(me.rep)} · ${repTier(me.rep)}</strong></div>
      <div class="status-metric"><span>满意</span><strong>${Math.round(me.satisfaction)}%</strong></div>
    </div>
    <div class="sidebar-block">
      <p class="eyebrow">库存</p>
      <div class="inventory-mini">
        <span>暗料 ${counts.sealed}</span>
        <span>加工 ${counts.jobs}</span>
        <span>明料 ${counts.revealed}</span>
        <span>成品 ${counts.products}</span>
        <span>藏品 ${counts.collection}</span>
      </div>
    </div>
    <div class="sidebar-block">
      <p class="eyebrow">时间</p>
      <div class="sidebar-clock"><strong>${gameClock()}</strong><span>${auctionMeta.label} · ${formatDuration(auctionMeta.remain)}</span></div>
    </div>
    <div class="sidebar-block">
      <p class="eyebrow">提醒</p>
      <div class="reminder-list">
        ${reminders.map(([title, text]) => `<div class="reminder-row"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`).join("") || `<div class="reminder-row"><strong>暂无急事</strong><span>可以看看公盘或账房</span></div>`}
      </div>
    </div>
  `;
}

function locationGate(location) {
  const me = state?.me || {};
  if (location.type === "ownedPrivate" && !me.assets?.[location.ownershipKey]) {
    return { visible: false, locked: true, reason: "尚未拥有" };
  }
  if (location.id === "livestream" && !me.assets?.livestreamPermitOwned) {
    return { visible: true, locked: true, reason: "需要直播经营许可" };
  }
  return { visible: true, locked: false, reason: "" };
}

function renderLocationCards() {
  if (!els.locationCards || !state) return;
  const cards = locationDefinitions.flatMap((location) => {
    const gate = locationGate(location);
    if (!gate.visible) return [];
    const action = gate.locked ? "lockedLocation" : "openLocation";
    return `
      <button class="location-card ${gate.locked ? "locked" : ""} ${activeView === location.view ? "active" : ""}" data-location="${location.view}" data-action="${action}" data-payload="${location.id}" type="button" aria-label="${escapeHtml(location.label)}">
        <span class="location-art ${escapeHtml(location.locationImage)}" aria-hidden="true"></span>
        <span class="location-copy">
          <span class="location-title">${escapeHtml(location.label)}</span>
          <span class="location-description">${escapeHtml(location.description)}</span>
        </span>
      </button>
    `;
  });
  els.locationCards.innerHTML = cards.join("");
}

function rankPosition(players, scoreFor, direction = "desc") {
  const ordered = [...players].sort((left, right) => {
    const diff = Number(scoreFor(right) || 0) - Number(scoreFor(left) || 0);
    return direction === "desc" ? diff : -diff;
  });
  const index = ordered.findIndex((player) => player.id === state.me.id);
  return index >= 0 ? index + 1 : null;
}

function renderRankBriefs() {
  if (!els.rankBriefList || !state?.me) return;
  const players = Array.isArray(state.players) ? state.players : [];
  const briefs = [
    ["声望榜", rankPosition(players, (player) => player.rep)],
    ["现金榜", rankPosition(players, (player) => player.cash)],
    ["藏品榜", rankPosition(players, (player) => player.collectionPower || player.collectionCount)],
    ["库存榜", rankPosition(players, (player) => player.inventoryCount)]
  ];
  els.rankBriefList.innerHTML = briefs.map(([label, rank]) => `
    <span class="rank-brief-item"><strong>${escapeHtml(label)}</strong><em>${rank ? `第${rank}名` : "未入榜"}</em></span>
  `).join("");
}

function button(label, action, payload = "", className = "") {
  return `<button class="${className}" data-action="${action}" data-payload="${escapeHtml(payload)}">${label}</button>`;
}

function viewButton(label, view, className = "") {
  return `<button class="${className}" data-view-link="${view}">${label}</button>`;
}

function openLocationByView(view) {
  if (view === "overview") {
    setView("overview");
    return;
  }

  const location = locationDefinitions.find((item) => item.view === view);
  if (!location) {
    setView("overview");
    return;
  }

  const gate = locationGate(location);
  if (gate.visible && !gate.locked) {
    setView(location.view);
    return;
  }

  if (location?.purchaseId) {
    showToast(`${gate.reason || "尚未解锁"}，先去商铺购买。`);
    setView("shop");
    return;
  }

  if (!gate.visible) {
    showToast(gate.reason || "条件未满足。");
    setView(location.ownershipKey ? "shop" : "overview");
    return;
  }

  showToast(gate.reason || "条件未满足。");
  setView("overview");
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
  const canBid = currentAuctionPhase(state.auction) === "bidding" && state.auction?.registered;
  const disabled = canBid ? "" : "disabled";
  const amount = bid?.amount || rough.price;
  const proxyMax = bid?.proxyMax || bid?.amount || Math.round(rough.price * 1.18);
  const countdown = auctionPhaseMeta(state.auction);
  const status = bid
    ? `<div class="bid-status success"><strong>已封存暗标</strong><span>出价 ${formatMoney(bid.amount)} · 代理 ${formatMoney(bid.proxyMax)} · 冻结 ${formatMoney(bid.deposit)} · ${countdown.clock} ${formatDuration(countdown.remain)}</span></div>`
    : `<div class="bid-status"><strong>${canBid ? "尚未投标" : "等待开盘"}</strong><span>暗拍不显示最高价和是否领先，开标后统一揭晓。</span></div>`;
  return `
    <div class="bid-controls">
      ${status}
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

function resultForRough(roughId) {
  return (state.auction?.results || []).find((result) => result.roughId === roughId);
}

function renderAuctionHalls() {
  const halls = state.auctionHalls || [];
  els.auctionHalls.innerHTML = halls.map((hall) => {
    const active = hall.active ? "active" : "";
    const locked = hall.unlocked ? "" : "locked";
    const canJoin = hall.active && hall.unlocked && currentAuctionPhase(state.auction) === "registration" && !state.auction?.registered;
    const note = hall.unlocked ? `${hall.tone} · ${hall.priceNote}` : `声望 ${hall.requiredRep} 解锁`;
    return `
      <article class="auction-hall ${active} ${locked}">
        <div>
          <strong>${escapeHtml(hall.label)}</strong>
          <span>${escapeHtml(note)}</span>
        </div>
        <button class="secondary" data-action="joinAuction" data-payload="${escapeHtml(hall.id)}" ${canJoin ? "" : "disabled"}>
          ${hall.active ? (state.auction?.registered ? "已报名" : "报名") : "未开放"}
        </button>
      </article>
    `;
  }).join("");
}

function renderAuctionResults(roughs = []) {
  const results = state.auction?.results || [];
  if (!results.length) {
    els.auctionResults.innerHTML = "";
    return;
  }
  const roughById = new Map(roughs.map((rough) => [rough.id, rough]));
  els.auctionResults.innerHTML = `
    <section class="auction-result-board">
      <div class="panel-head">
        <h3>${escapeHtml(state.auction?.hallLabel || "公盘")}开标结果</h3>
        <span>结果展示 ${formatDuration(auctionPhaseMeta(state.auction).remain)}</span>
      </div>
      <div class="auction-result-list">
        ${results.map((result) => {
          const rough = roughById.get(result.roughId);
          const isMine = result.winnerId === state.me.id;
          const status = result.status === "passed"
            ? "流拍"
            : result.status === "aiWon" || result.ai
              ? "AI 买手中标"
              : isMine
                ? "恭喜中标"
                : "他人中标";
          const tone = result.status === "passed" ? "muted" : isMine ? "success" : "risk";
          return `
            <div class="auction-result-row ${tone}">
              <strong>${escapeHtml(rough?.name || result.roughId)}</strong>
              <span>${status}</span>
              <small>成交 ${formatMoney(result.price)} · 投标 ${result.bids || 0} · 抵扣 ${formatMoney(result.depositUsed)}</small>
            </div>
          `;
        }).join("")}
      </div>
    </section>
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

function kitTemplateCanvas(kit, template) {
  const layout = kitLayout(kit.type);
  return jadeCanvasMarkup("kit", {
    id: kit.id,
    name: `${template.label}模板`,
    type: kit.type,
    layout,
    templateSize: { w: template.w, h: template.h },
    ringSize: layout === "bracelet" ? kit.ringSize || 56 : undefined
  }, "kit-template");
}

function consumedKitMaskCanvas(kit, template) {
  const layout = kitLayout(kit.type);
  return jadeCanvasMarkup("kitMask", {
    id: kit.id,
    name: `已取${template.label}`,
    type: kit.type,
    layout,
    templateSize: { w: template.w, h: template.h },
    ringSize: layout === "bracelet" ? kit.ringSize || 56 : undefined
  }, "kit-consumed");
}

function kitsFor(roughId) {
  if (!roughKits.has(roughId)) roughKits.set(roughId, []);
  return roughKits.get(roughId);
}

function defaultKitPosition(type, current) {
  const preferred = KIT_DEFAULT_POSITIONS[type] || KIT_FALLBACK_POSITIONS[current.length % KIT_FALLBACK_POSITIONS.length];
  const isOpen = (position) => !current.some((kit) => Math.hypot(kit.x - position.x, kit.y - position.y) < 18);
  const clampedPreferred = clampKitPosition(type, preferred.x, preferred.y);
  if (isOpen(clampedPreferred)) return clampedPreferred;
  const fallback = KIT_FALLBACK_POSITIONS
    .map((position) => clampKitPosition(type, position.x, position.y))
    .find(isOpen);
  return fallback || clampedPreferred;
}

function templateForKit(type) {
  return KIT_TEMPLATES[type] || KIT_TEMPLATES.bangle;
}

function kitCssPixels(value) {
  return `${Math.round((Number(value) || 28) * KIT_BOARD_UNIT_PX * 100) / 100}px`;
}

function clampKitPosition(type, x, y) {
  const template = templateForKit(type);
  const halfWidth = clampClient(Number(template.w) || 28, 8, 60) / 2;
  const halfHeight = clampClient(Number(template.h) || 28, 8, 60) / 2;
  return {
    x: clampClient(Math.round(Number(x) || 50), halfWidth, 100 - halfWidth),
    y: clampClient(Math.round(Number(y) || 50), halfHeight, 100 - halfHeight)
  };
}

function addRoughKit(roughId, type) {
  const current = kitsFor(roughId);
  const safeType = KIT_TEMPLATES[type] ? type : "bangle";
  const position = defaultKitPosition(safeType, current);
  const kit = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: safeType,
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
    kit.id === kitId ? { ...kit, ...clampKitPosition(kit.type, x, y) } : kit
  )));
  renderWorkshop();
  paintJades();
}

function kitOverlay(rough) {
  const saved = (rough.extractionKits || rough.braceletPlacements || []).map((kit) => ({ ...kit, saved: true }));
  const active = kitsFor(rough.id);
  return [...saved, ...active].map((kit) => {
    const template = KIT_TEMPLATES[kit.type] || KIT_TEMPLATES.bangle;
    const dragAttrs = kit.saved ? "" : `data-kit-id="${escapeHtml(kit.id)}" data-rough-id="${escapeHtml(rough.id)}" data-kit-type="${escapeHtml(kit.type)}"`;
    const width = Number(template.w) || 28;
    const height = Number(template.h) || 28;
    const canvas = kit.saved ? consumedKitMaskCanvas(kit, template) : kitTemplateCanvas(kit, template);
    return `
      <div class="kit-placement ${kit.saved ? "saved consumed" : "active"}" style="left:${kit.x}%;top:${kit.y}%;--kit-w:${width};--kit-h:${height};--kit-w-px:${kitCssPixels(width)};--kit-h-px:${kitCssPixels(height)};" ${dragAttrs}>
        ${canvas}
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
  document.querySelectorAll(".location-card").forEach((node) => node.classList.toggle("active", node.dataset.location === view));
  els.title.textContent = viewLabels[view] || "翡翠街";
  if (els.homeBtn) els.homeBtn.hidden = view === "overview";
  document.querySelector(".main-stage")?.classList.toggle("overview-mode", view === "overview");
  if (state) paintJades();
}

function initShell() {
  setView(activeView);
}

function render() {
  if (!state) return;
  const { me } = state;
  els.nameInput.value = me.name;

  renderPlayerSidebar();
  renderOverview();
  renderAuction();
  renderWorkshop();
  renderOrders();
  renderMarket();
  renderShop();
  renderLivestream();
  renderReports();
  renderCollection();
  paintJades();
}

function paintJades() {
  paintJadeCanvases();
}

function renderOverview() {
  renderLocationCards();
  renderRankBriefs();
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
  const phaseMeta = auctionPhaseMeta(auction);
  const phaseLabel = phaseMeta.label;
  const canRequestWindow = currentAuctionPhase(auction) === "bidding";
  renderAuctionHalls();
  renderAuctionResults(roughs);
  els.auctionBrief.innerHTML = `
    <span>${phaseLabel}</span>
    <span>${phaseMeta.clock} ${formatDuration(phaseMeta.remain)}</span>
    <span>${auction?.registered ? "已报名" : "未报名"}</span>
    <span>报名保证金 ${formatMoney(auction?.registrationDeposit)}</span>
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
            <button class="secondary" data-action="requestWindow" data-payload="${rough.id}" ${!canRequestWindow || !auction?.registered || windowFee > me.cash || windowCount(rough) >= 6 ? "disabled" : ""}>按点开窗 ${formatMoney(windowFee)}</button>
          </div>
          ${resultForRough(rough.id) ? `<p class="card-meta">开标：${escapeHtml(resultForRough(rough.id).status === "passed" ? "流拍" : resultForRough(rough.id).winnerId === me.id ? "你已中标" : "已成交")}</p>` : ""}
          ${renderAuctionBidControls(rough)}
        </div>
      </article>
    `;
  }).join("");
}

function renderWorkshop() {
  const { me } = state;
  const productionJobs = productionJobsFor(me);
  const refineJobs = productionJobs.filter((job) => job.stage === "refine");
  const roughProductionJobs = productionJobs.filter((job) => job.stage !== "refine");
  const sealed = me.rough.filter((rough) => !rough.revealed);
  const revealed = me.rough.filter((rough) => rough.revealed);
  els.roughCount.textContent = roughProductionJobs.length ? `${sealed.length} 原石 · ${roughProductionJobs.length} 加工任务` : sealed.length;
  els.materialCount.textContent = revealed.length + refineJobs.length;
  els.braceletCount.textContent = me.bracelets.length;

  const productionRows = roughProductionJobs.map((job) => {
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

  const refineRows = refineJobs.map((job) => {
    const item = job.item || {};
    const remain = Math.max(0, Math.ceil((job.readyAt - Date.now()) / 1000));
    const progress = Math.min(100, Math.round((Date.now() - job.startedAt) / Math.max(1, job.readyAt - job.startedAt) * 100));
    const savedCount = (item.extractionKits || item.braceletPlacements || []).length;
    return `
      <div class="item-row refine-progress-row">
        <div class="item-title"><span>${escapeHtml(item.name)}</span><span class="pill">精加工中</span></div>
        <p class="item-meta">${item.mass || "?"}kg · ${escapeHtml(item.quality || "已揭露")} · 已取 ${savedCount} 套 · 还需 ${remain} 秒</p>
        ${roughBoard(item)}
        <div class="machine-row inline-machine">
          <div class="machine-top"><div><strong>精加工中</strong><p class="item-meta">完成后原料回到这里，成品进入库存。</p></div></div>
          <div class="machine-track"><span style="width:${progress}%"></span></div>
        </div>
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

  els.materialInventory.innerHTML = [
    ...refineRows,
    ...revealed.map((item) => {
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
  })
  ].join("") || empty("全料打磨完成后，会在这里直接规划取手镯。");

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
  els.marketBrief.innerHTML = `<span>我的可卖 ${sellables.length}</span><span>我的挂单 ${ownListings.length}</span><span>玩家挂单 ${state.listings.length}</span>`;
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
  const listingRows = state.listings.map((listing) => {
    const own = listing.ownerId === state.me.id;
    return `
      <div class="item-row">
        <div class="item-title"><span>${escapeHtml(listing.item.name)}</span><span class="pill">${formatMoney(listing.price)}</span></div>
        <p class="item-meta">${escapeHtml(listing.ownerName)} · ${typeName(listing.type, listing.item)}</p>
        <div class="row-actions"><button data-action="buyListing" data-payload="${listing.id}" ${own ? "disabled" : ""}>买入</button></div>
      </div>
    `;
  }).join("");
  els.marketListings.innerHTML = listingRows || empty("玩家交易行还没有挂单。");
}

function renderShop() {
  if (!els.shopListings || !state) return;
  const assetListings = state.assetListings || [];
  els.shopBrief.innerHTML = `<span>可购内容 ${assetListings.length}</span><span>工坊 ${state.me.assets?.workshopOwned ? "已拥有" : "未拥有"}</span><span>直播许可 ${state.me.assets?.livestreamPermitOwned ? "已拥有" : "未拥有"}</span>`;
  els.shopListings.innerHTML = assetListings.map((listing) => `
    <div class="item-row asset-listing">
      <div class="item-title"><span>${escapeHtml(listing.name)}</span><span class="pill">${formatMoney(listing.price)}</span></div>
      <p class="item-meta">${escapeHtml(listing.description)}</p>
      <div class="card-actions"><button data-action="buyAssetListing" data-payload="${listing.id}">购买</button></div>
    </div>
  `).join("") || empty("商铺暂无可购买内容。");
}

function renderLivestream() {
  const products = state.me.bracelets || [];
  const jobs = state.me.livestreamJobs || [];
  const livestreamHistory = state.me.livestreamHistory || [];
  const modeName = {
    manual: "手动",
    autoConservative: "保守",
    autoBalanced: "均衡",
    autoAggressive: "激进"
  };
  const cards = [
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
  ];
  if (livestreamHistory.length) {
    cards.push(`
      <article class="rough-card livestream-history-card">
        <h3>最近直播</h3>
        <div class="fit-list">
          ${livestreamHistory.slice(0, 6).map((entry) => {
            const sold = Boolean(entry.outcome?.sold);
            const status = sold ? `成交 ${formatMoney(entry.outcome.price)}` : "未成交退回";
            return `
              <div>
                <strong>${escapeHtml(entry.product?.name || "成品")}</strong>
                <span>${escapeHtml(modeName[entry.mode] || entry.mode || "自动")} · ${status}</span>
              </div>
            `;
          }).join("")}
        </div>
      </article>
    `);
  }
  els.livestream.innerHTML = cards.join("") || empty("暂无可直播成品。");
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

function boardPointFromEvent(board, event, kitType = null) {
  const rect = board.getBoundingClientRect();
  const point = {
    x: (event.clientX - rect.left) / rect.width * 100,
    y: (event.clientY - rect.top) / rect.height * 100
  };
  if (kitType) return clampKitPosition(kitType, point.x, point.y);
  return {
    x: clampClient(point.x, 16, 84),
    y: clampClient(point.y, 16, 84)
  };
}

document.body.addEventListener("pointerdown", (event) => {
  const kit = event.target.closest("[data-kit-id]");
  if (!kit) return;
  activeDragKit = {
    roughId: kit.dataset.roughId,
    kitId: kit.dataset.kitId,
    type: kit.dataset.kitType || "bangle"
  };
  event.preventDefault();
});

document.body.addEventListener("pointermove", (event) => {
  if (!activeDragKit) return;
  const board = document.querySelector(`[data-rough-board="${CSS.escape(activeDragKit.roughId)}"]`);
  if (!board) return;
  const point = boardPointFromEvent(board, event, activeDragKit.type);
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
    openLocationByView(viewLink.dataset.viewLink);
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

  if (action === "openLocation") {
    const location = locationDefinitions.find((item) => item.id === payload);
    openLocationByView(location?.view || payload);
    return;
  }

  if (action === "lockedLocation") {
    const location = locationDefinitions.find((item) => item.id === payload);
    openLocationByView(location?.view || payload);
    return;
  }

  if (action === "buyAssetListing") {
    socket.emit("buyAssetListing", payload);
    return;
  }

  if (action === "requestWindow") {
    const targetPoint = windowTargetFor(payload);
    socket.emit("requestWindow", { roughId: payload, hallId: state.auction?.hallId, x: targetPoint.x, y: targetPoint.y });
    return;
  }

  if (action === "joinAuction") {
    socket.emit("joinAuction", { hallId: payload });
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
      hallId: state.auction?.hallId,
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
  if (Number.isFinite(Number(nextState.serverNow))) {
    serverClockOffset = Number(nextState.serverNow) - Date.now();
  }
  state = nextState;
  render();
});

socket.on("toast", showToast);

initShell();

window.setInterval(() => {
  if (!state) return;
  renderPlayerSidebar();
  renderAuction();
  paintJades();
}, 1000);
