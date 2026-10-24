// Inventory / material display helpers (moved from main.js)

import { productKindLabel } from "../jade-categories.js";
import { productMatchesOrder } from "../jade-rules.js";
import { reportSummary } from "../jade-loop.js";
import {
  MAX_COLLECTION_SIZE,
  collectRepLabel,
  collectRepFromValue
} from "../player-progression.js";
import { buildInventoryItems, inventoryPreview } from "../inventory-module.js";
import { formatMoney, formatNumber, escapeHtml } from "../shell/format-utils.js";
import { showToast } from "../shell/toast-fx.js";
import { openGameModal } from "../shell/game-modal.js";
import { inventoryDetailStats } from "./inventory/item-detail-model.js";
import { inventoryItemDetailHtml } from "./inventory/item-detail-view.js";

let getState = () => null;
let getSocket = () => null;
let kitsFor = () => [];
let openingKitProductLabel = () => "";

export function bindInventoryHelperDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.getSocket === "function") getSocket = deps.getSocket;
  if (typeof deps.kitsFor === "function") kitsFor = deps.kitsFor;
  if (typeof deps.openingKitProductLabel === "function") openingKitProductLabel = deps.openingKitProductLabel;
}

export function typeName(type, item = {}) {
  if (type === "equipment") return "设备";
  if (type === "planned" || item?._planned || item?.materialStage === "planned") return "规划产物";
  if (type === "leftover" || item?._leftover) return "规划余料";
  if (type === "bracelet") return `${materialStageLabel(item)} · ${productKindLabel(item.kind)}`;
  if (type === "rough") return materialStageLabel(item);
  return { material: "明料", slice: "片料" }[type] || type;
}

export function sumValue(items) {
  return items.reduce((sum, item) => sum + Number(item.value || item.price || 0), 0);
}

export function productionJobsFor(me) {
  return [
    ...(me.jobs || []),
    ...(me.polishingJobs || []).map((job) => ({
      ...job,
      stage: "rough",
      item: job.item || job.rough,
      options: { label: "粗加工", ...(job.options || {}) }
    }))
  ].filter((job) => job.item);
}

export function currentReportSummary() {
  const state = getState();

  const me = state?.me || {};
  return me.reports?.[0] || reportSummary(me.ledger || [], [
    ...(me.rough || []),
    ...(me.materials || []),
    ...(me.slices || []),
    ...(me.bracelets || [])
  ]);
}

export function riskTone(risk) {
  if (risk >= 80) return "高危";
  if (risk >= 55) return "谨慎";
  return "稳妥";
}

export function materialStageForClient(item = {}) {
  if (item.materialStage) return item.materialStage;
  if (item._planned || item.stage === "planned") return "planned";
  if (item.type === "rough") return item.revealed || item.polished ? "opened" : "rough";
  if (item.stage === "opened" || item.stage === "material") return "opened";
  if (item.stage === "carved") return "carved";
  if (item.stage === "polished") return "polished";
  if (item.stage === "finished" || item.inlaid) return "finished";
  if (item.type === "bracelet") return "finished";
  return "unknown";
}

export function findInventoryEntryById(id) {
  const state = getState();

  if (!id || !state?.me) return null;
  const helpers = {
    typeName,
    materialStageForClient,
    materialStageLabel,
    kitsFor,
    openingKitProductLabel
  };
  return buildInventoryItems(state, helpers).find((entry) => entry.id === id) || null;
}

