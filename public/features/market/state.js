export function createMarketUiState() {
  return {
    marketUi: {
      section: "listings", // listings（集市挂单） | mine（我的挂单） | want（求购）
      cat: "all",
      search: "",
      sort: "latest",
      q: new Set(),
      equipmentStage: "", equipmentBrand: "", equipmentTech: "", equipmentCondition: "",
      min: null,
      max: null,
      afford: false,
      buyId: null,
      offerId: null,
      applyWantId: null,
      applyItemId: null,
      applyPrice: 100
    },
    marketPriceDraft: { min: "", max: "" },
    marketFiltersBound: false,
    lastMarketRenderFp: "",
    marketVirtual: null,
    marketModalLifecycleCleanup: null,
    wantPostUi: {
      itemType: "bracelet",
      durationKey: "10m",
      rule: "lowest",
      minScore: 3,
      qualityKey: "",
      acceptedKinds: new Set(["bracelet"])
    },
    mlUi: {
      search: "",
      cat: "all",
      sort: "valueDesc",
      selectedId: null,
      price: 0,
      priceTouched: false,
      stepSmall: 100,
      stepLarge: 1000
    }
  };
}
