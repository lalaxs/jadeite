export const TIMING_PROFILES = {
  normal: {
    day: 4 * 60 * 60 * 1000,
    production: { rough: 5 * 60 * 1000, refine: 15 * 60 * 1000, inlay: 5 * 60 * 1000 },
    auction: { duration: 10 * 60 * 1000, registration: 0, bidding: 10 * 60 * 1000, settlement: 0, cadence: 10 * 60 * 1000 },
    livestream: { min: 10 * 60 * 1000, max: 30 * 60 * 1000 },
    orders: { refresh: 4 * 60 * 60 * 1000 }
  },
  test: {
    day: 2400,
    production: { rough: 300, refine: 900, inlay: 300 },
    auction: { duration: 1200, registration: 0, bidding: 1200, settlement: 0, cadence: 1200 },
    livestream: { min: 500, max: 1500 },
    orders: { refresh: 1500 }
  }
};

const MODE_CONFIG = {
  manual: { chance: 0.82, low: 1.0, high: 1.5 },
  autoConservative: { chance: 0.9, low: 0.8, high: 1.1 },
  autoBalanced: { chance: 0.7, low: 0.9, high: 1.2 },
  autoAggressive: { chance: 0.4, low: 1.0, high: 1.8 }
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function money(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function seededRatio(seed = 1) {
  const x = Math.sin(Number(seed) * 999 + 17) * 10000;
  return x - Math.floor(x);
}

export function resolveTiming(profile = "normal") {
  return TIMING_PROFILES[profile] || TIMING_PROFILES.normal;
}

export function productionDuration(stage, profile = "normal") {
  const timing = resolveTiming(profile);
  return timing.production[stage] || timing.production.rough;
}

export function ledgerEntry(kind, amount, note, meta = {}) {
  const rawAmount = money(amount);
  const signed = kind === "expense" ? -rawAmount : rawAmount;
  const at = Number(meta.at ?? Date.now());
  const source = meta.source || kind;
  const itemId = meta.itemId;
  return {
    id: meta.id || `${kind}-${at}-${source}-${itemId || "none"}-${Math.abs(signed)}`,
    kind,
    source,
    amount: signed,
    note: String(note || kind),
    itemId,
    at
  };
}

export function cashFlowTotals(entries = [], since = 0, until = Infinity) {
  const scoped = entries.filter((entry) => Number(entry.at || 0) >= since && Number(entry.at || 0) <= until);
  const income = scoped.filter((entry) => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0);
  const expense = scoped.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const sources = {};
  for (const entry of scoped) {
    const key = entry.source || entry.kind || "other";
    sources[key] = (sources[key] || 0) + Math.abs(entry.amount || 0);
  }
  return { income, expense, net: income - expense, sources };
}

export function repFromCashFlow(source, amount) {
  if (!["expense", "livestream"].includes(source)) return 0;
  return Math.floor(money(amount) / 10000) * 10;
}

export function makeOfflineSummary(events = []) {
  const lines = events.map((event) => event.text).filter(Boolean);
  return {
    count: events.length,
    income: events.reduce((sum, event) => sum + money(event.income), 0),
    expense: events.reduce((sum, event) => sum + money(event.expense), 0),
    lines: lines.slice(0, 8)
  };
}

export function livestreamOutcome(product = {}, options = {}) {
  const mode = MODE_CONFIG[options.mode] ? options.mode : "autoBalanced";
  const config = MODE_CONFIG[mode];
  const seed = options.seed ?? product.id?.length ?? product.value ?? 1;
  const roll = seededRatio(seed);
  const repBoost = clamp(Number(options.rep || 0) / 900, 0, 0.24);
  const scoreBoost = clamp(Number(product.score || 1) * 0.015, 0, 0.09);
  const sold = roll < clamp(config.chance + repBoost + scoreBoost, 0.05, 0.97);
  const spread = seededRatio(Number(seed) + 41);
  const multiplier = config.low + (config.high - config.low) * spread + repBoost * 0.35;
  const price = sold ? money(Number(product.value || product.price || 0) * multiplier) : 0;
  return { sold, price, mode, multiplier: Number(multiplier.toFixed(3)) };
}

export function reportSummary(entries = [], inventory = [], now = Date.now()) {
  const totals = cashFlowTotals(entries);
  const incomeSources = {};
  for (const entry of entries.filter((item) => item.amount > 0)) {
    incomeSources[entry.source || "income"] = (incomeSources[entry.source || "income"] || 0) + entry.amount;
  }
  const inventoryValue = inventory.reduce((sum, item) => sum + Number(item.value || item.price || 0), 0);
  const staleCount = inventory.filter((item) => Number(item.createdAt || now) <= now - 5 * 24 * 60 * 60 * 1000).length;
  const advice = [];
  if (totals.net < 0) advice.push("净利润为负，优先交付订单或降低公盘出价。");
  if (staleCount > 0) advice.push("存在滞销库存，可安排自动直播或降价挂牌。");
  if (totals.income === 0) advice.push("暂无收入记录，先处理可售成品或等待订单刷新。");
  if (!advice.length) advice.push("现金流健康，可以评估下一轮公盘机会。");
  return { ...totals, sources: incomeSources, incomeSources, inventoryValue: money(inventoryValue), staleCount, advice };
}
