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
  const excludesDisabled = normalized.includes(":not(:disabled)");
  normalized = normalized.replaceAll(":not(:disabled)", "");
  if (excludesDisabled && node.states.has("disabled")) return false;

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
    const normalized = simple.replaceAll(":not(:disabled)", "");
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
assert.equal(
  cascadedDeclarations('[data-theme="night"] .wrs-plan-step.is-ready').values["border-color"],
  "#2d6c52",
  "the ready planning state must survive the shared surface override"
);
assert.deepEqual(
  (() => {
    const disabled = cascadedDeclarations('[data-theme="night"] button.secondary:disabled:hover').values;
    return [disabled.color, disabled.background];
  })(),
  ["var(--night-muted)", "var(--night-surface-1)"],
  "disabled secondary buttons must not pick up enabled hover colors"
);

assert.match(css, /prefers-reduced-motion:\s*reduce/);
console.log("night-theme-smoke: effective low-luminance surfaces ok");
