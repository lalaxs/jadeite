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

console.log("responsive-layout-smoke: desktop guards ok");
