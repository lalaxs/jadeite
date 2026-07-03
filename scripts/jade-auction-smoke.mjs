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

const sensitiveRound = {
  id: "sensitive-round",
  startsAt: 1_000,
  biddingEndsAt: 2_000,
  roughs: [
    {
      id: "secret-r1",
      name: "Secret rough",
      price: 22000,
      mass: 3.4,
      publicHint: "皮壳完整，开窗有限",
      hint: "hidden high value clue",
      value: 78000,
      trueValue: 92000,
      windows: [{
        id: "win-1",
        x: 24,
        y: 42,
        r: 8,
        seed: 9001,
        skin: "#66736b",
        vein: "#62a87b",
        hasBelt: true,
        hasCrack: false,
        translucency: 0.82,
        cotton: 0.14,
        hiddenScore: 99
      }],
      visual: {
        seed: 4242,
        shape: "chunk",
        maskTone: "#4f5550",
        windows: [{
          id: "visual-win-1",
          x: 12,
          y: 18,
          r: 5,
          translucency: 0.5,
          cotton: 0.2,
          hiddenScore: 77
        }],
        bestAngle: 34,
        suggestedAngle: 28,
        translucency: 0.82,
        cotton: 0.14
      }
    }
  ],
  bids: []
};
const sensitiveView = publicAuctionSnapshot(sensitiveRound, "p1", 1500);
const sensitiveRough = sensitiveView.roughs[0];
assert.equal(sensitiveRough.hint, "皮壳完整，开窗有限");
assert.equal(Object.hasOwn(sensitiveRough, "value"), false);
assert.equal(Object.hasOwn(sensitiveRough, "trueValue"), false);
assert.equal(sensitiveRough.visual.seed, 4242);
assert.equal(sensitiveRough.visual.shape, "chunk");
assert.equal(sensitiveRough.visual.masked, true);
assert.equal(sensitiveRough.visual.maskTone, "#4f5550");
assert.deepEqual(sensitiveRough.windows, [{
  id: "win-1",
  x: 24,
  y: 42,
  r: 8,
  seed: 9001,
  skin: "#66736b",
  vein: "#62a87b",
  hasBelt: true,
  hasCrack: false
}]);
assert.deepEqual(sensitiveRough.visual.windows, sensitiveRough.windows);
for (const field of ["bestAngle", "suggestedAngle", "translucency", "cotton"]) {
  assert.equal(Object.hasOwn(sensitiveRough.visual, field), false);
}
for (const win of [...sensitiveRough.windows, ...sensitiveRough.visual.windows]) {
  for (const field of ["translucency", "cotton", "hiddenScore", "bestAngle", "suggestedAngle", "value", "trueValue"]) {
    assert.equal(Object.hasOwn(win, field), false);
  }
}

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

const missingPlayerSettled = settleAuctionRound(
  {
    id: "missing-player-round",
    roughs: [{ id: "missing-player-r1", name: "Missing player rough", price: 10000 }],
    bids: [
      { roughId: "missing-player-r1", amount: 999999, proxyMax: 999999, at: 1 },
      { playerId: "valid", roughId: "missing-player-r1", amount: 10000, proxyMax: 10000, at: 10 }
    ]
  },
  { minIncrement: 100 }
);
assert.equal(missingPlayerSettled.results[0].winnerId, "valid");

const malformedTimeSettled = settleAuctionRound(
  {
    id: "malformed-time-round",
    roughs: [{ id: "time-r1", name: "Time rough", price: 10000 }],
    bids: [
      { playerId: "bad-time", roughId: "time-r1", amount: 10000, proxyMax: 15000, at: "bad" },
      { playerId: "finite-early", roughId: "time-r1", amount: 10000, proxyMax: 15000, at: 50 }
    ]
  },
  { minIncrement: 100 }
);
assert.equal(malformedTimeSettled.results[0].winnerId, "finite-early");

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

const nonContiguousAi = aiBidsForRough(round.roughs[1], [
  { playerId: "ai-r2-7", roughId: "r2", amount: 7000, proxyMax: 7000, at: 1, ai: true }
], 2);
assert.equal(nonContiguousAi[0].playerId, "ai-r2-8");

const settledPrivacyView = publicAuctionSnapshot(
  {
    id: "settled-privacy-round",
    startsAt: 0,
    biddingEndsAt: 1,
    roughs: [
      { id: "own-r1", name: "Own rough", price: 10000 },
      { id: "other-r1", name: "Other rough", price: 10000 },
      { id: "passed-r1", name: "Passed rough", price: 10000 },
      { id: "malformed-result-r1", name: "Malformed result rough", price: 10000 }
    ],
    bids: [],
    results: [
      { roughId: "own-r1", winnerId: "p1", status: "won", price: 12000 },
      { roughId: "other-r1", winnerId: "p2", status: "won", price: 13000 },
      { roughId: "passed-r1", status: "passed", price: 0 },
      { roughId: "malformed-result-r1", status: "won", price: 999999 }
    ]
  },
  "p1",
  2
);
assert.deepEqual(settledPrivacyView.results.map((result) => result.roughId), ["own-r1", "passed-r1"]);

console.log("Jade sealed auction checks passed");
