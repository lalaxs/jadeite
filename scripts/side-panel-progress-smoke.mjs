import assert from "node:assert/strict";
import { bindSidePanelDeps, renderSidePanel, tickSidePanelProgress } from "../public/features/hud/side-panel.js";
import { bindFormatDeps } from "../public/shell/format-utils.js";
import { productMatchesOrder } from "../public/jade-rules.js";

let now = 100_000;
let renders = 0;
let requests = 0;
let connected = true;
let html = "";
let nodes = [];
const state = { me: { jobs: [], workshopDeliveries: [], workshop: { workers: [] }, cash: 1000 } };
const plane = {
  querySelectorAll: () => nodes,
  querySelector: () => html.split('<div data-pplane="order"')[0].includes('class="side-empty"') ? {} : null
};
const body = {
  set innerHTML(value) {
    renders++;
    html = value;
    nodes = [...value.matchAll(/data-side-job="([^"]+)"/g)].map((match) => ({
      dataset: { sideJob: match[1] },
      querySelector: () => ({ textContent: "", style: {}, classList: { toggle() {} } })
    }));
  },
  querySelector: (selector) => selector === '[data-pplane="workshop"]' ? plane : null,
  querySelectorAll: () => []
};
globalThis.document = { querySelectorAll: () => [] };
bindFormatDeps({ getNowMs: () => now });
bindSidePanelDeps({
  getState: () => state,
  getEls: () => ({ sidePanelBody: body }),
  workshopJobs: () => state.me.jobs,
  productionJobsFor: (me) => me.jobs,
  requestState: () => { if (!connected) return false; requests++; return true; }
});
const delivery = (id, stage = "opening") => ({ id, stage, inputName: `石料 ${id}`, workerName: "阿成",
  completedAt: 1, revealedAt: null, items: [{}], auxiliaryItems: [] });
const job = (id, readyAt, stage = "opening") => ({ id, stage, startedAt: now - 10_000, readyAt, item: { name: `加工 ${id}` } });
const tick = (at = now) => { now = at; tickSidePanelProgress(now); };
function expectDeliveryUpdate(deliveries, text) {
  state.me.workshopDeliveries = deliveries;
  const before = renders;
  tick();
  assert.equal(renders, before + 1, "delivery changes refresh the panel without a page reload");
  assert.ok(html.includes(text));
  tick();
  assert.equal(renders, before + 1, "unchanged deliveries retain the DOM");
}

renderSidePanel();
const initialRenders = renders;
tick();
assert.equal(renders, initialRenders);
expectDeliveryUpdate([delivery("A")], 'data-side-delivery="A"');
expectDeliveryUpdate([delivery("A"), delivery("B")], 'data-side-delivery="B"');
expectDeliveryUpdate([delivery("B")], 'data-side-delivery="B"');
assert.ok(!html.includes('data-side-delivery="A"'));
expectDeliveryUpdate([delivery("C")], 'data-side-delivery="C"');
const revealed = { ...delivery("C"), revealedAt: 1 };
expectDeliveryUpdate([revealed], "继续领取");
expectDeliveryUpdate([{ ...revealed, items: [{}, {}] }], "2 件");
expectDeliveryUpdate([], "暂无加工任务");

state.me.jobs = [job("opening", 110_000)];
renderSidePanel();
for (const at of [109_999, 110_000, 111_999]) tick(at);
assert.equal(requests, 0, "allow the server completion tick to deliver its normal update");
const processingRenders = renders;
tick(112_000);
assert.equal(requests, 1, "a stuck completed job requests authoritative state automatically");
assert.equal(renders, processingRenders, "countdown updates retain the DOM");
assert.ok(!html.includes("待领取"), "an expired timer cannot manufacture unconfirmed outputs");
for (const at of [113_000, 120_000, 121_999]) tick(at);
assert.equal(requests, 1, "recovery requests are rate limited");
renderSidePanel(); // A delayed full snapshot may still contain the old job.
tick(122_000);
assert.equal(requests, 2, "rerendering must not reset the retry throttle");
state.me.jobs.push(job("second", 110_000));
tick(132_000);
assert.equal(requests, 3, "multiple overdue jobs share one recovery request");

