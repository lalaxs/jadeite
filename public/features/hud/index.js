// HUD feature barrel

import { bindTopHudDeps, tickHudClock, renderTopHud, closeHudRatingPopover, clientBmRatingSamples } from "./top-hud.js";
import { bindPlayerCardDeps, renderPlayerCard, renderPlayerSidebar } from "./player-card.js";
import {
  bindSidePanelDeps,
  reminderRows,
  reminderCardHtml,
  renderSidePanel,
  syncAchievementTabDot,
  tickSidePanelProgress,
  applySidePanelFilter,
  getSidePanelFilter,
  setSidePanelFilter
} from "./side-panel.js";
import { inventoryCounts } from "../inventory-helpers.js";

export function bindHudDeps(deps = {}) {
  bindTopHudDeps(deps);
  bindSidePanelDeps({
    getState: deps.getState,
    getEls: deps.getEls,
    productionJobsFor: deps.productionJobsFor,
    matchingBracelets: deps.matchingBracelets,
    workshopJobs: deps.workshopJobs,
    auctionPhaseMeta: deps.auctionPhaseMeta,
    achievementsHtml: deps.achievementsHtml,
    requestState: deps.requestState,
    renderPlayerSidebar: () => renderPlayerSidebar()
  });
  bindPlayerCardDeps({
    getState: deps.getState,
    getEls: deps.getEls,
    inventoryCounts: deps.inventoryCounts || inventoryCounts,
    reminderRows,
    reminderCardHtml
  });
}

export {
  tickHudClock,
  renderTopHud,
  closeHudRatingPopover,
  clientBmRatingSamples,
  renderPlayerCard,
  renderPlayerSidebar,
  reminderRows,
  reminderCardHtml,
  renderSidePanel,
  syncAchievementTabDot,
  tickSidePanelProgress,
  applySidePanelFilter,
  getSidePanelFilter,
  setSidePanelFilter,
  inventoryCounts
};
