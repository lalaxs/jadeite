import { LIVESTREAM_MIN_PRICE, LIVESTREAM_MAX_ITEMS as MAX_ROOM_ITEMS, LIVESTREAM_MIN_ITEMS as MIN_ROOM_ITEMS } from "../../livestream-rules.js";
import { normalizeTalkStyle } from "../../livestream-host-bonuses.js";
import { requestId, trimLivestreamSelection } from "./catalog.js";

export function createLivestreamActions({ socketRef, getState, elsRef, ui, helpers, ports }) {
  const { selectedProductIds, priceDrafts } = ui;
  const { finishedProducts, showToast } = helpers;
  const { roomForId, itemValue, defaultPrice, resolveSelectedHost, selectedListings, renderLivestream } = ports;

function applySelectAll(products, capacity, checked) {
  selectedProductIds.clear();
  if (!checked) return;
  const limit = Math.max(0, Math.floor(Number(capacity) || 0));
  for (const item of products) {
    if (selectedProductIds.size >= limit) break;
    selectedProductIds.add(item.id);
  }
}

function reconcileSelection(products, capacity) {
  const productIds = new Set(products.map((item) => item.id));
  for (const productId of [...selectedProductIds]) {
    if (!productIds.has(productId)) selectedProductIds.delete(productId);
  }
  trimLivestreamSelection(selectedProductIds, capacity);
}

function clearWatchingRoom() {
  ui.watchingRoomId = null;
  ui.buyConfirm = null;
}

function enterHallRoom(roomId, ownerId) {
  const me = getState()?.me;
  if (me?.id && ownerId && ownerId === me.id) {
    clearWatchingRoom();
    setLivestreamTab("mine");
    return;
  }
  const room = roomForId(roomId) || (me?.livestreamRoom?.id === roomId ? me.livestreamRoom : null);
  if (!room?.id) return;
  ui.watchingRoomId = room.id;
  ui.buyConfirm = null;
  ui.activeLivestreamTab = "hall";
  ui.lastLivestreamRenderFp = "";
  renderLivestream();
}

function setLivestreamTab(tabId) {
  const next = tabId === "mine" ? "mine" : "hall";
  const wasWatching = Boolean(ui.watchingRoomId);
  if (next === "hall") clearWatchingRoom();
  else ui.watchingRoomId = null;
  if (ui.activeLivestreamTab === next && !wasWatching) return;
  ui.activeLivestreamTab = next;
  if (next !== "hall") ui.buyConfirm = null;
  if (next !== "mine") {
    ui.closeConfirmOpen = false;
    ui.hostModalOpen = false;
    ui.modalHostId = null;
  }
  renderLivestream();
}

function applyPricePreset(mult) {
  if (!selectedProductIds.size) {
    showToast?.("请先勾选要改价的商品");
    return;
  }
  const products = finishedProducts();
  const byId = new Map(products.map((item) => [item.id, item]));
  for (const id of selectedProductIds) {
    const item = byId.get(id);
    if (!item) continue;
    priceDrafts.set(id, Math.max(LIVESTREAM_MIN_PRICE, Math.round(itemValue(item) * Number(mult))));
  }
  // A preset can restore a previously rendered price after an in-place edit.
  ui.lastLivestreamRenderFp = "";
  renderLivestream();
}

function emitStart() {
  const host = resolveSelectedHost();
  const items = selectedListings(MAX_ROOM_ITEMS);
  if (items.length < MIN_ROOM_ITEMS) return;
  ui.hostModalOpen = false;
  ui.modalHostId = null;
  socketRef.emit("startLivestreamRoom", {
    items,
    workerId: host?.id || null,
    talkStyle: normalizeTalkStyle(ui.draftTalkStyle),
    requestId: requestId("livestream-start")
  });
}

function emitReplenish() {
  const roomCount = Number(getState()?.me?.livestreamRoom?.items?.length || 0);
  const items = selectedListings(Math.max(0, MAX_ROOM_ITEMS - roomCount));
  if (!items.length) return;
  socketRef.emit("replenishLivestreamRoom", {
    items,
    requestId: requestId("livestream-replenish")
  });
  selectedProductIds.clear();
  ui.replenishOpen = false;
}

function emitClose() {
  ui.closeConfirmOpen = false;
  socketRef.emit("closeLivestreamRoom", {
    requestId: requestId("livestream-close")
  });
}

function emitBuy(roomId, itemId) {
  socketRef.emit("buyLivestreamRoomItem", {
    roomId,
    itemId,
    requestId: requestId("livestream-buy")
  });
  ui.buyConfirm = null;
}

function focusLivestreamProduct(rawProductId) {
  const productId = String(rawProductId || "").trim();
  const product = finishedProducts().find((item) => String(item.id) === productId);
  if (!product) {
    showToast?.({ text: "这件成品已不在可直播库存中。", tone: "warn" });
    return false;
  }
  selectedProductIds.add(product.id);
  if (!priceDrafts.has(product.id)) priceDrafts.set(product.id, defaultPrice(product));
  ui.stockPickerQuery = product.name || "";
  ui.stockPickerFilter = "all";
  ui.stockPickerSort = "selected";
  ui.activeLivestreamTab = "mine";
  ui.watchingRoomId = null;
  ui.lastLivestreamRenderFp = "";
  renderLivestream();
  elsRef.livestream?.querySelector(`[data-product-id="${CSS.escape(product.id)}"]`)?.scrollIntoView?.({ block: "center" });
  return true;
}

  return { applySelectAll, reconcileSelection, clearWatchingRoom, enterHallRoom, setLivestreamTab, applyPricePreset, emitStart, emitReplenish, emitClose, emitBuy, focusLivestreamProduct };
}
