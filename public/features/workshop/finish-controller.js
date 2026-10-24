// Finish-plan controls, preview, validation and submission lifecycle.
import { createFinishPlanDraft, normalizeFinishPlanDraft, validateFinishPlanDraft } from "../../finish-plan-model.js";
import { finishGemPolicy, finishPieceRestriction } from "../../../shared/domain/workshop/finished-product-design.js";
import { bangleFinishControls, patchBangleFinishUi } from "./bangle-finish-ui.js";
import { jadePiecePreviewMarkup } from "../../jade-piece-view.js";
import { patchFinishPlanSelectOptions, preserveFinishPlanUiState } from "../../finish-plan-dom.js";
import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { workerProcessingFee } from "../../worker-economy.js";
import { buildFinishPreviewProduct } from "../../inlay-preview-tester.js";
import { openMaterialBuyModal } from "../../shop-module.js";
import { finishItemShape } from "./catalog.js";
import { publicStationFee } from "../../../shared/domain/economy/public-workstations.js";
import { equipmentRepairRate } from "../../../shared/domain/economy/equipment-maintenance.js";

export function createWorkshopFinish({ ui, getState, document, helpers, ports }) {
  const { formatMoney, formatDuration, escapeHtml, productCanvas } = helpers;
  const { workshopDevices, workshopWorkers, workshopStageItems, workshopDurationMs, finishCatalog } = ports;

function finishOptions(keys, labels, selected, {
  enabledKeys = keys,
  disabledReason = "当前组合不兼容"
} = {}) {
  const enabled = new Set(enabledKeys);
  return keys.map((key) => {
    const disabled = !enabled.has(key);
    const reason = disabled ? `（${disabledReason}）` : "";
    return `<option value="${escapeHtml(key)}" ${key === selected ? "selected" : ""} ${disabled ? `disabled title="${escapeHtml(disabledReason)}"` : ""}>${escapeHtml(labels?.[key] || key)}${escapeHtml(reason)}</option>`;
  }).join("");
}

function closeFinishPlanModal() {
  ui.finishPlanController.close();
}

function updateFinishPlanFromControl(event) {
  const field = event.target?.dataset?.finishField;
  if (!field || !ui.activeFinishPlanModal || ui.activeFinishPlanModal.submitting) return;
  const draft = ui.activeFinishPlanModal.draft;
  draft[field] = field === "gemCount"
    ? Number(event.target.value)
    : event.target.value === "" ? null : event.target.value;
  if (field === "gemId" && draft.gemId && draft.gemCount < 1) draft.gemCount = 1;
  ui.activeFinishPlanModal.error = "";
  ui.finishPlanController.refresh();
}

function finishRootEl() {
  let root = document.getElementById("finish-plan-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "finish-plan-root";
  root.className = "modal-root";
  root.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-finish-action]");
    const action = actionTarget?.dataset.finishAction;
    if (!action) return;
    if (action === "close") closeFinishPlanModal();
    else if (action === "confirm") confirmFinishPlan();
    else if (action === "buy-stock") {
      const materialId = actionTarget.dataset.materialId;
      if (materialId) openMaterialBuyModal(materialId);
    }
  });
  root.addEventListener("change", updateFinishPlanFromControl);
  root.addEventListener("input", updateFinishPlanFromControl);
  document.body.appendChild(root);
  return root;
}

function openFinishPlanModal(device, item, workerId) {
  const shape = finishItemShape(item);
  ui.finishPlanController.open({
    deviceId: device.id,
    itemId: item.id,
    workerId,
    shape,
    draft: createFinishPlanDraft(shape, finishCatalog(), item),
    submitting: false,
    error: ""
  });
}

function confirmFinishPlan() {
  ui.finishPlanController.confirm();
}

