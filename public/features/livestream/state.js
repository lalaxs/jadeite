export function createLivestreamUiState() {
  return {
    selectedProductIds: new Set(),
    priceDrafts: new Map(),
    slideIndexByRoom: new Map(),
    chatScrollByRoom: new Map(),
    shelfScrollByRoom: new Map(),
    chatFeedByRoom: new Map(),
    chatTickTimer: null,
    chatTickSeq: 0,
    draftHostId: null,
    draftTalkStyle: "balanced",
    hostModalOpen: false,
    modalHostId: null,
    hostDetailsOpen: false,
    replenishOpen: false,
    hallSort: "newest",
    activeLivestreamTab: "hall",
    stockPickerQuery: "",
    stockPickerFilter: "all",
    stockPickerSort: "valueDesc",
    watchingRoomId: null,
    buyConfirm: null,
    closeConfirmOpen: false,
    carouselTimer: null,
    boundRoot: null,
    lastLivestreamRenderFp: ""
  };
}
