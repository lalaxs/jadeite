import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "acorn";

const root = process.env.WORKSHOP_SOURCE_DIR || "public/features/workshop";
const original = parse(readFileSync(process.env.WORKSHOP_ORACLE_SOURCE || "scripts/fixtures/workshop-baseline/workshop-module.js", "utf8"),
  { ecmaVersion: "latest", sourceType: "module" });
const declarations = original.body.map(node => node.declaration || node);
const ui = new Set(["activeWorkshopDeviceId", "selectedWorkshopItemId", "selectedWorkshopWorkerId", "activeWorkshopStep",
  "activeWorkshopPicker", "pickerMountKey", "activePickerWorkerId", "lastWorkshopRenderFp", "activeWorkerSort",
  "activeKitPlanner", "activeFinishPlanModal", "activeInlayPreviewTester", "finishPlanController",
  "plannerModalLifecycleCleanup", "finishModalLifecycleCleanup", "inlayPreviewTesterLifecycleCleanup",
  "workshopStepKeyboardBound", "finishPlanPreviewMarkupCache"]);
const functions = new Map();
let stateInitializer;
function walk(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "FunctionDeclaration") {
    functions.set(node.id.name, node);
    if (node.id.name === "createWorkshopUiState") stateInitializer = node.body.body.find(n => n.type === "ReturnStatement").argument;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") walk(value);
  }
}
for (const file of readdirSync(root).filter(file => file.endsWith(".js") && file !== "workshop-module.js")) {
  walk(parse(readFileSync(path.join(root, file), "utf8"), { ecmaVersion: "latest", sourceType: "module" }));
}
function semantic(node) {
  if (Array.isArray(node)) return node.map(semantic);
  if (!node || typeof node !== "object") return node;
  if (node.type === "MemberExpression" && !node.computed && node.object?.name === "ui" && ui.has(node.property?.name)) {
    return { type: "Identifier", name: node.property.name };
  }
  return Object.fromEntries(Object.entries(node).filter(([key]) => !["start", "end", "raw"].includes(key))
    .map(([key, value]) => [key, key === "shorthand" ? false : semantic(value)]));
}
// These two functions acquire lifecycle ownership. Their behavior is covered by
// the browser, legacy-output, scope, dispose/remount and subscription tests.
const lifecycleChanges = new Set(["initWorkshopModule", "bindWorkshopStepKeyboard"]);
let count = 0;
for (const node of declarations.filter(node => node.type === "FunctionDeclaration")) {
  if (lifecycleChanges.has(node.id.name)) continue;
  assert.ok(functions.has(node.id.name), `${node.id.name}: original function was lost`);
  assert.deepEqual(semantic(functions.get(node.id.name)), semantic(node), `${node.id.name}: branch, operation or template changed during extraction`);
  count++;
}
assert.ok(stateInitializer, "UI state has an instance initializer");
const properties = new Map(stateInitializer.properties.map(property => [property.key.name, property.value]));
for (const node of declarations.filter(node => node.type === "VariableDeclaration")) {
  for (const variable of node.declarations.filter(variable => ui.has(variable.id.name))) {
    assert.deepEqual(semantic(properties.get(variable.id.name)), semantic(variable.init), `${variable.id.name}: initial UI state changed`);
  }
}
assert.equal(properties.size, ui.size);
console.log(`workshop-source-parity-smoke: ${count} original functions and ${ui.size} UI initializers preserved; 2 lifecycle functions checked separately`);
