// Planning draft, drag-safe patches and commit/cancel lifecycle.
import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { patchPlannerBody } from "../../planner-dom.js";

export function createWorkshopPlanner({ ui, document, helpers, ports, opening, manageOpeningEvents = false }) {
  const { escapeHtml, kitsFor, roughBoard, roughPlannerControls, placementAnalysisRows, paintJades, showToast, renderInventory } = helpers;
  const { ensurePlannerDraft, subscribePlannerDrafts, plannerDraftStatus, persistPlannerDraft,
    confirmPlannerDraft, replacePlannerDraft, undoPlannerDraft, finishPlannerDraftGesture, reconcilePlannerDrafts } = opening.drafts;
  const { openingPlanValidation } = opening.render;
  let plannerRoot = null;
  let stopPointer = null;
  const removePlannerRoot = () => {
    stopPointer?.(); stopPointer = null;
    plannerRoot?.remove(); plannerRoot = null;
  };
  const { workshopDevices, workshopProcessableItems, workshopStageItems, renderWorkshop } = ports;

function plannerRootEl() {
  let root = plannerRoot;
  if (root) return root;
  root = document.createElement("div");
  root.id = "ws-planner-root";
  root.className = "ws-picker-overlay";
  plannerRoot = root;
  if (manageOpeningEvents) stopPointer = opening.pointer.registerOpeningPointerListeners(root);
  root.addEventListener("click", (event) => {
    if (manageOpeningEvents) {
      if (opening.actions.handleOpeningClick(event.target, event)) { event.stopPropagation(); return; }
      const control = event.target.closest("[data-action]");
      if (control?.dataset.action === "clearRoughKits") {
        opening.kits.clearRoughKits(control.dataset.payload); event.stopPropagation(); return;
      }
      if (control?.dataset.action === "removeOpeningKit") {
        opening.kits.removeOpeningKit(control.dataset.payload, control.dataset.kitId); event.stopPropagation(); return;
      }
    }
    const action = event.target.closest("[data-draft-action]");
    if (action && ui.activeKitPlanner) {
      const { itemId, originalKits } = ui.activeKitPlanner;
      if (action.dataset.draftAction === "undo") undoPlannerDraft(itemId);
      if (action.dataset.draftAction === "redo") undoPlannerDraft(itemId, true);
      if (action.dataset.draftAction === "revert") replacePlannerDraft(itemId, originalKits);
      if (action.dataset.draftAction === "retry") persistPlannerDraft(itemId);
      workshopRefreshPlanner(itemId);
      return;
    }
    if (event.target.closest('[data-planner-action="cancel"]')) {
      workshopClosePlanner(false);
      return;
    }
    if (event.target.closest('[data-planner-action="confirm"]')) {
      workshopClosePlanner(true);
    }
  });
  root.addEventListener("keydown", (event) => {
    if (!ui.activeKitPlanner || !(event.ctrlKey || event.metaKey) || event.altKey
      || event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    undoPlannerDraft(ui.activeKitPlanner.itemId, key === "y" || event.shiftKey);
    workshopRefreshPlanner(ui.activeKitPlanner.itemId);
  });
  document.body.appendChild(root);
  return root;
}

function buildPlannerShell(item) {
  return `
    <section class="ws-planner-modal" role="dialog" aria-modal="true" aria-label="规划套件">
      <header class="ws-picker-head">
        <div class="wsp-head-text">
          <h3>规划套件</h3>
          <p>${escapeHtml(item.name)}</p>
        </div>
        <button class="ws-picker-close" data-planner-action="cancel" type="button" aria-label="关闭并保留草稿">×</button>
      </header>
      <div class="planner-draft-toolbar" data-planner-draft-toolbar></div>
      <div class="ws-planner-body" data-planner-body></div>
      <footer class="game-modal-actions">
        <button class="secondary" data-draft-action="revert" type="button">还原本次修改</button>
        <button class="primary" data-planner-action="confirm" type="button">完成规划</button>
      </footer>
    </section>
  `;
}

function patchDraftToolbar() {
  const planner = ui.activeKitPlanner;
  const toolbar = plannerRoot?.querySelector("[data-planner-draft-toolbar]");
  if (!planner || !toolbar) return;
  const status = plannerDraftStatus(planner.itemId);
  const saved = status.error ? "保存失败" : status.pending ? "等待开工确认" : status.saved ? "已保存" : "自动保存";
  toolbar.innerHTML = `<div class="planner-draft-main">
    <div class="planner-draft-history" role="group" aria-label="规划历史">
      <button class="secondary small" type="button" data-draft-action="undo" ${status.canUndo ? "" : "disabled"} title="撤销 Ctrl+Z">撤销</button>
      <button class="secondary small" type="button" data-draft-action="redo" ${status.canRedo ? "" : "disabled"} title="重做 Ctrl+Shift+Z">重做</button>
    </div><span class="planner-draft-status${status.error ? " is-warning" : ""}" role="status" aria-live="polite">${escapeHtml(saved)}</span>
    ${status.error ? '<button class="secondary small" type="button" data-draft-action="retry">重试保存</button>' : ""}
  </div>`;
  const root = plannerRoot;
  root?.classList.toggle("is-draft-pending", Boolean(status.locked));
  const revert = root?.querySelector('[data-draft-action="revert"]');
  const confirm = root?.querySelector('[data-planner-action="confirm"]');
  if (revert) revert.disabled = Boolean(status.locked);
  const item = workshopStageItems().find((entry) => entry.id === planner.itemId);
  const validation = item ? openingPlanValidation(item) : { ok: false, message: "" };
  if (confirm) {
    confirm.disabled = Boolean(status.locked) || !validation.ok;
    confirm.title = validation.message;
  }
}

function workshopOpenPlanner(payload) {
  const deviceId = payload || ui.activeWorkshopDeviceId;
  const device = workshopDevices().find((entry) => entry.id === deviceId);
  if (!device || device.stage !== "carving") {
    showToast("请先选择需要规划的石头。");
    return;
  }
  const item = workshopProcessableItems(device).find((entry) => entry.id === ui.selectedWorkshopItemId);
  if (!item) {
    showToast("请先选择需要规划的石头。");
    return;
  }
  const draft = ensurePlannerDraft(item);
  ui.activeKitPlanner = {
    deviceId,
    itemId: item.id,
    fingerprint: draft?.fingerprint,
    originalKits: structuredClone(kitsFor(item.id))
  };
  const root = plannerRootEl();
  root.innerHTML = buildPlannerShell(item);
  ui.plannerDraftSubscription?.();
  ui.plannerDraftSubscription = subscribePlannerDrafts((itemId) => {
    if (ui.activeKitPlanner?.itemId === itemId) patchDraftToolbar();
  });
  ui.plannerModalLifecycleCleanup?.();
  ui.plannerModalLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    shell: document.querySelector(".shell"),
    onClose: () => workshopClosePlanner(false)
  });
  workshopRefreshPlanner(item.id);
}

