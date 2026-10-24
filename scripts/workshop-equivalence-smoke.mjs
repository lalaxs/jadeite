import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { parse } from "acorn";

const contract = JSON.parse(readFileSync("scripts/fixtures/workshop-baseline/contract.json", "utf8"));
const snapshot = JSON.parse(readFileSync("scripts/fixtures/workshop-baseline/state.json", "utf8"));
const source = readFileSync(process.env.WORKSHOP_ORACLE_SOURCE || "scripts/fixtures/workshop-baseline/workshop-module.js", "utf8");
if (!process.env.WORKSHOP_ORACLE_SOURCE) assert.equal(createHash("sha256")
  .update(contract.normalizedSourceSha256 ? source.replaceAll("\r\n", "\n") : source).digest("hex"),
contract.normalizedSourceSha256 || contract.sourceSha256, "the original oracle stays frozen");
// Load the frozen original as a separate module instance, resolving its original
// dependencies from their unchanged production URLs rather than duplicating rules.
let original = source;
for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body.reverse()) {
  if (node.type !== "ImportDeclaration") continue;
  const url = pathToFileURL(path.resolve("public/features/workshop", node.source.value)).href;
  original = original.slice(0, node.source.start) + JSON.stringify(url) + original.slice(node.source.end);
}
const before = await import(`data:text/javascript;base64,${Buffer.from(original).toString("base64")}`);
const candidate = process.env.WORKSHOP_CANDIDATE_URL || pathToFileURL(path.resolve("public/features/workshop/workshop-module.js")).href;
const after = await import(candidate);
assert.deepEqual(Object.keys(before).sort(), contract.exports);
assert.deepEqual(Object.keys(after).filter(key => key !== "createWorkshopFeature").sort(), contract.exports, "legacy exports remain available");
Date.now = () => contract.now;
Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: () => "workshop-fixed-request-id" });

function fixture(change = () => {}) {
  const state = structuredClone(snapshot);
  change(state);
  const commands = [], actions = new Map(), listeners = new Map();
  const keyboard = new Set();
  const root = { innerHTML: "", childElementCount: 0, querySelectorAll: () => [],
    addEventListener(name, handler) { if (name === "keydown") keyboard.add(handler); },
    removeEventListener(name, handler) { if (name === "keydown") keyboard.delete(handler); } };
  const document = { querySelectorAll: () => [], querySelector: () => null, getElementById: () => null };
  const kits = new Map();
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const socket = {
    on(name, handler) { listeners.set(name, [...(listeners.get(name) || []), handler]); },
    off(name, handler) { listeners.set(name, (listeners.get(name) || []).filter(fn => fn !== handler)); },
    emit(name, payload, ack) { commands.push([name, structuredClone(payload)]); ack?.({ ok: false, message: "unchanged request" }); }
  };
  const helpers = {
    escapeHtml: esc, formatMoney: value => `¥${value}`, formatNumber: String, formatDuration: value => `${value}ms`,
    nowMs: () => contract.now, typeName: type => type || "jade", empty: text => `<empty>${text}</empty>`,
    materialStageForClient: item => typeof item === "string" ? item : item?.materialStage || item?.stage,
    materialStageLabel: item => typeof item === "string" ? item : item?.materialStage || "unknown",
    productionJobsFor: me => me.jobs || [], productCanvas: (item, size) => `<preview data-id="${item?.id}" data-size="${size}"></preview>`,
    openingStoneSvg: (item, options) => `<stone data-id="${item.id}" data-options="${esc(JSON.stringify(options))}"></stone>`,
    openingKitsForRender: item => [...(item.extractionKits || []), ...(kits.get(item.id) || [])],
    kitsFor: id => kits.get(id) || [], roughKits: kits, openingKitsForServer: id => kits.get(id) || [],
    roughBoard: () => "<board></board>", roughPlannerControls: () => "<tools></tools>", placementAnalysisRows: () => "<analysis></analysis>",
    paintJades() {}, showToast: message => commands.push(["toast", message]), renderInventory() {}
  };
  const deps = { socket, document, getState: () => state, els: { workshopRoot: root }, getActiveView: () => "workshop", helpers,
    registerAction(name, handler) { actions.set(name, handler); return () => { if (actions.get(name) === handler) actions.delete(name); }; }
  };
  return { state, root, document, deps, commands, actions, listeners, kits, keyboard };
}

const cases = [
  ["normal", () => {}],
  ["cash-empty", s => { s.me.cash = 0; }],
  ["busy-worker", s => { s.me.workshop.workers[0].busy = true; }],
  ["busy-machine", s => { s.me.jobs.push({ id: "baseline-busy-job", deviceId: s.me.workshop.devices[0].id, stage: "rough", item: s.me.rough[0], startedAt: contract.now - 15000, readyAt: contract.now + 30000, workerId: s.me.workshop.workers[0].id }); }],
  ["broken-device", s => { s.me.workshop.devices[0].condition = 0; }],
  ["equipment-listed", s => { s.me.workshop.devices[0].blackmarketListingId = "equipment-sale"; }],
  ["worker-listed", s => { s.me.workshop.workers[0].blackmarketListingId = "employee-transfer"; }],
  ["empty-stock", s => { s.me.rough = []; s.me.materials = []; s.me.slices = []; s.me.bracelets = []; }],
  ["empty-equipment-roster", s => { s.me.workshop.devices = []; s.me.workshop.workers = []; }],
  ["empty-worker-roster", s => { s.me.workshop.workers = []; }],
  ["legacy-fallbacks", s => { delete s.me.workshop.devices; s.me.workshop.workers = []; }],
  ["payroll-stopped", s => { s.me.employeePayroll = { version: 3, status: "stopped", debt: 1500 }; }],
  ["leftover", s => { s.me.materials[0].leftover = true; s.me.materials[0].extractionKits = [{ type: "cabochon", x: 50, y: 50 }]; }]
];

