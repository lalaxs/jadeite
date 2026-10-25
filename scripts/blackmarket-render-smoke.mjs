import assert from "node:assert/strict";
import { createBlackmarketFeature } from "../public/blackmarket-module.js";
import { escapeHtml, formatMoney } from "../public/shell/format-utils.js";

const stall = { id: "render-stall", type: "goods", title: "货架", displayName: "测试摊主", items: [
  { id: "row", price: 100, item: { id: "jade", name: "平安扣毛坯", kind: "peacePendant", materialStage: "carved" } }
] };
const state = { me: { id: "buyer", cash: 100, achievementPoints: 9999 }, blackStalls: [stall] };
let html = "", writes = 0;
const grid = { firstElementChild: null, querySelectorAll: () => [],
  set innerHTML(value) { html = value; writes++; this.firstElementChild = {}; }, get innerHTML() { return html; }
};
const deps = { getState: () => state, els: { bmGrid: grid }, helpers: { escapeHtml, formatMoney, productCanvas: () => "<svg></svg>" } };
const { bmUi, renderBmDetail } = createBlackmarketFeature(deps);
bmUi.detailStallId = stall.id;
renderBmDetail();
assert.equal(writes, 1);
assert.match(html, />买入 · ¥100<\/button>/);
state.me.exp = 42;
renderBmDetail();
assert.equal(writes, 1, "unrelated experience updates retain the shelf DOM");
state.me.cash = 99;
renderBmDetail();
assert.equal(writes, 2);
assert.match(html, /disabled[^>]*>现金不足 · ¥100<\/button>/);
stall.items[0].price = 90;
renderBmDetail();
assert.equal(writes, 3);
assert.match(html, />买入 · ¥90<\/button>/, "repricing updates affordability immediately");
stall.items.length = 0;
renderBmDetail();
assert.equal(writes, 4);
assert.match(html, /这个摊位暂时空着/);
grid.innerHTML = "plaza";
renderBmDetail();
assert.equal(writes, 6, "returning from another screen cannot mistake its DOM for the cached shelf");
console.log("blackmarket-render-smoke: retained shelf, cash, prices, sold stock and navigation ok");
