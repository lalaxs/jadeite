import { jadeCanvasMarkup } from "./jade-renderer.js";
import {
  featureAccess
} from "./player-progression.js";
import {
  productMatchesOrder,
  productOrderFitReasons,
  liveSaleRange,
  routeRecommendation
} from "./jade-rules.js";
import {
  initAuctionModule,
  auctionPhaseMeta,
  isWindowSelectionActive, requestAuctionWindowAt,
  renderAuction, renderAuctionHistory,
  syncAuctionBidAffordability,
  tickAuctionClock,
  clearPendingAuctionBid, clearPendingEnterAuctionHall
} from "./auction-module.js";
import {
  initMarketModule,
  renderMarket,
  closeMarketModals,
  openMarketListModal
} from "./market-module.js";
import { initBlackmarketModule, renderBlackmarket } from "./blackmarket-module.js";
import {
  initWorkshopModule,
  workshopJobs,
  renderWorkshop,
  tickWorkshopJobProgress,
  workshopRefreshPlanner,
  focusWorkshopItem,
  workshopSelectStep
} from "./workshop-module.js";
import { initInventoryModule, renderInventory, countInventoryUnseen, focusInventoryEscrow, exitInventoryRecycleMode } from "./inventory-module.js";
import {
  initChatModule,
  renderHomeMessages, sendChat
} from "./chat-module.js";
import {
  initRankingModule,
  rankBoardById, rankingRowsFor, renderRankingBoard
} from "./ranking-module.js";
import {
  initOrdersModule,
  renderOrders,
  confirmBatchRefreshOrders,
  msUntilNextOrderDailyRefresh,
  focusOrdersForProduct
} from "./orders-module.js";
import {
  initLivestreamModule,
  renderLivestream,
  focusLivestreamProduct
} from "./livestream-module.js";
import { buildAuctionSettleModalEvent } from "./jade-auction.js";
import {
  buildLivestreamSettleModalEvent
} from "./livestream-module.js";
import {
  initExtraModule,
  renderShop, renderHireMarket,
  setHireMarketTab,
  renderReports, renderCollection
} from "./extra-module.js";
import { createActionRouter } from "./shell/action-router.js";
import {
  bindFormatDeps,
  formatMoney,
  formatNumber,
  nowMs,
  formatDuration,
  gameClock,
  escapeHtml,
  empty,
  clampClient
} from "./shell/format-utils.js";
import {
  bindToastFxDeps,
  showToast
} from "./shell/toast-fx.js";
import {
  bindGameModalDeps,
  openGameModal,
  closeGameModal,
  ackAuctionSettleModal,
  ackLivestreamSettleModal,
  openInventoryAfterAuction,
  handleUiEvent,
  maybeShowStateDrivenModals
} from "./shell/game-modal.js";
import {
  bindNavigationDeps,
  renderMainNav,
  setView,
  openLocationByView,
  button,
  viewButton,
  selectHomeTab,
  openHomeOverview,
  setMobileResourcesOpen,
  toggleMobilePanel,
  closeMobileTransientUi
} from "./shell/navigation.js";
import {
  bindThemeDeps,
  initTheme
} from "./shell/theme.js";
import {
  bindRenderPipelineDeps,
  setViewRenderers,
  render,
  renderActiveView,
  paintJades,
  activeViewRoot
} from "./shell/render-pipeline.js";
import { wireFeatureModules } from "./shell/wire-modules.js";
import { wireSocket } from "./shell/wire-socket.js";
import { installMutationRequestIds } from "./shell/mutation-socket.js";
import { wireShellActions } from "./shell/wire-shell-actions.js";
import { initShell } from "./shell/wire-shell-ui.js";
import {
  bindOpeningDeps,
  roughKits,
  removeOpeningKit,
  kitsFor,
  openingKitsForServer,
  openingKitFromStored,
  openingKitProductLabel,
  openingKitsForRender,
  openingStoneSvg,
  productCanvas,
  roughBoard,
  roughPlannerControls,
  placementAnalysisRows,
  boardPointFromEvent,
  registerOpeningPointerListeners,
  handleOpeningClick,
  registerOpeningActions
} from "./features/opening/index.js";
import {
  bindInventoryHelperDeps,
  typeName,
  materialStageForClient,
  materialStageLabel,
  productionJobsFor,
  finishedProducts,
  matchingBracelets,
  productName,
  inspectInventoryItem,
  currentReportSummary,
  inventoryCounts,
  sumValue
} from "./features/inventory-helpers.js";
import {
  bindHudDeps,
  renderTopHud,
  renderPlayerCard,
  renderPlayerSidebar,
  renderSidePanel,
  reminderRows,
  tickHudClock,
  tickSidePanelProgress,
  applySidePanelFilter,
  getSidePanelFilter,
  setSidePanelFilter
} from "./features/hud/index.js";
import {
  bindOverviewDeps,
  TASK_RESET_COST,
  renderOverview,
  updateTaskCountdown,
  achievementsHtml,
  notifyNewAchievements,
  resetAchievementToastState
} from "./features/overview/index.js";
import { initBillModule, renderBill, renderCredit, openBillView } from "./bill-module.js";
import { initMiningModule, renderMining } from "./mining-module.js";
import { initAccountModule } from "./account-module.js";
import { initFinanceModule } from "./features/finance/index.js";

