/**
 * world-persist: JSON round-trip via exportSnapshot/importSnapshot.
 */
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
import { WORLD_STORE_VERSION, createMemoryWorldStore } from "../server/world-store.js";
import {
  createWorldPersister,
  isWorldPersistEnabled,
  resolveWorldPersistPath,
  resolveWorldSaveIntervalMs
} from "../server/shell/world-persist.js";

assert.equal(isWorldPersistEnabled({ JADE_WORLD_PERSIST: "0" }), false);
assert.equal(isWorldPersistEnabled({ JADE_WORLD_PERSIST: "false" }), false);
assert.equal(isWorldPersistEnabled({}), true);
assert.equal(isWorldPersistEnabled({ JADE_WORLD_PERSIST: "1" }), true);

const resolved = resolveWorldPersistPath({ JADE_WORLD_PATH: "tmp/world.json" }, process.cwd());
assert.ok(resolved.endsWith(path.join("tmp", "world.json")));
assert.equal(resolveWorldSaveIntervalMs({ JADE_WORLD_SAVE_MS: "12000" }), 12000);
assert.equal(resolveWorldSaveIntervalMs({ JADE_WORLD_SAVE_MS: "100" }), 30_000);

const dir = mkdtempSync(path.join(tmpdir(), "jade-world-"));
const filePath = path.join(dir, "world.json");

try {
  const store = createMemoryWorldStore({ startedAt: 42_000 });
  const livePlayer = { id: "p1", name: "翠店", cash: 55_000, rough: [], bracelets: [], lastSeenAt: 100 };
  store.setPlayer(livePlayer);
  store.raw.listings.push({
    id: "L1",
    ownerId: "p1",
    price: 9000,
    item: { id: "persisted-listing-item", type: "bracelet" }
  });
  store.raw.blackStalls.push({ id: "S1", ownerId: "p1", type: "goods", title: "夜摊" });
  store.bindSocket("sock-live", "p1");

  const persister = createWorldPersister({ world: store, filePath, intervalMs: 60_000 });
  assert.equal(persister.loadIfPresent().loaded, false);

  const beforeFlush = Date.now();
  const savedPath = persister.flushSync();
  const afterFlush = Date.now();
  assert.equal(savedPath, filePath);
  assert.equal(existsSync(filePath), true);

  const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(onDisk.version, WORLD_STORE_VERSION);
  assert.equal(onDisk.players[0][1].name, "翠店");
  assert.ok(onDisk.players[0][1].lastSeenAt >= beforeFlush && onDisk.players[0][1].lastSeenAt <= afterFlush);
  assert.equal(onDisk.players[0][1].lastSeenAt, onDisk.savedAt);
  assert.equal(livePlayer.lastSeenAt, 100, "autosave must stamp only the persisted clone");
  assert.deepEqual(onDisk.sockets, []);
  assert.ok(Number(onDisk.savedAt) > 0);

  livePlayer.rough.push({ id: "duplicate-live-item" });
  livePlayer.bracelets.push({ id: "duplicate-live-item" });
  assert.throws(
    () => persister.flushSync(),
    /duplicate owned item duplicate-live-item/,
    "a corrupt live state must fail before rotating the healthy primary save"
  );
  assert.deepEqual(
    JSON.parse(readFileSync(filePath, "utf8")),
    onDisk,
    "rejected export must leave the last healthy save untouched"
  );
  livePlayer.rough.length = 0;
  livePlayer.bracelets.length = 0;

  livePlayer.cash = Infinity;
  assert.throws(
    () => persister.flushSync(),
    /player p1\.cash must be a finite non-negative number/,
    "non-finite cash must fail before JSON can silently persist it as null"
  );
  assert.deepEqual(
    JSON.parse(readFileSync(filePath, "utf8")),
    onDisk,
    "rejected monetary export must leave the last healthy save untouched"
  );
  livePlayer.cash = 55_000;

  const restored = createMemoryWorldStore();
  const loader = createWorldPersister({ world: restored, filePath });
  const result = loader.loadIfPresent();
  assert.equal(result.loaded, true);
  assert.equal(result.players, 1);
  assert.equal(restored.getPlayer("p1")?.cash, 55_000);
  assert.equal(restored.raw.listings[0].id, "L1");
  assert.equal(restored.raw.blackStalls[0].id, "S1");
  assert.equal(restored.raw.sockets.size, 0, "sockets cleared on load");

  // A later flush rotates the last known-good primary to .bak.
  store.getPlayer("p1").cash = 61_000;
  persister.flushSync();
  assert.equal(existsSync(`${filePath}.bak`), true);
  writeFileSync(filePath, "{broken-json", "utf8");
  const recovered = createMemoryWorldStore();
  const recoveryLoader = createWorldPersister({ world: recovered, filePath });
  const recovery = recoveryLoader.loadIfPresent();
  assert.equal(recovery.recoveredFromBackup, true);
  assert.equal(recovered.getPlayer("p1")?.cash, 55_000, "backup should contain the prior complete save");
  assert.equal(
    JSON.parse(readFileSync(filePath, "utf8")).players[0][1].cash,
    55_000,
    "backup recovery should immediately repair the corrupt primary"
  );

  // Semantic corruption also falls back instead of silently overwriting a player.
  const duplicateSave = JSON.parse(readFileSync(filePath, "utf8"));
  duplicateSave.players.push(["p1", { ...duplicateSave.players[0][1] }]);
  writeFileSync(filePath, JSON.stringify(duplicateSave), "utf8");
  const semanticRecovered = createMemoryWorldStore();
  const semanticLoader = createWorldPersister({ world: semanticRecovered, filePath });
  const semanticResult = semanticLoader.loadIfPresent();
  assert.equal(semanticResult.recoveredFromBackup, true);
  assert.equal(semanticRecovered.getPlayer("p1")?.cash, 55_000);

  // wire-server exposes persister hook + startServer wrapper
  const wireSource = readFileSync("server/boot/wire-server.js", "utf8") + readFileSync("server/boot/game-lifecycle.js", "utf8");
  assert.match(wireSource, /createWorldPersister/);
  assert.match(wireSource, /persister\.loadIfPresent/);
  assert.match(wireSource, /persister\.startAutoSave/);
  assert.match(wireSource, /persister\.flushSync/);
  assert.match(wireSource, /JADE_WORLD_PERSIST|isWorldPersistEnabled/);

  const ignore = readFileSync(".gitignore", "utf8");
  assert.match(ignore, /^data\/$/m);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("world-persist-smoke: ok");
