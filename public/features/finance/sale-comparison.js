import { itemCost } from "../../../shared/domain/economy/item-cost.js";
import { evaluateOrderFit, estimateOrderSettlement } from "../../../shared/domain/jade/jade-rules.js";
import { orderPayoutCap } from "../../../shared/domain/economy/new-player-economy.js";
import { quoteSystemDemand, systemSalePriceCap } from "../../../shared/domain/economy/system-demand.js";
import { inventoryRecyclePayout } from "../../../shared/domain/economy/inventory-recycle.js";
import { MARKET_LISTING_MIN_PRICE, MARKET_LISTING_PER_PLAYER_CAP, MARKET_LISTING_GLOBAL_CAP } from "../../../shared/domain/economy/market-rules.js";
import { previewIncomeCash } from "../../../shared/domain/economy/finance-book.js";

const amount = (value) => Math.max(0, Math.round(Number(value) || 0));

function saleResult(player, product, revenue, source) {
  const cost = itemCost(product);
  const cash = previewIncomeCash(player, revenue, { source });
  return {
    revenue,
    soldCost: cost.complete ? cost.amount : null,
    grossProfit: cost.complete ? revenue - cost.amount : null,
    cash
  };
}

/** Read-only comparison. Targets never become orders or sale instructions. */
export function buildSaleComparison(state, product, { targetPrice, now = Date.now() } = {}) {
  const player = state?.me || {};
  const value = amount(product?.value ?? product?.price);
  const requested = targetPrice == null ? value : Number(targetPrice);
  const targetValid = Number.isFinite(requested) && requested > 0 && Number.isSafeInteger(Math.round(requested));
  const target = targetValid ? Math.round(requested) : 0;
  const held = (player.bracelets || []).some((item) => String(item.id) === String(product?.id));
  const finished = (product?.materialStage || product?.stage || (product?.type === "bracelet" ? "finished" : "")) === "finished";
  const owned = held && !product?.escrowOrderId && !product?._planned;
  const block = !finished ? "仅最终成品可比较销售渠道。" : !owned ? "此件不在可出售库存中，请先到原渠道处理占用。" : "";
  const rows = [];
  const rank = { full: 0, partial: 1, hard_fail: 2 };
  const orders = (player.orders || []).map((order) => ({ order, fit: evaluateOrderFit(product, order) }))
    .filter(({ fit }) => fit.tier !== "hard_fail" && !fit.rejected)
    .sort((a, b) => (rank[a.fit.tier] - rank[b.fit.tier]) || amount(b.order.pay) - amount(a.order.pay));

  for (const { order, fit } of orders.slice(0, 4)) {
    const quantity = Math.max(1, Math.floor(Number(order.quantity) || 1));
    const late = Number(order.expiresAt || 0) > 0 && now > Number(order.expiresAt);
    const estimate = estimateOrderSettlement(fit, order);
    if (quantity > 1) {
      rows.push({ id: `order:${order.id}`, channel: `订单 · ${order.client || "客人"}`, kind: "bundle", available: !block,
        bundlePay: amount(order.pay), quantity, label: "整单报价", note: `需要 ${quantity} 件；整单报价不能当成本件收入。请到订单选齐后查看结算。`, destination: "orders" });
      continue;
    }
    const basePay = Math.min(Number(order.pay || 0), orderPayoutCap([product]), systemSalePriceCap(player, [product]));
    const revenue = amount(basePay * estimate.payMult * (late ? 0.72 : 1));
    const demand = quoteSystemDemand(player, [product], revenue, now, { exempt: order.starterOrder === true });
    rows.push({ id: `order:${order.id}`, channel: `订单 · ${order.client || "客人"}`, kind: "quote", label: "当前结算预估",
      available: !block && demand.ok, ...saleResult(player, product, revenue, "order"), destination: "orders",
      note: block || (!demand.ok ? demand.message : `${estimate.label}${late ? "，已计逾期七二折" : ""}；不含随机小费${fit.tier === "partial" || late ? "，可能影响客户评价" : ""}。`) });
  }
  if (!orders.length) rows.push({ id: "orders", channel: "订单", kind: "unavailable", available: false,
    note: "当前没有接受此件的订单；刷新订单会另外收费。", destination: "orders" });

  const demand = targetValid ? quoteSystemDemand(player, [product], target, now) : null;
  rows.push({ id: "livestream", channel: "直播", kind: "target", label: "目标价成交时", available: !block && targetValid,
    ...(targetValid ? saleResult(player, product, target, "livestream") : {}), destination: "livestream",
    note: block || (!targetValid ? "请输入有效目标售价。" : `${demand?.ok ? "系统客户额度允许当前报价" : demand?.message || "仅等待玩家购买"}；仍需上播并等待买家，成交与耗时不保证。`) });
  const listings = (state?.listings || []).filter((row) => row.ownerId === player.id);
  const listBlock = target < MARKET_LISTING_MIN_PRICE ? `挂牌价至少 ${MARKET_LISTING_MIN_PRICE} 元。`
    : listings.length >= MARKET_LISTING_PER_PLAYER_CAP ? "挂牌栏位已满，请先处理现有挂单。"
      : (state?.listings || []).length >= MARKET_LISTING_GLOBAL_CAP ? "交易行当前挂牌已满，请稍后再试。" : "";
  rows.push({ id: "market", channel: "交易行挂牌", kind: "target", label: "目标价成交时", available: !block && targetValid && !listBlock,
    ...(targetValid ? saleResult(player, product, target, "market-payout") : {}), destination: "market",
    note: block || listBlock || "需等待玩家购买；2%市场税由买家承担。成交后按实际渠道入账；已有待领取货款须领取后才增加可用现金。" });

  const listing = listings.find((row) => String(row.item?.id) === String(product?.id));
  rows.push(listing?.npcOffer ? {
    id: "wholesale", channel: "限额批发", kind: "quote", label: "现有批发报价", available: true,
    ...saleResult(player, product, amount(listing.npcOffer.amount), "market-payout"), listingId: listing.id,
    note: "已有报价；请到交易行确认，成交资格与每日额度以确认时为准。"
  } : { id: "wholesale", channel: "限额批发", kind: "unavailable", available: false, destination: "market",
    note: "当前没有实际报价。成品挂牌一段时间后，批发商可能在每日额度内报价；不能按估值直接成交。" });
  const recycle = inventoryRecyclePayout(value);
  rows.push({ id: "recycle", channel: "立即回收", kind: "quote", label: "当前回收价", available: !block && recycle > 0,
    ...saleResult(player, product, recycle, "inventory-recycle"), note: block || "按参考估值20%急售；确认后移除物品，无法恢复。", action: "recycleInventoryItem" });
  return { productId: String(product?.id || ""), name: product?.name || "成品", value, target, targetValid,
    cost: itemCost(product), rows, block };
}
