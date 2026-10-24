// 交易行系统模块（从 main.js 抽离，依赖注入解耦，复用公盘样板）
// 内部状态 marketUi / marketFiltersBound 与常量 MARKET_* 均为本模块私有，不再污染 main.js 全局。

import { inlaySummary } from "../../product-meta.js";
import { equipmentResaleValue, equipmentSaleBlockReason, EQUIPMENT_STAGE_LABELS } from "../../equipment-trading.js";
import { isMarketEquipment, equipmentVisual, equipmentChips, equipmentProfile, equipmentCostRows, equipmentCard, equipmentIdentityCard } from "./equipment-view.js";
import { lazyPreviewMarkup, observeLazyPreviews } from "../../lazy-preview.js";
import { cutoutPreviewSignature, getPreviewBitmap, previewBitmapImgMarkup, preparePreviewBitmap } from "../../preview-bitmap-cache.js";
import { paintJadeCanvases } from "../../jade-renderer.js";
import { createVirtualGridController } from "../../virtual-grid.js";
import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { openGameModal, closeGameModal } from "../../shell/game-modal.js";
import { itemCost } from "../../../shared/domain/economy/item-cost.js";
import {
  wantMatchesItem,
  WANT_ITEM_TYPES,
  WANT_TYPE_LABELS,
  WANT_RULES
} from "../../jade-rules.js";
import { KIND_LABELS } from "../../jade-categories.js";
import {
  MARKET_TAX,
  MARKET_TAX_PERCENT,
  MARKET_LISTING_MIN_PRICE,
  MARKET_LISTING_PER_PLAYER_CAP
} from "../../market-rules.js";

let socketRef = null;
let getState = () => null;
let elsRef = null;
let getActiveView = () => "overview";
let formatMoney, escapeHtml, empty, showToast, typeName, productCanvas, openingStoneSvg, openingKitsForRender, jadeCanvasMarkup;

function openingKitsForItemVisual(item) {
  if (typeof openingKitsForRender !== "function" || !item) return [];
  try {
    const kits = openingKitsForRender(item);
    return Array.isArray(kits) ? kits : [];
  } catch {
    return [];
  }
}

// 交易行客户端 UI 状态（筛选/排序/页签/弹窗选中）
const marketUi = {
  section: "listings", // listings（集市挂单） | mine（我的挂单） | want（求购）
  cat: "all",
  search: "",
  sort: "latest",
  q: new Set(),
  equipmentStage: "", equipmentBrand: "", equipmentTech: "", equipmentCondition: "",
  min: null,
  max: null,
  afford: false,
  buyId: null,
  offerId: null,
  applyWantId: null,
  applyItemId: null,
  applyPrice: 100
};
const marketPriceDraft = { min: "", max: "" };
let marketFiltersBound = false;
let lastMarketRenderFp = "";
const MARKET_VIRTUAL_THRESHOLD = 40;
let marketVirtual = null;
let marketModalLifecycleCleanup = null;

function marketModalRoots() {
  return [
    elsRef?.marketListModal,
    elsRef?.marketBuyModal,
    elsRef?.marketWantPostModal,
    elsRef?.marketWantApplyModal
  ].filter(Boolean);
}

function openMarketModal(root, { initialFocus } = {}) {
  if (!root) return;
  marketModalLifecycleCleanup?.();
  marketModalLifecycleCleanup = null;
  marketModalRoots().forEach((modalRoot) => {
    if (modalRoot !== root) modalRoot.hidden = true;
  });
  const focusTarget = initialFocus ? root.querySelector(initialFocus) : null;
  focusTarget?.setAttribute("data-modal-initial-focus", "");
  root.hidden = false;
  marketModalLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    onClose: closeMarketModals
  });
  focusTarget?.removeAttribute("data-modal-initial-focus");
}

