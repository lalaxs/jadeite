/**
 * Materials shop — inlay metals/gems catalog, pack purchase, price history tick.
 * Use createMaterialsService(deps) after spendCash / normalizePlayer exist.
 */
import { markExternalMaterialNew } from "./inventory-service.js";
import {
  smoothMaterialDiscount,
  quoteMaterialPurchase
} from "../../shared/domain/economy/material-pricing.js";

export const MATERIAL_META = {
  goldPure:  { name: "足金(24K)", unit: "g",     unitLabel: "克", unitPrice: 560,  tint: "#d4af37" },
  silver925: { name: "925银",     unit: "g",     unitLabel: "克", unitPrice: 12,   tint: "#c9c9c9" },
  gold18k:   { name: "18K金",     unit: "g",     unitLabel: "克", unitPrice: 380,  tint: "#e6c200" },
  platinum:  { name: "铂金PT950", unit: "g",     unitLabel: "克", unitPrice: 420,  tint: "#dfe6ee" },
  diamond:   { name: "配石钻石",  unit: "piece", unitLabel: "颗", unitPrice: 120,  tint: "#bfe9ff" },
  ruby:      { name: "红宝石",    unit: "piece", unitLabel: "颗", unitPrice: 40,   tint: "#e0556b" },
  sapphire:  { name: "蓝宝石",    unit: "piece", unitLabel: "颗", unitPrice: 40,   tint: "#5b8def" }
};

export function getMaterialPrice(key) {
  const meta = MATERIAL_META[key];
  return meta ? meta.unitPrice : 0;
}

export function createMaterialPriceRuntime() {
const MATERIAL_PRICE_HISTORY = {};
(function seedMaterialHistory() {
  const DAYS = 14;
  Object.keys(MATERIAL_META).forEach((key, ki) => {
    const base = MATERIAL_META[key].unitPrice;
    const arr = [];
    let seed = (ki + 3) * 9301 + 49297;
    for (let i = 0; i < DAYS; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const r = seed / 233280;
      const wobble = (r - 0.5) * 0.06; // ±3% 基线波动
      arr.push({ d: i - DAYS + 1, p: Math.round(base * (1 + wobble)) });
    }
    MATERIAL_PRICE_HISTORY[key] = arr;
  });
})();

let materialPriceDay = 0;
let priceTicker = null;

function recordMaterialPriceTick() {
  materialPriceDay += 1;
  Object.keys(MATERIAL_META).forEach((key) => {
    const arr = MATERIAL_PRICE_HISTORY[key] || (MATERIAL_PRICE_HISTORY[key] = []);
    const p = Math.round(getMaterialPrice(key));
    arr.push({ d: materialPriceDay, p });
    if (arr.length > 90) arr.shift(); // 保留约 90 个游戏日
  });
}

function getMaterialPriceHistory(key) {
  return MATERIAL_PRICE_HISTORY[key] || [];
}

/** 原型节奏：每 60 秒记一个游戏日（正式版改为游戏日结算钩子） */
function startMaterialPriceTicker(periodMs = 60 * 1000) {
  if (priceTicker) return priceTicker;
  priceTicker = setInterval(recordMaterialPriceTick, periodMs);
  if (typeof priceTicker.unref === "function") priceTicker.unref();
  return priceTicker;
}

function stopMaterialPriceTicker() {
  if (!priceTicker) return;
  clearInterval(priceTicker);
  priceTicker = null;
}

  return { recordMaterialPriceTick, getMaterialPriceHistory, startMaterialPriceTicker, stopMaterialPriceTicker };
}

const defaultPriceRuntime = createMaterialPriceRuntime();
export const { recordMaterialPriceTick, getMaterialPriceHistory, startMaterialPriceTicker, stopMaterialPriceTicker } = defaultPriceRuntime;

// 商铺供货规格同时也是自由数量采购的阶梯价依据。
// 金属从 50g 起让利，宝石从 10 颗起让利；档位之间平滑递增，避免跨档后总价倒挂。
export const MATERIAL_CATALOG = [
  { id: "goldPure",  key: "goldPure",  description: "足金底托、包金边，传统富贵色。" },
  { id: "silver925", key: "silver925", description: "廉价配托，适合练习与低档件。" },
  { id: "gold18k",   key: "gold18k",   description: "主流镶嵌金，硬度适中不易变形。" },
  { id: "platinum",  key: "platinum",  description: "稀有白金，硬度最高、抓石最牢。" },
  { id: "diamond",   key: "diamond",   description: "足反亮钻，戒指/耳饰点缀。" },
  { id: "ruby",      key: "ruby",      description: "红宝石配石，暖色点缀。" },
  { id: "sapphire",  key: "sapphire", description: "蓝宝石配石，冷色点缀。" }
].map((m) => {
  const meta = MATERIAL_META[m.key];
  const isMetal = meta.unit === "g";
  m.name = meta.name;
  m.unit = meta.unit;
  m.unitLabel = meta.unitLabel;
  m.tint = meta.tint;
  m.packs = isMetal
    ? [
        { packId: "single", label: "零售", amount: 1, discount: 0 },
        { packId: "batch50", label: "50克批采", amount: 50, discount: 0.01 },
        { packId: "batch100", label: "100克批采", amount: 100, discount: 0.04 },
        { packId: "jin", label: "1斤批采", amount: 500, discount: 0.075 },
        { packId: "kg", label: "1公斤批采", amount: 1000, discount: 0.10 }
      ]
    : [
        { packId: "single", label: "单颗",    amount: 1,  discount: 0 },
        { packId: "pack10", label: "10颗包", amount: 10, discount: 0.08 },
        { packId: "pack50", label: "50颗包", amount: 50, discount: 0.15 }
      ];
  return m;
});

