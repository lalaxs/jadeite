import { readTradingServiceSource } from "./load-trading-service-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks } from "../server.js";
import {
  AUCTION_HALL_LOT_PROFILES,
  createAuctionHallRoughs
} from "../server/services/auction-service.js";

const {
  makePlayer,
  normalizePlayer,
  enterAuctionForPlayer,
  submitAuctionBidForPlayer,
  requestAuctionWindowForPlayer,
  ensureAuctionRound,
  settleAuctionIfDue,
  processAuctionLifecycle,
  snapshotFor,
  auctionEscrowForRough,
  reconcileAuctionEscrows,
  ackAuctionSettleForPlayer,
  state
} = __testHooks;

function reset() {
  state.players.clear();
  state.sockets.clear();
  state.roughPool.length = 0;
  state.listings.length = 0;
  state.news.length = 0;
  state.auction = null;
  state.auctionRounds = {};
  state.latestAuctionResults = [];
  state.auctionHistory = [];
}

// 厅堂越高，抽样平均品质逐级提升；体量区间也遵守各场定位。
{
  const qualityScore = new Map([
    ["bean", 1],
    ["glutinous", 2],
    ["stickyIce", 3],
    ["ice", 4],
    ["highIce", 5],
    ["glass", 6]
  ]);
  const averages = [];
  for (const hallId of ["novice", "regular", "premium", "special", "legendary"]) {
    let seed = 7;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const rows = createAuctionHallRoughs(hallId, (options) => ({
      id: `${hallId}-${seed}`,
      trueQualityKey: options.qualityKey,
      mass: options.mass
    }), 800, rng);
    const profile = AUCTION_HALL_LOT_PROFILES[hallId];
    assert.equal(rows.length, 800);
    assert.ok(rows.every((row) => row.sourceHallId === hallId));
    assert.ok(rows.every((row) => row.mass >= profile.mass[0] && row.mass <= profile.mass[1]));
    averages.push(rows.reduce((sum, row) => sum + qualityScore.get(row.trueQualityKey), 0) / rows.length);
  }
  assert.ok(averages.every((avg, index) => index === 0 || avg > averages[index - 1]), `quality averages should rise: ${averages.join(", ")}`);
}

reset();
const player = makePlayer("auction-svc-1");
normalizePlayer(player);
player.cash = 200_000;
state.players.set(player.id, player);

const now = Date.now();
assert.equal(processAuctionLifecycle(now), true, "lifecycle should report initial round creation");
const round = ensureAuctionRound(now);
assert.ok(round?.id);
assert.ok((round.roughs || []).length > 0);

const entered = enterAuctionForPlayer(player, { hallId: "novice" }, now);
assert.equal(entered.ok, true, entered.message);

const rough = round.roughs[0];
const bid = submitAuctionBidForPlayer(player, { roughId: rough.id, amount: rough.price }, now);
assert.equal(bid.ok, true, bid.message);
const escrow = auctionEscrowForRough(player, rough.id);
assert.ok(escrow && escrow.amount >= rough.price);

const windowed = requestAuctionWindowForPlayer(player, { roughId: rough.id, x: 40, y: 45 }, now);
assert.equal(windowed.ok, true, windowed.message);
assert.equal((rough.windows || []).length, 1);

const cashBeforeOrphan = player.cash;
player.cash -= 1_234;
player.auctionEscrow.push({
  roughId: "orphaned-rough",
  roundId: "missing-round",
  amount: 1_234,
  at: now
});
const repairedOrphan = reconcileAuctionEscrows();
assert.equal(repairedOrphan.changed, true);
assert.equal(repairedOrphan.count, 1);
assert.equal(repairedOrphan.refunded, 1_234);
assert.equal(player.cash, cashBeforeOrphan);
assert.equal(auctionEscrowForRough(player, "orphaned-rough"), null);
assert.ok(auctionEscrowForRough(player, rough.id), "current live bid escrow must remain frozen");

