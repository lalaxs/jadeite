// Player-facing regression checks in a disposable world, never the user's save.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { applyInlay, quoteFinishPlan } from "../server/systems/inlay-system.js";
import { createDeviceInstance } from "../server/systems/equipment-system.js";
import { makeCandidate } from "../server/systems/employee-system.js";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
const player = H.makePlayer("market-list-visual-qa");
player.cash = 100000;
player.assets.workshopOwned = true;
player.workshop.devices.push(createDeviceInstance("opening", "cuijie-opening-1", "market-qa-device"));
const finishingWorker = makeCandidate({ rng: () => .4, makeId: () => "market-qa-finisher", usedNames: new Set(), tier: 8, job: "finisher" });
finishingWorker.traits = ["按线稳"];
finishingWorker.flaws = ["易脏"];
player.workshop.workers.push(finishingWorker);
const finishingDevice = createDeviceInstance("finishing", "cuijie-finishing-1", "market-qa-finishing-device");
finishingDevice.workerId = finishingWorker.id;
player.workshop.devices.push(finishingDevice);
const source = {
  ...player.rough[0], id: "market-qa-source", name: "飘花明料", type: "material",
  materialStage: "opened", stage: "material", qualityKey: "ice", quality: "正冰",
  color: "飘花绿", score: 4, mass: 1.5, price: 30000, value: 30000,
  visual: { seed: 32198, vein: "#247854", cotton: .65, translucency: .55 }
};
const definitions = [
  ["bracelet", "bangle", "手镯"], ["peacePendant", "ping", "平安扣"],
  ["gourdPendant", "gourd", "葫芦"], ["leafPendant", "leaf", "叶子"],
  ["cabochon", "egg", "蛋面戒指"]
];
player.bracelets = definitions.map(([type, openingTpl, name], index) => {
  const [blank] = H.extractProductsFromJob({ item: source, options: { kits: [{
    id: `market-qa-kit-${index}`, type, openingTpl, x: 50, y: 50,
    ringSize: 56, size: "M", scale: 1, rot: 0
  }] } });
  const plan = type === "bracelet"
    ? { process: "bangle", productType: "bangle", refinementId: "artisan", polishId: "soft" }
    : { process: "accessory", productType: type === "cabochon" ? "ring" : "pendant",
      refinementId: "artisan", polishId: "bright", settingId: "claw", metalId: "gold18k" };
  const product = applyInlay(structuredClone(blank), plan, quoteFinishPlan(blank, plan));
  return { ...product, id: `market-qa-finished-${index}`, name: `飘花${name}`, materialStage: "finished", stage: "finished" };
});
const extraProducts = Array.from({ length: 20 }, (_, index) => ({
  ...structuredClone(player.bracelets[index % definitions.length]),
  id: `market-qa-extra-${index}`, name: `备选玉件 ${index + 1}`
}));
player.bracelets.push(...extraProducts);
player.materials = [source];
H.state.players.clear();
H.state.players.set(player.id, player);
H.state.listings.length = 0;
const session = { playerId: player.id, resumeToken: H.playerSessions.issueSession(player) };
const directory = mkdtempSync(path.join(tmpdir(), "jade-market-list-browser-"));
const seedPath = path.join(directory, "seed.json");
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
const baseline = process.argv.includes("--baseline");
const report = path.resolve("docs/reports/2026-10-24-market-picker-large-cards");
mkdirSync(report, { recursive: true });
const port = 45000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
const errors = [];
let browser, server, output = "";
const measurements = [];
const scrollChecks = [];
const equipmentDetailChecks = [];
const cardChecks = [];
const traitFontChecks = [];

async function cardLayout(page, id) {
  const card = page.locator(`#mlGrid [data-ml-id='${id}']`);
  await card.scrollIntoViewIfNeeded();
  await card.locator("svg, canvas, img").first().waitFor({ state: "visible" });
  return card.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const visual = node.querySelector(".ml-slot-visual").getBoundingClientRect();
    const art = node.querySelector(".ml-slot-visual > :first-child").getBoundingClientRect();
    const name = node.querySelector(".ml-slot-name strong");
    const font = getComputedStyle(name);
    return {
      width: rect.width, height: rect.height, visualWidth: visual.width, visualHeight: visual.height,
      artWidth: art.width, artHeight: art.height,
      nameOffset: node.querySelector(".ml-slot-name").getBoundingClientRect().y - rect.y,
      fontSize: font.fontSize, fontWeight: font.fontWeight, textAlign: font.textAlign, whiteSpace: font.whiteSpace
    };
  });
}

