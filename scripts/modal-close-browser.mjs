import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { chromium } from "playwright";

// Isolated UI regression: actual shared modal / inventory entry points, and
// production modal class families with the same headers and close attributes.
// No live game server, persistent world, or player saves are accessed.
const cases = [
  { id: "game", title: "提示与确认", actual: "game" },
  { id: "payroll", title: "上次登录日工资结算", actual: "payroll" },
  { id: "inventory", title: "冰种飘花明料", actual: "inventory" },
  { id: "auction", title: "公盘竞拍结算", actual: "game", dialog: "auction-settle-modal auction-settle-modal--regular" },
  { id: "payroll-info", title: "员工工资说明", actual: "payroll-info" },
  { id: "finish", title: "制定精加工方案", actual: "game", dialog: "finish-plan-modal" },
  { id: "inlay", title: "镶嵌预览测试", actual: "game", dialog: "inlay-preview-tester-modal" },
  { id: "mining", title: "会卡深层矿区详情", actual: "game", dialog: "mining-mine-dialog" },
  { id: "market", title: "确认买入", dialog: "jm-modal", root: "jm-modal-root", head: "jm-modal-head", button: "jm-modal-x", action: 'data-action="closeMarketModal"' },
  { id: "blackmarket", title: "黑市买入", dialog: "jm-modal jm-modal-buy", root: "jm-modal-root", rootId: "bmBuyModal", head: "jm-modal-head", button: "jm-modal-x", action: 'data-action="closeBmModal"' },
  { id: "blindbox", title: "盲盒货池管理", dialog: "jm-modal jm-modal-wide bm-blind-manage-modal", root: "jm-modal-root", head: "jm-modal-head", button: "jm-modal-x", nested: "bm-blind-manage-head-acts", action: 'data-action="closeBmBlindManage"' },
  { id: "live", title: "直播间补货", dialog: "jm-modal", root: "jm-modal-root", head: "jm-modal-head", button: "jm-modal-x", action: 'data-livestream-action="close-replenish-modal"' },
  { id: "shop", title: "购买镶嵌材料", dialog: "modal", root: "modal-overlay", rootId: "shopModal", head: "modal-head", button: "modal-close", absolute: true },
  { id: "order", title: "选择交付成品", dialog: "modal order-pick-modal", root: "modal-overlay", head: "modal-head", button: "modal-close", absolute: true },
  { id: "mismatch", title: "成品与订单要求不符", dialog: "modal order-mismatch-modal", root: "modal-overlay", head: "modal-head", button: "modal-close", absolute: true },
  { id: "recruit", title: "林师傅 · 员工完整详情", actual: "owned" },
  { id: "candidate", title: "候选工匠完整详情", actual: "candidate" },
  { id: "picker", title: "选择工匠", dialog: "ws-picker-modal step-open kind-worker", root: "ws-picker-overlay", head: "ws-picker-head", button: "ws-picker-close", action: 'data-action="closeWorkshopPicker"' },
  { id: "planner", title: "规划套件", dialog: "ws-planner-modal", root: "ws-picker-overlay", head: "ws-picker-head", button: "ws-picker-close", action: 'data-planner-action="cancel"' },
  { id: "delivery", title: "工坊交付 · 开料", dialog: "delivery-dialog", root: "workshop-delivery-root", head: "delivery-head", button: "modal-close", action: "data-delivery-close" },
  { id: "delivery-details", title: "加工产物详情", dialog: "delivery-detail-dialog", root: "delivery-detail-root", head: "delivery-detail-head", button: "modal-close", action: "data-detail-close" }
];
const material = { id: "close-detail", name: "冰种飘花明料", type: "material", materialStage: "opened", revealed: true,
  qualityKey: "ice", quality: "冰种", color: "飘花绿", value: 12500, openingSeed: 32198, visual: { seed: 32198 } };
