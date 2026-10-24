/**
 * Transactional SQLite persistence for the WorldStore snapshot aggregate.
 *
 * Gameplay services continue to mutate the in-memory WorldStore. SQLite owns
 * durable checkpoints only, which keeps the simulation boundary unchanged and
 * makes a complete world save one atomic database transaction.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_WORLD_SAVE_MS } from "./world-persist.js";

export const SQLITE_WORLD_SCHEMA_VERSION = 1;
export const DEFAULT_SQLITE_WORLD_PATH = path.join("data", "world.sqlite");
export const DEFAULT_SQLITE_CHECKPOINT_LIMIT = 2;

export function resolveWorldSqlitePath(env = process.env, cwd = process.cwd()) {
  const custom = String(env.JADE_WORLD_SQLITE_PATH || "").trim();
  return path.resolve(cwd, custom || DEFAULT_SQLITE_WORLD_PATH);
}

function snapshotChecksum(payload) {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function ensureWorldContract(world) {
  if (!world || typeof world.exportSnapshot !== "function" || typeof world.importSnapshot !== "function") {
    throw new Error("sqlite-world-persist: world with exportSnapshot/importSnapshot required");
  }
}

function openDatabase(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  return database;
}

function initializeSchema(database) {
  const schemaVersion = Number(database.prepare("PRAGMA user_version").get()?.user_version || 0);
  if (schemaVersion > SQLITE_WORLD_SCHEMA_VERSION) {
    throw new Error(
      `sqlite-world-persist: unsupported schema version ${schemaVersion}`
    );
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS world_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_version INTEGER NOT NULL,
      saved_at INTEGER NOT NULL,
      player_count INTEGER NOT NULL,
      payload TEXT NOT NULL,
      checksum TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS world_snapshots_saved_at_idx
      ON world_snapshots(saved_at DESC, id DESC);
  `);
  if (schemaVersion < SQLITE_WORLD_SCHEMA_VERSION) {
    database.exec(`PRAGMA user_version = ${SQLITE_WORLD_SCHEMA_VERSION}`);
  }
}

/**
 * @param {{
 *   world: { exportSnapshot(options?: object): object, importSnapshot(snapshot: object): unknown, raw: { players: Map, sockets: Map } },
 *   filePath: string,
 *   intervalMs?: number,
 *   checkpointLimit?: number,
 *   migrationSourcePath?: string | null
 * }} options
 */
