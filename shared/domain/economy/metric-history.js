/**
 * Player metric history — shared FE/BE.
 * Cash stays on player.ledger; rep / exp / satisfaction use *History arrays.
 */
export const METRIC_HISTORY_LIMIT = 800;
export const CASH_LEDGER_LIMIT = 800;

export const BILL_METRICS = [
  { id: "cash", label: "金额" },
  { id: "rep", label: "声望" },
  { id: "exp", label: "经验" },
  { id: "satisfaction", label: "客户评级" }
];

/** 对外公开星级：订单交单 + 黑市买家→卖家评价合计达到该值（与 HUD/黑市共用） */
export const CUSTOMER_RATING_PUBLIC_MIN_SAMPLES = 5;
/** 双轨合成权重：订单为主，黑市为辅 */
export const CUSTOMER_RATING_ORDER_WEIGHT = 0.7;
export const CUSTOMER_RATING_BM_WEIGHT = 0.3;
export const CUSTOMER_RATING_BASELINE = 70;
/** 黑市成交≥该数时，评价率过低会在排序中降权 */
export const BM_RATING_RATE_DEALS_FLOOR = 3;
export const BM_RATING_RATE_SOFT_MIN = 0.35;

export function customerRatingOrderSamples(player) {
  return Math.max(0, Math.round(Number(player?.stats?.orderCount) || 0));
}

/** @param {number} bmSampleCount 黑市买家→卖家有效评价数 */
export function customerRatingSampleTotal(player, bmSampleCount = 0) {
  return customerRatingOrderSamples(player) + Math.max(0, Math.round(Number(bmSampleCount) || 0));
}

