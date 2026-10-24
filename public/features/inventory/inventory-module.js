import { lazyPreviewMarkup, observeLazyPreviews } from "../../lazy-preview.js";
import { cutoutPreviewSignature } from "../../preview-bitmap-cache.js";
import { createVirtualGridController } from "../../virtual-grid.js";
import { materialSwatchHtml } from "../../inlay-product-renderer.js";
import { inlaySummary } from "../../product-meta.js";
import { MAX_COLLECTION_SIZE, collectRepLabel } from "../../player-progression.js";
import { itemCost } from "../../../shared/domain/economy/item-cost.js";
import {
  INVENTORY_RECYCLE_PERCENT,
  inventoryRecyclePayout
} from "../../inventory-recycle.js";

export { inventoryRecyclePayout };

const STAGE_ORDER = { rough: 0, opened: 1, slice: 2, planned: 3, carved: 4, polished: 5, finished: 6 };
const GRADE_SCORE = { S: 500, A: 400, B: 300, C: 200, D: 100 };
const QUALITY_SCORE = {
  bean: 1,
  glutinous: 2,
  stickyIce: 3,
  ice: 4,
  highIce: 5,
  glass: 6,
  icy: 4,
  imperial: 6,
  violet: 3,
  red: 3,
  ink: 3
};
const QUALITY_NAME_SCORE = {
  豆种: 1,
  糯种: 2,
  糯冰: 3,
  冰糯种: 3,
  正冰: 4,
  冰种: 4,
  高冰: 5,
  高冰种: 5,
  玻璃种: 6,
  玻璃种帝王绿: 6,
  帝王绿: 6,
  紫罗兰: 3,
  红翡: 3,
  墨翠: 3
};
const CATEGORY_LABELS = { rough: "原石", stage: "阶段产物", finished: "成品", external: "镶嵌材料" };
const boundInventoryPanels = new WeakSet();
const mountedInventoryPanels = new WeakSet();

let getState;
let elsRef;
let socketRef;
let formatMoney;
let formatNumber;
let escapeHtml;
let typeName;
let materialStageForClient;
let materialStageLabel;
let productCanvas;
let openingStoneSvg;
let openingKitsForRender;
let kitsFor;
let openingKitProductLabel;

const inventoryUi = { query: "", category: "all", sort: "backpack", recycleMode: false };
let inventoryComposing = false;
let lastInventoryRenderFp = "";
const INVENTORY_VIRTUAL_THRESHOLD = 36;
let inventoryVirtual = null;
let openGameModal;
let closeGameModal;
let showToast;
let removeOpeningKit;
let getActiveView = () => "overview";
let pendingRecyclePayload = null;

export function exitInventoryRecycleMode() {
  if (!inventoryUi.recycleMode) return false;
  inventoryUi.recycleMode = false;
  pendingRecyclePayload = null;
  lastInventoryRenderFp = "";
  return true;
}

function canRecycleInventoryEntry(entry) {
  return Boolean(entry) && !entry.isEscrow;
}

function recyclePayloadForEntry(entry) {
  if (!entry || entry.isEscrow) return null;
  if (entry.isPlanned || entry.source === "planned") {
    const parentId = entry.plannedParentId || entry.item?._plannedParentId || "";
    const kitId = String(entry.id || "").split(":").slice(2).join(":")
      || entry.item?.sourceMaterial?.placement?.id
      || "";
    return {
      kind: "planned",
      itemId: entry.id,
      parentId: String(parentId),
      kitId: String(kitId)
    };
  }
  if (entry.category === "external" || entry.source === "externalMaterials") {
    const materialKey = entry.item?.key || String(entry.id || "").replace(/^external:/, "");
    return {
      kind: "external",
      itemId: entry.id,
      materialKey
    };
  }
  return {
    kind: "jade",
    itemId: entry.id,
    itemType: entry.item?.type || entry.source
  };
}

function isInventoryEntryUnseen(entry, me = {}) {
  if (!entry) return false;
  if (entry.category === "external") {
    const key = entry.item?.key || String(entry.id || "").replace(/^external:/, "");
    return Boolean(me.externalMaterialsUnseen?.[key]) && Number(entry.quantity || 0) > 0;
  }
  return entry.item?.seen === false;
}

export function countInventoryUnseen(state = {}) {
  const me = state?.me || {};
  let count = 0;
  for (const bucket of [me.rough, me.materials, me.slices, me.bracelets]) {
    for (const item of bucket || []) {
      if (item?.seen === false) count += 1;
    }
  }
  const unseenExt = me.externalMaterialsUnseen || {};
  const stocks = me.externalMaterials || {};
  for (const [key, flagged] of Object.entries(unseenExt)) {
    if (flagged && Number(stocks[key] || 0) > 0) count += 1;
  }
  return count;
}

