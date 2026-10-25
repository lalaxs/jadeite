import { LIVESTREAM_MIN_PRICE, LIVESTREAM_MAX_ITEMS as MAX_ROOM_ITEMS } from "../../livestream-rules.js";
import { systemSalePriceCap } from "../../../shared/domain/economy/system-demand.js";
import { rankLivestreamHosts, hostBonusPreview, hostBonusesFromWorker } from "../../livestream-host-bonuses.js";
import { workerJobLabel } from "../../worker-detail-view.js";

export function createLivestreamSelectors({ getState, getActiveView, ui, helpers }) {
  const { selectedProductIds, priceDrafts, slideIndexByRoom } = ui;
  const { finishedProducts } = helpers;

function rooms() {
  return getState()?.livestreamRooms || [];
}

function roomForId(roomId) {
  return rooms().find((room) => room.id === roomId) || null;
}

function itemValue(item) {
  return Math.max(1, Number(item?.value || item?.price || 100));
}

function defaultPrice(item) {
  return Math.max(LIVESTREAM_MIN_PRICE, Math.min(Math.round(itemValue(item) * 1.05), systemSalePriceCap(getState?.()?.me || {}, [item])));
}

function draftPrice(item) {
  if (!priceDrafts.has(item.id)) priceDrafts.set(item.id, defaultPrice(item));
  return priceDrafts.get(item.id);
}

function currentSlideIndex(room) {
  const count = room?.items?.length || 0;
  if (!count) return 0;
  const index = Number(slideIndexByRoom.get(room.id) || 0);
  const normalized = ((index % count) + count) % count;
  slideIndexByRoom.set(room.id, normalized);
  return normalized;
}

function visibleChatRoomIds() {
  if (getActiveView?.() !== "livestream") return [];
  const state = getState?.();
  if (!state?.me) return [];
  if (ui.watchingRoomId) return [ui.watchingRoomId];
  if (ui.activeLivestreamTab === "mine") {
    const myId = state.me.livestreamRoom?.id;
    return myId ? [myId] : [];
  }
  return (state.livestreamRooms || [])
    .filter((room) => room.ownerId !== state.me.id && room.items?.length)
    .map((room) => room.id);
}

function availableHosts() {
  return rankLivestreamHosts(getState()?.me?.workshop?.workers || []);
}

function ensureDraftHost() {
  const hosts = availableHosts();
  if (!hosts.length) {
    ui.draftHostId = null;
    return null;
  }
  if (!ui.draftHostId) return null;
  const selected = hosts.find((worker) => worker.id === ui.draftHostId && !worker.busy);
  if (selected) return selected;
  ui.draftHostId = null;
  return null;
}

function resolveSelectedHost() {
  return ensureDraftHost();
}

function resolveModalHost() {
  const hosts = availableHosts();
  if (!ui.modalHostId) return null;
  const selected = hosts.find((worker) => worker.id === ui.modalHostId && !worker.busy);
  if (selected) return selected;
  ui.modalHostId = null;
  return null;
}

function hostSubtitle(room) {
  const host = room?.host;
  if (!host?.name) return "";
  return `主播 ${host.name} · ${workerJobLabel(host.job)}`;
}

function selectedProducts(products) {
  const byId = new Map(products.map((item) => [item.id, item]));
  return [...selectedProductIds].map((id) => byId.get(id)).filter(Boolean);
}

function selectionSummary(products) {
  const selected = selectedProducts(products);
  let totalPrice = 0;
  let totalValue = 0;
  for (const item of selected) {
    totalPrice += Number(draftPrice(item)) || 0;
    totalValue += itemValue(item);
  }
  const avgRatio = totalValue > 0 ? totalPrice / totalValue : 1;
  const avgTier = avgRatio < 0.95 ? "low" : avgRatio > 1.1 ? "high" : "fair";
  const pct = Math.round((avgRatio - 1) * 100);
  const pctLabel = pct === 0 ? "持平" : pct > 0 ? `+${pct}%` : `${pct}%`;
  return {
    count: selected.length,
    totalPrice,
    totalValue,
    avgRatio,
    avgTier,
    pctLabel
  };
}

function sortHostsForPicker(hosts, recommendedId) {
  return [...hosts].sort((a, b) => {
    const busyA = a.busy ? 1 : 0;
    const busyB = b.busy ? 1 : 0;
    if (busyA !== busyB) return busyA - busyB;
    if (a.id === recommendedId && b.id !== recommendedId) return -1;
    if (b.id === recommendedId && a.id !== recommendedId) return 1;
    const pa = Number(hostBonusPreview(hostBonusesFromWorker(a).bonuses).convertPct) || 0;
    const pb = Number(hostBonusPreview(hostBonusesFromWorker(b).bonuses).convertPct) || 0;
    if (pb !== pa) return pb - pa;
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
  });
}

function visibleStockProducts(products) {
  const query = ui.stockPickerQuery.trim().toLocaleLowerCase("zh-CN");
  const rows = products.filter((item) => {
    const selected = selectedProductIds.has(item.id);
    if (ui.stockPickerFilter === "selected" && !selected) return false;
    if (ui.stockPickerFilter === "unselected" && selected) return false;
    if (!query) return true;
    return [item.name, item.quality, item.color, item.design, item.kind]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(query);
  });
  return rows.sort((a, b) => {
    if (ui.stockPickerSort === "valueAsc") return itemValue(a) - itemValue(b);
    if (ui.stockPickerSort === "name") return String(a.name || "").localeCompare(String(b.name || ""), "zh");
    if (ui.stockPickerSort === "selected") {
      return Number(selectedProductIds.has(b.id)) - Number(selectedProductIds.has(a.id))
        || itemValue(b) - itemValue(a);
    }
    return itemValue(b) - itemValue(a);
  });
}

function selectedListings(capacity = MAX_ROOM_ITEMS) {
  const availableIds = new Set(finishedProducts().map((item) => item.id));
  return [...selectedProductIds]
    .filter((productId) => availableIds.has(productId))
    .slice(0, Math.max(0, capacity))
    .map((productId) => ({
      productId,
      price: Number(priceDrafts.get(productId))
    }));
}

  return { rooms, roomForId, itemValue, defaultPrice, draftPrice, currentSlideIndex, visibleChatRoomIds, availableHosts, ensureDraftHost, resolveSelectedHost, resolveModalHost, hostSubtitle, selectedProducts, selectionSummary, sortHostsForPicker, visibleStockProducts, selectedListings };
}
