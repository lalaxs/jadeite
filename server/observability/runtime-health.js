export function createRuntimeHealth() {
  const state = {
    booting: true,
    serving: false,
    ready: false,
    shuttingDown: false,
    persistence: "unknown",
    persistenceLatencyMs: null,
    lastPersistenceSuccessAt: 0,
    consecutivePersistenceFailures: 0,
    lastError: null,
    startedAt: Date.now()
  };
  let readinessProbe = null;
  let probePromise = null;
  let lastProbeAt = 0;
  let writeFailurePending = false;

  function publicSnapshot() {
    return { ...state, now: Date.now() };
  }

  return {
    snapshot() {
      return publicSnapshot();
    },
    setReadinessProbe(probe) {
      readinessProbe = typeof probe === "function" ? probe : null;
    },
    async checkReadiness({ maxAgeMs = 2_000 } = {}) {
      if (!state.serving || state.shuttingDown || !readinessProbe) return publicSnapshot();
      if (!probePromise && Date.now() - lastProbeAt >= maxAgeMs) {
        probePromise = Promise.resolve()
          .then(() => readinessProbe())
          .then((result = {}) => {
            const failures = Number(result.consecutiveFailures) || 0;
            state.persistenceLatencyMs = Number(result.latencyMs) || 0;
            state.lastPersistenceSuccessAt = Number(result.lastSuccessfulWriteAt) || state.lastPersistenceSuccessAt;
            state.consecutivePersistenceFailures = failures;
            state.ready = state.serving && !state.shuttingDown && !writeFailurePending && failures === 0;
            state.persistence = state.ready ? "ready" : "error";
            if (state.ready) state.lastError = null;

          })
          .catch((error) => {
            state.persistence = "error";
            state.persistenceLatencyMs = null;
            state.consecutivePersistenceFailures += 1;
            state.lastError = error?.message || String(error || "persistence unavailable");
            state.ready = false;
          })
          .finally(() => {
            lastProbeAt = Date.now();
            probePromise = null;
          });
      }
      if (probePromise) await probePromise;
      return publicSnapshot();
    },
    markReady(persistence = "ready") {
      state.booting = false;
      state.serving = true;
      state.ready = true;
      state.persistence = persistence;
      state.lastError = null;
    },
    markError(error) {
      state.booting = false;
      state.serving = false;
      state.ready = false;
      state.lastError = error?.message || String(error || "unknown error");
    },
    markPersistenceSuccess(details = {}) {
      writeFailurePending = false;
      state.persistence = "ready";
      state.persistenceLatencyMs = Number(details.latencyMs) || 0;
      state.lastPersistenceSuccessAt = Number(details.lastSuccessfulWriteAt) || Date.now();
      state.consecutivePersistenceFailures = Number(details.consecutiveFailures) || 0;
      state.lastError = null;
      state.ready = state.serving && !state.shuttingDown;
    },
    markPersistenceError(error, details = {}) {
      writeFailurePending = true;
      state.persistence = "error";
      state.persistenceLatencyMs = null;
      state.consecutivePersistenceFailures = Math.max(
        state.consecutivePersistenceFailures + 1,
        Number(details.consecutiveFailures) || 0
      );
      state.lastError = error?.message || String(error || "persistence unavailable");
      state.ready = false;
    },
    markShuttingDown() {
      state.shuttingDown = true;
      state.ready = false;
    }
  };
}
