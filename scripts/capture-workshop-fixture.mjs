import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { seedWorkshopDeliveryFixtures } from "./workshop-delivery-fixtures.mjs";

assert.ok(process.argv.includes("--capture"), "Fixture capture must be explicitly requested");
const dir = "scripts/fixtures/workshop-baseline";
assert.ok(!existsSync(`${dir}/state.json`), "Frozen fixture already exists; never replace it during refactoring");
process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
const now = Date.parse("2026-10-23T12:00:00+08:00");
Date.now = () => now;
let seed = 42023;
Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
H.state.players.clear();
const player = H.makePlayer("workshop-baseline-player");
player.name = "基线掌柜";
player.cash = 200000;
H.state.players.set(player.id, player);
// Keep all three workshop stages plus the opening picker represented even when
// the production starter policy grants only one stone. These are test assets.
const starter = structuredClone(player.rough[0]);
while (player.rough.length < 3) {
  player.rough.push({ ...structuredClone(starter), id: `baseline-source-${player.rough.length}` });
}
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
state.serverNow = now;
state.stateVersion = 1;
state.news = [];
state.worldChat = [];
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/state.json`, JSON.stringify(state, null, 2) + "\n");
const source = readFileSync("public/features/workshop/workshop-module.js");
writeFileSync(`${dir}/workshop-module.js`, source);
writeFileSync(`${dir}/contract.json`, JSON.stringify({ now, sourceSha256: createHash("sha256").update(source).digest("hex"),
  normalizedSourceSha256: createHash("sha256").update(source.toString("utf8").replaceAll("\r\n", "\n")).digest("hex"),
  exports: Object.keys(await import("../public/features/workshop/workshop-module.js")).sort() }, null, 2) + "\n");
console.log(`Frozen workshop source, protocol state and ${state.me.workshopDeliveries.length} real production deliveries captured`);
