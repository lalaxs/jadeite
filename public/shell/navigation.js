// View navigation + mobile shell (moved from main.js)

import { escapeHtml } from "./format-utils.js";
import { showToast } from "./toast-fx.js";
import { isFeatureAvailable, MINING_UNAVAILABLE_MESSAGE } from "../feature-availability.js";

let getState = () => null;
let getEls = () => null;
let getActiveView = () => "overview";
let setActiveView = (_v) => {};
let locationDefinitions = [];
let featureAccess = () => ({ ok: true });
let countInventoryUnseen = () => 0;
let setHireMarketTab = (_t) => {};
let exitInventoryRecycleMode = () => {};
let renderActiveView = () => {};
let paintJades = (_root) => {};
let activeViewRoot = () => document;
let renderBill = () => {};
let renderCredit = () => {};

let mobileContentPane = "main";

export function bindNavigationDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.getEls === "function") getEls = deps.getEls;
  if (typeof deps.getActiveView === "function") getActiveView = deps.getActiveView;
  if (typeof deps.setActiveView === "function") setActiveView = deps.setActiveView;
  if (Array.isArray(deps.locationDefinitions)) locationDefinitions = deps.locationDefinitions;
  if (typeof deps.featureAccess === "function") featureAccess = deps.featureAccess;
  if (typeof deps.countInventoryUnseen === "function") countInventoryUnseen = deps.countInventoryUnseen;
  if (typeof deps.setHireMarketTab === "function") setHireMarketTab = deps.setHireMarketTab;
  if (typeof deps.exitInventoryRecycleMode === "function") exitInventoryRecycleMode = deps.exitInventoryRecycleMode;
  if (typeof deps.renderActiveView === "function") renderActiveView = deps.renderActiveView;
  if (typeof deps.paintJades === "function") paintJades = deps.paintJades;
  if (typeof deps.activeViewRoot === "function") activeViewRoot = deps.activeViewRoot;
  if (typeof deps.renderBill === "function") renderBill = deps.renderBill;
  if (typeof deps.renderCredit === "function") renderCredit = deps.renderCredit;
}

export const NAV_ICONS = {
  overview: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>`,
  auction: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3l7 7-3 3-7-7zM11 6L4 13l3 3 7-7M3 21l5-5"/></svg>`,
  mining: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18M5 20l3-8 4 4 3-10 4 14M9 8l3-3 3 3"/><path d="M12 5v11"/></svg>`,
  market: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0"/></svg>`,
  shop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-4h15L21 9M5 9v10h14V9M9 19v-5h6v5"/></svg>`,
  workshop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>`,
  inventory: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V7a6 6 0 0 1 12 0v2M5 8h14l1 13H4z"/><path d="M9 12v1M15 12v1"/></svg>`,
  orders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4V3h6v1M9 9h6M9 13h6M9 17h4"/></svg>`,
  livestream: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>`,
  collection: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12l3 5-9 11L3 9zM3 9h18M9 4l3 5 3-5"/></svg>`,
  reports: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-9"/></svg>`,
  rankings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v4a4 4 0 0 1-8 0zM8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M10 14h4M9 20h6M12 14v6"/></svg>`,
  blackmarket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10a7 7 0 0 1 14 0v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM9 11h.01M15 11h.01M10 17h4"/></svg>`,
  hireMarket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.2"/><path d="M4 20a6 6 0 0 1 12 0M18 8v6M15 11h6"/></svg>`
};

