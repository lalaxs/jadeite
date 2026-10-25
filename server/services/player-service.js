import { restoreInventoryItem, restoreInventoryItems } from "./inventory-items.js";
/**
 * Player factory + normalize (legacy field migration, bucket defaults).
 * Wire via createPlayerService after assets/task/workshop deps exist.
 */
import {
  normalizePlayerProgression
} from "../../shared/domain/progression/player-progression.js";
import { settlePlayerAchievements as legacySettlePlayerAchievements } from "./achievement-rewards.js";
import { ensureMetricHistories, ensureCustomerRatingTracks } from "../../shared/domain/economy/metric-history.js";
import { normalizeRecovery } from "./recovery-service.js";
import { normalizeRequestIdHistory } from "./request-id-policy.js";
import { repairPurchasedNpcJade } from "./blackmarket/npc-jade-finish.js";
import { INITIAL_PLAYER_CASH } from "../../shared/domain/economy/new-player-economy.js";
import { registerFinanceItem } from "../../shared/domain/economy/finance-book.js";

export function createPlayerService(deps) {
  const settlePlayerAchievements = deps.settlePlayerAchievements || legacySettlePlayerAchievements;
  const {
    makeStarterRoughs,
    materialStageFor,
    normalizeAssets,
    normalizeLivestreamRoom,
    normalizeAuctionEscrow,
    normalizeWorkshop,
    normalizeMiningPlayer,
    refreshTasksIfDue
  } = deps;

  function makePlayer(playerId) {
    const suffix = String(Math.floor(100 + Math.random() * 900));
    const player = {
      id: playerId,
      name: `新手掌柜${suffix}`,
      cash: INITIAL_PLAYER_CASH,
      onboarding: { startedAt: Date.now(), rewardCash: 0, firstSaleAt: 0, starterOrderCompletedAt: 0, completedAt: 0 },
      rep: 0,
      exp: 0,
      level: 1,
      achievementPoints: 0,
      achievementPointsBonus: 0,
      achievements: {},
      satisfaction: null,
      orderSat: null,
      bmSat: null,
      buyerCredit: null,
      assets: {
        workshopOwned: true,
        livestreamPermitOwned: false
      },
      offlineSummary: null,
      pendingAuctionSettle: null,
      pendingLivestreamSettle: null,
      ledger: [],
      repHistory: [],
      expHistory: [],
      ratingHistory: [],
      lastSeenAt: Date.now(),
      lastRepDecayAt: Date.now(),
      reports: [],
      rough: makeStarterRoughs(playerId),
      starterRoughGranted: true,
      jobs: [],
      workshopDeliveries: [],
      externalMaterials: {
        goldPure: 0,
        silver925: 0,
        gold18k: 0,
        platinum: 0,
        diamond: 0,
        ruby: 0,
        sapphire: 0
      },
      polishingJobs: [],
      materials: [],
      slices: [],
      bracelets: [],
      livestreamJobs: [],
      livestreamHistory: [],
      livestreamRoom: null,
      collection: [],
      orders: [],
      payouts: [],
      blackPayouts: [],
      pendingBmRatings: [],
      bmRatingSampleCount: 0,
      soldCount: 0,
      pendingOfflineEvents: [],
      processedRequestIds: [],
      recovery: {
        debt: 0,
        lastGrantedAt: 0,
        grantCount: 0,
        repaidTotal: 0
      },
      stats: {
        cutCount: 0,
        craftCount: 0,
        orderCount: 0,
        tradeCount: 0,
        livestreamSales: 0,
        windowOpens: 0,
        finishedMade: 0,
        craftDone: 0,
        hireCount: 0,
        auctionWins: 0,
        bmDeals: 0,
        badCutCount: 0,
        cashPeak: INITIAL_PLAYER_CASH,
        everImperial: false,
        legendaryHallWin: false
      }
    };
    for (const item of player.rough) registerFinanceItem(player, item, { acquisition: true });
    normalizePlayer(player);
    return player;
  }

  function normalizePlayer(player) {
    player.cash = Number.isFinite(Number(player.cash)) ? Number(player.cash) : INITIAL_PLAYER_CASH;
    player.rep = Number.isFinite(Number(player.rep)) ? Number(player.rep) : 0;
    normalizePlayerProgression(player);
    normalizeAssets(player);
    player.rough ||= [];
    player.materials ||= [];
    // 修复旧存—脏数据：rough 桶里已开窗的明料应归—materials
    const openedInRough = [];
    player.rough = player.rough.filter((rough) => {
      if (materialStageFor(rough) === "opened") {
        openedInRough.push({ ...rough, type: "material", materialStage: "opened" });
        return false;
      }
      return true;
    });
    if (openedInRough.length) restoreInventoryItems(player, "material", openedInRough);
    player.rough = player.rough.map((rough) => ({
      ...rough,
      type: "rough",
      materialStage: materialStageFor(rough)
    }));
    player.starterRoughGranted = true;
    player.jobs ||= [];
    player.workshopDeliveries ||= [];
    const em = player.externalMaterials ||= {};
    player.externalMaterials = {
      goldPure:  Number(em.goldPure) || 0,
      silver925: Number(em.silver925 ?? em.silverMount) || 0,
      gold18k:   Number(em.gold18k ?? em.goldMount) || 0,
      platinum:  Number(em.platinum) || 0,
      diamond:   Number(em.diamond ?? em.diamondChips) || 0,
      ruby:      Number(em.ruby) || 0,
      sapphire:  Number(em.sapphire) || 0
    };
    player.externalMaterialsUnseen ||= {};
    player.polishingJobs ||= player.cuttingJobs || [];
    player.cuttingJobs = [];
    player.materials ||= [];
    player.materials = player.materials.map((material) => {
      const next = {
        ...material,
        type: material.type || "material",
        materialStage: materialStageFor(material)
      };
      // 库存明料不应残留取件轮廓；那是进行中 job 上的字段，落—materials 里会误导规划 UI—      // 余料例外：必须保—extractionKits，否则卖掉取件产物后黑洞无法回补，会看起来像完整料
      const isLeftover = next.leftover === true || next.isLeftover === true;
      if (!isLeftover && (next.materialStage === "opened" || next.type === "material")) {
        delete next.extractionKits;
        delete next.braceletPlacements;
      }
      return next;
    });
    player.slices ||= [];
    player.slices = player.slices.map((slice) => ({
      ...slice,
      type: slice.type || "slice",
      materialStage: materialStageFor(slice)
    }));
    player.bracelets ||= [];
    player.bracelets = player.bracelets.map((product) => ({
      ...product,
      type: product.type || "bracelet",
      materialStage: materialStageFor(product)
    }));
    const blackmarketPurchases = new Set((player.ledger || []).filter((entry) => entry.source === "blackmarket").map((entry) => entry.itemId));
    for (const product of player.bracelets) repairPurchasedNpcJade(product, blackmarketPurchases);
    player.livestreamJobs ||= [];
    // Drain retired countdown-job path; room model is the sole live authority.
    for (const job of player.livestreamJobs) {
      if (job?.product) restoreInventoryItem(player, "bracelet", job.product);
    }
    player.livestreamJobs = [];
    player.livestreamHistory ||= [];
    normalizeLivestreamRoom(player);
    player.collection ||= [];
    player.orders ||= [];
    player.ledger ||= [];
    ensureMetricHistories(player);
    ensureCustomerRatingTracks(player);
    player.payouts ||= [];
    player.blackPayouts ||= [];
    player.pendingBmRatings ||= [];
    player.bmRatingSampleCount = Math.max(0, Math.round(Number(player.bmRatingSampleCount) || 0));
    const nowRate = Date.now();
    player.pendingBmRatings = player.pendingBmRatings.filter((r) => Number(r.expiresAt || 0) > nowRate);
    player.offlineSummary ||= null;
    player.pendingOfflineEvents ||= [];
    player.processedRequestIds = normalizeRequestIdHistory(player.processedRequestIds);
    normalizeRecovery(player);
    player.pendingAuctionSettle ||= null;
    player.pendingAuctionSettles ||= [];
    player.pendingLivestreamSettle ||= null;
    player.reports ||= [];
    normalizeAuctionEscrow(player);
    if (typeof normalizeMiningPlayer === "function") normalizeMiningPlayer(player);
    player.lastSeenAt ||= Date.now();
    player.lastRepDecayAt ||= Date.now();
    player.stats ||= {};
    player.stats.cutCount ||= 0;
    player.stats.sliceCount ||= 0;
    player.stats.splitCount ||= 0;
    player.stats.craftCount ||= 0;
    player.stats.orderCount ||= 0;
    player.stats.tradeCount ||= 0;
    player.stats.livestreamSales ||= 0;
    player.stats.windowOpens ||= 0;
    player.stats.finishedMade ||= 0;
    player.stats.craftDone ||= 0;
    player.stats.hireCount ||= 0;
    player.stats.auctionWins ||= 0;
    player.stats.bmDeals ||= 0;
    player.stats.badCutCount ||= 0;
    player.stats.legendaryHallWin = player.stats.legendaryHallWin === true;
    player.stats.cashPeak = Math.max(Number(player.stats.cashPeak) || 0, Math.round(Number(player.cash) || 0));
    player.stats.everImperial = player.stats.everImperial === true;
    settlePlayerAchievements(player);
    player.tasks ||= [];
    player.taskRefreshedAt ||= Date.now();
    refreshTasksIfDue(player);
    normalizeWorkshop(player);
  }

  return { makePlayer, normalizePlayer };
}

/** Late-bind player normalize after assets/workshop deps exist. */
export function createDeferredPlayerService() {
  let wired = null;

  function makePlayer(playerId) {
    if (!wired) throw new Error("player-service not ready");
    return wired.makePlayer(playerId);
  }

  function normalizePlayer(player) {
    if (!wired) throw new Error("player-service not ready");
    return wired.normalizePlayer(player);
  }

  function wirePlayerService(deps) {
    wired = createPlayerService(deps);
    return wired;
  }

  return { makePlayer, normalizePlayer, wirePlayerService };
}