export function inspectInventoryItem(id) {
  const state = getState();
  const socket = getSocket();

  const entry = findInventoryEntryById(id);
  if (!entry) {
    showToast("物品不存在或已离开库存");
    return;
  }
  if (entry.unseen) {
    const markId = entry.isPlanned ? (entry.plannedParentId || entry.item?._plannedParentId) : entry.id;
    if (markId) socket.emit("markInventorySeen", { ids: [markId] });
  }

  const item = entry.item || {};
  const stats = inventoryDetailStats(entry, { formatMoney, formatNumber, typeName });

  const lines = [];
  const archiveLines = [];
  if (entry.isEscrow || item.escrowOrderId) {
    lines.push("这是买家托管给你的黑市委托物：加工完成后请在「进行事项 → 订单」提交交还，不能当作自有库存出售或收藏。");
  }
  if (entry.isPlanned) {
    lines.push("这是已在明料上规划的套件产物预览。请在工坊「规划」页签开工取件后，才会变成真正的精雕毛坯。");
  } else if (entry.category === "rough" || item.type === "rough") {
    lines.push(item.revealed || materialStageForClient(item) !== "rough"
      ? "已开料，可在工坊继续加工。"
      : "暗料原石：种水未完全揭露，可去公盘对照或送工坊解料。");
    if (item.miningOrigin?.mineName) {
      const crewNames = Array.isArray(item.miningOrigin.crewNames) ? item.miningOrigin.crewNames.filter(Boolean) : [];
      const foremanNote = item.miningOrigin.foremanName
        ? `，由${item.miningOrigin.foremanName}负责${item.miningOrigin.foremanLabel || "现场指挥"}`
        : "";
      const roleNote = Array.isArray(item.miningOrigin.roleLabels) && item.miningOrigin.roleLabels.length
        ? `，井下分工为${item.miningOrigin.roleLabels.join("、")}`
        : "";
      const specializationNote = Array.isArray(item.miningOrigin.crewSpecializations) && item.miningOrigin.crewSpecializations.length
        ? `，专精矿工为${item.miningOrigin.crewSpecializations.join("、")}`
        : "";
      const incidentNote = item.miningOrigin.incidentName && item.miningOrigin.incidentChoiceLabel
        ? `，遇到${item.miningOrigin.incidentName}后采取${item.miningOrigin.incidentChoiceLabel}`
        : "";
      archiveLines.push(`由矿工队在${item.miningOrigin.mineName}开采获得${item.miningOrigin.conditionName ? `，当班环境为${item.miningOrigin.conditionName}` : ""}${crewNames.length ? `，班组为${crewNames.join("、")}` : ""}${foremanNote}${roleNote}${specializationNote}${incidentNote}，不占用普通员工。`);
    }
  } else if (entry.category === "external") {
    lines.push("镶嵌材料，在工坊精加工方案里选用。");
  } else if (entry.isFinished) {
    const collectionCount = (state.me?.collection || []).length;
    const collectionFull = collectionCount >= MAX_COLLECTION_SIZE;
    const collectHint = collectRepLabel(entry.totalValue ?? item.value, {
      alreadyGranted: Boolean(item.collectedRepGranted)
    });
    lines.push(collectionFull
      ? `最终成品。藏宝阁已满（${collectionCount}/${MAX_COLLECTION_SIZE}），请先放回仓库后再收藏。`
      : `最终成品：可收入藏宝阁（${collectionCount}/${MAX_COLLECTION_SIZE}，入库后冻结）。${collectHint}。也可去订单 / 交易行 / 直播间出手。`);
    if (!collectionFull) {
      const previewRep = collectRepFromValue(entry.totalValue ?? item.value, {
        alreadyGranted: Boolean(item.collectedRepGranted)
      });
      stats.push({
        label: "入库声望",
        value: previewRep > 0 ? `+${previewRep}` : (item.collectedRepGranted ? "已领取" : "不加")
      });
    }
  } else {
    lines.push("阶段产物：到工坊对应设备继续加工。");
  }

  const canCollect = entry.isFinished && !(entry.isEscrow || item.escrowOrderId) && !entry.isPlanned
    && (state.me?.collection || []).length < MAX_COLLECTION_SIZE;
  const routeItemId = entry.isPlanned
    ? (entry.plannedParentId || item?._plannedParentId || entry.id)
    : entry.id;
  const isOwned = !(entry.isEscrow || item.escrowOrderId);
  const routeAction = (label, destination, variant = "secondary") => ({
    label,
    variant,
    clientAction: "routeInventoryItem",
    payload: `${destination}|${routeItemId}`
  });
  const actions = [];
  if (entry.isFinished && !isOwned) {
    actions.push(routeAction("去处理委托", "blackmarket", "primary"));
    actions.push({ label: "关闭", variant: "secondary" });
  } else if (entry.isFinished && !entry.isPlanned) {
    actions.push(routeAction("匹配订单", "orders", "primary"));
    actions.push(routeAction("挂牌出售", "market"));
    actions.push(routeAction("加入直播", "livestream"));
    if (canCollect) actions.push({ label: "收入藏宝阁", clientAction: "collectBracelet", payload: entry.id, variant: "secondary" });
  } else if (entry.category === "external") {
    actions.push(routeAction("去精加工", "workshop-finish", "primary"));
    actions.push({ label: "关闭", variant: "secondary" });
  } else {
    actions.push(routeAction(entry.isPlanned ? "去工坊取件" : "继续加工", "workshop", "primary"));
    if (isOwned && !entry.isPlanned) {
      actions.push(routeAction("挂牌出售", "market"));
    }
    actions.push({ label: "关闭", variant: "secondary" });
  }
  openGameModal({
    id: `inventory-detail:${entry.id}`,
    title: entry.name,
    subtitle: entry.isPlanned
      ? `规划产物 · ${entry.typeLabel || "套件"}`
      : entry.isEscrow || item.escrowOrderId
        ? `委托加工 · ${entry.typeLabel || typeName(item.type, item)}`
        : (entry.typeLabel || typeName(item.type, item)),
    tone: entry.isPlanned ? "craft" : entry.isEscrow || item.escrowOrderId ? "craft" : "info",
    size: "wide",
    modalClass: "inventory-detail-modal",
    previewHtml: inventoryItemDetailHtml(entry, {
      previewHtml: inventoryPreview(entry, { eager: true, size: "finished" }),
      stats,
      lines,
      archiveLines
    }),
    actions: actions.length ? actions : [{ label: "知道了" }]
  });
}

