// Opening client actions + kit size/choice click handling (moved from main.js)

import {
  setSelectedBangleRingSize,
  setSelectedPendantSize,
  normalizePendantSize,
  normalizeBangleRingSize
} from "./opening-state.js";
import { settlePlannerSubmission } from "./planner-drafts.js";
import {
  applyOpeningKitSizeToSelected,
  refreshOpeningPlanUi,
  addRoughKit,
  clearRoughKits,
  openingKitsForServer
} from "./opening-kits.js";

/** @returns {boolean} true if the click was handled as an opening kit interaction */
export function handleOpeningClick(target, event) {
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

export function registerOpeningActions(registerAction, deps = {}) {
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
  registerAction("startPolish", ({ payload }) => {
    socket.emit("startPolish", {
      roughId: payload,
      requestId: globalThis.crypto?.randomUUID?.() || `polish-${Date.now()}`
    });
  });
}
