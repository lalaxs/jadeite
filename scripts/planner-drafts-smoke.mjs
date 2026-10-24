import assert from "node:assert/strict";
import {
  createPlannerDraftStore, plannerMaterialFingerprint, PLANNER_DRAFT_PREFIX
} from "../public/features/opening/planner-draft-store.js";
import {
  bindPlannerDraftDeps, ensurePlannerDraft, replacePlannerDraft, beginPlannerDraftGesture,
  finishPlannerDraftGesture, undoPlannerDraft, confirmPlannerDraft, restoreConfirmedPlannerDraft,
  plannerDraftStatus, beginPlannerSubmission, settlePlannerSubmission, reconcilePlannerDrafts,
  resetPlannerDraftRuntime, loadPlannerDraftVersion
} from "../public/features/opening/planner-drafts.js";
import { roughKits } from "../public/features/opening/opening-state.js";
import { createWorkshopActions } from "../public/features/workshop/actions.js";
import { openingKitsForServer } from "../public/features/opening/opening-kits.js";

class MemoryStorage {
  entries = new Map();
  get length() { return this.entries.size; }
  key(index) { return [...this.entries.keys()][index] ?? null; }
  getItem(key) { return this.entries.get(key) ?? null; }
  setItem(key, value) { this.entries.set(key, String(value)); }
  removeItem(key) { this.entries.delete(key); }
}
const storage = new MemoryStorage();
const material = { id: "draft-material", name: "测试明料", type: "material", materialStage: "opened", qualityKey: "ice", openingSeed: "fixed-stone" };
const piece = (id, x = 260) => ({ id, tpl: "ping", type: "peacePendant", x, y: 300, rot: 0, size: "M", scale: 1, svgSpace: true });
const player = { id: "draft-player", materials: [material], rough: [], slices: [], jobs: [] };
let state = { me: player };
let clock = 1_000;
function boot(writerId = "window-a") {
  resetPlannerDraftRuntime(); roughKits.clear();
  bindPlannerDraftDeps({ storage, writerId, getState: () => state, now: () => ++clock });
  ensurePlannerDraft(material);
}
boot();

// A long drag is one meaningful undo step, even with intermediate autosaves.
replacePlannerDraft(material.id, [piece("one")]);
beginPlannerDraftGesture(material.id);
for (let index = 0; index < 100; index++) replacePlannerDraft(material.id, [piece("one", 261 + index)], { transient: true });
finishPlannerDraftGesture(material.id);
assert.equal(roughKits.get(material.id)[0].x, 360);
assert.ok(undoPlannerDraft(material.id));
assert.equal(roughKits.get(material.id)[0].x, 260);
assert.ok(undoPlannerDraft(material.id, true));
assert.equal(roughKits.get(material.id)[0].x, 360);
confirmPlannerDraft(material.id);
replacePlannerDraft(material.id, [piece("one", 400)]);

// Reload restores the exact latest layout and separately retains the last confirmation.
boot("after-reload");
assert.equal(roughKits.get(material.id)[0].x, 400);
assert.equal(plannerDraftStatus(material.id).canUndo, false, "undo history starts afresh after a page reload");
assert.equal(plannerDraftStatus(material.id).confirmedDiffers, true);
assert.ok(restoreConfirmedPlannerDraft(material.id));
assert.equal(roughKits.get(material.id)[0].x, 360);
assert.ok(undoPlannerDraft(material.id));
assert.equal(roughKits.get(material.id)[0].x, 400);
replacePlannerDraft(material.id, [piece("one", 410)]);
assert.equal(undoPlannerDraft(material.id, true), false, "new edits invalidate the redo branch");

for (let index = 0; index < 70; index++) replacePlannerDraft(material.id, [piece("one", 411 + index)]);
let undoCount = 0;
while (undoPlannerDraft(material.id)) undoCount++;
assert.equal(undoCount, 50, "history has a fixed bound per material");

