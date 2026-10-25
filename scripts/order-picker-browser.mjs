import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { chromium } from "playwright";

// Exercise the actual modules and shared styles without booting a game or loading a save.
const products = [
  ["fit-white", "糯种青白水滴挂件", 4980, "glutinous", "糯种", "青白", "L"],
  ["fit-green", "糯种晴绿水滴挂件", 5260, "glutinous", "糯种", "阳绿", "L"],
  ["fit-ice", "冰种青白水滴挂件", 5480, "ice", "冰种", "青白", "L"],
  ["partial", "糯种青绿水滴挂件", 5880, "glutinous", "糯种", "阳绿", "L"],
  ["rejected", "糯种青白蛋面戒指", 3680, "glutinous", "糯种", "青白", "M"]
].map(([id, name, value, qualityKey, quality, color, size], index) => {
  const kind = id === "rejected" ? "cabochon" : "dropPendant";
  const ring = kind === "cabochon";
  const sourceMaterial = { roughId: `${id}-rough`, openingSeed: 32198, visual: { seed: 32198 }, qualityKey, quality, color,
    placement: { id: `${id}-kit`, openingTpl: ring ? "egg" : "drop", x: 300, y: 300, rot: 0, scale: .7, size, svgSpace: true } };
  return { id, name, type: "bracelet", materialStage: "finished", kind, size, value, qualityKey, quality, color, score: 4,
    seen: index !== 0, sourceMaterial, productType: ring ? "ring" : "pendant",
    inlay: { productTypeName: ring ? "戒指" : "吊坠", settingName: ring ? "爪镶" : "包镶", metalName: "18K金", polishName: "柔光", polishId: "soft" },
    components: [{ type: "jade", kind, sourceMaterial, polishId: "soft" }, { type: "mount", productType: ring ? "ring" : "pendant", metalId: "gold18k", settingId: ring ? "claw" : "bezel" }] };
});
const order = { id: "picker-order", client: "体面长辈", pay: 5625, rep: 11, quantity: 1,
  hard: { kind: "dropPendant", kindLabel: "水滴挂件", sizeBand: "L", budgetMax: 5625, minValue: 4500 }, requirements: [], persona: { personality: "大方" } };
const state = { me: { id: "picker-test", cash: 20000, rep: 8, rough: [], materials: [], slices: [], bracelets: products,
  collection: [], orders: [order, { ...order, id: "bundle-order", quantity: 2 }], satisfaction: 80, ledger: [] } };
const fixture = `<!doctype html><html lang="zh-CN" data-theme="day"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/styles.css"><style>body{height:auto;overflow:auto}.shell{display:block;height:auto;min-height:100dvh;overflow:visible;padding:24px}.fixture-open{margin-bottom:18px}#ordersList{max-width:1344px}@media(max-width:600px){.shell{padding:12px}}</style></head><body>
  <main class="shell"><button class="fixture-open" data-action="openOrderProductPicker" data-payload="picker-order" data-slot="0">选择交付成品</button><div id="ordersList" class="card-grid"></div><section id="affairsFixture" hidden style="width:300px;max-width:100%;margin-top:20px"><div class="panel-tabs" id="panelTabs"><button data-ptab="order">订单</button></div><div class="panel-body" id="sidePanelBody"></div></section></main><div id="modalRoot" class="modal-root" hidden></div>
  <script type="module">
    import * as helpers from '/features/inventory-helpers.js';
    import * as opening from '/features/opening/opening-render.js';
    import * as format from '/shell/format-utils.js';
    import * as rules from '/jade-rules.js';
    import * as modal from '/shell/game-modal.js';
    import {initInventoryModule} from '/inventory-module.js';
    import {initOrdersModule,renderOrders,focusOrdersForProduct} from '/orders-module.js';
    import {bindSidePanelDeps,renderSidePanel,setSidePanelFilter} from '/features/hud/side-panel.js';
    const state=${JSON.stringify(state)};
    const actions=new Map(),events=[];
    const socket={emit(...args){events.push(args)}};
    const getState=()=>state;
    const els={orders:document.getElementById('ordersList'),modalRoot:document.getElementById('modalRoot'),shell:document.querySelector('.shell'),sidePanelBody:document.getElementById('sidePanelBody'),panelTabs:document.getElementById('panelTabs')};
    helpers.bindInventoryHelperDeps({getState,getSocket:()=>socket,kitsFor:()=>[]});
    opening.bindOpeningRenderDeps({getState,materialStageForClient:helpers.materialStageForClient});
    modal.bindGameModalDeps({getEls:()=>els,getState,getSocket:()=>socket});
    initOrdersModule({getState,els,socket,getActiveView:()=> 'orders',registerAction:(name,handler)=>actions.set(name,handler),helpers:{...format,...helpers,...opening,...modal,...rules,button:()=>'',viewButton:()=>'',empty:()=>'',routeRecommendation:()=>'',liveSaleRange:()=>'',showToast:(message)=>events.push(['toast',message])}});
    bindSidePanelDeps({getState,getEls:()=>els,matchingBracelets:helpers.matchingBracelets});
    setSidePanelFilter('order');
    document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target)actions.get(target.dataset.action)?.({target,payload:target.dataset.payload});if(event.target.closest('[data-modal-close]'))modal.closeGameModal()});
    renderOrders();
    window.pickerFixture={state,events,renderOrders,renderSidePanel,focusOrdersForProduct,inspect(id){
      initInventoryModule({getState,els,socket,helpers:{...format,...helpers,...opening,...modal,kitsFor:()=>[]}});
      helpers.inspectInventoryItem(id);
    },open(id='picker-order',slot='0'){actions.get('openOrderProductPicker')({payload:id,target:{dataset:{slot}}})}};
  </script></body></html>`;