function clampSat(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function hasSatValue(value) {
  return value != null && value !== "";
}

/** 合成对外展示分（写入 player.satisfaction，兼容旧调用方） */
export function recomputeDisplaySatisfaction(player) {
  if (!player) return null;
  const hasOrder = hasSatValue(player.orderSat);
  const hasBm = hasSatValue(player.bmSat);
  if (!hasOrder && !hasBm) {
    player.satisfaction = null;
    return null;
  }
  if (hasOrder && !hasBm) {
    player.satisfaction = clampSat(player.orderSat);
    return player.satisfaction;
  }
  if (!hasOrder && hasBm) {
    player.satisfaction = clampSat(player.bmSat);
    return player.satisfaction;
  }
  player.satisfaction = clampSat(
    Number(player.orderSat) * CUSTOMER_RATING_ORDER_WEIGHT
      + Number(player.bmSat) * CUSTOMER_RATING_BM_WEIGHT
  );
  return player.satisfaction;
}

/**
 * 旧档迁移：仅有 satisfaction 时拆到 orderSat / bmSat。
 * 已有双轨字段则规范化并重算展示分。
 */
export function ensureCustomerRatingTracks(player) {
  if (!player) return;
  const hasOrderKey = Object.prototype.hasOwnProperty.call(player, "orderSat");
  const hasBmKey = Object.prototype.hasOwnProperty.call(player, "bmSat");
  if (!hasOrderKey || !hasBmKey) {
    const sat = player.satisfaction;
    const orderCount = customerRatingOrderSamples(player);
    const bmCount = Math.max(0, Math.round(Number(player.bmRatingSampleCount) || 0));
    player.orderSat = hasOrderKey && hasSatValue(player.orderSat) ? clampSat(player.orderSat) : null;
    player.bmSat = hasBmKey && hasSatValue(player.bmSat) ? clampSat(player.bmSat) : null;
    if (!hasSatValue(player.orderSat) && !hasSatValue(player.bmSat) && hasSatValue(sat)) {
      const n = clampSat(sat);
      if (orderCount > 0 && bmCount === 0) player.orderSat = n;
      else if (bmCount > 0 && orderCount === 0) player.bmSat = n;
      else if (orderCount > 0 && bmCount > 0) {
        player.orderSat = n;
        player.bmSat = n;
      } else {
        player.orderSat = n;
      }
    }
  } else {
    player.orderSat = hasSatValue(player.orderSat) ? clampSat(player.orderSat) : null;
    player.bmSat = hasSatValue(player.bmSat) ? clampSat(player.bmSat) : null;
  }
  if (!Object.prototype.hasOwnProperty.call(player, "buyerCredit")) {
    player.buyerCredit = null;
  } else {
    player.buyerCredit = hasSatValue(player.buyerCredit) ? clampSat(player.buyerCredit) : null;
  }
  recomputeDisplaySatisfaction(player);
}

/** Build a normalized rating view without migrating or rewriting the player. */
export function customerRatingView(player) {
  if (!player) return null;
  const view = {
    ...player,
    stats: player.stats && typeof player.stats === "object" ? { ...player.stats } : {}
  };
  ensureCustomerRatingTracks(view);
  return view;
}

export function isCustomerRatingPublic(
  player,
  bmSampleCount = 0,
  minSamples = CUSTOMER_RATING_PUBLIC_MIN_SAMPLES
) {
  const view = customerRatingView(player);
  if (!view || !hasSatValue(view.satisfaction)) return false;
  return customerRatingSampleTotal(view, bmSampleCount) >= minSamples;
}

export function customerRatingScore(playerOrValue) {
  if (playerOrValue != null && typeof playerOrValue === "object") {
    const view = customerRatingView(playerOrValue);
    if (!view || !hasSatValue(view.satisfaction)) return null;
    return clampSat(view.satisfaction);
  }
  if (!hasSatValue(playerOrValue)) return null;
  return clampSat(playerOrValue);
}

export function customerRatingStarsFromScore(score) {
  if (!hasSatValue(score)) return null;
  return Math.max(0, Math.min(5, Math.round(Number(score) / 20)));
}

/** 星级按 round(score/20)；下一星门槛为 stars*20+10 */
export function customerRatingStarProgress(score) {
  const sat = customerRatingScore(score);
  if (sat == null) {
    return { stars: null, score: null, nextStars: 1, nextAt: 10, remain: 10 };
  }
  const stars = customerRatingStarsFromScore(sat);
  if (stars >= 5) {
    return { stars, score: sat, nextStars: null, nextAt: null, remain: 0 };
  }
  const nextAt = stars * 20 + 10;
  return {
    stars,
    score: sat,
    nextStars: stars + 1,
    nextAt,
    remain: Math.max(0, nextAt - sat)
  };
}

/**
 * 星级经营称号 + 档位收益系数（订单报价/客源/小费用）。
 * <50 新店/口碑一般；50–69 尚可；70–89 优良；≥90 极佳。
 */
export function customerRatingTierInfo(score) {
  if (!hasSatValue(score)) {
    return {
      id: "none",
      title: "暂无评级",
      stars: null,
      payBoost: 1,
      wealthT: 0,
      tipChanceBonus: 0,
      tipMultBonus: 0
    };
  }
  const sat = clampSat(score);
  const stars = customerRatingStarsFromScore(sat);
  if (sat < 50) {
    return {
      id: "fair",
      title: sat < 30 ? "新店" : "口碑一般",
      stars,
      payBoost: 0.97,
      wealthT: 0.05,
      tipChanceBonus: 0,
      tipMultBonus: 0.02
    };
  }
  if (sat < 70) {
    return {
      id: "ok",
      title: "口碑尚可",
      stars,
      payBoost: 1,
      wealthT: 0.35,
      tipChanceBonus: 0.08,
      tipMultBonus: 0.03
    };
  }
  if (sat < 90) {
    return {
      id: "good",
      title: "口碑优良",
      stars,
      payBoost: 1.04,
      wealthT: 0.7,
      tipChanceBonus: 0.18,
      tipMultBonus: 0.04
    };
  }
  return {
    id: "great",
    title: "口碑极佳",
    stars,
    payBoost: 1.08,
    wealthT: 1,
    tipChanceBonus: 0.27,
    tipMultBonus: 0.05
  };
}

export function bmSellerRatingRate(player, bmSampleCount = 0) {
  const deals = Math.max(0, Math.round(Number(player?.stats?.bmDeals) || 0));
  if (deals <= 0) return null;
  return Math.min(1, Math.max(0, Math.round(Number(bmSampleCount) || 0) / deals));
}

/** 评价率过低时排序降权（不隐藏星级） */
export function bmRatingRateSortPenalty(player, bmSampleCount = 0) {
  const deals = Math.max(0, Math.round(Number(player?.stats?.bmDeals) || 0));
  if (deals < BM_RATING_RATE_DEALS_FLOOR) return 0;
  const rate = bmSellerRatingRate(player, bmSampleCount);
  if (rate == null || rate >= BM_RATING_RATE_SOFT_MIN) return 0;
  return Math.round((BM_RATING_RATE_SOFT_MIN - rate) * 40);
}

export function clearCustomerRating(player) {
  if (!player) return;
  player.orderSat = null;
  player.bmSat = null;
  player.buyerCredit = null;
  player.satisfaction = null;
  player.bmRatingSampleCount = 0;
  player.stats ||= {};
  player.stats.orderCount = 0;
}

export const BILL_GRAINS = [
  { id: "detail", label: "明细" },
  { id: "month", label: "月账单" },
  { id: "year", label: "年账单" }
];

/** Source filter chips per metric. `match` receives entry.source. */
export const BILL_SOURCE_FILTERS = {
  cash: [
    { id: "all", label: "全部", match: () => true },
    { id: "workshop", label: "工坊", match: (s) => ["production", "workshop", "employeeSalary", "material", "equipment", "equipmentRepair", "recruit", "recruitRefresh", "asset"].includes(s) },
    { id: "auction", label: "公盘", match: (s) => String(s || "").startsWith("auction") || s === "window" },
    { id: "market", label: "交易行", match: (s) => String(s || "").startsWith("market") },
    { id: "livestream", label: "直播", match: (s) => String(s || "").startsWith("livestream") },
    { id: "order", label: "订单", match: (s) => s === "order" || s === "orderRefresh" || s === "taskReward" || s === "taskReset" },
    { id: "blackmarket", label: "黑市", match: (s) => String(s || "").startsWith("blackmarket") },
    { id: "other", label: "其他", match: (s) => {
      const covered = ["production", "workshop", "employeeSalary", "material", "equipment", "equipmentRepair", "recruit", "recruitRefresh", "asset", "window", "order", "orderRefresh", "taskReward", "taskReset"];
      if (covered.includes(s)) return false;
      const raw = String(s || "");
      if (raw.startsWith("auction") || raw.startsWith("market") || raw.startsWith("livestream") || raw.startsWith("blackmarket")) return false;
      return true;
    } }
  ],
  rep: [
    { id: "all", label: "全部", match: () => true },
    { id: "craft", label: "工坊/切割", match: (s) => ["cut", "cut_fail", "opening"].includes(s) },
    { id: "trade", label: "交易", match: (s) => ["market_sell", "collect", "livestream"].includes(s) },
    { id: "order", label: "订单", match: (s) => s === "order" },
    { id: "cashflow", label: "流水换算", match: (s) => s === "cashflow" || s === "expense" },
    { id: "penalty", label: "处罚", match: (s) => s === "bm_penalty" },
    { id: "decay", label: "衰减", match: (s) => s === "decay" },
    { id: "other", label: "其他", match: (s) => !["cut", "cut_fail", "opening", "market_sell", "collect", "livestream", "order", "cashflow", "expense", "bm_penalty", "decay", "debug"].includes(s) }
  ],
  exp: [
    { id: "all", label: "全部", match: () => true },
    { id: "workshop", label: "工坊", match: (s) => ["opening_done", "carving_done", "finishing_done"].includes(s) },
    { id: "auction", label: "公盘", match: (s) => ["auction_win", "window_open"].includes(s) },
    { id: "market", label: "交易行", match: (s) => ["market_sell", "market_buy"].includes(s) },
    { id: "livestream", label: "直播", match: (s) => String(s || "").startsWith("livestream") },
    { id: "order", label: "订单", match: (s) => s === "order_ok" || s === "order_bad" },
    { id: "task", label: "任务/藏品", match: (s) => s === "task_claim" || s === "collect_item" || s === "achievement_unlock" },
    { id: "other", label: "其他", match: (s) => !["opening_done", "carving_done", "finishing_done", "auction_win", "window_open", "market_sell", "market_buy", "livestream_sale", "livestream_close", "order_ok", "order_bad", "task_claim", "collect_item", "achievement_unlock"].includes(s) }
  ],
  satisfaction: [
    { id: "all", label: "全部", match: () => true },
    { id: "order", label: "订单", match: (s) => s === "order_rating" },
    { id: "blackmarket", label: "黑市", match: (s) => s === "bm_rating" },
    { id: "buyer", label: "买家信誉", match: (s) => s === "bm_buyer_credit" },
    { id: "other", label: "其他", match: (s) => !["order_rating", "bm_rating", "bm_buyer_credit"].includes(s) }
  ]
};

const HISTORY_KEY = {
  rep: "repHistory",
  exp: "expHistory",
  satisfaction: "ratingHistory"
};

export const SOURCE_LABELS = {
  cashflow: "经营流水",
  production: "工坊生产",
  workshop: "工坊",
  commission: "来料加工报酬",
  "workshop-station": "公共工位费",
  window: "公盘开窗",
  auctionEntry: "公盘入场",
  auctionEscrow: "公盘保证金",
  auctionEscrowRefund: "公盘退还",
  auctionDeposit: "拍卖押金",
  auctionRefund: "拍卖退款",
  market: "交易行买入",
  "market-payout": "交易行结算",
  "market-want": "求购成交",
  "market-want-escrow": "求购冻结",
  "market-want-escrow-refund": "求购退还",
  "market-want-refund": "求购退还",
  livestream: "直播收入",
  "livestream-buy": "直播买入",
  order: "订单交付",
  orderRefresh: "刷新客户",
  taskReward: "任务奖励",
  taskReset: "任务重置",
  achievementReward: "成就奖励",
  blackmarket: "黑市购入",
  "blackmarket-blind": "黑市盲盒",
  "blackmarket-payout": "黑市结算",
  "blackmarket-service": "黑市服务",
  material: "镶嵌材料",
  equipment: "设备购置",
  equipmentRepair: "设备维修",
  recruit: "招募员工",
  employeeSalary: "员工日工资",
  recruitRefresh: "刷新候选人",
  minerRecruit: "招聘矿工",
  minerRecruitRefresh: "刷新矿工候选人",
  minerRetention: "矿工留任",
  minerMentorship: "矿工带教",
  minerTraining: "矿工训练",
  minerCare: "矿工休整",
  minerContractRenewal: "矿工续约",
  minerPromotion: "矿工晋升",
  miningLeaseAutomatic: "矿权自动分配",
  miningLeaseRent: "矿权租金",
  miningLeaseRefund: "矿权退款",
  miningLeaseEscrow: "矿权资金冻结",
  miningShift: "矿山开采",
  miningFacilityUpgrade: "矿业设施升级",
  asset: "资产购置",
  salvage: "切垮回收",
  "inventory-recycle": "库存回收",
  debug: "调试",
  decay: "自然衰减",
  cut: "切割",
  cut_fail: "切割失败",
  opening: "开石",
  collect: "收入藏品",
  market_sell: "交易行卖出",
  bm_penalty: "黑市处罚",
  bm_rating: "黑市摊评",
  bm_buyer_credit: "买家信誉",
  order_rating: "订单评价",
  expense: "支出",
  income: "收入"
};

export const EXP_TYPE_LABELS = {
  debug: "调试加经验",
  auction_win: "公盘中标",
  window_open: "公盘开窗",
  opening_done: "完成开石",
  carving_done: "完成精雕",
  finishing_done: "完成镶嵌",
  commission_done: "来料加工完成",
  livestream_sale: "直播成交",
  livestream_close: "结束直播",
  order_ok: "订单交付成功",
  order_bad: "订单交付不佳",
  market_sell: "交易行卖出",
  market_buy: "交易行买入",
  collect_item: "收入藏品",
  task_claim: "领取任务",
  achievement_unlock: "成就达成"
};

function dayKey(ts = Date.now()) {
  const d = new Date(Number(ts) || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthKey(ts = Date.now()) {
  const d = new Date(Number(ts) || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function yearKey(ts = Date.now()) {
  return String(new Date(Number(ts) || Date.now()).getFullYear());
}

export function monthBounds(ym) {
  const [y, m] = String(ym || "").split("-").map(Number);
  if (!y || !m) return { since: 0, until: Infinity };
  const since = new Date(y, m - 1, 1).getTime();
  const until = new Date(y, m, 0, 23, 59, 59, 999).getTime();
  return { since, until };
}

export function yearBounds(year) {
  const y = Number(year);
  if (!y) return { since: 0, until: Infinity };
  const since = new Date(y, 0, 1).getTime();
  const until = new Date(y, 11, 31, 23, 59, 59, 999).getTime();
  return { since, until };
}

export function ensureMetricHistories(player) {
  if (!player) return;
  player.repHistory = Array.isArray(player.repHistory) ? player.repHistory : [];
  player.expHistory = Array.isArray(player.expHistory) ? player.expHistory : [];
  player.ratingHistory = Array.isArray(player.ratingHistory) ? player.ratingHistory : [];
  player.ledger = Array.isArray(player.ledger) ? player.ledger : [];
  player.billMonthRollups = player.billMonthRollups && typeof player.billMonthRollups === "object"
    ? player.billMonthRollups
    : {};
  for (const metric of ["cash", "rep", "exp", "satisfaction"]) {
    player.billMonthRollups[metric] ||= {};
  }
}

function historyArray(player, metric) {
  ensureMetricHistories(player);
  const key = HISTORY_KEY[metric];
  return key ? player[key] : null;
}

export function foldEntriesIntoMonthRollups(player, metric, entries = []) {
  if (!player || !entries.length) return;
  ensureMetricHistories(player);
  const buckets = player.billMonthRollups[metric] || (player.billMonthRollups[metric] = {});
  for (const entry of entries) {
    const key = monthKey(entry.at);
    const bucket = buckets[key] || (buckets[key] = {
      key,
      gain: 0,
      loss: 0,
      net: 0,
      count: 0,
      since: monthBounds(key).since,
      until: monthBounds(key).until
    });
    const delta = Number(entry.delta ?? entry.amount) || 0;
    if (delta >= 0) bucket.gain += delta;
    else bucket.loss += Math.abs(delta);
    bucket.net += delta;
    bucket.count += 1;
  }
}

function trimHistoryList(player, metric, list, limit) {
  if (!Array.isArray(list) || list.length <= limit) return list;
  const keep = list.slice(0, limit);
  const dropped = list.slice(limit);
  foldEntriesIntoMonthRollups(player, metric, dropped.map((entry) => ({
    ...entry,
    delta: entry.delta ?? entry.amount
  })));
  return keep;
}

export function sourceLabel(source, metric = "cash") {
  if (!source) return "其他";
  if (metric === "exp" && EXP_TYPE_LABELS[source]) return EXP_TYPE_LABELS[source];
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  // 避免账单露出任何未登记的英文 source key（含 camelCase 形式）
  const raw = String(source);
  if (/[a-z]/i.test(raw)) return "其他";
  return raw;
}

export function recordMetricEntry(player, metric, delta, note, meta = {}) {
  const list = historyArray(player, metric);
  if (!list) return null;
  const at = Number(meta.at ?? Date.now());
  const source = meta.source || metric;
  const signed = Number(delta) || 0;

  // Daily merge for reputation decay to avoid tick spam.
  if (metric === "rep" && source === "decay") {
    const key = dayKey(at);
    const existing = list.find((entry) => entry.source === "decay" && dayKey(entry.at) === key);
    if (existing) {
      existing.delta = Number(existing.delta || 0) + signed;
      if (meta.after != null) existing.after = Number(meta.after);
      if (meta.before != null && existing.before == null) existing.before = Number(meta.before);
      existing.note = String(note || existing.note || "声望自然衰减");
      existing.at = at;
      return existing;
    }
  }

  const entry = {
    id: meta.id || `${metric}-${at}-${source}-${Math.abs(signed)}-${list.length}`,
    metric,
    delta: signed,
    before: meta.before != null ? Number(meta.before) : undefined,
    after: meta.after != null ? Number(meta.after) : undefined,
    source,
    note: String(note || sourceLabel(source, metric)),
    itemId: meta.itemId,
    at,
    track: meta.track || undefined,
    reasonTag: meta.reasonTag || undefined,
    displayBefore: meta.displayBefore != null ? Number(meta.displayBefore) : undefined,
    displayAfter: meta.displayAfter != null ? Number(meta.displayAfter) : undefined,
    meta: meta.extra || undefined
  };
  list.unshift(entry);
  player[HISTORY_KEY[metric]] = trimHistoryList(player, metric, list, METRIC_HISTORY_LIMIT);
  return entry;
}

export function applyRepDelta(player, delta, note, meta = {}) {
  if (!player) return { before: 0, after: 0, delta: 0 };
  const before = Number(player.rep) || 0;
  const floor = meta.floor != null ? Number(meta.floor) : 0;
  const after = Math.max(floor, before + (Number(delta) || 0));
  const actual = after - before;
  player.rep = after;
  if (actual !== 0 || meta.forceRecord) {
    recordMetricEntry(player, "rep", actual, note, {
      ...meta,
      before,
      after
    });
  }
  return { before, after, delta: actual };
}

export function applySatisfactionDelta(player, delta, note, meta = {}) {
  if (!player) return { before: null, after: null, delta: 0, track: null, displayBefore: null, displayAfter: null };
  ensureCustomerRatingTracks(player);
  const track = meta.track
    || (meta.source === "bm_rating" ? "bm" : meta.source === "bm_buyer_credit" ? "buyer" : "order");
  if (track === "buyer") {
    return applyBuyerCreditDelta(player, delta, note, meta);
  }
  const key = track === "bm" ? "bmSat" : "orderSat";
  const baseline = meta.baseline != null ? Number(meta.baseline) : CUSTOMER_RATING_BASELINE;
  const beforeStored = player[key];
  const before = !hasSatValue(beforeStored) ? baseline : Number(beforeStored);
  const after = clampSat(before + (Number(delta) || 0));
  const actual = after - before;
  player[key] = after;
  const displayBefore = hasSatValue(player.satisfaction) ? Number(player.satisfaction) : null;
  recomputeDisplaySatisfaction(player);
  const displayAfter = hasSatValue(player.satisfaction) ? Number(player.satisfaction) : null;
  if (actual !== 0 || !hasSatValue(beforeStored) || meta.forceRecord) {
    recordMetricEntry(player, "satisfaction", actual, note, {
      ...meta,
      track,
      before: !hasSatValue(beforeStored) ? null : before,
      after,
      displayBefore,
      displayAfter
    });
  }
  return {
    before: !hasSatValue(beforeStored) ? null : before,
    after,
    delta: actual,
    track,
    displayBefore,
    displayAfter
  };
}

export function applyBuyerCreditDelta(player, delta, note, meta = {}) {
  if (!player) return { before: null, after: null, delta: 0, track: "buyer" };
  ensureCustomerRatingTracks(player);
  const baseline = meta.baseline != null ? Number(meta.baseline) : CUSTOMER_RATING_BASELINE;
  const beforeStored = player.buyerCredit;
  const before = !hasSatValue(beforeStored) ? baseline : Number(beforeStored);
  const after = clampSat(before + (Number(delta) || 0));
  const actual = after - before;
  player.buyerCredit = after;
  if (actual !== 0 || !hasSatValue(beforeStored) || meta.forceRecord) {
    recordMetricEntry(player, "satisfaction", actual, note, {
      ...meta,
      source: meta.source || "bm_buyer_credit",
      track: "buyer",
      before: !hasSatValue(beforeStored) ? null : before,
      after
    });
  }
  return {
    before: !hasSatValue(beforeStored) ? null : before,
    after,
    delta: actual,
    track: "buyer",
    displayBefore: hasSatValue(player.satisfaction) ? Number(player.satisfaction) : null,
    displayAfter: hasSatValue(player.satisfaction) ? Number(player.satisfaction) : null
  };
}

export function setSatisfactionValue(player, value, note, meta = {}) {
  if (!player) return { before: null, after: null, delta: 0 };
  ensureCustomerRatingTracks(player);
  const displayBefore = hasSatValue(player.satisfaction) ? Number(player.satisfaction) : null;
  const after = clampSat(value);
  const track = meta.track || "both";
  if (track === "order" || track === "both") player.orderSat = after;
  if (track === "bm" || track === "both") player.bmSat = after;
  recomputeDisplaySatisfaction(player);
  const displayAfter = hasSatValue(player.satisfaction) ? Number(player.satisfaction) : null;
  const delta = displayBefore == null ? after : after - displayBefore;
  recordMetricEntry(player, "satisfaction", delta, note, {
    ...meta,
    source: meta.source || "debug",
    track,
    before: displayBefore,
    after: displayAfter,
    forceRecord: true
  });
  return { before: displayBefore, after: displayAfter, delta, track };
}

export function recordExpGain(player, amount, type, note, meta = {}) {
  const granted = Math.round(Number(amount) || 0);
  if (!player || granted <= 0) return null;
  const before = Math.max(0, Math.round(Number(player.exp) || 0) - granted);
  const after = Math.max(0, Math.round(Number(player.exp) || 0));
  return recordMetricEntry(player, "exp", granted, note || EXP_TYPE_LABELS[type] || type, {
    ...meta,
    source: type || meta.source || "exp",
    before,
    after
  });
}

export function cashBillEntries(player) {
  const rows = (player?.ledger || []).map((entry) => ({
    id: entry.id,
    metric: "cash",
    delta: Number(entry.amount) || 0,
    before: entry.before != null ? Number(entry.before) : undefined,
    after: entry.after != null ? Number(entry.after) : undefined,
    source: entry.source || entry.kind,
    note: entry.note,
    itemId: entry.itemId,
    at: Number(entry.at) || 0,
    kind: entry.kind
  }));
  // 旧流水可能缺 before/after：用当前现金从新到旧回推，保证「余」有金额
  let running = Math.max(0, Math.round(Number(player?.cash) || 0));
  for (const row of rows) {
    const delta = Number(row.delta) || 0;
    if (row.after == null || Number.isNaN(row.after)) row.after = running;
    else running = row.after;
    if (row.before == null || Number.isNaN(row.before)) row.before = running - delta;
    running = row.before;
  }
  return rows;
}

export function getBillEntries(player, metric) {
  ensureMetricHistories(player);
  if (metric === "cash") return cashBillEntries(player);
  const list = historyArray(player, metric) || [];
  return list.map((entry) => ({ ...entry, metric }));
}

export function filterEntriesBySource(entries = [], metric = "cash", sourceId = "all") {
  if (!sourceId || sourceId === "all") return entries;
  const filters = BILL_SOURCE_FILTERS[metric] || [];
  const filter = filters.find((item) => item.id === sourceId);
  if (!filter || typeof filter.match !== "function") return entries;
  return entries.filter((entry) => filter.match(entry.source || entry.kind));
}

export function filterEntriesByRange(entries = [], since = 0, until = Infinity) {
  const lo = Number(since) || 0;
  const hi = Number.isFinite(Number(until)) ? Number(until) : Infinity;
  return entries.filter((entry) => {
    const at = Number(entry.at) || 0;
    return at >= lo && at <= hi;
  });
}

export function summarizeEntries(entries = []) {
  let gain = 0;
  let loss = 0;
  for (const entry of entries) {
    const delta = Number(entry.delta) || 0;
    if (delta >= 0) gain += delta;
    else loss += Math.abs(delta);
  }
  return {
    gain,
    loss,
    net: gain - loss,
    count: entries.length
  };
}

export function aggregateBillPeriods(entries = [], grain = "month") {
  const buckets = new Map();
  for (const entry of entries) {
    const at = Number(entry.at) || 0;
    const key = grain === "year" ? yearKey(at) : monthKey(at);
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        gain: 0,
        loss: 0,
        net: 0,
        count: 0,
        since: grain === "year" ? yearBounds(key).since : monthBounds(key).since,
        until: grain === "year" ? yearBounds(key).until : monthBounds(key).until
      });
    }
    const bucket = buckets.get(key);
    const delta = Number(entry.delta) || 0;
    if (delta >= 0) bucket.gain += delta;
    else bucket.loss += Math.abs(delta);
    bucket.net += delta;
    bucket.count += 1;
  }
  return [...buckets.values()].sort((a, b) => String(b.key).localeCompare(String(a.key)));
}

/** Merge live period buckets with archived month rollups (no double-count: rollups only hold trimmed rows). */
export function mergePeriodRollups(player, metric, livePeriods = [], grain = "month", since = 0, until = Infinity) {
  ensureMetricHistories(player);
  const map = new Map(livePeriods.map((period) => [period.key, { ...period }]));
  const rollups = player.billMonthRollups?.[metric] || {};
  for (const bucket of Object.values(rollups)) {
    if (!bucket?.key) continue;
    const bSince = Number(bucket.since ?? monthBounds(bucket.key).since);
    const bUntil = Number(bucket.until ?? monthBounds(bucket.key).until);
    if (bUntil < since || bSince > until) continue;
    if (grain === "month") {
      const existing = map.get(bucket.key);
      if (existing) {
        existing.gain += Number(bucket.gain) || 0;
        existing.loss += Number(bucket.loss) || 0;
        existing.net += Number(bucket.net) || 0;
        existing.count += Number(bucket.count) || 0;
      } else {
        map.set(bucket.key, {
          key: bucket.key,
          gain: Number(bucket.gain) || 0,
          loss: Number(bucket.loss) || 0,
          net: Number(bucket.net) || 0,
          count: Number(bucket.count) || 0,
          since: bSince,
          until: bUntil,
          archived: true
        });
      }
      continue;
    }
    const y = yearKey(bSince);
    const existing = map.get(y);
    if (existing) {
      existing.gain += Number(bucket.gain) || 0;
      existing.loss += Number(bucket.loss) || 0;
      existing.net += Number(bucket.net) || 0;
      existing.count += Number(bucket.count) || 0;
    } else {
      map.set(y, {
        key: y,
        gain: Number(bucket.gain) || 0,
        loss: Number(bucket.loss) || 0,
        net: Number(bucket.net) || 0,
        count: Number(bucket.count) || 0,
        since: yearBounds(y).since,
        until: yearBounds(y).until,
        archived: true
      });
    }
  }
  return [...map.values()].sort((a, b) => String(b.key).localeCompare(String(a.key)));
}

export function pendingCashHint(player) {
  const payouts = Array.isArray(player?.payouts) ? player.payouts : [];
  const black = Array.isArray(player?.blackPayouts) ? player.blackPayouts : [];
  const sum = [...payouts, ...black].reduce((acc, row) => acc + (Number(row.amount || row.total || row.pay) || 0), 0);
  return Math.max(0, Math.round(sum));
}

/** Used by economy-service when cash ledger exceeds cap. */
export function trimCashLedger(player, limit = CASH_LEDGER_LIMIT) {
  ensureMetricHistories(player);
  player.ledger = trimHistoryList(player, "cash", player.ledger || [], limit);
  return player.ledger;
}
