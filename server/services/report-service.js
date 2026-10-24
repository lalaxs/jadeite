/**
 * Player report summaries — inventory valuation for 经营账房.
 */
import { reportSummary } from "../../shared/domain/economy/jade-loop.js";
import { financeSnapshot } from "../../shared/domain/economy/finance-book.js";

export function createReportService(deps) {
  const { getState, stallInventoryItemsForPlayer } = deps;
  if (typeof getState !== "function") {
    throw new Error("report-service: getState is required");
  }
  if (typeof stallInventoryItemsForPlayer !== "function") {
    throw new Error("report-service: stallInventoryItemsForPlayer is required");
  }

  function inventoryForReport(player) {
    const state = getState();
    const activeProductionItems = [
      ...(player.jobs || []),
      ...(player.polishingJobs || [])
    ].map((job) => job?.item || job?.rough).filter(Boolean);
    const activeLivestreamRoomProducts = (player.livestreamRoom?.items || [])
      .map((item) => item?.product)
      .filter(Boolean);
    const ownedListings = state.listings
      .filter((listing) => listing.ownerId === player.id)
      .map((listing) => listing.item)
      .filter(Boolean);
    const ownedBlackListings = stallInventoryItemsForPlayer(state, player.id);
    return [
      ...(player.rough || []),
      ...activeProductionItems,
      ...(player.workshopDeliveries || []).flatMap((delivery) => [...delivery.items, ...delivery.auxiliaryItems]),
      ...(player.materials || []),
      ...(player.slices || []),
      ...(player.bracelets || []),
      ...activeLivestreamRoomProducts,
      ...ownedListings,
      ...ownedBlackListings
    ];
  }

  function playerReportSnapshot(player, now = Date.now()) {
    if (!player) return null;
    const ledger = Array.isArray(player.ledger) ? player.ledger : [];
    const inventory = inventoryForReport(player);
    const statusById = new Map();
    const mark = (items, status) => { for (const item of items || []) if (item?.id) statusById.set(item.id, status); };
    mark((player.jobs || []).map(job => job.item || job.rough), "processing");
    mark((player.polishingJobs || []).map(job => job.item || job.rough), "processing");
    mark((player.workshopDeliveries || []).flatMap(delivery => [...delivery.items, ...delivery.auxiliaryItems]), "delivery");
    mark((player.livestreamRoom?.items || []).map(row => row.product), "livestream");
    mark(getState().listings.filter(row => row.ownerId === player.id).map(row => row.item), "listed");
    mark(stallInventoryItemsForPlayer(getState(), player.id), "blackmarket");
    const offeredItems = (getState().wants || []).flatMap(want => (want.offers || [])
      .filter(offer => offer.sellerId === player.id).map(offer => offer.item)).filter(Boolean);
    mark(offeredItems, "want");
    mark(player.collection, "collection");
    const ownedServiceItems = [];
    for (const order of getState().blackServiceOrders || []) {
      if (order.buyerId !== player.id || ["completed", "cancelled", "refunded", "expired"].includes(order.status)) continue;
      if (order.heldItem?.item) ownedServiceItems.push(order.heldItem.item);
      const seller = getState().players?.get(order.sellerId);
      if (!seller) continue;
      for (const bucket of [seller.rough, seller.materials, seller.slices, seller.bracelets]) {
        for (const item of bucket || []) if (item.escrowOrderId === order.id) ownedServiceItems.push(item);
      }
      for (const job of seller.jobs || []) if (job.item?.escrowOrderId === order.id) ownedServiceItems.push(job.item);
      for (const delivery of seller.workshopDeliveries || []) {
        for (const item of delivery.items || []) if (item.escrowOrderId === order.id) ownedServiceItems.push(item);
      }
    }
    mark(ownedServiceItems, "processing");
    const resourceIds = new Set([...(player.workshop?.devices || []), ...(player.workshop?.workers || [])].map(item => item.id));
    return { ...reportSummary(ledger, inventory, now), finance: financeSnapshot(player,
      [...inventory, ...(player.collection || []), ...ownedServiceItems, ...offeredItems]
        .filter(item => !resourceIds.has(item.id) && !["equipment", "employee"].includes(item.type))
        .map(item => ({ item, status: statusById.get(item.id) || "inventory" })), now) };
  }

  function refreshPlayerReport(player, now = Date.now()) {
    const report = playerReportSnapshot(player, now);
    if (!report) return null;
    player.reports = [report];
    return player.reports[0];
  }

  return { inventoryForReport, playerReportSnapshot, refreshPlayerReport };
}
