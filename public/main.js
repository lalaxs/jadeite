import { jadeCanvasMarkup, paintJadeCanvases } from "./jade-renderer.js";
import { reportSummary } from "./jade-loop.js";
import {
  productMatchesOrder,
  productOrderFitReasons,
  liveSaleRange,
  routeRecommendation
} from "./jade-rules.js";
import { productKindLabel } from "./jade-categories.js";
import {
  KIT_LIB as OPENING_KIT_LIB,
  buildOpeningStone,
  computeGrade as computeOpeningGrade,
  computeOverlaps as computeOpeningOverlaps,
  evaluateOpeningKit,
  mapOpeningKitToProductKind,
  renderJadeOpeningProductSvg,
  renderJadeOpeningSvg,
  scaleForOpeningKit
} from "./jade-opening-engine.js";
import {
  initAuctionModule,
  currentAuctionPhase, auctionPhaseMeta, auctionRoundLabel,
  windowCount, isWindowSelectionActive, canOpenWindow, startWindowSelection, requestAuctionWindowAt, clearWindowSelection,
  auctionStoneSizeClass, auctionStoneSizeLabel, auctionStoneBoard, stoneSvg,
  myBidFor, renderAuctionBidControls,
  selectedAuctionHall, enterAuctionHall, backAuctionHalls, renderAuctionHalls, renderAuctionLotCard,
  formatHistoryTime, auctionResultRow, renderAuctionHistory,
  renderAuction, updateAuctionChrome, jadeIconSvg
} from "./auction-module.js";
import {
  initMarketModule,
  marketQualityKey, marketQualityMeta, marketGemColor, marketRefValue, marketPriceDelta, marketElapsed,
  marketSellables, marketAffordable, renderMarket, renderMarketSection, renderMarketStalls, renderMarketFilters,
  marketFilterSort, marketCardHtml, renderMarketGrid, renderMarketMine, renderMarketWants,
  bindMarketOnce, syncMarketFilterInputs, openMarketListModal, updateMarketListModal, confirmMarketList,
  openMarketBuy, confirmMarketBuy, closeMarketModals,
  marketSetStall, marketSetSection, marketToggleQ
} from "./market-module.js";
import {
  initWorkshopModule,
  workshopDevices, workshopWorkers, workshopWorkerFor, workshopJobs, workshopProcessableItems, workshopStageItems,
  workshopOutputLabel, workshopDurationLabel, workshopWorkerImpact, workshopDeviceImpact, workshopJobEstimate,
  workshopJobProgress, workshopItemPreview, workshopRecipeCard, workshopRecipeHome, workshopStageInventory,
  workshopMaterialRow, workshopRecipeSummary, workshopStageDrawer, workshopRecommendedWorkerId, workshopWorkerColumn,
  workshopRecipePage, renderWorkshop,
  workshopOpenDevice, workshopBackDevices, workshopSelectItem, workshopStartJob, workshopAssignWorker, workshopRecommendWorker, workshopSelectStep,
  workshopOpenPicker, workshopClosePicker, workshopPickItem, workshopPickWorker, workshopConfirmPickerWorker, workshopSetSort
} from "./workshop-module.js";
import {
  initChatModule,
  formatMessageTime, messageSortAtFromClock, pushMessageRow, homeMessageRows,
  renderHomeMessages, scrollHomeMessagesToLatest, sendChat, chatSelectChannel
} from "./chat-module.js";
import {
  initRankingModule,
  rankBoardById, rankingRowsFor, renderRankingBoard,
  rankingOpenBoard, rankingSelectBoard
} from "./ranking-module.js";
import {
  initOrdersModule,
  renderOrders, ordersComplete
} from "./orders-module.js";
import {
  initLivestreamModule,
  renderLivestream, livestreamSchedule
} from "./livestream-module.js";
import {
  initExtraModule,
  renderShop, renderRecruitCandidates, renderReports, renderCollection
} from "./extra-module.js";

const playerId = sessionStorage.getItem("jade-player-id");
const socket = io({ auth: { playerId } });

const viewLabels = {
  overview: "翡翠街",
  auction: "公盘",
  auctionHistory: "历史拍卖成功",
  workshop: "工坊",
  market: "交易行",
  shop: "商铺",
  rankings: "排行榜",
  livestream: "直播间",
  orders: "订单",
  collection: "藏品",
  hireMarket: "招募",
  reports: "经营账房"
};

const locationDefinitions = [
  { id: "auction", view: "auction", label: "公盘", locationImage: "auction", type: "public", description: "暗标拍原石，开窗会公开信息。" },
  { id: "playerMarket", view: "market", label: "交易行", locationImage: "market", type: "public", description: "玩家之间买卖翡翠中间物和成品。" },
  { id: "shop", view: "shop", label: "商铺", locationImage: "shop", type: "public", description: "购买工坊、直播许可等功能建筑。" },
  { id: "orders", view: "orders", label: "订单", locationImage: "orders", type: "public", description: "接定制单，换现金和口碑。" },
  { id: "collection", view: "collection", label: "藏品", locationImage: "collection", type: "public", description: "收藏精品，提高门面声望。" },
  { id: "hireMarket", view: "hireMarket", label: "招募", locationImage: "hireMarket", type: "public", description: "招募掌柜与管家，扩展经营人力。" },
  { id: "livestream", view: "livestream", label: "直播间", locationImage: "livestream", type: "lockedPublic", description: "自动直播卖货，适合处理成品库存。", purchaseId: "livestream-permit" },
  { id: "workshop", view: "workshop", label: "工坊", locationImage: "workshop", type: "ownedPrivate", description: "打磨原石、取件、精加工。", ownershipKey: "workshopOwned" }
];

let state = null;
let activeView = "overview";
let activeDragKit = null;
let serverClockOffset = 0;
let activeModal = null;

const shownUiEventIds = new Set();
const roughKits = new Map();
const openingStoneCache = new Map();

const OPENING_KIT_SERVER_TYPES = {
  egg: "cabochon",
  ping: "peacePendant",
  rect: "plaque",
  drop: "dropPendant",
  leaf: "leafPendant",
  bangle: "bangle",
  buddha: "buddhaPendant"
};
const OPENING_KIT_BY_SERVER_TYPE = Object.fromEntries(
  Object.entries(OPENING_KIT_SERVER_TYPES).map(([tpl, type]) => [type, tpl])
);


const els = {
  sidebarStatus: document.querySelector("#sidebarStatus"),
  locationCards: document.querySelector("#locationCards"),
  messageChannelTabs: document.querySelector("#messageChannelTabs"),
  homeMessageLog: document.querySelector("#homeMessageLog"),
  rankingTitle: document.querySelector("#rankingTitle"),
  rankingTabs: document.querySelector("#rankingTabs"),
  rankingList: document.querySelector("#rankingList"),
  auctionHeadTitle: document.querySelector("#auctionHeadTitle"),
  auctionHeadDesc: document.querySelector("#auctionHeadDesc"),
  connection: document.querySelector("#connectionText"),
  nameInput: document.querySelector("#nameInput"),
  saveNameBtn: document.querySelector("#saveNameBtn"),
  auctionHalls: document.querySelector("#auctionHalls"),
  auctionBrief: document.querySelector("#auctionBrief"),
  auctionHistoryBrief: document.querySelector("#auctionHistoryBrief"),
  auctionHistoryList: document.querySelector("#auctionHistoryList"),
  roughPool: document.querySelector("#roughPool"),
  workshopRoot: document.querySelector("#workshopRoot"),
  orders: document.querySelector("#ordersList"),
  orderBrief: document.querySelector("#orderBrief"),
  refreshOrders: document.querySelector("#refreshOrdersBtn"),
  marketHeroStats: document.querySelector("#marketHeroStats"),
  marketMineCnt: document.querySelector("#marketMineCnt"),
  marketStalls: document.querySelector("#marketStalls"),
  marketShop: document.querySelector("#marketShop"),
  marketQFilters: document.querySelector("#marketQFilters"),
  marketPriceMin: document.querySelector("#marketPriceMin"),
  marketPriceMax: document.querySelector("#marketPriceMax"),
  marketAfford: document.querySelector("#marketAfford"),
  marketReset: document.querySelector("#marketReset"),
  marketSearch: document.querySelector("#marketSearch"),
  marketSort: document.querySelector("#marketSort"),
  marketGrid: document.querySelector("#marketGrid"),
  marketListModal: document.querySelector("#marketListModal"),
  marketBuyModal: document.querySelector("#marketBuyModal"),
  marketListItem: document.querySelector("#marketListItem"),
  marketListPrice: document.querySelector("#marketListPrice"),
  marketListSuggest: document.querySelector("#marketListSuggest"),
  marketListFee: document.querySelector("#marketListFee"),
  marketBuyBody: document.querySelector("#marketBuyBody"),
  shopBrief: document.querySelector("#shopBrief"),
  shopListings: document.querySelector("#shopListings"),
  equipmentShop: document.querySelector("#equipmentShop"),
  materialInventory: document.querySelector("#materialInventory"),
  refreshRecruitBtn: document.querySelector("#refreshRecruitBtn"),
  recruitCandidateList: document.querySelector("#recruitCandidateList"),
  livestream: document.querySelector("#livestreamPanel"),
  reports: document.querySelector("#reportsPanel"),
  collectionList: document.querySelector("#collectionList"),
  floatingTextLayer: document.querySelector("#floatingTextLayer"),
  modalRoot: document.querySelector("#modalRoot"),
  toast: document.querySelector("#toast"),
  topHud: document.querySelector("#topHud"),
  playerCard: document.querySelector("#playerCard"),
  chatInput: document.querySelector("#chatInput"),
  chatSend: document.querySelector("#chatSend"),
  mainNav: document.querySelector("#mainNav"),
  mainStage: document.querySelector("#mainStage"),
  sidePanel: document.querySelector("#sidePanel"),
  sidePanelToggle: document.querySelector("#sidePanelToggle"),
  chatDock: document.querySelector("#chatDock"),
  chatDockToggle: document.querySelector("#chatDockToggle"),
  sidePanelBody: document.querySelector("#sidePanelBody"),
  panelTabs: document.querySelector("#panelTabs"),
  homeTabs: document.querySelector("#homeTabs"),
  homeStatusPane: document.querySelector("#homeStatusPane"),
  homeTaskPane: document.querySelector("#homeTaskPane"),
  homeCommissionPane: document.querySelector("#homeCommissionPane"),
  homeBillPane: document.querySelector("#homeBillPane"),
  themeToggle: document.querySelector("#themeToggle")
};