function mountFinishPlanShell() {
  const root = finishRootEl();
  root.innerHTML = `
    <section class="game-modal finish-plan-modal" role="dialog" aria-modal="true" aria-label="精加工方案">
      <header class="game-modal-head">
        <div class="game-modal-title">
          <h3>制定精加工方案</h3>
          <p data-finish-item-title></p>
        </div>
        <button class="modal-close" data-finish-action="close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="game-modal-body">
        <div class="finish-plan-comparison" data-finish-item-preview></div>
        <div class="finish-plan-grid">
          <label class="finish-plan-field"><span>成品类型</span><select data-finish-field="productType"></select></label>
          <label class="finish-plan-field"><span>镶嵌方式</span><select data-finish-field="settingId"></select></label>
          <label class="finish-plan-field">
            <span class="finish-plan-field-label">金属<em class="finish-plan-stock-hint" data-finish-stock="metal" hidden></em></span>
            <select data-finish-field="metalId"></select>
          </label>
          <label class="finish-plan-field"><span>抛光</span><select data-finish-field="polishId"></select></label>
          <label class="finish-plan-field">
            <span class="finish-plan-field-label">配石<em class="finish-plan-stock-hint" data-finish-stock="gem" hidden></em></span>
            <select data-finish-field="gemId"></select>
            <small class="finish-plan-auto-hint" data-finish-gem-policy></small>
          </label>
          <label class="finish-plan-field" data-finish-count="gem" hidden>
            <span data-finish-gem-title>配石数量 · 自动计算</span>
            <input data-finish-field="gemCount" type="number" readonly aria-label="当前石座所需配石颗数">
            <small class="finish-plan-auto-hint" data-finish-gem-count-hint></small>
          </label>
          <label class="finish-plan-field" data-finish-backing hidden>
            <span>底托</span><select data-finish-field="backingId"></select>
          </label>
        </div>
        <div class="finish-plan-summary">
          <div><span>预计增值</span><strong class="pos" data-finish-summary="value"></strong></div>
          <div><span>辅材参考成本</span><strong data-finish-summary="materials"></strong></div>
          <div><span>工位与维护</span><strong data-finish-summary="operating"></strong></div>
          <div><span>扣成本后新增货值</span><strong data-finish-summary="margin"></strong></div>
          <p class="finish-cost-note">以上为估值参考，实际售价受客户需求与销售折价影响。</p>
        </div>
      </div>
      <footer class="game-modal-actions">
        <div class="finish-plan-warning-wrap" data-finish-warning-wrap hidden>
          <p class="finish-plan-warning" data-finish-warning></p>
          <span class="finish-plan-buy-actions" data-finish-buy-actions></span>
        </div>
        <div class="finish-plan-action-btns">
          <button class="secondary" data-finish-action="close" type="button">取消</button>
          <button class="primary" data-finish-action="confirm" type="button"></button>
        </div>
      </footer>
    </section>
  `;
  if (ui.activeFinishPlanModal?.shape === "bangle") {
    root.querySelector(".finish-plan-grid").innerHTML = bangleFinishControls(escapeHtml);
    root.querySelector(".finish-plan-modal").classList.add("bangle-finish-modal");
    root.querySelector('[role="dialog"]').setAttribute("aria-label", "手镯精修方案");
  }
  ui.finishModalLifecycleCleanup?.();
  ui.finishModalLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    shell: document.querySelector(".shell"),
    onClose: closeFinishPlanModal
  });
  return root;
}

function patchFinishPlanModal() {
  if (!ui.activeFinishPlanModal) return;
  const root = document.getElementById("finish-plan-root");
  const item = workshopStageItems().find((entry) => entry.id === ui.activeFinishPlanModal.itemId);
  if (!root || !item) return closeFinishPlanModal();
  preserveFinishPlanUiState(root, () => patchFinishPlanModalFields(root, item));
}

