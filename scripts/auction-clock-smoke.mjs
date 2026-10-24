import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { auctionRoundDuration } from "../server/services/auction-service.js";
import { auctionRoundsForState, auctionRoundForHall } from "../server/services/auction-rounds.js";
import { auctionBidPhase } from "../public/jade-auction.js";
import { bindFormatDeps, formatDuration } from "../public/shell/format-utils.js";
import { initAuctionModule, renderAuction, tickAuctionClock, auctionPhaseMeta, auctionCountdownPct,
  auctionRoundLabel, enterAuctionHall, backAuctionHalls } from "../public/auction-module.js";
import { bindTopHudDeps, renderTopHud, tickHudClock } from "../public/features/hud/top-hud.js";
import { bindSidePanelDeps, tickReminderCountdowns } from "../public/features/hud/side-panel.js";

const start = Date.now();
const duration = auctionRoundDuration();
const rounds = () => auctionRoundsForState(H.state);
const roundFor = (hallId) => auctionRoundForHall(H.state, hallId);
function reset() {
  H.world.clear();
  const player = H.makePlayer("auction-clock-qa");
  player.exp = 3_600;
  player.cash = 100_000_000;
  H.normalizePlayer(player);
  H.state.players.set(player.id, player);
  return player;
}
function assertSynchronized(now) {
  assert.equal(rounds().length, 5);
  for (const field of ["startsAt", "endsAt", "biddingEndsAt"]) {
    assert.equal(new Set(rounds().map((round) => round[field])).size, 1, `${field} must match in every hall`);
  }
  const snapshot = H.snapshotFor(player, now);
  for (const hall of snapshot.auctionHalls) {
    assert.equal(hall.startsAt, snapshot.auction.startsAt);
    assert.equal(hall.endsAt, snapshot.auction.endsAt);
    assert.equal(snapshot.auctionRounds[hall.id].endsAt, snapshot.auction.endsAt);
  }
}

// A hall created later joins the existing clock, including an old primary hall.
let player = reset();
H.ensureAuctionRound(start, "regular");
const legacy = structuredClone(H.state.auction);
H.processAuctionLifecycle(start + 180_000);
assert.deepEqual(H.state.auction, legacy, "adding halls cannot replace or reset a paid legacy round");
assertSynchronized(start + 180_000);
assert.equal(roundFor("novice").endsAt, start + duration);

// Repair staggered saved rounds in place without shortening any live deadline.
player = reset();
H.processAuctionLifecycle(start);
for (const hallId of ["novice", "regular"]) {
  assert.equal(H.enterAuctionForPlayer(player, { hallId }, start).ok, true);
  const rough = roundFor(hallId).roughs[0];
  assert.equal(H.submitAuctionBidForPlayer(player, { hallId, roughId: rough.id, amount: 1_000_000 }, start).ok, true);
}
const paidRounds = rounds().map((round) => ({ id: round.id, bids: structuredClone(round.bids),
  entries: structuredClone(round.entries), roughs: structuredClone(round.roughs) }));
const escrow = structuredClone(player.auctionEscrow);
const cash = player.cash;
roundFor("regular").startsAt += 90_000;
roundFor("regular").endsAt += 90_000;
roundFor("regular").biddingEndsAt += 90_000;
assert.equal(H.processAuctionLifecycle(start + 100_000), true);
assertSynchronized(start + 100_000);
assert.equal(H.state.auction.endsAt, start + duration + 90_000);
assert.deepEqual(rounds().map((round) => ({ id: round.id, bids: round.bids, entries: round.entries, roughs: round.roughs })), paidRounds);
assert.deepEqual(player.auctionEscrow, escrow);
assert.equal(player.cash, cash);
assert.equal(H.processAuctionLifecycle(start + 100_001), false, "the clock must not restart on every tick");
for (const at of [H.state.auction.endsAt - 120_001, H.state.auction.endsAt - 120_000, H.state.auction.endsAt]) {
  assert.equal(new Set(rounds().map((round) => auctionBidPhase(round, at))).size, 1);
}
const saved = H.world.exportSnapshot({ savedAt: start + 100_000 });
H.world.importSnapshot(structuredClone(saved));
player = H.state.players.get(player.id);
assert.equal(H.processAuctionLifecycle(start + 100_002), false);
assertSynchronized(start + 100_002);
assert.deepEqual(player.auctionEscrow, escrow);