function formatMoney(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN")}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
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
  const startedAt = Number(state?.worldStartedAt || state?.auction?.startsAt || nowMs());
  const elapsed = Math.max(0, nowMs() - startedAt);
  const day = Math.floor(elapsed / dayLength) + 1;
  const dayProgress = elapsed % dayLength;
  const gameMinutes = Math.floor(dayProgress / dayLength * 24 * 60);
  const hour = Math.floor(gameMinutes / 60);
  const minute = gameMinutes % 60;
  return `第 ${day} 天 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// 把游戏时钟拆成「天数 / 时间」两个独立值，供顶栏 HUD 分两段显示（不上下堆叠）
function gameClockParts() {
  const dayLength = Number(state?.timing?.day || 20 * 60 * 1000);
  const startedAt = Number(state?.worldStartedAt || state?.auction?.startsAt || nowMs());
  const elapsed = Math.max(0, nowMs() - startedAt);
  const day = Math.floor(elapsed / dayLength) + 1;
  const dayProgress = elapsed % dayLength;
  const gameMinutes = Math.floor(dayProgress / dayLength * 24 * 60);
  const hour = Math.floor(gameMinutes / 60);
  const minute = gameMinutes % 60;
  return { day, time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

// 毫秒倒计时 → HH:MM:SS / MM:SS
function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

function signedMoney(value) {
  const amount = Number(value || 0);
  const sign = amount >= 0 ? "+" : "-";
  return `${sign}${formatMoney(Math.abs(amount))}`;
}

function uiText(payload) {
  if (typeof payload === "string") return payload;
  return String(payload?.text || payload?.message || payload?.title || "");
}

function rememberUiEvent(event) {
  const id = typeof event === "string" ? event : event?.id;
  if (!id) return false;
  if (shownUiEventIds.has(id)) return true;
  shownUiEventIds.add(id);
  if (shownUiEventIds.size > 80) {
    const [oldest] = shownUiEventIds;
    shownUiEventIds.delete(oldest);
  }
  return false;
}

function floatingPoint(payload = {}) {
  const jitter = Math.random() * 12 - 6;
  const x = Number.isFinite(Number(payload.x)) ? Number(payload.x) : 50 + jitter;
  const y = Number.isFinite(Number(payload.y)) ? Number(payload.y) : 70 + Math.random() * 10;
  return {
    x: clampClient(x, 12, 88),
    y: clampClient(y, 18, 84)
  };
}

function spawnFloatingText(payload) {
  const text = uiText(payload);
  if (!text || !els.floatingTextLayer) return;
  const point = floatingPoint(typeof payload === "object" ? payload : {});
  const tone = typeof payload === "object" ? payload.tone || payload.kind || "info" : "info";
  const node = document.createElement("div");
  node.className = `floating-text ${String(tone).replace(/[^\w-]/g, "") || "info"}`;
  node.textContent = text;
  node.style.setProperty("--float-x", `${point.x}%`);
  node.style.setProperty("--float-y", `${point.y}%`);
  els.floatingTextLayer.append(node);

  const activeFloats = [...els.floatingTextLayer.querySelectorAll(".floating-text")];
  for (const stale of activeFloats.slice(0, Math.max(0, activeFloats.length - 16))) {
    stale.remove();
  }
  node.addEventListener("animationend", () => node.remove(), { once: true });
  // 游戏化正反馈：金钱类信息让 HUD 现金块脉冲一下
  if (tone === "income" || tone === "expense") pulse("#hudCashStat", tone === "expense" ? "gold" : "jade");
  if (payload && payload.pulse) pulse(payload.pulse, payload.pulseTone || "jade");
}

// ===== 数值滚动动画 + 脉冲反馈（游戏化：让"钱变多/升级"有手感）=====
let hudPrev = { cash: null, rep: null };
function animateNumber(el, from, to, fmt) {
  if (!el) return;
  from = Number(from); to = Number(to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const dur = 650, start = performance.now();
  (function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmt(to);
  })(performance.now());
}

function pulse(selector, tone = "jade") {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const cls = `pulse-${tone}`;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}

// 每秒只刷新倒计时文字，避免整段 HUD 重建打断数值滚动动画
function tickHudClock() {
  if (!els.topHud) return;
  const clockEl = els.topHud.querySelector('[data-hud="clock"]');
  if (clockEl) clockEl.textContent = formatCountdown(auctionPhaseMeta().remain);
}

function modalStatsHtml(stats = []) {
  if (!Array.isArray(stats) || !stats.length) return "";
  return stats.map((stat) => `
    <div class="game-modal-stat">
      <span>${escapeHtml(stat.label)}</span>
      <strong>${escapeHtml(stat.value)}</strong>
    </div>
  `).join("");
}

function modalLinesHtml(lines = []) {
  if (!Array.isArray(lines) || !lines.length) return "";
  return `
    <div class="game-modal-lines">
      ${lines.slice(0, 8).map((line) => `<div class="game-modal-line">${escapeHtml(line)}</div>`).join("")}
    </div>
  `;
}

function modalParagraphsHtml(payload = {}) {
  const paragraphs = Array.isArray(payload.body)
    ? payload.body
    : [payload.body || payload.text || payload.message].filter(Boolean);
  return paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function modalActionHtml(action = {}, index = 0) {
  const label = escapeHtml(action.label || (index ? "取消" : "知道了"));
  const variant = action.variant === "warn" ? "warn" : action.variant === "secondary" ? "secondary" : "";
  const className = variant ? ` class="${variant}"` : "";
  if (action.socketAction) {
    return `<button${className} data-modal-emit="${escapeHtml(action.socketAction)}" data-modal-payload="${escapeHtml(action.payload || "")}" type="button">${label}</button>`;
  }
  return `<button${className} data-modal-close type="button">${label}</button>`;
}

function openGameModal(payload = {}) {
  if (!els.modalRoot) return;
  activeModal = payload;
  const actions = Array.isArray(payload.actions) && payload.actions.length
    ? payload.actions
    : [{ label: payload.confirmText || "知道了" }];
  els.modalRoot.innerHTML = `
    <section class="game-modal" data-tone="${escapeHtml(payload.tone || "info")}" role="dialog" aria-modal="true" aria-labelledby="gameModalTitle">
      <div class="game-modal-head">
        <div class="game-modal-title">
          <h3 id="gameModalTitle">${escapeHtml(payload.title || "提示")}</h3>
          ${payload.subtitle ? `<p>${escapeHtml(payload.subtitle)}</p>` : ""}
        </div>
        <button class="modal-close" data-modal-close type="button" aria-label="关闭弹窗">×</button>
      </div>
      <div class="game-modal-body">
        ${modalParagraphsHtml(payload)}
        ${modalStatsHtml(payload.stats)}
        ${modalLinesHtml(payload.lines)}
        ${payload.html ? payload.html : ""}
      </div>
      <div class="game-modal-actions">
        ${actions.map(modalActionHtml).join("")}
      </div>
    </section>
  `;
  els.modalRoot.hidden = false;
  els.modalRoot.querySelector("[data-modal-close], button")?.focus();
}

function closeGameModal() {
  if (!els.modalRoot) return;
  activeModal = null;
  els.modalRoot.hidden = true;
  els.modalRoot.innerHTML = "";
}

function handleUiEvent(event) {
  if (Array.isArray(event)) {
    event.forEach(handleUiEvent);
    return;
  }
  const payload = typeof event === "string" ? { type: "toast", text: event } : event;
  if (!payload || typeof payload !== "object") return;
  if (rememberUiEvent(payload)) return;
  const type = payload.type || payload.kind || "toast";
  if (type === "modal") {
    openGameModal(payload);
    if (payload.floatText) spawnFloatingText({ text: payload.floatText, tone: payload.tone });
    return;
  }
  if (type === "float" || type === "floatingText") {
    spawnFloatingText(payload);
    return;
  }
  showToast(payload);
}

function maybeShowStateDrivenModals(nextState = state) {
  const summary = nextState?.me?.offlineSummary;
  if (!summary || !Number(summary.count)) return;
  const lines = Array.isArray(summary.lines) ? summary.lines : [];
  const net = Number(summary.income || 0) - Number(summary.expense || 0);
  const id = `offline:${nextState.me.id}:${summary.count}:${summary.income || 0}:${summary.expense || 0}:${lines.join("|")}`;
  if (rememberUiEvent({ id })) return;
  spawnFloatingText({
    id: `${id}:float`,
    text: `离线结算 ${signedMoney(net)}`,
    tone: net >= 0 ? "income" : "expense",
    x: 50,
    y: 58
  });
  openGameModal({
    id,
    type: "modal",
    tone: net >= 0 ? "success" : "warn",
    title: "离线结算",
    subtitle: `${Number(summary.count)} 件事已完成`,
    body: "你离开期间，工坊、直播和订单继续推进。",
    stats: [
      { label: "收入", value: formatMoney(summary.income) },
      { label: "支出", value: formatMoney(summary.expense) },
      { label: "净现金", value: signedMoney(net) }
    ],
    lines
  });
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
  // 公盘时间提醒（左侧提醒栏）：开标倒计时实时跟随
  if (state?.auction) {
    const a = auctionPhaseMeta(state.auction);
    reminders.unshift(["公盘开标", `${a.clock} ${formatDuration(a.remain)}`]);
  }
  return reminders.slice(0, 5);
}

function starsHtml(n, max = 5) {
  let s = "";
  for (let i = 1; i <= max; i++) s += i <= n ? "★" : '<span class="off">★</span>';
  return `<span class="mini-stars">${s}</span>`;
}

// ===== 左导航图标 =====
const NAV_ICONS = {
  overview: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>`,
  auction: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3l7 7-3 3-7-7zM11 6L4 13l3 3 7-7M3 21l5-5"/></svg>`,
  market: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0"/></svg>`,
  shop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-4h15L21 9M5 9v10h14V9M9 19v-5h6v5"/></svg>`,
  workshop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>`,
  orders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4V3h6v1M9 9h6M9 13h6M9 17h4"/></svg>`,
  livestream: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>`,
  collection: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12l3 5-9 11L3 9zM3 9h18M9 4l3 5 3-5"/></svg>`,
  reports: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-9"/></svg>`,
  rankings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v4a4 4 0 0 1-8 0zM8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M10 14h4M9 20h6M12 14v6"/></svg>`,
  blackmarket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10a7 7 0 0 1 14 0v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM9 11h.01M15 11h.01M10 17h4"/></svg>`,
  hireMarket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.2"/><path d="M4 20a6 6 0 0 1 12 0M18 8v6M15 11h6"/></svg>`
};

