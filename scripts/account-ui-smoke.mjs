import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("public/index.html", "utf8");
const source = readFileSync("public/account-module.js", "utf8");
const styles = readFileSync("public/styles/account.css", "utf8");

assert.match(html, /id="accountButton"[^>]*aria-haspopup="dialog"/);
assert.match(html, /id="accountModal"[^>]*hidden/);
assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
assert.match(html, /id="accountBindForm"/);
assert.match(html, /id="accountLoginForm"/);
assert.match(source, /\/api\/account\/bind/);
assert.match(source, /\/api\/account\/login/);
assert.match(source, /\/api\/account\/logout/);
assert.match(source, /setAttribute\("inert"/);
assert.match(source, /event\.key === "Escape"/);
assert.match(source, /event\.key !== "Tab"/);
assert.match(source, /showGuest\(\);\s*setStatus\(""\);/);
assert.match(styles, /min-height:\s*44px/);
assert.match(styles, /100dvh/);
assert.match(styles, /safe-area-inset-bottom/);

console.log("account-ui-smoke: account bind/login/logout modal contract ok");
