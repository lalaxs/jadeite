import { readWorkshopSource } from "./load-workshop-source.mjs";
import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFile } from "node:fs/promises";
import { inventoryPreviewHtml } from "../public/inventory-preview.js";
import { finishedProductCardContent } from "../public/finished-product-card-view.js";
import {
  buildInventoryItems,
  countInventoryUnseen,
  filterAndSortInventory,
  initInventoryModule,
  renderInventory,
  summarizeInventory
} from "../public/inventory-module.js";

const stageFor = (item = {}) => item.materialStage
  || (item.type === "rough" ? (item.revealed ? "opened" : "rough") : "unknown");
const stageLabel = (itemOrStage = {}) => ({
  rough: "暗料原石",
  opened: "明料",
  carved: "精雕毛坯",
  polished: "抛光半成品",
  finished: "最终成品"
}[typeof itemOrStage === "string" ? itemOrStage : stageFor(itemOrStage)] || "阶段产物");
const typeName = (type) => ({ rough: "原石", material: "明料", slice: "片料", bracelet: "成品" }[type] || type);

const state = {
  me: {
    rough: [{ id: "r1", name: "木那原石", type: "rough", materialStage: "rough", value: 100, quality: { score: 2 } }],
    materials: [{ id: "m1", name: "开窗明料", type: "material", materialStage: "opened", value: 300 }],
    slices: [{ id: "s1", name: "观音片料", type: "slice", materialStage: "opened", value: 200 }],
    bracelets: [
      { id: "c1", name: "佛公毛坯", type: "bracelet", materialStage: "carved", value: 500, craftGrade: "B" },
      { id: "p1", name: "平安扣半成品", type: "bracelet", materialStage: "polished", value: 600, craftGrade: "A" },
      { id: "f1", name: "福镯", type: "bracelet", materialStage: "finished", value: 1000, craftGrade: "S" }
    ],
    externalMaterials: { gold18k: 5, diamond: 0, ruby: 3 }
  },
  materialCatalog: [
    { id: "gold18k", key: "gold18k", group: "metal", name: "18K金", unitLabel: "克", price: 380, tint: "#e6c200" },
    { id: "diamond", key: "diamond", group: "gem", name: "配石钻石", unitLabel: "颗", price: 120, tint: "#bfe9ff" },
    { id: "ruby", key: "ruby", group: "gem", name: "红宝石", unitLabel: "颗", price: 40, tint: "#e0556b" }
  ]
};
const helpers = { materialStageForClient: stageFor, materialStageLabel: stageLabel, typeName };
const items = buildInventoryItems(state, helpers);
const previewProduct = items.find(item => item.id === "f1");
const previewRenderer = (item, size) => `<svg data-product="${item.id}" data-size="${size}"></svg>`;
const independentPreview = inventoryPreviewHtml(previewProduct, { eager: true, renderProduct: previewRenderer });
assert.equal(independentPreview, previewRenderer(previewProduct.item, "inventory"), "previews render before inventory initialization");
assert.match(finishedProductCardContent(state.me.bracelets.at(-1), {
  escapeHtml: String, formatMoney: String, renderProduct: previewRenderer
}), /data-product="f1"/, "shared product cards use the caller's renderer before inventory initialization");

assert.deepEqual(items.map((item) => item.id), ["r1", "m1", "s1", "c1", "p1", "f1", "external:gold18k", "external:ruby"]);
assert.equal(items.find((item) => item.id === "external:gold18k").totalValue, 1900);
assert.equal(items.some((item) => item.id === "external:diamond"), false);
assert.equal(items.every((item) => item.isEscrow !== true), true);