export function renderMainNav() {
  const state = getState();
  const els = getEls();

  if (!els.mainNav) return;
  const me = state?.me || {};
  const marketAccess = featureAccess(me, "market");
  const bmBrowseAccess = featureAccess(me, "bmBrowse");
  const locItems = locationDefinitions.filter((loc) => isFeatureAvailable(loc.view)).map((loc) => ({
    label: loc.label, id: loc.id, view: loc.view, type: "loc", icon: loc.view
  }));
  const extra = [
    { label: "主页", view: "overview", type: "overview", icon: "overview" },
    { label: "库存", view: "inventory", type: "inventory", icon: "inventory" },
    { label: "黑市", view: "blackmarket", type: "blackmarket", icon: "blackmarket" },
    { label: "排行榜", view: "rankings", type: "rank", icon: "rankings" }
  ];
  const items = [extra[0], ...locItems, extra[1], extra[2], extra[3]];
  els.mainNav.innerHTML = items.map((it) => {
    const active = getActiveView() === it.view ? " active" : "";
    const ico = `<span class="nav-ico">${NAV_ICONS[it.icon] || ""}</span>`;
    const navView = `data-nav-view="${escapeHtml(it.view)}"`;
    if (it.type === "locked") {
      return `<button class="main-nav-item locked" disabled type="button" title="即将开放">${ico}${escapeHtml(it.label)}</button>`;
    }
    if (it.type === "rank") {
      return `<button class="main-nav-item${active}" ${navView} data-action="openRankBoard" type="button">${ico}${escapeHtml(it.label)}</button>`;
    }
    if (it.type === "overview") {
      return `<button class="main-nav-item${active}" ${navView} data-action="openLocation" data-payload="overview" type="button">${ico}${escapeHtml(it.label)}</button>`;
    }
    if (it.type === "inventory") {
      const unseen = countInventoryUnseen(state);
      const badge = unseen > 0
        ? `<span class="nav-unread-dot" aria-label="${unseen} 件未查看">${unseen > 9 ? "9+" : unseen}</span>`
        : "";
      return `<button class="main-nav-item${active}" ${navView} data-action="openLocation" data-payload="inventory" type="button">${ico}<span class="nav-label">${escapeHtml(it.label)}</span>${badge}</button>`;
    }
    if (it.view === "mining") {
      const mining = state?.mining || {};
      const needsApplication = Boolean(
        mining.acceptingApplications
        && mining.playerQualified
        && !mining.myApplication
      );
      const rosterWarning = Boolean(
        mining.playerQualified
        && Number(mining.skippedApplicationRounds) > 0
        && !(mining.acceptingApplications && mining.myApplication)
      );
      const attentionLabel = needsApplication ? "矿权申请等待提交" : "竞租席位参与提醒";
      const badge = needsApplication || rosterWarning
        ? `<span class="nav-unread-dot" aria-label="${attentionLabel}">!</span>`
        : "";
      return `<button class="main-nav-item${active}" ${navView} data-action="openLocation" data-payload="${escapeHtml(it.id)}" type="button">${ico}<span class="nav-label">${escapeHtml(it.label)}</span>${badge}</button>`;
    }
    if (it.type === "blackmarket") {
      if (!bmBrowseAccess.ok) {
        return `<button class="main-nav-item locked" ${navView} data-action="lockedLocation" data-payload="blackmarket" type="button" title="${escapeHtml(bmBrowseAccess.message)}">${ico}${escapeHtml(it.label)}</button>`;
      }
      return `<button class="main-nav-item${active}" ${navView} data-action="openLocation" data-payload="blackmarket" type="button">${ico}${escapeHtml(it.label)}</button>`;
    }
    if (it.view === "market" && !marketAccess.ok) {
      return `<button class="main-nav-item locked" ${navView} data-action="lockedLocation" data-payload="${escapeHtml(it.id)}" type="button" title="${escapeHtml(marketAccess.message)}">${ico}${escapeHtml(it.label)}</button>`;
    }
    return `<button class="main-nav-item${active}" ${navView} data-action="openLocation" data-payload="${escapeHtml(it.id)}" type="button">${ico}${escapeHtml(it.label)}</button>`;
  }).join("");
}

export function locationGate(location) {
  const state = getState();

  if (!isFeatureAvailable(location.view)) {
    return { visible: false, locked: true, reason: MINING_UNAVAILABLE_MESSAGE };
  }

  const me = state?.me || {};
  if (location.type === "ownedPrivate" && !me.assets?.[location.ownershipKey]) {
    return { visible: false, locked: true, reason: "尚未拥有" };
  }
  if (location.view === "market") {
    const access = featureAccess(me, "market");
    if (!access.ok) {
      return { visible: true, locked: true, reason: access.message };
    }
  }
  return { visible: true, locked: false, reason: "" };
}

export function renderLocationCards() {
  const state = getState();
  const els = getEls();

  if (!els.locationCards || !state) return;
  const cards = locationDefinitions.flatMap((location) => {
    const gate = locationGate(location);
    if (!gate.visible) return [];
    const action = gate.locked ? "lockedLocation" : "openLocation";
    return `
      <button class="location-card ${gate.locked ? "locked" : ""} ${getActiveView() === location.view ? "active" : ""}" data-location="${location.view}" data-action="${action}" data-payload="${location.id}" type="button" aria-label="${escapeHtml(location.label)}">
        <span class="location-art ${escapeHtml(location.locationImage)}" aria-hidden="true"></span>
        <span class="location-copy">
          <span class="location-title">${escapeHtml(location.label)}</span>
          <span class="location-description">${escapeHtml(location.description)}</span>
        </span>
      </button>
    `;
  });
  els.locationCards.innerHTML = cards.join("");
}

