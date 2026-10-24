// Legacy named API. Production wiring uses a separately created instance.
import { createAuctionModule, createAuctionService } from "./auction-instance.js";
import { settlePlayerAchievements } from "./achievement-rewards.js";
export { createAuctionService };
let api = null;
const current = createAuctionModule(() => api, settlePlayerAchievements);
export function bindAuctionApi(nextApi) { api = nextApi; }
export const AUCTION_HALL_LOT_PROFILES = current.AUCTION_HALL_LOT_PROFILES;
export function createAuctionHallRoughs(...args) { return current.createAuctionHallRoughs(...args); }
export function normalizeAuctionEscrow(...args) { return current.normalizeAuctionEscrow(...args); }
export function auctionEscrowForRough(...args) { return current.auctionEscrowForRough(...args); }
export function setAuctionEscrow(...args) { return current.setAuctionEscrow(...args); }
export function applyAuctionBidEscrow(...args) { return current.applyAuctionBidEscrow(...args); }
export function consumeAuctionEscrow(...args) { return current.consumeAuctionEscrow(...args); }
export function refundAuctionEscrow(...args) { return current.refundAuctionEscrow(...args); }
export function refundStaleAuctionEscrows(...args) { return current.refundStaleAuctionEscrows(...args); }
export function reconcileAuctionEscrows(...args) { return current.reconcileAuctionEscrows(...args); }
export function publicAuctionHalls(...args) { return current.publicAuctionHalls(...args); }
export function auctionRoundDuration(...args) { return current.auctionRoundDuration(...args); }
export function auctionEndsAt(...args) { return current.auctionEndsAt(...args); }
export function playerEnteredAuction(...args) { return current.playerEnteredAuction(...args); }
export function createAuctionRound(...args) { return current.createAuctionRound(...args); }
export function ensureAuctionRound(...args) { return current.ensureAuctionRound(...args); }
export function settleAuctionIfDue(...args) { return current.settleAuctionIfDue(...args); }
export function ackAuctionSettleForPlayer(...args) { return current.ackAuctionSettleForPlayer(...args); }
export function processAuctionLifecycle(...args) { return current.processAuctionLifecycle(...args); }
export function enterAuctionForPlayer(...args) { return current.enterAuctionForPlayer(...args); }
export function joinAuctionForPlayer(...args) { return current.joinAuctionForPlayer(...args); }
export function submitAuctionBidForPlayer(...args) { return current.submitAuctionBidForPlayer(...args); }
export function normalizeWindowPayload(...args) { return current.normalizeWindowPayload(...args); }
export function windowTouchesColor(...args) { return current.windowTouchesColor(...args); }
export function windowTouchesCrack(...args) { return current.windowTouchesCrack(...args); }
export function makeWindowReveal(...args) { return current.makeWindowReveal(...args); }
export function requestAuctionWindowForPlayer(...args) { return current.requestAuctionWindowForPlayer(...args); }
