export const INVENTORY_RECYCLE_RATE = 0.20;
export const INVENTORY_RECYCLE_PERCENT = Math.round(INVENTORY_RECYCLE_RATE * 100);

export function inventoryRecyclePayout(value) {
  const normalized = Math.max(0, Math.floor(Number(value) || 0));
  if (normalized <= 0) return 0;
  return Math.max(1, Math.floor(normalized * INVENTORY_RECYCLE_RATE));
}
