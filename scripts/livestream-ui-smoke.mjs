import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFileSync } from "node:fs";
import {
  appendLivestreamChatComments,
  aiDemandMeta,
  buildLivestreamChatFeed,
  priceRatioTier,
  resetLivestreamChatFeeds,
  sortHallRooms,
  trimLivestreamSelection
} from "../public/livestream-module.js";
import {
  LIVESTREAM_BASE_DURATION_MS,
  LIVESTREAM_MAX_ITEMS,
  LIVESTREAM_MAX_DURATION_MS,
  LIVESTREAM_MIN_ITEMS,
  LIVESTREAM_SALE_EXTENSION_MS
} from "../public/livestream-rules.js";
import { loadResolvedStyles } from "./load-styles.mjs";

const moduleSource = readFileSync("public/features/livestream/livestream-module.js", "utf8");
const settleModalSource = readFileSync("shared/domain/livestream/settle-modal.js", "utf8");
const mainEntry = readFileSync("public/main.js", "utf8");
const mainSource = readClientShellSource();
const indexSource = readFileSync("public/index.html", "utf8");
const stylesSource = loadResolvedStyles();

for (const eventName of [
  "startLivestreamRoom",
  "replenishLivestreamRoom",
  "closeLivestreamRoom",
  "buyLivestreamRoomItem"
]) {
  assert.match(moduleSource, new RegExp(`socketRef\\.emit\\("${eventName}"`));
}

