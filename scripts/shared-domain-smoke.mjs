/**
 * shared/domain boundary: isomorphic rules live under shared/, public/* re-exports,
 * server must not import domain rules from public/ UI tree.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DOMAIN_ROOT = "shared/domain";
const REQUIRED = [
  "economy/metric-history.js",
  "economy/jade-loop.js",
  "economy/worker-economy.js",
  "economy/material-pricing.js",
  "progression/player-progression.js",
  "jade/jade-categories.js",
  "jade/jade-rules.js",
  "jade/jade-volume.js",
  "jade/jade-opening-engine.js",
  "jade/product-meta.js",
  "auction/jade-auction.js",
  "workshop/workshop-craft-scoring.js",
  "workshop/finish-plan-model.js",
  "livestream/livestream-host-bonuses.js",
  "livestream/livestream-rules.js",
  "livestream/settle-modal.js",
  "blackmarket/bm-plan-pool.js",
  "blackmarket/bm-service-templates.js",
  "blackmarket/bm-constants.js"
];

for (const rel of REQUIRED) {
  const path = join(DOMAIN_ROOT, rel);
  assert.ok(existsSync(path), `missing ${path}`);
}

const PUBLIC_REEXPORTS = [
  "metric-history.js",
  "jade-loop.js",
  "worker-economy.js",
  "material-pricing.js",
  "player-progression.js",
  "jade-categories.js",
  "jade-rules.js",
  "jade-volume.js",
  "jade-opening-engine.js",
  "product-meta.js",
  "jade-auction.js",
  "workshop-craft-scoring.js",
  "finish-plan-model.js",
  "livestream-host-bonuses.js",
  "livestream-rules.js",
  "bm-plan-pool.js",
  "bm-service-templates.js",
  "bm-constants.js"
];

for (const name of PUBLIC_REEXPORTS) {
  const src = readFileSync(join("public", name), "utf8");
  assert.match(src, /export \* from ['"]\.\.\/shared\/domain\//, `${name} should re-export shared/domain`);
}

const serverJs = readFileSync("server.js", "utf8") + readFileSync("server/create-game.js", "utf8");
assert.match(serverJs, /app\.use\(\s*["']\/shared["']/);
assert.match(serverJs, /shared\/domain\/economy\/jade-loop\.js/);

function walkJs(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkJs(p, out);
    else if (ent.name.endsWith(".js")) out.push(p);
  }
  return out;
}

for (const file of walkJs("server")) {
  const src = readFileSync(file, "utf8");
  assert.doesNotMatch(
    src,
    /from\s+["']\.\.\/\.\.\/public\/(player-progression|metric-history|jade-|workshop-craft|worker-economy|livestream-host|bm-|finish-plan|product-meta)/,
    `${file} must not import domain rules from public/`
  );
  assert.doesNotMatch(
    src,
    /from\s+["']\.\.\/\.\.\/public\/livestream-module\.js["']/,
    `${file} must not import UI module livestream-module`
  );
}

// Smoke: domain modules load under Node
const { resolveTiming } = await import("../shared/domain/economy/jade-loop.js");
assert.equal(typeof resolveTiming, "function");
const { buildLivestreamSettleModalEvent } = await import("../shared/domain/livestream/settle-modal.js");
assert.equal(typeof buildLivestreamSettleModalEvent, "function");
const { evaluateOrderFit } = await import("../shared/domain/jade/jade-rules.js");
assert.equal(typeof evaluateOrderFit, "function");
const { quoteMaterialPurchase } = await import("../shared/domain/economy/material-pricing.js");
assert.equal(typeof quoteMaterialPurchase, "function");

const bmConstants = await import("../shared/domain/blackmarket/bm-constants.js");
assert.equal(bmConstants.BLACKMARKET_MIN_PRICE, 100);
assert.equal(bmConstants.BLACKMARKET_GOODS_CAP, 24);
assert.equal(bmConstants.BLACKMARKET_BLIND_MIN, 6);
assert.equal(bmConstants.BLACKMARKET_BLIND_CAP, 50);
assert.equal(bmConstants.BM_SERVICE_PROFILE_CAPS.tags, 3);

const bmService = await import("../server/services/blackmarket-service.js");
assert.equal(bmService.BLACKMARKET_GOODS_CAP, bmConstants.BLACKMARKET_GOODS_CAP);
assert.equal(bmService.BLACKMARKET_BLIND_CAP, bmConstants.BLACKMARKET_BLIND_CAP);

const bmModuleSrc = [
  "public/features/blackmarket/shared.js",
  "public/features/blackmarket/plaza.js",
  "public/features/blackmarket/goods.js",
  "public/features/blackmarket/blind-ui.js",
  "public/features/blackmarket/service-ui.js",
  "public/features/blackmarket/actions.js",
  "public/features/blackmarket/index.js"
].map((p) => readFileSync(p, "utf8")).join("\n");
assert.match(bmModuleSrc, /from ["'](?:\.\.\/){1,2}bm-constants\.js["']/);
assert.doesNotMatch(bmModuleSrc, /const BM_GOODS_CAP\s*=\s*24/);
assert.doesNotMatch(bmModuleSrc, /const BM_BLIND_CAP\s*=\s*50/);

console.log("shared-domain-smoke: ok");
