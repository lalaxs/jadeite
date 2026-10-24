import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  flatBandSegments,
  flatSliceBandPolygons,
  flatCrackSegments,
  getPolishedWindowEdgeStyle,
  getRoughDrawBox,
  jadeCanvasMarkup,
  jadeVisualSignature,
  roughOutlineSignature,
  sliceOutlineSignature
} from "../public/jade-renderer.js";
import {
  EXTRACTION_KITS,
  PRODUCT_CATEGORIES,
  productKindLabel,
  templateSizeForKind
} from "../public/jade-categories.js";

const item = {
  id: "rough-test",
  name: "白雾木那料",
  visual: {
    seed: 12345,
    shape: "round",
    skin: "#b8b7a8",
    vein: "#18a66d",
    window: true,
    crack: true,
    belt: true
  }
};

const markup = jadeCanvasMarkup("rough", item, "large");
assert.match(markup, /class="jade-canvas large"/);
assert.match(markup, /data-jade-kind="rough"/);
assert.match(markup, /data-jade-payload="/);
assert.match(markup, /aria-label="白雾木那料"/);

const productMarkup = jadeCanvasMarkup("product", { id: "product-1", name: "糯种手镯", kind: "bracelet" }, "finished");
assert.match(productMarkup, /data-jade-kind="product"/);
assert.match(productMarkup, /class="jade-canvas finished"/);

const kitMarkup = jadeCanvasMarkup("kit", { id: "kit-1", name: "手镯套件", type: "bangle", templateSize: { w: 34, h: 34 } }, "kit-template");
assert.match(kitMarkup, /data-jade-kind="kit"/);
assert.match(kitMarkup, /class="jade-canvas kit-template"/);

const consumedMarkup = jadeCanvasMarkup("kitMask", { id: "kit-1", name: "已取手镯", type: "bangle", templateSize: { w: 34, h: 34 } }, "kit-consumed");
assert.match(consumedMarkup, /data-jade-kind="kitMask"/);
assert.match(consumedMarkup, /class="jade-canvas kit-consumed"/);

for (const [kind, label] of Object.entries({
  plaque: "无字牌",
  buddhaPendant: "佛公挂件",
  guanyinPendant: "观音挂件",
  fuBeanPendant: "福豆挂件",
  gourdPendant: "葫芦挂件"
})) {
  assert.equal(productKindLabel(kind), label, `${kind} should have a product label`);
  assert.ok(PRODUCT_CATEGORIES[kind], `${kind} should be defined as a jade product category`);
  assert.ok(templateSizeForKind(kind).w > 0, `${kind} should have a template width`);
}

for (const [type, label] of Object.entries({
  plaque: "无字牌套件",
  buddhaPendant: "佛公挂件",
  guanyinPendant: "观音挂件",
  fuBeanPendant: "福豆挂件",
  gourdPendant: "葫芦挂件"
})) {
  assert.equal(EXTRACTION_KITS[type].label, label, `${type} should be available as an extraction kit`);
  const markup = jadeCanvasMarkup("kit", { id: `kit-${type}`, name: label, type, templateSize: EXTRACTION_KITS[type] }, "kit-template");
  assert.match(markup, new RegExp(`%22type%22%3A%22${type}%22`), `${type} kit markup should preserve its type`);
}

const sourceProductMarkup = jadeCanvasMarkup("product", {
  id: "product-source-1",
  name: "糯种佛公挂件",
  kind: "buddhaPendant",
  sourceMaterial: {
    roughId: "rough-test",
    visual: item.visual,
    windows: [],
    placement: { x: 42, y: 58 }
  }
}, "finished");
assert.match(sourceProductMarkup, /sourceMaterial/, "product markup should preserve source material metadata");

const payloadMatch = markup.match(/data-jade-payload="([^"]+)"/);
assert.ok(payloadMatch, "payload attribute should exist");
const decoded = JSON.parse(decodeURIComponent(payloadMatch[1]));
assert.equal(decoded.name, "白雾木那料");
assert.equal(decoded.visual.seed, 12345);

assert.equal(jadeVisualSignature(item), jadeVisualSignature(structuredClone(item)));
assert.notEqual(
  jadeVisualSignature({ id: "kit-sig", type: "bangle", templateSize: { w: 34, h: 34 } }),
  jadeVisualSignature({ id: "kit-sig", type: "cabochon", templateSize: { w: 22, h: 28 } }),
  "kit template signatures should include type and footprint so template canvas rerenders"
);

