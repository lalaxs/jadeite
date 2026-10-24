// Only compatibility consumers share this slot. Production methods close over private dependencies.
import { createBlackmarketModules } from "./create-service.js";
import { settlePlayerAchievements } from "../achievement-rewards.js";
let api = null;
let modules;
export function bindBlackmarketApi(nextApi) { api = nextApi; }
export function legacyBlackmarketModule(name) {
  modules ||= createBlackmarketModules(() => api, settlePlayerAchievements);
  return modules[name];
}
