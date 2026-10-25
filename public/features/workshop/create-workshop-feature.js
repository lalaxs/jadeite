// Instance composition. Cross-controller callbacks are explicit, local ports.
import { createWorkshopScope } from "./scope.js";
import { createWorkshopUiState } from "./state.js";
import { createWorkshopSelectors } from "./selectors.js";
import { createWorkshopWorkerView } from "./worker-view.js";
import { createWorkshopItemPreview } from "./item-preview.js";
import { createWorkshopView } from "./view.js";
import { createWorkshopPicker } from "./picker-controller.js";
import { createWorkshopPlanner } from "./planner-controller.js";
import { createWorkshopFinish } from "./finish-controller.js";
import { createWorkshopInlayPreview } from "./inlay-preview-controller.js";
import { createWorkshopActions } from "./actions.js";
import { createFinishPlanModalController } from "../../finish-plan-modal-controller.js";
import { createWorkshopDeliveryUi } from "./delivery-ui.js";
import { createOpeningRuntime } from "../opening/create-opening-runtime.js";

export function createWorkshopFeature(deps) {
  const { socket: socketRef, getState, els: elsRef } = deps;
  const document = deps.document || globalThis.document;
  const opening = deps.opening || createOpeningRuntime({
    ...deps.plannerDrafts, getState, document,
    materialStageForClient: deps.helpers.materialStageForClient
  });
  const helpers = {
    ...deps.helpers,
    productCanvas: deps.helpers.productCanvas || opening.render.productCanvas,
    openingStoneSvg: deps.helpers.openingStoneSvg || opening.render.openingStoneSvg,
    openingKitsForRender: opening.render.openingKitsForRender,
    roughBoard: opening.render.roughBoard,
    roughPlannerControls: opening.render.roughPlannerControls,
    placementAnalysisRows: opening.render.placementAnalysisRows,
    kitsFor: opening.kits.kitsFor,
    openingKitsForServer: opening.kits.openingKitsForServer,
    roughKits: opening.openingState.roughKits
  };
  const ui = createWorkshopUiState();
  const scope = createWorkshopScope({ socket: socketRef, registerAction: deps.registerAction });
  let mounted = false;
  let delivery = null;
  const api = {};
  const forward = name => (...args) => api[name](...args);
  Object.assign(api, createWorkshopSelectors({ ui, getState, helpers }));
  Object.assign(api, createWorkshopWorkerView({
    helpers,
    ports: {
      workerStepPreview: forward("workerStepPreview"),
    }
  }));
  Object.assign(api, createWorkshopItemPreview({
    helpers,
    ports: {
      isWorkshopLeftoverMaterial: forward("isWorkshopLeftoverMaterial"),
    }
  }));
  Object.assign(api, createWorkshopView({
    ui, getState, elsRef, helpers,
    ports: {
      tierLabel: forward("tierLabel"),
      craftGradeBadge: forward("craftGradeBadge"),
      craftScoreLine: forward("craftScoreLine"),
      flawClass: forward("flawClass"),
      workshopDevices: forward("workshopDevices"),
      workshopWorkers: forward("workshopWorkers"),
      workshopWorkerFor: forward("workshopWorkerFor"),
      workshopJobs: forward("workshopJobs"),
      workshopProcessableItems: forward("workshopProcessableItems"),
      workshopRepairQuote: forward("workshopRepairQuote"),
      workshopJobEstimate: forward("workshopJobEstimate"),
      workshopItemPreview: forward("workshopItemPreview"),
      workshopRefreshPlanner: forward("workshopRefreshPlanner"),
      workerStepPreview: forward("workerStepPreview"),
      patchInlayPreviewTester: forward("patchInlayPreviewTester"),
    }
  }));
  Object.assign(api, createWorkshopPicker({
    ui, document, helpers,
    ports: {
      tierLabel: forward("tierLabel"),
      tierBadgeStyle: forward("tierBadgeStyle"),
      tierBorder: forward("tierBorder"),
      renderWorkerMiniScores: forward("renderWorkerMiniScores"),
      renderWorkerMiniTraitChips: forward("renderWorkerMiniTraitChips"),
      workshopDevices: forward("workshopDevices"),
      workshopWorkers: forward("workshopWorkers"),
      isWorkshopLeftoverMaterial: forward("isWorkshopLeftoverMaterial"),
      workshopProcessableItems: forward("workshopProcessableItems"),
      workshopHeldJadeItems: forward("workshopHeldJadeItems"),
      workshopStageItems: forward("workshopStageItems"),
      workshopItemPreview: forward("workshopItemPreview"),
      renderWorkshop: forward("renderWorkshop"),
      workshopSelectItem: forward("workshopSelectItem"),
      workerStepPreview: forward("workerStepPreview"),
      workshopAssignWorker: forward("workshopAssignWorker"),
    }
  }));
  Object.assign(api, createWorkshopPlanner({
    ui, document, helpers, opening, manageOpeningEvents: !deps.opening,
    ports: {
      workshopDevices: forward("workshopDevices"),
      workshopProcessableItems: forward("workshopProcessableItems"),
      workshopStageItems: forward("workshopStageItems"),
      renderWorkshop: forward("renderWorkshop"),
    }
  }));
  Object.assign(api, createWorkshopFinish({
    ui, getState, document, helpers,
    ports: {
      workshopDevices: forward("workshopDevices"),
      workshopWorkers: forward("workshopWorkers"),
      workshopStageItems: forward("workshopStageItems"),
      workshopDurationMs: forward("workshopDurationMs"),
      finishCatalog: forward("finishCatalog"),
    }
  }));
  Object.assign(api, createWorkshopInlayPreview({
    ui, document, helpers,
    ports: {
      finishCatalog: forward("finishCatalog"),
      finishOptions: forward("finishOptions"),
    }
  }));
  Object.assign(api, createWorkshopActions({
    ui, socketRef: scope.socket, elsRef, helpers, drafts: opening.drafts,
    ports: {
      workshopDevices: forward("workshopDevices"),
      workshopProcessableItems: forward("workshopProcessableItems"),
      workshopRecommendedWorkerId: forward("workshopRecommendedWorkerId"),
      renderWorkshop: forward("renderWorkshop"),
      openFinishPlanModal: forward("openFinishPlanModal"),
    }
  }));
  if (!deps.opening) opening.kits.bindOpeningKitsUiDeps({
    workshopRefreshPlanner: forward("workshopRefreshPlanner"),
    renderWorkshop: forward("renderWorkshop"), paintJades: helpers.paintJades
  });

  function mount() {
    if (mounted) return feature;
    mounted = true;
    scope.activate();
    opening.drafts.bindPlannerDraftDeps();
    api.bindWorkshopStepKeyboard();
    delivery = createWorkshopDeliveryUi({ socket: scope.socket, getState, els: elsRef, registerAction: scope.registerAction, helpers, document });
    ui.finishPlanController = createFinishPlanModalController({
      mount: api.mountFinishPlanShell,
      patch: api.patchFinishPlanModal,
      unmount: (root) => {
        ui.finishModalLifecycleCleanup?.();
        ui.finishModalLifecycleCleanup = null;
        root?.remove();
      },
      emit: (payload, acknowledge) => scope.socket.emit("startWorkshopJob", payload, (result) => {
        if (!mounted) return;
        if (typeof acknowledge === "function") acknowledge(result);
        if (result?.ok) api.workshopBackDevices();
      }),
      createRequestId: () => globalThis.crypto?.randomUUID?.() || `workshop-${Date.now()}`,
      onActiveChange: (modal) => {
        ui.activeFinishPlanModal = modal;
      }
    });
    const register = scope.registerAction;
    if (typeof register === "function") {
      register("selectWorkshopStep", ({ payload }) => api.workshopSelectStep(payload));
      register("openWorkshopDevice", ({ payload }) => api.workshopOpenDevice(payload));
      register("backWorkshopDevices", () => api.workshopBackDevices());
      register("selectWorkshopItem", ({ payload }) => api.workshopSelectItem(payload));
      register("startWorkshopJob", ({ target, payload }) => api.workshopStartJob(target, payload));
      register("assignWorkshopWorker", ({ target, payload }) => api.workshopAssignWorker(target, payload));
      register("recommendWorkshopWorker", ({ payload }) => api.workshopRecommendWorker(payload));
      register("claimCommission", ({ payload, target }) => {
        if (target?.dataset.submitting) return;
        if (target) { target.disabled = true; target.dataset.submitting = "true"; }
        scope.socket.emit("claimCommission", { commissionId: payload,
          requestId: globalThis.crypto?.randomUUID?.() || `commission-${Date.now()}-${Math.random().toString(36).slice(2)}`
        }, (result = {}) => {
          if (target) { delete target.dataset.submitting; target.disabled = false; }
          if (result.message) helpers.showToast?.(result.message);
          if (result.code === "FEATURE_DISPOSED") return;
          ui.lastWorkshopRenderFp = "";
          api.renderWorkshop();
        });
      });
      register("openWorkshopPicker", ({ payload }) => api.workshopOpenPicker(payload));
      register("closeWorkshopPicker", () => api.workshopClosePicker());
      register("pickWorkshopItem", ({ payload }) => api.workshopPickItem(payload));
      register("pickWorkshopWorker", ({ target, payload }) => api.workshopPickWorker(target, payload));
      register("confirmPickerWorker", ({ target, payload }) => api.workshopConfirmPickerWorker(target, payload));
      register("setWorkerSort", ({ target }) => api.workshopSetSort(target));
      register("openWorkshopPlanner", ({ payload }) => api.workshopOpenPlanner(payload));
      register("closeWorkshopPlanner", () => api.workshopClosePlanner(false));
      register("openInlayPreviewTester", () => api.openInlayPreviewTester());
    }
    return feature;
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    scope.dispose();
    api.disposeWorkshopKeyboard();
    api.disposeWorkshopPlanner();
    opening.drafts.dispose();
    ui.finishPlanController?.close();
    if (document) api.closeInlayPreviewTester();
    api.disposeWorkshopPicker();
    delivery?.close(true);
    delivery = null;
  }

  const feature = {
    mount, dispose, opening,
    workshopDevices: api.workshopDevices,
    workshopWorkers: api.workshopWorkers,
    workshopWorkerFor: api.workshopWorkerFor,
    workshopJobs: api.workshopJobs,
    workshopProcessableItems: api.workshopProcessableItems,
    workshopStageItems: api.workshopStageItems,
    workshopOutputLabel: api.workshopOutputLabel,
    workshopDurationMs: api.workshopDurationMs,
    workshopDurationLabel: api.workshopDurationLabel,
    workshopWorkerImpact: api.workshopWorkerImpact,
    workshopDeviceImpact: api.workshopDeviceImpact,
    workshopJobEstimate: api.workshopJobEstimate,
    workshopJobProgress: api.workshopJobProgress,
    tickWorkshopJobProgress: api.tickWorkshopJobProgress,
    workshopItemPreview: api.workshopItemPreview,
    workshopRecipeCard: api.workshopRecipeCard,
    workshopStepTabs: api.workshopStepTabs,
    workshopRecipeHome: api.workshopRecipeHome,
    workshopMaterialRow: api.workshopMaterialRow,
    workshopRecipeSummary: api.workshopRecipeSummary,
    workshopBigMaterialCard: api.workshopBigMaterialCard,
    workshopBigWorkerCard: api.workshopBigWorkerCard,
    workshopRecommendedWorkerId: api.workshopRecommendedWorkerId,
    workshopWorkerColumn: api.workshopWorkerColumn,
    workshopRecipePage: api.workshopRecipePage,
    renderWorkshop: (...args) => { api.reconcilePlannerDrafts(); return api.renderWorkshop(...args); },
    workshopOpenPlanner: api.workshopOpenPlanner,
    workshopRefreshPlanner: api.workshopRefreshPlanner,
    workshopClosePlanner: api.workshopClosePlanner,
    renderPicker: api.renderPicker,
    workshopOpenPicker: api.workshopOpenPicker,
    workshopClosePicker: api.workshopClosePicker,
    workshopPickItem: api.workshopPickItem,
    workshopPickWorker: api.workshopPickWorker,
    workshopSetSort: api.workshopSetSort,
    workshopConfirmPickerWorker: api.workshopConfirmPickerWorker,
    workshopOpenDevice: api.workshopOpenDevice,
    focusWorkshopItem: api.focusWorkshopItem,
    workshopSelectStep: api.workshopSelectStep,
    workshopBackDevices: api.workshopBackDevices,
    workshopSelectItem: api.workshopSelectItem,
    finishOptions: api.finishOptions,
    openInlayPreviewTester: api.openInlayPreviewTester,
    closeInlayPreviewTester: api.closeInlayPreviewTester,
    patchFinishPlanPreview: api.patchFinishPlanPreview,
    workshopStartJob: api.workshopStartJob,
    workshopAssignWorker: api.workshopAssignWorker,
    workshopRecommendWorker: api.workshopRecommendWorker,
  };
  return feature;
}