function assertMatchingCards(actual, expected, message) {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === "number") assert.ok(Math.abs(actual[key] - value) < 1, `${message}: ${key}`);
    else assert.equal(actual[key], value, `${message}: ${key}`);
  }
}

async function start() {
  server = spawn(process.execPath, ["server.js"], { stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), LOG_LEVEL: "warn",
    JADE_WORLD_PERSIST: "1", JADE_WORLD_PERSIST_DRIVER: "sqlite",
    JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite"), JADE_WORLD_PATH: seedPath
  } });
  server.stdout.on("data", chunk => { output += chunk; });
  server.stderr.on("data", chunk => { output += chunk; });
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`QA server failed: ${output}`);
}

async function measure(page, label) {
  const result = await page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const detail = document.querySelector("#mlDetail");
    const modal = document.querySelector("#marketListModal .jm-modal-body");
    return {
      controls: [".ml-toolbar > :first-child", "#mlCategory", "#mlSort"].map(box),
      product: box("#mlDetail .component-jewelry-product"),
      svg: box("#mlDetail .component-jewelry-svg"),
      detailOverflow: detail.scrollWidth > detail.clientWidth + 1,
      modalOverflow: modal.scrollWidth > modal.clientWidth + 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  measurements.push({ label, ...result });
  return result;
}

async function assertArtwork(page) {
  const art = page.locator("#mlDetail .ml-info-visual");
  await art.scrollIntoViewIfNeeded();
  const product = await page.locator("#mlDetail .component-jewelry-product").boundingBox();
  assert.ok(product.width >= 100 && product.height >= 100, "finished product wrapper must have visible dimensions");
  const png = PNG.sync.read(await art.screenshot());
  let coloredPixels = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const [r, g, b, a] = png.data.subarray(offset, offset + 4);
    if (a > 0 && Math.max(r, g, b) - Math.min(r, g, b) > 12 && Math.min(r, g, b) < 150) coloredPixels++;
  }
  assert.ok(coloredPixels > 250, "finished product must paint actual jade/metal pixels, not an empty SVG container");
}

