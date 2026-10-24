import { AsyncLocalStorage } from "node:async_hooks";

// Enlist a player root on access. Business services retain ordinary mutable
// objects; rollback copies only participants, including both sides of a trade.
export function createMutationTracking(raw, validate, version) {
  const context = new AsyncLocalStorage();
  class PlayerRoots extends Map {
    capture(id) {
      const scope = context.getStore();
      if (scope && !scope.players.has(id)) {
        scope.players.set(id, super.has(id) ? structuredClone(super.get(id)) : null);
      }
    }
    get(id) { this.capture(id); return super.get(id); }
    peek(id) { return super.get(id); }
    set(id, value) { this.capture(id); return super.set(id, value); }
    delete(id) { this.capture(id); return super.delete(id); }
    clear() { for (const id of super.keys()) this.capture(id); super.clear(); }
    *values() { for (const [id, value] of super.entries()) { this.capture(id); yield value; } }
    *entries() { for (const [id, value] of super.entries()) { this.capture(id); yield [id, value]; } }
    [Symbol.iterator]() { return this.entries(); }
    forEach(fn, receiver) { for (const [id, value] of this.entries()) fn.call(receiver, value, id, this); }
    *valuesWhere(predicate) {
      for (const [id, value] of super.entries()) {
        if (predicate(value)) { this.capture(id); yield value; }
      }
    }
    *valuesForRead(predicate) {
      for (const value of super.values()) if (predicate(value)) yield value;
    }
  }
  const original = raw.players;
  raw.players = new PlayerRoots();
  for (const [id, player] of original) raw.players.set(id, player);
  const worldKeys = () => Object.keys(raw).filter((key) => key !== "players" && key !== "sockets");
  const worldRoots = () => Object.fromEntries(worldKeys().map((key) => [key, structuredClone(raw[key])]));

  return {
    begin(savedAt) {
      const roots = worldRoots();
      const scope = { players: new Map() };
      return {
        run: (operation) => context.run(scope, operation),
        snapshots() {
          const before = {
            version, savedAt, ...roots, sockets: [],
            players: [...scope.players].filter(([, player]) => player !== null)
          };
          const after = {
            version, savedAt, ...worldRoots(), sockets: [],
            players: [...scope.players.keys()].filter((id) => raw.players.has(id))
              .map((id) => [id, structuredClone(raw.players.get(id))])
          };
          validate(after);
          return { before, after };
        },
        rollback() {
          for (const [id, player] of scope.players) {
            if (player === null) raw.players.delete(id);
            else raw.players.set(id, player);
          }
          for (const key of worldKeys()) if (!(key in roots)) delete raw[key];
          for (const [key, value] of Object.entries(roots)) raw[key] = value;
          // Transport lifetimes continue during database I/O. Never resurrect
          // a socket that disconnected while the transaction was in flight.
          for (const [socketId, playerId] of raw.sockets) {
            if (!raw.players.has(playerId)) raw.sockets.delete(socketId);
          }
        }
      };
    }
  };
}

// Predicates must be read-only; only selected players enter the transaction.
export function playersMatching(players, predicate) {
  return players.valuesWhere ? players.valuesWhere(predicate) : [...players.values()].filter(predicate);
}

// Read-only derived views must not enlist player roots. Before any write, reacquire
// the player with get()/playersMatching() so the original is captured for rollback.
export const peekPlayer = (players, id) => players.peek ? players.peek(id) : players.get(id);
export const playersForRead = (players, predicate) => players.valuesForRead
  ? players.valuesForRead(predicate) : [...players.values()].filter(predicate);
