// A broadcast shares one detached snapshot across all recipients. Cache its
// signatures for that object only; personalized or replaced fields still serialize.
export function createStateSignatureBuilder() {
  const sharedSignatures = new WeakMap();
  const ignored = new Set(["serverNow", "stateVersion"]);
  return function snapshotSignatures(snapshot, sharedSnapshot = null) {
    let common = null;
    if (sharedSnapshot) {
      common = sharedSignatures.get(sharedSnapshot);
      if (!common) {
        common = new Map(Object.entries(sharedSnapshot).filter(([key]) => !ignored.has(key))
          .map(([key, value]) => [key, JSON.stringify(value)]));
        sharedSignatures.set(sharedSnapshot, common);
      }
    }
    const signatures = new Map();
    for (const [key, value] of Object.entries(snapshot || {})) {
      if (ignored.has(key)) continue;
      signatures.set(key, common?.has(key) && value === sharedSnapshot[key] ? common.get(key) : JSON.stringify(value));
    }
    return signatures;
  };
}
