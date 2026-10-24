/**
 * Player assets shop — workshop ownership + livestream permit listings.
 * Use createAssetsService(deps) after spendCash / refreshPlayerReport exist.
 */

export const ASSET_LISTINGS = [
  {
    id: "starter-workshop",
    type: "workshop",
    name: "街角小工坊",
    price: 8000,
    description: "解锁自己的打磨与取件工位。"
  },
  {
    id: "livestream-permit",
    type: "livestreamPermit",
    name: "直播经营许可",
    price: 10000,
    description: "解锁直播间和自动直播卖货。"
  }
];

export function createAssetsService(deps) {
  const {
    normalizePlayer,
    spendCash,
    refreshPlayerReport
  } = deps;

  function normalizeAssets(player) {
    player.assets ||= {};
    player.assets.workshopOwned = Boolean(player.assets.workshopOwned);
    player.assets.livestreamPermitOwned = Boolean(player.assets.livestreamPermitOwned);
    return player.assets;
  }

  function playerCanLivestream(player) {
    normalizePlayer(player);
    return Boolean(player.assets.livestreamPermitOwned);
  }

  function assetListingsForPlayer(player) {
    return ASSET_LISTINGS.filter((listing) => {
      if (listing.type === "workshop") return !player?.assets?.workshopOwned;
      if (listing.type === "livestreamPermit") return !player?.assets?.livestreamPermitOwned;
      return false;
    });
  }

  function buyAssetListingForPlayer(player, listingId) {
    if (!player) return { ok: false, message: "未找到玩家。" };
    normalizePlayer(player);
    const listing = ASSET_LISTINGS.find((item) => item.id === listingId);
    if (!listing) return { ok: false, message: "资产挂单不存在。" };
    if (listing.type === "workshop" && player.assets.workshopOwned) {
      return { ok: false, message: "你已经拥有自己的工坊。" };
    }
    if (listing.type === "livestreamPermit" && player.assets.livestreamPermitOwned) {
      return { ok: false, message: "你已经拥有直播经营许可。" };
    }
    if (!spendCash(player, listing.price, `购入资产：${listing.name}`, { source: "asset", itemId: listing.id })) {
      return { ok: false, code: "INSUFFICIENT_CASH", message: `购买 ${listing.name} 需要 ${listing.price}。` };
    }
    if (listing.type === "workshop") player.assets.workshopOwned = true;
    if (listing.type === "livestreamPermit") player.assets.livestreamPermitOwned = true;
    refreshPlayerReport(player);
    return { ok: true, message: `${listing.name} 已归入名下。`, listing };
  }

  return {
    ASSET_LISTINGS,
    normalizeAssets,
    playerCanLivestream,
    assetListingsForPlayer,
    buyAssetListingForPlayer
  };
}