function inventoryRenderFingerprint(state, items) {
  const me = state?.me || {};
  const catalogKeys = (state.materialCatalog || []).map((material) => material.key || material.id).join(",");
  const external = Object.entries(me.externalMaterials || {})
    .map(([key, quantity]) => `${key}:${quantity}`)
    .join("|");
  const unseenExt = Object.entries(me.externalMaterialsUnseen || {})
    .filter(([, flagged]) => flagged)
    .map(([key]) => key)
    .join("|");
  const itemSig = items.map((entry) => {
    const item = entry.item || entry;
    return [
      entry.id || item.id || entry.key || "",
      entry.category || "",
      item.value ?? item.price ?? "",
      materialStageForClient?.(item) || "",
      Array.isArray(item.windows) ? item.windows.length : 0,
      entry.unseen ? 1 : 0,
      item.escrowOrderId ? 1 : 0,
      entry.inJob ? 1 : 0,
      entry.isPlanned ? 1 : 0
    ].join(":");
  }).join("|");
  return [
    inventoryUi.query,
    inventoryUi.category,
    inventoryUi.sort,
    inventoryUi.recycleMode ? 1 : 0,
    catalogKeys,
    external,
    unseenExt,
    (state?.me?.jobs || []).map((job) => {
      const item = job?.item || {};
      return [
        job?.id || "",
        item.id || "",
        item.escrowOrderId || "",
        item.sourceRoughId || item.sourceMaterial?.roughId || ""
      ].join(":");
    }).join("|"),
    typeof kitsFor === "function"
      ? [...(me.rough || []), ...(me.materials || [])]
        .map((item) => `${item.id}:${(kitsFor(item.id) || []).length}`)
        .join("|")
      : "",
    itemSig
  ].join("::");
}

function numericValue(item = {}) {
  return Number(item.value ?? item.price ?? 0) || 0;
}

function scaledQualityScore(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric >= 0 && numeric <= 6 ? numeric * 50 : numeric;
}

function qualityRarityScore(item = {}) {
  for (const value of [item.score, item.quality?.score, item.qualityScore]) {
    const score = scaledQualityScore(value);
    if (score != null) return score;
  }
  const qualityKey = item.qualityKey || item.quality?.key;
  if (QUALITY_SCORE[qualityKey]) return QUALITY_SCORE[qualityKey] * 50;
  const qualityName = typeof item.quality === "string" ? item.quality : item.quality?.name;
  if (QUALITY_NAME_SCORE[qualityName]) return QUALITY_NAME_SCORE[qualityName] * 50;
  return 0;
}

function rarityScore(item = {}) {
  const craftScore = Number(item.craftScore);
  if (item.craftScore != null && item.craftScore !== "" && Number.isFinite(craftScore)) {
    const inferredGrade = craftScore >= 100 ? "S" : craftScore >= 85 ? "A" : craftScore >= 70 ? "B" : craftScore >= 55 ? "C" : "D";
    const grade = GRADE_SCORE[item.craftGrade] ? item.craftGrade : inferredGrade;
    return GRADE_SCORE[grade] + craftScore / 100;
  }
  if (GRADE_SCORE[item.craftGrade]) return GRADE_SCORE[item.craftGrade];
  const qualityScore = qualityRarityScore(item);
  if (qualityScore) return qualityScore;
  return 0;
}

function plannedKitEntries(parent, source, helpers = {}) {
  const listKits = helpers.kitsFor || kitsFor;
  const labelFor = helpers.openingKitProductLabel || openingKitProductLabel;
  if (typeof listKits !== "function") return [];
  const kits = listKits(parent.id) || [];
  return kits.map((kit, index) => {
    const kitId = kit.uid || kit.id || `k${index}`;
    const tpl = kit.tpl || kit.openingTpl || "";
    const label = (typeof labelFor === "function" ? labelFor(tpl) : null) || "套件";
    const parentName = parent.name || "明料";
    const value = numericValue(parent);
    const item = {
      id: `planned:${parent.id}:${kitId}`,
      type: "bracelet",
      materialStage: "planned",
      stage: "planned",
      name: `${parentName} · ${label}`,
      kind: kit.type || tpl,
      value,
      price: value,
      quality: parent.quality,
      qualityKey: parent.qualityKey,
      color: parent.color,
      sourceMaterial: {
        roughId: parent.id,
        roughName: parent.name,
        visual: parent.visual,
        openingSeed: parent.openingSeed || parent.visual?.openingSeed,
        windows: parent.windows || [],
        placement: {
          id: kitId,
          openingTpl: tpl,
          kitType: kit.type,
          x: Number(kit.x),
          y: Number(kit.y),
          rot: Number(kit.rot ?? kit.rotation ?? 0),
          scale: Number(kit.scale || 1),
          size: kit.size,
          ringSize: kit.ringSize || (tpl === "bangle" ? (kit.size || 56) : undefined),
          svgSpace: true
        }
      },
      _planned: true,
      _plannedParentId: parent.id,
      seen: parent.seen !== false
    };
    return {
      id: item.id,
      source: "planned",
      item,
      name: item.name,
      category: "stage",
      categoryLabel: CATEGORY_LABELS.stage,
      stage: "planned",
      stageLabel: "规划产物",
      typeLabel: label,
      quantity: 1,
      unitLabel: "件",
      unitPrice: value,
      totalValue: value,
      rarityScore: rarityScore(parent),
      groupOrder: STAGE_ORDER.planned,
      isFinished: false,
      isPlanned: true,
      plannedParentId: parent.id,
      unseen: parent.seen === false,
      isEscrow: Boolean(parent.escrowOrderId)
    };
  });
}

