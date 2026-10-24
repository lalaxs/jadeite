import { economyDayKey } from './new-player-economy.js';
import { itemCost } from './item-cost.js';

export const SYSTEM_DEMAND_RULES = Object.freeze({
  dailyCashBase: 24_000,
  dailyCashPerLevel: 8_000,
  dailyCashMax: 240_000,
  dailyCountBase: 12,
  dailyCountPerLevel: 2,
  dailyCountMax: 40,
  dailyPremiumBase: 1_500,
  dailyPremiumPerLevel: 300,
  dailyPremiumMax: 6_000,
  dailyRareCount: 2,
  ordinaryMaxRatio: 1.15,
  rareMaxRatio: 1.25,
  resaleMaxRatio: 1.03
});

function nonnegative(value) { return Math.max(0, Math.round(Number(value) || 0)); }

export function systemDemandSnapshot(player, now = Date.now()) {
  const level = Math.max(1, Math.floor(Number(player?.level) || 1));
  const extra = level - 1;
  const rules = SYSTEM_DEMAND_RULES;
  const caps = {
    cash: Math.min(rules.dailyCashMax, rules.dailyCashBase + extra * rules.dailyCashPerLevel),
    count: Math.min(rules.dailyCountMax, rules.dailyCountBase + extra * rules.dailyCountPerLevel),
    premiumCash: Math.min(rules.dailyPremiumMax, rules.dailyPremiumBase + extra * rules.dailyPremiumPerLevel),
    rareCount: rules.dailyRareCount
  };
  const day = economyDayKey(now);
  const stored = player?.systemDemandBudget?.day === day ? player.systemDemandBudget
    : player?.systemDemand?.day === day ? player.systemDemand.spent : {};
  const spent = Object.fromEntries(Object.keys(caps).map(key => [key, nonnegative(stored[key])]));
  return {
    day, caps, spent,
    remaining: Object.fromEntries(Object.keys(caps).map(key => [key, Math.max(0, caps[key] - spent[key])])),
    nextResetAt: (day + 1) * 86_400_000 - 8 * 3_600_000,
    ordinaryMaxRatio: rules.ordinaryMaxRatio,
    rareMaxRatio: rules.rareMaxRatio,
    resaleMaxRatio: rules.resaleMaxRatio
  };
}

export function isNpcFinishedResale(player, product) {
  return product?.npcOrigin === 'blackmarket'
    && product?.craftedByPlayerId !== player?.id
    && product?.starterOwnerId !== player?.id;
}

export function systemSalePriceCap(player, products = []) {
  return Math.floor(products.reduce((sum, product) => {
    const value = nonnegative(product?.value ?? product?.price);
    return sum + value * (isNpcFinishedResale(player, product)
      ? SYSTEM_DEMAND_RULES.resaleMaxRatio : SYSTEM_DEMAND_RULES.rareMaxRatio);
  }, 0));
}

/** Read-only preflight. Caller must book the exact quote only after accepting the sale. */
export function quoteSystemDemand(player, products = [], payout, now = Date.now(), { exempt = false } = {}) {
  const amount = nonnegative(payout);
  const value = products.reduce((sum, product) => sum + nonnegative(product?.value ?? product?.price), 0);
  const quantity = Math.max(1, products.length);
  // Clearance discounts are not a way around the daily customer margin budget.
  // A resale's recorded positive trading margin consumes demand even below V.
  const premiumCash = products.reduce((sum, product) => {
    const appraisal = nonnegative(product?.value ?? product?.price);
    const share = value > 0 ? amount * appraisal / value : 0;
    const cost = itemCost(product);
    const basis = isNpcFinishedResale(player, product) && cost.complete ? Math.min(appraisal, cost.amount) : appraisal;
    return sum + Math.max(0, share - basis);
  }, 0);
  const quote = {
    ok: true, amount, value, quantity,
    premiumCash: Math.ceil(premiumCash),
    rareCount: amount > Math.floor(value * SYSTEM_DEMAND_RULES.ordinaryMaxRatio) ? 1 : 0,
    day: economyDayKey(now), exempt
  };
  if (amount > systemSalePriceCap(player, products)) {
    return { ...quote, ok: false, code: 'SYSTEM_PRICE_LIMIT', message: products.some(product => isNpcFinishedResale(player, product))
      ? '购入的NPC现成品按现货价收购，系统客户最高接受参考估值的103%；自制成品可争取工艺溢价。'
      : '系统客户最高接受参考估值的125%，更高报价可面向其他玩家出售。' };
  }
  if (exempt) return quote;
  const { remaining } = systemDemandSnapshot(player, now);
  if (amount > remaining.cash || quantity > remaining.count) {
    return { ...quote, ok: false, code: 'SYSTEM_DEMAND_EXHAUSTED', message: '今日订单与直播客户的收购额度不足，明日恢复；仍可与其他玩家交易。' };
  }
  if (quote.premiumCash > remaining.premiumCash || quote.rareCount > remaining.rareCount) {
    return { ...quote, ok: false, code: 'SYSTEM_PREMIUM_EXHAUSTED', message: '今日客户溢价需求已不足，可按参考估值报价，或明日再争取溢价。' };
  }
  return quote;
}

export function bookSystemDemand(player, quote, source = 'sale') {
  if (!quote?.ok || quote.exempt) return;
  const stored = player.systemDemandBudget?.day === quote.day ? player.systemDemandBudget : {};
  player.systemDemandBudget = {
    version: 1, day: quote.day,
    cash: nonnegative(stored.cash) + quote.amount,
    count: nonnegative(stored.count) + quote.quantity,
    premiumCash: nonnegative(stored.premiumCash) + quote.premiumCash,
    rareCount: nonnegative(stored.rareCount) + quote.rareCount,
    bySource: { ...(stored.bySource || {}), [source]: nonnegative(stored.bySource?.[source]) + quote.amount }
  };
}
