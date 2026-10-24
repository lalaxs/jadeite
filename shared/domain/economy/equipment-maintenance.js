export const EQUIPMENT_REPAIR_RATES = Object.freeze({
  1: 0.25,
  2: 0.20,
  3: 0.15
});

export function equipmentRepairRate(device) {
  const techLevel = Math.max(1, Math.min(3, Math.round(Number(device?.techLevel) || 1)));
  return EQUIPMENT_REPAIR_RATES[techLevel];
}

export function equipmentRepairQuote(device) {
  const condition = Math.max(0, Math.min(100, Number(device?.condition ?? 100)));
  const missing = 100 - condition;
  return Math.ceil(Number(device?.basePrice || 0) * (missing / 100) * equipmentRepairRate(device));
}
