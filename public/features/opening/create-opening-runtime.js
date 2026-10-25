import { createOpeningState } from "./opening-state.js";
import { createPlannerDraftRuntime } from "./planner-drafts.js";
import { createOpeningKits } from "./opening-kits.js";
import { createOpeningRender } from "./opening-render.js";
import { createOpeningPointer } from "./opening-pointer.js";
import { createOpeningActions } from "./opening-actions.js";

export function createOpeningRuntime(deps = {}) {
  const openingState = createOpeningState();
  const drafts = createPlannerDraftRuntime({ ...deps, openingState });
  const kits = createOpeningKits({ openingState, drafts, document: deps.document });
  const render = createOpeningRender({ ...deps, openingState, kits });
  kits.bindOpeningKitsRenderDeps(render);
  const pointer = createOpeningPointer({ openingState, drafts, kits, render, document: deps.document });
  const actions = createOpeningActions({ openingState, drafts, kits });
  return { openingState, drafts, kits, render, pointer, actions };
}
