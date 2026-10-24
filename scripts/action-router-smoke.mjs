import { readWorkshopSource } from "./load-workshop-source.mjs";
import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFileSync } from "node:fs";
import { createActionRouter } from "../public/shell/action-router.js";
import { bindNavigationDeps, openLocationByView } from "../public/shell/navigation.js";

const router = createActionRouter();
const seen = [];
router.on("alpha", (ctx) => seen.push(["alpha", ctx.payload]));
router.register({
  beta: (ctx) => seen.push(["beta", ctx.payload])
});

assert.equal(router.dispatch("alpha", { payload: 1 }), true);
assert.equal(router.dispatch("beta", { payload: 2 }), true);
assert.equal(router.dispatch("missing", { payload: 3 }), false);
assert.deepEqual(seen, [["alpha", 1], ["beta", 2]]);
assert.equal(router.has("alpha"), true);
assert.equal(router.has("missing"), false);
assert.deepEqual(router.list(), ["alpha", "beta"]);

const previousDocument = globalThis.document;
let activeView = "workshop";
let setViewCalls = 0;
globalThis.document = { querySelector: () => null };
try {
  bindNavigationDeps({
    getState: () => ({ me: { achievementPoints: 0 } }),
    getEls: () => ({}),
    getActiveView: () => activeView,
    setActiveView: (view) => {
      activeView = view;
      setViewCalls += 1;
    },
    featureAccess: () => ({ ok: false, message: "成就积分不足" })
  });
  openLocationByView("blackmarket");
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}
assert.equal(activeView, "workshop", "failed blackmarket entry should keep the current view");
assert.equal(setViewCalls, 0, "failed blackmarket entry should not trigger any view transition");

activeView = "overview";
setViewCalls = 0;
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => []
};
try {
  bindNavigationDeps({
    getState: () => null,
    getEls: () => ({}),
    getActiveView: () => activeView,
    setActiveView: (view) => {
      activeView = view;
      setViewCalls += 1;
    }
  });
  openLocationByView("rankings");
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}
assert.equal(activeView, "rankings", "data-view-link should open the full rankings view");
assert.equal(setViewCalls, 1, "rankings navigation should trigger exactly one view transition");

const mainEntry = readFileSync("public/main.js", "utf8");
const main = readClientShellSource();
const inventoryHelpers = readFileSync("public/features/inventory-helpers.js", "utf8");
const sidePanel = readFileSync("public/features/hud/side-panel.js", "utf8");
assert.match(main, /from "\.\/shell\/action-router\.js"/);
assert.match(main, /createActionRouter\(\)/);
assert.match(main, /actions\.dispatch\(/);
assert.match(main, /registerAction/);
assert.match(mainEntry, /destination === "workshop-finish"[\s\S]*workshopSelectStep\("finish"\)/);
assert.match(mainEntry, /destination === "blackmarket"[\s\S]*openLocationByView\("blackmarket"\)/);
assert.match(inventoryHelpers, /entry\.isFinished && !isOwned[\s\S]*去处理委托[\s\S]*blackmarket/);
assert.match(inventoryHelpers, /entry\.category === "external"[\s\S]*去精加工[\s\S]*workshop-finish/);
assert.match(sidePanel, /isEscrowResult && stage === "finished"[\s\S]*blackmarket/);

for (const file of [
  "public/features/auction/auction-module.js",
  "public/features/market/market-module.js",
  "public/features/workshop/workshop-module.js",
  "public/features/inventory/inventory-module.js",
  "public/features/chat/chat-module.js",
  "public/features/ranking/ranking-module.js",
  "public/features/orders/orders-module.js",
  "public/features/shop/shop-module.js",
  "public/features/hire/hire-module.js"
]) {
  const source = file === "public/features/workshop/workshop-module.js" ? readWorkshopSource() : readFileSync(file, "utf8");
  assert.match(source, /deps\.registerAction|options\.registerAction/, `${file} should accept registerAction`);
  assert.match(source, /register\("/, `${file} should register data-action handlers`);
}

assert.match(readFileSync("public/features/extra/extra-module.js", "utf8"), /initExtraModule|initShopModule|initHireModule/);

console.log("action-router-smoke: ok");
