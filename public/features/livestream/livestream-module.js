import { createLivestreamFeature } from "./create-livestream-feature.js";
export { createLivestreamFeature };
export { priceRatioTier, aiDemandMeta, sortHallRooms, trimLivestreamSelection } from "./catalog.js";
export { formatLivestreamDuration, buildLivestreamSettleModalEvent } from "../../../shared/domain/livestream/settle-modal.js";

let current = createLivestreamFeature();
export function initLivestreamModule(deps) {
  current.dispose();
  current = createLivestreamFeature(deps);
  current.mount();
}
export function disposeLivestreamModule() { current.dispose(); }
export function appendLivestreamChatComments(...args) { return current.appendLivestreamChatComments(...args); }
export function buildLivestreamChatFeed(...args) { return current.buildLivestreamChatFeed(...args); }
export function resetLivestreamChatFeeds(...args) { return current.resetLivestreamChatFeeds(...args); }
export function focusLivestreamProduct(...args) { return current.focusLivestreamProduct(...args); }
export function renderLivestream(...args) { return current.renderLivestream(...args); }
