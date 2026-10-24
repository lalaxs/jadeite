import { loadResolvedStyles } from "./load-styles.mjs";
import { readFileSync, readdirSync } from "node:fs";

const css = loadResolvedStyles();
const index = readFileSync("public/styles.css", "utf8");
const parts = readdirSync("public/styles").filter((name) => name.endsWith(".css")).sort();

assert(parts.length >= 8, `expected split css parts, got ${parts.length}`);
assert(/@import url\("\.\/styles\//.test(index), "styles.css should be an @import index");
assert(!/\.auction-round-hero\s*\{/.test(index), "index should not keep rule bodies");
assert(/\.auction-round-hero/.test(css), "resolved css should include auction styles");
for (const hallId of ["novice", "regular", "premium", "special", "legendary"]) {
  assert(css.includes(`[data-auction-hall="${hallId}"]`), `auction tier style should include ${hallId}`);
}
assert(/prefers-reduced-motion[\s\S]*auction-hall-card/.test(css), "auction tier motion should respect reduced motion");
assert(/@keyframes auction-hall-enter/.test(css), "auction hall should include an entrance transition");
assert(/\.auction-hall-card\.is-preview/.test(css), "inactive halls should use compact preview cards");
assert(/\.auction-hall-card\.is-next/.test(css), "the next hall should receive a static preview treatment");
assert(/@keyframes auction-hall-unlock-rise/.test(css), "newly unlocked halls should receive a one-shot reveal");
assert(/#roughPool::before/.test(css), "auction hall should carry its tier atmosphere into the lot area");
assert(/\.auction-history-card\[data-auction-hall=/.test(css), "auction history should retain hall tier styling");
assert(/\.auction-history-card\.has-my-win/.test(css), "winning history should include a restrained highlight");
assert(/\.auction-history-card[\s\S]*content-visibility:\s*auto/.test(css), "offscreen auction history should defer rendering");
assert(/\.auction-settle-modal--legendary/.test(css), "settlement modal should include tier styling");
assert(/@keyframes auction-settle-win-shine/.test(css), "winning settlement should include a one-shot shine");
assert(/\.livestream-tabs/.test(css), "resolved css should include livestream styles");
assert(/\.wrc-title-row/.test(css), "resolved css should include workshop styles");
assert(/\.treasure-card/.test(css), "resolved css should include collection styles");
assert(/\.jm-grid/.test(css), "resolved css should include market styles");
assert(/\[data-theme="night"\]/.test(css), "resolved css should include night theme");
assert(css.length > 200_000, "resolved stylesheet should remain large");

console.log(`styles-split-smoke: ${parts.length} parts, resolved ${css.length} bytes ok`);

function assert(cond, message) {
  if (!cond) throw new Error(message);
}
