import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";

assert.equal(typeof H.makePlayer, "function");
assert.equal(typeof H.normalizePlayer, "function");

const player = H.makePlayer("player-svc-1");
assert.equal(player.id, "player-svc-1");
assert.equal(player.cash, 12000);
assert.ok(Array.isArray(player.rough));
assert.equal(player.assets.workshopOwned, true);
assert.ok(player.workshop, "player factory must return a fully normalized player");
assert.ok(Array.isArray(player.tasks), "player factory must initialize progression tasks");
assert.match(player.name, /^新手掌柜/);

player.cash = "not-a-number";
player.rep = null;
delete player.polishingJobs;
player.cuttingJobs = [{ id: "legacy" }];
player.externalMaterials = { silverMount: 2, goldMount: 1, diamondChips: 3 };
player.processedRequestIds = ["valid-request", "bad request", "x".repeat(129)];
H.normalizePlayer(player);
assert.equal(player.cash, 12000);
assert.equal(player.rep, 0);
assert.equal(player.polishingJobs[0].id, "legacy");
assert.equal(player.cuttingJobs.length, 0);
assert.equal(player.externalMaterials.silver925, 2);
assert.equal(player.externalMaterials.gold18k, 1);
assert.equal(player.externalMaterials.diamond, 3);
assert.deepEqual(player.processedRequestIds, ["valid-request"]);
assert.ok(player.workshop);

player.materials = [{
  id: "stale-kit-material",
  type: "material",
  materialStage: "opened",
  name: "脏数据明料",
  extractionKits: [{ id: "ghost", type: "bangle", x: 50, y: 50 }],
  braceletPlacements: [{ id: "ghost", type: "bangle", x: 50, y: 50 }]
}];
H.normalizePlayer(player);
assert.equal(
  player.materials[0].extractionKits,
  undefined,
  "normalizePlayer should strip stale extractionKits from inventory materials"
);
assert.equal(
  player.materials[0].braceletPlacements,
  undefined,
  "normalizePlayer should strip stale braceletPlacements from inventory materials"
);

player.materials = [{
  id: "leftover-kit-material",
  type: "material",
  materialStage: "opened",
  name: "取件余料",
  leftover: true,
  extractionKits: [{ id: "cut-a", type: "bangle", x: 40, y: 40 }],
  braceletPlacements: [{ id: "cut-a", type: "bangle", x: 40, y: 40 }]
}];
H.normalizePlayer(player);
assert.equal(player.materials[0].leftover, true);
assert.equal(
  player.materials[0].extractionKits?.length,
  1,
  "normalizePlayer must keep extractionKits on leftover materials"
);
assert.equal(
  player.materials[0].braceletPlacements?.length,
  1,
  "normalizePlayer must keep braceletPlacements on leftover materials"
);

const serverSource = readFileSync("server.js", "utf8") + readFileSync("server/create-game.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
assert.match(serverSource, /wire-server\.js/);
assert.match(wireSource, /player-service\.js/);
assert.match(wireSource, /createDeferredPlayerService/);
assert.match(wireSource, /wirePlayerService/);
assert.doesNotMatch(serverSource, /cashPeak: 12000/);

const serviceSource = readFileSync("server/services/player-service.js", "utf8");
assert.match(serviceSource, /function makePlayer/);
assert.match(serviceSource, /function normalizePlayer/);
assert.match(serviceSource, /cashPeak: INITIAL_PLAYER_CASH/);

console.log("player-service-smoke: ok");
process.exit(0);