const wideBox = getRoughDrawBox(430, 122);
assert.equal(wideBox.scaleX, wideBox.scaleY, "rough draw box must preserve aspect ratio in wide cards");
assert.ok(wideBox.width < 430, "wide rough draw box should letterbox horizontally instead of stretching");
assert.equal(Math.round(wideBox.height), 122);

const tallBox = getRoughDrawBox(96, 148);
assert.equal(tallBox.scaleX, tallBox.scaleY, "rough draw box must preserve aspect ratio in tall planners");
assert.ok(tallBox.height < 148, "tall rough draw box should letterbox vertically instead of stretching");
assert.equal(Math.round(tallBox.width), 96);

assert.notEqual(
  roughOutlineSignature("round", 12345),
  roughOutlineSignature("round", 54321),
  "rough stones with the same base shape need seed-specific edges"
);

const windowEdge = getPolishedWindowEdgeStyle(430, 122);
assert.equal(windowEdge.lineWidth, 0, "polished windows should not draw an outline stroke");
assert.equal(windowEdge.alpha, 0, "polished windows should not use edge highlight alpha");

const rendererSource = readFileSync(new URL("../public/jade-renderer.js", import.meta.url), "utf8");
for (const token of [
  "drawJadeTextureField",
  "drawSoftColorBloom",
  "drawFibrousVeins",
  "drawPolishedRim",
  "drawMistWash",
  "drawNaturalCrack",
  "renderProductCanvas",
  "drawPolishedBangle"
]) {
  assert.match(rendererSource, new RegExp(`function ${token}\\b`), `jade renderer should include the art prototype layer: ${token}`);
}
assert.match(rendererSource, /createLinearGradient|createRadialGradient/, "jade renderer should support soft material transitions like the reference art");

const bands = flatBandSegments(12345, 168, 140);
assert.ok(bands.length >= 2, "rough band should be made from multiple flat segments");
assert.ok(bands.every((band) => band.points.length === 4), "each rough band segment should be a flat quadrilateral");
assert.ok(new Set(bands.map((band) => band.points.map((point) => Math.round(point.y)).join(":"))).size > 1, "rough band segments should not collapse into one repeated ribbon");

assert.notEqual(
  sliceOutlineSignature({ sourceShape: "chunk", sourceSeed: 12345, sliceIndex: 0 }),
  sliceOutlineSignature({ sourceShape: "chunk", sourceSeed: 12345, sliceIndex: 1 }),
  "neighboring slice boards should have distinct derived edges"
);

assert.notEqual(
  sliceOutlineSignature({ sourceShape: "round", sourceSeed: 12345, sliceIndex: 0 }),
  sliceOutlineSignature({ sourceShape: "long", sourceSeed: 12345, sliceIndex: 0 }),
  "slice edge profile should inherit the rough shape family"
);

const sliceBands = flatSliceBandPolygons(12345, 288, 176, [
  { cx: 54, cy: 42, rx: 24, ry: 10, angle: 22, opacity: 0.5 },
  { cx: 80, cy: 54, rx: 28, ry: 12, angle: 22, opacity: 0.45 },
  { cx: 104, cy: 48, rx: 24, ry: 10, angle: 22, opacity: 0.42 }
]);
assert.ok(sliceBands.length <= 3, "slice color zones should merge into a few continuous vein ribbons instead of repeated patches");
assert.ok(sliceBands.length >= 1, "slice color should still render at least one green vein ribbon");
assert.ok(sliceBands.every((band) => band.points.length >= 5), "slice color bands should be irregular polygons, not ellipses");
assert.ok(sliceBands.some((band) => new Set(band.points.map((point) => Math.round(point.y))).size > 2), "slice color bands should have non-horizontal jagged edges");
assert.ok(
  sliceBands.some((band) => {
    const xs = band.points.map((point) => point.x);
    return Math.max(...xs) - Math.min(...xs) > 288 * 0.62;
  }),
  "at least one slice color band should span across most of the board like a vein, not sit as a local sticker"
);

const cracks = flatCrackSegments(12345, 168, 140, 96);
assert.ok(cracks.main.length >= 5, "main crack should be a jagged polyline");
assert.ok(cracks.branches.length >= 2, "crack should include small branches instead of one single line");
assert.ok(cracks.main.some((point, index, list) => index > 0 && point.x !== list[index - 1].x), "main crack should change x as it travels");

console.log("jade renderer smoke test passed");
