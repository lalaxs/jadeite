// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export const BM_RATING_MIN_SAMPLES = legacyBlackmarketModule("rating").BM_RATING_MIN_SAMPLES;
export const SATISFACTION_BASELINE = legacyBlackmarketModule("rating").SATISFACTION_BASELINE;
export function ownerRawSatisfaction(...args) { return legacyBlackmarketModule("rating").ownerRawSatisfaction(...args); }
export function ownerPublicSatisfaction(...args) { return legacyBlackmarketModule("rating").ownerPublicSatisfaction(...args); }
export function bmRatingSampleCountForPlayer(...args) { return legacyBlackmarketModule("rating").bmRatingSampleCountForPlayer(...args); }
export function buildRatingDisplay(...args) { return legacyBlackmarketModule("rating").buildRatingDisplay(...args); }
export function submitBlackmarketRatingForPlayer(...args) { return legacyBlackmarketModule("rating").submitBlackmarketRatingForPlayer(...args); }
export function collectBlackmarketPayoutForPlayer(...args) { return legacyBlackmarketModule("rating").collectBlackmarketPayoutForPlayer(...args); }
