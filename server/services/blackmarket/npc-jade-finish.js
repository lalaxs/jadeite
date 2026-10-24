// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export function completeNpcJadeAppearance(...args) { return legacyBlackmarketModule("npc-jade-finish").completeNpcJadeAppearance(...args); }
export function repairPurchasedNpcJade(...args) { return legacyBlackmarketModule("npc-jade-finish").repairPurchasedNpcJade(...args); }
