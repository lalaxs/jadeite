import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { createProjectionDelta } from "../persistence/projection-delta.js";
import { DEFAULT_WORLD_SAVE_MS } from "./world-persist.js";
import { applyPostgresMigrations } from "../persistence/postgres-migrations.js";
import {
  replayWorldDeltas,
  createWorldDelta,
  worldDeltaHasChanges
} from "../persistence/world-delta.js";

const { Pool } = pg;
const SNAPSHOT_LOCK_KEY = 0x4a414445;

function checksum(payload) {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function safeDatabaseLabel(connectionString) {
  try {
    const value = new URL(connectionString);
    return `${value.protocol}//${value.hostname}:${value.port || "default"}/${value.pathname.replace(/^\//, "")}`;
  } catch (_) {
    return "postgresql:configured";
  }
}

function snapshotWithMetadata(world, savedAt = Date.now()) {
  const snapshot = world.exportSnapshot({ savedAt });
  snapshot.sockets = [];
  snapshot.savedAt = savedAt;
  return snapshot;
}

function parseJson(value) {
  return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
}

export function createPostgresWorldPersister({
  world,
  connectionString,
  intervalMs = DEFAULT_WORLD_SAVE_MS,
  checkpointLimit = 3,
  auditRetentionDays = 90,
  migrationSourcePath = null,
  logger = console,
  metrics = { increment() {}, set() {} },
  pool = null
}) {
  if (!world || typeof world.exportSnapshot !== "function" || typeof world.importSnapshot !== "function") {
    throw new Error("postgres-world-persist: world with exportSnapshot/importSnapshot required");
  }
  if (!connectionString && !pool) {
    throw new Error("postgres-world-persist: connectionString or pool required");
  }
  const retainedCheckpoints = Math.max(2, Math.min(20, Math.floor(Number(checkpointLimit) || 3)));
  const retainedAuditDays = Math.max(7, Math.min(3650, Math.floor(Number(auditRetentionDays) || 90)));
  const database = pool || new Pool({
    connectionString,
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 5_000,
    lock_timeout: 2_000,
    application_name: "jade-market-server"
  });
  const filePath = safeDatabaseLabel(connectionString || "postgresql:injected");
  let initialized = false;
  let timer = null;
  let closing = false;
  let flushChain = Promise.resolve();
  let pendingAudits = [];
  let lastSuccessfulWriteAt = 0;
  let consecutiveFailures = 0;

  async function initialize() {
    if (initialized) return;
    await applyPostgresMigrations(database);
    initialized = true;
  }

  async function readJournalAfter(client, mutationId) {
    const result = await client.query(`
      SELECT id, snapshot_version, saved_at, payload, checksum
      FROM jade_world_mutations
      WHERE id > $1
      ORDER BY id ASC
    `, [Number(mutationId) || 0]);
    return result.rows || [];
  }

  function replayJournal(snapshot, rows) {
    function* checkedDeltas() {
      for (const row of rows) {
        const payloadText = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
        if (checksum(payloadText) !== row.checksum) {
          throw new Error(`world mutation ${row.id} checksum mismatch`);
        }
        const delta = parseJson(row.payload);
        if (Number(delta.snapshotVersion) !== Number(row.snapshot_version)) {
          throw new Error(`world mutation ${row.id} version mismatch`);
        }
        if (Number(delta.savedAt) !== Number(row.saved_at)) {
          throw new Error(`world mutation ${row.id} save time mismatch`);
        }
        yield delta;
      }
    }
    return replayWorldDeltas(snapshot, checkedDeltas());
  }

  async function loadIfPresent() {
    await initialize();
    const result = await database.query(`
      SELECT id, snapshot_version, saved_at, player_count, payload, checksum, last_mutation_id
      FROM jade_world_snapshots
      ORDER BY saved_at DESC, id DESC
      LIMIT $1
    `, [retainedCheckpoints]);
    if (!result.rows.length) {
      if (migrationSourcePath) {
        try {
          const text = await readFile(migrationSourcePath, "utf8");
          world.importSnapshot(JSON.parse(text));
          world.raw.sockets.clear();
          await writeCheckpoint({ rebuildProjections: true });
          return {
            loaded: true,
            path: filePath,
            players: world.raw.players.size,
            migratedFrom: migrationSourcePath
          };
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      await writeCheckpoint({ rebuildProjections: true });
      return { loaded: false, path: filePath, players: 0 };
    }

    const client = await database.connect();
    const errors = [];
    try {
      for (let index = 0; index < result.rows.length; index += 1) {
        const row = result.rows[index];
        try {
          const payloadText = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
          if (checksum(payloadText) !== row.checksum) {
            throw new Error(`checkpoint ${row.id} checksum mismatch`);
          }
          let snapshot = parseJson(row.payload);
          if (Number(snapshot.version) !== Number(row.snapshot_version)) {
            throw new Error(`checkpoint ${row.id} version mismatch`);
          }
          const journal = await readJournalAfter(client, row.last_mutation_id);
          snapshot = replayJournal(snapshot, journal);
          world.importSnapshot(snapshot);
          world.raw.sockets.clear();
          return {
            loaded: true,
            path: filePath,
            players: world.raw.players.size,
            checkpointId: Number(row.id),
            replayedMutations: journal.length,
            recoveredFromBackup: index > 0,
            recoverySource: index > 0 ? `${filePath}#checkpoint:${row.id}` : undefined
          };
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      client.release();
    }
    throw new AggregateError(errors, "postgres-world-persist: all retained checkpoints are unreadable");
  }

  async function syncProjectionChanges(client, beforeSnapshot, delta) {
    const changedPlayers = delta.players?.upsert || [];
    const removedPlayerIds = (delta.players?.remove || []).map(String);

    if (removedPlayerIds.length) {
      await client.query("DELETE FROM jade_inventory_projection WHERE owner_player_id = ANY($1::text[])", [removedPlayerIds]);
      await client.query("DELETE FROM jade_idempotency_keys WHERE player_id = ANY($1::text[])", [removedPlayerIds]);
      await client.query("DELETE FROM jade_ledger_entries WHERE player_id = ANY($1::text[])", [removedPlayerIds]);
      await client.query("DELETE FROM jade_player_projection WHERE player_id = ANY($1::text[])", [removedPlayerIds]);
    }
    if (!changedPlayers.length) return;

    const changes = createProjectionDelta(beforeSnapshot, delta);
    if (changes.players.length) await client.query(`
      INSERT INTO jade_player_projection(player_id, display_name, cash, reputation, level, updated_at)
      SELECT player_id, display_name, cash, reputation, level, NOW()
      FROM jsonb_to_recordset($1::jsonb) AS row(
        player_id TEXT, display_name TEXT, cash BIGINT, reputation DOUBLE PRECISION, level INTEGER
      )
      ON CONFLICT (player_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        cash = EXCLUDED.cash,
        reputation = EXCLUDED.reputation,
        level = EXCLUDED.level,
        updated_at = NOW()
    `, [JSON.stringify(changes.players)]);

    if (changes.ledger.length) {
      await client.query(`
        INSERT INTO jade_ledger_entries(
          player_id, entry_id, kind, source, amount, balance_before,
          balance_after, note, occurred_at, payload
        )
        SELECT player_id, entry_id, kind, source, amount, balance_before,
          balance_after, note, occurred_at, payload
        FROM jsonb_to_recordset($1::jsonb) AS row(
          player_id TEXT, entry_id TEXT, kind TEXT, source TEXT, amount BIGINT,
          balance_before BIGINT, balance_after BIGINT, note TEXT, occurred_at BIGINT, payload JSONB
        )
        ON CONFLICT (player_id, entry_id) DO NOTHING
      `, [JSON.stringify(changes.ledger)]);
    }
    if (changes.removedRequests.length) await client.query(`
      DELETE FROM jade_idempotency_keys AS target
      USING jsonb_to_recordset($1::jsonb) AS removed(player_id TEXT, request_id TEXT)
      WHERE target.player_id = removed.player_id AND target.request_id = removed.request_id
    `, [JSON.stringify(changes.removedRequests)]);
    if (changes.requests.length) {
      await client.query(`
        INSERT INTO jade_idempotency_keys(player_id, request_id)
        SELECT player_id, request_id
        FROM jsonb_to_recordset($1::jsonb) AS row(player_id TEXT, request_id TEXT)
        ON CONFLICT (player_id, request_id) DO NOTHING
      `, [JSON.stringify(changes.requests)]);
    }

    if (changes.removedInventory.length) await client.query(`
      DELETE FROM jade_inventory_projection AS target
      USING jsonb_to_recordset($1::jsonb) AS removed(item_id TEXT, owner_player_id TEXT)
      WHERE target.item_id = removed.item_id AND target.owner_player_id = removed.owner_player_id
    `, [JSON.stringify(changes.removedInventory)]);
    if (changes.inventory.length) {
      await client.query(`
        INSERT INTO jade_inventory_projection(
          item_id, owner_player_id, location, item_type, payload, updated_at
        )
        SELECT item_id, owner_player_id, location, item_type, payload, NOW()
        FROM jsonb_to_recordset($1::jsonb) AS row(
          item_id TEXT, owner_player_id TEXT, location TEXT, item_type TEXT, payload JSONB
        )
        ON CONFLICT (item_id) DO UPDATE SET
          owner_player_id = EXCLUDED.owner_player_id,
          location = EXCLUDED.location,
          item_type = EXCLUDED.item_type,
          payload = EXCLUDED.payload,
          updated_at = NOW()
      `, [JSON.stringify(changes.inventory)]);
    }
  }

  async function writeAudits(client, audits) {
    if (!audits.length) return;
    await client.query(`
      INSERT INTO jade_audit_log(
        actor_type, actor_id, action, request_id, outcome, metadata
      )
      SELECT actor_type, actor_id, action, request_id, outcome, metadata
      FROM jsonb_to_recordset($1::jsonb) AS row(
        actor_type TEXT, actor_id TEXT, action TEXT, request_id TEXT, outcome TEXT, metadata JSONB
      )
    `, [JSON.stringify(audits.map((audit) => ({
      actor_type: audit.actorType,
      actor_id: audit.actorId,
      action: audit.action,
      request_id: audit.requestId,
      outcome: audit.outcome,
      metadata: audit.metadata || {}
    })))]);
  }

  async function writeMutation(options) {
    const savedAt = Math.max(0, Math.round(Number(options.savedAt) || Date.now()));
    const beforeSnapshot = structuredClone(options.beforeSnapshot);
    const afterSnapshot = structuredClone(options.snapshot || snapshotWithMetadata(world, savedAt));
    beforeSnapshot.savedAt ||= savedAt;
    afterSnapshot.savedAt = savedAt;
    afterSnapshot.sockets = [];
    const delta = options.delta || createWorldDelta(beforeSnapshot, afterSnapshot, {
      savedAt,
      action: options.action,
      actorId: options.actorId,
      requestId: options.requestId
    });
    const audits = pendingAudits;
    if (!worldDeltaHasChanges(delta) && !audits.length) return filePath;
    const payload = JSON.stringify(delta);
    const transactionStarted = performance.now();
    let outcome = "failed";
    let client = null;
    try {
      client = await database.connect();
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [SNAPSHOT_LOCK_KEY]);
      await client.query(`
        INSERT INTO jade_world_mutations(
          snapshot_version, saved_at, action, actor_id, request_id, payload, checksum
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [
        delta.snapshotVersion,
        delta.savedAt,
        delta.action,
        delta.actorId,
        delta.requestId,
        payload,
        checksum(payload)
      ]);
      await syncProjectionChanges(client, beforeSnapshot, delta);
      await writeAudits(client, audits);
      await client.query("COMMIT");
      outcome = "committed";
      pendingAudits = pendingAudits.slice(audits.length);
      lastSuccessfulWriteAt = Date.now();
      consecutiveFailures = 0;
      metrics.increment("jade_persistence_mutations_total", { outcome: "committed" });
      metrics.increment("jade_persistence_bytes_total", { kind: "delta" }, Buffer.byteLength(payload));
      return filePath;
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      consecutiveFailures += 1;
      metrics.increment("jade_persistence_mutations_total", { outcome: "failed" });
      throw error;
    } finally {
      metrics.observe?.("jade_persistence_transaction_milliseconds", { kind: "mutation", outcome }, performance.now() - transactionStarted);
      client?.release();
    }
  }

  async function writeCheckpoint({ rebuildProjections = false } = {}) {
    const prepareStarted = performance.now();
    await initialize();
    const savedAt = Date.now();
    const snapshot = snapshotWithMetadata(world, savedAt);
    const payload = JSON.stringify(snapshot);
    const digest = checksum(payload);
    const audits = pendingAudits;
    metrics.observe?.("jade_checkpoint_prepare_milliseconds", {}, performance.now() - prepareStarted);
    const transactionStarted = performance.now();
    let outcome = "failed";
    let client = null;
    try {
      client = await database.connect();
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [SNAPSHOT_LOCK_KEY]);
      const cursor = await client.query("SELECT COALESCE(MAX(id), 0) AS id FROM jade_world_mutations");
      const lastMutationId = Number(cursor.rows?.[0]?.id) || 0;
      await client.query(`
        INSERT INTO jade_world_snapshots(
          snapshot_version, saved_at, player_count, payload, checksum, last_mutation_id
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [snapshot.version, savedAt, snapshot.players.length, payload, digest, lastMutationId]);

      if (rebuildProjections) {
        await client.query("DELETE FROM jade_inventory_projection");
        await client.query("DELETE FROM jade_idempotency_keys");
        await client.query("DELETE FROM jade_ledger_entries");
        await client.query("DELETE FROM jade_player_projection");
        const baseline = { ...snapshot, players: [] };
        await syncProjectionChanges(client, baseline, createWorldDelta(baseline, snapshot, {
          savedAt,
          action: "checkpoint:projection-rebuild"
        }));
      }
      await writeAudits(client, audits);
      await client.query(`
        DELETE FROM jade_world_snapshots
        WHERE id NOT IN (
          SELECT id FROM jade_world_snapshots
          ORDER BY saved_at DESC, id DESC
          LIMIT $1
        )
      `, [retainedCheckpoints]);
      await client.query(`
        DELETE FROM jade_world_mutations
        WHERE id <= COALESCE((SELECT MIN(last_mutation_id) FROM jade_world_snapshots), 0)
      `);
      await client.query(`
        DELETE FROM jade_audit_log
        WHERE occurred_at < NOW() - ($1 * INTERVAL '1 day')
      `, [retainedAuditDays]);
      await client.query("COMMIT");
      outcome = "committed";
      pendingAudits = pendingAudits.slice(audits.length);
      lastSuccessfulWriteAt = Date.now();
      consecutiveFailures = 0;
      metrics.increment("jade_persistence_checkpoints_total", { outcome: "committed" });
      metrics.increment("jade_persistence_bytes_total", { kind: "checkpoint" }, Buffer.byteLength(payload));
      return filePath;
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      consecutiveFailures += 1;
      metrics.increment("jade_persistence_checkpoints_total", { outcome: "failed" });
      throw error;
    } finally {
      metrics.observe?.("jade_persistence_transaction_milliseconds", { kind: "checkpoint", outcome }, performance.now() - transactionStarted);
      client?.release();
    }
  }

  async function flushNow(options = {}) {
    if (closing) return filePath;
    await initialize();
    if (options.beforeSnapshot) return writeMutation(options);
    return writeCheckpoint(options);
  }

  function flush(options = {}) {
    flushChain = flushChain.then(() => flushNow(options), () => flushNow(options));
    return flushChain;
  }

  function startAutoSave({ save = () => flush({ reason: "interval" }) } = {}) {
    if (timer) return;
    timer = setInterval(() => {
      Promise.resolve().then(save).catch((error) => logger.error?.({ error: error.message }, "postgres checkpoint failed"));
    }, intervalMs);
    timer.unref?.();
  }

  function recordAudit(entry = {}) {
    const record = {
      actorType: String(entry.actorType || "system").slice(0, 32),
      actorId: entry.actorId == null ? null : String(entry.actorId).slice(0, 128),
      action: String(entry.action || "unknown").slice(0, 128),
      requestId: entry.requestId == null ? null : String(entry.requestId).slice(0, 128),
      outcome: String(entry.outcome || "unknown").slice(0, 32),
      metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {}
    };
    pendingAudits.push(record);
    return () => {
      const index = pendingAudits.indexOf(record);
      if (index >= 0) pendingAudits.splice(index, 1);
    };
  }

  async function stop({ flush: shouldFlush = true } = {}) {
    if (timer) clearInterval(timer);
    timer = null;
    if (shouldFlush) await flush({ reason: "shutdown" });
  }

  async function close() {
    closing = true;
    await flushChain.catch(() => {});
    if (!pool) await database.end();
  }

  async function checkpoints() {
    await initialize();
    const result = await database.query(`
      SELECT id, snapshot_version, saved_at, player_count, checksum, last_mutation_id, created_at
      FROM jade_world_snapshots
      ORDER BY saved_at DESC, id DESC
      LIMIT $1
    `, [retainedCheckpoints]);
    return result.rows;
  }

  async function healthCheck() {
    await initialize();
    const startedAt = Date.now();
    await database.query("SELECT 1 AS ok");
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      lastSuccessfulWriteAt,
      consecutiveFailures
    };
  }

  function status() {
    return { lastSuccessfulWriteAt, consecutiveFailures };
  }

  return {
    driver: "postgres",
    filePath,
    intervalMs,
    checkpointLimit: retainedCheckpoints,
    auditRetentionDays: retainedAuditDays,
    initialize,
    loadIfPresent,
    flush,
    recordAudit,
    startAutoSave,
    stop,
    close,
    checkpoints,
    healthCheck,
    status
  };
}
