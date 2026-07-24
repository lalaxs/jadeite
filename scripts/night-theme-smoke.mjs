import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("public/styles.css", "utf8");
const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [];
const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
let match;

while ((match = blockPattern.exec(source))) {
  const declarations = {};
  for (const entry of match[2].split(";")) {
    const colon = entry.indexOf(":");
    if (colon < 0) continue;
    const property = entry.slice(0, colon).trim();
    const value = entry.slice(colon + 1).trim();
    if (property && value) declarations[property] = value;
  }
  for (const selector of match[1].split(",").map((value) => value.trim()).filter(Boolean)) {
    rules.push({ selector, declarations, index: match.index });
  }
}

function exactDeclarations(selector) {
  const effective = {};
  for (const rule of rules) {
    if (rule.selector === selector) Object.assign(effective, rule.declarations);
  }
  return effective;
}

function selectorSpecificity(selector) {
  const normalized = selector.replace(/:not\(([^)]*)\)/g, "$1");
  const ids = (normalized.match(/#[\w-]+/g) || []).length;
  const classes = (normalized.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const types = normalized
    .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:{1,2}[\w-]+(?:\([^)]*\))?/g, " ")
    .split(/[\s>+~]+/)
    .filter((value) => /^[a-z][\w-]*$/i.test(value)).length;
  return [ids, classes, types];
}

function compareSpecificity(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function simpleSelectorMatches(simple, node) {
  if (!node || simple.includes("::")) return false;
  let normalized = simple;
  for (const [, excluded] of normalized.matchAll(/:not\(([^)]*)\)/g)) {
    if (simpleSelectorMatches(excluded, node)) return false;
  }
  normalized = normalized.replace(/:not\([^)]*\)/g, "");

  for (const [, pseudo] of normalized.matchAll(/:([\w-]+)/g)) {
    if (!node.states.has(pseudo)) return false;
  }
  normalized = normalized.replace(/:[\w-]+/g, "");

  const type = normalized.match(/^[a-z][\w-]*/i)?.[0];
  if (type && type.toLowerCase() !== node.tag) return false;
  for (const [, id] of normalized.matchAll(/#([\w-]+)/g)) {
    if (node.id !== id) return false;
  }
  for (const [, className] of normalized.matchAll(/\.([\w-]+)/g)) {
    if (!node.classes.has(className)) return false;
  }
  for (const [, name, value] of normalized.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (!(name in node.attributes)) return false;
    if (value !== undefined && node.attributes[name] !== value) return false;
  }
  return true;
}

function selectorMatches(selector, node) {
  if (/[+~]/.test(selector)) return false;
  const parts = selector.replace(/\s*>\s*/g, " > ").trim().split(/\s+/);

  function matchAt(current, index) {
    if (index < 0) return true;
    if (!simpleSelectorMatches(parts[index], current)) return false;
    if (index === 0) return true;
    if (parts[index - 1] === ">") return matchAt(current.parent, index - 2);
    for (let ancestor = current.parent; ancestor; ancestor = ancestor.parent) {
      if (matchAt(ancestor, index - 1)) return true;
    }
    return false;
  }

  return matchAt(node, parts.length - 1);
}

function fixtureFor(selector) {
  const root = {
    tag: "html",
    id: "",
    classes: new Set(),
    attributes: { "data-theme": "night" },
    states: new Set(),
    parent: null
  };
  let parent = {
    tag: "body",
    id: "",
    classes: new Set(),
    attributes: {},
    states: new Set(),
    parent: root
  };
  const targetPath = selector
    .replace(/^\[data-theme="night"\]\s*/, "")
    .replace(/\s*>\s*/g, " ")
    .trim()
    .split(/\s+/);

  for (const simple of targetPath) {
    const normalized = simple.replace(/:not\([^)]*\)/g, "");
    const node = {
      tag: normalized.match(/^[a-z][\w-]*/i)?.[0]?.toLowerCase() || "div",
      id: normalized.match(/#([\w-]+)/)?.[1] || "",
      classes: new Set([...normalized.matchAll(/\.([\w-]+)/g)].map((entry) => entry[1])),
      attributes: Object.fromEntries(
        [...normalized.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)]
          .map((entry) => [entry[1], entry[2] ?? ""])
      ),
      states: new Set([...normalized.matchAll(/:([\w-]+)/g)].map((entry) => entry[1])),
      parent
    };
    parent = node;
  }
  return parent;
}

