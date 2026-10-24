// Instance-owned implementation; legacy entry points remain one directory above.
import { featureAccess } from "../../../../shared/domain/progression/player-progression.js";

export function createContext({
  getApi,
  settlePlayerAchievements
}) {
  function requireApi() {
    const api = getApi();
    if (!api) throw new Error("blackmarket-service: bindBlackmarketApi() was not called");
    return api;
  }

function bumpBmDeal(player) {
  if (!player) return;
  player.stats ||= {};
  player.stats.bmDeals = (player.stats.bmDeals || 0) + 1;
  settlePlayerAchievements(player);
}

function denyUnlessBmBuy(player) {
  const access = featureAccess(player, "bmBuy");
  if (!access.ok) return { ok: false, message: access.message, code: "FEATURE_LOCKED" };
  return null;
}

function denyUnlessBmStall(player) {
  const access = featureAccess(player, "bmStall");
  if (!access.ok) return { ok: false, message: access.message, code: "FEATURE_LOCKED" };
  return null;
}

  return {
    bumpBmDeal,
    requireApi,
    denyUnlessBmBuy,
    denyUnlessBmStall
  };
}
