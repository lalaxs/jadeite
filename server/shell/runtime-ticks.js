import { restoreInventoryItem } from "../services/inventory-items.js";
import { playersMatching } from "../persistence/mutation-scope.js";
/**
 * World runtime ticks — legacy cutting drain, online polishing, server intervals.
 */
import { applyRepDelta } from "../../shared/domain/economy/metric-history.js";
import { settlePlayerAchievements as legacySettlePlayerAchievements } from "../services/achievement-rewards.js";
import { rollQualityColor } from "../services/rough-pool-service.js";

export const REPUTATION_DECAY_INTERVAL_MS = 10 * 60 * 1000;
export const REPUTATION_DECAY_PER_INTERVAL = 0.5;
export const REPUTATION_DECAY_FLOOR = 10;
export const MINING_HEALTH_CHECK_INTERVAL_MS = 15_000;

export function applyReputationDecay(player, now = Date.now()) {
  if (!player) return { applied: false, amount: 0 };
  const at = Math.max(0, Math.round(Number(now) || 0));
  const previous = Math.max(0, Math.round(Number(player.lastRepDecayAt) || 0));
  if (!previous || at <= previous) {
    player.lastRepDecayAt = at;
    return { applied: false, amount: 0 };
  }
  const intervals = Math.floor((at - previous) / REPUTATION_DECAY_INTERVAL_MS);
  if (intervals < 1) return { applied: false, amount: 0 };
  player.lastRepDecayAt = previous + intervals * REPUTATION_DECAY_INTERVAL_MS;
  if (Number(player.rep) <= REPUTATION_DECAY_FLOOR) {
    return { applied: false, amount: 0 };
  }
  const result = applyRepDelta(
    player,
    -intervals * REPUTATION_DECAY_PER_INTERVAL,
    "声望自然衰减",
    { source: "decay", floor: REPUTATION_DECAY_FLOOR }
  );
  return { applied: result.delta < 0, amount: Math.abs(result.delta) };
}

