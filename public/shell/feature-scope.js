export function createFeatureScope({ registerAction, timers = globalThis } = {}) {
  let active = false;
  let generation = 0;
  const cleanups = new Set();
  const scheduled = new Map();
  const frames = new Map();

  function guard(callback) {
    const owner = generation;
    return (...args) => active && owner === generation ? callback(...args) : undefined;
  }

  function listen(target, name, callback, options) {
    if (!target?.addEventListener) return () => {};
    const listener = guard(callback);
    target.addEventListener(name, listener, options);
    const stop = () => { target.removeEventListener(name, listener, options); cleanups.delete(stop); };
    cleanups.add(stop);
    return stop;
  }

  function register(name, callback) {
    const handler = guard(callback);
    const registration = registerAction?.(name, handler);
    if (typeof registration === "function") cleanups.add(registration);
    else if (registration?.off) cleanups.add(() => registration.off(name, handler));
  }

  function subscribe(target, name, callback) {
    if (!target?.on) return () => {};
    const listener = guard(callback);
    target.on(name, listener);
    const stop = () => { target.off(name, listener); cleanups.delete(stop); };
    cleanups.add(stop);
    return stop;
  }

  function cancel(handle) {
    scheduled.get(handle)?.();
    scheduled.delete(handle);
  }

  function timeout(callback, delay) {
    const run = guard(callback);
    const handle = timers.setTimeout(() => { scheduled.delete(handle); run(); }, delay);
    scheduled.set(handle, () => timers.clearTimeout(handle));
    return handle;
  }

  function interval(callback, delay) {
    const handle = timers.setInterval(guard(callback), delay);
    scheduled.set(handle, () => timers.clearInterval(handle));
    return handle;
  }

  function frame(callback) {
    const run = guard(callback);
    const handle = timers.requestAnimationFrame(time => { frames.delete(handle); run(time); });
    frames.set(handle, () => timers.cancelAnimationFrame(handle));
    return handle;
  }

  function dispose() {
    active = false;
    generation++;
    for (const stop of [...cleanups].reverse()) stop();
    cleanups.clear();
    for (const handle of scheduled.keys()) cancel(handle);
    for (const cancelFrame of frames.values()) cancelFrame();
    frames.clear();
  }

  return {
    activate() { active = true; }, get active() { return active; },
    guard, listen, register, subscribe, setTimeout: timeout, clearTimeout: cancel,
    setInterval: interval, clearInterval: cancel, requestAnimationFrame: frame,
    addCleanup(stop) { cleanups.add(stop); return () => cleanups.delete(stop); }, dispose
  };
}
