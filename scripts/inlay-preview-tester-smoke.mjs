import { readWorkshopSource } from "./load-workshop-source.mjs";
import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFileSync } from "node:fs";
import {
  applyInlayPreviewTesterField,
  buildFinishPreviewProduct,
  buildInlayPreviewBaseItem,
  createInlayPreviewTesterState,
  metalPreviewVariants,
  settingPreviewVariants
} from "../public/inlay-preview-tester.js";
import { loadResolvedStyles } from "./load-styles.mjs";

const catalog = {
  productTypes: {
    cabochon: ["ring", "pendant"],
    carving: ["pendant"],
    pierced: ["pendant"],
    bangle: ["bangle"]
  },
  shapeSettings: {
    cabochon: ["claw", "bezel", "cord"],
    carving: ["claw", "cord"],
    pierced: ["bezel", "cord"],
    bangle: []
  },
  productTypeNames: {
    ring: "戒指",
    pendant: "吊坠",
    bangle: "手镯"
  },
  settings: {
    claw: { name: "爪镶", metals: ["gold18k", "platinum"], grams: 1.5, labor: 200 },
    bezel: { name: "包镶", metals: ["goldPure", "silver925", "gold18k"], grams: 2.5, labor: 300 },
    cord: { name: "编绳/配链", metals: [], grams: 0, labor: 20 }
  },
  metals: {
    goldPure: "足金24K",
    silver925: "925银",
    gold18k: "18K金",
    platinum: "铂金PT950"
  },
  metalValues: { goldPure: 0.15, silver925: 0.03, gold18k: 0.2, platinum: 0.25 },
  gems: { diamond: "配石钻石", ruby: "红宝石", sapphire: "蓝宝石" },
  polishes: { bright: { labor: 50, value: 0.05 } },
  polishNames: { bright: "亮光" },
  backings: { open: { labor: 0, value: 0 }, closed: { labor: 100, value: 0.03 } },
  backingNames: { open: "透底", closed: "封底" }
};

let state = createInlayPreviewTesterState(catalog);
assert.equal(state.shape, "cabochon");
assert.equal(state.draft.productType, "ring");
assert.equal(state.draft.settingId, "claw");
assert.equal(state.draft.metalId, "gold18k", "tester should auto-pick a compatible visible metal");

for (const [shape, openingTpl] of Object.entries({
  cabochon: "egg",
  carving: "buddha",
  pierced: "ping",
  bangle: "bangle"
})) {
  const baseItem = buildInlayPreviewBaseItem(shape);
  assert.equal(baseItem.sourceMaterial?.placement?.openingTpl, openingTpl, `${shape} preview should use a matching real jade opening template`);
  assert.equal(baseItem.sourceMaterial?.placement?.svgSpace, true, `${shape} preview placement should be ready for opening product rendering`);
  assert.ok(Number(baseItem.sourceMaterial?.placement?.scale || 0) > 0, `${shape} preview should have a positive jade cutout scale`);
  assert.ok(baseItem.sourceMaterial?.visual?.seed, `${shape} preview should carry rough material visual data`);
}

const settingCards = settingPreviewVariants(state, catalog);
assert.deepEqual(settingCards.map((card) => card.id), ["claw", "bezel", "cord"]);
assert.equal(settingCards.find((card) => card.id === "cord").draft.metalId, null);

const metalCards = metalPreviewVariants(state, catalog);
assert.deepEqual(metalCards.map((card) => card.id), ["gold18k", "platinum"]);

state = applyInlayPreviewTesterField(state, "gemId", "ruby", catalog);
assert.equal(state.draft.gemId, "ruby");
assert.equal(state.draft.gemCount, 2, "claw rings place accents in their two shoulder seats");

const product = buildFinishPreviewProduct(buildInlayPreviewBaseItem(state.shape), state.draft);
assert.equal(product.preview, true);
assert.equal(product.productType, "ring");
assert.deepEqual(product.components.map((component) => component.type), ["jade", "mount", "accentStones"]);
assert.equal(product.components.find((component) => component.type === "jade").sourceMaterial.placement.openingTpl, "egg");
assert.equal(product.components.find((component) => component.type === "mount").metalId, "gold18k");

state = applyInlayPreviewTesterField(state, "settingId", "cord", catalog);
assert.equal(state.draft.metalId, null);
const cordProduct = buildFinishPreviewProduct(buildInlayPreviewBaseItem(state.shape), state.draft);
assert.deepEqual(cordProduct.components.map((component) => component.type), ["jade", "cord"]);
assert.equal(state.draft.gemId, null, "cord has no metal gemstone seat");

state = applyInlayPreviewTesterField(state, "shape", "bangle", catalog);
assert.equal(state.shape, "bangle");
assert.equal(state.draft.productType, "bangle");
assert.equal(state.draft.settingId, undefined);
assert.equal(state.draft.metalId, undefined);
assert.deepEqual(metalPreviewVariants(state, catalog).map((card) => card.id), [""]);

const packageSource = readFileSync("package.json", "utf8");
assert.match(packageSource, /"test:inlay-preview-tester":\s*"node scripts\/inlay-preview-tester-smoke\.mjs"/);

const workshopSource = readWorkshopSource();
assert.match(workshopSource, /(?:export )?function openInlayPreviewTester\(\)/);
assert.doesNotMatch(workshopSource, /data-action="openInlayPreviewTester"/, "preview testing has no player-facing workshop action");
assert.match(workshopSource, /data-inlay-preview-field="shape"/);
assert.match(workshopSource, /data-inlay-preview-action="select-setting"/);
assert.match(workshopSource, /data-inlay-preview-action="select-metal"/);
assert.match(workshopSource, /productCanvas\(buildFinishPreviewProduct\(/);
assert.match(workshopSource, /register\("openInlayPreviewTester"/);

const mainEntry = readFileSync("public/main.js", "utf8");
assert.match(mainEntry, /wireFeatureModules|initWorkshopModule/, "workshop module must still be wired from main bootstrap");

const shellSource = readClientShellSource();
const previewHeavySource = [
  workshopSource,
  readFileSync("public/inlay-preview-tester.js", "utf8"),
  mainEntry
].join("\n");
assert.doesNotMatch(
  previewHeavySource,
  /componentJadeCutoutMarkup\(item,\s*size\)/,
  "component jewelry should not render heavyweight exact cutouts for preview-heavy screens"
);
// Keep shell aggregate loadable (regression guard for shell split)
assert.match(shellSource, /function formatMoneyCompact|export function formatMoneyCompact/);

const stylesSource = loadResolvedStyles();
assert.match(stylesSource, /\.inlay-preview-tester-modal/);
assert.match(stylesSource, /\.inlay-preview-tester-layout/);
assert.match(stylesSource, /\.inlay-preview-card-grid/);
assert.match(stylesSource, /grid-template-rows:\s*104px auto/, "preview cards should allocate enough visual space for readable accessories");
assert.match(stylesSource, /inlay-preview-card-visual[\s\S]*width:\s*104px[\s\S]*height:\s*104px/, "preview card jewelry should be large enough to read");
assert.match(stylesSource, /\[data-theme="night"\]\s+\.inlay-preview-card/);
assert.match(stylesSource, /@media\s+\(max-width:\s*760px\)[\s\S]*\.inlay-preview-tester-layout/);

console.log("inlay-preview-tester-smoke: model ok");
