import assert from "node:assert/strict";
import { createPostgresWorldPersister } from "../server/shell/postgres-world-persist.js";

class FakePool {
  constructor() {
    this.rows = [];
    this.mutations = [];
    this.nextId = 1;
    this.nextMutationId = 1;
    this.failOnce = null;
    this.rollbacks = 0;
    this.queries = [];
    this.failConnect = false;
  }
  async query(sql, params = []) {
    if (/SELECT id, snapshot_version, saved_at, player_count, payload, checksum/.test(sql)) {
      return { rows: [...this.rows].sort((a, b) => b.saved_at - a.saved_at || b.id - a.id).slice(0, params[0]) };
    }
    if (/SELECT id, snapshot_version, saved_at, player_count, checksum, created_at/.test(sql)) {
      return { rows: [...this.rows].sort((a, b) => b.saved_at - a.saved_at || b.id - a.id).slice(0, params[0]) };
    }
    if (/SELECT id, snapshot_version, saved_at, payload, checksum\s+FROM jade_world_mutations/.test(sql)) {
      return { rows: this.mutations.filter((row) => row.id > Number(params[0] || 0)) };
    }
    return { rows: [] };
  }
  async connect() {
    if (this.failConnect) { this.failConnect = false; throw new Error("injected connection failure"); }
    let transactionRows = null;
    let transactionMutations = null;
    return {
      query: async (sql, params = []) => {
        this.queries.push(sql.trim().replace(/\s+/g, " "));
        if (/^BEGIN/.test(sql.trim())) {
          transactionRows = structuredClone(this.rows);
          transactionMutations = structuredClone(this.mutations);
        }
        if (this.failOnce?.test(sql)) {
          this.failOnce = null;
          throw new Error("injected PostgreSQL write failure");
        }
        if (/INSERT INTO jade_world_snapshots/.test(sql)) {
          this.rows.push({
            id: this.nextId++,
            snapshot_version: params[0],
            saved_at: params[1],
            player_count: params[2],
            payload: params[3],
            checksum: params[4],
            last_mutation_id: Number(params[5]) || 0,
            created_at: new Date()
          });
        }
        if (/INSERT INTO jade_world_mutations/.test(sql)) {
          this.mutations.push({
            id: this.nextMutationId++,
            snapshot_version: params[0],
            saved_at: params[1],
            action: params[2],
            payload: params[5],
            checksum: params[6]
          });
        }
        if (/SELECT COALESCE\(MAX\(id\), 0\) AS id FROM jade_world_mutations/.test(sql)) {
          return { rows: [{ id: this.mutations.at(-1)?.id || 0 }] };
        }
        if (/SELECT id, snapshot_version, saved_at, payload, checksum\s+FROM jade_world_mutations/.test(sql)) {
          return { rows: this.mutations.filter((row) => row.id > Number(params[0] || 0)) };
        }
        if (/DELETE FROM jade_world_snapshots/.test(sql)) {
          const keep = Number(params[0]);
          this.rows = [...this.rows]
            .sort((a, b) => b.saved_at - a.saved_at || b.id - a.id)
            .slice(0, keep);
        }
        if (/^COMMIT/.test(sql.trim())) transactionRows = null;
        if (/^ROLLBACK/.test(sql.trim())) {
          this.rows = transactionRows || this.rows;
          this.mutations = transactionMutations || this.mutations;
          transactionRows = null;
          transactionMutations = null;
          this.rollbacks += 1;
        }
        return { rows: [] };
      },
      release() {}
    };
  }
}

function makeWorld(value = 0) {
  const raw = { players: new Map([["p1", { id: "p1", value }]]), sockets: new Map() };
  return {
    raw,
    exportSnapshot({ savedAt }) {
      return { version: 5, savedAt, players: structuredClone([...raw.players.entries()]), sockets: [] };
    },
    importSnapshot(snapshot) {
      raw.players = new Map(structuredClone(snapshot.players));
      raw.sockets.clear();
    }
  };
}

