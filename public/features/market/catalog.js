import { KIND_LABELS } from "../../jade-categories.js";
export { PRODUCT_QUALITY as MARKET_QUALITY, QUALITY_KEY_ALIASES, productQualityKey as marketQualityKey, productQualityMeta as marketQualityMeta, clamp, PRODUCT_COLOR_POOL as MARKET_COLOR_POOL, PRODUCT_WATER_META as MARKET_WATER_META, productColorMeta as marketColorMeta, normalizeDistribution, deriveWaterDistribution, deriveSecondaryColor, deriveColorDistribution, deriveMaterialProfile, productGemColor as marketGemColor, itemReferenceValue as marketRefValue, listingElapsed as marketElapsed, productRarity as marketRarity } from "../../commerce/product-catalog.js";

export const MARKET_VIRTUAL_THRESHOLD = 40;

export const MARKET_STALLS = [
  { id: "all", label: "全部", color: "var(--jade)" },
  { id: "rough", label: "原石", color: "var(--q-bean)" },
  { id: "material", label: "明料", color: "var(--q-glutinous)" },
  { id: "slice", label: "片料", color: "var(--q-icy)" },
  { id: "bracelet", label: "成品", color: "var(--q-imperial)" },
  { id: "equipment", label: "设备", color: "var(--blue)" }
];

export const WANT_SCORE_LABELS = {
  1: "豆种起",
  2: "糯种起",
  3: "糯冰起",
  4: "正冰起",
  5: "高冰起",
  6: "玻璃种起"
};

export const KIND_OPTIONS = Object.keys(KIND_LABELS);

export function mlSteps(suggested) {
  const s = Math.max(1, Number(suggested) || 0);
  return {
    small: Math.max(100, Math.round(s * 0.01)),
    large: Math.max(1000, Math.round(s * 0.10))
  };
}
