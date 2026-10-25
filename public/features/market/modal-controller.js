import { activateModalLifecycle } from "../../modal-lifecycle.js";

export function createMarketModalController({ elsRef, ui }) {


function marketModalRoots() {
  return [
    elsRef?.marketListModal,
    elsRef?.marketBuyModal,
    elsRef?.marketWantPostModal,
    elsRef?.marketWantApplyModal
  ].filter(Boolean);
}

function openMarketModal(root, { initialFocus } = {}) {
  if (!root) return;
  ui.marketModalLifecycleCleanup?.();
  ui.marketModalLifecycleCleanup = null;
  marketModalRoots().forEach((modalRoot) => {
    if (modalRoot !== root) modalRoot.hidden = true;
  });
  const focusTarget = initialFocus ? root.querySelector(initialFocus) : null;
  focusTarget?.setAttribute("data-modal-initial-focus", "");
  root.hidden = false;
  ui.marketModalLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    onClose: closeMarketModals
  });
  focusTarget?.removeAttribute("data-modal-initial-focus");
}

function closeMarketModals() {
  ui.marketModalLifecycleCleanup?.();
  ui.marketModalLifecycleCleanup = null;
  if (elsRef.marketListModal) elsRef.marketListModal.hidden = true;
  if (elsRef.marketBuyModal) elsRef.marketBuyModal.hidden = true;
  if (elsRef.marketWantPostModal) elsRef.marketWantPostModal.hidden = true;
  if (elsRef.marketWantApplyModal) elsRef.marketWantApplyModal.hidden = true;
}

  return { marketModalRoots, openMarketModal, closeMarketModals };
}
