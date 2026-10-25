import assert from "node:assert/strict";
import { createBlackmarketFeature } from "../public/blackmarket-module.js";
import { escapeHtml, formatMoney } from "../public/shell/format-utils.js";
import { inventoryDetailStats } from "../public/features/inventory/item-detail-model.js";
const { goodsReferencePrice, goodsPriceComparison, goodsOfferNotes, npcGoodsInfo } = createBlackmarketFeature({ helpers: { escapeHtml, formatMoney } });

const machine = { id: "machine-row", type: "equipment", price: 4390, referencePrice: 4500,
  npcDiscount: true, npcPremium: true, item: { id: "machine", name: "测试旧机", basePrice: 6800,
    condition: 70, techLevel: 1, specs: "测试参数", stage: "opening" } };
assert.equal(goodsReferencePrice(machine), 6800, "a resale appraisal must not replace the same-model new price");
assert.deepEqual(goodsPriceComparison(machine), { referencePrice: 6800, price: 4390, repair: 510,
  totalCost: 4900, referenceLabel: "同款新机价", savingsLabel: "修满后较新机省", hasReference: true, savings: 1900 });
const worker = { id: "worker-row", type: "employee", price: 31500, referencePrice: 35000,
  item: { id: "worker", name: "测试师傅", tier: 8, job: "finisher" } };
assert.equal(goodsPriceComparison(worker).savings, 3500);
assert.equal(goodsPriceComparison(worker).referenceLabel, "同阶招聘基准");
assert.equal(goodsPriceComparison(worker).hasReference, true);
const jade = { id: "jade-row", type: "bracelet", price: 850, referencePrice: 1000,
  item: { id: "jade", name: "测试玉器", materialStage: "finished", value: 1000 } };
assert.equal(goodsPriceComparison(jade).savingsLabel, "较参考估值省");
assert.equal(goodsPriceComparison({ ...jade, referencePrice: undefined }).referencePrice, 1000,
  "ordinary player jade uses its value instead of an equipment resale fallback");

let dialog;
const buyBody = { innerHTML: "", querySelectorAll: () => [] };
const buyModal = { hidden: true, querySelector: () => ({}) };
const stall = { id: "npc-stall", title: "测试摊", displayName: "测试摊主", npc: true, status: "open", items: [machine, worker, jade] };
const state = { me: { id: "buyer", cash: 1_000_000, achievementPoints: 9999, workshop: { workers: [] } }, blackStalls: [stall] };
const deps = { getState: () => state, els: { bmBuyBody: buyBody, bmBuyModal: buyModal }, helpers: {
  escapeHtml, formatMoney, openGameModal: (next) => { dialog = next; }, productCanvas: () => "<svg></svg>"
} };
const { openBmItemDetail, openBmBuy, blackmarketItemDetailHtml } = createBlackmarketFeature(deps);
function detailRegions(html) {
  const layoutStart = html.search(/class="inventory-detail-layout(?:\s|")/);
  const rightStart = html.search(/class="inventory-detail-content(?:\s|")/);
  const footerStart = html.search(/class="inventory-detail-footer(?:\s|")/);
  assert.ok(layoutStart > 0 && rightStart > layoutStart, "prices precede the two balanced columns");
  return { summary: html.slice(0, layoutStart), overview: html.slice(layoutStart, rightStart),
    content: html.slice(rightStart, footerStart < 0 ? html.length : footerStart), footer: footerStart < 0 ? "" : html.slice(footerStart) };
}
const npcMachineHtml = npcGoodsInfo(machine, { npc: true, showSavings: true });
assert.match(npcMachineHtml, /本批清仓/);
assert.match(npcMachineHtml, /限量高货/);
assert.match(npcMachineHtml, /修满后较新机省 ¥1,900/);
assert.match(npcMachineHtml, /挂牌价 ¥4,390.*维修至满耐久 ¥510.*修满后总投入 ¥4,900/);
assert.doesNotMatch(npcGoodsInfo(machine, { showSavings: true }), /本批清仓|限量高货/,
  "player resales are never labelled as NPC offers even with copied flags");
assert.doesNotMatch(npcGoodsInfo({ ...machine, price: 6800 }, { npc: true, showSavings: true }), /bm-npc-saving/,
  "do not claim savings when repairs erase the discount");
assert.doesNotMatch(npcGoodsInfo(machine), /bm-npc-saving/,
  "the editable player listing does not keep a stale savings quote while its input changes");
