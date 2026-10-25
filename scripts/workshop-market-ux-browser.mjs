import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "@playwright/test";
import { io } from "socket.io-client";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

// The parent creates a seed in a temporary directory. The child uses a separate
// SQLite world and port; no connection is made to the regular game service.
process.env.JADE_WORLD_PERSIST = "0";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "warn";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
const player = H.makePlayer("planning-finance-browser-player");
installOwnedWorkshopFixture(player);
player.name = "规划与经营验收";
player.cash = 30000;
player.offlineSummary = null;
player.pendingAuctionSettle = null;
player.assets.livestreamPermitOwned = true;
const gift = player.rough.shift();
const opened = H.revealPolishedRough(gift);
Object.assign(opened, { id: "planning-qa-material-a", type: "material", materialStage: "opened", stage: "material", name: "草稿验收明料A" });
H.addItem(player, opened, { type: "material", acquisitionCost: 4000 });
H.addItem(player, { ...structuredClone(opened), id: "planning-qa-material-b", name: "草稿验收明料B" }, { type: "material", acquisitionCost: 3200 });
const extracted = H.extractProductsFromJob({ item: opened, options: { kits: [{ type: "peacePendant", x: 50, y: 50, size: "M" }] } })[0];
const product = { ...extracted, id: "finance-qa-product", name: "经营验收平安扣", type: "bracelet", materialStage: "finished", stage: "finished", value: 2600, price: 2600 };
H.addItem(player, product, { type: "bracelet", acquisitionCost: 1850 });
const unknown = { ...structuredClone(product), id: "finance-qa-legacy", name: "旧藏成本待核平安扣" };
delete unknown.costBasis;
delete unknown.financeBatchId;
H.addItem(player, unknown, { type: "bracelet" });
H.state.players.set(player.id, player);
const customer = H.makePlayer("planning-finance-browser-customer");
customer.cash = 50000;
H.state.players.set(customer.id, customer);
H.addItem(player, { ...structuredClone(product), id: "finance-qa-sold", name: "已售账本验收件" }, { type: "bracelet", acquisitionCost: 1850 });
const listed = H.listItemForPlayer(player, { type: "bracelet", itemId: "finance-qa-sold", price: 2400 });
assert.equal(listed.ok, true, listed.message);
const trade = H.buyListingForPlayer(customer, H.state.listings.find(row => row.item.id === "finance-qa-sold").id);
assert.equal(trade.ok, true, trade.message);
player.externalMaterials.goldPure = 8;
player.externalMaterials.silver925 = 15;
player.workshopDeliveries.push({ id: "ux-opening-delivery", stage: "opening", inputName: "购入原石", completedAt: Date.now(), revealedAt: null,
  items: [{ ...structuredClone(opened), id: "ux-opening-result", name: "切涨明料", value: 6000, costBasis: { amount: 4000, complete: true } }], auxiliaryItems: [],
  scratchReveal: { version: 1, itemIds: ["ux-opening-result"], revealedItemIds: [] } });
