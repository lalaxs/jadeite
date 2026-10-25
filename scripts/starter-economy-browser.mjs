import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

// Real purchases and processing on a disposable server. A capitalized fixture
// buys all three machines; production timers use the test timing profile.
const port = 47000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
const directory = ".tmp/workshop-owned-ui";
mkdirSync(directory, { recursive: true });
try { await fetch(origin); throw new Error("QA port is occupied"); }
catch (error) { if (error.message === "QA port is occupied") throw error; }
const server = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: String(port), NODE_ENV: "test", PUBLIC_ORIGIN: "",
    JADE_WORLD_PERSIST: "0", JADE_TIMING_PROFILE: "test", LOG_LEVEL: "warn" },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "", browser, page;
server.stdout.on("data", (data) => { serverOutput += data; });
server.stderr.on("data", (data) => { serverOutput += data; });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [], milestones = [], diagnostics = [];
try {
  const deadline = Date.now() + 15_000;
  while (true) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) break; } catch {}
    if (Date.now() > deadline || server.exitCode !== null) throw new Error(serverOutput || "QA server did not start");
    await sleep(100);
  }
  browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "chrome" : undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    locale: "zh-CN", timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) diagnostics.push(message.text()); });
  page.on("requestfailed", (request) => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", (response) => { if (response.status() >= 400) diagnostics.push(`${response.status()} ${response.url()}`); });
  await page.addInitScript(() => {
    let factory;
    Object.defineProperty(window, "io", { configurable: true, get: () => factory,
      set(value) {
        factory = new Proxy(value, { apply(target, receiver, args) {
          const socket = Reflect.apply(target, receiver, args);
          window.__starterQa = { socket, state: null, commands: [] };
          socket.on("state", (state) => { window.__starterQa.state = structuredClone(state); });
          socket.on("state:patch", (patch) => {
            if (window.__starterQa.state) Object.assign(window.__starterQa.state, structuredClone(patch.changes || {}));
          });
          socket.onAnyOutgoing((name) => window.__starterQa.commands.push(name));
          socket.on("connect_error", (error) => { window.__starterQa.connectionError = error.message; });
          return socket;
        } });
      }
    });
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.__starterQa?.state?.me?.rough?.length === 1);
  const state = () => page.evaluate(() => window.__starterQa.state);
  const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
  };
  const initial = (await state()).me;
  assert.equal(initial.cash, 12_000);
  assert.equal(initial.rough.length, 1);
  const giftId = initial.rough[0].id;
  milestones.push({ stage: "initial", cash: initial.cash, rough: initial.rough.length });
  await shot("01-initial");

  assert.deepEqual(initial.workshop.devices, []);
  assert.equal(Object.hasOwn(initial.workshop, "publicStations"), false);
  await page.locator('#mainNav [data-nav-view="workshop"]').click();
  for (const [step, label] of [["open", "开料"], ["plan", "规划"], ["finish", "精加工"]]) {
    await page.locator(`#workshopStepTab-${step}`).click();
    assert.equal(await page.locator('.workshop-recipe-card').count(), 0);
    assert.match(await page.locator('.workshop-step-empty').innerText(), new RegExp(`暂无${label}设备`));
    assert.equal(await page.locator('#workshopRoot [data-view-link="shop"]').count(), 1);
    assert.equal(await page.locator('[data-action="openInlayPreviewTester"], .workshop-ownership-note').count(), 0);
  }
  await shot("02-empty-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await shot("03-empty-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.workshop-step-empty [data-view-link="shop"]').click();
  await page.locator('[data-action="shopSelectTab"][data-payload="equipment"]').waitFor();
  await page.evaluate(() => window.__starterQa.socket.emit('debugGrant', { cash: 14_000 }));
  await page.waitForFunction(() => window.__starterQa.state.me.cash === 26_000);
  for (const stage of ["opening", "carving", "finishing"]) {
    await page.locator('[data-action="shopSelectTab"][data-payload="equipment"]').click();
    await page.locator(`[data-eq-stage="${stage}"]`).click();
    await page.locator(`[data-action="buyWorkshopDevice"][data-model-key="used-${stage}-1"]`).click();
    await page.locator('[data-action="confirmShopPurchase"]').click();
    await page.waitForFunction((stage) => window.__starterQa.state.me.workshop.devices.some(device => device.stage === stage), stage);
  }
  assert.equal((await state()).me.cash, 12_000);
  milestones.push({ stage: "owned-line-purchased", invested: 14_000, cash: 12_000 });

  async function workshop(stage, itemId) {
    await page.locator('#mainNav [data-nav-view="workshop"]').click();
    const back = page.locator('[data-action="backWorkshopDevices"]');
    if (await back.isVisible()) await back.click();
    const tab = page.locator(`#workshopStepTab-${{ opening: "open", carving: "plan", finishing: "finish" }[stage]}`);
    if (await tab.count()) await tab.click();
    const device = (await state()).me.workshop.devices.find((row) => row.stage === stage);
    await page.locator(`[data-action="openWorkshopDevice"][data-payload="${device.id}"]`).click();
    await page.locator('.ws-big-material[data-action="openWorkshopPicker"]').click();
    await page.locator(`[data-action="pickWorkshopItem"][data-payload="${itemId}"]`).click();
  }
  async function receive(stage) {
    await page.waitForFunction((stage) => window.__starterQa.state.me.workshopDeliveries.some((row) => row.stage === stage), stage);
    const delivery = (await state()).me.workshopDeliveries.find((row) => row.stage === stage);
    const noticeClose = page.locator('#modalRoot [data-modal-close]').first();
    if (await noticeClose.isVisible()) await noticeClose.click();
    await page.locator(`[data-action="openWorkshopDelivery"][data-payload="${delivery.id}"]`).first().click();
    await page.locator("[data-delivery-box]").focus();
    await page.keyboard.press("Enter");
    await page.locator("[data-delivery-results]").waitFor({ state: "visible" });
    let revealRequested = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const back = page.locator("[data-delivery-return]");
      const reveal = page.locator("[data-delivery-reveal-all]");
      if (await back.isVisible()) { await back.click(); await page.waitForTimeout(100); }
      else if (!revealRequested && await reveal.isVisible() && await reveal.isEnabled()) { revealRequested = true; await reveal.click(); }
      else if (await page.locator("[data-delivery-collect]").isVisible()) break;
      else await page.waitForTimeout(100);
    }
    await page.locator("[data-delivery-collect]").click();
    await page.waitForFunction((id) => !window.__starterQa.state.me.workshopDeliveries.some((row) => row.id === id), delivery.id);
    await page.locator(".workshop-delivery-root").waitFor({ state: "detached" });
  }
  await workshop("opening", giftId);
  await page.locator('[data-action="startWorkshopJob"]').click();
  await receive("opening");
  assert.equal((await state()).me.cash, 12_000);

  await workshop("carving", giftId);
  await page.locator('[data-action="openWorkshopPlanner"]').click();
  await page.locator('[data-opening-kit-choice="ping"]').click();
  const board = await page.locator("#ws-planner-root svg").first().boundingBox();
  await page.mouse.click(board.x + board.width / 2, board.y + board.height / 2);
  await shot("02-planning");
  await page.locator('[data-planner-action="confirm"]').click();
  await page.locator('[data-action="startWorkshopJob"]').click();
  await receive("carving");
  const blank = (await state()).me.bracelets.find((row) => row.starterOriginId === giftId);
  assert.ok(blank);
  await workshop("finishing", blank.id);
  await page.locator('[data-action="startWorkshopJob"]').click();
  await page.locator('[data-finish-field="productType"]').selectOption("pendant");
  await page.locator('[data-finish-field="settingId"]').selectOption("cord");
  await shot("03-finishing");
  await page.locator('[data-finish-action="confirm"]').click();
  await receive("finishing");
  const finished = (await state()).me;
  assert.equal(finished.cash, 12_000);
  assert.equal(finished.bracelets.find((row) => row.id === blank.id).materialStage, "finished");
  milestones.push({ stage: "finished", cash: finished.cash, productValue: finished.bracelets[0].value });

  await page.locator('#mainNav [data-nav-view="orders"]').click();
  const trial = (await state()).me.orders.find((order) => order.starterOrder);
  assert.ok(trial);
  await page.locator(`[data-action="openOrderProductPicker"][data-payload="${trial.id}"]`).click();
  const productChoice = page.locator(`[data-action="pickOrderProductOption"][data-product-id="${blank.id}"]`);
  if (await productChoice.getAttribute("aria-pressed") !== "true") await productChoice.click();
  await page.locator('[data-action="confirmOrderProductPick"]').click();
  await page.locator(`[data-action="completeOrder"][data-payload="${trial.id}"]`).click();
  await page.getByRole("button", { name: "确认交付", exact: true }).click();
  await page.waitForFunction(() => window.__starterQa.state.me.onboarding.firstSaleAt > 0);
  const sold = (await state()).me;
  assert.ok(sold.cash > 12_000);
  assert.ok(!sold.bracelets.some((row) => row.id === blank.id));
  milestones.push({ stage: "sold", cash: sold.cash, revenue: sold.cash - 12_000 });
  await shot("04-sold");

  // Dismiss the completed-sale modal before visiting the real NPC stalls.
  const close = page.locator('#modalRoot [data-modal-close]');
  if (await close.first().isVisible()) await close.first().click();
  await page.locator('#mainNav [data-nav-view="blackmarket"]').click();
  const stalls = (await state()).blackStalls;
  const offers = stalls.filter((stall) => stall.npc).flatMap((stall) => (stall.items || [])
    .filter((row) => row.type === "rough").map((row) => ({ stallId: stall.id, ...row })))
    .filter((row) => row.price <= sold.cash - 4500).sort((a, b) => a.price - b.price);
  assert.ok(offers.length, "NPC stalls must have a rough affordable from the starter bankroll");
  const offer = offers[0];
  await page.locator(`[data-action="openBmStallDetail"][data-payload="${offer.stallId}"]`).first().click();
  await page.locator(`[data-action="openBmBuyGoods"][data-payload="${offer.id}"]`).click();
  await page.locator('[data-action="confirmBmBuy"]').click();
  await page.waitForFunction((id) => window.__starterQa.state.me.rough.some((row) => row.id === id), offer.item.id);
  const replenished = (await state()).me;
  assert.equal(replenished.cash, sold.cash - offer.price);
  assert.ok(replenished.cash >= 4500);
  assert.ok(replenished.onboarding.completedAt);
  milestones.push({ stage: "replenished", price: offer.price, cash: replenished.cash });
  await shot("05-replenished");

  const identity = replenished.id;
  await page.reload();
  await page.waitForFunction((id) => window.__starterQa?.state?.me?.id === id, identity);
  assert.equal((await state()).me.cash, replenished.cash);
  assert.equal((await state()).me.rough.length, 1, "reconnect must not grant another starter rough");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("06-mobile");
  assert.deepEqual(errors, []);
  const report = { ok: true, timing: "test profile; real production and transaction handlers", milestones, pageErrors: errors };
  writeFileSync(`${directory}/browser-flow.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${directory}/browser-failure.png`, fullPage: true }).catch(() => {});
    const bridge = await page.evaluate(() => ({ io: typeof window.io, bridge: !!window.__starterQa,
      connected: window.__starterQa?.socket?.connected, connectionError: window.__starterQa?.connectionError,
      commands: window.__starterQa?.commands, hasState: !!window.__starterQa?.state }));
    writeFileSync(`${directory}/browser-failure.txt`, `${error.stack}\nPage errors: ${JSON.stringify(errors)}\nDiagnostics: ${JSON.stringify({ diagnostics, bridge })}\n${(await page.locator("body").innerText().catch(() => "")).slice(-14_000)}\n${serverOutput.slice(-3000)}`);
  }
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
}