state.me.jobs = [];
expectDeliveryUpdate([delivery("opening")], "待领取");
assert.ok(!html.includes("data-side-job="));
tick(160_000);
assert.equal(requests, 3, "recovery stops after the completion state arrives");
state.me.jobs = [job("next-opening", 170_000)];
tick(170_000);
tick(172_000);
assert.equal(requests, 4, "a later stuck job can recover independently");
state.me.jobs = [undefined, 0, NaN, Infinity].map((readyAt, index) => job(`invalid-${index}`, readyAt));
tick(200_000);
assert.equal(requests, 4, "invalid deadlines do not request state");
state.me.jobs = [job("offline-opening", 210_000)];
connected = false;
tick(212_000);
assert.equal(requests, 4, "disconnected clients do not buffer recovery requests");
connected = true;
tick(212_001);
assert.equal(requests, 5, "a skipped offline request does not consume the throttle window");
tick(211_999);
tick(212_000);
assert.equal(requests, 6, "server clock corrections cannot postpone recovery indefinitely");

for (const [stage, label] of [["opening", "开料"], ["carving", "规划取件"], ["finishing", "精加工"]]) {
  const id = `${stage}-normal`;
  const readyAt = now + 10_000;
  state.me.jobs = [job(id, readyAt, stage)];
  state.me.workshopDeliveries = [];
  renderSidePanel();
  const before = requests;
  tick(readyAt);
  assert.equal(requests, before, `${label}: normal completion does not request extra state`);
  state.me.jobs = [];
  const outputs = { ...delivery(id, stage), auxiliaryItems: stage === "carving" ? [{}] : [] };
  expectDeliveryUpdate([outputs], `${label}完成`);
  assert.ok(html.includes("待领取"), `${label}: completion becomes claimable without a reload`);
  assert.ok(!html.includes("data-side-job="), `${label}: remove the completed progress bar`);
  if (stage === "carving") assert.ok(html.includes("+ 余料"), "carving also displays its offcut");
  assert.equal(requests, before);

  const delayedId = `${stage}-delayed`;
  const delayedReadyAt = now + 10_000;
  state.me.jobs = [job(delayedId, delayedReadyAt, stage)];
  state.me.workshopDeliveries = [];
  renderSidePanel();
  tick(delayedReadyAt + 2000);
  assert.equal(requests, before + 1, `${label}: a missed completion update triggers recovery`);
  state.me.jobs = [];
  expectDeliveryUpdate([delivery(delayedId, stage)], `${label}完成`);
  tick(now + 10_000);
  assert.equal(requests, before + 1, `${label}: recovery stops after the server confirms completion`);
}

state.me.jobs = [job("still-processing", now + 20_000, "finishing")];
state.me.workshopDeliveries = [];
renderSidePanel();
expectDeliveryUpdate([delivery("completed-carving", "carving")], "规划取件完成");
assert.ok(html.includes('data-side-job="still-processing"'), "one completed batch must not hide another active job");

const readyTab = { innerHTML: "", setAttribute() {} };
const unread = { hidden: true, textContent: "", setAttribute() {}, removeAttribute() {} };
let reminderDot = null;
const reminderTab = { querySelector: () => reminderDot, appendChild: (dot) => { reminderDot = dot; } };
document.createElement = () => ({ setAttribute() {}, remove() { reminderDot = null; } });
bindSidePanelDeps({
  getEls: () => ({ sidePanelBody: body, sidePanelUnread: unread,
    panelTabs: { querySelector: (selector) => selector === '[data-ptab="order"]' ? readyTab
      : selector === '[data-ptab="remind"]' ? reminderTab : null } }),
  matchingBracelets: (order) => (state.me.bracelets || []).filter((product) => product.materialStage === "finished" && productMatchesOrder(product, order))
});
state.me.orders = [{ id: "npc-ready", client: "街坊", quantity: 2, pay: 10000,
  hard: { kind: "dropPendant", kindLabel: "水滴挂件", minValue: 4000 }, requirements: [] }];
const stockProduct = { id: "stock-1", kind: "dropPendant", materialStage: "finished", value: 1000 };
state.me.bracelets = [stockProduct];
renderSidePanel();
assert.ok(!html.includes('data-side-npc-order="npc-ready"'), "partial quantities do not prompt delivery");
state.me.bracelets.push({ ...stockProduct, id: "stock-2" });
renderSidePanel();
assert.ok(html.includes('data-side-npc-order="npc-ready"'));
assert.ok(html.includes("库存已备齐"));
assert.match(readyTab.innerHTML, />1<\/span>/);
assert.equal(unread.hidden, false, "ready stock is visible on the mobile affairs button");
state.me.bracelets = [];
renderSidePanel();
assert.ok(!html.includes('data-side-npc-order="npc-ready"'), "selling or consuming stock clears the prompt");
assert.equal(readyTab.innerHTML, "订单");
assert.equal(unread.hidden, true);

console.log("side-panel-progress-smoke: all three stages auto-claimable, missed updates recover, active jobs coexist and DOM stays stable");
