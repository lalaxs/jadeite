import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
const socketHandlers = readFileSync("server/shell/socket-handlers.js", "utf8");
const miningCommands = readFileSync("server/shell/commands/mining-commands.js", "utf8");
const blackmarketCommands = readFileSync("server/shell/commands/blackmarket-commands.js", "utf8");
const commerceCommands = readFileSync("server/shell/commands/commerce-commands.js", "utf8");
const progressionCommands = readFileSync("server/shell/commands/progression-commands.js", "utf8");
const debugCommands = readFileSync("server/shell/commands/debug-commands.js", "utf8");
const combined = `${serverSource}\n${socketHandlers}\n${miningCommands}\n${blackmarketCommands}\n${commerceCommands}\n${progressionCommands}\n${debugCommands}`;

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
  "miningSaveTuningExperiment",
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
  "recycleInventoryItem",
  "withdrawListing",
  "refreshOrders",
  "refreshOrderSlot",
  "collectPayout",
  "bmListItem",
  "bmBuyListing",
  "bmWithdrawListing",
  "bmAddBlindItems",
  "bmWithdrawBlindItem",
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
    combined,
    new RegExp(`socket\\.on\\("${eventName.replace(":", "\\:")}"`),
    `frozen socket event missing: ${eventName}`
  );
}

assert.match(bootSource, /registerSocketHandlers\(io,/);
assert.match(socketHandlers, /export function registerSocketHandlers/);
assert.match(socketHandlers, /io\.on\("connection"/);
assert.doesNotMatch(serverSource, /io\.on\("connection"/);
assert.doesNotMatch(serverSource, /socket\.on\("setName"/);

assert.match(socketHandlers, /const\s+wasOnline\s*=\s*isPlayerOnline\(player\)/);
assert.match(socketHandlers, /if\s*\(!wasOnline\)\s*settleOfflinePlayer\(player\)/);
assert.match(socketHandlers, /world\.bindSocket\(socket\.id,\s*playerId\)/);
assert.match(socketHandlers, /world\.unbindSocket\(socket\.id\)/);
assert.match(socketHandlers, /playerSocketCount\(playerId\)\s*===\s*0/);

for (const eventName of ["startPolish", "extractFromRough", "livestreamSell"]) {
  const start = socketHandlers.indexOf(`socket.on("${eventName}"`);
  assert.ok(start >= 0, `missing handler: ${eventName}`);
  const slice = socketHandlers.slice(start, start + 600);
  assert.match(slice, /normalizeMutationPayload/, `${eventName} should normalize payloads`);
}

assert.match(socketHandlers, /本单评价/);
assert.match(socketHandlers, /客户评级/);
assert.match(socketHandlers, /客人给了好评/);

console.log("socket-handlers-smoke: ok", SOCKET_EVENTS.length, "events");
process.exit(0);
