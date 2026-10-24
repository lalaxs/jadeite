// UI-only state. Never written to the authoritative snapshot or save.
export function createWorkshopUiState() {
  return {
    activeWorkshopDeviceId: null,
    selectedWorkshopItemId: null,
    selectedWorkshopWorkerId: null,
    activeWorkshopStep: "open",
    activeWorkshopPicker: null,
    pickerMountKey: null,
    activePickerWorkerId: null,
    lastWorkshopRenderFp: "",
    activeWorkerSort: "default",
    activeKitPlanner: null,
    activeFinishPlanModal: null,
    activeInlayPreviewTester: null,
    finishPlanController: null,
    plannerModalLifecycleCleanup: null,
    finishModalLifecycleCleanup: null,
    inlayPreviewTesterLifecycleCleanup: null,
    workshopStepKeyboardBound: false,
    finishPlanPreviewMarkupCache: new WeakMap()
  };
}
