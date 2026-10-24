import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { chromium } from "playwright";
import { inventoryDetailAnalysis } from "../public/features/inventory/item-detail-analysis.js";
import { bindOpeningRenderDeps } from "../public/features/opening/opening-render.js";

// An isolated static client exercises the actual inspectInventoryItem entry point.
// No live game, player inventory or persistent world is read or changed.
const source = {
  id: "detail-opened", name: "冰种飘花明料", type: "material", materialStage: "opened",
  revealed: true, qualityKey: "ice", quality: "冰种", color: "飘花绿", value: 12500,
  openingSeed: 32198, visual: { seed: 32198 }
};
const hidden = {
  id: "detail-hidden", name: "松花会卡料", type: "rough", materialStage: "rough", value: 2418,
  qualityKey: "glass", quality: "玻璃种", color: "帝王绿", hint: "松花皮壳 · 轮廓饱满",
  costBasis: { amount: 24180, complete: true },
  visual: { seed: 17, masked: true }, seen: false
};
const finished = {
  id: "detail-finished", name: "冰种平安扣", type: "bracelet", kind: "peacePendant",
  materialStage: "finished", qualityKey: "ice", quality: "冰种", color: "飘花绿", value: 19500,
  sourceRoughId: source.id,
  sourceMaterial: {
    roughId: source.id, roughName: source.name, openingSeed: source.openingSeed,
    visual: source.visual, qualityKey: source.qualityKey, quality: source.quality, color: source.color,
    placement: { id: "detail-kit", openingTpl: "ping", x: 300, y: 300, rot: 0, scale: .7, size: "M", svgSpace: true }
  }
};
const state = {
  me: {
    rough: [hidden, { ...hidden, id: "detail-windowed", windows: [{ x: 50, y: 50, hasCrack: true }] }],
    materials: [source, {
      ...source, id: "detail-origin", name: "矿山明料", miningOrigin: {
        mineName: "会卡深层矿区 · 西侧老坑通道", beltLabel: "深层绿色含玉矿带", conditionName: "雨后潮湿围岩",
        foremanName: "老张", foremanLabel: "支护与通风", crewNames: ["张师傅", "李师傅", "王师傅"],
        roleLabels: ["开采", "支护", "运输"], crewSpecializations: ["识玉", "围岩辨识", "安全支护"]
      }
    }, { ...source, id: "detail-escrow", escrowOrderId: "commission-1" }],
    slices: [], bracelets: [finished, { ...finished, id: "detail-finished-escrow", escrowOrderId: "commission-finished" }],
    collection: [], externalMaterials: { gold18k: 3 }
  },
  materialCatalog: [{ key: "gold18k", name: "18K金", group: "metal", price: 480, unitLabel: "克" }]
};
bindOpeningRenderDeps({ getState: () => state });
const fixture = `<!doctype html><html lang="zh-CN" data-theme="day"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/styles.css"><style>.shell{display:block;min-height:0;padding:24px}.shell button{margin:4px}</style></head><body>
  <main class="shell"><h2>库存详情检查</h2>${[hidden, source, finished].map(item => `<button type="button" data-inspect="${item.id}">${item.name}</button>`).join("")}</main>
  <div id="modalRoot" class="modal-root" hidden></div>
  <script type="module">
    import * as helpers from '/features/inventory-helpers.js';
    import * as opening from '/features/opening/opening-render.js';
    import { initInventoryModule } from '/inventory-module.js';
    import * as modal from '/shell/game-modal.js';
    import * as format from '/shell/format-utils.js';
    const state = ${JSON.stringify(state)};
    const socket = { emit(...args) { window.detailEvents.push(args); } };
    window.detailEvents = [];
    const getState = () => state;
    helpers.bindInventoryHelperDeps({ getState, getSocket: () => socket, kitsFor: () => [] });
    opening.bindOpeningRenderDeps({ getState, materialStageForClient: helpers.materialStageForClient });
    const els = { modalRoot: document.getElementById('modalRoot'), shell: document.querySelector('.shell') };
    modal.bindGameModalDeps({ getEls: () => els, getState, getSocket: () => socket });
    initInventoryModule({ getState, els, socket, helpers: { ...format, ...helpers, ...opening, ...modal, kitsFor: () => [] } });
    document.addEventListener('click', event => {
      const opener = event.target.closest('[data-inspect]');
      if (opener) helpers.inspectInventoryItem(opener.dataset.inspect);
      if (event.target.closest('[data-modal-close]')) modal.closeGameModal();
    });
    window.inspectDetail = helpers.inspectInventoryItem;
    window.detailReady = true;
  </script></body></html>`;

