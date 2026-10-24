// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export const NPC_JADE_KINDS = legacyBlackmarketModule("npc-catalog").NPC_JADE_KINDS;
export function npcRandom(...args) { return legacyBlackmarketModule("npc-catalog").npcRandom(...args); }
export function repriceNpcGoodsRow(...args) { return legacyBlackmarketModule("npc-catalog").repriceNpcGoodsRow(...args); }
export function createNpcGoodsRow(...args) { return legacyBlackmarketModule("npc-catalog").createNpcGoodsRow(...args); }
export function upgradeNpcOffcutRow(...args) { return legacyBlackmarketModule("npc-catalog").upgradeNpcOffcutRow(...args); }
