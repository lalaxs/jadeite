import { readWorkshopServiceSource } from "./load-workshop-service-source.mjs";
import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFileSync } from "node:fs";
import { loadResolvedStyles } from "./load-styles.mjs";
import { productCanvas } from "../public/features/opening/opening-render.js";
import {
  EXTRACTION_KITS,
  PRODUCT_CATEGORIES,
  productKindLabel
} from "../public/jade-categories.js";
import * as productMeta from "../public/product-meta.js";
import {
  SVG_FILTER_IDS,
  JADE_OPENING_DEFS,
  KIT_LIB,
  buildOpeningStone,
  buildJadeMap,
  buildJadeMaterial,
  computeGrade,
  computeOverlaps,
  defectPenalty,
  evaluateOpeningKit,
  jadeValueFactor,
  mapOpeningKitToProductKind,
  openingGradeForQuality,
  openingPaletteForColor,
  renderJadeOpeningProductSvg,
  renderJadeOpeningSvg
} from "../public/jade-opening-engine.js";

const requiredFilterIds = [
  "jadeVar",
  "jadeMarble",
  "zoneMixA",
  "zoneMixB",
  "wasteBlur",
  "flowerTex",
  "grain",
  "colorWash",
  "crackWarp",
  "skinMottle",
  "rock",
  "scratchMask"
];

assert.deepEqual(SVG_FILTER_IDS, requiredFilterIds, "opening engine should preserve the reference SVG filter/mask IDs");
for (const id of requiredFilterIds) {
  const kind = id === "scratchMask" ? "mask" : "filter";
  assert.match(JADE_OPENING_DEFS, new RegExp(`<${kind} id="${id}"(?:\\s|>)`), `${id} should exist in SVG defs`);
}
assert.match(JADE_OPENING_DEFS, /id="jadeMaterial"/, "defs should keep the shared jadeMaterial group");
assert.match(JADE_OPENING_DEFS, /id="jadeVar"[\s\S]*color-interpolation-filters="sRGB"/, "jadeVar should render in sRGB");
assert.match(JADE_OPENING_DEFS, /id="colorWash"[\s\S]*color-interpolation-filters="sRGB"/, "colorWash should render in sRGB");
assert.doesNotMatch(JADE_OPENING_DEFS.match(/<filter id="wasteBlur"[\s\S]*?<\/filter>/)?.[0] || "", /color-interpolation-filters/, "wasteBlur should keep default linearRGB");
assert.doesNotMatch(JADE_OPENING_DEFS.match(/<filter id="rock"[\s\S]*?<\/filter>/)?.[0] || "", /color-interpolation-filters/, "rock should keep default linearRGB");

assert.deepEqual(KIT_LIB.map((kit) => kit.id), ["egg", "ping", "rect", "drop", "leaf", "bangle", "buddha"], "opening kit library should match the reference page");
assert.equal(KIT_LIB.find((kit) => kit.id === "bangle").priceMul, 1.85, "bangle should keep the high industry multiplier");
assert.ok(KIT_LIB.find((kit) => kit.id === "ping").shape.includes("clip-rule=\"evenodd\""), "ping buckle should be hollow via evenodd");
assert.ok(KIT_LIB.find((kit) => kit.id === "bangle").shape.includes("clip-rule=\"evenodd\""), "bangle should be hollow via evenodd");

assert.equal(mapOpeningKitToProductKind("egg"), "cabochon");
assert.equal(mapOpeningKitToProductKind("ping"), "peacePendant");
assert.equal(mapOpeningKitToProductKind("rect"), "plaque");
assert.equal(mapOpeningKitToProductKind("drop"), "dropPendant");
assert.equal(mapOpeningKitToProductKind("leaf"), "leafPendant");
assert.equal(mapOpeningKitToProductKind("bangle"), "bracelet");
assert.equal(mapOpeningKitToProductKind("buddha"), "buddhaPendant");
assert.equal(productKindLabel("dropPendant"), "水滴挂件");
assert.ok(PRODUCT_CATEGORIES.dropPendant, "drop pendant should be a business product category");
assert.ok(EXTRACTION_KITS.dropPendant, "drop pendant should be a server-supported extraction kit");

const stone = buildOpeningStone({ seed: 24681357, roughId: "test-rough" });
const rawSlice = { id: "opened-slice", type: "slice", materialStage: "opened", stage: "material", revealed: true,
  qualityKey: "bean", quality: "豆种", color: "灰绿", visual: { seed: 21568 }, windows: [] };
