import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "acorn";
import { seedWorkshopDeliveryFixtures } from "./workshop-delivery-fixtures.mjs";

assert.ok(process.argv.includes("--capture"), "Capture is an explicit, one-time baseline operation");
const directory = "scripts/fixtures/workshop-server-baseline";
assert.ok(!existsSync(directory), "Never replace a frozen baseline fixture");
process.env.JADE_WORLD_PERSIST = "0";
const now = Date.parse("2026-10-23T12:00:00+08:00");
Date.now = () => now;
let seed = 42023;
Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const { __testHooks: H } = await import("../server.js");
H.state.players.clear();
const starter = H.makePlayer("server-workshop-starter");
const player = H.makePlayer("server-workshop-baseline-player");
player.name = "基线掌柜";
player.cash = 200000;
H.state.players.set(player.id, player);
const raw = structuredClone(player.rough[0]);
while (player.rough.length < 3) player.rough.push({ ...structuredClone(raw), id: `baseline-source-${player.rough.length}` });
seedWorkshopDeliveryFixtures(H, player);
const material = {
  ...player.rough[0], id: "baseline-opened", name: "冰种飘花明料", type: "material",
  materialStage: "opened", stage: "material", qualityKey: "ice", quality: "冰种", color: "飘花绿",
  score: 4, mass: 1.5, price: 36000, value: 36000, rep: 20,
  visual: { seed: 32198, cotton: .45, crack: false, translucency: .55, vein: "#247854" }
};
player.materials.push(material);
for (const [type, id] of [["bangle", "baseline-bangle"], ["cabochon", "baseline-cabochon"]]) {
  const [blank] = H.extractProductsFromJob({ item: material, options: { kits: [{ type, x: 50, y: 50, ringSize: 56, scale: 1, rot: 17, size: "M" }] } });
  blank.id = id;
  player.bracelets.push(blank);
}
player.externalMaterials = { goldPure: 100, silver925: 100, gold18k: 100, platinum: 100, diamond: 500, ruby: 500, sapphire: 500 };
player.cash = 200000;
player.offlineSummary = null;
const state = H.snapshotFor(player, now);
Object.assign(state, { serverNow: now, stateVersion: 1, news: [], worldChat: [] });
const owned = structuredClone(player);
owned.workshopDeliveries = [];
owned.jobs = [];
owned.polishingJobs = [];
owned.cuttingJobs = [];
const client = readFileSync("public/features/workshop/workshop-module.js", "utf8");
const server = readFileSync("server/services/workshop-service.js", "utf8");
const ast = parse(server, { ecmaVersion: "latest", sourceType: "module" });
const factory = ast.body.find(n => n.declaration?.id?.name === "createWorkshopService").declaration;
const methods = factory.body.body.findLast(n => n.type === "ReturnStatement").argument.properties.map(p => p.key.name);
const functions = factory.body.body.filter(n => n.type === "FunctionDeclaration").map(n => n.id.name);
assert.equal(functions.length, 26, "Capture the unsplit service; review changed responsibilities first");
const sha = text => createHash("sha256").update(text).digest("hex");
mkdirSync(directory, { recursive: true });
const json = (name, data) => writeFileSync(`${directory}/${name}.json`, JSON.stringify(data, null, 2) + "\n");
writeFileSync(`${directory}/workshop-module.js`, client);
writeFileSync(`${directory}/server-service.js`, server);
json("state", state);
json("players", { owned, starter });
json("contract", { now, sourceSha256: sha(client), normalizedSourceSha256: sha(client.replaceAll("\r\n", "\n")) });
json("server-contract", { now, sourceSha256: sha(server), normalizedSourceSha256: sha(server.replaceAll("\r\n", "\n")), methods, functions });
console.log(`Captured ${methods.length} server methods, ${functions.length} functions, 2 synthetic players and ${state.me.workshopDeliveries.length} real deliveries`);
