export function createFinishPlanModalController({
  mount,
  patch,
  unmount,
  emit,
  createRequestId,
  onActiveChange = () => {}
}) {
  let activeModal = null;
  let mountedRoot = null;

  const setActiveModal = (modal) => {
    activeModal = modal;
    onActiveChange(modal);
  };

  const refresh = () => {
    if (!activeModal || !mountedRoot) return null;
    patch(activeModal, mountedRoot);
    return mountedRoot;
  };

  const close = () => {
    if (!activeModal && !mountedRoot) return;
    setActiveModal(null);
    unmount(mountedRoot);
    mountedRoot = null;
  };

  const open = (modal) => {
    setActiveModal(modal);
    mountedRoot = mount();
    refresh();
    return mountedRoot;
  };

  const confirm = () => {
    if (!activeModal || activeModal.submitting) return;
    const modal = activeModal;
    const requestId = createRequestId();
    modal.submitting = true;
    modal.error = "";
    refresh();
    emit({
      deviceId: modal.deviceId,
      itemId: modal.itemId,
      workerId: modal.workerId,
      finishPlan: structuredClone(modal.draft),
      requestId
    }, (result = {}) => {
      if (activeModal !== modal) return;
      if (result.ok) {
        close();
        return;
      }
      modal.submitting = false;
      modal.error = result.message || "开工失败，请检查方案后重试。";
      refresh();
    });
  };

  return {
    open,
    refresh,
    close,
    confirm,
    current: () => activeModal
  };
}
