// Compatibility entry point. New hosts should construct their own game with createGame.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGame } from "./server/create-game.js";
import { installProcessLifecycle } from "./server/boot/process-lifecycle.js";

export { createGame };
const game = createGame({ legacyBindings: true });
export const { materialCatalogForPlayer, buyMaterialPack, __testHooks } = game;

function isDirectRun() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const detachSignals = installProcessLifecycle({ game });
  game.startServer().catch((error) => {
    detachSignals();
    game.health.markError(error);
    game.logger.fatal({ error: error?.message || error }, "server startup failed");
    process.exitCode = 1;
  });
}