// A delayed lifecycle tick settles all five once and preserves their cadence.
const end = H.state.auction.endsAt;
const previousIds = rounds().map((round) => round.id);
assert.equal(H.processAuctionLifecycle(end + 2_345), true);
assertSynchronized(end + 2_345);
assert.equal(H.state.auction.startsAt, end);
assert.equal(H.state.auction.endsAt, end + duration);
assert.ok(rounds().every((round) => !previousIds.includes(round.id)));
assert.equal(player.auctionEscrow.length, 0);
assert.equal(H.state.auctionHistory.length, 5);
assert.equal(H.processAuctionLifecycle(end + 2_346), false);
assert.equal(H.state.auctionHistory.length, 5);
const resumedAt = end + duration * 4 + 1_234;
assert.equal(H.processAuctionLifecycle(resumedAt), true);
assertSynchronized(resumedAt);
assert.equal(H.state.auction.startsAt, end + duration * 4);
assert.equal(H.state.auction.endsAt, end + duration * 5);

// Live DOM adapters exercise the real HUD, hall clock, progress and reminder code.
let now = resumedAt;
let view = H.snapshotFor(player, now);
const node = () => ({ textContent: "", hidden: false, style: {}, classList: { toggle() {} }, closest: () => null });
const hudClock = node();
const clock = node();
const label = node();
const meter = { setAttribute(key, value) { this[key] = value; } };
const bar = { ...node(), closest: () => meter };
const reminder = node();
const root = () => ({ innerHTML: "", querySelectorAll: () => [] });
const els = { auctionHalls: root(), roughPool: root(), auctionHeadTitle: node(), auctionHeadDesc: node(), auctionBackBtn: node(),
  topHud: { ...root(), querySelector: (selector) => selector === '[data-hud="clock"]' ? hudClock : null },
  auctionBrief: { ...root(), querySelector: (selector) => ({ "[data-auction-clock]": clock,
    "[data-auction-clock-label]": label, "[data-auction-clock-bar]": bar })[selector] || null } };
globalThis.document = { querySelector: () => null, addEventListener() {},
  querySelectorAll: (selector) => selector === "[data-remind-auction-eta]" ? [reminder] : [] };
globalThis.window = { addEventListener() {} };
bindFormatDeps({ getNowMs: () => now, getState: () => view });
bindTopHudDeps({ getState: () => view, getEls: () => els, auctionPhaseMeta });
bindSidePanelDeps({ getState: () => view, getEls: () => els, auctionPhaseMeta });
initAuctionModule({ socket: { emit() {} }, getState: () => view, els, getActiveView: () => "auction",
  helpers: { formatMoney: String, formatDuration, nowMs: () => now, escapeHtml: String, empty: String,
    showToast() {}, paintJades() {}, setView() {}, clampClient: (n) => n, CSS: {}, tickHudClock } });
const liveEnd = view.auction.endsAt;
for (const remain of [180_999, 120_001, 120_000, 60_001, 999, 1, 0]) {
  now = liveEnd - remain;
  renderTopHud();
  renderAuction();
  assert.match(els.topHud.innerHTML, new RegExp(`data-hud="clock">${formatDuration(remain)}<`));
  assert.match(els.auctionBrief.innerHTML, new RegExp(`data-auction-clock>${formatDuration(remain)}<`));
  tickAuctionClock(now);
  tickReminderCountdowns(now);
  assert.equal(hudClock.textContent, formatDuration(remain));
  assert.equal(clock.textContent, hudClock.textContent);
  assert.equal(reminder.textContent, hudClock.textContent);
  assert.equal(bar.style.width, `${Math.max(0, remain / duration * 100)}%`);
  assert.equal(meter["aria-valuenow"], String(Math.round(auctionCountdownPct())));
}
now = liveEnd - 180_999;
const roundLabel = auctionRoundLabel();
for (const hall of view.auctionHalls) {
  // Paid entry is acknowledged through the same snapshot path as the browser.
  assert.equal(H.enterAuctionForPlayer(player, { hallId: hall.id }, now).ok, true);
  view = H.snapshotFor(player, now);
  enterAuctionHall(hall.id);
  assert.equal(auctionRoundLabel(), roundLabel);
  assert.match(els.auctionBrief.innerHTML, /data-auction-clock>03:01</);
  assert.equal(hudClock.textContent, "03:01", "switching halls immediately patches the HUD clock");
  assert.equal(els.auctionHeadDesc.hidden, true);
  assert.equal(els.auctionHeadDesc.textContent, "");
  assert.equal(els.auctionBackBtn.hidden, false);
  backAuctionHalls();
  assert.match(els.auctionBrief.innerHTML, /data-auction-clock>03:01</);
}
console.log("auction-clock-smoke: synchronized halls, legacy repair, escrow retention, delayed rollover/restart, shared HUD/reminder rounding and hall switches ok");