const plannedHelpers = {
  ...helpers,
  kitsFor: (id) => id === "m1"
    ? [{ id: "kit-a", tpl: "fo", type: "buddha", x: 300, y: 280, scale: 1, size: "M" }]
    : [],
  openingKitProductLabel: () => "佛公"
};
const plannedItems = buildInventoryItems(state, plannedHelpers);
const planned = plannedItems.find((item) => item.id === "m1");
assert.deepEqual(plannedItems.map((item) => item.id), items.map((item) => item.id), "planning keeps only physical inventory items");
assert.equal(planned.category, "stage");
assert.equal(planned.stageLabel, "明料");
assert.deepEqual(plannedItems, items, "planning does not change inventory state");
assert.equal(planned.item, state.me.materials[0]);
assert.deepEqual(summarizeInventory(plannedItems), summarizeInventory(items), "planned kits do not inflate inventory counts");
assert.equal(plannedItems.reduce((total, item) => total + item.totalValue, 0), items.reduce((total, item) => total + item.totalValue, 0), "planned kits do not duplicate the material value");

const escrowState = {
  ...state,
  me: {
    ...state.me,
    materials: [
      { id: "m1", name: "开窗明料", type: "material", materialStage: "opened", value: 300 },
      { id: "esc1", name: "委托明料", type: "material", materialStage: "opened", value: 400, escrowOrderId: "order-1", seen: false }
    ]
  }
};
const escrowItems = buildInventoryItems(escrowState, helpers);
const escrowEntry = escrowItems.find((item) => item.id === "esc1");
assert.equal(escrowEntry?.isEscrow, true);
const escrowSorted = filterAndSortInventory(escrowItems, { category: "all", sort: "backpack" });
assert.equal(escrowSorted[0].id, "esc1");
assert.ok(filterAndSortInventory(escrowItems, { query: "委托" }).some((item) => item.id === "esc1"));
const escrowOnly = filterAndSortInventory(escrowItems, { category: "escrow", sort: "backpack" });
assert.equal(escrowOnly.length, 1);
assert.equal(escrowOnly[0].id, "esc1");
assert.equal(summarizeInventory(escrowItems).escrow, 1);

const jobEscrowState = {
  ...state,
  me: {
    ...state.me,
    materials: [],
    jobs: [{
      id: "job-esc",
      item: {
        id: "esc-job",
        name: "加工中委托",
        type: "material",
        materialStage: "opened",
        value: 500,
        escrowOrderId: "order-job"
      }
    }]
  }
};
const jobEscrowItems = buildInventoryItems(jobEscrowState, helpers);
assert.ok(jobEscrowItems.some((item) => item.id === "esc-job" && item.isEscrow && item.inJob));
assert.equal(summarizeInventory(jobEscrowItems).escrow, 1);
assert.equal(filterAndSortInventory(jobEscrowItems, { category: "escrow" }).length, 1);

const invalidHoldingsItems = buildInventoryItems({
  ...state,
  me: {
    ...state.me,
    externalMaterials: { gold18k: "invalid", diamond: Infinity, ruby: 3 }
  }
}, helpers);
assert.equal(invalidHoldingsItems.some((item) => item.id === "external:gold18k"), false);
assert.equal(invalidHoldingsItems.some((item) => item.id === "external:diamond"), false);
assert.deepEqual(summarizeInventory(items), { slots: 8, rough: 1, stage: 4, finished: 1, external: 2, escrow: 0 });

assert.deepEqual(filterAndSortInventory(items, { category: "finished" }).map((item) => item.id), ["f1"]);
assert.deepEqual(filterAndSortInventory(items, { query: "片料" }).map((item) => item.id), ["s1"]);
assert.deepEqual(filterAndSortInventory(items, { sort: "backpack" }).map((item) => item.id), items.map((item) => item.id));
assert.equal(filterAndSortInventory(items, { sort: "valueDesc" })[0].id, "external:gold18k");
assert.equal(filterAndSortInventory(items, { sort: "valueAsc" })[0].id, "r1");
assert.equal(filterAndSortInventory(items, { sort: "name" })[0].name, "18K金");
assert.equal(filterAndSortInventory(items, { sort: "rarity" })[0].id, "f1");