export function buildInventoryItems(state = {}, helpers = {}) {
  const me = state.me || {};
  const stageFor = helpers.materialStageForClient || ((item) => item.materialStage || "unknown");
  const stageLabelFor = helpers.materialStageLabel || ((stage) => stage);
  const typeLabelFor = helpers.typeName || ((type) => type);
  let backpackIndex = 0;
  const entries = [];
  const pushItem = (item, source, type, forcedStage = null) => {
    const stage = forcedStage || stageFor(item);
    const normalizedStage = source === "slices" ? "slice" : stage;
    const category = stage === "rough" ? "rough" : stage === "finished" ? "finished" : "stage";
    entries.push({
      id: item.id,
      source,
      item,
      name: item.name || "未命名物品",
      category,
      categoryLabel: CATEGORY_LABELS[category],
      stage,
      stageLabel: source === "slices" ? "片料" : stageLabelFor(stage),
      typeLabel: typeLabelFor(type, item),
      quantity: 1,
      unitLabel: "件",
      unitPrice: numericValue(item),
      totalValue: numericValue(item),
      rarityScore: rarityScore(item),
      groupOrder: STAGE_ORDER[normalizedStage] ?? 99,
      backpackIndex: backpackIndex++,
      isFinished: stage === "finished",
      unseen: item?.seen === false,
      isEscrow: Boolean(item?.escrowOrderId)
    });
  };

  for (const item of me.rough || []) {
    pushItem(item, "rough", "rough");
    for (const planned of plannedKitEntries(item, "rough", helpers)) {
      planned.backpackIndex = backpackIndex++;
      entries.push(planned);
    }
  }
  for (const item of me.materials || []) {
    pushItem(item, "materials", "material", item.materialStage || "opened");
    for (const planned of plannedKitEntries(item, "materials", helpers)) {
      planned.backpackIndex = backpackIndex++;
      entries.push(planned);
    }
  }
  for (const item of me.slices || []) pushItem(item, "slices", "slice", item.materialStage || "opened");
  for (const item of me.bracelets || []) pushItem(item, "bracelets", "bracelet");

  // Escrow items currently inside workshop jobs still belong to「委托」and must remain visible.
  for (const job of me.jobs || []) {
    const item = job?.item;
    if (!item?.escrowOrderId) continue;
    const already = entries.some((entry) => entry.id === item.id);
    if (already) continue;
    const type = item.type || "material";
    const source = type === "rough" ? "rough" : type === "slice" ? "slices" : type === "bracelet" ? "bracelets" : "materials";
    pushItem(item, source, type, item.materialStage || null);
    const last = entries[entries.length - 1];
    if (last) {
      last.inJob = true;
      last.jobId = job.id;
      last.stageLabel = `${last.stageLabel || "加工"} · 加工中`;
    }
  }

  for (const material of state.materialCatalog || []) {
    const quantity = Number((me.externalMaterials || {})[material.key] || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const entry = {
      id: `external:${material.key}`,
      source: "externalMaterials",
      item: material,
      name: material.name,
      category: "external",
      categoryLabel: CATEGORY_LABELS.external,
      stage: material.group === "metal" ? "metal" : "gem",
      stageLabel: material.group === "metal" ? "金属" : "宝石",
      typeLabel: "镶嵌材料",
      quantity,
      unitLabel: material.unitLabel,
      unitPrice: Number(material.price || 0),
      totalValue: Number(material.price || 0) * quantity,
      rarityScore: 0,
      groupOrder: material.group === "metal" ? 7 : 8,
      backpackIndex: backpackIndex++,
      isFinished: false,
      unseen: false
    };
    entry.unseen = isInventoryEntryUnseen(entry, me);
    entries.push(entry);
  }

  return entries
    .sort((a, b) => a.groupOrder - b.groupOrder || a.backpackIndex - b.backpackIndex)
    .map((entry, index) => ({ ...entry, backpackIndex: index }));
}

export function filterAndSortInventory(items = [], filters = {}) {
  const query = String(filters.query || "").trim().toLocaleLowerCase("zh-CN");
  const category = filters.category || "all";
  const result = items.filter((item) => {
    if (category === "escrow") {
      if (!item.isEscrow) return false;
    } else if (category !== "all" && item.category !== category) {
      return false;
    }
    if (!query) return true;
    return [item.name, item.stageLabel, item.categoryLabel, item.typeLabel, item.isEscrow ? "委托" : ""]
      .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(query));
  });
  const byBackpack = (a, b) =>
    Number(b.isEscrow) - Number(a.isEscrow)
    || Number(b.unseen) - Number(a.unseen)
    || a.backpackIndex - b.backpackIndex;
  const sorters = {
    backpack: byBackpack,
    valueDesc: (a, b) => Number(b.isEscrow) - Number(a.isEscrow) || Number(b.unseen) - Number(a.unseen) || b.totalValue - a.totalValue || byBackpack(a, b),
    valueAsc: (a, b) => Number(b.isEscrow) - Number(a.isEscrow) || Number(b.unseen) - Number(a.unseen) || a.totalValue - b.totalValue || byBackpack(a, b),
    name: (a, b) => Number(b.isEscrow) - Number(a.isEscrow) || Number(b.unseen) - Number(a.unseen) || a.name.localeCompare(b.name, "zh-CN") || byBackpack(a, b),
    rarity: (a, b) => Number(b.isEscrow) - Number(a.isEscrow) || Number(b.unseen) - Number(a.unseen) || b.rarityScore - a.rarityScore || byBackpack(a, b)
  };
  return result.sort(sorters[filters.sort] || sorters.backpack);
}

