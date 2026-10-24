import {
  settleAchievements,
  claimAchievement,
  claimAllAchievements
} from "../../shared/domain/progression/player-progression.js";
import { markExternalMaterialNew } from "./inventory-service.js";

export function createAchievementRewards(deps = {}) {
  const earnCashFn = typeof deps.earnCash === "function" ? deps.earnCash : null;
function rewardHooks() {
  return {
    earnCash: earnCashFn || undefined,
    markExternalMaterialNew
  };
}

function settlePlayerAchievements(player, now = Date.now()) {
  return settleAchievements(player, rewardHooks(), now);
}

function claimPlayerAchievement(player, id, now = Date.now()) {
  return claimAchievement(player, id, rewardHooks(), now);
}

function claimAllPlayerAchievements(player, now = Date.now()) {
  return claimAllAchievements(player, rewardHooks(), now);
}
  return { settlePlayerAchievements, claimPlayerAchievement, claimAllPlayerAchievements };
}
