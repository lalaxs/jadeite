// Run against a disposable world; never read or modify the player's live save.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { equipmentCatalog } from "../server/systems/equipment-system.js";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.state.players.clear();
const sessions = {};
for (const [id, cash, workshopOwned] of [["shop-detail-buyer", 1_000_000, true], ["shop-detail-poor", 100, true], ["shop-detail-starter", 1_000_000, false]]) {
  const player = H.makePlayer(id);
  H.normalizePlayer(player);
  player.cash = cash;
  player.assets.workshopOwned = workshopOwned;
  H.state.players.set(id, player);
  sessions[id] = { playerId: id, resumeToken: H.playerSessions.issueSession(player) };
}
const directory = mkdtempSync(path.join(tmpdir(), "jade-shop-detail-"));
const seed = path.join(directory, "seed.json");
writeFileSync(seed, JSON.stringify(H.world.exportSnapshot()));
const report = path.resolve("docs/reports/2026-10-24-shop-equipment-detail");
mkdirSync(report, { recursive: true });
const port = 46000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
const errors = [], layouts = [], tooltips = [], scrolls = [];
let server, browser, output = "";
async function start() {
  server = spawn(process.execPath, ["server.js"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), LOG_LEVEL: "warn", JADE_WORLD_PERSIST: "1",
    JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite"), JADE_WORLD_PATH: seed
  } });
  server.stdout.on("data", data => { output += data; });
  server.stderr.on("data", data => { output += data; });
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`QA server failed: ${output}`);
}
async function shopPage(id, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: "zh-CN", timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
  await context.addInitScript(session => localStorage.setItem("jade-player-session-v1", JSON.stringify(session)), sessions[id]);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.locator("#mainNav [data-nav-view='shop']").waitFor();
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Escape");
  await page.locator("#mainNav [data-nav-view='shop']").click();
  await page.locator(".view.active[data-view='shop']").waitFor();
  await page.locator(".shop-tab[data-tab='equipment']").click();
  await page.locator("#equipmentShop .equipment-listing").first().waitFor();
  return page;
}
const detailSelector = "#modalRoot .shop-equipment-detail-modal";
async function shot(page, name) {
  await page.screenshot({ path: path.join(report, `${name}.png`), fullPage: true });
}
async function checkTooltip(page, cardIndex, keyIndex, name) {
  const pill = page.locator("#equipmentShop .equipment-listing").nth(cardIndex).locator(".equipment-param-pill").nth(keyIndex);
  await pill.hover();
  await pill.focus();
  await page.waitForFunction(element => getComputedStyle(element, "::after").opacity === "1", await pill.elementHandle());
  const result = await pill.evaluate((element, name) => {
    const style = getComputedStyle(element, "::after");
    const anchor = element.closest(".resource-card-details").getBoundingClientRect();
    const width = parseFloat(style.width);
    const left = style.left === "auto" ? anchor.right - parseFloat(style.right) - width : anchor.left + parseFloat(style.left);
    return { name, width, left, right: left + width, viewport: innerWidth, opacity: style.opacity,
      transform: getComputedStyle(element).transform, anchorWidth: anchor.width, lineHeight: style.lineHeight };
  }, name);
  assert.ok(result.width >= 180 && result.width <= 280, `${name}: readable tooltip width`);
  if (result.viewport > 767) assert.equal(result.width, 280, `${name}: desktop reading width`);
  assert.equal(result.transform, "none", `${name}: hover must not create a pill-sized containing block`);
  if (result.left < 0 || result.right > result.viewport) await shot(page, `${name}-overflow`);
  assert.ok(result.left >= 0 && result.right <= result.viewport, `${name}: tooltip stays inside viewport ${JSON.stringify(result)}`);
  tooltips.push(result);
}
async function checkDialog(page, name) {
  const dialog = page.locator(detailSelector);
  await dialog.waitFor();
  const result = await dialog.evaluate((element, name) => {
    const rect = element.getBoundingClientRect();
    const body = element.querySelector(".game-modal-body");
    const footer = element.querySelector(".game-modal-actions").getBoundingClientRect();
    return { name, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: innerWidth, height: innerHeight, footerBottom: footer.bottom,
      horizontalOverflow: body.scrollWidth > body.clientWidth + 1,
      focusInside: element.contains(document.activeElement), shellInert: document.querySelector(".shell").inert };
  }, name);
  assert.ok(result.left >= 0 && result.right <= result.width && result.top >= 0 && result.bottom <= result.height + 1, `${name}: dialog fits viewport`);
  assert.ok(result.footerBottom <= result.height + 1 && result.focusInside && result.shellInert, `${name}: accessible modal with visible actions`);
  assert.equal(result.horizontalOverflow, false, `${name}: no horizontal body overflow`);
  assert.equal(await dialog.locator(".shop-equipment-detail-param").count(), 4);
  layouts.push(result);
  await shot(page, name);
}
async function checkShopScroll(page, width, height, theme) {
  const name = `scroll-${width}-${theme}`;
  await page.setViewportSize({ width, height });
  await page.evaluate(theme => {
    document.documentElement.dataset.theme = theme;
    const stage = document.querySelector("#mainStage");
    stage.scrollTop = 0;
    const toolbar = document.querySelector(".eq-shop-toolbar");
    const cards = [...document.querySelectorAll("#equipmentShop .equipment-listing")];
    const firstTop = cards[0].getBoundingClientRect().top;
    const nextRow = cards.find(card => card.getBoundingClientRect().top > firstTop + 2);
    stage.scrollTop = nextRow.getBoundingClientRect().top - stage.getBoundingClientRect().top - toolbar.getBoundingClientRect().height + 24;
  }, theme);
  const target = await page.evaluate(() => {
    const toolbar = document.querySelector(".eq-shop-toolbar").getBoundingClientRect();
    const cards = [...document.querySelectorAll("#equipmentShop .equipment-listing")];
    const card = cards.find(card => {
      const rect = card.getBoundingClientRect();
      return rect.top < toolbar.bottom && rect.bottom > toolbar.bottom + 30;
    });
    const rect = card.getBoundingClientRect();
    card.querySelector(".resource-card-visual").focus({ preventScroll: true });
    return { x: rect.left + rect.width / 2, y: toolbar.bottom + 20 };
  });
  await page.mouse.move(target.x, target.y);
  const result = await page.evaluate(({ name, x }) => {
    const stage = document.querySelector("#mainStage").getBoundingClientRect();
    const toolbar = document.querySelector(".eq-shop-toolbar");
    const rect = toolbar.getBoundingClientRect();
    const above = document.elementFromPoint(x, stage.top + Math.max(1, (rect.top - stage.top) / 2));
    const under = document.elementFromPoint(x, rect.bottom - 10);
    return { name, scrollTop: document.querySelector("#mainStage").scrollTop, stageTop: stage.top,
      toolbarTop: rect.top, toolbarBottom: rect.bottom, background: getComputedStyle(toolbar).backgroundColor,
      toolbarOnTop: toolbar.contains(under), aboveHeaderClear: !above?.closest(".equipment-listing"),
      hit: under?.className, aboveHit: above?.className };
  }, { name, x: target.x });
  await shot(page, name);
  assert.ok(result.toolbarOnTop, `${name}: hovered cards must stay behind the toolbar ${JSON.stringify(result)}`);
  assert.ok(result.aboveHeaderClear, `${name}: cards must not leak through the top inset ${JSON.stringify(result)}`);
  assert.ok(!result.background.startsWith("rgba("), `${name}: toolbar must be opaque`);
  scrolls.push(result);
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector("#mainStage").scrollTop = 0;
  });
}
try {
  await start();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await shopPage("shop-detail-buyer");
  for (const [width, height, theme] of [[1920, 1080, "day"], [1440, 900, "night"], [768, 1024, "day"], [390, 844, "day"], [320, 640, "night"]]) {
    await checkShopScroll(page, width, height, theme);
  }
  for (const [width, height, theme, name] of [[1440, 900, "day", "desktop"], [390, 844, "day", "mobile"], [320, 640, "day", "small-mobile"], [390, 844, "night", "night-mobile"], [1440, 900, "night", "night-desktop"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const keyIndex of [0, 1, 2, 3]) await checkTooltip(page, 0, keyIndex, `${name}-${keyIndex}`);
    await checkTooltip(page, 1, 0, `${name}-second-card`);
    await shot(page, `${name}-tooltip`);
    // Parameter help must not open the device dialog or a purchase confirmation.
    await page.locator("#equipmentShop .equipment-listing .equipment-param-pill").first().click();
    assert.equal(await page.locator("#modalRoot").isVisible(), false);
    await page.locator("#equipmentShop [data-action='openShopEquipmentDetail']").first().click();
    await checkDialog(page, `${name}-detail`);
    await page.keyboard.press("Shift+Tab");
    assert.ok(await page.locator(detailSelector).evaluate(element => element.contains(document.activeElement)), "Tab stays in dialog");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#modalRoot").isVisible(), false);
    assert.equal(await page.evaluate(() => document.querySelector(".shell").inert), false);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "openShopEquipmentDetail", "closing returns focus to the device");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.documentElement.dataset.theme = "day");
  // Verify all stages read the selected catalogue entry rather than stale card data.
  for (const stage of ["opening", "carving", "finishing"]) {
    const offered = await page.locator("#equipmentShop .equipment-listing").evaluateAll(nodes => nodes.map(node => node.dataset.shopEquipmentModel));
    const modelKey = equipmentCatalog().filter(item => item.stage === stage && offered.includes(item.modelKey)).at(-1).modelKey;
    const card = page.locator(`#equipmentShop [data-shop-equipment-model='${modelKey}']`);
    const item = equipmentCatalog().find(item => item.modelKey === modelKey);
    await card.locator(".inventory-slot-name").click();
    const text = await page.locator(detailSelector).innerText();
    for (const value of [item.displayName, item.brand, item.modelName, item.category, item.description, item.profile]) assert.ok(text.includes(value), `${stage}: selected model ${value}`);
    await page.locator(`${detailSelector} [data-action='buyWorkshopDevice']`).click();
    await page.getByRole("heading", { name: "确认大额购买" }).waitFor();
    assert.ok((await page.locator("#modalRoot").innerText()).includes(item.displayName));
    await page.keyboard.press("Escape");
  }
  // Confirm once and verify the device actually arrives in the workshop.
  const purchaseCard = page.locator("#equipmentShop .equipment-listing").first();
  const purchaseTitle = await purchaseCard.locator(".inventory-slot-name").innerText();
  await purchaseCard.locator("[data-action='buyWorkshopDevice']").click();
  await page.getByRole("heading", { name: "确认大额购买" }).waitFor();
  await page.keyboard.press("Escape");
  await purchaseCard.locator("[data-action='openShopEquipmentDetail']").click();
  await page.locator(`${detailSelector} [data-action='buyWorkshopDevice']`).click();
  await page.locator("#modalRoot [data-action='confirmShopPurchase']").click();
  await page.locator("#modalRoot").waitFor({ state: "hidden" });
  await page.locator("#mainNav [data-nav-view='workshop']").click();
  await page.locator("[data-action='selectWorkshopStep'][data-payload='finish']").click();
  await page.locator("#workshopRoot").getByText(purchaseTitle, { exact: true }).waitFor();
  for (const [id, expected, name] of [["shop-detail-poor", "现金不足", "insufficient-cash"], ["shop-detail-starter", "先购置工坊", "no-workshop"]]) {
    const locked = await shopPage(id, { width: 390, height: 844 });
    await locked.locator("#equipmentShop [data-action='openShopEquipmentDetail']").first().click();
    assert.ok((await locked.locator(detailSelector).innerText()).includes(expected));
    assert.equal(await locked.locator(`${detailSelector} [data-action='buyWorkshopDevice']`).count(), 0);
    await checkDialog(locked, name);
    await locked.locator("#modalRoot").click({ position: { x: 2, y: 2 } });
    assert.equal(await locked.locator("#modalRoot").isVisible(), false, "backdrop closes detail");
  }
  assert.deepEqual(errors, []);
  writeFileSync(path.join(report, "browser-result.json"), JSON.stringify({ passed: true, layouts, tooltips, scrolls, errors,
    checks: ["opaque sticky toolbar", "no card overlap on hover or focus", "no cards above the sticky toolbar", "readable hover and focus tooltips", "all four parameters", "mobile edge alignment", "image and card clicks", "all stages show selected data", "purchase confirmation and delivery", "cash and workshop availability", "focus trap and return", "Escape and backdrop", "day and night", "no browser errors"] }, null, 2));
  console.log(`shop-equipment-browser: passed; screenshots at ${report}`);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode == null) {
    const stopped = new Promise(resolve => server.once("exit", resolve));
    server.kill();
    await stopped;
  }
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("jade-shop-detail-")) throw new Error("unsafe QA cleanup path");
  rmSync(resolved, { recursive: true, force: true });
}
process.exit(0);
