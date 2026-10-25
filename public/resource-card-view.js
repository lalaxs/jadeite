import { employeeOutlineSvg, equipmentOutlineSvg } from "./workshop-resource-art.js";
import { escapeHtml } from "./shell/format-utils.js";

// Shared by the black market, shop, employee roster and workshop selectors.
export function resourceCardArt(type, stage) {
  return `<span class="bm-resource-art resource-card-art" aria-hidden="true">${type === "employee" ? employeeOutlineSvg() : equipmentOutlineSvg(stage)}</span>`;
}

// Text is escaped here; body/footer and attributes are trusted markup from views.
export function renderResourceCard({ type, stage, name, badge, summary = [], body = "", footer = "", controlHtml = "", className = "", attributes = "", tag = "article", visualAttributes = "" }) {
  const visualTag = visualAttributes && tag !== "button" ? "button" : "span";
  const phrasing = tag === "button" || tag === "label";
  const copyTag = phrasing ? "span" : "div";
  const summaryTag = phrasing ? "span" : "p";
  return `<${tag} class="inventory-slot resource-card ${className}" ${attributes}>
    ${controlHtml}
    <${visualTag} class="inventory-slot-visual resource-card-visual" ${visualTag === "button" ? `type="button" ${visualAttributes}` : ""}>
      ${badge ? `<span class="inventory-slot-badge">${escapeHtml(badge)}</span>` : ""}
      ${resourceCardArt(type, stage)}
    </${visualTag}>
    <${copyTag} class="inventory-slot-copy resource-card-copy">
      <span class="inventory-slot-name"><strong>${escapeHtml(name)}</strong></span>
      ${summary.map((line) => `<${summaryTag} class="resource-card-summary">${escapeHtml(line)}</${summaryTag}>`).join("")}
      ${body ? `<${copyTag} class="resource-card-details">${body}</${copyTag}>` : ""}
      ${footer ? `<${copyTag} class="resource-card-footer">${footer}</${copyTag}>` : ""}
    </${copyTag}>
  </${tag}>`;
}