const sliceArt = productCanvas(rawSlice);
assert.match(sliceArt, /class="jade-opening-svg"/, "shared preview must retain the opened material rather than draw a generic product");
assert.doesNotMatch(sliceArt, /data-jade-kind="product"/);
assert.match(sliceArt, /id="[^"]*-roughExterior"[^>]*style="opacity:0"/, "opened slices expose the jade surface");
assert.equal(stone.jadeMap.RES, 40, "jadeMap should use the reference 40x40 grid");
assert.equal(stone.jadeMap.grid.length, 1600, "jadeMap should contain 1600 cells");
assert.ok(stone.jadeMap.grid.some((cell) => cell.waste), "deterministic test stone should include waste cells");
assert.ok(stone.material.includes("filter=\"url(#wasteBlur)\""), "waste visualization should be drawn from jadeMap cells");
assert.equal(stone.seeds.grainBaseFrequency, stone.grade.freq, "grain frequency should come from the picked water grade");

assert.equal(openingGradeForQuality("stickyIce")?.name, "糯冰");
assert.equal(openingGradeForQuality("冰种")?.name, "正冰");
assert.equal(openingPaletteForColor("帝王绿")?.name, "帝王绿");
assert.equal(openingPaletteForColor("青白")?.name, "白冰");
assert.equal(openingPaletteForColor("飘花绿")?.name, "翠绿");
const forcedLowStone = buildOpeningStone({ seed: "quality-bound", roughId: "low", qualityKey: "bean", color: "晴水" });
const forcedHighStone = buildOpeningStone({ seed: "quality-bound", roughId: "high", qualityKey: "glass", color: "晴水" });
assert.equal(forcedLowStone.grade.name, "豆种", "revealed bean quality should bind the opening grade");
assert.equal(forcedHighStone.grade.name, "玻璃种", "revealed glass quality should bind the opening grade");
assert.equal(forcedHighStone.palList[0].pal.name, "晴水", "revealed color should bind the dominant opening palette");
assert.ok(
  evaluateOpeningKit({ uid: "quality-probe", tpl: "bangle", x: 300, y: 300, rot: 0, scale: 0.96 }, forcedHighStone).price
    > evaluateOpeningKit({ uid: "quality-probe", tpl: "bangle", x: 300, y: 300, rot: 0, scale: 0.96 }, forcedLowStone).price,
  "higher revealed water grade should produce the higher cutout valuation for the same layout"
);

const manualMap = buildJadeMap(stone.palList, stone.grade, true, stone.cracks, stone.seeds);
assert.deepEqual(
  manualMap.grid.map((cell) => cell.waste),
  stone.jadeMap.grid.map((cell) => cell.waste),
  "rebuilding jadeMap from the same seeds should align visual waste and report data"
);

const material = buildJadeMaterial({
  palList: stone.palList,
  grade: stone.grade,
  hasColor: true,
  hasFlower: true,
  withWaste: true,
  cracksSvg: stone.cracksSvg,
  jadeMap: stone.jadeMap
});
for (const token of [
  `fill="${stone.palList[0].pal.base}"`,
  "url(#zoneMixA)",
  "url(#jadeVar)",
  "url(#jadeMarble)",
  "url(#crackWarp)",
  "url(#colorWash)",
  "url(#flowerTex)",
  "mix-blend-mode:screen",
  "mix-blend-mode:multiply",
  "url(#grain)",
  "url(#wasteBlur)"
]) {
  assert.ok(material.includes(token), `material should include layer token: ${token}`);
}
const glossyMaterial = buildJadeMaterial({
  palList: stone.palList,
  grade: { ...stone.grade, water: 1, gloss: 0.55, gOp: 0.04 },
  hasColor: true,
  hasFlower: true,
  withWaste: true,
  cracksSvg: stone.cracksSvg,
  jadeMap: stone.jadeMap
});
assert.ok(glossyMaterial.includes("id=\"sheenGrad\""), "glass-grade material should include the diagonal sheen highlight");
assert.ok(material.indexOf("url(#jadeVar)") < material.indexOf("url(#jadeMarble)"), "jadeVar should render before jadeMarble");
assert.ok(material.indexOf("url(#grain)") < material.indexOf("url(#wasteBlur)"), "grain should render before waste cells");

assert.equal(Math.round(jadeValueFactor(6, 1) * 100), 165);
assert.ok(jadeValueFactor(1, 0.9) > jadeValueFactor(1, 0.1), "water should independently increase value");
assert.ok(defectPenalty(0.12, 0.25) > defectPenalty(0.01, 0.05), "visible crack and waste should penalize harder");

const bangle = { uid: 1, tpl: "bangle", x: 300, y: 300, rot: 0, scale: 0.96 };
const egg = { uid: 2, tpl: "egg", x: 300, y: 230, rot: 0, scale: 1 };
const kitEval = evaluateOpeningKit(bangle, stone);
assert.ok(kitEval.total > 0, "kit evaluation should sample cells inside the real shape");
assert.ok(kitEval.price >= 0, "kit evaluation should produce a non-negative price");
assert.ok(["S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"].includes(computeGrade(kitEval, stone).letter));
assert.deepEqual([...computeOverlaps([bangle, egg])].sort(), [1, 2], "overlap detection should use true kit coverage, including hollow pieces");

