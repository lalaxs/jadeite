// Explicit composition; internal imports form a directed acyclic graph.
import { createAchievementRewards } from "../achievement-rewards-instance.js";
import { createContext } from "./instances/context.js";
import { createResources } from "./instances/resources.js";
import { createHelpers } from "./instances/helpers.js";
import { createBlind } from "./instances/blind.js";
import { createNpcOffcut } from "./instances/npc-offcut.js";
import { createNpcJadeFinish } from "./instances/npc-jade-finish.js";
import { createNpcFinishPlans } from "./instances/npc-finish-plans.js";
import { createNpcCatalog } from "./instances/npc-catalog.js";
import { createNpc } from "./instances/npc.js";
import { createRating } from "./instances/rating.js";
import { createRecovery } from "./instances/recovery.js";
import { createService } from "./instances/service.js";
import { createStall } from "./instances/stall.js";
import { createBlackmarketCustomers } from "./npc-customers.js";

export function createBlackmarketModules(getApi, settlePlayerAchievements) {
  const context = createContext({
    getApi,
    settlePlayerAchievements
  });
  const resources = createResources({
    requireApi: context.requireApi
  });
  const helpers = createHelpers({
    requireApi: context.requireApi,
    lockResource: resources.lockResource,
    unlockResource: resources.unlockResource
  });
  const blind = createBlind({
    requireApi: context.requireApi,
    denyUnlessBmBuy: context.denyUnlessBmBuy,
    denyUnlessBmStall: context.denyUnlessBmStall,
    bumpBmDeal: context.bumpBmDeal,
    PLAN_LIST_TYPES: helpers.PLAN_LIST_TYPES,
    ITEM_TYPES: helpers.ITEM_TYPES,
    findStallByOwner: helpers.findStallByOwner,
    findStallById: helpers.findStallById,
    stallDisplayName: helpers.stallDisplayName,
    takeBmListEntries: helpers.takeBmListEntries,
    rollbackBmTaken: helpers.rollbackBmTaken,
    returnItemToPlayer: helpers.returnItemToPlayer,
    removeStallFromState: helpers.removeStallFromState,
    tryActivateStall: helpers.tryActivateStall,
    syncBlindPause: helpers.syncBlindPause,
    averageBlindPoolRefPrice: helpers.averageBlindPoolRefPrice,
    paySellerNow: helpers.paySellerNow,
    pushPendingRatings: helpers.pushPendingRatings
  });
  const npcOffcut = createNpcOffcut({
    buildLeftoverMaterial: helpers.buildLeftoverMaterial
  });
  const npcJadeFinish = createNpcJadeFinish({

  });
  const npcFinishPlans = createNpcFinishPlans({

  });
  const npcCatalog = createNpcCatalog({
    createNpcOffcut: npcOffcut.createNpcOffcut,
    NPC_OFFCUT_POLICY_VERSION: npcOffcut.NPC_OFFCUT_POLICY_VERSION,
    completeNpcJadeAppearance: npcJadeFinish.completeNpcJadeAppearance,
    createNpcFinishPlan: npcFinishPlans.createNpcFinishPlan,
    applyNpcCraftScore: npcFinishPlans.applyNpcCraftScore,
    npcFinishSignature: npcFinishPlans.npcFinishSignature
  });
  const npc = createNpc({
    requireApi: context.requireApi,
    denyUnlessBmBuy: context.denyUnlessBmBuy,
    createNpcGoodsRow: npcCatalog.createNpcGoodsRow,
    npcRandom: npcCatalog.npcRandom,
    upgradeNpcOffcutRow: npcCatalog.upgradeNpcOffcutRow,
    repriceNpcGoodsRow: npcCatalog.repriceNpcGoodsRow,
    completeNpcJadeAppearance: npcJadeFinish.completeNpcJadeAppearance,
    npcFinishStyle: npcFinishPlans.npcFinishStyle,
    resourceBuyerBlock: resources.resourceBuyerBlock,
    receiveResource: resources.receiveResource
  });
  const rating = createRating({
    requireApi: context.requireApi,
    clamp: helpers.clamp
  });
  const recovery = createRecovery({
    requireApi: context.requireApi,
    reconcileResourceListings: resources.reconcileResourceListings,
    findEscrowItemForOrder: helpers.findEscrowItemForOrder,
    paySellerNow: helpers.paySellerNow,
    releaseDepositSafe: helpers.releaseDepositSafe,
    removeEscrowItemFromSeller: helpers.removeEscrowItemFromSeller,
    removeStallFromState: helpers.removeStallFromState,
    returnHeldItemToBuyer: helpers.returnHeldItemToBuyer
  });
  const service = createService({
    requireApi: context.requireApi,
    denyUnlessBmBuy: context.denyUnlessBmBuy,
    denyUnlessBmStall: context.denyUnlessBmStall,
    bumpBmDeal: context.bumpBmDeal,
    clamp: helpers.clamp,
    ITEM_TYPES: helpers.ITEM_TYPES,
    blackMaskForPlayerId: helpers.blackMaskForPlayerId,
    findStallByOwner: helpers.findStallByOwner,
    findStallById: helpers.findStallById,
    tryActivateStall: helpers.tryActivateStall,
    paySellerNow: helpers.paySellerNow,
    pushPendingRatings: helpers.pushPendingRatings,
    attachEscrowItemToSeller: helpers.attachEscrowItemToSeller,
    removeEscrowItemFromSeller: helpers.removeEscrowItemFromSeller,
    removeStallFromState: helpers.removeStallFromState,
    findEscrowItemForOrder: helpers.findEscrowItemForOrder,
    returnHeldItemToBuyer: helpers.returnHeldItemToBuyer,
    returnEscrowItemToBuyer: helpers.returnEscrowItemToBuyer,
    itemMatchesAcceptScopes: helpers.itemMatchesAcceptScopes,
    releaseDepositSafe: helpers.releaseDepositSafe,
    desensitizePlayerName: helpers.desensitizePlayerName,
    publicInputItemRef: helpers.publicInputItemRef,
    publicCapabilitySnapshot: helpers.publicCapabilitySnapshot,
    bmRatingSampleCountForPlayer: rating.bmRatingSampleCountForPlayer,
    SATISFACTION_BASELINE: rating.SATISFACTION_BASELINE
  });
  const stall = createStall({
    requireApi: context.requireApi,
    denyUnlessBmBuy: context.denyUnlessBmBuy,
    denyUnlessBmStall: context.denyUnlessBmStall,
    bumpBmDeal: context.bumpBmDeal,
    STALL_TYPES: helpers.STALL_TYPES,
    ITEM_TYPES: helpers.ITEM_TYPES,
    PLAN_LIST_TYPES: helpers.PLAN_LIST_TYPES,
    blackMaskForPlayerId: helpers.blackMaskForPlayerId,
    findStallByOwner: helpers.findStallByOwner,
    findStallById: helpers.findStallById,
    stallDisplayName: helpers.stallDisplayName,
    takeBmListEntries: helpers.takeBmListEntries,
    rollbackBmTaken: helpers.rollbackBmTaken,
    returnItemToPlayer: helpers.returnItemToPlayer,
    tryActivateStall: helpers.tryActivateStall,
    closeGoodsStallIfEmpty: helpers.closeGoodsStallIfEmpty,
    removeStallFromState: helpers.removeStallFromState,
    averageBlindPoolRefPrice: helpers.averageBlindPoolRefPrice,
    paySellerNow: helpers.paySellerNow,
    pushPendingRatings: helpers.pushPendingRatings,
    buildRatingDisplay: rating.buildRatingDisplay,
    ownerRawSatisfaction: rating.ownerRawSatisfaction,
    defaultServiceProfile: service.defaultServiceProfile,
    buildServiceSnapshot: service.buildServiceSnapshot,
    buildServiceProfileOptions: service.buildServiceProfileOptions,
    applyServiceCuration: service.applyServiceCuration,
    buildServiceProof: service.buildServiceProof,
    sortServiceOffers: service.sortServiceOffers,
    publicServiceOffer: service.publicServiceOffer,
    ensureBlindStallResolvedPrice: blind.ensureBlindStallResolvedPrice,
    resolvedBlindStallPrice: blind.resolvedBlindStallPrice,
    publicBlindDrawSession: blind.publicBlindDrawSession,
    isNpcBlackStall: npc.isNpcBlackStall,
    buyNpcBlackmarketGoods: npc.buyNpcBlackmarketGoods,
    ownedResource: resources.ownedResource,
    resourceBuyerBlock: resources.resourceBuyerBlock,
    receiveResource: resources.receiveResource,
    releaseSoldResource: resources.releaseSoldResource
  });
  return {
    "context": context,
    "resources": resources,
    "helpers": helpers,
    "blind": blind,
    "npc-offcut": npcOffcut,
    "npc-jade-finish": npcJadeFinish,
    "npc-finish-plans": npcFinishPlans,
    "npc-catalog": npcCatalog,
    "npc": npc,
    "rating": rating,
    "recovery": recovery,
    "service": service,
    "stall": stall
  };
}

