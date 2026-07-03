import assert from "node:assert/strict";
import {
  auctionPhase,
  bidDeposit,
  upsertBid,
  aiBidsForRough,
  settleAuctionRound,
  publicAuctionSnapshot
} from "../public/jade-auction.js";

const round = {
  id: "round-1",
  startsAt: 1_000,
  biddingEndsAt: 2_000,
  settlesAt: 2_000,
  roughs: [
    { id: "r1", name: "木那料", price: 10000, value: 18000, trueValue: 18000 },
    { id: "r2", name: "会卡料", price: 6000, value: 9000, trueValue: 9000 }
  ],
  bids: []
};

assert.equal(auctionPhase(round, 500), "preview");
assert.equal(auctionPhase(round, 1500), "bidding");
assert.equal(auctionPhase(round, 2500), "settled");
assert.equal(bidDeposit(10000), 2000);

const first = upsertBid(round, { playerId: "p1", roughId: "r1", amount: 12000, proxyMax: 15000, at: 1200 });
assert.equal(first.depositDelta, 2400);
assert.equal(first.round.bids.length, 1);

const second = upsertBid(first.round, { playerId: "p1", roughId: "r1", amount: 14000, proxyMax: 17000, at: 1300 });
assert.equal(second.depositDelta, 400);
assert.equal(second.round.bids[0].amount, 14000);
assert.equal(second.round.bids[0].proxyMax, 17000);

const third = upsertBid(second.round, { playerId: "p2", roughId: "r1", amount: 16500, at: 1250 });
const ai = aiBidsForRough(round.roughs[0], third.round.bids, 3);
assert.ok(ai.length >= 1);
assert.ok(ai.every((bid) => bid.ai === true));

const settled = settleAuctionRound({ ...third.round, bids: [...third.round.bids, ...ai] }, { minIncrement: 100 });
const r1 = settled.results.find((result) => result.roughId === "r1");
assert.equal(r1.winnerId, "p1");
assert.equal(r1.price, 16600);
assert.equal(r1.depositUsed, 2800);
assert.equal(r1.balanceDue, 13800);

const publicView = publicAuctionSnapshot(third.round, "p1", 1500);
assert.equal(publicView.phase, "bidding");
assert.equal(publicView.myBids.length, 1);
assert.equal(publicView.roughs[0].currentHighest, undefined);
assert.equal(publicView.roughs[0].bidderCount, undefined);

console.log("Jade sealed auction checks passed");
