// Independent inlay preview tester.
import { finishGemPolicy } from "../../../shared/domain/workshop/finished-product-design.js";
import { BANGLE_REFINEMENTS } from "../../../shared/domain/workshop/bangle-finish.js";
import { bangleFinishControls } from "./bangle-finish-ui.js";
import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { INLAY_PREVIEW_SHAPES, applyInlayPreviewTesterField, buildFinishPreviewProduct, buildInlayPreviewBaseItem, createInlayPreviewTesterState, metalPreviewVariants, normalizeInlayPreviewTesterState, previewCapabilityShape, settingPreviewVariants } from "../../inlay-preview-tester.js";

export function createWorkshopInlayPreview({ ui, document, helpers, ports }) {
  const { escapeHtml, empty, productCanvas } = helpers;
  const { finishCatalog, finishOptions } = ports;

let previewRoot = null;
function inlayPreviewTesterRootEl() {
  let root = previewRoot;
  if (root) return root;
  root = document.createElement("div");
  root.id = "inlay-preview-tester-root";
  previewRoot = root;
  root.className = "modal-root";
  root.addEventListener("click", handleInlayPreviewTesterClick);
  root.addEventListener("change", updateInlayPreviewTesterFromControl);
  root.addEventListener("input", updateInlayPreviewTesterFromControl);
  document.body.appendChild(root);
  return root;
}

function handleInlayPreviewTesterClick(event) {
  const actionTarget = event.target.closest("[data-inlay-preview-action]");
  const action = actionTarget?.dataset.inlayPreviewAction;
  if (!action || !ui.activeInlayPreviewTester) return;
  if (action === "close") {
    closeInlayPreviewTester();
    return;
  }
  if (action === "select-setting") {
    ui.activeInlayPreviewTester = applyInlayPreviewTesterField(
      ui.activeInlayPreviewTester,
      "settingId",
      actionTarget.dataset.settingId || "",
      finishCatalog()
    );
    patchInlayPreviewTester();
    return;
  }
  if (action === "select-metal") {
    ui.activeInlayPreviewTester = applyInlayPreviewTesterField(
      ui.activeInlayPreviewTester,
      "metalId",
      actionTarget.dataset.metalId || "",
      finishCatalog()
    );
    patchInlayPreviewTester();
  }
}

function updateInlayPreviewTesterFromControl(event) {
  const field = event.target?.dataset?.inlayPreviewField;
  if (!field || !ui.activeInlayPreviewTester) return;
  ui.activeInlayPreviewTester = applyInlayPreviewTesterField(
    ui.activeInlayPreviewTester,
    field,
    event.target.value,
    finishCatalog()
  );
  patchInlayPreviewTester();
}

function inlayPreviewTesterShell() {
  return `
    <section class="game-modal inlay-preview-tester-modal" role="dialog" aria-modal="true" aria-label="镶嵌预览测试">
      <header class="game-modal-head">
        <div class="game-modal-title">
          <h3>镶嵌预览测试</h3>
          <p>跳过工坊流程，直接查看不同配饰和材质的效果。</p>
        </div>
        <button class="modal-close" data-inlay-preview-action="close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="game-modal-body" data-inlay-preview-body></div>
      <footer class="game-modal-actions">
        <button class="secondary" data-inlay-preview-action="close" type="button">关闭</button>
      </footer>
    </section>
  `;
}

function inlayPreviewSelectOptions(keys, labels, selected, enabledKeys = keys) {
  return finishOptions(keys, labels, selected, { enabledKeys });
}

function renderInlayPreviewControls(state, catalog) {
  const gemPolicy = finishGemPolicy(state.draft);
  const shapeLabels = Object.fromEntries(INLAY_PREVIEW_SHAPES.map((shape) => [shape.id, shape.label]));
  if (state.shape === "bangle") return `<div class="inlay-preview-controls">
    <label class="finish-plan-field"><span>原料形态</span><select data-inlay-preview-field="shape">${inlayPreviewSelectOptions(INLAY_PREVIEW_SHAPES.map((shape) => shape.id), shapeLabels, state.shape)}</select></label>
    ${bangleFinishControls(escapeHtml).replaceAll("data-finish-field", "data-inlay-preview-field")}</div>`;
  const capability = previewCapabilityShape(state.shape);
  const settings = catalog.shapeSettings?.[capability] || [];
  const metals = catalog.settings?.[state.draft.settingId]?.metals || [];
  const settingNames = Object.fromEntries(
    Object.entries(catalog.settings || {}).map(([key, value]) => [key, value.name])
  );
  const backingAllowed = state.shape === "cabochon" && state.draft.productType === "ring";
  return `
    <div class="inlay-preview-controls">
      <label class="finish-plan-field">
        <span>原料形态</span>
        <select data-inlay-preview-field="shape">${inlayPreviewSelectOptions(INLAY_PREVIEW_SHAPES.map((shape) => shape.id), shapeLabels, state.shape)}</select>
      </label>
      <label class="finish-plan-field">
        <span>成品类型</span>
        <select data-inlay-preview-field="productType">${inlayPreviewSelectOptions(Object.keys(catalog.productTypeNames || {}), catalog.productTypeNames, state.draft.productType, catalog.productTypes?.[capability] || [])}</select>
      </label>
      <label class="finish-plan-field">
        <span>镶嵌方式</span>
        <select data-inlay-preview-field="settingId">${inlayPreviewSelectOptions(Object.keys(catalog.settings || {}), settingNames, state.draft.settingId, settings)}</select>
      </label>
      <label class="finish-plan-field">
        <span>金属材质</span>
        <select data-inlay-preview-field="metalId">
          <option value="">${metals.length ? "自动选择兼容金属" : "不使用金属"}</option>
          ${inlayPreviewSelectOptions(Object.keys(catalog.metals || {}), catalog.metals, state.draft.metalId, metals)}
        </select>
      </label>
      <label class="finish-plan-field">
        <span>配石</span>
        <select data-inlay-preview-field="gemId" ${gemPolicy.supports ? "" : "disabled"}>
          <option value="">${gemPolicy.required ? "请选择配石种类（微镶必选）" : "不使用配石"}</option>
          ${inlayPreviewSelectOptions(Object.keys(catalog.gems || {}), catalog.gems, state.draft.gemId)}
        </select>
        <small class="finish-plan-auto-hint">${escapeHtml(gemPolicy.hint)}</small>
      </label>
      <label class="finish-plan-field" ${state.draft.gemId ? "" : "hidden"}>
        <span>${escapeHtml(gemPolicy.title)}</span>
        <input data-inlay-preview-field="gemCount" type="number" readonly value="${Number(state.draft.gemCount || 0)}">
        <small class="finish-plan-auto-hint">${gemPolicy.kind === "channel" ? `左右各 ${state.draft.gemCount / 2} 颗，按槽长排布` : "数量由当前石座结构确定"}</small>
      </label>
      <label class="finish-plan-field"><span>抛光</span><select data-inlay-preview-field="polishId">${inlayPreviewSelectOptions(Object.keys(catalog.polishes || {}), catalog.polishNames, state.draft.polishId)}</select></label>
      <label class="finish-plan-field"><span>玉件尺寸</span><select data-inlay-preview-field="size">${inlayPreviewSelectOptions(["S", "M", "L"], { S: "小号", M: "中号", L: "大号" }, state.size)}</select></label>
      <label class="finish-plan-field" ${backingAllowed ? "" : "hidden"}>
        <span>底托</span>
        <select data-inlay-preview-field="backingId">${inlayPreviewSelectOptions(Object.keys(catalog.backings || {}), catalog.backingNames, state.draft.backingId)}</select>
      </label>
    </div>
  `;
}

function renderInlayPreviewSettingCard(variant, item, size = "compact") {
  return `
    <button class="inlay-preview-card ${variant.selected ? "is-active" : ""}" data-inlay-preview-action="select-setting" data-setting-id="${escapeHtml(variant.id)}" type="button">
      <span class="inlay-preview-card-visual">${productCanvas(buildFinishPreviewProduct(item, variant.draft), size)}</span>
      <span class="inlay-preview-card-label">${escapeHtml(variant.label)}</span>
    </button>
  `;
}

function renderInlayPreviewMetalCard(variant, item, size = "compact") {
  return `
    <button class="inlay-preview-card ${variant.selected ? "is-active" : ""}" data-inlay-preview-action="select-metal" data-metal-id="${escapeHtml(variant.id)}" type="button">
      <span class="inlay-preview-card-visual">${productCanvas(buildFinishPreviewProduct(item, variant.draft), size)}</span>
      <span class="inlay-preview-card-label">${escapeHtml(variant.label)}</span>
    </button>
  `;
}

function renderInlayPreviewMatrices(state, catalog, item) {
  if (state.shape === "bangle") return "";
  const settingCards = settingPreviewVariants(state, catalog)
    .map((variant) => renderInlayPreviewSettingCard(variant, item))
    .join("");
  const metalCards = metalPreviewVariants(state, catalog)
    .map((variant) => renderInlayPreviewMetalCard(variant, item))
    .join("");
  return `
    <section class="inlay-preview-matrix">
      <h4>镶嵌方式</h4>
      <div class="inlay-preview-card-grid">${settingCards || empty("暂无可预览镶嵌方式。")}</div>
      <h4>金属材质</h4>
      <div class="inlay-preview-card-grid">${metalCards || empty("暂无可预览金属材质。")}</div>
    </section>
  `;
}

function patchInlayPreviewTester() {
  const root = previewRoot;
  const body = root?.querySelector("[data-inlay-preview-body]");
  if (!root || !body || !ui.activeInlayPreviewTester) return;
  const catalog = finishCatalog();
  ui.activeInlayPreviewTester = normalizeInlayPreviewTesterState(ui.activeInlayPreviewTester, catalog);
  const item = buildInlayPreviewBaseItem(ui.activeInlayPreviewTester.shape, ui.activeInlayPreviewTester.size);
  body.innerHTML = `
    <div class="inlay-preview-tester-layout">
      ${renderInlayPreviewControls(ui.activeInlayPreviewTester, catalog)}
      <section class="inlay-preview-main">
        <div class="inlay-preview-main-visual">${productCanvas(buildFinishPreviewProduct(item, ui.activeInlayPreviewTester.draft), "finished")}</div>
        <div class="inlay-preview-current">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${ui.activeInlayPreviewTester.shape === "bangle" ? `手镯 · ${escapeHtml(BANGLE_REFINEMENTS[ui.activeInlayPreviewTester.draft.refinementId].name)}` : `${escapeHtml(catalog.productTypeNames?.[ui.activeInlayPreviewTester.draft.productType] || ui.activeInlayPreviewTester.draft.productType)} · ${escapeHtml(catalog.settings?.[ui.activeInlayPreviewTester.draft.settingId]?.name || ui.activeInlayPreviewTester.draft.settingId)}`}</span>
        </div>
      </section>
    </div>
    ${renderInlayPreviewMatrices(ui.activeInlayPreviewTester, catalog, item)}
  `;
}

function openInlayPreviewTester() {
  ui.activeInlayPreviewTester = createInlayPreviewTesterState(finishCatalog());
  const root = inlayPreviewTesterRootEl();
  root.innerHTML = inlayPreviewTesterShell();
  ui.inlayPreviewTesterLifecycleCleanup?.();
  ui.inlayPreviewTesterLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    shell: document.querySelector(".shell"),
    onClose: closeInlayPreviewTester
  });
  patchInlayPreviewTester();
}

function closeInlayPreviewTester() {
  ui.activeInlayPreviewTester = null;
  ui.inlayPreviewTesterLifecycleCleanup?.();
  ui.inlayPreviewTesterLifecycleCleanup = null;
  previewRoot?.remove(); previewRoot = null;
}

  return { inlayPreviewTesterRootEl, handleInlayPreviewTesterClick, updateInlayPreviewTesterFromControl, inlayPreviewTesterShell, inlayPreviewSelectOptions, renderInlayPreviewControls, renderInlayPreviewSettingCard, renderInlayPreviewMetalCard, renderInlayPreviewMatrices, patchInlayPreviewTester, openInlayPreviewTester, closeInlayPreviewTester };
}
