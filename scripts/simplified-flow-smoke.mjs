import { readFileSync } from "node:fs";

const server = readFileSync("server.js", "utf8");
const main = readFileSync("public/main.js", "utf8");
const renderer = readFileSync("public/jade-renderer.js", "utf8");

function extractObjectEntry(source, key) {
  const start = source.indexOf(`${key}:`);
  if (start < 0) throw new Error(`missing object entry: ${key}`);
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error(`missing object body: ${key}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`unterminated object entry: ${key}`);
}

const serverExpectations = [
  [/productMatchesOrder/, "server should use shared product/order matching rules"],
  [/makeExpertClues/, "server should attach expert appraisal clues to rough stones"],
  [/expertClues/, "rough stones should expose expert clue chips"],
  [/normalizeWindowPayload/, "server should normalize positional public window requests"],
  [/requestWindow/, "server should support public paid auction windows"],
  [/acceptedKinds/, "orders should define accepted product kinds"],
  [/preferredKinds/, "orders should define preferred product kinds"],
  [/tasteTags/, "orders should carry customer taste tags"],
  [/startPolish/, "server should support full-stone polishing after purchase"],
  [/extractFromRough/, "server should extract bracelets directly from a polished rough"],
  [/polishingJobs/, "player state should track polishing jobs instead of cutting jobs"],
  [/OPEN_WINDOW_RATE/, "window fee should be configured as a percentage of current rough price"]
];

for (const [pattern, message] of serverExpectations) {
  if (!pattern.test(server)) throw new Error(message);
}

const publicStoneStart = server.indexOf("function publicStone");
const publicListingStart = server.indexOf("function publicListing");
const publicStoneBody = server.slice(publicStoneStart, publicListingStart);
if (!/function publicWindowReveal\b/.test(server)) {
  throw new Error("server should whitelist public window reveal fields");
}

if (/windows:\s*item\.windows\s*\|\|\s*\[\]/.test(publicStoneBody)) {
  throw new Error("publicStone masked visual should not expose raw item windows");
}

const forbiddenClientFlow = [
  "cutAnglePlanner",
  "data-angle-slider",
  "startCut",
  "cutSlice",
  "splitSlice",
  "data-slice-board"
];

for (const token of forbiddenClientFlow) {
  if (main.includes(token)) throw new Error(`main.js should not expose old cut/slice flow token: ${token}`);
}

if (!/data-rough-board/.test(main) || !/extractFromRough/.test(main)) {
  throw new Error("main.js should let players place bracelets directly on rough boards");
}

const frontendExpertExpectations = [
  [/from "\.\/jade-rules\.js"/, "main.js should import shared expert rules"],
  [/auctionWindowTargets/, "main.js should track selected public window positions"],
  [/data-window-board/, "auction rough cards should allow click-to-select window positions"],
  [/requestWindow", \{ roughId: payload/, "requestWindow should emit a positional payload"],
  [/expertClueChips/, "auction cards should render expert clue chips"],
  [/placementAnalysisRows/, "workshop should render extraction placement analysis"],
  [/productMatchesOrder/, "order matching should use shared product rules"],
  [/productOrderFitReasons/, "orders should explain why a product fits"],
  [/liveSaleRange/, "finished products should show expected livestream range"],
  [/routeRecommendation/, "finished products should recommend a sales route"]
];

for (const [pattern, message] of frontendExpertExpectations) {
  if (!pattern.test(main)) throw new Error(message);
}

if (!/KIT_TEMPLATES/.test(main) || !/data-kit-choice/.test(main) || !/activeDragKit/.test(main)) {
  throw new Error("main.js should use draggable extraction kit templates on rough boards");
}

if (!/KIT_DEFAULT_POSITIONS/.test(main) || /offset \* 4/.test(main) || /offset \* 3/.test(main)) {
  throw new Error("new extraction templates should be dropped on distinct default positions, not tiny overlapping offsets");
}

const defaultPositionMatch = main.match(/const KIT_DEFAULT_POSITIONS = \{([\s\S]*?)\n\};/);
if (!defaultPositionMatch) {
  throw new Error("default extraction positions should be keyed by kit type so mixed kits do not overlap");
}
const defaultPositions = {};
for (const match of defaultPositionMatch[1].matchAll(/(\w+):\s*\{\s*x:\s*(\d+),\s*y:\s*(\d+)\s*\}/g)) {
  defaultPositions[match[1]] = { x: Number(match[2]), y: Number(match[3]) };
}
const placementRadii = {
  bangle: 14.2,
  cabochon: 7,
  peacePendant: 12,
  ruyiPendant: 11,
  leafPendant: 10
};
for (const type of Object.keys(placementRadii)) {
  if (!defaultPositions[type]) throw new Error(`${type} should have a non-overlapping default position`);
}
for (const [type, position] of Object.entries(defaultPositions)) {
  if (position.x < 16 || position.x > 84 || position.y < 16 || position.y > 84) {
    throw new Error(`${type} default position should stay inside the rough board drag bounds`);
  }
}
const defaultTypes = Object.keys(placementRadii);
for (let i = 0; i < defaultTypes.length; i += 1) {
  for (let j = i + 1; j < defaultTypes.length; j += 1) {
    const a = defaultPositions[defaultTypes[i]];
    const b = defaultPositions[defaultTypes[j]];
    const minDistance = placementRadii[defaultTypes[i]] + placementRadii[defaultTypes[j]] + 2;
    if (Math.hypot(a.x - b.x, a.y - b.y) < minDistance) {
      throw new Error(`${defaultTypes[i]} and ${defaultTypes[j]} default positions overlap`);
    }
  }
}

for (const label of ["手镯套件", "蛋面套件", "平安扣挂件", "如意挂件", "叶子挂件"]) {
  if (!main.includes(label)) throw new Error(`main.js should expose ${label}`);
}

for (const label of ["无字牌套件", "佛公挂件", "观音挂件", "福豆挂件", "葫芦挂件", "珠串套件"]) {
  if (main.includes(label) || server.includes(label)) {
    throw new Error(`${label} should be removed from client and server extraction options`);
  }
}

for (const type of ["plaque", "buddhaPendant", "guanyinPendant", "fuBeanPendant", "gourdPendant", "beads"]) {
  const templatePattern = new RegExp(`\\b${type}\\s*:`);
  if (templatePattern.test(main) || templatePattern.test(server)) {
    throw new Error(`${type} should not be available as an extraction kit template`);
  }
}

if (/\bbeads\b/.test(main) || /\bbeads\b/.test(server)) {
  throw new Error("bead strand kit should be removed from client and server extraction options");
}

const expectedKitTypes = [
  "bangle",
  "cabochon",
  "peacePendant",
  "ruyiPendant",
  "leafPendant"
];

if (!/function kitPreviewCanvas/.test(main) || !/jadeCanvasMarkup\("product"/.test(main) || !/sourceMaterial/.test(main) || !/kit-board-overlay/.test(main)) {
  throw new Error("main.js should render extraction kit previews as source-material product canvases");
}

if (!/preview:\s*true/.test(main) || !/templateSize:\s*\{\s*w:\s*template\.w,\s*h:\s*template\.h\s*\}/.test(main)) {
  throw new Error("extraction kit previews should carry template size so material sampling matches the placed kit area");
}

for (const token of ["templateSvg:", "<svg", "<image", "<img", "kit-template-asset", "kitAssetMarkup", "/assets/template-icons/", "board-svg board-overlay rough-overlay"]) {
  if (main.includes(token)) {
    throw new Error(`main.js should not render extraction kit previews through static template assets: ${token}`);
  }
}

if (/function kitShapeMarkup/.test(main) || /item\.shape/.test(main)) {
  throw new Error("main.js should not procedurally draw extraction template silhouettes");
}

for (const type of expectedKitTypes) {
  const template = extractObjectEntry(main, type);
  if (template.includes("items:") || template.includes("shape:") || template.includes("templateSvg:") || template.includes("icon:")) {
    throw new Error(`${type} should use source-material canvas previews instead of static template artwork`);
  }

  const serverKit = extractObjectEntry(server, type);
  const slotCount = (serverKit.match(/layout:/g) || []).length;
  if (slotCount !== 1) {
    throw new Error(`${type} extraction kit should create exactly one product slot, found ${slotCount}`);
  }
}

if (/<text[^>]*>[\s\S]*template\.short/.test(main) || /<text[^>]*>[\s\S]*kit\.saved/.test(main)) {
  throw new Error("rough kit overlays should not draw visible text labels inside templates");
}

if (!/normalizeExtractionKits/.test(server) || !/expandKitPlacements/.test(server) || !/kitProductMeta/.test(server)) {
  throw new Error("server should normalize extraction kits and expand them into product outputs");
}

if (!/sourceMaterial\s*:/.test(server) || !/visual\s*:\s*rough\.visual/.test(server) || !/windows\s*:\s*rough\.windows/.test(server)) {
  throw new Error("products extracted from polished rough should carry source material data for cutout rendering");
}

if (!/templateSize\s*=\s*\{\s*w:\s*template\.w,\s*h:\s*template\.h\s*\}/.test(server)) {
  throw new Error("server should preserve extraction template size on finished products for matching material sampling");
}

if (!/a\.kitId && a\.kitId === b\.kitId/.test(server)) {
  throw new Error("server overlap detection should allow pieces within the same kit");
}

if (!/masked/.test(renderer) || !/drawMaskedRough/.test(renderer) || !/drawWindowReveals/.test(renderer)) {
  throw new Error("jade renderer should support masked rough display and public window reveals");
}

if (!/function renderSourceMaterialProductCanvas\b/.test(renderer) || !/function drawSourceMaterialTexture\b/.test(renderer) || !/sourceMaterial/.test(renderer)) {
  throw new Error("jade renderer should render finished products as cutouts from their source rough material");
}

const braceletPathStart = renderer.indexOf('if (kind === "bracelet")');
const peacePathStart = renderer.indexOf('if (kind === "peacePendant")');
const braceletPathBody = renderer.slice(braceletPathStart, peacePathStart);
if (braceletPathStart < 0 || peacePathStart < 0 || !/ctx\.ellipse/.test(braceletPathBody)) {
  throw new Error("bracelet templates should use a distinct oval bangle path, not the same circular ring as peace pendants");
}

if (!/const isPreview = Boolean\(item\?\.preview\)/.test(renderer) || !/if \(!isPreview\) drawProductCarvingLines/.test(renderer)) {
  throw new Error("source-material kit previews should keep the cutout outline but skip carving lines and shared highlight arcs");
}

if (!/ctx\.globalAlpha = isPreview \? 0\.[0-9]+ : 1/.test(renderer)) {
  throw new Error("kit previews should render the sampled material translucently over the rough");
}

if (!/function clipSourceRoughShape\b/.test(renderer) || !/clipSourceRoughShape\(ctx, item, seed, width, height\)/.test(renderer)) {
  throw new Error("kit previews should be clipped by the source rough outline so masks do not show outside the stone");
}

if (!/function sourceSampleDimensions\b/.test(renderer) || /sourceSeed\s*=[^;]*hashString\(kind\)/.test(renderer)) {
  throw new Error("source-material products should sample from the placed rough area instead of reseeding by product kind");
}

if (!/function placementFootprint\b/.test(server) || /a\.radius \+ b\.radius/.test(server)) {
  throw new Error("server overlap detection should use template footprints instead of one circular radius per kit");
}

console.log("Simplified rough-to-bracelet flow checks passed");
