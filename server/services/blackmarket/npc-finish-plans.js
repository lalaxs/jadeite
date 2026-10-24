// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export function npcFinishStyle(...args) { return legacyBlackmarketModule("npc-finish-plans").npcFinishStyle(...args); }
export function npcFinishSignature(...args) { return legacyBlackmarketModule("npc-finish-plans").npcFinishSignature(...args); }
export function createNpcFinishPlan(...args) { return legacyBlackmarketModule("npc-finish-plans").createNpcFinishPlan(...args); }
export function applyNpcCraftScore(...args) { return legacyBlackmarketModule("npc-finish-plans").applyNpcCraftScore(...args); }
