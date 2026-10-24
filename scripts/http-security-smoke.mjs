import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { installHttpSecurity } from "../server/security/http-security.js";
import { loadRuntimeConfig } from "../server/config/runtime-config.js";
import { createLogger } from "../server/observability/logger.js";
import { createMetrics } from "../server/observability/metrics.js";
import { createRuntimeHealth } from "../server/observability/runtime-health.js";

for (const nodeEnv of ["development", "test", "production"]) {
  const config = loadRuntimeConfig({
    NODE_ENV: nodeEnv,
    PUBLIC_ORIGIN: "https://jade.example.com",
    ADMIN_TOKEN: "http-security-regression-test-token",
    LOG_LEVEL: "silent",
    JADE_WORLD_PERSIST: "0",
    JADE_ALLOW_VOLATILE_PRODUCTION: "1",
    HTTP_REQUESTS_PER_MINUTE: "30"
  });
  const app = express();
  installHttpSecurity({
    app, config, logger: createLogger(config),
    metrics: createMetrics(), health: createRuntimeHealth()
  });
  app.get("/", (_req, res) => res.send("local-preview"));
  app.get(["/styles.css", "/features/boot.js", "/shared/domain/rules.js"], (_req, res) => res.send("asset"));
  app.get("/api/probe", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(response.status, 200);
    const policy = response.headers.get("content-security-policy");
    assert.match(policy, /script-src 'self'/);
    assert.match(policy, /object-src 'none'/);
    assert.equal(policy.includes("upgrade-insecure-requests"), config.isProduction,
      `${nodeEnv}: local HTTP resources must load without HTTPS upgrades`);
    assert.equal(response.headers.has("strict-transport-security"), config.isProduction);
    if (config.isProduction) {
      assert.match(response.headers.get("strict-transport-security"), /max-age=31536000; includeSubDomains/);
    }
    assert.equal(await response.text(), "local-preview");
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (let i = 0; i < 36; i++) {
      const assetPath = ["/styles.css", "/features/boot.js", "/shared/domain/rules.js"][i % 3];
      const asset = await fetch(`${origin}${assetPath}`);
      assert.equal(asset.status, 200, "resource loads must not exhaust the API budget");
      assert.equal(asset.headers.has("ratelimit"), false);
      await asset.text();
    }
    for (let i = 0; i < 30; i++) {
      const api = await fetch(`${origin}/api/probe`);
      assert.equal(api.status, 200);
      await api.text();
    }
    const blocked = await fetch(`${origin}/api/probe`);
    assert.equal(blocked.status, 429, "API rate limits must remain enforced");
    await blocked.text();
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

console.log("http-security-smoke: local HTTP previews + production HTTPS policy + asset/API budgets ok");
