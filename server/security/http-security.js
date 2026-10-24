import compression from "compression";
import { timingSafeEqual } from "node:crypto";
import helmet from "helmet";
import { rateLimit, MemoryStore } from "express-rate-limit";
import pinoHttp from "pino-http";

function authorizeMetrics(config, req) {
  if (!config.adminToken) return !config.isProduction;
  const authorization = String(req.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${config.adminToken}`);
  const supplied = Buffer.from(authorization);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function installHttpSecurity({ app, config, logger, metrics, health }) {
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(pinoHttp({ logger }));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        // Safari also upgrades loopback resources; local previews use HTTP.
        upgradeInsecureRequests: config.isProduction ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.isProduction
  }));
  app.use(compression());
  // A game boot loads many static modules; reserve this budget for APIs.
  const requestStore = new MemoryStore();
  app.use(["/api", "/metrics"], rateLimit({
    store: requestStore,
    windowMs: 60_000,
    limit: config.httpRequestsPerMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false
  }));
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      metrics.increment("jade_http_requests_total", {
        method: req.method,
        status: res.statusCode
      });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      metrics.increment("jade_http_request_milliseconds_total", { method: req.method }, elapsedMs);
    });
    next();
  });

  app.get("/health/live", (_req, res) => {
    res.status(200).json({ ok: true, status: "live", version: config.appVersion });
  });
  app.get("/health/ready", async (_req, res) => {
    const snapshot = typeof health.checkReadiness === "function"
      ? await health.checkReadiness()
      : health.snapshot();
    metrics.set("jade_server_ready", {}, snapshot.ready ? 1 : 0);
    res.status(snapshot.ready ? 200 : 503).json({ ok: snapshot.ready, ...snapshot });
  });
  app.get("/version", (_req, res) => {
    res.status(200).json({ version: config.appVersion, environment: config.nodeEnv });
  });
  app.get("/metrics", (req, res) => {
    if (!authorizeMetrics(config, req)) return res.status(404).end();
    metrics.set("jade_server_ready", {}, health.snapshot().ready ? 1 : 0);
    res.type("text/plain; version=0.0.4").send(metrics.render());
  });
  return () => requestStore.shutdown();
}
