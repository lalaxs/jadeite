/**
 * In-memory transaction boundary for synchronous authoritative mutations.
 *
 * The server runs gameplay commands on one event loop, so taking snapshots of
 * the directly affected roots is enough to prevent a thrown dependency from
 * leaving cash, inventory, escrow and world collections half-mutated. Durable
 * crash atomicity belongs to the persistence adapter; this module protects the
 * live simulation state between persistence checkpoints.
 */

function cloneRoot(root) {
  if (!root || typeof root !== "object") {
    throw new TypeError("atomic-mutation: roots must be objects, arrays, maps or sets");
  }
  return structuredClone(root);
}

function restoreRoot(target, snapshot) {
  const restored = structuredClone(snapshot);
  if (Array.isArray(target)) {
    target.splice(0, target.length, ...restored);
    return;
  }
  if (target instanceof Map) {
    for (const key of [...target.keys()]) {
      if (!restored.has(key)) target.delete(key);
    }
    for (const [key, value] of restored) {
      const current = target.get(key);
      if (canRestoreInPlace(current, value)) restoreRoot(current, value);
      else target.set(key, value);
    }
    return;
  }
  if (target instanceof Set) {
    target.clear();
    for (const value of restored) target.add(value);
    return;
  }
  const restoredKeys = new Set(Reflect.ownKeys(restored));
  for (const key of Reflect.ownKeys(target)) {
    if (Object.prototype.propertyIsEnumerable.call(target, key) && !restoredKeys.has(key)) {
      delete target[key];
    }
  }
  for (const key of Reflect.ownKeys(restored)) {
    if (!Object.prototype.propertyIsEnumerable.call(restored, key)) continue;
    const current = target[key];
    if (canRestoreInPlace(current, restored[key])) restoreRoot(current, restored[key]);
    else target[key] = restored[key];
  }
}

function canRestoreInPlace(target, snapshot) {
  if (!target || !snapshot || typeof target !== "object" || typeof snapshot !== "object") {
    return false;
  }
  if (Array.isArray(target) || Array.isArray(snapshot)) {
    return Array.isArray(target) && Array.isArray(snapshot);
  }
  if (target instanceof Map || snapshot instanceof Map) {
    return target instanceof Map && snapshot instanceof Map;
  }
  if (target instanceof Set || snapshot instanceof Set) {
    return target instanceof Set && snapshot instanceof Set;
  }
  return Object.getPrototypeOf(target) === Object.prototype
    && Object.getPrototypeOf(snapshot) === Object.prototype;
}

function uniqueRoots(roots) {
  const seen = new Set();
  const normalized = [];
  for (const root of roots || []) {
    if (!root || typeof root !== "object" || seen.has(root)) continue;
    seen.add(root);
    normalized.push(root);
  }
  return normalized;
}

export function runAtomicMutation(roots, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("atomic-mutation: operation must be a function");
  }
  const tracked = uniqueRoots(roots);
  const snapshots = tracked.map((root) => cloneRoot(root));
  try {
    return operation();
  } catch (error) {
    for (let index = tracked.length - 1; index >= 0; index -= 1) {
      restoreRoot(tracked[index], snapshots[index]);
    }
    throw error;
  }
}

export function attemptAtomicMutation(roots, operation, options = {}) {
  const effects = [];
  const afterCommit = (effect) => {
    if (typeof effect === "function") effects.push(effect);
  };
  let result;
  try {
    result = runAtomicMutation(roots, () => operation({ afterCommit }));
  } catch (error) {
    if (typeof options.onRollback === "function") options.onRollback(error);
    return {
      ok: false,
      code: "TRANSACTION_ABORTED",
      message: options.message || "交易未完成，资产状态已恢复，请重试。"
    };
  }
  for (const effect of effects) {
    try {
      effect();
    } catch (error) {
      if (typeof options.onEffectError === "function") options.onEffectError(error);
    }
  }
  return result;
}