function workshopRefreshPlanner(roughId, options = {}) {
  if (!ui.activeKitPlanner || ui.activeKitPlanner.itemId !== roughId) return;
  const item = workshopStageItems().find((entry) => entry.id === roughId);
  const body = plannerRoot?.querySelector("[data-planner-body]");
  if (!item) {
    ui.activeKitPlanner = null;
    ui.plannerDraftSubscription?.(); ui.plannerDraftSubscription = null;
    ui.plannerModalLifecycleCleanup?.();
    ui.plannerModalLifecycleCleanup = null;
    removePlannerRoot();
    return;
  }
  if (!body) return;
  const draft = ensurePlannerDraft(item);
  if (draft && ui.activeKitPlanner.fingerprint !== draft.fingerprint) {
    // A second window may have consumed part of this material. The old entry
    // baseline is a different geometry and must never be restored into it.
    ui.activeKitPlanner.fingerprint = draft.fingerprint;
    ui.activeKitPlanner.originalKits = structuredClone(kitsFor(item.id));
  }
  patchDraftToolbar();
  const kits = kitsFor(roughId);
  // Socket snapshots also refresh this view. Keep the captured SVG mounted
  // throughout a drag, including those background refreshes.
  if (options.dragging || opening.openingState.activeDragKit?.roughId === roughId) {
    const tools = body.querySelector(".ws-planner-tools");
    if (tools) patchPlannerBody(tools, `${roughPlannerControls(item)}${placementAnalysisRows(item, kits)}`);
    return;
  }
  const markup = `
    <div class="ws-planner-canvas">${roughBoard(item)}</div>
    <div class="ws-planner-tools">
      ${roughPlannerControls(item)}
      ${placementAnalysisRows(item, kits)}
    </div>
  `;
  patchPlannerBody(body, markup, paintJades);
}

function workshopClosePlanner(commit = false) {
  if (!ui.activeKitPlanner) {
    ui.plannerModalLifecycleCleanup?.();
    ui.plannerModalLifecycleCleanup = null;
    removePlannerRoot();
    return;
  }
  if (commit) {
    const draftKits = typeof kitsFor === "function" ? (kitsFor(ui.activeKitPlanner.itemId) || []) : [];
    if (!draftKits.length) {
      showToast("请先摆放至少一个套件。");
      return;
    }
    const item = workshopStageItems().find((entry) => entry.id === ui.activeKitPlanner.itemId);
    const validation = item && openingPlanValidation(item, draftKits);
    if (!validation?.ok) {
      showToast(validation?.message || "请重新选择石料。");
      return;
    }
    confirmPlannerDraft(ui.activeKitPlanner.itemId);
  }
  finishPlannerDraftGesture(ui.activeKitPlanner.itemId);
  persistPlannerDraft(ui.activeKitPlanner.itemId);
  ui.plannerDraftSubscription?.(); ui.plannerDraftSubscription = null;
  ui.activeKitPlanner = null;
  ui.plannerModalLifecycleCleanup?.();
  ui.plannerModalLifecycleCleanup = null;
  removePlannerRoot();
  ui.lastWorkshopRenderFp = "";
  renderWorkshop();
  if (typeof renderInventory === "function") renderInventory();
}

function disposeWorkshopPlanner() {
  if (ui.activeKitPlanner) {
    finishPlannerDraftGesture(ui.activeKitPlanner.itemId);
    persistPlannerDraft(ui.activeKitPlanner.itemId);
  }
  ui.plannerDraftSubscription?.(); ui.plannerDraftSubscription = null;
  ui.activeKitPlanner = null;
  ui.plannerModalLifecycleCleanup?.();
  ui.plannerModalLifecycleCleanup = null;
  removePlannerRoot();
  ui.lastWorkshopRenderFp = "";
}

  return { plannerRootEl, buildPlannerShell, workshopOpenPlanner, workshopRefreshPlanner, workshopClosePlanner, disposeWorkshopPlanner, reconcilePlannerDrafts };
}