// 种水稀有度定义（key → 名称/星级/色阶；对齐 server.js qualities）
const MARKET_QUALITY = {
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
const MARKET_STALLS = [
  { id: "all", label: "全部", color: "var(--jade)" },
  { id: "rough", label: "原石", color: "var(--q-bean)" },
  { id: "material", label: "明料", color: "var(--q-glutinous)" },
  { id: "slice", label: "片料", color: "var(--q-icy)" },
  { id: "bracelet", label: "成品", color: "var(--q-imperial)" },
  { id: "equipment", label: "设备", color: "var(--blue)" }
];
const WANT_SCORE_LABELS = {
  1: "豆种起",
  2: "糯种起",
  3: "糯冰起",
  4: "正冰起",
  5: "高冰起",
  6: "玻璃种起"
};
const wantPostUi = {
  itemType: "bracelet",
  durationKey: "10m",
  rule: "lowest",
  minScore: 3,
  qualityKey: "",
  acceptedKinds: new Set(["bracelet"])
};
const KIND_OPTIONS = Object.keys(KIND_LABELS);
/* ---------- 交易行助手 ---------- */
// 解析种水 key：特色色（紫罗兰/红翡/墨翠）可单独筛；帝王绿是色不是种，不占种水 key
const QUALITY_KEY_ALIASES = { icy: "ice", imperial: "glass" };
export function marketQualityKey(item = {}) {
  const color = String(item.color || "");
  if (color.includes("紫")) return "violet";
  if (color.includes("红")) return "red";
  if (color.includes("墨")) return "ink";
  const rawKey = item.qualityKey ? (QUALITY_KEY_ALIASES[item.qualityKey] || item.qualityKey) : "";
  if (rawKey && MARKET_QUALITY[rawKey]) return rawKey;
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
export function marketQualityMeta(item = {}) {
  return MARKET_QUALITY[marketQualityKey(item)] || MARKET_QUALITY.glutinous;
}

// 辅助：限制数值范围
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

// 颜色样本池（与 jade-opening-engine.js PALETTES 对齐主要色调，用于分布图）
const MARKET_COLOR_POOL = [
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
const MARKET_WATER_META = {
  glass: { name: "玻璃种", color: "#5aa87a" },
  highIce: { name: "高冰", color: "#4fb89a" },
  ice: { name: "正冰", color: "#6fb89a" },
  stickyIce: { name: "糯冰", color: "#7eb89a" },
  glutinous: { name: "糯种", color: "#8fb59a" },
  bean: { name: "豆种", color: "#a8b8a0" }
};

function marketColorMeta(item = {}) {
  const color = String(item.color || "");
  const exact = MARKET_COLOR_POOL.find((c) => color.includes(c.name));
  if (exact) return exact;
  if (color.includes("紫")) return MARKET_COLOR_POOL.find((c) => c.name === "紫罗兰");
  if (color.includes("红")) return MARKET_COLOR_POOL.find((c) => c.name === "红翡");
  if (color.includes("黄")) return MARKET_COLOR_POOL.find((c) => c.name === "黄翡");
  if (color.includes("白") || color.includes("无色")) return MARKET_COLOR_POOL.find((c) => c.name === "白冰");
  if (color.includes("墨") || color.includes("黑")) return MARKET_COLOR_POOL.find((c) => c.name === "墨翠");
  if (color.includes("蓝")) return MARKET_COLOR_POOL.find((c) => c.name === "飘蓝花");
  const q = marketQualityMeta(item).score;
  if (q >= 5) return MARKET_COLOR_POOL.find((c) => c.name === "阳绿");
  if (q >= 4) return MARKET_COLOR_POOL.find((c) => c.name === "翠绿");
  return MARKET_COLOR_POOL.find((c) => c.name === "豆绿");
}

function normalizeDistribution(arr) {
  const total = arr.reduce((s, x) => s + x.pct, 0);
  if (total <= 0) return arr.map((x) => ({ ...x, pct: 0 }));
  const norm = arr.map((x) => ({ ...x, pct: Math.round((x.pct / total) * 100) }));
  // 处理四舍五入后总和误差，把差值加到最后一段
  const sum = norm.reduce((s, x) => s + x.pct, 0);
  if (sum !== 100 && norm.length) norm[norm.length - 1].pct += 100 - sum;
  return norm;
}

function deriveWaterDistribution(qualityKey) {
  const order = ["bean", "glutinous", "stickyIce", "ice", "highIce", "glass"];
  const idx = order.indexOf(qualityKey);
  const main = MARKET_WATER_META[qualityKey] || MARKET_WATER_META.glutinous;
  const waters = [{ ...main, pct: 62 }];
  if (idx > 0) waters.push({ ...MARKET_WATER_META[order[idx - 1]], pct: 22 });
  if (idx < order.length - 1) waters.push({ ...MARKET_WATER_META[order[idx + 1]], pct: 10 });
  const otherPct = 100 - waters.reduce((s, w) => s + w.pct, 0);
  if (otherPct > 0) waters.push({ name: "其他", color: "#7a8a80", pct: otherPct });
  return normalizeDistribution(waters).filter((w) => w.pct > 0);
}

function deriveSecondaryColor(main) {
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
  return MARKET_COLOR_POOL.find((c) => c.name === name) || MARKET_COLOR_POOL[MARKET_COLOR_POOL.length - 1];
}

function deriveColorDistribution(item) {
  const main = marketColorMeta(item);
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
  const qualityKey = marketQualityKey(item);

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

  return { waters, colors, wastePct, crackPct, sealed };
}

// 原石、明料和片料共用开料 SVG；取件后的毛坯与成品使用成品轮廓。
export function marketItemPreviewKey(item = {}) {
  return JSON.stringify([
    "mkt-v2", item.id, item.name, item.materialStage || item.stage || "rough", item.type, item._type,
    item.kind, item.productType, item.size, item.ringSize, item.qualityKey, item.quality, item.color,
    item.openingSeed, item.visual, item.sourceMaterial, item.jadePiece?.signature,
    item.polished, item.finish, item.inlay, item.components, item.revealed, item.windows,
    cutoutPreviewSignature(openingKitsForItemVisual(item))
  ]);
}

export function prepareMarketItemVisual(item, options = {}) {
  const key = marketItemPreviewKey(item);
  return preparePreviewBitmap(key, () => {
    const template = document.createElement("template");
    template.innerHTML = marketItemVisual(item, { eager: true });
    // Legacy canvases need the connected renderer; an unpainted canvas would
    // otherwise become a permanently blank cached product.
    return template.content.querySelector("svg") ? template.content : null;
  }, { ...options, isCurrent: () => (!options.isCurrent || options.isCurrent()) && marketItemPreviewKey(item) === key });
}

export function marketItemVisual(item = {}, options = {}) {
  if (isMarketEquipment(item)) return equipmentVisual(item, escapeHtml);
  const eager = options.eager || options.lazy === false;
  const cacheKey = eager ? "" : marketItemPreviewKey(item);
  const cached = cacheKey && getPreviewBitmap(cacheKey);
  if (cached) return previewBitmapImgMarkup(cached);
  const stage = item.materialStage || item.stage || "rough";
  const isSlice = item.type === "slice" || item._type === "slice";
  const isStoneLike = isSlice || (
    stage === "rough"
    || stage === "opened"
    || stage === "material"
    || item.type === "material"
    || item._type === "material"
  );
  let inner;
  try {
    if (isStoneLike && openingStoneSvg) {
      const revealed = isSlice || stage === "opened"
        || stage === "material"
        || item.type === "material"
        || item._type === "material"
        || Boolean(item.revealed || (item.windows && item.windows.length));
      const kits = openingKitsForItemVisual(item);
      inner = openingStoneSvg(item, { revealed, kits });
    } else {
      inner = productCanvas ? productCanvas(item, "inventory") : "";
    }
  } catch (e) {
    inner = "";
  }
  const visual = inner || `<div class="jm-gem ${marketGemColor(item)}"></div>`;
  const wrapped = `<div class="jm-visual">${visual}</div>`;
  if (eager) return wrapped;
  return lazyPreviewMarkup(wrapped, {
    tint: item?.visual?.skin || item?.visual?.vein || "",
    cacheKey,
    bitmapOnly: options.bitmapOnly
  });
}

/** 阶段标签：暗料 / 明料·已开窗 / 其他桶类型名 */
function marketStageLabel(item = {}, listingType = "") {
  const stage = item.materialStage || item.stage || "rough";
  const revealed = Boolean(item.revealed || (item.windows && item.windows.length));
  if (stage === "rough" && !revealed) return "暗料原石 · 未开窗";
  if (stage === "rough" && revealed) return "原石 · 已开窗";
  if (stage === "opened" || listingType === "material") return "明料 · 已开窗";
  return typeName(listingType || item._type || item.type, item);
}

/** 列表卡公开属性行：暗料用皮壳提示；明料/成品用种水星级 + 颜色 */
export function marketCardAttrChips(item = {}, listingType = "", profile = null) {
  const stageChip = `<span class="jm-chip jm-chip-stage">${escapeHtml(marketStageLabel(item, listingType))}</span>`;
  if (profile?.sealed) {
    const hint = String(item.publicHint || item.hint || "").trim();
    const mass = Number(item.mass);
    const massChip = Number.isFinite(mass) && mass > 0
      ? `<span class="jm-chip">${mass.toFixed(2)} kg</span>`
      : "";
    const hintChip = hint ? `<span class="jm-chip jm-chip-hint" title="${escapeHtml(hint)}">${escapeHtml(hint)}</span>` : "";
    return `<div class="jm-chips">${stageChip}${hintChip}${massChip}</div>`;
  }
  const q = marketQualityMeta(item);
  const qLabel = escapeHtml(item.quality || q.name);
  const color = item.color ? `<span class="jm-chip">${escapeHtml(item.color)}</span>` : "";
  return `<div class="jm-chips">${stageChip}<span class="jm-chip jm-chip-q">${qLabel} ${q.stars}</span>${color}</div>`;
}

/** 列表卡料情摘要：暗料一行短提示；明料只显示有缺陷时的废料/裂 */
export function marketCardProfile(item = {}, profile = null) {
  if (!profile) return "";
  if (profile.sealed) {
    return `<div class="jm-sealed-note is-compact">暗料 · 种水未揭露</div>`;
  }
  const defects = [];
  if (profile.wastePct > 0) defects.push(`<span class="jm-defect waste">废料 ${profile.wastePct}%</span>`);
  if (profile.crackPct > 0) defects.push(`<span class="jm-defect crack">裂 ${profile.crackPct}%</span>`);
  if (!defects.length) return "";
  return `<div class="jm-profile-defects">${defects.join("")}</div>`;
}

// 分布：纯文本 + 颜色标（挂牌详情等完整视图）；暗料原石说明未揭露
export function marketProfileChips(profile) {
  if (!profile) return "";
  if (profile.sealed) {
    return `<div class="jm-sealed-note">暗料 · 种水与颜色未揭露</div>`;
  }
  const rows = (segs) => segs.map((s) => `<span class="jm-pchip"><i style="background:${s.color}"></i>${escapeHtml(s.name)} ${s.pct}%</span>`).join("");
  const defects = [];
  if (profile.wastePct > 0) defects.push(`<span class="jm-defect waste">废料 ${profile.wastePct}%</span>`);
  if (profile.crackPct > 0) defects.push(`<span class="jm-defect crack">裂 ${profile.crackPct}%</span>`);
  return `
    <div class="jm-profile">
      <div class="jm-profile-row">
        <span class="jm-profile-label">种水分布</span>
        <div class="jm-chips-line">${rows(profile.waters)}</div>
      </div>
      <div class="jm-profile-row">
        <span class="jm-profile-label">颜色分布</span>
        <div class="jm-chips-line">${rows(profile.colors)}</div>
      </div>
      ${defects.length ? `<div class="jm-profile-defects">${defects.join("")}</div>` : ""}
    </div>`;
}

// 立绘颜色类
export function marketGemColor(item = {}) {
  const color = String(item.color || "");
  if (color.includes("紫")) return "violet";
  if (color.includes("红")) return "red";
  if (color.includes("墨")) return "ink";
  if (color.includes("帝王") || color.includes("黄")) return "gold";
  if (color.includes("白") || color.includes("无色")) return "white";
  const key = marketQualityKey(item);
  if (key === "ice" || key === "highIce" || key === "stickyIce") return "ice";
  return "green";
}
export function marketRefValue(item = {}) {
  if (isMarketEquipment(item)) return equipmentResaleValue(item);
  return Number(item.value || item.price || 0);
}
export function marketPriceDelta(price, ref) {
  const diff = Number(price) - Number(ref || 0);
  if (!ref) return { cls: "flat", txt: "无参考价" };
  if (diff < -1) return { cls: "down", txt: `↓ 便宜 ${formatMoney(-diff)}` };
  if (diff > ref * 0.08) return { cls: "up", txt: `↑ 偏贵 ${formatMoney(diff)}` };
  return { cls: "flat", txt: "接近参考价" };
}

/** 从排行榜/玩家列表取卖家公开声望、等级 */
function marketSellerMeta(ownerId, ownerName = "") {
  const players = getState()?.players || [];
  const hit = getState()?.marketPlayers?.[ownerId] || players.find((p) => p.id === ownerId);
  if (!hit) return { name: ownerName || "未知卖家", rep: null, level: null };
  return {
    name: hit.name || ownerName || "未知卖家",
    rep: Number.isFinite(Number(hit.rep)) ? Math.round(Number(hit.rep)) : null,
    level: Number.isFinite(Number(hit.level)) ? Number(hit.level) : null
  };
}

function marketSellerLine(ownerId, ownerName = "", options = {}) {
  const seller = marketSellerMeta(ownerId, ownerName);
  const bits = [escapeHtml(seller.name)];
  if (!options.compact) {
    if (seller.level != null) bits.push(`Lv.${seller.level}`);
    if (seller.rep != null) bits.push(`声望 ${seller.rep}`);
  }
  return bits.join(" · ");
}

export function marketElapsed(createdAt) {
  const ms = Date.now() - Number(createdAt || Date.now());
  if (ms < 60000) return "刚刚上架";
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)} 分钟前`;
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}
// 汇总玩家可挂牌库存（原石/明料/片料/成品四桶）
export function marketSellables() {
  const me = getState().me;
  return [
    ...(me.rough || []).map((item) => ({ ...item, _type: "rough" })),
    ...(me.materials || []).map((item) => ({ ...item, _type: "material" })),
    ...(me.slices || []).map((item) => ({ ...item, _type: "slice" })),
    ...(me.bracelets || []).map((item) => ({ ...item, _type: "bracelet" })),
    ...(me.workshop?.devices || []).filter((device) => !equipmentSaleBlockReason(me, device, getState())).map((item) => ({ ...item, _type: "equipment" }))
  ];
}
export function marketAffordable(price) {
  return Number(getState().me.cash || 0) >= Math.round(Number(price) * (1 + MARKET_TAX));
}

// ---- 挂牌弹窗客户端状态（筛选/排序/选中/价格步进）----
const mlUi = {
  search: "",
  cat: "all",
  sort: "valueDesc",
  selectedId: null,
  price: 0,
  priceTouched: false,
  stepSmall: 100,
  stepLarge: 1000
};

// 价格步进幅度：基于建议价，小步 = 1%、大步 = 10%（与用户给定锚点一致：
// 建议价 1 万 → 100 / 1000；建议价 10 万 → 1000 / 10000），下限 100 / 1000。
export function mlSteps(suggested) {
  const s = Math.max(1, Number(suggested) || 0);
  return {
    small: Math.max(100, Math.round(s * 0.01)),
    large: Math.max(1000, Math.round(s * 0.10))
  };
}

function marketRarity(item = {}) {
  return marketQualityMeta(item).score;
}

/* ---------- 交易行主渲染 ---------- */
export function renderMarket() {
  if (!elsRef?.marketGrid || !getState()) return;
  bindMarketOnce();

  const all = getState().listings;
  const mine = all.filter((l) => l.ownerId === getState().me.id);
  const sellables = marketSellables();
  const wants = getState().wants || [];
  const fp = [
    marketUi.section,
    marketUi.cat,
    marketUi.search,
    marketUi.sort,
    [...marketUi.q].join(","),
    marketUi.equipmentStage, marketUi.equipmentBrand, marketUi.equipmentTech, marketUi.equipmentCondition,
    marketUi.min ?? "",
    marketUi.max ?? "",
    marketUi.afford ? 1 : 0,
    getState().me?.cash ?? 0,
    all.map((listing) => `${listing.id}:${listing.price}:${listing.ownerId}:${listing.item?.id || ""}:${listing.npcOffer?.id || ""}`).join("|"),
    sellables.map((item) => item.id).join(","),
    wants.map((w) => `${w.id}:${w.expiresAt}:${(w.offers || []).map((o) => `${o.id}:${o.price}`).join(",")}`).join("|"),
    Date.now() - (wants[0]?.expiresAt || 0) < 0 ? 0 : Math.floor(Date.now() / 60000)
  ].join("::");
  if (fp === lastMarketRenderFp && elsRef.marketGrid.childElementCount) return;
  lastMarketRenderFp = fp;

  if (elsRef.marketMineCnt) elsRef.marketMineCnt.textContent = mine.length;

  renderMarketStalls();
  renderMarketFilters();
  syncMarketFilterInputs();
  renderMarketSection(all, mine);
}

// 根据当前区段（集市 / 我的挂单 / 求购）切换主区内容
export function renderMarketSection(listings, mine) {
  const sec = marketUi.section;
  const isList = sec === "listings";
  if (elsRef.marketShop) elsRef.marketShop.classList.toggle("solo", !isList);
  // 头图「我的挂单」按钮高亮
  document.querySelector('[data-market-section="mine"]')?.classList.toggle("active", sec === "mine");
  if (sec === "mine") {
    elsRef.marketGrid.className = "jm-grid";
    renderMarketMine(mine);
  } else if (sec === "want") {
    elsRef.marketGrid.className = "jm-grid as-wants";
    renderMarketWants();
  } else {
    elsRef.marketGrid.className = "jm-grid";
    renderMarketGrid(listings);
  }
}

export function renderMarketStalls() {
  const cats = MARKET_STALLS.map((s) =>
    `<button class="jm-stall ${marketUi.section === "listings" && s.id === marketUi.cat ? "active" : ""}" data-action="marketStall" data-market-cat="${s.id}" type="button" aria-pressed="${marketUi.section === "listings" && s.id === marketUi.cat}"><span class="dot" style="background:${s.color}"></span>${s.label}</button>`
  ).join("");
  const wants = getState().wants || [];
  const want = `<button class="jm-stall jm-stall-want ${marketUi.section === "want" ? "active" : ""}" data-action="marketSection" data-market-section="want" type="button" aria-pressed="${marketUi.section === "want"}"><span class="dot" style="background:var(--blue)"></span>求购 <span class="jm-stall-cnt">${wants.length}</span></button>`;
  elsRef.marketStalls.innerHTML = cats + want;
}

export function renderMarketFilters() {
  const equipment = marketUi.section === "listings" && marketUi.cat === "equipment";
  elsRef.marketQFilters.classList?.toggle("is-equipment", equipment);
  const label = elsRef.marketQFilters.closest?.(".jm-fgroup-quality")?.querySelector("label");
  if (label) label.textContent = equipment ? "设备筛选" : "种水";
  if (equipment) {
    const brands = [...new Map([...(getState().equipmentCatalog || []), ...(getState().listings || []).filter((row) => row.type === "equipment").map((row) => row.item)].map((row) => [row.brandKey, row.brand])).entries()].filter(([key]) => key);
    const select = (key, title, rows) => `<select data-equipment-filter="${key}" aria-label="${title}"><option value="">${title}</option>${rows.map(([value, text]) => `<option value="${escapeHtml(String(value))}" ${marketUi[key] === String(value) ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select>`;
    elsRef.marketQFilters.innerHTML = select("equipmentStage", "全部工序", Object.entries(EQUIPMENT_STAGE_LABELS)) + select("equipmentBrand", "全部品牌", brands) + select("equipmentTech", "科技等级", [1, 2, 3].map((level) => [level, `科技 ${level} 级`])) + select("equipmentCondition", "全部耐久", [["80", "耐久 ≥80%"], ["50", "耐久 ≥50%"], ["0", "需维修（0%）"]]);
  } else {
  const order = ["glass", "highIce", "ice", "stickyIce", "violet", "red", "ink", "glutinous", "bean"];
  elsRef.marketQFilters.innerHTML = order.map((k) => {
    const on = marketUi.q.has(k);
    return `<button type="button" class="jm-qchip ${on ? "on" : ""}" data-action="marketQ" data-market-q="${k}" aria-pressed="${on}" style="${on ? `background:${MARKET_QUALITY[k].color}` : ""}">${MARKET_QUALITY[k].name}</button>`;
  }).join("");
  }
  if (elsRef.marketAfford) {
    elsRef.marketAfford.classList.toggle("on", marketUi.afford);
    elsRef.marketAfford.setAttribute("aria-checked", marketUi.afford ? "true" : "false");
  }
}

function marketActiveFilterCount() {
  return Number(marketUi.cat !== "all")
    + marketUi.q.size
    + [marketUi.equipmentStage, marketUi.equipmentBrand, marketUi.equipmentTech, marketUi.equipmentCondition].filter(Boolean).length
    + Number(marketUi.min != null)
    + Number(marketUi.max != null)
    + Number(marketUi.afford)
    + Number(Boolean(marketUi.search));
}

function updateMarketResultStatus(count, noun = "条结果") {
  if (!elsRef.marketResultStatus) return;
  const active = marketActiveFilterCount();
  elsRef.marketResultStatus.textContent = `${count} ${noun}${active ? ` · ${active} 项筛选` : ""}`;
  elsRef.marketResultStatus.classList.toggle("is-filtered", active > 0);
}

export function marketFilterSort(list) {
  let arr = list.slice();
  if (marketUi.cat !== "all") arr = arr.filter((l) => l.type === marketUi.cat);
  if (marketUi.q.size) arr = arr.filter((l) => marketUi.q.has(marketQualityKey(l.item)));
  if (marketUi.cat === "equipment") {
    if (marketUi.equipmentStage) arr = arr.filter((l) => l.item.stage === marketUi.equipmentStage);
    if (marketUi.equipmentBrand) arr = arr.filter((l) => l.item.brandKey === marketUi.equipmentBrand);
    if (marketUi.equipmentTech) arr = arr.filter((l) => String(l.item.techLevel) === marketUi.equipmentTech);
    if (marketUi.equipmentCondition) arr = arr.filter((l) => marketUi.equipmentCondition === "0" ? Number(l.item.condition) === 0 : Number(l.item.condition) >= Number(marketUi.equipmentCondition));
  }
  if (marketUi.min != null) arr = arr.filter((l) => l.price >= marketUi.min);
  if (marketUi.max != null) arr = arr.filter((l) => l.price <= marketUi.max);
  if (marketUi.afford) arr = arr.filter((l) => marketAffordable(l.price));
  if (marketUi.search) {
    const q = marketUi.search.toLowerCase();
    arr = arr.filter((l) =>
      String(l.item.name).toLowerCase().includes(q) ||
      String(l.ownerName).toLowerCase().includes(q) ||
      String(l.item.quality || "").toLowerCase().includes(q) ||
      String(l.item.color || "").toLowerCase().includes(q));
  }
  if (marketUi.sort === "priceAsc") arr.sort((a, b) => a.price - b.price);
  else if (marketUi.sort === "priceDesc") arr.sort((a, b) => b.price - a.price);
  else if (marketUi.sort === "deal") arr.sort((a, b) => (a.price - marketRefValue(a.item)) - (b.price - marketRefValue(b.item)));
  else arr.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return arr;
}

export function marketCardHtml(listing, isMine = false) {
  const item = listing.item;
  if (listing.type === "equipment") return equipmentCard(listing, isMine, { escapeHtml, formatMoney, total: listing.price + Math.round(listing.price * MARKET_TAX), can: marketAffordable(listing.price), seller: marketSellerLine(listing.ownerId, listing.ownerName, { compact: true }), elapsed: marketElapsed(listing.createdAt) });
  const q = marketQualityMeta(item);
  const qk = marketQualityKey(item);
  const can = marketAffordable(listing.price);
  const summary = inlaySummary(item);
  const profile = deriveMaterialProfile(item);
  const ref = marketRefValue(item);
  const delta = marketPriceDelta(listing.price, ref);
  const taxPay = Math.round(Number(listing.price) * (1 + MARKET_TAX));
  const badges = [];
  if (isMine) {
    badges.push(`<span class="jm-badge mine">我的挂单</span>`);
  } else if (Date.now() - Number(listing.createdAt || 0) < 3600000) {
    badges.push(`<span class="jm-badge new">新上</span>`);
  }
  if (profile.sealed) {
    badges.push(`<span class="jm-badge sealed">暗料</span>`);
  } else if (listing.type === "material" || listing.type === "rough" || item.materialStage === "opened" || item.materialStage === "rough") {
    // 与集市卡一致：明料/原石阶段角标
    const stage = item.materialStage || (listing.type === "material" ? "opened" : "rough");
    const opened = stage === "opened" || listing.type === "material" || Boolean(item.revealed || item.windows?.length);
    badges.push(opened
      ? `<span class="jm-badge opened">明料</span>`
      : `<span class="jm-badge sealed">暗料</span>`);
  } else if (listing.type === "slice") {
    badges.push(`<span class="jm-badge stage">片料</span>`);
  } else if (listing.type === "bracelet") {
    badges.push(`<span class="jm-badge stage">成品</span>`);
  }
  const actionBtn = isMine
    ? `${listing.npcOffer ? `<button class="jm-buy" data-action="openMarketOffer" data-payload="${escapeHtml(listing.id)}" type="button">批发商报价 · ${formatMoney(listing.npcOffer.amount)}</button>` : ""}<button class="jm-buy jm-buy-mine" data-action="withdrawListing" data-payload="${escapeHtml(listing.id)}" type="button">撤单</button>`
    : `<button class="jm-buy${can ? "" : " jm-buy-preview"}" data-action="openMarketBuy" data-payload="${escapeHtml(listing.id)}" type="button" aria-label="${escapeHtml(can
      ? `买入${item.name}，需支付${formatMoney(taxPay)}`
      : `查看${item.name}交易详情，现金不足，需支付${formatMoney(taxPay)}`)}">${can ? `买入 · ${formatMoney(taxPay)}` : "查看详情 · 现金不足"}</button>`;
  const ribbon = !profile.sealed && q.score >= 4
    ? `<div class="jm-ribbon" style="background:${q.color}">${escapeHtml(item.quality || q.name)}<span class="stars">${q.stars}</span></div>`
    : "";
  const cardAction = isMine
    ? ""
    : ` data-action="openMarketBuy" data-payload="${escapeHtml(listing.id)}"`;
  return `
  <article class="jm-card ${can ? "" : "locked"} q-score-${q.score} ${q.score >= 5 ? "q-legend" : ""} ${isMine ? "is-mine" : ""} ${profile.sealed ? "is-sealed" : ""}${isMine ? "" : " is-buyable"}" data-q="${qk}"${cardAction}>
    <div class="jm-art">
      ${ribbon}
      ${badges.length ? `<div class="jm-badges">${badges.join("")}</div>` : ""}
      ${marketItemVisual(item)}
    </div>
    <div class="jm-body">
      <div class="jm-nm">${escapeHtml(item.name)}</div>
      ${marketCardAttrChips(item, listing.type, profile)}
      ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
      ${marketCardProfile(item, profile)}
      <div class="jm-price-block">
        <span class="jm-price">${formatMoney(listing.price)}</span>
        <span class="jm-delta ${delta.cls}">${escapeHtml(delta.txt)}</span>
      </div>
      <div class="jm-price-meta">
        <span>参考 ${formatMoney(ref)}${isMine ? "" : ` · 含税约 ${formatMoney(taxPay)}`}</span>
      </div>
      <div class="jm-seller">
        <span class="who" title="${escapeHtml(listing.ownerName || "")}">🏪 ${marketSellerLine(listing.ownerId, listing.ownerName, { compact: true })}</span>
        <span class="when">${marketElapsed(listing.createdAt)}</span>
      </div>
      ${actionBtn}
    </div>
  </article>`;
}

export function renderMarketGrid(listings) {
  const meId = getState().me.id;
  const arr = marketFilterSort(listings);
  const includeWants = marketUi.section === "listings" && marketUi.cat === "all";
  const wants = includeWants ? filterWantsForBrowse(getState().wants || []) : [];
  updateMarketResultStatus(arr.length + wants.length, "条交易");

  if (!arr.length && !wants.length) {
    marketVirtual?.destroy();
    marketVirtual = null;
    elsRef.marketGrid.classList?.remove?.("virtual-grid-host", "as-wants", "as-feed");
    const hasAnyListing = (getState().listings || []).length > 0;
    const hasAnyWant = (getState().wants || []).length > 0;
    const emptyText = (hasAnyListing || hasAnyWant)
      ? "没有符合条件的挂单或求购，调整筛选或搜索试试。"
      : "玩家交易行还没有挂单，也没有求购。等别人上货、发求购，或自己先挂一件。";
    elsRef.marketGrid.innerHTML = `
      <div class="jm-empty game-empty-state">
        <span class="game-empty-state-mark" aria-hidden="true">玉</span>
        <strong>${hasAnyListing || hasAnyWant ? "暂时没有匹配结果" : "交易行还在等第一批货"}</strong>
        <p>${emptyText}</p>
        ${hasAnyListing || hasAnyWant
          ? `<button class="secondary" type="button" data-action="resetMarketFilters">清除筛选</button>`
          : `<button type="button" data-action="openMarketListModal">挂牌第一件商品</button>`}
      </div>`;
    return;
  }

  // 「全部」混入求购：按时间/价格与挂单一起排，不用虚拟列表（卡片高度差异大）
  if (wants.length) {
    marketVirtual?.destroy();
    marketVirtual = null;
    elsRef.marketGrid.classList?.remove?.("virtual-grid-host");
    elsRef.marketGrid.classList?.add?.("as-feed");
    const feed = [
      ...arr.map((listing) => ({
        kind: "listing",
        at: Number(listing.createdAt) || 0,
        price: Number(listing.price) || 0,
        deal: (Number(listing.price) || 0) - marketRefValue(listing.item),
        listing
      })),
      ...wants.map((want) => ({
        kind: "want",
        at: Number(want.createdAt) || 0,
        price: Number(want.budget) || 0,
        deal: 0,
        want
      }))
    ];
    if (marketUi.sort === "priceAsc") feed.sort((a, b) => a.price - b.price || b.at - a.at);
    else if (marketUi.sort === "priceDesc") feed.sort((a, b) => b.price - a.price || b.at - a.at);
    else if (marketUi.sort === "deal") feed.sort((a, b) => a.deal - b.deal || b.at - a.at);
    else feed.sort((a, b) => b.at - a.at);
    elsRef.marketGrid.innerHTML = feed.map((row) =>
      row.kind === "want"
        ? wantCardHtml(row.want)
        : marketCardHtml(row.listing, row.listing.ownerId === meId)
    ).join("");
    if (arr.length) {
      paintJadeCanvases(elsRef.marketGrid);
      observeLazyPreviews(elsRef.marketGrid);
    }
    return;
  }

  elsRef.marketGrid.classList?.remove?.("as-feed", "as-wants");
  if (
    arr.length >= MARKET_VIRTUAL_THRESHOLD
    && !elsRef.marketGrid.classList?.contains?.("as-list")
    && typeof elsRef.marketGrid.classList?.add === "function"
  ) {
    if (!marketVirtual) marketVirtual = createVirtualGridController({
      minItemWidth: 210,
      gap: 16,
      estimateRowHeight: 360,
      overscanRows: 1
    });
    if (!elsRef.marketGrid.classList.contains("virtual-grid-host")) marketVirtual.mount(elsRef.marketGrid);
    marketVirtual.setItems(arr, (listing) => marketCardHtml(listing, listing.ownerId === meId), (windowEl) => {
      paintJadeCanvases(windowEl);
      observeLazyPreviews(windowEl);
    });
    return;
  }
  marketVirtual?.destroy();
  marketVirtual = null;
  elsRef.marketGrid.classList?.remove?.("virtual-grid-host");
  elsRef.marketGrid.innerHTML = arr.map((listing) => marketCardHtml(listing, listing.ownerId === meId)).join("");
  paintJadeCanvases(elsRef.marketGrid);
  observeLazyPreviews(elsRef.marketGrid);
}

export function renderMarketMine(mine) {
  marketVirtual?.destroy();
  marketVirtual = null;
  elsRef.marketGrid.classList?.remove?.("virtual-grid-host");
  if (!mine.length) {
    elsRef.marketGrid.innerHTML = `
      <div class="jm-mine-empty">
        <b>还没有挂单</b>
        <p>把库存上架到交易行，等买家来成交。成交后买家另付 ${MARKET_TAX_PERCENT}% 市场税。</p>
        <button class="jm-hero-btn primary" data-action="openMarketListModal" type="button">＋ 挂牌出售</button>
      </div>`;
    return;
  }
  const slotsLeft = Math.max(0, MARKET_LISTING_PER_PLAYER_CAP - mine.length);
  const totalValue = mine.reduce((sum, l) => sum + Number(l.price || 0), 0);
  // 与集市在售同一套竖向卡片；汇总条通栏，不再放「继续挂牌」（顶栏已有挂牌出售）
  elsRef.marketGrid.innerHTML = `
    <div class="jm-mine-summary jm-mine-summary-span">
      <div class="jm-mine-summary-copy">
        <strong>我的挂单</strong>
        <span>${mine.length}/${MARKET_LISTING_PER_PLAYER_CAP} 栏位 · 挂出价合计 ${formatMoney(totalValue)} · 剩余 ${slotsLeft} 栏</span>
      </div>
    </div>
    ${mine.map((l) => marketCardHtml(l, true)).join("")}`;
  observeLazyPreviews(elsRef.marketGrid);
}

function wantRemainLabel(expiresAt) {
  const end = Number(expiresAt || 0);
  if (end <= 0) return "长期征集";
  const ms = end - Date.now();
  if (ms <= 0) return "即将结算";
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `剩余 ${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `剩余 ${hours} 小时 ${rem} 分` : `剩余 ${hours} 小时`;
}

function wantRuleLabel(want) {
  if (want.durationKey === "long") return "长期收";
  return WANT_RULES[want.rule]?.label || "价低者得";
}

function wantKindsSummary(want) {
  const type = (want.itemTypes || [])[0] || "bracelet";
  if (type === "bracelet") {
    const kinds = Array.isArray(want.acceptedKinds) ? want.acceptedKinds : [];
    const totalKinds = KIND_OPTIONS.length || 12;
    if (!kinds.length || kinds.length >= Math.max(8, Math.floor(totalKinds * 0.85))) {
      return { label: "题材", text: "不限" };
    }
    const names = kinds.map((k) => KIND_LABELS[k] || k);
    if (names.length <= 3) return { label: "题材", text: names.join("、") };
    return { label: "题材", text: `${names.slice(0, 3).join("、")} 等 ${names.length} 种` };
  }
  if (want.qualityKey && MARKET_QUALITY[want.qualityKey]) {
    return { label: "指定", text: MARKET_QUALITY[want.qualityKey].name };
  }
  return null;
}

function wantCoreChips(want) {
  const type = (want.itemTypes || [])[0] || "bracelet";
  const chips = [WANT_TYPE_LABELS[type] || type];
  const scoreLabel = WANT_SCORE_LABELS[want.minScore] || `种水≥${want.minScore}`;
  chips.push(scoreLabel);
  chips.push(wantRuleLabel(want));
  return chips.filter(Boolean).slice(0, 3);
}

function wantRequirementText(want) {
  const type = (want.itemTypes || [])[0] || "bracelet";
  const typeLabel = WANT_TYPE_LABELS[type] || type;
  const scoreLabel = WANT_SCORE_LABELS[want.minScore] || `种水≥${want.minScore}`;
  const parts = [`${typeLabel} · ${scoreLabel}`, `预算 ≤ ${formatMoney(want.budget)}`];
  if (type === "bracelet" && (want.acceptedKinds || []).length) {
    parts.push(`题材：${want.acceptedKinds.map((k) => KIND_LABELS[k] || k).join("、")}`);
  } else if (want.qualityKey && MARKET_QUALITY[want.qualityKey]) {
    parts.push(`指定：${MARKET_QUALITY[want.qualityKey].name}`);
  }
  if (want.note) parts.push(want.note);
  return parts.join(" · ");
}

function sortOffersPreview(offers = []) {
  return offers.slice().sort((a, b) => Number(a.price) - Number(b.price) || Number(a.createdAt) - Number(b.createdAt));
}

function wantLowestOffer(want) {
  return sortOffersPreview(want.offers || [])[0] || null;
}

function filterWantsForBrowse(wants = []) {
  let arr = wants.slice();
  if (marketUi.q.size) {
    arr = arr.filter((w) => !w.qualityKey || marketUi.q.has(w.qualityKey));
  }
  if (marketUi.min != null) arr = arr.filter((w) => Number(w.budget) >= marketUi.min);
  if (marketUi.max != null) arr = arr.filter((w) => Number(w.budget) <= marketUi.max);
  if (marketUi.search) {
    const q = marketUi.search.toLowerCase();
    arr = arr.filter((w) =>
      String(w.title || "").toLowerCase().includes(q)
      || String(w.ownerName || "").toLowerCase().includes(q)
      || String(wantRequirementText(w)).toLowerCase().includes(q)
      || String(w.note || "").toLowerCase().includes(q));
  }
  if (marketUi.sort === "priceAsc") arr.sort((a, b) => Number(a.budget) - Number(b.budget));
  else if (marketUi.sort === "priceDesc") arr.sort((a, b) => Number(b.budget) - Number(a.budget));
  else arr.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return arr;
}

function wantCardHtml(w) {
  const meId = getState().me?.id;
  const isOwner = w.ownerId === meId;
  const isManual = w.rule === "manual";
  const myOffer = (w.offers || []).find((o) => o.sellerId === meId);
  const lowest = wantLowestOffer(w);
  const offerCount = (w.offers || []).length;
  const chips = wantCoreChips(w);
  const kinds = wantKindsSummary(w);
  const offersHtml = isOwner && offerCount
    ? `<div class="jm-want-offers">${sortOffersPreview(w.offers).map((o, i) => `
        <div class="jm-want-offer ${!isManual && i === 0 ? "is-lead" : ""}">
          <span>${escapeHtml(o.item?.name || "货品")} · ${escapeHtml(o.sellerName)} · ${formatMoney(o.price)}${!isManual && i === 0 ? " · 当前最低" : ""}</span>
          ${isManual
            ? `<button class="jm-btn-gold jm-btn-compact" data-action="settleWant" data-payload="${w.id}" data-offer-id="${o.id}" type="button">选此成交</button>`
            : `<b>${i === 0 ? "将成交" : ""}</b>`}
        </div>`).join("")}
      <div class="jm-want-hint">${isManual
        ? "手选模式：点「选此成交」指定应征；到期不会自动成交。"
        : "价低者得：确认或到期时取最低报价；冻结结余自动退回。"}</div>
    </div>`
    : "";
  let actions = "";
  if (isOwner) {
    actions = `
      <div class="jm-want-acts">
        ${isManual
          ? ""
          : `<button class="jm-btn-gold" data-action="settleWant" data-payload="${w.id}" type="button" ${offerCount ? "" : "disabled"}>按最低价成交</button>`}
        <button class="jm-btn-ghost" data-action="cancelWant" data-payload="${w.id}" type="button">撤销</button>
      </div>`;
  } else if (myOffer) {
    actions = `
      <div class="jm-want-acts">
        <span class="jm-want-mine-offer">已应征 ${formatMoney(myOffer.price)}</span>
        <button class="jm-btn-ghost" data-action="withdrawWantOffer" data-want-id="${w.id}" data-payload="${myOffer.id}" type="button">撤回应征</button>
      </div>`;
  } else {
    actions = `<button class="jm-btn-apply" data-action="marketApplyWant" data-payload="${w.id}" type="button">应征</button>`;
  }
  const offerSummary = offerCount
    ? `应征 ${offerCount}${lowest ? ` · 最低 ${formatMoney(lowest.price)}` : ""}`
    : "应征 0 · 暂无报价";
  return `
    <article class="jm-want ${isOwner ? "is-mine" : ""}">
      <div class="jm-want-head">
        <h4 class="jm-want-title">${escapeHtml(w.title || "未命名求购")}</h4>
        <span class="jm-want-timer">${escapeHtml(wantRemainLabel(w.expiresAt))}</span>
      </div>
      <div class="jm-want-chips">
        ${chips.map((chip) => `<span class="jm-want-chip">${escapeHtml(chip)}</span>`).join("")}
      </div>
      <div class="jm-want-budget-row">
        <div class="jm-want-budget"><span>预算</span><strong>≤ ${formatMoney(w.budget)}</strong></div>
        <div class="jm-want-offer-sum">${escapeHtml(offerSummary)}</div>
      </div>
      ${kinds ? `<div class="jm-want-kinds"><span>${escapeHtml(kinds.label)}</span><em>${escapeHtml(kinds.text)}</em></div>` : ""}
      ${w.note ? `<div class="jm-want-extra">${escapeHtml(w.note)}</div>` : ""}
      ${offersHtml}
      <div class="jm-want-foot">
        <span class="jm-want-owner">${escapeHtml(w.ownerName || "掌柜")}</span>
        ${actions}
      </div>
    </article>`;
}

export function renderMarketWants() {
  marketVirtual?.destroy();
  marketVirtual = null;
  elsRef.marketGrid.classList?.remove?.("virtual-grid-host");
  const wants = filterWantsForBrowse(getState().wants || []);
  updateMarketResultStatus(wants.length, "条求购");
  if (!wants.length) {
    const rawCount = (getState().wants || []).length;
    elsRef.marketGrid.innerHTML = `
      <div class="jm-empty game-empty-state">
        <span class="game-empty-state-mark" aria-hidden="true">求</span>
        <strong>${rawCount ? "暂时没有匹配的求购" : "还没有求购"}</strong>
        <p>${rawCount ? "调整筛选或搜索条件后再看看。" : "发布需求后，其他掌柜可以带货应征报价。"}</p>
        ${rawCount
          ? `<button class="secondary" type="button" data-action="resetMarketFilters">清除筛选</button>`
          : `<button type="button" data-action="openMarketWantPost">发布求购</button>`}
      </div>`;
    return;
  }
  elsRef.marketGrid.innerHTML = wants.map(wantCardHtml).join("");
}

// 只绑定一次静态控件（避免每次 render 重复绑定）
export function bindMarketOnce() {
  if (marketFiltersBound) return;
  marketFiltersBound = true;
  const regrid = () => {
    if (marketUi.section === "want") renderMarketWants();
    else if (marketUi.section === "listings") renderMarketGrid(getState().listings || []);
  };
  const applyMarketPriceFilters = () => {
    const minText = String(elsRef.marketPriceMin?.value ?? "").trim();
    const maxText = String(elsRef.marketPriceMax?.value ?? "").trim();
    const min = minText === "" ? null : Math.max(0, Math.floor(Number(minText)));
    const max = maxText === "" ? null : Math.max(0, Math.floor(Number(maxText)));
    if ((minText && !Number.isFinite(min)) || (maxText && !Number.isFinite(max))) {
      showToast("请输入有效的价格区间");
      return;
    }
    if (min != null && max != null && min > max) {
      showToast("最低价不能高于最高价");
      elsRef.marketPriceMax?.focus();
      return;
    }
    marketUi.min = min;
    marketUi.max = max;
    marketPriceDraft.min = min == null ? "" : String(min);
    marketPriceDraft.max = max == null ? "" : String(max);
    syncMarketFilterInputs();
    regrid();
  };
  elsRef.marketSearch?.addEventListener("input", (e) => { marketUi.search = e.target.value.trim(); regrid(); });
  elsRef.marketQFilters?.addEventListener("change", (event) => {
    const key = event.target.dataset.equipmentFilter;
    if (!["equipmentStage", "equipmentBrand", "equipmentTech", "equipmentCondition"].includes(key)) return;
    marketUi[key] = event.target.value;
    regrid();
  });
  elsRef.marketSort?.addEventListener("change", (e) => { marketUi.sort = e.target.value; regrid(); });
  elsRef.marketPriceMin?.addEventListener("input", (e) => { marketPriceDraft.min = e.target.value; });
  elsRef.marketPriceMax?.addEventListener("input", (e) => { marketPriceDraft.max = e.target.value; });
  elsRef.marketPriceApply?.addEventListener("click", applyMarketPriceFilters);
  [elsRef.marketPriceMin, elsRef.marketPriceMax].filter(Boolean).forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyMarketPriceFilters();
    });
  });
  elsRef.marketAfford?.addEventListener("click", () => { marketUi.afford = !marketUi.afford; renderMarketFilters(); regrid(); });
  elsRef.marketReset?.addEventListener("click", resetMarketFilters);
  // 挂牌弹窗：筛选 / 排序 / 选择物品 / 价格步进（事件委托，避免重复绑定）
  const modal = elsRef.marketListModal;
  if (modal) {
    modal.querySelector("#mlSearch")?.addEventListener("input", (e) => { mlUi.search = e.target.value.trim(); renderMlGrid(); });
    modal.querySelector("#mlCategory")?.addEventListener("change", (e) => { mlUi.cat = e.target.value; renderMlGrid(); });
    modal.querySelector("#mlSort")?.addEventListener("change", (e) => { mlUi.sort = e.target.value; renderMlGrid(); });
    modal.querySelector("#mlGrid")?.addEventListener("click", (e) => {
      const card = e.target.closest("[data-ml-id]");
      if (card) selectMlItem(card.dataset.mlId);
    });
    modal.querySelector("#mlGrid")?.addEventListener("keydown", (event) => {
      const card = event.target.closest?.("[data-ml-id]");
      if (!card) return;
      const cards = [...event.currentTarget.querySelectorAll("[data-ml-id]")];
      const index = cards.indexOf(card);
      let next = index;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMlItem(card.dataset.mlId);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(cards.length - 1, index + 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = cards.length - 1;
      else return;
      event.preventDefault();
      cards[next]?.focus();
      if (cards[next]) selectMlItem(cards[next].dataset.mlId);
    });
    modal.querySelector("#mlDetail")?.addEventListener("click", (e) => {
      const stepBtn = e.target.closest("[data-ml-step]");
      if (stepBtn) changeMlPrice(Number(stepBtn.dataset.mlDir) * (stepBtn.dataset.mlStep === "small" ? mlUi.stepSmall : mlUi.stepLarge));
    });
    modal.querySelector("#mlDetail")?.addEventListener("input", (e) => {
      if (e.target && e.target.id === "mlPrice") { mlUi.priceTouched = true; mlUi.price = Math.max(MARKET_LISTING_MIN_PRICE, Number(e.target.value) || 0); updateMlFee(); }
    });
  }
  const postModal = elsRef.marketWantPostModal || document.getElementById("marketWantPostModal");
  if (postModal) {
    postModal.addEventListener("click", (e) => {
      if (e.target === postModal) closeMarketModals();
    });
    postModal.querySelector("#mwType")?.addEventListener("change", (e) => {
      wantPostUi.itemType = e.target.value;
      syncWantPostFields();
    });
    postModal.querySelector("#mwBudget")?.addEventListener("input", () => syncWantPostFields());
    postModal.querySelector("#mwDurations")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mw-duration]");
      if (!btn) return;
      wantPostUi.durationKey = btn.dataset.mwDuration;
      postModal.querySelectorAll("[data-mw-duration]").forEach((el) => {
        el.classList.toggle("on", el.dataset.mwDuration === wantPostUi.durationKey);
      });
      if (wantPostUi.durationKey === "long" && wantPostUi.rule === "lowest") {
        wantPostUi.rule = "manual";
        postModal.querySelectorAll("[data-mw-rule]").forEach((el) => {
          el.classList.toggle("on", el.dataset.mwRule === wantPostUi.rule);
        });
      }
    });
    postModal.querySelector("#mwRules")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mw-rule]");
      if (!btn) return;
      wantPostUi.rule = btn.dataset.mwRule;
      postModal.querySelectorAll("[data-mw-rule]").forEach((el) => {
        el.classList.toggle("on", el.dataset.mwRule === wantPostUi.rule);
      });
    });
  }
  const applyModal = elsRef.marketWantApplyModal || document.getElementById("marketWantApplyModal");
  if (applyModal) {
    applyModal.querySelector("#mwaGrid")?.addEventListener("click", (e) => {
      const card = e.target.closest("[data-mwa-id]");
      if (!card) return;
      selectMarketWantApplyItem(applyModal, card);
    });
    applyModal.querySelector("#mwaGrid")?.addEventListener("keydown", (event) => {
      const card = event.target.closest?.("[data-mwa-id]");
      if (!card) return;
      const cards = [...event.currentTarget.querySelectorAll("[data-mwa-id]")];
      const index = cards.indexOf(card);
      let next = index;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMarketWantApplyItem(applyModal, card);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(cards.length - 1, index + 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = cards.length - 1;
      else return;
      event.preventDefault();
      cards[next]?.focus();
      if (cards[next]) selectMarketWantApplyItem(applyModal, cards[next]);
    });
  }
}

function selectMarketWantApplyItem(modal, card) {
  marketUi.applyItemId = card.dataset.mwaId;
  modal.querySelectorAll(".ml-slot[data-mwa-id]").forEach((el) => {
    const selected = el.dataset.mwaId === marketUi.applyItemId;
    el.classList.toggle("selected", selected);
    el.setAttribute("aria-selected", selected ? "true" : "false");
    el.setAttribute("tabindex", selected ? "0" : "-1");
  });
  const confirmBtn = modal.querySelector("#mwaConfirm");
  if (confirmBtn) confirmBtn.disabled = false;
}

export function resetMarketFilters() {
  const hadFilters = marketActiveFilterCount() > 0;
  marketUi.q.clear();
  marketUi.equipmentStage = marketUi.equipmentBrand = marketUi.equipmentTech = marketUi.equipmentCondition = "";
  marketUi.cat = "all";
  marketUi.min = null;
  marketUi.max = null;
  marketPriceDraft.min = "";
  marketPriceDraft.max = "";
  marketUi.afford = false;
  marketUi.search = "";
  renderMarketStalls();
  renderMarketFilters();
  syncMarketFilterInputs();
  if (marketUi.section === "want") renderMarketWants();
  else if (marketUi.section === "listings") renderMarketGrid(getState().listings || []);
  if (hadFilters) showToast("已清除交易行筛选");
}

export function syncMarketFilterInputs() {
  if (elsRef.marketSearch && document.activeElement !== elsRef.marketSearch) elsRef.marketSearch.value = marketUi.search;
  if (elsRef.marketSort) elsRef.marketSort.value = marketUi.sort;
  if (elsRef.marketPriceMin && document.activeElement !== elsRef.marketPriceMin) elsRef.marketPriceMin.value = marketPriceDraft.min;
  if (elsRef.marketPriceMax && document.activeElement !== elsRef.marketPriceMax) elsRef.marketPriceMax.value = marketPriceDraft.max;
}

/* ---------- 交易行弹窗 ---------- */
export function mlVisual(item) {
  if (isMarketEquipment(item)) return equipmentVisual(item, escapeHtml);
  const stage = item.materialStage || item.stage || "rough";
  const isSlice = item.type === "slice" || item._type === "slice";
  const isStoneLike = isSlice || (
    stage === "rough"
    || stage === "opened"
    || stage === "material"
    || item.type === "material"
    || item._type === "material"
  );
  // 暗料/明料与库存一致：走开料 SVG（明料 revealed），并带上已取件遮罩（余料黑洞）
  if (isStoneLike) {
    const revealed = isSlice || stage === "opened"
      || stage === "material"
      || item.type === "material"
      || item._type === "material"
      || Boolean(item.revealed || (item.windows && item.windows.length));
    const kits = openingKitsForItemVisual(item);
    return openingStoneSvg
      ? openingStoneSvg(item, { revealed, kits })
      : `<div class="jm-gem ${marketGemColor(item)}"></div>`;
  }
  // 挂牌弹窗左侧小卡片：不要 productCutoutPlaceholder 的默认套件虚线圈，
  // 对无具体器型的阶段产物直接画料子本体；成品仍用 productCanvas 保持套件形状。
  const hasKind = Boolean(item.kind || item.layout || item.templateSize);
  if (!hasKind && jadeCanvasMarkup) {
    return jadeCanvasMarkup("rough", item, "inventory");
  }
  return productCanvas ? productCanvas(item, "inventory") : `<div class="jm-gem ${marketGemColor(item)}"></div>`;
}

function mlSlotHtml(item, index = 0) {
  const isSelected = item.id === mlUi.selectedId;
  const selected = isSelected ? " selected" : "";
  const equipment = isMarketEquipment(item);
  const name = equipment ? [item.brand, item.modelName].filter(Boolean).join(" ") || item.name : item.name;
  const stage = item.materialStage || item.stage || "rough";
  const windows = Array.isArray(item.windows) ? item.windows.length : 0;
  const kitsSig = cutoutPreviewSignature(openingKitsForItemVisual(item));
  return `
    <article class="ml-slot${selected}" data-ml-id="${escapeHtml(item.id)}" title="${escapeHtml(name)}" role="option" aria-selected="${isSelected}" tabindex="${isSelected || index === 0 ? "0" : "-1"}">
      <div class="ml-slot-visual">${lazyPreviewMarkup(mlVisual(item), {
        eager: equipment,
        tint: item?.visual?.skin || item?.visual?.vein || "",
        cacheKey: `ml:${item.id}:${stage}:${windows}:${kitsSig}`
      })}</div>
      <div class="ml-slot-copy">
        <div class="ml-slot-name"><strong>${escapeHtml(name)}</strong></div>
      </div>
    </article>`;
}

function renderMlGrid() {
  const grid = elsRef.marketListModal?.querySelector("#mlGrid");
  if (!grid) return;
  let arr = marketSellables();
  if (mlUi.cat !== "all") arr = arr.filter((i) => i._type === mlUi.cat);
  if (mlUi.search) {
    const q = mlUi.search.toLowerCase();
    arr = arr.filter((i) =>
      String(i.name).toLowerCase().includes(q) ||
      String(i.quality || "").toLowerCase().includes(q) ||
      String(i.color || "").toLowerCase().includes(q) ||
      typeName(i._type, i).toLowerCase().includes(q)
    );
  }
  const sorters = {
    valueDesc: (a, b) => marketRefValue(b) - marketRefValue(a),
    valueAsc: (a, b) => marketRefValue(a) - marketRefValue(b),
    name: (a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"),
    rarity: (a, b) => marketRarity(b) - marketRarity(a),
    type: (a, b) => a._type.localeCompare(b._type)
  };
  arr = arr.slice().sort(sorters[mlUi.sort] || sorters.valueDesc);
  grid.innerHTML = arr.length
    ? arr.map((item, index) => mlSlotHtml(item, index)).join("")
    : `<div class="ml-empty modal-empty-state">
        <strong>暂无可挂牌物品</strong>
        <p>${mlUi.cat === "equipment" ? "工坊中暂无可挂牌的闲置设备。" : "可出售玉料、成品或工坊中的闲置设备。"}</p>
      </div>`;
  observeLazyPreviews(grid);
}

function renderMlDetailEmpty() {
  const detail = elsRef.marketListModal?.querySelector("#mlDetail");
  if (detail) detail.innerHTML = `<div class="ml-detail-empty">从左侧选择一个物品进行挂牌</div>`;
}

function updateMlFee() {
  const fee = elsRef.marketListModal?.querySelector("#mlFee");
  if (!fee) return;
  const p = Math.max(100, Number(mlUi.price) || 0);
  fee.innerHTML = `
    <div><span>挂牌价</span><span>${formatMoney(p)}</span></div>
    <div><span>成交市场税（${MARKET_TAX_PERCENT}%，买家付）</span><span>${formatMoney(Math.round(p * MARKET_TAX))}</span></div>`;
}

function renderMlDetail(item) {
  const detail = elsRef.marketListModal?.querySelector("#mlDetail");
  if (!detail) return;
  const q = marketQualityMeta(item);
  const gem = marketGemColor(item);
  const ref = marketRefValue(item);
  const equipment = isMarketEquipment(item);
  const name = equipment ? [item.brand, item.modelName].filter(Boolean).join(" ") || item.name : item.name;
  const suggested = equipment ? ref : Math.max(100, Math.round(ref * 1.18));
  const profile = deriveMaterialProfile(item);
  const profileHtml = marketProfileChips(profile);
  // 是否暗料以 materialStage / revealed / windows 为准，不依赖 _type 分桶
  const isSealed = !equipment && profile.sealed;
  const summary = inlaySummary(item);
  const stage = item.materialStage || item.stage || "rough";
  const stateChip = equipment
    ? `<span class="ml-info-chip">${escapeHtml(EQUIPMENT_STAGE_LABELS[item.stage] || "加工")}设备</span>`
    : isSealed
    ? `<span class="ml-info-chip sealed">暗料原石 · 未揭露</span>`
    : stage === "opened"
      ? `<span class="ml-info-chip opened">明料 · 已开窗</span>`
      : `<span class="ml-info-chip">${escapeHtml(typeName(item._type, item))}</span>`;
  detail.innerHTML = `
    <div class="ml-detail-scroll" role="region" aria-label="物品详情与挂牌价格" tabindex="0">
    <div class="ml-detail-panels${equipment ? " is-equipment" : ""}">
      <div class="ml-detail-info">
        <div class="ml-info-visual ${gem}">${mlVisual(item)}</div>
        <div class="ml-info-copy">
          <b class="ml-info-name">${escapeHtml(name)}</b>
          <div class="ml-info-chips">
            ${stateChip}
            ${equipment ? `<span class="ml-info-chip">耐久 ${Number(item.condition ?? 100)}%</span><span class="ml-info-chip">科技 ${Number(item.techLevel || 1)} 级</span>${Number(item.condition) === 0 ? '<span class="ml-info-chip sealed">需维修后使用</span>' : ""}` : `<span class="ml-info-chip">${escapeHtml(item.quality || q.name)} ${q.stars}</span>`}
            ${!equipment && item.color ? `<span class="ml-info-chip">${escapeHtml(item.color)}</span>` : ""}
          </div>
          <div class="ml-info-ref">参考估值 <strong>${formatMoney(ref)}</strong></div>
          ${summary ? `<p class="ml-info-summary">${escapeHtml(summary)}</p>` : ""}
        </div>
        <div class="ml-info-profile">
          ${equipment ? equipmentProfile(item, escapeHtml, formatMoney) : isSealed ? `<div class="ml-info-sealed">暗料原石：种水与颜色分布未揭露</div>` : profileHtml}
        </div>
      </div>
      <div class="ml-detail-pricing">
        <div class="ml-price-row">
          <label>挂牌价（不低于 ¥100）</label>
          <input id="mlPrice" type="number" inputmode="numeric" min="${MARKET_LISTING_MIN_PRICE}" value="${mlUi.price}">
        </div>
        <div class="ml-stepper">
          <button type="button" data-ml-step="large" data-ml-dir="-1">−${formatMoney(mlUi.stepLarge)}</button>
          <button type="button" data-ml-step="small" data-ml-dir="-1">−${formatMoney(mlUi.stepSmall)}</button>
          <button type="button" data-ml-step="small" data-ml-dir="1">+${formatMoney(mlUi.stepSmall)}</button>
          <button type="button" data-ml-step="large" data-ml-dir="1">+${formatMoney(mlUi.stepLarge)}</button>
        </div>
        <div class="ml-suggest">${equipment ? "建议价 = 同款新机价 ×80% − 修满费用" : "建议价 ≈ 参考价 ×1.18"} = <b>${formatMoney(suggested)}</b>（不低于 ¥100）</div>
        ${equipment ? '<p class="jm-equipment-note">挂牌后设备暂停使用，员工留在工坊。撤单退回原设备，耐久保持不变。</p>' : ""}
        <div class="ml-fee" id="mlFee"></div>
      </div>
    </div>
    </div>
    <div class="ml-detail-actions">
      <button class="jm-btn-gold ml-confirm-btn" id="mlConfirm" data-action="confirmMarketList" type="button" disabled>确认挂牌</button>
    </div>`;
  paintJadeCanvases(detail);
  updateMlFee();
}

function setMlConfirm(enabled) {
  const btn = elsRef.marketListModal?.querySelector("#mlConfirm");
  if (btn) btn.disabled = !enabled;
}

function changeMlPrice(delta) {
  mlUi.price = Math.max(100, (Number(mlUi.price) || 100) + delta);
  mlUi.priceTouched = true;
  const input = elsRef.marketListModal?.querySelector("#mlPrice");
  if (input) input.value = mlUi.price;
  updateMlFee();
}

function selectMlItem(id) {
  const item = marketSellables().find((i) => i.id === id);
  if (!item) return;
  mlUi.selectedId = id;
  mlUi.price = isMarketEquipment(item) ? marketRefValue(item) : Math.max(100, Math.round(marketRefValue(item) * 1.18));
  mlUi.priceTouched = false;
  const steps = mlSteps(mlUi.price);
  mlUi.stepSmall = steps.small;
  mlUi.stepLarge = steps.large;
  // 只切换选中态，不重建整个网格，避免左侧卡片预览闪烁
  const grid = elsRef.marketListModal?.querySelector("#mlGrid");
  if (grid) {
    grid.querySelectorAll(".ml-slot").forEach((el) => {
      const selected = el.getAttribute("data-ml-id") === id;
      el.classList.toggle("selected", selected);
      el.setAttribute("aria-selected", selected ? "true" : "false");
      el.setAttribute("tabindex", selected ? "0" : "-1");
    });
  } else {
    renderMlGrid();
  }
  renderMlDetail(item);
  setMlConfirm(true);
}

export function openMarketListModal(preselectedItemId = "") {
  const modal = elsRef.marketListModal || document.getElementById("marketListModal");
  if (!modal) { showToast("交易行弹窗未就绪，请刷新页面后重试。"); return; }
  const state = getState();
  const mine = (state?.listings || []).filter((listing) => listing.ownerId === state?.me?.id).length;
  if (mine >= MARKET_LISTING_PER_PLAYER_CAP) {
    showToast(`交易行栏位已满，每位掌柜最多挂出 ${MARKET_LISTING_PER_PLAYER_CAP} 件。`);
    return;
  }
  const sellables = marketSellables();
  mlUi.search = "";
  mlUi.cat = "all";
  mlUi.sort = "valueDesc";
  mlUi.selectedId = null;
  mlUi.priceTouched = false;
  const search = modal.querySelector("#mlSearch");
  const cat = modal.querySelector("#mlCategory");
  const sort = modal.querySelector("#mlSort");
  if (search) search.value = "";
  if (cat) cat.value = "all";
  if (sort) sort.value = "valueDesc";
  if (!sellables.length) {
    showToast("暂无可挂牌物品，先去公盘拍原石或加工成品。");
    renderMlGrid();
    renderMlDetailEmpty();
    setMlConfirm(false);
    openMarketModal(modal, { initialFocus: "#mlSearch" });
    return;
  }
  renderMlGrid();
  const preselected = preselectedItemId
    ? sellables.find((item) => String(item.id) === String(preselectedItemId))
    : null;
  if (preselected) {
    selectMlItem(preselected.id);
  } else {
    renderMlDetailEmpty();
    setMlConfirm(false);
    if (preselectedItemId) {
      const device = state.me.workshop?.devices?.find((row) => row.id === preselectedItemId);
      showToast(device ? equipmentSaleBlockReason(state.me, device, state) : "这件物品当前不可挂牌。");
    }
  }
  openMarketModal(modal, { initialFocus: preselected ? "#mlPrice" : "#mlSearch" });
}

export function confirmMarketList() {
  const item = marketSellables().find((i) => i.id === mlUi.selectedId);
  const type = item?._type;
  if (!item || !type) { showToast("请先选择一个物品。"); return; }
  const price = Math.max(100, Number(mlUi.price) || 0);
  socketRef.emit("listItem", { type, itemId: item.id, price });
  closeMarketModals();
}
export function openMarketBuy(id) {
  const modal = elsRef.marketBuyModal || document.getElementById("marketBuyModal");
  const body = elsRef.marketBuyBody || document.getElementById("marketBuyBody");
  if (!modal || !body) { showToast("买入弹窗未就绪，请刷新页面后重试。"); return; }
  elsRef.marketBuyModal = modal;
  elsRef.marketBuyBody = body;
  const l = getState().listings.find((x) => x.id === id);
  if (!l) return;
  const equipment = l.type === "equipment";
  marketUi.buyId = id;
  const summary = inlaySummary(l.item);
  const profile = deriveMaterialProfile(l.item);
  const ref = marketRefValue(l.item);
  const delta = marketPriceDelta(l.price, ref);
  const tax = Math.round(l.price * MARKET_TAX);
  const total = Math.round(l.price + tax);
  const can = marketAffordable(l.price);
  const confirmBtn = modal.querySelector("[data-action='confirmMarketBuy']");
  if (confirmBtn) {
    confirmBtn.disabled = !can;
    confirmBtn.textContent = can ? `支付 ${formatMoney(total)}` : `现金不足 · 需 ${formatMoney(total)}`;
  }
  body.innerHTML = `
    <div class="jm-buy-detail">
      ${equipment ? `${equipmentIdentityCard(l.item, {
        badge: "二手设备", className: "resource-card--compact", body: equipmentChips(l.item, escapeHtml)
      })}<div class="jm-buy-seller">卖家 ${marketSellerLine(l.ownerId, l.ownerName)} · ${marketElapsed(l.createdAt)}</div>` : `<div class="jm-buy-hero">
        <div class="jm-buy-visual">${marketItemVisual(l.item, { eager: true })}</div>
        <div class="jm-buy-copy">
          <div class="jm-nm">${escapeHtml(l.item.name)}</div>
          ${equipment ? equipmentChips(l.item, escapeHtml) : marketCardAttrChips(l.item, l.type, profile)}
          ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
          <div class="jm-buy-seller">卖家 ${marketSellerLine(l.ownerId, l.ownerName)} · ${marketElapsed(l.createdAt)}</div>
        </div>
      </div>`}
      <div class="jm-buy-profile">
        ${equipment ? equipmentProfile(l.item, escapeHtml, formatMoney) : profile.sealed
          ? `<div class="jm-sealed-note">暗料 · 种水与颜色未揭露，按皮壳与估值议价</div>`
          : marketProfileChips(profile)}
      </div>
      <div class="jm-fee">
        <div><span>挂牌价</span><span>${formatMoney(l.price)}</span></div>
        <div><span>参考估值</span><span>${formatMoney(ref)} <span class="jm-delta ${delta.cls}">${escapeHtml(delta.txt)}</span></span></div>
        <div><span>市场税（${MARKET_TAX_PERCENT}%，买家付）</span><span>${formatMoney(tax)}</span></div>
        ${equipment ? equipmentCostRows(l.item, total, formatMoney) : ""}
        <div class="total"><span>你需支付</span><span>${formatMoney(total)}</span></div>
      </div>
      ${equipment ? '<p class="jm-equipment-note">设备将加入工坊，保留当前耐久。请自行安排员工；维修费用另行支付。卖家货款直接入账，自动补薪、还款按现有规则结算。</p>' : ""}
      ${l.type === "rough" && !l.item.revealed && (l.item.materialStage || l.item.stage || "rough") === "rough" ? '<p class="jm-sealed-note">自购暗料有开亏风险，参考估值不保证回本。</p>' : ""}
    </div>`;
  paintJadeCanvases(body);
  openMarketModal(modal);
}
export function confirmMarketBuy() {
  if (!marketUi.buyId) return;
  socketRef.emit("buyListing", marketUi.buyId);
  closeMarketModals();
  marketUi.buyId = null;
}

function syncWantPostFields() {
  const modal = elsRef.marketWantPostModal;
  if (!modal) return;
  const kindsWrap = modal.querySelector("#mwKindsWrap");
  const qualityWrap = modal.querySelector("#mwQualityWrap");
  const isBracelet = wantPostUi.itemType === "bracelet";
  if (kindsWrap) kindsWrap.hidden = !isBracelet;
  if (qualityWrap) qualityWrap.hidden = isBracelet;
  const budget = Math.max(100, Number(modal.querySelector("#mwBudget")?.value || 0));
  const tax = Math.round(budget * MARKET_TAX);
  const hint = modal.querySelector("#mwEscrowHint");
  if (hint) {
    hint.textContent = `发布将冻结 ${formatMoney(budget + tax)}（预算 ${formatMoney(budget)} + 税 ${formatMoney(tax)}）；成交后结余退回可用现金。`;
  }
}

function setWantPostError(modal, message = "") {
  const err = modal?.querySelector("#mwFormError");
  if (!err) return;
  const text = String(message || "").trim();
  err.hidden = !text;
  err.textContent = text;
}

export function openMarketWantPost() {
  const modal = elsRef.marketWantPostModal || document.getElementById("marketWantPostModal");
  if (!modal) { showToast("求购弹窗未就绪，请刷新页面。"); return; }
  wantPostUi.itemType = "bracelet";
  wantPostUi.durationKey = "10m";
  wantPostUi.rule = "lowest";
  wantPostUi.minScore = 3;
  wantPostUi.qualityKey = "";
  wantPostUi.acceptedKinds = new Set(["bracelet"]);
  const title = modal.querySelector("#mwTitle");
  const budget = modal.querySelector("#mwBudget");
  const note = modal.querySelector("#mwNote");
  const typeSel = modal.querySelector("#mwType");
  const scoreSel = modal.querySelector("#mwScore");
  const qualitySel = modal.querySelector("#mwQuality");
  if (title) title.value = "";
  if (budget) budget.value = "10000";
  if (note) note.value = "";
  if (typeSel) typeSel.value = "bracelet";
  if (scoreSel) scoreSel.value = "3";
  if (qualitySel) qualitySel.value = "";
  setWantPostError(modal, "");
  modal.querySelectorAll("[data-mw-duration]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.mwDuration === wantPostUi.durationKey);
  });
  modal.querySelectorAll("[data-mw-rule]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.mwRule === wantPostUi.rule);
  });
  const kinds = modal.querySelector("#mwKinds");
  if (kinds) {
    kinds.innerHTML = KIND_OPTIONS.map((k) => `
      <label class="jm-kind-chip">
        <input type="checkbox" value="${k}" ${wantPostUi.acceptedKinds.has(k) ? "checked" : ""}>
        <span class="jm-kind-face">${escapeHtml(KIND_LABELS[k] || k)}</span>
      </label>`).join("");
  }
  syncWantPostFields();
  const confirmBtn = modal.querySelector("[data-action='confirmMarketWantPost']");
  if (confirmBtn) confirmBtn.disabled = false;
  openMarketModal(modal, { initialFocus: "#mwTitle" });
  modal.querySelector(".jm-modal-body")?.scrollTo?.(0, 0);
}

export function confirmMarketWantPost() {
  const modal = elsRef.marketWantPostModal || document.getElementById("marketWantPostModal");
  if (!modal) return;
  const titleInput = modal.querySelector("#mwTitle");
  const title = String(titleInput?.value || "").trim();
  const budget = Number(modal.querySelector("#mwBudget")?.value || 0);
  const note = String(modal.querySelector("#mwNote")?.value || "").trim();
  const minScore = Number(modal.querySelector("#mwScore")?.value || 3);
  const itemType = String(modal.querySelector("#mwType")?.value || wantPostUi.itemType);
  const qualityKey = String(modal.querySelector("#mwQuality")?.value || "");
  const acceptedKinds = [...modal.querySelectorAll("#mwKinds input:checked")].map((el) => el.value);
  const fail = (message, focusEl = null) => {
    setWantPostError(modal, message);
    showToast(message);
    focusEl?.focus?.();
  };
  if (!title) { fail("请填写求购标题。", titleInput); return; }
  if (!WANT_ITEM_TYPES.includes(itemType)) { fail("请选择品类。", modal.querySelector("#mwType")); return; }
  if (budget < 100) { fail("预算至少 ¥100。", modal.querySelector("#mwBudget")); return; }
  if (itemType === "bracelet" && !acceptedKinds.length) { fail("请至少选择一个成品题材。"); return; }
  if (!socketRef) { fail("连接未就绪，请刷新后重试。"); return; }

  const confirmBtn = modal.querySelector("[data-action='confirmMarketWantPost']");
  if (confirmBtn) confirmBtn.disabled = true;
  setWantPostError(modal, "");
  let settled = false;
  const finish = (res = {}) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeoutId);
    if (confirmBtn) confirmBtn.disabled = false;
    if (!res?.ok) {
      fail(res?.message || "发布求购失败，请稍后重试。");
      return;
    }
    closeMarketModals();
    showToast(res.message || "求购已发布。");
  };
  const timeoutId = window.setTimeout(() => {
    finish({ ok: false, message: "发布超时，请检查连接后重试。" });
  }, 8000);
  socketRef.emit("postWant", {
    title,
    itemTypes: [itemType],
    acceptedKinds: itemType === "bracelet" ? acceptedKinds : [],
    qualityKey: itemType === "bracelet" ? "" : qualityKey,
    minScore,
    budget,
    note,
    durationKey: wantPostUi.durationKey,
    rule: wantPostUi.rule
  }, (res = {}) => finish(res));
}

export function openMarketApplyWant(wantId) {
  const want = (getState().wants || []).find((w) => w.id === wantId);
  if (!want) { showToast("求购不存在。"); return; }
  if (want.ownerId === getState().me?.id) { showToast("不能应征自己的求购。"); return; }
  const modal = elsRef.marketWantApplyModal || document.getElementById("marketWantApplyModal");
  if (!modal) { showToast("应征弹窗未就绪，请刷新页面。"); return; }
  marketUi.applyWantId = wantId;
  marketUi.applyItemId = null;
  marketUi.applyPrice = Math.min(want.budget, Math.max(100, Math.round(want.budget * 0.9)));
  const matchables = marketSellables().filter((item) => wantMatchesItem(want, item, item._type));
  const grid = modal.querySelector("#mwaGrid");
  const summary = modal.querySelector("#mwaSummary");
  const priceInput = modal.querySelector("#mwaPrice");
  if (summary) summary.textContent = wantRequirementText(want);
  if (priceInput) {
    priceInput.max = want.budget;
    priceInput.value = marketUi.applyPrice;
  }
  if (grid) {
    grid.innerHTML = matchables.length
      ? matchables.map((item, index) => `
        <article class="ml-slot" data-mwa-id="${escapeHtml(item.id)}" title="${escapeHtml(item.name)}" role="option" aria-selected="false" tabindex="${index === 0 ? "0" : "-1"}">
          <div class="ml-slot-visual">${lazyPreviewMarkup(mlVisual(item), {
            tint: item?.visual?.skin || item?.visual?.vein || "",
            cacheKey: `mwa:${item.id}`
          })}</div>
          <div class="ml-slot-copy"><div class="ml-slot-name"><strong>${escapeHtml(item.name)}</strong></div></div>
        </article>`).join("")
      : `<div class="ml-empty modal-empty-state">
          <strong>没有符合条件的货品</strong>
          <p>检查求购所需的品类与品质；备齐对应货品后再来应征。</p>
        </div>`;
    observeLazyPreviews(grid);
  }
  const confirmBtn = modal.querySelector("#mwaConfirm");
  if (confirmBtn) confirmBtn.disabled = true;
  openMarketModal(modal);
}

export function confirmMarketApplyWant() {
  const want = (getState().wants || []).find((w) => w.id === marketUi.applyWantId);
  if (!want || !marketUi.applyItemId) { showToast("请选择应征货品。"); return; }
  const item = marketSellables().find((i) => i.id === marketUi.applyItemId);
  if (!item) { showToast("货品不存在。"); return; }
  const modal = elsRef.marketWantApplyModal;
  const price = Math.max(100, Number(modal?.querySelector("#mwaPrice")?.value || marketUi.applyPrice));
  if (price > want.budget) { showToast(`报价不能超过预算 ${formatMoney(want.budget)}。`); return; }
  socketRef.emit("applyWant", {
    wantId: want.id,
    type: item._type,
    itemId: item.id,
    price
  });
  closeMarketModals();
  marketUi.applyWantId = null;
  marketUi.applyItemId = null;
}

export function closeMarketModals() {
  marketModalLifecycleCleanup?.();
  marketModalLifecycleCleanup = null;
  if (elsRef.marketListModal) elsRef.marketListModal.hidden = true;
  if (elsRef.marketBuyModal) elsRef.marketBuyModal.hidden = true;
  if (elsRef.marketWantPostModal) elsRef.marketWantPostModal.hidden = true;
  if (elsRef.marketWantApplyModal) elsRef.marketWantApplyModal.hidden = true;
}
// ---- 供 main.js dispatch 调用的动作包装（封装对私有 marketUi 的修改）----
export function marketSetStall(target) {
  marketUi.section = "listings";
  marketUi.cat = (target && target.dataset && target.dataset.marketCat) || "all";
  marketUi.q.clear();
  marketUi.equipmentStage = marketUi.equipmentBrand = marketUi.equipmentTech = marketUi.equipmentCondition = "";
  renderMarket();
}
export function marketSetSection(target) {
  marketUi.section = (target && target.dataset && target.dataset.marketSection) || "listings";
  renderMarket();
}
export function marketToggleQ(target) {
  const k = target && target.dataset && target.dataset.marketQ;
  if (!k) return;
  marketUi.q.has(k) ? marketUi.q.delete(k) : marketUi.q.add(k);
  renderMarketFilters();
  if (marketUi.section === "want") renderMarketWants();
  else if (marketUi.section === "listings") renderMarketGrid(getState().listings || []);
}


export function initMarketModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ formatMoney, escapeHtml, empty, showToast, typeName, productCanvas, openingStoneSvg, openingKitsForRender, jadeCanvasMarkup } = deps.helpers);
  const register = deps.registerAction;
  if (typeof register === "function") {
    register("marketStall", ({ target }) => marketSetStall(target));
    register("marketSection", ({ target }) => marketSetSection(target));
    register("marketQ", ({ target }) => marketToggleQ(target));
    register("resetMarketFilters", () => resetMarketFilters());
    register("openMarketListModal", ({ payload }) => openMarketListModal(payload || ""));
    register("confirmMarketList", () => confirmMarketList());
    register("openMarketBuy", ({ payload }) => openMarketBuy(payload));
    register("confirmMarketBuy", () => confirmMarketBuy());
    register("closeMarketModal", () => closeMarketModals());
    register("withdrawListing", ({ payload }) => socketRef.emit("withdrawListing", payload));
    register("openMarketOffer", ({ payload }) => {
      const listing = (getState().listings || []).find((entry) => entry.id === payload);
      if (!listing?.npcOffer) return;
      marketUi.offerId = listing.npcOffer.id;
      const cost = itemCost(listing.item);
      const difference = Number(listing.npcOffer.amount) - cost.amount;
      openGameModal({
        title: "批发商收购报价", subtitle: listing.item.name,
        body: [
          `收购价 ${formatMoney(listing.npcOffer.amount)}。成交后货款直接入账，挂单下架。`,
          "系统批发按不高于估值 65% 收购，属于急售折价，不保证回本。",
          ...(cost.complete ? [`已记货品成本 ${formatMoney(cost.amount)}；本次回款与该成本差额 ${difference > 0 ? "+" : difference < 0 ? "−" : ""}${formatMoney(Math.abs(difference))}（未含未记账的经营费用）。`] : [])
        ],
        confirmText: "接受报价", cancelText: "返回",
        actions: [{ label: "接受报价", clientAction: "acceptMarketOffer", payload: listing.id }, { label: "返回", variant: "secondary" }]
      });
    });
    register("acceptMarketOffer", ({ payload, target }) => {
      const listing = (getState().listings || []).find((entry) => entry.id === payload);
      if (!listing?.npcOffer) return;
      socketRef.emit("acceptMarketOffer", { listingId: payload, offerId: marketUi.offerId });
      closeGameModal();
    });
    register("collectPayouts", () => socketRef.emit("collectPayout"));
    register("openMarketWantPost", () => openMarketWantPost());
    register("confirmMarketWantPost", () => confirmMarketWantPost());
    register("marketApplyWant", ({ payload }) => openMarketApplyWant(payload));
    register("confirmMarketApplyWant", () => confirmMarketApplyWant());
    register("cancelWant", ({ payload }) => socketRef.emit("cancelWant", payload));
    register("settleWant", ({ payload, target }) => {
      socketRef.emit("settleWant", { wantId: payload, offerId: target.dataset.offerId || null });
    });
    register("withdrawWantOffer", ({ payload, target }) => {
      socketRef.emit("withdrawWantOffer", { wantId: target.dataset.wantId, offerId: payload });
    });
  }
}
