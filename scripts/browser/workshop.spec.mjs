import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";

const fixtureDirectory = process.env.WORKSHOP_BASELINE_DIR || "scripts/fixtures/workshop-baseline";
const preserveDrafts = process.env.WORKSHOP_PRESERVE_DRAFTS === "1";
const fixture = JSON.parse(readFileSync(`${fixtureDirectory}/state.json`, "utf8"));
const contract = JSON.parse(readFileSync(`${fixtureDirectory}/contract.json`, "utf8"));
const original = readFileSync(process.env.WORKSHOP_ORACLE_SOURCE || `${fixtureDirectory}/workshop-module.js`, "utf8");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (!process.env.WORKSHOP_ORACLE_SOURCE) expect(digest(contract.normalizedSourceSha256 ? original.replaceAll("\r\n", "\n") : original))
  .toBe(contract.normalizedSourceSha256 || contract.sourceSha256);

function comparePixels(actualBytes, expectedBytes) {
  const actual = PNG.sync.read(actualBytes), expected = PNG.sync.read(expectedBytes);
  expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
  let changedPixels = 0, maxChannelDelta = 0;
  for (let i = 0; i < actual.data.length; i += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs(actual.data[i + channel] - expected.data[i + channel]));
    if (delta) changedPixels++;
    maxChannelDelta = Math.max(maxChannelDelta, delta);
  }
  // The unchanged source produced <=3/255 compositor rounding noise in Chrome
  // shadows. No pixels are masked; geometry and protocol are compared exactly.
  return { changedPixels, maxChannelDelta };
}

