
import { defaultOpeningState } from "./opening-state.js";
import { defaultPlannerDraftRuntime } from "./planner-drafts.js";
import { defaultOpeningKits } from "./opening-kits.js";
export function createOpeningActions({ openingState = defaultOpeningState, drafts = defaultPlannerDraftRuntime, kits = defaultOpeningKits } = {}) {
  const { setSelectedBangleRingSize, setSelectedPendantSize, normalizePendantSize, normalizeBangleRingSize } = openingState;
  const { settlePlannerSubmission } = drafts;
  const { applyOpeningKitSizeToSelected, refreshOpeningPlanUi, addRoughKit, clearRoughKits, removeOpeningKit, openingKitsForServer } = kits;
/** @returns {boolean} true if the click was handled as an opening kit interaction */
function handleOpeningClick(target, event) {
  const kitSizeChoice = target?.closest?.("[data-opening-kit-size]");
  if (kitSizeChoice) {
    const kind = kitSizeChoice.dataset.openingKitSizeKind === "bangle" ? "bangle" : "pendant";
    const value = kitSizeChoice.dataset.openingKitSize;
    if (kind === "bangle") setSelectedBangleRingSize(normalizeBangleRingSize(value));
    else setSelectedPendantSize(normalizePendantSize(value));
    const roughId = kitSizeChoice.dataset.rough;
    if (roughId) {
      applyOpeningKitSizeToSelected(roughId, kind);
      refreshOpeningPlanUi(roughId);
    }
    return true;
  }

  const kitChoice = target?.closest?.("[data-opening-kit-choice]");
  if (kitChoice) {
    addRoughKit(kitChoice.dataset.rough, kitChoice.dataset.openingKitChoice);
    return true;
  }

  return false;
}

function registerOpeningActions(registerAction, deps = {}) {
  const { socket } = deps;

  registerAction("extractFromRough", ({ payload }) => {
    socket.emit("extractFromRough", {
      roughId: payload,
      kits: openingKitsForServer(payload),
      requestId: globalThis.crypto?.randomUUID?.() || `extract-${Date.now()}`
    }, (result = {}) => {
      if (result.ok) settlePlannerSubmission(payload, result);
    });
  });
  registerAction("clearRoughKits", ({ payload }) => clearRoughKits(payload));
  registerAction("removeOpeningKit", ({ payload, target }) => removeOpeningKit(payload, target.dataset.kitId));
  registerAction("startPolish", ({ payload }) => {
    socket.emit("startPolish", {
      roughId: payload,
      requestId: globalThis.crypto?.randomUUID?.() || `polish-${Date.now()}`
    });
  });
}

  return { handleOpeningClick, registerOpeningActions };
}

export const defaultOpeningActions = createOpeningActions();
export const { handleOpeningClick, registerOpeningActions } = defaultOpeningActions;
