import { escapeHtml, formatMoney } from "../../shell/format-utils.js";
import { inventoryDetailAnalysis } from "./item-detail-analysis.js";

const OVERVIEW_FIELDS = new Set(["分类", "阶段", "数量", "持有", "开窗", "原件尺寸", "重量", "归属", "工分", "入库声望"]);
const RESOURCE_OVERVIEW_FIELDS = {
  employee: new Set(["岗位", "职位", "等阶", "优点", "缺点"]),
  equipment: new Set(["品牌", "型号"])
};
const VALUE_FIELDS = new Set(["售价", "估值", "总价值"]);
const COMPARISON_FIELDS = new Set(["参考估值", "同款新机价", "同阶招聘基准", "商店同批价", "较参考估值省", "修满后较新机省", "较同阶招聘省", "较商店同批省", "已记货品成本"]);
const COST_FIELDS = new Set(["购入分摊", "直接加工", "镶嵌材料", "历史合计成本"]);
const ARCHIVE_FIELDS = new Set(["矿山来源", "所属矿带", "开采环境", "开采档案", "班组默契", "值班班长", "井下分工", "矿工专精", "井下急报", "勘探成果"]);
const STATUS_LABELS = { revealed: "已揭露", partial: "局部已揭露", hidden: "未揭露", unavailable: "暂无统计" };

function percentage(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : fallback;
}

