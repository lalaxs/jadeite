import { clampClient } from "../../shell/format-utils.js";
import { computeOverlaps } from "../../jade-opening-engine.js";
import { defaultOpeningState } from "./opening-state.js";
import { defaultPlannerDraftRuntime } from "./planner-drafts.js";
import { defaultOpeningKits } from "./opening-kits.js";
import { defaultOpeningRender } from "./opening-render.js";
export function createOpeningPointer({ openingState = defaultOpeningState, drafts = defaultPlannerDraftRuntime, kits = defaultOpeningKits, render = defaultOpeningRender, document = globalThis.document } = {}) {
  const { setActiveDragKit } = openingState;
  const { beginPlannerDraftGesture, finishPlannerDraftGesture } = drafts;
  const getState = () => render.getState();
  const { openingKitFromStored, openingKitsForRender, openingPlanValidation } = render;
  const { moveRoughKit, kitsFor, refreshOpeningPlanUi, selectOpeningDraftKit } = kits;
const DRAG_FEEDBACK_INTERVAL = 100;
let dragFrame = null;
let pendingPoint = null;
let lastFeedbackAt = 0;

function refreshDragFeedback(drag) {
  // Keep saved cutouts in the existing overlap calculation as well.
  const me = getState()?.me;
  const rough = [...(me?.materials || []), ...(me?.rough || []), ...(me?.slices || [])]
    .find((item) => item.id === drag.roughId);
  const kits = rough ? openingKitsForRender(rough) : kitsFor(drag.roughId).map((kit) => openingKitFromStored(kit));
  const overlaps = computeOverlaps(kits);
  const invalid = rough ? openingPlanValidation(rough).invalid : overlaps;
  for (const node of drag.board.querySelectorAll(".kit:not(.extracted)")) {
    const selected = node.dataset.uid === openingState.selectedOpeningKitId;
    const overlapping = invalid.has(node.dataset.uid);
    node.classList.toggle("sel", selected);
    for (const outline of node.querySelectorAll(".kit-wire > *")) {
      outline.setAttribute("stroke", overlapping ? "#ff4636" : selected ? "#d4af37" : "rgba(255,255,255,.58)");
      outline.setAttribute("stroke-width", selected || overlapping ? "3" : "2");
    }
  }
  refreshOpeningPlanUi(drag.roughId, { dragging: true });
}

function applyPendingDragPoint() {
  const drag = openingState.activeDragKit;
  const point = pendingPoint;
  pendingPoint = null;
  if (!drag?.board.isConnected || !point) return;
  const position = openingBoardPointFromEvent(drag.board, point);
  const kit = moveRoughKit(drag.roughId, drag.kitId, position.x, position.y, { refresh: false, transient: true });
  if (!kit) return;
  drag.node.setAttribute("transform", `translate(${kit.x.toFixed(1)} ${kit.y.toFixed(1)}) rotate(${Number(kit.rot || 0).toFixed(1)}) scale(${Number(kit.scale || 1).toFixed(4)})`);
}

function finishOpeningDrag(event) {
  const drag = openingState.activeDragKit;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (dragFrame !== null) cancelAnimationFrame(dragFrame);
  dragFrame = null;
  // A quick release can arrive before the animation frame; retain its final move.
  applyPendingDragPoint();
  finishPlannerDraftGesture(drag.roughId);
  setActiveDragKit(null);
  if (drag.board.hasPointerCapture?.(drag.pointerId)) drag.board.releasePointerCapture(drag.pointerId);
  if (drag.board.isConnected) refreshOpeningPlanUi(drag.roughId);
}

function boardPointFromEvent(board, event, kitType = null) {
  const rect = board.getBoundingClientRect();
  const point = {
    x: (event.clientX - rect.left) / rect.width * 100,
    y: (event.clientY - rect.top) / rect.height * 100
  };
  if (kitType) return point;
  return {
    x: clampClient(point.x, 16, 84),
    y: clampClient(point.y, 16, 84)
  };
}

function openingBoardPointFromEvent(board, event) {
  const rect = board.getBoundingClientRect();
  return {
    x: clampClient((event.clientX - rect.left) / rect.width * 600, 0, 600),
    y: clampClient((event.clientY - rect.top) / rect.height * 600, 0, 600)
  };
}

function registerOpeningPointerListeners(root = (document || globalThis.document).body) {
  const cleanups = [];
  const on = (name, handler) => {
    const listener = (event) => { handler(event); if (root !== (document || globalThis.document).body) event.stopPropagation?.(); };
    root.addEventListener(name, listener);
    cleanups.push(() => root.removeEventListener(name, listener));
  };
  on("pointerdown", (event) => {
    if (openingState.activeDragKit && !openingState.activeDragKit.board.isConnected) finishOpeningDrag({ pointerId: openingState.activeDragKit.pointerId });
    if (openingState.activeDragKit || event.button > 0 || event.isPrimary === false) return;
    const openingKit = event.target.closest(".jade-opening-board .kit[data-uid]");
    if (openingKit && !openingKit.classList.contains("extracted")) {
      const board = openingKit.closest("[data-opening-board]");
      if (!board) return;
      const roughId = board.dataset.openingBoard;
      const kitId = openingKit.dataset.uid;
      if (!selectOpeningDraftKit(roughId, kitId)) return;
      if (!beginPlannerDraftGesture(roughId)) return;
      setActiveDragKit({
        mode: "opening",
        roughId,
        kitId,
        board,
        node: openingKit,
        pointerId: event.pointerId
      });
      board.setPointerCapture?.(event.pointerId);
      lastFeedbackAt = performance.now();
      refreshDragFeedback(openingState.activeDragKit);
      event.preventDefault();
      return;
    }
  });

  on("pointermove", (event) => {
    if (!openingState.activeDragKit || event.pointerId !== openingState.activeDragKit.pointerId) return;
    pendingPoint = { clientX: event.clientX, clientY: event.clientY };
    if (dragFrame === null) {
      dragFrame = requestAnimationFrame((now) => {
        dragFrame = null;
        applyPendingDragPoint();
        if (openingState.activeDragKit?.board.isConnected && now - lastFeedbackAt >= DRAG_FEEDBACK_INTERVAL) {
          refreshDragFeedback(openingState.activeDragKit);
          lastFeedbackAt = now;
        }
      });
    }
    event.preventDefault();
  });

  on("pointerup", finishOpeningDrag);
  on("pointercancel", finishOpeningDrag);
  on("lostpointercapture", finishOpeningDrag);
  return () => {
    if (openingState.activeDragKit) finishOpeningDrag({ pointerId: openingState.activeDragKit.pointerId });
    for (const cleanup of cleanups) cleanup();
  };
}

  return { boardPointFromEvent, openingBoardPointFromEvent, registerOpeningPointerListeners };
}

export const defaultOpeningPointer = createOpeningPointer();
export const { boardPointFromEvent, openingBoardPointFromEvent, registerOpeningPointerListeners } = defaultOpeningPointer;
