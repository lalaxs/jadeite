import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTiming } from "../shared/domain/economy/jade-loop.js";
import { wireServer } from "./boot/wire-server.js";
import { createTestHooks } from "./shell/test-hooks.js";
import { loadRuntimeConfig } from "./config/runtime-config.js";
import { createLogger } from "./observability/logger.js";
import { createMetrics } from "./observability/metrics.js";
import { createRuntimeHealth } from "./observability/runtime-health.js";
import { installHttpSecurity } from "./security/http-security.js";
import { installSocketServerSecurity, socketServerOptions } from "./security/socket-security.js";

const rootDirectory = fileURLToPath(new URL("../", import.meta.url));

// Importing this factory does not create a world, listener, timer or signal handler.
// Distinct persistent instances must be given distinct save paths (or databases).
export function createGame({ env = process.env, cwd = process.cwd(), world, createPersister, legacyBindings = false } = {}) {
  const environment = { ...env };
  const runtimeConfig = loadRuntimeConfig(environment);
  const logger = createLogger(runtimeConfig);
  const metrics = createMetrics();
  const health = createRuntimeHealth();
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, socketServerOptions(runtimeConfig));
  const PORT = runtimeConfig.port;
  const OPEN_WINDOW_RATE = 0.04;
  const DEFAULT_AUCTION_HALL_ID = "novice";
  const TIMING_PROFILE = environment.JADE_TIMING_PROFILE || "normal";
  const TIMING = resolveTiming(TIMING_PROFILE);

  const stopHttpSecurity = installHttpSecurity({ app, config: runtimeConfig, logger, metrics, health });
  const stopSocketSecurity = installSocketServerSecurity({ io, config: runtimeConfig, logger, metrics });
  app.use(express.json({ limit: "32kb", strict: true }));
  if (!runtimeConfig.isProduction) {
    app.use(express.static(path.join(rootDirectory, "public"), {
      etag: true,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (/\.(?:png|jpe?g|webp|gif|svg)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
          return;
        }
        res.setHeader("Cache-Control", "no-cache");
      }
    }));
    app.use("/shared", express.static(path.join(rootDirectory, "shared")));
  }

  try {
    const boot = wireServer({
      app, io, httpServer, PORT, TIMING, TIMING_PROFILE, OPEN_WINDOW_RATE, DEFAULT_AUCTION_HALL_ID,
      runtimeConfig, logger, metrics, health, stopSocketSecurity, stopHttpSecurity,
      env: environment, cwd, world, createPersister, legacyBindings
    });
    return { ...boot, app, io, httpServer, runtimeConfig, logger, metrics, health, __testHooks: createTestHooks(boot.testHookBindings) };
  } catch (error) {
    stopSocketSecurity();
    stopHttpSecurity();
    io.close(() => {});
    throw error;
  }
}
