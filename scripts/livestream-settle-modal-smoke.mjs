import { readFileSync } from "node:fs";
import { readClientShellSource } from "./load-client-shell.mjs";
import assert from "node:assert/strict";
import {
  buildLivestreamSettleModalEvent,
  formatLivestreamDuration
} from "../public/livestream-module.js";
import {
  buildLivestreamSettleReport,
  closeLivestreamRoom,
  purchaseLivestreamRoomItem,
  startLivestreamRoom
} from "../server/systems/livestream-room-system.js";
import { createLivestreamService } from "../server/services/livestream-service.js";

const mainEntry = readFileSync("public/main.js", "utf8");
const main = readClientShellSource();
assert.match(main, /pendingLivestreamSettle/);
assert.match(main, /buildLivestreamSettleModalEvent/);
assert.match(main, /ackLivestreamSettle/);
assert.doesNotMatch(
  main,
  /rememberUiEvent\(\{ id: modal\.id \}\)\)\s*\{\s*socket\.emit\(["']ackLivestreamSettle/
);

assert.equal(formatLivestreamDuration(5_000), "5 秒");
assert.equal(formatLivestreamDuration(90_000), "1 分 30 秒");
assert.equal(formatLivestreamDuration(3_600_000), "1 小时 0 分");

const emptyModal = buildLivestreamSettleModalEvent({
  playerId: "p1",
  roomId: "room-1",
  reason: "manual",
  hostName: "阿成",
  soldCount: 0,
  returnedCount: 2,
  revenueTotal: 0,
  costTotal: 0,
  netProfit: 0,
  durationMs: 45_000,
  items: []
}, (n) => `¥${n}`);
assert.equal(emptyModal.type, "modal");
assert.equal(emptyModal.title, "直播已结束");
assert.equal(emptyModal.id, "livestream-settle:p1:room-1");
assert.equal(emptyModal.actions[0]?.clientAction, "ackLivestreamSettle");
assert.equal(emptyModal.modalClass, "livestream-settle-modal");
assert.match(emptyModal.body.join("\n"), /暂无成交/);
assert.match(emptyModal.body.join("\n"), /退回库存/);
assert.ok(emptyModal.stats?.some((row) => row.label === "用时"));
assert.ok(!emptyModal.stats?.some((row) => row.label === "货品毛利"));

const soldModal = buildLivestreamSettleModalEvent({
  playerId: "p1",
  roomId: "room-2",
  reason: "sold_out",
  hostName: "阿成",
  soldCount: 2,
  returnedCount: 0,
  revenueTotal: 24_000,
  costTotal: 20_000,
  costComplete: true,
  netProfit: 4_000,
  durationMs: 120_000,
  items: [
    { productName: "冰种扣", quantity: 1, price: 12_000, buyerName: "晴" },
    { productName: "平安扣", quantity: 1, price: 12_000, buyerName: "AI翠友" }
  ]
}, (n) => `¥${n}`);
assert.match(soldModal.subtitle, /售罄/);
assert.match(soldModal.body.join("\n"), /共卖出 2 件/);
assert.ok(soldModal.lines.some((line) => /冰种扣/.test(line) && /晴/.test(line)));
assert.deepEqual(soldModal.stats.map((row) => row.label), ["成交", "用时"]);
assert.doesNotMatch(soldModal.body.concat(soldModal.lines).join("\n"), /¥|营收|毛利/);
assert.equal(soldModal.report.revenueTotal, 24000);
assert.equal(soldModal.report.netProfit, 4000);

function product(id) {
  return {
    id,
    type: "bracelet",
    kind: "bracelet",
    materialStage: "finished",
    name: `成品${id}`,
    value: 10_000,
    score: 3
  };
}

function makePlayer(id, count) {
  return {
    id,
    name: `掌柜${id}`,
    cash: 100_000,
    level: 9,
    exp: 35000,
    rep: 50,
    assets: { livestreamPermitOwned: true },
    bracelets: Array.from({ length: count }, (_, i) => product(`${id}-${i}`)),
    livestreamRoom: null,
    livestreamHistory: [],
    workshop: { workers: [{ id: "host-1", name: "阿成", job: "streamer", tier: 3, skills: {} }] },
    pendingLivestreamSettle: null
  };
}

const owner = makePlayer("settle", 3);
const deps = {
  now: 1_000,
  makeId: (() => { let n = 0; return () => `ls-${++n}`; })(),
  isFinishedProduct: () => true,
  earnCash: (player, amount) => { player.cash += amount; },
  addNews: () => {}
};
assert.equal(startLivestreamRoom(owner, owner.bracelets.map((p) => ({
  productId: p.id,
  price: 12_000
})), {
  ...deps,
  host: { id: "host-1", name: "阿成", job: "streamer", tier: 3, skills: {} }
}).ok, true);

const report = buildLivestreamSettleReport(owner.livestreamRoom, {
  playerId: owner.id,
  endedAt: 61_000,
  reason: "manual",
  returnedCount: 3
});
assert.equal(report.durationMs, 60_000);
assert.equal(report.soldCount, 0);

const events = [];
const api = createLivestreamService({
  normalizePlayer: () => {},
  materialStageFor: () => "finished",
  spendCash: () => true,
  earnCash: () => {},
  addItem: () => {},
  advanceTask: () => {},
  addNews: () => {},
  refreshPlayerReport: () => {},
  emitUiEventToPlayer: (_player, event) => { events.push(event); },
  getState: () => ({ players: new Map([[owner.id, owner]]) }),
  broadcast: () => {},
  publicProduct: (item) => item,
  uiMoney: (n) => `¥${n}`,
  randomUUID: () => "uuid-1"
});

owner.bracelets = [
  product("a"), product("b"), product("c")
];
owner.livestreamRoom = null;
const start = api.startLivestreamRoomForPlayer(
  owner,
  owner.bracelets.map((p) => ({ productId: p.id, price: 11_000 })),
  "host-1",
  10_000
);
assert.equal(start.ok, true);
const closed = api.closeLivestreamRoomForPlayer(owner, 70_000);
assert.equal(closed.ok, true);
assert.ok(owner.pendingLivestreamSettle?.roomId);
assert.equal(owner.pendingLivestreamSettle.reason, "manual");
assert.ok(events.some((event) => event?.type === "modal" && /直播已结束/.test(event.title)));
assert.equal(api.ackLivestreamSettleForPlayer(owner, owner.pendingLivestreamSettle.roomId).cleared, true);
assert.equal(owner.pendingLivestreamSettle, null);

// sold-out path also delivers settle
const seller = makePlayer("soldout", 3);
events.length = 0;
assert.equal(api.startLivestreamRoomForPlayer(
  seller,
  seller.bracelets.map((p) => ({ productId: p.id, price: 11_000 })),
  "host-1",
  1_000
).ok, true);
const roomId = seller.livestreamRoom.id;
for (const item of [...seller.livestreamRoom.items]) {
  purchaseLivestreamRoomItem({
    seller,
    buyer: null,
    itemId: item.id,
    buyerType: "ai",
    buyerName: "AI翠友"
  }, api.livestreamRoomDependencies(5_000));
}
assert.equal(seller.livestreamRoom, null);
assert.ok(seller.pendingLivestreamSettle);
assert.equal(seller.pendingLivestreamSettle.reason, "sold_out");
assert.equal(seller.pendingLivestreamSettle.soldCount, 3);
assert.equal(seller.pendingLivestreamSettle.roomId, roomId);

console.log("livestream-settle-modal-smoke: ok");