const PLAYER_SESSION_STORAGE_KEY = "jade-player-session-v1";

function storedPlayerSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYER_SESSION_STORAGE_KEY) || "null");
    if (saved?.playerId && saved?.resumeToken) return saved;
  } catch (_) {}
  // One-time bridge for browsers that still have the legacy session-only id.
  const legacyPlayerId = sessionStorage.getItem("jade-player-id");
  return legacyPlayerId ? { playerId: legacyPlayerId, resumeToken: "" } : {};
}

function routeInventoryItem(rawPayload = "") {
  const [destination, ...idParts] = String(rawPayload || "").split("|");
  const itemId = idParts.join("|");
  closeGameModal();
  if (!itemId) return;
  if (destination === "inspect") {
    openLocationByView("inventory");
    inspectInventoryItem(itemId);
    return;
  }
  if (destination === "workshop") {
    openLocationByView("workshop");
    if (activeView === "workshop") focusWorkshopItem(itemId);
    return;
  }
  if (destination === "workshop-finish") {
    openLocationByView("workshop");
    if (activeView === "workshop") workshopSelectStep("finish");
    return;
  }
  if (destination === "orders") {
    openLocationByView("orders");
    focusOrdersForProduct(itemId);
    return;
  }
  if (destination === "market") {
    openLocationByView("market");
    if (activeView === "market") openMarketListModal(itemId);
    return;
  }
  if (destination === "livestream") {
    openLocationByView("livestream");
    focusLivestreamProduct(itemId);
    return;
  }
  if (destination === "blackmarket") {
    openLocationByView("blackmarket");
  }
}

const playerSession = storedPlayerSession();
const socket = io({
  auth: {
    playerId: playerSession.playerId || "",
    resumeToken: playerSession.resumeToken || "",
    capabilities: { statePatchV1: true }
  }
});
installMutationRequestIds(socket);
const actions = createActionRouter();
const registerAction = (name, handler) => actions.on(name, handler);

const viewLabels = {
  overview: "翡翠街",
  auction: "公盘",
  auctionHistory: "历史拍卖成功",
  mining: "矿区",
  workshop: "工坊",
  inventory: "库存",
  market: "交易行",
  blackmarket: "黑市",
  shop: "商铺",
  rankings: "排行榜",
  livestream: "直播间",
  orders: "订单",
  collection: "藏品",
  hireMarket: "员工",
  reports: "经营账房"
};

