import { isEquipmentItem } from "./equipment-view.js";
import { equipmentResaleValue } from "../equipment-trading.js";

export const PRODUCT_QUALITY = {
  bean: { name: "豆种", stars: "★", color: "var(--q-bean)", score: 1 },
  glutinous: { name: "糯种", stars: "★★", color: "var(--q-glutinous)", score: 2 },
  stickyIce: { name: "糯冰", stars: "★★★", color: "var(--q-sticky-ice)", score: 3 },
  ice: { name: "正冰", stars: "★★★★", color: "var(--q-ice)", score: 4 },
  highIce: { name: "高冰", stars: "★★★★★", color: "var(--q-high-ice)", score: 5 },
  glass: { name: "玻璃种", stars: "★★★★★★", color: "var(--q-glass)", score: 6 },
  violet: { name: "紫罗兰", stars: "★★★", color: "var(--q-violet)", score: 3 },
  red: { name: "红翡", stars: "★★★", color: "var(--q-red)", score: 3 },
  ink: { name: "墨翠", stars: "★★★", color: "var(--q-ink)", score: 3 }
};

export const QUALITY_KEY_ALIASES = { icy: "ice", imperial: "glass" };

export function productQualityKey(item = {}) {
  const color = String(item.color || "");
  if (color.includes("紫")) return "violet";
  if (color.includes("红")) return "red";
  if (color.includes("墨")) return "ink";
  const rawKey = item.qualityKey ? (QUALITY_KEY_ALIASES[item.qualityKey] || item.qualityKey) : "";
  if (rawKey && PRODUCT_QUALITY[rawKey]) return rawKey;
  const byScore = { 1: "bean", 2: "glutinous", 3: "stickyIce", 4: "ice", 5: "highIce", 6: "glass" };
  if (item.score != null) return byScore[Number(item.score)] || "glutinous";
  // 未开窗原石没有 qualityKey/score，从 hint 字符串推断可见种水
  const hint = String(item.hint || item.publicHint || "");
  if (hint.includes("玻璃种")) return "glass";
  if (hint.includes("高冰")) return "highIce";
  if (hint.includes("正冰") || hint.includes("冰种")) return "ice";
  if (hint.includes("糯冰") || hint.includes("冰糯")) return "stickyIce";
  if (hint.includes("糯种")) return "glutinous";
  if (hint.includes("豆种")) return "bean";
  return "glutinous";
}

export function productQualityMeta(item = {}) {
  return PRODUCT_QUALITY[productQualityKey(item)] || PRODUCT_QUALITY.glutinous;
}

export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

export const PRODUCT_COLOR_POOL = [
  { name: "帝王绿", color: "#0e7a3e" },
  { name: "阳绿", color: "#2fb557" },
  { name: "翠绿", color: "#1ba050" },
  { name: "苹果绿", color: "#4cb868" },
  { name: "豆绿", color: "#6fae66" },
  { name: "晴水", color: "#7fb8c9" },
  { name: "蓝水", color: "#5a93a3" },
  { name: "紫罗兰", color: "#8a6db0" },
  { name: "红翡", color: "#b5482f" },
  { name: "黄翡", color: "#d99a2b" },
  { name: "白冰", color: "#c0ccce" },
  { name: "油青", color: "#41615a" },
  { name: "墨翠", color: "#16331f" },
  { name: "飘蓝花", color: "#7fb8c9" },
  { name: "无色玻璃种", color: "#eef2f3" },
  { name: "底色/棉", color: "#c6d0c8" }
];

export const PRODUCT_WATER_META = {
  glass: { name: "玻璃种", color: "#5aa87a" },
  highIce: { name: "高冰", color: "#4fb89a" },
  ice: { name: "正冰", color: "#6fb89a" },
  stickyIce: { name: "糯冰", color: "#7eb89a" },
  glutinous: { name: "糯种", color: "#8fb59a" },
  bean: { name: "豆种", color: "#a8b8a0" }
};

export function productColorMeta(item = {}) {
  const color = String(item.color || "");
  const exact = PRODUCT_COLOR_POOL.find((c) => color.includes(c.name));
  if (exact) return exact;
  if (color.includes("紫")) return PRODUCT_COLOR_POOL.find((c) => c.name === "紫罗兰");
  if (color.includes("红")) return PRODUCT_COLOR_POOL.find((c) => c.name === "红翡");
  if (color.includes("黄")) return PRODUCT_COLOR_POOL.find((c) => c.name === "黄翡");
  if (color.includes("白") || color.includes("无色")) return PRODUCT_COLOR_POOL.find((c) => c.name === "白冰");
  if (color.includes("墨") || color.includes("黑")) return PRODUCT_COLOR_POOL.find((c) => c.name === "墨翠");
  if (color.includes("蓝")) return PRODUCT_COLOR_POOL.find((c) => c.name === "飘蓝花");
  const q = productQualityMeta(item).score;
  if (q >= 5) return PRODUCT_COLOR_POOL.find((c) => c.name === "阳绿");
  if (q >= 4) return PRODUCT_COLOR_POOL.find((c) => c.name === "翠绿");
  return PRODUCT_COLOR_POOL.find((c) => c.name === "豆绿");
}

