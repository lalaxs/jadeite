import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WORLD_STORE_VERSION,
  createMemoryWorldStore
} from "../server/world-store.js";

const store = createMemoryWorldStore({ startedAt: 1_000 });
assert.equal(store.startedAt, 1_000);
assert.ok(store.raw);
assert.equal(store.raw.players instanceof Map, true);
assert.equal(store.raw.sockets instanceof Map, true);

const player = { id: "p1", name: "翠店", cash: 1000, lastSeenAt: 250 };
store.setPlayer(player);
store.setPlayer({ id: "p2", name: "离线店", cash: 500, lastSeenAt: 123 });
assert.equal(store.hasPlayer("p1"), true);
assert.equal(store.getPlayer("p1"), player);
assert.deepEqual(store.allPlayers().map((row) => row.id), ["p1", "p2"]);

store.bindSocket("sock-a", "p1");
store.bindSocket("sock-b", "p1");
assert.equal(store.playerIdForSocket("sock-a"), "p1");
assert.equal(store.socketCountForPlayer("p1"), 2);
assert.equal(store.unbindSocket("sock-a"), true);
assert.equal(store.socketCountForPlayer("p1"), 1);
assert.throws(
  () => store.bindSocket("sock-missing", "missing-player"),
  /cannot bind socket to unknown player missing-player/,
  "runtime socket bindings must not point at a missing player"
);
assert.equal(store.playerIdForSocket("sock-missing"), null);
assert.throws(
  () => store.setPlayer({ id: " padded-player " }),
  /player\.id must be a canonical string id/,
  "new runtime players must use the same canonical ids as restored players"
);

store.raw.listings.push({
  id: "L1",
  ownerId: "p1",
  price: 9000,
  item: { id: "listed-item", type: "bracelet" }
});
store.raw.blackListings.push({ id: "B1", ownerId: "p1", price: 50, maskName: "夜摊·ABCD" });
store.raw.blackStalls.push({ id: "S1", ownerId: "p1", type: "goods", title: "夜摊" });
store.raw.wants.push({ id: "W1", ownerId: "p1", status: "open" });
store.raw.auction = { id: "round-1", status: "live", roughs: [] };
store.raw.news.push({ id: "n1", text: "开市" });
store.raw.worldChat.push({ id: "c1", speaker: "翠店", text: "你好", at: 1000, channel: "world" });

const snap = store.exportSnapshot({ savedAt: 5_000 });
assert.equal(snap.version, WORLD_STORE_VERSION);
assert.equal(snap.players.length, 2);
assert.equal(snap.players.find(([id]) => id === "p1")?.[1]?.lastSeenAt, 5_000);
assert.equal(snap.players.find(([id]) => id === "p2")?.[1]?.lastSeenAt, 123);
assert.equal(player.lastSeenAt, 250, "save export must not mutate the live online player");
assert.deepEqual(snap.sockets, [], "process-local sockets must not enter world snapshots");
assert.equal(snap.listings[0].id, "L1");
assert.equal(snap.blackListings[0].id, "B1");
assert.equal(snap.blackStalls[0].id, "S1");
assert.equal(snap.auction.id, "round-1");
assert.equal(snap.worldChat[0].id, "c1");

const other = createMemoryWorldStore();
const rawRef = other.raw;
other.importSnapshot(snap);
assert.equal(other.raw, rawRef, "import must keep raw object identity");
assert.equal(other.getPlayer("p1")?.name, "翠店");
assert.equal(other.raw.listings[0].id, "L1");
assert.equal(other.raw.blackListings[0].id, "B1");
assert.equal(other.raw.blackStalls[0].id, "S1");
assert.equal(other.raw.wants[0].id, "W1");
assert.equal(other.raw.auction.id, "round-1");
assert.equal(other.raw.worldChat[0].id, "c1");
assert.equal(other.playerIdForSocket("sock-b"), null, "snapshot import must not revive stale sockets");
assert.equal(other.socketCountForPlayer("p1"), 0);

const legacyWithSocket = { ...snap, sockets: [["stale-socket", "p1"]] };
other.importSnapshot(legacyWithSocket);
assert.equal(other.raw.sockets.size, 0, "legacy persisted sockets are ignored");

assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: [...snap.players, ["p1", { ...snap.players[0][1] }]]
  }),
  /duplicate player entry p1/,
  "duplicate player records must not silently overwrite each other"
);
assert.equal(other.getPlayer("p1")?.cash, 1000, "failed validation keeps the loaded world intact");

assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: [[123, { ...snap.players[0][1], id: 123 }]]
  }),
  /player entry key must be a canonical string id/,
  "numeric ids must not load under Map keys that reconnect strings cannot find"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: [[" padded-player ", { ...snap.players[0][1], id: " padded-player " }]]
  }),
  /player entry key must be a canonical string id/,
  "padded ids must not become unreachable after reconnect input is trimmed"
);
assert.equal(other.getPlayer("p1")?.cash, 1000, "identity validation failures keep the loaded world intact");

