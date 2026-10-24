// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export function ownedResource(...args) { return legacyBlackmarketModule("resources").ownedResource(...args); }
export function lockResource(...args) { return legacyBlackmarketModule("resources").lockResource(...args); }
export function unlockResource(...args) { return legacyBlackmarketModule("resources").unlockResource(...args); }
export function resourceBuyerBlock(...args) { return legacyBlackmarketModule("resources").resourceBuyerBlock(...args); }
export function receiveResource(...args) { return legacyBlackmarketModule("resources").receiveResource(...args); }
export function releaseSoldResource(...args) { return legacyBlackmarketModule("resources").releaseSoldResource(...args); }
export function reconcileResourceListings(...args) { return legacyBlackmarketModule("resources").reconcileResourceListings(...args); }
