// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export const STALL_TYPES = legacyBlackmarketModule("helpers").STALL_TYPES;
export const ITEM_TYPES = legacyBlackmarketModule("helpers").ITEM_TYPES;
export const PLAN_LIST_TYPES = legacyBlackmarketModule("helpers").PLAN_LIST_TYPES;
export function clamp(...args) { return legacyBlackmarketModule("helpers").clamp(...args); }
export function blackMaskForPlayerId(...args) { return legacyBlackmarketModule("helpers").blackMaskForPlayerId(...args); }
export function findStallByOwner(...args) { return legacyBlackmarketModule("helpers").findStallByOwner(...args); }
export function findStallById(...args) { return legacyBlackmarketModule("helpers").findStallById(...args); }
export function stallDisplayName(...args) { return legacyBlackmarketModule("helpers").stallDisplayName(...args); }
export function pushPendingRatings(...args) { return legacyBlackmarketModule("helpers").pushPendingRatings(...args); }
export function pushSellerPayout(...args) { return legacyBlackmarketModule("helpers").pushSellerPayout(...args); }
export function paySellerNow(...args) { return legacyBlackmarketModule("helpers").paySellerNow(...args); }
export function removeStallFromState(...args) { return legacyBlackmarketModule("helpers").removeStallFromState(...args); }
export function closeGoodsStallIfEmpty(...args) { return legacyBlackmarketModule("helpers").closeGoodsStallIfEmpty(...args); }
export function returnItemToPlayer(...args) { return legacyBlackmarketModule("helpers").returnItemToPlayer(...args); }
export function buildLeftoverMaterial(...args) { return legacyBlackmarketModule("helpers").buildLeftoverMaterial(...args); }
export function takeBmListEntries(...args) { return legacyBlackmarketModule("helpers").takeBmListEntries(...args); }
export function rollbackBmTaken(...args) { return legacyBlackmarketModule("helpers").rollbackBmTaken(...args); }
export function desensitizePlayerName(...args) { return legacyBlackmarketModule("helpers").desensitizePlayerName(...args); }
export function findEscrowItemForOrder(...args) { return legacyBlackmarketModule("helpers").findEscrowItemForOrder(...args); }
export function attachEscrowItemToSeller(...args) { return legacyBlackmarketModule("helpers").attachEscrowItemToSeller(...args); }
export function removeEscrowItemFromSeller(...args) { return legacyBlackmarketModule("helpers").removeEscrowItemFromSeller(...args); }
export function returnHeldItemToBuyer(...args) { return legacyBlackmarketModule("helpers").returnHeldItemToBuyer(...args); }
export function returnEscrowItemToBuyer(...args) { return legacyBlackmarketModule("helpers").returnEscrowItemToBuyer(...args); }
export function itemMatchesAcceptScopes(...args) { return legacyBlackmarketModule("helpers").itemMatchesAcceptScopes(...args); }
export function publicInputItemRef(...args) { return legacyBlackmarketModule("helpers").publicInputItemRef(...args); }
export function publicCapabilitySnapshot(...args) { return legacyBlackmarketModule("helpers").publicCapabilitySnapshot(...args); }
export function blindLockedCount(...args) { return legacyBlackmarketModule("helpers").blindLockedCount(...args); }
export function syncBlindPause(...args) { return legacyBlackmarketModule("helpers").syncBlindPause(...args); }
export function stallTypeLabel(...args) { return legacyBlackmarketModule("helpers").stallTypeLabel(...args); }
export function stallReadyToPublish(...args) { return legacyBlackmarketModule("helpers").stallReadyToPublish(...args); }
export function averageBlindPoolRefPrice(...args) { return legacyBlackmarketModule("helpers").averageBlindPoolRefPrice(...args); }
export function tryActivateStall(...args) { return legacyBlackmarketModule("helpers").tryActivateStall(...args); }
export function releaseDepositSafe(...args) { return legacyBlackmarketModule("helpers").releaseDepositSafe(...args); }
