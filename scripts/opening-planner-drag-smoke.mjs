import assert from "node:assert/strict";
import {
  bindOpeningDeps, roughBoard, roughKits, kitsFor, openingKitsForServer,
  activeDragKit, registerOpeningPointerListeners
} from "../public/features/opening/index.js";
import { buildOpeningStone, renderJadeOpeningSvg } from "../public/jade-opening-engine.js";

const rough = { id: "drag-material", name: "拖动测试明料", type: "material", qualityKey: "ice" };
const draft = (id, x) => ({ id, tpl: "ping", type: "peacePendant", x, y: 300, rot: 0, scale: 1, size: "M", svgSpace: true });
roughKits.set(rough.id, [draft("first", 260), draft("second", 320)]);
const refreshes = [];
let paints = 0;
bindOpeningDeps({
  getState: () => ({ me: { materials: [rough] } }),
  workshopRefreshPlanner: (...args) => refreshes.push(args),
  paintJades: () => paints++
});

const markup = roughBoard(rough);
assert.equal((markup.match(/fill="transparent"/g) || []).length, 2, "both overlapping pieces retain a draggable transparent hit area");
assert.equal((markup.match(/<use /g) || []).length, 1, "the planning board renders the stone texture only once");
assert.equal((markup.match(/class="kit-wire"/g) || []).length, 2, "every piece keeps its complete outline");
const stone = buildOpeningStone({ seed: 17, roughId: "outline-cache" });
const options = { revealed: true, kits: [{ uid: "cache-kit", tpl: "ping", x: 300, y: 300, scale: 1 }] };
const filled = renderJadeOpeningSvg(stone, options);
const wire = renderJadeOpeningSvg(stone, { ...options, outlineOnly: true });
assert.equal((filled.match(/<use /g) || []).length, 2, "other previews retain their material cutout");
assert.equal((wire.match(/<use /g) || []).length, 1, "the markup cache distinguishes outline rendering");

const listeners = new Map();
const frames = new Map();
let frameId = 0;
let capturedPointer = null;
const node = (id) => ({
  dataset: { uid: id }, attrs: {},
  classList: { contains: () => false, toggle() {} },
  outlines: [{ attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } }],
  setAttribute(key, value) { this.attrs[key] = value; },
  querySelectorAll() { return this.outlines; },
  closest(selector) { return selector === "[data-opening-board]" ? board : this; }
});
const nodes = [node("first"), node("second")];
const board = {
  isConnected: true, dataset: { openingBoard: rough.id },
  getBoundingClientRect: () => ({ left: 10, top: 20, width: 600, height: 600 }),
  querySelectorAll: () => nodes,
  setPointerCapture: (id) => { capturedPointer = id; },
  hasPointerCapture: (id) => capturedPointer === id,
  releasePointerCapture: () => { capturedPointer = null; }
};
globalThis.document = {
  body: { addEventListener: (type, listener) => listeners.set(type, listener) },
  getElementById: () => ({})
};
globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
registerOpeningPointerListeners();
const event = (extra = {}) => ({ target: nodes[0], pointerId: 1, button: 0, preventDefault() {}, ...extra });
const fire = (type, extra) => listeners.get(type)(event(extra));
const flushFrame = (time) => {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(time));
};

fire("pointerdown");
assert.equal(capturedPointer, 1);
assert.equal(refreshes.length, 1, "selection feedback is immediate");
assert.equal(nodes[1].outlines[0].attrs.stroke, "#ff4636", "overlapping outlines remain marked");
for (let i = 0; i < 100; i++) fire("pointermove", { clientX: 271 + i, clientY: 320 });
assert.equal(frames.size, 1, "a burst of pointer events schedules only one frame");
assert.equal(kitsFor(rough.id)[0].x, 260, "pointer events themselves do not rebuild or move the board");
flushFrame(performance.now() + 110);
assert.equal(kitsFor(rough.id)[0].x, 360, "the frame uses the latest pointer coordinate");
assert.match(nodes[0].attrs.transform, /translate\(360\.0 300\.0\)/);
assert.ok(refreshes.every(([, options]) => options?.dragging), "drag refreshes use the tools-only path");
assert.equal(paints, 0, "dragging does not repaint unrelated jade previews");

fire("pointermove", { pointerId: 2, clientX: 550, clientY: 550 });
fire("pointerup", { pointerId: 2 });
assert.ok(activeDragKit, "another touch cannot end the current drag");
assert.equal(frames.size, 0);
fire("pointermove", { clientX: 410, clientY: 350 });
fire("pointerup");
assert.equal(frames.size, 0);
assert.equal(kitsFor(rough.id)[0].x, 400, "quick release flushes a queued final move");
assert.equal(kitsFor(rough.id)[0].y, 330);
assert.equal(activeDragKit, null);
assert.equal(capturedPointer, null);
assert.equal(paints, 1, "the settled plan performs one complete refresh");
assert.deepEqual(openingKitsForServer(rough.id)[0], {
  id: "first", type: "peacePendant", openingTpl: "ping", x: 67, y: 55,
  rot: 0, scale: 1, size: "M", ringSize: undefined
}, "server payload conversion is unchanged");

fire("pointerdown");
fire("pointermove", { clientX: 12, clientY: 2000 });
fire("pointercancel");
assert.equal(activeDragKit, null);
assert.equal(frames.size, 0);
assert.equal(kitsFor(rough.id)[0].x, 76, "the original template radius clamp is retained");
assert.equal(kitsFor(rough.id)[0].y, 524);

fire("pointerdown");
fire("pointermove", { clientX: 310, clientY: 320 });
board.isConnected = false;
const before = structuredClone(kitsFor(rough.id));
fire("lostpointercapture");
assert.equal(activeDragKit, null);
assert.equal(frames.size, 0);
assert.deepEqual(kitsFor(rough.id), before, "closing/cancelling the planner prevents stale frames from mutating its draft");

console.log("opening-planner-drag-smoke: transparent overlap, frame coalescing, pointer isolation, final position and cancellation passed");
