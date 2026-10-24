import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "acorn";

const manifest = JSON.parse(readFileSync("docs/reports/2026-10-23-workshop-refactor/baseline-final-manifest.json", "utf8"));
const owned = new Set(["public/features/workshop/workshop-module.js", "public/shell/action-router.js"]);
const production = file => file === "server.js" || file === "workshop-start-handler.js" || /^(public|server|shared)\//.test(file);
const addedModules = new Set(["catalog", "state", "selectors", "worker-view", "item-preview", "view",
  "picker-controller", "planner-controller", "finish-controller", "inlay-preview-controller", "actions", "scope",
  "create-workshop-feature"].map(name => `public/features/workshop/${name}.js`));
const known = new Set(manifest.files.map(file => file.path));
function productionFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? productionFiles(file) : [file];
  });
}
const added = ["public", "server", "shared"].flatMap(productionFiles).filter(file => !known.has(file));
assert.deepEqual(added.filter(file => !addedModules.has(file)), [], "phase 1 adds only the explicit workshop modules");
const changed = manifest.files.filter(file => {
  if (!production(file.path) || owned.has(file.path)) return false;
  const bytes = readFileSync(file.path);
  const content = file.normalizedSha256 ? bytes.toString("utf8").replaceAll("\r\n", "\n") : bytes;
  return createHash("sha256").update(content).digest("hex") !== (file.normalizedSha256 || file.sha256);
}).map(file => file.path);
assert.deepEqual(changed, [], "phase 1 must preserve all existing UI/CSS/assets, rules, server, protocol and persistence code outside its two owned files");

const root = path.resolve("public/features/workshop");
const files = readdirSync(root).filter(name => name.endsWith(".js"));
const graph = new Map();
for (const file of files) {
  const source = readFileSync(path.join(root, file), "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  if (file !== "workshop-module.js") {
    assert.ok(!ast.body.some(node => node.type === "VariableDeclaration" && node.kind === "let"), `${file}: mutable feature state belongs in an instance`);
  }
  const imports = ast.body.filter(node => ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && node.source)
    .map(node => node.source.value).filter(target => target.startsWith("./")).map(target => path.basename(target));
  graph.set(file, imports);
}
const visiting = new Set(), visited = new Set();
function visit(file) {
  assert.ok(!visiting.has(file), `workshop import cycle through ${file}`);
  if (visited.has(file)) return;
  visiting.add(file);
  for (const target of graph.get(file) || []) if (graph.has(target)) visit(target);
  visiting.delete(file); visited.add(file);
}
for (const file of files) visit(file);
const budgets = { "workshop-module.js": 100, "create-workshop-feature.js": 350, "view.js": 550,
  "selectors.js": 220, "picker-controller.js": 400, "planner-controller.js": 200, "finish-controller.js": 420 };
for (const [file, budget] of Object.entries(budgets)) {
  assert.ok(readFileSync(path.join(root, file), "utf8").split("\n").length <= budget, `${file}: responsibility budget exceeded`);
}
console.log(`workshop-boundary-smoke: protected production hashes, ${files.length} acyclic modules, instance state and module budgets ok`);
