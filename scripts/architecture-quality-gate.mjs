import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";

const root = process.cwd();
const lineBudgets = new Map([
  ["server/shell/socket-handlers.js", 1050],
  ["server/world-store.js", 250],
  ["server/persistence/world-schema.js", 350],
  ["server/persistence/player-snapshot-schema.js", 850],
  ["server/persistence/mining-snapshot-schema.js", 250],
  ["server/services/mining-service.js", 4000],
  ["public/main.js", 700],
  ["public/features/blackmarket/plaza.js", 1250],
  ["public/features/blackmarket/blind-ui.js", 1250]
]);

for (const [file, limit] of lineBudgets) {
  const lines = readFileSync(join(root, file), "utf8").split("\n").length;
  assert.ok(lines <= limit, `${file} has ${lines} lines; architecture budget is ${limit}`);
}

function filesBelow(directory, predicate) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(path, predicate));
    else if (predicate(path)) result.push(path);
  }
  return result;
}

const blackmarketRoot = resolve(root, "public/features/blackmarket");
const blackmarketFiles = filesBelow(blackmarketRoot, (path) => extname(path) === ".js");
const graph = new Map();
for (const file of blackmarketFiles) {
  const source = readFileSync(file, "utf8");
  const imports = [...source.matchAll(/from\s+["'](\.[^"']+)["']/g)]
    .map((match) => normalize(resolve(dirname(file), match[1])))
    .map((path) => extname(path) ? path : `${path}.js`)
    .filter((path) => path.startsWith(blackmarketRoot) && blackmarketFiles.includes(path));
  graph.set(file, imports);
  if (!["actions.js", "index.js"].includes(basename(file))) {
    assert.doesNotMatch(source, /from\s+["']\.\/plaza\.js["']/, `${file} must use controller.js, not import plaza.js back`);
  }
}

const visiting = new Set();
const visited = new Set();
function visit(file, trail = []) {
  if (visiting.has(file)) {
    const cycle = [...trail.slice(trail.indexOf(file)), file].map((path) => path.replace(`${root}/`, ""));
    assert.fail(`client import cycle: ${cycle.join(" -> ")}`);
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of graph.get(file) || []) visit(dependency, [...trail, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of graph.keys()) visit(file);

const assets = filesBelow(resolve(root, "public"), (path) => /\.(?:png|jpe?g|webp|avif)$/i.test(path));
for (const asset of assets) {
  assert.ok(statSync(asset).size <= 2_100_000, `${asset.replace(`${root}/`, "")} exceeds the 2.1 MB asset budget`);
}

const html = readFileSync(join(root, "public/index.html"), "utf8");
assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/, "runtime must not depend on third-party font origins");

const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
const compose = readFileSync(join(root, "compose.yaml"), "utf8");
assert.doesNotMatch(dockerfile, /^FROM node:24-bookworm-slim/m, "pin the Node image to a patch version");
assert.doesNotMatch(compose, /image:\s+(?:postgres:17-alpine|caddy:2-alpine)\s*$/m, "pin service images to patch versions");

console.log(`architecture-quality-gate: ${lineBudgets.size} module budgets, ${graph.size} black-market modules, ${assets.length} assets ok`);