// 未读红点：新入账 seen:false + 镶嵌材料 unseen map
const unseenState = {
  ...state,
  me: {
    ...state.me,
    rough: [{ id: "r-new", name: "新买原石", type: "rough", materialStage: "rough", value: 100, seen: false }],
    materials: [{ id: "m-old", name: "旧明料", type: "material", materialStage: "opened", value: 300, seen: true }],
    slices: [],
    bracelets: [],
    externalMaterials: { gold18k: 2 },
    externalMaterialsUnseen: { gold18k: true }
  }
};
assert.equal(countInventoryUnseen(unseenState), 2);
assert.equal(countInventoryUnseen(null), 0);
assert.equal(countInventoryUnseen(undefined), 0);
const unseenItems = buildInventoryItems(unseenState, helpers);
assert.equal(unseenItems.find((item) => item.id === "r-new")?.unseen, true);
assert.equal(unseenItems.find((item) => item.id === "m-old")?.unseen, false);
assert.equal(unseenItems.find((item) => item.id === "external:gold18k")?.unseen, true);
assert.equal(filterAndSortInventory(unseenItems, { sort: "backpack" })[0].id, "r-new");

const realRarityItems = buildInventoryItems({
  me: {
    rough: [
      { id: "quality-score", name: "品质分原石", type: "rough", materialStage: "rough", qualityScore: 1 },
      { id: "nested-score", name: "嵌套分原石", type: "rough", materialStage: "rough", quality: { score: 2 } },
      { id: "quality-name", name: "品质名原石", type: "rough", materialStage: "rough", quality: "正冰" },
      { id: "quality-key", name: "品质键原石", type: "rough", materialStage: "rough", qualityKey: "glass" },
      { id: "null-score-key", name: "空分旧档原石", type: "rough", materialStage: "rough", qualityScore: null, qualityKey: "imperial" },
      { id: "direct-score", name: "真实分原石", type: "rough", materialStage: "rough", score: 5 },
      { id: "violet-key", name: "紫色键原石", type: "rough", materialStage: "rough", qualityKey: "violet" },
      { id: "red-name", name: "红翡名原石", type: "rough", materialStage: "rough", quality: "红翡" },
      { id: "ink-name", name: "墨翠名原石", type: "rough", materialStage: "rough", quality: "墨翠" },
      { id: "imperial-long", name: "长帝王绿名原石", type: "rough", materialStage: "rough", quality: "玻璃种帝王绿" },
      { id: "imperial-short", name: "帝王绿名原石", type: "rough", materialStage: "rough", quality: "帝王绿" },
      { id: "bean-name", name: "豆种名原石", type: "rough", materialStage: "rough", quality: "豆种" },
      { id: "glutinous-name", name: "糯种名原石", type: "rough", materialStage: "rough", quality: "糯种" },
      { id: "sticky-name", name: "糯冰名原石", type: "rough", materialStage: "rough", quality: "糯冰" },
      { id: "glass-name", name: "玻璃种名原石", type: "rough", materialStage: "rough", quality: "玻璃种" }
    ],
    bracelets: [
      { id: "craft-low", name: "低工分", type: "bracelet", materialStage: "finished", craftScore: 61, craftGrade: "B" },
      { id: "craft-high", name: "高工分", type: "bracelet", materialStage: "finished", craftScore: 89, craftGrade: "B" },
      { id: "craft-null", name: "空工分", type: "bracelet", materialStage: "finished", craftScore: null }
    ]
  }
}, helpers);
const rarityById = Object.fromEntries(realRarityItems.map((item) => [item.id, item.rarityScore]));
assert.equal(rarityById["quality-score"], 50);
assert.equal(rarityById["nested-score"], 100);
assert.equal(rarityById["quality-name"], 200);
assert.equal(rarityById["quality-key"], 300);
assert.equal(rarityById["null-score-key"], 300);
assert.equal(rarityById["direct-score"], 250);
for (const id of ["violet-key", "red-name", "ink-name"]) assert.equal(rarityById[id], 150);
for (const id of ["imperial-long", "imperial-short"]) assert.equal(rarityById[id], 300);
assert.equal(rarityById["bean-name"], 50);
assert.equal(rarityById["glutinous-name"], 100);
assert.equal(rarityById["sticky-name"], 150);
assert.equal(rarityById["glass-name"], 300);
const craftSorted = filterAndSortInventory(
  realRarityItems.filter((item) => item.id === "craft-low" || item.id === "craft-high"),
  { sort: "rarity" }
);
assert.deepEqual(craftSorted.map((item) => item.id), ["craft-high", "craft-low"]);
assert.equal(rarityById["craft-null"], 0);