export function materialStageLabel(itemOrStage = {}) {
  const stage = typeof itemOrStage === "string" ? itemOrStage : materialStageForClient(itemOrStage);
  return {
    rough: "暗料原石",
    opened: "明料",
    planned: "规划产物",
    carved: "精雕毛坯",
    polished: "抛光半成品",
    finished: "最终成品"
  }[stage] || "阶段产物";
}

export function finishedProducts() {
  const state = getState();

  return (state.me.bracelets || []).filter((product) => materialStageForClient(product) === "finished");
}

export function matchingBracelets(order) {
  return finishedProducts().filter((product) => productMatchesOrder(product, order));
}

export function productName(item) {
  return productKindLabel(item.kind) || item.design || "成品";
}

export function expertClueChips(rough) {
  const clues = Array.isArray(rough.expertClues) ? rough.expertClues : [];
  if (!clues.length) return "";
  return `<div class="expert-clues">${clues.map((clue) => `<span>${escapeHtml(clue)}</span>`).join("")}</div>`;
}

export function inventoryCounts(me = {}) {
  const productionJobs = productionJobsFor(me);
  // 开料后明料进 materials 桶；rough.revealed 只覆盖尚未迁桶的旧数据
  const revealedInRough = (me.rough || []).filter((rough) => rough.revealed || materialStageForClient(rough) === "opened").length;
  const materialsOpened = (me.materials || []).filter((item) => materialStageForClient(item) === "opened").length;
  return {
    sealed: (me.rough || []).filter((rough) => !rough.revealed && materialStageForClient(rough) === "rough").length,
    revealed: revealedInRough + materialsOpened,
    jobs: productionJobs.length,
    products: (me.bracelets || []).length,
    collection: (me.collection || []).length
  };
}
