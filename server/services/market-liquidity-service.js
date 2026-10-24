/**
 * Limited NPC liquidity for finished products, plus a low-population stock backstop.
 *
 * Finished products remain eligible with more players online. An NPC wholesaler
 * quotes a small number of stale listings within each seller's daily budget.
 * The offer is capped by both the listing
 * price and a conservative fraction of intrinsic value, so this is a liquidity
 * floor rather than a profitable price oracle.
 */
import { economyDayKey } from "../../shared/domain/economy/new-player-economy.js";

export const MARKET_LIQUIDITY_MAX_ONLINE = 2;
export const MARKET_LIQUIDITY_STALE_MS = 10 * 60 * 1000;
export const MARKET_LIQUIDITY_VALUE_RATE = 0.65;
export const MARKET_LIQUIDITY_MAX_PURCHASES = 2;
export const MARKET_LIQUIDITY_DAILY_CASH_CAP = 6_000;
export const MARKET_LIQUIDITY_DAILY_COUNT_CAP = 4;

export function remainingMarketLiquidity(player, now = Date.now()) {
  const budget = player?.marketLiquidityBudget?.day === economyDayKey(now) ? player.marketLiquidityBudget : {};
  return {
    cash: Math.max(0, MARKET_LIQUIDITY_DAILY_CASH_CAP - Number(budget.cash || 0)),
    count: Math.max(0, MARKET_LIQUIDITY_DAILY_COUNT_CAP - Number(budget.count || 0))
  };
}

export function bookMarketLiquidity(player, amount, now = Date.now()) {
  if (player.marketLiquidityBudget?.day !== economyDayKey(now)) {
    player.marketLiquidityBudget = { day: economyDayKey(now), cash: 0, count: 0 };
  }
  player.marketLiquidityBudget.cash = Math.max(0, Number(player.marketLiquidityBudget.cash) || 0) + amount;
  player.marketLiquidityBudget.count = Math.max(0, Number(player.marketLiquidityBudget.count) || 0) + 1;
}

export function uniqueOnlinePlayerCount(state) {
  return new Set([...(state?.sockets?.values?.() || [])].map(String)).size;
}

export function marketMakerOffer(listing, deps = {}) {
  if (listing?.type === "equipment") return 0;
  const asMoney = typeof deps.money === "function"
    ? deps.money
    : (value) => Math.max(0, Math.round(Number(value) || 0));
  const valueOf = typeof deps.itemValue === "function"
    ? deps.itemValue
    : (item) => Number(item?.value || item?.price || 0);
  const listPrice = asMoney(listing?.price);
  const referenceValue = asMoney(valueOf(listing?.item));
  if (listPrice < 100 || referenceValue <= 0) return 0;
  return Math.min(listPrice, asMoney(referenceValue * MARKET_LIQUIDITY_VALUE_RATE));
}

export function createMarketLiquidityService({
  getState,
  money,
  itemValue,
  randomUUID,
  addNews,
  refreshPlayerReport
} = {}) {
  if (typeof getState !== "function") throw new Error("market-liquidity-service: getState is required");
  if (typeof randomUUID !== "function") throw new Error("market-liquidity-service: randomUUID is required");

  function processMarketLiquidity(now = Date.now(), options = {}) {
    const state = getState();
    const onlineCount = uniqueOnlinePlayerCount(state);
    const maxOnline = Number.isFinite(Number(options.maxOnline))
      ? Math.max(0, Math.floor(Number(options.maxOnline)))
      : MARKET_LIQUIDITY_MAX_ONLINE;

    const staleMs = Number.isFinite(Number(options.staleMs))
      ? Math.max(0, Math.floor(Number(options.staleMs)))
      : MARKET_LIQUIDITY_STALE_MS;
    const maxPurchases = Number.isFinite(Number(options.maxPurchases))
      ? Math.max(0, Math.floor(Number(options.maxPurchases)))
      : MARKET_LIQUIDITY_MAX_PURCHASES;
    const eligible = (state.listings || [])
      .filter((listing) => !listing.npcOffer && Number(listing?.createdAt || 0) + staleMs <= now)
      .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
    const purchases = [];

    for (const listing of eligible) {
      if (purchases.length >= maxPurchases) break;
      const seller = state.players?.get?.(listing.ownerId);
      if (!seller) continue;
      const finished = listing.item?.materialStage === "finished";
      if (!finished && onlineCount > maxOnline) continue;
      const remaining = remainingMarketLiquidity(seller, now);
      const openQuotes = state.listings.filter((row) => row.ownerId === seller.id && row.npcOffer);
      if (remaining.count <= openQuotes.length) continue;
      const reserved = openQuotes.reduce((sum, row) => sum + Number(row.npcOffer.amount || 0), 0);
      const amount = marketMakerOffer(listing, { money, itemValue });
      if (amount > Math.max(0, remaining.cash - reserved)) continue;
      if (amount < 100) continue;
      const index = state.listings.findIndex((row) => row.id === listing.id);
      if (index < 0) continue;

      listing.npcOffer = { id: randomUUID(), amount, at: now };
      purchases.push({ listingId: listing.id, sellerId: seller.id, amount });
    }

    return { changed: purchases.length > 0, purchases, onlineCount };
  }

  return { processMarketLiquidity };
}