// ===== 左导航：主页 + 各地点 + 黑市(锁定) + 排行榜 =====
function renderMainNav() {
  if (!els.mainNav) return;
  const locItems = locationDefinitions.map((loc) => ({
    label: loc.label, id: loc.id, view: loc.view, type: "loc", icon: loc.view
  }));
  const extra = [
    { label: "主页", view: "overview", type: "overview", icon: "overview" },
    { label: "黑市", view: "blackmarket", type: "locked", icon: "blackmarket" },
    { label: "排行榜", view: "rankings", type: "rank", icon: "rankings" }
  ];
  const items = [extra[0], ...locItems, extra[1], extra[2]];
  els.mainNav.innerHTML = items.map((it) => {
    const active = activeView === it.view ? " active" : "";
    const ico = `<span class="nav-ico">${NAV_ICONS[it.icon] || ""}</span>`;
    if (it.type === "locked") {
      return `<button class="main-nav-item locked" disabled type="button" title="即将开放">${ico}${escapeHtml(it.label)}</button>`;
    }
    if (it.type === "rank") {
      return `<button class="main-nav-item${active}" data-action="openRankBoard" type="button">${ico}${escapeHtml(it.label)}</button>`;
    }
    if (it.type === "overview") {
      return `<button class="main-nav-item${active}" data-action="openLocation" data-payload="overview" type="button">${ico}${escapeHtml(it.label)}</button>`;
    }
    return `<button class="main-nav-item${active}" data-action="openLocation" data-payload="${escapeHtml(it.id)}" type="button">${ico}${escapeHtml(it.label)}</button>`;
  }).join("");
}

// ===== 右侧常驻「进行事项」面板 =====
// 筛选状态：null = 不过滤（显示全部）；否则只显示对应 plane
let sidePanelFilter = null;
function applySidePanelFilter() {
  if (!els.sidePanelBody) return;
  els.sidePanelBody.querySelectorAll("[data-pplane]").forEach((p) => {
    p.hidden = sidePanelFilter ? (p.dataset.pplane !== sidePanelFilter) : false;
  });
}
function renderSidePanel() {
  if (!els.sidePanelBody || !state?.me) return;
  const { me } = state;
  const jobs = workshopJobs();
  const orders = me.orders || [];
  const reminders = reminderRows();

  const workshopHtml = jobs.length ? jobs.map((job) => {
    const total = Math.max(1, Number(job.readyAt || 0) - Number(job.startedAt || nowMs()));
    const elapsed = Math.max(0, nowMs() - Number(job.startedAt || nowMs()));
    const pct = Math.max(2, Math.min(100, Math.round((elapsed / total) * 100)));
    const remain = Math.max(0, Math.ceil((Number(job.readyAt || nowMs()) - nowMs()) / 60000));
    const name = job.item?.name || "物料";
    return `<div class="side-prog">
        <div class="side-prog-top"><span>${escapeHtml(name)}</span><span class="side-prog-eta">${remain} min</span></div>
        <div class="side-prog-bar"><i class="${pct >= 100 ? "done" : ""}" style="width:${pct}%"></i></div>
      </div>`;
  }).join("") : `<div class="side-empty">暂无加工任务</div>`;

  const ordersHtml = orders.length ? orders.map((order) => {
    const rating = Math.max(0, Math.min(5, Math.round((me.satisfaction || 0) / 20)));
    const minutes = Math.max(0, Math.ceil((order.expiresAt - Date.now()) / 60000));
    return `<div class="side-order">
        <div class="side-order-head"><span class="side-order-who">${escapeHtml(order.client)}</span>${starsHtml(rating)}</div>
        <div class="side-order-req">${escapeHtml(order.taste)} · 需 ${order.quantity} 件 · ${escapeHtml(order.minQuality)}</div>
        <div class="side-order-pay">${formatMoney(order.pay)} <span class="side-order-meta">剩 ${minutes} 分钟</span></div>
      </div>`;
  }).join("") : `<div class="side-empty">暂无委托订单</div>`;

  const remindHtml = reminders.length ? reminders.map(([title, text]) => `
      <div class="side-remind-row"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>
    `).join("") : `<div class="side-empty">暂无提醒</div>`;

  els.sidePanelBody.innerHTML = `
    <div data-pplane="workshop">${workshopHtml}</div>
    <div data-pplane="order" hidden>${ordersHtml}</div>
    <div data-pplane="remind" hidden>${remindHtml}</div>
    <div data-pplane="achv" hidden>${achievementsHtml()}</div>
  `;
  applySidePanelFilter();
}

function renderPlayerSidebar() {
  if (!els.sidebarStatus || !state?.me) return;
  const { me } = state;
  const counts = inventoryCounts(me);
  const reminders = reminderRows();
  els.sidebarStatus.innerHTML = `
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
      <p class="eyebrow">提醒</p>
      <div class="reminder-list">
        ${reminders.map(([title, text]) => `<div class="reminder-row"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`).join("") || `<div class="reminder-row"><strong>暂无急事</strong><span>可以看看公盘或账房</span></div>`}
      </div>
    </div>
  `;
}