const svg = renderJadeOpeningSvg(stone, {
  scratches: [{ x: 260, y: 260 }, { x: 310, y: 300 }],
  kits: [bangle],
  revealed: false
});
assert.match(svg, /<svg[^>]+viewBox="0 0 600 600"/);
const materialId = svg.match(/\bid="([^"]*jadeMaterial)"/)?.[1];
const stoneClipId = svg.match(/\bid="([^"]*stoneClip)"/)?.[1];
const scratchMaskId = svg.match(/\bid="([^"]*scratchMask)"/)?.[1];
const kitClipId = svg.match(/\bid="([^"]*kc1)"/)?.[1];
assert.ok(materialId, "rendered SVG should include a namespaced jadeMaterial id");
assert.ok(stoneClipId, "rendered SVG should include a namespaced stoneClip id");
assert.ok(scratchMaskId, "rendered SVG should include a namespaced scratchMask id");
assert.ok(kitClipId, "rendered SVG should include a namespaced kit clip id");
assert.match(svg, new RegExp(`<use href="#${materialId}" id="[^"]*jadeUse"\\/>`));
assert.match(svg, new RegExp(`<g id="[^"]*roughExterior" mask="url\\(#${scratchMaskId}\\)">`));
assert.match(svg, new RegExp(`<g id="[^"]*kitLayer" clip-path="url\\(#${stoneClipId}\\)">`));
assert.match(svg, new RegExp(`<use href="#${materialId}" transform=`), "kit preview should reuse its own namespaced jadeMaterial");