export function summarizeInventory(items = []) {
  return items.reduce((summary, item) => {
    summary.slots += 1;
    summary[item.category] += 1;
    if (item.isEscrow) summary.escrow += 1;
    return summary;
  }, { slots: 0, rough: 0, stage: 0, finished: 0, external: 0, escrow: 0 });
}

export function initInventoryModule(options) {
  getState = options.getState;
  elsRef = options.els;
  socketRef = options.socket || null;
  getActiveView = typeof options.getActiveView === "function" ? options.getActiveView : () => "overview";
  ({
    formatMoney,
    formatNumber,
    escapeHtml,
    typeName,
    materialStageForClient,
    materialStageLabel,
    productCanvas,
    openingStoneSvg,
    openingKitsForRender,
    kitsFor,
    openingKitProductLabel,
    openGameModal,
    closeGameModal,
    showToast,
    removeOpeningKit
  } = {
    openGameModal: null,
    closeGameModal: null,
    showToast: null,
    removeOpeningKit: null,
    ...options.helpers
  });

  const register = options.registerAction;
  if (typeof register === "function") {
    register("markInventorySeen", ({ payload }) => {
      if (payload) socketRef?.emit("markInventorySeen", { ids: [payload] });
    });
    register("inspectInventoryItem", ({ payload }) => {
      if (inventoryUi.recycleMode) return;
      options.helpers.inspectInventoryItem?.(payload);
    });
    register("collectBracelet", ({ payload, event }) => {
      event?.stopPropagation?.();
      const braceletId = String(payload || "").trim();
      if (!braceletId) return;
      options.helpers.closeGameModal?.();
      socketRef?.emit("collectBracelet", {
        braceletId,
        requestId: globalThis.crypto?.randomUUID?.() || `collect-${Date.now()}`
      });
    });
    register("listItem", ({ payload, target }) => {
      const input = document.querySelector(`[data-price-for="${CSS.escape(payload)}"]`);
      socketRef?.emit("listItem", { type: target.dataset.type, itemId: payload, price: input?.value });
    });
    register("toggleInventoryRecycle", ({ event }) => {
      event?.stopPropagation?.();
      inventoryUi.recycleMode = !inventoryUi.recycleMode;
      lastInventoryRenderFp = "";
      // 虚拟网格可能因 item 引用未变而跳过重绘，强制刷新槽位 HTML
      if (inventoryVirtual) {
        inventoryVirtual.destroy();
        inventoryVirtual = null;
      }
      renderInventory();
    });
    register("recycleInventoryItem", ({ payload, event }) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      requestRecycleInventoryItem(payload);
    });
    register("confirmInventoryRecycle", ({ event }) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const payload = pendingRecyclePayload;
      pendingRecyclePayload = null;
      confirmRecycleInventoryItem(payload);
    });
  }

  socketRef?.off?.("inventoryRecycleResult");
  socketRef?.on?.("inventoryRecycleResult", (res = {}) => {
    if (!res.ok) {
      if (res.message) showToast?.({ text: res.message, tone: "warn" });
      return;
    }
    if (res.clearClientKit && res.parentId && res.kitId && typeof removeOpeningKit === "function") {
      removeOpeningKit(res.parentId, res.kitId);
    }
    lastInventoryRenderFp = "";
    renderInventory();
  });

  const panel = elsRef.inventoryPanel;
  if (!panel || boundInventoryPanels.has(panel)) return;
  boundInventoryPanels.add(panel);

  panel.addEventListener("input", (event) => {
    if (event.target?.id !== "inventorySearch") return;
    if (inventoryComposing || event.isComposing) return;
    inventoryUi.query = event.target.value;
    renderInventory();
  });
  panel.addEventListener("compositionstart", (event) => {
    if (event.target?.id === "inventorySearch") inventoryComposing = true;
  });
  panel.addEventListener("compositionend", (event) => {
    if (event.target?.id !== "inventorySearch") return;
    inventoryComposing = false;
    inventoryUi.query = event.target.value;
    renderInventory();
  });
  panel.addEventListener("change", (event) => {
    if (event.target?.id !== "inventorySort") return;
    inventoryUi.sort = event.target.value;
    renderInventory();
  });
  panel.addEventListener("click", (event) => {
    const categoryBtn = event.target?.closest?.("[data-inventory-category]");
    if (categoryBtn) {
      inventoryUi.category = categoryBtn.getAttribute("data-inventory-category") || "all";
      renderInventory();
      return;
    }
    if (!event.target?.closest?.("[data-inventory-reset]")) return;
    inventoryUi.query = "";
    inventoryUi.category = "all";
    inventoryUi.sort = "backpack";
    inventoryUi.recycleMode = false;
    pendingRecyclePayload = null;
    syncInventoryToolbar(panel);
    renderInventory();
  });
}

