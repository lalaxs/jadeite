import { readWorkshopServiceSource } from "./load-workshop-service-source.mjs";
import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFileSync } from "node:fs";
import * as employeeSystem from "../server/systems/employee-system.js";
import { loadResolvedStyles } from "./load-styles.mjs";
import {
  enterAuctionHall,
  initAuctionModule,
  renderAuction,
  tickAuctionClock,
  sortAuctionLots
} from "../public/auction-module.js";

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

// 公盘换场后必须退出旧会场详情，回到可操作的会场列表。
let auctionState = {
  worldStartedAt: 0,
  timing: { auction: { cadence: 1_200 } },
  me: { id: "player-1", cash: 30_000 },
  players: [],
  auctionHistory: [],
  auctionHalls: [{
    id: "novice",
    label: "新手公盘",
    active: true,
    unlocked: true,
    requiredLevel: 1,
    entryFee: 500,
    deposit: 500,
    windowRate: 0.06
  }],
  auction: {
    id: "round-1",
    hallId: "novice",
    startsAt: 0,
    endsAt: 1_200,
    entered: true,
    roughs: [],
    myBids: []
  }
};
const auctionEls = {
  auctionHalls: { innerHTML: "" },
  auctionBrief: { innerHTML: "" },
  roughPool: { innerHTML: "" },
  auctionHeadTitle: { textContent: "" },
  auctionHeadDesc: { textContent: "" }
};
const auctionToasts = [];
const auctionEmits = [];
let auctionClock = 1_000;
initAuctionModule({
  socket: { emit(...args) { auctionEmits.push(args); } },
  getState: () => auctionState,
  els: auctionEls,
  getActiveView: () => "auction",
  helpers: {
    formatMoney: (value) => `¥${value}`,
    formatDuration: (value) => String(value),
    nowMs: () => auctionClock,
    escapeHtml: (value) => String(value),
    empty: (message) => `<div class="empty">${message}</div>`,
    showToast(message) { auctionToasts.push(message); },
    clampClient: (value, min, max) => Math.max(min, Math.min(max, value)),
    paintJades() {},
    setView() {},
    CSS: {},
    openGameModal() {},
    closeGameModal() {}
  }
});
enterAuctionHall("novice");
auctionState = {
  ...auctionState,
  auction: {
    id: "round-2",
    hallId: "novice",
    startsAt: 1_200,
    endsAt: 2_400,
    entered: false,
    roughs: [],
    myBids: []
  }
};
renderAuction();
expect(
  auctionEls.auctionHalls.innerHTML.includes("新手公盘")
    && auctionEls.roughPool.innerHTML === "",
  "auction round rollover should return the player to the hall list instead of leaving an empty old hall"
);

// 现金不足时不得进入「确认入场」页，应留在会场列表并飘字提示。
{
  const emitsBefore = auctionEmits.length;
  const toastsBefore = auctionToasts.length;
  auctionState = {
    ...auctionState,
    me: { id: "player-1", cash: 200 },
    auction: {
      id: "round-2b",
      hallId: "novice",
      startsAt: 1_200,
      endsAt: 2_400,
      entered: false,
      roughs: [],
      myBids: [],
      entryFee: 500
    }
  };
  enterAuctionHall("novice");
  expect(
    auctionEls.auctionHalls.innerHTML.includes("新手公盘")
      && auctionEls.roughPool.innerHTML === ""
      && auctionEmits.length === emitsBefore
      && auctionToasts.length === toastsBefore + 1
      && /现金不足/.test(String(auctionToasts.at(-1)?.text || auctionToasts.at(-1) || "")),
    "insufficient cash should block hall entry with a floating toast and stay on the hall list"
  );
}

// 公盘料子：已暗标优先，其次开窗；已暗标卡片要有图上暗标金额提示。
auctionState = {
  ...auctionState,
  me: { id: "player-1", cash: 20_000 },
  auction: {
    id: "round-3",
    hallId: "novice",
    startsAt: 2_400,
    endsAt: 3_600,
    entered: true,
    roughs: [
      { id: "r-plain", name: "素料", price: 8_000, mass: 1 },
      { id: "r-window", name: "开窗料", price: 9_000, mass: 1.2, windows: [{ x: 40, y: 40 }] },
      { id: "r-bid", name: "已暗标料", price: 7_000, mass: 0.9 },
      { id: "r-bid-window", name: "暗标开窗料", price: 12_000, mass: 1.1, windows: [{ x: 50, y: 50 }] },
      { id: "r-locked", name: "买不起", price: 50_000, mass: 2 }
    ],
    myBids: [
      { roughId: "r-bid", amount: 7_500, escrowed: 7_500 },
      { roughId: "r-bid-window", amount: 13_000, escrowed: 13_000 }
    ]
  }
};
renderAuction(); // 换场同步会清掉会场选择，先吃掉 round 变更
{
  const ordered = sortAuctionLots(auctionState.auction.roughs, auctionState.me).map((item) => item.id);
  expect(
    ordered.join(",") === "r-bid-window,r-bid,r-window,r-plain,r-locked",
    "auction lots should sort as mine-bid+window, mine-bid, windowed, plain, unaffordable"
  );
}
enterAuctionHall("novice");
expect(
  /is-mine-bid/.test(auctionEls.roughPool.innerHTML)
    && /is-windowed/.test(auctionEls.roughPool.innerHTML)
    && /lot-seal/.test(auctionEls.roughPool.innerHTML)
    && /lot-bid-chip/.test(auctionEls.roughPool.innerHTML)
    && /lot-window-bar/.test(auctionEls.roughPool.innerHTML)
    && /已出价/.test(auctionEls.roughPool.innerHTML)
    && /已开窗 ·/.test(auctionEls.roughPool.innerHTML)
    && /我的出价/.test(auctionEls.roughPool.innerHTML)
    && !/当前出价/.test(auctionEls.roughPool.innerHTML),
  "bidded auction lots should show mine-bid chrome and sealed-bid copy"
);
{
  const names = [...auctionEls.roughPool.innerHTML.matchAll(/class="lot-name">([^<]+)</g)].map((m) => m[1]);
  expect(
    names.join(",") === "暗标开窗料,已暗标料,开窗料,素料,买不起",
    "rendered auction lot grid should follow the smart sort order"
  );
}