import { BM_SERVICE_TEMPLATES } from "../../../shared/domain/blackmarket/bm-service-templates.js";
import {
  BLACKMARKET_TAX,
  BLACKMARKET_MIN_PRICE,
  BLACKMARKET_GOODS_CAP,
  BLACKMARKET_BLIND_MIN,
  BLACKMARKET_BLIND_CAP,
  BLACKMARKET_BLIND_DRAW_COUNT,
  BLACKMARKET_BLIND_DRAW_TIMEOUT_MS,
  BLACKMARKET_BLIND_EXTRA_RATES,
  BLACKMARKET_RATING_TTL_MS,
  BM_EARLY_SUBMIT_REP_PENALTY,
  BM_TIMEOUT_REP_PENALTY,
  BM_SELLER_CANCEL_REP_PENALTY,
  BM_ACCEPT_TIMEOUT_MS,
  BLACKMARKET_PER_PLAYER_CAP,
  BM_SERVICE_PROFILE_CAPS
} from "../../../shared/domain/blackmarket/bm-constants.js";

export function createBlackmarketService(deps) {
  const modules = createBlackmarketModules(() => deps, createAchievementRewards({ earnCash: deps?.earnCash }).settlePlayerAchievements);
  const customers = createBlackmarketCustomers({ ...deps, closeGoodsStallIfEmpty: modules.helpers.closeGoodsStallIfEmpty, bumpBmDeal: modules.context.bumpBmDeal });
  return {
    BM_SERVICE_TEMPLATES: BM_SERVICE_TEMPLATES,
    BLACKMARKET_TAX: BLACKMARKET_TAX,
    BLACKMARKET_MIN_PRICE: BLACKMARKET_MIN_PRICE,
    BLACKMARKET_GOODS_CAP: BLACKMARKET_GOODS_CAP,
    BLACKMARKET_BLIND_MIN: BLACKMARKET_BLIND_MIN,
    BLACKMARKET_BLIND_CAP: BLACKMARKET_BLIND_CAP,
    BLACKMARKET_BLIND_DRAW_COUNT: BLACKMARKET_BLIND_DRAW_COUNT,
    BLACKMARKET_BLIND_DRAW_TIMEOUT_MS: BLACKMARKET_BLIND_DRAW_TIMEOUT_MS,
    BLACKMARKET_BLIND_EXTRA_RATES: BLACKMARKET_BLIND_EXTRA_RATES,
    BLACKMARKET_RATING_TTL_MS: BLACKMARKET_RATING_TTL_MS,
    BM_EARLY_SUBMIT_REP_PENALTY: BM_EARLY_SUBMIT_REP_PENALTY,
    BM_TIMEOUT_REP_PENALTY: BM_TIMEOUT_REP_PENALTY,
    BM_SELLER_CANCEL_REP_PENALTY: BM_SELLER_CANCEL_REP_PENALTY,
    BM_ACCEPT_TIMEOUT_MS: BM_ACCEPT_TIMEOUT_MS,
    BLACKMARKET_PER_PLAYER_CAP: BLACKMARKET_PER_PLAYER_CAP,
    BM_SERVICE_PROFILE_CAPS: BM_SERVICE_PROFILE_CAPS,
    maintainNpcBlackmarket: modules["npc"].maintainNpcBlackmarket,
    processBlackmarketCustomers: customers.processBlackmarketCustomers,
    visitBlackStallForPlayer: modules.stall.visitBlackStallForPlayer,
    reconcileBlackmarketReferences: modules["recovery"].reconcileBlackmarketReferences,
    blackMaskForPlayerId: modules["helpers"].blackMaskForPlayerId,
    findStallByOwner: modules["helpers"].findStallByOwner,
    findStallById: modules["helpers"].findStallById,
    BM_RATING_MIN_SAMPLES: modules["rating"].BM_RATING_MIN_SAMPLES,
    bmRatingSampleCountForPlayer: modules["rating"].bmRatingSampleCountForPlayer,
    buildRatingDisplay: modules["rating"].buildRatingDisplay,
    submitBlackmarketRatingForPlayer: modules["rating"].submitBlackmarketRatingForPlayer,
    collectBlackmarketPayoutForPlayer: modules["rating"].collectBlackmarketPayoutForPlayer,
    defaultServiceProfile: modules["service"].defaultServiceProfile,
    normalizeServiceProfile: modules["service"].normalizeServiceProfile,
    buildServiceProfileOptions: modules["service"].buildServiceProfileOptions,
    applyServiceCuration: modules["service"].applyServiceCuration,
    buildOfferCapabilityRefs: modules["service"].buildOfferCapabilityRefs,
    freezeOrderCapabilitySnapshot: modules["service"].freezeOrderCapabilitySnapshot,
    buildServiceProof: modules["service"].buildServiceProof,
    buildServiceSnapshot: modules["service"].buildServiceSnapshot,
    computeOrderFinished: modules["service"].computeOrderFinished,
    linkWorkshopJobToServiceOrder: modules["service"].linkWorkshopJobToServiceOrder,
    refreshBlackServiceOrderStates: modules["service"].refreshBlackServiceOrderStates,
    updateServiceProfileForPlayer: modules["service"].updateServiceProfileForPlayer,
    addServiceOfferForPlayer: modules["service"].addServiceOfferForPlayer,
    removeServiceOfferForPlayer: modules["service"].removeServiceOfferForPlayer,
    orderBlackServiceForPlayer: modules["service"].orderBlackServiceForPlayer,
    acceptBlackServiceForPlayer: modules["service"].acceptBlackServiceForPlayer,
    submitBlackServiceForPlayer: modules["service"].submitBlackServiceForPlayer,
    deliverBlackServiceForPlayer: modules["service"].deliverBlackServiceForPlayer,
    confirmBlackServiceForPlayer: modules["service"].confirmBlackServiceForPlayer,
    cancelBlackServiceForPlayer: modules["service"].cancelBlackServiceForPlayer,
    processExpiredBlackServiceOrders: modules["service"].processExpiredBlackServiceOrders,
    publicServiceOrdersForPlayer: modules["service"].publicServiceOrdersForPlayer,
    resolvedBlindStallPrice: modules["blind"].resolvedBlindStallPrice,
    ensureBlindStallResolvedPrice: modules["blind"].ensureBlindStallResolvedPrice,
    addBlindboxItemsForPlayer: modules["blind"].addBlindboxItemsForPlayer,
    withdrawBlindboxItemForPlayer: modules["blind"].withdrawBlindboxItemForPlayer,
    startBlindboxDrawForPlayer: modules["blind"].startBlindboxDrawForPlayer,
    settleBlindboxDrawForPlayer: modules["blind"].settleBlindboxDrawForPlayer,
    processExpiredBlindDraws: modules["blind"].processExpiredBlindDraws,
    buyBlindboxFromStallForPlayer: modules["blind"].buyBlindboxFromStallForPlayer,
    publicBlackStall: modules["stall"].publicBlackStall,
    publicBlackListing: modules["stall"].publicBlackListing,
    signedStallListings: modules["stall"].signedStallListings,
    sweepEmptyBlackGoodsStalls: modules["stall"].sweepEmptyBlackGoodsStalls,
    openBlackStallForPlayer: modules["stall"].openBlackStallForPlayer,
    closeBlackStallForPlayer: modules["stall"].closeBlackStallForPlayer,
    setBlackStallPausedForPlayer: modules["stall"].setBlackStallPausedForPlayer,
    updateBlackStallMetaForPlayer: modules["stall"].updateBlackStallMetaForPlayer,
    addGoodsToStallForPlayer: modules["stall"].addGoodsToStallForPlayer,
    withdrawGoodsFromStallForPlayer: modules["stall"].withdrawGoodsFromStallForPlayer,
    addGoodsBatchToStallForPlayer: modules["stall"].addGoodsBatchToStallForPlayer,
    buyGoodsFromStallForPlayer: modules["stall"].buyGoodsFromStallForPlayer,
    stallInventoryItemsForPlayer: modules["stall"].stallInventoryItemsForPlayer,
    listBlackItemForPlayer: modules["stall"].listBlackItemForPlayer,
    buyBlackListingForPlayer: modules["stall"].buyBlackListingForPlayer,
    withdrawBlackListingForPlayer: modules["stall"].withdrawBlackListingForPlayer
  };
}
