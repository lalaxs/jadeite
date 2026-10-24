// Isolated visual QA: temporary SQLite world, no access to the live save.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.state.players.clear(); H.state.blackStalls.length = 0;
const sessions = {};
for (const id of ["bm-resource-qa-seller", "bm-resource-qa-buyer", "bm-empty-qa-buyer"]) {
  const player = H.makePlayer(id); H.normalizePlayer(player);
  player.cash = 1_000_000; player.assets.workshopOwned = true;
  H.state.players.set(id, player);
  sessions[id] = { playerId: id, resumeToken: H.playerSessions.issueSession(player) };
}
const owner = H.state.players.get("bm-resource-qa-seller");
const starterIds = [...owner.workshop.workers, ...owner.workshop.devices].map((item) => item.id);
const worker = H.recruitWorker(owner, owner.recruitCandidates[0].id, { spendCash: H.spendCash }).worker;
worker.skills.cut.jieliao.exp = 29;
const device = H.buyEquipment(owner, "cuijie-opening-2", { spendCash: H.spendCash, makeId: randomUUID }).device;
device.condition = 61;
const directory = mkdtempSync(path.join(tmpdir(), "jade-bm-resources-"));
const seed = path.join(directory, "seed.json");
writeFileSync(seed, JSON.stringify(H.world.exportSnapshot()));
const report = path.resolve("docs/reports/2026-10-23-blackmarket-outline-cards");
mkdirSync(report, { recursive: true });
const port = 45000 + process.pid % 1000, origin = `http://127.0.0.1:${port}`;
let server, browser, output = "";
const errors = [];
async function start() {
  server = spawn(process.execPath, ["server.js"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), LOG_LEVEL: "warn", JADE_WORLD_PERSIST: "1",
    JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite"), JADE_WORLD_PATH: seed } });
  server.stdout.on("data", (data) => { output += data; }); server.stderr.on("data", (data) => { output += data; });
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`QA server failed: ${output}`);
}
async function stop() {
  if (server && server.exitCode == null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve)); server.kill(); await stopped;
  }
}
async function pageFor(id, viewport) {
  const context = await browser.newContext({ viewport, locale: "zh-CN", timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
  await context.addInitScript((session) => localStorage.setItem("jade-player-session-v1", JSON.stringify(session)), sessions[id]);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin); await page.locator("#mainNav button[data-nav-view='blackmarket']").waitFor();
  await page.waitForLoadState("networkidle"); await page.keyboard.press("Escape");
  return page;
}
async function go(page, view) {
  await page.locator(`#mainNav button[data-nav-view='${view}']`).click();
  await page.locator(`.view.active[data-view='${view}']`).waitFor();
  if (view === "blackmarket") {
    const back = page.locator("[data-action='bmBackPlaza']").first();
    if (await back.isVisible()) await back.click();
  }
  if (view === "workshop") {
    const back = page.locator("[data-action='backWorkshopDevices']").first();
    if (await back.isVisible()) await back.click();
  }
}
async function shot(page, name) {
  await page.waitForFunction(() => !document.querySelector(".floating-text"));
  await page.screenshot({ path: path.join(report, name), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: horizontal overflow`);
}
async function buyFirst(page) {
  const button = page.locator("#bmGrid [data-action='openBmBuyGoods']").first();
  const listingId = await button.getAttribute("data-payload");
  await button.click();
  await page.locator("#bmBuyModal:not([hidden])").waitFor();
  await page.locator("#bmBuyModal [data-action='confirmBmBuy']").click();
  await page.locator("#bmBuyModal").waitFor({ state: "hidden" });
  await page.locator(`#bmGrid [data-action='openBmBuyGoods'][data-payload='${listingId}']`).waitFor({ state: "detached" });
}
async function checkResourceCards(page) {
  const cards = await page.locator("#bmGrid .bm-goods-card").evaluateAll((rows) => rows.map((row) => ({
    art: row.querySelectorAll(".bm-resource-art svg").length,
    summaries: row.querySelectorAll(".inventory-slot-copy > p").length,
    artText: row.querySelector(".bm-resource-art")?.textContent.trim()
  })));
  assert.ok(cards.length);
  assert.ok(cards.every((card) => card.art === 1 && card.summaries === 2 && card.artText === ""), "resource cards use an outline and two short metadata lines");
}
try {
  await start(); browser = await chromium.launch({ channel: "msedge", headless: true });
  const seller = await pageFor(owner.id, { width: 1440, height: 900 });
  await go(seller, "hireMarket");
  await seller.locator(`[data-action='openOwnedWorkerDetail'][data-payload='${worker.id}']`).click();
  await seller.locator("[data-action='sellBmResource']").click();
  await seller.locator("#bmOpenModal:not([hidden])").waitFor();
  await seller.locator("#bmOpenTitle").fill("山路经营资源");
  await seller.locator("[data-action='confirmBmOpenStall']").click();
  await seller.locator("#bmListModal:not([hidden])").waitFor();
  assert.match(await seller.locator("#bmMlDetail").innerText(), /挂牌期间继续占名额/);
  await seller.locator("#bmMlPrice").fill("18000"); await shot(seller, "employee-list-desktop.png");
  await seller.locator("[data-action='confirmBmList']").click();
  await seller.locator("#bmListModal").waitFor({ state: "hidden" });
  await seller.locator("#bmGrid [data-action='bmReprice']").click();
  await seller.locator("#bmRepriceInput").fill("19500");
  await seller.locator("[data-modal-client-action='bmConfirmReprice'], [data-action='bmConfirmReprice']").click();
  await go(seller, "workshop");
  await seller.locator(`[data-action='openWorkshopDevice'][data-payload='${device.id}']`).click();
  await seller.locator("[data-action='sellBmResource']").click();
  await seller.locator("#bmListModal:not([hidden])").waitFor();
  assert.match(await seller.locator("#bmMlDetail").innerText(), /修满后总投入/);
  await seller.locator("#bmMlPrice").fill("12000"); await seller.locator("[data-action='confirmBmList']").click();
  await seller.locator("#bmListModal").waitFor({ state: "hidden" });
  await seller.locator("#bmGrid .bm-goods-card").nth(1).waitFor();
  await checkResourceCards(seller);
  await shot(seller, "player-stall-desktop.png");
  await seller.locator("#bmGrid").screenshot({ path: path.join(report, "outline-cards-night.png") });
  await seller.locator("#themeToggle").click();
  assert.equal(await seller.locator("html").getAttribute("data-theme"), "day");
  await shot(seller, "player-stall-desktop-day.png");
  await seller.locator("#bmGrid").screenshot({ path: path.join(report, "outline-cards-day.png") });
  await seller.locator("#themeToggle").click();

  const buyer = await pageFor("bm-resource-qa-buyer", { width: 390, height: 844 });
  await go(buyer, "blackmarket");
  await buyer.locator("[data-bm-type='employee']").click(); await shot(buyer, "employee-market-mobile.png");
  await buyer.locator("#bmGrid .bm-stall-card").filter({ hasText: "山路经营资源" }).click();
  assert.equal(await buyer.locator("#bmGrid .bm-goods-card").count(), 1, "employee filter hides equipment in a mixed stall");
  await buyer.locator("#bmGrid [data-action='openBmBuyGoods']").click();
  assert.match(await buyer.locator("#bmBuyBody").innerText(), /登录日日薪|加入当天记薪/);
  await shot(buyer, "employee-purchase-mobile.png");
  await buyer.locator("#bmBuyModal [data-action='confirmBmBuy']").click();
  await go(buyer, "hireMarket");
  await buyer.locator(`[data-action='openOwnedWorkerDetail'][data-payload='${worker.id}']`).click();
  assert.match(await buyer.locator(".owned-worker-detail-modal").innerText(), /29 \/ /);
  await shot(buyer, "employee-received-mobile.png");
  await buyer.locator("[data-action='closeOwnedWorkerDetail']").first().click();
  await go(buyer, "blackmarket"); await buyer.locator("[data-bm-type='equipment']").click();
  await buyer.locator("#bmGrid .bm-stall-card").filter({ hasText: "山路经营资源" }).click();
  await buyer.locator("#bmGrid [data-action='openBmBuyGoods']").click();
  assert.match(await buyer.locator("#bmBuyBody").innerText(), /61 \/ 100/);
  await shot(buyer, "equipment-purchase-mobile.png");
  await buyer.locator("#bmBuyModal [data-action='confirmBmBuy']").click();
  await go(buyer, "workshop"); await buyer.locator(`[data-action='openWorkshopDevice'][data-payload='${device.id}']`).click();
  assert.match(await buyer.locator(".machine-info-bar").innerText(), /耐久 61%/);
  await shot(buyer, "equipment-received-mobile.png");

  await go(buyer, "blackmarket"); await buyer.locator("[data-bm-type='employee']").click();
  await buyer.locator("#bmGrid .bm-stall-card").filter({ hasText: "何叔人才行" }).click();
  await checkResourceCards(buyer); await shot(buyer, "employee-cards-mobile.png"); await buyFirst(buyer);
  await go(buyer, "blackmarket"); await buyer.locator("[data-bm-type='equipment']").click();
  await buyer.locator("#bmGrid .bm-stall-card").filter({ hasText: "老鲁设备铺" }).click();
  await checkResourceCards(buyer); await shot(buyer, "equipment-cards-mobile.png"); await buyFirst(buyer);
  await go(buyer, "workshop"); await buyer.locator(`[data-action='openWorkshopDevice'][data-payload='${device.id}']`).click();
  await buyer.locator("[data-action='sellBmResource']").click();
  await buyer.locator("#bmOpenModal:not([hidden])").waitFor(); await buyer.locator("[data-action='confirmBmOpenStall']").click();
  await buyer.locator("#bmListModal:not([hidden])").waitFor(); await buyer.locator("[data-action='confirmBmList']").click();
  await buyer.locator("#bmListModal").waitFor({ state: "hidden" });
  await buyer.locator("#bmGrid [data-action='bmWithdraw']").click();
  await buyer.locator("#bmWithdrawConfirmModal:not([hidden])").waitFor(); await buyer.locator("[data-action='confirmBmWithdraw']").click();
  await buyer.locator("#bmWithdrawConfirmModal").waitFor({ state: "hidden" });

  // Sell all seven initial resources through the real listing/purchase UI.
  await go(seller, "hireMarket");
  await seller.locator(`[data-action='openOwnedWorkerDetail'][data-payload='${starterIds[0]}']`).click();
  await seller.locator(`[data-action='sellBmResource'][data-payload='${starterIds[0]}']`).click();
  await seller.locator("#bmOpenModal:not([hidden])").waitFor();
  await seller.locator("#bmOpenTitle").fill("山路经营资源");
  await seller.locator("[data-action='confirmBmOpenStall']").click();
  await seller.locator("#bmListModal:not([hidden])").waitFor();
  for (const id of starterIds.slice(1)) await seller.locator(`#bmMlGrid [data-payload='${id}']`).click();
  assert.equal(await seller.locator("#bmMlGrid .selected").count(), 7);
  await shot(seller, "all-initial-resources-selected.png");
  await seller.locator("[data-action='confirmBmList']").click();
  await seller.locator("#bmListModal").waitFor({ state: "hidden" });
  await seller.locator("#bmGrid .bm-goods-card").nth(6).waitFor();
  assert.equal(await seller.locator("#bmGrid .bm-goods-card").count(), 7, "one confirmation lists all resources");
  const emptyBuyer = await pageFor("bm-empty-qa-buyer", { width: 390, height: 844 });
  await go(emptyBuyer, "blackmarket"); await emptyBuyer.locator("[data-bm-type='goods']").click();
  await emptyBuyer.locator("#bmGrid .bm-stall-card").filter({ hasText: "山路经营资源" }).click();
  for (let index = 0; index < 7; index++) await buyFirst(emptyBuyer);
  await go(seller, "hireMarket");
  await seller.locator("[data-action='openOwnedWorkerDetail']").first().waitFor({ state: "detached" });
  assert.equal(await seller.locator("[data-action='openOwnedWorkerDetail']").count(), 0);
  assert.match(await seller.locator(".view[data-view='hireMarket']").innerText(), /花名册还是空的/);
  await shot(seller, "empty-roster-desktop.png");
  await go(seller, "workshop");
  await seller.locator("#workshopRoot [data-action='openWorkshopDevice']").first().waitFor({ state: "detached" });
  assert.equal(await seller.locator("#workshopRoot [data-action='openWorkshopDevice']").count(), 0);
  assert.match(await seller.locator("#workshopRoot").innerText(), /还没有可用设备/);
  await shot(seller, "empty-workshop-desktop.png");
  await stop(); await start(); await buyer.reload();
  await buyer.locator("#mainNav button[data-nav-view='workshop']").waitFor();
  await buyer.waitForLoadState("networkidle"); await buyer.keyboard.press("Escape");
  await go(buyer, "workshop"); await buyer.locator(`[data-action='openWorkshopDevice'][data-payload='${device.id}']`).click();
  assert.match(await buyer.locator(".machine-info-bar").innerText(), /耐久 61%/);
  await shot(buyer, "save-restored-mobile.png");
  await seller.setViewportSize({ width: 390, height: 844 }); await seller.reload();
  await seller.waitForLoadState("networkidle"); await seller.keyboard.press("Escape");
  await go(seller, "hireMarket");
  assert.equal(await seller.locator("[data-action='openOwnedWorkerDetail']").count(), 0, "SQLite restart preserves zero employees");
  await shot(seller, "empty-roster-restored-mobile.png");
  await go(seller, "workshop");
  assert.equal(await seller.locator("#workshopRoot [data-action='openWorkshopDevice']").count(), 0, "SQLite restart preserves zero devices");
  await shot(seller, "empty-workshop-restored-mobile.png"); assert.deepEqual(errors, []);
  writeFileSync(path.join(report, "browser-result.json"), JSON.stringify({ passed: true, viewports: ["1440x900", "390x844"], checks: ["shared outline cards and two-line summaries", "day/night themes", "employee shortcut and listing", "repricing", "equipment shortcut and listing", "category filtering", "P2P employee and equipment purchases", "preserved skills and durability", "NPC employee and equipment purchases", "resale and withdrawal", "sale of all seven initial resources with one listing confirmation", "empty roster and workshop", "SQLite restart preserves empty resources", "no overflow or browser errors"], errors }, null, 2));
  console.log(`blackmarket-resources-browser: full player flows passed; screenshots: ${report}`);
} catch (error) {
  if (browser) for (const [index, context] of browser.contexts().entries()) for (const page of context.pages()) await page.screenshot({ path: path.join(report, `failure-${index}.png`), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); await stop();
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("jade-bm-resources-")) throw new Error("Unsafe QA cleanup path");
  rmSync(resolved, { recursive: true, force: true });
}
process.exit(0);