// 即使服务端还未推送新快照，最后两分钟也必须立即清掉已显示的最高价。
auctionState.auction = { ...auctionState.auction, id: "round-clock-boundary", startsAt: 1_000, endsAt: 601_000,
  roughs: auctionState.auction.roughs.map((rough) => ({ ...rough, highestOtherBid: 123456 })) };
renderAuction();
enterAuctionHall("novice");
expect(auctionEls.roughPool.innerHTML.includes("¥123456"), "open phase should display the current competing price");
auctionClock = 481_000;
tickAuctionClock();
expect(!auctionEls.roughPool.innerHTML.includes("¥123456"), "clock transition must remove a cached competing price");
expect(auctionEls.roughPool.innerHTML.includes("他人最高出价已隐藏"), "clock transition should explain the sealed phase");

// 招募与加工经济：候选人展示日工资，工坊不按次收取工资。
expect(
  typeof employeeSystem.baseWageForTier === "function",
  "employee system should expose a base wage formula"
);
expect(
  typeof employeeSystem.workerProcessingFee === "function",
  "employee system should expose the per-processing worker fee"
);
if (typeof employeeSystem.baseWageForTier === "function") {
  expect(
    employeeSystem.baseWageForTier(5) > employeeSystem.baseWageForTier(1),
    "higher-tier workers should have a higher base wage"
  );
}

const hireSource = readFileSync(new URL("../public/features/hire/hire-module.js", import.meta.url), "utf8");
const collectionSource = readFileSync(new URL("../public/features/collection/collection-module.js", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const wireSource = readFileSync(new URL("../server/boot/wire-server.js", import.meta.url), "utf8");
const workshopServiceSource = readWorkshopServiceSource();
const bootSource = `${serverSource}\n${wireSource}\n${workshopServiceSource}`;
const mainEntry = readFileSync(new URL("../public/main.js", import.meta.url), "utf8");
const mainSource = readClientShellSource();
const stylesSource = loadResolvedStyles();
expect(
  /recruit-trait-chip pos/.test(hireSource) && /recruit-trait-chip neg/.test(hireSource),
  "positive and negative recruit traits should use one shared chip component"
);
expect(
  /日工资\s*\/\s*日/.test(hireSource),
  "recruit cards and details should label the worker daily wage"
);
expect(
  /workerProcessingFee/.test(bootSource),
  "the authoritative workshop start path should share the zero processing fee rule"
);

// 藏品卡必须拥有独立的主题表面，而不是继承只适合白天的通用卡片底色。
expect(
  /treasure-card-visual/.test(collectionSource) && /treasure-card-value/.test(collectionSource),
  "collection entries should expose a themed visual area and value hierarchy"
);
expect(
  /\[data-theme="night"\]\s+\.treasure-card\s*\{[^}]*background:\s*var\(--night-surface-2\)/s.test(stylesSource),
  "night collection cards should use the shared night surface"
);
expect(
  /\.treasure-card-visual\s+\.component-jewelry-product\s*,\s*\.treasure-card-visual\s+\.jade-opening-product\s*,\s*\.treasure-card-visual\s+\.jade-canvas\s*\{[^}]*background:\s*transparent/s.test(stylesSource),
  "collection product previews should not keep the generic pale thumbnail backing"
);
expect(
  /\.view\[data-view="collection"\]\s+\.treasure-grid\s*>\s*\.empty\s*\{[^}]*max-width:\s*none/s.test(stylesSource),
  "the empty collection frame should use the same full-width content boundary as other views"
);

// 同一毛坯会同时出现在工坊、选择弹窗和精加工弹窗；SVG id 必须逐实例唯一。
const openingProductSource = mainSource.match(
  /function openingProductSvg[\s\S]*?\n}\n\nfunction productCutoutPlaceholder/
)?.[0] || "";
expect(
  !/idPrefix\s*:/.test(openingProductSource),
  "source-material product cutouts should not reuse a deterministic SVG id prefix across simultaneous previews"
);
expect(
  /\.ws-pick-material\s+\.wsp-thumb\s+\.jade-opening-product\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s.test(stylesSource),
  "finishing material thumbnails should let the kit-shaped cutout fill the preview frame"
);

assert.deepEqual(failures, [], failures.join("\n"));
console.log("experience-regressions-smoke: rollover, lot sort/bid chrome, wages, collection theme and cutouts ok");