assert.match(npcGoodsInfo(jade, { npc: true, showSavings: true }), /较参考估值省 ¥150/);
assert.doesNotMatch(npcGoodsInfo(jade, { npc: true, showSavings: true }), /商城|新机/);
assert.equal(goodsOfferNotes({ ...machine, note: "本批清仓，售完等下一批；按当前耐久交付。" }, true)
  .filter((line) => line.includes("本批清仓")).length, 1, "avoid duplicate clearance notes");
assert.deepEqual(goodsOfferNotes(machine), [], "a player's copied flags add no NPC offer notes");

openBmItemDetail(machine.id, stall.id);
assert.equal(dialog.size, "wide");
assert.equal(dialog.modalClass, "inventory-detail-modal blackmarket-detail-modal");
assert.equal(dialog.stats, undefined, "the shared detail content must not be rendered twice");
assert.equal(dialog.lines, undefined);
const machineRegions = detailRegions(dialog.previewHtml);
assert.doesNotMatch(machineRegions.overview, /同款新机价|修满后总投入|修满后较新机省|¥4,390|测试摊/,
  "the image column no longer accumulates transaction rows");
assert.match(machineRegions.summary, /售价<\/dt><dd[^>]*>¥4,390/);
assert.match(machineRegions.summary, /同款新机价<\/dt><dd[^>]*>¥6,800/);
assert.match(machineRegions.content, /修满后总投入<\/dt><dd[^>]*>¥4,900/);
assert.match(machineRegions.summary, /修满后较新机省<\/dt><dd[^>]*>¥1,900/);
assert.match(machineRegions.content, /设备详情/);
assert.match(machineRegions.footer, /测试摊/);
assert.match(machineRegions.content, /测试参数/);
assert.doesNotMatch(dialog.previewHtml, /料质详情|颜色分布/);
assert.doesNotMatch(dialog.previewHtml, /本批清仓|限量高货|常规现货|限量供应/,
  "offer slogans stay out of the detail view without changing the goods cards");
assert.match(dialog.previewHtml, /设备将加入工坊，可在设备页查看和维修。/);
assert.ok(dialog.actions.some((action) => action.clientAction === "openBmBuyFromDetail" && action.payload === `${stall.id}|${machine.id}`));
openBmBuy(machine.id, stall.id);
assert.match(buyBody.innerHTML, /修满后较新机省 ¥1,900/);
assert.match(buyBody.innerHTML, /便宜 ¥1,900/,
  "purchase comparison includes the repair cost rather than only the sticker price");
openBmItemDetail(worker.id, stall.id);
const workerRegions = detailRegions(dialog.previewHtml);
assert.match(workerRegions.summary, /较同阶招聘省<\/dt><dd[^>]*>¥3,500/);
assert.match(workerRegions.content, /员工详情/);
assert.match(workerRegions.content, /登录日日薪<\/dt><dd[^>]*>¥590/);
assert.doesNotMatch(dialog.previewHtml, /料质详情|颜色分布/);
openBmItemDetail(jade.id, stall.id);
assert.match(detailRegions(dialog.previewHtml).summary, /较参考估值省<\/dt><dd[^>]*>¥150/);
assert.match(dialog.previewHtml, /inventory-detail-layout/);
assert.match(dialog.previewHtml, /料质详情/);

const hidden = { id: "hidden-row", type: "rough", price: 150, referencePrice: 200,
  note: "常规现货，限量供应",
  item: { id: "hidden", name: "暗料", type: "rough", materialStage: "rough", quality: "玻璃种", color: "帝王绿",
    mass: .7, hint: "白雾皮壳 · 轮廓饱满", visual: { masked: true } } };