function requestRecycleInventoryItem(entryId) {
  const state = getState?.() || {};
  const entry = buildInventoryItems(state, {
    materialStageForClient,
    materialStageLabel,
    typeName,
    kitsFor,
    openingKitProductLabel
  }).find((item) => String(item.id) === String(entryId || ""));
  if (!entry) {
    showToast?.({ text: "找不到该物品。", tone: "warn" });
    return;
  }
  if (!canRecycleInventoryEntry(entry)) {
    showToast?.({ text: "委托物不可回收。", tone: "warn" });
    return;
  }
  const payload = recyclePayloadForEntry(entry);
  if (!payload) return;
  const value = Number(entry.totalValue || 0) || 0;
  const payout = inventoryRecyclePayout(value);
  const cost = !entry.isPlanned && entry.source !== "externalMaterials" ? itemCost(entry.item) : { complete: false };
  const difference = payout - (cost.amount || 0);
  pendingRecyclePayload = payload;
  if (typeof openGameModal !== "function") {
    confirmRecycleInventoryItem(payload);
    return;
  }
  openGameModal({
    id: "inventory-recycle",
    title: "确认回收",
    tone: "warn",
    body: [
      `回收「${entry.name}」后将从库存移除，无法复原。`,
      `估值 ${formatMoney(value)} · 回收可得 ${formatMoney(payout)}（估值 ${INVENTORY_RECYCLE_PERCENT}%）。`,
      "回收属于急售折价，不保证回本；余料回收也不会补齐原石采购与加工投入。",
      ...(cost.complete ? [`已记货品成本 ${formatMoney(cost.amount)}；本次回款与该成本差额 ${difference > 0 ? "+" : difference < 0 ? "−" : ""}${formatMoney(Math.abs(difference))}（未含未记账的经营费用）。`] : [])
    ],
    actions: [
      {
        label: "确认回收",
        variant: "warn",
        clientAction: "confirmInventoryRecycle"
      },
      { label: "取消", variant: "secondary" }
    ]
  });
}

function confirmRecycleInventoryItem(rawPayload) {
  if (typeof closeGameModal === "function") closeGameModal();
  let payload = rawPayload;
  if (typeof rawPayload === "string") {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      payload = null;
    }
  }
  if (!payload || typeof payload !== "object") {
    showToast?.({ text: "回收请求无效。", tone: "warn" });
    return;
  }
  if (!socketRef?.emit) {
    showToast?.({ text: "未连接服务器，无法回收。", tone: "warn" });
    return;
  }
  socketRef.emit("recycleInventoryItem", payload);
}

function inventoryCategoryFilters(summary) {
  const filters = [
    { id: "all", label: "全部", count: summary.slots },
    { id: "escrow", label: "委托", count: summary.escrow || 0 },
    { id: "rough", label: "原石", count: summary.rough },
    { id: "stage", label: "阶段产物", count: summary.stage },
    { id: "finished", label: "成品", count: summary.finished },
    { id: "external", label: "镶嵌材料", count: summary.external }
  ];
  const recycleLabel = inventoryUi.recycleMode ? "完成" : "回收";
  const recycleClass = inventoryUi.recycleMode ? "jm-btn-gold" : "secondary";
  return `
    <div class="inventory-density-filters" role="group" aria-label="库存分类筛选">
      ${filters.map((filter) => `
        <button
          class="jm-stall${inventoryUi.category === filter.id ? " active" : ""}${filter.id === "escrow" ? " is-escrow-filter" : ""}"
          data-inventory-category="${escapeHtml(filter.id)}"
          type="button"
          aria-pressed="${inventoryUi.category === filter.id ? "true" : "false"}"
        >${escapeHtml(filter.label)}<span class="jm-stall-cnt">${formatNumber(filter.count)}</span></button>
      `).join("")}
    </div>
    <button
      class="inventory-recycle-toggle ${recycleClass}"
      data-action="toggleInventoryRecycle"
      type="button"
      aria-pressed="${inventoryUi.recycleMode ? "true" : "false"}"
    >${recycleLabel}</button>
  `;
}