const app = express();
app.get("/order-picker-fixture", (_request, response) => response.type("html").send(fixture));
app.use("/shared", express.static(path.resolve("shared")));
app.use(express.static(path.resolve("public")));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const output = path.resolve(".tmp/order-picker-ui");
await mkdir(output, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "chrome" } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/order-picker-fixture`);
  await page.waitForFunction(() => Boolean(window.pickerFixture));
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.fixture-open').click();
  const overlay = page.locator('.modal-overlay').filter({ has: page.locator('.order-pick-modal, .order-pick-detail-modal') });
  const picker = overlay.locator('[role="dialog"]');
  const cards = picker.locator('.order-pick-card');
  const inspect = id => picker.locator(`[data-action="inspectOrderPickProduct"][data-product-id="${id}"]`);
  const select = id => picker.locator(`[data-action="pickOrderProductOption"][data-product-id="${id}"]`);
  const confirm = () => picker.locator('[data-action="confirmOrderProductPick"]');
  const open = async (id = "picker-order", slot = "0") => { await page.evaluate(([id, slot]) => window.pickerFixture.open(id, slot), [id, slot]); await picker.waitFor({ state: "visible" }); };
  assert.equal(await picker.locator('[data-order-pick-tier]').inputValue(), "full");
  assert.equal(await cards.count(), 3);
  assert.equal(await cards.locator('.tier-full').count(), 3);
  const initialText = await picker.innerText();
  for (const removed of ["体面长辈的订单", "点击图片或名称查看详情", "查看详情 ↗", "清除选择"]) assert.ok(!initialText.includes(removed));
  assert.equal((await picker.locator('.order-pick-foot').innerText()).replace(/\s+/g, ''), "取消确认选择");
  const baseline = await picker.locator('.order-pick-requirements > span').evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().top));
  assert.ok(Math.max(...baseline) - Math.min(...baseline) <= 1, "Requirements share one baseline");
  await page.waitForFunction(() => [...document.querySelectorAll('.order-pick-card .lazy-preview')].every(el => !el.classList.contains('is-pending')));
  const artBounds = await cards.locator('.inventory-slot-visual').evaluateAll(nodes => nodes.map(el => {
    const frame = el.getBoundingClientRect(), visual = el.querySelector('svg,canvas,img').getBoundingClientRect();
    return { frameTop: frame.top, frameBottom: frame.bottom, visualTop: visual.top, visualBottom: visual.bottom };
  }));
  for (const art of artBounds) assert.ok(art.visualTop >= art.frameTop - 1 && art.visualBottom <= art.frameBottom + 1, 'Card artwork fits its preview');
  await picker.screenshot({ path: path.join(output, "picker-desktop.png") });

  await picker.locator('[data-order-pick-sort]').selectOption('valueDesc');
  await picker.locator('[data-order-pick-search]').fill('水滴');
  await inspect('fit-green').click();
  assert.equal(await picker.locator('.inventory-detail-summary').count(), 1);
  assert.equal(await picker.locator('.inventory-detail-analysis').count(), 1);
  assert.equal(await picker.locator('.inventory-detail-footer').count(), 0, "No final-product explanation footer");
  assert.ok(!(await picker.locator('.game-modal-body').innerText()).includes('最终成品：'));
  const orderDetailText = (await picker.locator('.inventory-detail-document').innerText()).replace(/\s+/g, '');
  await picker.screenshot({ path: path.join(output, "detail-desktop.png") });
  await page.keyboard.press('Escape');
  assert.equal(await picker.locator('[data-order-pick-tier]').inputValue(), 'full');
  assert.equal(await picker.locator('[data-order-pick-sort]').inputValue(), 'valueDesc');
  assert.equal(await picker.locator('[data-order-pick-search]').inputValue(), '水滴');
  assert.ok(await inspect('fit-green').evaluate(el => el === document.activeElement));
  await inspect('fit-green').click();
  await select('fit-green').click();
  assert.equal(await select('fit-green').getAttribute('aria-pressed'), 'true');
  await confirm().click();
  await overlay.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-order-select="picker-order"]').inputValue(), 'fit-green');
  assert.ok(!await page.evaluate(() => window.pickerFixture.events.some(([event]) => event === 'completeOrder')));

  await open();
  await select('fit-white').click();
  await picker.getByRole('button', { name: '取消', exact: true }).click();
  await open();
  assert.equal(await select('fit-green').getAttribute('aria-pressed'), 'true', "Cancel preserves the confirmed selection");
  await select('fit-green').click();
  assert.ok(await confirm().isDisabled());
  await select('fit-white').click();
  assert.ok(!await confirm().isDisabled());
  await picker.locator('[data-order-pick-tier]').selectOption('partial');
  assert.equal(await cards.count(), 1);
  await inspect('partial').click();
  await page.keyboard.press('Tab');
  assert.ok(await picker.evaluate(el => el.contains(document.activeElement)));
  await picker.getByRole('button', { name: '返回列表', exact: true }).click();
  assert.equal(await picker.locator('[data-order-pick-tier]').inputValue(), 'partial');
  await picker.locator('[data-order-pick-tier]').selectOption('hard_fail');
  assert.equal(await cards.count(), 1);
  await picker.locator('[data-order-pick-search]').fill('没有此成品');
  assert.equal(await cards.count(), 0);
  await picker.getByRole('button', { name: '查看全部成品', exact: true }).click();
  assert.equal(await cards.count(), 5);
  assert.equal(await picker.locator('[data-order-pick-search]').inputValue(), '');
  await picker.getByRole('button', { name: '取消', exact: true }).click();

  await page.evaluate(() => { const s = window.pickerFixture.state; s.me.bracelets = s.me.bracelets.filter(p => ['partial', 'rejected'].includes(p.id)); });
  await open();
  assert.equal(await cards.count(), 0);
  assert.equal(await picker.locator('[data-order-pick-tier]').inputValue(), 'full');
  assert.ok((await picker.innerText()).includes('暂无完全符合的成品'));
  assert.ok(await confirm().isDisabled());
  await picker.getByRole('button', { name: '查看全部成品', exact: true }).click();
  assert.equal(await cards.count(), 2);
  await picker.screenshot({ path: path.join(output, "picker-no-full.png") });
  await picker.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(products => { window.pickerFixture.state.me.bracelets = products; }, products);
  await open('bundle-order', '1');
  await select('fit-ice').click();
  await confirm().click();
  assert.equal(await page.locator('[data-order-select="bundle-order"][data-slot="0"]').inputValue(), 'fit-white');
  assert.equal(await page.locator('[data-order-select="bundle-order"][data-slot="1"]').inputValue(), 'fit-ice');

  const layouts = [];
  for (const [name, width, height, theme] of [['mobile', 390, 844, 'day'], ['narrow-night', 320, 640, 'night'], ['short', 900, 500, 'day']]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await open();
    const check = async stage => {
      const report = await picker.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const body = el.querySelector('.order-pick-body, .game-modal-body');
        const foot = el.querySelector('.order-pick-foot, .game-modal-actions').getBoundingClientRect();
        return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom, footerBottom: foot.bottom, overflow: el.scrollWidth > el.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1 };
      });
      assert.equal(report.overflow, false, `${name}/${stage} has no horizontal overflow`);
      assert.ok(report.top >= 0 && report.bottom <= height + 1, `${name}/${stage} fits viewport`);
      assert.ok(report.footerBottom <= height, `${name}/${stage} keeps actions visible`);
      layouts.push({ name, stage, ...report });
      await picker.screenshot({ path: path.join(output, `${name}-${stage}.png`) });
    };
    await check('picker');
    await inspect('fit-green').click();
    await check('detail');
    assert.equal(await picker.locator('.inventory-detail-footer').count(), 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => { window.pickerFixture.focusOrdersForProduct('partial'); });
  assert.equal(await picker.locator('[data-order-pick-tier]').inputValue(), 'partial');
  assert.equal(await select('partial').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.pickerFixture.inspect('fit-green'));
  const stock = page.locator('#modalRoot .inventory-detail-document');
  const stockText = await stock.evaluate(el => { const clone = el.cloneNode(true); clone.querySelector('.inventory-detail-footer')?.remove(); return clone.innerText || clone.textContent; });
  assert.equal(stockText.replace(/\s+/g, ''), orderDetailText, "Order detail matches the live inventory component except the removed explanation footer");
  await page.keyboard.press('Escape');

  const demandOrders = [
    { ...order, id: 'demand-main', requirements: [{ type: 'minScore', minScore: 2, label: '种水：糯种及以上' }] },
    { ...order, id: 'demand-plaque', client: '阔太太', pay: 23811, rep: 8,
      hard: { kind: 'plainPlaque', kindLabel: '无字牌', sizeBand: 'L', budgetMax: 23811, minValue: 19049 }, requirements: [] },
    { ...order, id: 'demand-color', client: '热心街坊', pay: 5742, rep: 8, persona: { personality: '宽和' },
      hard: { ...order.hard, sizeBand: 'M', budgetMax: 5742, minValue: 4594 },
      requirements: [{ type: 'requireBrightColor', label: '色泽：要明艳正色' }, { type: 'forbidCrack', label: '净度：无纹。' }] },
    { ...order, id: 'demand-unlimited', client: '喜欢素雅镶嵌的老熟客', pay: 21243, rep: 8, persona: { personality: '宽和' },
      hard: { kind: 'leafPendant', kindLabel: '叶子挂件', budgetUnlimited: true, minValue: 16995 },
      requirements: [{ type: 'requireMetal', metalId: 'gold18k', label: '镶嵌金属18K金' }, { type: 'requireSetting', settingId: 'bezel', label: '镶法包镶' }] }
  ];
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.evaluate(orders => { const f = window.pickerFixture; f.state.me.orders = orders; f.state.me.bracelets = []; document.documentElement.dataset.theme = 'day'; f.renderOrders(); }, demandOrders);
  const mainCard = page.locator('[data-order-card="demand-main"]');
  assert.equal(await mainCard.locator('.order-demand-row').count(), 2);
  assert.equal((await mainCard.locator('.order-hero-main').innerText()).replace(/\s+/g, ' '), '水滴挂件 × 1 件');
  assert.equal(await mainCard.locator('.order-demand-row').nth(0).locator('dd').innerText(), '糯种及以上');
  assert.equal(await page.locator('[data-order-card="demand-unlimited"] .order-budget strong').innerText(), '不限');
  assert.doesNotMatch(await page.locator('#ordersList').innerText(), /最低货值|单件货值|满额报价|库存匹配/);
  const extraValues = await page.locator('[data-order-card="demand-unlimited"] .order-demand-target').allTextContents();
  assert.ok(extraValues.includes('18K金') && extraValues.includes('包镶'));
  const colorValues = await page.locator('[data-order-card="demand-color"] .order-demand-target').allTextContents();
  assert.ok(colorValues.includes('要明艳正色') && colorValues.includes('无纹'));
  const orderCardLayouts = [];
  const inspectOrderCards = async name => {
    const report = await page.locator('#ordersList').evaluate(list => ({
      overflow: list.scrollWidth > list.clientWidth + 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      cards: [...list.querySelectorAll('.order-card')].map(card => {
        const title = card.querySelector('.order-card-heading').getBoundingClientRect();
        const demand = card.querySelector('.order-demand').getBoundingClientRect();
        const meta = card.querySelector('.order-card-meta').getBoundingClientRect();
        const bounds = card.getBoundingClientRect();
        const actionBounds = card.querySelector('.order-card-actions').getBoundingClientRect();
        return { width: bounds.width, height: bounds.height, top: bounds.top, actionBottom: actionBounds.bottom,
          titleFirst: title.bottom <= demand.top && demand.bottom <= meta.top,
          overflow: card.scrollWidth > card.clientWidth + 1,
          actions: [...card.querySelectorAll('.order-card-actions button')].map(button => {
            const s = getComputedStyle(button), label = button.querySelector('.order-picker-label');
            const foreground = label ? getComputedStyle(label).color : s.color;
            const luminance = rgb => { const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
            const a = luminance(foreground), b = luminance(s.backgroundColor);
            return { text: button.innerText, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
          }),
          typography: [...card.querySelectorAll('*')]
            .filter(el => el.getClientRects().length && [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
            .map(el => ({
              text: el.textContent.trim(),
              fontSize: parseFloat(getComputedStyle(el).fontSize),
              // list-density.css defines 16px titles, 12px quantities and 13px body text.
              minFontSize: el.matches('.order-quantity') ? 12 : el.matches('.order-hero-main') ? 16 : 13
            })) };
      })
    }));
    assert.equal(report.overflow, false, `${name}: order grid fits`);
    assert.equal(report.pageOverflow, false, `${name}: page fits`);
    for (const card of report.cards) {
      assert.equal(card.titleFirst, true, `${name}: product title precedes requirements and customer`);
      assert.equal(card.overflow, false, `${name}: card fits`);
      assert.ok(card.typography.length > 0, `${name}: order text is present`);
      for (const text of card.typography) {
        assert.ok(text.fontSize >= text.minFontSize, `${name}: readable order text ${JSON.stringify(text)}`);
      }
      for (const action of card.actions) assert.ok(action.text.trim() && action.contrast >= 4.5, `${name}: readable button label ${JSON.stringify(action)}`);
    }
    const heights = report.cards.map(card => card.height);
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `${name}: cards have equal height`);
    for (const card of report.cards) {
      const row = report.cards.filter(other => Math.abs(other.top - card.top) <= 1);
      assert.ok(Math.max(...row.map(other => other.actionBottom)) - Math.min(...row.map(other => other.actionBottom)) <= 1, `${name}: actions align across a row`);
    }
    orderCardLayouts.push({ name, ...report });
    await page.locator('#ordersList').screenshot({ path: path.join(output, `orders-${name}.png`) });
  };
  await inspectOrderCards('desktop-waiting');
  for (const [name, width, theme] of [['mobile', 390, 'day'], ['narrow-night', 320, 'night']]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await inspectOrderCards(name);
  }
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.evaluate(products => { const f = window.pickerFixture; f.state.me.bracelets = products; document.documentElement.dataset.theme = 'day'; f.renderOrders(); }, products);
  assert.equal(await mainCard.locator('.order-demand-actual.is-pass').count(), 2);
  assert.equal(await mainCard.locator('.order-persona summary, .order-persona-chevron, [data-order-notes]').count(), 0);
  assert.equal(await mainCard.locator('.order-care').count(), 0);
  await inspectOrderCards('selected');
  await open('demand-main');
  await picker.locator('[data-order-pick-tier]').selectOption('partial');
  await select('partial').click();
  await confirm().click();
  assert.match(await mainCard.locator('.order-fit-feedback').innerText(), /略超预算/);
  assert.equal(await mainCard.locator('[data-action="completeOrder"]').innerText(), '折价交付');
  await mainCard.screenshot({ path: path.join(output, 'order-partial.png') });
  await mainCard.locator('[data-action="completeOrder"]').click();
  assert.equal(await page.locator('#orderMismatchTitle').innerText(), '订单不完全符合');
  await page.keyboard.press('Escape');
  await open('demand-main');
  await picker.locator('[data-order-pick-tier]').selectOption('hard_fail');
  await select('rejected').click();
  await confirm().click();
  assert.equal(await mainCard.locator('.order-demand-actual.is-fail').count(), 2);
  assert.equal(await mainCard.locator('[data-action="completeOrder"]').count(), 0);
  assert.equal(await mainCard.getByRole('button', { name: '重新选择成品', exact: true }).count(), 1);
  for (const [name, width, theme] of [['rejected', 1600, 'day'], ['rejected-narrow', 320, 'night']]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await inspectOrderCards(name);
  }
  await page.evaluate(() => document.getElementById('ordersList').style.maxWidth = '216px');
  await inspectOrderCards('sidebar-narrow');
  await page.evaluate(() => document.getElementById('ordersList').style.maxWidth = '');
  await open('demand-main');
  await select('fit-white').click();
  await confirm().click();
  await mainCard.locator('[data-action="completeOrder"]').click();
  assert.equal(await page.locator('#orderMismatchTitle').innerText(), '确认交付');
  await page.locator('.order-mismatch-modal .modal-confirm').click();
  const delivery = await page.evaluate(() => window.pickerFixture.events.find(([event]) => event === 'completeOrder'));
  assert.deepEqual(delivery, ['completeOrder', { orderId: 'demand-main', braceletIds: ['fit-white'] }]);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.evaluate(() => { const f = window.pickerFixture; f.state.me.orders.push({ ...f.state.me.orders[0], id: 'demand-bundle', quantity: 2 }); f.renderOrders(); });
  const bundle = page.locator('[data-order-card="demand-bundle"]');
  assert.equal(await bundle.locator('.order-quantity').innerText(), '× 2 件');
  assert.equal(await bundle.locator('.order-selects .order-picker').count(), 2);
  assert.equal(await bundle.locator('.order-demand-actual').count(), 0, 'Multiple products are not mislabeled as a single product comparison');
  assert.match(await bundle.innerText(), /单件预算/);
  assert.doesNotMatch(await bundle.innerText(), /单件货值/);
  await inspectOrderCards('multi-item');
  await page.evaluate(() => {
    window.pickerFixture.renderSidePanel();
    document.getElementById('affairsFixture').hidden = false;
  });
  assert.ok(await page.locator('[data-side-npc-order="demand-main"]').isVisible());
  assert.match(await page.locator('#panelTabs').innerText(), /订单\s*2/);
  assert.match(await page.locator('#sidePanelBody').innerText(), /库存已备齐/);
  await page.locator('#affairsFixture').screenshot({ path: path.join(output, 'orders-stock-ready.png') });
  const touchPage = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
  touchPage.on('pageerror', error => errors.push(error.message));
  await touchPage.goto(`http://127.0.0.1:${server.address().port}/order-picker-fixture`);
  await touchPage.waitForFunction(() => Boolean(window.pickerFixture));
  const touchTargets = await touchPage.locator('#ordersList :is(.order-picker-btn, .order-card-actions > button, summary)').evaluateAll(nodes => nodes.map(el => ({ height: el.getBoundingClientRect().height, label: el.innerText || el.getAttribute('aria-label') })));
  for (const target of touchTargets) assert.ok(target.height >= 44, `Touch target is usable: ${JSON.stringify(target)}`);
  await touchPage.close();
  assert.deepEqual(errors, []);
  const report = { defaultFull: true, cards: 3, sharedInventoryDetail: true, removedExplanationFooter: true, draftCancelAndConfirm: true, filtersAndBack: true, emptyFullState: true, multiItemSlots: true, productFirstCards: true, fullAndPartialDelivery: true, rejectedBlocked: true, touchTargets, orderCardLayouts, layouts, errors };
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
