import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";
import { seedWorkshopDeliveryFixtures } from "./workshop-delivery-fixtures.mjs";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
H.ensureEquipmentShop();
const sessions = {};
for (const id of ["notice-buyer", "stock-buyer"]) {
  const player = H.makePlayer(id);
  player.cash = 1_000_000;
  H.state.players.set(id, player);
  if (id === "notice-buyer") seedWorkshopDeliveryFixtures(H, player);
  sessions[id] = { playerId: id, resumeToken: H.playerSessions.issueSession(player) };
}
const stockRow = H.state.equipmentShop.items.find(row => row.modelKey === "used-opening-1");
stockRow.stock = 1;
const basicOpening = H.state.equipmentShop.items.find(row => {
  const model = H.equipmentCatalog().find(model => model.modelKey === row.modelKey);
  return model.stage === "opening" && model.techLevel === 1 && model.brandKey !== "used";
});
basicOpening.modelKey = "cuijie-opening-1";
const directory = mkdtempSync(path.join(tmpdir(), "jade-notices-stock-"));
const seedPath = path.join(directory, "seed.json");
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
const output = path.resolve(".tmp/workshop-notices-shop");
mkdirSync(output, { recursive: true });
const port = 45000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
let server, browser, serverOutput = "";
const errors = [];

async function start() {
  server = spawn(process.execPath, ["server.js"], { stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), LOG_LEVEL: "warn",
    JADE_WORLD_PERSIST: "1", JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_PATH: seedPath,
    JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite")
  } });
  server.stdout.on("data", data => { serverOutput += data; });
  server.stderr.on("data", data => { serverOutput += data; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    if (server.exitCode != null) throw new Error(serverOutput);
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`test server did not start: ${serverOutput}`);
}
async function stop() {
  if (server?.exitCode == null) { const stopped = once(server, "exit"); server.kill(); await stopped; }
}
async function openPlayer(id, viewport = { width: 1625, height: 892 }) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce", timezoneId: "Asia/Shanghai" });
  await context.addInitScript(({ session }) => {
    localStorage.setItem("jade-player-session-v1", JSON.stringify(session));
    localStorage.setItem("jade-theme", "day");
    let factory;
    Object.defineProperty(window, "io", { configurable: true, get: () => factory, set(value) {
      factory = new Proxy(value, { apply(target, receiver, args) {
        const socket = Reflect.apply(target, receiver, args);
        window.testGame = { socket, state: null };
        socket.on("state", state => { window.testGame.state = structuredClone(state); });
        socket.on("state:patch", patch => { if (window.testGame.state) Object.assign(window.testGame.state, structuredClone(patch.changes)); });
        return socket;
      } });
    } });
  }, { session: sessions[id] });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.testGame?.state?.me);
  return page;
}
async function shop(page) {
  await page.locator('#mainNav [data-nav-view="shop"]').click();
  await page.locator('[data-action="shopSelectTab"][data-payload="equipment"]').click();
}
async function collect(page, id) {
  await page.locator(`[data-side-delivery="${id}"] [data-action="openWorkshopDelivery"]`).click();
  await page.locator('[data-delivery-box]').focus();
  await page.keyboard.press("Enter");
  await page.locator('[data-delivery-results]').waitFor({ state: "visible" });
  let revealed = false;
  for (let count = 0; count < 60; count++) {
    const back = page.locator('[data-delivery-return]');
    const reveal = page.locator('[data-delivery-reveal-all]');
    if (await back.isVisible()) await back.click();
    else if (!revealed && await reveal.isVisible() && await reveal.isEnabled()) { revealed = true; await reveal.click(); }
    else if (await page.locator('[data-delivery-collect]').isVisible()) break;
    await page.waitForTimeout(100);
  }
  await page.locator('[data-delivery-collect]').click();
  await page.waitForFunction(id => !window.testGame.state.me.workshopDeliveries.some(row => row.id === id), id);
}

