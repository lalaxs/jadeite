import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createWorldPersister } from "../server/shell/world-persist.js";
import { createSqliteWorldPersister } from "../server/shell/sqlite-world-persist.js";

const crashChild = fileURLToPath(
  new URL("./fixtures/persistence-crash-child.mjs", import.meta.url)
);

function forceCrash(mode, targetPath, cash = "") {
  const result = spawnSync(process.execPath, [crashChild, mode, targetPath, String(cash)], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0, `${mode} child unexpectedly exited cleanly`);
}

const dir = mkdtempSync(path.join(tmpdir(), "jade-crash-recovery-"));
try {
  const sqlitePath = path.join(dir, "world.sqlite");
  const sqliteWorld = createMemoryWorldStore({ startedAt: 1_000 });
  sqliteWorld.setPlayer({ id: "crash-player", name: "断电测试", cash: 100 });
  const sqliteSeed = createSqliteWorldPersister({ world: sqliteWorld, filePath: sqlitePath });
  sqliteSeed.flushSync();
  sqliteSeed.close();

  // A committed WAL transaction must survive even when the process never closes
  // its database handle or runs the normal shutdown path.
  forceCrash("sqlite-committed", sqlitePath, 200);
  const committedWorld = createMemoryWorldStore();
  const committedPersist = createSqliteWorldPersister({
    world: committedWorld,
    filePath: sqlitePath
  });
  assert.equal(committedPersist.loadIfPresent().loaded, true);
  assert.equal(committedWorld.getPlayer("crash-player")?.cash, 200);
  assert.equal(committedPersist.integrityCheck(), "ok");
  assert.equal(committedPersist.checkpoints().length, 2);
  committedPersist.close();

  // An interrupted transaction must be rolled back rather than appearing as a
  // partially written newer checkpoint.
  forceCrash("sqlite-uncommitted", sqlitePath, 999);
  const rolledBackWorld = createMemoryWorldStore();
  const rolledBackPersist = createSqliteWorldPersister({
    world: rolledBackWorld,
    filePath: sqlitePath
  });
  assert.equal(rolledBackPersist.loadIfPresent().loaded, true);
  assert.equal(rolledBackWorld.getPlayer("crash-player")?.cash, 200);
  assert.equal(rolledBackPersist.integrityCheck(), "ok");
  assert.equal(rolledBackPersist.checkpoints().length, 2);
  rolledBackPersist.close();

  const jsonPath = path.join(dir, "world.json");
  const jsonWorld = createMemoryWorldStore({ startedAt: 2_000 });
  const jsonPlayer = { id: "json-crash-player", name: "临时档测试", cash: 10 };
  jsonWorld.setPlayer(jsonPlayer);
  const jsonPersist = createWorldPersister({ world: jsonWorld, filePath: jsonPath });
  jsonPersist.flushSync();
  jsonPlayer.cash = 20;
  jsonPersist.flushSync();

  forceCrash("json-partial", jsonPath);
  assert.equal(existsSync(`${jsonPath}.tmp`), true);
  const primaryWorld = createMemoryWorldStore();
  const primaryPersist = createWorldPersister({ world: primaryWorld, filePath: jsonPath });
  assert.equal(primaryPersist.loadIfPresent().recoveredFromBackup, false);
  assert.equal(primaryWorld.getPlayer("json-crash-player")?.cash, 20);

  // If the primary was damaged after backup rotation, loading the previous
  // generation also repairs the primary through the atomic replacement path.
  writeFileSync(jsonPath, '{"broken":', "utf8");
  const backupWorld = createMemoryWorldStore();
  const backupPersist = createWorldPersister({ world: backupWorld, filePath: jsonPath });
  const recovery = backupPersist.loadIfPresent();
  assert.equal(recovery.recoveredFromBackup, true);
  assert.equal(backupWorld.getPlayer("json-crash-player")?.cash, 10);
  assert.doesNotThrow(() => JSON.parse(readFileSync(jsonPath, "utf8")));
  assert.equal(existsSync(`${jsonPath}.tmp`), false);
  assert.equal(existsSync(`${jsonPath}.bak.tmp`), false);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("persistence-crash-recovery-smoke: committed + rollback + JSON recovery ok");