// Independent keys make even simultaneous windows preserve both versions.
const otherStore = createPlannerDraftStore({ storage, writerId: "window-b", now: () => ++clock });
otherStore.save(player.id, material.id, { fingerprint: plannerMaterialFingerprint(material), current: [piece("other", 200)], confirmed: [] });
boot("window-c");
replacePlannerDraft(material.id, [piece("current", 300)]);
const alternatives = plannerDraftStatus(material.id).alternatives;
assert.ok(alternatives.length >= 1);
const otherVersion = alternatives.find((entry) => entry.key.endsWith("window-b"));
assert.ok(otherVersion);
assert.ok(loadPlannerDraftVersion(material.id, otherVersion.key));
assert.equal(roughKits.get(material.id)[0].id, "other");
assert.ok(undoPlannerDraft(material.id), "loading another version is undoable");
assert.equal(roughKits.get(material.id)[0].id, "current");
assert.equal(otherStore.list(player.id, material.id).records.find((record) => record.writerId === "window-b").current[0].x, 200);

// A different owner or changed remaining geometry cannot inherit the old layout.
const priceOnly = { ...material, value: 90_000, costBasis: { amount: 80_000 } };
assert.equal(plannerMaterialFingerprint(priceOnly), plannerMaterialFingerprint(material));
const changed = { ...material, remainingRatio: .7, extractionKits: [{ id: "taken", type: "peacePendant", x: 50, y: 50 }] };
state = { me: { ...player, materials: [changed] } };
ensurePlannerDraft(changed);
assert.deepEqual(roughKits.get(material.id), []);
assert.ok(plannerDraftStatus(material.id).staleCount > 0);
replacePlannerDraft(changed.id, [piece("new-geometry", 250)]);
const revisions = otherStore.list(player.id, material.id).records;
assert.ok(revisions.some(record => record.fingerprint === plannerMaterialFingerprint(material)), "editing a changed material must retain the old geometry's copy");
assert.ok(revisions.some(record => record.fingerprint === plannerMaterialFingerprint(changed)));
state = { me: { ...player, id: "different-player" } };
ensurePlannerDraft(material);
assert.deepEqual(roughKits.get(material.id), []);
state = { me: player }; boot("submission-window");

// Selecting another material and a rejected command preserve the first layout.
const second = { ...material, id: "second-material" };
player.materials.push(second);
replacePlannerDraft(material.id, [piece("submit-kit")]);
const ui = { activeWorkshopDeviceId: "carver", selectedWorkshopItemId: material.id };
const device = { id: "carver", stage: "carving" };
const requests = [], notices = [];
const actions = createWorkshopActions({ ui,
  socketRef: { emit: (event, request, ack) => requests.push({ event, request, ack }) }, elsRef: {},
  helpers: { openingKitsForServer, paintJades() {}, showToast: (message) => notices.push(message) },
  ports: { workshopDevices: () => [device], renderWorkshop() {} }
});
actions.workshopSelectItem(second.id);
assert.equal(roughKits.get(material.id)[0].id, "submit-kit");
actions.workshopSelectItem(material.id);
const button = { dataset: {}, disabled: false };
actions.workshopStartJob(button, device.id);
assert.equal(roughKits.get(material.id)[0].id, "submit-kit", "submission must not clear the draft before acceptance");
assert.equal(replacePlannerDraft(material.id, []), false, "in-flight commands freeze their submitted layout");
requests[0].ack({ ok: false, code: "INSUFFICIENT_CASH", message: "工位费不足" });
assert.equal(roughKits.get(material.id)[0].id, "submit-kit");
assert.equal(button.disabled, false);
assert.ok(undoPlannerDraft(material.id));
replacePlannerDraft(material.id, [piece("accepted-kit")]);

