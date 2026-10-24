// Disposable, read-only rendering benchmark. Never loads or writes the live save.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stalls = JSON.parse(await readFile(new URL('./fixture-stock.json', import.meta.url), 'utf8'));
const html = `<!doctype html><html data-theme="day"><meta charset="utf-8">
<link rel="stylesheet" href="/styles.css"><style>
body{display:block;padding:24px;overflow:auto}main{max-width:1400px;margin:auto}
#controls{display:flex;gap:12px;margin-bottom:20px}#metrics{white-space:pre-wrap;display:block;font:14px monospace;margin-bottom:20px}
</style><main><div id="controls"></div><output id="metrics">Ready</output><div id="bmGrid"></div></main>
<script type="module">
import {initMarketModule} from '/market-module.js';
import {bindBlackmarketDeps,bmUi} from '/features/blackmarket/shared.js';
import {renderBmDetail,renderBmMain} from '/features/blackmarket/plaza.js';
import {openingStoneSvg,productCanvas,openingKitsForRender} from '/features/opening/opening-render.js';
import {formatMoney,escapeHtml} from '/shell/format-utils.js';
import {clearPreviewBitmapCache} from '/preview-bitmap-cache.js';
const stalls=await (await fetch('/fixture.json')).json();
const state={me:{id:'perf',cash:10000000,achievementPoints:9999},blackStalls:stalls};
const helpers={formatMoney,escapeHtml,openingStoneSvg,productCanvas,openingKitsForRender};
const deps={getState:()=>state,getActiveView:()=> 'blackmarket',els:{bmGrid:document.querySelector('#bmGrid')},helpers};
initMarketModule(deps);bindBlackmarketDeps(deps);
let longTasks=[];new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});
for(const stall of stalls){const button=document.createElement('button');button.textContent=stall.title;button.dataset.stall=stall.id;
button.onclick=()=>{bmUi.detailStallId=stall.id;bmUi.section='detail';const start=performance.now();renderBmDetail();const sync=performance.now()-start;
let frames=0;function check(){frames++;const imgs=[...document.querySelectorAll('#bmGrid .lazy-preview-bitmap')];
if((imgs.length>=stall.items.length&&imgs.every(i=>i.complete&&i.naturalWidth))||performance.now()-start>15000){
document.querySelector('#metrics').textContent=JSON.stringify({stall:stall.npcRole,syncMs:+sync.toFixed(1),readyMs:+(performance.now()-start).toFixed(1),frames,bitmaps:imgs.length,svgNodes:document.querySelectorAll('#bmGrid svg *').length,longTasks:longTasks.filter(e=>e.start>=start)},null,2);
}else requestAnimationFrame(check);}requestAnimationFrame(check);};document.querySelector('#controls').append(button);}
const clear=document.createElement('button');clear.textContent='Clear / back';clear.onclick=()=>{document.querySelector('#bmGrid').replaceChildren();clearPreviewBitmapCache();document.querySelector('#metrics').textContent='Ready';};document.querySelector('#controls').append(clear);
const plaza=document.createElement('button');plaza.textContent='Plaza (prewarm)';plaza.onclick=()=>{document.querySelector('#bmGrid').classList.add('jm-grid');bmUi.section='plaza';renderBmMain(stalls,null);};document.querySelector('#controls').append(plaza);
const rerender=document.createElement('button');rerender.textContent='Unrelated update';rerender.onclick=()=>{const head=document.querySelector('#bmGrid').firstElementChild;state.me.exp=(state.me.exp||0)+1;renderBmDetail();document.querySelector('#metrics').textContent=JSON.stringify({retained:head===document.querySelector('#bmGrid').firstElementChild});};document.querySelector('#controls').append(rerender);
</script></html>`;
const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
http.createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(req.url==='/fixture.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(stalls));return;}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative=pathname.startsWith('/shared/')?pathname.slice(1):'public'+pathname;
  const file=path.resolve(root,relative);if(!file.startsWith(root)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
  res.setHeader('Cache-Control','no-store');res.end(await readFile(file));
}catch{res.writeHead(404).end();}}).listen(3020,'127.0.0.1',()=>console.log('Rendering benchmark: http://127.0.0.1:3020'));
