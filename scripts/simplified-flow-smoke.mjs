import { existsSync, readFileSync, statSync } from "node:fs";
import { inlaySummary } from "../public/product-meta.js";

const sampleInlaySummary = inlaySummary({
  inlay: {
    productTypeName: "戒指",
    settingName: "爪镶",
    metalName: "18K金",
    gemName: "配石钻石",
    gemCount: 2,
    polishName: "亮光",
    backingName: "透底"
  }
});
if (sampleInlaySummary !== "戒指 · 爪镶 · 18K金 · 配石钻石×2 · 亮光 · 透底") {
  throw new Error("shared inlay summary should preserve the complete finishing plan");
}

const server = readFileSync("server.js", "utf8");
const mainEntry = readFileSync("public/main.js", "utf8");
const clientModulePaths = [
  "public/auction-module.js",
  "public/workshop-module.js",
  "public/chat-module.js",
  "public/ranking-module.js",
  "public/orders-module.js",
  "public/livestream-module.js",
  "public/market-module.js",
  "public/extra-module.js"
];
const main = [
  mainEntry,
  ...clientModulePaths.map((file) => readFileSync(file, "utf8"))
].join("\n");
const workshopModule = readFileSync("public/workshop-module.js", "utf8");
const extraModule = readFileSync("public/extra-module.js", "utf8");
const ordersModule = readFileSync("public/orders-module.js", "utf8");
const marketModule = readFileSync("public/market-module.js", "utf8");
const index = readFileSync("public/index.html", "utf8");
const renderer = readFileSync("public/jade-renderer.js", "utf8");
const openingEngine = readFileSync("public/jade-opening-engine.js", "utf8");
const styles = readFileSync("public/styles.css", "utf8");
for (const [source, label] of [
  [extraModule, "collection"],
  [ordersModule, "orders"],
  [marketModule, "market"]
]) {
  if (!/inlaySummary\(/.test(source)) {
    throw new Error(`${label} should render finishing inlay metadata`);
  }
}
if (!existsSync("public/jade-categories.js")) {
  throw new Error("jade category definitions should live in public/jade-categories.js and be shared by client/server");
}
const categories = readFileSync("public/jade-categories.js", "utf8");

if (!/let activeView\s*=\s*"overview"/.test(main)) {
  throw new Error("the prototype should open the overview by default");
}
if (!/function openLocationByView/.test(main) || !/setView\(view\)/.test(main)) {
  throw new Error("the overview should expose location navigation into the workshop");
}

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

function extractFunctionBody(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  const start = match?.index ?? -1;
  if (start < 0) throw new Error(`missing function: ${name}`);
  const signatureEnd = source.indexOf(")", start);
  const open = source.indexOf("{", signatureEnd);
  if (open < 0) throw new Error(`missing function body: ${name}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`unterminated function body: ${name}`);
}

function extractBlockFrom(source, start, label) {
  if (start < 0) throw new Error(`missing block: ${label}`);
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error(`missing block body: ${label}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`unterminated block: ${label}`);
}

function extractSocketHandlerBody(source, eventName) {
  const start = source.indexOf(`socket.on("${eventName}"`);
  return extractBlockFrom(source, start, `socket handler: ${eventName}`);
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

if (!/function publicSourceMaterial\b/.test(server)) {
  throw new Error("server should sanitize product source material before public snapshots");
}

if (!/safeItem\.sourceMaterial\s*=\s*publicSourceMaterial\(safeItem\.sourceMaterial\)/.test(publicStoneBody)) {
  throw new Error("publicStone should replace raw sourceMaterial with a public source material snapshot");
}

if (/sourceMaterial\s*:\s*\{[\s\S]*windows\s*:\s*rough\.windows\s*\|\|\s*\[\]/.test(publicStoneBody)) {
  throw new Error("publicStone should not expose raw rough windows through nested sourceMaterial");
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
  [/activeWindowSelection/, "main.js should track the public window lot currently awaiting point selection"],
  [/data-window-board/, "auction rough cards should allow click-to-select window positions"],
  [/requestAuctionWindowAt/, "main.js should submit positional public window requests from the selected board point"],
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

if (!/OPENING_KIT_LIB/.test(main) || !/data-opening-kit-choice/.test(main) || !/activeDragKit/.test(main)) {
  throw new Error("main.js should use draggable reference opening kit templates on rough boards");
}

if (!/disabledReason/.test(workshopModule) || !/disabled/.test(workshopModule) || !/不兼容/.test(workshopModule)) {
  throw new Error("finish-plan selectors should keep incompatible options visible, disabled, and explain why");
}

if (!/findSafeOpeningPosition/.test(main) || !/computeOpeningOverlaps/.test(main) || /offset \* 4/.test(main) || /offset \* 3/.test(main)) {
  throw new Error("new extraction templates should be dropped through safe reference-geometry placement, not tiny overlapping offsets");
}

const expectedKitTypes = [
  "bangle",
  "cabochon",
  "peacePendant",
  "ruyiPendant",
  "leafPendant",
  "dropPendant",
  "plaque",
  "buddhaPendant",
  "guanyinPendant",
  "fuBeanPendant",
  "gourdPendant",
  "beads"
];
const extractionKitDefinitions = extractBlockFrom(categories, categories.indexOf("EXTRACTION_KITS"), "EXTRACTION_KITS");

const defaultPositionMatch = categories.match(/const KIT_DEFAULT_POSITIONS = \{([\s\S]*?)\n\};/);
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
  leafPendant: 10,
  plaque: 9,
  buddhaPendant: 9,
  guanyinPendant: 9,
  fuBeanPendant: 8,
  gourdPendant: 8,
  beads: 8
};

const templateSizes = {};
for (const type of expectedKitTypes) {
  const template = extractObjectEntry(extractionKitDefinitions, type);
  const widthMatch = template.match(/\bw:\s*(\d+)/);
  const heightMatch = template.match(/\bh:\s*(\d+)/);
  if (!widthMatch || !heightMatch) throw new Error(`${type} should define a visible template footprint`);
  templateSizes[type] = { w: Number(widthMatch[1]), h: Number(heightMatch[1]) };
}

for (const type of Object.keys(placementRadii)) {
  if (!defaultPositions[type]) throw new Error(`${type} should have a non-overlapping default position`);
}
for (const [type, position] of Object.entries(defaultPositions)) {
  const size = templateSizes[type] || { w: 28, h: 28 };
  if (
    position.x - size.w / 2 < 0 ||
    position.x + size.w / 2 > 100 ||
    position.y - size.h / 2 < 0 ||
    position.y + size.h / 2 > 100
  ) {
    throw new Error(`${type} default position should keep the whole template inside the rough board`);
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

for (const label of ["手镯套件", "蛋面套件", "平安扣挂件", "如意挂件", "叶子挂件", "水滴挂件", "无字牌套件", "佛公挂件", "观音挂件", "福豆挂件", "葫芦挂件", "珠串套件"]) {
  if (!categories.includes(label)) throw new Error(`game should define ${label}`);
}

for (const type of ["plaque", "dropPendant", "buddhaPendant", "guanyinPendant", "fuBeanPendant", "gourdPendant", "beads"]) {
  const templatePattern = new RegExp(`\\b${type}\\s*:`);
  if (!templatePattern.test(categories) || !/OPENING_KIT_LIB/.test(main) || !/EXTRACTION_KITS/.test(server)) {
    throw new Error(`${type} should be available through shared extraction kit definitions`);
  }
}

if (!/\bbeads\b/.test(categories) || !/EXTRACTION_KITS/.test(server) || !/\bbeads\b/.test(renderer)) {
  throw new Error("bead strand kit should be supported by client, server, and renderer");
}

const scratchlessWorkshopBody = extractFunctionBody(main, "renderWorkshop");
for (const token of ["scratch-board", "data-scratch-board", "SCRATCH_READY_PERCENT", "scratchReady", "刮到"]) {
  if (scratchlessWorkshopBody.includes(token)) {
    throw new Error(`workshop should temporarily skip scratch-off gating: ${token}`);
  }
}
if (!/let activeWorkshopDeviceId/.test(main) || !/let selectedWorkshopItemId/.test(main)) {
  throw new Error("workshop should track active device and selected material");
}
if (!/id="workshopRoot"/.test(index)) {
  throw new Error("workshop should render into one recipe-style root instead of three inventory panels");
}
const workshopViewHtml = index.slice(
  index.indexOf('data-view="workshop"'),
  index.indexOf('data-view="orders"')
);
if (/id="roughInventory"|id="materialInventory"|id="braceletInventory"/.test(workshopViewHtml)) {
  throw new Error("workshop HTML should not expose the old three-column inventory containers");
}
if (!/data-action="openWorkshopDevice"/.test(main) || !/data-action="startWorkshopJob"/.test(main)) {
  throw new Error("workshop should expose device entry and staged job start actions");
}
if (!/socket(?:Ref)?\.emit\("startWorkshopJob"/.test(main)) {
  throw new Error("workshop should start all device processing through the staged workshop socket event");
}
for (const token of ["opening", "carving", "finishing", "开料", "规划", "精加工", "容量", "员工", "设备"]) {
  if (!main.includes(token) && !index.includes(token)) throw new Error(`workshop device UI should include ${token}`);
}
for (const className of ["workshop-recipe-home", "workshop-recipe-card", "workshop-recipe-page", "workshop-material-grid", "workshop-material-card", "workshop-recipe-summary", "stage-chip"]) {
  if (!styles.includes(className)) throw new Error(`workshop device UI should style ${className}`);
}

if (!/function openingKitsForRender/.test(main) || !/renderJadeOpeningSvg/.test(main) || !/extracted/.test(main) || !/jadeMaterial/.test(openingEngine || "")) {
  throw new Error("main.js should render active kit templates and consumed kit masks through the SVG opening renderer");
}

const openingKitsForRenderBody = extractFunctionBody(main, "openingKitsForRender");
if (/jadeCanvasMarkup\("product"/.test(openingKitsForRenderBody)) {
  throw new Error("active extraction templates should not reuse finished-product source material previews");
}

if (!/openingTpl/.test(main) || !/scaleForOpeningKit/.test(main)) {
  throw new Error("extraction kit templates should carry opening template ids and scale so drag bounds match the visual footprint");
}

if (!/renderJadeOpeningProductSvg/.test(main)) {
  throw new Error("finished extraction products should render the exact SVG cutout from the opening material");
}
const productCanvasBody = extractFunctionBody(main, "productCanvas");
const openingProductSvgBody = extractFunctionBody(main, "openingProductSvg");
if (!/openingProductSvg/.test(productCanvasBody) || !/sourceMaterial/.test(openingProductSvgBody) || !/renderJadeOpeningProductSvg/.test(openingProductSvgBody) || !/jade-opening-product/.test(openingProductSvgBody)) {
  throw new Error("productCanvas should use the opening SVG cutout for source-material products");
}

const openingKitsBody = extractFunctionBody(main, "openingKitsForRender");
if (!/saved/.test(openingKitsBody) || !/extracted/.test(openingEngine) || !/fill="\$?\{?fill/.test(openingEngine)) {
  throw new Error("saved extraction placements should render as black consumed masks on the rough");
}

if (!/aspect-ratio:\s*1/.test(styles) || !/\.jade-opening-svg/.test(styles)) {
  throw new Error("kit placement CSS should let the SVG opening board preserve the reference coordinate aspect ratio");
}

if (/calc\(var\(--kit-[wh]\)\s*\*/.test(styles)) {
  throw new Error("kit placement CSS should avoid unsupported calc multiplication that collapses template boxes in browsers");
}

for (const token of ["templateSvg:", "<image", "<img", "kit-template-asset", "kitAssetMarkup", "/assets/template-icons/", "board-svg board-overlay rough-overlay"]) {
  if (openingKitsBody.includes(token)) {
    throw new Error(`openingKitsForRender should not render extraction kit previews through static template assets: ${token}`);
  }
}

if (/function kitShapeMarkup/.test(main) || /item\.shape/.test(main)) {
  throw new Error("main.js should not procedurally draw extraction template silhouettes");
}

for (const type of expectedKitTypes) {
  const template = extractObjectEntry(extractionKitDefinitions, type);
  if (template.includes("items:") || template.includes("shape:") || template.includes("templateSvg:") || template.includes("icon:")) {
    throw new Error(`${type} should use renderer-owned kit canvases instead of static template artwork`);
  }

  const slotCount = (template.match(/layout:/g) || []).length;
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

if (!/sourceMaterial\s*:/.test(server) || !/visual\s*:\s*rough\.visual/.test(server)) {
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

if (!/function renderKitTemplateCanvas\b/.test(renderer) || !/function renderKitMaskCanvas\b/.test(renderer) || !/function drawKitTemplatePath\b/.test(renderer)) {
  throw new Error("jade renderer should own active kit template and consumed-mask drawing");
}

if (!/function drawBangleTemplatePath\b/.test(renderer) || !/ctx\.ellipse\(cx,\s*cy,\s*outerX,\s*outerY/.test(renderer)) {
  throw new Error("bangle kit templates should draw a closed oval ring without a seam or side opening");
}

if (!/function drawPeacePendantTemplatePath\b/.test(renderer) || !/function strokePeacePendantTemplatePath\b/.test(renderer)) {
  throw new Error("peace pendant templates should use dedicated ring path and stroke helpers to avoid connector seams");
}

const peaceTemplateBody = extractFunctionBody(renderer, "drawPeacePendantTemplatePath");
if (!/ctx\.arc\(cx,\s*cy,\s*outer/.test(peaceTemplateBody) || !/ctx\.arc\(cx,\s*cy,\s*inner/.test(peaceTemplateBody) || !/return true/.test(peaceTemplateBody)) {
  throw new Error("peace pendant template should cut out the center like a bangle");
}

const peaceStrokeBody = extractFunctionBody(renderer, "strokePeacePendantTemplatePath");
if ((peaceStrokeBody.match(/ctx\.beginPath\(\)/g) || []).length < 2 || !/ctx\.arc\(cx,\s*cy,\s*outer/.test(peaceStrokeBody) || !/ctx\.arc\(cx,\s*cy,\s*inner/.test(peaceStrokeBody)) {
  throw new Error("peace pendant stroke should draw outer and inner rings separately so no right-side connector appears");
}

if (!/rgba\(0,\s*0,\s*0,\s*0\.[6-9]/.test(renderer) || !/renderKitMaskCanvas/.test(renderer)) {
  throw new Error("consumed extraction masks should visibly black out the removed kit position");
}

const kitMaskCanvasBody = extractFunctionBody(renderer, "renderKitMaskCanvas");
if (!/const evenOdd = drawKitMaskPath/.test(kitMaskCanvasBody) || !/ctx\.fill\("evenodd"\)/.test(kitMaskCanvasBody)) {
  throw new Error("consumed extraction masks should use even-odd fill so bangle masks stay donut-shaped");
}

const kitMaskPathBody = extractFunctionBody(renderer, "drawKitMaskPath");
if (!/kind === "bracelet"[\s\S]*drawBangleTemplatePath\(ctx,\s*width,\s*height\)[\s\S]*return true/.test(kitMaskPathBody)) {
  throw new Error("bangle consumed masks should be a donut ring and should not black out the bangle core");
}
if (!/kind === "peacePendant"[\s\S]*drawPeacePendantTemplatePath\(ctx,\s*width,\s*height\)[\s\S]*return true/.test(kitMaskPathBody)) {
  throw new Error("peace pendant consumed masks should be a donut ring with the center removed");
}

const bangleTemplateStart = renderer.indexOf("function drawBangleTemplatePath");
const bangleTemplateEnd = renderer.indexOf("function drawKitMaskPath");
const bangleTemplateBody = renderer.slice(bangleTemplateStart, bangleTemplateEnd);
if (bangleTemplateStart < 0 || bangleTemplateEnd < 0 || !/ctx\.ellipse/.test(bangleTemplateBody)) {
  throw new Error("bracelet templates should use a distinct closed bangle path, not the same circular ring as peace pendants");
}

if (!/function clipSourceRoughShape\b/.test(renderer) || !/clipSourceRoughShape\(ctx, item, seed, width, height\)/.test(renderer)) {
  throw new Error("source-material product cutouts should be clipped by the source rough outline");
}

if (!/function sourceSampleDimensions\b/.test(renderer) || /sourceSeed\s*=[^;]*hashString\(kind\)/.test(renderer)) {
  throw new Error("source-material products should sample from the placed rough area instead of reseeding by product kind");
}

if (!/function placementFootprint\b/.test(server) || /a\.radius \+ b\.radius/.test(server) || !/function templateWidthOnBoard\b/.test(server)) {
  throw new Error("server overlap detection should use UI-aligned template footprints instead of one circular radius per kit");
}

const renderWorkshopBody = extractFunctionBody(main, "renderWorkshop");
if (!/workshopRecipeHome/.test(renderWorkshopBody) || !/workshopRecipePage/.test(renderWorkshopBody) || !/els(?:Ref)?\.workshopRoot\.innerHTML/.test(renderWorkshopBody)) {
  throw new Error("workshop should render a recipe-style equipment home or a single equipment page into one root");
}
if (/roughInventory|materialInventory|braceletInventory/.test(workshopModule)) {
  throw new Error("workshop should no longer route the flow through the old three inventory containers");
}
if (!/workshopProcessableItems/.test(main) || !/workshopJobEstimate/.test(main) || !/workshopDeviceImpact/.test(main)) {
  throw new Error("workshop should compute processable items, estimates, and device impact text on the client");
}
if (/const startDisabled\s*=\s*device\.id === "carving" && !kits\.length/.test(main) || /data-action="startWorkshopJob"[\s\S]{0,220}\$\{startDisabled \? "disabled" : ""\}/.test(main)) {
  throw new Error("carving start should not be a disabled dead-end when kits are missing");
}
const startWorkshopJobActionBody = extractFunctionBody(workshopModule, "workshopStartJob");
if (!/device\?\.stage === "carving"/.test(startWorkshopJobActionBody) || !/showToast\("请先在明料上摆放套件。"\)/.test(startWorkshopJobActionBody)) {
  throw new Error("carving start should give a visible hint when no kit has been placed");
}
if (!/device\?\.stage === "finishing"/.test(startWorkshopJobActionBody) || !/openFinishPlanModal/.test(startWorkshopJobActionBody)) {
  throw new Error("finishing start should open the authoritative inlay plan instead of immediately emitting a job");
}
const pickWorkshopItemBody = extractFunctionBody(workshopModule, "workshopPickItem");
if (!/activeWorkshopPicker\s*=\s*null/.test(pickWorkshopItemBody) || !/renderPicker\(\)/.test(pickWorkshopItemBody)) {
  throw new Error("material picker should unmount after selecting an item so it cannot cover the start button");
}
if (!/data-action="collectBracelet"/.test(workshopModule) || !/action === "collectBracelet"/.test(mainEntry)) {
  throw new Error("finished workshop inventory should expose a working collection action");
}
const workshopRecipePageBody = extractFunctionBody(workshopModule, "workshopRecipePage");
if (!/workshopStageDrawer\(\)/.test(workshopRecipePageBody)) {
  throw new Error("the workshop page should expose its collapsed stage inventory and collection action");
}
if (!/stageDrawerOpen/.test(workshopModule) || !/addEventListener\("toggle"/.test(workshopModule)) {
  throw new Error("the workshop stage drawer should preserve its open state across server renders");
}

const idleServerExpectations = [
  [/from "\.\/public\/jade-loop\.js"/, "server should import shared idle loop rules"],
  [/ledger\s*:\s*\[\]/, "player state should include a ledger"],
  [/offlineSummary/, "player state should include offline summary data"],
  [/function recordLedger/, "server should record income and expenses through one helper"],
  [/function spendCash/, "server should spend cash through one helper"],
  [/function earnCash/, "server should earn cash through one helper"],
  [/function settleOfflinePlayer/, "server should settle offline progress when players connect"],
  [/lastSeenAt/, "server should track last seen timestamps"],
  [/makeOfflineSummary/, "server should use shared offline summary formatting"],
  [/repFromCashFlow/, "server should award reputation from qualifying cash flow"]
];

for (const [pattern, message] of idleServerExpectations) {
  if (!pattern.test(server)) throw new Error(message);
}

const idleFrontendExpectations = [
  [/offlineSummary/, "main.js should render offline summaries"],
  [/renderOfflineSummary/, "main.js should have a focused offline summary renderer"],
  [/reportSummary/, "main.js should render lightweight report summaries"]
];

for (const [pattern, message] of idleFrontendExpectations) {
  if (!pattern.test(main)) throw new Error(message);
}

const locationUiExpectations = [
  [/id="playerCard"/, "index.html should expose the topbar player status card"],
  [/id="mainNav"/, "index.html should expose the primary feature navigation"],
  [/id="homeStatusPane"/, "index.html should expose the overview status pane"],
  [/id="homeTaskPane"/, "index.html should expose the overview task pane"],
  [/id="homeCommissionPane"/, "index.html should expose the overview commission pane"],
  [/id="homeBillPane"/, "index.html should expose the overview bill pane"],
  [/id="homeMessageLog"/, "index.html should expose a homepage play log message area"],
  [/id="messageChannelTabs"/, "index.html should expose message channel tabs"],
  [/data-view="rankings"/, "index.html should expose a full leaderboard view"],
  [/id="rankingList"/, "index.html should expose the full leaderboard list"],
  [/id="rankingTabs"/, "index.html should expose leaderboard category tabs"],
  [/data-view="shop"/, "index.html should expose the shop as a separate view"],
  [/id="shopListings"/, "index.html should expose shop listings separately from player listings"],
  [/const rankBoardDefinitions\s*=/, "main.js should define leaderboard categories"],
  [/const messageChannelDefinitions\s*=/, "main.js should define expandable message channels"],
  [/id:\s*"trade",\s*label:\s*"交易"/, "message channels should include a trade channel like traditional MMO chat"],
  [/const locationDefinitions\s*=/, "main.js should define location metadata separately from feature views"],
  [/function renderOverview\b/, "main.js should render the overview panes"],
  [/function renderTasks\b/, "main.js should render overview tasks"],
  [/function renderRankingBoard\b/, "main.js should render the full leaderboard view"],
  [/function rankingRowsFor\b/, "main.js should build leaderboard rows by selected board"],
  [/function openRankBoard\b/, "main.js should navigate ranking brief clicks to the full leaderboard"],
  [/function pushMessageRow\b/, "main.js should normalize dense MMO-style message rows through one helper"],
  [/function messageSortAtFromClock\b/, "main.js should derive message sort order from HH:mm display times"],
  [/function scrollHomeMessagesToLatest\b/, "main.js should auto-scroll the message HUD to the latest message"],
  [/function renderHomeMessages\b/, "main.js should render homepage play log messages"],
  [/function homeMessageRows\b/, "main.js should build homepage messages from player/system activity"],
  [/function renderShop\b/, "main.js should render purchasable building and permit listings in the shop"],
  [/function locationGate\b/, "main.js should centralize location lock logic"],
  [/function openLocationByView\b/, "main.js should gate location view transitions through openLocationByView"],
  [/label:\s*"公盘"/, "location metadata should include the public auction"],
  [/label:\s*"交易行"/, "location metadata should include the player market"],
  [/label:\s*"商铺"/, "location metadata should include the shop"],
  [/label:\s*"订单"/, "location metadata should include orders"],
  [/label:\s*"藏品"/, "location metadata should include the collection"],
  [/label:\s*"招募"/, "location metadata should include hiring"],
  [/label:\s*"直播间"/, "location metadata should include livestream"],
  [/label:\s*"工坊"/, "location metadata should include the workshop"],
  [/locationImage/, "location metadata should retain its image keys"],
  [/workshopOwned/, "main.js should use server-owned workshop state"],
  [/livestreamPermitOwned/, "main.js should use server-owned livestream permit state"],
  [/buyAssetListing/, "main.js should emit asset purchase actions"]
];

for (const [pattern, message] of locationUiExpectations) {
  if (!pattern.test(index) && !pattern.test(main)) throw new Error(message);
}

const clickHandlerBody = extractBlockFrom(main, main.indexOf('document.body.addEventListener("click"'), "document click handler");
const openLocationByViewBody = extractFunctionBody(main, "openLocationByView");
if (!/view\s*===\s*"overview"/.test(openLocationByViewBody) || !/setView\("overview"\)/.test(openLocationByViewBody)) {
  throw new Error("openLocationByView should allow overview to open directly");
}
if (!/locationDefinitions\.find\(\(item\)\s*=>\s*item\.view\s*===\s*view\)/.test(openLocationByViewBody)) {
  throw new Error("openLocationByView should resolve the target location from its view");
}
if (!/const gate = locationGate\(location\)/.test(openLocationByViewBody)) {
  throw new Error("openLocationByView should gate resolved locations through locationGate");
}
if (!/location\?\.purchaseId/.test(openLocationByViewBody) || !/setView\("shop"\)/.test(openLocationByViewBody)) {
  throw new Error("openLocationByView should route locked purchasable locations to the shop");
}

const openLocationActionBody = extractBlockFrom(clickHandlerBody, clickHandlerBody.indexOf('if (action === "openLocation")'), "openLocation client handler");
if (!/openLocationByView\(/.test(openLocationActionBody)) {
  throw new Error("openLocation actions should navigate through openLocationByView");
}
if (/setView\(/.test(openLocationActionBody)) {
  throw new Error("openLocation actions should not call setView directly");
}

const lockedLocationActionBody = extractBlockFrom(clickHandlerBody, clickHandlerBody.indexOf('if (action === "lockedLocation")'), "lockedLocation client handler");
if (!/openLocationByView\(/.test(lockedLocationActionBody)) {
  throw new Error("lockedLocation actions should navigate through openLocationByView");
}
if (/setView\(/.test(lockedLocationActionBody)) {
  throw new Error("lockedLocation actions should not call setView directly");
}

if (!/openLocationByView\(viewLink\.dataset\.viewLink\)/.test(clickHandlerBody)) {
  throw new Error("data-view-link navigation should use openLocationByView");
}
if (/setView\(viewLink\.dataset\.viewLink\)/.test(clickHandlerBody)) {
  throw new Error("data-view-link navigation should not bypass location gating with direct setView");
}
if (!/action === "openRankBoard"/.test(clickHandlerBody) || !/rankingOpenBoard\(target\)/.test(clickHandlerBody)) {
  throw new Error("clicking a homepage ranking brief should open the matching full leaderboard");
}
if (!/action === "selectRankBoard"/.test(clickHandlerBody) || !/rankingSelectBoard\(target\)/.test(clickHandlerBody)) {
  throw new Error("full leaderboard category tabs should rerender the selected ranking");
}
if (!/action === "selectMessageChannel"/.test(clickHandlerBody) || !/chatSelectChannel\(target\.dataset\.messageChannel\)/.test(clickHandlerBody)) {
  throw new Error("homepage message channel tabs should rerender the play log");
}

const locationStyleExpectations = [
  [/\.topbar \.player-card/, "styles.css should style the player card in the topbar"],
  [/\.sidebar\s*\{[\s\S]*overflow-y:\s*auto/, "left navigation should remain independently scrollable"],
  [/\.main-nav\s*\{[\s\S]*flex-direction:\s*column/, "styles.css should arrange the desktop navigation vertically"],
  [/\.main-nav-item\.active/, "styles.css should distinguish the active feature"],
  [/\.home-tabs/, "styles.css should style the overview tabs"],
  [/\.status-rows/, "styles.css should style overview status rows"],
  [/\.rank-pills/, "styles.css should style compact overview ranking pills"],
  [/\.ranking-board/, "styles.css should style the full leaderboard page"],
  [/\.ranking-tabs/, "styles.css should style compact leaderboard category tabs"],
  [/\.ranking-row/, "styles.css should style leaderboard rows"],
  [/\.chatdock\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/, "styles.css should lay out the persistent play log dock"],
  [/\.chatdock-tabs/, "styles.css should style message channel tabs"],
  [/\.chatdock-log\s*\{[\s\S]*overflow:\s*auto/, "the play log should scroll independently"],
  [/\.chatdock-input/, "styles.css should style the play log input row"],
  [/\.message-log-row/, "styles.css should style homepage message rows"],
  [/\.message-log-row\[data-channel="world"\]/, "styles.css should color-code world-channel message rows"],
  [/\.message-log-speaker/, "styles.css should style MMO-style message speakers"],
  [/min-height:\s*26px/, "homepage message rows should have larger traditional MMO chat text"],
  [/font-size:\s*13px/, "homepage message rows should use a larger readable MMO chat font"],
  [/\.asset-listing/, "styles.css should style purchasable asset listings"]
];

for (const [pattern, message] of locationStyleExpectations) {
  if (!pattern.test(styles)) throw new Error(message);
}

const messageLogRowStyle = styles.match(/\.message-log-row\s*\{[\s\S]*?\n\}/)?.[0] || "";
if (/border-bottom\s*:/.test(messageLogRowStyle)) {
  throw new Error("homepage message rows should not use horizontal divider lines between messages");
}
const messageLogChannelStyle = styles.match(/\.message-log-channel\s*\{[\s\S]*?\n\}/)?.[0] || "";
if (/border\s*:|background\s*:|border-radius\s*:/.test(messageLogChannelStyle)) {
  throw new Error("homepage message channel labels should be plain MMORPG chat text, not boxed chips");
}

for (const location of ["auction", "market", "shop", "orders", "collection", "reports", "livestream", "workshop"]) {
  const imagePath = `public/assets/locations/${location}.jpg`;
  if (!existsSync(imagePath)) throw new Error(`location art missing: ${imagePath}`);
  if (statSync(imagePath).size < 100000) throw new Error(`location art looks too small or empty: ${imagePath}`);
  if (!styles.includes(`/assets/locations/${location}.jpg`)) throw new Error(`styles.css should use generated location art for ${location}`);
}

if (/<nav class="tabs" id="tabs"><\/nav>/.test(index)) {
  throw new Error("left sidebar should no longer expose the old tab navigation container");
}
if (!/<aside class="sidebar">[\s\S]*<nav class="main-nav" id="mainNav"/.test(index)) {
  throw new Error("the desktop shell should expose its feature navigation in the left sidebar");
}
if (/id="timeHud"/.test(index) || /class="kpi-strip"/.test(index)) {
  throw new Error("the homepage should not duplicate topbar time or resource information");
}
if (/id="playersList"/.test(index) || /id="newsList"/.test(index) || /同行排名|市场战报/.test(index)) {
  throw new Error("overview should replace broad ranking/news panels with compact status content");
}
if (/>游玩消息</.test(index)) {
  throw new Error("homepage message HUD should not show a visible 游玩消息 title above channel tabs");
}
if (/经营驾驶舱|今天去哪儿/.test(index)) {
  throw new Error("overview should not show the old top title and descriptive heading copy");
}
const renderOverviewBody = extractFunctionBody(main, "renderOverview");
if (/rank-row|news-row|playersList|newsList/.test(renderOverviewBody)) {
  throw new Error("renderOverview should not render the old broad ranking or news panels");
}
if (!/homeStatusPane\.innerHTML/.test(renderOverviewBody) || !/rank-pills/.test(renderOverviewBody) || !/status-rows/.test(renderOverviewBody)) {
  throw new Error("renderOverview should render ranking and operating status in the status pane");
}
if (!/renderHomeMessages\(\)/.test(renderOverviewBody)) {
  throw new Error("renderOverview should refresh the persistent play log");
}
const renderHomeMessagesBody = extractFunctionBody(main, "renderHomeMessages");
if (!/visibleRows\.slice\(0,\s*40\)/.test(renderHomeMessagesBody)) {
  throw new Error("homepage message log should render a dense MMO-style list of up to 40 rows");
}
if (!/visibleRows\.slice\(0,\s*40\)\.reverse\(\)/.test(renderHomeMessagesBody)) {
  throw new Error("homepage message log should render newest messages at the bottom like MMO chat");
}
if (!/scrollHomeMessagesToLatest\(\)/.test(renderHomeMessagesBody)) {
  throw new Error("homepage message log should scroll to the latest message after rendering");
}
if (!/message-log-speaker/.test(renderHomeMessagesBody) || !/data-channel="\$\{escapeHtml\(row\.channel\)\}"/.test(renderHomeMessagesBody)) {
  throw new Error("message rows should expose channel and speaker markup for MMO-style chat styling");
}
const scrollHomeMessagesToLatestBody = extractFunctionBody(main, "scrollHomeMessagesToLatest");
if (!/scrollTop\s*=\s*elsRef\.homeMessageLog\.scrollHeight/.test(scrollHomeMessagesToLatestBody)) {
  throw new Error("scrollHomeMessagesToLatest should position the message log at the latest message");
}
const homeMessageRowsBody = extractFunctionBody(main, "homeMessageRows");
for (const token of ["trade", "rumor", "reminder", "订单", "挂单", "掌柜"]) {
  if (!homeMessageRowsBody.includes(token)) {
    throw new Error(`homeMessageRows should generate richer MMO-style content including ${token}`);
  }
}
const messageSortAtFromClockBody = extractFunctionBody(main, "messageSortAtFromClock");
if (!/setHours/.test(messageSortAtFromClockBody) || !/24 \* 60 \* 60 \* 1000/.test(messageSortAtFromClockBody)) {
  throw new Error("messageSortAtFromClock should convert HH:mm clock text into a same-day timestamp with rollover handling");
}
if (!/messageSortAtFromClock\(item\.at,\s*now\s*-\s*index\s*\*\s*60000\)/.test(homeMessageRowsBody)) {
  throw new Error("news messages should sort by their displayed HH:mm timestamp instead of synthetic index timing");
}
if (!/<section class="view" data-view="reports">[\s\S]*<h3>经营账房<\/h3>/.test(index)) {
  throw new Error("reports view heading should use the location naming: 经营账房");
}

const renderMarketBody = extractFunctionBody(main, "renderMarket");
if (!/const others\s*=\s*getState\(\)\.listings\.filter/.test(renderMarketBody) || !/const mine\s*=\s*getState\(\)\.listings\.filter/.test(renderMarketBody)) {
  throw new Error("renderMarket should partition player listings into market and owned rows");
}
if (/assetListings|assetRows|buyAssetListing/.test(renderMarketBody)) {
  throw new Error("renderMarket should only render player-to-player listings, not shop assets");
}
if (!/renderMarketSection\(others,\s*mine\)/.test(renderMarketBody)) {
  throw new Error("renderMarket should delegate the selected player-market section");
}
const renderMarketGridBody = extractFunctionBody(main, "renderMarketGrid");
if (!/玩家交易行还没有挂单/.test(renderMarketGridBody)) {
  throw new Error("renderMarketGrid should show a player-market empty state when regular listings are absent");
}

const renderShopBody = extractFunctionBody(main, "renderShop");
if (!/assetListings\s*\|\|\s*\[\]/.test(renderShopBody)) {
  throw new Error("renderShop should normalize asset listings before rendering");
}
if (!/buyAssetListing/.test(renderShopBody) || !/shopListings/.test(renderShopBody)) {
  throw new Error("renderShop should render asset purchases into the shop listings container");
}

const normalizePlayerBody = extractFunctionBody(server, "normalizePlayer");
if (!/player\.cash\s*=\s*Number\.isFinite\(Number\(player\.cash\)\)\s*\?\s*Number\(player\.cash\)\s*:\s*30000/.test(normalizePlayerBody)) {
  throw new Error("normalizePlayer should coerce cash to a numeric default");
}
if (!/player\.rep\s*=\s*Number\.isFinite\(Number\(player\.rep\)\)\s*\?\s*Number\(player\.rep\)\s*:\s*0/.test(normalizePlayerBody)) {
  throw new Error("normalizePlayer should coerce rep to a numeric default");
}

if (!/function inventoryForReport\b/.test(server)) {
  throw new Error("server should build report inventory through one helper");
}
if (!/function refreshPlayerReport\b/.test(server)) {
  throw new Error("server should refresh report summaries through one helper");
}

const recordLedgerBody = extractFunctionBody(server, "recordLedger");
if (!/refreshPlayerReport\(player\)/.test(recordLedgerBody)) {
  throw new Error("recordLedger should refresh reports after ledger changes");
}

const privatePlayerSnapshotBody = extractFunctionBody(server, "privatePlayerSnapshot");
if (!/refreshPlayerReport\(player\)/.test(privatePlayerSnapshotBody)) {
  throw new Error("privatePlayerSnapshot should guarantee a current report");
}

const processPolishingJobsBody = extractFunctionBody(server, "processPolishingJobs");
if (!/(isPlayerOnline\(player\)|state\.sockets)/.test(processPolishingJobsBody) || !/continue/.test(processPolishingJobsBody)) {
  throw new Error("processPolishingJobs should skip disconnected players before consuming jobs");
}
if (!/function playerSocketCount\b/.test(server)) {
  throw new Error("server should count active sockets per player");
}
const isPlayerOnlineBody = extractFunctionBody(server, "isPlayerOnline");
if (!/playerSocketCount\(player\.id\)\s*>\s*0/.test(isPlayerOnlineBody)) {
  throw new Error("isPlayerOnline should use active socket counts");
}

const settleOfflinePlayerBody = extractFunctionBody(server, "settleOfflinePlayer");
if (!/const\s+offlineSince\s*=\s*player\.lastSeenAt\s*\|\|\s*now/.test(settleOfflinePlayerBody)) {
  throw new Error("settleOfflinePlayer should read lastSeenAt before overwriting it");
}
if (!/readyAt\s*>\s*offlineSince/.test(settleOfflinePlayerBody)) {
  throw new Error("settleOfflinePlayer should summarize only jobs completed during the offline interval");
}
if (!/refreshPlayerReport\(player,\s*now\)/.test(settleOfflinePlayerBody)) {
  throw new Error("settleOfflinePlayer should refresh reports after offline settlement");
}

const connectionBody = extractBlockFrom(server, server.indexOf('io.on("connection"'), "connection handler");
if (!/const\s+wasOnline\s*=\s*isPlayerOnline\(player\)/.test(connectionBody)) {
  throw new Error("connection should capture prior online state before registering the socket");
}
if (!/const\s+wasOnline[\s\S]*if\s*\(!wasOnline\)\s*settleOfflinePlayer\(player\)[\s\S]*state\.sockets\.set\(socket\.id,\s*playerId\)/.test(connectionBody)) {
  throw new Error("connection should settle offline progress on 0-to-1 socket transitions before registering the new socket");
}

const disconnectBody = extractSocketHandlerBody(connectionBody, "disconnect");
if (!/const\s+playerId\s*=\s*state\.sockets\.get\(socket\.id\)/.test(disconnectBody)) {
  throw new Error("disconnect should capture player id before deleting socket state");
}
if (!/state\.sockets\.delete\(socket\.id\)[\s\S]*playerSocketCount\(playerId\)\s*===\s*0[\s\S]*lastSeenAt\s*=\s*Date\.now\(\)/.test(disconnectBody)) {
  throw new Error("disconnect should update lastSeenAt only on 1-to-0 socket transitions");
}

const realtimeTickBody = extractBlockFrom(server, server.search(/setInterval\(\(\) => \{\s*processPolishingJobs\(\);\s*refreshRoughPool\(\);/), "realtime tick");
if (!/for\s*\(const player of state\.players\.values\(\)\)\s*\{[\s\S]*if\s*\(!isPlayerOnline\(player\)\)\s*continue;[\s\S]*player\.orders\s*=/.test(realtimeTickBody)) {
  throw new Error("realtime order and reputation tick should skip offline players before mutating them");
}

const auctionServerExpectations = [
  [/from "\.\/public\/jade-auction\.js"/, "server should import shared auction rules"],
  [/auction\s*:\s*null/, "state should include current auction"],
  [/function ensureAuctionRound/, "server should create auction rounds"],
  [/function settleAuctionIfDue/, "server should settle due auction rounds"],
  [/submitAuctionBid/, "server should expose submitAuctionBid"],
  [/enterAuctionForPlayer/, "server should expose paid auction entry"],
  [/publicAuctionSnapshot/, "server snapshots should use public auction snapshots"],
  [/aiBidsForRough/, "server settlement should fill missing bidders with AI"],
  [/auctionEntryFee/, "server should calculate auction entry fees through shared rules"],
  [/settleAuctionRound/, "server should settle sealed bids through shared rules"]
];

for (const [pattern, message] of auctionServerExpectations) {
  if (!pattern.test(server)) throw new Error(message);
}

if (/data-action="buyRough"/.test(main)) {
  throw new Error("main.js should no longer expose direct buyRough auction purchase buttons");
}

const auctionUiExpectations = [
  [/auctionHalls/, "main.js should render multiple public auction entrances"],
  [/auctionHistory/, "main.js should render historical auction result pages"],
  [/function renderAuctionHistory\b/, "main.js should render auction results in the history page"],
  [/enterAuction/, "auction UI should let players pay an entry fee"],
  [/selectedAuctionHallId/, "auction UI should remember which hall card the player entered from"],
  [/function enterAuctionHall\b/, "main.js should enter a selected public auction hall from its card"],
  [/本场拍卖进行中/, "auction UI should describe the live-only auction phase"],
  [/entryFee/, "main.js should render the auction entry fee"],
  [/function renderOfflineSummary/, "main.js should render offline summary cards"],
  [/function renderAuctionBidControls/, "main.js should render sealed bid controls"],
  [/data-bid-amount/, "auction cards should include bid amount inputs"],
  [/data-bid-increment/, "auction cards should include dynamic increment controls"],
  [/submitAuctionBid/, "auction controls should emit submitAuctionBid"],
  [/快捷加价/, "auction UI should label quick bid increments"],
  [/封存暗标/, "auction UI should communicate sealed bidding"],
  [/历史拍卖成功/, "auction UI should expose completed auction history"]
];

for (const [pattern, message] of auctionUiExpectations) {
  if (!pattern.test(main)) throw new Error(message);
}

for (const token of ["auctionHalls", "auctionHistoryList"]) {
  if (!index.includes(`id="${token}"`)) throw new Error(`index.html should include #${token}`);
}
if (!/data-view="auctionHistory"/.test(index) || !/id="auctionHistoryBrief"/.test(index)) {
  throw new Error("index.html should expose a separate historical auction results page");
}
const auctionViewSource = index.slice(index.indexOf('data-view="auction"'), index.indexOf('data-view="auctionHistory"'));
if (/auctionResults|auction-result-board|开标结果/.test(auctionViewSource)) {
  throw new Error("auction view should not contain the completed auction results list");
}

const renderOfflineSummaryBody = extractFunctionBody(main, "renderOfflineSummary");
if (/class="panel offline-summary"/.test(renderOfflineSummaryBody)) {
  throw new Error("offline summary should render as an unframed block, not a nested panel");
}

const renderNextActionsBody = extractFunctionBody(main, "renderNextActions");
if (/renderOfflineSummary\s*\(/.test(renderNextActionsBody)) {
  throw new Error("renderNextActions should not embed the offline summary card");
}

const submitAuctionBidBody = extractBlockFrom(clickHandlerBody, clickHandlerBody.indexOf('if (action === "submitAuctionBid")'), "submitAuctionBid client handler");
if (!/data-bid-amount/.test(submitAuctionBidBody) || /data-proxy-max/.test(submitAuctionBidBody)) {
  throw new Error("submitAuctionBid should read direct bid amount and not read proxy max inputs");
}
if (!/socket\.emit\("submitAuctionBid",\s*\{[\s\S]*roughId:\s*payload[\s\S]*amount:\s*[^,\n}]+/.test(submitAuctionBidBody) || /proxyMax/.test(submitAuctionBidBody)) {
  throw new Error("submitAuctionBid should emit roughId and direct amount only");
}

const renderAuctionBidControlsBody = extractFunctionBody(main, "renderAuctionBidControls");
if (/尚未投标|开标后揭晓结果/.test(renderAuctionBidControlsBody)) {
  throw new Error("auction bid controls should not repeat unbid explanatory status text on every lot card");
}
if (/type="number"|step="100"/.test(renderAuctionBidControlsBody)) {
  throw new Error("auction bid amount should use a plain manual text input without native number steppers");
}
if (!/inputmode="numeric"/.test(renderAuctionBidControlsBody) || !/data-bid-increment/.test(renderAuctionBidControlsBody)) {
  throw new Error("auction bid amount should support manual numeric input and quick increment buttons");
}

for (const token of ["submitAuctionBid", "快捷加价", "提交暗标", "myBids"]) {
  if (!main.includes(token)) throw new Error(`main.js should expose sealed auction UI token: ${token}`);
}

if (!/function requestAuctionWindowForPlayer/.test(server) || !/requestAuctionWindowForPlayer\(player,\s*payload\)/.test(server)) {
  throw new Error("server should phase-gate public window requests through a focused helper");
}

const renderAuctionHistoryBody = extractFunctionBody(main, "renderAuctionHistory");
const auctionResultRowBody = extractFunctionBody(main, "auctionResultRow");
if (!/getState\(\)\.auctionHistory/.test(renderAuctionHistoryBody) || !/result\.roughName/.test(auctionResultRowBody)) {
  throw new Error("auction history should render stored result rough names from historical rounds");
}
if (!/auctionHistoryList/.test(renderAuctionHistoryBody) || !/历史拍卖成功/.test(main)) {
  throw new Error("auction history should render completed auction results in its own list");
}

const renderAuctionBody = extractFunctionBody(main, "renderAuction");
const renderAuctionSource = main.slice(main.indexOf("function renderAuction()"), main.indexOf("function renderWorkshop"));
const renderAuctionLotCardBody = extractFunctionBody(main, "renderAuctionLotCard");
if (/resultForRough\(rough\.id\)|开标：/.test(renderAuctionLotCardBody)) {
  throw new Error("auction lot cards should not show completed auction result text in the active bidding list");
}
if (/renderAuctionResults/.test(renderAuctionSource) || /auctionResults/.test(renderAuctionSource)) {
  throw new Error("renderAuction should not render completed auction results in the active auction page");
}
const renderAuctionHallsBody = extractFunctionBody(main, "renderAuctionHalls");
if (!/data-action="enterAuctionHall"/.test(renderAuctionHallsBody) || !/auction-hall-card/.test(renderAuctionHallsBody) || !/auction-hall-art/.test(renderAuctionHallsBody)) {
  throw new Error("auction hall list should render image-led entrance cards that directly enter halls");
}
if (!/selectedHall/.test(renderAuctionHallsBody) || !/elsRef\.auctionHalls\.innerHTML\s*=\s*""/.test(renderAuctionHallsBody)) {
  throw new Error("auction hall list should be hidden while a selected public auction page is open");
}
if (!/action === "enterAuctionHall"/.test(clickHandlerBody) || !/enterAuctionHall\(payload\)/.test(clickHandlerBody)) {
  throw new Error("clicking an auction hall entrance should enter with one click");
}
if (!/action === "openAuctionHistory"/.test(clickHandlerBody) || !/setView\("auctionHistory"\)/.test(clickHandlerBody)) {
  throw new Error("auction history should open as a separate page from the auction hall page");
}
if (!/function backAuctionHalls\b/.test(main) || !/action === "backAuctionHalls"/.test(clickHandlerBody) || !/backAuctionHalls\(\)/.test(clickHandlerBody)) {
  throw new Error("selected auction hall pages should provide a back action to the hall list");
}
const enterAuctionHallBody = extractFunctionBody(main, "enterAuctionHall");
if (!/socketRef\.emit\("enterAuction",\s*\{\s*hallId\s*\}/.test(enterAuctionHallBody)) {
  throw new Error("enterAuctionHall should pay entry through enterAuction immediately");
}
if (!/!auction\?\.entered/.test(renderAuctionSource)) {
  throw new Error("renderAuction should branch before rendering current lots until the player enters");
}
if (!/const selectedHall = selectedAuctionHall\(\)/.test(renderAuctionSource) || !/!selectedHall/.test(renderAuctionSource)) {
  throw new Error("renderAuction should not render lot cards until a hall detail page is selected");
}
if (!/selectedHall\.id !== auction\?\.hallId/.test(renderAuctionSource)) {
  throw new Error("renderAuction should only show lots for the selected active auction hall");
}
if (/state\.roughPool/.test(renderAuctionSource)) {
  throw new Error("renderAuction should not fall back to the global rough pool before auction entry");
}
if (!/auction-lot-grid/.test(renderAuctionSource) || !/elsRef\.roughPool\.innerHTML\s*=\s*pageBody/.test(renderAuctionSource)) {
  throw new Error("renderAuction should render entered lots in the selected public auction area");
}
if (/els\.roughPool\.innerHTML\s*=\s*roughs\.map/.test(renderAuctionSource)) {
  throw new Error("renderAuction should not append raw lot cards directly under the public auction entrance list");
}
if (/auction-entry-prompt|入场后查看本场料子/.test(renderAuctionSource)) {
  throw new Error("renderAuction should show only public auction hall cards before entry, not an extra lot-list prompt card");
}
if (!/auction-round-hero/.test(renderAuctionSource) || !/auction-round-clock/.test(renderAuctionSource)) {
  throw new Error("renderAuction should render a prominent current round timer above the auction entry cards");
}
if (!/auctionRoundLabel\(\)/.test(renderAuctionSource)) {
  throw new Error("auction round hero should identify the current round, not a selected public hall");
}
if (/auction\?\.hallLabel|\|\|\s*"新手公盘"/.test(renderAuctionSource)) {
  throw new Error("auction round hero should not display a specific public hall label");
}
if (!/id="auctionBrief"[\s\S]*id="auctionHalls"/.test(index)) {
  throw new Error("auction round timer should appear above the public auction hall card list");
}
if (!/\.auction-round-hero/.test(styles) || !/\.auction-round-clock/.test(styles)) {
  throw new Error("styles.css should make the current auction round timer visually prominent");
}
if (!/\.auction-hall-card/.test(styles) || !/var\(--auction-hall-image\)/.test(styles) || !styles.includes('url("/assets/locations/auction.jpg")')) {
  throw new Error("styles.css should style auction hall entrances like image-led location cards");
}
if (!/\.auction-hall-enter-btn/.test(styles) || !/min-height:\s*48px/.test(styles)) {
  throw new Error("auction hall card entry call-to-action should be visually prominent");
}
if (!/\.auction-lot-grid/.test(styles)) {
  throw new Error("styles.css should style the selected public auction lot grid");
}
if (!/\.auction-history-list/.test(styles) || !/\.auction-history-card/.test(styles)) {
  throw new Error("styles.css should style the separate historical auction results page");
}
const auctionHallCardStyle = styles.match(/\.auction-hall-card\s*\{[\s\S]*?\n\}/)?.[0] || "";
const auctionHallCardHoverStyle = styles.match(/\.auction-hall-card:hover\s*\{[\s\S]*?\n\}/)?.[0] || "";
if (/background\s*:|background-image\s*:/.test(auctionHallCardHoverStyle) || /transition:\s*[^;]*background/.test(auctionHallCardStyle)) {
  throw new Error("auction hall card hover should not swap background layers because that causes image flicker");
}

if (!/canRequestWindow\s*=\s*currentAuctionPhase\(auction\)\s*===\s*"live"/.test(main) || !/const canWin\s*=\s*canOpenWindow\(rough\.id\)/.test(main) || !/data-action="startWindow"[\s\S]*canWin\s*\?\s*""\s*:\s*"disabled"/.test(main)) {
  throw new Error("main.js should disable public window requests outside live auction rounds");
}

if (/function windowTargetFor|function setWindowTarget|auctionWindowTargets|确认开窗/.test(main)) {
  throw new Error("auction window selection should not store a pending marker for a second confirmation step");
}

const requestWindowBody = extractBlockFrom(clickHandlerBody, clickHandlerBody.indexOf('if (action === "requestWindow")'), "requestWindow client handler");
if (!/startWindowSelection\(payload\)/.test(requestWindowBody) || !/请选择开窗位置/.test(requestWindowBody)) {
  throw new Error("requestWindow should first put the lot into point-selection mode when no point has been chosen");
}
if (/socket\.emit\("requestWindow"/.test(requestWindowBody)) {
  throw new Error("requestWindow button should not submit a second confirmation after point selection");
}
const windowBoardBody = extractBlockFrom(clickHandlerBody, clickHandlerBody.indexOf('const windowBoard = event.target.closest("[data-window-board]")'), "window board click handler");
if (!/requestAuctionWindowAt\(roughId,\s*point\.x,\s*point\.y\)/.test(windowBoardBody)) {
  throw new Error("clicking a selected window point should immediately submit the paid window request");
}
const requestAuctionWindowAtBody = extractFunctionBody(main, "requestAuctionWindowAt");
if (!/socketRef\.emit\("requestWindow",\s*\{[\s\S]*roughId[\s\S]*x:\s*point\.x[\s\S]*y:\s*point\.y/.test(requestAuctionWindowAtBody)) {
  throw new Error("requestAuctionWindowAt should submit the selected public window point immediately");
}
if (!/activeWindowSelection\s*=\s*null/.test(requestAuctionWindowAtBody)) {
  throw new Error("window point submission should clear selection state immediately");
}

const auctionStoneBoardBody = extractFunctionBody(main, "auctionStoneBoard");
if (!/auctionStoneSizeClass\(rough\)/.test(auctionStoneBoardBody)) {
  throw new Error("auction stone boards should size lots by mass");
}
if (!/function auctionStoneSizeClass/.test(main) || !/auction-stone-small/.test(main) || !/auction-stone-large/.test(main)) {
  throw new Error("main.js should expose mass-based auction stone size classes");
}
if (/expertClueChips\(rough\)/.test(renderAuctionSource) || /风险\s*\$\{rough\.risk/.test(renderAuctionSource) || /占现金/.test(renderAuctionSource)) {
  throw new Error("auction rough cards should use compact lot information without expert chips, risk percentages, or cash share text");
}

const productionExpectations = [
  [/jobs\s*:\s*\[\]/, "player state should include staged production jobs"],
  [/startProductionJob/, "server should expose startProductionJob"],
  [/completeProductionJob/, "server should complete staged production jobs"],
  [/productionDuration/, "server should use shared production durations"],
  [/粗加工台/, "UI should show the opening device stage"],
  [/套件雕刻台/, "UI should show the carving device stage"],
  [/精加工抛光台/, "UI should show the finishing device stage"],
  [/加工中/, "workshop should label active device jobs separately from inventory"]
];

for (const [pattern, message] of productionExpectations) {
  if (!pattern.test(server) && !pattern.test(main)) throw new Error(message);
}

const liveReportExpectations = [
  [/livestreamJobs\s*:\s*\[\]/, "player state should track livestream jobs"],
  [/scheduleLivestream/, "server should expose scheduleLivestream"],
  [/processLivestreamJobs/, "server should process due livestream jobs"],
  [/livestreamOutcome/, "server should use shared livestream outcomes"],
  [/reportSummary/, "server and client should use report summaries"],
  [/直播卖货/, "navigation should include livestream page"],
  [/经营账房/, "navigation should include report page"],
  [/autoConservative/, "UI should expose conservative auto livestream mode"],
  [/autoBalanced/, "UI should expose balanced auto livestream mode"],
  [/autoAggressive/, "UI should expose aggressive auto livestream mode"]
];

for (const [pattern, message] of liveReportExpectations) {
  if (!pattern.test(server) && !pattern.test(main)) throw new Error(message);
}

const renderLivestreamBody = extractFunctionBody(main, "renderLivestream");
if (!/livestreamHistory/.test(renderLivestreamBody)) {
  throw new Error("livestream page should render recent livestream history");
}
if (/\]\.join\(""\)\s*\|\|\s*empty\("暂无可直播成品。"\)[\s\S]*livestreamHistory/.test(renderLivestreamBody)) {
  throw new Error("livestream page should not show the empty product state when history exists");
}

console.log("Simplified rough-to-bracelet flow checks passed");
