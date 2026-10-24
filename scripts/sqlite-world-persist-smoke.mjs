import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createWorldPersister } from "../server/shell/world-persist.js";
import {
  SQLITE_WORLD_SCHEMA_VERSION,
  createSqliteWorldPersister,
  resolveWorldSqlitePath
} from "../server/shell/sqlite-world-persist.js";
import {
  createWorldPersisterForEnvironment,
  resolveWorldPersistDriver
} from "../server/shell/world-persistence.js";

assert.equal(resolveWorldPersistDriver({}), "json");
assert.equal(resolveWorldPersistDriver({ JADE_WORLD_PERSIST_DRIVER: "SQLITE" }), "sqlite");
assert.throws(
  () => resolveWorldPersistDriver({ JADE_WORLD_PERSIST_DRIVER: "redis" }),
  /unsupported driver redis/
);
assert.ok(
  resolveWorldSqlitePath({ JADE_WORLD_SQLITE_PATH: "tmp/save.db" }, process.cwd())
    .endsWith(path.join("tmp", "save.db"))
);

const dir = mkdtempSync(path.join(tmpdir(), "jade-sqlite-world-"));
try {
  const sqlitePath = path.join(dir, "world.sqlite");
  const world = createMemoryWorldStore({ startedAt: 10_000 });
  const livePlayer = { id: "sqlite-player", name: "银库", cash: 100, lastSeenAt: 50 };
  world.setPlayer(livePlayer);
  world.bindSocket("live-socket", livePlayer.id);

  const persister = createSqliteWorldPersister({
    world,
    filePath: sqlitePath,
    intervalMs: 60_000
  });
  assert.equal(persister.driver, "sqlite");
  assert.equal(persister.loadIfPresent().loaded, false);
  assert.equal(persister.integrityCheck(), "ok");

  const firstSaveAt = Date.now();
  persister.flushSync();
  assert.equal(existsSync(sqlitePath), true);
  assert.equal(livePlayer.lastSeenAt, 50, "SQLite export must not mutate the live online player");
  livePlayer.cash = 200;
  persister.flushSync();
  livePlayer.cash = 300;
  persister.flushSync();
  const retained = persister.checkpoints();
  assert.equal(retained.length, 2, "only the two newest complete checkpoints are retained");
  assert.ok(retained[0].savedAt >= firstSaveAt);
  assert.equal(retained[0].playerCount, 1);
  persister.close();

  const metadataDb = new DatabaseSync(sqlitePath);
  assert.equal(
    Number(metadataDb.prepare("PRAGMA user_version").get().user_version),
    SQLITE_WORLD_SCHEMA_VERSION
  );
  const latestId = metadataDb.prepare("SELECT MAX(id) AS id FROM world_snapshots").get().id;
  metadataDb.prepare("UPDATE world_snapshots SET payload = ? WHERE id = ?")
    .run("{broken-checkpoint", latestId);
  metadataDb.close();

  const recoveredWorld = createMemoryWorldStore();
  const recoveryPersister = createSqliteWorldPersister({
    world: recoveredWorld,
    filePath: sqlitePath
  });
  const recovery = recoveryPersister.loadIfPresent();
  assert.equal(recovery.loaded, true);
  assert.equal(recovery.recoveredFromBackup, true);
  assert.match(recovery.primaryError, /checksum mismatch/);
  assert.equal(recoveredWorld.getPlayer("sqlite-player")?.cash, 200);
  assert.equal(recoveredWorld.raw.sockets.size, 0);

  const checkpointsBeforeRejectedExport = recoveryPersister.checkpoints();
  recoveredWorld.getPlayer("sqlite-player").cash = Infinity;
  assert.throws(
    () => recoveryPersister.flushSync(),
    /cash must be a finite non-negative number/,
    "invalid live state must fail before starting a SQLite transaction"
  );
  assert.deepEqual(
    recoveryPersister.checkpoints(),
    checkpointsBeforeRejectedExport,
    "rejected export must not rotate healthy checkpoints"
  );
  recoveredWorld.getPlayer("sqlite-player").cash = 200;
  recoveryPersister.close();

  const jsonPath = path.join(dir, "legacy-world.json");
  const migrationDbPath = path.join(dir, "migrated-world.sqlite");
  const legacyWorld = createMemoryWorldStore({ startedAt: 20_000 });
  legacyWorld.setPlayer({ id: "legacy-player", name: "旧档", cash: 888 });
  const jsonPersister = createWorldPersister({ world: legacyWorld, filePath: jsonPath });
  jsonPersister.flushSync();
  const originalJson = readFileSync(jsonPath, "utf8");

  const migratedWorld = createMemoryWorldStore();
  const migrationPersister = createSqliteWorldPersister({
    world: migratedWorld,
    filePath: migrationDbPath,
    migrationSourcePath: jsonPath
  });
  const migration = migrationPersister.loadIfPresent();
  assert.equal(migration.loaded, true);
  assert.equal(migration.migratedFrom, jsonPath);
  assert.equal(migratedWorld.getPlayer("legacy-player")?.cash, 888);
  assert.equal(migrationPersister.checkpoints().length, 1);
  assert.equal(readFileSync(jsonPath, "utf8"), originalJson, "migration must not alter the JSON source");
  migrationPersister.close();

  const factoryWorld = createMemoryWorldStore();
  const factorySqlitePath = path.join(dir, "factory.sqlite");
  const factory = createWorldPersisterForEnvironment({
    world: factoryWorld,
    cwd: dir,
    env: {
      JADE_WORLD_PERSIST_DRIVER: "sqlite",
      JADE_WORLD_SQLITE_PATH: factorySqlitePath,
      JADE_WORLD_PATH: path.join(dir, "missing-legacy.json"),
      JADE_WORLD_SAVE_MS: "12000"
    }
  });
  assert.equal(factory.driver, "sqlite");
  assert.equal(factory.intervalMs, 12_000);
  assert.equal(factory.filePath, factorySqlitePath);
  factory.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("sqlite-world-persist-smoke: transactions + migration + fallback ok");
