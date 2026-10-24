export const LIVESTREAM_MIN_ITEMS = 3;
export const LIVESTREAM_MAX_ITEMS = 12;
export const LIVESTREAM_MIN_PRICE = 1;
export const LIVESTREAM_BASE_DURATION_MS = 12 * 60 * 1000;
export const LIVESTREAM_MAX_DURATION_MS = 15 * 60 * 1000;
export const LIVESTREAM_SALE_EXTENSION_MS = 60 * 1000;

export const LIVESTREAM_AI_TUNING = Object.freeze({
  visitMinMs: 18_000,
  visitSpreadMs: 14_000,
  minVisitMs: 10_000,
  maxPriceRatio: 1.25,
  minPurchaseChance: 0.01,
  maxPurchaseChance: 0.88,
  scoreBoostPerPoint: 0.01,
  maxScoreBoost: 0.06,
  repFullValue: 1_500,
  maxRepBoost: 0.08
});

export const LIVESTREAM_AI_PRICE_BANDS = Object.freeze([
  Object.freeze({ maxRatio: 0.85, chance: 0.64 }),
  Object.freeze({ maxRatio: 0.95, chance: 0.50 }),
  Object.freeze({ maxRatio: 1.05, chance: 0.36 }),
  Object.freeze({ maxRatio: 1.15, chance: 0.24 }),
  Object.freeze({ maxRatio: 1.20, chance: 0.16 }),
  Object.freeze({ maxRatio: 1.25, chance: 0.10 })
]);