const app = express();
app.get("/inventory-detail-fixture", (_request, response) => response.type("html").send(fixture));
app.use("/shared", express.static(path.resolve("shared")));
app.use(express.static(path.resolve("public")));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const outputDirectory = path.resolve(".tmp/inventory-detail-review");
await mkdir(outputDirectory, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/inventory-detail-fixture`);
  await page.waitForFunction(() => window.detailReady);
  await page.evaluate(() => document.fonts.ready);
  const dialog = page.locator(".inventory-detail-modal");
  const analysis = page.locator(".inventory-detail-analysis");
  const inspect = async id => {
    await page.evaluate(id => window.inspectDetail(id), id);
    await dialog.waitFor({ state: "visible" });
  };
  const layoutReports = [];
  async function checkLayout(name, width, height, id = source.id, theme = "day") {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await inspect(id);
    const report = await dialog.evaluate((element, name) => {
      const rect = element.getBoundingClientRect();
      const overview = element.querySelector('.inventory-detail-overview').getBoundingClientRect();
      const detail = element.querySelector('.inventory-detail-content').getBoundingClientRect();
      const body = element.querySelector('.game-modal-body');
      const actions = element.querySelector('.game-modal-actions').getBoundingClientRect();
      return { name, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom,
        columns: detail.left > overview.left + overview.width - 1 ? 2 : 1,
        overviewWidth: overview.width, contentWidth: detail.width,
        horizontalOverflow: body.scrollWidth > body.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth,
        footerVisible: actions.top >= rect.top && actions.bottom <= innerHeight,
        bodyScrollable: body.scrollHeight > body.clientHeight + 1 };
    }, name);
    assert.equal(report.horizontalOverflow, false, `${name}: no horizontal overflow`);
    assert.equal(report.columns, width > 640 ? 2 : 1, `${name}: responsive columns`);
    if (width > 640) assert.ok(Math.abs(report.contentWidth - report.overviewWidth) <= 1, `${name}: equal visual weight on both sides`);
    assert.ok(report.top >= 0 && report.bottom <= height + 1, `${name}: modal fits viewport`);
    assert.ok(report.footerVisible, `${name}: actions remain visible`);
    layoutReports.push(report);
    await dialog.screenshot({ path: path.join(outputDirectory, `${name}.png`) });
  }

  await page.getByRole("button", { name: hidden.name, exact: true }).click();
  assert.match(await analysis.innerText(), /未揭露/);
  assert.match(await analysis.innerText(), /内部料质未揭露，开窗或开料后可查看。/);
  assert.doesNotMatch(await analysis.innerText(), /颜色分布|裂纹覆盖|废料占比/);
  assert.doesNotMatch(await analysis.innerText(), /玻璃种|帝王绿|\d+(?:\.\d+)?%/);
  assert.doesNotMatch(await page.locator(".inventory-detail-facts").innerText(), /玻璃种/);
  assert.match(await page.locator('.inventory-detail-summary').innerText(), /已记货品成本\s*¥24,180/);
  assert.doesNotMatch(await page.locator('.inventory-detail-overview').innerText(), /已记货品成本|¥24,180/);
  assert.equal(await page.locator('.game-modal-actions [data-payload^="workshop|"]').count(), 1);
  assert.equal(await page.locator('.game-modal-actions [data-payload^="market|"]').count(), 1);
  assert.equal(await page.evaluate(() => window.detailEvents.some(([event]) => event === "markInventorySeen")), true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: hidden.name, exact: true }).evaluate(element => element === document.activeElement), true);
  await checkLayout("desktop-hidden", 1440, 900, hidden.id);
  await inspect("detail-windowed");
  assert.doesNotMatch(await analysis.innerText(), /玻璃种|帝王绿|\d+(?:\.\d+)?%/);

  const expected = inventoryDetailAnalysis({ item: source, stage: "opened", category: "stage", source: "materials" });
  await checkLayout("desktop-opened", 1440, 900);
  const text = await analysis.innerText();
  for (const row of [...expected.grades, ...expected.colors]) {
    assert.ok(text.includes(row.name));
    if (row.percent != null) assert.ok(text.includes(`${row.percent.toFixed(1)}%`));
  }
  assert.ok(text.includes(`${expected.crackPercent.toFixed(1)}%`));
  assert.ok(text.includes(`${expected.wastePercent.toFixed(1)}%`));
  await checkLayout("desktop-night", 1440, 900, source.id, "night");
  await checkLayout("mobile-opened", 390, 844);
  await checkLayout("narrow-finished", 320, 640, finished.id);
  assert.equal(await page.locator('.game-modal-actions [data-action="collectBracelet"]').count(), 1);
  for (const destination of ["orders", "market", "livestream"]) {
    assert.equal(await page.locator(`.game-modal-actions [data-payload="${destination}|${finished.id}"]`).count(), 1);
  }
  await checkLayout("short-origin", 900, 500, "detail-origin");
  const archive = page.locator('.inventory-detail-archive');
  assert.equal(await archive.getAttribute('open'), null);
  await archive.locator('summary').click();
  assert.equal(layoutReports.at(-1).bodyScrollable, true);
  assert.match(await archive.innerText(), /矿山来源|井下分工|值班班长/);
  assert.equal(await page.locator('.inventory-detail-footer .inventory-detail-archive').count(), 1);
  assert.doesNotMatch(await page.locator('.inventory-detail-overview').innerText(), /矿山来源|井下分工|值班班长/);
  await inspect("detail-escrow");
  assert.equal(await page.locator('.game-modal-actions [data-payload^="market|"]').count(), 0);
  await inspect("detail-finished-escrow");
  assert.equal(await page.locator('.game-modal-actions [data-payload="blackmarket|detail-finished-escrow"]').count(), 1);
  assert.equal(await page.locator('.game-modal-actions [data-action="collectBracelet"]').count(), 0);
  assert.equal(await page.locator('.game-modal-actions [data-payload^="market|"]').count(), 0);
  await inspect("external:gold18k");
  assert.equal(await page.locator('.game-modal-actions [data-payload="workshop-finish|external:gold18k"]').count(), 1);
  assert.match(await analysis.innerText(), /材料详情|18K金|金属/);
  assert.match(await analysis.innerText(), /不适用/);
  assert.doesNotMatch(await analysis.innerText(), /\d+(?:\.\d+)?%/);
  await page.locator('.game-modal-actions [data-modal-close]').click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  await writeFile(path.join(outputDirectory, "results.json"), JSON.stringify({ layoutReports, errors }, null, 2));
  console.log(JSON.stringify({ layoutReports, errors, outputDirectory }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
