import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  publicStone,
  publicListing,
  publicWant,
  publicWindowReveal
} from "../server/services/snapshot-public.js";
import { __testHooks as H } from "../server.js";

const rough = {
  id: "r1",
  type: "rough",
  name: "原石",
  trueQualityKey: "imperial",
  trueValue: 99999,
  revealed: false,
  publicHint: "皮壳提示",
  windows: [{ id: "w1", x: 0.2, y: 0.3, r: 0.1, secret: 1 }],
  visual: { seed: 1, shape: "oval", skinRoughness: 0.8, bestAngle: 45, windows: [{ id: "w1", x: 0.2, y: 0.3, r: 0.1 }] }
};

const pub = publicStone(rough);
assert.equal(pub.trueQualityKey, undefined);
assert.equal(pub.trueValue, undefined);
assert.equal(pub.visual.masked, true);
assert.equal(pub.visual.bestAngle, undefined);
assert.equal(pub.hint, "皮壳提示");
assert.equal(pub.windows[0].secret, undefined);

const listing = publicListing({ id: "L1", item: rough });
assert.equal(listing.item.visual.masked, true);

const want = publicWant({ id: "W1", offers: [{ id: "o1", item: rough }] });
assert.equal(want.offers[0].item.trueQualityKey, undefined);

assert.deepEqual(publicWindowReveal({ id: "w", x: 1, leak: true }), { id: "w", x: 1 });

assert.equal(typeof H.snapshotFor, "function");
const player = H.makePlayer("snap-test");
H.state.players.set(player.id, player);
H.state.auction = null;
H.state.news.push({ id: "snapshot-news", text: "快照隔离", meta: { source: "world" } });
H.state.worldChat.push({ id: "snapshot-chat", text: "只读消息", meta: { source: "world" } });
H.state.listings.push({
  id: "snapshot-listing",
  ownerId: player.id,
  item: {
    id: "snapshot-listed-item",
    type: "bracelet",
    name: "隔离测试成品",
    value: 1234,
    provenance: { source: "world" }
  }
});
H.state.blackStalls.push({
  id: "snapshot-goods-stall",
  ownerId: player.id,
  ownerName: player.name,
  title: "快照隔离货摊",
  type: "goods",
  status: "open",
  anonymous: false,
  items: [{
    id: "snapshot-stall-row",
    type: "bracelet",
    price: 1500,
    item: { id: "snapshot-stall-item", type: "bracelet", name: "摊位成品", value: 1500 }
  }],
  createdAt: 900,
  updatedAt: 900
});
H.state.blackServiceOrders.push({
  id: "snapshot-timed-order",
  buyerId: player.id,
  buyerName: player.name,
  sellerId: "snapshot-seller",
  sellerName: "测试卖家",
  status: "pending",
  acceptExpiresAt: 1500,
  createdAt: 900
});
const newsCountBeforeInitialRead = H.state.news.length;
const playerBeforeInitialRead = structuredClone(player);
const worldBeforeInitialRead = structuredClone(H.state);
const snap = H.snapshotFor(player, 1000);
assert.equal(snap.serverNow, 1000);
assert.equal(snap.me.id, player.id);
assert.equal(Number.isInteger(snap.onlinePlayerCount), true);
assert.ok(Array.isArray(snap.listings));
assert.ok(Array.isArray(snap.wants));
assert.equal(snap.blackServiceOrders.some((order) => order.id === "snapshot-timed-order"), true);
assert.ok(snap.auction);
assert.ok(Array.isArray(snap.equipmentCatalog));
assert.ok(snap.inlayCatalog && typeof snap.inlayCatalog === "object");
assert.deepEqual(player, playerBeforeInitialRead, "snapshot reads must not normalize or rewrite player state");
assert.deepEqual(structuredClone(H.state), worldBeforeInitialRead, "snapshot assembly must leave the complete world unchanged");
assert.equal(H.state.auction, null, "snapshot reads must not create or advance auction rounds");
assert.equal(H.state.news.length, newsCountBeforeInitialRead, "snapshot reads must not announce auction rounds");
snap.me.stats.tradeCount = 999;
snap.me.assets.workshopOwned = false;
snap.news[0].meta.source = "snapshot";
snap.worldChat[0].meta.source = "snapshot";
snap.listings[0].item.provenance.source = "snapshot";
snap.news.push({ id: "snapshot-only" });
assert.notEqual(player.stats.tradeCount, 999, "mutating snapshot stats must not affect player state");
assert.equal(player.assets.workshopOwned, true, "mutating snapshot assets must not affect player state");
assert.equal(H.state.news[0].meta.source, "world", "snapshot news rows must be detached");
assert.equal(H.state.worldChat[0].meta.source, "world", "snapshot chat rows must be detached");
assert.equal(H.state.listings[0].item.provenance.source, "world", "nested listing items must be detached");
assert.equal(H.state.news.length, newsCountBeforeInitialRead, "snapshot arrays must be detached");
const privateSnapshot = H.privatePlayerSnapshot(player, 1000);
privateSnapshot.stats.tradeCount = 777;
assert.notEqual(player.stats.tradeCount, 777, "private player snapshots must be detached when used directly");
const deltaSnap = H.snapshotFor(player, 1001, { includeStaticCatalogs: false });
assert.equal(deltaSnap.equipmentCatalog, undefined);
assert.equal(deltaSnap.inlayCatalog, undefined);
assert.equal(
  H.snapshotFor(player, 1501).blackServiceOrders.some((order) => order.id === "snapshot-timed-order"),
  false,
  "all time-sensitive snapshot sections must use the same serverNow"
);
player.auth = { resumeTokenHash: "secret-hash" };
assert.equal(H.snapshotFor(player, 1002).me.auth, undefined, "session hashes must stay server-only");

