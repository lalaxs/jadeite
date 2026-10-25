// Opening feature barrel — bind deps + re-export public symbols

import {
  roughKits,
  openingStoneCache,
  OPENING_KIT_SERVER_TYPES,
  OPENING_KIT_BY_SERVER_TYPE,
  OPENING_KIT_TEMPLATE_IDS,
  BANGLE_RING_SIZES,
  PENDANT_SIZE_OPTIONS,
  selectedBangleRingSize,
  selectedPendantSize,
  selectedOpeningKitTpl,
  selectedOpeningKitId,
  activeDragKit,
  setSelectedBangleRingSize,
  setSelectedPendantSize,
  setSelectedOpeningKitId,
  setSelectedOpeningKitTpl,
  setActiveDragKit,
  normalizePendantSize,
  normalizeBangleRingSize,
  syncOpeningSizeDefaultsFromKit,
  openingKitSizeValue,
  openingKitSizeLabel
} from "./opening-state.js";

import {
  bindOpeningKitsRenderDeps,
  bindOpeningKitsUiDeps,
  kitsFor,
  selectOpeningDraftKit,
  clampOpeningKitPosition,
  openingKitsOverlapAt,
  findSafeOpeningPosition,
  refreshOpeningPlanUi,
  applyOpeningKitSizeToSelected,
  addRoughKit,
  clearRoughKits,
  removeOpeningKit,
  moveRoughKit,
  openingKitsForServer
} from "./opening-kits.js";

import {
  bindOpeningRenderDeps,
  openingSeedFor,
  openingStoneFor,
  openingKitTemplate,
  serverTypeForOpeningKit,
  openingTplForServerType,
  openingKitProductLabel,
  openingKitFromStored,
  productsReferencingRough,
  openingKitsFromProductPlacements,
  openingKitsForRender,
  openingStoneSvg,
  openingProductKitFor,
  openingProductSvg,
  productCutoutPlaceholder,
  componentJadeCutoutMarkup,
  productCanvas,
  roughBoard,
  roughPlannerControls,
  placementAnalysisRows
} from "./opening-render.js";

import {
  boardPointFromEvent,
  openingBoardPointFromEvent,
  registerOpeningPointerListeners
} from "./opening-pointer.js";

import {
  handleOpeningClick,
  registerOpeningActions
} from "./opening-actions.js";
import { bindPlannerDraftDeps } from "./planner-drafts.js";
import { defaultOpeningState } from "./opening-state.js";
import { defaultPlannerDraftRuntime } from "./planner-drafts.js";
import { defaultOpeningKits } from "./opening-kits.js";
import { defaultOpeningRender } from "./opening-render.js";
import { defaultOpeningPointer } from "./opening-pointer.js";
import { defaultOpeningActions } from "./opening-actions.js";

export { createOpeningRuntime } from "./create-opening-runtime.js";
export const defaultOpeningRuntime = {
  openingState: defaultOpeningState, drafts: defaultPlannerDraftRuntime,
  kits: defaultOpeningKits, render: defaultOpeningRender,
  pointer: defaultOpeningPointer, actions: defaultOpeningActions
};

// Wire kits ↔ render as soon as this barrel loads (avoid stub helpers).
bindOpeningKitsRenderDeps({
  openingKitTemplate,
  openingKitFromStored,
  serverTypeForOpeningKit
});

export function bindOpeningDeps(deps = {}) {
  bindPlannerDraftDeps({ getState: deps.getState });
  bindOpeningRenderDeps({
    getState: deps.getState,
    materialStageForClient: deps.materialStageForClient
  });
  bindOpeningKitsUiDeps({
    workshopRefreshPlanner: deps.workshopRefreshPlanner,
    renderWorkshop: deps.renderWorkshop,
    paintJades: deps.paintJades
  });
}

export {
  roughKits,
  openingStoneCache,
  OPENING_KIT_SERVER_TYPES,
  OPENING_KIT_BY_SERVER_TYPE,
  OPENING_KIT_TEMPLATE_IDS,
  BANGLE_RING_SIZES,
  PENDANT_SIZE_OPTIONS,
  selectedBangleRingSize,
  selectedPendantSize,
  selectedOpeningKitTpl,
  selectedOpeningKitId,
  activeDragKit,
  setSelectedBangleRingSize,
  setSelectedPendantSize,
  setSelectedOpeningKitId,
  setSelectedOpeningKitTpl,
  setActiveDragKit,
  normalizePendantSize,
  normalizeBangleRingSize,
  syncOpeningSizeDefaultsFromKit,
  openingKitSizeValue,
  openingKitSizeLabel,
  kitsFor,
  selectOpeningDraftKit,
  clampOpeningKitPosition,
  openingKitsOverlapAt,
  findSafeOpeningPosition,
  refreshOpeningPlanUi,
  applyOpeningKitSizeToSelected,
  addRoughKit,
  clearRoughKits,
  removeOpeningKit,
  moveRoughKit,
  openingKitsForServer,
  openingSeedFor,
  openingStoneFor,
  openingKitTemplate,
  serverTypeForOpeningKit,
  openingTplForServerType,
  openingKitProductLabel,
  openingKitFromStored,
  productsReferencingRough,
  openingKitsFromProductPlacements,
  openingKitsForRender,
  openingStoneSvg,
  openingProductKitFor,
  openingProductSvg,
  productCutoutPlaceholder,
  componentJadeCutoutMarkup,
  productCanvas,
  roughBoard,
  roughPlannerControls,
  placementAnalysisRows,
  boardPointFromEvent,
  openingBoardPointFromEvent,
  registerOpeningPointerListeners,
  handleOpeningClick,
  registerOpeningActions
};
