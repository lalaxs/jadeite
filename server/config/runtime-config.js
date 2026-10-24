import { z } from "zod";

const booleanText = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === "boolean") return value;
  return !["0", "false", "off", "no", ""].includes(value.trim().toLowerCase());
});

const optionalText = z.string().trim().optional().transform((value) => value || null);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_ORIGIN: optionalText,
  TRUST_PROXY: z.string().trim().default("loopback"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  APP_VERSION: z.string().trim().default("dev"),
  JADE_DEBUG_TOOLS: booleanText.default(true),
  JADE_WORLD_PERSIST: booleanText.default(true),
  JADE_ALLOW_VOLATILE_PRODUCTION: booleanText.default(false),
  JADE_WORLD_PERSIST_DRIVER: z.enum(["json", "sqlite", "postgres"]).default("json"),
  DATABASE_URL: optionalText,
  JADE_WORLD_SAVE_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  JADE_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
  SOCKET_MAX_BUFFER_BYTES: z.coerce.number().int().min(4096).max(1048576).default(131072),
  SOCKET_CONNECTS_PER_MINUTE: z.coerce.number().int().min(5).max(1000).default(60),
  SOCKET_EVENTS_PER_10_SECONDS: z.coerce.number().int().min(10).max(1000).default(120),
  HTTP_REQUESTS_PER_MINUTE: z.coerce.number().int().min(30).max(10000).default(300),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  ADMIN_TOKEN: optionalText
}).passthrough();

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function parseTrustProxy(value) {
  const text = String(value || "loopback").trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

function validatePublicOrigins(origins, isProduction) {
  for (const origin of origins) {
    let url;
    try {
      url = new URL(origin);
    } catch (_) {
      throw new Error(`runtime-config: invalid PUBLIC_ORIGIN ${origin}`);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
      throw new Error(`runtime-config: PUBLIC_ORIGIN must contain exact HTTP(S) origins: ${origin}`);
    }
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (isProduction && url.protocol !== "https:" && !isLoopback) {
      throw new Error(`runtime-config: production PUBLIC_ORIGIN must use HTTPS: ${origin}`);
    }
  }
}

export function loadRuntimeConfig(env = process.env) {
  const parsed = environmentSchema.safeParse(env);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`runtime-config: ${summary}`);
  }
  const values = parsed.data;
  const isProduction = values.NODE_ENV === "production";
  const publicOrigins = parseOrigins(values.PUBLIC_ORIGIN);
  if (isProduction && !publicOrigins.length) {
    throw new Error("runtime-config: PUBLIC_ORIGIN is required in production");
  }
  validatePublicOrigins(publicOrigins, isProduction);
  if (isProduction && (!values.ADMIN_TOKEN || values.ADMIN_TOKEN.length < 32)) {
    throw new Error("runtime-config: ADMIN_TOKEN must contain at least 32 characters in production");
  }
  if (isProduction && /replace[_-]?with|change[_-]?me|changeme/i.test(values.ADMIN_TOKEN)) {
    throw new Error("runtime-config: ADMIN_TOKEN still contains a placeholder value");
  }
  if (isProduction && !values.JADE_WORLD_PERSIST && !values.JADE_ALLOW_VOLATILE_PRODUCTION) {
    throw new Error("runtime-config: persistence cannot be disabled in production");
  }
  if (
    isProduction
    && values.JADE_WORLD_PERSIST
    && values.JADE_WORLD_PERSIST_DRIVER !== "postgres"
  ) {
    throw new Error("runtime-config: production persistence must use postgres");
  }
  if (values.JADE_WORLD_PERSIST_DRIVER === "postgres" && !values.DATABASE_URL) {
    throw new Error("runtime-config: DATABASE_URL is required for postgres persistence");
  }
  if (
    isProduction
    && values.DATABASE_URL
    && /replace[_-]?with|change[_-]?me|changeme/i.test(values.DATABASE_URL)
  ) {
    throw new Error("runtime-config: DATABASE_URL still contains a placeholder credential");
  }
  return Object.freeze({
    nodeEnv: values.NODE_ENV,
    isProduction,
    host: values.HOST,
    port: values.PORT,
    publicOrigins,
    trustProxy: parseTrustProxy(values.TRUST_PROXY),
    logLevel: values.LOG_LEVEL,
    appVersion: values.APP_VERSION,
    debugToolsEnabled: !isProduction && values.JADE_DEBUG_TOOLS,
    persistEnabled: values.JADE_WORLD_PERSIST,
    allowVolatileProduction: values.JADE_ALLOW_VOLATILE_PRODUCTION,
    persistDriver: values.JADE_WORLD_PERSIST_DRIVER,
    databaseUrl: values.DATABASE_URL,
    saveIntervalMs: values.JADE_WORLD_SAVE_MS,
    auditRetentionDays: values.JADE_AUDIT_RETENTION_DAYS,
    socketMaxBufferBytes: values.SOCKET_MAX_BUFFER_BYTES,
    socketConnectsPerMinute: values.SOCKET_CONNECTS_PER_MINUTE,
    socketEventsPer10Seconds: values.SOCKET_EVENTS_PER_10_SECONDS,
    httpRequestsPerMinute: values.HTTP_REQUESTS_PER_MINUTE,
    shutdownGraceMs: values.SHUTDOWN_GRACE_MS,
    adminToken: values.ADMIN_TOKEN
  });
}

export function originAllowed(config, origin) {
  const normalized = String(origin || "").trim().replace(/\/$/, "");
  if (!config?.isProduction && !config?.publicOrigins?.length) return true;
  if (!normalized) return false;
  return config.publicOrigins.includes(normalized);
}
