/**
 * JSON file persistence for WorldStore (exportSnapshot / importSnapshot).
 * Default path: data/world.json — override with JADE_WORLD_PATH.
 * Disable with JADE_WORLD_PERSIST=0.
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

export const DEFAULT_WORLD_SAVE_MS = 30_000;

const UNSUPPORTED_DIRECTORY_FSYNC_CODES = new Set([
  "EBADF",
  "EINVAL",
  "EISDIR",
  "ENOTSUP",
  "EPERM"
]);

function syncFilePath(filePath) {
  const fd = openSync(filePath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function syncParentDirectory(filePath) {
  let fd;
  try {
    fd = openSync(path.dirname(filePath), "r");
    fsyncSync(fd);
  } catch (error) {
    // Windows and a few filesystems do not support fsync on directory handles.
    // The file itself has already been fsynced, so only ignore that known gap.
    if (!UNSUPPORTED_DIRECTORY_FSYNC_CODES.has(error?.code)) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function replaceWithDurableCopy(sourcePath, targetPath) {
  const tmp = `${targetPath}.tmp`;
  copyFileSync(sourcePath, tmp);
  syncFilePath(tmp);
  renameSync(tmp, targetPath);
  syncParentDirectory(targetPath);
}

export function resolveWorldPersistPath(env = process.env, cwd = process.cwd()) {
  const custom = String(env.JADE_WORLD_PATH || "").trim();
  if (custom) return path.resolve(cwd, custom);
  return path.join(cwd, "data", "world.json");
}

export function isWorldPersistEnabled(env = process.env) {
  const raw = String(env.JADE_WORLD_PERSIST ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function resolveWorldSaveIntervalMs(env = process.env) {
  const n = Number(env.JADE_WORLD_SAVE_MS);
  return Number.isFinite(n) && n >= 5_000 ? Math.floor(n) : DEFAULT_WORLD_SAVE_MS;
}

/**
 * @param {{ world: { exportSnapshot(): object, importSnapshot(s: object): unknown, raw: { sockets: Map } }, filePath: string, intervalMs?: number }} opts
 */
export function createWorldPersister({
  world,
  filePath,
  intervalMs = DEFAULT_WORLD_SAVE_MS
}) {
  if (!world || typeof world.exportSnapshot !== "function" || typeof world.importSnapshot !== "function") {
    throw new Error("world-persist: world with exportSnapshot/importSnapshot required");
  }
  if (!filePath) throw new Error("world-persist: filePath required");

  let timer = null;

  function backupPath() {
    return `${filePath}.bak`;
  }

  function loadFrom(candidatePath) {
    const text = readFileSync(candidatePath, "utf8");
    const snapshot = JSON.parse(text);
    world.importSnapshot(snapshot);
    world.raw.sockets.clear();
    return {
      loaded: true,
      path: candidatePath,
      players: world.raw.players?.size ?? 0
    };
  }

  function loadIfPresent() {
    const backup = backupPath();
    if (!existsSync(filePath) && !existsSync(backup)) {
      return { loaded: false, path: filePath, players: 0 };
    }
    try {
      return { ...loadFrom(filePath), recoveredFromBackup: false };
    } catch (primaryError) {
      if (!existsSync(backup)) throw primaryError;
      try {
        const recovered = loadFrom(backup);
        // Restore the last known-good snapshot immediately. Otherwise the next
        // flush would rotate the corrupt primary over the healthy backup.
        replaceWithDurableCopy(backup, filePath);
        return {
          ...recovered,
          path: filePath,
          recoveredFromBackup: true,
          recoverySource: backup,
          primaryError: primaryError?.message || String(primaryError)
        };
      } catch (backupError) {
        throw new AggregateError(
          [primaryError, backupError],
          "world-persist: primary and backup saves are unreadable"
        );
      }
    }
  }

  function flushSync() {
    const dir = path.dirname(filePath);
    mkdirSync(dir, { recursive: true });
    const savedAt = Date.now();
    const snapshot = world.exportSnapshot({ savedAt });
    snapshot.sockets = [];
    snapshot.savedAt = savedAt;
    const tmp = `${filePath}.tmp`;
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(snapshot, null, 0)}\n`, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(filePath)) replaceWithDurableCopy(filePath, backupPath());
    renameSync(tmp, filePath);
    syncParentDirectory(filePath);
    return filePath;
  }

  function startAutoSave({ save = flushSync } = {}) {
    if (timer) return;
    timer = setInterval(() => {
      Promise.resolve().then(save).catch((error) => console.error("[persist] auto-save failed:", error?.message || error));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop({ flush = true } = {}) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (flush) flushSync();
  }

  return {
    filePath,
    backupPath: backupPath(),
    intervalMs,
    loadIfPresent,
    flushSync,
    startAutoSave,
    stop
  };
}