// ===== 顶栏资源条（分段式 HUD）：现金 / 声望·Lv / 客户评级 / 公盘结束 / 时间 =====
// 客户评级（★1-5）由满意度推导示意；倒计时与时间仅放顶栏。
function renderTopHud() {
  if (!els.topHud || !state?.me) return;
  const { me } = state;
  const rep = Number(me.rep || 0);
  const level = repLevelTier(rep);
  const repTitle = repTier(rep);
  const satisfaction = Math.round(Number(me.satisfaction || 0));
  const rating = Math.max(0, Math.min(5, Math.round(satisfaction / 20)));
  const countdown = formatCountdown(auctionPhaseMeta().remain);

  const starsHtml = (n) => {
    let s = "";
    for (let i = 1; i <= 5; i++) s += i <= n ? "★" : '<span class="off">★</span>';
    return `<span class="hud-stars">${s}</span>`;
  };

  const ico = {
    cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l3.5 4 3.5-4M12 12.5V16M9.5 14h5"/></svg>',
    rep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/><path d="M9 13l-1.5 7L12 18l4.5 2L15 13"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.8 5.9 20.4l1.5-6.8L2.2 9l6.9-.7z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };

  els.topHud.innerHTML = `
    <div class="hud-stat is-gold" id="hudCashStat">
      <span class="hud-ico">${ico.cash}</span>
      <div class="hud-meta"><b data-hud="cash">${formatMoney(me.cash)}</b><span>现金</span></div>
    </div>
    <div class="hud-stat is-jade">
      <span class="hud-ico">${ico.rep}</span>
      <div class="hud-meta">
        <div class="hud-rep-row"><b data-hud="rep">${formatNumber(rep)}</b><i class="hud-rep-title">${escapeHtml(repTitle)}</i></div>
        <span>声望 · Lv.${level}</span>
      </div>
    </div>
    <div class="hud-stat">
      <span class="hud-ico">${ico.star}</span>
      <div class="hud-meta"><b>${starsHtml(rating)}</b><span>客户评级</span></div>
    </div>
    <div class="hud-stat is-muted">
      <span class="hud-ico">${ico.clock}</span>
      <div class="hud-meta"><b data-hud="clock">${countdown}</b><span>公盘结束</span></div>
    </div>
  `;
  const cashEl = els.topHud.querySelector('[data-hud="cash"]');
  const repEl = els.topHud.querySelector('[data-hud="rep"]');
  const newCash = Number(me.cash || 0);
  animateNumber(cashEl, hudPrev.cash ?? newCash, newCash, (v) => formatMoney(Math.round(v)));
  animateNumber(repEl, hudPrev.rep ?? rep, rep, (v) => formatNumber(Math.round(v)));
  hudPrev.cash = newCash;
  hudPrev.rep = rep;
}

