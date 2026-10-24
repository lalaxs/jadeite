import path from "node:path";
import { createHash } from "node:crypto";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createWorldPersister } from "../server/shell/world-persist.js";
import { createSqliteWorldPersister } from "../server/shell/sqlite-world-persist.js";
import { createPostgresWorldPersister } from "../server/shell/postgres-world-persist.js";

const sourceDriver = String(process.env.JADE_MIGRATION_SOURCE_DRIVER || "json").trim().toLowerCase();
const sourcePath = path.resolve(process.env.JADE_MIGRATION_SOURCE_PATH || (
  sourceDriver === "sqlite" ? "data/world.sqlite" : "data/world.json"
));
const connectionString = String(process.env.DATABASE_URL || "").trim();
if (!connectionString) throw new Error("DATABASE_URL is required");
if (!["json", "sqlite"].includes(sourceDriver)) throw new Error("JADE_MIGRATION_SOURCE_DRIVER must be json or sqlite");

const world = createMemoryWorldStore();
const source = sourceDriver === "sqlite"
  ? createSqliteWorldPersister({ world, filePath: sourcePath, migrationSourcePath: null })
  : createWorldPersister({ world, filePath: sourcePath });
let target = null;
let verifier = null;

function digestWorld(candidate) {
  const payload = JSON.stringify(candidate.exportSnapshot({ savedAt: 0 }));
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

try {
  const loaded = await source.loadIfPresent();
  if (!loaded.loaded) throw new Error(`no ${sourceDriver} save found at ${sourcePath}`);

  target = createPostgresWorldPersister({ world, connectionString });
  await target.initialize();
  const existing = await target.checkpoints();
  if (existing.length && process.env.JADE_MIGRATION_FORCE !== "1") {
    throw new Error("PostgreSQL already contains checkpoints; set JADE_MIGRATION_FORCE=1 only after taking a backup");
  }
  await target.flush();

  const verificationWorld = createMemoryWorldStore();
  verifier = createPostgresWorldPersister({ world: verificationWorld, connectionString });
  const verified = await verifier.loadIfPresent();
  if (!verified.loaded) throw new Error("migration verification failed: no PostgreSQL checkpoint found");
  if (digestWorld(verificationWorld) !== digestWorld(world)) {
    throw new Error("migration verification failed: complete world checksum mismatch");
  }

  console.log(`migration complete: ${world.raw.players.size} player(s), ${sourcePath} -> PostgreSQL`);
} finally {
  await verifier?.close().catch(() => {});
  await target?.close().catch(() => {});
  await source.close?.();
}