function patchFinishPlanModalFields(root, item) {
  const catalog = finishCatalog();
  const { shape, draft } = ui.activeFinishPlanModal;
  const worker = workshopWorkers()
    .find((entry) => entry.id === ui.activeFinishPlanModal.workerId);
  const device = workshopDevices().find((entry) => entry.id === ui.activeFinishPlanModal.deviceId);
  const stationFee = publicStationFee(device, item, getState().me.id);
  const risk = Number(device?.attrs?.risk ?? 1);
  const wear = Math.max(1, Math.min(3, Math.round(1 + Math.max(0, risk - 1) * 5)));
  const upkeep = device?.publicStation ? 0 : Math.ceil(Number(device?.basePrice || 0) * wear / 100 * equipmentRepairRate(device));
  const workerFee = workerProcessingFee(worker, 0, {
    stage: "finishing",
    itemValue: item.value ?? item.price
  });
  normalizeFinishPlanDraft(shape, draft, catalog, item);
  patchFinishPlanPreview(root, item, draft);
  const validation = validateFinishPlanDraft({
    shape,
    draft,
    catalog,
    materials: getState().me.externalMaterials || {},
    cash: Number(getState().me.cash || 0),
    workerFee,
    itemValue: item.value ?? item.price,
    item
  });
  if (Number(getState().me.cash || 0) < stationFee) {
    validation.canStart = false;
    validation.reasons.push(`公共工位费需 ${formatMoney(stationFee)}，当前现金不足。`);
  }
  ui.activeFinishPlanModal.canStart = validation.canStart;
  if (shape === "bangle") {
    patchBangleFinishUi(root, { item, draft, worker, device, durationMs: workshopDurationMs(device, worker),
      formatMoney, formatDuration, escapeHtml, error: ui.activeFinishPlanModal.error || validation.reasons.join("；"),
      canStart: validation.canStart, submitting: ui.activeFinishPlanModal.submitting, stationFee, upkeep });
    return;
  }

  root.querySelector("[data-finish-item-title]").textContent =
    `${item.name} · ${worker?.name || "师傅"}`;

  const fields = Object.fromEntries(
    [...root.querySelectorAll("[data-finish-field]")].map((field) => [field.dataset.finishField, field])
  );
  const settings = catalog.shapeSettings?.[shape] || [];
  const metals = catalog.settings?.[draft.settingId]?.metals || [];
  const settingNames = Object.fromEntries(
    Object.entries(catalog.settings || {}).map(([key, value]) => [key, value.name])
  );

  const productTypes = catalog.productTypes?.[shape] || [];
  const productNames = Object.fromEntries(Object.entries(catalog.productTypeNames || {}).map(([key, name]) => {
    const reason = productTypes.includes(key) ? finishPieceRestriction(item, key) : "";
    return [key, reason ? `${name}（${reason}）` : name];
  }));
  patchFinishPlanSelectOptions(fields.productType,
    finishOptions(Object.keys(catalog.productTypeNames || {}), productNames, draft.productType, {
      enabledKeys: productTypes.filter((type) => !finishPieceRestriction(item, type))
    }), draft.productType);
  patchFinishPlanSelectOptions(fields.settingId,
    finishOptions(Object.keys(catalog.settings || {}), settingNames, draft.settingId, { enabledKeys: settings }),
    draft.settingId);
  patchFinishPlanSelectOptions(fields.metalId,
    `<option value="">${metals.length ? "请选择金属种类" : "不使用金属"}</option>${finishOptions(Object.keys(catalog.metals || {}), catalog.metals, draft.metalId, { enabledKeys: metals })}`,
    draft.metalId);
  patchFinishPlanSelectOptions(fields.polishId,
    finishOptions(Object.keys(catalog.polishes || {}), catalog.polishNames, draft.polishId),
    draft.polishId);
  patchFinishPlanSelectOptions(fields.gemId,
    `<option value="">${finishGemPolicy(draft).required ? "请选择配石种类（微镶必选）" : "不使用配石"}</option>${finishOptions(Object.keys(catalog.gems || {}), catalog.gems, draft.gemId)}`,
    draft.gemId);

  const gemPolicy = finishGemPolicy(draft);
  fields.gemCount.value = String(draft.gemCount || 0);
  fields.gemId.disabled = !gemPolicy.supports;
  root.querySelector('[data-finish-gem-policy]').textContent = gemPolicy.hint;
  root.querySelector('[data-finish-gem-title]').textContent = gemPolicy.title;
  root.querySelector('[data-finish-gem-count-hint]').textContent = gemPolicy.kind === "channel" ? `左右各 ${draft.gemCount / 2} 颗，按有效槽长排布` : gemPolicy.hint;
  fields.gemCount.readOnly = true;
  root.querySelector('[data-finish-count="gem"]').hidden = !draft.gemId;
  const backingAllowed = shape === "cabochon" && draft.productType === "ring";
  const backingField = root.querySelector("[data-finish-backing]");
  backingField.hidden = !backingAllowed;
  if (backingAllowed) {
    patchFinishPlanSelectOptions(fields.backingId,
      finishOptions(Object.keys(catalog.backings || {}), catalog.backingNames, draft.backingId),
      draft.backingId);
  }

  const metalStock = root.querySelector('[data-finish-stock="metal"]');
  const metalShort = (validation.stockShortages || []).some((entry) => entry.kind === "metal");
  metalStock.hidden = !validation.showMetalInventory;
  metalStock.classList.toggle("is-short", metalShort);
  metalStock.textContent = draft.metalId
    ? `当前持有 ${validation.metalHeld.toFixed(2)} 克 · 需要 ${Number(validation.quote?.metalAmount || 0).toFixed(2)} 克`
    : "";

  const gemStock = root.querySelector('[data-finish-stock="gem"]');
  const gemShort = (validation.stockShortages || []).some((entry) => entry.kind === "gem");
  gemStock.hidden = !validation.showGemInventory;
  gemStock.classList.toggle("is-short", gemShort);
  gemStock.textContent = draft.gemId
    ? `当前持有 ${validation.gemHeld} 颗 · 需要 ${Number(validation.quote?.gemCount || 0)} 颗`
    : "";

  root.querySelector('[data-finish-summary="value"]').textContent =
    `+${formatMoney(validation.quote?.valueBonus || 0)}`;
  root.querySelector('[data-finish-summary="materials"]').textContent = formatMoney(validation.quote?.materialCost || 0);
  root.querySelector('[data-finish-summary="operating"]').textContent = formatMoney(stationFee + upkeep);
  const margin = Number(validation.quote?.valueBonus || 0) - Number(validation.quote?.materialCost || 0) - stationFee - upkeep;
  const marginEl = root.querySelector('[data-finish-summary="margin"]');
  marginEl.textContent = `${margin >= 0 ? "+" : "−"}${formatMoney(Math.abs(margin))}`;
  marginEl.classList.toggle("neg", margin < 0);
  marginEl.classList.toggle("pos", margin >= 0);

  const warningWrap = root.querySelector("[data-finish-warning-wrap]");
  const warning = root.querySelector("[data-finish-warning]");
  const buyActions = root.querySelector("[data-finish-buy-actions]");
  const warningText = ui.activeFinishPlanModal.error || validation.reasons.join("；");
  const showWarning = Boolean(warningText);
  warningWrap.hidden = !showWarning;
  warning.textContent = warningText;

  const shortageButtons = (validation.stockShortages || []).map((entry) => {
    const name = entry.kind === "gem"
      ? (catalog.gems?.[entry.materialId] || "配石")
      : (catalog.metals?.[entry.materialId] || "金属");
    return `<button type="button" class="finish-plan-buy-btn" data-finish-action="buy-stock" data-material-id="${escapeHtml(entry.materialId)}">去购买${escapeHtml(name)}</button>`;
  }).join("");
  if (buyActions.dataset.buttonsHtml !== shortageButtons) {
    buyActions.innerHTML = shortageButtons;
    buyActions.dataset.buttonsHtml = shortageButtons;
  }

  const confirm = root.querySelector('[data-finish-action="confirm"]');
  confirm.disabled = !validation.canStart || ui.activeFinishPlanModal.submitting;
  confirm.textContent = ui.activeFinishPlanModal.submitting
    ? "正在提交…"
    : "确认开工";
}

