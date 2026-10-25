import { BLACKMARKET_MIN_PRICE as BM_MIN_PRICE } from "../../bm-constants.js";

export function createBlackmarketUiState() {
  return {
    bmUi: {
      section: "plaza", // plaza | mine | detail
      typeFilter: "all",
      search: "",
      sort: "latest",
      detailStallId: null,
      buyStallId: null,
      buyListingId: null,
      buyPrice: null,
      openType: "goods",
      openTitle: "",
      openBlurb: "",
      openAnonymous: false,
      goodsPrice: BM_MIN_PRICE,
      goodsSelectedIds: new Set(),
      goodsPriceById: new Map(),
      goodsFocusId: null,
      goodsSubmitting: false,
      goodsPendingIds: new Set(),
      pendingWithdrawId: null,
      blindSelected: new Set(),
      blindFocusId: null,
      blindSubmitting: false,
      blindPriceTouched: false,
      blindManageFocusId: null,
      blindManageTab: "pool",
      blindWithdrawing: false,
      blindDraw: null, // { stallId, drawId, price, extras, candidates, selectedIds:Set, phase }
      blindDrawTimer: null,
      suppressBlindDrawResume: false,
      serviceTitle: "",
      serviceDesc: "",
      servicePrice: 100,
      serviceEta: 30,
      ratingStars: 5,
      orderItemId: null,
      orderItemType: null,
      orderStallId: null,
      orderOfferId: null,
      orderNote: "",
      orderFilter: "all",
      pendingSetupType: null,
      pendingAnonymous: null
    },
    bmFiltersBound: false, lastBlindSellableKey: "", lastDetailRender: null,
    blackmarketTabKeyboardBound: false, bmServiceTemplateBound: false,
    profileModalBound: null, orderModalBound: null, previewPrewarmingBound: false, goodsSubmitTimer: null
  };
}