export function createSqliteWorldPersister({
  world,
  filePath,
  intervalMs = DEFAULT_WORLD_SAVE_MS,
  checkpointLimit = DEFAULT_SQLITE_CHECKPOINT_LIMIT,
  migrationSourcePath = null
}) {
  ensureWorldContract(world);
  if (!filePath) throw new Error("sqlite-world-persist: filePath required");
  const resolvedFilePath = path.resolve(filePath);
  const retainedCheckpoints = Math.max(2, Math.min(10, Math.floor(Number(checkpointLimit) || 2)));
  const database = openDatabase(resolvedFilePath);
  initializeSchema(database);

  const insertSnapshot = database.prepare(`
    INSERT INTO world_snapshots (
      snapshot_version, saved_at, player_count, payload, checksum, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const newestSnapshots = database.prepare(`
    SELECT id, snapshot_version, saved_at, player_count, payload, checksum
    FROM world_snapshots
    ORDER BY id DESC
    LIMIT ?
  `);
  const deleteOldSnapshots = database.prepare(`
    DELETE FROM world_snapshots
    WHERE id NOT IN (
      SELECT id FROM world_snapshots ORDER BY id DESC LIMIT ?
    )
  `);
  const checkpointRows = database.prepare(`
    SELECT id, snapshot_version, saved_at, player_count, checksum
    FROM world_snapshots
    ORDER BY id DESC
  `);

  let timer = null;
  let closed = false;

  function requireOpen() {
    if (closed) throw new Error("sqlite-world-persist: database is closed");
  }

  function flushSync() {
    requireOpen();
    const savedAt = Date.now();
    const snapshot = world.exportSnapshot({ savedAt });
    snapshot.sockets = [];
    snapshot.savedAt = savedAt;
    const payload = JSON.stringify(snapshot);
    const checksum = snapshotChecksum(payload);
    database.exec("BEGIN IMMEDIATE");
    try {
      insertSnapshot.run(
        Number(snapshot.version),
        savedAt,
        Array.isArray(snapshot.players) ? snapshot.players.length : 0,
        payload,
        checksum,
        Date.now()
      );
      deleteOldSnapshots.run(retainedCheckpoints);
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original write failure.
      }
      throw error;
    }
    return resolvedFilePath;
  }

  function importRow(row) {
    if (snapshotChecksum(row.payload) !== row.checksum) {
      throw new Error(`sqlite-world-persist: checkpoint ${row.id} checksum mismatch`);
    }
    const snapshot = JSON.parse(row.payload);
    if (Number(snapshot.version) !== Number(row.snapshot_version)) {
      throw new Error(`sqlite-world-persist: checkpoint ${row.id} version metadata mismatch`);
    }
    if (!Array.isArray(snapshot.players) || snapshot.players.length !== Number(row.player_count)) {
      throw new Error(`sqlite-world-persist: checkpoint ${row.id} player count mismatch`);
    }
    if (Number(snapshot.savedAt) !== Number(row.saved_at)) {
      throw new Error(`sqlite-world-persist: checkpoint ${row.id} save time mismatch`);
    }
    world.importSnapshot(snapshot);
    world.raw.sockets.clear();
    return snapshot;
  }

  function migrateJsonIfAvailable() {
    const source = migrationSourcePath ? path.resolve(migrationSourcePath) : null;
    if (!source || !existsSync(source)) return null;
    const snapshot = JSON.parse(readFileSync(source, "utf8"));
    world.importSnapshot(snapshot);
    world.raw.sockets.clear();
    flushSync();
    return {
      loaded: true,
      path: resolvedFilePath,
      players: world.raw.players?.size ?? 0,
      migratedFrom: source,
      recoveredFromBackup: false
    };
  }

  function loadIfPresent() {
    requireOpen();
    const rows = newestSnapshots.all(retainedCheckpoints);
    if (!rows.length) {
      const migrated = migrateJsonIfAvailable();
      return migrated || { loaded: false, path: resolvedFilePath, players: 0 };
    }

    const failures = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      try {
        importRow(row);
        return {
          loaded: true,
          path: resolvedFilePath,
          players: world.raw.players?.size ?? 0,
          checkpointId: Number(row.id),
          recoveredFromBackup: index > 0,
          recoverySource: index > 0 ? `${resolvedFilePath}#checkpoint:${row.id}` : undefined,
          primaryError: index > 0 ? failures[0]?.message : undefined
        };
      } catch (error) {
        failures.push(error);
      }
    }
    throw new AggregateError(
      failures,
      "sqlite-world-persist: all retained checkpoints are unreadable"
    );
  }

  function startAutoSave({ save = flushSync } = {}) {
    requireOpen();
    if (timer) return;
    timer = setInterval(() => {
      Promise.resolve().then(save).catch((error) => console.error("[persist] auto-save failed:", error?.message || error));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function close() {
    if (closed) return;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    database.close();
    closed = true;
  }

  function stop({ flush = true } = {}) {
    if (closed) return;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (flush) flushSync();
    close();
  }

  function integrityCheck() {
    requireOpen();
    const row = database.prepare("PRAGMA integrity_check").get();
    return String(row?.integrity_check || Object.values(row || {})[0] || "");
  }

  function checkpoints() {
    requireOpen();
    return checkpointRows.all().map((row) => ({
      id: Number(row.id),
      snapshotVersion: Number(row.snapshot_version),
      savedAt: Number(row.saved_at),
      playerCount: Number(row.player_count),
      checksum: row.checksum
    }));
  }

  return {
    driver: "sqlite",
    filePath: resolvedFilePath,
    backupPath: null,
    intervalMs,
    checkpointLimit: retainedCheckpoints,
    loadIfPresent,
    flushSync,
    startAutoSave,
    stop,
    close,
    integrityCheck,
    checkpoints
  };
}
