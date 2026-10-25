/**
 * WorldStore — persistence boundary for the shared game world.
 *
 * Services keep mutating `store.raw` (same shape as the old `state` bag) via getState().
 * JSON and SQLite persistence adapters hydrate/flush through
 * exportSnapshot/importSnapshot without rewriting gameplay service call sites.
 */
import {
  WORLD_STORE_VERSION,
  migrateWorldSnapshot,
  requireCanonicalId,
  validateSnapshotShape
} from "./persistence/world-schema.js";
import { createMutationTracking } from "./persistence/mutation-scope.js";

export {
  WORLD_STORE_VERSION,
  migrateWorldSnapshot,
  validateSnapshotShape
} from "./persistence/world-schema.js";

function emptyWorld(seed = {}) {
  return {
    startedAt: Number(seed.startedAt) || Date.now(),
    players: seed.players instanceof Map ? seed.players : new Map(seed.players || []),
    sockets: seed.sockets instanceof Map ? seed.sockets : new Map(seed.sockets || []),
    roughPool: Array.isArray(seed.roughPool) ? [...seed.roughPool] : [],
    listings: Array.isArray(seed.listings) ? [...seed.listings] : [],
    blackListings: Array.isArray(seed.blackListings) ? [...seed.blackListings] : [],
    blackStalls: Array.isArray(seed.blackStalls) ? [...seed.blackStalls] : [],
    blackServiceOrders: Array.isArray(seed.blackServiceOrders) ? [...seed.blackServiceOrders] : [],
    wants: Array.isArray(seed.wants) ? [...seed.wants] : [],
    news: Array.isArray(seed.news) ? [...seed.news] : [],
    worldChat: Array.isArray(seed.worldChat) ? [...seed.worldChat] : [],
    auction: seed.auction ?? null,
    auctionRounds: structuredClone(seed.auctionRounds || {}),
    latestAuctionResults: Array.isArray(seed.latestAuctionResults)
      ? [...seed.latestAuctionResults]
      : [],
    auctionHistory: Array.isArray(seed.auctionHistory) ? [...seed.auctionHistory] : [],
    mining: seed.mining && typeof seed.mining === "object" ? structuredClone(seed.mining) : null,
    equipmentShop: structuredClone(seed.equipmentShop || null)
  };
}

function refillMap(target, entries) {
  target.clear();
  for (const [key, value] of entries || []) target.set(String(key), value);
}

function refillArray(target, values) {
  target.length = 0;
  if (Array.isArray(values)) target.push(...values);
}