async function assertIndependentScroll(page, label) {
  const snapshot = () => page.evaluate(() => {
    const grid = document.querySelector("#mlGrid");
    const scroll = document.querySelector("#mlDetail .ml-detail-scroll");
    const panel = document.querySelector("#mlDetail");
    const body = document.querySelector("#marketListModal .jm-modal-body");
    const button = document.querySelector("#mlConfirm").getBoundingClientRect();
    return {
      left: grid.scrollTop, right: scroll.scrollTop, body: body.scrollTop,
      leftRange: grid.scrollHeight - grid.clientHeight,
      rightRange: scroll.scrollHeight - scroll.clientHeight,
      bodyRange: body.scrollHeight - body.clientHeight,
      toolbarY: document.querySelector(".ml-toolbar").getBoundingClientRect().y,
      buttonY: button.y, buttonHeight: button.height, buttonBottom: button.bottom,
      panelBottom: panel.getBoundingClientRect().bottom,
      footerY: document.querySelector("#marketListModal .jm-modal-foot").getBoundingClientRect().y
    };
  });
  await page.locator("#mlGrid, #mlDetail .ml-detail-scroll").evaluateAll(nodes => {
    nodes.forEach(node => { node.scrollTop = 0; });
  });
  const initial = await snapshot();
  assert.ok(initial.leftRange > 0 && initial.rightRange > 0, `${label}: fixture must overflow both independent scroll areas`);
  assert.ok(initial.bodyRange <= 1, `${label}: the modal body must not scroll as a whole`);
  assert.equal(initial.buttonHeight, 48, `${label}: confirmation height must stay fixed`);
  assert.ok(initial.buttonBottom < initial.panelBottom && initial.panelBottom < initial.footerY,
    `${label}: confirmation must remain fully visible above the modal footer`);
  const checkFixed = state => {
    assert.ok(Math.abs(state.buttonY - initial.buttonY) < 1, `${label}: confirmation must stay anchored while scrolling`);
    assert.equal(state.buttonHeight, initial.buttonHeight);
    assert.equal(state.toolbarY, initial.toolbarY, `${label}: inventory search must stay in place`);
    assert.equal(state.body, 0, `${label}: scrolling must not move the modal body`);
  };
  const leftBox = await page.locator("#mlGrid").boundingBox();
  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => document.querySelector("#mlGrid").scrollTop > 0);
  await page.waitForTimeout(150);
  const afterLeft = await snapshot();
  assert.equal(afterLeft.right, initial.right, `${label}: scrolling inventory must not move details`);
  checkFixed(afterLeft);

  await page.locator("#mlGrid").evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(150);
  const leftBoundary = await snapshot();
  assert.equal(leftBoundary.right, 0, `${label}: inventory boundary must not chain into details`);
  checkFixed(leftBoundary);

  const rightBox = await page.locator("#mlDetail .ml-detail-scroll").boundingBox();
  await page.mouse.move(rightBox.x + 8, rightBox.y + rightBox.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => document.querySelector("#mlDetail .ml-detail-scroll").scrollTop > 0);
  await page.waitForTimeout(150);
  const afterRight = await snapshot();
  assert.equal(afterRight.left, leftBoundary.left, `${label}: scrolling details must not move inventory`);
  checkFixed(afterRight);

  await page.locator("#mlDetail .ml-detail-scroll").evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(150);
  const rightBoundary = await snapshot();
  assert.equal(rightBoundary.left, afterRight.left, `${label}: detail boundary must not chain into inventory`);
  checkFixed(rightBoundary);
  scrollChecks.push({ label, initial, afterLeft, leftBoundary, afterRight, rightBoundary });
}

