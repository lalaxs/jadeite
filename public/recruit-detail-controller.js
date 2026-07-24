export function createRecruitDetailController({
  mount,
  patch,
  unmount,
  emit,
  createRequestId
}) {
  let activeModal = null;
  let mountedRoot = null;

  const close = () => {
    if (!activeModal && !mountedRoot) return;
    activeModal = null;
    unmount(mountedRoot);
    mountedRoot = null;
  };

  const refresh = () => {
    if (!activeModal || !mountedRoot) return null;
    if (patch(activeModal, mountedRoot) === false) {
      close();
      return null;
    }
    return mountedRoot;
  };

  const open = (candidateId) => {
    activeModal = {
      candidateId,
      submitting: false,
      error: ""
    };
    mountedRoot = mount();
    return refresh();
  };

  const confirm = () => {
    if (!activeModal || activeModal.submitting) return;
    const modal = activeModal;
    modal.submitting = true;
    modal.error = "";
    refresh();
    emit("recruitWorker", {
      candidateId: modal.candidateId,
      requestId: createRequestId()
    }, (result = {}) => {
      if (activeModal !== modal) return;
      if (result.ok) {
        close();
        return;
      }
      modal.submitting = false;
      modal.error = result.message || "招募失败，请稍后重试。";
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
