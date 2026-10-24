/**
 * Socket.IO connection handlers — thin wrappers over domain services.
 * Event names and ack/toast behavior are contract-frozen.
 */
import { handleStartWorkshopJobRequest } from "./workshop-start-handler.js";
import { grantPlayerExp } from "../../shared/domain/progression/player-progression.js";
import { settlePlayerAchievements as legacySettlePlayerAchievements } from "../services/achievement-rewards.js";
import { customerRatingTierInfo } from "../../shared/domain/economy/metric-history.js";
import {
  DURABLE_SOCKET_EVENTS,
  normalizeMutationPacketPayload
} from "../../shared/protocol/mutation-events.js";
import { installSocketEventSecurity } from "../security/socket-security.js";
import { accountSessionFromCookie } from "../gateway/account-routes.js";
import { registerMiningCommands } from "./commands/mining-commands.js";
import { registerBlackmarketCommands } from "./commands/blackmarket-commands.js";
import { registerCommerceCommands } from "./commands/commerce-commands.js";
import { registerProgressionCommands } from "./commands/progression-commands.js";
import { registerDebugCommands } from "./commands/debug-commands.js";
import { registerWorkshopDeliveryCommands } from "./commands/workshop-delivery-commands.js";
import { registerCommissionCommands } from "./commands/commission-commands.js";
import { registerPayrollCommands } from "./commands/payroll-commands.js";
import { enterEmployeePayrollDay } from "../systems/employee-payroll.js";