export function normalizeDistribution(arr) {
  const total = arr.reduce((s, x) => s + x.pct, 0);
  if (total <= 0) return arr.map((x) => ({ ...x, pct: 0 }));
  const norm = arr.map((x) => ({ ...x, pct: Math.round((x.pct / total) * 100) }));
  // 处理四舍五入后总和误差，把差值加到最后一段
  const sum = norm.reduce((s, x) => s + x.pct, 0);
  if (sum !== 100 && norm.length) norm[norm.length - 1].pct += 100 - sum;
  return norm;
}

export function deriveWaterDistribution(qualityKey) {
  const order = ["bean", "glutinous", "stickyIce", "ice", "highIce", "glass"];
  const idx = order.indexOf(qualityKey);
  const main = PRODUCT_WATER_META[qualityKey] || PRODUCT_WATER_META.glutinous;
  const waters = [{ ...main, pct: 62 }];
  if (idx > 0) waters.push({ ...PRODUCT_WATER_META[order[idx - 1]], pct: 22 });
  if (idx < order.length - 1) waters.push({ ...PRODUCT_WATER_META[order[idx + 1]], pct: 10 });
  const otherPct = 100 - waters.reduce((s, w) => s + w.pct, 0);
  if (otherPct > 0) waters.push({ name: "其他", color: "#7a8a80", pct: otherPct });
  return normalizeDistribution(waters).filter((w) => w.pct > 0);
}

export function deriveSecondaryColor(main) {
  // 基于主色给一个常见伴生色
  const pairs = {
    "帝王绿": "阳绿",
    "阳绿": "翠绿",
    "翠绿": "苹果绿",
    "苹果绿": "豆绿",
    "豆绿": "底色/棉",
    "晴水": "白冰",
    "蓝水": "飘蓝花",
    "紫罗兰": "白冰",
    "红翡": "黄翡",
    "黄翡": "红翡",
    "白冰": "晴水",
    "油青": "墨翠",
    "墨翠": "油青",
    "飘蓝花": "白冰",
    "无色玻璃种": "晴水"
  };
  const name = pairs[main?.name] || "底色/棉";
  return PRODUCT_COLOR_POOL.find((c) => c.name === name) || PRODUCT_COLOR_POOL[PRODUCT_COLOR_POOL.length - 1];
}

export function deriveColorDistribution(item) {
  const main = productColorMeta(item);
  const second = deriveSecondaryColor(main);
  const colors = [
    { ...main, pct: 68 },
    { ...second, pct: 20 },
    { name: "底色/棉", color: "#c6d0c8", pct: 12 }
  ];
  return normalizeDistribution(colors).filter((c) => c.pct > 0);
}

export function deriveMaterialProfile(item = {}) {
  const evalData = item.openingEval || item.sourceMaterial?.openingEval || {};
  const stage = item.materialStage || item.stage || "rough";
  // 以 materialStage 为准；_type 只是库存分桶标记，不能决定物品是否已开窗/明料
  const isRough = stage === "rough";
  const qualityKey = productQualityKey(item);

  const waters = deriveWaterDistribution(qualityKey);
  const colors = deriveColorDistribution(item);

  let wastePct = Math.round((evalData.wasteRatio || 0) * 100);
  let crackPct = Math.round((evalData.crackRatio || 0) * 100);

  // 原石没有 openingEval，根据 visual 做一次合理推断
  if (isRough && wastePct === 0 && crackPct === 0) {
    const visual = item.visual || {};
    const cotton = visual.cotton ?? 0.4;
    const trans = visual.translucency ?? 0.5;
    wastePct = Math.round(clamp(cotton * 0.45 + (1 - trans) * 0.15, 0.06, 0.50) * 100);
    crackPct = Math.round(clamp((visual.crack ? 0.22 : 0) + (1 - trans) * 0.08, 0, 0.32) * 100);
  }

  // 暗料原石（未开窗）看不到内部种水/颜色，仅作占位
  const revealed = Boolean(item.revealed || (item.windows && item.windows.length));
  const sealed = isRough && !revealed;

  return { waters, colors, wastePct, crackPct, sealed, hasReference: !isRough };
}

export function productGemColor(item = {}) {
  const color = String(item.color || "");
  if (color.includes("紫")) return "violet";
  if (color.includes("红")) return "red";
  if (color.includes("墨")) return "ink";
  if (color.includes("帝王") || color.includes("黄")) return "gold";
  if (color.includes("白") || color.includes("无色")) return "white";
  const key = productQualityKey(item);
  if (key === "ice" || key === "highIce" || key === "stickyIce") return "ice";
  return "green";
}

export function itemReferenceValue(item = {}) {
  if (isEquipmentItem(item)) return equipmentResaleValue(item);
  return Number(item.value || item.price || 0);
}

export function listingElapsed(createdAt) {
  const ms = Date.now() - Number(createdAt || Date.now());
  if (ms < 60000) return "刚刚上架";
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)} 分钟前`;
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function productRarity(item = {}) {
  return productQualityMeta(item).score;
}