function trackedRegion() {
  let html = "";
  return {
    writes: 0,
    hidden: false,
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      html = value;
      this.writes += 1;
    }
  };
}

const inventoryListeners = {};
const inventorySummary = trackedRegion();
const inventoryWarning = trackedRegion();
const inventoryGrid = trackedRegion();
const inventorySearch = { id: "inventorySearch", value: "", selectionStart: 0, selectionEnd: 0 };
const inventorySort = { id: "inventorySort", value: "backpack" };
let inventoryPanelHtml = "";
let inventoryState = state;
const inventoryPanel = {
  innerHTMLWrites: 0,
  get innerHTML() {
    return inventoryPanelHtml;
  },
  set innerHTML(value) {
    inventoryPanelHtml = value;
    this.innerHTMLWrites += 1;
  },
  addEventListener(type, handler) {
    inventoryListeners[type] ||= [];
    inventoryListeners[type].push(handler);
  },
  querySelector(selector) {
    return {
      "#inventorySearch": inventorySearch,
      "#inventorySort": inventorySort,
      "[data-inventory-summary]": inventorySummary,
      "[data-inventory-warning]": inventoryWarning,
      "[data-inventory-grid]": inventoryGrid
    }[selector] || null;
  }
};
initInventoryModule({
  getState: () => inventoryState,
  els: { inventoryPanel },
  helpers: {
    formatMoney: (value) => `¥${Number(value || 0).toLocaleString("zh-CN")}`,
    formatNumber: (value) => Number(value || 0).toLocaleString("zh-CN"),
    escapeHtml: (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;"),
    typeName,
    materialStageForClient: stageFor,
    materialStageLabel: stageLabel,
    productCanvas: (item) => `<canvas data-product="${item.id}"></canvas>`,
    openingStoneSvg: (item) => `<svg data-rough="${item.id}"></svg>`
  }
});
renderInventory();

const inventoryMarkup = () => [
  inventoryPanel.innerHTML,
  inventorySummary.innerHTML,
  inventoryWarning.innerHTML,
  inventoryGrid.innerHTML
].join("\n");

assert.match(inventoryMarkup(), /data-action="toggleInventoryRecycle"/);
assert.match(inventoryMarkup(), /inventory-recycle-toggle/);
assert.doesNotMatch(inventoryMarkup(), /inventory-toolbar-acts/);
assert.match(inventoryMarkup(), /data-inventory-reset/);

const recycleActions = {};
initInventoryModule({
  getState: () => inventoryState,
  els: { inventoryPanel },
  registerAction: (name, handler) => {
    recycleActions[name] = handler;
  },
  helpers: {
    formatMoney: (value) => `¥${Number(value || 0).toLocaleString("zh-CN")}`,
    formatNumber: (value) => Number(value || 0).toLocaleString("zh-CN"),
    escapeHtml: (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;"),
    typeName,
    materialStageForClient: stageFor,
    materialStageLabel: stageLabel,
    productCanvas: (item) => `<canvas data-product="${item.id}"></canvas>`,
    openingStoneSvg: (item) => `<svg data-rough="${item.id}"></svg>`
  }
});
recycleActions.toggleInventoryRecycle?.({});
assert.match(inventoryGrid.innerHTML, /inventory-slot-recycle-btn/);
assert.match(inventorySummary.innerHTML, />完成</);
assert.doesNotMatch(inventoryGrid.innerHTML, /data-action="inspectInventoryItem"/);

let emitted = null;
let modalOpened = false;
initInventoryModule({
  socket: {
    off() {},
    on() {},
    emit(event, payload) { emitted = { event, payload }; }
  },
  getState: () => inventoryState,
  els: { inventoryPanel },
  registerAction: (name, handler) => {
    recycleActions[name] = handler;
  },
  helpers: {
    formatMoney: (value) => `¥${Number(value || 0).toLocaleString("zh-CN")}`,
    formatNumber: (value) => Number(value || 0).toLocaleString("zh-CN"),
    escapeHtml: (value) => String(value),
    typeName,
    materialStageForClient: stageFor,
    materialStageLabel: stageLabel,
    productCanvas: (item) => `<canvas data-product="${item.id}"></canvas>`,
    openingStoneSvg: (item) => `<svg data-rough="${item.id}"></svg>`,
    openGameModal: () => { modalOpened = true; },
    closeGameModal: () => {},
    showToast: () => {}
  }
});
recycleActions.recycleInventoryItem?.({ payload: "r1", event: { stopPropagation() {}, preventDefault() {} } });
assert.equal(modalOpened, true);
assert.equal(emitted, null);
recycleActions.confirmInventoryRecycle?.({ event: { stopPropagation() {}, preventDefault() {} } });
assert.equal(emitted?.event, "recycleInventoryItem");
assert.equal(emitted?.payload?.kind, "jade");
assert.equal(emitted?.payload?.itemId, "r1");

recycleActions.toggleInventoryRecycle?.({});
assert.doesNotMatch(inventoryGrid.innerHTML, /inventory-slot-recycle-btn/);
assert.match(inventorySummary.innerHTML, />回收</);

assert.match(inventoryMarkup(), /id="inventorySearch"/);
assert.doesNotMatch(inventoryMarkup(), /id="inventoryCategory"/);
assert.match(inventoryMarkup(), /id="inventorySort"/);
assert.match(inventoryMarkup(), /data-inventory-category="all"/);
assert.match(inventoryMarkup(), /全部<span class="jm-stall-cnt">/);
assert.match(inventoryMarkup(), /原石<span class="jm-stall-cnt">/);
assert.match(inventoryMarkup(), /18K金/);
assert.match(inventoryMarkup(), /5克/);
assert.match(inventoryMarkup(), /data-action="collectBracelet"\s+data-payload="f1"/);
// 原石/明料走开料 SVG；成品走 productCanvas（避免明料被画成手镯缩略图）
assert.match(inventoryMarkup(), /data-rough="r1"/);
assert.match(inventoryMarkup(), /data-rough="m1"/);
assert.doesNotMatch(inventoryMarkup(), /data-product="m1"/);
assert.match(inventoryMarkup(), /data-rough="s1"/);
assert.doesNotMatch(inventoryMarkup(), /data-product="s1"/, "slice inventory uses the raw material preview");
assert.match(inventoryMarkup(), /data-product="f1"/);

const mountedSearch = inventoryPanel.querySelector("#inventorySearch");
const mountedSort = inventoryPanel.querySelector("#inventorySort");
const firstPanelWriteCount = inventoryPanel.innerHTMLWrites;
const firstGridWriteCount = inventoryGrid.writes;
renderInventory();
assert.equal(inventoryPanel.innerHTMLWrites, firstPanelWriteCount);
assert.equal(inventoryPanel.querySelector("#inventorySearch"), mountedSearch);
assert.equal(inventoryPanel.querySelector("#inventorySort"), mountedSort);
assert.equal(inventoryGrid.writes, firstGridWriteCount + 1);

initInventoryModule({
  getState: () => inventoryState,
  els: { inventoryPanel },
  helpers: {
    formatMoney: (value) => `¥${Number(value || 0).toLocaleString("zh-CN")}`,
    formatNumber: (value) => Number(value || 0).toLocaleString("zh-CN"),
    escapeHtml: (value) => String(value),
    typeName,
    materialStageForClient: stageFor,
    materialStageLabel: stageLabel,
    productCanvas: (item) => `<canvas data-product="${item.id}"></canvas>`,
    openingStoneSvg: (item) => `<svg data-rough="${item.id}"></svg>`
  }
});
for (const type of ["input", "change", "click", "compositionstart", "compositionend"]) {
  assert.equal(inventoryListeners[type]?.length || 0, 1);
}

const beforeCompositionGridWrites = inventoryGrid.writes;
inventoryListeners.compositionstart[0]({ target: inventorySearch });
inventorySearch.value = "福";
inventorySearch.selectionStart = 1;
inventorySearch.selectionEnd = 1;
inventoryListeners.input[0]({ target: inventorySearch, isComposing: true });
assert.equal(inventoryGrid.writes, beforeCompositionGridWrites);
assert.match(inventoryMarkup(), /18K金/);

inventorySearch.value = "福镯";
inventorySearch.selectionStart = 2;
inventorySearch.selectionEnd = 2;
inventoryListeners.compositionend[0]({ target: inventorySearch });
assert.equal(inventoryGrid.writes, beforeCompositionGridWrites + 1);
assert.match(inventoryMarkup(), /福镯/);
assert.doesNotMatch(inventoryMarkup(), /18K金/);
assert.equal(inventoryPanel.querySelector("#inventorySearch"), mountedSearch);

inventorySort.value = "valueAsc";
inventoryListeners.change[0]({ target: inventorySort });
assert.equal(inventoryPanel.innerHTMLWrites, firstPanelWriteCount);
assert.equal(inventoryPanel.querySelector("#inventorySort"), mountedSort);

const beforeCategoryGridWrites = inventoryGrid.writes;
inventoryListeners.click[0]({
  target: {
    closest(selector) {
      if (selector === "[data-inventory-category]") {
        return { getAttribute: () => "rough" };
      }
      return null;
    }
  }
});
assert.equal(inventoryGrid.writes, beforeCategoryGridWrites + 1);
assert.match(inventorySummary.innerHTML, /data-inventory-category="rough"[^>]*class="jm-stall active"|class="jm-stall active"[^>]*data-inventory-category="rough"/);

inventoryState = {
  ...state,
  me: {
    ...state.me,
    externalMaterials: {
      ...state.me.externalMaterials,
      emerald: 2
    }
  }
};
renderInventory();
assert.equal(inventoryWarning.hidden, false);
assert.match(inventoryWarning.innerHTML, /材料目录未加载完整/);
assert.equal(inventoryPanel.innerHTMLWrites, firstPanelWriteCount);

assert.equal(inventoryPreviewHtml(previewProduct, { eager: true, renderProduct: previewRenderer }), independentPreview,
  "inventory initialization and redraws cannot redirect an independent preview");

const mainEntry = await readFile(new URL("../public/main.js", import.meta.url), "utf8");
const main = readClientShellSource();
const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const workshop = readWorkshopSource();

assert.match(main, /\{\s*label:\s*"库存",\s*view:\s*"inventory",\s*type:\s*"inventory",\s*icon:\s*"inventory"\s*\}/);
assert.match(main, /inventory:\s*"库存"/);
assert.match(main, /inspectInventoryItem/);
assert.match(main, /markInventorySeen/);
assert.match(main, /countInventoryUnseen/);
assert.match(index, /class="view"\s+data-view="inventory"/);
assert.match(index, /id="inventoryPanel"\s+class="inventory-panel"/);
assert.doesNotMatch(workshop, /workshopStageDrawer|阶段库存/);

const inventorySource = await readFile(new URL("../public/features/inventory/inventory-module.js", import.meta.url), "utf8");
assert.match(inventorySource, /data-action="inspectInventoryItem"/);
assert.match(inventorySource, /data-action="toggleInventoryRecycle"/);
assert.match(inventorySource, /inventory-slot-recycle-btn/);
assert.match(inventorySource, /inventory-recycle-toggle/);
assert.match(inventorySource, /inventory-density-filters/);
assert.match(inventorySource, /game-empty-state-actions/);
assert.match(inventorySource, /清除筛选/);
assert.match(main, /exitInventoryRecycleMode/);
assert.match(main, /removeOpeningKit/);

console.log("inventory-module-smoke: normalization, filters, sorting and inventory view ok");
