import assert from "node:assert/strict";
import { FEATURE_AVAILABILITY, isFeatureAvailable } from "../shared/domain/feature-availability.js";
import { bindNavigationDeps, renderMainNav, renderLocationCards, locationGate, setView } from "../public/shell/navigation.js";
import { bindSidePanelDeps, reminderRows } from "../public/features/hud/side-panel.js";
import { registerMiningCommands } from "../server/shell/commands/mining-commands.js";
import { registerDebugCommands } from "../server/shell/commands/debug-commands.js";
import { createRuntimeTicks } from "../server/shell/runtime-ticks.js";

assert.equal(FEATURE_AVAILABILITY.mining, false);
assert.equal(isFeatureAvailable("workshop"), true);
const state = { me: { orders: [], stats: {}, workshop: { workers: [] } }, mining: {
  acceptingApplications: true, playerQualified: true, skippedApplicationRounds: 2
} };
const els = { mainNav: {}, locationCards: {} };
let activeView = "mining";
bindNavigationDeps({ getState: () => state, getEls: () => els,
  getActiveView: () => activeView, setActiveView: (view) => { activeView = view; },
  locationDefinitions: [
    { id: "mining", view: "mining", label: "矿区" },
    { id: "workshop", view: "workshop", label: "工坊" }
  ] });
renderMainNav();
renderLocationCards();
assert.ok(!els.mainNav.innerHTML.includes('data-payload="mining"'));
assert.ok(els.mainNav.innerHTML.includes('data-payload="workshop"'));
assert.ok(!els.locationCards.innerHTML.includes('data-location="mining"'));
assert.equal(locationGate({ view: "mining" }).visible, false);

globalThis.document = { querySelectorAll: () => [], querySelector: () => null };
globalThis.window = { matchMedia: () => ({ matches: false }) };
setView("mining");
assert.equal(activeView, "overview", "stale links must not enter a closed feature");
delete globalThis.document;
delete globalThis.window;
bindSidePanelDeps({ getState: () => state });
assert.ok(reminderRows().every((row) => !row.id?.startsWith("mining")), "old licensed saves must not show mining reminders");

const handlers = new Map();
const socket = { on: (event, handler) => handlers.set(event, handler), emit: () => {} };
registerMiningCommands(socket, { getPlayer: () => { throw new Error("closed mining must not read or mutate a player"); } });
assert.equal(handlers.size, 20);
for (const [event, handler] of handlers) {
  let reply;
  handler({ requestId: event }, (result) => { reply = result; });
  assert.equal(reply?.code, "FEATURE_UNAVAILABLE", event);
  assert.equal(reply?.ok, false, event);
}

let unlockCalled = false;
registerDebugCommands(socket, { getPlayer: () => state.me, normalizePlayer: () => {},
  debugUnlockMining: () => { unlockCalled = true; }, broadcast: () => {} });
handlers.get("debugGrant")({ unlockMining: true });
assert.equal(unlockCalled, false, "debug commands must not bypass closure");

let worldCalls = 0;
let jobCalls = 0;
const ticks = createRuntimeTicks({ miningAvailable: false, getState: () => ({ players: new Map() }),
  processMiningWorld: () => { worldCalls++; return { changed: true }; },
  processMiningJobs: () => { jobCalls++; return { changed: false }; },
  processProductionJobs: () => false, processLivestreamRooms: () => false,
  processAuctionLifecycle: () => false, processExpiredWants: () => false
});
ticks.reconcileWorld(Date.now(), { broadcast: false });
assert.equal(worldCalls, 0, "closed mining must not advance rental rounds");
assert.equal(jobCalls, 1, "existing paid jobs must still settle");
console.log("feature-availability-smoke: hidden entrances/reminders, 20 rejected commands, debug closure and paused rentals ok");
