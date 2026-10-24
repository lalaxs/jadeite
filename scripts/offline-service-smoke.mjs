import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { money } from "../server/services/economy-service.js";
import {
  createOfflineHelpers,
  createOfflineSettlement
} from "../server/services/offline-service.js";
import { __testHooks as H } from "../server.js";

const onlineCalls = [];
const { queueOfflineEvent, consumePendingOfflineEvents } = createOfflineHelpers({
  money,
  isPlayerOnline: (player) => {
    onlineCalls.push(player?.id);
    return player?.id === "online-player";
  }
});

const offlinePlayer = { id: "offline-player", pendingOfflineEvents: [] };
queueOfflineEvent(offlinePlayer, { type: "auction", text: "中标", income: 100, readyAt: 500 });
assert.equal(offlinePlayer.pendingOfflineEvents.length, 1);

const onlinePlayer = { id: "online-player", pendingOfflineEvents: [] };
queueOfflineEvent(onlinePlayer, { text: "skip" });
assert.equal(onlinePlayer.pendingOfflineEvents.length, 0);
assert.ok(onlineCalls.length >= 1);

const consumed = consumePendingOfflineEvents(offlinePlayer, 400, 600);
assert.equal(consumed.length, 1);
assert.equal(consumed[0].text, "中标");

const player = H.makePlayer("offline-settle-1");
player.lastSeenAt = 1000;
H.state.players.set(player.id, player);

const { settleOfflinePlayer } = createOfflineSettlement({
  normalizePlayer: H.normalizePlayer,
  consumePendingOfflineEvents,
  auctionEndsAt: H.auctionEndsAt || (() => 0),
  settleAuctionIfDue: () => {},
  settleProductionJobsForPlayer: () => [],
  refillOrders: H.refillOrders,
  refreshPlayerReport: H.refreshPlayerReport,
  getState: () => H.state
});

const events = settleOfflinePlayer(player, 2000);
assert.ok(Array.isArray(events));
assert.equal(player.lastSeenAt, 2000);
assert.ok(player.reports?.length);

assert.equal(typeof H.settleOfflinePlayer, "function");
assert.equal(typeof H.queueOfflineEvent, "function");

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /offline-service\.js/);
assert.match(bootSource, /createOfflineHelpers/);
assert.match(bootSource, /createOfflineSettlement/);
assert.doesNotMatch(serverSource, /function settleOfflinePlayer\(/);
assert.doesNotMatch(serverSource, /function queueOfflineEvent\(/);

const serviceSource = readFileSync("server/services/offline-service.js", "utf8");
assert.match(serviceSource, /function settleOfflinePlayer/);
assert.match(serviceSource, /makeOfflineSummary/);

console.log("offline-service-smoke: ok");
process.exit(0);
