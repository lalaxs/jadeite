import assert from "node:assert/strict";
import { createWorkshopFeature } from "../public/features/workshop/create-workshop-feature.js";
import { bindOpeningDeps, defaultOpeningRuntime } from "../public/features/opening/index.js";
import { createActionRouter } from "../public/shell/action-router.js";
import { createWorkshopPicker } from "../public/features/workshop/picker-controller.js";
import { createWorkshopPlanner } from "../public/features/workshop/planner-controller.js";
import { createWorkshopFinish } from "../public/features/workshop/finish-controller.js";
import { createWorkshopInlayPreview } from "../public/features/workshop/inlay-preview-controller.js";

class MemoryStorage {
  entries = new Map();
  get length() { return this.entries.size; }
  key(index) { return [...this.entries.keys()][index] ?? null; }
  getItem(key) { return this.entries.get(key) ?? null; }
  setItem(key, value) { this.entries.set(key, String(value)); }
  removeItem(key) { this.entries.delete(key); }
}

class Events extends EventTarget {
  registrations = new Set();
  addEventListener(name, listener) {
    this.registrations.add({ name, listener });
    super.addEventListener(name, listener);
  }
  removeEventListener(name, listener) {
    for (const entry of this.registrations) {
      if (entry.name === name && entry.listener === listener) this.registrations.delete(entry);
    }
    super.removeEventListener(name, listener);
  }
}

const material = { id: "same-material", name: "隔离测试明料", type: "material",
  materialStage: "opened", qualityKey: "ice", openingSeed: "instance-stone" };
const piece = (id, x) => ({ id, tpl: "ping", type: "peacePendant", x, y: 300,
  rot: 0, size: "M", scale: 1, svgSpace: true });
const document = { getElementById: () => null };
const fixtures = [];
function fixture(playerId, storage = new MemoryStorage()) {
  const state = { me: { id: playerId, materials: [structuredClone(material)], rough: [], slices: [],
    bracelets: [], jobs: [], workshop: { devices: [{ id: "carving", stage: "carving", workerId: "worker" }], workers: [] } } };
  const events = new Events(), router = createActionRouter(), requests = [], subscriptions = new Map();
  const socket = {
    on(name, listener) { subscriptions.set(name, listener); },
    off(name, listener) { if (subscriptions.get(name) === listener) subscriptions.delete(name); },
    emit(event, request, ack) { requests.push({ event, request, ack }); }
  };
  const feature = createWorkshopFeature({
    getState: () => state, socket, document, els: {}, registerAction: (name, fn) => router.on(name, fn),
    plannerDrafts: { storage, writerId: `writer-${fixtures.length}`, eventTarget: events },
    helpers: { materialStageForClient: item => item.materialStage, showToast() {} }
  });
  const row = { state, storage, events, router, requests, subscriptions, feature, opening: feature.opening };
  fixtures.push(row);
  feature.mount();
  return row;
}
const button = () => ({ dataset: { itemId: material.id }, disabled: false });

function pointerBoard(opening, kitId) {
  const handlers = new Map();
  const root = {
    addEventListener(name, listener) { handlers.set(name, listener); },
    removeEventListener(name, listener) { if (handlers.get(name) === listener) handlers.delete(name); }
  };
  let captured = null;
  const node = { dataset: { uid: kitId }, classList: { contains: () => false, toggle() {} },
    querySelectorAll: () => [], setAttribute() {}, closest: () => board };
  const board = { dataset: { openingBoard: material.id }, isConnected: true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }),
    querySelectorAll: () => [node], setPointerCapture: id => { captured = id; },
    hasPointerCapture: id => captured === id, releasePointerCapture: () => { captured = null; } };
  opening.kits.bindOpeningKitsUiDeps({ workshopRefreshPlanner() {}, renderWorkshop() {}, paintJades() {} });
  const stop = opening.pointer.registerOpeningPointerListeners(root);
  const fire = (name, values = {}) => handlers.get(name)({
    target: { closest: () => node }, pointerId: 7, button: 0, preventDefault() {}, stopPropagation() {}, ...values
  });
  return { handlers, stop, fire, captured: () => captured };
}

