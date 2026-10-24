import { inventoryItemDetailHtml } from "../inventory/item-detail-view.js";
import { inventoryDetailStats } from "../inventory/item-detail-model.js";
import { workerJobLabel } from "../../worker-detail-view.js";
import { blackmarketResourceCard } from "./goods-display.js";

const CATEGORY_LABELS = { rough: "原石", stage: "阶段产物", finished: "成品", external: "镶嵌材料" };
const STAGE_LABELS = { rough: "暗料原石", opened: "明料", material: "明料", planned: "规划产物", carved: "精雕毛坯", polished: "抛光半成品", finished: "最终成品" };

function resourceStats(row) {
  const item = row.item || {};
  const employee = row.type === "employee";
  const fields = [{ label: "分类", value: employee ? "员工" : "设备" }, { label: "数量", value: employee ? "1 名" : "1 台" }];
  if (employee) {
    fields.push({ label: "岗位", value: workerJobLabel(item.job) });
    if (Number(item.tier) > 0) fields.push({ label: "等阶", value: `${Number(item.tier)}阶` });
  } else {
    if (item.brand) fields.push({ label: "品牌", value: item.brand });
    if (item.modelName || item.model) fields.push({ label: "型号", value: item.modelName || item.model });
    if (Number(item.techLevel) > 0) fields.push({ label: "科技等级", value: `${Number(item.techLevel)}级` });
    if (item.specs) fields.push({ label: "设备参数", value: item.specs });
  }
  return fields;
}

export function blackmarketItemDetailHtml(row, { previewHtml, stats = [], lines = [] } = {}) {
  const item = row.item || {};
  const resource = row.type === "employee" || row.type === "equipment";
  const stage = item.materialStage || item.stage || (row.type === "rough" ? item.revealed || item.polished ? "opened" : "rough"
    : row.type === "bracelet" ? "finished" : "opened");
  const category = row.type === "supply" ? "external" : stage === "rough" ? "rough" : stage === "finished" ? "finished" : "stage";
  const quantity = row.type === "supply" ? Math.max(0, Number(item.amount) || 0) : 1;
  const totalValue = Number(row.referencePrice ?? item.value ?? 0);
  const supplyStage = item.group === "metal" || item.unitLabel === "克" ? "金属"
    : item.group === "gem" || item.unitLabel === "颗" ? "宝石" : "镶嵌材料";
  const entry = {
    name: item.name || "黑市物品", item, stage,
    source: { rough: "rough", material: "materials", slice: "slices", bracelet: "bracelets" }[row.type],
    category, categoryLabel: CATEGORY_LABELS[category], quantity, totalValue,
    unitPrice: quantity > 0 ? totalValue / quantity : 0, unitLabel: item.unitLabel,
    stageLabel: row.type === "slice" ? "片料" : row.type === "supply" ? supplyStage : STAGE_LABELS[stage] || "阶段产物"
  };
  const publicStats = resource ? resourceStats(row)
    : inventoryDetailStats(entry, { includeCost: false, includeOwnership: false, includeValue: false })
      .map((field) => field.label === "持有" ? { ...field, label: "数量" } : field);
  // Trading quotes remain authoritative while all intrinsic fields use the
  // same model as inventory. A label appears only once after the merge.
  const fields = [...new Map([...stats, ...publicStats].map((field) => [field.label, field])).values()];
  return inventoryItemDetailHtml(entry, {
    previewHtml: resource ? blackmarketResourceCard(row) : previewHtml,
    stats: fields,
    lines: resource && item.specs ? lines.filter((line) => line !== item.specs) : lines,
    ...(resource ? { analysis: null, detailKind: row.type, detailTitle: row.type === "equipment" ? "设备详情" : "员工详情" } : {})
  });
}