function chartWidth(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function chartColor(color) {
  // Palette colors come from the rendered material. Never interpolate arbitrary CSS.
  return /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(String(color || "")) ? color : "var(--jade)";
}

function materialAnalysisHtml(entry, report) {
  if (report.kind === "external") {
    const rows = [
      { label: "材料类型", value: entry.stageLabel || "镶嵌材料" },
      { label: "单价", value: `${formatMoney(entry.unitPrice)} / ${entry.unitLabel || "份"}` },
      { label: "用途", value: "工坊精加工镶嵌" }
    ];
    return `<section class="inventory-detail-analysis" aria-label="镶嵌材料详情">
      <header class="inventory-analysis-heading"><h4>材料详情</h4><span class="inventory-analysis-status">${escapeHtml(entry.stageLabel || "镶嵌材料")}</span></header>
      <dl class="inventory-analysis-fallback">${rows.map(({ label, value }) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      <p class="inventory-analysis-note">镶嵌材料不适用种水、裂纹和开料占比分析。</p>
    </section>`;
  }

  const isHidden = report.status === "hidden";
  const missingValue = isHidden || report.status === "partial" ? "未揭露" : "暂无统计";
  const grades = report.grades || [];
  const colors = report.colors || [];
  const partial = report.status === "partial";
  const heading = `<header class="inventory-analysis-heading"><h4>料质详情</h4><span class="inventory-analysis-status${isHidden ? " is-hidden" : ""}">${STATUS_LABELS[report.status] || "暂无统计"}</span></header>`;
  if (isHidden || (["partial", "unavailable"].includes(report.status) && !grades.length && !colors.length && report.crackPercent == null && report.wastePercent == null)) {
    return `<section class="inventory-detail-analysis" aria-label="种水与料质详情" data-analysis-status="${escapeHtml(report.status)}">
      ${heading}<p class="inventory-analysis-empty">${escapeHtml(isHidden ? "内部料质未揭露，开窗或开料后可查看。" : report.note || (partial ? "开窗仅揭露局部线索，完整料质需开料后查看。" : "暂无料质统计记录。"))}</p>
    </section>`;
  }
  const visibleColors = colors.length ? colors : [{ name: "内部颜色", percent: null }];
  const colorTrack = colors.filter(({ percent }) => chartWidth(percent) > 0);
  const gradeMarkup = grades.length
    ? grades.map(({ name, percent }) => `<div class="inventory-analysis-grade"><strong>${escapeHtml(name)}</strong><b>${percentage(percent, missingValue)}</b></div>
      ${typeof percent === "number" ? `<div class="inventory-analysis-track" aria-hidden="true"><span style="width:${chartWidth(percent)}%"></span></div>` : ""}`).join("")
    : `<div class="inventory-analysis-grade"><strong>${isHidden || report.status === "partial" ? "未揭露" : report.hasUsableJade === false ? "未检出可用玉肉" : "暂无种水记录"}</strong></div>`;

  return `<section class="inventory-detail-analysis" aria-label="种水与料质详情" data-analysis-status="${escapeHtml(report.status)}">
    ${heading}
    ${!partial || grades.length ? `<section class="inventory-analysis-section" aria-label="种水分布">
      <div class="inventory-analysis-label"><h5>种水</h5><small>玉肉内占比</small></div>
      ${gradeMarkup}
    </section>` : ""}
    ${!partial || colors.length ? `<section class="inventory-analysis-section" aria-label="颜色分布">
      <div class="inventory-analysis-label"><h5>颜色分布</h5><small>占整块料面</small></div>
      ${colorTrack.length ? `<div class="inventory-analysis-colors-track" aria-hidden="true">${colorTrack.map(({ color, percent }) => `<span style="width:${chartWidth(percent)}%;background:${chartColor(color)}"></span>`).join("")}</div>` : ""}
      <ul class="inventory-analysis-colors">${visibleColors.map(({ name, color, percent }) => `<li><span class="inventory-analysis-color-name">${color ? `<i style="background:${chartColor(color)}" aria-hidden="true"></i>` : ""}${escapeHtml(name)}</span><strong>${percentage(percent, missingValue)}</strong></li>`).join("")}</ul>
    </section>` : ""}
    ${!partial || report.crackPercent != null || report.wastePercent != null ? `<dl class="inventory-analysis-defects">
      ${!partial || report.crackPercent != null ? `<div><dt>裂纹覆盖</dt><dd>${percentage(report.crackPercent, missingValue)}</dd></div>` : ""}
      ${!partial || report.wastePercent != null ? `<div><dt>废料占比</dt><dd>${percentage(report.wastePercent, missingValue)}</dd></div>` : ""}
    </dl>` : ""}
    ${partial && report.note ? `<p class="inventory-analysis-note">${escapeHtml(report.note)}</p>` : ""}
  </section>`;
}

function fieldsHtml(stats, compact = false) {
  return stats.map(({ label, value }) => `<div class="inventory-detail-field${compact && label !== "归属" ? "" : " is-wide"}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function notesHtml(lines) {
  return lines.length ? `<div class="inventory-detail-notes">${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>` : "";
}

function priceSummaryHtml(stats) {
  const price = stats.find(({ label }) => VALUE_FIELDS.has(label));
  const comparison = stats.filter(({ label }) => COMPARISON_FIELDS.has(label));
  const costs = stats.filter(({ label }) => COST_FIELDS.has(label));
  if (!price && !comparison.length && !costs.length) return "";
  return `<section class="inventory-detail-summary${costs.length ? " has-costs" : ""}" aria-label="价格与成本">
    ${price ? `<dl class="inventory-detail-price"><dt>${escapeHtml(price.label)}</dt><dd>${escapeHtml(price.value)}</dd></dl>` : ""}
    ${comparison.length ? `<dl class="inventory-detail-comparison">${fieldsHtml(comparison)}</dl>` : ""}
    ${costs.length ? `<details class="inventory-detail-costs"><summary>成本明细</summary><dl class="inventory-detail-cost-facts">${fieldsHtml(costs)}</dl></details>` : ""}
  </section>`;
}

function detailFooterHtml(stats, notes, archiveLines) {
  const sources = stats.filter(({ label }) => ["摊位", "来源"].includes(label));
  const archive = stats.filter(({ label }) => ARCHIVE_FIELDS.has(label));
  if (!sources.length && !notes.length && !archive.length && !archiveLines.length) return "";
  return `<section class="inventory-detail-footer" aria-label="来源与说明">
    ${sources.length ? `<dl class="inventory-detail-source">${sources.map(({ label, value }) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}
    ${notesHtml(notes)}
    ${archive.length || archiveLines.length ? `<details class="inventory-detail-archive"><summary>来源档案${archive.find(({ label }) => label === "矿山来源") ? ` · ${escapeHtml(archive.find(({ label }) => label === "矿山来源").value)}` : ""}</summary><dl class="inventory-detail-secondary-facts">${fieldsHtml(archive)}</dl>${notesHtml(archiveLines)}</details>` : ""}
  </section>`;
}

export function inventoryItemDetailHtml(entry, { previewHtml, stats = [], lines = [], archiveLines = [], analysis = inventoryDetailAnalysis(entry), secondaryHtml, detailTitle = "物品详情", detailKind = "jade" } = {}) {
  const isOverview = (label) => OVERVIEW_FIELDS.has(label) || RESOURCE_OVERVIEW_FIELDS[detailKind]?.has(label);
  const overview = stats.filter(({ label }) => isOverview(label));
  const attributes = stats.filter(({ label }) => !isOverview(label) && !VALUE_FIELDS.has(label)
    && !COMPARISON_FIELDS.has(label) && !COST_FIELDS.has(label) && !ARCHIVE_FIELDS.has(label) && !["摊位", "来源", "线索"].includes(label)
    && !(["玉料种水", "花色"].includes(label) && (["hidden", "partial"].includes(analysis?.status)
      || (label === "玉料种水" ? analysis?.grades?.length : analysis?.colors?.length))));
  const hints = [...new Set([entry.item?.hint, ...stats.filter(({ label }) => label === "线索").map(({ value }) => value)].filter(Boolean))];
  const notes = [...new Set(lines.filter((line) => line && !hints.includes(line)))];
  const compact = analysis?.kind === "jade" && ["hidden", "partial", "unavailable"].includes(analysis.status)
    && !analysis.grades?.length && !analysis.colors?.length && analysis.crackPercent == null && analysis.wastePercent == null;
  const facts = `<dl class="inventory-detail-facts">${fieldsHtml(overview, true)}</dl>${notesHtml(hints)}`;
  return `<div class="inventory-detail-document${["employee", "equipment"].includes(detailKind) ? " is-resource" : ""}">
    ${priceSummaryHtml(stats)}
    <div class="inventory-detail-layout${compact ? " is-compact" : ""}">
    <section class="inventory-detail-overview" aria-label="物品概况">
      <div class="inventory-detail-preview" role="img" aria-label="${escapeHtml(entry.name)}">${previewHtml || ""}</div>
      ${compact ? "" : facts}
    </section>
    <div class="inventory-detail-content">
      ${compact && (overview.length || hints.length) ? `<section class="inventory-detail-basics" aria-label="基础信息"><header class="inventory-analysis-heading"><h4>基础信息</h4></header>${facts}</section>` : ""}
      ${secondaryHtml ?? (analysis ? materialAnalysisHtml(entry, analysis) : "")}
      ${attributes.length ? `<section class="inventory-detail-attributes${detailKind === "employee" ? " is-employee" : ""}" aria-label="${escapeHtml(detailTitle)}"><header class="inventory-analysis-heading"><h4>${escapeHtml(detailTitle)}</h4></header><dl class="inventory-detail-secondary-facts">${fieldsHtml(attributes, detailKind === "employee")}</dl></section>` : ""}
    </div>
    </div>
    ${detailFooterHtml(stats, notes, archiveLines)}
  </div>`;
}
