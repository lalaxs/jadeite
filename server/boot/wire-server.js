import { createGameLifecycle } from "./game-lifecycle.js";
import { createEquipmentShopService } from "../services/equipment-shop-service.js";
import { createAchievementRewards } from "../services/achievement-rewards-instance.js";
import { randomUUID } from "node:crypto";
import { isFeatureAvailable } from "../../shared/domain/feature-availability.js";
import {
  equipmentCatalog,
  buyEquipment,
  durabilityLoss,
  repairEquipment,
  repairQuote
} from "../systems/equipment-system.js";
import {
  ensureRecruitCandidates,
  refreshRecruitCandidates,
  recruitWorker,
  dismissWorker,
  settleEmployeePayroll,
  mergeWorkers,
  normalizeDismissedStarterIds,
  isWorkerBusy,
  grantActivityExperience,
  baseWageForTier,
  workerProcessingFee
} from "../systems/employee-system.js";
import {
  MAX_MINERS,
  MINER_RECRUIT_REFRESH_COST,
  ensureMinerRecruitCandidates,
  refreshMinerRecruitCandidates,
  recruitMiner,
  dismissMiner,
  trainMiner,
  careForMiner,
  resolveMinerRetention,
  formMinerMentorship,
  endMinerMentorship,
  specializeMiner,
  renewMinerContract,
  promoteMiner,
  normalizeMiningPlayer,
  isMinerBusy,
  refreshMinerCondition,
  minerReadiness,
  applyMinerShiftCondition,
  applyMinerRetentionAfterShift,
  applyMinerMentorshipsForShift
} from "../systems/miner-system.js";
import {
  inlayCatalog,
  validateFinishPlan,
  quoteFinishPlan,
  reserveFinishMaterials,
  refundFinishMaterials,
  applyInlay
} from "../systems/inlay-system.js";
import { spawnDebugFinishedProducts } from "../services/debug-spawn-service.js";
import { createLivestreamService, normalizeLivestreamRoom, publicLivestreamRoom } from "../services/livestream-service.js";
import { createMemoryWorldStore } from "../world-store.js";
import { isWorldPersistEnabled } from "../shell/world-persist.js";
import { createWorldPersisterForEnvironment } from "../shell/world-persistence.js";
import { createAuctionService, bindAuctionApi } from "../services/auction-service.js";
import { createMarketService, bindMarketApi } from "../services/market-service.js";
import { createBlackmarketService, bindBlackmarketApi, BLACKMARKET_MIN_PRICE, BLACKMARKET_PER_PLAYER_CAP, BLACKMARKET_GOODS_CAP, BLACKMARKET_BLIND_MIN, BLACKMARKET_BLIND_CAP, BLACKMARKET_BLIND_DRAW_COUNT, BLACKMARKET_BLIND_DRAW_TIMEOUT_MS, BLACKMARKET_BLIND_EXTRA_RATES } from "../services/blackmarket-service.js";
import { createWorkshopService } from "../services/workshop-service.js";
import { createCommissionService } from "../services/commission-service.js";
import {
  createMaterialsService,
  createMaterialPriceRuntime
} from "../services/materials-service.js";
import {
  createTaskService,
  TASK_REFRESH_MS,
  TASK_RESET_COST,
  TASK_COUNT
} from "../services/task-service.js";
import { createOrdersService } from "../services/orders-service.js";
import { createRoughPoolService, QUALITIES } from "../services/rough-pool-service.js";
import { createAssetsService } from "../services/assets-service.js";
import {
  pick,
  clamp,
  money,
  uiMoney,
  createEconomyService
} from "../services/economy-service.js";
import { bindAchievementRewards } from "../services/achievement-rewards.js";
import {
  publicStone
} from "../services/snapshot-public.js";
import { createSnapshotService } from "../services/snapshot-service.js";
import { registerSocketHandlers } from "../shell/socket-handlers.js";
import { createRuntimeTicks } from "../shell/runtime-ticks.js";
import { createServerContext } from "../shell/server-context.js";
import { createDeferredPlayerService } from "../services/player-service.js";
import { createPlayerSessionService } from "../services/player-session-service.js";
import { createAccountService } from "../services/account-service.js";
import { installAccountRoutes } from "../gateway/account-routes.js";
import { installAdminRoutes } from "../gateway/admin-routes.js";
import { createRecoveryService } from "../services/recovery-service.js";
import { createMarketLiquidityService } from "../services/market-liquidity-service.js";
import { createReportService } from "../services/report-service.js";
import { createCollectionService } from "../services/collection-service.js";
import { createMiningService } from "../services/mining-service.js";
import { createChatService } from "../services/chat-service.js";
import { createOfflineHelpers, createOfflineSettlement } from "../services/offline-service.js";
import { createDurableMutationCoordinator } from "../services/durable-mutation-coordinator.js";
import {
  materialStageFor,
  itemValue,
  takeItem,
  addItem,
  markInventoryItemNew,
  markExternalMaterialNew,
  markInventoryItemsSeen,
  inventoryUnseenCount,
  inventoryRecyclePayout,
  recycleInventoryItemForPlayer
} from "../services/inventory-service.js";
import { getMaterialPrice, MATERIAL_META } from "../services/materials-service.js";