// The actual action watchdog freezes uncertain drafts and retries the exact
// original payload, even if the visible worker selection changes meanwhile.
const timers = [], nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = callback => { const timer = { callback, unref() {} }; timers.push(timer); return timer; };
globalThis.clearTimeout = () => {};
try {
  actions.workshopStartJob(button, device.id);
  const uncertain = requests.at(-1), submittedPayload = structuredClone(uncertain.request);
  timers.at(-1).callback();
  const frozen = structuredClone(roughKits.get(material.id));
  assert.equal(plannerDraftStatus(material.id).locked, true, "timeout retains a read-only pending draft");
  assert.equal(replacePlannerDraft(material.id, []), false);
  assert.equal(undoPlannerDraft(material.id), false);
  assert.equal(undoPlannerDraft(material.id, true), false);
  assert.equal(beginPlannerDraftGesture(material.id), false);
  assert.equal(confirmPlannerDraft(material.id), false);
  assert.equal(restoreConfirmedPlannerDraft(material.id), false);
  assert.equal(loadPlannerDraftVersion(material.id, otherVersion.key), false);
  assert.deepEqual(roughKits.get(material.id), frozen);
  ui.selectedWorkshopWorkerId = "different-worker-after-timeout";
  actions.workshopStartJob(button, device.id);
  const retried = requests.at(-1);
  assert.deepEqual(retried.request, submittedPayload, "same ID retry must also retain the same device, worker and kit payload");
  retried.ack({ ok: false, code: "INVALID_PLANNING", message: "明确拒绝" });
  assert.equal(plannerDraftStatus(material.id).pending, false);
  assert.ok(replacePlannerDraft(material.id, [piece("after-definitive-failure", 280)]));
  uncertain.ack({ ok: true });
  assert.equal(roughKits.get(material.id)[0].id, "after-definitive-failure", "an older callback cannot clear later edits");
  assert.equal(ui.selectedWorkshopItemId, material.id, "an ignored old callback cannot navigate away from the current selection");
} finally { globalThis.setTimeout = nativeSetTimeout; globalThis.clearTimeout = nativeClearTimeout; }
replacePlannerDraft(material.id, [piece("accepted-kit")]);

// A lost acknowledgement, then reload and an authoritative job, clears only accepted drafts.
assert.ok(beginPlannerSubmission(material.id, "stable-request"));
settlePlannerSubmission(material.id, { ok: false, code: "ACK_TIMEOUT" });
boot("after-timeout-reload");
assert.equal(plannerDraftStatus(material.id).pending, true);
assert.equal(beginPlannerSubmission(material.id, "different-request"), false);
assert.ok(beginPlannerSubmission(material.id, "stable-request"));
player.jobs.push({ item: material, options: { kits: [{ id: "accepted-kit" }] } });
reconcilePlannerDrafts();
assert.equal(roughKits.has(material.id), false);
assert.equal(otherStore.list(player.id, material.id).records.filter((record) => record.fingerprint === plannerMaterialFingerprint(material)).length, 0);
player.jobs.length = 0;

// A delayed success from the old geometry must not settle a new draft/request
// that happens to use the same persistent material ID after an offcut returns.
const returnedMaterial = { ...material, remainingRatio: .8, extractionKits: [{ id: "accepted-kit", x: 50, y: 50 }] };
state = { me: { ...player, materials: [returnedMaterial] } };
ensurePlannerDraft(returnedMaterial);
replacePlannerDraft(material.id, [piece("new-offcut-layout", 350)]);
assert.ok(beginPlannerSubmission(material.id, "new-offcut-request"));
assert.equal(settlePlannerSubmission(material.id, { ok: true }, "stable-request"), false);
assert.equal(roughKits.get(material.id)[0].id, "new-offcut-layout");
assert.equal(plannerDraftStatus(material.id).pending, true);
assert.equal(settlePlannerSubmission(material.id, { ok: false, code: "INVALID_PLANNING" }, "new-offcut-request"), true);
assert.ok(replacePlannerDraft(material.id, []));
state = { me: player };

// Corrupt records and blocked/quota-full storage must leave the usable editor intact.
storage.setItem(`${PLANNER_DRAFT_PREFIX}${encodeURIComponent(player.id)}:${material.id}:broken`, "{");
boot("safe-window");
assert.ok(plannerDraftStatus(material.id).invalidCount > 0);
resetPlannerDraftRuntime(); roughKits.clear();
const blocked = { get length() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
bindPlannerDraftDeps({ storage: blocked, writerId: "private-mode", getState: () => state });
ensurePlannerDraft(material);
assert.ok(replacePlannerDraft(material.id, [piece("unsaved")]));
assert.match(plannerDraftStatus(material.id).error, /未能保存/);
assert.ok(undoPlannerDraft(material.id), "storage errors must not disable editing or history");
resetPlannerDraftRuntime();
console.log("planner-drafts-smoke: gestures, bounded undo/redo, reload, confirmed versions, window isolation, material/owner checks, rejected/uncertain/accepted submissions and storage failures passed");
