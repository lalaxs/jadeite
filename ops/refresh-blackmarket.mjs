import assert from "node:assert/strict";
import { copyFileSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { __testHooks as H } from "../server.js";
import { maintainNpcBlackmarket } from "../server/services/blackmarket/npc.js";
import { NPC_STALLS, NPC_SHIFT_MS } from "../shared/domain/blackmarket/npc-rules.js";
import { BLACKMARKET_GOODS_BUCKETS, isBlackmarketGoodsType } from "../shared/domain/blackmarket/bm-constants.js";
import { isBlackmarketResource, resourceBucket } from "../shared/domain/blackmarket/bm-resources.js";
import { createWorldPersister } from "../server/shell/world-persist.js";

// Offline maintenance only. Never write a save while its server is running.
export function refreshBlackmarketSnapshot(snapshot, now = Date.now()) {
  H.world.importSnapshot(structuredClone(snapshot));
  const state = H.state;
  const previous = H.world.exportSnapshot({ savedAt: now });
  const expectedPlayers = new Map(structuredClone(previous.players));
  const oldItemIds = new Set(state.blackStalls.flatMap((stall) => (stall.items || []).map((row) => row.item.id)));
  const playerStalls = state.blackStalls.filter((stall) => stall.npc !== true);
  assert.ok(!state.blackStalls.some((stall) => stall.blindDraw), "A blind draw is active; finish it before refreshing.");
  assert.ok(!state.blackServiceOrders.some((order) => ["pending", "escrow", "delivered"].includes(order.status)), "Service orders are active; finish them before refreshing.");
  const returned = [];
  for (const stall of playerStalls) {
    assert.ok(state.players.has(stall.ownerId), `Missing owner for stall ${stall.id}`);
    assert.ok(["goods", "blindbox", "service"].includes(stall.type), "Unknown stall type");
    const owner = state.players.get(stall.ownerId);
    for (const row of stall.type === "goods" ? stall.items || [] : stall.type === "blindbox" ? stall.pool || [] : []) {
      assert.ok(isBlackmarketGoodsType(row.type), "Unknown player stock type");
      assert.ok(row.item?.id, "Player stock has no item ID");
      assert.ok(!Object.values(BLACKMARKET_GOODS_BUCKETS).some((bucket) => owner[bucket]?.some((item) => item.id === row.item.id)), "Player stock already exists in inventory");
      returned.push({ ownerId: owner.id, itemId: row.item.id, type: row.type });
      if (isBlackmarketResource(row.type)) {
        const resource = expectedPlayers.get(owner.id).workshop[resourceBucket(row.type)].find((item) => item.id === row.item.id);
        assert.ok(resource, "Listed resource is missing from its owner's workshop");
        delete resource.blackmarketListingId;
        continue;
      }
      const bucket = BLACKMARKET_GOODS_BUCKETS[row.type];
      (expectedPlayers.get(owner.id)[bucket] ||= []).push(structuredClone(row.item));
    }
  }
  for (const stall of playerStalls) {
    const result = H.closeBlackStallForPlayer(state.players.get(stall.ownerId));
    assert.equal(result.ok, true, result.message);
  }
  for (const stall of state.blackStalls) {
    const rule = NPC_STALLS.find((entry) => entry.role === stall.npcRole);
    if (!rule) continue;
    stall.items = [];
    stall.ownerName = rule.ownerName;
    stall.createdAt = stall.updatedAt = now;
    stall.npcBatch = -1;
    stall.npcDiscountIssued = stall.npcPremiumIssued = 0;
    delete stall.npcScheduleVersion;
    stall.npcRefillAt = null;
    stall.npcShiftAt = now + NPC_SHIFT_MS;
    // Retain the sequence so replacing shelves also advances their assortment.
  }
  maintainNpcBlackmarket(now);
  const freshItems = state.blackStalls.flatMap((stall) => stall.items);
  assert.equal(state.blackStalls.length, NPC_STALLS.length);
  assert.ok(freshItems.every((row) => !oldItemIds.has(row.item.id)), "Old stock survived the refresh");
  assert.deepEqual([...state.players], [...expectedPlayers], "Only the returned inventory may change player data");
  const next = H.world.exportSnapshot({ savedAt: now });
  for (const key of Object.keys(previous)) {
    if (!["players", "blackStalls", "news"].includes(key)) assert.deepEqual(next[key], previous[key], `Unexpected change to ${key}`);
  }
  return { snapshot: next, summary: { removedStalls: snapshot.blackStalls.length, newStalls: state.blackStalls.length, newItems: freshItems.length, returned } };
}

async function requireStoppedServer(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", () => reject(new Error(`Stop the game server on port ${port} before applying this operation.`)));
    probe.listen(port, "0.0.0.0", resolve);
  });
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
}

async function main() {
  const args = process.argv.slice(2);
  const filePath = path.resolve(args.find((arg) => !arg.startsWith("--")) || "data/world.json");
  const apply = args.includes("--apply");
  const port = Number(args.find((arg) => arg.startsWith("--port="))?.split("=")[1] || 3000);
  if (apply) await requireStoppedServer(port);
  const source = readFileSync(filePath, "utf8");
  const result = refreshBlackmarketSnapshot(JSON.parse(source));
  let backupPath = null;
  if (apply) {
    assert.equal(readFileSync(filePath, "utf8"), source, "Save changed during maintenance; refusing to overwrite it.");
    backupPath = `${filePath}.blackmarket-refresh-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    copyFileSync(filePath, backupPath);
    createWorldPersister({ world: H.world, filePath }).flushSync();
  }
  console.log(JSON.stringify({ applied: apply, filePath, backupPath, ...result.summary }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
