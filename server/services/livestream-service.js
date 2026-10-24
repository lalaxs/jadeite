import { playersMatching } from "../persistence/mutation-scope.js";
import { employeeWorkBlock, enterEmployeePayrollDay } from "../systems/employee-payroll.js";
/**
 * Livestream service — single authority: public stall rooms.
 * Legacy scheduleLivestream / livestreamJobs are retired (stubs for socket contract freeze).
 */
import {
  normalizeLivestreamRoom,
  startLivestreamRoom as startLivestreamRoomState,
  replenishLivestreamRoom as replenishLivestreamRoomState,
  closeLivestreamRoom as closeLivestreamRoomState,
  purchaseLivestreamRoomItem as purchaseLivestreamRoomItemState,
  processAiLivestreamRooms,
  publicLivestreamRoom,
  buildLivestreamSettleReport
} from "../systems/livestream-room-system.js";
import {
  isWorkerBusy,
  grantActivityExperience
} from "../systems/employee-system.js";
import {
  grantPlayerExp
} from "../../shared/domain/progression/player-progression.js";
import { settlePlayerAchievements as legacySettlePlayerAchievements } from "./achievement-rewards.js";
import {
  buildLivestreamSettleModalEvent
} from "../../shared/domain/livestream/settle-modal.js";
import { attemptAtomicMutation } from "./atomic-mutation.js";

export { normalizeLivestreamRoom, publicLivestreamRoom, buildLivestreamSettleReport };

