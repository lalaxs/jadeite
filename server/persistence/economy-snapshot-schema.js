import { COMMISSION_OFFERS, MAX_COMMISSION_NET_PAY } from "../../shared/domain/economy/commission-rules.js";
import { requireCanonicalId, validateUniqueRecordIds, requireArrayField, normalizeNonNegativeInteger } from "./world-schema-utils.js";
import { validateFinanceBook } from "./finance-snapshot-schema.js";

export function validatePlayerEconomy(player, playerLabel) {
  validateFinanceBook(player, playerLabel);
  if (player.systemDemandBudget != null) {
    const budget = player.systemDemandBudget;
    const label = `${playerLabel}.systemDemandBudget`;
    if (typeof budget !== "object" || Array.isArray(budget)) throw new Error(`world-store: ${label} must be an object`);
    for (const field of ["version", "day", "cash", "count", "premiumCash", "rareCount"]) normalizeNonNegativeInteger(budget, field, label);
    if (budget.version !== 1) throw new Error(`world-store: ${label}.version is unsupported`);
    if (budget.bySource != null) {
      if (typeof budget.bySource !== "object" || Array.isArray(budget.bySource)) throw new Error(`world-store: ${label}.bySource must be an object`);
      for (const field of Object.keys(budget.bySource)) normalizeNonNegativeInteger(budget.bySource, field, `${label}.bySource`);
    }
  }
  if (player.commissions != null) {
    const record = player.commissions;
    const label = `${playerLabel}.commissions`;
    if (typeof record !== "object" || Array.isArray(record)) throw new Error(`world-store: ${label} must be an object`);
    for (const field of ["version", "completedCount", "totalEarned"]) normalizeNonNegativeInteger(record, field, label);
    if (record.version !== 1) throw new Error(`world-store: ${label}.version is unsupported`);
    const history = requireArrayField(record, "history", label);
    if (history.length > 12) throw new Error(`world-store: ${label}.history exceeds limit`);
    validateUniqueRecordIds(history, `${label}.history`);
    for (const row of history) {
      for (const field of ["amount", "grossPay", "stationFee", "consumables", "maintenanceFee", "completedAt"]) normalizeNonNegativeInteger(row, field, `${label}.history`);
      if (row.amount > MAX_COMMISSION_NET_PAY || !COMMISSION_OFFERS.some((offer) => offer.id === row.offerId)) throw new Error(`world-store: ${label}.history is invalid`);
    }
    if (record.active != null) {
      const active = record.active;
      if (typeof active !== "object" || Array.isArray(active)) throw new Error(`world-store: ${label}.active must be an object`);
      requireCanonicalId(active.id, `${label}.active.id`);
      if (!COMMISSION_OFFERS.some((offer) => offer.id === active.offerId)) throw new Error(`world-store: ${label}.active.offerId is invalid`);
      for (const field of ["startedAt", "readyAt", "grossPay", "stationFee", "consumables", "maintenanceFee", "netPay"]) normalizeNonNegativeInteger(active, field, `${label}.active`);
      if (active.readyAt <= active.startedAt || active.readyAt - active.startedAt > 12 * 60_000
        || active.netPay <= 0 || active.netPay > MAX_COMMISSION_NET_PAY
        || active.netPay !== active.grossPay - active.stationFee - active.consumables - active.maintenanceFee) {
        throw new Error(`world-store: ${label}.active has invalid timer or payment`);
      }
      for (const field of ["deviceIds", "ownedStages"]) {
        const values = requireArrayField(active, field, `${label}.active`);
        if (values.length > 3 || new Set(values).size !== values.length || values.some((value) => typeof value !== "string" || !value)) {
          throw new Error(`world-store: ${label}.active.${field} is invalid`);
        }
      }
      if (active.ownedStages.some((stage) => !["opening", "carving", "finishing"].includes(stage))) throw new Error(`world-store: ${label}.active.ownedStages is invalid`);
    }
  }
}
