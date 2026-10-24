import { recruitPrice } from "../economy/worker-economy.js";
import { equipmentRepairQuote } from "../economy/equipment-maintenance.js";
import { BLACKMARKET_MIN_PRICE } from "./bm-constants.js";

export const NPC_PRICING_VERSION = 1;

const ranges = (ordinary, discount) => Object.freeze({
  ordinary: Object.freeze(ordinary), discount: Object.freeze(discount)
});

// Equipment ratios include the full repair bill; other ratios apply to the item.
export const NPC_PRICE_RANGES = Object.freeze({
  stone: ranges([0.85, 0.92], [0.75, 0.82]),
  offcut: ranges([0.75, 0.85], [0.68, 0.75]),
  finished: ranges([0.85, 0.95], [0.75, 0.85]),
  traveler: ranges([0.95, 1], [0.90, 0.95]),
  employee: ranges([0.85, 0.92], [0.75, 0.80]),
  equipment: ranges([0.70, 0.75], [0.60, 0.65])
});

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

export function npcPriceReference(type, item = {}) {
  if (type === "employee") return recruitPrice(item.tier);
  if (type === "equipment") return amount(item.basePrice);
  // Offcut values already account for removed pieces and remaining usable jade.
  // Sealed stone prices never use trueValue or other unrevealed attributes.
  return amount(item.value ?? item.price);
}

export function quoteNpcGoods(role, type, item, { discount = false, roll = 0.5, referencePrice } = {}) {
  const range = NPC_PRICE_RANGES[role]?.[discount ? "discount" : "ordinary"];
  if (!range) throw new Error(`Unsupported NPC pricing role: ${role}`);
  const reference = referencePrice == null ? npcPriceReference(type, item) : amount(referencePrice);
  const sample = Number.isFinite(Number(roll)) ? Math.max(0, Math.min(1, Number(roll))) : 0.5;
  const ratio = range[0] + (range[1] - range[0]) * sample;
  const repairCost = type === "equipment" ? equipmentRepairQuote(item) : 0;
  const price = Math.max(BLACKMARKET_MIN_PRICE, Math.round(reference * ratio) - repairCost);
  const totalCost = price + repairCost;
  return { price, referencePrice: reference, totalCost, repairCost, savings: Math.max(0, reference - totalCost) };
}
