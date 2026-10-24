import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { AUCTION_HALLS } from "../shared/domain/auction/jade-auction.js";
import { auctionRoundsForState, auctionRoundForHall } from "../server/services/auction-rounds.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { initAuctionModule, renderAuction, enterAuctionHall, backAuctionHalls } from "../public/auction-module.js";

const now = Date.now();
function setup(exp = 3_600) {
  H.world.clear();
  const player = H.makePlayer("auction-halls-qa");
  player.exp = exp;
  player.cash = 100_000_000;
  H.normalizePlayer(player);
  H.state.players.set(player.id, player);
  H.processAuctionLifecycle(now);
  return player;
}
const roundFor = (hallId) => auctionRoundForHall(H.state, hallId);
let player = setup();
const initialIds = auctionRoundsForState(H.state).map((round) => round.id);
assert.equal(new Set(initialIds).size, 5);
assert.equal(new Set(auctionRoundsForState(H.state).flatMap((round) => round.roughs.map((rough) => rough.id))).size, 40);
for (const [exp, count] of [[0, 1], [249, 1], [250, 2], [799, 2], [800, 3], [1799, 3], [1800, 4], [3599, 4], [3600, 5]]) {
  player.exp = exp;
  player.level = 99; // Unlocks must use authoritative experience, not a stale cached level.
  const snapshot = H.snapshotFor(player, now);
  assert.equal(snapshot.auctionHalls.filter((hall) => hall.active).length, count);
  assert.equal(snapshot.auctionHalls.filter((hall) => hall.unlocked).length, count);
  assert.ok(snapshot.auctionHalls.every((hall) => !hall.next));
  assert.ok(Object.values(snapshot.auctionRounds).every((round) => round.roughs.length === 0), "unpaid lots remain private");
  assert.deepEqual(auctionRoundsForState(H.state).map((round) => round.id), initialIds, "reading or leveling up cannot replace live auctions");
}
assert.equal(H.state.sockets.size, 0, "halls must not depend on another online player's level");

// Lv.2 can enter both novice and regular; higher halls remain rejected without a debit.
player = setup(372);
const balance = player.cash;
const novice = roundFor("novice");
const regular = roundFor("regular");
assert.equal(H.enterAuctionForPlayer(player, { hallId: "novice" }, now).ok, true);
assert.equal(H.enterAuctionForPlayer(player, { hallId: "regular" }, now).ok, true);
assert.equal(player.cash, balance - 200 - 1_200);
assert.equal(H.state.auction.id, novice.id);
assert.equal(roundFor("regular").id, regular.id);
assert.equal(H.enterAuctionForPlayer(player, { hallId: "novice" }, now).ok, true);
assert.equal(player.cash, balance - 1_400, "returning to a paid hall cannot charge twice");
for (const hallId of ["premium", "special", "legendary", "invalid-hall"]) {
  const before = player.cash;
  assert.equal(H.enterAuctionForPlayer(player, { hallId }, now).ok, false);
  assert.equal(player.cash, before);
}
const n = novice.roughs[0];
const r = regular.roughs[0];
const bidAmount = 1_000_000;
assert.equal(H.submitAuctionBidForPlayer(player, { hallId: "novice", roughId: n.id, amount: bidAmount }, now).ok, true);
assert.equal(H.submitAuctionBidForPlayer(player, { hallId: "regular", roughId: r.id, amount: bidAmount }, now).ok, true);
assert.equal(player.cash, balance - 1_400 - 2 * bidAmount);
assert.equal(player.auctionEscrow.length, 2);
assert.equal(H.reconcileAuctionEscrows().refunded, 0, "other halls' valid guarantees cannot be refunded");
const beforeWrongHall = player.cash;
assert.equal(H.submitAuctionBidForPlayer(player, { hallId: "regular", roughId: n.id, amount: bidAmount }, now).ok, false);
assert.equal(H.requestAuctionWindowForPlayer(player, { hallId: "regular", roughId: n.id, x: 40, y: 45 }, now).ok, false);
assert.equal(player.cash, beforeWrongHall);
assert.equal(H.requestAuctionWindowForPlayer(player, { hallId: "regular", roughId: r.id, x: 40, y: 45 }, now).ok, true);
assert.equal(r.windows.length, 1);
assert.equal(n.windows?.length || 0, 0);
// Legacy clients without hallId are routed by unique rough ID.
assert.equal(H.submitAuctionBidForPlayer(player, { roughId: r.id, amount: bidAmount + 1 }, now).ok, true);
const snap = H.snapshotFor(player, now);
assert.equal(snap.auctionRounds.novice.myBids.length, 1);
assert.equal(snap.auctionRounds.regular.myBids.length, 1);
assert.equal(snap.auctionRounds.regular.roughs.length, 8);
assert.equal(snap.auctionRounds.premium.roughs.length, 0);
assert.ok(snap.auctionRounds.regular.roughs.every((rough) => rough.trueValue === undefined && rough.trueQualityKey === undefined));
assert.ok(!snap.roughPool.some((rough) => regular.roughs.some((item) => item.id === rough.id)), "extra unpaid halls must not leak through the shared legacy pool");

// Save/restore all rounds and guarantees; reject malformed extra rounds at the storage boundary.
const saved = H.world.exportSnapshot({ savedAt: now });
const restored = createMemoryWorldStore();
restored.importSnapshot(structuredClone(saved));
assert.deepEqual(restored.exportSnapshot({ savedAt: now }).auctionRounds, saved.auctionRounds);
assert.equal(restored.raw.players.get(player.id).auctionEscrow.length, 2);
for (const mutate of [
  (bad) => { bad.auctionRounds.regular.endsAt = -1; },
  (bad) => { bad.auctionRounds.regular.hallId = "novice"; },
  (bad) => { bad.auctionRounds.regular.roughs[0].id = bad.auction.roughs[0].id; },
  (bad) => { bad.auctionRounds.regular.id = bad.auction.id; }
]) {
  const bad = structuredClone(saved); mutate(bad);
  assert.throws(() => createMemoryWorldStore().importSnapshot(bad), /world-store/);
}

