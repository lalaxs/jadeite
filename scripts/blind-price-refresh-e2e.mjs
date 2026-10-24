/**
 * Self-test: rough stones in blind pool + placeholder blindPrice=1
 * must resolve to pool-average and survive public snapshot / “refresh”.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import {
  BLACKMARKET_BLIND_MIN,
  BLACKMARKET_MIN_PRICE,
  publicBlackStall,
  ensureBlindStallResolvedPrice,
  updateBlackStallMetaForPlayer,
  addBlindboxItemsForPlayer,
  openBlackStallForPlayer,
  closeBlackStallForPlayer
} from "../server/services/blackmarket-service.js";
import { publicStone } from "../server/services/snapshot-public.js";

function reset() {
  H.state.players.clear();
  H.state.sockets.clear();
  H.state.blackStalls.length = 0;
  H.state.news.length = 0;
}

function install(id) {
  const player = H.makePlayer(id);
  H.normalizePlayer(player);
  player.id = id;
  player.name = `测-${id}`;
  player.cash = 999999;
  player.achievementPoints = Math.max(Number(player.achievementPoints) || 0, 680);
  H.state.players.set(id, player);
  return player;
}

function makeRough(id, price) {
  return {
    id,
    type: "rough",
    name: `黄雾后江料-${id}`,
    price,
    trueValue: price * 2,
    trueQualityKey: "bean",
    revealed: false,
    materialStage: "rough",
    publicHint: "黄雾皮壳"
  };
}

reset();
const seller = install("blind-refresh-rough");
assert.equal(openBlackStallForPlayer(seller, {
  type: "blindbox",
  title: "刷新定价-原石",
  anonymous: false
}).ok, true);

const prices = [];
const entries = [];
for (let i = 0; i < BLACKMARKET_BLIND_MIN; i += 1) {
  const price = 4200 + i * 180;
  prices.push(price);
  const stone = makeRough(`rg-${i}`, price);
  seller.rough.push(stone);
  entries.push({ type: "rough", itemId: stone.id });
}
const expectedAvg = Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length);

const put = addBlindboxItemsForPlayer(seller, entries, { blindPrice: BLACKMARKET_MIN_PRICE });
assert.equal(put.ok, true, put.message);
assert.equal(put.blindPrice, expectedAvg, `put with blindPrice=1 must use rough pool avg, got ${put.blindPrice}`);
assert.equal(H.state.blackStalls[0].blindPrice, expectedAvg);

// Simulate stale stall stuck at ¥1 (旧进程写入) → lifecycle maintenance heals it.
H.state.blackStalls[0].blindPrice = BLACKMARKET_MIN_PRICE;
const healed = ensureBlindStallResolvedPrice(H.state.blackStalls[0]);
assert.equal(healed, expectedAvg);
assert.equal(H.state.blackStalls[0].blindPrice, expectedAvg);

H.state.blackStalls[0].blindPrice = BLACKMARKET_MIN_PRICE;
const beforePublicUpdatedAt = H.state.blackStalls[0].updatedAt;
const pub = publicBlackStall(H.state.blackStalls[0], seller.id, publicStone);
assert.equal(pub.blindPrice, expectedAvg, "publicBlackStall must display the resolved price");
assert.equal(H.state.blackStalls[0].blindPrice, BLACKMARKET_MIN_PRICE, "public reads must not write the resolved price");
assert.equal(H.state.blackStalls[0].updatedAt, beforePublicUpdatedAt, "public reads must not touch stall timestamps");
assert.ok((pub.pool || []).length >= BLACKMARKET_BLIND_MIN);
assert.ok(pub.pool.every((row) => Number(row.item?.price) > 0), "owner pool must expose price for client suggested");

assert.equal(H.processExpiredBlindDraws(H.state, 123456), true);
assert.equal(H.state.blackStalls[0].blindPrice, expectedAvg, "runtime maintenance must persist the resolved price");
assert.equal(H.state.blackStalls[0].updatedAt, 123456);

const meta = updateBlackStallMetaForPlayer(seller, { blindPrice: BLACKMARKET_MIN_PRICE });
assert.equal(meta.ok, true, meta.message);
assert.equal(H.state.blackStalls[0].blindPrice, expectedAvg, "meta=1 must not wipe healed price");

const snap = H.snapshotFor(seller);
const mine = (snap.blackStalls || []).find((row) => row.isMine);
assert.ok(mine);
assert.equal(mine.blindPrice, expectedAvg, "snapshot after refresh must keep avg, not ¥1");

const client = [
  "public/features/blackmarket/shared.js",
  "public/features/blackmarket/plaza.js",
  "public/features/blackmarket/goods.js",
  "public/features/blackmarket/blind-ui.js",
  "public/features/blackmarket/service-ui.js",
  "public/features/blackmarket/actions.js",
  "public/features/blackmarket/index.js"
].map((p) => readFileSync(p, "utf8")).join("\n");
assert.match(client, /function bmBlindDisplayPrice/);
assert.match(client, /reconcileBmBlindPlaceholderPrice\(bmMyStall\(\)\)/);

closeBlackStallForPlayer(seller);
console.log(`blind-price-refresh-e2e: ok (rough avg ¥${expectedAvg} survives refresh/heal)`);
process.exit(0);
