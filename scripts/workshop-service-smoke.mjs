import { readWorkshopServiceSource } from "./load-workshop-service-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

function reset() {
  H.state.players.clear();
  H.state.sockets.clear();
  H.state.roughPool.length = 0;
  H.state.listings.length = 0;
  H.state.wants.length = 0;
  H.state.news.length = 0;
  H.state.auction = null;
  H.state.latestAuctionResults = [];
  H.state.auctionHistory = [];
}

reset();
assert.equal(typeof H.startWorkshopJobForPlayer, "function");
assert.equal(typeof H.completeProductionJob, "function");
assert.equal(typeof H.processProductionJobs, "function");
assert.equal(typeof H.workshopDevicesForPlayer, "function");

const player = installOwnedWorkshopFixture(H.makePlayer("ws-svc-1"));
H.normalizePlayer(player);
player.cash = 0;
H.state.players.set(player.id, player);

const devices = H.workshopDevicesForPlayer(player);
const opening = devices.find((d) => d.stage === "opening") || devices[0];
assert.ok(opening?.id, "starter opening device");
const rough = player.rough[0];
assert.ok(rough?.id, "starter rough");

const started = H.startWorkshopJobForPlayer(player, opening.id, {
  itemId: rough.id,
  workerId: opening.workerId
});
assert.equal(started.ok, true, started.message);
assert.equal((player.jobs || []).length, 1);
assert.ok(player.jobs[0].readyAt - player.jobs[0].startedAt > 30_000, "normal workshop jobs should no longer finish in ten seconds");
assert.equal(started.fee, 0, "workshop jobs must start without cash");
assert.equal(player.cash, 0);

player.jobs[0].readyAt = Date.now() - 1;
const savedRandom = Math.random;
try {
  Math.random = () => 0.99; // This case verifies successful opening, not the fracture branch.
  H.processProductionJobs(Date.now(), { onlineOnly: false });
} finally {
  Math.random = savedRandom;
}
assert.equal((player.jobs || []).length, 0);
assert.equal(player.materials.length, 0, "completed work waits outside usable inventory");
assert.equal(player.workshopDeliveries.length, 1);
assert.equal(H.revealWorkshopDeliveryForPlayer(player, player.workshopDeliveries[0].id).ok, true);
assert.equal(H.revealWorkshopDeliveryForPlayer(player, player.workshopDeliveries[0].id, { itemIds: player.workshopDeliveries[0].scratchReveal.itemIds }).ok, true);
assert.equal(H.claimWorkshopDeliveryForPlayer(player, player.workshopDeliveries[0].id).ok, true);
assert.ok(player.materials.some((item) => item.materialStage === "opened" || item.revealed));
const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /createWorkshopService/);
assert.doesNotMatch(serverSource, /function completeProductionJob\(/);
assert.doesNotMatch(serverSource, /function startWorkshopJobForPlayer\(/);

const serviceSource = readWorkshopServiceSource();
assert.match(serviceSource, /function completeProductionJob/);
assert.match(serviceSource, /function startWorkshopJobForPlayer/);
assert.match(serviceSource, /createWorkshopPlanning/);
assert.match(serviceSource, /createWorkshopRoster/);
assert.doesNotMatch(serverSource, /function normalizeExtractionKits\(/);
assert.doesNotMatch(serverSource, /function revealPolishedRough\(/);
assert.doesNotMatch(serverSource, /function normalizeWorkshop\(/);
assert.doesNotMatch(serverSource, /const WORKSHOP_WORKER_DEFS\s*=/);

const planningSource = readFileSync("server/services/workshop-planning.js", "utf8");
assert.match(planningSource, /function normalizeExtractionKits/);
assert.match(planningSource, /function revealPolishedRough/);

const rosterSource = readFileSync("server/services/workshop-roster.js", "utf8");
assert.match(rosterSource, /WORKSHOP_WORKER_DEFS/);
assert.match(rosterSource, /function normalizeWorkshop/);

console.log("workshop-service-smoke: ok");
process.exit(0);
