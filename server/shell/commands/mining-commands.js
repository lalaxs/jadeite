/** Mining socket command registration. Keeps transport wiring separate from the root command shell. */
import { isFeatureAvailable, MINING_UNAVAILABLE_MESSAGE } from "../../../shared/domain/feature-availability.js";

export function registerMiningCommands(socket, deps) {
  function rejectUnavailableMining(acknowledge) {
    if (isFeatureAvailable("mining")) return false;
    const result = { ok: false, code: "FEATURE_UNAVAILABLE", message: MINING_UNAVAILABLE_MESSAGE };
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    return true;
  }
  const {
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
  } = deps;

  socket.on("miningApply", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该矿权申请已处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const result = submitMiningApplication(player, payload.preferences, Date.now(), {
      allowFallback: payload.allowFallback !== false,
      expectedRevision: payload.expectedRevision
    });
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok || result.stale) broadcast();
  });

  socket.on("miningCancelApplication", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该取消请求已处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const result = cancelMiningApplication(player, Date.now(), {
      expectedRevision: payload.expectedRevision
    });
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok || result.stale) broadcast();
  });

  socket.on("miningSaveTuningExperiment", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该影子观察请求已处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const result = saveMiningTuningExperiment(player, payload.selections, Date.now());
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningReviewTuningExperiment", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该人工审核请求已处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const result = reviewMiningTuningExperiment(player, payload.experimentId, Date.now());
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningCancelTuningVersion", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该撤销排期请求已处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const result = cancelMiningTuningVersion(player, payload.versionId, Date.now());
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningRollbackTuningVersion", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该回滚请求已处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const result = rollbackMiningTuningVersion(player, payload.versionId, Date.now());
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningRefreshCandidates", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该矿工刷新请求已处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const access = canPlayerMine(player);
    if (!access.ok) {
      socket.emit("toast", access.message);
      if (typeof acknowledge === "function") acknowledge(access);
      return;
    }
    const result = refreshMinerRecruitCandidates(player, {
      rng: Math.random,
      makeId: randomUUID,
      spendCash,
      expectedCandidateIds: payload.candidateIds,
      now: Date.now()
    });
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningRecruitMiner", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该矿工招聘请求已处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const access = canPlayerMine(player);
    if (!access.ok) {
      socket.emit("toast", access.message);
      if (typeof acknowledge === "function") acknowledge(access);
      return;
    }
    ensureMinerRecruitCandidates(player, { rng: Math.random, makeId: randomUUID });
    const result = recruitMiner(player, payload.candidateId, { spendCash });
    socket.emit("toast", result.message);
    if (result.ok) addNews(`${player.name} 招聘了矿工 ${result.miner.name}。`, "craft");
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningDismissMiner", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该矿工解雇请求已处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const result = dismissMiner(player, payload.minerId, {
      minimumRoster: miningBasicMode ? 1 : 0
    });
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningTrainMiner", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该矿工训练请求已处理，请勿重复提交。", acknowledge)) return;
    if (rejectAdvancedMining(acknowledge)) return;
    normalizePlayer(player);
    const access = canPlayerMine(player);
    if (!access.ok) {
      socket.emit("toast", access.message);
      if (typeof acknowledge === "function") acknowledge(access);
      return;
    }
    const result = trainMiner(player, payload.minerId, payload.trainingId, Date.now(), { spendCash });
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: `矿工训练 -${uiMoney(result.fee)}`,
        x: 62,
        y: 64
      });
      if (result.progress?.leveled) {
        addNews(`${player.name}的矿工 ${result.miner.name} 完成训练，${result.training.skillLabel}提升至 Lv.${result.progress.level}。`, "craft");
      }
    }
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningCareMiner", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该矿工休整请求已处理，请勿重复提交。", acknowledge)) return;
    if (rejectAdvancedMining(acknowledge)) return;
    normalizePlayer(player);
    const access = canPlayerMine(player);
    if (!access.ok) {
      socket.emit("toast", access.message);
      if (typeof acknowledge === "function") acknowledge(access);
      return;
    }
    const result = careForMiner(player, payload.minerId, payload.careId, Date.now(), { spendCash });
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: `矿工休整 -${uiMoney(result.fee)}`,
        x: 62,
        y: 64
      });
    }
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningResolveMinerRetention", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该矿工留任请求已处理，请勿重复提交。", acknowledge)) return;
    if (rejectAdvancedMining(acknowledge)) return;
    normalizePlayer(player);
    const access = canPlayerMine(player);
    if (!access.ok) {
      socket.emit("toast", access.message);
      if (typeof acknowledge === "function") acknowledge(access);
      return;
    }
    const result = resolveMinerRetention(player, payload.minerId, payload.choiceId, Date.now(), { spendCash });
    socket.emit("toast", result.message);
    if (result.ok && result.fee > 0) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: `矿工留任 -${uiMoney(result.fee)}`,
        x: 62,
        y: 64
      });
    }
    if (result.ok) {
      addNews(
        result.departed
          ? `${player.name}的矿工 ${result.miner.name} 已办理离队。`
          : `${player.name}通过“${result.choice.name}”成功挽留矿工 ${result.miner.name}。`,
        result.departed ? "bad" : "craft"
      );
    }
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningFormMentorship", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该带教协议请求已处理，请勿重复提交。", acknowledge)) return;
    if (rejectAdvancedMining(acknowledge)) return;
    normalizePlayer(player);
    const access = canPlayerMine(player);
    if (!access.ok) {
      socket.emit("toast", access.message);
      if (typeof acknowledge === "function") acknowledge(access);
      return;
    }
    const result = formMinerMentorship(
      player,
      payload.mentorId,
      payload.apprenticeId,
      Date.now(),
      { spendCash }
    );
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: `签订带教 -${uiMoney(result.fee)}`,
        x: 62,
        y: 64
      });
      addNews(`${player.name}安排矿工 ${result.mentor.name} 带教 ${result.apprentice.name}。`, "craft");
    }
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningEndMentorship", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该终止带教请求已处理，请勿重复提交。", acknowledge)) return;
    if (rejectAdvancedMining(acknowledge)) return;
    normalizePlayer(player);
    const result = endMinerMentorship(player, payload.mentorshipId, Date.now());
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningSpecializeMiner", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该矿工专精请求已处理，请勿重复提交。", acknowledge)) return;
    if (rejectAdvancedMining(acknowledge)) return;
    normalizePlayer(player);
    const access = canPlayerMine(player);
    if (!access.ok) {
      socket.emit("toast", access.message);
      if (typeof acknowledge === "function") acknowledge(access);
      return;
    }
    const result = specializeMiner(player, payload.minerId, payload.specializationId, Date.now());
    socket.emit("toast", result.message);
    if (result.ok) {
      addNews(`${player.name}的矿工 ${result.miner.name} 确定职业专精：${result.specialization.name}。`, "craft");
    }
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningRenewMinerContract", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该矿工续约请求已处理，请勿重复提交。", acknowledge)) return;
    if (rejectAdvancedMining(acknowledge)) return;
    normalizePlayer(player);
    const access = canPlayerMine(player);
    if (!access.ok) {
      socket.emit("toast", access.message);
      if (typeof acknowledge === "function") acknowledge(access);
      return;
    }
    const result = renewMinerContract(player, payload.minerId, Date.now(), { spendCash });
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: `矿工续约 -${uiMoney(result.fee)}`,
        x: 62,
        y: 64
      });
    }
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningPromoteMiner", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该矿工晋升请求已处理，请勿重复提交。", acknowledge)) return;
    if (rejectAdvancedMining(acknowledge)) return;
    normalizePlayer(player);
    const access = canPlayerMine(player);
    if (!access.ok) {
      socket.emit("toast", access.message);
      if (typeof acknowledge === "function") acknowledge(access);
      return;
    }
    const result = promoteMiner(player, payload.minerId, Date.now(), { spendCash });
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: `晋升评定 -${uiMoney(result.fee)}`,
        x: 62,
        y: 64
      });
      addNews(`${player.name}的矿工 ${result.miner.name} 晋升为 T${result.targetTier}。`, "craft");
    }
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningUpgradeFacility", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该设施升级请求已处理，请勿重复提交。", acknowledge)) return;
    if (rejectAdvancedMining(acknowledge)) return;
    normalizePlayer(player);
    const result = upgradeMiningFacility(player, payload.facilityId, Date.now());
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: `设施升级 -${uiMoney(result.fee)}`,
        x: 62,
        y: 64
      });
    }
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningStartShift", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该开采请求已处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const result = startMiningShift(player, payload, Date.now());
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: `开采支出 -${uiMoney(result.fee)}`,
        x: 62,
        y: 64
      });
    }
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });

  socket.on("miningResolveIncident", (payload = {}, acknowledge) => {
    if (rejectUnavailableMining(acknowledge)) return;
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该井下急报已经处理，请勿重复提交。", acknowledge)) return;
    normalizePlayer(player);
    const result = resolveMiningIncident(player, payload.jobId, payload.choiceId, Date.now());
    socket.emit("toast", result.message);
    if (typeof acknowledge === "function") acknowledge(result);
    if (result.ok) broadcast();
  });
}