export function button(label, action, payload = "", className = "") {
  return `<button class="${className}" data-action="${action}" data-payload="${escapeHtml(payload)}">${label}</button>`;
}

export function viewButton(label, view, className = "") {
  return `<button class="${className}" data-view-link="${view}">${label}</button>`;
}

export function openLocationByView(view) {
  const state = getState();

  if (view === "overview") {
    setView("overview");
    return;
  }
  if (view === "inventory") {
    setView("inventory");
    return;
  }
  if (view === "reports") {
    setView("reports");
    return;
  }
  if (view === "rankings") {
    setView("rankings");
    return;
  }
  if (view === "blackmarket") {
    const access = featureAccess(state?.me, "bmBrowse");
    if (!access.ok) {
      showToast(access.message || "成就积分不足，暂无法查看黑市。");
      return;
    }
    setView("blackmarket");
    return;
  }

  const location = locationDefinitions.find((item) => item.view === view);
  if (!location) {
    setView("overview");
    return;
  }

  const gate = locationGate(location);
  if (gate.visible && !gate.locked) {
    if (location.view === "hireMarket") setHireMarketTab("roster");
    setView(location.view);
    return;
  }

  if (location?.purchaseId) {
    showToast(`${gate.reason || "尚未解锁"}，先去商铺购买。`);
    setView("shop");
    return;
  }

  if (!gate.visible) {
    showToast(gate.reason || "条件未满足。");
    setView(location.ownershipKey ? "shop" : "overview");
    return;
  }

  showToast(gate.reason || "条件未满足。");
  setView("overview");
}

export function setView(view) {
  const state = getState();
  const els = getEls();
  if (!isFeatureAvailable(view)) view = "overview";

  setMobileContentPane("main");
  if (getActiveView() === "inventory" && view !== "inventory") {
    exitInventoryRecycleMode();
  }
  setActiveView(view);
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  document.querySelectorAll(".location-card").forEach((node) => node.classList.toggle("active", node.dataset.location === view));
  document.querySelectorAll("#mainNav .main-nav-item").forEach((b) => {
    // payload 可能是地点 id（如 playerMarket），需用 data-nav-view / 地点表映射到真实 view
    let navView = b.dataset.navView || "";
    if (!navView) {
      if (b.dataset.action === "openRankBoard") navView = "rankings";
      else {
        const payload = b.dataset.payload || "";
        navView = locationDefinitions.find((item) => item.id === payload)?.view || payload;
      }
    }
    b.classList.toggle("active", navView === view);
  });
  document.querySelector(".main-stage")?.classList.toggle("overview-mode", view === "overview");
  if (state) {
    renderActiveView();
    paintJades(activeViewRoot());
  }
  if (els.mainStage) els.mainStage.scrollTop = 0;
}

export function selectHomeTab(tab = "status") {
  const els = getEls();

  const next = ["status", "task", "bill", "credit"].includes(tab) ? tab : "status";
  if (els.homeTabs) {
    els.homeTabs.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.homeTab === next;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.setAttribute("tabindex", on ? "0" : "-1");
    });
  }
  [els.homeStatusPane, els.homeTaskPane, els.homeBillPane, els.homeCreditPane].forEach((p) => {
    if (p) p.hidden = p.dataset.homePane !== next;
  });
  if (next === "bill") renderBill();
  if (next === "credit") renderCredit();
}

export function openHomeOverview(tab = "status") {
  setView("overview");
  selectHomeTab(tab);
}

export function setMobileResourcesOpen(open) {
  const els = getEls();

  const expanded = Boolean(open) && window.matchMedia("(max-width: 767px)").matches;
  els.topHud?.classList.toggle("is-mobile-open", expanded);
  els.mobileResourcesToggle?.setAttribute("aria-expanded", String(expanded));
}

export function setMobileContentPane(name = "main") {
  const els = getEls();

  const next = ["main", "side", "chat"].includes(name) ? name : "main";
  mobileContentPane = next;
  els.shell?.setAttribute("data-mobile-pane", next);
  els.sidePanelToggle?.setAttribute("aria-expanded", String(next === "side"));
  els.chatDockToggle?.setAttribute("aria-expanded", String(next === "chat"));
  setMobileResourcesOpen(false);
}

export function toggleMobilePanel(targetName) {
  const next = targetName === "side" ? "side" : "chat";
  setMobileContentPane(mobileContentPane === next ? "main" : next);
}

export function closeMobileTransientUi() {
  setMobileResourcesOpen(false);
  setMobileContentPane("main");
}
