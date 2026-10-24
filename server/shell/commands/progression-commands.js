import {
  newlyUnlockedFeatures,
  playerAchievementPoints,
  buildFeatureUnlockModalEvent
} from "../../../shared/domain/progression/player-progression.js";
import {
  claimPlayerAchievement as legacyClaimPlayerAchievement,
  claimAllPlayerAchievements as legacyClaimAllPlayerAchievements
} from "../../services/achievement-rewards.js";

function emitFeatureUnlockModal(socket, beforeAp, afterAp, emitUiEvent) {
  const unlocked = newlyUnlockedFeatures(beforeAp, afterAp);
  if (!unlocked.length) return;
  const modal = buildFeatureUnlockModalEvent(unlocked, { currentAp: afterAp });
  if (modal) emitUiEvent(socket, modal);
}

export function registerProgressionCommands(socket, deps) {
  const claimPlayerAchievement = deps.claimPlayerAchievement || legacyClaimPlayerAchievement;
  const claimAllPlayerAchievements = deps.claimAllPlayerAchievements || legacyClaimAllPlayerAchievements;
  const {
    getPlayer,
    acceptMutation,
    claimTask,
    resetTask,
    uiMoney,
    emitUiEvent,
    broadcast
  } = deps;

  socket.on("task:claim", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该任务奖励领取请求已处理，请勿重复提交。")) return;
    const { uid } = payload;
    const result = claimTask(player, uid);
    if (!result.ok) return socket.emit("toast", result.message);
    socket.emit("toast", `任务完成：${result.title}${result.exp ? `，经验 +${result.exp}` : ""}`);
    emitUiEvent(socket, { type: "float", tone: "profit", text: `任务 +${uiMoney(result.reward)}`, x: 62, y: 60 });
    broadcast();
  });

  socket.on("achievement:claim", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该成就奖励领取请求已处理，请勿重复提交。")) return;
    const { id } = payload;
    const beforeAp = playerAchievementPoints(player);
    const result = claimPlayerAchievement(player, id);
    if (!result.ok) return socket.emit("toast", result.message);
    socket.emit("toast", `成就奖励已领取：${result.title}`);
    const ap = Number(result.granted?.ap) || 0;
    const floatBits = [];
    if (ap) floatBits.push(`+${ap} AP`);
    emitUiEvent(socket, {
      type: "float",
      tone: "profit",
      text: floatBits.length ? `成就 ${floatBits.join(" ")}` : "成就已领。",
      x: 62,
      y: 58
    });
    emitFeatureUnlockModal(socket, beforeAp, playerAchievementPoints(player), emitUiEvent);
    broadcast();
  });

  socket.on("achievement:claimAll", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该批量领取请求已处理，请勿重复提交。")) return;
    const result = claimAllPlayerAchievements(player);
    if (!result.ok) return socket.emit("toast", result.message);
    const exp = Math.max(0, Number(result.granted?.exp) || 0);
    const materialKinds = Object.keys(result.granted?.materials || {}).length;
    const bits = [];
    if (exp) bits.push(`经验 +${exp}`);
    if (materialKinds) bits.push(`${materialKinds} 类材料`);
    socket.emit("toast", `已领取 ${result.count} 项成就奖励${bits.length ? `：${bits.join("、")}` : ""}`);
    emitUiEvent(socket, {
      type: "float",
      tone: "profit",
      text: `已领 ${result.count} 项`,
      x: 62,
      y: 58
    });
    broadcast();
  });

  socket.on("task:reset", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该任务重置请求已处理，请勿重复提交。")) return;
    const uid = typeof payload === "object" && payload !== null ? payload.uid : payload;
    const result = resetTask(player, uid);
    if (!result.ok) return socket.emit("toast", result.message);
    const cost = Math.max(0, Number(result.cost) || 0);
    socket.emit("toast", "任务已重置。");
    emitUiEvent(socket, {
      type: "float",
      tone: cost > 0 ? "expense" : "great",
      text: cost > 0 ? `重置 -${uiMoney(cost)}` : "免费重置",
      x: 62,
      y: 60
    });
    broadcast();
  });
}
