import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const main = await readFile(new URL("../public/main.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

assert.match(css, /@media \(min-width: 768px\)/);
assert.match(css, /--desktop-chat-height:\s*270px/);
assert.match(css, /\.main-stage[\s\S]*min-width:\s*0/);
assert.match(css, /\.main-stage[\s\S]*min-height:\s*0/);
assert.match(css, /\.workshop-recipe-main[\s\S]*minmax\(0,\s*1fr\)/);
assert.match(main, /els\.mainStage\.scrollTop\s*=\s*0/);
assert.match(html, /id="mainStage"/);

assert.match(css, /@media \(max-width: 767px\)/);
assert.match(css, /min-height:\s*44px/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(main, /function toggleMobilePanel/);
assert.match(html, /id="sidePanelToggle"/);
assert.match(html, /id="chatDockToggle"/);

console.log("responsive-layout-smoke: desktop guards ok");
