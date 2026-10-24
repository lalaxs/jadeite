/**
 * Socket events that mutate saveable simulation state.
 *
 * Debug helpers stay outside this set so development workflows remain explicit
 * and do not consume the player's production request-id history.
 */
export const MUTATION_SOCKET_EVENTS = new Set([
  "setName",
  "sendWorldChat",
  "submitAuctionBid",
  "joinAuction",
  "enterAuction",
  "requestWindow",
  "startPolish",
  "refreshRecruitCandidates",
  "recruitWorker",
  "dismissWorker",
  "payEmployeePayroll",
  "resumeEmployeeWork",
  "miningApply",
  "miningCancelApplication",
  "miningSaveTuningExperiment",
  "miningReviewTuningExperiment",
  "miningCancelTuningVersion",
  "miningRollbackTuningVersion",
  "miningRefreshCandidates",
  "miningRecruitMiner",
  "miningDismissMiner",
  "miningTrainMiner",
  "miningCareMiner",
  "miningResolveMinerRetention",
  "miningFormMentorship",
  "miningEndMentorship",
  "miningSpecializeMiner",
  "miningRenewMinerContract",
  "miningPromoteMiner",
  "miningUpgradeFacility",
  "miningStartShift",
  "miningResolveIncident",
  "buyWorkshopDevice",
  "repairWorkshopDevice",
  "startWorkshopJob",
  "startCommission",
  "claimCommission",
  "revealWorkshopDelivery",
  "claimWorkshopDelivery",
  "assignWorkshopWorker",
  "extractFromRough",
  "collectBracelet",
  "returnCollectionItem",
  "startLivestreamRoom",
  "replenishLivestreamRoom",
  "closeLivestreamRoom",
  "buyLivestreamRoomItem",
  "scheduleLivestream",
  "livestreamSell",
  "completeOrder",
  "listItem",
  "buyAssetListing",
  "buyMaterialPack",
  "buyListing",
  "acceptMarketOffer",
  "requestRecovery",
  "markInventorySeen",
  "recycleInventoryItem",
  "withdrawListing",
  "refreshOrders",
  "refreshOrderSlot",
  "collectPayout",
  "bmOpenStall",
  "bmCloseStall",
  "bmPauseStall",
  "bmUpdateStallMeta",
  "bmSetStallAnonymous",
  "bmUpdateServiceProfile",
  "bmListItem",
  "bmAddBlindItems",
  "bmWithdrawBlindItem",
  "bmBuyListing",
  "bmBuyBlindbox",
  "bmSettleBlindDraw",
  "bmWithdrawListing",
  "bmAddServiceOffer",
  "bmRemoveServiceOffer",
  "bmOrderService",
  "bmAcceptService",
  "bmSubmitService",
  "bmDeliverService",
  "bmConfirmService",
  "bmCancelService",
  "bmSubmitRating",
  "bmCollectPayout",
  "postWant",
  "cancelWant",
  "applyWant",
  "withdrawWantOffer",
  "settleWant",
  "task:claim",
  "achievement:claim",
  "achievement:claimAll",
  "task:reset"
]);

// Server durability also covers acknowledgement flags that intentionally keep
// their compact legacy payload shape and therefore do not use mutationEnvelope.
export const DURABLE_SOCKET_EVENTS = new Set([
  ...MUTATION_SOCKET_EVENTS,
  "ackAuctionSettle",
  "ackLivestreamSettle",
  "ackEmployeePayrollSettle"
]);

export function normalizeMutationPacketPayload(packet) {
  if (!Array.isArray(packet) || !MUTATION_SOCKET_EVENTS.has(String(packet[0] || ""))) {
    return false;
  }
  if (packet[1] !== null) return false;
  packet[1] = {};
  return true;
}