const pool = new FakePool();
const source = makeWorld(10);
const observations = [];
const writer = createPostgresWorldPersister({
  world: source,
  pool,
  checkpointLimit: 2,
  intervalMs: 60_000,
  logger: { error() {} },
  metrics: { increment() {}, set() {}, observe: (...args) => observations.push(args) }
});
await writer.flush();
source.raw.players.get("p1").value = 20;
await new Promise((resolve) => setTimeout(resolve, 2));
await writer.flush();
source.raw.players.get("p1").value = 30;
await new Promise((resolve) => setTimeout(resolve, 2));
await writer.flush();
assert.equal(pool.rows.length, 2, "checkpoint retention must prune old snapshots transactionally");

const restored = makeWorld(0);
const reader = createPostgresWorldPersister({ world: restored, pool, checkpointLimit: 2 });
const loaded = await reader.loadIfPresent();
assert.equal(loaded.loaded, true);
assert.equal(restored.raw.players.get("p1").value, 30);

const deltaSavedAt = Date.now();
const beforeDelta = source.exportSnapshot({ savedAt: deltaSavedAt });
source.raw.players.get("p1").value = 35;
const afterDelta = source.exportSnapshot({ savedAt: deltaSavedAt });
pool.queries = [];
await writer.flush({
  beforeSnapshot: beforeDelta,
  snapshot: afterDelta,
  savedAt: deltaSavedAt,
  action: "test:update",
  actorId: "p1",
  requestId: "request-35"
});
assert.equal(pool.mutations.length, 1, "ordinary writes should append one mutation journal row");
assert.ok(pool.queries.length < 15, `incremental mutation used too many SQL statements: ${pool.queries.length}`);

const replayed = makeWorld(0);
const replayReader = createPostgresWorldPersister({ world: replayed, pool, checkpointLimit: 2 });
const replayResult = await replayReader.loadIfPresent();
assert.equal(replayResult.replayedMutations, 1);
assert.equal(replayed.raw.players.get("p1").value, 35, "journal must replay after the newest checkpoint");

const newest = [...pool.rows].sort((a, b) => b.saved_at - a.saved_at || b.id - a.id)[0];
newest.checksum = "0".repeat(64);
const fallback = makeWorld(0);
const fallbackReader = createPostgresWorldPersister({ world: fallback, pool, checkpointLimit: 2 });
const recovered = await fallbackReader.loadIfPresent();
assert.equal(recovered.recoveredFromBackup, true);
assert.equal(fallback.raw.players.get("p1").value, 35, "older checkpoint must catch up through the journal");

const beforeFailedWrite = {
  rows: structuredClone(pool.rows),
  mutations: structuredClone(pool.mutations)
};
const beforeFailure = source.exportSnapshot({ savedAt: deltaSavedAt + 1 });
source.raw.players.get("p1").value = 40;
const afterFailure = source.exportSnapshot({ savedAt: deltaSavedAt + 1 });
pool.failOnce = /INSERT INTO jade_world_mutations/;
await assert.rejects(writer.flush({
  beforeSnapshot: beforeFailure,
  snapshot: afterFailure,
  savedAt: deltaSavedAt + 1,
  action: "test:failure",
  actorId: "p1",
  requestId: "request-40"
}), /injected PostgreSQL write failure/);
assert.equal(pool.rollbacks, 1, "failed journal writes must roll back the mutation transaction");
assert.deepEqual(pool.rows, beforeFailedWrite.rows);
assert.deepEqual(pool.mutations, beforeFailedWrite.mutations);
pool.failConnect = true;
await assert.rejects(writer.flush({ beforeSnapshot: beforeFailure, snapshot: afterFailure, savedAt: deltaSavedAt + 1 }), /connection failure/);
assert.equal(observations.filter(([name, labels, elapsed]) => name === "jade_persistence_transaction_milliseconds"
  && labels.kind === "mutation" && labels.outcome === "failed" && elapsed >= 0).length, 2, "connection failures must still expose persistence timing");
assert.equal((await writer.healthCheck()).consecutiveFailures, 2, "connection failure must count as a failed write");

console.log("postgres-world-persist-smoke: migrations + journal replay + incremental rollback ok");
