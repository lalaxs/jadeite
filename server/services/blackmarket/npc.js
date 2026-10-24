// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export const isNpcBlackStall = legacyBlackmarketModule("npc").isNpcBlackStall;
export function maintainNpcBlackmarket(...args) { return legacyBlackmarketModule("npc").maintainNpcBlackmarket(...args); }
export function buyNpcBlackmarketGoods(...args) { return legacyBlackmarketModule("npc").buyNpcBlackmarketGoods(...args); }
