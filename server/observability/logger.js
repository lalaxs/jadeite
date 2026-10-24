import pino from "pino";

export function createLogger(config = {}) {
  return pino({
    level: config.logLevel || "info",
    base: {
      service: "jade-market-server",
      version: config.appVersion || "dev",
      environment: config.nodeEnv || "development"
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "request.headers.authorization",
        "request.headers.cookie",
        "resumeToken",
        "password",
        "token",
        "*.resumeToken",
        "*.password",
        "*.token"
      ],
      censor: "[REDACTED]"
    }
  });
}

