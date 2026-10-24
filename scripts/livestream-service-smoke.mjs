import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLivestreamService } from "../server/services/livestream-service.js";

const serviceSource = readFileSync("server/services/livestream-service.js", "utf8");
const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;

assert.match(serviceSource, /export function createLivestreamService/);
assert.match(serviceSource, /startLivestreamRoomForPlayer/);
assert.match(serviceSource, /processLivestreamRooms/);
assert.match(serviceSource, /retireLegacyLivestreamJobs/);
assert.match(serviceSource, /@deprecated/);
assert.match(bootSource, /from "\.\.\/services\/livestream-service\.js"/);
assert.match(bootSource, /createLivestreamService\(/);
assert.match(serviceSource, /deliverLivestreamSettle|pendingLivestreamSettle/);
assert.match(serviceSource, /ackLivestreamSettleForPlayer/);
assert.match(serviceSource, /buildLivestreamSettleModalEvent/);
assert.match(serviceSource, /shared\/domain\/livestream\/settle-modal\.js/);
assert.doesNotMatch(serviceSource, /public\/livestream-module\.js/);
assert.match(serviceSource, /UI uses livestream rooms/);
const runtimeTicksSource = readFileSync("server/shell/runtime-ticks.js", "utf8");
assert.doesNotMatch(bootSource, /processLivestreamJobs\(\);/);
assert.match(runtimeTicksSource, /processLivestreamRooms\(now, \{ broadcast: false \}\)/);
const api = createLivestreamService({
  normalizePlayer: () => {},
  materialStageFor: () => "finished",
  spendCash: () => true,
  earnCash: () => {},
  addItem: (player, product) => {
    player.bracelets ||= [];
    player.bracelets.push(product);
    return product;
  },
  advanceTask: () => {},
  addNews: () => {},
  refreshPlayerReport: () => {},
  emitUiEventToPlayer: () => {},
  getState: () => ({ players: new Map() }),
  broadcast: () => {},
  publicProduct: (item) => item,
  uiMoney: (n) => String(n),
  randomUUID: () => "id-1"
});

assert.equal(api.scheduleLivestream(), null);
assert.equal(api.sellLivestreamNow(), null);
assert.equal(api.processLivestreamJobs(), false);
assert.deepEqual(api.settleLivestreamJobsForPlayer(), []);

const player = { livestreamJobs: [{ product: { id: "p1" } }], bracelets: [] };
const restored = api.retireLegacyLivestreamJobs(player);
assert.equal(restored, 1);
assert.equal(player.livestreamJobs.length, 0);
assert.equal(player.bracelets.length, 1);
assert.equal(player.bracelets[0].id, "p1");

console.log("livestream-service-smoke: room authority + legacy retirement ok");