function cascadedDeclarations(selector) {
  const target = fixtureFor(selector);
  const winners = {};
  for (const rule of rules) {
    if (!selectorMatches(rule.selector, target)) continue;
    const specificity = selectorSpecificity(rule.selector);
    for (const [property, rawValue] of Object.entries(rule.declarations)) {
      const important = /!important$/i.test(rawValue);
      const value = rawValue.replace(/\s*!important$/i, "");
      const current = winners[property];
      const wins = !current
        || Number(important) > Number(current.important)
        || (important === current.important && compareSpecificity(specificity, current.specificity) > 0)
        || (
          important === current.important
          && compareSpecificity(specificity, current.specificity) === 0
          && rule.index > current.index
        );
      if (wins) winners[property] = { value, important, specificity, index: rule.index, selector: rule.selector };
    }
  }
  return {
    values: Object.fromEntries(Object.entries(winners).map(([property, winner]) => [property, winner.value])),
    winners
  };
}

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const rootVariables = exactDeclarations(":root");

function resolveHex(value) {
  let resolved = value;
  const seen = new Set();
  while (String(resolved || "").startsWith("var(")) {
    const variable = String(resolved).match(/^var\((--[\w-]+)\)$/)?.[1];
    assert.ok(variable && !seen.has(variable), `cannot resolve cyclic CSS color ${value}`);
    seen.add(variable);
    resolved = nightVariables[variable] || rootVariables[variable];
  }
  assert.match(resolved || "", /^#[0-9a-f]{6}$/i, `cannot resolve ${value} to a hex color`);
  return resolved;
}

function compositeHex(foreground, background, alpha) {
  const channels = (hex) => hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16));
  const blended = channels(foreground).map(
    (value, index) => Math.round(value * alpha + channels(background)[index] * (1 - alpha))
  );
  return `#${blended.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function compositedContrast({ color, background, backdrop, opacity }) {
  const alpha = Number(opacity);
  const base = resolveHex(backdrop);
  const renderedBackground = compositeHex(resolveHex(background), base, alpha);
  const renderedText = compositeHex(resolveHex(color), base, alpha);
  return contrastRatio(renderedText, renderedBackground);
}

const nightVariables = exactDeclarations('[data-theme="night"]');
for (const token of [
  "--night-surface-1",
  "--night-surface-2",
  "--night-surface-3",
  "--night-text",
  "--night-muted",
  "--night-primary"
]) {
  assert.ok(nightVariables[token], `missing ${token}`);
  assert.match(nightVariables[token], /^#[0-9a-f]{6}$/i, `${token} must be an opaque hex color`);
}

for (const token of ["--night-surface-1", "--night-surface-2", "--night-surface-3"]) {
  assert.ok(relativeLuminance(nightVariables[token]) < 0.05, `${token} must remain low luminance`);
}
assert.ok(relativeLuminance(nightVariables["--night-primary"]) < 0.2, "night primary must not become a bright button");
assert.ok(relativeLuminance(nightVariables["--night-text"]) < 0.85, "night text must avoid pure white glare");
assert.ok(relativeLuminance(nightVariables["--night-text"]) > 0.55, "night text must remain legible");
assert.ok(
  contrastRatio(nightVariables["--night-text"], nightVariables["--night-surface-2"]) >= 4.5,
  "shared night text must retain readable contrast"
);
for (const traitText of ["#a9d9c4", "#e5ad9c"]) {
  assert.ok(
    contrastRatio(traitText, nightVariables["--night-surface-2"]) >= 4.5,
    `${traitText} must remain readable on night summaries`
  );
}

const surfaceSelectors = [
  ".ws-picker-modal",
  ".ws-planner-modal",
  ".game-modal",
  ".worker-detail-panel",
  ".recruit-candidate-card",
  ".ws-big-card",
  ".ws-picker-item",
  ".finish-plan-summary > div",
  ".finish-plan-stock",
  ".game-modal-line",
  ".game-modal-stat",
  ".wrs-plan-step"
];

for (const baseSelector of surfaceSelectors) {
  const selector = `[data-theme="night"] ${baseSelector}`;
  const { values: declarations, winners } = cascadedDeclarations(selector);
  assert.equal(declarations.background, "var(--night-surface-2)", `${selector} must use the shared low surface`);
  assert.equal(declarations.color, "var(--night-text)", `${selector} must use shared night text`);
  assert.equal(winners.background.selector, selector, `${selector} must win the effective surface cascade`);
}

const primary = cascadedDeclarations('[data-theme="night"] button.primary').values;
assert.equal(primary.background, "var(--night-primary)");
assert.equal(primary.color, "#e4f1eb");

for (const selector of [
  '[data-theme="night"] button.secondary',
  '[data-theme="night"] .mobile-resources-toggle'
]) {
  const declarations = cascadedDeclarations(selector).values;
  assert.equal(declarations.background, "var(--night-surface-3)");
  assert.equal(declarations.color, "var(--night-text)");
}

const candidate = cascadedDeclarations('[data-theme="night"] .recruit-candidate-card').values;
assert.equal(candidate["background-color"], "var(--night-surface-2)");
assert.match(candidate["background-image"], /rgba\(42,\s*91,\s*70,\s*\.22\)/);
assert.doesNotMatch(candidate["background-image"], /#(?:000|fff)|255\s*,\s*255\s*,\s*255/i);
for (const selector of [
  '[data-theme="night"] .recruit-candidate-card .pill',
  '[data-theme="night"] .recruit-skill-row span'
]) {
  const declarations = cascadedDeclarations(selector).values;
  assert.deepEqual(
    [declarations.color, declarations.background],
    ["#a9d9c4", "#153d2e"],
    `${selector} must not retain its bright day surface`
  );
  assert.ok(
    contrastRatio(declarations.color, declarations.background) >= 4.5,
    `${selector} must retain readable contrast`
  );
}
assert.deepEqual(
  (() => {
    const recruitButton = cascadedDeclarations('[data-theme="night"] .recruit-candidate-card > button').values;
    return [recruitButton.color, recruitButton.background];
  })(),
  ["#e4f1eb", "var(--night-primary)"],
  "the recruit-card action must use the low-luminance night button"
);

for (const selector of [
  '[data-theme="night"] .wsp-worker-top',
  '[data-theme="night"] .recruit-card-head',
  '[data-theme="night"] .ws-big-worker-top',
  '[data-theme="night"] .wsp-pick-side-head'
]) {
  const declarations = cascadedDeclarations(selector).values;
  assert.equal(declarations.background, "rgba(4, 13, 10, .58)");
  assert.doesNotMatch(declarations.background, /gradient|255\s*,\s*255\s*,\s*255/i);
}

for (const selector of [
  '[data-theme="night"] .recruit-card-head h3',
  '[data-theme="night"] .wsp-worker-name',
  '[data-theme="night"] .ws-big-worker-id strong',
  '[data-theme="night"] .wsp-pick-side-id strong',
  '[data-theme="night"] .wsp-head-text h3'
]) {
  const declarations = cascadedDeclarations(selector).values;
  assert.equal(declarations.color, "var(--night-text)");
  assert.equal(declarations["text-shadow"], "0 1px 1px rgba(0, 0, 0, .5)");
}

const positiveTrait = cascadedDeclarations('[data-theme="night"] .wsp-trait-row.pos').values;
const negativeTrait = cascadedDeclarations('[data-theme="night"] .wsp-trait-row.neg').values;
assert.deepEqual(
  [positiveTrait.color, positiveTrait.background, positiveTrait["border-color"]],
  ["#a9d9c4", "#153d2e", "#2d6c52"]
);
assert.deepEqual(
  [negativeTrait.color, negativeTrait.background, negativeTrait["border-color"]],
  ["#e5ad9c", "#3b241e", "#78493b"]
);
for (const selector of [
  '[data-theme="night"] .trait-chip',
  '[data-theme="night"] .wsp-trait-chip.pos',
  '[data-theme="night"] .flaw-chip.pos'
]) {
  const declarations = cascadedDeclarations(selector).values;
  assert.deepEqual(
    [declarations.color, declarations.background, declarations["border-color"]],
    ["#a9d9c4", "#153d2e", "#2d6c52"],
    `${selector} must match the positive trait treatment`
  );
}
for (const selector of [
  '[data-theme="night"] .wsp-trait-chip.neg',
  '[data-theme="night"] .flaw-chip.neg'
]) {
  const declarations = cascadedDeclarations(selector).values;
  assert.deepEqual(
    [declarations.color, declarations.background, declarations["border-color"]],
    ["#e5ad9c", "#3b241e", "#78493b"],
    `${selector} must match the negative trait treatment`
  );
}

const forbiddenBrightSurface = /#fff(?:fff)?\b|#f8fbf8\b|#fbfdfb\b|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(?:[2-9]\d*|1(?:\.0*)?)\s*\)/i;
for (const baseSelector of surfaceSelectors) {
  const declarations = cascadedDeclarations(`[data-theme="night"] ${baseSelector}`).values;
  for (const property of ["background", "background-color", "background-image"]) {
    assert.doesNotMatch(declarations[property] || "", forbiddenBrightSurface, `${baseSelector} has a bright ${property}`);
  }
}

assert.equal(
  cascadedDeclarations('[data-theme="night"] .finish-plan-summary strong.pos').values.color,
  "#a9d9c4",
  "positive finishing summary text must remain readable"
);
assert.equal(
  cascadedDeclarations('[data-theme="night"] .finish-plan-summary strong.neg').values.color,
  "#e5ad9c",
  "negative finishing summary text must remain readable"
);
assert.deepEqual(
  (() => {
    const disabled = cascadedDeclarations('[data-theme="night"] button.secondary:disabled:hover').values;
    return [disabled.color, disabled.background];
  })(),
  ["var(--night-muted)", "var(--night-surface-1)"],
  "disabled secondary buttons must not pick up enabled hover colors"
);

for (const selector of [
  '[data-theme="night"] .layout-tools',
  '[data-theme="night"] .kit-choice'
]) {
  const { values, winners } = cascadedDeclarations(selector);
  const expectedSurface = selector.endsWith(".layout-tools")
    ? "var(--night-surface-2)"
    : "var(--night-surface-3)";
  assert.equal(values.background, expectedSurface, `${selector} must replace its light planner surface`);
  assert.equal(values.color, "var(--night-text)", `${selector} must keep readable night text`);
  assert.match(values["border-color"] || values.border || "", /142,\s*178,\s*160|#327f61/i);
  assert.match(winners.background.selector, /^\[data-theme="night"\]/, `${selector} needs a night cascade winner`);
}

const kitHover = cascadedDeclarations('[data-theme="night"] .kit-choice:hover').values;
assert.deepEqual(
  [kitHover.color, kitHover.background, kitHover["border-color"]],
  ["#e4f1eb", "var(--night-primary)", "#327f61"],
  "planner kit hover must remain low luminance and readable"
);
for (const state of ["hover", "focus-visible"]) {
  const kitLabel = cascadedDeclarations(
    `[data-theme="night"] .kit-choice.opening-kit-choice:${state} span`
  ).values;
  assert.equal(kitLabel.color, "#e4f1eb", `planner kit labels need readable ${state} text`);
  assert.ok(
    contrastRatio(resolveHex(kitLabel.color), resolveHex("var(--night-primary)")) >= 4.5,
    `planner kit labels need 4.5:1 contrast during ${state}`
  );
}
for (const [selector, surface] of [
  ['[data-theme="night"] .layout-tools label', "var(--night-surface-2)"],
  ['[data-theme="night"] .opening-kit-choice span', "var(--night-surface-3)"]
]) {
  const textColor = cascadedDeclarations(selector).values.color;
  assert.ok(
    contrastRatio(resolveHex(textColor), resolveHex(surface)) >= 4.5,
    `${selector} must retain readable planner text`
  );
}

const navHover = cascadedDeclarations(
  '[data-theme="night"] .main-nav-item:hover:not(.active):not(.locked)'
);
assert.deepEqual(
  [navHover.values.color, navHover.values.background],
  ["var(--night-text)", "var(--night-surface-3)"],
  "shared desktop/mobile inactive nav hover must use the night palette"
);
assert.equal(
  navHover.winners.background.selector,
  '[data-theme="night"] .main-nav-item:hover:not(.active):not(.locked)',
  "the shared night nav hover must win over the legacy white hover"
);
assert.equal(
  cascadedDeclarations(
    '[data-theme="night"] .main-nav-item:hover:not(.active):not(.locked) .nav-ico'
  ).values.color,
  "var(--night-muted)",
  "inactive nav hover icons must remain readable"
);
const activeNavHover = cascadedDeclarations('[data-theme="night"] .main-nav-item.active:hover').values;
assert.deepEqual(
  [activeNavHover.color, activeNavHover.background],
  ["#e4f1eb", "var(--night-primary)"],
  "active nav styling must survive hover"
);
assert.equal(
  cascadedDeclarations('[data-theme="night"] .main-nav-item.active:hover .nav-ico').values.color,
  "#e4f1eb",
  "active nav icons must retain their active treatment"
);
const lockedNavHover = cascadedDeclarations(
  '[data-theme="night"] button.main-nav-item.locked:disabled:hover'
).values;
assert.deepEqual(
  [lockedNavHover.color, lockedNavHover.background],
  ["var(--night-muted)", "var(--night-surface-1)"],
  "locked nav hover must not fall through to the legacy white surface"
);
assert.equal(
  cascadedDeclarations(
    '[data-theme="night"] button.main-nav-item.locked:disabled:hover .nav-ico'
  ).values.color,
  "var(--night-muted)",
  "locked nav hover icons must remain readable"
);
assert.ok(
  compositedContrast({
    color: lockedNavHover.color,
    background: lockedNavHover.background,
    backdrop: "var(--night-surface-2)",
    opacity: lockedNavHover.opacity
  }) >= 4.5,
  "locked nav text needs 4.5:1 contrast after opacity compositing"
);

const readyStep = cascadedDeclarations('[data-theme="night"] .wrs-plan-step.is-ready').values;
assert.ok(
  contrastRatio(resolveHex(readyStep["border-color"]), nightVariables["--night-surface-2"]) >= 3,
  "ready planner border needs at least 3:1 contrast against its surface"
);

const disabledButton = cascadedDeclarations('[data-theme="night"] button.secondary:disabled:hover').values;
assert.ok(Number(disabledButton.opacity) < 1, "disabled buttons must retain a disabled affordance");
assert.ok(Number(disabledButton.opacity) >= 0.7, "disabled opacity must not erase text legibility");
assert.ok(
  compositedContrast({
    color: disabledButton.color,
    background: disabledButton.background,
    backdrop: "var(--night-surface-2)",
    opacity: disabledButton.opacity
  }) >= 4.5,
  "disabled button text needs 4.5:1 contrast after opacity compositing"
);

assert.match(css, /prefers-reduced-motion:\s*reduce/);
console.log("night-theme-smoke: effective low-luminance surfaces ok");