// ===== 左栏玩家信息卡：头像接口占位 + 等级 + 经验值（经验由声望推导，因 me 无 exp 字段）=====
function renderPlayerCard() {
  if (!els.playerCard || !state?.me) return;
  const { me } = state;
  const rep = Number(me.rep || 0);
  const level = repLevelTier(rep);
  const thresholds = [0, 30, 80, 160, 320];
  const lower = thresholds[level - 1];
  const maxed = repNextThreshold(rep) === null;
  const upper = thresholds[level] ?? rep;
  const cur = maxed ? rep : rep - lower;
  const span = maxed ? 1 : Math.max(1, upper - lower);
  const pct = Math.max(4, Math.min(100, Math.round((cur / span) * 100)));
  const initial = (me.name || "翠").trim().charAt(0) || "翠";

  els.playerCard.innerHTML = `
    <div class="player-id">
      <div class="avatar" data-avatar-slot="player" title="头像占位（后续接入头像）">
        <span class="ph">${escapeHtml(initial)}</span>
      </div>
      <div class="player-meta">
        <div class="player-name">${escapeHtml(me.name || "无名")}</div>
        <div class="player-lv">等级 <b>Lv.${level}</b></div>
      </div>
    </div>
    <div class="exp">
      <div class="exp-top"><span>经验值</span><b>${maxed ? "已满级" : `${formatNumber(cur)} / ${formatNumber(span)}`}</b></div>
      <div class="exp-bar"><i class="${maxed ? "done" : ""}" style="width:${pct}%"></i></div>
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
  if (type === "bracelet") return `${materialStageLabel(item)} · ${productKindLabel(item.kind)}`;
  if (type === "rough") return materialStageLabel(item);
  return { material: "明料", slice: "片料" }[type] || type;
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


function repTier(rep) {
  if (rep >= 320) return "宗师";
  if (rep >= 160) return "名店";
  if (rep >= 80) return "熟行";
  if (rep >= 30) return "起势";
  return "新人";
}

function repLevelTier(rep) {
  if (rep >= 320) return 5;
  if (rep >= 160) return 4;
  if (rep >= 80) return 3;
  if (rep >= 30) return 2;
  return 1;
}

function repNextThreshold(rep) {
  if (rep >= 320) return null;
  if (rep >= 160) return 320;
  if (rep >= 80) return 160;
  if (rep >= 30) return 80;
  return 30;
}

function riskTone(risk) {
  if (risk >= 80) return "高危";
  if (risk >= 55) return "谨慎";
  return "稳妥";
}

function materialStageForClient(item = {}) {
  if (item.materialStage) return item.materialStage;
  if (item.type === "rough") return item.revealed || item.polished ? "opened" : "rough";
  if (item.stage === "opened" || item.stage === "material") return "opened";
  if (item.stage === "carved") return "carved";
  if (item.stage === "polished") return "polished";
  if (item.stage === "finished" || item.inlaid) return "finished";
  if (item.type === "bracelet") return "finished";
  return "unknown";
}

function materialStageLabel(itemOrStage = {}) {
  const stage = typeof itemOrStage === "string" ? itemOrStage : materialStageForClient(itemOrStage);
  return {
    rough: "暗料原石",
    opened: "明料",
    carved: "精雕毛坯",
    polished: "抛光半成品",
    finished: "最终成品"
  }[stage] || "阶段产物";
}

function finishedProducts() {
  return (state.me.bracelets || []).filter((product) => materialStageForClient(product) === "finished");
}

function matchingBracelets(order) {
  return finishedProducts().filter((product) => productMatchesOrder(product, order));
}


function productName(item) {
  return productKindLabel(item.kind) || item.design || "成品";
}


function expertClueChips(rough) {
  const clues = Array.isArray(rough.expertClues) ? rough.expertClues : [];
  if (!clues.length) return "";
  return `<div class="expert-clues">${clues.map((clue) => `<span>${escapeHtml(clue)}</span>`).join("")}</div>`;
}

function placementAnalysisRows(rough, kits) {
  if (!kits.length) return `<div class="placement-analysis muted">选择套件后显示吃色、压裂和边缘风险。</div>`;
  const stone = openingStoneFor(rough);
  return `
    <div class="placement-analysis">
      ${kits.map((kit) => {
        const openingKit = openingKitFromStored(kit);
        const template = openingKitTemplate(openingKit.tpl);
        const evalResult = evaluateOpeningKit(openingKit, stone);
        const grade = computeOpeningGrade(evalResult, stone);
        const tone = evalResult.penalty > 0.42 || grade.score < 34 ? "danger" : grade.score >= 65 ? "profit" : "";
        const crackPct = Math.round(evalResult.crackRatio * 100);
        const wastePct = Math.round(evalResult.wasteRatio * 100);
        return `
          <div class="analysis-row ${tone}">
            <strong>${template.name} ${grade.letter} · ${formatMoney(evalResult.price)}</strong>
            <span>${escapeHtml(openingKitProductLabel(openingKit.tpl))} · 裂 ${crackPct}% · 废料 ${wastePct}% · 色${grade.breakdown.color} 种${grade.breakdown.water}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}



function clampClient(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function openingSeedFor(rough) {
  return rough.openingSeed || rough.visual?.openingSeed || rough.visual?.seed || rough.id || rough.name;
}

function openingStoneFor(rough) {
  const key = `${rough.id || rough.name}:${openingSeedFor(rough)}`;
  if (!openingStoneCache.has(key)) {
    openingStoneCache.set(key, buildOpeningStone({ seed: key, roughId: rough.id || rough.name }));
  }
  return openingStoneCache.get(key);
}

function openingKitTemplate(tplId) {
  return OPENING_KIT_LIB.find((kit) => kit.id === tplId) || OPENING_KIT_LIB[0];
}

function serverTypeForOpeningKit(tplId) {
  return OPENING_KIT_SERVER_TYPES[tplId] || "peacePendant";
}

function openingTplForServerType(type) {
  return OPENING_KIT_BY_SERVER_TYPE[type] || "ping";
}

function openingKitProductLabel(tplId) {
  return productKindLabel(mapOpeningKitToProductKind(tplId));
}

function openingKitFromStored(kit, saved = false) {
  const tpl = kit.tpl || kit.openingTpl || openingTplForServerType(kit.type);
  const scale = Number(kit.scale) || scaleForOpeningKit(tpl, kit.size || kit.ringSize || (tpl === "bangle" ? 56 : "M"));
  const rawX = Number(kit.x) || 50;
  const rawY = Number(kit.y) || 50;
  const usesPercent = rawX <= 100 && rawY <= 100 && !kit.svgSpace;
  return {
    uid: kit.id,
    id: kit.id,
    tpl,
    type: serverTypeForOpeningKit(tpl),
    x: usesPercent ? rawX * 6 : rawX,
    y: usesPercent ? rawY * 6 : rawY,
    rot: Number(kit.rot ?? kit.rotation ?? 0),
    scale,
    size: kit.size || kit.ringSize || (tpl === "bangle" ? 56 : "M"),
    extracted: saved,
    saved
  };
}

function openingKitsForRender(rough) {
  const saved = (rough.extractionKits || rough.braceletPlacements || []).map((kit) => openingKitFromStored(kit, true));
  const active = kitsFor(rough.id).map((kit) => openingKitFromStored(kit));
  return [...saved, ...active];
}

function openingStoneSvg(rough, options = {}) {
  return renderJadeOpeningSvg(openingStoneFor(rough), {
    scratches: [],
    kits: options.kits || [],
    revealed: Boolean(options.revealed),
    label: rough.name
  });
}

function openingProductKitFor(item) {
  const source = item?.sourceMaterial || {};
  const placement = source.placement || item?.plan || {};
  const tpl = placement.openingTpl || openingTplForServerType(placement.kitType || item?.kind || item?.type);
  const rawX = Number(placement.x) || 50;
  const rawY = Number(placement.y) || 50;
  const usesPercent = rawX <= 100 && rawY <= 100 && !placement.svgSpace;
  return {
    uid: item.id || placement.id,
    id: item.id || placement.id,
    tpl,
    x: usesPercent ? rawX * 6 : rawX,
    y: usesPercent ? rawY * 6 : rawY,
    rot: Number(placement.rot ?? placement.rotation ?? 0),
    scale: Number(placement.scale || 1),
    size: placement.ringSize || item.ringSize || (tpl === "bangle" ? 56 : "M")
  };
}

function openingProductSvg(item, size = "finished") {
  const source = item?.sourceMaterial;
  if (!source?.visual || !source?.placement) return "";
  const rough = {
    id: source.roughId || item.sourceRoughId || item.id,
    name: source.roughName || item.name,
    visual: source.visual,
    openingSeed: source.openingSeed
  };
  return `
    <div class="jade-opening-product ${escapeHtml(size)}" aria-label="${escapeHtml(item.name)}对应料子裁片">
      ${renderJadeOpeningProductSvg(openingStoneFor(rough), openingProductKitFor(item), {
        label: item.name,
        idPrefix: `product-${item.id || source.roughId || source.roughName || "jade"}`
      })}
    </div>
  `;
}

function productCanvas(item, size = "finished") {
  const exactCutout = openingProductSvg(item, size);
  if (exactCutout) return exactCutout;
  return jadeCanvasMarkup("product", item, size);
}

function kitsFor(roughId) {
  if (!roughKits.has(roughId)) roughKits.set(roughId, []);
  return roughKits.get(roughId);
}

function clampOpeningKitPosition(tplId, x, y, scale = 1) {
  const template = openingKitTemplate(tplId);
  const radius = clampClient(template.r * scale, 18, 148);
  return {
    x: clampClient(Math.round(Number(x) || 300), radius, 600 - radius),
    y: clampClient(Math.round(Number(y) || 300), radius, 600 - radius)
  };
}

function openingKitsOverlapAt(current, nextKit) {
  return computeOpeningOverlaps([...current.map((kit) => openingKitFromStored(kit)), nextKit]).has(nextKit.uid);
}

function findSafeOpeningPosition(tplId, preferX, preferY, current) {
  const scale = scaleForOpeningKit(tplId, tplId === "bangle" ? 56 : "M");
  const base = { uid: "candidate", tpl: tplId, x: preferX, y: preferY, rot: 0, scale };
  const first = { ...base, ...clampOpeningKitPosition(tplId, preferX, preferY, scale) };
  if (!openingKitsOverlapAt(current, first)) return first;
  for (let radius = 34; radius <= 260; radius += 22) {
    const steps = Math.max(8, Math.ceil(radius * Math.PI * 2 / 34));
    for (let index = 0; index < steps; index += 1) {
      const angle = index / steps * Math.PI * 2;
      const candidate = {
        ...base,
        ...clampOpeningKitPosition(tplId, preferX + Math.cos(angle) * radius, preferY + Math.sin(angle) * radius, scale)
      };
      if (!openingKitsOverlapAt(current, candidate)) return candidate;
    }
  }
  return first;
}

function addRoughKit(roughId, tplId) {
  const current = kitsFor(roughId);
  const safeTpl = OPENING_KIT_LIB.some((kit) => kit.id === tplId) ? tplId : "bangle";
  const same = current.filter((kit) => kit.tpl === safeTpl).length;
  const position = findSafeOpeningPosition(safeTpl, 300 + ((same % 4) - 1.5) * 36, 300 + Math.floor(same / 4) * 44, current);
  const scale = scaleForOpeningKit(safeTpl, safeTpl === "bangle" ? 56 : "M");
  const kit = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    tpl: safeTpl,
    type: serverTypeForOpeningKit(safeTpl),
    x: position.x,
    y: position.y,
    rot: 0,
    scale,
    size: safeTpl === "bangle" ? 56 : "M",
    ringSize: safeTpl === "bangle" ? 56 : undefined,
    svgSpace: true
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
    kit.id === kitId ? { ...kit, ...clampOpeningKitPosition(kit.tpl || "bangle", x, y, kit.scale || 1), svgSpace: true } : kit
  )));
  renderWorkshop();
  paintJades();
}

function openingKitsForServer(roughId) {
  return kitsFor(roughId).map((kit) => ({
    id: kit.id,
    type: kit.type || serverTypeForOpeningKit(kit.tpl),
    openingTpl: kit.tpl,
    x: clampClient(Math.round((Number(kit.x) || 300) / 6), 4, 96),
    y: clampClient(Math.round((Number(kit.y) || 300) / 6), 4, 96),
    rot: Number(kit.rot || 0),
    scale: Number(kit.scale || 1),
    ringSize: kit.tpl === "bangle" ? kit.ringSize || kit.size || 56 : undefined
  }));
}

function roughBoard(rough) {
  const kits = openingKitsForRender(rough);
  return `
    <div class="rough-board-wrap jade-opening-board" data-opening-board="${rough.id}" data-rough-board="${rough.id}" aria-label="${escapeHtml(rough.name)}取件规划">
      ${openingStoneSvg(rough, { revealed: true, kits })}
    </div>
  `;
}

function roughPlannerControls(rough) {
  const kits = kitsFor(rough.id);
  const savedCount = (rough.extractionKits || rough.braceletPlacements || []).length;
  return `
    <div class="layout-tools">
      <div class="kit-choice-row">
        ${OPENING_KIT_LIB.map((template) => `<button class="kit-choice opening-kit-choice" data-opening-kit-choice="${template.id}" data-rough="${rough.id}">${template.name}<span>${openingKitProductLabel(template.id)}</span></button>`).join("")}
      </div>
      <div class="placement-summary">
        <span>本次 ${kits.length} 件 · 已取 ${savedCount} 件</span>
        <button class="secondary" data-action="clearRoughKits" data-payload="${rough.id}" ${kits.length ? "" : "disabled"}>清空</button>
      </div>
    </div>
  `;
}

// 玩法底图已移除：用户要求不使用图片底图，整页改用浅玉渐变背景。

function setView(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  document.querySelectorAll(".location-card").forEach((node) => node.classList.toggle("active", node.dataset.location === view));
  document.querySelectorAll("#mainNav .main-nav-item").forEach((b) => {
    const v = b.dataset.action === "openRankBoard" ? "rankings" : (b.dataset.payload || "");
    b.classList.toggle("active", v === view);
  });
  document.querySelector(".main-stage")?.classList.toggle("overview-mode", view === "overview");
  if (state) paintJades();
  if (els.mainStage) els.mainStage.scrollTop = 0;
}

function toggleMobilePanel(targetName) {
  const target = targetName === "side" ? els.sidePanel : els.chatDock;
  const targetButton = targetName === "side"
    ? els.sidePanelToggle
    : els.chatDockToggle;
  const shouldOpen = !target?.classList.contains("is-mobile-open");

  for (const [panel, button] of [
    [els.sidePanel, els.sidePanelToggle],
    [els.chatDock, els.chatDockToggle]
  ]) {
    panel?.classList.remove("is-mobile-open");
    button?.setAttribute("aria-expanded", "false");
  }

  if (shouldOpen) {
    target?.classList.add("is-mobile-open");
    targetButton?.setAttribute("aria-expanded", "true");
  }
}

function initShell() {
  setView(activeView);
  renderMainNav();
  els.sidePanelToggle?.addEventListener("click", () => {
    toggleMobilePanel("side");
  });
  els.chatDockToggle?.addEventListener("click", () => {
    toggleMobilePanel("chat");
  });
  if (els.chatSend) els.chatSend.addEventListener("click", sendChat);
  if (els.chatInput) {
    els.chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendChat();
      }
    });
  }
  // 主页四标签切换
  if (els.homeTabs) {
    els.homeTabs.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        els.homeTabs.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        const t = btn.dataset.homeTab;
        [els.homeStatusPane, els.homeTaskPane, els.homeCommissionPane, els.homeBillPane].forEach((p) => {
          if (p) p.hidden = (p.dataset.homePane !== t);
        });
      });
    });
  }
  // 右侧面板分类切换（筛选页签：默认不选中=显示全部，点击选中筛选，再点取消）
  if (els.panelTabs) {
    els.panelTabs.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.ptab;
        if (sidePanelFilter === t) {
          // 再次点击已选中的页签 → 取消筛选
          sidePanelFilter = null;
          els.panelTabs.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
        } else {
          // 选中该页签 → 仅筛选显示对应内容
          sidePanelFilter = t;
          els.panelTabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
        }
        applySidePanelFilter();
      });
    });
  }
  // 任务面板：点击重置/领取/前往
  if (els.homeTaskPane) {
    els.homeTaskPane.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-task-action]");
      if (!btn) return;
      const action = btn.dataset.taskAction;
      const uid = btn.dataset.uid;
      if (action === "go") {
        setView(btn.dataset.view);
      } else if (action === "reset") {
        if (!window.confirm("确定花费 " + formatMoney(TASK_RESET_COST) + " 重置该任务？将换成一个新任务。")) return;
        socket.emit("task:reset", { uid });
      } else if (action === "claim") {
        socket.emit("task:claim", { uid });
      }
    });
  }
  window.matchMedia("(min-width: 768px)").addEventListener("change", (event) => {
    if (!event.matches) return;
    for (const [panel, button] of [
      [els.sidePanel, els.sidePanelToggle],
      [els.chatDock, els.chatDockToggle]
    ]) {
      panel?.classList.remove("is-mobile-open");
      button?.setAttribute("aria-expanded", "false");
    }
  });
  // 顶栏时钟/公盘倒计时 + 右侧进行事项面板 每秒刷新
  setInterval(() => {
    if (!state) return;
    tickHudClock();
    renderSidePanel();
    updateTaskCountdown();
  }, 1000);
}

function render() {
  if (!state) return;
  const { me } = state;
  if (els.nameInput) els.nameInput.value = me.name;

  renderMainNav();
  renderPlayerCard();
  renderTopHud();
  renderSidePanel();
  renderOverview();
  renderAuction();
  renderAuctionHistory();
  renderWorkshop();
  renderOrders();
  renderMarket();
  renderShop();
  renderRecruitCandidates();
  renderRankingBoard();
  renderLivestream();
  renderReports();
  renderCollection();
  paintJades();
}

function paintJades() {
  paintJadeCanvases();
}

const ACTION_ICONS = {
  livestream: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M6 6a8 8 0 000 12M18 6a8 8 0 010 12"/></svg>`,
  hire: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.4"/><path d="M5 20a7 7 0 0 1 14 0M18 9v5M15.5 11.5h5"/></svg>`,
  workshop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4l6 6-9 9-6 1 1-6 8-10z"/></svg>`
};

function myRankFor(boardId) {
  const board = rankBoardById(boardId);
  const row = rankingRowsFor(board).find((r) => r.mine);
  return row ? row.rank : null;
}

function assetPriceByPurchase(id, type) {
  const list = state.assetListings || [];
  const found = list.find((l) => l.id === id || l.type === type);
  return found?.price ?? 0;
}

function currentAuctionHall() {
  const halls = state.auctionHalls || [];
  const open = halls.filter((h) => h.active && h.unlocked).sort((a, b) => b.requiredLevel - a.requiredLevel);
  if (open.length) {
    const higher = halls.filter((h) => h.active && !h.unlocked).sort((a, b) => a.requiredLevel - b.requiredLevel)[0];
    return { label: open[0].label, nextLevel: higher ? higher.requiredLevel : null };
  }
  const locked = halls.filter((h) => h.active).sort((a, b) => a.requiredLevel - b.requiredLevel)[0];
  return { label: locked ? `声望 Lv.${locked.requiredLevel} 解锁` : "未开放", nextLevel: null };
}

function myTradeInfo() {
  const mine = (state.listings || []).filter((l) => l.ownerId === state.me.id);
  return {
    active: mine.length,
    claimable: state.me.payouts?.length || 0,
    sold: state.me.soldCount || 0,
    slots: 40
  };
}

function guestOrderRefreshText() {
  const orders = state.me.orders || [];
  if (!orders.length) return "可刷新（¥300）";
  const soonest = Math.min(...orders.map((o) => Number(o.expiresAt || 0)));
  const ms = soonest - Date.now();
  if (ms <= 0) return "即将刷新";
  return `${Math.max(1, Math.round(ms / 60000))} 分钟后刷新`;
}

function statusRow(label, text, action) {
  return `<div class="srow"><span class="s-label">${escapeHtml(label)}</span><span class="s-text">${escapeHtml(text)}</span>${action || ""}</div>`;
}

function statusRows() {
  const { me } = state;
  const rows = [];
  if (!me.assets?.livestreamPermitOwned) {
    rows.push(statusRow("直播间", `未开通 · 直播经营许可 ${formatMoney(assetPriceByPurchase("livestream-permit", "livestreamPermit"))}`, viewButton("前往", "shop", "s-go")));
  }
  if (!me.assets?.workshopOwned) {
    rows.push(statusRow("工坊", `未开通 · 街角小工坊 ${formatMoney(assetPriceByPurchase("starter-workshop", "workshop"))}`, viewButton("前往", "shop", "s-go")));
  }
  const workers = me.workshop?.workers?.length || 0;
  if (workers === 0) {
    rows.push(statusRow("掌柜", "0 名 · 前往招募", viewButton("前往", "hireMarket", "s-go")));
  }
  const hall = currentAuctionHall();
  rows.push(statusRow("公盘", hall ? `可进 ${hall.label}${hall.nextLevel ? ` · 更高档需声望 Lv.${hall.nextLevel}` : ""}` : "未开放", viewButton("查看", "auction", "s-go")));
  const trade = myTradeInfo();
  const tradeBtn = trade.claimable > 0 ? button("领取", "collectPayouts", "", "s-go") : viewButton("查看", "market", "s-go");
  rows.push(statusRow("交易行", `可领取 ${trade.claimable} · 已售出 ${trade.sold} · 栏位 ${trade.slots}`, tradeBtn));
  rows.push(statusRow("客人订单", guestOrderRefreshText(), viewButton("查看", "orders", "s-go")));
  return rows;
}

// ── 每日任务面板 ────────────────────────────────────────────────
const TASK_RESET_COST = 5000;

function taskStatusLabel(status) {
  if (status === "complete") return "可领取";
  if (status === "claimed") return "已领取";
  return "进行中";
}

function taskCardHtml(task) {
  const status = task.status;
  const claimed = status === "claimed";
  const complete = status === "complete";
  const rowCls = claimed ? " is-claimed" : (complete ? " is-ready" : "");
  const resetBtn = status === "active"
    ? `<button class="task-btn task-reset" data-task-action="reset" data-uid="${escapeHtml(task.uid)}">${formatMoney(TASK_RESET_COST)} 重置</button>`
    : `<button class="task-btn task-reset is-disabled" disabled>已结束</button>`;
  let rightBtn;
  if (claimed) {
    rightBtn = `<button class="task-btn task-claim is-disabled" disabled>已领取</button>`;
  } else if (complete) {
    rightBtn = `<button class="task-btn task-claim" data-task-action="claim" data-uid="${escapeHtml(task.uid)}">领取</button>`;
  } else {
    rightBtn = `<button class="task-btn task-go" data-task-action="go" data-view="${escapeHtml(task.view)}">前往</button>`;
  }
  return `
    <article class="task-card${rowCls}">
      <div class="task-card-body">
        <div class="task-card-top">
          <div class="task-card-titles">
            <p class="task-card-title">${escapeHtml(task.title)}</p>
            <p class="task-card-desc">${escapeHtml(task.desc)}</p>
          </div>
          <span class="task-status ${status}">${taskStatusLabel(status)}</span>
        </div>
        <div class="task-card-meta">
          <span>进度：<b>${Number(task.progress || 0)}/${task.target}</b></span>
          <span>奖励：<b class="task-reward">${formatMoney(task.reward)}</b>${task.rep ? ` <b class="task-rep">+声望 ${task.rep}</b>` : ""}</span>
        </div>
        <div class="task-card-actions">
          ${resetBtn}
          ${rightBtn}
        </div>
      </div>
    </article>
  `;
}

function renderTasks() {
  if (!els.homeTaskPane || !state?.me) return;
  const { me } = state;
  const tasks = me.tasks || [];
  const done = tasks.filter((t) => t.status === "claimed").length;
  const nextIn = Math.max(0, (me.taskRefreshedAt || nowMs()) + (me.taskRefreshMs || 21600000) - nowMs());
  els.homeTaskPane.innerHTML = `
    <div class="task-head">
      <div class="task-head-main">
        <div class="task-head-ico">
          <svg width="18" height="18" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        </div>
        <div>
          <p class="task-head-title">每日任务</p>
          <p class="task-head-sub" id="taskCountdown">下次刷新：${formatCountdown(nextIn)}</p>
        </div>
      </div>
      <span class="task-done-pill">已完成 ${done}/${tasks.length}</span>
    </div>
    <div class="task-list">
      ${tasks.length ? tasks.map(taskCardHtml).join("") : empty("暂无任务，等待刷新")}
    </div>
  `;
}

function updateTaskCountdown() {
  const el = document.getElementById("taskCountdown");
  if (!el || !state?.me) return;
  const nextIn = Math.max(0, (state.me.taskRefreshedAt || nowMs()) + (state.me.taskRefreshMs || 21600000) - nowMs());
  el.textContent = `下次刷新：${formatCountdown(nextIn)}`;
}

function renderOverview() {
  if (!state?.me) return;
  const { me } = state;

  if (els.homeStatusPane) {
    const rankBoards = [
      { id: "rep", label: "声望榜" },
      { id: "collection", label: "藏品榜" },
      { id: "cash", label: "现金榜" },
      { id: "inventory", label: "库存榜" }
    ];
    els.homeStatusPane.innerHTML = `
      ${currentGoalHtml()}
      <h1 class="status-title">状态</h1>
      <div class="rank-pills">
        ${rankBoards.map((b) => `<span class="rank-pill">${escapeHtml(b.label)} 第 ${myRankFor(b.id) ?? "—"} 名</span>`).join("")}
      </div>
      <div class="status-rows">
        ${statusRows().join("")}
      </div>
    `;
  }
  if (els.homeTaskPane) {
    renderTasks();
  }
  if (els.homeCommissionPane) {
    els.homeCommissionPane.innerHTML = `<div class="placeholder"><b>委托（规划中）</b>NPC / 玩家委托列表与接单流程将在此展示。</div>`;
  }
  if (els.homeBillPane) {
    els.homeBillPane.innerHTML = `<div class="placeholder"><b>账单（规划中）</b>经营收支、税费、工资等账单明细将在此展示。</div>`;
  }
  renderHomeMessages();
}

// ===== 目标 / 成就系统（游戏化：给玩家"下一步做什么"的牵引）=====
function hasImperial(me = {}) {
  const scan = [...(me.rough || []), ...(me.bracelets || []), ...(me.collection || [])];
  return scan.some((it) => it && (it.quality === "imperial" || it.qualityKey === "imperial" || String(it.color || "").includes("帝王")));
}
const GOALS = [
  { id: "first-open", title: "初试开窗", desc: "完成第一次原石开窗", prog: (me) => (me.rough || []).filter((r) => r.revealed).length, target: 1 },
  { id: "first-bracelet", title: "匠心初成", desc: "打磨出第一只翡翠镯", prog: (me) => (me.bracelets || []).length, target: 1 },
  { id: "cash1w", title: "小有积蓄", desc: "现金达到 ¥10,000", prog: (me) => Number(me.cash || 0), target: 10000 },
  { id: "rep3", title: "崭露头角", desc: "声望达到 Lv.3", prog: (me) => repLevelTier(Number(me.rep || 0)), target: 3 },
  { id: "imperial", title: "帝王之绿", desc: "拥有或经手一件帝王绿", prog: (me) => (hasImperial(me) ? 1 : 0), target: 1 },
  { id: "collection5", title: "藏珍纳宝", desc: "藏品达到 5 件", prog: (me) => (me.collection || []).length, target: 5 }
];
function goalFmt(g, v) {
  if (g.id === "cash1w") return `${formatMoney(v)} / ${formatMoney(g.target)}`;
  if (g.id === "rep3") return `Lv.${v} / ${g.target}`;
  return `${v} / ${g.target}`;
}
function currentGoalHtml() {
  const { me } = state;
  const next = GOALS.find((g) => Math.min(g.target, g.prog(me)) < g.target);
  if (!next) return `<div class="goal-card is-done"><div class="goal-head"><span class="goal-label">当前目标</span><b>全部达成</b></div><div class="goal-desc">江湖路远，去公盘再淘块好料吧！</div></div>`;
  const cur = Math.min(next.target, next.prog(me));
  const pct = Math.round((cur / next.target) * 100);
  return `<div class="goal-card">
    <div class="goal-head"><span class="goal-label">当前目标</span><b>${escapeHtml(next.title)}</b></div>
    <div class="goal-desc">${escapeHtml(next.desc)}</div>
    <div class="goal-bar"><i style="width:${pct}%"></i></div>
    <div class="goal-prog">${goalFmt(next, cur)} · ${pct}%</div>
  </div>`;
}
function achievementsHtml() {
  const { me } = state;
  return GOALS.map((g) => {
    const cur = Math.min(g.target, g.prog(me));
    const done = cur >= g.target;
    const pct = Math.round((cur / g.target) * 100);
    return `<div class="achv ${done ? "is-done" : ""}">
      <div class="achv-ico">${done ? "★" : "○"}</div>
      <div class="achv-main">
        <div class="achv-top"><b>${escapeHtml(g.title)}</b>${done ? '<span class="achv-tag">已达成</span>' : ""}</div>
        <div class="achv-desc">${escapeHtml(g.desc)}</div>
        <div class="achv-bar"><i style="width:${pct}%"></i></div>
        <div class="achv-prog">${goalFmt(g, cur)}</div>
      </div>
    </div>`;
  }).join("");
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
    primary.push({ tone: "profit", title: "处理成品库存", meta: `${me.bracelets.length} 件成品可接单、收藏、直播或挂牌`, action: viewButton("看成品", "workshop") });
  } else if (revealed.length) {
    primary.push({ tone: "craft", title: "在已揭露原料上规划取件", meta: `${revealed.length} 块料可摆放套件，规划手镯和挂件`, action: viewButton("去取件", "workshop") });
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
    ["明料", revealed.length, sumValue(revealed), "可取件"],
    ["成品", me.bracelets.length, sumValue(me.bracelets), "可变现"],
    ["藏品", me.collection.length, sumValue(me.collection), "涨声望"]
  ];
  els.pipeline.innerHTML = stages.map(([name, count, value, hint]) => `
    <div class="pipeline-step">
      <span>${name}</span><strong>${count}</strong><small>${formatMoney(value)} · ${hint}</small>
    </div>
  `).join("");
}









function showToast(message) {
  const payload = typeof message === "object" && message ? message : { text: message };
  const text = uiText(payload);
  if (!text || !els.toast) return;
  els.toast.textContent = text;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2200);
  if (payload.float !== false) {
    spawnFloatingText({
      text,
      tone: payload.tone || "info",
      x: payload.x || 78,
      y: payload.y || 78
    });
  }
}

function boardPointFromEvent(board, event, kitType = null) {
  const rect = board.getBoundingClientRect();
  const point = {
    x: (event.clientX - rect.left) / rect.width * 100,
    y: (event.clientY - rect.top) / rect.height * 100
  };
  if (kitType) return point;
  return {
    x: clampClient(point.x, 16, 84),
    y: clampClient(point.y, 16, 84)
  };
}

function openingBoardPointFromEvent(board, event) {
  const rect = board.getBoundingClientRect();
  return {
    x: clampClient((event.clientX - rect.left) / rect.width * 600, 0, 600),
    y: clampClient((event.clientY - rect.top) / rect.height * 600, 0, 600)
  };
}

document.body.addEventListener("pointerdown", (event) => {
  const openingKit = event.target.closest(".jade-opening-board .kit[data-uid]");
  if (openingKit && !openingKit.classList.contains("extracted")) {
    const board = openingKit.closest("[data-opening-board]");
    if (!board) return;
    activeDragKit = {
      mode: "opening",
      roughId: board.dataset.openingBoard,
      kitId: openingKit.dataset.uid
    };
    event.preventDefault();
    return;
  }
});

document.body.addEventListener("pointermove", (event) => {
  if (!activeDragKit) return;
  const board = document.querySelector(`[data-opening-board="${CSS.escape(activeDragKit.roughId)}"]`);
  if (!board) return;
  const point = openingBoardPointFromEvent(board, event);
  moveRoughKit(activeDragKit.roughId, activeDragKit.kitId, point.x, point.y);
  event.preventDefault();
});

document.body.addEventListener("pointerup", () => {
  activeDragKit = null;
});

document.body.addEventListener("pointercancel", () => {
  activeDragKit = null;
});

document.body.addEventListener("click", (event) => {
  if (els.modalRoot && !els.modalRoot.hidden && event.target === els.modalRoot) {
    closeGameModal();
    return;
  }

  const modalClose = event.target.closest("[data-modal-close]");
  if (modalClose) {
    closeGameModal();
    return;
  }

  const modalEmit = event.target.closest("[data-modal-emit]");
  if (modalEmit) {
    socket.emit(modalEmit.dataset.modalEmit, modalEmit.dataset.modalPayload || "");
    closeGameModal();
    return;
  }

  const viewLink = event.target.closest("[data-view-link]");
  if (viewLink) {
    openLocationByView(viewLink.dataset.viewLink);
    return;
  }

  const kitChoice = event.target.closest("[data-opening-kit-choice]");
  if (kitChoice) {
    addRoughKit(kitChoice.dataset.rough, kitChoice.dataset.openingKitChoice);
    return;
  }

  const windowBoard = event.target.closest("[data-window-board]");
  if (windowBoard) {
    const roughId = windowBoard.dataset.windowBoard;
    if (isWindowSelectionActive(roughId)) {
      const point = boardPointFromEvent(windowBoard, event, true);
      requestAuctionWindowAt(roughId, point.x, point.y);
    }
    return;
  }

  const target = event.target.closest("[data-action]");
  if (!target || !state) return;
  const action = target.dataset.action;
  const payload = target.dataset.payload;

  if (action === "startWindow") {
    if (isWindowSelectionActive(payload)) {
      clearWindowSelection();
    } else if (canOpenWindow(payload)) {
      startWindowSelection(payload);
      return;
    } else {
      showToast("当前无法开窗：需已入场、现金足够且本料开窗未满 6 次");
      return;
    }
    renderAuction();
    paintJades();
    return;
  }

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

  if (action === "openRankBoard") {
    rankingOpenBoard(target);
    return;
  }

  if (action === "selectRankBoard") {
    rankingSelectBoard(target);
    return;
  }

  if (action === "selectMessageChannel") {
    chatSelectChannel(target.dataset.messageChannel);
    return;
  }

  if (action === "enterAuctionHall") {
    enterAuctionHall(payload);
    return;
  }

  if (action === "openHallHistory") {
    setView("auctionHistory");
    return;
  }

  if (action === "openAuctionHistory") {
    setView("auctionHistory");
    renderAuctionHistory();
    return;
  }

  if (action === "backAuctionHalls") {
    backAuctionHalls();
    return;
  }

  if (action === "buyAssetListing") {
    socket.emit("buyAssetListing", payload);
    return;
  }

  if (action === "buyMaterialPack") {
    const [materialId, amount] = String(payload).split("|");
    socket.emit("buyMaterialPack", {
      materialId,
      amount: Number(amount),
      requestId: globalThis.crypto?.randomUUID?.() || `material-${Date.now()}`
    });
    return;
  }
  if (action === "buyWorkshopDevice") {
    const modelKey = target.dataset.modelKey || payload;
    socket.emit("buyWorkshopDevice", {
      modelKey,
      requestId: globalThis.crypto?.randomUUID?.() || `equipment-${Date.now()}`
    });
    return;
  }
  if (action === "repairWorkshopDevice") {
    socket.emit("repairWorkshopDevice", {
      deviceId: payload,
      requestId: globalThis.crypto?.randomUUID?.() || `repair-${Date.now()}`
    });
    return;
  }
  if (action === "refreshRecruitCandidates") {
    socket.emit("refreshRecruitCandidates", {
      requestId: globalThis.crypto?.randomUUID?.() || `recruit-refresh-${Date.now()}`
    });
    return;
  }
  if (action === "recruitWorker") {
    socket.emit("recruitWorker", {
      candidateId: payload,
      requestId: globalThis.crypto?.randomUUID?.() || `recruit-${Date.now()}`
    });
    return;
  }

  // ---- 交易行（游戏化）----
  if (action === "marketStall") { marketSetStall(target); return; }
  if (action === "marketSection") { marketSetSection(target); return; }
  if (action === "marketQ") { marketToggleQ(target); return; }
  if (action === "openMarketListModal") { openMarketListModal(); return; }
  if (action === "confirmMarketList") { confirmMarketList(); return; }
  if (action === "openMarketBuy") { openMarketBuy(payload); return; }
  if (action === "confirmMarketBuy") { confirmMarketBuy(); return; }
  if (action === "closeMarketModal") { closeMarketModals(); return; }
  if (action === "withdrawListing") { socket.emit("withdrawListing", payload); return; }
  if (action === "collectPayouts") { socket.emit("collectPayout"); return; }
  if (action === "marketApplyWant") { showToast("求购系统开发中，应征功能即将开放。"); return; }

  if (action === "requestWindow") {
    startWindowSelection(payload);
    showToast("请选择开窗位置");
    return;
  }

  if (action === "enterAuction") {
    socket.emit("enterAuction", { hallId: payload });
    return;
  }

  if (action === "joinAuction") {
    socket.emit("enterAuction", { hallId: payload });
    return;
  }

  if (action === "increaseBid") {
    const amountInput = document.querySelector(`[data-bid-amount="${CSS.escape(payload)}"]`);
    const increment = Number(target.dataset.bidIncrement || 0);
    if (amountInput && Number.isFinite(increment)) {
      const minimum = Number(amountInput.dataset.minBid || 0);
      const current = Math.max(minimum, Number(amountInput.value || 0));
      amountInput.value = Math.round(current + increment);
    }
    return;
  }

  if (action === "selectWorkshopStep") { workshopSelectStep(payload); return; }
  if (action === "openWorkshopDevice") { workshopOpenDevice(payload); return; }
  if (action === "backWorkshopDevices") { workshopBackDevices(); return; }
  if (action === "selectWorkshopItem") { workshopSelectItem(payload); return; }
  if (action === "startWorkshopJob") { workshopStartJob(target, payload); return; }
  if (action === "assignWorkshopWorker") { workshopAssignWorker(target, payload); return; }
  if (action === "recommendWorkshopWorker") { workshopRecommendWorker(payload); return; }
  if (action === "openWorkshopPicker") { workshopOpenPicker(payload); return; }
  if (action === "closeWorkshopPicker") { workshopClosePicker(); return; }
  if (action === "pickWorkshopItem") { workshopPickItem(payload); return; }
  if (action === "pickWorkshopWorker") { workshopPickWorker(target, payload); return; }
  if (action === "confirmPickerWorker") { workshopConfirmPickerWorker(target, payload); return; }
  if (action === "setWorkerSort") { workshopSetSort(target); return; }

  if (action === "extractFromRough") {
    socket.emit("extractFromRough", { roughId: payload, kits: openingKitsForServer(payload) });
    roughKits.set(payload, []);
    return;
  }

  if (action === "clearRoughKits") {
    clearRoughKits(payload);
    return;
  }

  if (action === "startPolish") {
    socket.emit("startPolish", payload);
    return;
  }

  if (action === "listItem") {
    const input = document.querySelector(`[data-price-for="${CSS.escape(payload)}"]`);
    socket.emit("listItem", { type: target.dataset.type, itemId: payload, price: input?.value });
    return;
  }

  if (action === "completeOrder") {
    ordersComplete(target, payload);
    return;
  }

  if (action === "scheduleLivestream") {
    livestreamSchedule(target, payload);
    return;
  }

  if (action === "submitAuctionBid") {
    const amountInput = document.querySelector(`[data-bid-amount="${CSS.escape(payload)}"]`);
    socket.emit("submitAuctionBid", {
      roughId: payload,
      hallId: state.auction?.hallId,
      amount: amountInput?.value
    });
    return;
  }

  socket.emit(action, payload);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.modalRoot && !els.modalRoot.hidden) {
    closeGameModal();
  }
});