assert.match(moduleSource, /livestream-room-card/);
assert.match(moduleSource, /livestream-chat-rail/);
assert.match(moduleSource, /livestream-chat-scroll/);
assert.match(moduleSource, /showChat:\s*false/);
assert.match(moduleSource, /showFooter:\s*false/);
assert.match(moduleSource, /hallRoomMap\.set\(myRoom\.id,\s*myRoom\)/);
assert.match(moduleSource, /enter-hall-room/);
assert.match(moduleSource, /watchingRoomId/);
assert.match(moduleSource, /visitorWatchMarkup/);
assert.match(moduleSource, /function visitorRoomCardMarkup[\s\S]*?is-hall-card/);
assert.doesNotMatch(
  moduleSource.slice(moduleSource.indexOf("function visitorRoomCardMarkup"), moduleSource.indexOf("export function trimLivestreamSelection")),
  /livestream-live-badge/
);
assert.match(stylesSource, /\.livestream-hall-section\s+\.livestream-room-card\s*\{[^}]*width:\s*70%/s);
assert.match(stylesSource, /\.livestream-hall-section\s+\.livestream-room-head\s+h3\s*\{[^}]*font-size:\s*13px/s);
assert.match(moduleSource, /buildLivestreamSettleModalEvent/);
assert.match(moduleSource, /formatLivestreamDuration/);
assert.match(moduleSource, /shared\/domain\/livestream\/settle-modal\.js/);
assert.match(moduleSource, /ackLivestreamSettle|shared\/domain\/livestream\/settle-modal/);
assert.match(settleModalSource, /ackLivestreamSettle/);
assert.match(settleModalSource, /直播已结束/);
assert.doesNotMatch(settleModalSource, /货品毛利/);
assert.match(moduleSource, /livestream-room-carousel/);
assert.doesNotMatch(moduleSource, /livestream-comment-layer/);
assert.doesNotMatch(moduleSource, /comment-\$\{commentIndex/);
assert.match(moduleSource, /livestream-host-picker|livestream-host-modal/);
assert.doesNotMatch(moduleSource, /livestream-host-preview/);
assert.doesNotMatch(moduleSource, /livestream-style-picker/);
assert.doesNotMatch(moduleSource, /livestream-wizard-progress/);
assert.doesNotMatch(moduleSource, /livestream-confirm-panel/);
assert.match(moduleSource, /livestream-shelf/);
assert.match(moduleSource, /livestream-room-footer/);
assert.match(moduleSource, /data-livestream-shelf-host/);
assert.match(moduleSource, /livestream-replenish-modal/);
assert.match(moduleSource, /livestream-close-modal/);
assert.match(moduleSource, /open-replenish-modal/);
assert.match(moduleSource, /close-replenish-modal/);
assert.doesNotMatch(moduleSource, /toggle-replenish/);
assert.doesNotMatch(moduleSource, /收起补货/);
assert.match(moduleSource, /livestream-buy-confirm/);
assert.match(moduleSource, /livestream-owner-dash|is-owner-dash/);
assert.match(moduleSource, /select-modal-host/);
assert.match(moduleSource, /open-host-modal/);
assert.match(moduleSource, /confirm-host-modal/);
assert.doesNotMatch(moduleSource, /set-no-host/);
assert.match(moduleSource, /close-host-modal/);
assert.match(moduleSource, /clear-modal-host/);
assert.doesNotMatch(moduleSource, /data-livestream-action="select-style"/);
assert.doesNotMatch(moduleSource, /data-livestream-action="wizard-next"/);
assert.doesNotMatch(moduleSource, /data-livestream-action="wizard-back"/);
assert.match(moduleSource, /data-livestream-action="price-preset"/);
assert.match(moduleSource, /请先勾选要改价的商品/);
assert.doesNotMatch(moduleSource, /class="livestream-price-tier/);
assert.doesNotMatch(moduleSource, /selectedProductIds\.size\s*\?\s*\[\.\.\.selectedProductIds\]\s*:\s*products\.map/);
assert.match(moduleSource, /data-livestream-select-all/);
assert.doesNotMatch(moduleSource, /至少 3 件、最多 20 件/);
assert.match(moduleSource, /data-livestream-action="select-slide"/);
assert.match(moduleSource, /data-livestream-action="confirm-buy"/);
assert.match(moduleSource, /data-hall-sort/);
assert.match(moduleSource, /workerId:\s*host\?\.id\s*\|\|\s*null/);
assert.match(moduleSource, /talkStyle:\s*normalizeTalkStyle\(draftTalkStyle\)/);
assert.match(moduleSource, /hostBonusesFromWorker/);
assert.doesNotMatch(moduleSource, /hostBonusesWithTalkStyle/);
assert.doesNotMatch(moduleSource, /LIVESTREAM_TALK_STYLES/);
assert.match(moduleSource, /recommendLivestreamHost/);
assert.match(moduleSource, /livestream-host-list/);
assert.match(moduleSource, /livestream-host-row/);
assert.match(moduleSource, /is-recommended/);
assert.match(moduleSource, /sortHostsForPicker/);
assert.doesNotMatch(moduleSource, /toggle-host-list|hostListExpanded|livestream-host-featured/);
assert.doesNotMatch(moduleSource, /预计转化/);
assert.match(moduleSource, /默认不选择主播/);
assert.match(moduleSource, /选择主播/);
assert.match(moduleSource, /挑选带货主播/);
assert.match(moduleSource, /livestream-back-btn|返回/);
assert.doesNotMatch(moduleSource, /默认不添加主播/);
assert.doesNotMatch(moduleSource, /当前不开主播/);
assert.doesNotMatch(moduleSource, /本场策略/);
assert.doesNotMatch(moduleSource, /historyMarkup|最近直播成交|成交回放/);
assert.doesNotMatch(moduleSource, /下一步：选择主播/);
assert.match(moduleSource, /无员工加成|不添加主播/);
assert.match(moduleSource, /至少选择 3 件/);
assert.match(moduleSource, /livestream-stock-empty/);
assert.match(moduleSource, /data-view-link="workshop"/);
assert.match(moduleSource, /LIVESTREAM_MIN_ITEMS as MIN_ROOM_ITEMS/);
assert.match(moduleSource, /LIVESTREAM_MAX_ITEMS as MAX_ROOM_ITEMS/);
assert.equal(LIVESTREAM_MIN_ITEMS, 3);
assert.equal(LIVESTREAM_MAX_ITEMS, 12);
assert.equal(LIVESTREAM_BASE_DURATION_MS, 12 * 60 * 1000);
assert.equal(LIVESTREAM_MAX_DURATION_MS, 15 * 60 * 1000);
assert.equal(LIVESTREAM_SALE_EXTENSION_MS, 60 * 1000);
assert.doesNotMatch(moduleSource, /今日订单与直播共用客户额度|重新开播不重置|每次成交 \+/);
assert.match(moduleSource, /成交可延长至 \$\{MAX_DURATION_MINUTES\} 分钟/);
assert.match(moduleSource, /formatRelativeMinutes\(room\.endsAt, Date\.now\(\), "即将结束"\)/);
assert.match(moduleSource, /开启直播/);
assert.match(moduleSource, /data-livestream-action="previous"/);
assert.match(moduleSource, /data-livestream-action="next"/);
assert.match(moduleSource, /data-livestream-action="buy"/);
assert.match(moduleSource, /data-livestream-action="close"/);
assert.match(moduleSource, /action = isStart \? "start" : "replenish"/);
assert.match(moduleSource, /if \(action === "start"\) emitStart\(\)/);
assert.match(moduleSource, /if \(action === "replenish"\) emitReplenish\(\)/);
assert.match(moduleSource, /setInterval/);
assert.match(moduleSource, /paintProductCanvases/);
assert.match(moduleSource, /const hasPermit = Boolean\(state\.me\.assets\?\.livestreamPermitOwned\)/);
assert.match(moduleSource, /const ownerSection = myRoom[\s\S]*:\s*hasPermit/);
assert.match(moduleSource, /data-view-link="shop"/);
assert.match(moduleSource, /本场营业中/);
assert.match(moduleSource, /营业中的房间/);
assert.match(moduleSource, /data-livestream-tab="hall"/);
assert.doesNotMatch(moduleSource, /data-livestream-tab="mine"/);
assert.match(moduleSource, /activeLivestreamTab\s*=\s*"hall"/);
assert.match(moduleSource, /翡翠街/);
assert.match(moduleSource, /我的直播/);
assert.match(moduleSource, /goto-mine-tab/);
assert.match(moduleSource, /livestream-mine-entry/);
assert.match(moduleSource, /mineEntryCardMarkup/);
assert.match(moduleSource, /livestream-tab-live|LIVE/);
assert.match(moduleSource, /activeLivestreamTab === "mine"/);
assert.doesNotMatch(moduleSource, /livestream-hall-cta/);
assert.match(indexSource, /逛摊 · 开播/);
assert.doesNotMatch(indexSource, /公开营业 · AI 与玩家共逛/);
assert.doesNotMatch(moduleSource, /href="#livestream-owner-wizard"/);

{
  const selected = new Set(["one", "two", "three"]);
  trimLivestreamSelection(selected, 2);
  assert.deepEqual([...selected], ["one", "two"]);
}

assert.equal(priceRatioTier(900, 1000), "low");
assert.equal(priceRatioTier(1000, 1000), "fair");
assert.equal(priceRatioTier(1200, 1000), "high");
assert.equal(aiDemandMeta(900, 1000).label, "好卖");
assert.equal(aiDemandMeta(1050, 1000).label, "正常");
assert.equal(aiDemandMeta(1200, 1000).label, "限量溢价客");
assert.equal(aiDemandMeta(1400, 1000).label, "仅等玩家");
assert.equal(aiDemandMeta(1600, 1000).label, "仅等玩家");
assert.equal(aiDemandMeta(1810, 1000).label, "仅等玩家");

{
  const sorted = sortHallRooms([
    { id: "a", startedAt: 1, likes: 1, totalSales: 0, stockCount: 2 },
    { id: "b", startedAt: 3, likes: 9, totalSales: 1, stockCount: 1 },
    { id: "c", startedAt: 2, likes: 2, totalSales: 5, stockCount: 8 }
  ], "stock");
  assert.deepEqual(sorted.map((room) => room.id), ["c", "a", "b"]);
}

{
  resetLivestreamChatFeeds();
  const room = {
    id: "room-1",
    sales: [
      { id: "s2", buyerName: "晴", productName: "冰种扣", price: 12800, buyerType: "player" },
      { id: "s1", buyerName: "AI翠友", productName: "平安扣", price: 6600, buyerType: "ai" }
    ]
  };
  const feedA = buildLivestreamChatFeed(room, { id: "item-1" }, 0);
  assert.equal(feedA.filter((row) => row.type === "chat").length, 0);
  // 真实成交不进公屏，只保留氛围评论通道
  assert.equal(feedA.filter((row) => row.type === "sale").length, 0);

  appendLivestreamChatComments("room-1", 2, 11);
  const feedB = buildLivestreamChatFeed(room, { id: "item-2" }, 7);
  assert.equal(feedB.filter((row) => row.type === "chat").length, 2);
  assert.equal(feedB.filter((row) => row.type === "sale").length, 0);
  // 轮播切品不应重置已有评论
  const feedC = buildLivestreamChatFeed(room, { id: "item-9" }, 99);
  assert.deepEqual(
    feedC.map((row) => `${row.type}:${row.name}:${row.text}:${row.price || ""}`),
    feedB.map((row) => `${row.type}:${row.name}:${row.text}:${row.price || ""}`)
  );
}

assert.match(mainSource, /paintProductCanvases:\s*paintJades/);
assert.doesNotMatch(mainSource, /if \(action === "scheduleLivestream"\)/);
assert.match(mainSource, /\{ id: "livestream".*type: "public"/);
assert.doesNotMatch(mainSource, /location\.id === "livestream".*livestreamPermitOwned/);
assert.match(indexSource, /逛摊 · 开播/);
assert.match(indexSource, /class="livestream-root"/);

for (const selector of [
  ".livestream-room-card",
  ".livestream-room-stage",
  ".livestream-chat-rail",
  ".livestream-chat-scroll",
  ".livestream-chat-line",
  ".livestream-recent-sales",
  ".livestream-stock-picker",
  ".livestream-host-picker",
  ".livestream-host-list",
  ".livestream-host-row",
  ".livestream-host-row.is-recommended",
  ".livestream-host-modal",
  ".livestream-host-chip",
  ".livestream-host-chip.is-style",
  ".livestream-host-badge",
  ".livestream-room-carousel",
  ".livestream-stock-list",
  ".livestream-stock-row",
  ".livestream-price-tier",
  ".livestream-owner-grid",
  ".livestream-room-footer",
  ".livestream-owner-shelf-host",
  ".livestream-shelf",
  ".livestream-replenish-modal",
  ".livestream-close-modal",
  ".livestream-buy-confirm",
  ".livestream-hall-sort",
  ".livestream-tabs",
  ".livestream-top-nav",
  ".livestream-back-btn",
  ".livestream-start-bar",
  ".livestream-picker-toolbar",
  ".livestream-picker-dock",
  ".livestream-mine-entry",
  ".livestream-tab-live"
]) {
  assert.match(stylesSource, new RegExp(selector.replace(/\./g, "\\.")));
}
assert.match(stylesSource, /\[data-theme="day"\]\s*\.livestream-root/);
assert.match(stylesSource, /\[data-theme="day"\]\s*\.livestream-room-card/);
assert.match(
  stylesSource,
  /\[data-theme="night"\]\s*\.game-modal,\s*\[data-theme="night"\]\s*\.jm-modal\s*\{[^}]*background:\s*var\(--panel\)/s
);
assert.match(stylesSource, /\[data-theme="day"\]\s*\.livestream-room-footer/);
assert.match(stylesSource, /\.jm-modal\.jm-modal-wide\.livestream-host-modal\b/);
assert.match(stylesSource, /\.livestream-replenish-modal\b/);
assert.match(stylesSource, /\.livestream-close-modal\b/);
assert.match(stylesSource, /width:\s*min\(480px/);
assert.doesNotMatch(stylesSource, /\.livestream-comment-layer\b/);
assert.doesNotMatch(stylesSource, /\.livestream-comment\.comment-1\b/);
assert.doesNotMatch(stylesSource, /\.livestream-host-preview\b/);
assert.match(stylesSource, /@media \(max-width:\s*700px\)/);
assert.match(stylesSource, /prefers-reduced-motion:\s*reduce/);
assert.match(stylesSource, /\.livestream-stock-list\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(stylesSource, /\.livestream-nav-hint\b/);
assert.match(stylesSource, /\.livestream-top-nav\.is-mine-nav\b/);
assert.match(stylesSource, /\.game-modal\.livestream-settle-modal\s+\.game-modal-lines/);
assert.match(moduleSource, /售罄自动关闭 · 离线继续营业/);
assert.match(moduleSource, /appendLivestreamChatComments/);
assert.match(moduleSource, /CHAT_TICK_MIN_MS\s*=\s*7_000/);
assert.match(moduleSource, /CHAT_TICK_MAX_MS\s*=\s*13_000/);
assert.match(settleModalSource, /modalClass:\s*"livestream-settle-modal"/);
assert.match(readFileSync("public/shell/game-modal.js", "utf8"), /payload\.modalClass/);
assert.match(
  stylesSource,
  /\.main-stage:has\(\.view\[data-view="livestream"\]\.active\s+\.livestream-owner-section\s*>\s*\.livestream-stock-picker\)/
);
assert.doesNotMatch(
  stylesSource,
  /\.main-stage:has\(\.livestream-root\s+\.livestream-owner-section\s*>\s*\.livestream-stock-picker\)/
);
assert.match(moduleSource, /livestream-picker-toolbar/);
assert.match(moduleSource, /livestream-picker-dock/);
assert.doesNotMatch(moduleSource, /定价大致贴近估值|整体偏高可能更慢出货|livestream-stock-hint/);
assert.match(stylesSource, /\.livestream-price-tools\s*\{[^}]*grid-template-columns:\s*22px\s+minmax\(0,\s*1fr\)\s+auto/s);
assert.match(stylesSource, /\.livestream-shelf-scroll\s*\{[^}]*overflow-x:\s*auto/s);
assert.match(stylesSource, /\.livestream-shelf-track\s*\{[^}]*width:\s*max-content/s);
assert.match(moduleSource, /data-livestream-shelf-scroll/);
assert.match(moduleSource, /shelfDrag/);
assert.match(moduleSource, /syncShelfCurrent/);
assert.match(moduleSource, /captureShelfScroll|restoreShelfScroll|restorePreservedShelves/);
assert.doesNotMatch(moduleSource, /shelfHost\.innerHTML\s*=\s*shelfMarkup/);
assert.match(stylesSource, /\.livestream-shelf-art\s+\.jade-opening-product\.finished[\s\S]*?background:\s*transparent/);
assert.match(stylesSource, /\.livestream-stock-row\s+\.livestream-stock-art\s+\.jade-opening-product\.finished[\s\S]*?background:\s*transparent/);
assert.match(stylesSource, /\.livestream-product-visual\s+\.jade-opening-product\.finished[\s\S]*?background:\s*transparent/);
assert.match(stylesSource, /\.livestream-room-carousel\s*\{[^}]*min-height:\s*465px/s);
assert.match(stylesSource, /\.livestream-room-stage\.is-compact\s+\.livestream-room-carousel\s*\{[^}]*min-height:\s*330px/s);

console.log("livestream-ui-smoke: wizard, shelf, owner dash and hall sort ok");
