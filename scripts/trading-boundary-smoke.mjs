import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "acorn";
const report = "docs/reports/2026-10-23-trading-service-refactor";
const manifest = JSON.parse(readFileSync(`${report}/baseline-manifest.json`, "utf8"));
const originals = JSON.parse(readFileSync("scripts/fixtures/trading-service-baseline/sources.json", "utf8"));
const changed = new Set([...Object.keys(originals).map(name => `server/services/${name}`), "server/boot/wire-server.js", "server/shell/socket-handlers.js", "server/shell/commands/commerce-commands.js"]);
const modules = Object.keys(originals).filter(name => name.startsWith("blackmarket/") && !name.endsWith("index.js"));
const additions = new Set(["auction-instance.js", "market-instance.js", "achievement-rewards-instance.js", "blackmarket/create-service.js", "blackmarket/legacy.js",
  ...modules.map(name => name.replace("blackmarket/", "blackmarket/instances/"))].map(name => `server/services/${name}`));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const production = name => /^(public|server|shared)\//.test(name) || ["server.js", "workshop-start-handler.js"].includes(name);
const protectedFiles = manifest.files.filter(file => production(file.path) && !changed.has(file.path));
for (const file of protectedFiles) assert.equal(sha(readFileSync(file.path)), file.sha256, `${file.path}: UI, rules, protocol, persistence and unrelated services must stay frozen`);
assert.equal(sha(readFileSync("scripts/fixtures/trading-service-baseline/sources.json")), manifest.files.find(file => file.path === "scripts/fixtures/trading-service-baseline/sources.json").sha256);
function filesBelow(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesBelow(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]); }
const known = new Set(manifest.files.map(file => file.path));
assert.deepEqual(["public", "server", "shared"].flatMap(filesBelow).filter(file => !known.has(file) && !additions.has(file)), []);
const options = { ecmaVersion: "latest", sourceType: "module" };
const roots = new Set([...additions].filter(file => !file.endsWith("/legacy.js")).map(file => path.resolve(file))), graph = new Map();
for (const file of roots) {
  const ast = parse(readFileSync(file, "utf8"), options);
  assert.ok(!ast.body.some(node => node.type === "VariableDeclaration" && node.kind === "let"), `${file}: instance implementations cannot own module-global mutable slots`);
  const imports = ast.body.filter(node => node.type === "ImportDeclaration").map(node => node.source.value);
  assert.ok(imports.every(target => !/(?:^|\/)(?:auction-service|market-service|blackmarket-service|achievement-rewards|legacy)\.js$/.test(target)), `${file}: cannot call back into legacy default instances`);
  graph.set(file, imports.map(target => path.resolve(path.dirname(file), target)).filter(target => roots.has(target)));
}
const visiting = new Set(), visited = new Set();
function visit(file) { assert.ok(!visiting.has(file), `trading import cycle at ${file}`); if (visited.has(file)) return; visiting.add(file); for (const next of graph.get(file)) visit(next); visiting.delete(file); visited.add(file); }
for (const file of roots) visit(file);

