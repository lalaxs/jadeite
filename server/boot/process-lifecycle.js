// Only the executable host owns process signals and process exit.
export function installProcessLifecycle({ game, host = process }) {
  const { logger, runtimeConfig } = game;
  let handling = false;
  let forceTimer = null;
  const onInt = () => handleSignal("SIGINT");
  const onTerm = () => handleSignal("SIGTERM");

  function dispose() {
    host.off("SIGINT", onInt);
    host.off("SIGTERM", onTerm);
    if (forceTimer) clearTimeout(forceTimer);
    forceTimer = null;
  }

  function handleSignal(signal) {
    if (handling) return;
    handling = true;
    forceTimer = setTimeout(() => {
      logger.error?.({ signal }, "graceful shutdown timed out");
      host.exit(1);
    }, runtimeConfig.shutdownGraceMs || 15_000);
    forceTimer.unref?.();
    game.shutdown(signal)
      .then(() => { dispose(); host.exit(0); })
      .catch(error => {
        dispose();
        logger.error?.({ signal, error: error?.message || error }, "graceful shutdown failed");
        host.exit(1);
      });
  }

  host.once("SIGINT", onInt);
  host.once("SIGTERM", onTerm);
  return dispose;
}
