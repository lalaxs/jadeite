import { equipmentSaleBlockReason } from "../../equipment-trading.js";
import { MARKET_TAX } from "../../market-rules.js";
import { marketQualityKey, marketRefValue } from "./catalog.js";

export function createMarketSelectors({ getState, ui, ports }) {
  const { marketUi } = ui;
  const { wantRequirementText } = ports;

function marketSellables() {
  const me = getState().me;
  return [
    ...(me.rough || []).map((item) => ({ ...item, _type: "rough" })),
    ...(me.materials || []).map((item) => ({ ...item, _type: "material" })),
    ...(me.slices || []).map((item) => ({ ...item, _type: "slice" })),
    ...(me.bracelets || []).map((item) => ({ ...item, _type: "bracelet" })),
    ...(me.workshop?.devices || []).filter((device) => !equipmentSaleBlockReason(me, device, getState())).map((item) => ({ ...item, _type: "equipment" }))
  ];
}

function marketAffordable(price) {
  return Number(getState().me.cash || 0) >= Math.round(Number(price) * (1 + MARKET_TAX));
}

function marketActiveFilterCount() {
  return Number(marketUi.cat !== "all")
    + marketUi.q.size
    + [marketUi.equipmentStage, marketUi.equipmentBrand, marketUi.equipmentTech, marketUi.equipmentCondition].filter(Boolean).length
    + Number(marketUi.min != null)
    + Number(marketUi.max != null)
    + Number(marketUi.afford)
    + Number(Boolean(marketUi.search));
}

function marketFilterSort(list) {
  let arr = list.slice();
  if (marketUi.cat !== "all") arr = arr.filter((l) => l.type === marketUi.cat);
  if (marketUi.q.size) arr = arr.filter((l) => marketUi.q.has(marketQualityKey(l.item)));
  if (marketUi.cat === "equipment") {
    if (marketUi.equipmentStage) arr = arr.filter((l) => l.item.stage === marketUi.equipmentStage);
    if (marketUi.equipmentBrand) arr = arr.filter((l) => l.item.brandKey === marketUi.equipmentBrand);
    if (marketUi.equipmentTech) arr = arr.filter((l) => String(l.item.techLevel) === marketUi.equipmentTech);
    if (marketUi.equipmentCondition) arr = arr.filter((l) => marketUi.equipmentCondition === "0" ? Number(l.item.condition) === 0 : Number(l.item.condition) >= Number(marketUi.equipmentCondition));
  }
  if (marketUi.min != null) arr = arr.filter((l) => l.price >= marketUi.min);
  if (marketUi.max != null) arr = arr.filter((l) => l.price <= marketUi.max);
  if (marketUi.afford) arr = arr.filter((l) => marketAffordable(l.price));
  if (marketUi.search) {
    const q = marketUi.search.toLowerCase();
    arr = arr.filter((l) =>
      String(l.item.name).toLowerCase().includes(q) ||
      String(l.ownerName).toLowerCase().includes(q) ||
      String(l.item.quality || "").toLowerCase().includes(q) ||
      String(l.item.color || "").toLowerCase().includes(q));
  }
  if (marketUi.sort === "priceAsc") arr.sort((a, b) => a.price - b.price);
  else if (marketUi.sort === "priceDesc") arr.sort((a, b) => b.price - a.price);
  else if (marketUi.sort === "deal") arr.sort((a, b) => (a.price - marketRefValue(a.item)) - (b.price - marketRefValue(b.item)));
  else arr.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return arr;
}

function sortOffersPreview(offers = []) {
  return offers.slice().sort((a, b) => Number(a.price) - Number(b.price) || Number(a.createdAt) - Number(b.createdAt));
}

function wantLowestOffer(want) {
  return sortOffersPreview(want.offers || [])[0] || null;
}

function filterWantsForBrowse(wants = []) {
  let arr = wants.slice();
  if (marketUi.q.size) {
    arr = arr.filter((w) => !w.qualityKey || marketUi.q.has(w.qualityKey));
  }
  if (marketUi.min != null) arr = arr.filter((w) => Number(w.budget) >= marketUi.min);
  if (marketUi.max != null) arr = arr.filter((w) => Number(w.budget) <= marketUi.max);
  if (marketUi.search) {
    const q = marketUi.search.toLowerCase();
    arr = arr.filter((w) =>
      String(w.title || "").toLowerCase().includes(q)
      || String(w.ownerName || "").toLowerCase().includes(q)
      || String(wantRequirementText(w)).toLowerCase().includes(q)
      || String(w.note || "").toLowerCase().includes(q));
  }
  if (marketUi.sort === "priceAsc") arr.sort((a, b) => Number(a.budget) - Number(b.budget));
  else if (marketUi.sort === "priceDesc") arr.sort((a, b) => Number(b.budget) - Number(a.budget));
  else arr.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return arr;
}

  return { marketSellables, marketAffordable, marketActiveFilterCount, marketFilterSort, sortOffersPreview, wantLowestOffer, filterWantsForBrowse };
}
