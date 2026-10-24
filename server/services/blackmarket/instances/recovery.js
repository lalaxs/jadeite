// Instance-owned implementation; legacy entry points remain one directory above.
import { isNpcBlackStall } from "../../../../shared/domain/blackmarket/npc-rules.js";
import { refundFinanceItemCost } from "../../../../shared/domain/economy/finance-book.js";

export function createRecovery({
  requireApi,
  reconcileResourceListings,
  findEscrowItemForOrder,
  paySellerNow,
  releaseDepositSafe,
  removeEscrowItemFromSeller,
  removeStallFromState,
  returnHeldItemToBuyer
}) {
const RECOVERABLE_ORDER_STATUSES = new Set(["pending", "escrow", "delivered"]);

const INVENTORY_BUCKETS = ["rough", "materials", "slices", "bracelets"];

function playerHasItem(player, itemId) {
  const id = String(itemId || "");
  if (!player || !id) return false;
  return INVENTORY_BUCKETS.some((bucket) =>
    (player[bucket] || []).some((item) => String(item?.id || "") === id)
  );
}

function recoverLegacyBlackListings(state, summary) {
  const legacyListings = state.blackListings;
  if (!Array.isArray(legacyListings) || legacyListings.length === 0) return;
  const { addItem } = requireApi();

  for (const listing of legacyListings) {
    summary.legacyListings += 1;
    const owner = listing?.ownerId ? state.players?.get?.(listing.ownerId) : null;
    const item = listing?.item;
    if (!owner || !item?.id) {
      summary.discardedLegacyListings += 1;
      continue;
    }
    if (!playerHasItem(owner, item.id)) {
      addItem(owner, item, { type: listing.type || item.type, asNew: false });
    }
    if (playerHasItem(owner, item.id)) {
      summary.recoveredLegacyItems += 1;
    } else {
      summary.discardedLegacyListings += 1;
    }
  }

  legacyListings.length = 0;
  summary.changed = true;
}

function outstandingOrderFee(order) {
  const price = Math.max(0, Number(order?.price) || 0);
  const released = Math.max(0, Number(order?.feeReleased) || 0);
  const refunded = Math.max(0, Number(order?.feeRefunded) || 0);
  return Math.max(0, price - released - refunded);
}

function refundOutstandingOrderFee(order, buyer) {
  const amount = outstandingOrderFee(order);
  if (!buyer || amount <= 0) return 0;
  const refunded = releaseDepositSafe(
    buyer,
    amount,
    `黑市服务存档恢复退款：${order.title || "技术单"}`,
    { source: "blackmarket-service-recovery" }
  );
  order.feeRefunded = Math.max(0, Number(order.feeRefunded) || 0) + refunded;
  if (refunded > 0 && order.financeFeeBookedAt && !order.financeFeeRefundedAt) {
    const state = requireApi().getState();
    const items = [
      ...INVENTORY_BUCKETS.flatMap(bucket => buyer[bucket] || []), ...(buyer.collection || []),
      ...(buyer.jobs || []).map(job => job.item || job.rough),
      ...(buyer.polishingJobs || []).map(job => job.item || job.rough),
      ...(buyer.workshopDeliveries || []).flatMap(delivery => [...delivery.items, ...delivery.auxiliaryItems]),
      ...(buyer.livestreamRoom?.items || []).map(row => row.product),
      ...(state.listings || []).filter(row => row.ownerId === buyer.id).map(row => row.item),
      ...(state.wants || []).flatMap(want => (want.offers || []).filter(row => row.sellerId === buyer.id).map(row => row.item)),
      ...(state.blackStalls || []).filter(stall => stall.ownerId === buyer.id)
        .flatMap(stall => [...(stall.items || []), ...(stall.pool || []), ...(stall.blindDraw?.candidates || [])].map(row => row.item))
    ].filter(Boolean);
    refundFinanceItemCost(buyer, { id: `service:${order.id}`, feeKey: order.id,
      batchId: order.financeFeeBatchId, amount: Math.min(refunded, order.financeFeeBookedAmount || order.price), items });
    order.financeFeeRefundedAt = Date.now();
  }
  return refunded;
}

function payOutstandingOrderFee(order, seller) {
  const amount = outstandingOrderFee(order);
  if (!seller || amount <= 0) return 0;
  const released = paySellerNow(
    seller,
    amount,
    `服务存档恢复·${order.title || "技术单"}`,
    { source: "blackmarket-service-recovery-payout" }
  );
  order.feeReleased = Math.max(0, Number(order.feeReleased) || 0) + released;
  return released;
}

function discardEscrowItem(order, seller) {
  if (!seller) return false;
  const row = findEscrowItemForOrder(seller, order.id);
  if (!row) return false;
  if (row.inDelivery) {
    let pending = row;
    while (pending?.inDelivery) {
      if (!removeEscrowItemFromSeller(seller, pending.type, pending.item)) break;
      pending = findEscrowItemForOrder(seller, order.id);
    }
    return true;
  }
  if (row.inJob && row.job) {
    const jobs = seller.jobs || [];
    const index = jobs.findIndex((job) => job === row.job || job?.id === row.job?.id);
    if (index < 0) return false;
    jobs.splice(index, 1);
    return true;
  }
  return Boolean(removeEscrowItemFromSeller(seller, row.type, row.item));
}

function recoverOrphanServiceOrder(order, state, now, summary) {
  if (!RECOVERABLE_ORDER_STATUSES.has(order?.status)) return false;
  const buyer = state.players?.get?.(order.buyerId);
  const seller = state.players?.get?.(order.sellerId);
  if (buyer && seller) return false;

  if (order.status === "delivered" && !buyer && seller) {
    summary.releasedFees += payOutstandingOrderFee(order, seller);
    order.status = "completed";
    order.completedAt = now;
    order.submitMode = "recovered_missing_buyer";
  } else {
    let itemRecovered = false;
    if (buyer && order.heldItem?.item) {
      itemRecovered = returnHeldItemToBuyer(order, state);
    } else if (!buyer && seller && order.status === "escrow") {
      if (discardEscrowItem(order, seller)) summary.discardedItems += 1;
    }
    if (buyer) {
      summary.refundedFees += refundOutstandingOrderFee(order, buyer);
      if (!itemRecovered && order.status !== "delivered") summary.unrecoverableItems += 1;
    }
    if (!buyer) order.heldItem = null;
    order.status = buyer && order.status === "delivered" ? "refunded" : "cancelled";
    order.cancelledAt = now;
    order.submitMode = !buyer && !seller
      ? "recovered_missing_parties"
      : !buyer
        ? "recovered_missing_buyer"
        : "recovered_missing_seller";
  }

  summary.orphanOrders += 1;
  return true;
}

function recoverOrphanBlindDraw(stall, state, summary) {
  const draw = stall?.blindDraw;
  if (!draw) return;
  const buyer = state.players?.get?.(draw.buyerId);
  if (!buyer) return;

  const first = (draw.candidates || []).find((row) => row?.item);
  if (first) {
    const { addItem } = requireApi();
    if (!first.item.type && first.type) first.item.type = first.type;
    addItem(buyer, first.item, { type: first.type || first.item.type, asNew: true,
      acquisitionCost: draw.entryPaid === false ? 0 : Math.max(0, Number(draw.price) || 0) });
    summary.recoveredBlindItems += 1;
    return;
  }

  if (draw.entryPaid !== false) {
    summary.refundedBlindFees += releaseDepositSafe(
      buyer,
      Math.max(0, Number(draw.price) || 0),
      `黑市盲盒存档恢复退款：${stall.title || "盲盒"}`,
      { source: "blackmarket-blind-recovery" }
    );
  }
}

function reconcileBlackmarketReferences(state, now = Date.now()) {
  const summary = {
    changed: false,
    orphanStalls: 0,
    orphanOrders: 0,
    refundedFees: 0,
    releasedFees: 0,
    recoveredBlindItems: 0,
    refundedBlindFees: 0,
    discardedItems: 0,
    unrecoverableItems: 0,
    legacyListings: 0,
    recoveredLegacyItems: 0,
    discardedLegacyListings: 0
  };

  recoverLegacyBlackListings(state, summary);

  for (const order of state.blackServiceOrders || []) {
    if (recoverOrphanServiceOrder(order, state, now, summary)) summary.changed = true;
  }

  for (const stall of [...(state.blackStalls || [])]) {
    if (isNpcBlackStall(stall)) continue;
    if (state.players?.has?.(stall.ownerId)) continue;
    recoverOrphanBlindDraw(stall, state, summary);
    if (removeStallFromState(state, stall)) {
      summary.orphanStalls += 1;
      summary.changed = true;
    }
  }

  if (reconcileResourceListings(state)) summary.changed = true;
  return summary;
}

  return {
    reconcileBlackmarketReferences
  };
}