export function materialBulkDiscount(materialIdOrKey, amount) {
  const cat = MATERIAL_CATALOG.find((item) => (
    item.id === materialIdOrKey || item.key === materialIdOrKey
  ));
  const qty = Math.max(0, Math.floor(Number(amount) || 0));
  if (!cat || qty < 1) return 0;
  return smoothMaterialDiscount(cat.packs, qty);
}

export function materialPurchaseQuote(materialIdOrKey, amount) {
  const cat = MATERIAL_CATALOG.find((item) => (
    item.id === materialIdOrKey || item.key === materialIdOrKey
  ));
  const qty = Math.max(0, Math.floor(Number(amount) || 0));
  if (!cat || qty < 1) return { quantity: qty, discount: 0, price: 0 };
  return quoteMaterialPurchase(getMaterialPrice(cat.key), cat.packs, qty);
}

export function createMaterialsService(deps) {
  const { getMaterialPriceHistory, recordMaterialPriceTick } = deps.priceRuntime || defaultPriceRuntime;
  const {
    normalizePlayer,
    spendCash
  } = deps;

  function materialCatalogForPlayer() {
    return MATERIAL_CATALOG.map((m) => ({
      id: m.id,
      key: m.key,
      group: m.unit === "g" ? "metal" : "gem",
      tint: m.tint || MATERIAL_META[m.key]?.tint || "#d2c4a0",
      name: m.name,
      unit: m.unit,
      unitLabel: m.unitLabel,
      price: Math.round(getMaterialPrice(m.key)),
      description: m.description,
      packs: m.packs.map((p) => ({
        packId: p.packId,
        label: p.label,
        amount: p.amount,
        discount: p.discount,
        price: Math.round(getMaterialPrice(m.key) * p.amount * (1 - p.discount))
      }))
    }));
  }

  function buyMaterialPack(player, materialId, amount) {
    if (!player) return { ok: false, message: "未找到玩家。" };
    normalizePlayer(player);
    const cat = MATERIAL_CATALOG.find((m) => m.id === materialId);
    if (!cat) return { ok: false, message: "材料不存在。" };
    const qty = Math.floor(Number(amount));
    if (!Number.isFinite(qty) || qty < 1) return { ok: false, message: "购买数量至少为 1。" };
    const quote = materialPurchaseQuote(cat.id, qty);
    const price = quote.price;
    if (!spendCash(player, price, `购入镶嵌材料：${cat.name}×${qty}${cat.unitLabel}`, { source: "material", materialId, qty })) {
      return { ok: false, message: `购买 ${cat.name} ${qty}${cat.unitLabel} 需要 ${price}。` };
    }
    const stock = Number(player.externalMaterials[cat.key] || 0);
    player.externalMaterialCosts ||= {};
    const prior = player.externalMaterialCosts[cat.key];
    const aligned = prior && Math.abs(Number(prior.quantity) - stock) < 0.001;
    player.externalMaterialCosts[cat.key] = {
      quantity: stock + qty,
      amount: (aligned ? Number(prior.amount) || 0 : 0) + price,
      complete: stock === 0 || (aligned && prior.complete === true)
    };
    player.externalMaterials[cat.key] = stock + qty;
    markExternalMaterialNew(player, cat.key);
    return {
      ok: true,
      message: `购入 ${cat.name} ×${qty}${cat.unitLabel}`,
      listing: { name: `${cat.name} ×${qty}${cat.unitLabel}` },
      price,
      discount: quote.discount
    };
  }

  function materialHistoryPayload(key) {
    const meta = MATERIAL_META[key];
    if (!meta) return { ok: false };
    return {
      ok: true,
      key,
      name: meta.name,
      unitLabel: meta.unitLabel,
      base: meta.unitPrice,
      current: Math.round(getMaterialPrice(key)),
      history: getMaterialPriceHistory(key)
    };
  }

  return {
    materialCatalogForPlayer,
    buyMaterialPack,
    materialHistoryPayload,
    materialBulkDiscount,
    materialPurchaseQuote,
    getMaterialPrice,
    getMaterialPriceHistory,
    recordMaterialPriceTick,
    MATERIAL_META,
    MATERIAL_CATALOG
  };
}
