import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createSqliteWorldPersister } from "../server/shell/sqlite-world-persist.js";
import { NPC_TARGET_STALLS } from "../shared/domain/blackmarket/npc-rules.js";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");

const PLAYER_COUNT = 12;
const STEP_MS = 15 * 60 * 1000;
const SIMULATION_DAYS = 30;
const STEPS_PER_DAY = 24 * 60 * 60 * 1000 / STEP_MS;

function roughFor(playerId) {
  return {
    id: `soak-rough-${playerId}`,
    type: "rough",
    materialStage: "rough",
    name: "耐久验证原石",
    price: 1_200,
    value: 1_600,
    trueValue: 1_600,
    mass: 1.8,
    risk: 20,
    trueQualityKey: "icy",
    visual: { seed: 17, vein: "#58a984", skin: "#6f756b" },
    windows: []
  };
}

function assertFiniteNumbers(value, location = "world") {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${location} contains a non-finite number`);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteNumbers(entry, `${location}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assertFiniteNumbers(entry, `${location}.${key}`);
  }
}

H.world.clear({ keepStartedAt: false });
assert.equal(H.persister, null, "soak test must not touch the configured user save");

const baseNow = Date.now();
for (let index = 0; index < PLAYER_COUNT; index += 1) {
  const id = `soak-player-${index}`;
  const player = H.makePlayer(id);
  player.name = `耐久掌柜${index}`;
  player.achievementPoints = 100;
  player.achievementPointsBonus = 100;
  H.normalizePlayer(player);
  H.refillOrders(player);
  H.world.setPlayer(player);

  const job = H.startProductionJob(player, "rough", roughFor(id), { label: "耐久粗加工" });
  assert.ok(job, `failed to seed production job for ${id}`);
  job.startedAt = baseNow;
  job.readyAt = baseNow + STEP_MS;

  if (index < 4) {
    const product = {
      id: `soak-product-${index}`,
      type: "bracelet",
      materialStage: "finished",
      name: `耐久测试成品${index}`,
      value: 2_000 + index * 100,
      score: 3
    };
    player.bracelets.push(product);
    const listed = H.listItemForPlayer(player, {
      type: "bracelet",
      itemId: product.id,
      price: product.value
    });
    assert.equal(listed.ok, true, listed.message);
  }
}

// Keep a full catalog throughout the asset/persistence soak. NPC rotation,
// repricing and replenishment have their own clock-driven regressions.
const simulationEndsAt = baseNow + SIMULATION_DAYS * 24 * 60 * 60 * 1000;
H.reconcileWorld(baseNow, { broadcast: false });
const npcStalls = H.state.blackStalls.filter(stall => stall.npc);
assert.equal(npcStalls.length, NPC_TARGET_STALLS);
for (const stall of npcStalls) {
  stall.npcMarketRefreshAt = simulationEndsAt + 1;
  stall.npcRotateAt = simulationEndsAt + 1;
  stall.npcRefillAt = null;
}

const dir = mkdtempSync(path.join(tmpdir(), "jade-runtime-soak-"));
const sqlitePath = path.join(dir, "world.sqlite");
let persister = createSqliteWorldPersister({ world: H.world, filePath: sqlitePath });

try {
  persister.flushSync();
  for (let step = 1; step <= SIMULATION_DAYS * STEPS_PER_DAY; step += 1) {
    const now = baseNow + step * STEP_MS;
    H.reconcileWorld(now, { broadcast: false, livestreamCatchUpMaxVisits: 60 });

    if (step % (STEPS_PER_DAY / 2) === 0) {
      const snapshot = H.world.exportSnapshot({ savedAt: now });
      assert.equal(snapshot.players.length, PLAYER_COUNT);
      assertFiniteNumbers(snapshot);
    }

    if (step % STEPS_PER_DAY === 0) {
      persister.flushSync();
      assert.equal(persister.integrityCheck(), "ok");
      assert.ok(persister.checkpoints().length <= 2);
    }

    if (step % (STEPS_PER_DAY * 5) === 0) {
      persister.close();
      persister = createSqliteWorldPersister({ world: H.world, filePath: sqlitePath });
      const restored = persister.loadIfPresent();
      assert.equal(restored.loaded, true);
      assert.equal(restored.players, PLAYER_COUNT);
      assert.equal(H.state.sockets.size, 0);
    }
  }

  const finalSnapshot = H.world.exportSnapshot({
    savedAt: simulationEndsAt
  });
  assert.equal(finalSnapshot.players.length, PLAYER_COUNT);
  assert.equal(finalSnapshot.blackStalls.filter(stall => stall.npc).length, NPC_TARGET_STALLS);
  assert.ok(H.state.auctionHistory.length <= 24, "auction history must remain bounded");
  assert.equal(H.state.listings.length, 4, "unaccepted listings remain owned throughout the soak run");
  assert.ok(H.state.listings.every((listing) => listing.npcOffer?.amount > 0), "stale listings receive optional NPC offers");
  assert.ok(
    [...H.state.players.values()].every((player) => player.jobs.length === 0),
    "all due production jobs should settle"
  );
  assert.ok(
    [...H.state.players.values()].every((player) => player.materials.length + (player.workshopDeliveries || []).flatMap((delivery) => delivery.items).length >= 1),
    "each seeded production result should remain owned"
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(finalSnapshot), "utf8") < 5 * 1024 * 1024,
    "bounded histories should keep the 30-day snapshot below 5 MiB"
  );

  persister.flushSync();
  const finalCash = new Map(
    [...H.state.players.values()].map((player) => [player.id, player.cash])
  );
  persister.close();
  persister = null;

  const restoredWorld = createMemoryWorldStore();
  const restoredPersist = createSqliteWorldPersister({
    world: restoredWorld,
    filePath: sqlitePath
  });
  const restored = restoredPersist.loadIfPresent();
  assert.equal(restored.players, PLAYER_COUNT);
  assert.equal(restoredPersist.integrityCheck(), "ok");
  assert.equal(restoredPersist.checkpoints().length, 2);
  for (const [playerId, cash] of finalCash) {
    assert.equal(restoredWorld.getPlayer(playerId)?.cash, cash);
  }
  assertFiniteNumbers(restoredWorld.exportSnapshot());
  restoredPersist.close();
} finally {
  persister?.close();
  rmSync(dir, { recursive: true, force: true });
  H.world.clear({ keepStartedAt: false });
}

console.log("runtime-soak-smoke: 30 simulated days + repeated SQLite restarts ok");