assert.throws(
  () => other.importSnapshot({
    ...snap,
    listings: [snap.listings[0], structuredClone(snap.listings[0])]
  }),
  /duplicate listings entry L1/,
  "duplicate transaction ids must not make a client action target an arbitrary record"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    blackStalls: [
      {
        ...snap.blackStalls[0],
        items: [{ id: "BL1", price: 100, item: { id: "black-item-1" } }]
      },
      {
        ...snap.blackStalls[0],
        id: "S2",
        ownerId: "p2",
        items: [{ id: "BL1", price: 100, item: { id: "black-item-2" } }]
      }
    ]
  }),
  /duplicate black stall listing BL1/,
  "legacy listing-only actions require globally unambiguous black-market listing ids"
);
assert.equal(other.raw.listings.length, 1, "transaction validation failures keep live records intact");

assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, {
        ...savedPlayer,
        rough: [{ id: "shared-owned-item" }],
        materials: [{ id: "shared-owned-item" }]
      }]
      : [id, savedPlayer])
  }),
  /duplicate owned item shared-owned-item/,
  "one item id must not be spendable from two player inventory locations"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, {
        ...savedPlayer,
        orders: [{ id: "order-1" }, { id: "order-1" }]
      }]
      : [id, savedPlayer])
  }),
  /duplicate player p1\.orders entry order-1/,
  "duplicate order ids must not let completion target an arbitrary order"
);
assert.equal(other.getPlayer("p1")?.cash, 1000, "nested validation failures keep the loaded world intact");

assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, { ...savedPlayer, bracelets: [{ id: "double-owned-item" }] }]
      : [id, savedPlayer]),
    listings: [
      ...snap.listings,
      {
        id: "L2",
        ownerId: "p1",
        price: 500,
        item: { id: "double-owned-item" }
      }
    ]
  }),
  /duplicate owned item double-owned-item/,
  "an escrowed listing item must not remain spendable in player inventory"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    wants: [{
      id: "W2",
      ownerId: "p1",
      offers: [
        { id: "offer-1", price: 100, item: { id: "offer-item-a" } },
        { id: "offer-1", price: 100, item: { id: "offer-item-b" } }
      ]
    }]
  }),
  /duplicate wants\[0\]\.offers entry offer-1/,
  "duplicate offer ids must not make withdrawal or settlement ambiguous"
);
assert.equal(other.raw.listings.length, 1, "escrow validation failures keep live records intact");

assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, {
        ...savedPlayer,
        workshop: {
          devices: [{ id: "device-1" }, { id: "device-1" }],
          workers: []
        }
      }]
      : [id, savedPlayer])
  }),
  /duplicate player p1\.workshop\.devices entry device-1/,
  "duplicate device ids must not make repair or production target an arbitrary machine"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, {
        ...savedPlayer,
        workshop: { devices: [], workers: [{ id: "worker-1" }] },
        recruitCandidates: [{ id: "worker-1" }]
      }]
      : [id, savedPlayer])
  }),
  /recruit candidate worker-1 is already a hired worker/,
  "a hired worker must not remain recruitable under the same id"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    blackStalls: [
      snap.blackStalls[0],
      { id: "S2", ownerId: "p1", type: "service", offers: [] }
    ]
  }),
  /duplicate black stall owner p1/,
  "one player must not own multiple stalls that owner-scoped actions cannot distinguish"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    blackStalls: [{
      id: "S3",
      ownerId: "p3",
      type: "service",
      offers: [{ id: "offer-1", price: 100 }, { id: "offer-1", price: 100 }]
    }]
  }),
  /duplicate blackStalls\[0\]\.offers entry offer-1/,
  "duplicate service offer ids must not make orders target an arbitrary offer"
);
assert.equal(other.raw.blackStalls.length, 1, "facility validation failures keep live records intact");

assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, {
        ...savedPlayer,
        tasks: [
          { uid: "daily-duplicate", target: 1, progress: 0, reward: 100, status: "active" },
          { uid: "daily-duplicate", target: 1, progress: 0, reward: 100, status: "active" }
        ]
      }]
      : [id, savedPlayer])
  }),
  /duplicate player p1\.tasks entry daily-duplicate/,
  "duplicate task ids must not make a reward claim target an arbitrary task"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, {
        ...savedPlayer,
        tasks: [{ uid: "unfinished-claim", target: 2, progress: 1, reward: 100, status: "claimed" }]
      }]
      : [id, savedPlayer])
  }),
  /incomplete progress cannot be claimed/,
  "an incomplete task must not enter the claimed state"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, {
        ...savedPlayer,
        jobs: [{
          id: "backwards-job",
          startedAt: 2_000,
          readyAt: 1_000,
          item: { id: "backwards-job-item" }
        }]
      }]
      : [id, savedPlayer])
  }),
  /readyAt must not be before startedAt/,
  "production jobs must not finish before they start"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    players: snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, {
        ...savedPlayer,
        workshop: { devices: [{ id: "over-repaired", condition: 101 }], workers: [] }
      }]
      : [id, savedPlayer])
  }),
  /condition must not exceed 100/,
  "device condition must stay within its gameplay range"
);
assert.throws(
  () => other.importSnapshot({
    ...snap,
    auction: {
      ...snap.auction,
      startsAt: 2_000,
      biddingEndsAt: 1_500,
      endsAt: 1_500
    }
  }),
  /biddingEndsAt must not be before startsAt/,
  "auction settlement windows must not run backwards"
);
assert.equal(other.getPlayer("p1")?.cash, 1000, "time and counter validation failures keep the loaded world intact");