function observe(module, f) {
  globalThis.document = f.document;
  module.initWorkshopModule(f.deps);
  module.workshopBackDevices();
  module.workshopSelectStep("open");
  f.commands.length = 0;
  const output = { devices: module.workshopDevices(), workers: module.workshopWorkers(), jobs: module.workshopJobs(), stages: module.workshopStageItems(), tabs: module.workshopStepTabs() };
  for (const device of module.workshopDevices()) {
    const worker = module.workshopWorkerFor(device), items = module.workshopProcessableItems(device), item = items[0] || null;
    output[device.id] = {
      items, worker, jobs: module.workshopJobs(device.id), label: module.workshopOutputLabel(device),
      duration: module.workshopDurationMs(device), durationLabel: module.workshopDurationLabel(device),
      workerImpact: module.workshopWorkerImpact(worker, device), deviceImpact: module.workshopDeviceImpact(device), estimate: module.workshopJobEstimate(device, item),
      card: module.workshopRecipeCard(device), summary: module.workshopRecipeSummary(device, item),
      material: module.workshopBigMaterialCard(device, item), workerCard: module.workshopBigWorkerCard(device, worker),
      lockedMaterial: module.workshopBigMaterialCard(device, item, { locked: true }), lockedWorker: module.workshopBigWorkerCard(device, worker, { locked: true }),
      recommendation: module.workshopRecommendedWorkerId(device), workersColumn: module.workshopWorkerColumn(device), page: module.workshopRecipePage(device)
    };
    if (item) {
      output[device.id].preview = module.workshopItemPreview(item, device);
      output[device.id].lazyPreview = module.workshopItemPreview(item, device, { lazy: true });
      output[device.id].row = module.workshopMaterialRow(device, item);
    }
  }
  output.home = module.workshopRecipeHome(module.workshopDevices());
  output.options = module.finishOptions(["ring", "pendant"], { ring: "戒指", pendant: "吊坠" }, "ring", { enabledKeys: ["pendant"] });
  const opening = module.workshopDevices()[0];
  if (!opening) {
    output.commands = f.commands;
    output.actions = [...f.actions.keys()].sort();
    return output;
  }
  module.workshopOpenDevice(opening.id);
  output.opened = f.root.innerHTML;
  const item = module.workshopProcessableItems(opening)[0];
  if (item) {
    module.workshopSelectItem(item.id);
    output.selected = f.root.innerHTML;
    module.workshopStartJob({ dataset: { itemId: item.id } }, opening.id);
    const assignee = module.workshopWorkers()[0];
    if (assignee) module.workshopAssignWorker({ dataset: { workerId: assignee.id } }, opening.id);
  }
  output.commands = f.commands;
  output.actions = [...f.actions.keys()].sort();
  return output;
}

for (const [name, change] of cases) {
  const a = fixture(change), b = fixture(change);
  assert.deepEqual(observe(after, b), observe(before, a), `${name}: exact model, numeric, template, action and request equivalence`);
}

if (after.createWorkshopFeature) {
  const a = fixture(), b = fixture();
  const first = after.createWorkshopFeature(a.deps), second = after.createWorkshopFeature(b.deps);
  first.mount(); second.mount();
  first.mount();
  assert.equal(a.listeners.get("state").length, 1, "mount is idempotent");
  first.workshopOpenDevice(first.workshopDevices()[0].id);
  first.workshopSelectItem(a.state.me.rough[0].id);
  const retained = a.root.innerHTML;
  second.workshopSelectStep("finish");
  first.renderWorkshop();
  assert.equal(a.root.innerHTML, retained, "independent instances retain their own selections and render fingerprint");
  assert.notEqual(b.root.innerHTML, retained);
  const staleAction = a.actions.get("startWorkshopJob");
  first.dispose(); first.dispose();
  assert.equal(a.actions.size, 0, "dispose releases owned actions");
  assert.equal(a.keyboard.size, 0, "dispose releases keyboard listeners");
  assert.equal(a.listeners.get("state").length, 0, "dispose releases full-state subscription");
  assert.equal(a.listeners.get("state:patch").length, 0, "dispose releases patch subscription");
  const count = a.commands.length;
  staleAction({ target: { dataset: { itemId: a.state.me.rough[0].id } }, payload: a.state.me.workshop.devices[0].id });
  assert.equal(a.commands.length, count, "stale actions cannot submit after dispose");
  assert.equal(b.actions.size, 17, "disposing one instance does not unregister another");
  first.mount();
  assert.equal(a.actions.size, 17);
  assert.equal(a.keyboard.size, 1);
  assert.equal(a.listeners.get("state").length, 1, "remount binds exactly once");
  staleAction({ target: { dataset: { itemId: a.state.me.rough[0].id } }, payload: a.state.me.workshop.devices[0].id });
  assert.equal(a.commands.length, count, "a handler from a disposed mount stays inert after remount");
  first.dispose(); second.dispose();
}
console.log(`workshop-equivalence-smoke: ${cases.length} scenarios, ${contract.exports.length} legacy exports, exact templates/models/actions/requests${after.createWorkshopFeature ? ", instance isolation and mount/dispose/remount ok" : " (legacy control)"}`);