export function createRuntimeTicks(deps) {
  const settlePlayerAchievements = deps.settlePlayerAchievements || legacySettlePlayerAchievements;
  const {
    httpServer,
    PORT,
    HOST = "0.0.0.0",
    getState,
    startMaterialPriceTicker,
    stopMaterialPriceTicker = () => {},
    refreshRoughPool,
    addNews,
    normalizePlayer,
    isPlayerOnline,
    settleProductionJobsForPlayer,
    settleEmployeePayroll,
    broadcast,
    processAuctionLifecycle,
    reconcileAuctionEscrows,
    reconcileMarketReferences,
    reconcileBlackmarketReferences,
    maintainNpcBlackmarket,
    ensureEquipmentShop,
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
    miningAvailable = true,
    inspectMiningHealth,
    logMiningWarning = console.warn,
    logMiningInfo = console.info,
    randomUUID,
    qualityByKey,
    clamp,
    money,
    earnCash,
    markInventoryItemNew,
    angleDistance,
    cutAngleName
  } = deps;
  const runDurableMutation = typeof deps.runDurableMutation === "function"
    ? deps.runDurableMutation
    : async (_label, operation) => operation();
  const logTickError = deps.logTickError || console.error;
  const runReadOperation = deps.runReadOperation || (async (_label, operation) => operation());
  let lastMiningHealthSignature = "";
  let lastMiningRecoverySignature = "";
  let running = false;
  let listener = null;
  const timers = new Set();

  function every(ms, operation) {
    const timer = setInterval(operation, ms);
    timer.unref?.();
    timers.add(timer);
    return timer;
  }

  function runTick(label, operation, changedOnly = false) {
    Promise.resolve(runDurableMutation(label, operation, changedOnly
      ? { shouldPersist: (changed) => changed === true, key: label, audit: false }
      : { key: label, audit: false }))
      .catch((error) => logTickError(`[${label}] ${error?.message || error}`));
  }

  function reportMiningRecovery(result) {
    const fields = [
      ["recoveredTimings", "timing"],
      ["recoveredCosts", "cost"],
      ["recoveredLeaseLinks", "lease-link"],
      ["refundedJobs", "refunded"],
      ["deduplicatedJobs", "deduplicated"],
      ["recoveredConcurrentJobs", "concurrent"],
      ["prunedJobs", "pruned"]
    ];
    const parts = fields.flatMap(([key, label]) => {
      const count = Math.max(0, Math.round(Number(result?.[key]) || 0));
      return count > 0 ? [`${label}=${count}`] : [];
    });
    const signature = parts.join(",");
    if (!signature) {
      lastMiningRecoverySignature = "";
      return null;
    }
    if (signature === lastMiningRecoverySignature) return null;
    lastMiningRecoverySignature = signature;
    const message = `[mining-recovery] ${parts.join(", ")}`;
    logMiningInfo(message);
    return message;
  }

  function checkMiningHealth(now = Date.now()) {
    if (typeof inspectMiningHealth !== "function") return null;
    try {
      const report = inspectMiningHealth(now);
      const signature = (report?.issues || [])
        .map((issue) => `${issue.code}:${issue.scope}`)
        .sort()
        .join("|");
      if (signature && signature !== lastMiningHealthSignature) {
        const sample = report.issues
          .slice(0, 6)
          .map((issue) => `${issue.code}@${issue.scope}`)
          .join(", ");
        logMiningWarning(`[mining-health] ${report.issues.length} issue(s): ${sample}`);
      } else if (!signature && lastMiningHealthSignature) {
        logMiningInfo("[mining-health] recovered");
      }
      lastMiningHealthSignature = signature;
      return report;
    } catch (error) {
      const signature = `inspection_failed:${error?.message || error}`;
      if (signature !== lastMiningHealthSignature) {
        logMiningWarning(`[mining-health] inspection failed: ${error?.message || error}`);
      }
      lastMiningHealthSignature = signature;
      return null;
    }
  }

  function resolveCuttingJob(player, job) {
    const rough = job.rough;
    const quality = qualityByKey(rough.trueQualityKey);
    const bestAngle = rough.visual?.bestAngle ?? rough.visual?.suggestedAngle ?? 0;
    const crackAngle = rough.visual?.crackAngle ?? 95;
    const bestDelta = angleDistance(job.angle, bestAngle);
    const crackDelta = angleDistance(job.angle, crackAngle);
    const angleModifier = bestDelta <= 12 ? -0.16 : bestDelta <= 28 ? -0.06 : bestDelta >= 58 ? 0.13 : 0.03;
    const crackModifier = rough.visual?.crack && crackDelta <= 12 ? 0.16 : rough.visual?.crack && crackDelta <= 24 ? 0.07 : 0;
    const breakChance = clamp(0.29 - quality.score * 0.035 + rough.risk / 520 + angleModifier + crackModifier, 0.06, 0.62);
    player.stats.cutCount += 1;

    if (Math.random() < breakChance) {
      player.stats.badCutCount = (player.stats.badCutCount || 0) + 1;
      const salvage = money(rough.price * (0.08 + Math.random() * 0.2));
      earnCash(player, salvage, `切垮回收${rough.name}`, { source: "salvage", itemId: rough.id });
      applyRepDelta(player, -2, `切垮${rough.name}`, { source: "cut_fail", itemId: rough.id });
      addNews(`${player.name} ${cutAngleName(job.angle)}切垮 ${rough.name}，只回收 ${salvage}。`, "bad");
      settlePlayerAchievements(player);
      return;
    }

    const smartCut = bestDelta <= 18;
    const yieldRate = smartCut ? 0.7 + Math.random() * 0.18 : 0.44 + Math.random() * 0.26;
    const color = rollQualityColor(quality, Math.random, {
      imperialMultiplier: rough.imperialChanceMultiplier
    });
    const material = {
      id: randomUUID(),
      type: "material",
      name: `${quality.name}${color}明料`,
      qualityKey: quality.key,
      quality: quality.name,
      score: quality.score,
      color,
      mass: Math.max(0.25, Math.round((rough.mass * yieldRate) * 10) / 10),
      value: money(rough.price * quality.value * (smartCut ? 1.05 : 0.82) * (0.86 + Math.random() * 0.38)),
      rep: quality.rep,
      visual: rough.visual,
      cutAngle: job.angle,
      cutDelta: bestDelta,
      slicePotential: Math.max(1, Math.round(quality.score + rough.mass / 1.4))
    };

    restoreInventoryItem(player, "material", markInventoryItemNew(material));
    applyRepDelta(player, quality.rep, `切出${material.name}`, { source: "cut", itemId: material.id });
    if (quality.score >= 5) {
      addNews(`${player.name} ${cutAngleName(job.angle)}切出 ${material.name}，全场轰动，声望 +${quality.rep}。`, "great");
    } else {
      addNews(`${player.name} 切出 ${material.name}，估值 ${material.value}。`, "info");
    }
    if (String(color || "").includes("帝王")) {
      player.stats.everImperial = true;
    }
    settlePlayerAchievements(player);
  }

  function processCuttingJobs() {
    const state = getState();
    let changed = false;
    for (const player of state.players.values()) {
      normalizePlayer(player);
      const ready = player.cuttingJobs.filter((job) => job.readyAt <= Date.now());
      if (!ready.length) continue;
      player.cuttingJobs = player.cuttingJobs.filter((job) => job.readyAt > Date.now());
      ready.forEach((job) => resolveCuttingJob(player, job));
      changed = true;
    }
    if (changed) broadcast();
  }

  function processPolishingJobs(now = Date.now(), options) {
    options ||= {};
    const state = getState();
    let changed = false;
    for (const player of playersMatching(state.players, isPlayerOnline)) {
      normalizePlayer(player);
      if (!isPlayerOnline(player)) continue;
      const events = settleProductionJobsForPlayer(player, now);
      if (events.length) changed = true;
    }
    if (changed && options.broadcast !== false) broadcast();
    return changed;
  }

  function reconcileWorld(now = Date.now(), options = {}) {
    let changed = false;
    if (typeof ensureEquipmentShop === "function" && ensureEquipmentShop(now)) changed = true;
    if (typeof processMiningJobs === "function") {
      const miningJobResult = processMiningJobs(now);
      reportMiningRecovery(miningJobResult);
      if (miningJobResult.changed) changed = true;
    }
    if (miningAvailable && typeof processMiningWorld === "function" && processMiningWorld(now).changed) changed = true;
    if (processProductionJobs(now, { onlineOnly: false, broadcast: false })) changed = true;
    if (processLivestreamRooms(now, {
      broadcast: false,
      catchUpMaxVisits: options.livestreamCatchUpMaxVisits || 60
    })) changed = true;
    if (processAuctionLifecycle(now)) changed = true;
    if (typeof reconcileAuctionEscrows === "function" && reconcileAuctionEscrows().changed) changed = true;
    if (typeof reconcileMarketReferences === "function" && reconcileMarketReferences().changed) changed = true;
    if (processExpiredWants(now)) changed = true;
    if (typeof processMarketLiquidity === "function") {
      if (processMarketLiquidity(now).changed) changed = true;
    }
    const state = getState();
    if (typeof reconcileBlackmarketReferences === "function" && reconcileBlackmarketReferences(state, now).changed) changed = true;
    if (typeof processExpiredBlackServiceOrders === "function" && processExpiredBlackServiceOrders(state, now)) changed = true;
    if (typeof refreshBlackServiceOrderStates === "function" && refreshBlackServiceOrderStates(state)) changed = true;
    if (typeof processExpiredBlindDraws === "function" && processExpiredBlindDraws(state, now)) changed = true;
    if (typeof sweepEmptyBlackGoodsStalls === "function" && sweepEmptyBlackGoodsStalls(state)) changed = true;
    if (typeof maintainNpcBlackmarket === "function" && maintainNpcBlackmarket(now).changed) changed = true;
    if (typeof processBlackmarketCustomers === "function" && processBlackmarketCustomers(now).changed) changed = true;
    for (const player of state.players.values()) {
      normalizePlayer(player);
      if (settleEmployeePayroll?.(player, now)?.changed) changed = true;
      if (typeof ensureDailyOrderRefresh === "function") {
        if (ensureDailyOrderRefresh(player, now)) changed = true;
      } else {
        refillOrders(player);
      }
    }
    if (changed && options.broadcast !== false) broadcast();
    return changed;
  }

  function startServer() {
    if (running) return listener;
    running = true;
    checkMiningHealth();
    startMaterialPriceTicker();
    refreshRoughPool();
    addNews("本地翡翠街开市，公盘、工坊、订单与交易行已开放。", "great");

    every(MINING_HEALTH_CHECK_INTERVAL_MS, () => {
      Promise.resolve(runReadOperation("inspection:mining", () => checkMiningHealth()))
        .catch((error) => logTickError(`[inspection:mining] ${error?.message || error}`));
    });

    every(25000, () => runTick("tick:world-refresh", () => {
      const now = Date.now();
      ensureEquipmentShop?.(now);
      processPolishingJobs(now, { broadcast: false });
      refreshRoughPool();
      const miningJobResult = typeof processMiningJobs === "function" ? processMiningJobs(now) : null;
      reportMiningRecovery(miningJobResult);
      const miningJobsChanged = Boolean(miningJobResult?.changed);
      const miningWorldChanged = miningAvailable && typeof processMiningWorld === "function" && processMiningWorld(now).changed;
      processAuctionLifecycle(now);
      const wantsChanged = processExpiredWants(now);
      const liquidityChanged = typeof processMarketLiquidity === "function"
        ? processMarketLiquidity(now).changed
        : false;
      const state = getState();
      let bmChanged = processExpiredBlackServiceOrders(state, now);
      if (typeof maintainNpcBlackmarket === "function") bmChanged = maintainNpcBlackmarket(now).changed || bmChanged;
      if (typeof processBlackmarketCustomers === "function") bmChanged = processBlackmarketCustomers(now).changed || bmChanged;
      bmChanged = refreshBlackServiceOrderStates(state) || bmChanged;
      if (typeof processExpiredBlindDraws === "function") {
        bmChanged = processExpiredBlindDraws(state, now) || bmChanged;
      }
      if (typeof sweepEmptyBlackGoodsStalls === "function") {
        bmChanged = sweepEmptyBlackGoodsStalls(state) || bmChanged;
      }
      for (const player of playersMatching(state.players, isPlayerOnline)) {
        if (!isPlayerOnline(player)) continue;
        // 05:00 整池替换；不再按单卡短时 expires 拆池刷新
        if (typeof ensureDailyOrderRefresh === "function") {
          const refreshed = ensureDailyOrderRefresh(player);
          if (!refreshed) refillOrders(player);
        } else {
          player.orders = (player.orders || []).filter((order) => !order.expiresAt || order.expiresAt > Date.now());
          refillOrders(player);
        }
        applyReputationDecay(player, now);
        settleEmployeePayroll?.(player, now);
      }
      broadcast();
      void wantsChanged;
      void liquidityChanged;
      void bmChanged;
      void miningJobsChanged;
      void miningWorldChanged;
      return true;
    }));

    every(1000, () => runTick("tick:due-jobs", () => {
      const now = Date.now();
      let changed = processProductionJobs(now, { broadcast: false });
      if (typeof processMiningJobs === "function") {
        const miningJobResult = processMiningJobs(now);
        reportMiningRecovery(miningJobResult);
        if (miningJobResult.changed) changed = true;
      }
      if (miningAvailable && typeof processMiningWorld === "function" && processMiningWorld(now).changed) changed = true;
      if (processLivestreamRooms(now, { broadcast: false })) changed = true;
      if (processAuctionLifecycle(now)) changed = true;
      if (processExpiredWants(now)) changed = true;
      const state = getState();
      if (processExpiredBlackServiceOrders(state, now)) changed = true;
      if (refreshBlackServiceOrderStates(state)) changed = true;
      if (typeof processExpiredBlindDraws === "function" && processExpiredBlindDraws(state, now)) changed = true;
      if (typeof sweepEmptyBlackGoodsStalls === "function" && sweepEmptyBlackGoodsStalls(state)) changed = true;
      if (changed) broadcast();
      return changed;
    }, true));

    listener = httpServer.listen(PORT, HOST, () => {
      console.log(`Jade Market Prototype running at http://${HOST}:${PORT}`);
    });
    return listener;
  }

  async function stopServer() {
    if (!running) return;
    running = false;
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    stopMaterialPriceTicker();
    const activeListener = listener;
    listener = null;
    if (!activeListener?.listening) return;
    await new Promise((resolve, reject) => {
      activeListener.close((error) => error ? reject(error) : resolve());
      activeListener.closeIdleConnections?.();
    });
  }

  return {
    resolveCuttingJob,
    processCuttingJobs,
    processPolishingJobs,
    reconcileWorld,
    checkMiningHealth,
    reportMiningRecovery,
    startServer,
    stopServer
  };
}
