import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "acorn";

// Intentional feature work after the frozen refactor changes business bodies.
// Its latest accepted source is a new integration baseline, never a replacement
// for the historical before/after refactor proof.
const manifest = JSON.parse(readFileSync("docs/reports/2026-10-23-trading-service-refactor/integration-manifest.json", "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const production = file => /^(public|server|shared)\//.test(file) || ["server.js", "workshop-start-handler.js"].includes(file);
const files = manifest.files.filter(file => production(file.path));
for (const file of files) assert.equal(sha(readFileSync(file.path)), file.sha256, `Integration baseline drift: ${file.path}`);
const sourceMap = JSON.parse(readFileSync("scripts/fixtures/trading-service-baseline/sources.json", "utf8"));
const instanceFiles = ["auction-instance.js", "market-instance.js", "achievement-rewards-instance.js", "blackmarket/create-service.js",
  ...Object.keys(sourceMap).filter(name => name.startsWith("blackmarket/") && !name.endsWith("index.js")).map(name => name.replace("blackmarket/", "blackmarket/instances/"))];
const roots = new Set(instanceFiles.map(file => path.resolve("server/services", file))), graph = new Map();
const options = { ecmaVersion: "latest", sourceType: "module" };
for (const file of roots) {
  const ast = parse(readFileSync(file, "utf8"), options);
  assert.ok(!ast.body.some(node => node.type === "VariableDeclaration" && node.kind === "let"), `${file}: no module-level mutable instance slot`);
  const imports = ast.body.filter(node => node.type === "ImportDeclaration").map(node => node.source.value);
  assert.ok(imports.every(target => !/(?:^|\/)(?:auction-service|market-service|blackmarket-service|achievement-rewards|legacy)\.js$/.test(target)), `${file}: no legacy default-instance dependency`);
  graph.set(file, imports.map(target => path.resolve(path.dirname(file), target)).filter(target => roots.has(target)));
}
const visited = new Set(), visiting = new Set();
function visit(file) { assert.ok(!visiting.has(file), `Cycle: ${file}`); if (visited.has(file)) return; visiting.add(file); for (const target of graph.get(file)) visit(target); visiting.delete(file); visited.add(file); }
for (const file of roots) visit(file);
const wire = parse(readFileSync("server/boot/wire-server.js", "utf8"), options);
const body = wire.body.find(node => node.declaration?.id?.name === "wireServer").declaration.body.body;
for (const domain of ["Auction", "Market", "Blackmarket"]) {
  const declarations = body.filter(node => node.type === "VariableDeclaration").flatMap(node => node.declarations);
  const actual = declarations.filter(node => node.init?.callee?.name === `create${domain}Service`);
  assert.equal(actual.length, 1, `${domain}: exactly one owned service instance per boot`);
  assert.equal(actual[0].id.type, "ObjectPattern");
  assert.equal(actual[0].init.arguments[0].name, `${domain.toLowerCase()}Deps`);
}
const commerce = parse(readFileSync("server/shell/commands/commerce-commands.js", "utf8"), options);
assert.ok(!commerce.body.some(node => node.type === "ImportDeclaration" && /market-service/.test(node.source.value)), "NPC accept command must use its injected market instance");
assert.match(readFileSync("server/shell/commands/commerce-commands.js", "utf8"), /acceptMarketOfferForPlayer,/);
function allFiles(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? allFiles(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]); }
const known = new Set(manifest.files.map(file => file.path));
assert.deepEqual(["public", "server", "shared"].flatMap(allFiles).filter(file => !known.has(file)), [], "No unvalidated runtime additions after integration freeze");
console.log(`trading-integration-smoke: ${files.length} current production files frozen, three owned service instances, no legacy back-imports or instance cycles`);
