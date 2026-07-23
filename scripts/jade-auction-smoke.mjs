import assert from "node:assert/strict";
import {
  auctionEntryFee,
  auctionPhase,
  bidIncrementOptions,
  enterAuctionRound,
  upsertBid,
  aiBidsForRough,
  settleAuctionRound,
  publicAuctionSnapshot,
  publicAuctionHistoryEntry
} from "../public/jade-auction.js";

const round = {
  id: "round-1",
  hallId: "novice",
  hallLabel: "新手公盘",
  status: "live",
  startsAt: 500,
  endsAt: 1_500,
  entryFee: 5_000,
  roughs: [
    { id: "r1", name: "木那料", price: 10_000, value: 18_000, trueValue: 18_000 },
    { id: "r2", name: "会卡料", price: 600, value: 900, trueValue: 900 }
  ],
  entries: [],
  bids: []
};

assert.equal(auctionPhase(round, 500), "live");
assert.equal(auctionPhase(round, 1_499), "live");
assert.equal(auctionPhase(round, 1_500), "settlement");
assert.equal(auctionPhase({ ...round, settledAt: 1_500 }, 1_600), "settlement");
assert.equal(auctionEntryFee({ entryFee: 800 }), 800);
assert.equal(auctionEntryFee({ deposit: 5_000 }), 5_000);

assert.deepEqual(bidIncrementOptions(999), [50, 100, 200]);
assert.deepEqual(bidIncrementOptions(1_000), [100, 500, 1000]);
assert.deepEqual(bidIncrementOptions(10_000), [1000, 2000, 5000]);
assert.deepEqual(bidIncrementOptions(100_000), [5000, 10000, 20000]);

const entered = enterAuctionRound(round, { playerId: "p1", fee: 5_000, at: 600 });
assert.equal(entered.already, false);
assert.equal(entered.entry.fee, 5_000);
assert.equal(entered.round.entries.length, 1);
const enteredAgain = enterAuctionRound(entered.round, { playerId: "p1", fee: 5_000, at: 700 });
assert.equal(enteredAgain.already, true);
assert.equal(enteredAgain.round.entries.length, 1);

const first = upsertBid(entered.round, { playerId: "p1", roughId: "r1", amount: 12_000, at: 800 });
assert.equal(first.previous, undefined);
assert.equal(first.bid.amount, 12_000);
assert.equal(first.round.bids.length, 1);

const second = upsertBid(first.round, { playerId: "p1", roughId: "r1", amount: 14_000, at: 900 });
assert.equal(second.previous.amount, 12_000);
assert.equal(second.round.bids.length, 1);
assert.equal(second.round.bids[0].amount, 14_000);
assert.equal(Object.hasOwn(second.round.bids[0], "proxyMax"), false);

const directSettled = settleAuctionRound(
  {
    ...round,
    bids: [
      { playerId: "p1", roughId: "r1", amount: 17_000, at: 200 },
      { playerId: "p2", roughId: "r1", amount: 16_500, at: 100 }
    ]
  },
  { now: 2_000 }
);
const directResult = directSettled.results.find((result) => result.roughId === "r1");
assert.equal(directResult.winnerId, "p1");
assert.equal(directResult.roughName, "木那料");
assert.equal(directResult.price, 17_000);
assert.equal(directResult.status, "won");
assert.equal(directResult.bids, 2);
assert.equal(Object.hasOwn(directResult, "depositUsed"), false);
assert.equal(directSettled.settledAt, 2_000);

const tieSettled = settleAuctionRound(
  {
    ...round,
    bids: [
      { playerId: "early", roughId: "r1", amount: 15_000, at: 100 },
      { playerId: "late", roughId: "r1", amount: 15_000, at: 200 }
    ]
  },
  { now: 2_000 }
);
assert.equal(tieSettled.results[0].winnerId, "early");
assert.equal(tieSettled.results[0].price, 15_000);

const belowReserveSettled = settleAuctionRound(
  {
    ...round,
    bids: [{ playerId: "low", roughId: "r1", amount: 9_999, at: 100 }]
  },
  { now: 2_000 }
);
assert.equal(belowReserveSettled.results[0].status, "passed");
assert.equal(belowReserveSettled.results[0].winnerId, undefined);

const skippedSettled = settleAuctionRound(
  {
    ...round,
    bids: [
      { playerId: "rich", roughId: "r1", amount: 20_000, at: 200 },
      { playerId: "payable", roughId: "r1", amount: 15_000, at: 100 }
    ]
  },
  {
    now: 2_000,
    bidderCanPay: (bid) => bid.playerId !== "rich"
  }
);
assert.equal(skippedSettled.results[0].winnerId, "payable");
assert.equal(skippedSettled.results[0].price, 15_000);
assert.equal(skippedSettled.results[0].skippedBids, 1);

const invalidAmountSettled = settleAuctionRound(
  {
    ...round,
    bids: [
      { playerId: "bad", roughId: "r1", amount: "bad", at: 1 },
      { playerId: "valid", roughId: "r1", amount: 10_000, at: 10 }
    ]
  },
  { now: 2_000 }
);
assert.equal(invalidAmountSettled.results[0].winnerId, "valid");

