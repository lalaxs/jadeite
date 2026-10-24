const SNAPSHOT_META_KEYS = new Set(["version", "savedAt", "sockets", "players"]);

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function playerMap(snapshot) {
  return new Map(Array.isArray(snapshot?.players) ? snapshot.players : []);
}

export function createWorldDelta(beforeSnapshot, afterSnapshot, metadata = {}) {
  if (!beforeSnapshot || !afterSnapshot) {
    throw new Error("world-delta: beforeSnapshot and afterSnapshot are required");
  }
  const beforePlayers = playerMap(beforeSnapshot);
  const afterPlayers = playerMap(afterSnapshot);
  const upsert = [];
  const remove = [];

  for (const [playerId, player] of afterPlayers) {
    if (!beforePlayers.has(playerId) || !jsonEqual(beforePlayers.get(playerId), player)) {
      upsert.push([playerId, structuredClone(player)]);
    }
  }
  for (const playerId of beforePlayers.keys()) {
    if (!afterPlayers.has(playerId)) remove.push(playerId);
  }

  const world = {};
  const removeWorldKeys = [];
  const keys = new Set([...Object.keys(beforeSnapshot), ...Object.keys(afterSnapshot)]);
  for (const key of keys) {
    if (SNAPSHOT_META_KEYS.has(key)) continue;
    const beforeHas = Object.prototype.hasOwnProperty.call(beforeSnapshot, key);
    const afterHas = Object.prototype.hasOwnProperty.call(afterSnapshot, key);
    if (!afterHas && beforeHas) {
      removeWorldKeys.push(key);
    } else if (afterHas && (!beforeHas || !jsonEqual(beforeSnapshot[key], afterSnapshot[key]))) {
      world[key] = structuredClone(afterSnapshot[key]);
    }
  }

  return {
    version: 1,
    snapshotVersion: Number(afterSnapshot.version),
    savedAt: Math.max(0, Math.round(Number(metadata.savedAt ?? afterSnapshot.savedAt) || Date.now())),
    action: String(metadata.action || "mutation").slice(0, 128),
    actorId: metadata.actorId == null ? null : String(metadata.actorId).slice(0, 128),
    requestId: metadata.requestId == null ? null : String(metadata.requestId).slice(0, 128),
    players: { upsert, remove },
    world,
    removeWorldKeys
  };
}

export function worldDeltaHasChanges(delta) {
  return Boolean(
    delta?.players?.upsert?.length
    || delta?.players?.remove?.length
    || Object.keys(delta?.world || {}).length
    || delta?.removeWorldKeys?.length
  );
}

export function applyWorldDelta(snapshot, delta) {
  return replayWorldDeltas(snapshot, [delta]);
}

export function replayWorldDeltas(snapshot, deltas) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("world-delta: snapshot object required");
  }
  // Keep the input immutable, but copy the checkpoint and index its players once.
  // A failed replay discards this local copy before it reaches the live world.
  const next = structuredClone(snapshot);
  const players = playerMap(next);
  for (const delta of deltas) {
    if (Number(delta?.version) !== 1) {
      throw new Error(`world-delta: unsupported delta version ${delta?.version}`);
    }
    if (Number(delta.snapshotVersion) !== Number(snapshot.version)) {
      throw new Error(`world-delta: snapshot version ${snapshot.version} cannot apply delta for ${delta.snapshotVersion}`);
    }
    for (const playerId of delta.players?.remove || []) players.delete(String(playerId));
    for (const [playerId, player] of delta.players?.upsert || []) {
      players.set(String(playerId), structuredClone(player));
    }
    for (const key of delta.removeWorldKeys || []) delete next[key];
    for (const [key, value] of Object.entries(delta.world || {})) next[key] = structuredClone(value);
    next.savedAt = Math.max(Number(next.savedAt) || 0, Number(delta.savedAt) || 0);
  }
  next.players = [...players.entries()];
  next.sockets = [];
  return next;
}
