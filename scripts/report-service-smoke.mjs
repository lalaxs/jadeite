import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createReportService } from "../server/services/report-service.js";
import { __testHooks as H } from "../server.js";

const player = H.makePlayer("report-svc-1");
H.state.players.set(player.id, player);
H.state.listings.push({
  id: "L1",
  ownerId: player.id,
  item: { id: "listed-1", type: "bracelet", value: 5000 }
});

const { inventoryForReport, playerReportSnapshot, refreshPlayerReport } = createReportService({
  getState: () => H.state,
  stallInventoryItemsForPlayer: () => []
});

const inventory = inventoryForReport(player);
assert.ok(inventory.some((item) => item.id === "listed-1"));
const reportsBeforeRead = player.reports;
const readOnlyReport = playerReportSnapshot(player, 1999);
assert.ok(readOnlyReport);
assert.equal(player.reports, reportsBeforeRead, "report snapshots must not replace persistent player state");
const report = refreshPlayerReport(player, 2000);
assert.ok(report);
assert.ok(typeof report.inventoryValue === "number");

assert.equal(typeof H.refreshPlayerReport, "function");
assert.equal(typeof H.inventoryForReport, "function");

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /report-service\.js/);
assert.match(bootSource, /createReportService/);
assert.doesNotMatch(serverSource, /function inventoryForReport\(/);
assert.doesNotMatch(serverSource, /function refreshPlayerReport\(/);

const serviceSource = readFileSync("server/services/report-service.js", "utf8");
assert.match(serviceSource, /function inventoryForReport/);
assert.match(serviceSource, /function playerReportSnapshot/);
assert.match(serviceSource, /function refreshPlayerReport/);
assert.match(serviceSource, /reportSummary/);

console.log("report-service-smoke: ok");
process.exit(0);