const locationDefinitions = [
  { id: "auction", view: "auction", label: "公盘", locationImage: "auction", type: "public", description: "先明拍后暗拍，开窗会公开信息。" },
  { id: "mining", view: "mining", label: "矿区", locationImage: "mining", type: "public", description: "租赁矿权，雇佣独立矿工开采原石。" },
  { id: "playerMarket", view: "market", label: "交易行", locationImage: "market", type: "public", description: "玩家之间买卖翡翠中间物和成品。" },
  { id: "shop", view: "shop", label: "商铺", locationImage: "shop", type: "public", description: "购买工坊、直播许可等功能建筑。" },
  { id: "orders", view: "orders", label: "订单", locationImage: "orders", type: "public", description: "接定制单，换现金和口碑。" },
  { id: "collection", view: "collection", label: "藏品", locationImage: "collection", type: "public", description: "收藏精品，提高门面声望。" },
  { id: "hireMarket", view: "hireMarket", label: "员工", locationImage: "hireMarket", type: "public", description: "查看已有员工，并招募新师傅。" },
  { id: "livestream", view: "livestream", label: "直播间", locationImage: "livestream", type: "public", description: "逛公开直播摊位；取得许可后可自行开播。" },
  { id: "workshop", view: "workshop", label: "工坊", locationImage: "workshop", type: "ownedPrivate", description: "打磨原石、取件、精加工。", ownershipKey: "workshopOwned" }
];
let state = null;
let activeView = "overview";
let serverClockOffset = 0;

