import { createLivestreamUiState } from "./state.js";
import { createFeatureScope } from "../../shell/feature-scope.js";
import { createLazyPreviewObserver } from "../../lazy-preview.js";
import { createLivestreamSelectors } from "./selectors.js";
import { createLivestreamChat } from "./chat.js";
import { createLivestreamStockView } from "./stock-view.js";
import { createLivestreamRoomView } from "./room-view.js";
import { createLivestreamOwnerView } from "./owner-view.js";
import { createLivestreamHallView } from "./hall-view.js";
import { createLivestreamShelfController } from "./shelf-controller.js";
import { createLivestreamActions } from "./actions.js";
import { createLivestreamBindings } from "./bindings.js";
import { createLivestreamView } from "./view.js";
import { priceRatioTier, aiDemandMeta, sortHallRooms, trimLivestreamSelection } from "./catalog.js";
import { CAROUSEL_INTERVAL_MS } from "./catalog.js";

export function createLivestreamFeature(deps = {}) {
  const ui = createLivestreamUiState();
  const scope = createFeatureScope({ registerAction: deps.registerAction, timers: deps.timers });
  const previewObserver = createLazyPreviewObserver();
  const getState = deps.getState || (() => null);
  const getActiveView = deps.getActiveView || (() => "overview");
  const elsRef = deps.els || {};
  const helpers = deps.helpers || {};
  const getDocument = () => deps.document || globalThis.document;
  const socketRef = deps.socket && { emit(name, ...args) {
    if (!scope.active) return;
    return deps.socket.emit(name, ...args.map(arg => typeof arg === "function" ? scope.guard(arg) : arg));
  } };
  const api = {};
  const forward = name => (...args) => api[name](...args);
  let mounted = false;
  Object.assign(api, createLivestreamSelectors({
    getState, getActiveView, ui, helpers
  }));
  Object.assign(api, createLivestreamChat({
    getState, elsRef, scope, ui, helpers,
    ports: {
      roomForId: forward("roomForId"),
      visibleChatRoomIds: forward("visibleChatRoomIds")
    }
  }));
  Object.assign(api, createLivestreamStockView({
    getState, ui, helpers,
    ports: {
      draftPrice: forward("draftPrice"),
      resolveModalHost: forward("resolveModalHost"),
      selectionSummary: forward("selectionSummary"),
      sortHostsForPicker: forward("sortHostsForPicker"),
      visibleStockProducts: forward("visibleStockProducts")
    }
  }));
  Object.assign(api, createLivestreamRoomView({
    getState, ui, helpers,
    ports: {
      itemValue: forward("itemValue"),
      currentSlideIndex: forward("currentSlideIndex"),
      chatRailMarkup: forward("chatRailMarkup")
    }
  }));
  Object.assign(api, createLivestreamOwnerView({
    ui, helpers,
    ports: {
      hostSubtitle: forward("hostSubtitle"),
      stockPickerMarkup: forward("stockPickerMarkup"),
      hostLiveChips: forward("hostLiveChips"),
      shelfMarkup: forward("shelfMarkup"),
      roomHeroMarkup: forward("roomHeroMarkup")
    }
  }));
  Object.assign(api, createLivestreamHallView({
    getState, ui, helpers,
    ports: {
      roomForId: forward("roomForId"),
      roomHeroMarkup: forward("roomHeroMarkup")
    }
  }));
  Object.assign(api, createLivestreamShelfController({
    getState, elsRef, getActiveView, scope, ui, helpers,
    ports: {
      rooms: forward("rooms"),
      roomForId: forward("roomForId"),
      currentSlideIndex: forward("currentSlideIndex"),
      captureChatScroll: forward("captureChatScroll"),
      restoreChatScroll: forward("restoreChatScroll"),
      roomHeroMarkup: forward("roomHeroMarkup")
    }
  }));
  Object.assign(api, createLivestreamActions({
    socketRef, getState, elsRef, ui, helpers,
    ports: {
      roomForId: forward("roomForId"),
      itemValue: forward("itemValue"),
      defaultPrice: forward("defaultPrice"),
      resolveSelectedHost: forward("resolveSelectedHost"),
      selectedListings: forward("selectedListings"),
      renderLivestream: forward("renderLivestream")
    }
  }));
  Object.assign(api, createLivestreamBindings({
    elsRef, scope, ui, helpers,
    ports: {
      visibleStockProducts: forward("visibleStockProducts"),
      moveSlide: forward("moveSlide"),
      selectSlide: forward("selectSlide"),
      applySelectAll: forward("applySelectAll"),
      enterHallRoom: forward("enterHallRoom"),
      setLivestreamTab: forward("setLivestreamTab"),
      applyPricePreset: forward("applyPricePreset"),
      emitStart: forward("emitStart"),
      emitReplenish: forward("emitReplenish"),
      emitClose: forward("emitClose"),
      emitBuy: forward("emitBuy"),
      syncSelectionControls: forward("syncSelectionControls"),
      renderLivestream: forward("renderLivestream")
    }
  }));
  Object.assign(api, createLivestreamView({
    getState, elsRef, observeLazyPreviews: previewObserver.observe, ui, helpers,
    ports: {
      roomForId: forward("roomForId"),
      availableHosts: forward("availableHosts"),
      resolveSelectedHost: forward("resolveSelectedHost"),
      selectionSummary: forward("selectionSummary"),
      visibleStockProducts: forward("visibleStockProducts"),
      pruneChatFeeds: forward("pruneChatFeeds"),
      captureChatScroll: forward("captureChatScroll"),
      restoreChatScroll: forward("restoreChatScroll"),
      startWizardMarkup: forward("startWizardMarkup"),
      ownerDashboardMarkup: forward("ownerDashboardMarkup"),
      visitorRoomCardMarkup: forward("visitorRoomCardMarkup"),
      visitorWatchMarkup: forward("visitorWatchMarkup"),
      tabsMarkup: forward("tabsMarkup"),
      mineEntryCardMarkup: forward("mineEntryCardMarkup"),
      captureShelfScroll: forward("captureShelfScroll"),
      restoreShelfScroll: forward("restoreShelfScroll"),
      capturePreservedShelves: forward("capturePreservedShelves"),
      restorePreservedShelves: forward("restorePreservedShelves"),
      reconcileSelection: forward("reconcileSelection"),
      clearWatchingRoom: forward("clearWatchingRoom")
    }
  }));

  function mount() {
    if (mounted) return feature;
    mounted = true;
    scope.activate();
    api.bindLivestreamOnce();
    if (!ui.carouselTimer) ui.carouselTimer = scope.setInterval(api.advanceVisibleCarousels, CAROUSEL_INTERVAL_MS);
    if (!ui.chatTickTimer) api.scheduleChatTick();
    return feature;
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    scope.dispose();
    previewObserver.disconnect();
    ui.boundRoot = null;
    ui.chatTickTimer = ui.carouselTimer = null;
    ui.hostModalOpen = ui.replenishOpen = ui.closeConfirmOpen = false;
    ui.buyConfirm = null;
    elsRef.livestream?.querySelectorAll?.(".livestream-host-modal-root, .livestream-replenish-modal-root, .livestream-close-modal-root, .livestream-buy-confirm").forEach(node => node.remove());
    ui.lastLivestreamRenderFp = "";
  }

  const feature = {
    mount, dispose, render: (...args) => mounted ? api.renderLivestream(...args) : undefined,
    appendLivestreamChatComments: api.appendLivestreamChatComments,
    buildLivestreamChatFeed: api.buildLivestreamChatFeed,
    resetLivestreamChatFeeds: api.resetLivestreamChatFeeds,
    focusLivestreamProduct: api.focusLivestreamProduct,
    renderLivestream: (...args) => mounted ? api.renderLivestream(...args) : undefined,
    priceRatioTier,
    aiDemandMeta,
    sortHallRooms,
    trimLivestreamSelection
  };
  return feature;
}
