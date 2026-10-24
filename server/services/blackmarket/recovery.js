// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export function reconcileBlackmarketReferences(...args) { return legacyBlackmarketModule("recovery").reconcileBlackmarketReferences(...args); }