async function openClient(browser, baseURL, viewport, theme, baseline) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "zh-CN", timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date(contract.now));
  await page.addInitScript(({ fixture, theme }) => {
    localStorage.setItem("jade-theme", theme);
    let seed = 12345, sequence = 0;
    Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
    window.__recordedState = fixture;
  }, { fixture, theme });
  await page.route("**/socket.io/socket.io.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.io = () => {
      const handlers = new Map(), commands = [], state = window.__recordedState;
      const trigger = (name, payload) => { for (const handler of handlers.get(name) || []) handler(payload); };
      const patch = () => trigger('state:patch', { baseVersion: state.stateVersion, stateVersion: ++state.stateVersion, serverNow: state.serverNow, changes: { me: structuredClone(state.me) } });
      const socket = {
        auth: {}, connected: true,
        on(name, handler) { handlers.set(name, [...(handlers.get(name) || []), handler]); return this; },
        off(name, handler) { handlers.set(name, (handlers.get(name) || []).filter(fn => fn !== handler)); return this; },
        emit(name, ...args) {
          const payload = args[0], ack = args.find(arg => typeof arg === 'function');
          commands.push([name, structuredClone(typeof payload === 'function' ? null : payload)]);
          if (name === 'revealWorkshopDelivery') {
            const delivery = state.me.workshopDeliveries.find(row => row.id === payload.deliveryId);
            delivery.revealedAt = state.serverNow;
            delivery.scratchReveal ||= { version: 1, itemIds: delivery.items.map(item => item.id), revealedItemIds: [] };
            if (payload.itemIds) delivery.scratchReveal = { ...delivery.scratchReveal, revealedItemIds: [...new Set([...delivery.scratchReveal.revealedItemIds, ...payload.itemIds])] };
            ack?.({ ok: true, revealedAt: delivery.revealedAt, scratchReveal: delivery.scratchReveal }); setTimeout(patch, 0);
          } else if (name === 'claimWorkshopDelivery') {
            const delivery = state.me.workshopDeliveries.find(row => row.id === payload.deliveryId);
            for (const item of [...delivery.items, ...delivery.auxiliaryItems]) {
              state.me[item.type === 'rough' ? 'rough' : item.type === 'material' ? 'materials' : item.type === 'slice' ? 'slices' : 'bracelets'].push(item);
            }
            state.me.workshopDeliveries = state.me.workshopDeliveries.filter(row => row.id !== delivery.id);
            ack?.({ ok: true, count: delivery.items.length }); setTimeout(patch, 0);
          } else if (name === 'startWorkshopJob') ack?.(window.__nextWorkshopAck || { ok: false, message: '基线：暂不提交任务' });
          else if (name === 'requestState') trigger('state', structuredClone(state));
          return this;
        }
      };
      window.__workshopTransport = { commands, trigger, patch };
      setTimeout(() => { trigger('connect'); trigger('hello', { playerId: state.me.id, resumeToken: 'fixture-token' }); trigger('state', structuredClone(state)); }, 0);
      return socket;
    };
  ` }));
  if (baseline) await page.route("**/features/workshop/workshop-module.js", (route) => route.fulfill({ contentType: "text/javascript", body: original }));
  await page.goto(baseURL);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#mainNav [data-nav-view="workshop"]').click();
  await expect(page.locator("#workshopRoot .workshop-step-tab")).toHaveCount(3);
  return { context, page, errors };
}

async function exercise(client, info, label) {
  const { page } = client;
  const shots = new Map(), layouts = new Map();
  const shot = async (name) => {
    // Let fonts, preview hydration, raster caches and two paint frames settle.
    await page.waitForTimeout(250);
    await page.mouse.move(1, 1);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (animation.effect.getComputedTiming().iterations === Infinity) { animation.pause(); animation.currentTime = 0; }
        else animation.finish();
      }
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    shots.set(name, await page.screenshot({ path: info.outputPath(`${label}-${name}.png`), animations: "disabled", caret: "hide" }));
    layouts.set(name, await page.locator('#workshopRoot, .ws-picker-modal, .ws-planner-modal, .finish-plan-modal, .delivery-dialog, .delivery-detail-dialog, .delivery-reveal-summary').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(); return { class: node.className, x: r.x, y: r.y, width: r.width, height: r.height };
    })));
  };
  const device = (stage) => fixture.me.workshop.devices.find(row => row.stage === stage).id;
  const openDevice = async (stage) => {
    await page.locator(`[data-action="openWorkshopDevice"][data-payload="${device(stage)}"]`).click();
  };
  const back = () => page.locator('[data-action="backWorkshopDevices"]').click();
  const pick = async (id) => {
    await page.locator('.ws-big-material[data-action="openWorkshopPicker"]').click();
    await page.locator(`[data-action="pickWorkshopItem"][data-payload="${id}"]`).click();
  };
  await shot("opening-home");
  await openDevice("opening");
  await shot("opening-device");
  await page.locator('.ws-big-material[data-action="openWorkshopPicker"]').click();
  await shot("material-picker");
  await page.locator(".wsp-search").fill("没有匹配的原料");
  await expect(page.locator(".wsp-search-empty")).toBeVisible();
  await shot("material-search");
  await page.locator('[data-action="closeWorkshopPicker"]').click();
  await page.locator('.wsp-select-worker').click();
  await page.locator('[data-action="setWorkerSort"][data-sort="quality"]').click();
  await shot("worker-picker");
  await page.locator('[data-action="closeWorkshopPicker"]').click();
  await back();
  await page.locator('#workshopStepTab-plan').click();
  await openDevice("carving");
  await pick("baseline-opened");
  await page.locator('[data-action="openWorkshopPlanner"]').click();
  await expect(page.locator(".ws-planner-modal")).toBeVisible();
  await shot("planner-empty");
  await page.locator('#ws-planner-root [data-opening-kit-choice="ping"]').click();
  await expect(page.locator('#ws-planner-root .kit:not(.extracted)')).toHaveCount(1);
  await shot("planner-kit");
  const kit = page.locator('#ws-planner-root .kit:not(.extracted)');
  const previousTransform = await kit.getAttribute("transform");
  await kit.scrollIntoViewIfNeeded();
  const point = await kit.evaluate(node => {
    const box = node.getBoundingClientRect();
    for (const y of [.18, .3, .5, .7, .82]) for (const x of [.18, .3, .5, .7, .82]) {
      const px = box.x + box.width * x, py = box.y + box.height * y;
      if (document.elementFromPoint(px, py)?.closest('.kit') === node) return { x: px, y: py };
    }
    throw new Error("No visible draggable part of the selected kit");
  });
  await page.evaluate(() => { window.__capturedPlannerBoard = document.querySelector('#ws-planner-root [data-opening-board]'); });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 16, point.y + 10, { steps: 5 });
  await page.evaluate(() => window.__workshopTransport.patch());
  expect(await page.evaluate(() => window.__capturedPlannerBoard.isConnected)).toBe(true);
  await page.mouse.up();
  await expect(kit).not.toHaveAttribute("transform", previousTransform);
  const draggedTransform = await kit.getAttribute("transform");
  await shot("planner-dragged");
  await page.locator('[data-planner-action="cancel"]').first().click();
  await expect(page.locator("#ws-planner-root")).toHaveCount(0);
  await page.locator('[data-action="openWorkshopPlanner"]').click();
  await expect(page.locator('#ws-planner-root .kit:not(.extracted)')).toHaveCount(preserveDrafts ? 1 : 0);
  if (preserveDrafts) await expect(page.locator('#ws-planner-root .kit:not(.extracted)')).toHaveAttribute("transform", draggedTransform);
  else await page.locator('#ws-planner-root [data-opening-kit-choice="ping"]').click();
  await page.locator('[data-planner-action="confirm"]').click();
  await expect(page.locator('[data-action="startWorkshopJob"]')).toBeVisible();
  await shot("planner-committed");
  await back();
  await page.locator('#workshopStepTab-finish').click();
  await openDevice("finishing");
  await pick("baseline-bangle");
  await page.locator('[data-action="startWorkshopJob"]').click();
  await expect(page.locator(".bangle-finish-modal")).toBeVisible();
  await shot("bangle-plan");
  await page.locator('[data-finish-field="polishId"]').selectOption("soft");
  await page.locator('[data-finish-action="confirm"]').click();
  await expect(page.locator('[data-finish-warning]')).toContainText("基线：暂不提交任务");
  await shot("bangle-rejected");
  await page.evaluate(() => { window.__nextWorkshopAck = { ok: true }; });
  await page.locator('[data-finish-action="confirm"]').click();
  await expect(page.locator("#finish-plan-root")).toHaveCount(0);
  await openDevice("finishing");
  await pick("baseline-cabochon");
  await page.locator('[data-action="startWorkshopJob"]').click();
  await expect(page.locator(".finish-plan-modal")).toBeVisible();
  await shot("cabochon-plan");
  const metal = page.locator('[data-finish-field="metalId"]');
  const metalId = await metal.locator('option').evaluateAll(options => options.find(option => option.value && !option.disabled)?.value);
  await metal.selectOption(metalId);
  await metal.focus();
  await page.evaluate(() => {
    window.__focusedFinishField = document.activeElement;
    window.__recordedState.me.externalMaterials = {};
    window.__workshopTransport.patch();
  });
  expect(await page.evaluate(() => window.__focusedFinishField === document.activeElement)).toBe(true);
  await expect(page.locator('[data-finish-action="confirm"]')).toBeDisabled();
  await shot("finish-stock-shortage");
  await page.locator('[data-finish-action="close"]').first().click();
  // Existing side-panel delivery action, same as a real completed production job.
  if (page.viewportSize().width < 768) await page.locator("#sidePanelToggle").click();
  await page.locator('[data-action="openWorkshopDelivery"]').first().click();
  await expect(page.locator("[data-delivery-box]")).toBeVisible();
  await shot("delivery-pending");
  // Keep the baseline's existing pointer hit-testing unchanged; exercise the
  // accessible button activation rather than force-clicking through its art.
  await page.locator("[data-delivery-box]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-delivery-results]")).toBeVisible();
  if (await page.locator("[data-delivery-reveal-all]").isVisible()) {
    await shot("delivery-covered");
    await page.locator("[data-delivery-reveal-all]").click();
  }
  if (await page.locator("[data-delivery-return]").count()) {
    await expect(page.locator("[data-delivery-summary]")).toBeVisible();
    await shot("delivery-material-info");
    await page.locator("[data-delivery-return]").click();
    await expect(page.locator("[data-delivery-collect]")).toBeEnabled();
    await shot("delivery-returned");
    await page.locator("[data-delivery-item]").first().click();
    await expect(page.locator(".delivery-detail-dialog")).toBeVisible();
    await shot("delivery-details");
    await page.locator(".delivery-detail-dialog [data-detail-close]").first().click();
    await expect(page.locator(".delivery-detail-dialog")).toHaveCount(0);
  }
  await expect(page.locator("[data-delivery-collect]")).toBeVisible();
  await shot("delivery-revealed");
  const deliveryId = fixture.me.workshopDeliveries[0].id;
  await page.locator("[data-delivery-collect]").click();
  await expect(page.locator(".delivery-dialog")).toHaveCount(0);
  expect(await page.evaluate(id => window.__recordedState.me.workshopDeliveries.some(row => row.id === id), deliveryId)).toBe(false);
  await shot("delivery-collected");
  expect(client.errors).toEqual([]);
  return { shots, layouts, commands: await page.evaluate(() => window.__workshopTransport.commands) };
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
  for (const theme of ["day", "night"]) {
    test(`${viewport.width}x${viewport.height} ${theme}: frozen/current workshop equivalence`, async ({ browser, baseURL }, info) => {
      const before = await openClient(browser, baseURL, viewport, theme, true);
      const expected = await exercise(before, info, "baseline");
      await before.context.close();
      const after = await openClient(browser, baseURL, viewport, theme, false);
      const actual = await exercise(after, info, "current");
      await after.context.close();
      expect(actual.commands).toEqual(expected.commands);
      expect([...actual.layouts]).toEqual([...expected.layouts]);
      const pixelResults = {};
      for (const [name, bytes] of expected.shots) {
        const result = comparePixels(actual.shots.get(name), bytes);
        pixelResults[name] = result;
        expect(result.maxChannelDelta, `Pixel difference in ${name}; inspect baseline/current images in ${info.outputDir}`).toBeLessThanOrEqual(3);
      }
      const comparisonPath = info.outputPath("pixel-comparison.json");
      writeFileSync(comparisonPath, JSON.stringify(pixelResults, null, 2) + "\n");
      await info.attach("pixel-comparison", { path: comparisonPath, contentType: "application/json" });
    });
  }
}