try {
  const a = fixture("player-a"), b = fixture("player-b");
  assert.equal(a.opening.drafts.ensurePlannerDraft(material).playerId, "player-a");
  assert.equal(b.opening.drafts.ensurePlannerDraft(material).playerId, "player-b");
  assert.equal(a.opening.drafts.ensurePlannerDraft(material).playerId, "player-a", "creating B must not rebind A");
  a.opening.drafts.replacePlannerDraft(material.id, [piece("kit-a", 240)]);
  b.opening.drafts.replacePlannerDraft(material.id, [piece("kit-b", 360)]);
  a.opening.kits.selectOpeningDraftKit(material.id, "kit-a");
  a.opening.openingState.setSelectedPendantSize("L");
  assert.equal(b.opening.openingState.selectedOpeningKitId, null);
  assert.equal(b.opening.openingState.selectedPendantSize, "M");
  a.opening.drafts.beginPlannerDraftGesture(material.id);
  a.opening.kits.moveRoughKit(material.id, "kit-a", 270, 310, { refresh: false, transient: true });
  a.opening.drafts.finishPlannerDraftGesture(material.id);
  a.opening.drafts.undoPlannerDraft(material.id);
  assert.equal(a.opening.kits.kitsFor(material.id)[0].x, 240);
  a.opening.drafts.undoPlannerDraft(material.id, true);
  assert.equal(a.opening.kits.kitsFor(material.id)[0].x, 270);
  assert.equal(b.opening.kits.kitsFor(material.id)[0].x, 360);
  assert.match(a.opening.render.roughBoard(material), /data-uid="kit-a"/);
  assert.doesNotMatch(a.opening.render.roughBoard(material), /data-uid="kit-b"/);
  assert.match(b.opening.render.roughBoard(material), /data-uid="kit-b"/);
  assert.notEqual(a.opening.render.openingStoneFor(material), b.opening.render.openingStoneFor(material));

  const originalFrame = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  const frames = new Map();
  globalThis.requestAnimationFrame = fn => { frames.set(1, fn); return 1; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const pointerA = pointerBoard(a.opening, "kit-a"), pointerB = pointerBoard(b.opening, "kit-b");
  try {
    pointerA.fire("pointerdown");
    assert.equal(b.opening.openingState.activeDragKit, null);
    pointerB.fire("pointerdown");
    assert.equal(a.opening.openingState.activeDragKit.kitId, "kit-a");
    assert.equal(b.opening.openingState.activeDragKit.kitId, "kit-b");
    pointerA.fire("pointermove", { clientX: 270, clientY: 310 });
    pointerA.stop();
    assert.equal(frames.size, 0, "disposing a pointer root cancels its queued animation frame");
    assert.equal(a.opening.openingState.activeDragKit, null);
    assert.equal(pointerA.captured(), null);
    assert.equal(pointerA.handlers.size, 0);
    assert.equal(pointerB.handlers.size, 5);
    assert.equal(b.opening.openingState.activeDragKit.kitId, "kit-b");
    assert.equal(b.opening.kits.kitsFor(material.id)[0].x, 360);
  } finally {
    pointerA.stop(); pointerB.stop();
    globalThis.requestAnimationFrame = originalFrame;
    globalThis.cancelAnimationFrame = originalCancel;
  }

  const targetA = button(), targetB = button();
  a.feature.workshopStartJob(targetA, "carving");
  b.feature.workshopStartJob(targetB, "carving");
  const first = a.requests.at(-1), second = b.requests.at(-1);
  assert.equal(first.event, "startWorkshopJob");
  assert.equal(first.request.kits[0].id, "kit-a");
  assert.equal(second.request.kits[0].id, "kit-b");
  assert.equal(first.request.kits[0].x, 45, "wire coordinates retain percentage normalization");
  second.ack({ ok: false, code: "INVALID_PLANNING" });
  assert.equal(a.opening.drafts.plannerDraftStatus(material.id).pending, true);
  assert.equal(b.opening.drafts.plannerDraftStatus(material.id).pending, false);

  const other = { me: { id: "legacy-player", materials: [material] } };
  bindOpeningDeps({ getState: () => other });
  defaultOpeningRuntime.drafts.replacePlannerDraft(material.id, [piece("legacy-kit", 300)]);
  assert.equal(a.opening.drafts.ensurePlannerDraft(material).playerId, "player-a");
  assert.equal(b.opening.drafts.ensurePlannerDraft(material).playerId, "player-b");
  assert.equal(b.opening.kits.kitsFor(material.id)[0].id, "kit-b");

  a.feature.dispose();
  assert.equal(a.events.registrations.size, 0);
  assert.equal(a.subscriptions.size, 0);
  assert.deepEqual(a.router.list(), []);
  assert.equal(targetA.disabled, false);
  assert.equal(b.events.registrations.size, 3, "disposing A must retain B's subscriptions");
  first.ack({ ok: true });
  assert.equal(a.opening.drafts.plannerDraftStatus(material.id).pending, true, "a disposed view ignores late acknowledgements");

  const reloaded = fixture("player-a", a.storage);
  assert.equal(reloaded.opening.kits.kitsFor(material.id)[0].x, 270);
  assert.equal(reloaded.opening.drafts.plannerDraftStatus(material.id).pending, true);
  reloaded.feature.workshopStartJob(button(), "carving");
  const retry = reloaded.requests.at(-1);
  assert.deepEqual(retry.request, JSON.parse(JSON.stringify(first.request)), "reload retries the same wire payload and request ID");
  retry.ack({ ok: false, code: "INVALID_PLANNING" });
  assert.equal(reloaded.opening.drafts.plannerDraftStatus(material.id).pending, false);
  assert.equal(b.opening.kits.kitsFor(material.id)[0].id, "kit-b");
  reloaded.feature.dispose();
  reloaded.feature.mount();
  assert.equal(reloaded.events.registrations.size, 3, "remount installs one listener per event");

  const c = fixture("same-player"), d = fixture("same-player");
  c.opening.drafts.replacePlannerDraft(material.id, [piece("same-a", 240)]);
  d.opening.drafts.replacePlannerDraft(material.id, [piece("same-b", 360)]);
  assert.equal(c.opening.kits.kitsFor(material.id)[0].id, "same-a", "equal player and item IDs do not merge independent worlds");
  assert.equal(d.opening.kits.kitsFor(material.id)[0].id, "same-b");

  const nodes = [];
  const document = {
    body: { appendChild(node) { nodes.push(node); node.isConnected = true; } },
    getElementById: id => nodes.find(node => node.isConnected && node.id === id),
    createElement() {
      return { ownerDocument: document, isConnected: false, addEventListener() {},
        remove() { this.isConnected = false; } };
    }
  };
  const controllerDeps = () => ({ ui: {}, document, getState: () => a.state, helpers: {}, ports: {}, opening: a.opening });
  for (const [create, rootName, disposeName] of [
    [createWorkshopPicker, "pickerRootEl", "disposeWorkshopPicker"],
    [createWorkshopPlanner, "plannerRootEl", "disposeWorkshopPlanner"],
    [createWorkshopInlayPreview, "inlayPreviewTesterRootEl", "closeInlayPreviewTester"]
  ]) {
    const first = create(controllerDeps()), second = create(controllerDeps());
    const firstRoot = first[rootName](), secondRoot = second[rootName]();
    assert.notEqual(firstRoot, secondRoot, `${rootName}: instances own distinct roots in the same document`);
    first[disposeName]();
    assert.equal(firstRoot.isConnected, false);
    assert.equal(secondRoot.isConnected, true, `${disposeName}: disposing A must retain B's modal`);
    second[disposeName]();
  }
  const firstFinish = createWorkshopFinish(controllerDeps()), secondFinish = createWorkshopFinish(controllerDeps());
  const finishA = firstFinish.finishRootEl(), finishB = secondFinish.finishRootEl();
  assert.notEqual(finishA, finishB);
  finishA.remove();
  assert.equal(finishB.isConnected, true);
  assert.notEqual(firstFinish.finishRootEl(), finishA, "reopening creates a fresh connected finish root");
} finally {
  for (const { feature, events, subscriptions, router } of fixtures) {
    feature.dispose();
    assert.equal(events.registrations.size, 0);
    assert.equal(subscriptions.size, 0);
    assert.deepEqual(router.list(), []);
  }
  defaultOpeningRuntime.drafts.resetPlannerDraftRuntime();
  defaultOpeningRuntime.openingState.roughKits.clear();
}
console.log("workshop-instance-isolation-smoke: drafts, selection, drag, modal ownership, rendering, undo/redo, command payloads, legacy rebinding, pending-request reload and lifecycle passed");
