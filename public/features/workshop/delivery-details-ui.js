import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { buildInventoryItems } from "../../inventory-module.js";
import { inventoryDetailStats } from "../inventory/item-detail-model.js";
import { deliveryMaterialAnalysis } from "./delivery-material-analysis.js";

export function deliveryItemDetails(item, helpers) {
  const source = { rough: "rough", material: "materials", slice: "slices" }[item.type] || "bracelets";
  const [entry] = buildInventoryItems({ me: { [source]: [item] } }, { ...helpers, kitsFor: () => [] });
  const stats = inventoryDetailStats(entry, helpers);
  return { entry, stats };
}

export function createDeliveryDetailsUi({ parent, helpers }) {
  const esc = helpers.escapeHtml;
  let active = null;
  const fields = (stats) => stats.map(({ label, value }) => `<div class="delivery-detail-field"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("");
  function close() {
    if (!active) return;
    const current = active; active = null;
    current.cleanup(); current.root.remove();
  }
  return {
    close,
    summary(item) {
      const report = deliveryMaterialAnalysis(item);
      const rows = (values) => values.map(({ name, percent }) => `<div class="delivery-analysis-row"><span>${esc(name)}</span><b>${percent.toFixed(1)}%</b></div>`).join("");
      return `<p class="delivery-summary-eyebrow">开料分析</p><h3>${esc(item.name)}</h3>
        <section class="delivery-analysis-section"><h4>种水<small>玉肉内占比</small></h4>${report.grades.length ? rows(report.grades) : '<p class="delivery-analysis-empty">未检出可用玉肉</p>'}</section>
        <section class="delivery-analysis-section"><h4>颜色分布<small>占整块料面</small></h4>${rows(report.colors)}</section>
        <dl class="delivery-detail-fields delivery-analysis-defects">${fields([
          { label: "裂纹覆盖", value: `${report.crackPercent.toFixed(1)}%` },
          { label: "废料占比", value: `${report.wastePercent.toFixed(1)}%` }
        ])}</dl><p class="delivery-analysis-note">裂纹覆盖按玉肉上的裂纹影响区统计，占整块料面的比例。</p>`;
    },
    open(item) {
      close();
      const { entry, stats } = deliveryItemDetails(item, helpers);
      const visual = ["rough", "material", "slice"].includes(item.type)
        ? helpers.openingStoneSvg(item, { revealed: true, kits: helpers.openingKitsForRender?.(item) || [] }) : helpers.productCanvas(item, "finished");
      const root = document.createElement("div");
      root.className = "delivery-detail-root";
      root.innerHTML = `<section class="delivery-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="delivery-detail-title">
        <header class="delivery-detail-head"><div><h3 id="delivery-detail-title">${esc(entry.name)}</h3><p>物品详情 · ${esc(entry.stageLabel)}</p></div><button type="button" class="modal-close" data-detail-close aria-label="关闭物品详情">×</button></header>
        <div class="delivery-detail-body"><div class="delivery-detail-visual">${visual}</div><dl class="delivery-detail-fields">${fields(stats)}</dl></div>
        <footer><button type="button" class="delivery-collect" data-detail-close>返回领取弹窗</button></footer></section>`;
      document.body.append(root);
      root.querySelectorAll("[data-detail-close]").forEach((button) => button.addEventListener("click", close));
      active = { root, cleanup: activateModalLifecycle({ root, dialog: root.querySelector('[role="dialog"]'), shell: parent, onClose: close }) };
      helpers.paintJades(root);
    }
  };
}