const els = {
  shell: document.querySelector(".shell"),
  sidebarStatus: document.querySelector("#sidebarStatus"),
  locationCards: document.querySelector("#locationCards"),
  messageChannelTabs: document.querySelector("#messageChannelTabs"),
  homeMessageLog: document.querySelector("#homeMessageLog"),
  rankingTitle: document.querySelector("#rankingTitle"),
  rankingTabs: document.querySelector("#rankingTabs"),
  rankingList: document.querySelector("#rankingList"),
  rankingHead: document.querySelector("#rankingHead"),
  rankingMineBar: document.querySelector("#rankingMineBar"),
  auctionHeadTitle: document.querySelector("#auctionHeadTitle"),
  auctionHeadDesc: document.querySelector("#auctionHeadDesc"),
  auctionBackBtn: document.querySelector("#auctionBackBtn"),
  connection: document.querySelector("#connectionText"),
  nameInput: document.querySelector("#nameInput"),
  saveNameBtn: document.querySelector("#saveNameBtn"),
  auctionHalls: document.querySelector("#auctionHalls"),
  auctionBrief: document.querySelector("#auctionBrief"),
  auctionHistoryBrief: document.querySelector("#auctionHistoryBrief"),
  auctionHistoryList: document.querySelector("#auctionHistoryList"),
  roughPool: document.querySelector("#roughPool"),
  miningRoot: document.querySelector("#miningRoot"),
  workshopRoot: document.querySelector("#workshopRoot"),
  inventoryPanel: document.querySelector("#inventoryPanel"),
  orders: document.querySelector("#ordersList"),
  orderBrief: document.querySelector("#orderBrief"),
  orderRefreshCountdown: document.querySelector("#orderRefreshCountdown"),
  refreshOrders: document.querySelector("#refreshOrdersBtn"),
  marketMineCnt: document.querySelector("#marketMineCnt"),
  marketStalls: document.querySelector("#marketStalls"),
  marketShop: document.querySelector("#marketShop"),
  marketQFilters: document.querySelector("#marketQFilters"),
  marketPriceMin: document.querySelector("#marketPriceMin"),
  marketPriceMax: document.querySelector("#marketPriceMax"),
  marketPriceApply: document.querySelector("#marketPriceApply"),
  marketAfford: document.querySelector("#marketAfford"),
  marketReset: document.querySelector("#marketReset"),
  marketSearch: document.querySelector("#marketSearch"),
  marketResultStatus: document.querySelector("#marketResultStatus"),
  marketSort: document.querySelector("#marketSort"),
  marketGrid: document.querySelector("#marketGrid"),
  marketListModal: document.querySelector("#marketListModal"),
  marketBuyModal: document.querySelector("#marketBuyModal"),
  marketBuyBody: document.querySelector("#marketBuyBody"),
  marketWantPostModal: document.querySelector("#marketWantPostModal"),
  marketWantApplyModal: document.querySelector("#marketWantApplyModal"),
  bmMineCnt: document.querySelector("#bmMineCnt"),
  bmCollectBtn: document.querySelector("#bmCollectBtn"),
  bmRatingCnt: document.querySelector("#bmRatingCnt"),
  bmRatingBtn: document.querySelector("#bmRatingBtn"),
  bmStalls: document.querySelector("#bmStalls"),
  bmShop: document.querySelector("#bmShop"),
  bmQFilters: document.querySelector("#bmQFilters"),
  bmPriceMin: document.querySelector("#bmPriceMin"),
  bmPriceMax: document.querySelector("#bmPriceMax"),
  bmAfford: document.querySelector("#bmAfford"),
  bmReset: document.querySelector("#bmReset"),
  bmSearch: document.querySelector("#bmSearch"),
  bmSort: document.querySelector("#bmSort"),
  bmGrid: document.querySelector("#bmGrid"),
  bmListModal: document.querySelector("#bmListModal"),
  bmBuyModal: document.querySelector("#bmBuyModal"),
  bmBuyBody: document.querySelector("#bmBuyBody"),
  shopListings: document.querySelector("#shopListings"),
  equipmentShop: document.querySelector("#equipmentShop"),
  materialInventory: document.querySelector("#materialInventory"),
  refreshRecruitBtn: document.querySelector("#refreshRecruitBtn"),
  recruitCandidateList: document.querySelector("#recruitCandidateList"),
  ownedWorkerList: document.querySelector("#ownedWorkerList"),
  ownedWorkerCount: document.querySelector("#ownedWorkerCount"),
  hireMarketBrief: document.querySelector("#hireMarketBrief"),
  hireMarketView: document.querySelector('[data-view="hireMarket"]'),
  livestream: document.querySelector("#livestreamPanel"),
  reports: document.querySelector("#reportsPanel"),
  collectionList: document.querySelector("#collectionList"),
  floatingTextLayer: document.querySelector("#floatingTextLayer"),
  modalRoot: document.querySelector("#modalRoot"),
  toast: document.querySelector("#toast"),
  topHud: document.querySelector("#topHud"),
  hudRatingPopover: document.querySelector("#hudRatingPopover"),
  mobileResourcesToggle: document.querySelector("#mobileResourcesToggle"),
  playerCard: document.querySelector("#playerCard"),
  chatInput: document.querySelector("#chatInput"),
  chatSend: document.querySelector("#chatSend"),
  chatComposer: document.querySelector("#chatComposer"),
  chatNewMessages: document.querySelector("#chatNewMessages"),
  chatDockUnread: document.querySelector("#chatDockUnread"),
  mainNav: document.querySelector("#mainNav"),
  mainStage: document.querySelector("#mainStage"),
  sidePanel: document.querySelector("#sidePanel"),
  sidePanelToggle: document.querySelector("#sidePanelToggle"),
  sidePanelUnread: document.querySelector("#sidePanelUnread"),
  chatDock: document.querySelector("#chatDock"),
  chatDockCompactBtn: document.querySelector("#chatDockCompactBtn"),
  chatDockToggle: document.querySelector("#chatDockToggle"),
  sidePanelBody: document.querySelector("#sidePanelBody"),
  panelTabs: document.querySelector("#panelTabs"),
  homeTabs: document.querySelector("#homeTabs"),
  homeStatusPane: document.querySelector("#homeStatusPane"),
  homeTaskPane: document.querySelector("#homeTaskPane"),
  homeBillPane: document.querySelector("#homeBillPane"),
  homeCreditPane: document.querySelector("#homeCreditPane"),
  themeToggle: document.querySelector("#themeToggle")
};

