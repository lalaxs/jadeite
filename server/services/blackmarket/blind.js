// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export function resolvedBlindStallPrice(...args) { return legacyBlackmarketModule("blind").resolvedBlindStallPrice(...args); }
export function ensureBlindStallResolvedPrice(...args) { return legacyBlackmarketModule("blind").ensureBlindStallResolvedPrice(...args); }
export function addBlindboxItemsForPlayer(...args) { return legacyBlackmarketModule("blind").addBlindboxItemsForPlayer(...args); }
export function withdrawBlindboxItemForPlayer(...args) { return legacyBlackmarketModule("blind").withdrawBlindboxItemForPlayer(...args); }
export function publicBlindDrawSession(...args) { return legacyBlackmarketModule("blind").publicBlindDrawSession(...args); }
export function startBlindboxDrawForPlayer(...args) { return legacyBlackmarketModule("blind").startBlindboxDrawForPlayer(...args); }
export function settleBlindboxDrawForPlayer(...args) { return legacyBlackmarketModule("blind").settleBlindboxDrawForPlayer(...args); }
export function processExpiredBlindDraws(...args) { return legacyBlackmarketModule("blind").processExpiredBlindDraws(...args); }
export function buyBlindboxFromStallForPlayer(...args) { return legacyBlackmarketModule("blind").buyBlindboxFromStallForPlayer(...args); }
