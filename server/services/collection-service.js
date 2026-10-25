import { initializeInventory, takeInventoryItem, restoreInventoryItem } from "./inventory-items.js";
/**
 * 藏宝阁：成品入库冻结 / 放回仓库解冻。
 * 从 socket-handlers 剥离，handlers 只做 requestId + toast/broadcast。
 */
import {
  MAX_COLLECTION_SIZE,
  collectRepFromValue,
  collectExpFromValue,
  grantPlayerExp
} from "../../shared/domain/progression/player-progression.js";
import { applyRepDelta } from "../../shared/domain/economy/metric-history.js";

export function createCollectionService(deps) {
  const {
    takeItem,
    restoreWorkshopItem,
    materialStageFor,
    advanceTask,
    settlePlayerAchievements,
    addNews
  } = deps;

  if (typeof takeItem !== "function") throw new Error("collection-service: takeItem required");
  if (typeof restoreWorkshopItem !== "function") throw new Error("collection-service: restoreWorkshopItem required");
  if (typeof materialStageFor !== "function") throw new Error("collection-service: materialStageFor required");
  if (typeof advanceTask !== "function") throw new Error("collection-service: advanceTask required");
  if (typeof settlePlayerAchievements !== "function") {
    throw new Error("collection-service: settlePlayerAchievements required");
  }
  if (typeof addNews !== "function") throw new Error("collection-service: addNews required");

  function collectBraceletForPlayer(player, braceletId) {
    if (!player) return { ok: false, message: "玩家状态不可用。" };
    initializeInventory(player, "collection");
    if (player.collection.length >= MAX_COLLECTION_SIZE) {
      return {
        ok: false,
        message: `藏宝阁已满（上限 ${MAX_COLLECTION_SIZE} 件），请先放回仓库。`
      };
    }
    const bracelet = takeItem(player, "bracelet", braceletId);
    if (!bracelet) {
      return { ok: false, silent: true };
    }
    if (bracelet.escrowOrderId) {
      restoreWorkshopItem(player, bracelet);
      return { ok: false, message: "委托物不能收入藏宝阁。" };
    }
    if (materialStageFor(bracelet) !== "finished") {
      restoreWorkshopItem(player, bracelet);
      return { ok: false, message: "只有最终成品才能收入藏宝阁。" };
    }
    // 入库即冻结：离开 bracelets 后无法上架加工，需 returnCollectionItem 解冻
    const alreadyGranted = Boolean(bracelet.collectedRepGranted);
    const repGain = collectRepFromValue(bracelet.value, { alreadyGranted });
    const expAmount = collectExpFromValue(bracelet.value, { alreadyGranted });
    const stored = {
      ...bracelet,
      collectedAt: Date.now(),
      frozen: true,
      collectedRepGranted: true,
      collectRepGrantedAmount: alreadyGranted
        ? Math.max(0, Math.round(Number(bracelet.collectRepGrantedAmount) || 0))
        : repGain
    };
    restoreInventoryItem(player, "collection", stored);
    if (!alreadyGranted) {
      player.stats ||= {};
      player.stats.collectionUniqueCount = Math.max(0, Math.round(Number(player.stats.collectionUniqueCount) || 0)) + 1;
    }
    advanceTask(player, "collection_collect");
    if (repGain > 0) {
      applyRepDelta(player, repGain, `收入藏品${bracelet.name}`, { source: "collect", itemId: bracelet.id });
    }
    if (expAmount > 0) {
      grantPlayerExp(player, "collect_item", {
        itemValue: bracelet.value,
        collectRep: repGain,
        itemId: bracelet.id
      });
    }
    settlePlayerAchievements(player);
    addNews(
      repGain > 0
        ? `${player.name} 将「${bracelet.name}」收进藏宝阁，声望 +${repGain}。`
        : alreadyGranted
          ? `${player.name} 将「${bracelet.name}」重新收进藏宝阁。`
          : `${player.name} 将「${bracelet.name}」收进藏宝阁（本件不加声望）。`,
      "great"
    );
    const toast = repGain > 0
      ? `已收入藏宝阁：${bracelet.name}，声望 +${repGain}`
      : alreadyGranted
        ? `已收入藏宝阁${bracelet.name}（声望已领过）`
        : `已收入藏宝阁${bracelet.name}（本件不加声望）`;
    return {
      ok: true,
      message: toast,
      toast,
      repGain,
      alreadyGranted,
      uiEvent: {
        type: "float",
        tone: "great",
        text: repGain > 0 ? `声望 +${repGain}` : "已收。",
        x: 66,
        y: 66
      }
    };
  }

  function returnCollectionItemForPlayer(player, itemId) {
    if (!player) return { ok: false, message: "玩家状态不可用。" };
    const id = String(itemId || "").trim();
    if (!id) {
      return { ok: false, message: "缺少藏品编号。" };
    }
    initializeInventory(player, "collection");
    const item = takeInventoryItem(player, "collection", id);
    if (!item) {
      return { ok: false, message: "藏宝阁中找不到这件藏品。" };
    }
    delete item.collectedAt;
    delete item.frozen;
    item.type = item.type || "bracelet";
    try {
      restoreWorkshopItem(player, item);
    } catch (_) {
      restoreInventoryItem(player, "bracelet", item);
    }
    const toast = `${item.name || "藏品"} 已放回仓库，可继续交易或加工。`;
    return { ok: true, message: toast, toast, item };
  }

  return {
    collectBraceletForPlayer,
    returnCollectionItemForPlayer,
    MAX_COLLECTION_SIZE
  };
}
