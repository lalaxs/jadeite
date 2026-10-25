import { attemptAtomicMutation } from "../atomic-mutation.js";
import { quoteSystemDemand, bookSystemDemand } from "../../../shared/domain/economy/system-demand.js";
import { recordFinanceSale } from "../../../shared/domain/economy/finance-book.js";

export const BLACKMARKET_CUSTOMER_INTERVAL_MS = 25_000;

export function createBlackmarketCustomers({ getState, money, earnCash, uiMoney, notifyPlayerToast, queueOfflineEvent, refreshPlayerReport, closeGoodsStallIfEmpty, bumpBmDeal }) {
  function processBlackmarketCustomers(now = Date.now(), random = Math.random) {
    const state = getState();
    let changed = false;
    const purchases = [];
    for (const stall of [...(state.blackStalls || [])]) {
      if (stall.npc || stall.type !== "goods" || stall.status !== "open" || !stall.items?.length) continue;
      if (!stall.nextCustomerAt) { stall.nextCustomerAt = now + BLACKMARKET_CUSTOMER_INTERVAL_MS; changed = true; continue; }
      if (now < stall.nextCustomerAt) continue;
      stall.nextCustomerAt = now + BLACKMARKET_CUSTOMER_INTERVAL_MS;
      stall.views = Number(stall.views || 0) + 1;
      changed = true;
      const seller = state.players.get(stall.ownerId);
      if (!seller) continue;
      const candidates = stall.items.filter((row) => ["rough", "material", "slice", "bracelet"].includes(row.type));
      if (!candidates.length) continue;
      const row = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
      const price = money(row.price);
      const quote = quoteSystemDemand(seller, [row.item], price, now);
      if (!quote.ok || price <= 0 || random() >= Math.min(.45, .18 * quote.value / price)) continue;
      const result = attemptAtomicMutation([seller, state.blackStalls, state.news], ({ afterCommit }) => {
        recordFinanceSale(seller, [row.item], price, { id: `blackmarket:${row.id}`, channel: "blackmarket" });
        bookSystemDemand(seller, quote, "blackmarket");
        earnCash(seller, price, `黑市顾客买下${row.item.name}`, { source: "blackmarket-sale", itemId: row.item.id });
        queueOfflineEvent?.(seller, { type: "blackmarket", text: `黑市顾客买下「${row.item.name}」，成交金额 ${uiMoney(price)}，货款已入账。`, income: price, readyAt: now });
        stall.items.splice(stall.items.findIndex((item) => item.id === row.id), 1);
        stall.updatedAt = now;
        bumpBmDeal(seller);
        closeGoodsStallIfEmpty(state, stall, { afterCommit });
        refreshPlayerReport?.(seller);
        afterCommit(() => notifyPlayerToast?.(seller, `黑市顾客买下「${row.item.name}」，成交金额 ${uiMoney(price)}，货款已入账。`));
        return { ok: true };
      });
      if (result.ok) purchases.push({ stallId: stall.id, listingId: row.id, sellerId: seller.id, price });
    }
    return { changed, purchases };
  }
  return { processBlackmarketCustomers };
}