if (els.saveNameBtn && els.nameInput) {
  els.saveNameBtn.addEventListener("click", () => {
    socket.emit("setName", els.nameInput.value);
  });
}

els.refreshOrders.addEventListener("click", () => {
  socket.emit("refreshOrders");
});

socket.on("connect", () => {
  if (els.connection) els.connection.textContent = "已连接";
});

socket.on("disconnect", () => {
  if (els.connection) els.connection.textContent = "离线";
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
  maybeShowStateDrivenModals(nextState);
});

socket.on("toast", showToast);
socket.on("ui:event", handleUiEvent);

// ===== 昼夜主题切换 =====
const THEME_KEY = "jade-theme";
const themeIcons = {
  night: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>',
  day: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>'
};
function applyTheme(theme) {
  const t = theme === "day" ? "day" : "night";
  document.documentElement.dataset.theme = t;
  if (els.themeToggle) els.themeToggle.innerHTML = themeIcons[t === "night" ? "day" : "night"];
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
}
(function initTheme() {
  let saved = "night";
  try { saved = localStorage.getItem(THEME_KEY) || "night"; } catch (e) {}
  applyTheme(saved);
  if (els.themeToggle) els.themeToggle.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "day" ? "night" : "day");
  });
})();

initShell();

initAuctionModule({
  socket,
  getState: () => state,
  els,
  getActiveView: () => activeView,
  helpers: {
    formatMoney, formatDuration, nowMs,
    escapeHtml, empty, showToast, clampClient, boardPointFromEvent,
    setView, paintJades, CSS
  }
});

