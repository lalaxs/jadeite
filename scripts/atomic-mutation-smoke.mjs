import assert from "node:assert/strict";
import {
  attemptAtomicMutation,
  runAtomicMutation
} from "../server/services/atomic-mutation.js";

const buyer = {
  id: "atomic-buyer",
  cash: 1_000,
  bracelets: [],
  ledger: []
};
const seller = {
  id: "atomic-seller",
  cash: 500,
  payouts: []
};
const listings = [{ id: "atomic-listing", item: { id: "atomic-item" } }];
const before = structuredClone({ buyer, seller, listings });

assert.throws(
  () => runAtomicMutation([buyer, seller, listings], () => {
    buyer.cash -= 300;
    buyer.bracelets.push(listings[0].item);
    seller.payouts.push({ amount: 300 });
    listings.splice(0, 1);
    throw new Error("injected downstream failure");
  }),
  /injected downstream failure/
);
assert.deepEqual(buyer, before.buyer, "buyer state must roll back in place");
assert.deepEqual(seller, before.seller, "seller state must roll back in place");
assert.deepEqual(listings, before.listings, "world collection must roll back in place");

let committedEffect = 0;
const failed = attemptAtomicMutation(
  [buyer, seller],
  ({ afterCommit }) => {
    buyer.cash -= 100;
    seller.cash += 100;
    afterCommit(() => { committedEffect += 1; });
    throw new Error("credit failure");
  }
);
assert.equal(failed.ok, false);
assert.equal(failed.code, "TRANSACTION_ABORTED");
assert.equal(buyer.cash, 1_000);
assert.equal(seller.cash, 500);
assert.equal(committedEffect, 0, "notifications must not run for rolled-back mutations");

const committed = attemptAtomicMutation(
  [buyer, seller],
  ({ afterCommit }) => {
    buyer.cash -= 100;
    seller.cash += 100;
    afterCommit(() => { committedEffect += 1; });
    return { ok: true };
  }
);
assert.equal(committed.ok, true);
assert.equal(buyer.cash, 900);
assert.equal(seller.cash, 600);
assert.equal(committedEffect, 1);

const playerIdentity = buyer;
const world = {
  players: new Map([[buyer.id, buyer]]),
  sockets: new Map([["socket-1", buyer.id]]),
  auction: { id: "round-1", status: "live" }
};
assert.throws(() => runAtomicMutation([world], () => {
  buyer.cash = 0;
  world.auction = { id: "round-2", status: "live" };
  world.players.set("temporary", { id: "temporary", cash: 10 });
  throw new Error("world rollback");
}), /world rollback/);
assert.equal(world.players.get(buyer.id), playerIdentity, "world rollback must preserve live player identity");
assert.equal(world.players.has("temporary"), false);
assert.equal(buyer.cash, 900);
assert.equal(world.auction.id, "round-1");

console.log("atomic-mutation-smoke: rollback + post-commit effects ok");
