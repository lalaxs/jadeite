import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createGame } from "../server/create-game.js";
import { BUSINESS_DAY_MS } from "../shared/domain/progression/business-growth.js";

const port = 46000 + process.pid % 1000;
const game = createGame({ env: { ...process.env, NODE_ENV: "test", JADE_WORLD_PERSIST: "0", HOST: "127.0.0.1", PORT: String(port), PUBLIC_ORIGIN: "", LOG_LEVEL: "warn" } });
const h = game.__testHooks;
const directory = path.resolve(".tmp/business-growth");
mkdirSync(directory, { recursive: true });
let browser;
const errors = [];
async function open(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "选择你的经营方式" })).toBeVisible();
  return { context, page };
}
async function serverPlayer(page) {
  const id = await page.evaluate(() => sessionStorage.getItem("jade-player-id"));
  return h.world.getPlayer(id);
}
try {
  await game.startServer();
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const { context, page } = await open({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(directory, "startup-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "领取500元开始", exact: true }).click();
  const p = await serverPlayer(page);
  await expect.poll(() => p.cash).toBe(500);
  await expect(page.locator(".business-panel")).toContainText("累计经营净利润");
  await page.locator('#mainNav [data-nav-view="blackmarket"]').click();
  await expect(page.getByRole("heading", { name: "街坊供货与收购" })).toBeVisible();
  await page.locator('[data-action="businessBuy"]').first().click();
  await expect(page.locator('[data-action="businessSell"]')).toHaveCount(1);
  await page.locator('[data-action="businessSell"]').click();
  await expect.poll(() => p.cash).toBe(515);
  await expect(page.locator('[data-action="businessSell"]')).toHaveCount(0);
  await page.screenshot({ path: path.join(directory, "neighborhood-desktop.png"), fullPage: true });
  await page.locator('#mainNav [data-nav-view="workshop"]').click();
  await expect(page.locator('.view[data-view="overview"]')).toHaveClass(/active/);
  await expect(page.locator('.view[data-view="workshop"]')).not.toHaveClass(/active/);
  await page.locator(".business-treasury summary").click();
  await page.getByRole("button", { name: "申请贷款", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("每24小时一期");
  await page.locator("#businessLoanAmount").fill("100");
  await page.getByRole("button", { name: "借款", exact: true }).click();
  await expect.poll(() => p.cash).toBe(615);
  await expect.poll(() => p.business.loans[0]?.interest).toBe(1);
  await page.locator(".business-treasury summary").click();
  await page.getByRole("button", { name: "主动还款", exact: true }).click();
  await page.locator("#businessRepayAmount").fill("101");
  await page.getByRole("button", { name: "还款", exact: true }).click();
  await expect.poll(() => p.cash).toBe(514);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "选择你的经营方式" })).toHaveCount(0);
  assert.equal(p.cash, 514);
  h.earnCash(p, 10000, "建设界面经营收益夹具", { source: "commission" });
  h.broadcast();
  for (const id of ["stall", "expanded", "workshop"]) {
    await page.locator(`[data-action="businessBuild"][data-payload="${id}"]`).click();
    await page.getByRole("dialog").getByRole("button", { name: "建设并开业", exact: true }).click();
    await expect.poll(() => p.business.built.includes(id)).toBe(true);
    await page.keyboard.press("Escape");
  }
  assert.equal(p.workshop.devices.length, 1);
  assert.equal(p.cash, 5714);
  await page.locator('[data-action="businessStartOpening"]').click();
  await expect.poll(() => p.jobs.length).toBe(1);
  await page.locator('#mainNav [data-nav-view="workshop"]').click();
  await expect(page.locator('.view[data-view="workshop"]')).toHaveClass(/active/);
  await expect(page.getByText("公共开料工位", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: path.join(directory, "workshop-desktop.png"), fullPage: true });
  await context.close();

  for (const [name, cash, debt] of [["小本合约",500,5505],["周转合约",2000,27020],["大本合约",10000,60100]]) {
    const run = await open({ width: 390, height: 844 });
    await run.page.locator(".business-start-option").filter({ has: run.page.getByRole("heading", { name, exact: true }) }).getByRole("button").click();
    await expect(run.page.getByRole("dialog")).toContainText("现实24小时");
    await expect(run.page.getByRole("dialog").locator(".modal-close")).toHaveCount(0);
    await run.page.getByRole("button", { name: "签约并领取资金" }).click();
    const actor = await serverPlayer(run.page);
    await expect.poll(() => actor.cash).toBe(cash);
    await expect(run.page.locator(".business-contract")).toContainText(name);
    await expect(run.page.locator(".business-contract")).toBeInViewport();
    assert.equal(actor.business.contract.endsAt-actor.business.contract.startedAt, BUSINESS_DAY_MS);
    const at = Date.now();
    actor.business.contract.startedAt = at - BUSINESS_DAY_MS - 1;
    actor.business.contract.endsAt = at - 1;
    h.businessService.settleBusinessForPlayer(actor, at);
    h.broadcast();
    await expect(run.page.locator(".business-contract")).toContainText("已到期");
    assert.equal(actor.business.contract.initialDebt, debt);
    assert.equal(actor.business.loans[0].principal, cash);
    assert.equal(actor.business.loans[0].penalty, actor.business.contract.target*.5 - Math.max(0, actor.business.contract.paidAtSettlement - Math.ceil(cash*.01)));
    const overflow = await run.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, "手机页面没有横向溢出");
    await run.page.screenshot({ path: path.join(directory, `${name}-mobile.png`), fullPage: true });
    await run.context.close();
  }
  const mobile = await open({ width: 390, height: 844 });
  await mobile.page.screenshot({ path: path.join(directory, "startup-mobile.png"), fullPage: true });
  await mobile.page.setViewportSize({ width: 844, height: 390 });
  await mobile.page.screenshot({ path: path.join(directory, "startup-landscape.png"), fullPage: true });
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  await mobile.context.close();
  assert.deepEqual(errors, [], "浏览器无脚本异常");
  console.log(`business browser passed: four starts, trade, gates, borrowing, repayment, reconnect, three failures and mobile layouts; screenshots ${directory}`);
} finally {
  await browser?.close();
  await game.shutdown();
}