export function registerSocketHandlers(io, deps) {
  const settlePlayerAchievements = deps.settlePlayerAchievements || legacySettlePlayerAchievements;
  const {
    runtimeConfig = {},
    logger = console,
    metrics = { increment() {} },
    durableMutations = null,
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
    dismissWorker,
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
    miningBasicMode,
    upgradeMiningFacility,
    startMiningShift,
    resolveMiningIncident,
    debugUnlockMining,
    normalizePlayer,
    playerOwnsWorkshop,
    buyEquipment,
    workshopJobsForDevice,
    repairEquipment,
    startWorkshopJobForPlayer,
    assignWorkshopWorkerForPlayer,
    snapshotFor,
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
    recycleInventoryItemForPlayer,
    withdrawListingForPlayer,
    collectMarketPayoutForPlayer,
    openBlackStallForPlayer,
    closeBlackStallForPlayer,
    setBlackStallPausedForPlayer,
    updateBlackStallMetaForPlayer,
    updateServiceProfileForPlayer,
    addGoodsBatchToStallForPlayer,
    addGoodsToStallForPlayer,
    addBlindboxItemsForPlayer,
    buyGoodsFromStallForPlayer,
    buyBlackListingForPlayer,
    publicStone,
    buyBlindboxFromStallForPlayer,
    startBlindboxDrawForPlayer,
    settleBlindboxDrawForPlayer,
    processExpiredBlindDraws,
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
    earnCash,
    clamp,
    playerSocketCount,
    spawnDebugFinishedProducts,
    sendWorldChat
  } = deps;

  io.on("connection", async (socket) => {
  durableMutations?.wrapSocketRegistration?.(socket, DURABLE_SOCKET_EVENTS);
  installSocketEventSecurity(socket, {
    config: {
      socketEventsPer10Seconds: 120,
      ...runtimeConfig
    },
    logger,
    metrics
  });
  socket.use((packet, next) => {
    normalizeMutationPacketPayload(packet);
    next();
  });
  socket.on("disconnect", () => {
    const playerId = world.playerIdForSocket(socket.id);
    world.unbindSocket(socket.id);
    forgetSocketState?.(socket.id);
    const at = Date.now();
    const settle = () => {
      if (playerId && playerSocketCount(playerId) === 0) {
        const current = world.getPlayer(playerId);
        if (current) current.lastSeenAt = at;
      }
      broadcast({ privatePlayerIds: [] });
    };
    if (durableMutations) durableMutations.run("session:disconnect", settle, { audit: false }).catch(() => {});
    else settle();
  });
  const cookieSession = accountSessionFromCookie(socket.handshake.headers?.cookie);
  const requestedId = String(socket.handshake.auth?.playerId || cookieSession?.playerId || "").trim();
  const requestedToken = String(socket.handshake.auth?.resumeToken || cookieSession?.resumeToken || "").trim();
  function bootstrapConnection() {
    if (socket.connected === false) return { authenticated: false };
    let playerId = requestedId;
    let resumeToken = null;
    let isNewPlayer = false;

    if (requestedId && world.hasPlayer(requestedId)) {
      const existing = world.getPlayer(requestedId);
      const authentication = playerSessions.authenticateExistingPlayer(existing, requestedToken);
      if (!authentication.ok) {
        return {
          authenticated: false,
          code: authentication.code,
          message: authentication.message || "玩家身份验证失败。"
        };
      }
      resumeToken = authentication.resumeToken;
    } else {
      playerId = randomUUID();
      const player = makePlayer(playerId);
      resumeToken = playerSessions.issueSession(player, requestedId ? "unknown-id-recovery" : "new");
      world.setPlayer(player);
      isNewPlayer = true;
      if (typeof ensureDailyOrderRefresh === "function") ensureDailyOrderRefresh(player);
      refillOrders(player);
      addNews(`${player.name} 来到翡翠街。`);
    }

    const player = world.getPlayer(playerId);
    if (Number(player?.moderation?.bannedUntil || 0) > Date.now()) {
      return {
        authenticated: true,
        denied: true,
        code: "PLAYER_BANNED",
        message: player.moderation.banReason || "该账号暂时无法进入游戏。"
      };
    }
    const wasOnline = isPlayerOnline(player);
    enterEmployeePayrollDay(player, { spendCash });
    if (!wasOnline) settleOfflinePlayer(player);
    if (player.payouts?.length) collectMarketPayoutForPlayer(player);
    const recoveryResult = typeof recoverPlayerIfNeeded === "function"
      ? recoverPlayerIfNeeded(player)
      : { applied: false };
    if (typeof ensureDailyOrderRefresh === "function") ensureDailyOrderRefresh(player);
    refillOrders(player);
    socket.data ||= {};
    socket.data.jadeSessionId = playerSessions.sessionIdFor(player, resumeToken || requestedToken);
    world.bindSocket(socket.id, playerId);
    return { authenticated: true, playerId, resumeToken, isNewPlayer, player, recoveryResult };
  }

  let connection;
  try {
    connection = durableMutations
      ? await durableMutations.run("session:connect", bootstrapConnection, {
          audit: false,
          shouldPersist: (result) => result?.authenticated === true
        })
      : bootstrapConnection();
  } catch (error) {
    logger.error?.({ error: error?.message || error }, "player session persistence failed");
    socket.emit("session:error", {
      code: "PERSISTENCE_FAILED",
      message: "玩家资料未能安全保存，请稍后重试。"
    });
    socket.disconnect(true);
    return;
  }
  if (!connection?.authenticated || connection.denied) {
    socket.emit("session:error", {
      code: connection?.code || "INVALID_PLAYER_SESSION",
      message: connection?.message || "玩家身份验证失败。"
    });
    socket.disconnect(true);
    return;
  }
  const { playerId, resumeToken, isNewPlayer, player, recoveryResult } = connection;
  if (!socket.connected) {
    world.unbindSocket(socket.id);
    return;
  }
  const read = (operation) => durableMutations ? durableMutations.read(operation) : Promise.resolve(operation());
  await read(() => {
    const current = world.getPlayer(playerId);
    if (!socket.connected) return;
    if (!playerSessions.isSessionActive(current, socket.data?.jadeSessionId)) return socket.disconnect(true);
    socket.join?.("world");
    socket.join?.(`player:${playerId}`);
    socket.emit("hello", { playerId, resumeToken, isNewPlayer });
    if (recoveryResult.applied) socket.emit("toast", `经营纾困已到账 ¥${recoveryResult.grant}。`);
    if (typeof emitState === "function") emitState(socket, current, Date.now(), { includeStaticCatalogs: true, forceFull: true });
    else socket.emit("state", snapshotFor(current, Date.now(), { includeStaticCatalogs: true }));
    broadcast({ excludeSocketId: socket.id, privatePlayerIds: [] });
  }).catch((error) => {
    logger.warn?.({ error: error.message }, "initial state unavailable");
    socket.disconnect(true);
  });
  if (!socket.connected) return;

  socket.on("requestState", () => {
    read(() => {
      const current = getPlayer(socket);
      if (!current || !playerSessions.isSessionActive(current, socket.data?.jadeSessionId)) return;
      if (typeof emitState === "function") emitState(socket, current, Date.now(), { includeStaticCatalogs: true, forceFull: true });
      else socket.emit("state", snapshotFor(current, Date.now(), { includeStaticCatalogs: true }));
    }).catch((error) => socket.emit("toast", error.message));
  });

  function mutationValue(payload, ...keys) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    for (const key of keys) {
      if (payload[key] !== undefined) return payload[key];
    }
    return payload.value;
  }

  function acceptMutation(player, payload, message = "该请求已处理，请勿重复提交。", acknowledge) {
    const requestId = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload.requestId
      : null;
    // Backward compatibility for older clients and maintenance scripts. The
    // browser command boundary supplies ids for every current mutation.
    if (!requestId) return true;
    if (consumeRequestId(player, requestId)) return true;
    socket.emit("toast", message);
    if (typeof acknowledge === "function") acknowledge({ ok: false, message, duplicate: true });
    return false;
  }

  function rejectAdvancedMining(acknowledge) {
    if (!miningBasicMode) return false;
    const result = { ok: false, message: "当前采用基础矿山模式，该高级功能暂未开放。" };
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    return true;
  }

  registerWorkshopDeliveryCommands(socket, { ...deps, getPlayer, acceptMutation, broadcast });
  registerCommissionCommands(socket, { ...deps, getPlayer, acceptMutation, broadcast });

  socket.on("setName", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该改名请求已处理，请勿重复提交。")) return;
    const cleanName = String(mutationValue(payload, "name") || "").trim().slice(0, 10);
    if (!cleanName || cleanName === player.name) return;
    player.name = cleanName;
    addNews(`${player.name} 换上了新招牌。`);
    broadcast();
  });

  socket.on("sendWorldChat", (payload = {}, acknowledge) => {
    const player = getPlayer(socket);
    const reply = (ok, message) => {
      if (typeof acknowledge === "function") {
        acknowledge({ ok: Boolean(ok), message: message || "" });
      } else if (!ok && message) {
        socket.emit("toast", message);
      }
    };
    if (!player || typeof sendWorldChat !== "function") {
      return reply(false, "发送失败");
    }
    if (!acceptMutation(player, payload, "该消息已发送，请勿重复提交。", acknowledge)) return;
    const result = sendWorldChat(player, payload);
    if (!result.ok) return reply(false, result.message);
    reply(true, result.message || "已发送");
    broadcast();
  });

  socket.on("submitAuctionBid", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该投标请求已处理，请勿重复提交。")) return;
    const result = submitAuctionBidForPlayer(player, payload);
    if (!result.ok) return socket.emit("toast", result.message);
    socket.emit("toast", result.message);
    emitUiEvent(socket, {
      type: "float",
      tone: "trade",
      text: result.message,
      x: 70,
      y: 62
    });
    broadcast();
  });

  socket.on("joinAuction", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该入场请求已处理，请勿重复提交。")) return;
    const result = joinAuctionForPlayer(player, payload);
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: result.entryFee ? `入场 -${uiMoney(result.entryFee)}` : "已入场本场公盘。", x: 66,
        y: 68
      });
      broadcast();
    }
  });

  socket.on("enterAuction", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该入场请求已处理，请勿重复提交。")) return;
    const result = enterAuctionForPlayer(player, payload);
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: result.entryFee ? `入场 -${uiMoney(result.entryFee)}` : "已入场本场公盘。", x: 66,
        y: 68
      });
      broadcast();
    }
  });

  socket.on("ackAuctionSettle", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const result = ackAuctionSettleForPlayer(player, payload?.roundId || payload || "");
    if (result.cleared) broadcast();
  });

  socket.on("ackLivestreamSettle", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    ackLivestreamSettleForPlayer(player, payload?.roomId || payload || "");
  });

  socket.on("buyRough", () => {
    socket.emit("toast", "请通过公盘竞价面板提交出价，前 8 分钟明拍，最后 2 分钟暗拍。");
  });

  socket.on("requestWindow", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该开窗请求已处理，请勿重复提交。")) return;
    const result = requestAuctionWindowForPlayer(player, payload);
    if (!result.ok) return socket.emit("toast", result.message);
    emitUiEvent(socket, {
      type: "float",
      tone: "craft",
      text: "开窗完成", x: 58,
      y: 52
    });
    advanceTask(player, "window_open");
    player.stats.windowOpens = (player.stats.windowOpens || 0) + 1;
    grantPlayerExp(player, "window_open");
    settlePlayerAchievements(player);
    broadcast();
  });

  socket.on("startPolish", (rawPayload) => {
    const player = getPlayer(socket);
    if (!player) return;
    const { roughId, requestId } = normalizeMutationPayload(rawPayload);
    if (!consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该开工请求缺少有效编号或已处理，请勿重复提交。");
    }
    const result = startRoughOpeningForPlayer(player, roughId);
    if (!result.ok) return socket.emit("toast", result.message);
    addNews(`${player.name} 将 ${result.job.item.name} 安排到开料机。`, "craft");
    emitUiEvent(socket, {
      type: "float",
      tone: "expense",
      text: `加工支出 -${uiMoney(result.fee)}`,
      x: 62,
      y: 64
    });
    broadcast();
  });

  socket.on("refreshRecruitCandidates", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!consumeRequestId(player, payload.requestId)) {
      return socket.emit("toast", "该刷新请求已处理，请勿重复提交。");
    }
    const result = refreshRecruitCandidates(player, {
      rng: Math.random,
      makeId: randomUUID,
      spendCash
    });
    socket.emit("toast", result.message);
    broadcast();
  });

  socket.on("recruitWorker", (payload = {}, acknowledge) => {
    const reply = (result) => {
      if (typeof acknowledge === "function") acknowledge(result);
    };
    const player = getPlayer(socket);
    if (!player) {
      reply({ ok: false, message: "玩家状态不可用。" });
      return;
    }
    if (!consumeRequestId(player, payload.requestId)) {
      const message = "该招聘请求已处理，请勿重复提交。";
      socket.emit("toast", message);
      reply({ ok: false, message });
      return;
    }
    normalizePlayer(player);
    const result = recruitWorker(player, payload.candidateId, { spendCash });
    if (result.ok) {
      player.stats.hireCount = (player.stats.hireCount || 0) + 1;
      advanceTask(player, "recruit_worker");
      settlePlayerAchievements(player);
    }
    socket.emit("toast", result.message);
    if (!result.ok) {
      reply({ ok: false, message: result.message });
      broadcast();
      return;
    }
    addNews(`${player.name} 招聘了 ${result.worker.name}。`, "craft");
    reply({ ok: true, message: result.message, requestId: payload.requestId });
    broadcast();
  });

  socket.on("dismissWorker", (payload = {}, acknowledge) => {
    const reply = (result) => {
      if (typeof acknowledge === "function") acknowledge(result);
    };
    const player = getPlayer(socket);
    if (!player) {
      reply({ ok: false, message: "玩家状态不可用。" });
      return;
    }
    if (!consumeRequestId(player, payload.requestId)) {
      const message = "该解雇请求已处理，请勿重复提交。";
      socket.emit("toast", message);
      reply({ ok: false, message });
      return;
    }
    normalizePlayer(player);
    const result = dismissWorker(player, payload.workerId);
    socket.emit("toast", result.message);
    if (!result.ok) {
      reply({ ok: false, message: result.message });
      return;
    }
    addNews(`${player.name} 解雇了 ${result.worker.name}。`, "craft");
    reply({ ok: true, message: result.message, requestId: payload.requestId });
    broadcast();
  });

  registerPayrollCommands(socket, { getPlayer, normalizePlayer, consumeRequestId, spendCash, broadcast });
  registerMiningCommands(socket, {
    getPlayer,
    acceptMutation,
    normalizePlayer,
    submitMiningApplication,
    cancelMiningApplication,
    saveMiningTuningExperiment,
    reviewMiningTuningExperiment,
    cancelMiningTuningVersion,
    rollbackMiningTuningVersion,
    canPlayerMine,
    refreshMinerRecruitCandidates,
    randomUUID,
    spendCash,
    ensureMinerRecruitCandidates,
    recruitMiner,
    addNews,
    dismissMiner,
    miningBasicMode,
    rejectAdvancedMining,
    trainMiner,
    emitUiEvent,
    uiMoney,
    careForMiner,
    resolveMinerRetention,
    formMinerMentorship,
    endMinerMentorship,
    specializeMiner,
    renewMinerContract,
    promoteMiner,
    upgradeMiningFacility,
    startMiningShift,
    resolveMiningIncident,
    broadcast
  });


  socket.on("buyWorkshopDevice", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!consumeRequestId(player, payload.requestId)) {
      return socket.emit("toast", "该购买请求已处理，请勿重复提交。");
    }
    normalizePlayer(player);
    if (!playerOwnsWorkshop(player)) return socket.emit("toast", "先购买街角小工坊，再添置设备。");
    const result = buyEquipment(player, payload.modelKey, {
      spendCash,
      makeId: randomUUID
    });
    if (!result.ok) {
      return socket.emit("toast", {
        text: result.message,
        tone: result.code === "INSUFFICIENT_CASH" ? "danger" : "warn"
      });
    }
    addNews(`${player.name} 为工坊购入 ${result.device.name}。`, "craft");
    socket.emit("toast", result.message);
    broadcast();
  });

  socket.on("repairWorkshopDevice", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!consumeRequestId(player, payload.requestId)) {
      return socket.emit("toast", "该维修请求已处理，请勿重复提交。");
    }
    normalizePlayer(player);
    if (workshopJobsForDevice(player, payload.deviceId).length) {
      return socket.emit("toast", "设备加工中，完成后才能维修。");
    }
    const result = repairEquipment(player, payload.deviceId, { spendCash });
    if (!result.ok) return socket.emit("toast", result.message);
    addNews(`${player.name} 维修了 ${result.device.name}。`, "craft");
    socket.emit("toast", result.message);
    broadcast();
  });

  socket.on("startWorkshopJob", (payload = {}, acknowledge) => {
    const player = getPlayer(socket);
    const result = handleStartWorkshopJobRequest({
      player,
      payload,
      acknowledge,
      consumeRequestId,
      startWorkshopJob: startWorkshopJobForPlayer,
      emitToast: (message) => socket.emit("toast", message),
      onSuccess: (started) => {
        const linkedOrderId = payload.linkedOrderId || started?.job?.item?.escrowOrderId;
        if (linkedOrderId && started?.job?.id) {
          linkWorkshopJobToServiceOrder(linkedOrderId, player, started.job.id);
        }
        addNews(`${player.name} 将 ${started.job.item.name} 安排到 ${started.device.name}。`, "craft");
        emitUiEvent(socket, {
          type: "modal",
          tone: "craft",
          title: `${started.device.name}已开工`,
          subtitle: started.job.item.name,
          body: "设备和师傅已经开始处理，完成后可在右侧「进行事项 → 工坊」领取产物。", stats: [
            { label: "员工", value: started.worker?.name || "默认师傅" }
          ]
        });
      }
    });
    if (result.ok) broadcast();
  });

  socket.on("assignWorkshopWorker", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该排班请求已处理，请勿重复提交。")) return;
    const result = assignWorkshopWorkerForPlayer(player, payload);
    socket.emit("toast", result.message);
    if (result.ok) {
      addNews(`${player.name} 将 ${result.worker.name} 安排到 ${result.device.name}。`, "craft");
      broadcast();
    }
  });

  socket.on("startCut", () => {
    socket.emit("toast", "当前流程已改为全料打磨后直接取手镯。");
    socket.emit("state", snapshotFor(getPlayer(socket)));
  });

  socket.on("cutRough", (roughId) => {
    socket.emit("toast", "当前流程已改为全料打磨后直接取手镯。");
    socket.emit("state", snapshotFor(getPlayer(socket)));
  });

  socket.on("extractFromRough", (rawPayload) => {
    const player = getPlayer(socket);
    if (!player) return;
    const {
      roughId,
      kits: rawKits,
      placements: rawPlacements,
      requestId
    } = normalizeMutationPayload(rawPayload);
    if (!consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该开工请求缺少有效编号或已处理，请勿重复提交。");
    }
    normalizePlayer(player);
    const result = startWorkshopJobForPlayer(player, "carving", {
      itemId: roughId,
      kits: rawKits,
      placements: rawPlacements
    });
    if (!result.ok) return socket.emit("toast", result.message);
    const kitCount = result.job.options?.kits?.length || 0;
    addNews(`${player.name} 将 ${result.job.item.name} 安排为 ${kitCount} 件精雕。`, "craft");
    emitUiEvent(socket, {
      type: "modal",
      tone: "craft",
      title: "精雕已安排", subtitle: result.job.item.name,
      body: "师傅已经按你的套件位置开工，完成后会得到精雕毛坯。", stats: [
        { label: "套件", value: `${kitCount} 件` }
      ]
    });
    broadcast();
  });

  socket.on("cutSlice", (materialId) => {
    socket.emit("toast", "当前流程不再切片，请在已揭露原料上直接取手镯。");
    socket.emit("state", snapshotFor(getPlayer(socket)));
  });

  socket.on("splitSlice", () => {
    socket.emit("toast", "当前流程不再分割片料，请在已揭露原料上直接取手镯。");
    socket.emit("state", snapshotFor(getPlayer(socket)));
  });

  socket.on("craftBracelet", (materialId) => {
    socket.emit("toast", "当前流程请在已揭露原料上选择位置取手镯。");
    socket.emit("state", snapshotFor(getPlayer(socket)));
  });

  socket.on("collectBracelet", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const braceletId = typeof payload === "object" ? payload.braceletId : payload;
    const requestId = typeof payload === "object" ? payload.requestId : null;
    if (!consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该收藏请求已处理，请勿重复提交。");
    }
    const result = collectBraceletForPlayer(player, braceletId);
    if (!result?.ok) {
      if (result?.silent) return;
      return socket.emit("toast", result?.message || "收藏失败。");
    }
    socket.emit("toast", result.toast || result.message);
    if (result.uiEvent) emitUiEvent(socket, result.uiEvent);
    broadcast();
  });

  socket.on("returnCollectionItem", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const itemId = typeof payload === "object"
      ? (payload.itemId || payload.braceletId)
      : payload;
    const requestId = typeof payload === "object" ? payload.requestId : null;
    if (requestId && !consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该放回请求已处理，请勿重复提交。");
    }
    const result = returnCollectionItemForPlayer(player, itemId);
    if (!result?.ok) {
      return socket.emit("toast", result?.message || "放回失败。");
    }
    socket.emit("toast", result.toast || result.message);
    broadcast();
  });

  socket.on("startLivestreamRoom", (payload = {}, acknowledge) => {
    const player = getPlayer(socket);
    const requestId = payload?.requestId;
    if (!player) return;
    if (!consumeRequestId(player, requestId)) {
      const duplicate = { ok: false, message: "该开播请求缺少有效编号或已处理。" };
      socket.emit("toast", duplicate.message);
      if (typeof acknowledge === "function") acknowledge(duplicate);
      return;
    }
    const result = startLivestreamRoomForPlayer(
      player,
      payload.items,
      payload.workerId,
      Date.now(),
      payload.talkStyle
    );
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge({ ok: result.ok, message: result.message });
    if (result.ok) broadcast();
  });

  socket.on("replenishLivestreamRoom", (payload = {}, acknowledge) => {
    const player = getPlayer(socket);
    const requestId = payload?.requestId;
    if (!player) return;
    if (!consumeRequestId(player, requestId)) {
      const duplicate = { ok: false, message: "该补货请求缺少有效编号或已处理。" };
      socket.emit("toast", duplicate.message);
      if (typeof acknowledge === "function") acknowledge(duplicate);
      return;
    }
    const result = replenishLivestreamRoomForPlayer(player, payload.items, Date.now());
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge({ ok: result.ok, message: result.message });
    if (result.ok) broadcast();
  });

  socket.on("closeLivestreamRoom", (payload = {}, acknowledge) => {
    const player = getPlayer(socket);
    const requestId = payload?.requestId;
    if (!player) return;
    if (!consumeRequestId(player, requestId)) {
      const duplicate = { ok: false, message: "该关播请求缺少有效编号或已处理。" };
      socket.emit("toast", duplicate.message);
      if (typeof acknowledge === "function") acknowledge(duplicate);
      return;
    }
    const result = closeLivestreamRoomForPlayer(player, Date.now());
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge({ ok: result.ok, message: result.message });
    if (result.ok) broadcast();
  });

  socket.on("buyLivestreamRoomItem", (payload = {}, acknowledge) => {
    const buyer = getPlayer(socket);
    const requestId = payload?.requestId;
    if (!buyer) return;
    if (!consumeRequestId(buyer, requestId)) {
      const duplicate = { ok: false, message: "该购买请求缺少有效编号或已处理。" };
      socket.emit("toast", duplicate.message);
      if (typeof acknowledge === "function") acknowledge(duplicate);
      return;
    }
    const result = buyLivestreamRoomItemForPlayer(
      buyer,
      payload.roomId,
      payload.itemId,
      Date.now()
    );
    if (!result.ok) {
      socket.emit("toast", result.message);
      if (typeof acknowledge === "function") acknowledge({ ok: false, message: result.message });
      return;
    }
    emitUiEvent(socket, {
      type: "modal",
      tone: "trade",
      title: "直播间购买成功", subtitle: result.roomItem.product.name,
      body: `你从 ${result.seller.name} 的直播间买下了这件成品。`
    });
    if (typeof acknowledge === "function") {
      acknowledge({ ok: true, message: result.message, autoClosed: result.autoClosed });
    }
    broadcast();
  });

  socket.on("scheduleLivestream", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const requestId = payload?.requestId;
    if (requestId && !consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该直播请求已处理，请勿重复提交。");
    }
    scheduleLivestream();
    socket.emit("toast", "自动直播已升级为直播间，请打开直播间开播。");
  });

  socket.on("livestreamSell", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    const mutation = normalizeMutationPayload(payload);
    const requestId = mutation.requestId;
    if (requestId && !consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该直播请求缺少有效编号或已处理，请勿重复提交。");
    }
    sellLivestreamNow();
    socket.emit("toast", "请改用直播间上架售卖。");
  });

  socket.on("completeOrder", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该订单交付请求已处理，请勿重复提交。")) return;
    const { orderId, braceletIds } = payload;
    const result = completeOrderForPlayer(player, { orderId, braceletIds });
    if (!result.ok) {
      if (result.message) socket.emit("toast", result.message);
      return;
    }
    const {
      order,
      finalPay,
      repGain,
      qualityOk,
      badReview,
      tier,
      tipped,
      late,
      customerRating,
      satisfactionBefore,
      satisfactionAfter,
      satisfactionDelta,
      ratingTitle
    } = result;
    const title = badReview ? "订单差评" : qualityOk ? "订单交付成功" : "订单已交付";
    const body = badReview
      ? "客人对这单不满意，打了差评。"
      : qualityOk
        ? tipped
          ? "完全符合要求，客人额外给了小费。"
          : late
            ? "订单已收下，但已超时，结算有折扣。"
            : "完全符合要求，客人给了好评。"
        : late
          ? "订单已收下（超时折价），客人给出中评。"
          : "订单已收下，客人给出中评。";
    const satDeltaTxt = Number(satisfactionDelta) || 0;
    const satDeltaLabel = satDeltaTxt > 0 ? `+${satDeltaTxt}` : `${satDeltaTxt}`;
    const satBeforeTxt = satisfactionBefore == null ? "—" : `${Math.round(satisfactionBefore)}%`;
    const satAfterTxt = `${Math.round(Number(satisfactionAfter ?? player.satisfaction) || 0)}%`;
    const satStat = satDeltaTxt === 0 && satisfactionBefore != null
      ? satAfterTxt
      : `${satBeforeTxt} → ${satAfterTxt}（${satDeltaLabel}）`;
    const tierTitle = ratingTitle || customerRatingTierInfo(player.satisfaction).title;
    emitUiEvent(socket, {
      type: "modal",
      tone: badReview ? "bad" : qualityOk ? "success" : "info",
      title,
      subtitle: order.client,
      body,
      stats: [
        { label: "实际到账", value: `+${uiMoney(finalPay)}` },
        { label: "声望", value: `${repGain >= 0 ? "+" : ""}${repGain}` },
        { label: "符合", value: tier === "full" ? "完全符合" : tier === "partial" ? "部分符合" : "硬条件不符" },
        { label: "本单评价", value: customerRating || (badReview ? "差评" : "中评") },
        { label: "客户评级", value: satStat },
        { label: "评级称号", value: tierTitle }
      ]
    });
    broadcast();
  });

  registerCommerceCommands(socket, {
    recoverPlayerIfNeeded,
    getPlayer,
    acceptMutation,
    listItemForPlayer,
    emitUiEvent,
    uiMoney,
    broadcast,
    mutationValue,
    buyAssetListingForPlayer,
    addNews,
    consumeRequestId,
    buyMaterialPack,
    advanceTask,
    materialHistoryPayload,
    buyListingForPlayer,
    acceptMarketOfferForPlayer,
    normalizeMutationPayload,
    markInventoryItemsSeen,
    recycleInventoryItemForPlayer,
    withdrawListingForPlayer,
    ensureDailyOrderRefresh,
    ensureRefreshCounts,
    orderBatchRefreshFee,
    spendCash,
    replaceOrdersPool,
    refillOrders,
    replaceOrderSlot,
    orderSingleRefreshFee,
    collectMarketPayoutForPlayer,
    postWantForPlayer,
    cancelWantForPlayer,
    applyWantForPlayer,
    withdrawWantOfferForPlayer,
    settleWantForPlayer
  });


  registerBlackmarketCommands(socket, {
    getPlayer,
    acceptMutation,
    openBlackStallForPlayer,
    closeBlackStallForPlayer,
    setBlackStallPausedForPlayer,
    mutationValue,
    updateBlackStallMetaForPlayer,
    updateServiceProfileForPlayer,
    consumeRequestId,
    addGoodsBatchToStallForPlayer,
    addGoodsToStallForPlayer,
    emitUiEvent,
    uiMoney,
    broadcast,
    addBlindboxItemsForPlayer,
    withdrawBlindboxItemForPlayer,
    buyGoodsFromStallForPlayer,
    buyBlackListingForPlayer,
    publicStone,
    startBlindboxDrawForPlayer,
    settleBlindboxDrawForPlayer,
    withdrawGoodsFromStallForPlayer,
    addServiceOfferForPlayer,
    removeServiceOfferForPlayer,
    orderBlackServiceForPlayer,
    acceptBlackServiceForPlayer,
    submitBlackServiceForPlayer,
    confirmBlackServiceForPlayer,
    cancelBlackServiceForPlayer,
    submitBlackmarketRatingForPlayer,
    collectBlackmarketPayoutForPlayer
  });



  registerProgressionCommands(socket, {
    claimPlayerAchievement: deps.claimPlayerAchievement,
    claimAllPlayerAchievements: deps.claimAllPlayerAchievements,
    getPlayer,
    acceptMutation,
    claimTask,
    resetTask,
    uiMoney,
    emitUiEvent,
    broadcast
  });

  // Debug mutations are never registered in production.
  if (runtimeConfig.debugToolsEnabled !== false) {
    registerDebugCommands(socket, {
      getPlayer,
      normalizePlayer,
      earnCash,
      debugUnlockMining,
      emitUiEvent,
      spawnDebugFinishedProducts,
      broadcast
    });
  }



  });
}