function patchFinishPlanPreview(root, item, draft = null) {
  const preview = root.querySelector("[data-finish-item-preview]");
  if (!preview) return;
  const source = item?.sourceMaterial || {};
  const visual = source.visual || {};
  const placement = source.placement || {};
  const sourceKey = JSON.stringify([
    item?.id,
    item?.name,
    item?.materialStage,
    item?.kind,
    item?.design,
    item?.ringSize,
    item?.size,
    item?.jadePiece?.signature,
    source.roughId,
    source.roughName,
    source.openingSeed,
    visual.seed,
    visual.openingSeed,
    placement.id,
    placement.openingTpl,
    placement.kitType,
    placement.x,
    placement.y,
    placement.svgSpace,
    placement.rot ?? placement.rotation,
    placement.scale,
    placement.ringSize,
    draft?.productType,
    draft?.refinementId,
    draft?.settingId,
    draft?.metalId,
    draft?.gemId,
    draft?.gemCount,
    draft?.polishId,
    draft?.backingId
  ]);
  if (ui.finishPlanPreviewMarkupCache.get(preview) === sourceKey) return;
  const hideMount = preview.querySelector?.('[data-jade-hide-mount]')?.checked || false;
  preview.innerHTML = jadePiecePreviewMarkup(item, buildFinishPreviewProduct(item, draft))
    || productCanvas(buildFinishPreviewProduct(item, draft), "compact");
  const toggle = preview.querySelector?.('[data-jade-hide-mount]');
  if (toggle) toggle.checked = hideMount;
  ui.finishPlanPreviewMarkupCache.set(preview, sourceKey);
}

  return { finishOptions, closeFinishPlanModal, updateFinishPlanFromControl, finishRootEl, openFinishPlanModal, confirmFinishPlan, mountFinishPlanShell, patchFinishPlanModal, patchFinishPlanModalFields, patchFinishPlanPreview };
}
