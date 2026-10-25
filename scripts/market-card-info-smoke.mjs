import assert from "node:assert/strict";
import {
  initMarketModule,
  marketCardHtml,
  marketItemVisual,
  marketItemPreviewKey,
  prepareMarketItemVisual,
  mlVisual,
  openMarketBuy
} from "../public/market-module.js";
import { setPreviewBitmap, clearPreviewBitmapCache } from "../public/preview-bitmap-cache.js";

const listings = [];
const buyBody = {
  innerHTML: "",
  querySelectorAll() { return []; }
};
const confirmBtn = { disabled: false, textContent: "" };
const buyModal = {
  hidden: true,
  querySelector(sel) {
    return sel.includes("confirmMarketBuy") ? confirmBtn : null;
  }
};

initMarketModule({
  socket: { emit() {} },
  getState: () => ({
    me: { id: "me", cash: 30000 },
    listings,
    players: [
      { id: "seller-1", name: "新手掌柜245", rep: 12, level: 2 },
      { id: "seller-2", name: "玲珑阁", rep: 88, level: 5 }
    ]
  }),
  els: {
    marketBuyModal: buyModal,
    marketBuyBody: buyBody
  },
  getActiveView: () => "market",
  helpers: {
    formatMoney: (value) => `¥${Number(value).toLocaleString("zh-CN")}`,
    escapeHtml: (value) => String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;"),
    empty: () => "",
    showToast() {},
    typeName: (type, item = {}) => {
      if (type === "rough") return item.materialStage === "opened" ? "明料" : "暗料原石";
      return { material: "明料", slice: "片料", bracelet: "成品" }[type] || type;
    },
    productCanvas: () => '<div class="jade-canvas"></div>',
    openingStoneSvg: () => '<svg class="jade-opening-svg"></svg>',
    jadeCanvasMarkup: () => '<div class="jade-canvas"></div>'
  }
});

const sealedListing = {
  id: "L1",
  type: "rough",
  ownerId: "seller-1",
  ownerName: "新手掌柜245",
  price: 4475,
  createdAt: Date.now(),
  item: {
    id: "r1",
    name: "黄雾莫湾基料",
    materialStage: "rough",
    mass: 1.4,
    publicHint: "黄雾皮壳 · 轮廓饱满",
    hint: "黄雾皮壳 · 轮廓饱满",
    price: 3800,
    windows: []
  }
};

const openedListing = {
  id: "L2",
  type: "material",
  ownerId: "seller-2",
  ownerName: "玲珑阁",
  price: 2800,
  createdAt: Date.now(),
  item: {
    id: "m1",
    name: "白雾莫湾基料",
    materialStage: "opened",
    quality: "正冰",
    qualityKey: "ice",
    color: "灰绿",
    value: 3200,
    windows: [{ x: 1, y: 1 }],
    openingEval: { wasteRatio: 0.08, crackRatio: 0 }
  }
};

listings.push(sealedListing, openedListing);

const sealedHtml = marketCardHtml(sealedListing);
const openedHtml = marketCardHtml(openedListing, false);

assert.match(sealedHtml, /暗料/);
assert.match(sealedHtml, /种水未揭露/);
assert.doesNotMatch(sealedHtml, /按皮壳与估值议价/);
assert.match(sealedHtml, /黄雾皮壳/);
assert.match(sealedHtml, /1\.40 kg/);
const fractionalMassHtml = marketCardHtml({
  ...sealedListing,
  item: { ...sealedListing.item, mass: 1.2999999999999998 }
});
assert.match(fractionalMassHtml, /1\.30 kg/);
assert.doesNotMatch(fractionalMassHtml, /1\.299999/);
assert.doesNotMatch(sealedHtml, /jm-unknown/);
assert.doesNotMatch(sealedHtml, /参考 ¥/);
assert.doesNotMatch(sealedHtml, /含税约/);
assert.match(sealedHtml, /买入 · ¥4,565/);
assert.doesNotMatch(sealedHtml, /jm-delta/);
assert.match(sealedHtml, /新手掌柜245/);
assert.doesNotMatch(sealedHtml, /声望 12/);
assert.doesNotMatch(sealedHtml, /Lv\.2/);
assert.match(sealedHtml, /data-action="openMarketBuy"/);
assert.match(sealedHtml, /is-buyable/);

assert.match(openedHtml, /明料/);
assert.match(openedHtml, /正冰/);
assert.match(openedHtml, /灰绿/);
assert.match(openedHtml, /废料 8%/);
assert.doesNotMatch(openedHtml, /裂 0%/);
assert.doesNotMatch(openedHtml, /声望 88/);