bindFormatDeps({
  getNowMs: () => Date.now() + serverClockOffset,
  getState: () => state
});
bindToastFxDeps({ getEls: () => els });
bindGameModalDeps({
  getEls: () => els,
  getState: () => state,
  getSocket: () => socket,
  clearPendingAuctionBid,
  clearPendingEnterAuctionHall,
  openLocationByView: (view) => openLocationByView(view),
  buildAuctionSettle: buildAuctionSettleModalEvent,
  buildLivestreamSettle: buildLivestreamSettleModalEvent
});
bindThemeDeps({ getEls: () => els });
bindInventoryHelperDeps({
  getState: () => state,
  getSocket: () => socket,
  kitsFor,
  openingKitProductLabel
});
bindNavigationDeps({
  getState: () => state,
  getEls: () => els,
  getActiveView: () => activeView,
  setActiveView: (v) => { activeView = v; },
  locationDefinitions,
  featureAccess,
  countInventoryUnseen,
  setHireMarketTab,
  exitInventoryRecycleMode,
  renderActiveView,
  paintJades,
  activeViewRoot,
  renderBill,
  renderCredit
});
bindHudDeps({
  getState: () => state,
  getEls: () => els,
  productionJobsFor,
  matchingBracelets,
  inventoryCounts,
  workshopJobs,
  auctionPhaseMeta,
  achievementsHtml,
  requestState: () => {
    if (!socket.connected) return false;
    socket.emit("requestState");
    return true;
  },
  openBillView
});
bindOverviewDeps({
  getState: () => state,
  getEls: () => els,
  productionJobsFor,
  matchingBracelets,
  sumValue,
  currentReportSummary,
  rankBoardById,
  rankingRowsFor,
  msUntilNextOrderDailyRefresh,
  renderBill,
  renderCredit
});
bindRenderPipelineDeps({
  getState: () => state,
  getEls: () => els,
  getActiveView: () => activeView,
  renderMainNav,
  renderPlayerCard,
  renderTopHud,
  renderSidePanel,
  renderPlayerSidebar,
  renderHomeMessages
});
setViewRenderers({
  overview: () => renderOverview(),
  rankings: () => renderRankingBoard(),
  auction: () => renderAuction(),
  auctionHistory: () => renderAuctionHistory(),
  mining: () => renderMining(),
  workshop: () => renderWorkshop(),
  inventory: () => renderInventory(),
  orders: () => renderOrders(),
  market: () => renderMarket(),
  blackmarket: () => renderBlackmarket(),
  shop: () => renderShop(),
  livestream: () => renderLivestream(),
  reports: () => renderReports(),
  collection: () => renderCollection(),
  hireMarket: () => renderHireMarket()
});

bindOpeningDeps({
  getState: () => state,
  materialStageForClient,
  workshopRefreshPlanner,
  renderWorkshop,
  paintJades
});
registerOpeningPointerListeners();
registerOpeningActions(registerAction, { socket });

wireShellActions({
  registerAction,
  actions,
  socket,
  els,
  getState: () => state,
  locationDefinitions,
  openLocationByView,
  closeGameModal,
  ackAuctionSettleModal,
  ackLivestreamSettleModal,
  openInventoryAfterAuction,
  focusInventoryEscrow,
  isWindowSelectionActive,
  requestAuctionWindowAt,
  boardPointFromEvent,
  handleOpeningClick,
  setMobileResourcesOpen,
  closeMarketModals,
  routeInventoryItem
});

wireSocket({
  socket,
  els,
  setState: (next) => {
    state = {
      ...(state || {}),
      ...next,
      equipmentCatalog: next.equipmentCatalog || state?.equipmentCatalog || [],
      inlayCatalog: next.inlayCatalog || state?.inlayCatalog || []
    };
  },
  getState: () => state,
  setServerClockOffset: (offset) => { serverClockOffset = offset; },
  render,
  showToast,
  handleUiEvent,
  maybeShowStateDrivenModals,
  notifyNewAchievements,
  resetAchievementToastState
});

