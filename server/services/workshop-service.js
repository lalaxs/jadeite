// Workshop composition and legacy public API. Business behavior lives in narrow instance factories.
import { createWorkshopInventory } from "./workshop/inventory.js";
import { createWorkshopQueries } from "./workshop/queries.js";
import { createWorkshopProducts } from "./workshop/products.js";
import { createWorkshopCommands } from "./workshop/commands.js";
import { createWorkshopCompletion } from "./workshop/completion.js";
import { createWorkshopRuntime } from "./workshop/runtime.js";
import { createWorkshopRoster } from "./workshop-roster.js";
import { createWorkshopPlanning } from "./workshop-planning.js";
import { createWorkshopDeliveryService } from "./workshop-delivery.js";

export function createWorkshopService(deps) {
  const {
    money,
    clamp,
    spendCash,
    takeItem,
    markInventoryItemNew,
    normalizePlayer,
    materialStageFor,
    qualityByKey,
    refreshPlayerReport,
    advanceTask,
    addNews,
    emitUiEventToPlayer,
    getState,
    isPlayerOnline,
    broadcast,
    randomUUID,
    TIMING_PROFILE
  } = deps;

  const {
    normalizeWorkshop,
    starterDevices,
    mergeWorkerSkills,
    WORKSHOP_WORKER_DEFS
  } = createWorkshopRoster({ clamp, makeId: randomUUID });

  const {
    normalizeAngle,
    angleDistance,
    cutAngleName,
    makeSliceBoard,
    normalizePlan,
    normalizePlacement,
    normalizePlacements,
    openingTplForKit,
    openingKitFromExtractionKit,
    extractionKitsOverlap,
    normalizeExtractionKits,
    expandKitPlacements,
    kitProductMeta,
    placementFootprint,
    templateWidthOnBoard,
    placementsOverlap,
    scoreSlicePlacement,
    scoreSlicePlan,
    scoreRoughPlacement,
    revealPolishedRough
  } = createWorkshopPlanning({ clamp, money, qualityByKey, randomUUID });

  const { restoreWorkshopItem, restoreRoughToInventory, inheritEscrowMeta } = createWorkshopInventory({
    materialStageFor
  });

  const { workshopDevicesForPlayer, workshopDeviceForPlayer, workshopWorkerForPlayer, legacyDeviceIdForStage, workshopJobsForDevice, workshopProcessableItems, playerOwnsWorkshop, findWorkshopItem } = createWorkshopQueries({
    normalizePlayer, materialStageFor, normalizeWorkshop
  });

  const { wsApplyWorker, openingStoneForRough, openingKitForPlacement, extractProductsFromJob, productBaseName, stagedProduct } = createWorkshopProducts({
    money, clamp, randomUUID, openingTplForKit, normalizeExtractionKits, expandKitPlacements, kitProductMeta, scoreRoughPlacement
  });

  const { storeWorkshopDelivery, revealWorkshopDeliveryForPlayer, claimWorkshopDeliveryForPlayer } = createWorkshopDeliveryService({
    normalizePlayer, restoreWorkshopItem, markInventoryItemNew, refreshPlayerReport, randomUUID,
    onClaim: (player) => deps.refillOrders?.(player)
  });

  const { startProductionJob, startRoughOpeningForPlayer, startWorkshopJobForPlayer, assignWorkshopWorkerForPlayer } = createWorkshopCommands({
    money, spendCash, takeItem, normalizePlayer, materialStageFor, refreshPlayerReport, broadcast, randomUUID, TIMING_PROFILE, openingKitFromExtractionKit, extractionKitsOverlap, normalizeExtractionKits, expandKitPlacements, workshopDeviceForPlayer, workshopWorkerForPlayer, workshopJobsForDevice, playerOwnsWorkshop, restoreWorkshopItem, findWorkshopItem, openingStoneForRough
  });

  const { applyJobDurability, completeProductionJob } = createWorkshopCompletion({
    settlePlayerAchievements: deps.settlePlayerAchievements,
    money, clamp, getState, normalizeExtractionKits, expandKitPlacements, revealPolishedRough, storeWorkshopDelivery, workshopDeviceForPlayer, workshopWorkerForPlayer, restoreWorkshopItem, inheritEscrowMeta, openingStoneForRough, openingKitForPlacement, extractProductsFromJob, stagedProduct
  });

  const { normalizeProductionJob, settleProductionJobsForPlayer, processProductionJobs } = createWorkshopRuntime({
    normalizePlayer, refreshPlayerReport, advanceTask, addNews, emitUiEventToPlayer, getState, isPlayerOnline, broadcast, workshopWorkerForPlayer, completeProductionJob
  });

  return {
    workshopDevicesForPlayer,
    workshopDeviceForPlayer,
    workshopWorkerForPlayer,
    workshopJobsForDevice,
    workshopProcessableItems,
    playerOwnsWorkshop,
    legacyDeviceIdForStage,
    wsApplyWorker,
    restoreWorkshopItem,
    findWorkshopItem,
    restoreRoughToInventory,
    startProductionJob,
    startRoughOpeningForPlayer,
    startWorkshopJobForPlayer,
    extractProductsFromJob,
    productBaseName,
    stagedProduct,
    applyJobDurability,
    completeProductionJob,
    revealWorkshopDeliveryForPlayer,
    claimWorkshopDeliveryForPlayer,
    normalizeProductionJob,
    settleProductionJobsForPlayer,
    processProductionJobs,
    assignWorkshopWorkerForPlayer,
    normalizeAngle,
    angleDistance,
    cutAngleName,
    makeSliceBoard,
    normalizePlan,
    normalizePlacement,
    normalizePlacements,
    openingTplForKit,
    openingKitFromExtractionKit,
    extractionKitsOverlap,
    normalizeExtractionKits,
    expandKitPlacements,
    kitProductMeta,
    placementFootprint,
    templateWidthOnBoard,
    placementsOverlap,
    scoreSlicePlacement,
    scoreSlicePlan,
    scoreRoughPlacement,
    revealPolishedRough,
    normalizeWorkshop,
    starterDevices,
    mergeWorkerSkills,
    WORKSHOP_WORKER_DEFS
  };
}