// Reverse only the declared wiring transformation, then compare the whole boot
// module. This protects registration/effect/tick order and every unrelated port.
const frozenWire = readFileSync("scripts/fixtures/trading-service-baseline/wire-server.js", "utf8");
assert.equal(sha(frozenWire), manifest.files.find(file => file.path === "server/boot/wire-server.js").sha256);
const before = parse(frozenWire, options), after = parse(readFileSync("server/boot/wire-server.js", "utf8"), options);
const bodyFor = ast => ast.body.find(node => node.declaration?.id?.name === "wireServer").declaration.body.body;
for (const domain of ["auction", "market", "blackmarket"]) {
  const title = domain[0].toUpperCase() + domain.slice(1), bind = `bind${title}Api`;
  const originalImport = before.body.find(node => node.type === "ImportDeclaration" && node.source.value === `../services/${domain}-service.js`);
  const actualImportIndex = after.body.findIndex(node => node.type === "ImportDeclaration" && node.source.value === originalImport.source.value);
  const constants = originalImport.specifiers.map(node => node.local.name).filter(name => /^[A-Z_]+$/.test(name));
  assert.deepEqual(after.body[actualImportIndex].specifiers.map(node => node.local.name).sort(), [`create${title}Service`, bind, ...constants].sort());
  after.body[actualImportIndex] = originalImport;
  const originalCall = bodyFor(before).find(node => node.expression?.callee?.name === bind);
  const body = bodyFor(after), at = body.findIndex(node => node.declarations?.[0]?.id?.name === `${domain}Deps`);
  assert.ok(at >= 0);
  const [deps, instance, legacy] = body.slice(at, at + 3);
  const initializer = deps.declarations[0].init;
  if (domain === "auction") {
    const added = initializer.properties.filter(prop => prop.key.name === "earnCash");
    assert.equal(added.length, 1); assert.equal(added[0].value.name, "earnCash");
    initializer.properties = initializer.properties.filter(prop => prop.key.name !== "earnCash");
  }
  const importedMethods = originalImport.specifiers.map(node => node.local.name).filter(name => name !== bind && !constants.includes(name));
  const declaration = instance.declarations[0];
  if (domain === "market") {
    const added = declaration.id.properties.filter(prop => prop.key.name === "acceptMarketOfferForPlayer");
    assert.equal(added.length, 1); assert.equal(added[0].value.name, "acceptMarketOfferForPlayer");
    declaration.id.properties = declaration.id.properties.filter(prop => prop.key.name !== "acceptMarketOfferForPlayer");
  }
  assert.deepEqual(declaration.id.properties.map(prop => [prop.key.name, prop.value.name]), importedMethods.map(name => [name, name]));
  assert.equal(declaration.init.callee.name, `create${title}Service`);
  assert.deepEqual(declaration.init.arguments.map(node => node.name), [`${domain}Deps`]);
  assert.equal(legacy.expression.callee.name, bind);
  assert.deepEqual(legacy.expression.arguments.map(node => node.name), [`${domain}Deps`]);
  body.splice(at, 3, { ...originalCall, expression: { ...originalCall.expression, arguments: [initializer] } });
}
const deferred = new Set(["stallInventoryItemsForPlayer", "publicBlackStall", "publicServiceOrdersForPlayer", "publicAuctionHalls"]);
const restores = [];
function restoreCallbacks(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "Property" && deferred.has(node.key.name) && node.value.type === "ArrowFunctionExpression") {
    assert.deepEqual(node.value.params.map(param => [param.type, param.argument?.name]), [["RestElement", "args"]]);
    assert.equal(node.value.body.callee.name, node.key.name);
    assert.deepEqual(node.value.body.arguments.map(arg => [arg.type, arg.argument?.name]), [["SpreadElement", "args"]]);
    node.value = { type: "Identifier", name: node.key.name }; node.shorthand = true; restores.push(node.key.name);
  }
  for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(restoreCallbacks) : value && typeof value === "object" && restoreCallbacks(value);
}
restoreCallbacks(after); assert.deepEqual(restores.sort(), [...deferred].sort());
function stripOfferPort(node) {
  if (!node || typeof node !== "object") return 0;
  let removed = 0;
  if (["ObjectExpression", "ObjectPattern"].includes(node.type)) {
    const added = node.properties.filter(prop => prop.key?.name === "acceptMarketOfferForPlayer");
    for (const prop of added) assert.equal(prop.value.name, "acceptMarketOfferForPlayer");
    removed += added.length; node.properties = node.properties.filter(prop => prop.key?.name !== "acceptMarketOfferForPlayer");
  }
  for (const value of Object.values(node)) removed += Array.isArray(value) ? value.reduce((sum, child) => sum + stripOfferPort(child), 0) : value && typeof value === "object" ? stripOfferPort(value) : 0;
  return removed;
}
assert.equal(stripOfferPort(after), 1);
const semantic = node => Array.isArray(node) ? node.map(semantic) : node && typeof node === "object"
  ? Object.fromEntries(Object.entries(node).filter(([key]) => !["start", "end", "raw"].includes(key)).map(([key, value]) => [key, semantic(value)])) : node;
assert.deepEqual(semantic(after), semantic(before), "boot wiring changed beyond the three factories and four deferred registrations");
for (const [file, fixture, ports] of [["server/shell/socket-handlers.js", "socket-handlers.js", 2], ["server/shell/commands/commerce-commands.js", "commerce-commands.js", 1]]) {
  const frozen = readFileSync(`scripts/fixtures/trading-service-baseline/${fixture}`, "utf8");
  assert.equal(sha(frozen), manifest.files.find(entry => entry.path === file).sha256);
  const expected = parse(frozen, options), actual = parse(readFileSync(file, "utf8"), options);
  if (fixture === "commerce-commands.js") expected.body = expected.body.filter(node => !(node.type === "ImportDeclaration" && node.source.value === "../../services/market-service.js"));
  assert.equal(stripOfferPort(actual), ports);
  assert.deepEqual(semantic(actual), semantic(expected), `${file}: only dependency routing may change; handlers, feedback and order must stay exact`);
}
console.log(`trading-boundary-smoke: ${protectedFiles.length} protected production files, ${additions.size} additions, acyclic instance imports and exact declared boot transformation ok`);
