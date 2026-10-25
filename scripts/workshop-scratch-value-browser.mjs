import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "@playwright/test";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

process.env.JADE_WORLD_PERSIST = "0";
process.env.NODE_ENV = "test";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
const player = installOwnedWorkshopFixture(H.makePlayer("scratch-value-player"));
player.offlineSummary = null;
player.pendingAuctionSettle = null;
const item = { id: "scratch-value-material", name: "冰种阳绿明料", type: "material", materialStage: "opened", stage: "material",
  qualityKey: "ice", quality: "冰种", color: "阳绿", score: 4, mass: 1.5, price: 8000, value: 8000,
  visual: { seed: 32198 }, costBasis: { amount: 5000, complete: true } };
player.workshopDeliveries.push({ id: "scratch-value-delivery", stage: "opening", inputName: "验收原石", workerName: "掌柜",
  completedAt: Date.now(), revealedAt: null, items: [item], auxiliaryItems: [],
  scratchReveal: { version: 1, itemIds: [item.id], revealedItemIds: [] } });
H.state.players.set(player.id, player);
const session = { playerId: player.id, resumeToken: H.playerSessions.issueSession(player) };
const temporary = mkdtempSync(path.join(tmpdir(), "jade-scratch-value-"));
const seedPath = path.join(temporary, "seed.json");
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
const output = path.resolve(".tmp/workshop-scratch-value");
mkdirSync(output, { recursive: true });
const port = 46000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
let server, browser, serverOutput = "";
const errors = [];
try {
  server = spawn(process.execPath, ["server.js"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
    HOST: "127.0.0.1", PORT: String(port), PUBLIC_ORIGIN: "", LOG_LEVEL: "warn", JADE_WORLD_PERSIST: "1",
    JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_SQLITE_PATH: path.join(temporary, "world.sqlite"), JADE_WORLD_PATH: seedPath } });
  server.stdout.on("data", data => { serverOutput += data; });
  server.stderr.on("data", data => { serverOutput += data; });
  const deadline = Date.now() + 15000;
  while (true) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) break; } catch {}
    if (server.exitCode != null || Date.now() > deadline) throw new Error(serverOutput);
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce", timezoneId: "Asia/Shanghai" });
  await context.addInitScript(value => {
    localStorage.setItem("jade-player-session-v1", JSON.stringify(value));
    let factory;
    Object.defineProperty(window, "io", { configurable: true, get: () => factory, set(value) {
      factory = new Proxy(value, { apply(target, receiver, args) {
        const socket = Reflect.apply(target, receiver, args);
        socket.on("state", state => { window.scratchState = state; });
        socket.on("state:patch", patch => { if (window.scratchState) Object.assign(window.scratchState, patch.changes); });
        return socket;
      } });
    } });
  }, session);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.scratchState?.me?.id === "scratch-value-player");
  await page.locator('#mainNav [data-nav-view="workshop"]').click();
  const open = async () => {
    await page.locator('[data-action="openWorkshopDelivery"][data-payload="scratch-value-delivery"]').first().click();
    await page.locator('[data-scratch-canvas]').waitFor({ state: "visible" });
  };
  await page.locator('[data-action="openWorkshopDelivery"][data-payload="scratch-value-delivery"]').first().click();
  await page.locator('[data-delivery-box]').click();
  const canvas = page.locator('[data-scratch-canvas]');
  await canvas.waitFor({ state: "visible" });
  const value = () => page.locator('[data-scratch-value]').getAttribute("data-value").then(Number);
  assert.equal(await value(), 0);
  const points = await page.evaluate(async () => {
    const { openingStoneFor } = await import("/features/opening/opening-render.js");
    const { openingStoneOutline } = await import("/jade-opening-engine.js");
    const { pointInOutline, distanceToOutline } = await import("/shared/domain/jade/outline-geometry.js");
    const stone = openingStoneFor(window.scratchState.me.workshopDeliveries[0].items[0]);
    const boundary = openingStoneOutline(stone);
    const points = [];
    for (let r = 0; r < stone.jadeMap.RES; r++) for (let c = 0; c < stone.jadeMap.RES; c++) {
      const x = (c + .5) * stone.jadeMap.CELL, y = (r + .5) * stone.jadeMap.CELL;
      if (!stone.jadeMap.grid[r * stone.jadeMap.RES + c].waste && pointInOutline(x, y, boundary)
        && distanceToOutline(x, y, boundary) > 48) points.push({ x: x / 600, y: y / 600 });
    }
    points.sort((a, b) => Math.hypot(a.x - .5, a.y - .5) - Math.hypot(b.x - .5, b.y - .5));
    return [points[0], points.find(p => Math.hypot(p.x - points[0].x, p.y - points[0].y) > .18)];
  });
  const stroke = async (point, whileHeld) => {
    const b = await canvas.boundingBox();
    await page.mouse.move(b.x + b.width * (point.x - .015), b.y + b.height * point.y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * (point.x + .015), b.y + b.height * point.y, { steps: 8 });
    await whileHeld?.();
    await page.mouse.up();
  };
  await stroke(points[0], async () => assert.ok(await value() > 0, "value updates before the brush is released"));
  const firstValue = await value();
  assert.ok(firstValue < item.value, "hidden material is not included in the revealed value");
  await stroke(points[0]);
  assert.equal(await value(), firstValue, "rubbing the same area does not inflate value");
  assert.match(await page.locator('[data-scratch-value-delta]').innerText(), /本笔 \+¥0/);
  await stroke(points[1]);
  const secondValue = await value();
  assert.ok(secondValue > firstValue);
  await page.locator('[data-delivery-close]').click();
  await open();
  assert.equal(await value(), secondValue, "reopening retains the revealed value");
  for (const [width, height] of [[1366, 768], [360, 640], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(80);
    const layout = await page.locator('[data-scratch-valuation]').evaluate(el => {
      const r = el.getBoundingClientRect(), visual = document.querySelector('.delivery-item-visual').getBoundingClientRect();
      const footer = document.querySelector('.delivery-footer').getBoundingClientRect();
      return { inside: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight,
        below: r.top >= visual.bottom - 1 || r.left >= visual.right - 1, beforeFooter: r.bottom <= footer.top + 1 && footer.bottom <= innerHeight,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth, pictureSize: visual.height,
        footerTop: footer.top, footerBottom: footer.bottom, valueBottom: r.bottom,
        rows: getComputedStyle(document.querySelector('.delivery-dialog')).gridTemplateRows };
    });
    assert.equal(layout.inside && layout.below && layout.beforeFooter && !layout.horizontalOverflow, true, JSON.stringify(layout));
    assert.ok(layout.pictureSize >= 170, JSON.stringify(layout));
    await page.screenshot({ path: path.join(output, `scratch-${width}x${height}.png`), fullPage: true });
  }
  await page.locator('[data-delivery-reveal-all]').click();
  await page.locator('.delivery-reveal-summary .opening-result').waitFor({ state: "visible" });
  assert.match(await page.locator('.delivery-reveal-summary .opening-result').innerText(), /8,000/);
  assert.equal(await page.locator('[data-scratch-valuation]').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, firstValue, secondValue,
    checks: ["value changes during rubbing", "overlapping strokes", "restored value", "desktop, portrait and landscape layout", "full result"] }));
} catch (error) {
  console.error(JSON.stringify({ errors, serverOutput }));
  throw error;
} finally {
  await browser?.close();
  if (server?.exitCode === null) { const stopped = once(server, "exit"); server.kill(); await stopped; }
}
