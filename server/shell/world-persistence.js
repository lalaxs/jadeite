/** Select the durable WorldStore adapter without leaking it into game services. */
import {
  createWorldPersister,
  resolveWorldPersistPath,
  resolveWorldSaveIntervalMs
} from "./world-persist.js";
import {
  createSqliteWorldPersister,
  resolveWorldSqlitePath
} from "./sqlite-world-persist.js";
import { createPostgresWorldPersister } from "./postgres-world-persist.js";

export function resolveWorldPersistDriver(env = process.env) {
  const value = String(env.JADE_WORLD_PERSIST_DRIVER || "json").trim().toLowerCase();
  if (value === "json" || value === "sqlite" || value === "postgres") return value;
  throw new Error(`world-persistence: unsupported driver ${value || "(empty)"}`);
}

export function createWorldPersisterForEnvironment({
  world,
  metrics,
  env = process.env,
  cwd = process.cwd()
}) {
  const driver = resolveWorldPersistDriver(env);
  const intervalMs = resolveWorldSaveIntervalMs(env);
  if (driver === "postgres") {
    return createPostgresWorldPersister({
      world,
      connectionString: String(env.DATABASE_URL || "").trim(),
      intervalMs,
      auditRetentionDays: Number(env.JADE_AUDIT_RETENTION_DAYS) || 90,
      metrics,
      migrationSourcePath: resolveWorldPersistPath(env, cwd)
    });
  }
  if (driver === "sqlite") {
    return createSqliteWorldPersister({
      world,
      filePath: resolveWorldSqlitePath(env, cwd),
      intervalMs,
      // Migration is copy-only: the previous JSON save remains untouched.
      migrationSourcePath: resolveWorldPersistPath(env, cwd)
    });
  }
  const persister = createWorldPersister({
    world,
    filePath: resolveWorldPersistPath(env, cwd),
    intervalMs
  });
  return { driver: "json", ...persister };
}
