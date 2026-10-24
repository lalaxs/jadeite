import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFile } from "node:fs/promises";
import { loadResolvedStyles, stylesEntryFromMeta } from "./load-styles.mjs";

const css = loadResolvedStyles(stylesEntryFromMeta(import.meta.url));
const mainEntry = await readFile(new URL("../public/main.js", import.meta.url), "utf8");
const main = readClientShellSource();
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const auctionModule = await readFile(new URL("../public/features/auction/auction-module.js", import.meta.url), "utf8");

assert.match(css, /@media \(min-width: 768px\)/);
assert.match(css, /--desktop-chat-height:\s*270px/);
assert.match(
  css,
  /@media screen and \(min-width:\s*981px\)\s*\{\s*\.shell\s*\{[^}]*grid-template-columns:\s*224px\s+minmax\(0,\s*1fr\)\s+390px/s
);
assert.doesNotMatch(css, /\.shell:has\(\.view\[data-view="overview"\]\.active\)/);
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

const auctionHallCardRule = css.match(/\.auction-hall-card\s*\{([^}]*)\}/)?.[1] || "";
const auctionHallPreviewRule = css.match(/\.auction-hall-card\.is-preview\s*\{([^}]*)\}/)?.[1] || "";
const auctionHallEnterRule = css.match(/\.auction-hall-card\.active \.auction-hall-enter\s*\{([^}]*)\}/)?.[1] || "";
const auctionHallFeeRule = css.match(/\.auction-hall-card\.active \.auction-hall-fee\s*\{([^}]*)\}/)?.[1] || "";
const auctionHallFeeAmountRule = css.match(/\.auction-hall-card\.active \.auction-hall-fee b\s*\{([^}]*)\}/)?.[1] || "";
const auctionHallMetaRule = css.match(/\.auction-hall-card\.active \.auction-hall-meta\s*\{([^}]*)\}/)?.[1] || "";
assert.match(auctionHallCardRule, /height:\s*374px/);
assert.doesNotMatch(auctionHallPreviewRule, /(?:min-)?height|grid-template-rows/);
assert.doesNotMatch(css, /\.auction-hall-card\.active:not\(\.is-preview\)\s*\{/);
assert.match(auctionHallEnterRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
assert.doesNotMatch(auctionHallEnterRule, /84px/);
assert.match(auctionHallEnterRule, /border:\s*0/);
assert.match(auctionHallFeeRule, /border:\s*0/);
assert.match(auctionHallMetaRule, /border-top:\s*0/);
assert.match(auctionHallFeeAmountRule, /overflow:\s*visible/);
assert.match(auctionHallFeeAmountRule, /text-overflow:\s*clip/);
assert.doesNotMatch(auctionModule, /<span class="(?:cash|after)">/);

assert.match(html, /id="mobileResourcesToggle"/);
assert.match(html, /class="mobile-utility-tabs"/);
assert.match(css, /\.shell\[data-mobile-pane="side"\]/);
assert.match(css, /\.shell\[data-mobile-pane="chat"\]/);
assert.match(css, /grid-template-columns:\s*72px\s+minmax\(0,\s*1fr\)/);
assert.match(css, /height:\s*100dvh/);
const mobileShellMatch = /\.shell\s*\{[^}]*grid-template-columns:\s*72px\s+minmax\(0,\s*1fr\)/s.exec(css);
const mobileShellAnchor = mobileShellMatch?.index ?? -1;
const mobileShellStart = css.lastIndexOf("@media (max-width: 767px)", mobileShellAnchor);
const mobileShellCss = css.slice(mobileShellStart);
const mobileSidebarRule = mobileShellCss.match(/\.sidebar\s*\{([^}]*)\}/)?.[1] || "";
assert.match(mobileSidebarRule, /flex-direction:\s*column;/);
assert.match(mobileSidebarRule, /flex-wrap:\s*nowrap;/);
assert.match(mobileSidebarRule, /overflow:\s*hidden;/);
assert.match(main, /function setMobileContentPane\b/);
assert.match(main, /function setMobileResourcesOpen\b/);
assert.match(main, /mobileResourcesToggle/);
assert.match(
  css,
  /\.shell\[data-mobile-pane="chat"\] \.chatdock\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;/
);

console.log("responsive-layout-smoke: desktop guards ok");