const ai = aiBidsForRough(round.roughs[0], [], 3);
assert.equal(ai.length, 3);
assert.ok(ai.every((bid) => bid.ai === true));
assert.ok(ai.every((bid) => bid.amount > 0));
assert.equal(Object.hasOwn(ai[0], "proxyMax"), false);
const repeatedAi = aiBidsForRough(round.roughs[0], ai, 4);
assert.equal(repeatedAi[0].playerId, `ai-${round.roughs[0].id}-3`);

const sensitiveRound = {
  ...entered.round,
  roughs: [
    {
      id: "secret-r1",
      name: "Secret rough",
      price: 22_000,
      mass: 3.4,
      publicHint: "皮壳完整，开窗有限",
      hint: "hidden high value clue",
      value: 78_000,
      trueValue: 92_000,
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
  bids: [
    { playerId: "p1", roughId: "secret-r1", amount: 24_000, at: 900 },
    { playerId: "p2", roughId: "secret-r1", amount: 40_000, at: 910 }
  ]
};
const publicView = publicAuctionSnapshot(sensitiveRound, "p1", 1_000);
assert.equal(publicView.phase, "live");
assert.equal(publicView.entered, true);
assert.equal(publicView.entryFee, 5_000);
assert.equal(publicView.myBids.length, 1);
assert.equal(publicView.myBids[0].amount, 24_000);
assert.equal(publicView.myBids[0].deposit, undefined);
assert.deepEqual(publicView.roughs[0].bidIncrements, [1000, 2000, 5000]);
assert.equal(Object.hasOwn(publicView, "bids"), false);
assert.equal(Object.hasOwn(publicView.roughs[0], "trueValue"), false);
assert.equal(Object.hasOwn(publicView.roughs[0], "value"), false);
assert.equal(publicView.roughs[0].currentHighest, undefined);
assert.equal(publicView.roughs[0].bidderCount, undefined);
assert.equal(publicView.roughs[0].hint, "皮壳完整，开窗有限");
assert.deepEqual(publicView.roughs[0].windows, [{
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
for (const field of ["bestAngle", "suggestedAngle", "translucency", "cotton"]) {
  assert.equal(Object.hasOwn(publicView.roughs[0].visual, field), false);
}
for (const win of [...publicView.roughs[0].windows, ...publicView.roughs[0].visual.windows]) {
  for (const field of ["translucency", "cotton", "hiddenScore", "bestAngle", "suggestedAngle", "value", "trueValue"]) {
    assert.equal(Object.hasOwn(win, field), false);
  }
}

const outsideView = publicAuctionSnapshot(sensitiveRound, "outside-player", 1_000);
assert.equal(outsideView.phase, "live");
assert.equal(outsideView.entered, false);
assert.equal(outsideView.roughs.length, 0);
assert.equal(outsideView.myBids.length, 0);

const privacyResults = publicAuctionSnapshot(
  sensitiveRound,
  "p1",
  1_000,
  [
    { roughId: "secret-r1", roughName: "Secret rough", winnerId: "p1", status: "won", price: 24_000, bids: 2, hidden: true, trueValue: 92_000 },
    { roughId: "other-r1", roughName: "Other rough", winnerId: "p2", status: "won", price: 13_000, bids: 3, hidden: true },
    { roughId: "ai-r1", winnerId: "ai-ai-r1-0", status: "aiWon", ai: true, price: 11_000, bids: 3, hidden: true },
    { roughId: "passed-r1", status: "passed", price: 0, bids: 0, hidden: true, trueValue: 40_000 }
  ]
).results;
assert.equal(privacyResults[0].winnerId, "p1");
assert.equal(privacyResults[0].roughName, "Secret rough");
assert.equal(privacyResults[1].roughName, "Other rough");
assert.equal(privacyResults[1].winnerId, undefined);
assert.equal(privacyResults[2].winnerId, undefined);
assert.equal(privacyResults[2].ai, true);
assert.equal(privacyResults[3].status, "passed");
for (const result of privacyResults) {
  for (const field of ["hidden", "trueValue", "value"]) {
    assert.equal(Object.hasOwn(result, field), false);
  }
}

const historyEntry = publicAuctionHistoryEntry({
  roundId: "history-round-1",
  hallId: "regular",
  hallLabel: "常规公盘",
  startsAt: 1_000,
  endsAt: 2_000,
  settledAt: 2_000,
  results: [
    { roughId: "history-r1", roughName: "历史料一", winnerId: "p1", status: "won", price: 25_000, bids: 4, hidden: true, trueValue: 80_000 },
    { roughId: "history-r2", roughName: "历史料二", winnerId: "p2", status: "won", price: 18_000, bids: 3, hidden: true, trueValue: 42_000 }
  ]
}, "p1");
assert.equal(historyEntry.roundId, "history-round-1");
assert.equal(historyEntry.hallLabel, "常规公盘");
assert.equal(historyEntry.results[0].winnerId, "p1");
assert.equal(historyEntry.results[1].winnerId, undefined);
for (const result of historyEntry.results) {
  for (const field of ["hidden", "trueValue", "value"]) {
    assert.equal(Object.hasOwn(result, field), false);
  }
}

console.log("Jade 10-minute sealed auction checks passed");