const invalidLiveStore = createMemoryWorldStore();
invalidLiveStore.setPlayer({
  id: "invalid-live-player",
  cash: 0,
  rough: [{ id: "live-duplicate" }],
  materials: [{ id: "live-duplicate" }]
});
assert.throws(
  () => invalidLiveStore.exportSnapshot(),
  /duplicate owned item live-duplicate/,
  "export must reject corrupt live state before it can replace a healthy save"
);

const numericLegacy = structuredClone(snap);
numericLegacy.players[0][1].cash = "1250";
numericLegacy.players[0][1].lastSeenAt = "250";
numericLegacy.players[0][1].tasks = [{
  uid: "legacy-numeric-task",
  target: "2",
  progress: "1",
  reward: "100",
  status: "active"
}];
numericLegacy.listings[0].price = "9000";
numericLegacy.blackListings[0].price = "50";
const normalizedNumbers = createMemoryWorldStore();
normalizedNumbers.importSnapshot(numericLegacy);
assert.equal(normalizedNumbers.getPlayer("p1")?.cash, 1250);
assert.equal(typeof normalizedNumbers.getPlayer("p1")?.cash, "number");
assert.equal(normalizedNumbers.getPlayer("p1")?.lastSeenAt, 250);
assert.equal(typeof normalizedNumbers.getPlayer("p1")?.lastSeenAt, "number");
assert.equal(normalizedNumbers.getPlayer("p1")?.tasks[0].target, 2);
assert.equal(typeof normalizedNumbers.getPlayer("p1")?.tasks[0].reward, "number");
assert.equal(normalizedNumbers.raw.listings[0].price, 9000);
assert.equal(typeof normalizedNumbers.raw.listings[0].price, "number");

for (const [label, invalidPlayers, expected] of [
  [
    "null cash",
    snap.players.map(([id, savedPlayer]) => id === "p1" ? [id, { ...savedPlayer, cash: null }] : [id, savedPlayer]),
    /player p1\.cash must be a finite non-negative number/
  ],
  [
    "negative material balance",
    snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, { ...savedPlayer, externalMaterials: { goldPure: -1 } }]
      : [id, savedPlayer]),
    /externalMaterials\.goldPure must be a finite non-negative number/
  ],
  [
    "invalid pending payout",
    snap.players.map(([id, savedPlayer]) => id === "p1"
      ? [id, { ...savedPlayer, payouts: [{ amount: Infinity }] }]
      : [id, savedPlayer]),
    /payouts\[0\]\.amount must be a finite non-negative number/
  ]
]) {
  assert.throws(
    () => other.importSnapshot({ ...snap, players: invalidPlayers }),
    expected,
    `${label} must not cross the persistence boundary`
  );
}

assert.throws(
  () => other.importSnapshot({
    ...snap,
    listings: [{ ...snap.listings[0], price: NaN }]
  }),
  /listings\[0\]\.price must be a finite non-negative number/,
  "a non-finite listing price must not turn into null on disk"
);
assert.equal(other.getPlayer("p1")?.cash, 1000, "numeric validation failures keep the loaded world intact");

const legacy = { ...snap, version: 1 };
const migrated = createMemoryWorldStore();
migrated.importSnapshot(legacy);
assert.equal(migrated.getPlayer("p1")?.cash, 1000, "v1 snapshots should migrate in place");

other.clear();
assert.equal(other.allPlayers().length, 0);
assert.equal(other.raw.listings.length, 0);
assert.equal(other.raw.blackListings.length, 0);
assert.equal(other.raw.blackStalls.length, 0);
assert.equal(other.raw.worldChat.length, 0);
assert.equal(other.raw.auction, null);

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
const socketHandlersSource = readFileSync("server/shell/socket-handlers.js", "utf8");
assert.match(bootSource, /from "\.\.\/world-store\.js"/);
assert.match(bootSource, /createMemoryWorldStore\(\)/);
assert.match(bootSource, /createWorldPersister/);
assert.match(bootSource, /const state = world\.raw/);
assert.match(socketHandlersSource, /world\.bindSocket/);
assert.match(socketHandlersSource, /world\.unbindSocket/);
assert.match(bootSource, /world,\s*\n\s*state/);
console.log("world-store-smoke: memory store + server wiring ok");
