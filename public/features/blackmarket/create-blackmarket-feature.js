import { createBlackmarketUiState } from "./state.js";
import { createFeatureScope } from "../../shell/feature-scope.js";
import { createLazyPreviewObserver } from "../../lazy-preview.js";
import { createProductView } from "../../commerce/product-view.js";
import * as productCatalog from "../../commerce/product-catalog.js";
import { setView as shellSetView } from "../../shell/navigation.js";
import { getActiveModal } from "../../shell/game-modal.js";
import { createBlackmarketSelectors } from "./shared.js";
import { createBlackmarketGoodsDisplay } from "./goods-display.js";
import { createBlackmarketItemDetailView } from "./item-detail-view.js";
import { createBlackmarketPreviews } from "./previews.js";
import { createBlackmarketGoods } from "./goods.js";
import { createBlackmarketBlindUi } from "./blind-ui.js";
import { createBlackmarketServiceUi } from "./service-ui.js";
import { createBlackmarketPlaza } from "./plaza.js";
import { createBlackmarketActions } from "./actions.js";

export function createBlackmarketFeature(deps = {}) {
  const ui = createBlackmarketUiState();
  const scope = createFeatureScope({ registerAction: deps.registerAction, timers: deps.timers });
  const previewObserver = createLazyPreviewObserver();
  const document = deps.document || globalThis.document;
  const window = deps.window || document?.defaultView || globalThis.window;
  const getState = deps.getState || (() => null);
  const getActiveView = deps.getActiveView || (() => "overview");
  const elsRef = deps.els || {};
  const bmUi = ui.bmUi;
  const leaveLockedBlackmarket = deps.leaveLockedBlackmarket || null;
  const setView = deps.setView || shellSetView;
  let ownedModal = null;
  let mounted = false;
  const helpers = { ...deps.helpers,
    openGameModal(payload) { ownedModal = payload; return deps.helpers?.openGameModal?.(payload); },
    closeGameModal(...args) { ownedModal = null; return deps.helpers?.closeGameModal?.(...args); }
  };
  const socketRef = {
    emit(name, ...args) {
      if (!scope.active) return;
      return deps.socket?.emit(name, ...args.map(arg => typeof arg === "function" ? scope.guard(arg) : arg));
    },
    on(name, handler) { return scope.subscribe(deps.socket, name, handler); }
  };
  const productView = { ...productCatalog, ...createProductView({ getDocument: () => document, helpers, isCurrent: () => scope.active }) };
  const api = {};
  const forward = name => (...args) => api[name](...args);
  Object.assign(api, createBlackmarketSelectors({
    document, ui, getState, helpers
  }));
  Object.assign(api, createBlackmarketGoodsDisplay({
    helpers, productView
  }));
  Object.assign(api, createBlackmarketItemDetailView({
    ports: {
      blackmarketResourceCard: forward("blackmarketResourceCard")
    }
  }));
  Object.assign(api, createBlackmarketPreviews({
    document, window, scope, ui, bmUi, getActiveView, elsRef, productView,
    ports: {
      bmStallById: forward("bmStallById"),
      isSpecialGoods: forward("isSpecialGoods")
    }
  }));
  Object.assign(api, createBlackmarketGoods({
    document, scope, ui, socketRef, elsRef, bmUi, getState, helpers, productView, observeLazyPreviews: previewObserver.observe,
    ports: {
      bmSellables: forward("bmSellables"),
      clearBmPlanDrafts: forward("clearBmPlanDrafts"),
      bmMyStall: forward("bmMyStall"),
      bmFeatureGate: forward("bmFeatureGate"),
      guardBmFeature: forward("guardBmFeature"),
      openBmSetupModal: forward("openBmSetupModal"),
      renderBlackmarket: forward("renderBlackmarket"),
      closeBmModals: forward("closeBmModals"),
      specialGoodsVisual: forward("specialGoodsVisual"),
      specialGoodsChips: forward("specialGoodsChips"),
      npcGoodsInfo: forward("npcGoodsInfo"),
      specialGoodsLabel: forward("specialGoodsLabel"),
      blackmarketResourceCard: forward("blackmarketResourceCard")
    }
  }));
  Object.assign(api, createBlackmarketBlindUi({
    document, scope, ui, socketRef, getState, bmUi, helpers, productView, observeLazyPreviews: previewObserver.observe,
    ports: {
      setLastBlindSellableKey: forward("setLastBlindSellableKey"),
      allBmSellables: forward("bmSellables"),
      clearBmPlanDrafts: forward("clearBmPlanDrafts"),
      bmStalls: forward("bmStalls"),
      bmMyStall: forward("bmMyStall"),
      bmStallInSetup: forward("bmStallInSetup"),
      bmSetupHint: forward("bmSetupHint"),
      bmFeatureGate: forward("bmFeatureGate"),
      guardBmFeature: forward("guardBmFeature"),
      bmAffordable: forward("bmAffordable"),
      renderBlackmarket: forward("renderBlackmarket")
    }
  }));
  Object.assign(api, createBlackmarketServiceUi({
    document, scope, ui, socketRef, getState, bmUi, helpers, productView, observeLazyPreviews: previewObserver.observe,
    ports: {
      bmMyStall: forward("bmMyStall"),
      bmStallById: forward("bmStallById"),
      bmFeatureGate: forward("bmFeatureGate"),
      guardBmFeature: forward("guardBmFeature"),
      bmAffordable: forward("bmAffordable"),
      starsHtml: forward("starsHtml"),
      serviceProfileHtml: forward("serviceProfileHtml"),
      serviceOfferCapabilityHtml: forward("serviceOfferCapabilityHtml"),
      serviceOfferBasisHtml: forward("serviceOfferBasisHtml"),
      closeBmModals: forward("closeBmModals")
    }
  }));
  Object.assign(api, createBlackmarketPlaza({
    document, scope, ui, socketRef, getState, elsRef, getActiveView, leaveLockedBlackmarket, bmUi, helpers, productView, observeLazyPreviews: previewObserver.observe,
    ports: {
      setBmFiltersBound: forward("setBmFiltersBound"),
      bmSellables: forward("bmSellables"),
      bmFeatureGate: forward("bmFeatureGate"),
      guardBmFeature: forward("guardBmFeature"),
      syncBmFeatureChrome: forward("syncBmFeatureChrome"),
      bmStalls: forward("bmStalls"),
      bmPublishedStalls: forward("bmPublishedStalls"),
      bmMyStall: forward("bmMyStall"),
      bmStallInSetup: forward("bmStallInSetup"),
      bmSetupHint: forward("bmSetupHint"),
      bmStallById: forward("bmStallById"),
      bmClaimable: forward("bmClaimable"),
      bmPendingRatings: forward("bmPendingRatings"),
      bmPendingRatingLine: forward("bmPendingRatingLine"),
      bmPendingRatingsSummary: forward("bmPendingRatingsSummary"),
      bmServiceOrders: forward("bmServiceOrders"),
      bmAffordable: forward("bmAffordable"),
      starsHtml: forward("starsHtml"),
      satisfactionStars: forward("satisfactionStars"),
      bmRatingPublicHtml: forward("bmRatingPublicHtml"),
      bmRatingSortScore: forward("bmRatingSortScore"),
      typeLabel: forward("typeLabel"),
      openBmListModal: forward("openBmListModal"),
      syncBmBlindStockModalIfOpen: forward("syncBmBlindStockModalIfOpen"),
      bmBlindDisplayPrice: forward("bmBlindDisplayPrice"),
      reconcileBmBlindPlaceholderPrice: forward("reconcileBmBlindPlaceholderPrice"),
      confirmBmBlindManageMeta: forward("confirmBmBlindManageMeta"),
      isBmBlindManageModalOpen: forward("isBmBlindManageModalOpen"),
      syncBmBlindManageModalIfOpen: forward("syncBmBlindManageModalIfOpen"),
      openBmBlindManageModal: forward("openBmBlindManageModal"),
      closeBmBlindManageModal: forward("closeBmBlindManageModal"),
      requestBmBlindDrawClose: forward("requestBmBlindDrawClose"),
      resumeBmBlindDrawFromState: forward("resumeBmBlindDrawFromState"),
      openBmServiceOfferModal: forward("openBmServiceOfferModal"),
      npcRoleLabel: forward("npcRoleLabel"),
      isSpecialGoods: forward("isSpecialGoods"),
      specialGoodsVisual: forward("specialGoodsVisual"),
      specialGoodsChips: forward("specialGoodsChips"),
      npcGoodsInfo: forward("npcGoodsInfo"),
      npcPurchaseDestination: forward("npcPurchaseDestination"),
      specialGoodsLabel: forward("specialGoodsLabel"),
      employeeSkillStats: forward("employeeSkillStats"),
      goodsPriceComparison: forward("goodsPriceComparison"),
      resourceCardName: forward("resourceCardName"),
      resourceCardSummary: forward("resourceCardSummary"),
      blackmarketResourceCard: forward("blackmarketResourceCard"),
      bindBmPreviewPrewarming: forward("bindBmPreviewPrewarming"),
      prewarmBmVisibleStalls: forward("prewarmBmVisibleStalls"),
      blackmarketItemDetailHtml: forward("blackmarketItemDetailHtml")
    }
  }));
  Object.assign(api, createBlackmarketActions({
    document, scope, ui, socketRef, getState, bmUi, setView, helpers,
    ports: {
      bmMyStall: forward("bmMyStall"),
      bmStallById: forward("bmStallById"),
      guardBmFeature: forward("guardBmFeature"),
      openBmSetupModal: forward("openBmSetupModal"),
      guardBmPlazaLeave: forward("guardBmPlazaLeave"),
      renderBlackmarket: forward("renderBlackmarket"),
      openBmOpenModal: forward("openBmOpenModal"),
      syncBmOpenTypeHint: forward("syncBmOpenTypeHint"),
      confirmBmOpenStall: forward("confirmBmOpenStall"),
      openBmBuy: forward("openBmBuy"),
      openBmItemDetail: forward("openBmItemDetail"),
      confirmBmBuy: forward("confirmBmBuy"),
      openBmRatingModal: forward("openBmRatingModal"),
      openBmRatingForm: forward("openBmRatingForm"),
      closeBmModals: forward("closeBmModals"),
      openBmListModal: forward("openBmListModal"),
      toggleBmListItem: forward("toggleBmListItem"),
      confirmBmList: forward("confirmBmList"),
      finishGoodsList: forward("finishGoodsList"),
      requestBmWithdraw: forward("requestBmWithdraw"),
      confirmBmWithdraw: forward("confirmBmWithdraw"),
      isBmBlindStockModalOpen: forward("isBmBlindStockModalOpen"),
      applyBmBlindSuggestedPrice: forward("applyBmBlindSuggestedPrice"),
      confirmBmBlindStockPrice: forward("confirmBmBlindStockPrice"),
      confirmBmBlindManageMeta: forward("confirmBmBlindManageMeta"),
      openBmBlindStockModal: forward("openBmBlindStockModal"),
      toggleBmBlindItem: forward("toggleBmBlindItem"),
      confirmBmBlindStock: forward("confirmBmBlindStock"),
      finishBlindStock: forward("finishBlindStock"),
      setBmBlindManageTab: forward("setBmBlindManageTab"),
      openBmBlindManageModal: forward("openBmBlindManageModal"),
      closeBmBlindManageModal: forward("closeBmBlindManageModal"),
      selectBmBlindManageItem: forward("selectBmBlindManageItem"),
      openBmBlindStockFromManage: forward("openBmBlindStockFromManage"),
      openBmBlindMetaModal: forward("openBmBlindMetaModal"),
      confirmBmBlindMeta: forward("confirmBmBlindMeta"),
      promptBmToggleAnonymous: forward("promptBmToggleAnonymous"),
      confirmBmToggleAnonymous: forward("confirmBmToggleAnonymous"),
      bmBlindManageBuyerPreview: forward("bmBlindManageBuyerPreview"),
      requestBmBlindManageWithdraw: forward("requestBmBlindManageWithdraw"),
      finishBmBlindManageWithdraw: forward("finishBmBlindManageWithdraw"),
      openBmBlindDrawModal: forward("openBmBlindDrawModal"),
      skipBmBlindDrawAnim: forward("skipBmBlindDrawAnim"),
      toggleBmBlindDrawPick: forward("toggleBmBlindDrawPick"),
      renderBmBlindDrawModal: forward("renderBmBlindDrawModal"),
      settleBmBlindDraw: forward("settleBmBlindDraw"),
      requestBmBlindDrawClose: forward("requestBmBlindDrawClose"),
      confirmBmBlindDrawClose: forward("confirmBmBlindDrawClose"),
      finishBmBlindDrawUi: forward("finishBmBlindDrawUi"),
      openBmServiceOfferModal: forward("openBmServiceOfferModal"),
      openBmServiceInfoModal: forward("openBmServiceInfoModal"),
      confirmBmServiceOffer: forward("confirmBmServiceOffer"),
      setBmProfileTab: forward("setBmProfileTab"),
      confirmBmServiceProfile: forward("confirmBmServiceProfile"),
      bindBmServiceProfileModal: forward("bindBmServiceProfileModal"),
      openBmOrderServiceModal: forward("openBmOrderServiceModal"),
      setBmOrderFilter: forward("setBmOrderFilter"),
      bindBmOrderServiceModal: forward("bindBmOrderServiceModal"),
      confirmBmOrderService: forward("confirmBmOrderService"),
      promptBmEarlySubmit: forward("promptBmEarlySubmit")
    }
  }));

  function mount() {
    if (mounted) return feature;
    mounted = true;
    scope.activate();
    api.registerBlackmarketActions();
    return feature;
  }

  function dispose() {
    scope.dispose();
    previewObserver.disconnect();
    if (ownedModal && (deps.getActiveModal || getActiveModal)() === ownedModal) helpers.closeGameModal();
    if (mounted) {
      for (const id of ["bmListModal", "bmBuyModal", "bmOpenModal", "bmBlindStockModal", "bmBlindMetaModal",
        "bmServiceOfferModal", "bmServiceProfileModal", "bmServiceInfoModal", "bmRatingModal", "bmWithdrawConfirmModal",
        "bmOrderServiceModal", "bmBlindManageModal", "bmBlindDrawModal"]) {
        const modal = document?.getElementById(id);
        if (modal) modal.hidden = true;
      }
    }
    mounted = false;
    ui.bmFiltersBound = ui.blackmarketTabKeyboardBound = ui.bmServiceTemplateBound = false;
    ui.previewPrewarmingBound = false;
    ui.profileModalBound = ui.orderModalBound = ui.lastDetailRender = null;
    ui.lastBlindSellableKey = "";
    ui.goodsSubmitTimer = null;
    bmUi.goodsSubmitting = bmUi.blindSubmitting = bmUi.blindWithdrawing = false;
    bmUi.goodsPendingIds.clear();
    bmUi.blindDrawTimer = null;
    bmUi.blindDraw = null;
    bmUi.suppressBlindDrawResume = false;
  }

  const feature = { ...api, bmUi, mount, dispose,
    render: (...args) => mounted ? api.renderBlackmarket(...args) : undefined,
    renderBlackmarket: (...args) => mounted ? api.renderBlackmarket(...args) : undefined
  };
  return feature;
}
