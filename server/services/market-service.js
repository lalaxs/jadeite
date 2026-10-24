// Legacy named API. Production wiring uses a separately created instance.
import { createMarketModule, createMarketService } from "./market-instance.js";
import { settlePlayerAchievements } from "./achievement-rewards.js";
export { createMarketService };
let api = null;
const current = createMarketModule(() => api, settlePlayerAchievements);
export function bindMarketApi(nextApi) { api = nextApi; }
export const MARKET_TAX = current.MARKET_TAX;
export const MARKET_TAX_PERCENT = current.MARKET_TAX_PERCENT;
export const MARKET_LISTING_MIN_PRICE = current.MARKET_LISTING_MIN_PRICE;
export const MARKET_LISTING_PER_PLAYER_CAP = current.MARKET_LISTING_PER_PLAYER_CAP;
export const MARKET_LISTING_GLOBAL_CAP = current.MARKET_LISTING_GLOBAL_CAP;
export const WANT_PER_PLAYER_CAP = current.WANT_PER_PLAYER_CAP;
export const WANT_GLOBAL_CAP = current.WANT_GLOBAL_CAP;
export const WANT_OFFERS_CAP = current.WANT_OFFERS_CAP;
export { wantBucketName } from "./market-instance.js";
export function restoreWantOfferItem(...args) { return current.restoreWantOfferItem(...args); }
export function refundWantOffers(...args) { return current.refundWantOffers(...args); }
export function sortWantOffers(...args) { return current.sortWantOffers(...args); }
export function removeWantById(...args) { return current.removeWantById(...args); }
export function wantEscrowAmountForBudget(...args) { return current.wantEscrowAmountForBudget(...args); }
export function releaseWantEscrow(...args) { return current.releaseWantEscrow(...args); }
export function payWantFromEscrow(...args) { return current.payWantFromEscrow(...args); }
export function settleWantInternal(...args) { return current.settleWantInternal(...args); }
export function processExpiredWants(...args) { return current.processExpiredWants(...args); }
export function reconcileMarketReferences(...args) { return current.reconcileMarketReferences(...args); }
export function listItemForPlayer(...args) { return current.listItemForPlayer(...args); }
export function buyListingForPlayer(...args) { return current.buyListingForPlayer(...args); }
export function withdrawListingForPlayer(...args) { return current.withdrawListingForPlayer(...args); }
export function acceptMarketOfferForPlayer(...args) { return current.acceptMarketOfferForPlayer(...args); }
export function collectMarketPayoutForPlayer(...args) { return current.collectMarketPayoutForPlayer(...args); }
export function postWantForPlayer(...args) { return current.postWantForPlayer(...args); }
export function cancelWantForPlayer(...args) { return current.cancelWantForPlayer(...args); }
export function applyWantForPlayer(...args) { return current.applyWantForPlayer(...args); }
export function withdrawWantOfferForPlayer(...args) { return current.withdrawWantOfferForPlayer(...args); }
export function settleWantForPlayer(...args) { return current.settleWantForPlayer(...args); }
