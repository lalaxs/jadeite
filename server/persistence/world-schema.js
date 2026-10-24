/**
 * Versioned world snapshot migration and integrity validation.
 *
 * This module is intentionally independent from the live in-memory store so
 * persistence adapters can validate data before it reaches gameplay services.
 */
import {
  requireCanonicalId,
  validateUniqueRecordIds,
  validateUniqueRecordField,
  requireArrayField,
  normalizeNonNegativeNumber,
  normalizeOptionalTimestamp,
  validateTimeOrder,
  validateFiniteNumbers,
  registerOwnedItem
} from "./world-schema-utils.js";
import { validatePlayerState } from "./player-snapshot-schema.js";
import { validateMiningWorld } from "./mining-snapshot-schema.js";
import { validateNpcBlackStall } from "./blackmarket-npc-schema.js";
import { validateAuctionState } from "./auction-snapshot-schema.js";

export { requireCanonicalId } from "./world-schema-utils.js";

export const WORLD_STORE_VERSION = 2;

export function migrateWorldSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("world-store: snapshot object required");
  }
  const version = Number(snapshot.version);
  if (version === WORLD_STORE_VERSION) return snapshot;
  if (version === 1) {
    return {
      ...snapshot,
      version: WORLD_STORE_VERSION,
      meta: {
        ...(snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : {}),
        migratedFrom: 1,
        migratedAt: Date.now()
      }
    };
  }
  throw new Error(`world-store: unsupported snapshot version ${String(snapshot.version)}`);
}