initTheme();
initAccountModule({ socket, showToast });
initShell({
  els,
  socket,
  getState: () => state,
  getActiveView: () => activeView,
  setView,
  renderMainNav,
  setMobileResourcesOpen,
  toggleMobilePanel,
  closeMobileTransientUi,
  selectHomeTab,
  getSidePanelFilter,
  setSidePanelFilter,
  applySidePanelFilter,
  sendChat,
  syncAuctionBidAffordability,
  openGameModal,
  formatMoney,
  TASK_RESET_COST,
  tickHudClock,
  tickSidePanelProgress,
  tickWorkshopJobProgress,
  tickAuctionClock,
  updateTaskCountdown,
  confirmBatchRefreshOrders
});

wireFeatureModules({
  initAuctionModule,
  initMarketModule,
  initBlackmarketModule,
  initWorkshopModule,
  initInventoryModule,
  initChatModule,
  initRankingModule,
  initOrdersModule,
  initLivestreamModule,
  initExtraModule,
  initBillModule,
  initMiningModule,
  socket,
  getState: () => state,
  els,
  getActiveView: () => activeView,
  registerAction,
  leaveLockedBlackmarket: () => openLocationByView("overview"),
  openBillView,
  openHomeOverview,
  helpers: {
    auction: {
      formatMoney, formatDuration, nowMs, tickHudClock,
      escapeHtml, empty, showToast, clampClient, boardPointFromEvent,
      setView, paintJades, CSS, openGameModal, closeGameModal
    },
    market: {
      formatMoney, escapeHtml, empty, showToast, typeName,
      productCanvas, openingStoneSvg, openingKitsForRender, jadeCanvasMarkup
    },
    blackmarket: {
      formatMoney, escapeHtml, empty, showToast, openGameModal, closeGameModal, typeName,
      productCanvas, openingStoneSvg, jadeCanvasMarkup,
      kitsFor, roughKits, openingKitsForServer, openingKitFromStored, openingKitProductLabel
    },
    workshop: {
      formatMoney, formatDuration, escapeHtml, empty, nowMs, typeName,
      materialStageForClient, materialStageLabel, productCanvas, openingStoneSvg, openingKitsForRender,
      kitsFor, roughBoard, roughPlannerControls, placementAnalysisRows, openingKitsForServer,
      roughKits, paintJades, showToast, productionJobsFor, renderInventory
    },
    inventory: {
      formatMoney, formatNumber, escapeHtml, typeName,
      materialStageForClient, materialStageLabel, productCanvas, openingStoneSvg,
      openingKitsForRender, kitsFor, openingKitProductLabel,
      inspectInventoryItem, openGameModal, closeGameModal, showToast, removeOpeningKit
    },
    chat: {
      nowMs, formatMoney, formatDuration, escapeHtml, empty,
      gameClock, auctionPhaseMeta, reminderRows, inventoryCounts, showToast
    },
    ranking: {
      setView, escapeHtml, formatNumber, formatMoney
    },
    orders: {
      finishedProducts, matchingBracelets, productMatchesOrder, productName, productCanvas,
      formatMoney, escapeHtml, empty, routeRecommendation, liveSaleRange, productOrderFitReasons,
      button, viewButton, showToast, openGameModal, closeGameModal
    },
    livestream: {
      finishedProducts, productCanvas, formatMoney, escapeHtml, empty,
      paintProductCanvases: paintJades, showToast
    },
    extra: {
      currentReportSummary, formatMoney, escapeHtml, empty, productCanvas, formatNumber,
      openGameModal, closeGameModal
    },
    bill: { formatMoney, formatNumber, escapeHtml },
    mining: { formatMoney, formatDuration, escapeHtml, nowMs, showToast, openGameModal, closeGameModal }
  }
});
initFinanceModule({ getState: () => state, registerAction });