const liveEscrowAmount = auctionEscrowForRough(player, rough.id).amount;
const cashBeforeMissingRoundRepair = player.cash;
state.auction = null;
const repairedMissingRound = reconcileAuctionEscrows();
assert.equal(repairedMissingRound.changed, true);
assert.equal(repairedMissingRound.refunded, liveEscrowAmount);
assert.equal(player.cash, cashBeforeMissingRoundRepair + liveEscrowAmount);
assert.equal(player.auctionEscrow.length, 0);

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /from "\.\.\/services\/auction-service\.js"/);
assert.match(bootSource, /bindAuctionApi\(/);
assert.doesNotMatch(bootSource, /function createAuctionRound\(/);
assert.doesNotMatch(serverSource, /function applyAuctionBidEscrow\(/);

const serviceSource = readTradingServiceSource("auction-service.js");
assert.match(serviceSource, /export function createAuctionRound/);
assert.match(serviceSource, /export function submitAuctionBidForPlayer/);
assert.match(serviceSource, /deliverAuctionSettleReports|pendingAuctionSettle/);
assert.match(serviceSource, /ackAuctionSettleForPlayer/);

// Settle report: entrant gets pendingAuctionSettle even with zero bids
{
  reset();
  const p = makePlayer("auction-settle-1");
  normalizePlayer(p);
  p.cash = 200_000;
  state.players.set(p.id, p);
  const t0 = Date.now();
  ensureAuctionRound(t0);
  assert.equal(enterAuctionForPlayer(p, { hallId: "novice" }, t0).ok, true);
  assert.ok(state.auction?.id);
  state.auction.endsAt = t0 - 5_000;
  state.auction.biddingEndsAt = t0 - 5_000;
  assert.equal(settleAuctionIfDue(t0), true, "expired entered round should settle");
  assert.ok(p.pendingAuctionSettle, "entrant should receive settle report");
  assert.equal(p.pendingAuctionSettle.bidCount, 0);
  assert.equal(p.pendingAuctionSettle.wins.length, 0);
  assert.equal(p.pendingAuctionSettle.refundedTotal, 0);
  assert.equal(typeof ackAuctionSettleForPlayer, "function");
  assert.equal(ackAuctionSettleForPlayer(p, p.pendingAuctionSettle.roundId).cleared, true);
  assert.equal(p.pendingAuctionSettle, null);
}

// Last 10s: block new entry; already-paid entrants can still re-enter the round.
{
  reset();
  const early = makePlayer("auction-entry-early");
  const late = makePlayer("auction-entry-late");
  normalizePlayer(early);
  normalizePlayer(late);
  early.cash = 200_000;
  late.cash = 200_000;
  state.players.set(early.id, early);
  state.players.set(late.id, late);
  const t0 = Date.now();
  ensureAuctionRound(t0);
  assert.equal(enterAuctionForPlayer(early, { hallId: "novice" }, t0).ok, true);
  const endsAt = Number(state.auction.endsAt || state.auction.biddingEndsAt);
  const nearEnd = endsAt - 8_000;
  const blocked = enterAuctionForPlayer(late, { hallId: "novice" }, nearEnd);
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /不足 10 秒|停止入场/);
  const reenter = enterAuctionForPlayer(early, { hallId: "novice" }, nearEnd);
  assert.equal(reenter.ok, true, "already paid entry should still open near the end");
  const warnWindow = enterAuctionForPlayer(late, { hallId: "novice" }, endsAt - 30_000);
  assert.equal(warnWindow.ok, true, "entry within the last minute but above 10s stays allowed server-side");
}

// 达级即开放：各厅堂独立运行，不替换新手场，也不依赖其他在线玩家。
{
  reset();
  const veteran = makePlayer("auction-rotation-veteran");
  const newcomer = makePlayer("auction-rotation-newcomer");
  normalizePlayer(veteran);
  normalizePlayer(newcomer);
  veteran.cash = 200_000;
  veteran.exp = 3_600;
  newcomer.cash = 200_000;
  newcomer.exp = 0;
  state.players.set(veteran.id, veteran);
  state.players.set(newcomer.id, newcomer);
  state.sockets.set("socket-veteran", veteran.id);
  state.sockets.set("socket-newcomer", newcomer.id);
  const t0 = Date.now();
  ensureAuctionRound(t0);
  assert.equal(state.auction?.hallId, "novice");
  state.auction.endsAt = t0 - 1;
  state.auction.biddingEndsAt = t0 - 1;
  assert.equal(settleAuctionIfDue(t0), true);
  assert.equal(state.auction?.hallId, "novice", "a hall renews its own round");
  const halls = snapshotFor(veteran, t0 + 1).auctionHalls;
  assert.equal(halls.filter((hall) => hall.active).length, 5, "all unlocked halls are open immediately");
  assert.equal(halls.filter((hall) => hall.next).length, 0);
  assert.equal(enterAuctionForPlayer(veteran, { hallId: "regular" }, t0 + 1).ok, true);
  const regular = state.auctionRounds.regular;
  assert.ok(regular.roughs.every((rough) => rough.sourceHallId === "regular"));
  assert.ok(regular.roughs.every((rough) => rough.mass >= AUCTION_HALL_LOT_PROFILES.regular.mass[0]));
  const levelBlocked = enterAuctionForPlayer(newcomer, { hallId: "regular" }, t0 + 1);
  assert.equal(levelBlocked.ok, false);
  assert.match(levelBlocked.message, /经营 Lv\.2/);
}

console.log("auction-service-smoke: ok");
process.exit(0);
