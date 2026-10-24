/**
 * Black-market authoritative constants — single source for client + server.
 * Values must stay stable; move here, do not change numbers without a design pass.
 */

export const BLACKMARKET_TAX = 0;
export const BLACKMARKET_MIN_PRICE = 100;
export const BLACKMARKET_GOODS_CAP = 24;
/** Player inventory and NPC stock share the same tradable goods categories. */
export const BLACKMARKET_GOODS_BUCKETS = Object.freeze({
  rough: "rough",
  material: "materials",
  slice: "slices",
  bracelet: "bracelets"
});
export const BLACKMARKET_GOODS_TYPES = Object.freeze([...Object.keys(BLACKMARKET_GOODS_BUCKETS), "employee", "equipment"]);
export const isBlackmarketGoodsType = (type) => BLACKMARKET_GOODS_TYPES.includes(type);
export const BLACKMARKET_BLIND_MIN = 6;
/** 盲盒池容量上限 */
export const BLACKMARKET_BLIND_CAP = 50;
/** 单次拆盒抽出的候选件数 */
export const BLACKMARKET_BLIND_DRAW_COUNT = 3;
/** 抽选会话超时（超时按默认第 1 件强制结算） */
export const BLACKMARKET_BLIND_DRAW_TIMEOUT_MS = 120_000;
/** ≥2 / ≥3 件加购倍率（相对盲盒标价） */
export const BLACKMARKET_BLIND_EXTRA_RATES = [0, 1.1, 1.35];
export const BLACKMARKET_RATING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const BM_EARLY_SUBMIT_REP_PENALTY = -5;
export const BM_TIMEOUT_REP_PENALTY = -10;
export const BM_SELLER_CANCEL_REP_PENALTY = -3;
/** Stall owner must accept within this window after buyer places a service order. */
export const BM_ACCEPT_TIMEOUT_MS = 30 * 60 * 1000;

/** @deprecated use BLACKMARKET_GOODS_CAP — kept for older smoke imports */
export const BLACKMARKET_PER_PLAYER_CAP = BLACKMARKET_GOODS_CAP;

/** 技术支持摊主页展示上限（标签 / 员工 / 设备 / 案例） */
export const BM_SERVICE_PROFILE_CAPS = Object.freeze({
  tags: 3,
  workers: 3,
  devices: 4,
  showcase: 3
});
