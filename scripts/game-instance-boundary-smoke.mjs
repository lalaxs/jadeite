import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "acorn";

const manifest = JSON.parse(readFileSync("docs/reports/2026-10-23-game-instance-refactor/baseline-manifest.json", "utf8"));
const sources = JSON.parse(readFileSync("scripts/fixtures/game-instance-baseline/sources.json", "utf8"));
const sha = value => createHash("sha256").update(value).digest("hex");
const read = file => readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const production = file => /^(public|server|shared)\//.test(file) || ["server.js", "workshop-start-handler.js"].includes(file);
const added = ["server/create-game.js", "server/boot/game-lifecycle.js", "server/boot/process-lifecycle.js"];
const files = manifest.files.filter(file => production(file.path));
for (const file of files) {
  if (file.path in sources) assert.equal(sha(sources[file.path]), file.sha256, `Frozen source fixture drift: ${file.path}`);
  else assert.equal(sha(readFileSync(file.path)), file.sha256, `Unrelated production change: ${file.path}`);
}
const all = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? all(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
const known = new Set(manifest.files.map(file => file.path));
assert.deepEqual(["public", "server", "shared"].flatMap(all).filter(file => !known.has(file)).sort(), added.sort());

const ast = source => parse(source, { ecmaVersion: "latest", sourceType: "module" });
const clean = node => JSON.parse(JSON.stringify(node, (key, value) => ["start", "end", "raw"].includes(key) ? undefined : value));
const original = file => sources[file].replaceAll("\r\n", "\n");
const replace = (s, before, after) => { assert.ok(s.includes(before), `Missing expected plumbing: ${before}`); return s.replace(before, after); };
function equivalent(file, source) { assert.deepEqual(clean(ast(source)), clean(ast(original(file))), `${file}: original business logic and wiring must remain intact`); }

const wireFile = "server/boot/wire-server.js";
let wire = read(wireFile);
wire = replace(wire, 'import { createGameLifecycle } from "./game-lifecycle.js";\n', "");
wire = replace(wire, 'import { createAchievementRewards } from "../services/achievement-rewards-instance.js";\n', "");
wire = replace(wire, "  createMaterialPriceRuntime", "  startMaterialPriceTicker,\n  stopMaterialPriceTicker");
wire = replace(wire, 'import { bindAchievementRewards }', 'import { bindAchievementRewards, settlePlayerAchievements }');
wire = replace(wire, '  stopSocketSecurity = null,\n  stopHttpSecurity = null,\n  env = process.env,\n  cwd = process.cwd(),\n  world = createMemoryWorldStore(),\n  createPersister = createWorldPersisterForEnvironment,\n  legacyBindings = false\n', '  stopSocketSecurity = null\n');
wire = replace(wire, '  const state = world.raw;', '  const world = createMemoryWorldStore();\n  const state = world.raw;');
wire = replace(wire, 'isWorldPersistEnabled(env)', 'isWorldPersistEnabled()');
wire = replace(wire, 'createPersister({ world, metrics, env, cwd })', 'createWorldPersisterForEnvironment({ world, metrics })');
wire = replace(wire, '  const stopAccountRoutes = installAccountRoutes({', '  installAccountRoutes({');
wire = replace(wire, '  const { settlePlayerAchievements, claimPlayerAchievement, claimAllPlayerAchievements } = createAchievementRewards({ earnCash });\n  if (legacyBindings) bindAchievementRewards({ earnCash });', '  bindAchievementRewards({ earnCash });');
for (const domain of ["Auction", "Market", "Blackmarket"]) wire = replace(wire, `  if (legacyBindings) bind${domain}Api(${domain.toLowerCase()}Deps);`, `  bind${domain}Api(${domain.toLowerCase()}Deps);`);
wire = wire.replaceAll('env.JADE_MINING_', 'process.env.JADE_MINING_');
wire = replace(wire, '  const materialPrices = createMaterialPriceRuntime();\n  const { startMaterialPriceTicker, stopMaterialPriceTicker } = materialPrices;\n', '');
wire = replace(wire, '    priceRuntime: materialPrices,\n', '');
for (const factory of ["createTaskService", "createOrdersService", "createWorkshopService", "wirePlayerService", "createLivestreamService", "createRuntimeTicks"]) {
  const token = factory === "wirePlayerService" ? '  wirePlayerService({\n' : `  } = ${factory}({\n`;
  wire = replace(wire, token + '    settlePlayerAchievements,\n', token);
}
wire = replace(wire, '  registerSocketHandlers(io, {\n    settlePlayerAchievements, claimPlayerAchievement, claimAllPlayerAchievements,\n', '  registerSocketHandlers(io, {\n');
const before = original(wireFile);
const legacyLifecycle = before.slice(before.indexOf('  let shutdownPromise = null;'), before.indexOf('  const {\n    collectBraceletForPlayer,'));
wire = replace(wire, '  const { startServer, shutdown, status } = createGameLifecycle({\n    world, persister, normalizePlayer, checkMiningHealth, reconcileWorld, flushPersistence,\n    durableMutations, startHttpServer, stopHttpServer, io, stopSocketSecurity, stopHttpSecurity, stopAccountRoutes, health, logger, metrics\n  });\n\n', legacyLifecycle);
wire = replace(wire, '    shutdown,\n    status,\n', '    shutdown,\n');
equivalent(wireFile, wire);

for (const file of Object.keys(sources).filter(file => !["server.js", wireFile, "server/services/materials-service.js"].includes(file))) {
  let source = read(file);
  if (source.includes('legacySettlePlayerAchievements')) {
    source = replace(source, 'settlePlayerAchievements as legacySettlePlayerAchievements', 'settlePlayerAchievements');
    source = source.replace('  const settlePlayerAchievements = deps.settlePlayerAchievements || legacySettlePlayerAchievements;\n', '');
    source = source.replace('  settlePlayerAchievements = legacySettlePlayerAchievements,\n', '');
  }
  if (file.endsWith('workshop-service.js')) source = replace(source, '    settlePlayerAchievements: deps.settlePlayerAchievements,\n', '');
  if (file.endsWith('progression-commands.js')) {
    source = replace(source, 'claimPlayerAchievement as legacyClaimPlayerAchievement', 'claimPlayerAchievement');
    source = replace(source, 'claimAllPlayerAchievements as legacyClaimAllPlayerAchievements', 'claimAllPlayerAchievements');
    source = replace(source, '  const claimPlayerAchievement = deps.claimPlayerAchievement || legacyClaimPlayerAchievement;\n  const claimAllPlayerAchievements = deps.claimAllPlayerAchievements || legacyClaimAllPlayerAchievements;\n', '');
  }
  if (file.endsWith('socket-handlers.js')) source = replace(source, '    claimPlayerAchievement: deps.claimPlayerAchievement,\n    claimAllPlayerAchievements: deps.claimAllPlayerAchievements,\n', '');
  if (file.endsWith('http-security.js') || file.endsWith('account-routes.js')) {
    const store = file.endsWith('http-security.js') ? 'requestStore' : 'loginStore';
    source = replace(source, 'rateLimit, MemoryStore', 'rateLimit');
    source = replace(source, `  const ${store} = new MemoryStore();\n`, '');
    source = replace(source, `    store: ${store},\n`, '');
    source = replace(source, `  return () => ${store}.shutdown();\n`, '');
  }
  equivalent(file, source);
}

function functions(source) {
  const found = new Map();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type?.startsWith('Function') && node.id?.name) found.set(node.id.name, node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
  visit(ast(source)); return found;
}
const materialsFile = 'server/services/materials-service.js';
const oldFunctions = functions(original(materialsFile));
const newFunctions = functions(read(materialsFile));
for (const [name, old] of oldFunctions) {
  const next = structuredClone(newFunctions.get(name));
  assert.ok(next, `Material function preserved: ${name}`);
  if (name === 'createMaterialsService') next.body.body.shift();
  assert.deepEqual(clean(next), clean(old), `Material formulas/history unchanged: ${name}`);
}
function initializers(source) {
  const found = new Map();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name) found.set(node.id.name, clean(node.init));
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
  visit(ast(source)); return found;
}
const oldInitializers = initializers(original(materialsFile)), newInitializers = initializers(read(materialsFile));
for (const name of ['MATERIAL_META', 'MATERIAL_CATALOG', 'MATERIAL_PRICE_HISTORY', 'materialPriceDay', 'priceTicker']) {
  assert.deepEqual(newInitializers.get(name), oldInitializers.get(name), `Material constants and initial state unchanged: ${name}`);
}
const oldServer = ast(original('server.js')), gameFactory = ast(read('server/create-game.js'));
const factoryBody = gameFactory.body.find(node => node.declaration?.id?.name === 'createGame').declaration.body;
function staticOptions(node) {
  const result = [];
  function visit(value) { if (!value || typeof value !== 'object') return; if (value.type === 'CallExpression' && value.callee?.object?.name === 'express' && value.callee?.property?.name === 'static' && value.arguments[1]) result.push(clean(value.arguments[1])); for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child); }
  visit(node); return result;
}
assert.deepEqual(staticOptions(factoryBody), staticOptions(oldServer), 'HTTP cache and static asset behavior unchanged');
for (const file of added) {
  const source = read(file);
  assert.doesNotMatch(source, /process\.(?:once|on|exit)\(/, `${file}: use explicit process host adapter`);
  const module = ast(source);
  assert.ok(!module.body.some(node => node.type === 'VariableDeclaration' && node.kind === 'let'));
}
assert.match(read('server.js'), /createGame\(\{ legacyBindings: true \}\)/);
assert.match(read('server.js'), /if \(isDirectRun\(\)\)/);
assert.doesNotMatch(read('server/boot/wire-server.js'), /process\.(once|on|exit)\(|shutdownPromise/);
console.log(JSON.stringify({ ok: true, frozenUnchangedProductionFiles: files.length - Object.keys(sources).length, unchangedClientAndDomainFiles: files.filter(file => /^(public|shared)\//.test(file.path)).length, normalizedCompositionAndServices: Object.keys(sources).length - 2, materialFunctions: oldFunctions.size, added }));
