import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "acorn";

const manifest = JSON.parse(readFileSync("docs/reports/2026-10-23-workshop-server-refactor/baseline-manifest.json", "utf8"));
const owned = "server/services/workshop-service.js";
const additions = new Set(["inventory", "queries", "products", "commands", "completion", "runtime"].map(name => `server/services/workshop/${name}.js`));
const production = file => /^(public|server|shared)\//.test(file) || ["server.js", "workshop-start-handler.js"].includes(file);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const protectedFiles = manifest.files.filter(file => production(file.path) && file.path !== owned);
for (const file of protectedFiles) {
  const bytes = readFileSync(file.path);
  assert.equal(sha(file.normalizedSha256 ? bytes.toString("utf8").replaceAll("\r\n", "\n") : bytes), file.normalizedSha256 || file.sha256,
    `${file.path}: frontend, shared rules, protocol, roster/planning/delivery, transactions and persistence remain unchanged`);
}
function visitFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? visitFiles(file) : [file];
  });
}
const known = new Set(manifest.files.map(file => file.path));
assert.deepEqual(["public", "server", "shared"].flatMap(visitFiles).filter(file => !known.has(file) && !additions.has(file)), [], "only six declared server factories may be added");
const files = [owned, ...additions], graph = new Map();
const budgets = { "workshop-service.js": 250, "inventory.js": 90, "queries.js": 110, "products.js": 180,
  "commands.js": 300, "completion.js": 280, "runtime.js": 140 };
const roots = new Set(files.map(file => path.resolve(file)));
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  assert.ok(source.split("\n").length <= budgets[path.basename(file)], `${file}: responsibility budget exceeded`);
  assert.ok(!ast.body.some(node => node.type === "VariableDeclaration" && node.kind === "let"), `${file}: instance state cannot be module-global`);
  const imports = ast.body.filter(node => node.type === "ImportDeclaration").map(node => node.source.value);
  if (file !== owned) {
    assert.ok(imports.every(target => !/workshop-service\.js|(?:^|\/)boot\/|(?:^|\/)shell\//.test(target)), `${file}: cannot import composition or transport back`);
  }
  graph.set(path.resolve(file), imports.filter(target => target.startsWith(".")).map(target => path.resolve(path.dirname(file), target)).filter(target => roots.has(target)));
}
const visiting = new Set(), visited = new Set();
function visit(file) {
  assert.ok(!visiting.has(file), `workshop import cycle: ${file}`);
  if (visited.has(file)) return;
  visiting.add(file);
  for (const target of graph.get(file) || []) visit(target);
  visiting.delete(file); visited.add(file);
}
for (const file of graph.keys()) visit(file);
console.log(`workshop-server-boundary-smoke: ${protectedFiles.length} protected production files, six additions, acyclic dependencies and instance state ok`);