export function createLivestreamService(deps) {
  const settlePlayerAchievements = deps.settlePlayerAchievements || legacySettlePlayerAchievements;
  const {
    normalizePlayer,
    materialStageFor,
    spendCash,
    earnCash,
    addItem,
    advanceTask,
    addNews,
    refreshPlayerReport,
    emitUiEventToPlayer,
    getState,
    broadcast,
    publicProduct,
    uiMoney,
    randomUUID
  } = deps;

  function deliverLivestreamSettle(player, settleReport) {
    if (!player || !settleReport?.roomId) return;
    player.pendingLivestreamSettle = settleReport;
    if (typeof emitUiEventToPlayer === "function") {
      emitUiEventToPlayer(player, buildLivestreamSettleModalEvent(settleReport, uiMoney));
    }
  }

  function ackLivestreamSettleForPlayer(player, roomId = "") {
    if (!player?.pendingLivestreamSettle) return { ok: true, cleared: false };
    const pendingId = String(player.pendingLivestreamSettle.roomId || "");
    if (roomId && pendingId && pendingId !== String(roomId)) {
      return { ok: true, cleared: false };
    }
    player.pendingLivestreamSettle = null;
    return { ok: true, cleared: true };
  }

  function recordLivestreamRoomSale(player, sale, { afterCommit } = {}) {
    player.livestreamHistory ||= [];
    player.livestreamHistory.unshift(sale);
    player.livestreamHistory = player.livestreamHistory.slice(0, 40);
    player.soldCount = (player.soldCount || 0) + 1;
    player.stats ||= {};
    player.stats.livestreamSales = (player.stats.livestreamSales || 0) + 1;
    grantPlayerExp(player, "livestream_sale");
    settlePlayerAchievements(player);
    const notifySale = () => emitUiEventToPlayer(player, {
      type: "float",
      tone: "profit",
      text: `${sale.product?.name || "成品"}已售出`,
      x: 66,
      y: 62
    });
    if (typeof afterCommit === "function") afterCommit(notifySale);
    else notifySale();
  }

  function livestreamRoomDependencies(now = Date.now(), overrides = {}) {
    return {
      now,
      makeId: randomUUID,
      rng: overrides.rng || Math.random,
      forceVisit: overrides.forceVisit === true,
      isFinishedProduct: (product) => materialStageFor(product) === "finished",
      spendCash,
      earnCash,
      addItem,
      advanceTask,
      recordSale: recordLivestreamRoomSale,
      addNews,
      publicProduct,
      grantHostExperience: (seller, workerId, activity) => {
        const worker = (seller?.workshop?.workers || []).find((entry) => entry.id === workerId);
        if (!worker) return null;
        const xpResult = grantActivityExperience(worker, activity);
        if (xpResult?.levelUps?.length) {
          const label = xpResult.levelUps
            .map((entry) => ({
              huashu: "话术",
              kongchang: "控场",
              cuidan: "催单"
            })[entry.key] || entry.key)
            .join("。");
          emitUiEventToPlayer(seller, {
            type: "float",
            tone: "craft",
            text: `${worker.name} ${label}升级`,
            x: 70,
            y: 58
          });
        }
        return xpResult;
      },
      onRoomAutoClosed: (seller, payload = {}) => {
        const salesCount = typeof payload === "number"
          ? payload
          : Number(payload?.salesCount || 0);
        grantPlayerExp(seller, "livestream_close", { salesCount });
        settlePlayerAchievements(seller);
        if (payload && typeof payload === "object" && payload.settleReport) {
          deliverLivestreamSettle(seller, payload.settleReport);
        }
      },
      ...overrides
    };
  }

  /** Return any leftover legacy countdown-job products to bracelet inventory. */
  function retireLegacyLivestreamJobs(player) {
    if (!player) return 0;
    const jobs = Array.isArray(player.livestreamJobs) ? player.livestreamJobs : [];
    let restored = 0;
    for (const job of jobs) {
      if (job?.product) {
        addItem(player, job.product, { asNew: false });
        restored += 1;
      }
    }
    player.livestreamJobs = [];
    return restored;
  }

  function startLivestreamRoomForPlayer(player, listings, workerId = null, now = Date.now(), talkStyle = "balanced") {
    normalizePlayer(player);
    if (enterEmployeePayrollDay(player, { spendCash, now, reason: "continued" }).changed) broadcast?.();
    const blocked = employeeWorkBlock(player, now);
    if (blocked) return blocked;
    retireLegacyLivestreamJobs(player);
    const requestedId = String(workerId || "").trim();
    let host = null;
    if (requestedId) {
      const worker = (player.workshop?.workers || []).find((entry) => entry.id === requestedId);
      if (!worker) {
        return { ok: false, message: "找不到这位员工。" };
      }
      if (isWorkerBusy(player, worker.id)) {
        return { ok: false, message: "这位员工正在忙，请换一位主播。" };
      }
      host = {
        id: worker.id,
        name: worker.name,
        job: worker.job,
        tier: worker.tier,
        skills: worker.skills
      };
    }
    const result = startLivestreamRoomState(
      player,
      listings,
      {
        ...livestreamRoomDependencies(now),
        talkStyle,
        host
      }
    );
    if (result.ok) {
      refreshPlayerReport(player, now);
      addNews(
        host
          ? `${player.name} 安排 ${host.name} 开启直播间，上架${result.room.items.length} 件成品。`
          : `${player.name} 开启直播间，上架${result.room.items.length} 件成品。`,
        "trade"
      );
    }
    return result;
  }

  function replenishLivestreamRoomForPlayer(player, listings, now = Date.now()) {
    normalizePlayer(player);
    if (enterEmployeePayrollDay(player, { spendCash, now, reason: "continued" }).changed) broadcast?.();
    const blocked = employeeWorkBlock(player, now);
    if (blocked) return blocked;
    const result = replenishLivestreamRoomState(
      player,
      listings,
      livestreamRoomDependencies(now)
    );
    if (result.ok) {
      refreshPlayerReport(player, now);
      addNews(`${player.name} 为直播间补货 ${result.added.length} 件成品。`, "trade");
    }
    return result;
  }

  function closeLivestreamRoomForPlayer(player, now = Date.now()) {
    normalizePlayer(player);
    const salesCount = Number(player.livestreamRoom?.totalSales || 0);
    const result = closeLivestreamRoomState(
      player,
      livestreamRoomDependencies(now)
    );
    if (result.ok) {
      grantPlayerExp(player, "livestream_close", { salesCount });
      settlePlayerAchievements(player);
      if (result.settleReport) deliverLivestreamSettle(player, result.settleReport);
      refreshPlayerReport(player, now);
    }
    return result;
  }

  function livestreamRoomSeller(roomId) {
    for (const player of getState().players.values()) {
      if (player.livestreamRoom?.id === roomId) return player;
    }
    return null;
  }

  function buyLivestreamRoomItemForPlayer(buyer, roomId, itemId, now = Date.now()) {
    normalizePlayer(buyer);
    const seller = livestreamRoomSeller(roomId);
    if (!seller) return { ok: false, message: "直播间已经关闭。" };
    const state = getState();
    const result = attemptAtomicMutation(
      [buyer, seller, state.news],
      ({ afterCommit }) => purchaseLivestreamRoomItemState({
        seller,
        buyer,
        itemId,
        buyerType: "player",
        buyerName: buyer.name
      }, livestreamRoomDependencies(now, {
        recordSale: (owner, sale) => recordLivestreamRoomSale(owner, sale, { afterCommit })
      })),
      { message: "直播购买未完成，买卖双方资产已恢复，请重试。" }
    );
    if (result.ok) {
      refreshPlayerReport(seller, now);
      refreshPlayerReport(buyer, now);
    }
    return { ...result, seller };
  }

  function processLivestreamRooms(now = Date.now(), options = {}) {
    const owners = [...playersMatching(getState().players, (entry) => Boolean(entry.livestreamRoom && entry.livestreamRoom.status === "live"))];
    const changed = processAiLivestreamRooms(
      owners,
      livestreamRoomDependencies(now, options)
    );
    if (changed) {
      for (const player of owners) refreshPlayerReport(player, now);
      if (options.broadcast !== false) broadcast();
    }
    return changed;
  }

  /** @deprecated UI uses livestream rooms; kept for frozen socket contract. */
  function scheduleLivestream() {
    return null;
  }

  /** @deprecated UI uses livestream rooms; kept for frozen socket contract. */
  function sellLivestreamNow() {
    return null;
  }

  /** @deprecated no-op — legacy countdown jobs are retired. */
  function settleLivestreamJobsForPlayer() {
    return [];
  }

  /** @deprecated no-op — legacy countdown jobs are retired. */
  function processLivestreamJobs() {
    return false;
  }

  return {
    recordLivestreamRoomSale,
    livestreamRoomDependencies,
    retireLegacyLivestreamJobs,
    startLivestreamRoomForPlayer,
    replenishLivestreamRoomForPlayer,
    closeLivestreamRoomForPlayer,
    livestreamRoomSeller,
    buyLivestreamRoomItemForPlayer,
    processLivestreamRooms,
    deliverLivestreamSettle,
    ackLivestreamSettleForPlayer,
    scheduleLivestream,
    sellLivestreamNow,
    settleLivestreamJobsForPlayer,
    processLivestreamJobs
  };
}
