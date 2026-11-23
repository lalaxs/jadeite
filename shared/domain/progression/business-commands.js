import { businessAccess } from "./business-growth.js";

const EVENTS = {
  auction: ["enterAuction", "joinAuction", "submitAuctionBid", "requestWindow"],
  market: ["listItem", "buyListing", "acceptMarketOffer", "postWant", "applyWant", "settleWant"],
  workshop: ["startPolish", "startWorkshopJob", "assignWorkshopWorker", "extractFromRough", "startCommission", "buyWorkshopDevice", "repairWorkshopDevice"],
  hireMarket: ["refreshRecruitCandidates", "recruitWorker", "dismissWorker"],
  finishing: ["buyMaterialPack", "completeOrder", "refreshOrders", "refreshOrderSlot"],
  collection: ["collectBracelet"],
  livestream: ["startLivestreamRoom", "replenishLivestreamRoom", "scheduleLivestream", "livestreamSell"],
  bmBlind: ["bmBuyBlindbox", "bmAddBlindItems", "bmSettleBlindDraw"],
  bmService: ["bmAddServiceOffer", "bmOrderService", "bmAcceptService", "bmUpdateServiceProfile"]
};
const FEATURE_BY_EVENT = new Map(Object.entries(EVENTS).flatMap(([feature, events]) => events.map(event => [event, feature])));
export function businessCommandAccess(player, event, payload = {}) {
  if (!player?.business) return { ok: true };
  if (!player.business.choice && !["chooseBusinessStart", "setName", "sendWorldChat", "markInventorySeen"].includes(event)) {
    return { ok: false, message: "请先在主页选择开局经营方式。" };
  }
  if (["listItem", "bmListItem", "applyWant", "recycleInventoryItem", "collectBracelet", "startLivestreamRoom"].includes(event)) {
    const ids = [payload.itemId, payload.braceletId, ...(payload.entries || []).map(row => row.itemId), ...(payload.listings || []).map(row => row.productId)];
    const items = [...(player.rough || []), ...(player.materials || []), ...(player.bracelets || [])];
    if (items.some(item => item.customerCommissionId && ids.includes(item.id))) return { ok: false, message: "客户委托物需交还客户，不能出售、收藏或回收。" };
  }
  const feature = FEATURE_BY_EVENT.get(event);
  if (feature) {
    const result = businessAccess(player, feature);
    if (!result.ok) return result;
  }
  if (event === "bmOpenStall" && payload.type === "service") return businessAccess(player, "bmService");
  if (event === "requestRecovery" && player.business.choice !== "established") return { ok: false, message: "请在经营账房申请有息周转贷款，或做街坊寄售。" };
  return { ok: true };
}
