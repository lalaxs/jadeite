// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export const NPC_OFFCUT_POLICY_VERSION = legacyBlackmarketModule("npc-offcut").NPC_OFFCUT_POLICY_VERSION;
export function createNpcOffcut(...args) { return legacyBlackmarketModule("npc-offcut").createNpcOffcut(...args); }
