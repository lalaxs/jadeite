/**
 * collection-service: 藏宝阁入库/放回从 socket 层剥离后的行为契约。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCollectionService } from "../server/services/collection-service.js";
import { MAX_COLLECTION_SIZE } from "../shared/domain/progression/player-progression.js";

function makePlayer(overrides = {}) {
  return {
    id: "p1",
    name: "测掌柜",
    bracelets: [],
    collection: [],
    stats: {},
    ...overrides
  };
}

const news = [];
const tasks = [];
const {
  collectBraceletForPlayer,
  returnCollectionItemForPlayer
} = createCollectionService({
  takeItem(player, type, id) {
    if (type !== "bracelet") return null;
    const i = player.bracelets.findIndex((b) => b.id === id);
    if (i < 0) return null;
    return player.bracelets.splice(i, 1)[0];
  },
  restoreWorkshopItem(player, item) {
    player.bracelets.push(item);
  },
  materialStageFor(item) {
    return item.materialStage || "finished";
  },
  advanceTask(player, key) {
    tasks.push(key);
  },
  settlePlayerAchievements() {},
  addNews(text, tone) {
    news.push({ text, tone });
  }
});

// missing item → silent fail (matches旧 socket 行为)
{
  const player = makePlayer();
  const result = collectBraceletForPlayer(player, "missing");
  assert.equal(result.ok, false);
  assert.equal(result.silent, true);
}

// unfinished → restore + message
{
  const player = makePlayer({
    bracelets: [{ id: "b1", name: "半成品", value: 5000, materialStage: "carved" }]
  });
  const result = collectBraceletForPlayer(player, "b1");
  assert.equal(result.ok, false);
  assert.match(result.message, /最终成品/);
  assert.equal(player.bracelets.length, 1);
  assert.equal(player.collection.length, 0);
}

// escrow → reject
{
  const player = makePlayer({
    bracelets: [{ id: "b2", name: "委托货", value: 8000, materialStage: "finished", escrowOrderId: "o1" }]
  });
  const result = collectBraceletForPlayer(player, "b2");
  assert.equal(result.ok, false);
  assert.match(result.message, /委托物/);
  assert.equal(player.bracelets.length, 1);
}

// happy path + full + return
{
  news.length = 0;
  tasks.length = 0;
  const finished = { id: "b3", name: "玻璃种戒面", value: 30000, materialStage: "finished" };
  const player = makePlayer({ bracelets: [finished] });
  const collected = collectBraceletForPlayer(player, "b3");
  assert.equal(collected.ok, true);
  assert.equal(player.bracelets.length, 0);
  assert.equal(player.collection.length, 1);
  assert.equal(player.stats.collectionUniqueCount, 1);
  assert.equal(player.collection[0].frozen, true);
  assert.equal(tasks[0], "collection_collect");
  assert.ok(collected.uiEvent);
  assert.match(collected.toast, /已收入藏宝阁/);

  // fill to cap
  for (let i = player.collection.length; i < MAX_COLLECTION_SIZE; i += 1) {
    player.collection.push({ id: `pad-${i}`, name: `垫货${i}`, value: 100, frozen: true });
  }
  player.bracelets.push({ id: "b4", name: "多余", value: 9000, materialStage: "finished" });
  const full = collectBraceletForPlayer(player, "b4");
  assert.equal(full.ok, false);
  assert.match(full.message, /已满/);

  const returned = returnCollectionItemForPlayer(player, "b3");
  assert.equal(returned.ok, true);
  assert.ok(player.bracelets.some((b) => b.id === "b3"));
  assert.ok(!player.collection.some((c) => c.id === "b3"));
  assert.equal(player.bracelets.find((b) => b.id === "b3").frozen, undefined);

  const recollected = collectBraceletForPlayer(player, "b3");
  assert.equal(recollected.ok, true);
  assert.equal(player.stats.collectionUniqueCount, 1, "returning and re-collecting must not inflate unique collection progress");
}

// socket-handlers 不再内联业务
const handlers = readFileSync("server/shell/socket-handlers.js", "utf8");
assert.match(handlers, /collectBraceletForPlayer/);
assert.match(handlers, /returnCollectionItemForPlayer/);
assert.doesNotMatch(handlers, /MAX_COLLECTION_SIZE/);
assert.doesNotMatch(handlers, /player\.collection\.push/);
assert.match(handlers, /from "\.\/workshop-start-handler\.js"/);

const wire = readFileSync("server/boot/wire-server.js", "utf8");
assert.match(wire, /createCollectionService/);

console.log("collection-service-smoke: ok");
