import { NPC_SCHEDULE_VERSION, npcRuleForStall, isNpcBlackStall } from "../../shared/domain/blackmarket/npc-rules.js";
import { normalizeNonNegativeInteger, normalizeNonNegativeNumber, normalizeOptionalTimestamp } from "./world-schema-utils.js";
import { MATERIAL_META } from "../services/materials-service.js";
import { equipmentCatalog } from "../systems/equipment-system.js";
import { isBlackmarketGoodsType } from "../../shared/domain/blackmarket/bm-constants.js";

// Read-only compatibility for old saves. Stock maintenance retires these
// merchants; they cannot be generated, published or traded by the live rules.
const RETIRED_NPC_RULES = { supplies: { discount: 1 }, equipment: { discount: 0 } };

export function validateNpcBlackStall(stall) {
  if (!stall.npc) return;
  const legacyRule = Object.hasOwn(RETIRED_NPC_RULES, stall.npcRole) ? RETIRED_NPC_RULES[stall.npcRole] : null;
  const legacyIdentity = legacyRule && stall.type === "goods" && stall.id === `bm-npc:${stall.npcRole}` && stall.ownerId === `npc:blackmarket:${stall.npcRole}`;
  if (!isNpcBlackStall(stall) && !legacyIdentity) throw new Error("world-store: invalid NPC black stall identity");
  const label = `NPC black stall ${stall.id}`;
  const rule = npcRuleForStall(stall) || legacyRule;
  for (const field of ["npcSequence", "npcBatch", "npcDiscountIssued", "npcPremiumIssued"]) {
    normalizeNonNegativeInteger(stall, field, label);
  }
  if (stall.npcDiscountIssued > rule.discount || stall.npcPremiumIssued > (rule.roaming ? 2 : 0)) {
    throw new Error(`world-store: ${label} exceeds batch supply budget`);
  }
  normalizeNonNegativeInteger(stall, "npcScheduleVersion", label, { optional: true });
  normalizeNonNegativeInteger(stall, "npcPricingVersion", label, { optional: true });
  for (const field of ["npcRotateAt", "npcShiftAt", "npcRefillAt", "npcMarketRefreshAt"]) normalizeOptionalTimestamp(stall, field, label);
  if (stall.npcScheduleVersion === NPC_SCHEDULE_VERSION && stall.npcRotateAt == null) {
    throw new Error(`world-store: ${label} is missing its rotation deadline`);
  }
  for (const row of stall.items || []) {
    normalizeNonNegativeInteger(row, "npcPricingVersion", label, { optional: true });
    normalizeOptionalTimestamp(row, "createdAt", label);
    normalizeNonNegativeNumber(row, "referencePrice", label);
    if (row.type !== row.item?.type || (!isBlackmarketGoodsType(row.type) && !["supply", "equipment"].includes(row.type))) {
      throw new Error(`world-store: ${label} has an invalid item type`);
    }
    if (row.type === "supply") {
      if (!MATERIAL_META[row.item.materialKey]) throw new Error(`world-store: ${label} has unknown supply material`);
      const quantity = normalizeNonNegativeInteger(row.item, "amount", label);
      if (quantity < 1) throw new Error(`world-store: ${label} has empty supply batch`);
    }
    if (row.type === "equipment") {
      const model = equipmentCatalog().find((entry) => entry.modelKey === row.item.modelKey);
      const condition = normalizeNonNegativeNumber(row.item, "condition", label);
      if (!model || condition > 100 || model.stage !== row.item.stage) throw new Error(`world-store: ${label} has invalid equipment`);
    }
  }
}
