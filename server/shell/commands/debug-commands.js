import {
  grantPlayerExp,
  newlyUnlockedFeatures,
  grantDebugAchievementPoints,
  buildFeatureUnlockModalEvent
} from "../../../shared/domain/progression/player-progression.js";
import { isFeatureAvailable, MINING_UNAVAILABLE_MESSAGE } from "../../../shared/domain/feature-availability.js";
import {
  applyRepDelta,
  setSatisfactionValue,
  clearCustomerRating,
  customerRatingTierInfo
} from "../../../shared/domain/economy/metric-history.js";

function emitFeatureUnlockModal(socket, beforeAp, afterAp, emitUiEvent) {
  const unlocked = newlyUnlockedFeatures(beforeAp, afterAp);
  if (!unlocked.length) return;
  const modal = buildFeatureUnlockModalEvent(unlocked, { currentAp: afterAp });
  if (modal) emitUiEvent(socket, modal);
}

export function registerDebugCommands(socket, deps) {
  const {
    getPlayer,
    normalizePlayer,
    earnCash,
    debugUnlockMining,
    emitUiEvent,
    spawnDebugFinishedProducts,
    broadcast
  } = deps;

  socket.on("debugGrant", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    normalizePlayer(player);
    const body = payload && typeof payload === "object" ? payload : {};
    const addCash = Number(body.cash) || 0;
    const addRep = Number(body.rep) || 0;
    const addAp = Number(body.ap) || Number(body.achievementPoints) || 0;
    const addExp = Math.max(0, Math.round(Number(body.exp) || 0));
    const unlockMining = body.unlockMining === true;
    const satisfaction = body.satisfaction;
    const clearRating = body.clearRating === true;
    const bits = [];
    if (addCash) {
      earnCash(player, addCash, "调试加现", { source: "debug", recoveryDebtExempt: true });
      bits.push(`现金 ${addCash >= 0 ? "+" : ""}${addCash}`);
    }
    if (addRep) {
      applyRepDelta(player, addRep, "调试加声", { source: "debug" });
      bits.push(`声望 ${addRep >= 0 ? "+" : ""}${addRep}`);
    }
    if (addAp) {
      const apResult = grantDebugAchievementPoints(player, addAp);
      bits.push(`成就积分 +${apResult.gained}（现 ${apResult.after}）`);
      emitFeatureUnlockModal(socket, apResult.before, apResult.after, emitUiEvent);
      emitUiEvent(socket, {
        type: "float",
        tone: "profit",
        text: `+${apResult.gained} AP`,
        x: 62,
        y: 58
      });
    }
    if (addExp) {
      const expResult = grantPlayerExp(player, "debug", { amount: addExp });
      bits.push(`经营经验 +${expResult.granted}（现 ${player.exp}）`);
      emitUiEvent(socket, {
        type: "float",
        tone: "profit",
        text: `经验 +${expResult.granted}`,
        x: 62,
        y: 58
      });
    }
    if (unlockMining) {
      const result = !isFeatureAvailable("mining")
        ? { ok: false, message: MINING_UNAVAILABLE_MESSAGE }
        : typeof debugUnlockMining === "function"
        ? debugUnlockMining(player)
        : { ok: false, message: "矿山调试功能不可用。" };
      bits.push(result.message || (result.ok ? "矿山已解锁。" : "矿山解锁失败。"));
    }
    if (clearRating) {
      clearCustomerRating(player);
      bits.push("客户评级已重置为未评。");
    }
    if (satisfaction !== undefined && satisfaction !== null && satisfaction !== "") {
      setSatisfactionValue(player, satisfaction, "调试设置客户评级", { source: "debug", track: "both" });
      player.stats.orderCount = Math.max(1, Number(player.stats.orderCount) || 0);
      bits.push(`客户评级 ${Math.round(player.satisfaction)}%${customerRatingTierInfo(player.satisfaction).title}）`);
    }
    socket.emit("toast", bits.length ? `调试${bits.join("。")}` : "调试：无变更");
    broadcast();
  });

  socket.on("debugSpawnFinished", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const count = payload?.count ?? 50;
    normalizePlayer(player);
    const result = spawnDebugFinishedProducts(player, { count });
    if (!result.ok) {
      socket.emit("toast", result.message || "调试刷成品失败。");
      return;
    }
    socket.emit("toast", `调试：已刷入 ${result.count} 件不同成品`);
    broadcast();
  });
}
