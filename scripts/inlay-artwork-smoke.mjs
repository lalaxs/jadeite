import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INLAY_ART_ATLASES, INLAY_ART_FRAMES, INLAY_CORE_FRAMES, BUDDHA_ART_FRAME, inlayArtworkDefs } from "../public/inlay-artwork.js";
import { componentJewelrySvg, materialSwatchHtml } from "../public/inlay-product-renderer.js";
import { buildInlayPreviewBaseItem, buildFinishPreviewProduct } from "../public/inlay-preview-tester.js";
import { SETTING_GEMS, settingGemLayout } from "../shared/domain/workshop/finished-product-design.js";
import { inlinePreviewImages } from "../public/preview-bitmap-cache.js";
import { specialGoodsVisual } from "../public/features/blackmarket/goods-display.js";

for (const [name, atlas] of Object.entries(INLAY_ART_ATLASES)) {
  const png = readFileSync(new URL(`../public${atlas.href}`, import.meta.url));
  assert.equal(png.toString("ascii", 1, 4), "PNG");
  assert.equal(png.readUInt32BE(16), atlas.width, `${name}: real PNG width matches sprite coordinates`);
  assert.equal(png.readUInt32BE(20), atlas.height);
  assert.equal(png[25], 6, "production art must retain RGBA transparency");
  assert.ok(png.length < 2_100_000, "each atlas stays within the project's image budget");
}
for (const [name, [x, y, w, h]] of Object.entries(INLAY_ART_FRAMES)) {
  const atlas = /^(diamond|ruby|sapphire)/.test(name) ? INLAY_ART_ATLASES.gems : INLAY_ART_ATLASES.accessories;
  assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= atlas.width && y + h <= atlas.height, `${name}: crop stays inside its PNG`);
}
for (const [name, [x, y, w, h]] of Object.entries(INLAY_CORE_FRAMES)) {
  const atlas = INLAY_ART_ATLASES.core;
  assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= atlas.width && y + h <= atlas.height, `${name}: painted body/frame crop stays inside its PNG`);
}
{
  const [x, y, w, h] = BUDDHA_ART_FRAME;
  const atlas = INLAY_ART_ATLASES.buddha;
  assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= atlas.width && y + h <= atlas.height, "original-style Buddha crop stays inside its PNG");
  assert.deepEqual(readFileSync(new URL(`../public${atlas.href}`, import.meta.url)), readFileSync(new URL("../docs/art/2026-10-23-buddha-original-lines/buddha-original-clean-lines-v1.png", import.meta.url)), "production preserves the generated original-style line cleanup and alpha");
}

