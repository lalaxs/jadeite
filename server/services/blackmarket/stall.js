// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export function stallSummary(...args) { return legacyBlackmarketModule("stall").stallSummary(...args); }
export function publicBlackStall(...args) { return legacyBlackmarketModule("stall").publicBlackStall(...args); }
export function publicBlackListing(...args) { return legacyBlackmarketModule("stall").publicBlackListing(...args); }
export function signedStallListings(...args) { return legacyBlackmarketModule("stall").signedStallListings(...args); }
export function sweepEmptyBlackGoodsStalls(...args) { return legacyBlackmarketModule("stall").sweepEmptyBlackGoodsStalls(...args); }
export function openBlackStallForPlayer(...args) { return legacyBlackmarketModule("stall").openBlackStallForPlayer(...args); }
export function closeBlackStallForPlayer(...args) { return legacyBlackmarketModule("stall").closeBlackStallForPlayer(...args); }
export function setBlackStallPausedForPlayer(...args) { return legacyBlackmarketModule("stall").setBlackStallPausedForPlayer(...args); }
export function updateBlackStallMetaForPlayer(...args) { return legacyBlackmarketModule("stall").updateBlackStallMetaForPlayer(...args); }
export function addGoodsToStallForPlayer(...args) { return legacyBlackmarketModule("stall").addGoodsToStallForPlayer(...args); }
export function withdrawGoodsFromStallForPlayer(...args) { return legacyBlackmarketModule("stall").withdrawGoodsFromStallForPlayer(...args); }
export function addGoodsBatchToStallForPlayer(...args) { return legacyBlackmarketModule("stall").addGoodsBatchToStallForPlayer(...args); }
export function buyGoodsFromStallForPlayer(...args) { return legacyBlackmarketModule("stall").buyGoodsFromStallForPlayer(...args); }
export function stallInventoryItemsForPlayer(...args) { return legacyBlackmarketModule("stall").stallInventoryItemsForPlayer(...args); }
export function listBlackItemForPlayer(...args) { return legacyBlackmarketModule("stall").listBlackItemForPlayer(...args); }
export function buyBlackListingForPlayer(...args) { return legacyBlackmarketModule("stall").buyBlackListingForPlayer(...args); }
export function withdrawBlackListingForPlayer(...args) { return legacyBlackmarketModule("stall").withdrawBlackListingForPlayer(...args); }