// Only one hall expires: the other hall's ID, bids and deposits survive intact.
roundFor("novice").endsAt = now - 1;
const regularId = roundFor("regular").id;
const regularBids = structuredClone(roundFor("regular").bids);
assert.equal(H.settleAuctionIfDue(now), true);
assert.notEqual(roundFor("novice").id, novice.id);
assert.equal(roundFor("regular").id, regularId);
assert.deepEqual(roundFor("regular").bids, regularBids);
assert.ok(H.auctionEscrowForRough(player, r.id));
assert.equal(H.reconcileAuctionEscrows().refunded, 0);
roundFor("regular").endsAt = now - 1;
assert.equal(H.settleAuctionIfDue(now), true);
assert.equal(player.auctionEscrow.length, 0);
assert.ok(player.rough.some((rough) => rough.id === n.id));
assert.ok(player.rough.some((rough) => rough.id === r.id));
assert.equal(player.pendingAuctionSettle.roundId, novice.id);
assert.equal(player.pendingAuctionSettles.length, 1);
assert.equal(H.ackAuctionSettleForPlayer(player, novice.id).cleared, true);
assert.equal(player.pendingAuctionSettle.roundId, regularId);
assert.equal(H.ackAuctionSettleForPlayer(player, novice.id).cleared, false);
assert.equal(H.ackAuctionSettleForPlayer(player, regularId).cleared, true);
assert.equal(player.pendingAuctionSettle, null);
const ownedIds = player.rough.map((rough) => rough.id);
assert.equal(H.settleAuctionIfDue(now), false);
assert.deepEqual(player.rough.map((rough) => rough.id), ownedIds);

// A legacy save with an ongoing higher hall keeps that exact round, entries and escrow.
player = setup();
H.enterAuctionForPlayer(player, { hallId: "regular" }, now);
const legacyRound = roundFor("regular");
H.submitAuctionBidForPlayer(player, { hallId: "regular", roughId: legacyRound.roughs[0].id, amount: bidAmount }, now);
const legacy = H.world.exportSnapshot({ savedAt: now });
legacy.auction = legacy.auctionRounds.regular;
delete legacy.auctionRounds;
legacy.roughPool = structuredClone(legacy.auction.roughs);
H.world.importSnapshot(legacy);
const legacyBefore = structuredClone(H.state.auction);
H.processAuctionLifecycle(now);
assert.deepEqual(H.state.auction, legacyBefore);
assert.equal(auctionRoundsForState(H.state).length, 5);
assert.equal(H.reconcileAuctionEscrows().refunded, 0);

// Actual renderer: upgrade with unchanged cash must expose the newly unlocked entrance.
player = setup(249);
let view = H.snapshotFor(player, now);
const root = () => ({ innerHTML: "", querySelectorAll: () => [] });
const els = { auctionHalls: root(), auctionBrief: root(), roughPool: root(), auctionHeadTitle: {}, auctionHeadDesc: {} };
const emits = [];
initAuctionModule({ socket: { emit(...args) { emits.push(args); } }, getState: () => view, els, getActiveView: () => "auction",
  helpers: { formatMoney: (n) => `¥${n}`, formatDuration: String, nowMs: () => now, escapeHtml: String, empty: String,
    showToast() {}, paintJades() {}, setView() {}, clampClient: (n) => n, CSS: {}, openGameModal() {}, closeGameModal() {} } });
renderAuction();
const regularCard = () => els.auctionHalls.innerHTML.match(/<button[^>]*data-auction-hall="regular"[\s\S]*?<\/button>/)?.[0] || "";
assert.match(regularCard(), /disabled/);
els.auctionBrief.childElementCount = 1; // Exercise the cache used by the real DOM.
player.exp = 250;
view = H.snapshotFor(player, now);
renderAuction();
assert.doesNotMatch(regularCard().split(">")[0], /disabled/);
assert.match(regularCard(), /入场/);
enterAuctionHall("regular");
assert.equal(emits.at(-1)[0], "enterAuction");
assert.equal(emits.at(-1)[1].hallId, "regular");
H.enterAuctionForPlayer(player, { hallId: "regular" }, now);
view = H.snapshotFor(player, now);
renderAuction();
assert.match(els.roughPool.innerHTML, /auction-lot-grid/);
assert.equal(els.auctionHeadTitle.textContent, "常规公盘");
backAuctionHalls();
assert.match(regularCard(), /已入场/);
// A closing hall must not disable another hall's entrance.
const other = H.makePlayer("near-close-qa");
other.exp = 250; other.cash = 30_000; H.normalizePlayer(other);
H.state.players.set(other.id, other);
roundFor("regular").endsAt = now + 9_000;
view = H.snapshotFor(other, now);
renderAuction();
assert.match(regularCard().split(">")[0], /disabled/);
const noviceCard = els.auctionHalls.innerHTML.match(/<button[^>]*data-auction-hall="novice"[\s\S]*?<\/button>/)?.[0] || "";
assert.doesNotMatch(noviceCard.split(">")[0], /disabled/);
const beforeLockedEntry = emits.length;
enterAuctionHall("regular");
assert.equal(emits.length, beforeLockedEntry);
assert.equal(AUCTION_HALLS.length, 5);
console.log("auction-halls-unlock-smoke: Lv.1-5 thresholds, immediate entry, independent bids/windows/settlement, escrow isolation, report queue, legacy migration, persistence and live-render cache ok");
