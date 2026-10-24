import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const MIGRATIONS_URL = new URL("./migrations/", import.meta.url);
const MIGRATION_LOCK_KEY = 0x4a41444d;

function checksum(source) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function migrationVersion(fileName) {
  const match = /^(\d+)_.*\.sql$/.exec(fileName);
  return match ? Number(match[1]) : null;
}

export async function applyPostgresMigrations(database) {
  const client = await database.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS jade_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query("ALTER TABLE jade_schema_migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64)");

    const files = (await readdir(MIGRATIONS_URL, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && migrationVersion(entry.name) != null)
      .map((entry) => ({ name: entry.name, version: migrationVersion(entry.name) }))
      .sort((left, right) => left.version - right.version);
    const appliedResult = await client.query("SELECT version, checksum FROM jade_schema_migrations");
    const applied = new Map((appliedResult.rows || []).map((row) => [Number(row.version), row.checksum]));

    for (const migration of files) {
      const source = await readFile(new URL(migration.name, MIGRATIONS_URL), "utf8");
      const digest = checksum(source);
      const existing = applied.get(migration.version);
      if (existing && existing !== digest) {
        throw new Error(`postgres-migrations: checksum mismatch for ${migration.name}`);
      }
      if (existing === digest) continue;

      await client.query("BEGIN");
      try {
        if (!applied.has(migration.version)) await client.query(source);
        await client.query(`
          INSERT INTO jade_schema_migrations(version, checksum, applied_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum
        `, [migration.version, digest]);
        await client.query("COMMIT");
        applied.set(migration.version, digest);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
