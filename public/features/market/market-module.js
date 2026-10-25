import { createMarketFeature } from "./create-market-feature.js";
export { createMarketFeature };
export { marketQualityKey, marketQualityMeta, deriveMaterialProfile, marketGemColor, marketRefValue, marketElapsed, mlSteps } from "./catalog.js";

let current = createMarketFeature();
export function initMarketModule(deps) {
  current.dispose();
  current = createMarketFeature(deps);
  current.mount();
}
export function disposeMarketModule() { current.dispose(); }
export function marketItemPreviewKey(...args) { return current.marketItemPreviewKey(...args); }
export function prepareMarketItemVisual(...args) { return current.prepareMarketItemVisual(...args); }
export function marketItemVisual(...args) { return current.marketItemVisual(...args); }
export function marketCardAttrChips(...args) { return current.marketCardAttrChips(...args); }
export function marketCardProfile(...args) { return current.marketCardProfile(...args); }
export function marketProfileChips(...args) { return current.marketProfileChips(...args); }
export function marketPriceDelta(...args) { return current.marketPriceDelta(...args); }
export function marketSellables(...args) { return current.marketSellables(...args); }
export function marketAffordable(...args) { return current.marketAffordable(...args); }
export function renderMarket(...args) { return current.renderMarket(...args); }
export function renderMarketSection(...args) { return current.renderMarketSection(...args); }
export function renderMarketStalls(...args) { return current.renderMarketStalls(...args); }
export function renderMarketFilters(...args) { return current.renderMarketFilters(...args); }
export function marketFilterSort(...args) { return current.marketFilterSort(...args); }
export function marketCardHtml(...args) { return current.marketCardHtml(...args); }
export function renderMarketGrid(...args) { return current.renderMarketGrid(...args); }
export function renderMarketMine(...args) { return current.renderMarketMine(...args); }
export function renderMarketWants(...args) { return current.renderMarketWants(...args); }
export function bindMarketOnce(...args) { return current.bindMarketOnce(...args); }
export function resetMarketFilters(...args) { return current.resetMarketFilters(...args); }
export function syncMarketFilterInputs(...args) { return current.syncMarketFilterInputs(...args); }
export function mlVisual(...args) { return current.mlVisual(...args); }
export function openMarketListModal(...args) { return current.openMarketListModal(...args); }
export function confirmMarketList(...args) { return current.confirmMarketList(...args); }
export function openMarketBuy(...args) { return current.openMarketBuy(...args); }
export function confirmMarketBuy(...args) { return current.confirmMarketBuy(...args); }
export function openMarketWantPost(...args) { return current.openMarketWantPost(...args); }
export function confirmMarketWantPost(...args) { return current.confirmMarketWantPost(...args); }
export function openMarketApplyWant(...args) { return current.openMarketApplyWant(...args); }
export function confirmMarketApplyWant(...args) { return current.confirmMarketApplyWant(...args); }
export function closeMarketModals(...args) { return current.closeMarketModals(...args); }
export function marketSetStall(...args) { return current.marketSetStall(...args); }
export function marketSetSection(...args) { return current.marketSetSection(...args); }
export function marketToggleQ(...args) { return current.marketToggleQ(...args); }
