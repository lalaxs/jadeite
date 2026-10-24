/**
 * Offline event queue + reconnect settlement. Salary is handled separately at login.
 * Early helpers (queue/consume) wire before auction; settlement wires after workshop.
 */
import { makeOfflineSummary } from "../../shared/domain/economy/jade-loop.js";

export function createOfflineHelpers(deps) {
  const { money, isPlayerOnline } = deps;
  if (typeof money !== "function") throw new Error("offline-service: money is required");
  if (typeof isPlayerOnline !== "function") throw new Error("offline-service: isPlayerOnline is required");

  function queueOfflineEvent(player, event) {
    if (!player || isPlayerOnline(player)) return;
    player.pendingOfflineEvents ||= [];
    player.pendingOfflineEvents.push({
      type: event.type || "system",
      text: String(event.text || ""),
      income: money(event.income),
      expense: money(event.expense),
      readyAt: Number(event.readyAt || Date.now())
    });
    player.pendingOfflineEvents = player.pendingOfflineEvents.slice(-40);
  }

  function consumePendingOfflineEvents(player, offlineSince, now) {
    player.pendingOfflineEvents ||= [];
    const consumed = [];
    const future = [];
    for (const event of player.pendingOfflineEvents) {
      const readyAt = Number(event.readyAt || 0);
      if (readyAt > offlineSince && readyAt <= now) {
        consumed.push(event);
      } else if (readyAt > now) {
        future.push(event);
      }
    }
    player.pendingOfflineEvents = future;
    return consumed;
  }

  return { queueOfflineEvent, consumePendingOfflineEvents };
}

export function createOfflineSettlement(deps) {
  const {
    normalizePlayer,
    consumePendingOfflineEvents,
    auctionEndsAt,
    settleAuctionIfDue,
    settleProductionJobsForPlayer,
    refillOrders,
    refreshPlayerReport,
    getState
  } = deps;

  function settleOfflinePlayer(player, now = Date.now()) {
    const state = getState();
    normalizePlayer(player);
    const offlineSince = player.lastSeenAt || now;
    const events = [];
    if ([state.auction, ...Object.values(state.auctionRounds || {})].some((round) => round && !round.settledAt && now >= auctionEndsAt(round))) {
      settleAuctionIfDue(now);
    }
    events.push(...consumePendingOfflineEvents(player, offlineSince, now));
    const productionEvents = settleProductionJobsForPlayer(player, now);
    for (const event of productionEvents) {
      if (event.readyAt > offlineSince && event.readyAt <= now) {
        events.push({ type: "production", text: event.text, income: 0, expense: 0 });
      }
    }
    player.orders = player.orders.filter((order) => order.expiresAt > now);
    refillOrders(player);
    player.offlineSummary = events.length ? makeOfflineSummary(events) : null;
    player.lastSeenAt = now;
    player.lastRepDecayAt = now;
    refreshPlayerReport(player, now);
    return events;
  }

  return { settleOfflinePlayer };
}
