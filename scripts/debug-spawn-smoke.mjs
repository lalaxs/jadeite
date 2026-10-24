import assert from "node:assert/strict";
import { spawnDebugFinishedProducts } from "../server/services/debug-spawn-service.js";
import { materialStageFor } from "../server/services/inventory-service.js";
import { PRODUCT_CATEGORIES } from "../public/jade-categories.js";
import { productCanvas } from "../public/features/opening/opening-render.js";
import { componentJewelrySvg } from "../public/inlay-product-renderer.js";
import { jadePiecePreviewMarkup } from "../public/jade-piece-view.js";
import { resolveSourceMaterialPlacement } from "../shared/domain/jade/product-meta.js";

const player = { bracelets: [], rough: [], materials: [], slices: [] };
const result = spawnDebugFinishedProducts(player, { count: 50 });
assert.equal(result.ok, true);
assert.equal(result.count, 50);
assert.equal(player.bracelets.length, 50);

const fingerprints = new Set();
for (const item of player.bracelets) {
  assert.equal(materialStageFor(item), "finished");
  assert.equal(item.type, "bracelet");
  assert.equal(item.sourceMaterial.placement.svgSpace, true);
  assert.equal(item.sourceMaterial.placement.x, 300, "SVG placements use the 600px material centre, not 50 percent");
  assert.equal(item.sourceMaterial.placement.y, 300);
  const key = [
    item.jadeKind || item.sourceMaterial?.placement?.layout || item.kind,
    item.productType || "",
    item.ringSize ?? "",
    item.size ?? "",
    item.qualityKey || "",
    item.inlay?.settingId || "",
    item.inlay?.metalId || "",
    item.finish?.refinementId || "",
    item.finish?.polishId || item.inlay?.polishId || "",
    item.inlay?.gemId || "",
    item.inlay?.gemCount ?? "",
    item.inlay?.backingId || ""
  ].join("|");
  assert.equal(fingerprints.has(key), false, `duplicate finished product: ${key}`);
  fingerprints.add(key);
}

const kindsSeen = new Set(
  player.bracelets.map((item) => item.jadeKind || item.sourceMaterial?.placement?.layout || item.kind)
);
// At least cover several craftable jade kinds across the batch.
assert.ok(kindsSeen.size >= 5, `expected diverse kinds, got ${[...kindsSeen].join(",")}`);
assert.equal(Object.keys(PRODUCT_CATEGORIES).length, 11);

const again = spawnDebugFinishedProducts(player, { count: 50 });
assert.equal(again.count, 50);
assert.equal(player.bracelets.length, 100);

// Reproduce the old saved debug stock, including the exact bracelet reported
// in inventory. The correction must work in raw cutouts and assembled views.
for (const kind of ["bracelet", "plaque", "leafPendant"]) {
  const category = PRODUCT_CATEGORIES[kind];
  const legacy = {
    id: `legacy-debug-${kind}`, kind, type: "bracelet", name: kind,
    qualityKey: "glutinous", quality: "糯种", color: "青白", ringSize: 55,
    polished: true, materialStage: "finished", debugSpawn: true,
    sourceMaterial: {
      roughId: "debug-rough", visual: { seed: 18140 }, qualityKey: "glutinous", color: "青白",
      placement: { layout: kind, openingTpl: category.kitType, kitType: category.kitType,
        x: 50, y: 50, rot: 0, scale: 1, svgSpace: true }
    }
  };
  const saved = structuredClone(legacy);
  const centred = structuredClone(legacy);
  centred.sourceMaterial.placement.x = centred.sourceMaterial.placement.y = 300;
  const transform = (markup) => [...markup.matchAll(/<use href="#[^"]*-jadeMaterial" transform="([^"]+)"/g)].map((m) => m[1]);
  for (const render of [productCanvas, jadePiecePreviewMarkup,
    (item) => componentJewelrySvg(item, "compact", { viewMode: "original" }),
    (item) => componentJewelrySvg(item, "compact", { viewMode: "jade" })]) {
    const markup = render(legacy);
    assert.ok(transform(markup).length, `${kind}: exercise real material rendering`);
    assert.deepEqual(transform(markup), transform(render(centred)), `${kind}: old stock samples the centre consistently`);
    assert.doesNotMatch(markup, /translate\(-50 -50\)/, "never expose the rectangular material boundary");
  }
  const assembled = { ...legacy, components: [{ type: "jade", kind, sourceMaterial: structuredClone(legacy.sourceMaterial) }] };
  delete assembled.sourceMaterial;
  assert.deepEqual(transform(productCanvas(assembled)), transform(componentJewelrySvg(centred)), "jade-component-only sources receive the same compatibility repair");
  assert.deepEqual(legacy, saved, "rendering compatibility cannot rewrite saved inventory");
  // Real SVG coordinates near an edge remain authoritative for other sources.
  const real = structuredClone(legacy);
  real.sourceMaterial.roughId = "real-source";
  assert.ok(transform(componentJewelrySvg(real, "compact", { viewMode: "original" })).some((t) => t.includes("translate(-50 -50)")));
  assert.equal(resolveSourceMaterialPlacement(real.sourceMaterial), real.sourceMaterial.placement);
  for (const placement of [{ x: 300, y: 300, svgSpace: true }, { x: 50, y: 50, svgSpace: false }, { x: 50, y: 60, svgSpace: true }]) {
    assert.equal(resolveSourceMaterialPlacement({ ...legacy.sourceMaterial, placement }), placement, "leave other saved coordinate records intact");
  }
}

console.log("debug-spawn-smoke: ok");
process.exit(0);
