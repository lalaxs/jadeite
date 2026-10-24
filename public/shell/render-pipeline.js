// Shell render pipeline (moved from main.js)

import { paintJadeCanvases } from "../jade-renderer.js";

let getState = () => null;
let getEls = () => null;
let getActiveView = () => "overview";
let renderMainNav = () => {};
let renderPlayerCard = () => {};
let renderTopHud = () => {};
let renderSidePanel = () => {};
let renderPlayerSidebar = () => {};
let renderHomeMessages = () => {};

// Populated via bindRenderPipelineDeps / setViewRenderers
export let VIEW_RENDERERS = {};

const VIEW_STATE_KEYS = Object.freeze({
  overview: ["me", "onlinePlayerCount", "players", "news", "worldChat"],
  auction: ["me", "auction", "auctionRounds", "auctionHalls", "auctionHistory"],
  auctionHistory: ["me", "auctionHistory"],
  mining: ["me", "mining"],
  workshop: ["me"],
  inventory: ["me"],
  market: ["me", "marketPlayers", "listings", "wants", "assetListings", "materialCatalog"],
  blackmarket: ["me", "blackStalls", "blackServiceOrders"],
  shop: ["me", "assetListings", "materialCatalog"],
  rankings: ["me", "players", "rankings", "rankingSelf", "rankingPlayerCount"],
  livestream: ["me", "livestreamRooms"],
  orders: ["me"],
  collection: ["me"],
  hireMarket: ["me"],
  reports: ["me"]
});

const JADE_PAINT_KEYS = new Set([
  "me",
  "roughPool",
  "listings",
  "blackStalls",
  "livestreamRooms",
  "auction",
  "auctionRounds",
  "mining"
]);

export function bindRenderPipelineDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.getEls === "function") getEls = deps.getEls;
  if (typeof deps.getActiveView === "function") getActiveView = deps.getActiveView;
  if (typeof deps.renderMainNav === "function") renderMainNav = deps.renderMainNav;
  if (typeof deps.renderPlayerCard === "function") renderPlayerCard = deps.renderPlayerCard;
  if (typeof deps.renderTopHud === "function") renderTopHud = deps.renderTopHud;
  if (typeof deps.renderSidePanel === "function") renderSidePanel = deps.renderSidePanel;
  if (typeof deps.renderPlayerSidebar === "function") renderPlayerSidebar = deps.renderPlayerSidebar;
  if (typeof deps.renderHomeMessages === "function") renderHomeMessages = deps.renderHomeMessages;
  if (deps.VIEW_RENDERERS && typeof deps.VIEW_RENDERERS === "object") {
    VIEW_RENDERERS = deps.VIEW_RENDERERS;
  }
}

export function setViewRenderers(map) {
  VIEW_RENDERERS = map || {};
}

export function activeViewRoot() {
  return document.querySelector(`.view[data-view="${getActiveView()}"]`) || document;
}

export function renderShell() {
  renderMainNav();
  renderPlayerCard();
  renderTopHud();
  renderSidePanel();
  renderPlayerSidebar();
}

export function renderActiveView() {
  const renderView = VIEW_RENDERERS[getActiveView()];
  if (renderView) renderView();
}

export function render(changedKeys = null) {
  const state = getState();
  const els = getEls();

  if (!state) return;
  const { me } = state;
  const changed = Array.isArray(changedKeys) ? new Set(changedKeys) : null;
  const includesAny = (keys) => !changed || keys.some((key) => changed.has(key));
  if (changed?.has("me") || !changed) {
    if (els.nameInput) els.nameInput.value = me.name;
  }
  if (includesAny(["me", "onlinePlayerCount", "players"])) renderShell();
  const viewKeys = VIEW_STATE_KEYS[getActiveView()] || ["me"];
  if (includesAny(viewKeys)) renderActiveView();
  if (includesAny(["news", "worldChat"])) renderHomeMessages();
  if (!changed || [...JADE_PAINT_KEYS].some((key) => changed.has(key))) paintJades();
}

export function paintJades(root = document) {
  paintJadeCanvases(root);
}