for (const settingId of ["claw", "bezel", "micro", "channel", "invisible", "cord"]) {
  const source = buildInlayPreviewBaseItem("cabochon");
  const draft = { productType: "ring", settingId, metalId: settingId === "cord" ? null : "gold18k", gemId: ["bezel", "cord"].includes(settingId) ? null : "ruby", polishId: "bright", backingId: "open", gemLayout: SETTING_GEMS };
  draft.gemCount = settingGemLayout(source, draft).count;
  const item = buildFinishPreviewProduct(source, draft);
  const before = JSON.stringify(item);
  const markup = componentJewelrySvg(item);
  assert.equal(JSON.stringify(item), before, "art composition cannot rewrite a player's stone");
  assert.match(markup, /data-jewelry-art="handpainted-v2"/);
  assert.match(markup, /data-inlay-atlas="accessories"/);
  assert.match(markup, /data-inlay-atlas="core"/);
  assert.match(markup, /data-jade-body-art="cabochon"/);
  if (settingId !== "cord") assert.match(markup, /data-inlay-sprite="ovalFrame"/, "the full painted base frame is actually composed into the product");
  assert.equal((markup.match(/class="craft-accent-stone"/g) || []).length, draft.gemCount, `${settingId}: art uses exactly the paid slots`);
  const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const match of markup.matchAll(/(?:href="#|url\(#)([^"\)]+)/g)) assert.ok(ids.has(match[1]), `${settingId}: unresolved SVG reference ${match[1]}`);
  assert.doesNotMatch(componentJewelrySvg(item, "finished", { viewMode: "original" }), /data-inlay-atlas=/, "original cuts retain their exact raw material pass");
  const jadeOnly = componentJewelrySvg(item, "finished", { viewMode: "jade" });
  assert.doesNotMatch(jadeOnly, /data-inlay-atlas="(?:accessories|gems)"/, "jade-only view excludes mounting art");
  assert.match(jadeOnly, /data-jade-body-art="cabochon"/, "jade-only view retains the finished painted surface");
}
const buddhaSource = buildInlayPreviewBaseItem("carving");
const buddhaDraft = { productType: "pendant", settingId: "micro", metalId: "platinum", gemId: "diamond", polishId: "soft", gemLayout: SETTING_GEMS };
buddhaDraft.gemCount = settingGemLayout(buddhaSource, buddhaDraft).count;
const buddhaProduct = buildFinishPreviewProduct(buddhaSource, buddhaDraft);
const buddhaBefore = JSON.stringify(buddhaProduct);
const buddha = componentJewelrySvg(buddhaProduct);
assert.equal(JSON.stringify(buddhaProduct), buddhaBefore, "the new relief cannot change the Buddha's source jade or setting data");
assert.ok(buddha.includes(INLAY_ART_ATLASES.buddha.href), "finished Buddha uses the original-style line cleanup");
assert.doesNotMatch(buddha, /buddha-rounded-minimal/, "the rounded redesign is no longer rendered");
for (const match of buddha.matchAll(/<symbol id="[^"]+-art-jade-(?:shadow|light)"[^>]*>(.*?)<\/symbol>/g)) {
  assert.match(match[1], /href="#[^"]+-atlas-buddha"/, "both relief passes use the simplified Buddha, not the old core image");
}
const buddhaJadeOnly = componentJewelrySvg(buddhaProduct, "finished", { viewMode: "jade" });
assert.ok(buddhaJadeOnly.includes(INLAY_ART_ATLASES.buddha.href), "jade-only comparison retains the simplified carving");
assert.doesNotMatch(buddhaJadeOnly, /data-inlay-atlas="(?:core|accessories|gems)"/, "jade-only Buddha does not load unused mounting atlases");
assert.doesNotMatch(componentJewelrySvg(buddhaProduct, "finished", { viewMode: "original" }), /data-inlay-atlas=/, "original Buddha cut remains uncarved in the comparison");
assert.match(buddha, /data-jade-body-art="buddhaPendant"/);
assert.match(buddha, /data-inlay-sprite="jade-shadow"/);
assert.match(buddha, /data-inlay-sprite="jade-light"/);
assert.match(buddha, /data-inlay-sprite="rimProfile"/, "the painted profile follows the original Buddha outline");
assert.doesNotMatch(buddha, /data-inlay-sprite="buddhaFrame"/, "a differently shaped bitmap outline cannot double the captured contour");
assert.equal((buddha.match(/data-mount-art="contour-frame"/g) || []).length, 1, "micro setting has one continuous seat beneath the gems");
const buddhaWithoutGems = componentJewelrySvg(buildFinishPreviewProduct(buddhaSource, { ...buddhaDraft, gemId: null, gemCount: 0 }));
assert.equal((buddhaWithoutGems.match(/data-mount-art="contour-frame"/g) || []).length, 1, "the empty micro preview must not reveal overlapping base, rim and halo frames");
assert.doesNotMatch(buddhaWithoutGems, /class="craft-accent-stone"/);
for (const gemId of ["diamond", "ruby", "sapphire"]) assert.match(materialSwatchHtml({ key: gemId, group: "gem" }), /data-inlay-sprite="gem-round"/, "material inventory uses the same painted stone as the product");
for (const key of ["goldPure", "gold18k", "silver925", "platinum", "diamond", "ruby", "sapphire"]) {
  const gem = ["diamond", "ruby", "sapphire"].includes(key);
  const cardArt = specialGoodsVisual({ type: "supply", item: { id: "stock-id-is-not-material-key", materialKey: key, unitLabel: gem ? "颗" : "克" } });
  assert.ok(cardArt.includes(`data-material-key="${key}"`), "Black-market stock resolves the artwork from materialKey, not the listing UUID");
  assert.ok(cardArt.includes(`data-group="${gem ? "gem" : "metal"}"`));
  assert.doesNotMatch(cardArt, /bm-npc-product-mark/, "Material artwork replaces the old text placeholder");
  if (gem) assert.ok(cardArt.includes(INLAY_ART_ATLASES.gems.href), "Black-market gems reuse the existing painted atlas");
}
assert.notEqual(inlayArtworkDefs("sample", "goldPure"), inlayArtworkDefs("sample", "gold18k"));
assert.notEqual(inlayArtworkDefs("sample", "silver925"), inlayArtworkDefs("sample", "platinum"));

// Real linked artwork must be embedded before SVG-to-bitmap capture. Concurrent
// inventory cards share one fetch per atlas; failed images remain retryable.
const saved = { document: globalThis.document, fetch: globalThis.fetch, FileReader: globalThis.FileReader };
let fetches = 0;
globalThis.document = { baseURI: "http://localhost:3012/" };
globalThis.FileReader = class {
  readAsDataURL(blob) { blob.arrayBuffer().then((bytes) => { this.result = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`; this.onload(); }); }
};
globalThis.fetch = async () => { fetches++; return { ok: true, blob: async () => new Blob(["painted atlas"], { type: "image/png" }) }; };
const image = (href) => ({ href, getAttribute() { return this.href; }, getAttributeNS() { return null; }, removeAttributeNS() {}, setAttribute(_, value) { this.href = value; } });
const first = image("/assets/inlay/test-shared.png"), second = image("/assets/inlay/test-shared.png");
try {
  await Promise.all([first, second].map((img) => inlinePreviewImages({ querySelectorAll: () => [img] })));
  assert.equal(fetches, 1, "concurrent captures share atlas decoding");
  assert.match(first.href, /^data:image\/png;base64,/);
  assert.equal(first.href, second.href);
  const denied = image("https://unrelated.example/asset.png");
  await assert.rejects(inlinePreviewImages({ querySelectorAll: () => [denied] }), /same-origin/);
  globalThis.fetch = async () => ({ ok: false });
  const retry = image("/assets/inlay/test-retry.png");
  await assert.rejects(inlinePreviewImages({ querySelectorAll: () => [retry] }), /did not load/);
  globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(["recovered"], { type: "image/png" }) });
  await inlinePreviewImages({ querySelectorAll: () => [retry] });
  assert.match(retry.href, /^data:image\/png;base64,/, "an asset failure does not permanently poison the cache");
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
}
console.log("inlay-artwork-smoke: RGBA assets, crop bounds, all settings, exact stone counts, source preservation and bitmap capture embedding ok");
