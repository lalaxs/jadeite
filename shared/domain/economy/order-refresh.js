export const ORDER_SINGLE_REFRESH_DAILY_CAP = 10;
export const ORDER_BATCH_REFRESH_DAILY_CAP = 3;

export const ORDER_SINGLE_REFRESH_COSTS = Object.freeze([
  500,
  750,
  1_100,
  1_600,
  2_400,
  3_600,
  5_400,
  8_100,
  12_000,
  18_000
]);

export const ORDER_BATCH_REFRESH_COSTS = Object.freeze([
  1_500,
  3_000,
  6_000
]);

function normalizedCount(count) {
  return Math.max(0, Math.floor(Number(count) || 0));
}

export function orderSingleRefreshFeeForCount(count = 0) {
  const index = Math.min(normalizedCount(count), ORDER_SINGLE_REFRESH_COSTS.length - 1);
  return ORDER_SINGLE_REFRESH_COSTS[index];
}

export function orderBatchRefreshFeeForCount(count = 0) {
  const index = Math.min(normalizedCount(count), ORDER_BATCH_REFRESH_COSTS.length - 1);
  return ORDER_BATCH_REFRESH_COSTS[index];
}
