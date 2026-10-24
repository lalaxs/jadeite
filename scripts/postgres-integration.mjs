import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createDurableMutationCoordinator } from "../server/services/durable-mutation-coordinator.js";
import { createServerContext } from "../server/shell/server-context.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createPostgresWorldPersister } from "../server/shell/postgres-world-persist.js";
import { createMetrics } from "../server/observability/metrics.js";

const { Pool } = pg;
const connectionString = String(process.env.TEST_DATABASE_URL || "").trim();
if (!connectionString) {
  throw new Error("postgres-integration: TEST_DATABASE_URL is required (use a disposable test database)");
}

const schema = `jade_integration_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString, max: 1 });
const testPool = new Pool({
  connectionString,
  max: 4,
  options: `-c search_path=${schema}`
});
let writer = null;
let reader = null;
const metrics = createMetrics();

try {
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const world = createMemoryWorldStore();
  world.setPlayer({ id: "pg-fixture-1", name: "集成测试玩家", cash: 1000, rep: 10, level: 1, processedRequestIds: [], ledger: [], rough: [], jobs: [], polishingJobs: [], materials: [], slices: [], bracelets: [], collection: [] });
  world.setPlayer({ ...structuredClone(world.getPlayer("pg-fixture-1")), id: "pg-fixture-2" });
  world.getPlayer("pg-fixture-1").bracelets.push({ id: "pg-transfer-item", type: "bracelet", value: 123 });
  writer = createPostgresWorldPersister({ world, pool: testPool, metrics, intervalMs: 60_000 });
  await writer.initialize();
  await writer.flush({ rebuildProjections: true });
  const inventoryVersion = (await testPool.query("SELECT xmin::text AS version FROM jade_inventory_projection WHERE item_id = 'pg-transfer-item'")).rows[0].version;

  const player = world.allPlayers()[0];
  assert.ok(player?.id, "fixture must contain at least one player");
  const savedAt = Date.now();
  const before = world.exportSnapshot({ savedAt });
  const expectedName = `集成测试-${savedAt}`;
  player.name = expectedName;
  player.processedRequestIds = [...(player.processedRequestIds || []), `pg-${savedAt}`].slice(-64);
  const after = world.exportSnapshot({ savedAt });
  await writer.flush({
    beforeSnapshot: before,
    snapshot: after,
    savedAt,
    action: "integration:set-name",
    actorId: player.id,
    requestId: `pg-${savedAt}`
  });

  const mutationCount = Number((await testPool.query("SELECT COUNT(*) AS count FROM jade_world_mutations")).rows[0].count);
  assert.equal(mutationCount, 1);
  const projection = await testPool.query(
    "SELECT display_name FROM jade_player_projection WHERE player_id = $1",
    [player.id]
  );
  assert.equal(projection.rows[0]?.display_name, expectedName);
  assert.equal((await testPool.query("SELECT xmin::text AS version FROM jade_inventory_projection WHERE item_id = 'pg-transfer-item'")).rows[0].version,
    inventoryVersion, "name change must leave existing inventory rows untouched");

  const restored = createMemoryWorldStore();
  reader = createPostgresWorldPersister({ world: restored, pool: testPool, intervalMs: 60_000 });
  const result = await reader.loadIfPresent();
  assert.equal(result.replayedMutations, 1);
  assert.equal(restored.getPlayer(player.id)?.name, expectedName);
  assert.equal((await reader.healthCheck()).ok, true);
  const coordinator = createDurableMutationCoordinator({ world, flush: (options) => writer.flush(options),
    recordAudit: (entry) => writer.recordAudit(entry), logger: { error() {}, warn() {} } });
  const context = createServerContext({ world, getState: () => world.raw, io: {}, randomUUID });
  const sharedKey = `pg-${savedAt}`;
  await coordinator.run("integration:set-name", () => {
    const other = world.getPlayer("pg-fixture-2");
    assert.equal(context.consumeRequestId(other, sharedKey), true);
    other.name = "另一个玩家使用相同请求号";
    other.cash -= 7;
  }, { actorId: "pg-fixture-2", requestId: sharedKey });
  assert.equal(Number((await testPool.query("SELECT COUNT(*) AS count FROM jade_world_mutations")).rows[0].count), 2);
  for (let i = 0; i < 201; i++) {
    const key = `eviction-${i}`;
    await coordinator.run("integration:spend", () => {
      const current = world.getPlayer(player.id);
      assert.equal(context.consumeRequestId(current, key), true);
      current.cash -= 1;
    }, { actorId: player.id, requestId: key });
  }
  await coordinator.run("integration:set-name", () => {
    const current = world.getPlayer(player.id);
    assert.equal(context.consumeRequestId(current, sharedKey), true, "an evicted request key may represent a new command");
    current.name = "淘汰后再次使用请求号";
    current.cash -= 3;
  }, { actorId: player.id, requestId: sharedKey });
  const countBeforeDuplicate = Number((await testPool.query("SELECT COUNT(*) AS count FROM jade_world_mutations")).rows[0].count);
  await coordinator.run("integration:set-name", () => {
    assert.equal(context.consumeRequestId(world.getPlayer(player.id), sharedKey), false);
  }, { actorId: player.id, requestId: sharedKey });
  assert.equal(Number((await testPool.query("SELECT COUNT(*) AS count FROM jade_world_mutations")).rows[0].count), countBeforeDuplicate);
  const replayed = createMemoryWorldStore();
  const replayReader = createPostgresWorldPersister({ world: replayed, pool: testPool });
  await replayReader.loadIfPresent();
  assert.equal(replayed.getPlayer(player.id).cash, 796);
  assert.equal(replayed.getPlayer(player.id).name, "淘汰后再次使用请求号");
  assert.equal(replayed.getPlayer("pg-fixture-2").cash, 993);
  assert.equal(replayed.getPlayer("pg-fixture-2").name, "另一个玩家使用相同请求号");
  assert.equal(Number((await testPool.query("SELECT cash FROM jade_player_projection WHERE player_id = $1", [player.id])).rows[0].cash), 796);
  assert.equal(Number((await testPool.query("SELECT COUNT(*) AS count FROM jade_idempotency_keys WHERE player_id = $1", [player.id])).rows[0].count), 200);
  assert.equal((await testPool.query("SELECT request_id FROM jade_idempotency_keys WHERE player_id = $1 AND request_id = 'eviction-0'", [player.id])).rows.length, 0);
  await coordinator.run("integration:transfer", () => {
    // Access receiver first: deletion and upsert ordering must not lose the transfer.
    const receiver = world.getPlayer("pg-fixture-2");
    const sender = world.getPlayer(player.id);
    receiver.collection.push(sender.bracelets.pop());
  });
  let itemProjection = (await testPool.query("SELECT owner_player_id, location, payload FROM jade_inventory_projection WHERE item_id = 'pg-transfer-item'")).rows[0];
  assert.equal(itemProjection.owner_player_id, "pg-fixture-2");
  assert.equal(itemProjection.location, "collection");
  await coordinator.run("integration:edit-item", () => { world.getPlayer("pg-fixture-2").collection[0].value = 456; });
  itemProjection = (await testPool.query("SELECT payload FROM jade_inventory_projection WHERE item_id = 'pg-transfer-item'")).rows[0];
  assert.equal(itemProjection.payload.value, 456);
  await testPool.query(`CREATE FUNCTION reject_test_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.payload->>'value' = '999' THEN RAISE EXCEPTION 'injected projection failure'; END IF; RETURN NEW; END $$`);
  await testPool.query("CREATE TRIGGER reject_test_inventory BEFORE UPDATE ON jade_inventory_projection FOR EACH ROW EXECUTE FUNCTION reject_test_inventory()");
  const journalBeforeProjectionFailure = Number((await testPool.query("SELECT COUNT(*) AS count FROM jade_world_mutations")).rows[0].count);
  await assert.rejects(coordinator.run("integration:projection-fail", () => {
    const receiver = world.getPlayer("pg-fixture-2"); receiver.cash -= 10; receiver.collection[0].value = 999;
  }), /injected projection failure/);
  assert.equal(world.getPlayer("pg-fixture-2").cash, 993);
  assert.equal(world.getPlayer("pg-fixture-2").collection[0].value, 456);
  assert.equal(Number((await testPool.query("SELECT COUNT(*) AS count FROM jade_world_mutations")).rows[0].count), journalBeforeProjectionFailure);
  assert.equal(Number((await testPool.query("SELECT cash FROM jade_player_projection WHERE player_id = 'pg-fixture-2'")).rows[0].cash), 993);
  const transferredReplay = createMemoryWorldStore();
  await createPostgresWorldPersister({ world: transferredReplay, pool: testPool }).loadIfPresent();
  assert.equal(transferredReplay.getPlayer(player.id).bracelets.length, 0);
  assert.equal(transferredReplay.getPlayer("pg-fixture-2").collection[0].value, 456);
  await testPool.query(`CREATE FUNCTION reject_test_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action = 'integration:fail' THEN RAISE EXCEPTION 'injected write failure'; END IF; RETURN NEW; END $$`);
  await testPool.query("CREATE TRIGGER reject_test_mutation BEFORE INSERT ON jade_world_mutations FOR EACH ROW EXECUTE FUNCTION reject_test_mutation()");
  const failing = coordinator.run("integration:fail", () => { world.getPlayer(player.id).cash -= 50; });
  const failure = assert.rejects(failing, /injected write failure/);
  const checkpoint = coordinator.checkpoint(() => writer.flush());
  const committedRead = coordinator.read(() => world.getPlayer(player.id).cash);
  await failure;
  await checkpoint;
  assert.equal(await committedRead, 796);
  const afterFailure = createMemoryWorldStore();
  await createPostgresWorldPersister({ world: afterFailure, pool: testPool }).loadIfPresent();
  assert.equal(afterFailure.getPlayer(player.id).cash, 796, "checkpoint must not retain a failed command");
  assert.match(metrics.render(), /jade_persistence_transaction_milliseconds_count\{kind="mutation",outcome="failed"\} 2/,
    "both a projection failure and a journal failure must be recorded");
  await coordinator.close();
  console.log("postgres-integration: 4 migrations + selective projections + reverse-order transfer + item edits + projection rollback + 200-key eviction/reuse + restart replay + checkpoint isolation ok");
} finally {
  await writer?.close?.().catch(() => {});
  await reader?.close?.().catch(() => {});
  await testPool.end().catch(() => {});
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await adminPool.end().catch(() => {});
}
