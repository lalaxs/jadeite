import assert from "node:assert/strict";
import {
  bindOverviewRenderDeps,
  businessAttentionItems,
  businessEconomyHtml,
  businessTurnoverHtml,
  businessTurnoverModel
} from "../public/features/overview/overview-render.js";

let state = {
  me: {
    rough: [
      { id: "sealed", name: "暗料", value: 1000, revealed: false },
      { id: "opened", name: "明料", value: 2000, revealed: true }
    ],
    materials: [{ id: "material", name: "明料二", value: 1500 }],
    slices: [{ id: "slice", name: "片料", value: 900 }],
    bracelets: Array.from({ length: 5 }, (_, index) => ({ id: `product-${index}`, value: 3000 })),
    orders: [{ id: "order-ready", quantity: 1 }, { id: "order-wait", quantity: 2 }]
  }
};

bindOverviewRenderDeps({
  getState: () => state,
  productionJobsFor: () => [],
  matchingBracelets: (order) => order.id === "order-ready" ? [{}] : [],
  sumValue: (items) => items.reduce((total, item) => total + Number(item?.value || 0), 0)
});

const model = businessTurnoverModel();
assert.equal(model.cards.length, 4);
assert.equal(model.bottleneckId, "sell");
assert.equal(model.cards.find((card) => card.id === "stock")?.count, 4);
assert.equal(model.cards.find((card) => card.id === "ready")?.count, 3);
assert.equal(model.cards.find((card) => card.id === "sell")?.status, "bottleneck");
assert.match(model.summary, /5 件成品待变现/);

const html = businessTurnoverHtml();
assert.match(html, /经营周转/);
assert.match(html, /当前瓶颈/);
assert.match(html, /business-turnover-grid/);
assert.match(html, /data-view-link="inventory"/);
assert.match(html, /data-view-link="workshop"/);
assert.match(html, /data-view-link="orders"/);
assert.doesNotMatch(html, /aria-current="step"/);
assert.doesNotMatch(html, /business-pipeline-step/);

const attentionItems = businessAttentionItems();
assert.equal(attentionItems.length, 2);
assert.match(attentionItems[0].title, /交付/);
assert.equal(attentionItems[0].view, "orders");
const economyHtml = businessEconomyHtml();
assert.match(economyHtml, /business-attention/);
assert.match(economyHtml, /查看 2 项待处理事项/);
assert.match(economyHtml, /data-view-link="orders"/);
assert.match(economyHtml, /data-view-link="workshop"/);

state = { me: { rough: [], materials: [], slices: [], bracelets: [], orders: [] } };
const emptyHtml = businessTurnoverHtml();
assert.match(emptyHtml, /经营链路空闲/);
assert.match(emptyHtml, /data-view-link="auction"/);
assert.match(businessEconomyHtml(), /is-attention is-empty/);

state.me.bracelets = [{ id: "unfinished", value: 500, materialStage: "carved" }];
const unfinishedModel = businessTurnoverModel();
assert.equal(unfinishedModel.cards.find((card) => card.id === "sell").count, 0);
assert.equal(unfinishedModel.cards.find((card) => card.id === "ready").count, 1);

console.log("overview-turnover-smoke: actionable turnover queues ok");