try {
  await start();
  browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "chrome" } : {}) });
  const first = await openPlayer("notice-buyer");
  const second = await openPlayer("stock-buyer");
  const layoutAnchors = page => page.evaluate(() => ["#sidePanel .panel-head", "#panelTabs", "#mainStage"].map(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { selector, top: rect.top, left: rect.left, width: rect.width };
  }));
  const normalLayout = await layoutAnchors(second);
  await first.locator('[data-delivery-notice]').first().waitFor();
  assert.equal(await first.locator('[data-delivery-notice]').count(), 3);
  assert.deepEqual(await layoutAnchors(first), normalLayout, "stacked notices do not move the sidebar or main UI");
  assert.equal(await first.locator('#workshopNoticeStack').count(), 0);
  assert.equal(await first.locator('#toast [data-delivery-notice].toast-item').count(), 3);
  const toastBounds = await first.locator('#toast').evaluate(node => ({ position: getComputedStyle(node).position,
    top: node.getBoundingClientRect().top, right: innerWidth - node.getBoundingClientRect().right }));
  assert.deepEqual(toastBounds, { position: "fixed", top: 84, right: 18 });
  const cardStyle = await first.locator('.side-workshop-delivery').first().evaluate(node => ({
    padding: getComputedStyle(node).padding, leftBorder: getComputedStyle(node).borderLeftWidth,
    rightBorder: getComputedStyle(node).borderRightWidth,
    heading: getComputedStyle(node.querySelector('.side-delivery-heading b')).fontSize,
    name: getComputedStyle(node.querySelector('p')).fontSize
  }));
  assert.deepEqual(cardStyle, { padding: "12px", leftBorder: "1px", rightBorder: "1px", heading: "13px", name: "12px" });
  assert.equal(await first.locator('#panelTabs .workshop-ready-dot').count(), 1);
  await first.evaluate(async () => {
    const { showToast } = await import('/shell/toast-fx.js');
    for (let index = 0; index < 4; index++) showToast({ text: `普通提示检查 ${index}`, tone: "info" });
  });
  assert.equal(await first.locator('#toast .toast-item:not([data-delivery-notice])').count(), 3);
  await first.locator('#toast .toast-item:not([data-delivery-notice]) .toast-close').first().click();
  await first.waitForTimeout(4500);
  assert.equal(await first.locator('#toast .toast-item:not([data-delivery-notice])').count(), 0);
  assert.equal(await first.locator('[data-delivery-notice]').count(), 3, "pending reminders do not auto-dismiss");
  await first.screenshot({ path: path.join(output, "desktop-notices.png") });
  await first.locator('[data-ptab="remind"]').focus();
  await first.keyboard.press("Enter");
  const targetId = await first.locator('[data-delivery-notice]').first().getAttribute("data-delivery-notice");
  await first.locator(`[data-delivery-notice="${targetId}"]`).click();
  assert.equal(await first.locator('[data-ptab="workshop"]').getAttribute("aria-pressed"), "true");
  assert.equal(await first.locator(`[data-side-delivery="${targetId}"].is-highlighted`).isVisible(), true);
  assert.equal(await first.evaluate(() => document.activeElement?.dataset.sideDelivery), targetId);
  await first.screenshot({ path: path.join(output, "desktop-focused.png") });
  await collect(first, targetId);
  await first.locator(`[data-delivery-notice="${targetId}"]`).waitFor({ state: "detached" });
  assert.equal(await first.locator('[data-delivery-notice]').count(), 2);
  assert.deepEqual(await layoutAnchors(first), normalLayout, "removing a notice does not move the sidebar or main UI");
  await first.reload();
  await first.waitForFunction(() => window.testGame?.state?.me);
  assert.equal(await first.locator('[data-delivery-notice]').count(), 2, "reload restores pending reminders without duplicates");

  await first.setViewportSize({ width: 390, height: 844 });
  await first.locator('[data-delivery-notice]').first().click();
  assert.equal(await first.locator('.shell').getAttribute("data-mobile-pane"), "side");
  assert.equal(await first.locator('.side-workshop-delivery.is-highlighted').isVisible(), true);
  assert.equal(await first.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await first.screenshot({ path: path.join(output, "mobile-notices.png") });
  await first.locator('#sidePanelToggle').click();
  assert.equal(await first.locator('#toast [data-delivery-notice]').first().isVisible(), true);
  await first.setViewportSize({ width: 1625, height: 892 });
  await shop(first);
  await shop(second);
  const cards = await first.locator('#equipmentShop [data-shop-equipment-model]').count();
  assert.ok(cards >= 6 && cards <= 9, "only today's shared stock is listed in one grid");
  assert.equal(await first.locator("#equipmentShop .resource-card-grid").count(), 1);
  const moneySize = await first.locator('#equipmentShop [data-action="buyWorkshopDevice"]').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  assert.ok(moneySize >= 14);
  assert.ok(await first.locator('#equipmentShop .equipment-param-pill.is-neutral').count() > 0);
  assert.ok(await first.locator('#equipmentShop .equipment-param-pill.is-good').count() > 0);
  assert.ok(await first.locator('#equipmentShop .equipment-param-pill.is-poor').count() > 0);
  await first.screenshot({ path: path.join(output, "equipment-stock.png") });
  const identities = await Promise.all([first, second].map(page => page.evaluate(() => ({ cash: window.testGame.state.me.cash, count: window.testGame.state.me.workshop.devices.length }))));
  for (const page of [first, second]) {
    await page.locator('[data-action="buyWorkshopDevice"][data-model-key="used-opening-1"]').click();
    await page.locator('[data-action="confirmShopPurchase"]').waitFor();
  }
  await Promise.all([first, second].map(page => page.locator('[data-action="confirmShopPurchase"]').click()));
  for (const page of [first, second]) {
    await page.waitForFunction(() => window.testGame.state.equipmentShop.items.find(row => row.modelKey === "used-opening-1").stock === 0);
    assert.equal(await page.locator('[data-shop-equipment-model="used-opening-1"]').getAttribute("data-shop-stock"), "0");
    assert.equal(await page.locator('[data-model-key="used-opening-1"]').isEnabled(), false);
  }
  const results = await Promise.all([first, second].map(page => page.evaluate(() => ({ cash: window.testGame.state.me.cash, count: window.testGame.state.me.workshop.devices.length }))));
  assert.equal(results.reduce((sum, row, index) => sum + row.count - identities[index].count, 0), 1);
  assert.equal(results.reduce((sum, row, index) => sum + identities[index].cash - row.cash, 0), 3200);
  await stop();
  await start();
  await second.reload();
  await second.waitForFunction(() => window.testGame?.state?.equipmentShop?.items);
  assert.equal(await second.evaluate(() => window.testGame.state.equipmentShop.items.find(row => row.modelKey === "used-opening-1").stock), 0);
  assert.deepEqual(errors, []);
  const result = { ok: true, persistentStack: true, focusedDelivery: true, claimedNoticeRemoved: true,
    mobileNavigation: true, parameterColors: true, readablePrice: true, sharedLastMachine: true, restartRetainsSoldOut: true, errors };
  writeFileSync(path.join(output, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  for (const [index, page] of (browser?.contexts() || []).flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await stop();
  if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("jade-notices-stock-")) throw new Error("invalid test directory");
  rmSync(directory, { recursive: true, force: true });
}
