// Planning draft, drag-safe patches and commit/cancel lifecycle.
import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { patchPlannerBody } from "../../planner-dom.js";
import { activeDragKit } from "../opening/opening-state.js";
import {
  ensurePlannerDraft, subscribePlannerDrafts, plannerDraftStatus, persistPlannerDraft,
  confirmPlannerDraft, replacePlannerDraft, undoPlannerDraft, restoreConfirmedPlannerDraft,
  loadPlannerDraftVersion, finishPlannerDraftGesture, reconcilePlannerDrafts
} from "../opening/planner-drafts.js";

export function createWorkshopPlanner({ ui, document, helpers, ports }) {
  const { escapeHtml, kitsFor, roughBoard, roughPlannerControls, placementAnalysisRows, paintJades, showToast, renderInventory } = helpers;
  const { workshopDevices, workshopProcessableItems, workshopStageItems, renderWorkshop } = ports;

function plannerRootEl() {
  let root = document.getElementById("ws-planner-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "ws-planner-root";
  root.className = "ws-picker-overlay";
  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-draft-action]");
    if (action && ui.activeKitPlanner) {
      const { itemId, originalKits } = ui.activeKitPlanner;
      if (action.dataset.draftAction === "undo") undoPlannerDraft(itemId);
      if (action.dataset.draftAction === "redo") undoPlannerDraft(itemId, true);
      if (action.dataset.draftAction === "revert") replacePlannerDraft(itemId, originalKits);
      if (action.dataset.draftAction === "confirmed") restoreConfirmedPlannerDraft(itemId);
      if (action.dataset.draftAction === "retry") persistPlannerDraft(itemId);
      if (action.dataset.draftAction === "version") loadPlannerDraftVersion(itemId, action.dataset.draftVersion);
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

function buildPlannerShell(device, item) {
  return `
    <section class="ws-planner-modal" role="dialog" aria-modal="true" aria-label="规划套件">
      <header class="ws-picker-head">
        <div class="wsp-head-text">
          <h3>规划套件</h3>
          <p>${escapeHtml(item.name)} · ${escapeHtml(device.name)}</p>
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
  const toolbar = document.querySelector("#ws-planner-root [data-planner-draft-toolbar]");
  if (!planner || !toolbar) return;
  const status = plannerDraftStatus(planner.itemId);
  const open = Boolean(toolbar.querySelector("details")?.open);
  const time = (at) => new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const saved = status.error || (status.pending ? "开工结果待确认，草稿已保留" : status.saved
    ? `草稿已保存 · ${time(status.savedAt)}` : "修改后自动保存在当前浏览器");
  toolbar.innerHTML = `<div class="planner-draft-main">
    <div class="planner-draft-history" role="group" aria-label="规划历史">
      <button class="secondary small" type="button" data-draft-action="undo" ${status.canUndo ? "" : "disabled"} title="撤销 Ctrl+Z">撤销</button>
      <button class="secondary small" type="button" data-draft-action="redo" ${status.canRedo ? "" : "disabled"} title="重做 Ctrl+Shift+Z">重做</button>
    </div><span class="planner-draft-status${status.error ? " is-warning" : ""}" role="status" aria-live="polite">${escapeHtml(saved)}</span>
    ${status.error ? '<button class="secondary small" type="button" data-draft-action="retry">重试保存</button>' : ""}
    ${status.confirmedDiffers ? `<button class="secondary small" type="button" data-draft-action="confirmed" ${status.locked ? "disabled" : ""}>恢复上次确认</button>` : ""}
  </div>
  ${status.restored ? '<p class="planner-draft-note">已恢复上次布局。撤销记录从本次打开页面开始。</p>' : ""}
  ${status.alternatives.length ? `<details class="planner-draft-versions" ${open ? "open" : ""}><summary>另有 ${status.alternatives.length} 个草稿版本 · 各窗口独立保存</summary>
    <div>${status.alternatives.map((version) => `<button class="secondary small" type="button" data-draft-action="version" data-draft-version="${escapeHtml(version.key)}" ${status.locked ? "disabled" : ""}>载入 ${time(version.savedAt)} · ${version.count} 件</button>`).join("")}</div></details>` : ""}
  ${status.staleCount ? '<p class="planner-draft-note is-warning">材料或规则已变化，旧草稿副本已保留，本次请重新规划。</p>' : ""}
  ${status.invalidCount ? '<p class="planner-draft-note is-warning">有无法读取的草稿，已跳过；当前规划仍可正常使用。</p>' : ""}
  <p class="planner-draft-note">关闭会保留草稿；完成规划后仍需在工坊点击开工。</p>`;
  const root = document.getElementById("ws-planner-root");
  root?.classList.toggle("is-draft-pending", Boolean(status.locked));
  const revert = root?.querySelector('[data-draft-action="revert"]');
  const confirm = root?.querySelector('[data-planner-action="confirm"]');
  if (revert) revert.disabled = Boolean(status.locked);
  if (confirm) confirm.disabled = Boolean(status.locked);
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
  root.innerHTML = buildPlannerShell(device, item);
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
  const body = document.querySelector("#ws-planner-root [data-planner-body]");
  if (!item) {
    ui.activeKitPlanner = null;
    ui.plannerDraftSubscription?.(); ui.plannerDraftSubscription = null;
    ui.plannerModalLifecycleCleanup?.();
    ui.plannerModalLifecycleCleanup = null;
    document.getElementById("ws-planner-root")?.remove();
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
  if (options.dragging || activeDragKit?.roughId === roughId) {
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
    document.getElementById("ws-planner-root")?.remove();
    return;
  }
  if (commit) {
    const draftKits = typeof kitsFor === "function" ? (kitsFor(ui.activeKitPlanner.itemId) || []) : [];
    if (!draftKits.length) {
      showToast("请先摆放至少一个套件。");
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
  document.getElementById("ws-planner-root")?.remove();
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
  document?.getElementById("ws-planner-root")?.remove();
  ui.lastWorkshopRenderFp = "";
}

  return { plannerRootEl, buildPlannerShell, workshopOpenPlanner, workshopRefreshPlanner, workshopClosePlanner, disposeWorkshopPlanner, reconcilePlannerDrafts };
}
