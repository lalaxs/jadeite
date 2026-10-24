/**
 * Two-player livestream buy flow: seller opens room → buyer purchases → inventory/cash/snapshot.
 */
import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { createLivestreamService } from "../server/services/livestream-service.js";

function reset() {
  H.state.players.clear();
  H.state.sockets.clear();
  H.state.news.length = 0;
}

function install(id, name, { cash = 100_000, permit = false, bracelets = 0 } = {}) {
  const player = H.makePlayer(id);
  H.normalizePlayer(player);
  player.id = id;
  player.name = name;
  player.cash = cash;
  player.assets.livestreamPermitOwned = permit;
  player.bracelets = [];
  for (let i = 0; i < bracelets; i += 1) {
    player.bracelets.push({
      id: `${id}-p${i}`,
      type: "bracelet",
      materialStage: "finished",
      name: `${name}成品${i + 1}`,
      value: 8_000 + i * 500,
      price: 8_000 + i * 500
    });
  }
  H.state.players.set(id, player);
  return player;
}

reset();

const seller = install("ls-buy-seller", "卖家甲", { cash: 500_000, permit: true, bracelets: 3 });
const buyer = install("ls-buy-buyer", "买家乙", { cash: 100_000, permit: false, bracelets: 0 });

const listings = seller.bracelets.map((item, index) => ({
  productId: item.id,
  price: 12_000 + index * 1_000
}));

const started = H.startLivestreamRoomForPlayer(seller, listings);
assert.equal(started.ok, true, started.message);
assert.ok(seller.livestreamRoom?.id);
assert.equal(seller.livestreamRoom.items.length, 3);
assert.equal(seller.bracelets.length, 0);

const roomId = seller.livestreamRoom.id;
const roomItem = seller.livestreamRoom.items[0];
const price = roomItem.price;
const productId = roomItem.product.id;
const buyerCashBefore = buyer.cash;
const sellerCashBefore = seller.cash;

// Guest (no permit) can buy from another player's room
const bought = H.buyLivestreamRoomItemForPlayer(buyer, roomId, roomItem.id);
assert.equal(bought.ok, true, bought.message);
assert.equal(buyer.cash, buyerCashBefore - price);
assert.equal(seller.cash, sellerCashBefore + price);
assert.equal(buyer.bracelets.length, 1);
assert.equal(buyer.bracelets[0].id, productId);
assert.equal(buyer.bracelets[0].type, "bracelet");
assert.equal(seller.livestreamRoom.items.length, 2);
assert.equal(seller.livestreamRoom.totalSales, 1);

const buyerSnap = H.snapshotFor(buyer);
const hallRoom = (buyerSnap.livestreamRooms || []).find((room) => room.id === roomId);
assert.ok(hallRoom, "buyer snapshot must list seller room");
assert.equal(hallRoom.items.length, 2);
assert.equal(hallRoom.ownerId, seller.id);
assert.equal(hallRoom.sales?.length || 0, 0, "public hall room must not expose sale details");
assert.equal(hallRoom.totalSales, 1);

const sellerSnap = H.snapshotFor(seller);
assert.equal(sellerSnap.me.livestreamRoom?.sales?.length, 1, "seller private room keeps sale details");
assert.equal(sellerSnap.me.livestreamRoom.sales[0].buyerName, buyer.name);

// Self-buy rejected
const selfBuy = H.buyLivestreamRoomItemForPlayer(seller, roomId, seller.livestreamRoom.items[0].id);
assert.equal(selfBuy.ok, false);
assert.match(selfBuy.message, /自己/);

// Stale itemId rejected
const stale = H.buyLivestreamRoomItemForPlayer(buyer, roomId, roomItem.id);
assert.equal(stale.ok, false);

const rollbackItem = seller.livestreamRoom.items[0];
const rollbackBefore = {
  buyerCash: buyer.cash,
  sellerCash: seller.cash,
  buyerBracelets: structuredClone(buyer.bracelets),
  room: structuredClone(seller.livestreamRoom),
  news: structuredClone(H.state.news)
};
const failingLivestream = createLivestreamService({
  normalizePlayer: H.normalizePlayer,
  materialStageFor: H.materialStageFor,
  spendCash: H.spendCash,
  earnCash: H.earnCash,
  addItem: () => { throw new Error("injected livestream inventory failure"); },
  advanceTask: H.advanceTask,
  addNews: H.addNews,
  refreshPlayerReport: () => {},
  emitUiEventToPlayer: () => {},
  getState: () => H.state,
  broadcast: () => {},
  publicProduct: (product) => product,
  uiMoney: (value) => `¥${value}`,
  randomUUID: () => "atomic-live-sale"
});
const rollbackResult = failingLivestream.buyLivestreamRoomItemForPlayer(
  buyer,
  roomId,
  rollbackItem.id
);
assert.equal(rollbackResult.ok, false);
assert.equal(rollbackResult.code, "TRANSACTION_ABORTED");
assert.equal(buyer.cash, rollbackBefore.buyerCash);
assert.equal(seller.cash, rollbackBefore.sellerCash);
assert.deepEqual(buyer.bracelets, rollbackBefore.buyerBracelets);
assert.deepEqual(seller.livestreamRoom, rollbackBefore.room);
assert.deepEqual(H.state.news, rollbackBefore.news);

console.log("livestream-buy-flow-smoke: seller→buyer purchase ok");
