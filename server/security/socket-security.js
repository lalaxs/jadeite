import { originAllowed } from "../config/runtime-config.js";
import { MUTATION_SOCKET_EVENTS } from "../../shared/protocol/mutation-events.js";
import {
  socketPayloadError,
  validateSocketEventPayload
} from "../protocol/socket-event-schemas.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function inspectPayload(value, limits, depth = 0, seen = new WeakSet()) {
  if (depth > limits.maxDepth) throw new Error("请求结构过深");
  if (typeof value === "string" && value.length > limits.maxStringLength) {
    throw new Error("请求文本过长");
  }
  if (typeof value === "number" && (!Number.isFinite(value) || !Number.isSafeInteger(value) && Math.abs(value) > Number.MAX_SAFE_INTEGER)) {
    throw new Error("请求数值无效");
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("请求结构无效");
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) throw new Error("请求项目过多");
    for (const entry of value) inspectPayload(entry, limits, depth + 1, seen);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length > limits.maxObjectKeys) throw new Error("请求字段过多");
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error("请求字段无效");
    inspectPayload(value[key], limits, depth + 1, seen);
  }
}

function addressFor(socket) {
  return String(
    socket.handshake.headers?.["x-forwarded-for"]?.split(",")[0]
      || socket.handshake.address
      || "unknown"
  ).trim();
}

export function socketServerOptions(config) {
  return {
    maxHttpBufferSize: config.socketMaxBufferBytes,
    cors: {
      origin(origin, callback) {
        if (!origin) return callback(null, false);
        const allowed = originAllowed(config, origin);
        callback(allowed ? null : new Error("origin not allowed"), allowed);
      },
      credentials: true,
      methods: ["GET", "POST"]
    },
    allowRequest(req, callback) {
      const origin = req.headers.origin;
      const sameOriginPolling = !origin && req.headers["sec-fetch-site"] === "same-origin";
      const protocol = req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http");
      const requestOrigin = sameOriginPolling ? `${protocol}://${req.headers.host}` : origin;
      callback(null, originAllowed(config, requestOrigin));
    }
  };
}

export function installSocketServerSecurity({ io, config, logger, metrics }) {
  const attempts = new Map();
  io.use((socket, next) => {
    const now = Date.now();
    const address = addressFor(socket);
    const current = attempts.get(address) || [];
    const recent = current.filter((at) => now - at < 60_000);
    recent.push(now);
    attempts.set(address, recent);
    if (recent.length > config.socketConnectsPerMinute) {
      metrics.increment("jade_socket_rejections_total", { reason: "connection_rate" });
      logger.warn({ address }, "socket connection rate exceeded");
      return next(new Error("连接过于频繁，请稍后重试"));
    }
    next();
  });
  const cleanup = setInterval(() => {
    const threshold = Date.now() - 60_000;
    for (const [address, rows] of attempts) {
      const recent = rows.filter((at) => at >= threshold);
      if (recent.length) attempts.set(address, recent);
      else attempts.delete(address);
    }
  }, 60_000);
  cleanup.unref?.();
  return () => clearInterval(cleanup);
}

export function installSocketEventSecurity(socket, { config, logger, metrics }) {
  const timestamps = [];
  socket.use((packet, next) => {
    const acknowledge = typeof packet.at(-1) === "function" ? packet.at(-1) : null;
    const now = Date.now();
    while (timestamps.length && now - timestamps[0] >= 10_000) timestamps.shift();
    if (timestamps.length >= config.socketEventsPer10Seconds) {
      metrics.increment("jade_socket_rejections_total", { reason: "event_rate" });
      const message = "操作过于频繁，请稍后再试。";
      socket.emit("toast", message);
      acknowledge?.({ ok: false, code: "SOCKET_RATE_LIMIT", message });
      return;
    }
    timestamps.push(now);
    try {
      const event = String(packet[0] || "");
      if (MUTATION_SOCKET_EVENTS.has(event)) {
        const validation = validateSocketEventPayload(event, packet[1], {
          requireRequestId: config.isProduction
        });
        if (!validation.success) throw new Error(socketPayloadError(validation, event));
      }
      inspectPayload(packet.slice(1), {
        maxDepth: 8,
        maxStringLength: 4096,
        maxArrayLength: 200,
        maxObjectKeys: 100
      });
      metrics.increment("jade_socket_events_total", { event: String(packet[0] || "unknown") });
      next();
    } catch (error) {
      metrics.increment("jade_socket_rejections_total", { reason: "payload" });
      logger.warn({ event: packet[0], error: error.message }, "rejected socket payload");
      const message = error.message || "请求格式无效。";
      socket.emit("toast", message);
      acknowledge?.({ ok: false, code: "INVALID_SOCKET_PAYLOAD", message });
    }
  });
}
