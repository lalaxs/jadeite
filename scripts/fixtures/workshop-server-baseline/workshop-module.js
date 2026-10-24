// Legacy public API; state lives in the created feature instance.
import { createWorkshopFeature } from "./create-workshop-feature.js";
export { createWorkshopFeature };

let current;
export function initWorkshopModule(deps) {
  current?.dispose();
  current = createWorkshopFeature(deps);
  current.mount();
}

export function workshopDevices(...args) { return current.workshopDevices(...args); }
export function workshopWorkers(...args) { return current.workshopWorkers(...args); }
export function workshopWorkerFor(...args) { return current.workshopWorkerFor(...args); }
export function workshopJobs(...args) { return current.workshopJobs(...args); }
export function workshopProcessableItems(...args) { return current.workshopProcessableItems(...args); }
export function workshopStageItems(...args) { return current.workshopStageItems(...args); }
export function workshopOutputLabel(...args) { return current.workshopOutputLabel(...args); }
export function workshopDurationMs(...args) { return current.workshopDurationMs(...args); }
export function workshopDurationLabel(...args) { return current.workshopDurationLabel(...args); }
export function workshopWorkerImpact(...args) { return current.workshopWorkerImpact(...args); }
export function workshopDeviceImpact(...args) { return current.workshopDeviceImpact(...args); }
export function workshopJobEstimate(...args) { return current.workshopJobEstimate(...args); }
export function workshopJobProgress(...args) { return current.workshopJobProgress(...args); }
export function tickWorkshopJobProgress(...args) { return current.tickWorkshopJobProgress(...args); }
export function workshopItemPreview(...args) { return current.workshopItemPreview(...args); }
export function workshopRecipeCard(...args) { return current.workshopRecipeCard(...args); }
export function workshopStepTabs(...args) { return current.workshopStepTabs(...args); }
export function workshopRecipeHome(...args) { return current.workshopRecipeHome(...args); }
export function workshopMaterialRow(...args) { return current.workshopMaterialRow(...args); }
export function workshopRecipeSummary(...args) { return current.workshopRecipeSummary(...args); }
export function workshopBigMaterialCard(...args) { return current.workshopBigMaterialCard(...args); }
export function workshopBigWorkerCard(...args) { return current.workshopBigWorkerCard(...args); }
export function workshopRecommendedWorkerId(...args) { return current.workshopRecommendedWorkerId(...args); }
export function workshopWorkerColumn(...args) { return current.workshopWorkerColumn(...args); }
export function workshopRecipePage(...args) { return current.workshopRecipePage(...args); }
export function renderWorkshop(...args) { return current.renderWorkshop(...args); }
export function workshopOpenPlanner(...args) { return current.workshopOpenPlanner(...args); }
export function workshopRefreshPlanner(...args) { return current.workshopRefreshPlanner(...args); }
export function workshopClosePlanner(...args) { return current.workshopClosePlanner(...args); }
export function renderPicker(...args) { return current.renderPicker(...args); }
export function workshopOpenPicker(...args) { return current.workshopOpenPicker(...args); }
export function workshopClosePicker(...args) { return current.workshopClosePicker(...args); }
export function workshopPickItem(...args) { return current.workshopPickItem(...args); }
export function workshopPickWorker(...args) { return current.workshopPickWorker(...args); }
export function workshopSetSort(...args) { return current.workshopSetSort(...args); }
export function workshopConfirmPickerWorker(...args) { return current.workshopConfirmPickerWorker(...args); }
export function workshopOpenDevice(...args) { return current.workshopOpenDevice(...args); }
export function focusWorkshopItem(...args) { return current.focusWorkshopItem(...args); }
export function workshopSelectStep(...args) { return current.workshopSelectStep(...args); }
export function workshopBackDevices(...args) { return current.workshopBackDevices(...args); }
export function workshopSelectItem(...args) { return current.workshopSelectItem(...args); }
export function finishOptions(...args) { return current.finishOptions(...args); }
export function openInlayPreviewTester(...args) { return current.openInlayPreviewTester(...args); }
export function closeInlayPreviewTester(...args) { return current.closeInlayPreviewTester(...args); }
export function patchFinishPlanPreview(...args) { return current.patchFinishPlanPreview(...args); }
export function workshopStartJob(...args) { return current.workshopStartJob(...args); }
export function workshopAssignWorker(...args) { return current.workshopAssignWorker(...args); }
export function workshopRecommendWorker(...args) { return current.workshopRecommendWorker(...args); }