function isRoughLikeInventoryItem(entry) {
  const item = entry.item || {};
  const stage = entry.stage || materialStageForClient?.(item);
  return entry.category === "rough"
    || entry.source === "materials"
    || entry.source === "slices"
    || item.type === "rough"
    || item.type === "material"
    || item.type === "slice"
    || stage === "rough"
    || stage === "opened";
}

export function externalMaterialArtHtml(material = {}, options = {}) {
  return materialSwatchHtml(material, options);
}

export function inventoryPreview(entry, { eager = false, size = "inventory" } = {}) {
  if (entry.category === "external") {
    return externalMaterialArtHtml(entry.item, { escapeHtml });
  }
  // 原石、明料与片料走开料 SVG；取件后的毛坯、成品使用成品轮廓。
  let inner;
  let revealed = false;
  let kitsSig = 0;
  if (entry.isPlanned) {
    inner = productCanvas(entry.item, size);
  } else if (isRoughLikeInventoryItem(entry)) {
    revealed = (entry.stage || materialStageForClient?.(entry.item)) !== "rough";
    const kits = typeof openingKitsForRender === "function"
      ? openingKitsForRender(entry.item)
      : [];
    kitsSig = cutoutPreviewSignature(Array.isArray(kits) ? kits : []);
    inner = `<div class="inventory-rough-art">${openingStoneSvg(entry.item, { revealed, kits })}</div>`;
  } else {
    inner = productCanvas(entry.item, size);
  }
  const windows = Array.isArray(entry.item?.windows) ? entry.item.windows.length : 0;
  return lazyPreviewMarkup(inner, {
    eager,
    tint: entry.item?.visual?.skin || entry.item?.visual?.vein || "",
    cacheKey: `inv:${entry.id}:${entry.stage || ""}:${revealed ? 1 : 0}:${windows}:${kitsSig}:${entry.isPlanned ? 1 : 0}:${entry.item?.jadePiece?.signature || ""}:${entry.item?.components?.length || 0}:${entry.item?.finish?.polishId || entry.item?.inlay?.polishId || ""}:${entry.item?.finish?.refinementId || ""}`
  });
}

function inventorySlot(entry) {
  const quantity = entry.category === "external"
    ? `<span class="inventory-quantity">${formatNumber(entry.quantity)}${escapeHtml(entry.unitLabel)}</span>`
    : "";
  const collectionCount = (getState()?.me?.collection || []).length;
  const collectionFull = collectionCount >= MAX_COLLECTION_SIZE;
  const action = entry.isFinished && !entry.isEscrow && !entry.isPlanned
    ? (collectionFull
      ? `<button class="secondary small" type="button" disabled title="藏宝阁已满（上限 ${MAX_COLLECTION_SIZE} 件）">藏宝阁已满</button>`
      : `<button class="secondary small" data-action="collectBracelet" data-payload="${escapeHtml(entry.id)}" type="button" title="${escapeHtml(collectRepLabel(entry.totalValue ?? entry.item?.value, { alreadyGranted: Boolean(entry.item?.collectedRepGranted) }))}">收入藏宝阁</button>`)
    : "";
  const unseenDot = entry.unseen && !inventoryUi.recycleMode
    ? `<span class="inventory-slot-dot" aria-label="未查看"></span>`
    : "";
  const escrowBadge = entry.isEscrow
    ? `<span class="inventory-slot-escrow" title="黑市加工委托物，加工完成后需交还下单方">委托</span>`
    : "";
  const plannedBadge = entry.isPlanned
    ? `<span class="inventory-slot-planned" title="已在明料上规划，开工取件后转为精雕毛坯">已规划</span>`
    : "";
  const recycleBtn = inventoryUi.recycleMode && canRecycleInventoryEntry(entry)
    ? `<button class="inventory-slot-recycle-btn" data-action="recycleInventoryItem" data-payload="${escapeHtml(entry.id)}" type="button" title="回收" aria-label="回收 ${escapeHtml(entry.name)}">×</button>`
    : "";
  // 所有格子可点开详情；未查看时顺带清红点；回收模式下点卡片不进详情
  const clickable = inventoryUi.recycleMode
    ? ""
    : ` data-action="inspectInventoryItem" data-payload="${escapeHtml(entry.id)}" role="button" tabindex="0"`;
  const title = inventoryUi.recycleMode
    ? (canRecycleInventoryEntry(entry) ? "点击右上角删除回收" : "委托物不可回收")
    : entry.isPlanned
      ? "规划产物 · 点击查看详情"
      : entry.isEscrow
        ? "黑市委托物 · 点击查看详情"
        : entry.unseen
          ? "点击查看详情（将标记为已查看）"
          : "点击查看详情";
  return `
    <article class="inventory-slot${entry.unseen ? " is-unseen" : ""}${entry.isEscrow ? " is-escrow" : ""}${entry.isPlanned ? " is-planned" : ""}${inventoryUi.recycleMode ? " is-recycle-mode" : ""}"${clickable} title="${title}">
      ${recycleBtn}
      ${unseenDot}
      ${escrowBadge}
      ${plannedBadge}
      <div class="inventory-slot-visual">
        <span class="inventory-slot-badge">${escapeHtml(entry.categoryLabel)}</span>
        ${inventoryPreview(entry)}
      </div>
      <div class="inventory-slot-copy">
        <div class="inventory-slot-name">
          <strong>${escapeHtml(entry.name)}</strong>
          ${quantity}
        </div>
        <p>${entry.isEscrow ? (entry.inJob ? "委托加工中 · " : "委托加工 · ") : ""}${escapeHtml(entry.stageLabel || typeName(entry.item.type, entry.item))}</p>
        ${entry.isFinished && inlaySummary(entry.item) ? `<p class="inventory-finish-summary">${escapeHtml(inlaySummary(entry.item))}</p>` : ""}
        <div class="inventory-slot-value">
          <span>${entry.category === "external" ? "总价值" : "估值"}</span>
          <strong>${formatMoney(entry.totalValue)}</strong>
        </div>
        ${inventoryUi.recycleMode ? "" : action}
      </div>
    </article>
  `;
}