export function validateSnapshotShape(snapshot) {
  normalizeOptionalTimestamp(snapshot, "startedAt", "snapshot");
  normalizeOptionalTimestamp(snapshot, "savedAt", "snapshot");
  const arrayFields = [
    "players",
    "sockets",
    "roughPool",
    "listings",
    "blackListings",
    "blackStalls",
    "blackServiceOrders",
    "wants",
    "news",
    "worldChat",
    "latestAuctionResults",
    "auctionHistory"
  ];
  for (const field of arrayFields) {
    if (snapshot[field] != null && !Array.isArray(snapshot[field])) {
      throw new Error(`world-store: snapshot.${field} must be an array`);
    }
  }
  const playerIds = new Set();
  const ownedItems = new Map();
  for (const entry of snapshot.players || []) {
    if (!Array.isArray(entry) || entry.length !== 2 || !entry[1] || typeof entry[1] !== "object") {
      throw new Error("world-store: invalid player entry");
    }
    const key = requireCanonicalId(entry[0], "player entry key");
    const playerId = requireCanonicalId(entry[1].id, "player.id");
    if (key !== playerId) {
      throw new Error("world-store: player entry key/id mismatch");
    }
    if (playerIds.has(key)) {
      throw new Error(`world-store: duplicate player entry ${key}`);
    }
    playerIds.add(key);
    validatePlayerState(entry[1], key, ownedItems);
  }
  validateMiningWorld(snapshot.mining);
  validateUniqueRecordIds(snapshot.listings, "listings");
  validateUniqueRecordIds(snapshot.blackListings, "blackListings");
  validateUniqueRecordIds(snapshot.blackStalls, "blackStalls");
  validateUniqueRecordIds(snapshot.blackServiceOrders, "blackServiceOrders");
  validateUniqueRecordIds(snapshot.wants, "wants");

  for (let index = 0; index < (snapshot.listings || []).length; index += 1) {
    normalizeNonNegativeNumber(snapshot.listings[index], "price", `listings[${index}]`);
    normalizeOptionalTimestamp(snapshot.listings[index], "createdAt", `listings[${index}]`);
    registerOwnedItem(ownedItems, snapshot.listings[index].item, `listings[${index}]`);
  }

  for (let index = 0; index < (snapshot.blackListings || []).length; index += 1) {
    normalizeNonNegativeNumber(
      snapshot.blackListings[index],
      "price",
      `blackListings[${index}]`
    );
  }

  for (let wantIndex = 0; wantIndex < (snapshot.wants || []).length; wantIndex += 1) {
    const want = snapshot.wants[wantIndex];
    validateTimeOrder(want, "createdAt", "expiresAt", `wants[${wantIndex}]`);
    normalizeNonNegativeNumber(want, "budget", `wants[${wantIndex}]`, { optional: true });
    normalizeNonNegativeNumber(want, "escrowAmount", `wants[${wantIndex}]`, { optional: true });
    const offers = requireArrayField(want, "offers", `wants[${wantIndex}]`);
    validateUniqueRecordIds(offers, `wants[${wantIndex}].offers`);
    for (let offerIndex = 0; offerIndex < offers.length; offerIndex += 1) {
      normalizeNonNegativeNumber(
        offers[offerIndex],
        "price",
        `wants[${wantIndex}].offers[${offerIndex}]`
      );
      registerOwnedItem(
        ownedItems,
        offers[offerIndex].item,
        `wants[${wantIndex}].offers[${offerIndex}]`
      );
    }
  }

  for (let orderIndex = 0; orderIndex < (snapshot.blackServiceOrders || []).length; orderIndex += 1) {
    const order = snapshot.blackServiceOrders[orderIndex];
    const orderLabel = `blackServiceOrders[${orderIndex}]`;
    for (const field of [
      "createdAt",
      "acceptExpiresAt",
      "acceptedAt",
      "expiresAt",
      "deliveredAt",
      "completedAt"
    ]) {
      normalizeOptionalTimestamp(order, field, orderLabel);
    }
    validateTimeOrder(order, "createdAt", "acceptExpiresAt", orderLabel);
    validateTimeOrder(order, "acceptedAt", "expiresAt", orderLabel);
    validateTimeOrder(order, "createdAt", "deliveredAt", orderLabel);
    validateTimeOrder(order, "createdAt", "completedAt", orderLabel);
    normalizeNonNegativeNumber(order, "price", `blackServiceOrders[${orderIndex}]`);
    normalizeNonNegativeNumber(
      order,
      "feeReleased",
      `blackServiceOrders[${orderIndex}]`,
      { optional: true }
    );
    normalizeNonNegativeNumber(
      order,
      "feeRefunded",
      `blackServiceOrders[${orderIndex}]`,
      { optional: true }
    );
    const heldItem = order.heldItem?.item;
    if (heldItem) {
      registerOwnedItem(
        ownedItems,
        heldItem,
        `blackServiceOrders[${orderIndex}].heldItem`
      );
    }
  }

  const blackListingIds = new Set();
  const blackStallOwnerIds = new Map();
  for (let stallIndex = 0; stallIndex < (snapshot.blackStalls || []).length; stallIndex += 1) {
    const stall = snapshot.blackStalls[stallIndex];
    validateNpcBlackStall(stall);
    normalizeOptionalTimestamp(stall, "createdAt", `blackStalls[${stallIndex}]`);
    normalizeOptionalTimestamp(stall, "updatedAt", `blackStalls[${stallIndex}]`);
    const ownerId = typeof stall.ownerId === "string" ? stall.ownerId.trim() : "";
    if (ownerId) {
      const previousStallId = blackStallOwnerIds.get(ownerId);
      if (previousStallId) {
        throw new Error(
          `world-store: duplicate black stall owner ${ownerId} at ${previousStallId} and ${stall.id}`
        );
      }
      blackStallOwnerIds.set(ownerId, stall.id);
    }

    const offers = requireArrayField(stall, "offers", `blackStalls[${stallIndex}]`);
    validateUniqueRecordIds(offers, `blackStalls[${stallIndex}].offers`);
    for (let offerIndex = 0; offerIndex < offers.length; offerIndex += 1) {
      normalizeNonNegativeNumber(
        offers[offerIndex],
        "price",
        `blackStalls[${stallIndex}].offers[${offerIndex}]`
      );
    }
    normalizeNonNegativeNumber(stall, "blindPrice", `blackStalls[${stallIndex}]`, {
      optional: true
    });
    if (stall.items != null && !Array.isArray(stall.items)) {
      throw new Error(`world-store: blackStalls entry ${stall.id} items must be an array`);
    }
    for (let listingIndex = 0; listingIndex < (stall.items || []).length; listingIndex += 1) {
      const listing = stall.items[listingIndex];
      if (!listing || typeof listing !== "object" || Array.isArray(listing)) {
        throw new Error(`world-store: invalid blackStalls entry ${stall.id} item`);
      }
      const listingId = requireCanonicalId(
        listing.id,
        `blackStalls entry ${stall.id} item id`
      );
      if (blackListingIds.has(listingId)) {
        throw new Error(`world-store: duplicate black stall listing ${listingId}`);
      }
      blackListingIds.add(listingId);
      normalizeNonNegativeNumber(
        listing,
        "price",
        `blackStalls[${stallIndex}].items[${listingIndex}]`
      );
      registerOwnedItem(
        ownedItems,
        // Initial employees still use owner-local IDs while on the shelf;
        // transfer assigns a global ID without changing the seller's payroll.
        listing.type === "employee" && !stall.npc && /^worker-(opening|carving|polishing|finishing)$/.test(listing.item?.id)
          ? { ...listing.item, id: `blackmarket-worker:${ownerId}:${listing.item.id}` } : listing.item,
        `blackStalls[${stallIndex}].items[${listingIndex}]`
      );
    }

    const pool = requireArrayField(stall, "pool", `blackStalls[${stallIndex}]`);
    const draw = stall.blindDraw;
    if (draw != null && (!draw || typeof draw !== "object" || Array.isArray(draw))) {
      throw new Error(`world-store: blackStalls[${stallIndex}].blindDraw must be an object`);
    }
    const candidates = draw
      ? requireArrayField(draw, "candidates", `blackStalls[${stallIndex}].blindDraw`)
      : [];
    if (draw) {
      normalizeNonNegativeNumber(draw, "price", `blackStalls[${stallIndex}].blindDraw`);
      validateTimeOrder(
        draw,
        "startedAt",
        "expiresAt",
        `blackStalls[${stallIndex}].blindDraw`
      );
    }
    const blindRows = [...pool, ...candidates];
    validateUniqueRecordIds(blindRows, `blackStalls[${stallIndex}] blind inventory`);
    for (let rowIndex = 0; rowIndex < blindRows.length; rowIndex += 1) {
      registerOwnedItem(
        ownedItems,
        blindRows[rowIndex].item,
        `blackStalls[${stallIndex}] blind inventory[${rowIndex}]`
      );
    }
  }

  validateAuctionState(snapshot);

  // JSON.stringify silently converts NaN and infinities to null. Reject those
  // values anywhere in the authoritative world before a healthy save rotates.
  validateFiniteNumbers(snapshot);
  return snapshot;
}

