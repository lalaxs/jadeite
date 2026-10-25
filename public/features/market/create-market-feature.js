import { createMarketUiState } from "./state.js";
import { createFeatureScope } from "../../shell/feature-scope.js";
import { createLazyPreviewObserver } from "../../lazy-preview.js";
import { createMarketItemView } from "./item-view.js";
import { createMarketSelectors } from "./selectors.js";
import { createMarketBoardView } from "./board-view.js";
import { createMarketWantView } from "./want-view.js";
import { createMarketListingView } from "./listing-view.js";
import { createMarketListingController } from "./listing-controller.js";
import { createMarketWantController } from "./want-controller.js";
import { createMarketBindings } from "./bindings.js";
import { createMarketModalController } from "./modal-controller.js";
import { marketQualityKey, marketQualityMeta, deriveMaterialProfile, marketGemColor, marketRefValue, marketElapsed, mlSteps } from "./catalog.js";

export function createMarketFeature(deps = {}) {
  const ui = createMarketUiState();
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
  Object.assign(api, createMarketItemView({
    getState, getDocument, helpers, isCurrent: () => scope.active,
    ports: {
      marketAffordable: forward("marketAffordable")
    }
  }));
  Object.assign(api, createMarketSelectors({
    getState, ui,
    ports: {
      wantRequirementText: forward("wantRequirementText")
    }
  }));
  Object.assign(api, createMarketBoardView({
    getState, elsRef, getDocument, observeLazyPreviews: previewObserver.observe, ui, helpers,
    ports: {
      marketCardHtml: forward("marketCardHtml"),
      marketSellables: forward("marketSellables"),
      marketActiveFilterCount: forward("marketActiveFilterCount"),
      marketFilterSort: forward("marketFilterSort"),
      filterWantsForBrowse: forward("filterWantsForBrowse"),
      wantCardHtml: forward("wantCardHtml"),
      bindMarketOnce: forward("bindMarketOnce"),
      syncMarketFilterInputs: forward("syncMarketFilterInputs")
    }
  }));
  Object.assign(api, createMarketWantView({
    getState, helpers,
    ports: {
      sortOffersPreview: forward("sortOffersPreview"),
      wantLowestOffer: forward("wantLowestOffer")
    }
  }));
  Object.assign(api, createMarketListingView({
    elsRef, observeLazyPreviews: previewObserver.observe, ui, helpers,
    ports: {
      openingKitsForItemVisual: forward("openingKitsForItemVisual"),
      marketProfileChips: forward("marketProfileChips"),
      mlVisual: forward("mlVisual"),
      marketSellables: forward("marketSellables")
    }
  }));
  Object.assign(api, createMarketListingController({
    socketRef, getState, elsRef, getDocument, ui, helpers,
    ports: {
      marketItemVisual: forward("marketItemVisual"),
      marketCardAttrChips: forward("marketCardAttrChips"),
      marketProfileChips: forward("marketProfileChips"),
      marketPriceDelta: forward("marketPriceDelta"),
      marketSellerLine: forward("marketSellerLine"),
      marketSellables: forward("marketSellables"),
      marketAffordable: forward("marketAffordable"),
      renderMlGrid: forward("renderMlGrid"),
      renderMlDetailEmpty: forward("renderMlDetailEmpty"),
      updateMlFee: forward("updateMlFee"),
      renderMlDetail: forward("renderMlDetail"),
      setMlConfirm: forward("setMlConfirm"),
      openMarketModal: forward("openMarketModal"),
      closeMarketModals: forward("closeMarketModals")
    }
  }));
  Object.assign(api, createMarketWantController({
    socketRef, getState, elsRef, getDocument, scope, observeLazyPreviews: previewObserver.observe, ui, helpers,
    ports: {
      mlVisual: forward("mlVisual"),
      marketSellables: forward("marketSellables"),
      wantRequirementText: forward("wantRequirementText"),
      openMarketModal: forward("openMarketModal"),
      closeMarketModals: forward("closeMarketModals")
    }
  }));
  Object.assign(api, createMarketBindings({
    socketRef, getState, elsRef, getDocument, scope, ui, helpers,
    ports: {
      marketActiveFilterCount: forward("marketActiveFilterCount"),
      renderMarket: forward("renderMarket"),
      renderMarketStalls: forward("renderMarketStalls"),
      renderMarketFilters: forward("renderMarketFilters"),
      renderMarketGrid: forward("renderMarketGrid"),
      renderMarketWants: forward("renderMarketWants"),
      renderMlGrid: forward("renderMlGrid"),
      updateMlFee: forward("updateMlFee"),
      changeMlPrice: forward("changeMlPrice"),
      selectMlItem: forward("selectMlItem"),
      openMarketListModal: forward("openMarketListModal"),
      confirmMarketList: forward("confirmMarketList"),
      openMarketBuy: forward("openMarketBuy"),
      confirmMarketBuy: forward("confirmMarketBuy"),
      selectMarketWantApplyItem: forward("selectMarketWantApplyItem"),
      syncWantPostFields: forward("syncWantPostFields"),
      openMarketWantPost: forward("openMarketWantPost"),
      confirmMarketWantPost: forward("confirmMarketWantPost"),
      openMarketApplyWant: forward("openMarketApplyWant"),
      confirmMarketApplyWant: forward("confirmMarketApplyWant"),
      closeMarketModals: forward("closeMarketModals")
    }
  }));
  Object.assign(api, createMarketModalController({
    elsRef, ui
  }));

  function mount() {
    if (mounted) return feature;
    mounted = true;
    scope.activate();
    api.registerMarketActions();
    return feature;
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    scope.dispose();
    previewObserver.disconnect();
    api.closeMarketModals();
    ui.marketVirtual?.destroy(); ui.marketVirtual = null;
    ui.marketFiltersBound = false;
    ui.lastMarketRenderFp = "";
  }

  const feature = {
    mount, dispose, render: (...args) => mounted ? api.renderMarket(...args) : undefined,
    marketItemPreviewKey: api.marketItemPreviewKey,
    prepareMarketItemVisual: api.prepareMarketItemVisual,
    marketItemVisual: api.marketItemVisual,
    marketCardAttrChips: api.marketCardAttrChips,
    marketCardProfile: api.marketCardProfile,
    marketProfileChips: api.marketProfileChips,
    marketPriceDelta: api.marketPriceDelta,
    marketSellables: api.marketSellables,
    marketAffordable: api.marketAffordable,
    renderMarket: (...args) => mounted ? api.renderMarket(...args) : undefined,
    renderMarketSection: api.renderMarketSection,
    renderMarketStalls: api.renderMarketStalls,
    renderMarketFilters: api.renderMarketFilters,
    marketFilterSort: api.marketFilterSort,
    marketCardHtml: api.marketCardHtml,
    renderMarketGrid: api.renderMarketGrid,
    renderMarketMine: api.renderMarketMine,
    renderMarketWants: api.renderMarketWants,
    bindMarketOnce: api.bindMarketOnce,
    resetMarketFilters: api.resetMarketFilters,
    syncMarketFilterInputs: api.syncMarketFilterInputs,
    mlVisual: api.mlVisual,
    openMarketListModal: api.openMarketListModal,
    confirmMarketList: api.confirmMarketList,
    openMarketBuy: api.openMarketBuy,
    confirmMarketBuy: api.confirmMarketBuy,
    openMarketWantPost: api.openMarketWantPost,
    confirmMarketWantPost: api.confirmMarketWantPost,
    openMarketApplyWant: api.openMarketApplyWant,
    confirmMarketApplyWant: api.confirmMarketApplyWant,
    closeMarketModals: api.closeMarketModals,
    marketSetStall: api.marketSetStall,
    marketSetSection: api.marketSetSection,
    marketToggleQ: api.marketToggleQ,
    marketQualityKey,
    marketQualityMeta,
    deriveMaterialProfile,
    marketGemColor,
    marketRefValue,
    marketElapsed,
    mlSteps
  };
  return feature;
}
