import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

function terminateWithoutCleanup() {
  try {
    process.kill(process.pid, "SIGKILL");
  } catch {
    process.abort();
  }
}

const [mode, targetPath, rawCash] = process.argv.slice(2);

if (mode === "json-partial") {
  const fd = openSync(`${targetPath}.tmp`, "w", 0o600);
  writeSync(fd, '{"version":2,"savedAt":');
  fsyncSync(fd);
  closeSync(fd);
  terminateWithoutCleanup();
} else if (mode === "sqlite-committed" || mode === "sqlite-uncommitted") {
  const database = new DatabaseSync(targetPath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  const row = database.prepare(`
    SELECT snapshot_version, payload
    FROM world_snapshots
    ORDER BY id DESC
    LIMIT 1
  `).get();
  const snapshot = JSON.parse(row.payload);
  snapshot.savedAt = Date.now();
  snapshot.players[0][1].cash = Number(rawCash);
  const payload = JSON.stringify(snapshot);
  const checksum = createHash("sha256").update(payload, "utf8").digest("hex");
  database.exec("BEGIN IMMEDIATE");
  database.prepare(`
    INSERT INTO world_snapshots (
      snapshot_version, saved_at, player_count, payload, checksum, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    Number(snapshot.version),
    Number(snapshot.savedAt),
    snapshot.players.length,
    payload,
    checksum,
    Date.now()
  );
  if (mode === "sqlite-committed") database.exec("COMMIT");
  terminateWithoutCleanup();
} else {
  throw new Error(`unknown crash mode: ${mode}`);
}

