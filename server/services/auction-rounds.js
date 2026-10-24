import { publicAuctionSnapshot } from "../../shared/domain/auction/jade-auction.js";

// Keep the legacy primary round intact when loading an existing world. Other
// halls live alongside it; selecting a hall never replaces another hall's round.
export function auctionRoundsForState(state) {
  return [state.auction, ...Object.values(state.auctionRounds || {})].filter(Boolean);
}

export function auctionRoundForHall(state, hallId) {
  return auctionRoundsForState(state).find((round) => (round.hallId || "novice") === hallId) || null;
}

export function storeAuctionRound(state, round) {
  if (!state.auction || (state.auction.hallId || "novice") === round.hallId) {
    state.auction = round;
  } else {
    (state.auctionRounds ||= {})[round.hallId] = round;
  }
  return round;
}

export function auctionResultsForHall(state, round) {
  return state.auctionHistory.find((entry) => entry.hallId === round?.hallId)?.results
    || (round === state.auction ? state.latestAuctionResults : []) || [];
}

export function publicAuctionRounds(state, playerId, now) {
  return Object.fromEntries(auctionRoundsForState(state).map((round) => [
    round.hallId || "novice",
    publicAuctionSnapshot(round, playerId, now, auctionResultsForHall(state, round))
  ]));
}
