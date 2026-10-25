import { itemCost } from "../economy/item-cost.js";

export function openingResult(item) {
  const cost = itemCost(item);
  const value = Math.max(0, Math.round(Number(item?.value ?? item?.price) || 0));
  if (!cost.complete) return { title: "开料揭晓", tone: "neutral", value, cost: null, difference: null };
  const difference = value - cost.amount;
  return { title: cost.amount === 0 ? "赠料揭晓" : difference > 0 ? "切涨了！" : difference < 0 ? "切垮了" : "切平了",
    tone: cost.amount === 0 ? "neutral" : difference > 0 ? "profit" : difference < 0 ? "loss" : "neutral",
    value, cost: cost.amount, difference };
}
