import { jadePieceFor, jadePieceSizeLabel } from "../../../shared/domain/jade/jade-piece.js";
import { inlaySummary } from "../../product-meta.js";
import { formatMoney as money, formatNumber as number } from "../../shell/format-utils.js";
import { itemCost, itemCostComponents } from "../../../shared/domain/economy/item-cost.js";

// Public item fields are shared by inventory, workshop outputs and market listings.
// Only an owner's inventory includes its private costs and escrow ownership.
export function inventoryDetailStats(entry, { formatMoney = money, formatNumber = number, typeName = (type) => type,
  includeCost = true, includeOwnership = true, includeValue = true } = {}) {
  const item = entry.item || {};
  const windows = Array.isArray(item.windows) ? item.windows.length : Array.isArray(item.visual?.windows) ? item.visual.windows.length : 0;
  const stats = [
    { label: "分类", value: entry.categoryLabel },
    { label: "阶段", value: entry.stageLabel || typeName(item.type, item) },
    { label: entry.category === "external" ? "持有" : "数量", value: entry.category === "external" ? `${formatNumber(entry.quantity)}${entry.unitLabel || ""}` : "1 件" }
  ];
  if (includeValue) stats.push({ label: entry.category === "external" ? "总价值" : "估值", value: formatMoney(entry.totalValue) });
  if (includeCost && entry.category !== "external" && !entry.isPlanned) {
    const cost = itemCost(item);
    stats.push({ label: "已记货品成本", value: cost.complete ? formatMoney(cost.amount)
      : cost.amount > 0 ? `${formatMoney(cost.amount)}（已记部分）` : "待补全" });
    const breakdown = itemCostComponents(item);
    if (breakdown.complete) {
      for (const [key, label] of [["acquisition", "购入分摊"], ["processing", "直接加工"], ["materials", "镶嵌材料"]]) {
        stats.push({ label, value: formatMoney(breakdown.components[key] || 0) });
      }
      if (Number(breakdown.components.legacy || 0) > 0) stats.push({ label: "历史合计成本", value: formatMoney(breakdown.components.legacy) });
    }
  }
  if (Number(item.mass) > 0) stats.push({ label: "重量", value: `${Number(item.mass).toFixed(2)} kg` });
  if (windows) stats.push({ label: "开窗", value: `${windows} 处` });
  if (item.quality || item.qualityName) {
    stats.push({ label: "玉料种水", value: item.quality?.name || item.qualityName || item.quality });
  }
  const color = typeof item.color === "object" ? item.color?.name : item.color;
  if (color) stats.push({ label: "花色", value: color });
  if (jadePieceFor(item)) stats.push({ label: "原件尺寸", value: jadePieceSizeLabel(item) });
  if (item.craftGrade) stats.push({ label: "工分", value: String(item.craftGrade) });
  const finishSummary = inlaySummary(item);
  if (finishSummary) stats.push({ label: "成品工艺", value: finishSummary });
  if (item.hint) stats.push({ label: "线索", value: item.hint });
  if (item.miningOrigin?.mineName) {
    stats.push({ label: "矿山来源", value: item.miningOrigin.mineName });
    if (item.miningOrigin.beltLabel) {
      stats.push({ label: "所属矿带", value: item.miningOrigin.beltLabel });
    }
    if (item.miningOrigin.conditionName) {
      stats.push({ label: "开采环境", value: item.miningOrigin.conditionName });
    }
    if (item.miningOrigin.mineMasteryLevel != null) {
      stats.push({ label: "开采档案", value: `Lv.${Number(item.miningOrigin.mineMasteryLevel) || 0}` });
    }
    if (item.miningOrigin.crewBondLevel != null) {
      stats.push({ label: "班组默契", value: `Lv.${Number(item.miningOrigin.crewBondLevel) || 0}` });
    }
    if (item.miningOrigin.foremanName) {
      stats.push({
        label: "值班班长",
        value: `${item.miningOrigin.foremanName}${item.miningOrigin.foremanLabel ? ` · ${item.miningOrigin.foremanLabel}` : ""}`
      });
    }
    if (Array.isArray(item.miningOrigin.roleLabels) && item.miningOrigin.roleLabels.length) {
      stats.push({ label: "井下分工", value: item.miningOrigin.roleLabels.join("、") });
    }
    if (Array.isArray(item.miningOrigin.crewSpecializations) && item.miningOrigin.crewSpecializations.length) {
      stats.push({ label: "矿工专精", value: item.miningOrigin.crewSpecializations.join("、") });
    }
    if (item.miningOrigin.incidentName && item.miningOrigin.incidentChoiceLabel) {
      stats.push({
        label: "井下急报",
        value: `${item.miningOrigin.incidentName} · ${item.miningOrigin.incidentChoiceLabel}`
      });
    }
    if (item.miningOrigin.surveyReportUsed) {
      stats.push({ label: "勘探成果", value: "当班已采用" });
    }
  }
  if (includeOwnership && (entry.isEscrow || item.escrowOrderId)) {
    stats.unshift({ label: "归属", value: "黑市委托物" });
  }
  if (entry.isPlanned) {
    stats.push({ label: "来源", value: "明料套件规划" });
  }
  return stats;
}