const html = `<!doctype html><html lang="zh-CN" data-theme="day"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/styles.css"><style>
.shell{display:block;min-height:0;padding:24px}.qa-openers{display:flex;flex-wrap:wrap;gap:8px}.qa-content{padding:18px;color:var(--muted);min-height:130px}.qa-content p{margin:0;line-height:1.7}.qa-sample-row{display:flex;justify-content:space-between;padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin-top:10px}.delivery-footer{position:static}.qa-absolute-content{min-height:180px}
</style></head><body><main class="shell"><h2>统一弹窗关闭按钮检查</h2><div class="qa-openers">${cases.map(entry => `<button type="button" data-open="${entry.id}">${entry.title}</button>`).join("")}</div></main><div id="modalRoot" class="modal-root" hidden></div><div id="familyRoot" hidden></div><script type="module">
import * as modal from '/shell/game-modal.js';
import { buildEmployeePayrollSettleModal } from '/shell/payroll-settle-modal.js';
import { activateModalLifecycle } from '/modal-lifecycle.js';
import { createDeliverySpotlightUi } from '/features/workshop/delivery-spotlight-ui.js';
import * as inventory from '/features/inventory-helpers.js';
import * as opening from '/features/opening/opening-render.js';
import { initInventoryModule } from '/inventory-module.js';
import * as hire from '/hire-module.js';
import * as format from '/shell/format-utils.js';
const cases=${JSON.stringify(cases)}, material=${JSON.stringify(material)};
const worker={id:'close-worker',name:'林师傅 · 翡翠精雕与镶嵌工匠',job:'finisher',tier:8,traits:['心细'],flaws:['易疲'],skills:{finish:{diaozhuo:{level:6,exp:230}}}};
const state={me:{cash:50000,materials:[material],rough:[],slices:[],bracelets:[],collection:[],externalMaterials:{},workshop:{workers:[worker],devices:[]},recruitCandidates:[{...worker,id:'close-candidate',price:35000}]}};
const shell=document.querySelector('.shell'), familyRoot=document.getElementById('familyRoot'), modalRoot=document.getElementById('modalRoot');
const socket={emit(...args){window.closeEvents.push(args)}};window.closeEvents=[];
const getState=()=>state;modal.bindGameModalDeps({getEls:()=>({modalRoot,shell}),getState,getSocket:()=>socket});
inventory.bindInventoryHelperDeps({getState,getSocket:()=>socket,kitsFor:()=>[]});opening.bindOpeningRenderDeps({getState,materialStageForClient:inventory.materialStageForClient});
initInventoryModule({getState,els:{modalRoot,shell},socket,helpers:{...format,...inventory,...opening,...modal,kitsFor:()=>[]}});
const actions=new Map();hire.initHireModule({getState,els:{},socket,getActiveView:()=>'',helpers:{...format,empty:()=>''},registerAction:(name,handler)=>actions.set(name,handler)});
let cleanup=null;
const closeFamily=()=>{cleanup?.();cleanup=null;familyRoot.hidden=true;familyRoot.innerHTML='';window.closeEvents.push(['familyClosed'])};
function open(entry){
  if(!modalRoot.hidden)modal.closeGameModal();if(!familyRoot.hidden)closeFamily();
  if(entry.actual){
    if(entry.actual==='inventory'){inventory.inspectInventoryItem(material.id);return;}
    if(entry.actual==='owned'){hire.openOwnedWorkerDetail(worker.id);return;}
    if(entry.actual==='candidate'){hire.openRecruitCandidateDetail('close-candidate');return;}
    if(entry.actual==='payroll-info'){actions.get('openEmployeePayrollInfo')();return;}
    if(entry.actual==='payroll'){
      const receipt={id:'close-fixture',billDay:Date.UTC(2026,9,22,16),at:Date.UTC(2026,9,23,16),accrued:1500,paid:1500,previousDebt:0,debt:0,cashAfter:17841,entries:[{workerName:'林师傅',dailyWage:590,amount:590}]};
      state.me.employeePayroll={pendingSettlement:receipt};modal.openGameModal(buildEmployeePayrollSettleModal(receipt));return;
    }
    modal.openGameModal({title:entry.title,subtitle:'统一关闭按钮 · 日夜主题',modalClass:entry.dialog||'',body:'关闭按钮使用统一的线条、留白及交互状态。',stats:[{label:'物品参考估值',value:'¥12,500'}],actions:[{label:'知道了'}]});return;
  }
  familyRoot.id=entry.rootId||'familyRoot';familyRoot.className=entry.root;familyRoot.hidden=false;
  const button='<button type="button" class="'+entry.button+'" '+(entry.action||'')+' data-qa-close aria-label="关闭弹窗">×</button>';
  const title=entry.head==='jm-modal-head'&&!entry.nested?'<h3>'+entry.title+'</h3>':'<div class="'+(entry.nested?'bm-profile-head-copy':'qa-title-wrap')+'"><h3>'+entry.title+'</h3><p>物品详情与操作说明</p></div>';
  const head='<header class="'+entry.head+'">'+title+(entry.absolute?'':entry.nested?'<div class="'+entry.nested+'"><span class="bm-blind-manage-status-chip">货池已补满</span><button class="jm-btn-ghost" type="button">预览买家所见</button>'+button+'</div>':button)+'</header>';
  const deliveryExtras=entry.id==='delivery'?'<div class="delivery-item-visual" style="height:40px"></div><div data-delivery-summary hidden></div><button type="button" data-delivery-return hidden>返回领取弹窗</button>':'';
  familyRoot.innerHTML='<section class="'+entry.dialog+'" role="dialog" aria-modal="true" aria-label="'+entry.title+'">'+(entry.absolute?button:'')+head+'<div class="qa-content"><p>确认物品与费用后，可继续经营。</p><div class="qa-sample-row"><span>参考估值</span><b>¥12,500</b></div>'+deliveryExtras+'</div><footer class="game-modal-actions '+(entry.id==='delivery'?'delivery-footer':'')+'"><button type="button" data-delivery-collect data-qa-close>知道了</button></footer></section>';
  cleanup=activateModalLifecycle({root:familyRoot,dialog:familyRoot.querySelector('[role=dialog]'),shell,onClose:closeFamily});
}
document.addEventListener('click',event=>{const opener=event.target.closest('[data-open]');if(opener)open(cases.find(entry=>entry.id===opener.dataset.open));if(event.target.closest('[data-modal-close]'))modal.closeGameModal();if(event.target.closest('[data-qa-close]'))closeFamily();const action=event.target.closest('[data-action]');if(action)actions.get(action.dataset.action)?.({payload:action.dataset.payload,target:action,event});});
window.openCloseFixture=id=>open(cases.find(entry=>entry.id===id));window.closeCloseFixture=()=>{if(!modalRoot.hidden)modal.closeGameModal();if(!familyRoot.hidden)closeFamily()};
window.openExplicitFocusFixture=()=>modal.openGameModal({title:'显式输入焦点',html:'<input data-modal-initial-focus aria-label="输入名称" />',actions:[{label:'知道了'}]});
window.openStackFixture=()=>{
  modal.openGameModal({title:'底层弹窗',actions:[{label:'继续'}]});
  const anchor=modalRoot.querySelector('.game-modal-actions button');anchor.setAttribute('data-stack-opener','');anchor.focus({preventScroll:true});
  const nested=document.createElement('div');nested.className='modal-root';nested.innerHTML='<section class="game-modal" role="dialog" aria-modal="true" aria-label="上层弹窗"><header class="game-modal-head"><h3>上层弹窗</h3><button type="button" class="modal-close" aria-label="关闭上层弹窗">×</button></header><div class="game-modal-body"><p>检查嵌套弹窗焦点返回。</p></div><footer class="game-modal-actions"><button type="button">完成</button></footer></section>';document.body.append(nested);
  let deactivate=()=>{};const close=()=>{deactivate();nested.remove()};nested.querySelectorAll('button').forEach(button=>button.addEventListener('click',close));
  deactivate=activateModalLifecycle({root:nested,dialog:nested.querySelector('[role=dialog]'),shell,onClose:close});
};
window.deliveryCloseTransitions=async()=>{
  const root=familyRoot, q=selector=>root.querySelector(selector);root.classList.add('is-scratch-spotlight');
  const session={root,q,delivery:{items:[{}]},scratch:{enable(){},layout(){}},details:{summary:()=>'<p>开料分析</p>'}};
  const spotlight=createDeliverySpotlightUi({session,animate:async()=>{},isActive:()=>true,onDialog(){}});
  spotlight.prepare();const skip=q('[data-delivery-close]');
  const prepared={className:skip.className,text:skip.textContent,fontSize:getComputedStyle(skip).fontSize,mask:getComputedStyle(skip,'::before').maskImage};
  spotlight.sync(false,false);const hidden=q('[data-delivery-close]').hidden,hiddenDisplay=getComputedStyle(q('[data-delivery-close]')).display;
  await spotlight.returnToDialog();spotlight.dispose();root.classList.remove('is-scratch-spotlight','is-scratch-review');
  return {prepared,hidden,hiddenDisplay,restored:{className:skip.className,text:skip.textContent,hidden:skip.hidden,fontSize:getComputedStyle(skip).fontSize,mask:getComputedStyle(skip,'::before').maskImage}};
};
window.closeReady=true;
</script></body></html>`;
const app = express();app.get('/modal-close-fixture',(_req,res)=>res.type('html').send(html));app.use('/shared',express.static(path.resolve('shared')));app.use(express.static(path.resolve('public')));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const output=path.resolve('.tmp/modal-close-browser');await mkdir(output,{recursive:true});
let browser;
const reports=[],stressReports=[],autoOpenReports=[],errors=[],consoleErrors=[];
const closeSelector='button.modal-close,button.jm-modal-x,button.ws-picker-close,button.recruit-detail-close';
function checkColor(value,label){assert.ok(value&&value!=='rgba(0, 0, 0, 0)',label);}
async function measure(button){return button.evaluate(element=>{
  const style=getComputedStyle(element),before=getComputedStyle(element,'::before'),rect=element.getBoundingClientRect();
  const dialog=element.closest('[role=dialog]'),dialogRect=dialog.getBoundingClientRect();
  const title=dialog.querySelector('h3,.wsp-pick-side-head strong');let overlap=false,titleLines=[];
  if(title){const range=document.createRange();range.selectNodeContents(title);titleLines=[...range.getClientRects()].map(line=>({left:line.left,right:line.right,top:line.top,bottom:line.bottom}));overlap=titleLines.some(line=>line.left<rect.right&&line.right>rect.left&&line.top<rect.bottom&&line.bottom>rect.top);}
  return {width:rect.width,height:rect.height,x:rect.x,y:rect.y,color:style.color,background:style.backgroundColor,border:style.borderWidth,radius:style.borderRadius,fontSize:style.fontSize,outline:style.outlineStyle,outlineWidth:style.outlineWidth,outlineColor:style.outlineColor,boxShadow:style.boxShadow,mask:before.maskImage,iconWidth:before.width,iconHeight:before.height,focused:document.activeElement===element,dialogFocused:document.activeElement===dialog,focusVisible:element.matches(':focus-visible'),visible:rect.width>0&&rect.height>0,titleLines,titleOverlap:overlap,inside:rect.left>=dialogRect.left-1&&rect.right<=dialogRect.right+1&&rect.top>=dialogRect.top-1&&rect.bottom<=dialogRect.bottom+1,overflow:document.documentElement.scrollWidth>innerWidth};
});}
try{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  // A fresh page has no pointer-input history. This is the real startup path
  // that previously treated the automatically focused close as keyboard focus.
  for(const viewport of [{width:1440,height:900},{width:390,height:844}])for(const theme of ['day','night']){
    const context=await browser.newContext({viewport,hasTouch:viewport.width<641,isMobile:viewport.width<641,reducedMotion:'reduce'});
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())});
    await page.goto(`http://127.0.0.1:${server.address().port}/modal-close-fixture`);await page.waitForFunction(()=>window.closeReady);await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.openCloseFixture('payroll')},theme);
    const dialog=page.locator('[role=dialog]:visible'),button=dialog.locator(closeSelector).first();
    const report=await measure(button);autoOpenReports.push({theme,viewport:viewport.width,...report});
    assert.equal(report.focused,false,'automatic popup must not select its close button');assert.equal(report.dialogFocused,true,'automatic popup keeps focus inside its neutral dialog');
    assert.equal(report.focusVisible,false);assert.equal(report.background,'rgba(0, 0, 0, 0)');assert.equal(report.outline,'none');
    await dialog.screenshot({path:path.join(output,`${theme}-${viewport.width}-auto-payroll.png`)});
    await page.keyboard.press('Tab');const keyboard=await measure(button);assert.equal(keyboard.focused,true);assert.equal(keyboard.focusVisible,true);assert.equal(keyboard.outlineWidth,'2px');assert.equal(keyboard.outline,'solid');
    await dialog.screenshot({path:path.join(output,`${theme}-${viewport.width}-auto-keyboard-focus.png`)});await page.keyboard.press('Enter');await dialog.waitFor({state:'hidden'});
    await page.evaluate(()=>window.openCloseFixture('payroll'));await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('[role=dialog]:visible .game-modal-actions button').last().evaluate(element=>document.activeElement===element),true,'Shift+Tab from neutral dialog wraps to the last control');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    await page.evaluate(()=>window.openExplicitFocusFixture());const input=page.getByRole('textbox',{name:'输入名称'});assert.equal(await input.evaluate(element=>document.activeElement===element),true,'explicit initial input focus remains authoritative');await input.fill('测试名称');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    await page.evaluate(()=>window.openStackFixture());const stacked=page.getByRole('dialog',{name:'上层弹窗',exact:true});assert.equal(await stacked.evaluate(element=>document.activeElement===element),true);const stackClose=stacked.locator(closeSelector);assert.equal((await measure(stackClose)).outline,'none');await page.keyboard.press('Tab');assert.equal(await stackClose.evaluate(element=>document.activeElement===element),true);await page.keyboard.press('Escape');await stacked.waitFor({state:'detached'});assert.equal(await page.locator('[data-stack-opener]').evaluate(element=>document.activeElement===element),true,'closing top layer returns focus to its actual underlying opener');await page.keyboard.press('Escape');
    await context.close();
  }
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:640}]){
    const context=await browser.newContext({viewport,hasTouch:viewport.width<641,isMobile:viewport.width<641,reducedMotion:'reduce'});
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())});
    await page.goto(`http://127.0.0.1:${server.address().port}/modal-close-fixture`);await page.waitForFunction(()=>window.closeReady);await page.evaluate(()=>document.fonts.ready);
    for(const theme of ['day','night']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      for(const entry of cases){
        const opener=page.locator(`[data-open="${entry.id}"]`);await opener.click();
        const dialog=page.locator('[role=dialog]:visible');await dialog.waitFor();
        const button=dialog.locator(closeSelector).first();await page.mouse.move(0,0);
        const report=await measure(button),expectedSize=viewport.width<641?44:36;
        assert.equal(report.width,expectedSize,`${entry.id}/${theme}/${viewport.width}: unified click width`);
        assert.equal(report.height,expectedSize,`${entry.id}/${theme}/${viewport.width}: unified click height`);
        assert.equal(report.border,'0px',`${entry.id}: no permanent border`);
        assert.equal(report.radius,'8px',`${entry.id}: shared corner radius`);
        assert.equal(report.fontSize,'0px',`${entry.id}: old glyph does not double with vector icon`);
        assert.match(report.mask,/svg|data:image/,`${entry.id}: uses the shared vector cross`);
        assert.equal(report.iconWidth,'16px');assert.equal(report.iconHeight,'16px');
        assert.equal(report.background,'rgba(0, 0, 0, 0)',`${entry.id}: transparent rest state`);
        assert.equal(report.outline,'none',`${entry.id}: pointer opening does not create the old focus ring`);
        assert.equal(report.titleOverlap,false,`${entry.id}/${viewport.width}: title is not obscured`);
        assert.equal(report.inside,true,`${entry.id}: close remains inside its dialog`);
        assert.equal(report.overflow,false,`${entry.id}: viewport has no horizontal overflow`);
        reports.push({id:entry.id,theme,viewport:viewport.width,...report});
        if(viewport.width===1440||['payroll','inventory','recruit','picker','planner','delivery','blackmarket'].includes(entry.id))await dialog.screenshot({path:path.join(output,`${theme}-${viewport.width}-${entry.id}.png`)});
        await button.click();await dialog.waitFor({state:'hidden'});
        assert.equal(await opener.evaluate(element=>document.activeElement===element),true,`${entry.id}: focus returns to the opener`);
      }
      if(viewport.width===1440){
        const opener=page.locator('[data-open=game]');await opener.click();const dialog=page.locator('[role=dialog]:visible'),button=dialog.locator(closeSelector).first();
        await button.hover();const hovered=await measure(button);checkColor(hovered.background,'hover has a soft background');await dialog.screenshot({path:path.join(output,`${theme}-hover.png`)});
        await page.mouse.down();const pressed=await measure(button);assert.notEqual(pressed.background,hovered.background,'press gives distinct feedback');await dialog.screenshot({path:path.join(output,`${theme}-pressed.png`)});await page.mouse.up();await dialog.waitFor({state:'hidden'});await opener.click();
        await page.keyboard.press('Tab');const focused=await measure(button);assert.equal(focused.focused,true);assert.equal(focused.focusVisible,true);assert.equal(focused.outlineWidth,'2px');assert.equal(focused.outline,'solid');checkColor(focused.outlineColor,'keyboard focus remains visible');
        await dialog.screenshot({path:path.join(output,`${theme}-keyboard-focus.png`)});await page.keyboard.press('Enter');await dialog.waitFor({state:'hidden'});
        await opener.focus();await page.keyboard.press('Enter');await page.locator('[role=dialog]:visible').waitFor();await page.keyboard.press('Tab');await page.keyboard.press('Space');await page.locator('[role=dialog]:visible').waitFor({state:'hidden'});
        await opener.click();await page.keyboard.press('Escape');await page.locator('[role=dialog]:visible').waitFor({state:'hidden'});
        await page.locator('[data-open=delivery]').click();const delivery=page.locator('[role=dialog]:visible'),deliveryClose=delivery.locator('[data-delivery-close]');
        const beforeEvents=await page.evaluate(()=>window.closeEvents.length);await deliveryClose.evaluate(element=>{element.disabled=true;element.click()});assert.equal(await page.evaluate(()=>window.closeEvents.length),beforeEvents,'disabled delivery close cannot dismiss a pending save');assert.equal(await deliveryClose.evaluate(element=>getComputedStyle(element).opacity),'0.4');await deliveryClose.evaluate(element=>element.disabled=false);
        const transition=await page.evaluate(()=>window.deliveryCloseTransitions());assert.equal(transition.prepared.text,'稍后继续');assert.equal(transition.prepared.mask,'none','delivery text action is not converted to an icon');assert.ok(parseFloat(transition.prepared.fontSize)>0);assert.equal(transition.hidden,true);assert.equal(transition.hiddenDisplay,'none','review mode cannot leave the close icon visible');assert.equal(transition.restored.hidden,false);assert.equal(transition.restored.fontSize,'0px');assert.match(transition.restored.mask,/svg|data:image/);await page.keyboard.press('Escape');
      }
      if(viewport.width===320){
        for(const id of ['shop','order','market','blindbox']){
          await page.locator(`[data-open="${id}"]`).click();const dialog=page.locator('[role=dialog]:visible');
          await dialog.evaluate((element,id)=>{
            const title=element.querySelector('h3');title.textContent=id==='shop'||id==='order'?'冰种飘花翡翠平安扣与十八K金镶嵌材料购买确认详情':'CUIJIEProfessionalJadeCuttingAndPolishingMachineCJ2026ProMax';
            if(id==='shop'){const thumb=document.createElement('div');thumb.className='mat-thumb lg';thumb.textContent='18K';element.querySelector('.modal-head').prepend(thumb);}
          },id);
          const report=await measure(dialog.locator(closeSelector).first());stressReports.push({id,theme,...report});
          await dialog.screenshot({path:path.join(output,`${theme}-320-long-${id}.png`)});
          await page.keyboard.press('Escape');
        }
      }
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
  await writeFile(path.join(output,'results.json'),JSON.stringify({reports,stressReports,autoOpenReports,errors,consoleErrors},null,2));
  assert.deepEqual(stressReports.filter(report=>report.titleOverlap||report.overflow||!report.inside).map(({id,theme,titleOverlap,overflow,inside})=>({id,theme,titleOverlap,overflow,inside})),[],'long product names and model identifiers must not overlap the close control or overflow at 320px');
  console.log(`modal-close-browser: ${reports.length} family/theme/viewport checks and ${autoOpenReports.length} fresh-page automatic payroll checks; neutral initial focus, explicit targets, stacked dialogs, vector icon, pointer/keyboard states, focus return and closing actions ok`);
  console.log(output);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
