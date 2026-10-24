import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shopSource = readFileSync("public/features/shop/shop-module.js", "utf8");
const html = readFileSync("public/index.html", "utf8");
const hudCss = readFileSync("public/styles/hud-fx.css", "utf8");

assert.match(shopSource, /import\s+\{\s*activateModalLifecycle\s*\}\s+from\s+"\.\.\/\.\.\/modal-lifecycle\.js"/);
assert.match(shopSource, /el\.parentElement !== document\.body/);
assert.match(shopSource, /document\.body\.appendChild\(el\)/);
assert.match(shopSource, /bindShopModalLifecycle/);
assert.match(shopSource, /closeOnBackdrop:\s*true/);
assert.doesNotMatch(shopSource, /purchase-outcome/);
assert.doesNotMatch(shopSource, /modal-balance-preview/);
assert.match(shopSource, /批采优惠/);
assert.match(shopSource, /materialPurchaseQuote/);
assert.match(shopSource, /register\("shopSelectTab"/);
assert.match(shopSource, /section\.view\[data-view="shop"\]/);
assert.match(html, /data-action="shopSelectTab"/);
assert.doesNotMatch(
  shopSource,
  /document\.addEventListener\("keydown",\s*\(e\)\s*=>\s*\{\s*if\s*\(e\.key === "Escape"\)\s*closeShopModal/
);

const shopModalInShell = /<main class="shell"[\s\S]*id="shopModal"[\s\S]*<\/main>/;
assert.doesNotMatch(html, shopModalInShell, "shopModal must not live inside .shell (inert lock)");
assert.match(html, /id="shopModal"/);

assert.match(hudCss, /\.modal-overlay\s*\{[^}]*z-index:\s*1200/);
assert.match(
  hudCss,
  /\[data-theme="day"\] #shopModal \.modal\s*\{[^}]*var\(--panel\)/
);
assert.match(hudCss, /\[data-theme="day"\] #shopModal \.modal-confirm/);

console.log("shop-material-modal-smoke: body-mounted material buy modal ok");
