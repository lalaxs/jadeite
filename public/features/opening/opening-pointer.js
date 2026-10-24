// Opening board pointer / drag (moved from main.js)

import { clampClient } from "../../shell/format-utils.js";
import { computeOverlaps } from "../../jade-opening-engine.js";
import { beginPlannerDraftGesture, finishPlannerDraftGesture } from "./planner-drafts.js";
import { getState, openingKitFromStored, openingKitsForRender } from "./opening-render.js";
import {
  activeDragKit,
  selectedOpeningKitId,
  setActiveDragKit
} from "./opening-state.js";
import {
  moveRoughKit,
  kitsFor,
  refreshOpeningPlanUi,
  selectOpeningDraftKit
} from "./opening-kits.js";

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
  for (const node of drag.board.querySelectorAll(".kit:not(.extracted)")) {
    const selected = node.dataset.uid === selectedOpeningKitId;
    const overlapping = overlaps.has(node.dataset.uid);
    node.classList.toggle("sel", selected);
    for (const outline of node.querySelectorAll(".kit-wire > *")) {
      outline.setAttribute("stroke", selected ? "#d4af37" : overlapping ? "#ff4636" : "rgba(255,255,255,.58)");
      outline.setAttribute("stroke-width", selected || overlapping ? "3" : "2");
    }
  }
  refreshOpeningPlanUi(drag.roughId, { dragging: true });
}

function applyPendingDragPoint() {
  const drag = activeDragKit;
  const point = pendingPoint;
  pendingPoint = null;
  if (!drag?.board.isConnected || !point) return;
  const position = openingBoardPointFromEvent(drag.board, point);
  const kit = moveRoughKit(drag.roughId, drag.kitId, position.x, position.y, { refresh: false, transient: true });
  if (!kit) return;
  drag.node.setAttribute("transform", `translate(${kit.x.toFixed(1)} ${kit.y.toFixed(1)}) rotate(${Number(kit.rot || 0).toFixed(1)}) scale(${Number(kit.scale || 1).toFixed(4)})`);
}

function finishOpeningDrag(event) {
  const drag = activeDragKit;
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

export function boardPointFromEvent(board, event, kitType = null) {
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

export function openingBoardPointFromEvent(board, event) {
  const rect = board.getBoundingClientRect();
  return {
    x: clampClient((event.clientX - rect.left) / rect.width * 600, 0, 600),
    y: clampClient((event.clientY - rect.top) / rect.height * 600, 0, 600)
  };
}

export function registerOpeningPointerListeners() {
  document.body.addEventListener("pointerdown", (event) => {
    if (activeDragKit && !activeDragKit.board.isConnected) finishOpeningDrag({ pointerId: activeDragKit.pointerId });
    if (activeDragKit || event.button > 0 || event.isPrimary === false) return;
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
      refreshDragFeedback(activeDragKit);
      event.preventDefault();
      return;
    }
  });

  document.body.addEventListener("pointermove", (event) => {
    if (!activeDragKit || event.pointerId !== activeDragKit.pointerId) return;
    pendingPoint = { clientX: event.clientX, clientY: event.clientY };
    if (dragFrame === null) {
      dragFrame = requestAnimationFrame((now) => {
        dragFrame = null;
        applyPendingDragPoint();
        if (activeDragKit?.board.isConnected && now - lastFeedbackAt >= DRAG_FEEDBACK_INTERVAL) {
          refreshDragFeedback(activeDragKit);
          lastFeedbackAt = now;
        }
      });
    }
    event.preventDefault();
  });

  document.body.addEventListener("pointerup", finishOpeningDrag);
  document.body.addEventListener("pointercancel", finishOpeningDrag);
  document.body.addEventListener("lostpointercapture", finishOpeningDrag);
}
