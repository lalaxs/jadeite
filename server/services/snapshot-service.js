/**
 * World snapshot assembly — publicPlayer / private me / full state payload.
 */
import { collectionPowerOf, collectionValueOf } from "../../shared/domain/progression/player-progression.js";
import { customerRatingTierInfo } from "../../shared/domain/economy/metric-history.js";
import { publicAuctionRounds } from "./auction-rounds.js";
import { systemDemandSnapshot } from "../../shared/domain/economy/system-demand.js";
import { operatingReserveFor } from "../../shared/domain/economy/operating-reserve.js";
import {
  publicAuctionSnapshot,
  publicAuctionHistoryEntry
} from "../../shared/domain/auction/jade-auction.js";
import {
  publicStone,
  publicListing,
  publicWant,
  publicWantOffer,
  publicProductionJob,
  publicLivestreamJob
} from "./snapshot-public.js";

export function createSnapshotService(deps) {
  const {
    getState,
    TIMING,
    TASK_REFRESH_MS,
    playerReportSnapshot,
    isWorkerBusy,
    isMinerBusy,
    miningSnapshotForPlayer,
    publicLivestreamRoom,
    publicBlackStall,
    publicServiceOrdersForPlayer,
    assetListingsForPlayer,
    materialCatalogForPlayer,
    equipmentCatalog,
    inlayCatalog,
    publicAuctionHalls,
    commissionSnapshotForPlayer
  } = deps;

  const rankingIndexes = new WeakMap();
  const miningContexts = new WeakMap();
  let rankingCache = null;

  function rankingsFor(publicPlayers) {
    // Fingerprint actual public rows rather than maintaining a second dirty-state
    // protocol. Name, scores, collection and insertion order all invalidate it.
    const fingerprint = JSON.stringify(publicPlayers);
    if (rankingCache?.fingerprint === fingerprint) return rankingCache;
    const rankings = {};
    const indexes = {};
    for (const [board, key] of [["rep", "rep"], ["cash", "cash"], ["collection", "collectionValue"]]) {
      const rows = [...publicPlayers].sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))
        .map((player, index) => ({ player, rank: index + 1, score: Number(player[key] || 0) }));
      rankings[board] = rows.slice(0, 100);
      indexes[board] = new Map(rows.map((row, index) => [row.player.id, { row, previous: rows[index - 1] || null }]));
    }
    deps.metrics?.increment("jade_ranking_rebuilds_total");
    rankingCache = { fingerprint, rankings, indexes };
    return rankingCache;
  }

  function detachForTransport(value) {
    return structuredClone(value);
  }

  function publicPlayer(player) {
    const livestreamRoomStock = player.livestreamRoom?.items?.length || 0;
    return {
      id: player.id,
      name: player.name,
      cash: player.cash,
      rep: Math.round(player.rep),
      level: player.level,
      exp: player.exp,
      achievementPoints: player.achievementPoints,
      satisfaction: player.satisfaction == null || player.satisfaction === ""
        ? null
        : Math.round(Number(player.satisfaction)),
      ratingTitle: player.satisfaction == null || player.satisfaction === ""
        ? null
        : customerRatingTierInfo(player.satisfaction).title,
      collectionPower: collectionPowerOf(player),
      collectionValue: collectionValueOf(player),
      inventoryCount: player.rough.length + player.jobs.length + player.polishingJobs.length + livestreamRoomStock + player.materials.length + player.slices.length + player.bracelets.length
        + (player.workshopDeliveries || []).reduce((count, delivery) => count + delivery.items.length + delivery.auxiliaryItems.length, 0),
      collectionCount: player.collection.length
    };
  }

  function buildPrivatePlayerSnapshot(player, now = Date.now()) {
    const currentReport = playerReportSnapshot(player, now);
    const ownsCost = item => !item?.escrowOrderId || item.escrowFromBuyerId === player.id;
    const ownStone = item => publicStone(item, { privateFinance: ownsCost(item) });
    const ownProductionJob = job => publicProductionJob(job, { privateFinance: ownsCost(job.item || job.rough) });
    const ownLivestreamJob = job => publicLivestreamJob(job, { privateFinance: ownsCost(job.product) });
    const {
      pendingOfflineEvents,
      auth,
      processedRequestIds,
      financeBook,
      ...safePlayer
    } = player;
    return {
      ...safePlayer,
      reports: currentReport ? [currentReport] : [],
      systemDemand: systemDemandSnapshot(player, now),
      operatingReserve: operatingReserveFor(player),
      ...(typeof commissionSnapshotForPlayer === "function" ? { commissions: commissionSnapshotForPlayer(player, now) } : {}),
      workshop: {
        ...player.workshop,
        ...(player.workshop.owner ? { owner: { ...player.workshop.owner,
          busy: isWorkerBusy(player, player.workshop.owner.id) || Boolean(player.commissions?.active) } } : {}),
        devices: player.workshop.devices.map(({ tradeHistory, ...device }) => device),
        workers: player.workshop.workers.map(({ tradeHistory, ...worker }) => ({
          ...worker,
          busy: isWorkerBusy(player, worker.id)
        }))
      },
      mining: {
        ...(player.mining || {}),
        miners: (player.mining?.miners || []).map((miner) => ({
          ...miner,
          busy: typeof isMinerBusy === "function" ? isMinerBusy(player, miner.id) : false
        })),
        recruitCandidates: structuredClone(player.mining?.recruitCandidates || []),
        jobs: structuredClone(player.mining?.jobs || []),
        history: structuredClone(player.mining?.history || []),
        leaseHistory: structuredClone(player.mining?.leaseHistory || [])
      },
      recruitCandidates: structuredClone(player.recruitCandidates || []),
      jobs: player.jobs.map(ownProductionJob),
      workshopDeliveries: (player.workshopDeliveries || []).map((delivery) => ({
        ...delivery,
        ...(delivery.scratchReveal ? { scratchReveal: structuredClone(delivery.scratchReveal) } : {}),
        items: delivery.items.map(ownStone),
        auxiliaryItems: delivery.auxiliaryItems.map(ownStone)
      })),
      rough: player.rough.map(ownStone),
      polishingJobs: player.polishingJobs.map(ownProductionJob),
      materials: player.materials.map(ownStone),
      slices: player.slices.map(ownStone),
      bracelets: player.bracelets.map(ownStone),
      livestreamJobs: player.livestreamJobs.map(ownLivestreamJob),
      livestreamHistory: player.livestreamHistory.map(ownLivestreamJob),
      livestreamRoom: publicLivestreamRoom(player, { publicProduct: ownStone }),
      collection: player.collection.map(ownStone),
      tasks: (player.tasks || []).map((task) => ({ ...task })),
      taskRefreshedAt: player.taskRefreshedAt || now,
      taskRefreshMs: TASK_REFRESH_MS
    };
  }

  function privatePlayerSnapshot(player, now = Date.now()) {
    return detachForTransport(buildPrivatePlayerSnapshot(player, now));
  }

  function sharedSnapshotFor(now = Date.now()) {
    const state = getState();
    const publicPlayers = [...state.players.values()].map(publicPlayer);
    const { rankings, indexes } = rankingsFor(publicPlayers);
    const shared = detachForTransport({
      serverNow: now,
      worldStartedAt: state.startedAt,
      timing: {
        day: TIMING.day,
        production: TIMING.production,
        auction: TIMING.auction
      },
      roughPool: state.roughPool.map(publicStone),
      equipmentShop: structuredClone(state.equipmentShop || null),
      listings: state.listings.map(publicListing),
      livestreamRooms: [...state.players.values()]
        .map((owner) => publicLivestreamRoom(owner, {
          publicProduct: publicStone,
          includeSales: false
        }))
        .filter(Boolean)
        .sort((left, right) => right.startedAt - left.startedAt),
      onlinePlayerCount: new Set(state.sockets.values()).size,
      players: rankings.rep.map((row) => row.player),
      rankings,
      marketPlayers: Object.fromEntries([...new Set(state.listings.map((listing) => listing.ownerId))]
        .map((id) => { const owner = state.players.get(id); return [id, owner ? { id, name: owner.name, rep: Math.round(owner.rep), level: owner.level } : null]; })),
      rankingPlayerCount: publicPlayers.length,
      news: structuredClone(state.news),
      worldChat: structuredClone(Array.isArray(state.worldChat) ? state.worldChat : [])
    });
    rankingIndexes.set(shared, indexes);
    miningContexts.set(shared, {});
    return shared;
  }

  function snapshotFor(player, now = Date.now(), options = {}) {
    const state = getState();
    const includeStaticCatalogs = options.includeStaticCatalogs !== false;
    const includePrivatePlayer = options.includePrivatePlayer !== false;
    const sharedSnapshot = options.sharedSnapshot || sharedSnapshotFor(now);
    const indexes = rankingIndexes.get(sharedSnapshot);
    const rankingSelf = indexes ? Object.fromEntries(Object.entries(indexes).map(([board, index]) => [board, index.get(player.id) || null])) : {};
    const personalized = detachForTransport({
      rankingSelf,
      ...(includePrivatePlayer ? { me: privatePlayerSnapshot(player, now) } : {}),
      blackListings: [],
      listings: state.listings.map(listing => listing.ownerId === player.id
        ? { ...publicListing(listing), item: publicStone(listing.item, { privateFinance: true }) }
        : publicListing(listing)),
      blackStalls: (state.blackStalls || [])
        .map((stall) => publicBlackStall(stall, player.id, publicStone))
        .filter(Boolean),
      blackServiceOrders: publicServiceOrdersForPlayer(state, player.id, player.id, now),
      wants: state.wants.map(want => ({ ...publicWant(want), offers: (want.offers || []).map(offer => ({
        ...publicWantOffer(offer), item: publicStone(offer.item, { privateFinance: offer.sellerId === player.id })
      })) })),
      assetListings: assetListingsForPlayer(player),
      materialCatalog: materialCatalogForPlayer(player),
      staticCatalogVersion: 1,
      ...(includeStaticCatalogs ? {
        equipmentCatalog: equipmentCatalog(),
        inlayCatalog: inlayCatalog()
      } : {}),
      auction: publicAuctionSnapshot(state.auction, player.id, now, state.latestAuctionResults),
      auctionRounds: publicAuctionRounds(state, player.id, now),
      auctionHistory: state.auctionHistory.map((entry) => publicAuctionHistoryEntry(entry, player.id)),
      auctionHalls: publicAuctionHalls(player),
      mining: typeof miningSnapshotForPlayer === "function"
        ? miningSnapshotForPlayer(player, now, miningContexts.get(sharedSnapshot) || {})
        : null
    });
    return {
      ...sharedSnapshot,
      ...personalized
    };
  }

  return {
    publicPlayer,
    privatePlayerSnapshot,
    sharedSnapshotFor,
    snapshotFor
  };
}
