import { readFileSync } from "node:fs";
import { readClientShellSource } from "./load-client-shell.mjs";
import assert from "node:assert/strict";
import { buildAuctionSettleModalEvent } from "../public/jade-auction.js";
import { __testHooks } from "../server.js";

const mainEntry = readFileSync("public/main.js", "utf8");
const main = readClientShellSource();
assert.match(main, /function isGameModalOpenWithId\b/);
assert.match(main, /pendingAuctionSettle/);
assert.doesNotMatch(
  main,
  /rememberUiEvent\(\{ id: modal\.id \}\)\)\s*\{\s*socket\.emit\(["']ackAuctionSettle/
);

const {
  makePlayer,
  normalizePlayer,
  enterAuctionForPlayer,
  ensureAuctionRound,
  settleAuctionIfDue,
  ackAuctionSettleForPlayer,
  state
} = __testHooks;

state.players.clear();
state.sockets.clear();
state.auction = null;
state.auctionHistory = [];
state.latestAuctionResults = [];
state.roughPool.length = 0;
state.news.length = 0;

const player = makePlayer("settle-modal-1");
normalizePlayer(player);
player.cash = 200_000;
state.players.set(player.id, player);
state.sockets.set("sock-1", player.id);

const t0 = Date.now();
ensureAuctionRound(t0);
assert.equal(enterAuctionForPlayer(player, { hallId: "novice" }, t0).ok, true);
state.auction.endsAt = t0 - 1;
state.auction.biddingEndsAt = t0 - 1;
assert.equal(settleAuctionIfDue(t0), true);
assert.ok(player.pendingAuctionSettle?.roundId);
assert.equal(player.pendingAuctionSettle?.hallId, "novice");

const modal = buildAuctionSettleModalEvent(player.pendingAuctionSettle, (n) => `¥${n}`);
assert.equal(modal.type, "modal");
assert.equal(modal.title, "公盘已结束");
assert.equal(modal.id, `auction-settle:${player.id}:${player.pendingAuctionSettle.roundId}`);
assert.match(modal.modalClass, /auction-settle-modal--novice/);
assert.match(modal.modalClass, /is-empty/);
assert.ok(Array.isArray(modal.actions));
assert.equal(modal.actions[0]?.clientAction, "ackAuctionSettle");
const bodyText = Array.isArray(modal.body) ? modal.body.join("\n") : String(modal.body || "");
assert.doesNotMatch(bodyText, /共花费/);

const winModal = buildAuctionSettleModalEvent({
  playerId: player.id,
  roundId: "r-win",
  hallId: "special",
  hallLabel: "特别公盘",
  wins: [{ roughName: "测试料", roughId: "r1" }],
  losses: [],
  spentTotal: 112840,
  refundedTotal: 0,
  bidCount: 1
}, (n) => `¥${n}`);
assert.deepEqual(winModal.body, ["您已拍得：测试料"]);
assert.match(winModal.modalClass, /auction-settle-modal--special/);
assert.match(winModal.modalClass, /is-win/);
assert.doesNotMatch(winModal.body.join("\n"), /共花费|已退还/);
assert.deepEqual(winModal.stats, [{ label: "拍得", value: "1 件" }]);
assert.equal(winModal.report.spentTotal, 112840);
assert.equal(winModal.report.refundedTotal, 0);

const legacyModal = buildAuctionSettleModalEvent({
  playerId: player.id,
  roundId: "r-legacy",
  hallLabel: "传奇公盘",
  wins: [],
  losses: [],
  spentTotal: 0,
  refundedTotal: 0,
  bidCount: 0
}, (n) => `¥${n}`);
assert.match(legacyModal.modalClass, /auction-settle-modal--legendary/);

assert.equal(ackAuctionSettleForPlayer(player, player.pendingAuctionSettle.roundId).cleared, true);
assert.equal(player.pendingAuctionSettle, null);

console.log("auction-settle-modal-smoke: ok");