function inventoryEmptyState(allItems) {
  if (inventoryUi.category === "escrow") {
    return `
      <div class="inventory-empty game-empty-state">
        <span class="game-empty-state-mark" aria-hidden="true">托</span>
        <strong>暂无黑市委托物</strong>
        <p class="inventory-empty-hint">摊主确认接单后，委托物会出现在这里；加工中的委托也会保留在「委托」分类。</p>
        <button type="button" data-view-link="blackmarket">查看黑市技术单</button>
      </div>
    `;
  }
  if (allItems.length) {
    return `
      <div class="inventory-empty game-empty-state">
        <span class="game-empty-state-mark" aria-hidden="true">筛</span>
        <strong>没有符合条件的库存物品</strong>
        <p class="inventory-empty-hint">清除分类和搜索条件后查看全部库存。</p>
        <button class="secondary" data-inventory-reset type="button">清除筛选</button>
      </div>
    `;
  }
  return `
    <div class="inventory-empty game-empty-state">
      <span class="game-empty-state-mark" aria-hidden="true">库</span>
      <strong>库存还是空的</strong>
      <p class="inventory-empty-hint">先从公盘获得原料，再送进工坊加工。</p>
      <div class="game-empty-state-actions">
        <button type="button" data-view-link="auction">去公盘进料</button>
        <button class="secondary" type="button" data-view-link="shop">查看商铺</button>
      </div>
    </div>`;
}

function inventoryToolbar() {
  return `
    <div class="inventory-toolbar">
      <input id="inventorySearch" type="search" value="${escapeHtml(inventoryUi.query)}" placeholder="搜索名称、阶段或「委托」" aria-label="搜索库存">
      <span class="jm-result-status inventory-result-status" data-inventory-result aria-live="polite"></span>
      <select id="inventorySort" aria-label="库存排序">
        <option value="backpack" ${inventoryUi.sort === "backpack" ? "selected" : ""}>背包顺序</option>
        <option value="valueDesc" ${inventoryUi.sort === "valueDesc" ? "selected" : ""}>价值从高到低</option>
        <option value="valueAsc" ${inventoryUi.sort === "valueAsc" ? "selected" : ""}>价值从低到高</option>
        <option value="name" ${inventoryUi.sort === "name" ? "selected" : ""}>名称</option>
        <option value="rarity" ${inventoryUi.sort === "rarity" ? "selected" : ""}>稀有度</option>
      </select>
      <button class="secondary" data-inventory-reset type="button">重置</button>
    </div>
  `;
}

/** Jump to inventory and focus the escrow/委托 filter (used by side-order / blackmarket). */
export function focusInventoryEscrow(options = {}) {
  inventoryUi.category = "escrow";
  inventoryUi.query = String(options.query || "").trim();
  inventoryUi.sort = inventoryUi.sort || "backpack";
  lastInventoryRenderFp = "";
  renderInventory();
}

function mountInventoryPanel(panel) {
  if (!mountedInventoryPanels.has(panel)) {
    panel.innerHTML = `
      <div class="inventory-density" data-inventory-summary role="group" aria-label="库存工具"></div>
      ${inventoryToolbar()}
      <div class="inventory-warning" data-inventory-warning hidden></div>
      <div class="inventory-grid" data-inventory-grid></div>
    `;
    mountedInventoryPanels.add(panel);
    return;
  }
  // 旧版把「回收」叠在「重置」上；迁移回单按钮重置，回收改到分类行
  const acts = panel.querySelector?.(".inventory-toolbar-acts");
  if (!acts) return;
  const reset = acts.querySelector?.("[data-inventory-reset]");
  if (reset) {
    acts.replaceWith(reset);
    return;
  }
  const toolbar = panel.querySelector?.(".inventory-toolbar");
  if (!toolbar || typeof toolbar.insertAdjacentHTML !== "function") return;
  toolbar.insertAdjacentHTML("afterend", inventoryToolbar());
  toolbar.remove();
}