export function createMemoryWorldStore(seed = {}) {
  const raw = emptyWorld(seed);
  const mutations = createMutationTracking(raw, validateSnapshotShape, WORLD_STORE_VERSION);

  const store = {
    beginMutation(savedAt = Date.now()) {
      return mutations.begin(savedAt);
    },
    /** Mutable world bag — identical shape to the former server `state` object. */
    get raw() {
      return raw;
    },

    get startedAt() {
      return raw.startedAt;
    },

    getPlayer(id) {
      if (id == null || id === "") return null;
      return raw.players.get(String(id)) || null;
    },

    hasPlayer(id) {
      if (id == null || id === "") return false;
      return raw.players.has(String(id));
    },

    setPlayer(player) {
      const playerId = requireCanonicalId(player?.id, "player.id");
      raw.players.set(playerId, player);
      return player;
    },

    deletePlayer(id) {
      if (id == null || id === "") return false;
      return raw.players.delete(String(id));
    },

    allPlayers() {
      return [...raw.players.values()];
    },

    bindSocket(socketId, playerId) {
      const socketKey = requireCanonicalId(socketId, "socket id");
      const playerKey = requireCanonicalId(playerId, "socket player id");
      if (!raw.players.has(playerKey)) {
        throw new Error(`world-store: cannot bind socket to unknown player ${playerKey}`);
      }
      raw.sockets.set(socketKey, playerKey);
    },

    unbindSocket(socketId) {
      return raw.sockets.delete(String(socketId));
    },

    playerIdForSocket(socketId) {
      if (socketId == null || socketId === "") return null;
      return raw.sockets.get(String(socketId)) || null;
    },

    socketCountForPlayer(playerId) {
      const id = String(playerId || "");
      let count = 0;
      for (const bound of raw.sockets.values()) {
        if (bound === id) count += 1;
      }
      return count;
    },

    clear({ keepStartedAt = true } = {}) {
      raw.players.clear();
      raw.sockets.clear();
      refillArray(raw.roughPool, []);
      refillArray(raw.listings, []);
      refillArray(raw.blackListings, []);
      refillArray(raw.blackStalls, []);
      refillArray(raw.blackServiceOrders, []);
      refillArray(raw.wants, []);
      refillArray(raw.news, []);
      refillArray(raw.worldChat, []);
      raw.auction = null;
      raw.auctionRounds = {};
      refillArray(raw.latestAuctionResults, []);
      refillArray(raw.auctionHistory, []);
      raw.mining = null;
      raw.equipmentShop = null;
      if (!keepStartedAt) raw.startedAt = Date.now();
    },

    /**
     * JSON-safe persistence envelope. Maps become entry arrays.
     * Socket bindings are process-local transport state and are never saved.
     * Callers may structuredClone again before writing to disk.
     */
    exportSnapshot({ savedAt = Date.now() } = {}) {
      const snapshotAt = Number.isFinite(Number(savedAt)) ? Number(savedAt) : Date.now();
      const onlinePlayerIds = new Set(raw.sockets.values());
      const snapshot = {
        version: WORLD_STORE_VERSION,
        startedAt: raw.startedAt,
        players: [...raw.players.entries()].map(([id, player]) => {
          const savedPlayer = structuredClone(player);
          if (onlinePlayerIds.has(id)) savedPlayer.lastSeenAt = snapshotAt;
          return [id, savedPlayer];
        }),
        sockets: [],
        roughPool: structuredClone(raw.roughPool),
        listings: structuredClone(raw.listings),
        blackListings: structuredClone(raw.blackListings),
        blackStalls: structuredClone(raw.blackStalls),
        blackServiceOrders: structuredClone(raw.blackServiceOrders),
        wants: structuredClone(raw.wants),
        news: structuredClone(raw.news),
        worldChat: structuredClone(raw.worldChat),
        auction: structuredClone(raw.auction),
        auctionRounds: structuredClone(raw.auctionRounds),
        latestAuctionResults: structuredClone(raw.latestAuctionResults),
        auctionHistory: structuredClone(raw.auctionHistory),
        mining: structuredClone(raw.mining),
        equipmentShop: structuredClone(raw.equipmentShop)
      };
      return validateSnapshotShape(snapshot);
    },

    /**
     * Restore into the existing `raw` object identity so `const state = world.raw`
     * aliases remain valid across load cycles.
     */
    importSnapshot(snapshot) {
      snapshot = validateSnapshotShape(migrateWorldSnapshot(snapshot));
      raw.startedAt = Number(snapshot.startedAt) || Date.now();
      refillMap(raw.players, snapshot.players || []);
      // A restarted process cannot reuse Socket.IO connection ids. Ignore
      // legacy snapshot bindings so offline settlement and reconnect work.
      raw.sockets.clear();
      refillArray(raw.roughPool, snapshot.roughPool);
      refillArray(raw.listings, snapshot.listings);
      refillArray(raw.blackListings, snapshot.blackListings || []);
      refillArray(raw.blackStalls, snapshot.blackStalls || []);
      refillArray(raw.blackServiceOrders, snapshot.blackServiceOrders || []);
      refillArray(raw.wants, snapshot.wants);
      refillArray(raw.news, snapshot.news);
      refillArray(raw.worldChat, snapshot.worldChat || []);
      raw.auction = snapshot.auction ?? null;
      raw.auctionRounds = structuredClone(snapshot.auctionRounds || {});
      refillArray(raw.latestAuctionResults, snapshot.latestAuctionResults);
      refillArray(raw.auctionHistory, snapshot.auctionHistory);
      raw.mining = snapshot.mining ? structuredClone(snapshot.mining) : null;
      raw.equipmentShop = structuredClone(snapshot.equipmentShop || null);
      return store;
    }
  };

  return store;
}
