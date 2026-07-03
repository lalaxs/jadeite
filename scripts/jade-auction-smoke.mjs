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

const zeroTimeBid = upsertBid(round, { playerId: "p0", roughId: "r1", amount: 10000, at: 0 });
assert.equal(zeroTimeBid.bid.at, 0);

const first = upsertBid(round, { playerId: "p1", roughId: "r1", amount: 12000, proxyMax: 15000, at: 1200 });
assert.equal(first.depositDelta, 2400);
assert.equal(first.round.bids.length, 1);

const second = upsertBid(first.round, { playerId: "p1", roughId: "r1", amount: 14000, proxyMax: 17000, at: 1300 });
assert.equal(second.depositDelta, 400);
assert.equal(second.round.bids[0].amount, 14000);
assert.equal(second.round.bids[0].proxyMax, 17000);

const lowered = upsertBid(second.round, { playerId: "p1", roughId: "r1", amount: 10000, at: 1350 });
assert.equal(lowered.depositDelta, -800);

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
assert.deepEqual(publicView.myBids.map((bid) => bid.roughId), ["r1"]);
assert.equal(Object.hasOwn(publicView, "bids"), false);
assert.equal(Object.hasOwn(publicView.roughs[0], "trueValue"), false);
assert.equal(Object.hasOwn(publicView.roughs[0], "value"), false);
assert.equal(publicView.roughs[0].currentHighest, undefined);
assert.equal(publicView.roughs[0].bidderCount, undefined);
assert.deepEqual(publicView.results, []);

const tieSettled = settleAuctionRound(
  {
    id: "tie-round",
    roughs: [{ id: "tie-r1", name: "Tie rough", price: 10000 }],
    bids: [
      { playerId: "early", roughId: "tie-r1", amount: 10000, proxyMax: 15000, at: 100 },
      { playerId: "late", roughId: "tie-r1", amount: 10000, proxyMax: 15000, at: 200 }
    ]
  },
  { minIncrement: 100, now: 0 }
);
assert.equal(tieSettled.results[0].winnerId, "early");
assert.equal(tieSettled.settledAt, 0);

const malformedProxySettled = settleAuctionRound(
  {
    id: "malformed-proxy-round",
    roughs: [{ id: "raw-r1", name: "Raw rough", price: 10000 }],
    bids: [{ playerId: "raw", roughId: "raw-r1", amount: 10000, proxyMax: 5000, at: 100 }]
  },
  { minIncrement: 100 }
);
assert.equal(malformedProxySettled.results[0].price, 10000);

const zeroIncrementSettled = settleAuctionRound(
  {
    id: "zero-increment-round",
    roughs: [{ id: "zero-r1", name: "Zero increment rough", price: 10000 }],
    bids: [
      { playerId: "high", roughId: "zero-r1", amount: 10000, proxyMax: 12000, at: 100 },
      { playerId: "runner", roughId: "zero-r1", amount: 10000, proxyMax: 11000, at: 200 }
    ]
  },
  { minIncrement: 0, now: 0 }
);
assert.equal(zeroIncrementSettled.results[0].price, 11000);
assert.equal(zeroIncrementSettled.settledAt, 0);

const existingAi = aiBidsForRough(round.roughs[1], [], 2);
const repeatedAi = aiBidsForRough(round.roughs[1], existingAi, 3);
const aiIds = [...existingAi, ...repeatedAi].map((bid) => bid.playerId);
assert.equal(new Set(aiIds).size, aiIds.length);

console.log("Jade sealed auction checks passed");
