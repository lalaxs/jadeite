// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export { bindBlackmarketApi } from "./legacy.js";
export function bumpBmDeal(...args) { return legacyBlackmarketModule("context").bumpBmDeal(...args); }
export function requireApi(...args) { return legacyBlackmarketModule("context").requireApi(...args); }
export function denyUnlessBmBuy(...args) { return legacyBlackmarketModule("context").denyUnlessBmBuy(...args); }
export function denyUnlessBmStall(...args) { return legacyBlackmarketModule("context").denyUnlessBmStall(...args); }
