// Isolated player-facing QA. All game data lives in a disposable SQLite world.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { createDeviceInstance } from "../server/systems/equipment-system.js";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.state.players.clear();
H.state.listings.length = 0;
const sessions = {};
for (const id of ["equipment-qa-seller", "equipment-qa-buyer"]) {
  const player = H.makePlayer(id);
  player.cash = 100000;
  player.assets.workshopOwned = true;
  H.state.players.set(id, player);
  sessions[id] = { playerId: id, resumeToken: H.playerSessions.issueSession(player) };
}
const device = createDeviceInstance("opening", "cuijie-opening-1", "equipment-qa-used");
device.condition = 43;
H.state.players.get("equipment-qa-seller").workshop.devices.push(device);
const directory = mkdtempSync(path.join(tmpdir(), "jade-equipment-browser-"));
const seedPath = path.join(directory, "seed.json");
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
const report = path.resolve("docs/reports/2026-10-23-market-equipment");
mkdirSync(report, { recursive: true });
const port = 44000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
const errors = [];
let server, browser, output = "";
async function start() {
  server = spawn(process.execPath, ["server.js"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), LOG_LEVEL: "warn", JADE_WORLD_PERSIST: "1",
    JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite"), JADE_WORLD_PATH: seedPath
  } });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`server failed\n${output}`);
}
async function pageFor(id, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((session) => localStorage.setItem("jade-player-session-v1", JSON.stringify(session)), sessions[id]);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator("#mainNav button[data-payload='workshop']").waitFor();
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Escape");
  return page;
}
async function go(page, view) {
  await page.locator(`#mainNav button[data-nav-view='${view}']`).click();
  try {
    await page.locator(`.view.active[data-view='${view}']`).waitFor({ timeout: 10000 });
  } catch (error) {
    await page.screenshot({ path: path.join(report, `failure-${view}.png`), fullPage: true });
    console.log(await page.evaluate(() => ({ active: [...document.querySelectorAll('.view.active')].map((row) => row.dataset.view), modal: document.querySelector('#modalRoot')?.innerText, nav: document.querySelector('#mainNav')?.innerText, errors: document.querySelector('#toastRoot')?.innerText })));
    throw error;
  }
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(report, name), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, `${name}: page must fit viewport width`);
}
try {
  await start();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const seller = await pageFor("equipment-qa-seller", { width: 1440, height: 900 });
  await go(seller, "workshop");
  await seller.locator(`[data-action='openWorkshopDevice'][data-payload='${device.id}']`).click();
  await seller.locator(`[data-action='openMarketListModal'][data-payload='${device.id}']`).click();
  await seller.locator("#marketListModal:not([hidden]) #mlPrice").waitFor();
  assert.match(await seller.locator("#mlDetail").innerText(), /同款新机/);
  assert.doesNotMatch(await seller.locator("#mlDetail").innerText(), /糯种|豆种/);
  await screenshot(seller, "list-desktop.png");
  await seller.locator("#mlPrice").fill("4000");
  await seller.locator("#mlConfirm").click();
  await go(seller, "market");
  await seller.locator("[data-market-section='mine']").click();
  const withdrawal = seller.locator("#marketGrid .jm-equipment-card [data-action='withdrawListing']");
  await withdrawal.waitFor();
  await screenshot(seller, "mine-desktop.png");
  await withdrawal.click();
  await seller.locator("#marketGrid .jm-equipment-card").waitFor({ state: "detached" });
  // Relist through the trading house inventory picker after withdrawal.
  await seller.locator(".jm-topbar-actions [data-action='openMarketListModal']").click();
  await seller.locator("#mlCategory").selectOption("equipment");
  await seller.locator(`[data-ml-id='${device.id}']`).click();
  await seller.locator("#mlPrice").fill("4000");
  await seller.locator("#mlConfirm").click();
  await seller.locator("#marketGrid .jm-equipment-card").waitFor();
  const buyer = await pageFor("equipment-qa-buyer", { width: 390, height: 844 });
  await go(buyer, "market");
  await buyer.locator("[data-market-cat='equipment']").click();
  await buyer.locator("#marketGrid .jm-equipment-card").waitFor();
  await buyer.locator("[data-equipment-filter='equipmentStage']").selectOption("finishing");
  assert.equal(await buyer.locator("#marketGrid .jm-equipment-card").count(), 0);
  await buyer.locator("[data-equipment-filter='equipmentStage']").selectOption("opening");
  await buyer.locator("#marketGrid .jm-equipment-card").waitFor();
  const priceButton = await buyer.locator("#marketPriceApply").boundingBox();
  assert.ok(priceButton.x + priceButton.width <= 390, "mobile price search button must be fully visible");
  const filterBox = await buyer.locator("#marketQFilters").boundingBox();
  assert.ok(filterBox.height < 120, "mobile equipment filters should occupy two rows");
  await screenshot(buyer, "market-mobile.png");
  await buyer.locator("#marketGrid .jm-equipment-card .jm-buy").click();
  await buyer.locator("#marketBuyModal:not([hidden])").waitFor();
  const costs = await buyer.locator("#marketBuyBody").innerText();
  assert.match(costs, /购买并修满总成本/);
  assert.match(costs, /耐久 43%/);
  await screenshot(buyer, "buy-mobile.png");
  await buyer.locator("[data-action='confirmMarketBuy']").click();
  await buyer.locator("#modalRoot:not([hidden]) [data-modal-close]").first().click();
  await go(buyer, "workshop");
  await buyer.locator(`[data-action='openWorkshopDevice'][data-payload='${device.id}']`).click();
  await buyer.locator(".machine-info-bar").waitFor();
  assert.match(await buyer.locator(".machine-info-bar").innerText(), /耐久 43%/);
  await screenshot(buyer, "purchased-mobile.png");
  await seller.setViewportSize({ width: 390, height: 844 });
  await seller.reload();
  await seller.locator("#mainNav button[data-nav-view='market']").waitFor();
  await seller.waitForLoadState("networkidle");
  await go(seller, "market");
  await seller.locator("[data-market-section='mine']").click();
  await seller.locator(".jm-topbar-actions [data-action='openMarketListModal']").click();
  await seller.locator("#mlCategory").selectOption("equipment");
  const remainingIds = await seller.locator("#mlGrid .ml-slot").evaluateAll((rows) => rows.map((row) => row.dataset.mlId));
  assert.equal(remainingIds.length, 3, "each stage's last device must be available to list");
  assert.doesNotMatch(await seller.locator("#marketListModal").innerText(), /至少保留|替代设备/);
  await screenshot(seller, "all-devices-mobile.png");
  for (let index = 0; index < remainingIds.length; index += 1) {
    if (index) {
      await seller.locator(".jm-topbar-actions [data-action='openMarketListModal']").click();
      await seller.locator("#mlCategory").selectOption("equipment");
    }
    await seller.locator(`[data-ml-id='${remainingIds[index]}']`).click();
    await seller.locator("#mlConfirm").click();
    await seller.locator("#marketGrid .jm-equipment-card").nth(index).waitFor();
  }
  await seller.reload();
  await seller.waitForLoadState("networkidle");
  await seller.locator("#mainNav button[data-payload='workshop']").waitFor();
  await go(seller, "workshop");
  assert.equal(await seller.locator("#workshopRoot [data-action='openWorkshopDevice']").count(), 0, "reload must preserve the empty workshop");
  assert.match(await seller.locator("#workshopRoot").innerText(), /还没有可用设备/);
  await screenshot(seller, "empty-workshop-mobile.png");
  assert.deepEqual(errors, []);
  writeFileSync(path.join(report, "browser-result.json"), JSON.stringify({ passed: true, viewports: ["1440x900", "390x844"], checks: ["workshop entry", "listing", "withdrawal", "relisting", "equipment filters", "purchase costs", "purchase into workshop", "original durability", "listing all devices", "empty-workshop reload", "no horizontal overflow", "no browser errors"], errors }, null, 2));
  console.log(`market-equipment-browser: desktop and mobile full player flow ok; screenshots at ${report}`);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode == null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await stopped;
  }
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("jade-equipment-browser-")) throw new Error("unsafe QA cleanup path");
  rmSync(resolved, { recursive: true, force: true });
}
process.exit(0);