try {
  await start();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1542, height: 1026 } });
  await context.addInitScript(value => {
    localStorage.setItem("jade-player-session-v1", JSON.stringify(value));
    localStorage.setItem("jade-theme", "day");
  }, session);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "warning" && message.text().includes("Jade renderer fallback")) errors.push(message.text()); });
  await page.goto(origin);
  await page.locator("#mainNav button[data-nav-view='market']").waitFor();
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Escape");
  await page.locator("#mainNav button[data-nav-view='market']").click();
  await page.locator(".view.active[data-view='market']").waitFor();
  await page.locator(".jm-topbar-actions [data-action='openMarketListModal']").click();
  await page.locator("#marketListModal:not([hidden])").waitFor();
  await page.locator("[data-ml-id='market-qa-finished-1']").click();
  await page.screenshot({ path: path.join(report, baseline ? "before-desktop.png" : "desktop-day.png"), fullPage: true });
  const before = await measure(page, baseline ? "before-desktop" : "desktop-day");
  if (baseline) {
    assert.ok(before.product.width === 0 || before.product.height === 0, "reproduce the zero-size finished-product wrapper");
    assert.notEqual(before.controls[0].y, before.controls[1].y, "reproduce the stacked toolbar");
    console.log(JSON.stringify(before));
  } else {
    for (const viewport of [{ width: 1542, height: 1026 }, { width: 1024, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const result = await measure(page, `${viewport.width}px`);
      assert.equal(result.pageOverflow || result.modalOverflow || result.detailOverflow, false, "layout must fit its viewport and detail panel");
      const [search, category, sort] = result.controls;
      assert.equal(category.y, sort.y, "category and sorting must stay on the same row");
      if (viewport.width > 600) assert.ok(Math.abs(search.y - category.y) < 1, "desktop search, category and sorting must share one row");
      assert.equal(search.height, category.height, "toolbar controls must have equal heights");
      const equipmentCard = await cardLayout(page, "market-qa-device");
      const jadeCard = await cardLayout(page, "market-qa-source");
      assertMatchingCards(equipmentCard, jadeCard, "mixed inventory: equipment and jade must have equal card/visual dimensions and title typography");
      assert.ok(equipmentCard.width >= (viewport.width <= 600 ? 140 : 170), "restore the larger card width instead of the 110px compact cards");
      assert.ok(equipmentCard.height >= 198 && equipmentCard.visualHeight >= 128, "restore the larger card and artwork area");
      assert.equal(equipmentCard.fontSize, "15px", "restore the original larger title size");
      assert.equal(equipmentCard.artWidth, viewport.width <= 600 ? 112 : 148, "restore the original larger artwork scale");
      await page.locator("#mlGrid [data-ml-id='market-qa-device']").focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#mlGrid [data-ml-id='market-qa-device']").getAttribute("aria-selected"), "true", "equipment must retain keyboard selection");
      await page.locator("#mlCategory").selectOption("bracelet");
      assert.equal(await page.locator("#mlGrid .ml-slot").count(), definitions.length + extraProducts.length);
      for (let index = 0; index < definitions.length; index++) {
        await page.locator(`[data-ml-id='market-qa-finished-${index}']`).click();
        await assertArtwork(page);
      }
      await page.locator("#mlSearch").fill("飘花平安扣");
      assert.equal(await page.locator("#mlGrid .ml-slot").count(), 1);
      await page.locator("#mlSearch").fill("");
      await page.locator("#mlSort").selectOption("valueAsc");
      const ids = await page.locator("#mlGrid .ml-slot").evaluateAll(nodes => nodes.map(node => node.dataset.mlId));
      const values = ids.map(id => player.bracelets.find(item => item.id === id).value);
      assert.deepEqual(values, [...values].sort((a, b) => a - b), "sort must retain its behavior");
      await page.locator("[data-ml-id='market-qa-finished-1']").click();
      const price = Number(await page.locator("#mlPrice").inputValue());
      await page.locator("[data-ml-step='small'][data-ml-dir='1']").click();
      assert.ok(Number(await page.locator("#mlPrice").inputValue()) > price);
      assert.equal(await page.locator("#mlConfirm").isEnabled(), true);
      const productLayout = await page.locator("#mlDetail .ml-detail-info").evaluate(node => ({
        visualWidth: node.querySelector(".ml-info-visual").getBoundingClientRect().width,
        visualHeight: node.querySelector(".ml-info-visual").getBoundingClientRect().height,
        nameFontSize: getComputedStyle(node.querySelector(".ml-info-name")).fontSize,
        nameFontFamily: getComputedStyle(node.querySelector(".ml-info-name")).fontFamily
      }));
      await page.locator("#mlCategory").selectOption("material");
      await page.locator("[data-ml-id='market-qa-source']").click();
      await page.locator("#mlDetail .jade-opening-svg").waitFor();
      await page.locator("#mlCategory").selectOption("equipment");
      await page.locator("#mlGrid [data-ml-id='market-qa-device']").click();
      const equipmentOnlyCard = await cardLayout(page, "market-qa-device");
      assertMatchingCards(equipmentOnlyCard, equipmentCard, "filtering to equipment must not resize its cards");
      cardChecks.push({ viewport, equipmentCard, jadeCard, equipmentOnlyCard });
      const equipmentText = await page.locator("#mlDetail").innerText();
      assert.match(equipmentText, /开料设备/);
      assert.match(equipmentText, /耐久 100%/);
      assert.match(equipmentText, /科技 1 级/);
      assert.match(equipmentText, /参考估值|同款新机|修满需/);
      assert.doesNotMatch(equipmentText, /种水分布|糯种|豆种/);
      const equipmentLayout = await page.locator("#mlDetail .ml-detail-info").evaluate(node => {
        const visual = node.querySelector(".ml-info-visual").getBoundingClientRect();
        const info = node.getBoundingClientRect();
        const name = node.querySelector(".ml-info-name");
        return {
          visualWidth: visual.width, visualHeight: visual.height,
          nameFontSize: getComputedStyle(name).fontSize, nameFontFamily: getComputedStyle(name).fontFamily,
          centered: Math.abs(visual.x + visual.width / 2 - info.x - info.width / 2) < 1,
          nameBelowVisual: name.getBoundingClientRect().y >= visual.bottom
        };
      });
      for (const key of Object.keys(productLayout)) assert.equal(equipmentLayout[key], productLayout[key], `${key}: equipment and other goods must share the same detail presentation`);
      assert.equal(equipmentLayout.centered && equipmentLayout.nameBelowVisual, true, "equipment must use a centered icon above its name");
      assert.equal(await page.locator("#mlDetail .equipment-param-pill").count(), 4);
      await page.locator("#mlDetail .ml-detail-scroll").evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({ path: path.join(report, `equipment-${viewport.width}px-day.png`), fullPage: true });
      equipmentDetailChecks.push({ viewport, productLayout, equipmentLayout });
      await page.locator("#mlCategory").selectOption("all");
      await page.locator("#mlSort").selectOption("valueDesc");
      await page.locator("[data-ml-id='market-qa-finished-1']").click();
      await assertIndependentScroll(page, `${viewport.width}px`);
      await page.locator("#mlDetail .ml-detail-scroll, #mlGrid, #marketListModal .jm-modal-body").evaluateAll(nodes => {
        nodes.forEach(node => { node.scrollTop = 0; });
      });
      await page.locator("#mlGrid .ml-slot").first().locator("svg, canvas, img").first().waitFor({ state: "visible" });
      await page.screenshot({ path: path.join(report, `${viewport.width}px-day.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1542, height: 1026 });
    await page.evaluate(() => { document.documentElement.dataset.theme = "night"; });
    await assertArtwork(page);
    await page.screenshot({ path: path.join(report, "desktop-night.png"), fullPage: true });
    await page.locator("#mlCategory").selectOption("equipment");
    await page.locator("#mlGrid [data-ml-id='market-qa-device']").click();
    await page.screenshot({ path: path.join(report, "equipment-desktop-night.png"), fullPage: true });
    await page.locator("#mlCategory").selectOption("bracelet");
    await page.locator("[data-ml-id='market-qa-finished-1']").click();
    await page.locator("#mlPrice").fill("5000");
    await page.locator("#mlConfirm").click();
    await page.locator("#marketListModal").waitFor({ state: "hidden" });
    await page.locator("[data-market-section='mine']").click();
    await page.locator("#marketGrid .jm-card").filter({ hasText: "飘花平安扣" }).waitFor();
    await page.locator("#mainNav button[data-nav-view='workshop']").click();
    await page.locator("[data-action='selectWorkshopStep'][data-payload='finish']").click();
    await page.locator("[data-action='openWorkshopDevice'][data-payload='market-qa-finishing-device']").click();
    for (const theme of ["day", "night"]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const styles = await page.locator(".ws-big-worker-flaws").evaluate(node => {
        const font = selector => {
          const style = getComputedStyle(node.querySelector(selector));
          return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight };
        };
        return { positive: font(".trait-chip"), negative: font(".flaw-chip") };
      });
      assert.deepEqual(styles.positive, styles.negative, "positive and negative worker traits must use matching text styles");
      await page.locator(".ws-big-worker-flaws").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(report, `worker-trait-${theme}.png`), fullPage: true });
      traitFontChecks.push({ theme, ...styles });
    }
    assert.deepEqual(errors, [], "no browser errors or jade renderer fallbacks");
  }
  writeFileSync(path.join(report, baseline ? "baseline.json" : "browser-result.json"), JSON.stringify({ passed: true, baseline, measurements, scrollChecks, equipmentDetailChecks, cardChecks, traitFontChecks, errors }, null, 2));
  console.log(`market-list-browser: ${baseline ? "bugs reproduced" : "uniform inventory cards and equipment details, matching worker trait fonts, fixed confirmation, independent scrolling and listing passed"}; screenshots at ${report}`);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode == null) {
    const stopped = new Promise(resolve => server.once("exit", resolve));
    server.kill("SIGTERM");
    await stopped;
  }
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("jade-market-list-browser-")) throw new Error("unsafe QA cleanup path");
  rmSync(resolved, { recursive: true, force: true });
}
process.exit(0);