initMarketModule({
  socket,
  getState: () => state,
  els,
  getActiveView: () => activeView,
  helpers: {
    formatMoney, escapeHtml, empty, showToast, typeName
  }
});

initWorkshopModule({
  socket,
  getState: () => state,
  els,
  getActiveView: () => activeView,
  helpers: {
    formatMoney, formatDuration, escapeHtml, empty, nowMs, typeName,
    materialStageForClient, materialStageLabel, productCanvas, openingStoneSvg, openingKitsForRender,
    kitsFor, roughBoard, roughPlannerControls, placementAnalysisRows, openingKitsForServer,
    roughKits, paintJades, showToast, productionJobsFor
  }
});

initChatModule({
  socket,
  getState: () => state,
  els,
  getActiveView: () => activeView,
  helpers: {
    nowMs, formatMoney, formatDuration, escapeHtml, empty,
    gameClock, auctionPhaseMeta, reminderRows, inventoryCounts, showToast
  }
});

initRankingModule({
  socket,
  getState: () => state,
  els,
  getActiveView: () => activeView,
  helpers: {
    setView, escapeHtml, formatNumber, formatMoney
  }
});

initOrdersModule({
  socket,
  getState: () => state,
  els,
  getActiveView: () => activeView,
  helpers: {
    finishedProducts, matchingBracelets, productMatchesOrder, productName, productCanvas,
    formatMoney, escapeHtml, empty, routeRecommendation, liveSaleRange, productOrderFitReasons,
    button, viewButton
  }
});

initLivestreamModule({
  socket,
  getState: () => state,
  els,
  getActiveView: () => activeView,
  helpers: {
    finishedProducts, productCanvas, formatMoney, escapeHtml, empty
  }
});

initExtraModule({
  socket,
  getState: () => state,
  els,
  getActiveView: () => activeView,
  helpers: {
    currentReportSummary, formatMoney, escapeHtml, empty, productCanvas, formatNumber
  }
});

window.setInterval(() => {
  if (!state) return;
  renderPlayerSidebar();
  renderAuction();
  paintJades();
}, 1000);
