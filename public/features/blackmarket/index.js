import { createBlackmarketFeature } from "./create-blackmarket-feature.js";
export { createBlackmarketFeature };
export { BM_TYPE_META, BM_FILTERS } from "./catalog.js";

let current = createBlackmarketFeature();
export let bmUi = current.bmUi;
export function bindBlackmarketDeps(deps) {
  current.dispose();
  current = createBlackmarketFeature(deps);
  bmUi = current.bmUi;
  return current;
}
export function initBlackmarketModule(deps) { bindBlackmarketDeps(deps).mount(); }
export function disposeBlackmarketModule() { current.dispose(); }
export function bmSellables(...args) { return current.bmSellables(...args); }
export function clearBmPlanDrafts(...args) { return current.clearBmPlanDrafts(...args); }
export function bmFeatureGate(...args) { return current.bmFeatureGate(...args); }
export function guardBmFeature(...args) { return current.guardBmFeature(...args); }
export function syncBmFeatureChrome(...args) { return current.syncBmFeatureChrome(...args); }
export function bmStalls(...args) { return current.bmStalls(...args); }
export function bmPublishedStalls(...args) { return current.bmPublishedStalls(...args); }
export function bmMyStall(...args) { return current.bmMyStall(...args); }
export function bmStallInSetup(...args) { return current.bmStallInSetup(...args); }
export function bmSetupHint(...args) { return current.bmSetupHint(...args); }
export function bmStallById(...args) { return current.bmStallById(...args); }
export function bmClaimable(...args) { return current.bmClaimable(...args); }
export function bmPendingRatings(...args) { return current.bmPendingRatings(...args); }
export function bmPendingRatingLine(...args) { return current.bmPendingRatingLine(...args); }
export function bmPendingRatingsSummary(...args) { return current.bmPendingRatingsSummary(...args); }
export function bmServiceOrders(...args) { return current.bmServiceOrders(...args); }
export function bmAffordable(...args) { return current.bmAffordable(...args); }
export function starsHtml(...args) { return current.starsHtml(...args); }
export function satisfactionStars(...args) { return current.satisfactionStars(...args); }
export function bmRatingPublicHtml(...args) { return current.bmRatingPublicHtml(...args); }
export function bmRatingSortScore(...args) { return current.bmRatingSortScore(...args); }
export function typeLabel(...args) { return current.typeLabel(...args); }
export function openBmSetupModal(...args) { return current.openBmSetupModal(...args); }
export function guardBmPlazaLeave(...args) { return current.guardBmPlazaLeave(...args); }
export function renderBlackmarket(...args) { return current.renderBlackmarket(...args); }
export function syncBmPlazaChrome(...args) { return current.syncBmPlazaChrome(...args); }
export function openBmOpenModal(...args) { return current.openBmOpenModal(...args); }
export function syncBmOpenTypeHint(...args) { return current.syncBmOpenTypeHint(...args); }
export function confirmBmOpenStall(...args) { return current.confirmBmOpenStall(...args); }
export function openBmBuy(...args) { return current.openBmBuy(...args); }
export function openBmItemDetail(...args) { return current.openBmItemDetail(...args); }
export function confirmBmBuy(...args) { return current.confirmBmBuy(...args); }
export function openBmRatingModal(...args) { return current.openBmRatingModal(...args); }
export function openBmRatingForm(...args) { return current.openBmRatingForm(...args); }
export function closeBmModals(...args) { return current.closeBmModals(...args); }
export function openBmListModal(...args) { return current.openBmListModal(...args); }
export function confirmBmList(...args) { return current.confirmBmList(...args); }
export function toggleBmListItem(...args) { return current.toggleBmListItem(...args); }
export function finishGoodsList(...args) { return current.finishGoodsList(...args); }
export function requestBmWithdraw(...args) { return current.requestBmWithdraw(...args); }
export function confirmBmWithdraw(...args) { return current.confirmBmWithdraw(...args); }
export function openBmBlindStockModal(...args) { return current.openBmBlindStockModal(...args); }
export function openBmBlindManageModal(...args) { return current.openBmBlindManageModal(...args); }
export function closeBmBlindManageModal(...args) { return current.closeBmBlindManageModal(...args); }
export function confirmBmBlindStock(...args) { return current.confirmBmBlindStock(...args); }
export function confirmBmBlindStockPrice(...args) { return current.confirmBmBlindStockPrice(...args); }
export function confirmBmBlindManageMeta(...args) { return current.confirmBmBlindManageMeta(...args); }
export function confirmBmBlindMeta(...args) { return current.confirmBmBlindMeta(...args); }
export function applyBmBlindSuggestedPrice(...args) { return current.applyBmBlindSuggestedPrice(...args); }
export function reconcileBmBlindPlaceholderPrice(...args) { return current.reconcileBmBlindPlaceholderPrice(...args); }
export function bmBlindDisplayPrice(...args) { return current.bmBlindDisplayPrice(...args); }
export function openBmBlindDrawModal(...args) { return current.openBmBlindDrawModal(...args); }
export function settleBmBlindDraw(...args) { return current.settleBmBlindDraw(...args); }
export function finishBmBlindDrawUi(...args) { return current.finishBmBlindDrawUi(...args); }
export function resumeBmBlindDrawFromState(...args) { return current.resumeBmBlindDrawFromState(...args); }
export function openBmServiceOfferModal(...args) { return current.openBmServiceOfferModal(...args); }
export function openBmServiceInfoModal(...args) { return current.openBmServiceInfoModal(...args); }
export function confirmBmServiceOffer(...args) { return current.confirmBmServiceOffer(...args); }
export function openBmServiceProfileModal(...args) { return current.openBmServiceProfileModal(...args); }
export function confirmBmServiceProfile(...args) { return current.confirmBmServiceProfile(...args); }
export function openBmOrderServiceModal(...args) { return current.openBmOrderServiceModal(...args); }
export function confirmBmOrderService(...args) { return current.confirmBmOrderService(...args); }
export function promptBmEarlySubmit(...args) { return current.promptBmEarlySubmit(...args); }