const emptyStall = {
  id: "snapshot-empty-stall",
  ownerId: player.id,
  ownerName: player.name,
  title: "只读空摊",
  type: "goods",
  status: "open",
  anonymous: false,
  items: [],
  createdAt: 900,
  updatedAt: 900
};
H.state.blackStalls.push(emptyStall);
const stallCountBeforeRead = H.state.blackStalls.length;
const newsCountBeforeRead = H.state.news.length;
const readOnlySnap = H.snapshotFor(player, 1003);
assert.equal(readOnlySnap.blackStalls.some((stall) => stall.id === emptyStall.id), false);
assert.equal(H.state.blackStalls.length, stallCountBeforeRead, "snapshot reads must not sweep world stalls");
assert.equal(H.state.news.length, newsCountBeforeRead, "snapshot reads must not append world news");
H.state.blackStalls.splice(H.state.blackStalls.indexOf(emptyStall), 1);

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /snapshot-service\.js/);
assert.match(bootSource, /snapshot-public\.js/);
assert.match(bootSource, /createSnapshotService/);
assert.doesNotMatch(serverSource, /function publicStone\(/);
assert.doesNotMatch(serverSource, /function snapshotFor\(/);
assert.doesNotMatch(serverSource, /function privatePlayerSnapshot\(/);

const serviceSource = readFileSync("server/services/snapshot-service.js", "utf8");
assert.match(serviceSource, /function snapshotFor/);
assert.doesNotMatch(serviceSource, /sweepEmptyBlackGoodsStalls/);
assert.doesNotMatch(serviceSource, /settleAuctionIfDue|ensureAuctionRound/);
assert.doesNotMatch(serviceSource, /normalizePlayer|refreshPlayerReport/);
assert.match(serviceSource, /playerReportSnapshot/);
assert.match(serviceSource, /detachForTransport/);

// Cost and batch attribution are private to the current seller, including
// items held in a want offer or listing rather than the ordinary backpack.
const observer = H.makePlayer("snapshot-cost-observer");
H.state.players.set(observer.id, observer);
const privateItem = { id: "snapshot-private-offer", name: "应征货", type: "bracelet", value: 2000,
  costBasis: { amount: 1234, complete: true, components: { acquisition: 1234 } },
  financeBatchId: "seller-private-batch", financeOwnerId: player.id, financeParentItemId: "seller-private-parent" };
H.state.wants.push({ id: "snapshot-private-want", ownerId: observer.id,
  offers: [{ id: "snapshot-private-offer-row", sellerId: player.id, item: privateItem }] });
H.state.listings[0].item.costBasis = privateItem.costBasis;
H.state.listings[0].item.financeBatchId = privateItem.financeBatchId;
const ownCosts = H.snapshotFor(player, 2000);
const otherCosts = H.snapshotFor(observer, 2000);
assert.equal(ownCosts.wants.find(row => row.id === "snapshot-private-want").offers[0].item.costBasis.amount, 1234);
assert.equal(ownCosts.listings[0].item.costBasis.amount, 1234);
for (const item of [otherCosts.wants.find(row => row.id === "snapshot-private-want").offers[0].item, otherCosts.listings[0].item]) {
  assert.equal(item.costBasis, undefined);
  assert.equal(item.financeBatchId, undefined);
  assert.equal(item.financeOwnerId, undefined);
  assert.equal(item.financeParentItemId, undefined);
}
assert.equal(ownCosts.me.financeBook, undefined, "raw private accounting storage is not a transport field");
assert.ok(ownCosts.me.reports[0].finance, "only the read-only finance projection is sent");
assert.equal(ownCosts.me.rough[0].costBasis.complete, true, "own inventory retains its cost basis");

console.log("snapshot-service-smoke: ok");
process.exit(0);
