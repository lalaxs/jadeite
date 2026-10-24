import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import {
  ASSET_LISTINGS,
  createAssetsService
} from "../server/services/assets-service.js";

assert.equal(ASSET_LISTINGS.length, 2);
assert.deepEqual(
  ASSET_LISTINGS.map((listing) => listing.id),
  ["starter-workshop", "livestream-permit"]
);
assert.deepEqual(
  ASSET_LISTINGS.map((listing) => listing.price),
  [8_000, 10_000]
);

function reset() {
  H.world.clear();
}

reset();
const player = H.makePlayer("asset-svc-1");
H.normalizePlayer(player);
player.assets.workshopOwned = false;
player.assets.livestreamPermitOwned = false;
player.cash = 50_000;
H.state.players.set(player.id, player);

assert.equal(H.playerOwnsWorkshop(player), false);
assert.equal(H.playerCanLivestream(player), false);
assert.deepEqual(
  H.assetListingsForPlayer(player).map((listing) => listing.id),
  ["starter-workshop", "livestream-permit"]
);

const buyWorkshop = H.buyAssetListingForPlayer(player, "starter-workshop");
assert.equal(buyWorkshop.ok, true, buyWorkshop.message);
assert.equal(H.playerOwnsWorkshop(player), true);
assert.deepEqual(
  H.assetListingsForPlayer(player).map((listing) => listing.id),
  ["livestream-permit"]
);

const again = H.buyAssetListingForPlayer(player, "starter-workshop");
assert.equal(again.ok, false);

const buyPermit = H.buyAssetListingForPlayer(player, "livestream-permit");
assert.equal(buyPermit.ok, true, buyPermit.message);
assert.equal(H.playerCanLivestream(player), true);
assert.deepEqual(H.assetListingsForPlayer(player), []);

const local = createAssetsService({
  normalizePlayer: H.normalizePlayer,
  spendCash: H.spendCash,
  refreshPlayerReport: H.refreshPlayerReport
});
assert.equal(typeof local.normalizeAssets, "function");

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /createAssetsService/);
assert.doesNotMatch(serverSource, /const ASSET_LISTINGS\s*=/);
assert.doesNotMatch(serverSource, /function buyAssetListingForPlayer\(/);
assert.doesNotMatch(serverSource, /function normalizeAssets\(/);

const serviceSource = readFileSync("server/services/assets-service.js", "utf8");
assert.match(serviceSource, /function buyAssetListingForPlayer/);
assert.match(serviceSource, /export const ASSET_LISTINGS/);

console.log("assets-service-smoke: ok");
process.exit(0);
