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

function extractFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
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
if (!/const\s+wasOnline[\s\S]*state\.sockets\.set\(socket\.id,\s*playerId\)[\s\S]*if\s*\(!wasOnline\)\s*settleOfflinePlayer\(player\)/.test(connectionBody)) {
  throw new Error("connection should settle offline progress only on 0-to-1 socket transitions");
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
  [/publicAuctionSnapshot/, "server snapshots should use public auction snapshots"],
  [/aiBidsForRough/, "server settlement should fill missing bidders with AI"],
  [/bidDeposit/, "server should calculate auction deposits through shared rules"],
  [/settleAuctionRound/, "server should settle sealed bids through shared rules"]
];

for (const [pattern, message] of auctionServerExpectations) {
  if (!pattern.test(server)) throw new Error(message);
}

if (/data-action="buyRough"/.test(main)) {
  throw new Error("main.js should no longer expose direct buyRough auction purchase buttons");
}

const auctionUiExpectations = [
  [/function renderOfflineSummary/, "main.js should render offline summary cards"],
  [/function renderAuctionBidControls/, "main.js should render sealed bid controls"],
  [/data-bid-amount/, "auction cards should include bid amount inputs"],
  [/data-proxy-max/, "auction cards should include proxy max inputs"],
  [/submitAuctionBid/, "auction controls should emit submitAuctionBid"],
  [/代理上限/, "auction UI should label proxy bidding"],
  [/密封投标/, "auction UI should communicate sealed bidding"],
  [/开标/, "auction UI should show settlement language"]
];

for (const [pattern, message] of auctionUiExpectations) {
  if (!pattern.test(main)) throw new Error(message);
}

const renderOfflineSummaryBody = extractFunctionBody(main, "renderOfflineSummary");
if (/class="panel offline-summary"/.test(renderOfflineSummaryBody)) {
  throw new Error("offline summary should render as an unframed block, not a nested panel");
}

const renderNextActionsBody = extractFunctionBody(main, "renderNextActions");
if (/renderOfflineSummary\s*\(/.test(renderNextActionsBody)) {
  throw new Error("renderNextActions should not embed the offline summary card");
}

const clickHandlerBody = extractBlockFrom(main, main.indexOf('document.body.addEventListener("click"'), "document click handler");
const submitAuctionBidBody = extractBlockFrom(clickHandlerBody, clickHandlerBody.indexOf('if (action === "submitAuctionBid")'), "submitAuctionBid client handler");
if (!/data-bid-amount/.test(submitAuctionBidBody) || !/data-proxy-max/.test(submitAuctionBidBody)) {
  throw new Error("submitAuctionBid should read both bid amount and proxy max inputs");
}
if (!/socket\.emit\("submitAuctionBid",\s*\{[\s\S]*roughId:\s*payload[\s\S]*amount:\s*[^,\n]+[\s\S]*proxyMax:\s*[^,\n}]+/.test(submitAuctionBidBody)) {
  throw new Error("submitAuctionBid should emit roughId, amount, and proxyMax");
}

for (const token of ["submitAuctionBid", "代理上限", "提交暗标", "myBids"]) {
  if (!main.includes(token)) throw new Error(`main.js should expose sealed auction UI token: ${token}`);
}

if (!/function requestAuctionWindowForPlayer/.test(server) || !/requestAuctionWindowForPlayer\(player,\s*payload\)/.test(server)) {
  throw new Error("server should phase-gate public window requests through a focused helper");
}

if (!/canRequestWindow\s*=\s*auction\?\.phase\s*===\s*"bidding"/.test(main) || !/data-action="requestWindow"[\s\S]*!canRequestWindow/.test(main)) {
  throw new Error("main.js should disable public window requests outside auction bidding");
}

const productionExpectations = [
  [/jobs\s*:\s*\[\]/, "player state should include staged production jobs"],
  [/startProductionJob/, "server should expose startProductionJob"],
  [/completeProductionJob/, "server should complete staged production jobs"],
  [/productionDuration/, "server should use shared production durations"],
  [/粗加工/, "UI should show rough processing stage"],
  [/精加工/, "UI should show refine processing stage"],
  [/镶嵌/, "UI should show inlay processing stage"],
  [/加工任务/, "workshop should label the active production queue separately from rough inventory"]
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
  [/经营报告/, "navigation should include report page"],
  [/autoConservative/, "UI should expose conservative auto livestream mode"],
  [/autoBalanced/, "UI should expose balanced auto livestream mode"],
  [/autoAggressive/, "UI should expose aggressive auto livestream mode"]
];

for (const [pattern, message] of liveReportExpectations) {
  if (!pattern.test(server) && !pattern.test(main)) throw new Error(message);
}

console.log("Simplified rough-to-bracelet flow checks passed");
