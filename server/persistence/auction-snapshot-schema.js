import { AUCTION_HALLS } from "../../shared/domain/auction/jade-auction.js";
import { requireArrayField, requireCanonicalId, normalizeNonNegativeNumber, normalizeOptionalTimestamp } from "./world-schema-utils.js";

export function validateAuctionState(snapshot) {
  const extras = snapshot.auctionRounds ?? {};
  if (!extras || typeof extras !== "object" || Array.isArray(extras)) throw new Error("world-store: auctionRounds must be an object");
  const halls = new Set(snapshot.auction ? [snapshot.auction.hallId || "novice"] : []);
  const rounds = [["snapshot.auction", snapshot.auction]];
  for (const [hallId, round] of Object.entries(extras)) {
    if (!AUCTION_HALLS.some((hall) => hall.id === hallId) || round?.hallId !== hallId || halls.has(hallId)) {
      throw new Error("world-store: invalid or duplicate auction hall");
    }
    requireCanonicalId(round.id, `auctionRounds.${hallId}.id`);
    halls.add(hallId);
    rounds.push([`snapshot.auctionRounds.${hallId}`, round]);
  }
  const roundIds = new Set();
  const roughIds = new Set();
  for (const [label, round] of rounds) {
    if (round == null) continue;
    if (!round || typeof round !== "object" || Array.isArray(round)) throw new Error(`world-store: ${label} must be an object`);
    if (round.id && roundIds.has(round.id)) throw new Error("world-store: duplicate auction round id");
    if (round.id) roundIds.add(round.id);
    normalizeNonNegativeNumber(round, "entryFee", label, { optional: true });
    const start = normalizeOptionalTimestamp(round, "startsAt", label);
    for (const field of ["biddingEndsAt", "endsAt"]) {
      const end = normalizeOptionalTimestamp(round, field, label);
      if (start != null && end != null && end < start) throw new Error(`world-store: ${label}.${field} must not be before startsAt`);
    }
    normalizeOptionalTimestamp(round, "settledAt", label);
    for (const entry of requireArrayField(round, "entries", label)) normalizeNonNegativeNumber(entry, "fee", label, { optional: true });
    for (const bid of requireArrayField(round, "bids", label)) normalizeNonNegativeNumber(bid, "amount", label);
    for (const rough of requireArrayField(round, "roughs", label)) {
      if (roughIds.has(rough.id)) throw new Error("world-store: duplicate auction rough id");
      roughIds.add(rough.id);
    }
  }
}