export function wireServer({
  app,
  io,
  httpServer,
  PORT,
  TIMING,
  TIMING_PROFILE,
  OPEN_WINDOW_RATE,
  DEFAULT_AUCTION_HALL_ID,
  runtimeConfig = {},
  logger = console,
  metrics = { increment() {}, set() {} },
  health = null,
  stopSocketSecurity = null,
  stopHttpSecurity = null,
  env = process.env,
  cwd = process.cwd(),
  world = createMemoryWorldStore(),
  createPersister = createWorldPersisterForEnvironment,
  legacyBindings = false
}) {
  const state = world.raw;
  const persistEnabled = typeof runtimeConfig.persistEnabled === "boolean"
    ? runtimeConfig.persistEnabled
    : isWorldPersistEnabled(env);
  const persister = persistEnabled
    ? createPersister({ world, metrics, env, cwd })
    : null;
  if (typeof persister?.healthCheck === "function") {
    health?.setReadinessProbe?.(() => persister.healthCheck());
  }
  const durableMutations = createDurableMutationCoordinator({
        world,
        flush: (options) => flushPersistence(options),
        recordAudit: (entry) => persister?.recordAudit?.(entry),
        onRollback: () => resetStateCache(),
        logger,
        metrics,
        validateSocket: (socket) => playerSessions.isSessionActive(
          world.getPlayer(world.playerIdForSocket(socket.id)), socket.data?.jadeSessionId
        )
      });

  const {
    qualityByKey,
    makeRoughStone,
    makeExpertClues,
    refreshRoughPool,
    makeStarterRoughs,
    STARTER_ROUGH_COUNT
  } = createRoughPoolService({
    money,
    clamp,
    pick,
    getState: () => state
  });
  const qualities = QUALITIES;

  const {
    bindSnapshotFor,
    emitUiEvent,
    emitUiEventToPlayer,
    consumeRequestId,
    normalizeMutationPayload,
    notifyPlayerToast,
    emitState,
    forgetSocketState,
    resetStateCache,
    broadcast,
    addNews,
    getPlayer,
    playerSocketCount,
    isPlayerOnline
  } = createServerContext({
    io,
    world,
    metrics,
    getState: () => state,
    randomUUID,
    sessionIsActive: (player, socket) => playerSessions.isSessionActive(player, socket.data?.jadeSessionId),
    scheduleRead: (operation) => durableMutations.read(operation, { label: "broadcast" }),
    deferEffect: durableMutations?.deferEffect
  });

  const { makePlayer, normalizePlayer, wirePlayerService } = createDeferredPlayerService();
  const playerSessions = createPlayerSessionService();
  const accountService = createAccountService({
    getPlayers: () => state.players.values(),
    findAccountPlayer: (username) => state.players.valuesWhere((player) => player.auth?.account?.username === username).next().value || null,
    playerSessions
  });
  const stopAccountRoutes = installAccountRoutes({
    app,
    config: runtimeConfig,
    world,
    playerSessions,
    accountService,
    durableMutations,
    io,
    logger
  });
  installAdminRoutes({
    app,
    config: runtimeConfig,
    world,
    persister,
    saveCheckpoint: () => flushPersistence(),
    durableMutations,
    health,
    io,
    logger
  });

  const {
    inventoryForReport,
    playerReportSnapshot,
    refreshPlayerReport
  } = createReportService({
    getState: () => state,
    stallInventoryItemsForPlayer: (...args) => stallInventoryItemsForPlayer(...args)
  });

  const { sendWorldChat } = createChatService({
    getState: () => state,
    randomUUID
  });

  const {
    recordLedger,
    spendCash,
    earnCash,
    holdDeposit,
    releaseDeposit
  } = createEconomyService({
    refreshPlayerReport
  });
  const { settlePlayerAchievements, claimPlayerAchievement, claimAllPlayerAchievements } = createAchievementRewards({ earnCash });
  if (legacyBindings) bindAchievementRewards({ earnCash });

  const {
    config: miningConfig,
    grantMiningLicenseIfDue,
    canPlayerMine,
    submitMiningApplication,
    cancelMiningApplication,
    saveMiningTuningExperiment,
    reviewMiningTuningExperiment,
    cancelMiningTuningVersion,
    rollbackMiningTuningVersion,
    upgradeMiningFacility,
    startMiningShift,
    resolveMiningIncident,
    settleMiningJob,
    processMiningJobs,
    processMiningWorld,
    inspectMiningHealth,
    debugUnlockMining,
    miningSnapshotForPlayer
  } = createMiningService({
    getState: () => state,
    money,
    randomUUID,
    holdDeposit,
    releaseDeposit,
    spendCash,
    makeRoughStone,
    markInventoryItemNew,
    normalizePlayer,
    addNews,
    requiredRep: env.JADE_MINING_REQUIRED_REP,
    requiredPlayers: env.JADE_MINING_REQUIRED_PLAYERS,
    leaseMs: env.JADE_MINING_LEASE_MS,
    applicationMs: env.JADE_MINING_APPLICATION_MS,
    shiftMs: env.JADE_MINING_SHIFT_MS,
    basicMode: env.JADE_MINING_BASIC_MODE,
    allowFounderTuning: !runtimeConfig.isProduction,
    tuningReviewerPlayerIds: env.JADE_MINING_TUNING_REVIEWER_IDS
  });

  const {
    recoveryStatus,
    recoverPlayerIfNeeded
  } = createRecoveryService({
    getState: () => state,
    earnCash,
    refreshPlayerReport
  });

  const {
    processMarketLiquidity
  } = createMarketLiquidityService({
    getState: () => state,
    money,
    itemValue,
    randomUUID,
    addNews,
    refreshPlayerReport
  });

  const {
    refreshTasksIfDue,
    advanceTask,
    claimTask,
    resetTask,
    taskDefinitionAvailable
  } = createTaskService({
    settlePlayerAchievements,
    spendCash,
    earnCash,
    refreshPlayerReport
  });

  const {
    normalizeAssets,
    playerCanLivestream,
    assetListingsForPlayer,
    buyAssetListingForPlayer
  } = createAssetsService({
    normalizePlayer,
    spendCash,
    refreshPlayerReport
  });


  const {
    queueOfflineEvent,
    consumePendingOfflineEvents
  } = createOfflineHelpers({
    money,
    isPlayerOnline
  });

  const materialPrices = createMaterialPriceRuntime();
  const { startMaterialPriceTicker, stopMaterialPriceTicker } = materialPrices;
  const {
    materialCatalogForPlayer,
    buyMaterialPack,
    materialHistoryPayload
  } = createMaterialsService({
    priceRuntime: materialPrices,
    normalizePlayer,
    spendCash
  });

  const { ensureEquipmentShop, buyShopEquipmentForPlayer } = createEquipmentShopService({
    getState: () => state, spendCash, makeId: randomUUID
  });

  const {
    publicPlayer,
    privatePlayerSnapshot,
    sharedSnapshotFor,
    snapshotFor
  } = createSnapshotService({
    getState: () => state,
    metrics,
    TIMING,
    TASK_REFRESH_MS,
    playerReportSnapshot,
    isWorkerBusy,
    isMinerBusy,
    miningSnapshotForPlayer,
    publicLivestreamRoom,
    publicBlackStall: (...args) => publicBlackStall(...args),
    publicServiceOrdersForPlayer: (...args) => publicServiceOrdersForPlayer(...args),
    assetListingsForPlayer,
    materialCatalogForPlayer,
    equipmentCatalog,
    inlayCatalog,
    publicAuctionHalls: (...args) => publicAuctionHalls(...args),
    commissionSnapshotForPlayer: (player, now) => commissionSnapshotForPlayer(player, now)
  });

  bindSnapshotFor(snapshotFor, sharedSnapshotFor);

  const {
    makeOrder,
    refillOrders,
    replaceOrdersPool,
    replaceOrderSlot,
    ensureDailyOrderRefresh,
    completeOrderForPlayer,
    orderSingleRefreshFee,
    orderBatchRefreshFee,
    ensureRefreshCounts,
    msUntilNextOrderDailyRefresh
  } = createOrdersService({
    settlePlayerAchievements,
    money,
    clamp,
    pick,
    qualities,
    takeItem,
    earnCash,
    materialStageFor,
    advanceTask,
    addNews
  });

  const auctionDeps = {
    earnCash,
    money,
    uiMoney,
    holdDeposit,
    releaseDeposit,
    spendCash,
    clamp,
    getState: () => state,
    normalizePlayer,
    makeRoughStone,
    refreshRoughPool,
    addNews,
    randomUUID,
    TIMING,
    DEFAULT_AUCTION_HALL_ID,
    OPEN_WINDOW_RATE,
    markInventoryItemNew,
    advanceTask,
    queueOfflineEvent,
    refreshPlayerReport,
    qualityByKey,
    isPlayerOnline,
    emitUiEventToPlayer
  };
  const {
    normalizeAuctionEscrow,
    auctionEscrowForRough,
    setAuctionEscrow,
    applyAuctionBidEscrow,
    consumeAuctionEscrow,
    refundAuctionEscrow,
    refundStaleAuctionEscrows,
    reconcileAuctionEscrows,
    publicAuctionHalls,
    auctionRoundDuration,
    auctionEndsAt,
    playerEnteredAuction,
    createAuctionRound,
    ensureAuctionRound,
    settleAuctionIfDue,
    processAuctionLifecycle,
    enterAuctionForPlayer,
    joinAuctionForPlayer,
    submitAuctionBidForPlayer,
    normalizeWindowPayload,
    windowTouchesColor,
    windowTouchesCrack,
    makeWindowReveal,
    requestAuctionWindowForPlayer,
    ackAuctionSettleForPlayer
  } = createAuctionService(auctionDeps);
  // Legacy imports and existing test consumers retain their explicit default binding.
  if (legacyBindings) bindAuctionApi(auctionDeps);

  const marketDeps = {
    money,
    uiMoney,
    clamp,
    holdDeposit,
    releaseDeposit,
    spendCash,
    earnCash,
    getState: () => state,
    takeItem,
    addItem,
    advanceTask,
    addNews,
    randomUUID,
    emitUiEventToPlayer,
    notifyPlayerToast,
    queueOfflineEvent
  };
  const {
    wantEscrowAmountForBudget,
    releaseWantEscrow,
    settleWantInternal,
    processExpiredWants,
    reconcileMarketReferences,
    listItemForPlayer,
    buyListingForPlayer,
    withdrawListingForPlayer,
    collectMarketPayoutForPlayer,
    postWantForPlayer,
    cancelWantForPlayer,
    applyWantForPlayer,
    withdrawWantOfferForPlayer,
    settleWantForPlayer,
    acceptMarketOfferForPlayer,
  } = createMarketService(marketDeps);
  // Legacy imports and existing test consumers retain their explicit default binding.
  if (legacyBindings) bindMarketApi(marketDeps);

  const blackmarketDeps = {
    money,
    isPlayerOnline,
    uiMoney,
    spendCash,
    earnCash,
    holdDeposit,
    releaseDeposit,
    getState: () => state,
    takeItem,
    addItem,
    addNews,
    randomUUID,
    materialStageFor,
    makeRoughStone,
    revealPolishedRough: (rough) => revealPolishedRough(rough),
    materialMeta: MATERIAL_META,
    refreshPlayerReport,
    notifyPlayerToast,
    queueOfflineEvent
  };
  const {
    maintainNpcBlackmarket,
    processBlackmarketCustomers,
    visitBlackStallForPlayer,
    publicBlackStall,
    publicBlackListing,
    openBlackStallForPlayer,
    closeBlackStallForPlayer,
    setBlackStallPausedForPlayer,
    updateBlackStallMetaForPlayer,
    updateServiceProfileForPlayer,
    addGoodsToStallForPlayer,
    addGoodsBatchToStallForPlayer,
    withdrawGoodsFromStallForPlayer,
    buyGoodsFromStallForPlayer,
    addBlindboxItemsForPlayer,
    withdrawBlindboxItemForPlayer,
    buyBlindboxFromStallForPlayer,
    startBlindboxDrawForPlayer,
    settleBlindboxDrawForPlayer,
    processExpiredBlindDraws,
    addServiceOfferForPlayer,
    removeServiceOfferForPlayer,
    orderBlackServiceForPlayer,
    acceptBlackServiceForPlayer,
    deliverBlackServiceForPlayer,
    submitBlackServiceForPlayer,
    confirmBlackServiceForPlayer,
    cancelBlackServiceForPlayer,
    processExpiredBlackServiceOrders,
    reconcileBlackmarketReferences,
    refreshBlackServiceOrderStates,
    sweepEmptyBlackGoodsStalls,
    linkWorkshopJobToServiceOrder,
    submitBlackmarketRatingForPlayer,
    listBlackItemForPlayer,
    buyBlackListingForPlayer,
    withdrawBlackListingForPlayer,
    collectBlackmarketPayoutForPlayer,
    blackMaskForPlayerId,
    stallInventoryItemsForPlayer,
    publicServiceOrdersForPlayer,
    computeOrderFinished
  } = createBlackmarketService(blackmarketDeps);
  // Legacy imports and existing test consumers retain their explicit default binding.
  if (legacyBindings) bindBlackmarketApi(blackmarketDeps);

  const {
    workshopDevicesForPlayer,
    workshopDeviceForPlayer,
    workshopWorkerForPlayer,
    workshopJobsForDevice,
    workshopProcessableItems,
    playerOwnsWorkshop,
    legacyDeviceIdForStage,
    restoreWorkshopItem,
    findWorkshopItem,
    restoreRoughToInventory,
    startProductionJob,
    startRoughOpeningForPlayer,
    startWorkshopJobForPlayer,
    extractProductsFromJob,
    applyJobDurability,
    completeProductionJob,
    revealWorkshopDeliveryForPlayer,
    claimWorkshopDeliveryForPlayer,
    settleProductionJobsForPlayer,
    processProductionJobs,
    assignWorkshopWorkerForPlayer,
    angleDistance,
    cutAngleName,
    normalizeExtractionKits,
    expandKitPlacements,
    extractionKitsOverlap,
    placementsOverlap,
    revealPolishedRough,
    normalizeWorkshop
  } = createWorkshopService({
    settlePlayerAchievements,
    refillOrders,
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
    getState: () => state,
    isPlayerOnline,
    broadcast,
    randomUUID,
    TIMING_PROFILE
  });

  const {
    commissionSnapshotForPlayer,
    startCommissionForPlayer,
    claimCommissionForPlayer
  } = createCommissionService({
    normalizePlayer,
    earnCash,
    refreshPlayerReport,
    advanceTask,
    getState: () => state,
    makeId: randomUUID,
    TIMING_PROFILE
  });

  wirePlayerService({
    settlePlayerAchievements,
    makeStarterRoughs,
    materialStageFor,
    normalizeAssets,
    normalizeLivestreamRoom,
    normalizeAuctionEscrow,
    normalizeWorkshop,
    normalizeMiningPlayer,
    refreshTasksIfDue
  });

  const {
    settleOfflinePlayer
  } = createOfflineSettlement({
    settleEmployeePayroll: (player, now) => settleEmployeePayroll(player, { spendCash, now }),
    normalizePlayer,
    consumePendingOfflineEvents,
    auctionEndsAt,
    settleAuctionIfDue,
    settleProductionJobsForPlayer,
    refillOrders,
    refreshPlayerReport,
    getState: () => state
  });

  const {
    startLivestreamRoomForPlayer,
    replenishLivestreamRoomForPlayer,
    closeLivestreamRoomForPlayer,
    buyLivestreamRoomItemForPlayer,
    processLivestreamRooms,
    scheduleLivestream,
    sellLivestreamNow,
    settleLivestreamJobsForPlayer,
    processLivestreamJobs,
    retireLegacyLivestreamJobs,
    ackLivestreamSettleForPlayer
  } = createLivestreamService({
    settlePlayerAchievements,
    normalizePlayer,
    materialStageFor,
    spendCash,
    earnCash,
    addItem,
    advanceTask,
    addNews,
    refreshPlayerReport,
    emitUiEventToPlayer,
    getState: () => state,
    broadcast,
    publicProduct: publicStone,
    uiMoney,
    randomUUID
  });
  void retireLegacyLivestreamJobs;
  void settleLivestreamJobsForPlayer;
  void processLivestreamJobs;

  const {
    processPolishingJobs,
    reconcileWorld,
    checkMiningHealth,
    startServer: startHttpServer,
    stopServer: stopHttpServer
  } = createRuntimeTicks({
    settlePlayerAchievements,
    miningAvailable: isFeatureAvailable("mining"),
    settleEmployeePayroll: (player, now) => settleEmployeePayroll(player, { spendCash, now }),
    httpServer,
    PORT,
    HOST: runtimeConfig.host,
    getState: () => state,
    startMaterialPriceTicker,
    stopMaterialPriceTicker,
    refreshRoughPool,
    addNews,
    normalizePlayer,
    isPlayerOnline,
    settleProductionJobsForPlayer,
    broadcast,
    processAuctionLifecycle,
    reconcileAuctionEscrows,
    reconcileMarketReferences,
    reconcileBlackmarketReferences,
    ensureEquipmentShop,
    maintainNpcBlackmarket,
    processBlackmarketCustomers,
    processExpiredWants,
    processMarketLiquidity,
    processExpiredBlackServiceOrders,
    refreshBlackServiceOrderStates,
    sweepEmptyBlackGoodsStalls,
    processExpiredBlindDraws,
    refillOrders,
    ensureDailyOrderRefresh,
    processProductionJobs,
    processLivestreamRooms,
    processMiningJobs,
    processMiningWorld,
    inspectMiningHealth,
    randomUUID,
    qualityByKey,
    clamp,
    money,
    earnCash,
    markInventoryItemNew,
    angleDistance,
    cutAngleName,
    runReadOperation: (label, operation) => durableMutations.read(operation, { key: label }),
    runDurableMutation: (label, operation, options) => durableMutations
      ? durableMutations.run(label, operation, options)
      : operation()
  });

  async function flushPersistence(options = {}) {
    if (!persister) return null;
    const startedAt = Date.now();
    try {
      const result = typeof persister.flush === "function"
        ? await persister.flush(options)
        : persister.flushSync();
      health?.markPersistenceSuccess?.({
        latencyMs: Date.now() - startedAt,
        ...(persister.status?.() || {})
      });
      metrics.set("jade_server_ready", {}, health?.snapshot?.().ready ? 1 : 0);
      return result;
    } catch (error) {
      health?.markPersistenceError?.(error, persister.status?.() || {});
      metrics.set("jade_server_ready", {}, 0);
      throw error;
    }
  }

  const { startServer, shutdown, status } = createGameLifecycle({
    world, persister, normalizePlayer, checkMiningHealth, reconcileWorld, flushPersistence,
    durableMutations, startHttpServer, stopHttpServer, io, stopSocketSecurity, stopHttpSecurity, stopAccountRoutes, health, logger, metrics
  });

  const {
    collectBraceletForPlayer,
    returnCollectionItemForPlayer
  } = createCollectionService({
    takeItem,
    restoreWorkshopItem,
    materialStageFor,
    advanceTask,
    settlePlayerAchievements,
    addNews
  });

  registerSocketHandlers(io, {
    getState: () => state,
    settlePlayerAchievements, claimPlayerAchievement, claimAllPlayerAchievements,
    runtimeConfig,
    logger,
    metrics,
    durableMutations,
    randomUUID,
    world,
    playerSessions,
    makePlayer,
    refillOrders,
    replaceOrdersPool,
    replaceOrderSlot,
    ensureDailyOrderRefresh,
    orderSingleRefreshFee,
    orderBatchRefreshFee,
    ensureRefreshCounts,
    msUntilNextOrderDailyRefresh,
    addNews,
    isPlayerOnline,
    settleOfflinePlayer,
    recoverPlayerIfNeeded,
    getPlayer,
    emitState,
    forgetSocketState,
    broadcast,
    emitUiEvent,
    submitAuctionBidForPlayer,
    joinAuctionForPlayer,
    enterAuctionForPlayer,
    uiMoney,
    requestAuctionWindowForPlayer,
    ackAuctionSettleForPlayer,
    ackLivestreamSettleForPlayer,
    advanceTask,
    normalizeMutationPayload,
    consumeRequestId,
    startRoughOpeningForPlayer,
    refreshRecruitCandidates,
    spendCash,
    recruitWorker,
    dismissWorker: (player, workerId) => dismissWorker(player, workerId, { spendCash }),
    ensureMinerRecruitCandidates,
    refreshMinerRecruitCandidates,
    recruitMiner,
    dismissMiner,
    trainMiner,
    careForMiner,
    resolveMinerRetention,
    formMinerMentorship,
    endMinerMentorship,
    specializeMiner,
    renewMinerContract,
    promoteMiner,
    canPlayerMine,
    submitMiningApplication,
    cancelMiningApplication,
    saveMiningTuningExperiment,
    reviewMiningTuningExperiment,
    cancelMiningTuningVersion,
    rollbackMiningTuningVersion,
    miningBasicMode: miningConfig.basicMode,
    upgradeMiningFacility,
    startMiningShift,
    resolveMiningIncident,
    debugUnlockMining,
    normalizePlayer,
    playerOwnsWorkshop,
    buyShopEquipmentForPlayer,
    workshopJobsForDevice,
    repairEquipment,
    startWorkshopJobForPlayer,
    assignWorkshopWorkerForPlayer,
    startCommissionForPlayer,
    claimCommissionForPlayer,
    snapshotFor,
    revealWorkshopDeliveryForPlayer,
    claimWorkshopDeliveryForPlayer,
    normalizeExtractionKits,
    collectBraceletForPlayer,
    returnCollectionItemForPlayer,
    startLivestreamRoomForPlayer,
    replenishLivestreamRoomForPlayer,
    closeLivestreamRoomForPlayer,
    buyLivestreamRoomItemForPlayer,
    scheduleLivestream,
    sellLivestreamNow,
    completeOrderForPlayer,
    listItemForPlayer,
    buyAssetListingForPlayer,
    buyMaterialPack,
    materialHistoryPayload,
    buyListingForPlayer,
    acceptMarketOfferForPlayer,
    markInventoryItemsSeen,
    recycleInventoryItemForPlayer: (player, payload = {}) => recycleInventoryItemForPlayer(player, payload, {
      money,
      earnCash,
      materialUnitPrice: (key) => Math.round(getMaterialPrice(key))
    }),
    withdrawListingForPlayer,
    collectMarketPayoutForPlayer,
    openBlackStallForPlayer,
    visitBlackStallForPlayer,
    publicBlackStall,
    closeBlackStallForPlayer,
    setBlackStallPausedForPlayer,
    updateBlackStallMetaForPlayer,
    updateServiceProfileForPlayer,
    addGoodsBatchToStallForPlayer,
    addGoodsToStallForPlayer,
    addBlindboxItemsForPlayer,
    buyGoodsFromStallForPlayer,
    buyBlackListingForPlayer,
    buyBlindboxFromStallForPlayer,
    startBlindboxDrawForPlayer,
    settleBlindboxDrawForPlayer,
    processExpiredBlindDraws,
    publicStone,
    withdrawGoodsFromStallForPlayer,
    withdrawBlindboxItemForPlayer,
    addServiceOfferForPlayer,
    removeServiceOfferForPlayer,
    orderBlackServiceForPlayer,
    acceptBlackServiceForPlayer,
    deliverBlackServiceForPlayer,
    submitBlackServiceForPlayer,
    confirmBlackServiceForPlayer,
    cancelBlackServiceForPlayer,
    linkWorkshopJobToServiceOrder,
    submitBlackmarketRatingForPlayer,
    collectBlackmarketPayoutForPlayer,
    postWantForPlayer,
    cancelWantForPlayer,
    applyWantForPlayer,
    withdrawWantOfferForPlayer,
    settleWantForPlayer,
    claimTask,
    resetTask,
    TASK_RESET_COST,
    earnCash,
    clamp,
    playerSocketCount,
    spawnDebugFinishedProducts,
    sendWorldChat
  });

  return {
    world,
    state,
    materialCatalogForPlayer,
    buyMaterialPack,
    startServer,
    shutdown,
    status,
    persister,
    testHookBindings: {
      world, state, persister, playerSessions, makePlayer, normalizePlayer, recordLedger, spendCash, consumeRequestId,
      normalizeMutationPayload, emitUiEvent, broadcast, addNews, getPlayer, earnCash, holdDeposit,
      releaseDeposit, applyAuctionBidEscrow, auctionEscrowForRough, normalizeAuctionEscrow,
      consumeAuctionEscrow, refundAuctionEscrow, reconcileAuctionEscrows, settleOfflinePlayer, queueOfflineEvent,
      refreshRoughPool, makeStarterRoughs, qualityByKey, makeOrder, refillOrders, replaceOrdersPool,
      replaceOrderSlot, ensureDailyOrderRefresh, orderSingleRefreshFee, orderBatchRefreshFee,
      ensureRefreshCounts, msUntilNextOrderDailyRefresh, completeOrderForPlayer,
      materialCatalogForPlayer, buyMaterialPack, enterAuctionForPlayer, ackAuctionSettleForPlayer, ackLivestreamSettleForPlayer, submitAuctionBidForPlayer,
      joinAuctionForPlayer, requestAuctionWindowForPlayer, ensureAuctionRound, settleAuctionIfDue,
      processAuctionLifecycle, snapshotFor, privatePlayerSnapshot, processExpiredWants, reconcileMarketReferences, reconcileBlackmarketReferences, settleWantInternal,
      wantEscrowAmountForBudget, releaseWantEscrow, listItemForPlayer, buyListingForPlayer,
      withdrawListingForPlayer, listBlackItemForPlayer, buyBlackListingForPlayer,
      withdrawBlackListingForPlayer, collectBlackmarketPayoutForPlayer, publicBlackListing,
      publicBlackStall, openBlackStallForPlayer, closeBlackStallForPlayer, setBlackStallPausedForPlayer,
      updateBlackStallMetaForPlayer, updateServiceProfileForPlayer, addGoodsToStallForPlayer, addGoodsBatchToStallForPlayer,
      withdrawGoodsFromStallForPlayer, buyGoodsFromStallForPlayer, addBlindboxItemsForPlayer,
      withdrawBlindboxItemForPlayer,
      buyBlindboxFromStallForPlayer, startBlindboxDrawForPlayer, settleBlindboxDrawForPlayer, processExpiredBlindDraws,
      addServiceOfferForPlayer, removeServiceOfferForPlayer,
      orderBlackServiceForPlayer, acceptBlackServiceForPlayer, deliverBlackServiceForPlayer, submitBlackServiceForPlayer,
      confirmBlackServiceForPlayer, cancelBlackServiceForPlayer, processExpiredBlackServiceOrders,
      refreshBlackServiceOrderStates, sweepEmptyBlackGoodsStalls, linkWorkshopJobToServiceOrder, computeOrderFinished,
      submitBlackmarketRatingForPlayer, blackMaskForPlayerId,
      BLACKMARKET_MIN_PRICE, BLACKMARKET_PER_PLAYER_CAP, BLACKMARKET_GOODS_CAP, BLACKMARKET_BLIND_MIN,
      BLACKMARKET_BLIND_CAP, BLACKMARKET_BLIND_DRAW_COUNT, BLACKMARKET_BLIND_DRAW_TIMEOUT_MS, BLACKMARKET_BLIND_EXTRA_RATES,
      postWantForPlayer, takeItem, addItem, markInventoryItemNew, markInventoryItemsSeen,
      markExternalMaterialNew, inventoryUnseenCount, inventoryRecyclePayout, recycleInventoryItemForPlayer,
      itemValue, startRoughOpeningForPlayer,
      normalizeWorkshop, materialStageFor, workshopDevicesForPlayer, workshopDeviceForPlayer,
      commissionSnapshotForPlayer, startCommissionForPlayer, claimCommissionForPlayer,
      workshopJobsForDevice, workshopProcessableItems, startWorkshopJobForPlayer, startProductionJob,
      completeProductionJob, revealWorkshopDeliveryForPlayer, claimWorkshopDeliveryForPlayer, applyJobDurability, validateFinishPlan, quoteFinishPlan,
      reserveFinishMaterials, refundFinishMaterials, applyInlay, equipmentCatalog, buyEquipment,
      ensureEquipmentShop, buyShopEquipmentForPlayer,
      repairEquipment, repairQuote, ensureRecruitCandidates, refreshRecruitCandidates, recruitWorker,
      dismissWorker, mergeWorkers, normalizeDismissedStarterIds, isWorkerBusy, grantActivityExperience,
      miningConfig, grantMiningLicenseIfDue, canPlayerMine, submitMiningApplication,
      cancelMiningApplication, saveMiningTuningExperiment, reviewMiningTuningExperiment, cancelMiningTuningVersion, rollbackMiningTuningVersion, upgradeMiningFacility, startMiningShift, resolveMiningIncident, settleMiningJob, processMiningJobs, processMiningWorld, inspectMiningHealth,
      debugUnlockMining, miningSnapshotForPlayer, ensureMinerRecruitCandidates, refreshMinerRecruitCandidates,
      recruitMiner, dismissMiner, trainMiner, careForMiner, resolveMinerRetention, formMinerMentorship, endMinerMentorship, specializeMiner, renewMinerContract, promoteMiner, normalizeMiningPlayer, isMinerBusy, refreshMinerCondition,
      minerReadiness, applyMinerShiftCondition, applyMinerRetentionAfterShift, applyMinerMentorshipsForShift, MAX_MINERS, MINER_RECRUIT_REFRESH_COST,
      startLivestreamRoomForPlayer,
      replenishLivestreamRoomForPlayer, closeLivestreamRoomForPlayer, buyLivestreamRoomItemForPlayer,
      ackLivestreamSettleForPlayer,
      processLivestreamRooms, scheduleLivestream, sellLivestreamNow, assetListingsForPlayer,
      buyAssetListingForPlayer, playerOwnsWorkshop, playerCanLivestream, extractProductsFromJob,
      normalizeExtractionKits, expandKitPlacements, extractionKitsOverlap, placementsOverlap,
      processProductionJobs, settleLivestreamJobsForPlayer, processLivestreamJobs, processPolishingJobs, reconcileWorld, checkMiningHealth,
      recoveryStatus, recoverPlayerIfNeeded, processMarketLiquidity,
      playerSocketCount, isPlayerOnline, revealPolishedRough, inventoryForReport, refreshPlayerReport,
      refreshTasksIfDue, advanceTask, claimTask, resetTask, taskDefinitionAvailable, TASK_RESET_COST, TASK_COUNT,
      sendWorldChat
    }
  };
}
