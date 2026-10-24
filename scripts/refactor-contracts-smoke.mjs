import { readClientShellSource } from "./load-client-shell.mjs";
/**
 * Phase-0 refactor contract freeze: socket event names + snapshot keys must stay stable
 * while modules are relocated. UI/gameplay behavior is not asserted here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
const socketHandlersSource = readFileSync("server/shell/socket-handlers.js", "utf8");
const socketCommandSources = [
  "server/shell/commands/mining-commands.js",
  "server/shell/commands/blackmarket-commands.js",
  "server/shell/commands/commerce-commands.js",
  "server/shell/commands/progression-commands.js",
  "server/shell/commands/debug-commands.js"
].map((file) => readFileSync(file, "utf8")).join("\n");
const snapshotServiceSource = readFileSync("server/services/snapshot-service.js", "utf8");
const mainEntry = readFileSync("public/main.js", "utf8");
const mainSource = readClientShellSource();
const indexHtml = readFileSync("public/index.html", "utf8");
const snapshotCombined = `${bootSource}\n${snapshotServiceSource}`;
const socketCombined = `${bootSource}\n${socketHandlersSource}\n${socketCommandSources}`;

const SOCKET_EVENTS = [
  "setName",
  "submitAuctionBid",
  "joinAuction",
  "enterAuction",
  "ackAuctionSettle",
  "ackLivestreamSettle",
  "buyRough",
  "requestWindow",
  "startPolish",
  "refreshRecruitCandidates",
  "recruitWorker",
  "dismissWorker",
  "miningTrainMiner",
  "miningCareMiner",
  "miningResolveMinerRetention",
  "miningFormMentorship",
  "miningEndMentorship",
  "miningSpecializeMiner",
  "miningRenewMinerContract",
  "miningPromoteMiner",
  "miningResolveIncident",
  "buyWorkshopDevice",
  "repairWorkshopDevice",
  "startWorkshopJob",
  "assignWorkshopWorker",
  "startCut",
  "cutRough",
  "extractFromRough",
  "cutSlice",
  "splitSlice",
  "craftBracelet",
  "collectBracelet",
  "returnCollectionItem",
  "startLivestreamRoom",
  "replenishLivestreamRoom",
  "closeLivestreamRoom",
  "buyLivestreamRoomItem",
  "scheduleLivestream",
  "livestreamSell",
  "completeOrder",
  "listItem",
  "buyAssetListing",
  "buyMaterialPack",
  "getMaterialHistory",
  "buyListing",
  "markInventorySeen",
  "withdrawListing",
  "refreshOrders",
  "refreshOrderSlot",
  "collectPayout",
  "bmListItem",
  "bmBuyListing",
  "bmWithdrawListing",
  "bmCollectPayout",
  "bmOpenStall",
  "bmCloseStall",
  "bmBuyBlindbox",
  "bmSettleBlindDraw",
  "bmSubmitRating",
  "postWant",
  "cancelWant",
  "applyWant",
  "withdrawWantOffer",
  "settleWant",
  "task:claim",
  "task:reset",
  "achievement:claim",
  "debugGrant",
  "debugSpawnFinished",
  "sendWorldChat",
  "disconnect"
];

for (const eventName of SOCKET_EVENTS) {
  assert.match(
    socketCombined,
    new RegExp(`socket\\.on\\("${eventName.replace(":", "\\:")}"`),
    `frozen socket event missing: ${eventName}`
  );
}

const SNAPSHOT_HINTS = [
  "me:",
  "players",
  "auction",
  "listings",
  "blackListings",
  "blackStalls",
  "wants",
  "news",
  "worldChat",
  "orders",
  "roughPool"
];

for (const hint of SNAPSHOT_HINTS) {
  assert.ok(
    snapshotCombined.includes(hint),
    `snapshot-related token missing from server/snapshot-service: ${hint}`
  );
}

const DATA_VIEWS = [
  "overview",
  "rankings",
  "auction",
  "auctionHistory",
  "workshop",
  "inventory",
  "orders",
  "market",
  "blackmarket",
  "shop",
  "livestream",
  "reports",
  "collection",
  "hireMarket"
];

for (const view of DATA_VIEWS) {
  assert.match(
    indexHtml,
    new RegExp(`data-view="${view}"`),
    `frozen data-view missing: ${view}`
  );
}

assert.match(bootSource, /from "\.\.\/services\/auction-service\.js"/);
assert.match(bootSource, /from "\.\.\/services\/market-service\.js"/);
assert.match(bootSource, /from "\.\.\/services\/blackmarket-service\.js"/);
assert.match(bootSource, /createWorkshopService/);
assert.match(mainSource, /socket\.on\("state"/);
assert.match(mainSource, /socket\.on\("hello"/);
assert.match(mainSource, /socket\.on\("toast"/);
assert.match(mainSource, /socket\.on\("ui:event"/);
assert.match(mainSource, /dataset\.action|data-action/);

console.log(`refactor-contracts-smoke: ${SOCKET_EVENTS.length} socket events + ${DATA_VIEWS.length} views frozen`);
