import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { chromium } from "playwright";
import {
  startLivestreamRoom,
  replenishLivestreamRoom,
  publicLivestreamRoom
} from "../server/systems/livestream-room-system.js";

// Run the real picker and room authority against isolated in-memory products.
const products = [
  ["pendant", "糯种青白水滴挂件", 6340, "dropPendant"],
  ["bracelet", "糯种青白52圈口手镯", 2629, "bracelet"],
  ["low", "糯种青白蛋面", 15, "cabochon"],
  ["restock", "补货蛋面", 15, "cabochon"],
  ["minimum", "低价成品", 1, "cabochon"],
  ["unselected", "未勾选成品", 99, "cabochon"]
].map(([id, name, value, kind]) => {
  const productType = kind === "cabochon" ? "ring" : "pendant";
  const sourceMaterial = {
    roughId: `${id}-rough`, openingSeed: 32198, visual: { seed: 32198 },
    qualityKey: "glutinous", quality: "糯种", color: "青白",
    placement: { id: `${id}-kit`, openingTpl: kind === "cabochon" ? "egg" : kind === "bracelet" ? "bracelet" : "drop",
      x: 300, y: 300, rot: 0, scale: 0.7, size: "M", svgSpace: true }
  };
  return {
    id, name, value, kind, type: "bracelet", materialStage: "finished", quality: "糯种",
    qualityKey: "glutinous", color: "青白", size: "M", score: 3, sourceMaterial,
    ...(kind === "bracelet" ? { ringSize: 52 } : {
      productType,
      inlay: { productTypeName: productType === "ring" ? "戒指" : "吊坠", settingName: "爪镶", metalName: "18K金", polishName: "柔光", polishId: "soft" },
      components: [{ type: "jade", kind, sourceMaterial, polishId: "soft" },
        { type: "mount", productType, metalId: "gold18k", settingId: "claw" }]
    }),
    costBasis: { amount: value, complete: true }
  };
});
let seller;
let sequence = 0;
const app = express();
app.use(express.json());
app.get("/livestream-pricing-fixture", (_request, response) => {
  seller = {
    id: "pricing-test", name: "定价测试", level: 2, rep: 18, cash: 7841,
    assets: { livestreamPermitOwned: true }, bracelets: structuredClone(products),
    materials: [], slices: [], rough: [], collection: [], workshop: { workers: [] },
    livestreamRoom: null, livestreamHistory: [], ledger: []
  };
  response.type("html").send(`<!doctype html><html lang="zh-CN" data-theme="day"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,"><link rel="stylesheet" href="/styles.css">
    <style>body{height:auto;overflow:auto}.fixture-shell{padding:24px;max-width:1400px;margin:auto}@media(max-width:600px){.fixture-shell{padding:12px}}</style>
    </head><body><main class="fixture-shell"><div id="livestreamList"></div></main>
    <script type="module">
      import * as format from '/shell/format-utils.js';
      import * as helpers from '/features/inventory-helpers.js';
      import * as opening from '/features/opening/opening-render.js';
      import {initInventoryModule} from '/inventory-module.js';
      import {initLivestreamModule,renderLivestream} from '/livestream-module.js';
      const state={me:${JSON.stringify(seller)},livestreamRooms:[]},events=[];
      const getState=()=>state,els={livestream:document.getElementById('livestreamList')};
      const socket={emit(event,payload){
        events.push([event,payload]);
        fixture.pending=fetch('/pricing-event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,payload})})
          .then(response=>response.json()).then(result=>{
            fixture.lastResult={event,...result};
            if(result.ok){state.me=result.me;state.livestreamRooms=result.me.livestreamRoom?[result.me.livestreamRoom]:[];renderLivestream()}
          });
      }};
      const deps={...format,...helpers,...opening,kitsFor:()=>[],empty:()=>'',showToast:message=>events.push(['toast',message])};
      helpers.bindInventoryHelperDeps({getState,getSocket:()=>socket,kitsFor:()=>[]});
      opening.bindOpeningRenderDeps({getState,materialStageForClient:helpers.materialStageForClient});
      initInventoryModule({getState,els,socket,helpers:deps});
      const fixture=window.pricingFixture={state,events,renderLivestream,lastResult:null};
      initLivestreamModule({getState,els,socket,getActiveView:()=> 'livestream',helpers:{...deps,finishedProducts:()=>state.me.bracelets}});
      renderLivestream();
    </script></body></html>`);
});
app.post("/pricing-event", (request, response) => {
  const { event, payload } = request.body;
  const options = { now: Date.now(), host: null, makeId: () => `pricing-${++sequence}` };
  const result = event === "startLivestreamRoom"
    ? startLivestreamRoom(seller, payload.items, options)
    : event === "replenishLivestreamRoom"
      ? replenishLivestreamRoom(seller, payload.items, options)
      : { ok: false, message: `Unexpected event: ${event}` };
  response.json({ ok: result.ok, message: result.message, me: { ...seller, livestreamRoom: publicLivestreamRoom(seller) } });
});
app.use("/shared", express.static(path.resolve("shared")));
app.use(express.static(path.resolve("public")));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const output = path.resolve(".tmp/livestream-pricing-ui");
await mkdir(output, { recursive: true });
const reports = [], errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "chrome" } : {}) });
  for (const [name, width, height, theme] of [["desktop", 1440, 1000, "day"], ["mobile-night", 390, 844, "night"]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/livestream-pricing-fixture`);
    await page.waitForFunction(() => Boolean(window.pricingFixture));
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.locator('[data-livestream-action="goto-mine-tab"]').first().click();
    const price = id => page.locator(`[data-livestream-price="${id}"]`);
    const select = id => page.locator(`[data-livestream-select="${id}"]`);
    const preset = mult => page.locator(`[data-livestream-action="price-preset"][data-price-mult="${mult}"]`);
    const start = () => page.locator('[data-livestream-action="start"]');
    assert.equal(await price("low").inputValue(), "16");
    assert.equal(await price("minimum").inputValue(), "1");
    assert.equal(await price("low").getAttribute("min"), "1");
    assert.equal(await price("low").getAttribute("step"), "1");
    await preset("1.15").click();
    assert.equal(await price("low").inputValue(), "16", "Presets require selected products");
    for (const id of ["pendant", "bracelet", "low"]) await select(id).check({ force: true });
    const expected = [["1", [6340, 2629, 15]], ["1.05", [6657, 2760, 16]], ["1.15", [7291, 3023, 17]]];
    for (const [mult, values] of expected) {
      await preset(mult).click();
      for (const [index, id] of ["pendant", "bracelet", "low"].entries()) {
        assert.equal(Number(await price(id).inputValue()), values[index]);
        assert.equal(await price(id).evaluate(el => el.checkValidity()), true);
      }
      assert.equal(await price("unselected").inputValue(), "104", "Unselected prices stay unchanged");
    }
    await price("low").fill("18");
    await preset("1.15").click();
    assert.equal(await price("low").inputValue(), "17", "Preset refreshes an edited input even when the draft matches a prior render");
    for (const invalid of ["0", "-1", "15.5"]) {
      await price("low").fill(invalid);
      assert.equal(await start().isDisabled(), true);
    }
    await price("low").fill("1");
    assert.equal(await start().isEnabled(), true, "The shared minimum price is accepted");
    await preset("1.15").click();
    assert.equal(await page.locator(".livestream-price-tier").count(), 0);
    assert.ok(!(await page.locator(".livestream-stock-picker").innerText()).match(/仅等玩家|今日需求不足|偏慢|正常/));
    assert.equal(await page.locator(".livestream-stock-limit").count(), 0);
    const overflow = await page.locator(".livestream-stock-picker").evaluate(el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false);
    await page.locator('[data-product-id="low"]').scrollIntoViewIfNeeded();
    await page.locator('[data-product-id="low"] .lazy-preview:not(.is-pending)').waitFor();
    await page.locator('[data-product-id="low"]').screenshot({ path: path.join(output, `${name}-low-price.png`) });
    await start().click();
    await page.waitForFunction(() => window.pricingFixture.lastResult?.event === "startLivestreamRoom");
    assert.equal(await page.evaluate(() => window.pricingFixture.lastResult.ok), true);
    assert.deepEqual(seller.livestreamRoom.items.map(item => item.price), [7291, 3023, 17]);
    await page.locator('[data-livestream-action="open-replenish-modal"]').click();
    await select("restock").check({ force: true });
    await select("minimum").check({ force: true });
    for (const [mult, expectedPrice] of [["1", 15], ["1.05", 16], ["1.15", 17]]) {
      await preset(mult).click();
      assert.equal(Number(await price("restock").inputValue()), expectedPrice);
      assert.equal(await price("minimum").inputValue(), "1");
    }
    assert.equal(await page.locator(".livestream-price-tier").count(), 0);
    await page.locator('[data-product-id="restock"]').scrollIntoViewIfNeeded();
    await page.locator('[data-product-id="restock"] .lazy-preview:not(.is-pending)').waitFor();
    await page.locator('[data-product-id="restock"]').screenshot({ path: path.join(output, `${name}-restock.png`) });
    await page.locator('[data-livestream-action="replenish"]').click();
    await page.waitForFunction(() => window.pricingFixture.lastResult?.event === "replenishLivestreamRoom");
    assert.equal(await page.evaluate(() => window.pricingFixture.lastResult.ok), true);
    assert.deepEqual(seller.livestreamRoom.items.map(item => item.price), [7291, 3023, 17, 17, 1]);
    reports.push({ name, passed: true, presetPrices: [15, 16, 17], submittedPrices: seller.livestreamRoom.items.map(item => item.price) });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ reports, errors }, null, 2));
  console.log("livestream-pricing-browser: low-price presets, validation, clean cards, start and replenishment passed on desktop/mobile");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
