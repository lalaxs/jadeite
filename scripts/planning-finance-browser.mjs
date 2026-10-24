import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "@playwright/test";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

// The parent creates a seed in a temporary directory. The child uses a separate
// SQLite world and port; no connection is made to the regular game service.
process.env.JADE_WORLD_PERSIST = "0";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "warn";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
const player = H.makePlayer("planning-finance-browser-player");
installOwnedWorkshopFixture(player);
player.name = "规划与经营验收";
player.cash = 30000;
player.offlineSummary = null;
player.pendingAuctionSettle = null;
player.assets.livestreamPermitOwned = true;
const gift = player.rough.shift();
const opened = H.revealPolishedRough(gift);
Object.assign(opened, { id: "planning-qa-material-a", type: "material", materialStage: "opened", stage: "material", name: "草稿验收明料A" });
H.addItem(player, opened, { type: "material", acquisitionCost: 4000 });
H.addItem(player, { ...structuredClone(opened), id: "planning-qa-material-b", name: "草稿验收明料B" }, { type: "material", acquisitionCost: 3200 });
const extracted = H.extractProductsFromJob({ item: opened, options: { kits: [{ type: "peacePendant", x: 50, y: 50, size: "M" }] } })[0];
const product = { ...extracted, id: "finance-qa-product", name: "经营验收平安扣", type: "bracelet", materialStage: "finished", stage: "finished", value: 2600, price: 2600 };
H.addItem(player, product, { type: "bracelet", acquisitionCost: 1850 });
const unknown = { ...structuredClone(product), id: "finance-qa-legacy", name: "旧藏成本待核平安扣" };
delete unknown.costBasis;
delete unknown.financeBatchId;
H.addItem(player, unknown, { type: "bracelet" });
H.state.players.set(player.id, player);
const customer = H.makePlayer("planning-finance-browser-customer");
customer.cash = 50000;
H.state.players.set(customer.id, customer);
H.addItem(player, { ...structuredClone(product), id: "finance-qa-sold", name: "已售账本验收件" }, { type: "bracelet", acquisitionCost: 1850 });
const listed = H.listItemForPlayer(player, { type: "bracelet", itemId: "finance-qa-sold", price: 2400 });
assert.equal(listed.ok, true, listed.message);
const trade = H.buyListingForPlayer(customer, H.state.listings.find(row => row.item.id === "finance-qa-sold").id);
assert.equal(trade.ok, true, trade.message);
H.refreshPlayerReport(player);
const session = { playerId: player.id, resumeToken: H.playerSessions.issueSession(player) };
const temporary = mkdtempSync(path.join(tmpdir(), "jade-planning-finance-"));
const seedPath = path.join(temporary, "seed.json");
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
const directory = path.resolve("docs/reports/2026-10-23-planning-finance");
mkdirSync(directory, { recursive: true });
const port = 48000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
try { await fetch(origin); throw new Error("QA port occupied"); }
catch (error) { if (error.message === "QA port occupied") throw error; }
let browser, server, output = "";
const errors = [], checks = [], screenshots = [];
try {
  server = spawn(process.execPath, ["server.js"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
    HOST: "127.0.0.1", PORT: String(port), PUBLIC_ORIGIN: "", JADE_WORLD_PERSIST: "1",
    JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_SQLITE_PATH: path.join(temporary, "world.sqlite"),
    JADE_WORLD_PATH: seedPath } });
  server.stdout.on("data", data => { output += data; });
  server.stderr.on("data", data => { output += data; });
  const deadline = Date.now() + 15000;
  while (true) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) break; } catch {}
    if (Date.now() > deadline || server.exitCode != null) throw new Error(`QA server failed: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
  await context.addInitScript((value) => {
    localStorage.setItem("jade-player-session-v1", JSON.stringify(value));
    let ioFactory;
    Object.defineProperty(window, "io", { configurable: true, get: () => ioFactory, set(factory) {
      ioFactory = new Proxy(factory, { apply(target, receiver, args) {
        const socket = Reflect.apply(target, receiver, args);
        socket.on("state", state => { window.__planningFinanceState = state; });
        socket.on("state:patch", patch => {
          if (window.__planningFinanceState) Object.assign(window.__planningFinanceState, patch.changes || {});
        });
        return socket;
      } });
    } });
  }, session);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(180);
    const file = `${name}.png`;
    await page.screenshot({ path: path.join(directory, file), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `${name}: horizontal page overflow`);
    screenshots.push(file);
  };
  const go = async (view) => { await page.locator(`#mainNav [data-nav-view="${view}"]`).click(); };
  async function openPlanner(itemId, client = page) {
    await client.locator('#mainNav [data-nav-view="workshop"]').click();
    const back = client.locator('[data-action="backWorkshopDevices"]');
    if (await back.isVisible()) await back.click();
    await client.locator("#workshopStepTab-plan").click();
    await client.locator(`[data-action="openWorkshopDevice"][data-payload="${player.id}-carving"]`).click();
    await client.locator('.ws-big-material[data-action="openWorkshopPicker"]').click();
    await client.locator(`[data-action="pickWorkshopItem"][data-payload="${itemId}"]`).click();
    await client.locator('[data-action="openWorkshopPlanner"]').click();
    await client.locator(".ws-planner-modal").waitFor();
  }
  await page.goto(origin);
  await page.waitForFunction(id => window.__planningFinanceState?.me?.id === id, player.id);
  await page.locator('#mainNav [data-nav-view="workshop"]').waitFor();
  await page.keyboard.press("Escape");
  await openPlanner(opened.id);
  await page.locator('#ws-planner-root [data-opening-kit-choice="ping"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#ws-planner-root .kit:not(.extracted)').length === 1);
  const kitState = () => page.evaluate(async (id) => JSON.parse(JSON.stringify((await import("/features/opening/index.js")).kitsFor(id))), opened.id);
  const originalKits = await kitState();
  await shot("01-planner-desktop");
  const hit = await page.locator('#ws-planner-root .kit:not(.extracted)').evaluate(node => {
    const box = node.getBoundingClientRect();
    for (const y of [.3, .5, .7]) for (const x of [.3, .5, .7]) {
      const px = box.x + box.width * x, py = box.y + box.height * y;
      if (document.elementFromPoint(px, py)?.closest(".kit") === node) return { x: px, y: py };
    }
    throw new Error("No visible kit hit area");
  });
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.down();
  await page.mouse.move(hit.x + 35, hit.y + 20, { steps: 12 });
  await page.mouse.up();
  assert.notDeepEqual(await kitState(), originalKits);
  await page.keyboard.press("Control+z");
  assert.deepEqual(await kitState(), originalKits);
  checks.push("pointer drag is one undo operation");
  await page.keyboard.press("Control+z");
  assert.equal((await kitState()).length, 0);
  await page.keyboard.press("Control+Shift+z");
  assert.deepEqual(await kitState(), originalKits);
  checks.push("add/undo/redo through keyboard");
  await page.keyboard.press("Escape");
  await openPlanner("planning-qa-material-b");
  await page.keyboard.press("Escape");
  await openPlanner(opened.id);
  assert.deepEqual(await kitState(), originalKits);
  checks.push("switch A/B/A preserves layout");
  await page.reload();
  await page.waitForFunction(id => window.__planningFinanceState?.me?.id === id, player.id);
  await page.locator('#mainNav [data-nav-view="workshop"]').waitFor();
  await openPlanner(opened.id);
  assert.deepEqual(await kitState(), originalKits);
  checks.push("page reload restores layout");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("02-planner-mobile");
  const other = await context.newPage();
  other.setDefaultTimeout(12000);
  other.on("pageerror", error => errors.push(error.message));
  await other.goto(origin);
  await other.waitForFunction(id => window.__planningFinanceState?.me?.id === id, player.id);
  await other.locator('#mainNav [data-nav-view="workshop"]').waitFor();
  await openPlanner(opened.id, other);
  await other.locator('#ws-planner-root [data-opening-kit-choice="leaf"]').click();
  await page.locator('.planner-draft-versions summary').waitFor();
  assert.deepEqual(await kitState(), originalKits, "the other window must not replace the current layout");
  await page.locator('.planner-draft-versions summary').click();
  await page.locator('[data-draft-action="version"]').first().click();
  assert.equal((await kitState()).length, 2);
  checks.push("other window keeps an independent version and requires explicit loading");
  await other.close();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go("inventory");
  await page.locator(`[data-action="inspectInventoryItem"][data-payload="${product.id}"]`).click();
  await page.locator("#modalRoot:not([hidden])").waitFor();
  assert.match(await page.locator("#modalRoot").innerText(), /1,850|1850/);
  await shot("03-cost-detail-desktop");
  const financeActions = await page.locator("#modalRoot [data-action]").evaluateAll(nodes => nodes.map(node => ({ action: node.dataset.action, text: node.textContent })));
  writeFileSync(path.join(directory, "finance-actions.json"), JSON.stringify(financeActions, null, 2));
  assert.equal(financeActions.some(({ action }) => ["openSaleComparison", "openFinanceBatch"].includes(action)), false);
  checks.push("inventory detail keeps recorded cost and removes the two finance shortcuts");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("04-cost-detail-mobile");
  await page.locator('#modalRoot [data-modal-close]').first().click();
  await page.locator(`[data-action="inspectInventoryItem"][data-payload="${unknown.id}"]`).click();
  assert.match(await page.locator("#modalRoot").innerText(), /不完整|待补全|未知/);
  await page.locator('#modalRoot [data-modal-close]').first().click();
  checks.push("unknown historical cost is not presented as zero-cost profit");
  await go("overview");
  await page.locator("#homeTabBill").click();
  await page.locator("#homeBillPane").waitFor({ state: "visible" });
  assert.equal(await page.locator('#homeBillPane [data-view-link="reports"]').count(), 0);
  assert.doesNotMatch(await page.locator("#homeBillPane").innerText(), /现金流水记录实际收付|经营收益与同料账本/);
  await shot("09-bill-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await shot("10-bill-desktop");
  checks.push("cash ledger removes the finance explanation and shortcut");
  assert.deepEqual(errors, []);
  writeFileSync(path.join(directory, "browser-result.json"), JSON.stringify({ checks, errors, screenshots, temporaryWorld: temporary }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors, screenshots }));
} catch (error) {
  writeFileSync(path.join(directory, "browser-failure.json"), JSON.stringify({ error: error.stack, serverOutput: output.slice(-5000), errors, checks }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode == null) { const stopped = once(server, "exit"); server.kill(); await stopped; }
}
