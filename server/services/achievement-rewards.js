// Compatibility entry; new services own their reward hooks.
import { createAchievementRewards } from "./achievement-rewards-instance.js";
export { createAchievementRewards };
let current = createAchievementRewards();
export function bindAchievementRewards(deps = {}) { current = createAchievementRewards(deps); }
export function settlePlayerAchievements(...args) { return current.settlePlayerAchievements(...args); }
export function claimPlayerAchievement(...args) { return current.claimPlayerAchievement(...args); }
export function claimAllPlayerAchievements(...args) { return current.claimAllPlayerAchievements(...args); }
