// Workshop navigation, actions and command submission.
import { WORKSHOP_STEPS, deviceStep } from "./catalog.js";
import { defaultPlannerDraftRuntime } from "../opening/planner-drafts.js";

export function createWorkshopActions({ ui, socketRef, elsRef, helpers, ports, drafts = defaultPlannerDraftRuntime }) {
  const { ensurePlannerDraft, persistPlannerDraft, beginPlannerSubmission, settlePlannerSubmission,
    plannerSubmissionRequestId, plannerSubmissionRequest, reconcilePlannerDrafts } = drafts;
  const { openingKitsForServer, paintJades, showToast } = helpers;
  const { workshopDevices, workshopProcessableItems, workshopRecommendedWorkerId, renderWorkshop, openFinishPlanModal } = ports;
  let keyboardCleanup = null;

function bindWorkshopStepKeyboard() {
  if (ui.workshopStepKeyboardBound || !elsRef?.workshopRoot) return;
  ui.workshopStepKeyboardBound = true;
  const onKeydown = (event) => {
    const current = event.target.closest?.('.workshop-step-tab[role="tab"]');
    if (!current) return;
    const tabs = [...elsRef.workshopRoot.querySelectorAll('.workshop-step-tab[role="tab"]')];
    const index = tabs.indexOf(current);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const stepId = tabs[next].dataset.payload;
    workshopSelectStep(stepId);
    elsRef.workshopRoot.querySelector(`#workshopStepTab-${stepId}`)?.focus();
  };
  elsRef.workshopRoot.addEventListener("keydown", onKeydown);
  keyboardCleanup = () => elsRef.workshopRoot.removeEventListener?.("keydown", onKeydown);
}

function disposeWorkshopKeyboard() {
  keyboardCleanup?.();
  keyboardCleanup = null;
  ui.workshopStepKeyboardBound = false;
}

function workshopOpenDevice(payload) {
  ui.activeWorkshopDeviceId = payload;
  ui.selectedWorkshopItemId = null;
  const device = workshopDevices().find((entry) => entry.id === payload);
  ui.selectedWorkshopWorkerId = device?.workerId || (device ? workshopRecommendedWorkerId(device) : null);
  if (device) ui.activeWorkshopStep = deviceStep(device);
  renderWorkshop();
  paintJades();
}

function focusWorkshopItem(rawItemId) {
  const itemId = String(rawItemId || "").trim();
  if (!itemId) return false;
  const device = workshopDevices().find((entry) => (
    workshopProcessableItems(entry).some((item) => String(item.id) === itemId)
  ));
  if (!device) {
    showToast?.({ text: "当前没有可承接这件物品的加工设备。", tone: "warn" });
    return false;
  }
  ui.activeWorkshopDeviceId = device.id;
  ui.activeWorkshopStep = deviceStep(device);
  ui.selectedWorkshopItemId = itemId;
  ui.selectedWorkshopWorkerId = device.workerId || workshopRecommendedWorkerId(device);
  ui.lastWorkshopRenderFp = "";
  renderWorkshop();
  paintJades();
  return true;
}

function workshopSelectStep(payload) {
  if (!WORKSHOP_STEPS.some((step) => step.id === payload)) return;
  ui.activeWorkshopStep = payload;
  renderWorkshop();
  paintJades();
}

function workshopBackDevices() {
  ui.activeWorkshopDeviceId = null;
  ui.selectedWorkshopItemId = null;
  ui.selectedWorkshopWorkerId = null;
  renderWorkshop();
  paintJades();
}

function workshopSelectItem(payload) {
  const previousItemId = ui.selectedWorkshopItemId;
  const device = workshopDevices().find((entry) => entry.id === ui.activeWorkshopDeviceId);
  if (device?.stage === "carving" && previousItemId && previousItemId !== payload) {
    persistPlannerDraft(previousItemId);
  }
  ui.selectedWorkshopItemId = payload;
  if (device?.stage === "carving") ensurePlannerDraft(payload);
  renderWorkshop();
  paintJades();
}

function workshopStartJob(target, payload) {
  if (target?.dataset?.plannerSubmitting) return;
  reconcilePlannerDrafts();
  const deviceId = payload || ui.activeWorkshopDeviceId;
  const itemId = target.dataset.itemId || ui.selectedWorkshopItemId;
  const device = workshopDevices().find((item) => item.id === deviceId);
  const request = {
    deviceId,
    itemId,
    workerId: ui.selectedWorkshopWorkerId || device?.workerId,
    requestId: globalThis.crypto?.randomUUID?.() || `workshop-${Date.now()}`
  };
  if (device?.stage === "finishing") {
    const item = workshopProcessableItems(device).find((entry) => entry.id === itemId);
    if (!item) { showToast("请选择可精加工的套件。"); return; }
    openFinishPlanModal(device, item, request.workerId);
    return;
  }
  if (device?.stage === "carving") {
    request.kits = openingKitsForServer(itemId);
    if (!request.kits.length) { showToast("请先在明料上摆放套件。"); return; }
    request.requestId = plannerSubmissionRequestId(itemId) || request.requestId;
    const submitted = plannerSubmissionRequest(itemId);
    if (submitted) { for (const key of Object.keys(request)) delete request[key]; Object.assign(request, submitted); }
    if (!beginPlannerSubmission(itemId, request.requestId, request)) {
      showToast("开工结果正在确认，请稍候。"); return;
    }
  }
  if (target?.dataset) { target.dataset.plannerSubmitting = "true"; target.disabled = true; }
  let acknowledged = false;
  const timeout = globalThis.setTimeout(() => {
    if (acknowledged) return;
    if (target?.dataset) { delete target.dataset.plannerSubmitting; target.disabled = false; }
    if (device?.stage === "carving") settlePlannerSubmission(itemId, { ok: false, code: "ACK_TIMEOUT" }, request.requestId);
    showToast("开工结果待确认，规划已保留；可再次点击开工确认同一请求。");
  }, 10_000);
  timeout?.unref?.();
  socketRef.emit("startWorkshopJob", request, (result = {}) => {
    acknowledged = true; globalThis.clearTimeout(timeout);
    if (device?.stage === "carving" && !settlePlannerSubmission(itemId, result, request.requestId)) return;
    if (target?.dataset) { delete target.dataset.plannerSubmitting; target.disabled = false; }
    if (result.ok) {
      workshopBackDevices();
      return;
    }
    if (result.message) showToast(result.message);
  });
}

function workshopAssignWorker(target, payload) {
  const deviceId = payload || ui.activeWorkshopDeviceId;
  const workerId = target.dataset.workerId;
  if (!workerId || !deviceId) return;
  ui.selectedWorkshopWorkerId = workerId;
  socketRef.emit("assignWorkshopWorker", { deviceId, workerId });
}

function workshopRecommendWorker(payload) {
  const deviceId = payload || ui.activeWorkshopDeviceId;
  const device = workshopDevices().find((d) => d.id === deviceId);
  const workerId = device && workshopRecommendedWorkerId(device);
  if (workerId) {
    ui.selectedWorkshopWorkerId = workerId;
    socketRef.emit("assignWorkshopWorker", { deviceId, workerId });
    renderWorkshop();
  }
}

  return { bindWorkshopStepKeyboard, disposeWorkshopKeyboard, workshopOpenDevice, focusWorkshopItem, workshopSelectStep, workshopBackDevices, workshopSelectItem, workshopStartJob, workshopAssignWorker, workshopRecommendWorker };
}