const slice = { ...openedListing.item, id: "slice-1", name: "豆种灰绿片料", type: "slice", stage: "material" };
for (const markup of [marketItemVisual(slice, { eager: true }), mlVisual(slice), marketCardHtml({ ...openedListing, type: "slice", item: slice })]) {
  assert.match(markup, /jade-opening-svg/, "opened slices must show raw jade in cards and listing previews");
  assert.doesNotMatch(markup, /jade-canvas/, "a slice cannot fall back to the default bangle canvas");
}

const visualKey = marketItemPreviewKey(slice);
assert.equal(marketItemPreviewKey({ ...slice, value: 9999 }), visualKey, "repricing must reuse identical artwork");
assert.notEqual(marketItemPreviewKey({ ...slice, windows: [{ x: 2, y: 1 }] }), visualKey);
for (const change of [
  { finish: { polishId: "matte" } }, { inlay: { metalId: "silver" } },
  { components: [{ type: "mount", metalId: "gold" }] }, { jadePiece: { signature: "new-cut" } }
]) assert.notEqual(marketItemPreviewKey({ ...slice, ...change }), visualKey);
setPreviewBitmap(visualKey, "data:image/png;base64,cached-slice");
assert.match(marketItemVisual(slice), /cached-slice/);
assert.doesNotMatch(marketItemVisual(slice), /jade-opening-svg/, "cached cards must skip SVG generation");
assert.match(marketItemVisual(slice, { eager: true }), /jade-opening-svg/, "detail views retain their full vector artwork");
clearPreviewBitmapCache();
globalThis.document = { createElement: () => ({ content: { querySelector: () => null } }) };
assert.equal(await prepareMarketItemVisual(slice), null, "prewarming cannot cache an unpainted legacy canvas");
assert.doesNotMatch(marketItemVisual(slice), /is-bitmap/);
delete globalThis.document;

openMarketBuy("L2");
assert.equal(buyModal.hidden, false);
assert.match(buyBody.innerHTML, /种水分布/);
assert.match(buyBody.innerHTML, /颜色分布/);
assert.match(buyBody.innerHTML, /参考估值/);
assert.match(buyBody.innerHTML, /声望 88/);
assert.match(buyBody.innerHTML, /Lv\.5/);
assert.match(buyBody.innerHTML, /jm-buy-detail/);
assert.doesNotMatch(buyBody.innerHTML, /当前现金/);
assert.doesNotMatch(buyBody.innerHTML, /支付后余额/);
assert.equal(confirmBtn.textContent, "支付 ¥2,856");

openMarketBuy("L1");
assert.match(buyBody.innerHTML, /种水与颜色未揭露/);
assert.doesNotMatch(buyBody.innerHTML, /按皮壳与估值议价|参考估值|jm-delta/);
assert.match(buyBody.innerHTML, /声望 12/);
assert.doesNotMatch(buyBody.innerHTML, /种水分布/);

const equipmentListing = {
  id: "equipment-card", type: "equipment", ownerId: "seller-1", ownerName: "设备掌柜", price: 7000, createdAt: Date.now(),
  item: { id: "equipment-instance", modelKey: "cuijie-opening-1", stage: "opening", name: "翠捷快切型设备", brand: "翠捷", modelName: "CJ-O1 快切型", techLevel: 1, condition: 60, basePrice: 10000, attrs: { quality: 2, speed: 15, risk: 1.18, perfectFloor: 0 } }
};
listings.push(equipmentListing);
const equipmentHtml = marketCardHtml(equipmentListing);
assert.match(equipmentHtml, /二手设备/);
assert.match(equipmentHtml, /耐久 60%/);
assert.match(equipmentHtml, /修满需 ¥1,000/);
assert.doesNotMatch(equipmentHtml, /种水|豆种|糯种|jade-canvas/);
assert.match(marketCardHtml(equipmentListing, true), /撤单 · 退回工坊/);
assert.match(marketItemVisual(equipmentListing.item), /jm-equipment-visual/);
assert.match(mlVisual(equipmentListing.item), /jm-equipment-visual/);
openMarketBuy(equipmentListing.id);
assert.match(buyBody.innerHTML, /购买并修满总成本/);
assert.match(buyBody.innerHTML, /¥8,140/);
assert.match(buyBody.innerHTML, /设备将加入工坊/);
assert.doesNotMatch(buyBody.innerHTML, /种水分布|颜色分布/);
assert.equal(confirmBtn.textContent, "支付 ¥7,140");
equipmentListing.item.condition = 0;
assert.match(marketCardHtml(equipmentListing), /需维修后使用/);
console.log("market-card-info-smoke: jade and equipment cards, purchase costs and broken-device disclosure ok");