function inventoryActiveFilterCount() {
  return Number(inventoryUi.category !== "all") + Number(Boolean(inventoryUi.query.trim()));
}

function syncInventoryToolbar(panel, items = [], allItems = []) {
  const search = panel.querySelector?.("#inventorySearch");
  const sort = panel.querySelector?.("#inventorySort");
  const result = panel.querySelector?.("[data-inventory-result]");
  const reset = panel.querySelector?.("[data-inventory-reset]");
  if (search) search.value = inventoryUi.query;
  if (sort) sort.value = inventoryUi.sort;
  const activeFilters = inventoryActiveFilterCount();
  if (result) {
    result.textContent = `显示 ${items.length}/${allItems.length} 件${activeFilters ? ` · ${activeFilters} 项筛选` : ""}`;
    result.classList.toggle("is-filtered", activeFilters > 0);
  }
  if (reset) {
    const hasResettableState = activeFilters > 0 || inventoryUi.sort !== "backpack" || inventoryUi.recycleMode;
    reset.disabled = !hasResettableState;
    reset.title = hasResettableState ? "恢复默认库存视图" : "当前已是默认视图";
  }
  const recycleBtn = panel.querySelector?.('[data-action="toggleInventoryRecycle"]');
  if (recycleBtn) {
    recycleBtn.textContent = inventoryUi.recycleMode ? "完成" : "回收";
    recycleBtn.classList.toggle("jm-btn-gold", inventoryUi.recycleMode);
    recycleBtn.classList.toggle("secondary", !inventoryUi.recycleMode);
    recycleBtn.setAttribute("aria-pressed", inventoryUi.recycleMode ? "true" : "false");
  }
  panel.classList?.toggle?.("is-inventory-recycle", inventoryUi.recycleMode);
}

function paintInventoryGrid(gridRoot, items, allItems) {
  if (!gridRoot) return;
  if (!items.length) {
    inventoryVirtual?.destroy();
    inventoryVirtual = null;
    gridRoot.classList?.remove?.("virtual-grid-host");
    gridRoot.innerHTML = inventoryEmptyState(allItems);
    return;
  }
  if (items.length >= INVENTORY_VIRTUAL_THRESHOLD && typeof gridRoot.classList?.add === "function") {
    if (!inventoryVirtual) inventoryVirtual = createVirtualGridController({
      minItemWidth: 180,
      gap: 12,
      // 成品卡含操作按钮时实测约 420–430；过低会导致虚拟占位偏短、滚不到底。
      estimateRowHeight: 440,
      overscanRows: 2
    });
    if (!gridRoot.classList.contains("virtual-grid-host")) inventoryVirtual.mount(gridRoot);
    inventoryVirtual.setItems(items, (entry) => inventorySlot(entry), (windowEl) => {
      observeLazyPreviews(windowEl);
    });
    return;
  }
  inventoryVirtual?.destroy();
  inventoryVirtual = null;
  gridRoot.classList?.remove?.("virtual-grid-host");
  gridRoot.innerHTML = items.map(inventorySlot).join("");
  observeLazyPreviews(gridRoot);
}

export function renderInventory() {
  const panel = elsRef?.inventoryPanel;
  const state = getState?.();
  if (!panel || !state) return;
  mountInventoryPanel(panel);

  const helpers = {
    typeName,
    materialStageForClient,
    materialStageLabel,
    kitsFor,
    openingKitProductLabel
  };
  const allItems = buildInventoryItems(state, helpers);
  const items = filterAndSortInventory(allItems, inventoryUi);
  const fp = inventoryRenderFingerprint(state, items);
  const gridRoot = panel.querySelector("[data-inventory-grid]");
  if (fp === lastInventoryRenderFp && gridRoot?.childElementCount) {
    syncInventoryToolbar(panel, items, allItems);
    return;
  }
  lastInventoryRenderFp = fp;
  const summary = summarizeInventory(allItems);
  const catalogKeys = new Set((state.materialCatalog || []).map((material) => material.key || material.id));
  const catalogMissing = Object.entries(state.me?.externalMaterials || {}).some(([key, quantity]) => (
    Number.isFinite(Number(quantity))
    && Number(quantity) > 0
    && !catalogKeys.has(key)
  ));

  const summaryRoot = panel.querySelector("[data-inventory-summary]");
  const warningRoot = panel.querySelector("[data-inventory-warning]");
  if (summaryRoot) summaryRoot.innerHTML = inventoryCategoryFilters(summary);
  syncInventoryToolbar(panel, items, allItems);
  if (warningRoot) {
    warningRoot.hidden = !catalogMissing;
    warningRoot.innerHTML = catalogMissing ? "材料目录未加载完整" : "";
  }
  paintInventoryGrid(gridRoot, items, allItems);
}
