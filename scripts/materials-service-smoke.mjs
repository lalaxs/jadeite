import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import {
  MATERIAL_META,
  MATERIAL_CATALOG,
  getMaterialPrice,
  getMaterialPriceHistory,
  recordMaterialPriceTick,
  materialBulkDiscount,
  materialPurchaseQuote,
  createMaterialsService
} from "../server/services/materials-service.js";

assert.equal(getMaterialPrice("gold18k"), 380);
assert.equal(getMaterialPrice("missing"), 0);
assert.ok(MATERIAL_META.diamond);
assert.equal(MATERIAL_CATALOG.length, 7);
assert.ok(MATERIAL_CATALOG.find((m) => m.id === "gold18k")?.packs?.some((p) => p.packId === "kg"));
assert.equal(materialBulkDiscount("gold18k", 49), 0);
assert.equal(materialBulkDiscount("gold18k", 50), 0.01);
assert.equal(materialBulkDiscount("gold18k", 75), 0.025);
assert.equal(materialBulkDiscount("gold18k", 100), 0.04);
assert.equal(materialBulkDiscount("gold18k", 500), 0.075);
assert.equal(materialBulkDiscount("gold18k", 1000), 0.10);
assert.equal(materialBulkDiscount("diamond", 10), 0.08);
assert.equal(materialPurchaseQuote("diamond", 10).price, 1_104);
for (const material of MATERIAL_CATALOG) {
  let previousPrice = 0;
  for (let quantity = 1; quantity <= 2000; quantity += 1) {
    const quote = materialPurchaseQuote(material.id, quantity);
    assert.ok(
      quote.price >= previousPrice,
      `${material.id} price must not fall when quantity rises to ${quantity}`
    );
    previousPrice = quote.price;
  }
}
const before = getMaterialPriceHistory("gold18k").length;
recordMaterialPriceTick();
assert.equal(getMaterialPriceHistory("gold18k").length, before + 1);

assert.equal(typeof H.buyMaterialPack, "function");
assert.equal(typeof H.materialCatalogForPlayer, "function");

const player = H.makePlayer("mat-svc-1");
H.normalizePlayer(player);
player.cash = 1_000_000;
H.state.players.set(player.id, player);

const catalog = H.materialCatalogForPlayer(player);
assert.ok(catalog.some((m) => m.key === "gold18k" && m.packs.length >= 2));
const bought = H.buyMaterialPack(player, "diamond", 10);
assert.equal(bought.ok, true, bought.message);
assert.equal(bought.price, 1_104);
assert.equal(bought.discount, 0.08);
assert.equal(player.externalMaterials.diamond, 10);
assert.ok(player.cash < 1_000_000);
assert.equal(player.externalMaterialsUnseen.diamond, true);

const tooMuch = H.buyMaterialPack(player, "goldPure", 500);
assert.equal(tooMuch.ok, true);
assert.ok(player.externalMaterials.goldPure >= 500);

const broke = H.makePlayer("mat-broke");
H.normalizePlayer(broke);
broke.cash = 1;
const fail = H.buyMaterialPack(broke, "diamond", 1);
assert.equal(fail.ok, false);

const local = createMaterialsService({
  normalizePlayer: H.normalizePlayer,
  spendCash: H.spendCash
});
assert.equal(local.materialHistoryPayload("ruby").ok, true);
assert.equal(local.materialHistoryPayload("nope").ok, false);

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /createMaterialsService/);
assert.doesNotMatch(serverSource, /const MATERIAL_META\s*=/);
assert.doesNotMatch(bootSource, /function buyMaterialPack\(/);

const serviceSource = readFileSync("server/services/materials-service.js", "utf8");
assert.match(serviceSource, /function buyMaterialPack/);
assert.match(serviceSource, /function materialCatalogForPlayer/);

console.log("materials-service-smoke: ok");
process.exit(0);
