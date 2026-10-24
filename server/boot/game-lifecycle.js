// Own startup and resource disposal for one game. Process signals belong to the CLI host.
export function createGameLifecycle({
  world, persister, normalizePlayer, checkMiningHealth, reconcileWorld,
  flushPersistence, durableMutations, startHttpServer, stopHttpServer,
  io, stopSocketSecurity, stopHttpSecurity, stopAccountRoutes, health, logger, metrics
}) {
  let phase = "created";
  let startupPromise = null;
  let shutdownPromise = null;
  let cleanupPromise = null;
  let stopping = false;
  let initialized = false;
  let onListenerError = null;
  let listener = null;

  function closedError() {
    return Object.assign(new Error("Cannot start a disposed game; create a new game instance"), { code: "ERR_GAME_CLOSED" });
  }

  async function restoreWorld() {
    let migratedPayrollOnBoot = false;
    if (persister) {
      try {
        const result = await persister.loadIfPresent();
        if (result.loaded) {
          for (const player of world.allPlayers()) {
            const payrollVersion = player.employeePayroll?.version;
            normalizePlayer(player);
            if (payrollVersion !== player.employeePayroll?.version) migratedPayrollOnBoot = true;
          }
          if (result.migratedFrom) {
            console.log(`[persist] migrated JSON save ${result.migratedFrom} into ${persister.filePath}`);
          }
          if (result.recoveredFromBackup) {
            console.warn(
              `[persist] primary save failed; recovered ${result.players} player(s) from ${result.recoverySource}`
            );
          }
          console.log(
            `[persist] restored ${result.players} player(s) from ${persister.filePath}`
          );
        } else {
          console.log(`[persist] no save at ${persister.filePath} (fresh world)`);
        }
      } catch (err) {
        health?.markError?.(err);
        logger.error?.({ error: err?.message || err }, "persistence load failed; refusing startup");
        throw err;
      }
    }
    if (stopping) throw closedError();
    checkMiningHealth();
    const reconciledOnBoot = reconcileWorld(Date.now(), {
      broadcast: false,
      livestreamCatchUpMaxVisits: 60
    });
    if (persister) {
      // Preserve the existing migration checkpoint before opening the listener.
      if (reconciledOnBoot || migratedPayrollOnBoot) await flushPersistence();
      if (stopping) throw closedError();
      persister.startAutoSave({ save: () => durableMutations.checkpoint(() => flushPersistence()) });
    }
    initialized = true;
  }

  function closeResources(signal, flush) {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      health?.markShuttingDown?.();
      metrics.set("jade_server_ready", {}, 0);
      logger.info?.({ signal }, "server shutdown started");
      const errors = [];
      const attempt = async (operation) => {
        try { await operation(); } catch (error) { errors.push(error); }
      };
      await attempt(() => stopSocketSecurity?.());
      await attempt(() => io.disconnectSockets?.(true));
      await attempt(() => durableMutations?.close?.());
      await attempt(() => stopHttpServer());
      await attempt(() => stopAccountRoutes?.());
      await attempt(() => stopHttpSecurity?.());
      if (persister) {
        await attempt(async () => {
          if (typeof persister.stop === "function") await persister.stop({ flush });
          else if (flush) await flushPersistence();
        });
        await attempt(() => persister.close?.());
      }
      await attempt(() => new Promise((resolve, reject) => {
        io.close(error => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
      }));
      if (onListenerError) listener?.off("error", onListenerError);
      logger.info?.({ signal }, "server shutdown completed");
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, "Game resource cleanup failed");
    })();
    return cleanupPromise;
  }

  function startServer() {
    if (stopping || phase === "failed") return Promise.reject(closedError());
    if (startupPromise) return startupPromise;
    phase = "starting";
    startupPromise = (async () => {
      try {
        await restoreWorld();
        if (stopping) throw closedError();
        listener = startHttpServer();
        await new Promise((resolve, reject) => {
          if (listener.listening) return resolve();
          const ready = () => { listener.off("error", failed); resolve(); };
          const failed = error => { listener.off("listening", ready); reject(error); };
          listener.once("listening", ready);
          listener.once("error", failed);
        });
        if (stopping) throw closedError();
        onListenerError = error => {
          health?.markError?.(error);
          metrics.set("jade_server_ready", {}, 0);
          logger.error?.({ error: error?.message || error }, "server listen failed");
        };
        listener.once("error", onListenerError);
        health?.markReady?.(persister?.driver || (persister ? "file" : "disabled"));
        metrics.set("jade_server_ready", {}, 1);
        phase = "running";
        return listener;
      } catch (error) {
        phase = "failed";
        health?.markError?.(error);
        metrics.set("jade_server_ready", {}, 0);
        try { await closeResources("startup-failed", false); }
        catch (cleanupError) { logger.error?.({ error: cleanupError?.message || cleanupError }, "startup cleanup failed"); }
        throw error;
      }
    })();
    return startupPromise;
  }

  function shutdown(signal = "shutdown") {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    phase = "stopping";
    shutdownPromise = (async () => {
      try {
        if (startupPromise) await startupPromise.catch(() => {});
        await closeResources(signal, initialized);
      } finally {
        phase = "stopped";
      }
    })();
    return shutdownPromise;
  }

  return { startServer, shutdown, status: () => ({ phase }) };
}
