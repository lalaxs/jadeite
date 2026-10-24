import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Run against the disposable, non-persistent inlay-art-browser-fixture world.
const baseURL = "http://127.0.0.1:3012/";
const output = (name) => fileURLToPath(new URL(name, import.meta.url));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const failedResponses = [];
let guestSessionProbes = 0;
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.status() === 401 && new URL(response.url()).pathname === "/api/account/session") {
    guestSessionProbes++;
    return;
  }
  if (response.status() >= 400) failedResponses.push([response.status(), response.url()]);
});
const checks = [];
const field = (name) => page.locator(`[data-inlay-preview-field="${name}"]`);
const visual = page.locator(".inlay-preview-main-visual");
const artwork = "/assets/inlay/buddha-original-clean-lines-v1.png";
try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  if (await page.locator("html").getAttribute("data-theme") !== "day") await page.locator("#themeToggle").click();
  await page.locator('[data-action="openLocation"][data-payload="workshop"]').click();
  await page.locator('[data-action="openInlayPreviewTester"]').click();
  await field("shape").selectOption("carving");
  await field("polishId").selectOption("soft");

  for (const setting of ["claw", "bezel", "micro", "cord"]) {
    await field("settingId").selectOption(setting);
    if (setting === "micro") await field("gemId").selectOption("diamond");
    const state = await visual.evaluate((node) => {
      const svg = node.querySelector("svg");
      const ids = new Set([...svg.querySelectorAll("[id]")].map((element) => element.id));
      const missing = [...svg.outerHTML.matchAll(/(?:href="#|url\(#)([^"\)]+)/g)].map((match) => match[1]).filter((id) => !ids.has(id));
      return {
        body: svg.querySelector('image[data-inlay-atlas="buddha"]')?.getAttribute("href"),
        stones: svg.querySelectorAll(".craft-accent-stone").length,
        quoted: Number(svg.querySelector("[data-gem-count]")?.getAttribute("data-gem-count") || 0),
        missing
      };
    });
    assert.equal(state.body, artwork);
    assert.equal(state.stones, state.quoted);
    assert.deepEqual(state.missing, []);
    checks.push({ setting, ...state });
  }

  await field("settingId").selectOption("micro");
  await field("metalId").selectOption("gold18k");
  await field("gemId").selectOption("");
  await page.waitForTimeout(400);
  await page.screenshot({ path: output("after-day-desktop.png") });
  await visual.locator("svg.component-jewelry-svg").screenshot({ path: output("after-jade-day.png") });

  for (const polish of ["bright", "soft", "matte"]) {
    await field("polishId").selectOption(polish);
    assert.equal(await visual.locator("[data-jade-polish]").getAttribute("data-jade-polish"), polish);
    assert.equal(await visual.locator('image[data-inlay-atlas="buddha"]').getAttribute("href"), artwork);
  }
  checks.push({ polishes: ["bright", "soft", "matte"] });
  await field("polishId").selectOption("soft");
  await field("metalId").selectOption("platinum");
  await field("gemId").selectOption("diamond");
  await page.waitForTimeout(400);
  await page.screenshot({ path: output("after-diamond-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await visual.scrollIntoViewIfNeeded();
  await page.screenshot({ path: output("after-mobile.png") });
  const mobile = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.equal(mobile.document, mobile.viewport);
  checks.push({ mobile });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-inlay-preview-action="close"]').first().click();
  await page.locator('[data-action="openLocation"][data-payload="inventory"]').click();
  await page.locator('[data-inventory-category="finished"]').click();
  const buddhaCard = page.locator('.inventory-slot[data-payload="art-qa-3"]');
  await buddhaCard.waitFor();
  await buddhaCard.scrollIntoViewIfNeeded();
  const cached = buddhaCard.locator(".lazy-preview-bitmap");
  await cached.waitFor({ timeout: 20000 });
  assert.equal(await cached.evaluate((image) => image.complete && image.naturalWidth > 0), true);
  await page.screenshot({ path: output("inventory-desktop.png") });
  await buddhaCard.screenshot({ path: output("inventory-cached-buddha.png") });
  checks.push({ inventoryBitmap: true, bitmapWidth: await cached.evaluate((image) => image.naturalWidth) });

  await buddhaCard.click();
  const detail = page.locator('.game-modal[role="dialog"]');
  await detail.waitFor();
  assert.equal(await detail.locator('image[data-inlay-atlas="buddha"]').getAttribute("href"), artwork);
  await page.screenshot({ path: output("inventory-detail.png") });
  checks.push({ inventoryDetail: true });

  assert.deepEqual(errors, []);
  assert.deepEqual(failedResponses, []);
  const result = { baseURL, checks, errors, failedResponses, guestSessionProbes };
  writeFileSync(output("browser-checks.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