const secondStone = buildOpeningStone({ seed: 97531, roughId: "second-rough" });
const firstListSvg = renderJadeOpeningSvg(stone, { kits: [bangle], revealed: true, label: "第一块料" });
const secondListSvg = renderJadeOpeningSvg(secondStone, { kits: [{ ...bangle, uid: 1 }], revealed: true, label: "第二块料" });
const combinedSvg = `${firstListSvg}${secondListSvg}`;
const renderedIds = [...combinedSvg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateRenderedIds = [...new Set(renderedIds.filter((id, index) => renderedIds.indexOf(id) !== index))].sort();
assert.deepEqual(duplicateRenderedIds, [], "multiple rendered opening SVGs should not share DOM ids");
assert.doesNotMatch(combinedSvg, /url\(#(?:jadeVar|jadeMaterial|stoneClip|scratchMask|roughBase|rock|skinMottle|kc1)\)/, "rendered SVG references should be namespaced");
assert.doesNotMatch(combinedSvg, /href="#(?:jadeMaterial)"/, "rendered SVG href references should be namespaced");

const exactKit = { uid: "exact", tpl: "drop", x: 372, y: 246, rot: 31, scale: 0.92 };
const plannerSvg = renderJadeOpeningSvg(stone, { kits: [exactKit], revealed: true, label: "规划裁片" });
const plannerUseTransform = plannerSvg.match(/<use href="#[^"]*jadeMaterial" transform="([^"]+)"/)?.[1];
const productCutoutSvg = renderJadeOpeningProductSvg(stone, exactKit, { label: "成品裁片" });
const productUseTransform = productCutoutSvg.match(/<use href="#[^"]*jadeMaterial" transform="([^"]+)"/)?.[1];
assert.ok(plannerUseTransform, "planner kit preview should sample jadeMaterial");
assert.equal(productUseTransform, plannerUseTransform, "finished product cutout should sample the exact same material region as its planner kit");
assert.match(productCutoutSvg, /class="jade-opening-product-svg"/, "finished product cutout should render as a dedicated SVG");
assert.match(productCutoutSvg, /clip-path="url\(#.*productClip/, "finished product cutout should clip to the kit shape");
assert.match(productCutoutSvg, /viewBox="-/, "finished product cutout should use a local kit viewBox instead of the whole rough board");
assert.match(productCutoutSvg, /preserveAspectRatio="xMidYMid meet"/);
assert.doesNotMatch(productCutoutSvg, /overflow="visible"/);

assert.equal(
  typeof productMeta.resolveExactOpeningProductPlacement,
  "function",
  "product source metadata should expose a directly testable exact-placement gate"
);
const resolveExactOpeningProductPlacement = productMeta.resolveExactOpeningProductPlacement;
const placementOptions = {
  validTemplateIds: new Set(KIT_LIB.map((template) => template.id)),
  templateByKitType: { dropPendant: "drop" }
};
assert.equal(
  resolveExactOpeningProductPlacement({ visual: { seed: 1 }, placement: {} }, placementOptions),
  null,
  "an empty placement must not fabricate an exact cutout"
);
for (const placement of [
  { openingTpl: "drop", y: 48, scale: 1 },
  { openingTpl: "drop", x: 42, scale: 1 },
  { openingTpl: "drop", x: 42, y: 48 },
  { openingTpl: "drop", x: 42, y: 48, scale: 0 },
  { openingTpl: "unknown", x: 42, y: 48, scale: 1 }
]) {
  assert.equal(
    resolveExactOpeningProductPlacement({ visual: { seed: 1 }, placement }, placementOptions),
    null,
    "incomplete or unknown placement metadata must use the safe placeholder"
  );
}
assert.deepEqual(
  resolveExactOpeningProductPlacement({
    visual: { seed: 1 },
    placement: { kitType: "dropPendant", x: 42, y: 48, scale: 0.9, rot: 17 }
  }, placementOptions),
  { kitType: "dropPendant", openingTpl: "drop", x: 42, y: 48, scale: 0.9, rot: 17 },
  "a valid kit type mapping should retain the exact placement"
);

const mainEntry = readFileSync(new URL("../public/main.js", import.meta.url), "utf8");
const mainSource = readClientShellSource();
const stylesSource = loadResolvedStyles();
const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const wireSource = readFileSync(new URL("../server/boot/wire-server.js", import.meta.url), "utf8");
const workshopServiceSource = readWorkshopServiceSource();
const bootSource = `${serverSource}\n${wireSource}\n${workshopServiceSource}`;
assert.match(mainSource, /from "[^"]*jade-opening-engine\.js"/, "workshop UI should import the opening engine");
assert.match(mainSource, /function openingStoneFor\b/, "workshop UI should derive deterministic opening stones from rough items");
assert.match(mainSource, /renderJadeOpeningSvg/, "workshop boards should render the reference SVG opening view");
assert.match(mainSource, /OPENING_KIT_LIB/, "workshop kit palette should come from the reference KIT_LIB");
assert.match(mainSource, /data-opening-kit-choice/, "opening kit buttons should arm/drop the reference templates");
assert.match(mainSource, /evaluateOpeningKit/, "workshop should show grid-based valuation for planned kits");
assert.match(stylesSource, /\.jade-opening-board\b/, "styles should include a dedicated opening board shell");
assert.match(stylesSource, /\.jade-opening-svg\b/, "styles should size the migrated SVG opening scene");
assert.match(stylesSource, /\.opening-kit-choice\b/, "styles should distinguish reference kit palette buttons");
assert.match(mainSource, /function productCutoutPlaceholder\b/);
assert.match(mainSource, /sourceMaterial[\s\S]*productCutoutPlaceholder/);
assert.match(stylesSource, /\.workshop-product-preview[\s\S]*overflow:\s*hidden/);
assert.match(stylesSource, /\.jade-opening-product-svg[\s\S]*max-width:\s*100%/);
const placeholderSource = mainSource.match(/(?:export\s+)?function productCutoutPlaceholder[\s\S]*?\n}\n\n(?:export\s+)?function productCanvas/)?.[0]
  || mainSource.match(/(?:export\s+)?function productCutoutPlaceholder[\s\S]*?\n}\n\n(?:export\s+)?function componentJadeCutoutMarkup/)?.[0]
  || "";
assert.match(placeholderSource, /aria-label="\$\{label\}裁切数据缺失"/);
assert.match(placeholderSource, /aria-hidden="true"/);
assert.match(placeholderSource, /focusable="false"/);
const srOnlyRule = stylesSource.match(/\.sr-only\s*\{[^}]*\}/)?.[0] || "";
assert.match(srOnlyRule, /position:\s*absolute/);
assert.match(srOnlyRule, /width:\s*1px/);
assert.match(srOnlyRule, /height:\s*1px/);
assert.match(srOnlyRule, /clip(?:-path)?:/);
const bigProductPreviewRule = stylesSource.match(/\.ws-big-material\s*>\s*\.workshop-product-preview\s*\{[^}]*\}/)?.[0] || "";
assert.match(bigProductPreviewRule, /aspect-ratio:\s*1\s*\/\s*1/);
assert.match(bigProductPreviewRule, /max-width:\s*220px/);
assert.match(mainSource, /resolveExactOpeningProductPlacement/);
assert.match(bootSource, /jade-opening-engine\.js"/, "server should share the opening valuation engine");
assert.match(bootSource, /openingTpl/, "server should preserve the source KIT_LIB template id on extraction kits");
assert.match(bootSource, /evaluateOpeningKit/, "server should price refined products from jadeMap kit evaluation");
assert.match(bootSource, /computeOpeningGrade/, "server should store opening S+~F grade output on products");

console.log("jade opening engine smoke test passed");