stall.items.push(hidden);
openBmItemDetail(hidden.id, stall.id);
assert.match(dialog.previewHtml, /data-analysis-status="hidden"/);
assert.doesNotMatch(dialog.previewHtml, /玻璃种|帝王绿/);
const hiddenRegions = detailRegions(dialog.previewHtml);
assert.match(hiddenRegions.content, /重量<\/dt><dd>0\.70 kg/);
assert.match(hiddenRegions.content, /白雾皮壳 · 轮廓饱满/);
assert.match(hiddenRegions.summary, /售价<\/dt><dd[^>]*>¥150/);
assert.doesNotMatch(dialog.previewHtml, /参考估值|较参考|便宜|jm-delta/);
assert.equal(goodsPriceComparison(hidden).hasReference, false);
assert.doesNotMatch(npcGoodsInfo(hidden, { npc: true, showSavings: true }), /参考估值|较参考|¥200|¥50/);
openBmBuy(hidden.id, stall.id);
assert.match(buyBody.innerHTML, /你需支付<\/span><span>¥150/);
assert.doesNotMatch(buyBody.innerHTML, /参考估值|较参考|便宜|jm-delta|¥200|玻璃种|帝王绿/);
assert.match(hiddenRegions.content, /分类<\/dt><dd>原石/);
assert.match(hiddenRegions.content, /数量<\/dt><dd>1 件/);
assert.match(hiddenRegions.content, /内部料质未揭露，开窗或开料后可查看。/);
assert.doesNotMatch(dialog.previewHtml, /常规现货|限量供应|颜色分布|裂纹覆盖|废料占比/);
hidden.item.windows = [{}];
openBmItemDetail(hidden.id, stall.id);
assert.match(dialog.previewHtml, /data-analysis-status="partial"/);
assert.doesNotMatch(dialog.previewHtml, /玻璃种|帝王绿/);
assert.doesNotMatch(dialog.previewHtml, /参考估值|较参考|便宜/);
state.me.cash = 0;
openBmItemDetail(machine.id, stall.id);
assert.match(detailRegions(dialog.previewHtml).footer, /现金不足，购买需要 ¥4,390。/);
assert.ok(dialog.actions.every((action) => action.clientAction !== "openBmBuyFromDetail"),
  "reorganizing notes must preserve the insufficient-cash purchase guard");
state.me.cash = 1_000_000;
stall.npc = false;
jade.note = "卖家说明：这件已完成精加工。";
openBmItemDetail(jade.id, stall.id);
assert.match(detailRegions(dialog.previewHtml).footer, /卖家说明：这件已完成精加工。/,
  "a player's actual item description is kept when NPC offer slogans are removed");
stall.npc = true;
const publicItem = { id: "public-field-parity", name: "同一件明料", type: "material", materialStage: "opened",
  revealed: true, qualityKey: "ice", quality: "冰种", color: "晴水", mass: 1.25, craftGrade: 87,
  windows: [{}, {}], hint: "可公开的皮壳线索", openingSeed: 789,
  miningOrigin: { mineName: "会卡矿区", beltLabel: "老坑矿带", foremanName: "张师傅", roleLabels: ["开采", "运输"] },
  costBasis: { amount: 987654, complete: true, componentsComplete: true, components: { acquisition: 987654 } },
  escrowOrderId: "private-seller-commission" };
const publicEntry = { item: publicItem, name: publicItem.name, category: "stage", categoryLabel: "阶段产物",
  stage: "opened", stageLabel: "明料", totalValue: 12000, source: "materials" };
const publicStats = inventoryDetailStats(publicEntry, { includeCost: false, includeOwnership: false, includeValue: false });
assert.doesNotMatch(JSON.stringify(publicStats), /已记货品成本|购入分摊|987654|归属/);
const publicHtml = blackmarketItemDetailHtml({ type: "material", item: publicItem, price: 10000, referencePrice: 12000 }, {
  stats: [{ label: "售价", value: "¥10,000" }]
});
for (const [label, value] of [["分类", "阶段产物"], ["阶段", "明料"], ["数量", "1 件"],
  ["重量", "1.25 kg"], ["开窗", "2 处"], ["工分", "87"], ["矿山来源", "会卡矿区"], ["值班班长", "张师傅"]]) {
  assert.deepEqual(publicStats.find((field) => field.label === label), { label, value });
  assert.match(publicHtml, new RegExp(`${label}</dt><dd[^>]*>${value}`), `the same public ${label} is retained in black-market details`);
}
assert.match(publicHtml, /<details class="inventory-detail-archive"><summary>来源档案/);
assert.doesNotMatch(publicHtml, /已记货品成本|购入分摊|987654|黑市委托物|private-seller-commission/,
  "shared inventory fields must not expose a seller's private accounting or ownership");
const supplyHtml = blackmarketItemDetailHtml({ type: "supply", price: 1224, referencePrice: 1440,
  item: { name: "18K金", amount: 3, unitLabel: "克", group: "metal" } }, { stats: [{ label: "售价", value: "¥1,224" }] });
assert.match(supplyHtml, /数量<\/dt><dd>3克/);
assert.match(supplyHtml, /单价<\/dt><dd>¥480 \/ 克/);
assert.doesNotMatch(supplyHtml, /数量<\/dt><dd>1 件|已记货品成本/);
stall.isMine = true;
openBmItemDetail(machine.id, stall.id);
assert.ok(dialog.actions.every((action) => action.clientAction !== "openBmBuyFromDetail"), "own stock retains its read-only detail actions");

console.log("blackmarket-price-display-smoke: balanced inventory layout, concise offers, resource details, privacy, savings and purchase actions ok");
