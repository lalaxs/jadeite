// 临时开放开关；关闭时保留功能实现和存档，方便后续恢复。
export const FEATURE_AVAILABILITY = Object.freeze({ mining: false });
export const MINING_UNAVAILABLE_MESSAGE = "矿区暂未开放。";

export function isFeatureAvailable(feature) {
  return FEATURE_AVAILABILITY[feature] !== false;
}