H.refreshPlayerReport(player);
const session = { playerId: player.id, resumeToken: H.playerSessions.issueSession(player) };
const visitorSession = { playerId: customer.id, resumeToken: H.playerSessions.issueSession(customer) };
const temporary = mkdtempSync(path.join(tmpdir(), "jade-planning-finance-"));
const seedPath = path.join(temporary, "seed.json");
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
const directory = path.resolve(".tmp/workshop-market-ux");
mkdirSync(directory, { recursive: true });
const port = 48000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
try { await fetch(origin); throw new Error("QA port occupied"); }
catch (error) { if (error.message === "QA port occupied") throw error; }
let browser, server, visitorSocket, output = "";
const errors = [], checks = [], screenshots = [];
try {
  server = spawn(process.execPath, ["server.js"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
    HOST: "127.0.0.1", PORT: String(port), PUBLIC_ORIGIN: "", JADE_WORLD_PERSIST: "1",
    JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_SQLITE_PATH: path.join(temporary, "world.sqlite"),
    JADE_WORLD_PATH: seedPath } });
  server.stdout.on("data", data => { output += data; });
  server.stderr.on("data", data => { output += data; });
  const deadline = Date.now() + 15000;
  while (true) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) break; } catch {}
    if (Date.now() > deadline || server.exitCode != null) throw new Error(`QA server failed: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
  await context.addInitScript((value) => {
    localStorage.setItem("jade-player-session-v1", JSON.stringify(value));
    let ioFactory;
    Object.defineProperty(window, "io", { configurable: true, get: () => ioFactory, set(factory) {
      ioFactory = new Proxy(factory, { apply(target, receiver, args) {
        const socket = Reflect.apply(target, receiver, args);
        window.__uxSocket = socket;
        window.__uxToasts = [];
        socket.on('toast', value => window.__uxToasts.push(value));
        socket.on("state", state => { window.__planningFinanceState = state; });
        socket.on("state:patch", patch => {
          if (window.__planningFinanceState) Object.assign(window.__planningFinanceState, patch.changes || {});
        });
        return socket;
      } });
    } });
  }, session);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(180);
    const file = `${name}.png`;
    await page.screenshot({ path: path.join(directory, file), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `${name}: horizontal page overflow`);
    screenshots.push(file);
  };
  const go = async (view) => { await page.locator(`#mainNav [data-nav-view="${view}"]`).click(); };
  async function openPlanner(itemId, client = page) {
    await client.locator('#mainNav [data-nav-view="workshop"]').click();
    const back = client.locator('[data-action="backWorkshopDevices"]');
    if (await back.isVisible()) await back.click();
    await client.locator("#workshopStepTab-plan").click();
    await client.locator(`[data-action="openWorkshopDevice"][data-payload="${player.id}-carving"]`).click();
    await client.locator('.ws-big-material[data-action="openWorkshopPicker"]').click();
    await client.locator(`[data-action="pickWorkshopItem"][data-payload="${itemId}"]`).click();
    await client.locator('[data-action="openWorkshopPlanner"]').click();
    await client.locator(".ws-planner-modal").waitFor();
  }
  await page.goto(origin);
  await page.waitForFunction(id => window.__planningFinanceState?.me?.id === id, player.id);
  await page.locator('#mainNav [data-nav-view="workshop"]').waitFor();
  await page.keyboard.press("Escape");

  await openPlanner("planning-qa-material-b");
  await page.locator('#ws-planner-root [data-opening-kit-choice="egg"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#ws-planner-root .kit:not(.extracted)').length === 1);
  const geometry = () => page.locator('.ws-planner-body').evaluate(el => {
    const board=el.querySelector('.jade-opening-board'), b=board.getBoundingClientRect(), p=el.getBoundingClientRect();
    return {bodyScroll:el.scrollHeight-el.clientHeight,boardInside:b.top>=p.top-1&&b.bottom<=p.bottom+1, boardWidth:b.width,boardHeight:b.height};
  });
  for (const [width,height] of [[1366,768],[360,640],[844,390],[768,1024]]) {
    await page.setViewportSize({width,height});
    await page.waitForTimeout(80);
    const layout=await geometry();
    assert.equal(layout.bodyScroll<=1,true,JSON.stringify(layout));
    assert.equal(layout.boardInside,true,JSON.stringify(layout));
    assert.ok(Math.abs(layout.boardWidth-layout.boardHeight)<2,JSON.stringify(layout));
    await shot(`planner-${width}x${height}`);
  }
  await page.setViewportSize({width:1366,height:768});
  const board = page.locator('#ws-planner-root .jade-opening-board');
  const center = await page.locator('#ws-planner-root .kit:not(.extracted)').evaluate(el=>{const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};});
  const b = await board.boundingBox();
  await page.mouse.move(center.x,center.y);await page.mouse.down();
  await page.mouse.move(b.x+8,b.y+8,{steps:8});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('[data-planner-action="confirm"]')?.disabled);
  assert.match(await page.locator('.planner-validation-error').innerText(),/边缘/);
  assert.equal(await page.locator('#ws-planner-root .kit:not(.extracted) .kit-wire > *').first().getAttribute('stroke'),'#ff4636');
  await shot('planner-outside');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(()=>!document.querySelector('[data-planner-action="confirm"]')?.disabled);
  await page.locator('[data-planner-action="confirm"]').click();
  await go('inventory');
  await page.locator('[data-action="inspectInventoryItem"][data-payload="finance-qa-product"]').click();
  await page.locator('.inventory-detail-modal').waitFor();
  assert.ok((await page.locator('.inventory-detail-preview').boundingBox()).height>=250);
  await shot('item-detail-large');
  await page.keyboard.press('Escape');
  await page.evaluate(async()=> (await import('/features/inventory-helpers.js')).inspectInventoryItem('external:goldPure'));
  assert.match(await page.locator('.inventory-detail-preview image').getAttribute('href'),/gold-pure-handpainted/);
  await shot('inventory-gold-icon');
  await page.keyboard.press('Escape');
  await go('blackmarket');
  await page.locator('[data-bm-section="mine"]').click();
  await page.locator('#bmGrid [data-action="openBmOpenModal"]').click();
  await page.locator('#bmOpenTitle').fill('即时刷新验收摊');
  await page.locator('[data-action="confirmBmOpenStall"]').click();
  await page.locator('#bmListModal:not([hidden])').waitFor();
  await page.locator('#bmListModal [data-action="bmToggleListItem"][data-payload="finance-qa-product"]').click();
  await page.locator('#bmMlPrice').fill('1000');
  await page.locator('#bmListModal [data-action="bmToggleListItem"][data-payload="finance-qa-legacy"]').click();
  await page.locator('#bmConfirmListBtn').click();
  await page.locator('#bmListModal').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#bmGrid')?.textContent.includes('货架 2/'));
  await page.locator('#bmGrid [data-action="bmTogglePause"]').click();
  await page.waitForFunction(()=>document.querySelector('#bmGrid')?.textContent.includes('休摊中'));
  await page.locator('#bmGrid [data-action="bmTogglePause"]').click();
  await page.waitForFunction(()=>document.querySelector('#bmGrid')?.textContent.includes('营业中'));
  await shot('blackmarket-live-stall');
  const state = await page.evaluate(()=>window.__planningFinanceState);
  const mine=state.blackStalls.find(x=>x.isMine);
  visitorSocket=io(origin,{auth:visitorSession,transports:['websocket'],autoConnect:false,extraHeaders:{Origin:origin}});
  const visitorReady=once(visitorSocket,'state');
  visitorSocket.connect();
  await visitorReady;
  visitorSocket.emit('bmVisitStall',{stallId:mine.id,requestId:`ux-visit-${Date.now()}`});
  await page.waitForFunction(()=>document.querySelector('#bmGrid')?.textContent.includes('浏览 1'));
  const buyId=mine.items.find(row=>row.item.id==='finance-qa-legacy').id;
  visitorSocket.emit('bmBuyListing',{stallId:mine.id,listingId:buyId,requestId:`ux-buy-${Date.now()}`});
  await page.waitForFunction(()=>document.querySelector('#bmGrid')?.textContent.includes('货架 1/'));
  await page.waitForFunction(()=>window.__uxToasts.some(value=>String(value?.text||value).includes('黑市售出旧藏成本待核平安扣')&&String(value?.text||value).includes('成交金额')));
  await page.locator('#bmGrid [data-action="bmWithdraw"]').click();
  await page.locator('#bmWithdrawConfirmModal [data-action="confirmBmWithdraw"]').click();
  await page.waitForFunction(()=>document.querySelector('#bmMineCnt')?.textContent==='0');
  await page.locator('[data-action="openBmOpenModal"]').filter({visible:true}).first().click();
  await page.locator('[data-action="confirmBmOpenStall"]').click();
  await page.locator('#bmListModal:not([hidden])').waitFor();
  await page.locator('#bmListModal [data-action="bmToggleListItem"][data-payload="finance-qa-product"]').click();
  await page.locator('#bmConfirmListBtn').click();
  await page.waitForFunction(()=>document.querySelector('#bmGrid')?.textContent.includes('货架 1/'));
  await page.locator('#bmGrid [data-action="bmCloseStall"]').click();
  await page.waitForFunction(()=>document.querySelector('#bmGrid')?.textContent.includes('开设摊位'));
  await page.evaluate(()=>window.__uxSocket.emit('listItem',{type:'bracelet',itemId:'finance-qa-product',price:1800}));
  await page.waitForFunction(()=>window.__planningFinanceState.listings.some(row=>row.item.id==='finance-qa-product'));
  const marketId=await page.evaluate(()=>window.__planningFinanceState.listings.find(row=>row.item.id==='finance-qa-product').id);
  visitorSocket.emit('buyListing',{listingId:marketId,requestId:`ux-market-${Date.now()}`});
  await page.waitForFunction(()=>window.__uxToasts.some(value=>String(value?.text||value).includes('交易行售出「经营验收平安扣」')&&String(value?.text||value).includes('1,800')));
  await go('workshop');
  await page.evaluate(()=>{document.querySelector('[data-action="openWorkshopDelivery"][data-payload="ux-opening-delivery"]')?.click();});
  await page.locator('[data-delivery-box]').click();
  await page.locator('[data-delivery-reveal-all]').click();
  await page.waitForFunction(()=>document.querySelector('.delivery-reveal-summary .opening-result')?.textContent.includes('切涨了'));
  assert.match(await page.locator('.delivery-reveal-summary .opening-result').innerText(),/4,000|4，000|4千/);
  await shot('opening-profit-reveal');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,screenshots,checks:['responsive planner','pointer boundary feedback and blocked commit','undo and commit','large details','painted inventory metals','stall open/list/pause/resume/withdraw/close','visitor count','blackmarket and trading sale notifications','opening profit reveal']}));
} catch(error) { console.error(JSON.stringify({errors,output})); throw error;
} finally {
  visitorSocket?.disconnect();
  await browser?.close();
  if(server?.exitCode===null) {server.kill();await once(server,'exit');}
}
