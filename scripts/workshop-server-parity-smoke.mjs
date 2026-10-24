import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "acorn";

const fixture = "scripts/fixtures/workshop-server-baseline";
const contract = JSON.parse(readFileSync(`${fixture}/server-contract.json`, "utf8"));
const original = readFileSync(`${fixture}/server-service.js`, "utf8");
assert.equal(createHash("sha256").update(original.replaceAll("\r\n", "\n")).digest("hex"), contract.normalizedSourceSha256, "the original service remains frozen");
const options = { ecmaVersion: "latest", sourceType: "module" };
const parseSource = source => parse(source, options);
const originalFactory = parseSource(original).body.find(n => n.declaration?.id?.name === "createWorkshopService").declaration;
const root = process.env.WORKSHOP_SERVER_DIR || "server/services";
const files = ["workshop-service.js", ...["inventory", "queries", "products", "commands", "completion", "runtime"].map(name => `workshop/${name}.js`)];
const actual = new Map();
let actualFactory, runtimeState;
function walk(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "FunctionDeclaration" && contract.functions.includes(node.id.name)) {
    assert.ok(!actual.has(node.id.name), `${node.id.name} was duplicated`);
    actual.set(node.id.name, node);
  }
  if (node.type === "FunctionDeclaration" && node.id.name === "createWorkshopService") actualFactory = node;
  if (node.type === "VariableDeclarator" && node.id.name === "state") runtimeState = node.init;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") walk(value);
  }
}
for (const file of files.filter(file => existsSync(path.join(root, file)))) walk(parseSource(readFileSync(path.join(root, file), "utf8")));
function semantic(node) {
  if (Array.isArray(node)) return node.map(semantic);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node).filter(([key]) => !["start", "end", "raw"].includes(key)).map(([key, value]) => [key, semantic(value)]));
}
for (const node of originalFactory.body.body.filter(node => node.type === "FunctionDeclaration")) {
  assert.deepEqual(semantic(actual.get(node.id.name)), semantic(node), `${node.id.name}: a branch, operation, default argument or effect order changed`);
}
assert.equal(actual.size, contract.functions.length);
assert.deepEqual(semantic(actualFactory.params), semantic(originalFactory.params));
const returned = factory => factory.body.body.findLast(node => node.type === "ReturnStatement").argument;
assert.deepEqual(semantic(returned(actualFactory)), semantic(returned(originalFactory)), "all public methods, values and enumeration order are preserved");
const originalState = originalFactory.body.body.filter(node => node.type === "VariableDeclaration")
  .flatMap(node => node.declarations).find(node => node.id.name === "state").init;
assert.deepEqual(semantic(runtimeState), semantic(originalState), "dynamic world lookup cannot become a cached world/player reference");
console.log(`workshop-server-parity-smoke: ${actual.size} function bodies/defaults, ${contract.methods.length} public methods and dynamic state access preserved`);
