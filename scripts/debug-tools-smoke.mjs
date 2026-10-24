import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMiningService } from "../server/services/mining-service.js";
import {
  grantPlayerExp,
  playerLevelForExp
} from "../shared/domain/progression/player-progression.js";

const expPlayer = { exp: 0, level: 1, expHistory: [] };
for (let click = 1; click <= 3; click += 1) {
  const result = grantPlayerExp(expPlayer, "debug", { amount: 100, now: 1_900_000_000_000 + click });
  assert.equal(result.granted, 100, "each debug click should grant exactly 100 business exp");
  assert.equal(expPlayer.exp, click * 100);
}
assert.equal(expPlayer.level, playerLevelForExp(300));
assert.equal(expPlayer.expHistory.length, 3);
assert.ok(expPlayer.expHistory.every((entry) => entry.source === "debug"));

const state = {
  players: new Map(),
  sockets: new Map(),
  mining: null
};
let idSequence = 0;
const miningService = createMiningService({
  getState: () => state,
  randomUUID: () => `debug-mining-${++idSequence}`,
  requiredRep: 400,
  requiredPlayers: 30,
  applicationMs: 60_000,
  leaseMs: 600_000
});

const player = { id: "debug-player", rep: 0 };
state.players.set(player.id, player);
assert.equal(miningService.canPlayerMine(player, 1_900_000_100_000).ok, false);

const unlocked = miningService.debugUnlockMining(player, 1_900_000_100_000);
assert.equal(unlocked.ok, true);
assert.equal(unlocked.worldUnlocked, true);
assert.equal(unlocked.licenseGranted, true);
assert.equal(unlocked.roundCreated, true);
assert.equal(player.mining.licenseAt, 1_900_000_100_000);
assert.equal(state.mining.unlockedAt, 1_900_000_100_000);
assert.deepEqual(state.mining.founderPlayerIds, [player.id]);
assert.equal(state.mining.currentRound.number, 1);
assert.equal(miningService.canPlayerMine(player, 1_900_000_100_001).ok, true);

const roundId = state.mining.currentRound.id;
const repeated = miningService.debugUnlockMining(player, 1_900_000_200_000);
assert.equal(repeated.changed, false, "repeated unlock should be idempotent");
assert.equal(state.mining.currentRound.id, roundId, "repeated unlock must not replace the active round");
assert.equal(state.mining.unlockedAt, 1_900_000_100_000);
assert.equal(player.mining.licenseAt, 1_900_000_100_000);

state.mining.competitionPlayerIds = [];
player.mining.competitionSuspendedUntil = 1_900_001_000_000;
player.mining.skippedApplicationRounds = 2;
const restored = miningService.debugUnlockMining(player, 1_900_000_250_000);
assert.equal(restored.changed, true);
assert.equal(restored.rosterRestored, true,
  "debug unlock should immediately restore a player removed for missed applications");
assert.equal(player.mining.competitionSuspendedUntil, null);
assert.equal(player.mining.skippedApplicationRounds, 0);
assert.equal(miningService.canPlayerMine(player, 1_900_000_250_001).ok, true);

const secondPlayer = { id: "debug-player-2", rep: 0 };
state.players.set(secondPlayer.id, secondPlayer);
const secondUnlock = miningService.debugUnlockMining(secondPlayer, 1_900_000_300_000);
assert.equal(secondUnlock.worldUnlocked, false);
assert.equal(secondUnlock.licenseGranted, true);
assert.equal(miningService.canPlayerMine(secondPlayer, 1_900_000_300_001).ok, true);
assert.deepEqual(state.mining.founderPlayerIds, [player.id], "later debug licenses are not retroactive founders");

const [html, rankingSource, socketRootSource, debugCommandSource] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/features/ranking/ranking-module.js", import.meta.url), "utf8"),
  readFile(new URL("../server/shell/socket-handlers.js", import.meta.url), "utf8"),
  readFile(new URL("../server/shell/commands/debug-commands.js", import.meta.url), "utf8")
]);
const socketSource = `${socketRootSource}\n${debugCommandSource}`;
assert.match(html, /data-debug="exp"[^>]*>经验\+100<\/button>/);
assert.match(html, /data-debug="unlockMining"[^>]*>解锁矿山<\/button>/);
assert.match(rankingSource, /emit\("debugGrant", \{ exp: 100 \}\)/);
assert.match(rankingSource, /emit\("debugGrant", \{ unlockMining: true \}\)/);
assert.match(socketSource, /grantPlayerExp\(player, "debug", \{ amount: addExp \}\)/);
assert.match(socketSource, /debugUnlockMining\(player\)/);

console.log("debug-tools-smoke: exp +100 and idempotent mining unlock ok");
