import assert from "node:assert/strict";
import vm from "node:vm";
import { readClientShellSource } from "./load-client-shell.mjs";

const shell = readClientShellSource();
assert.match(shell, /function formatMoneyCompact\b/, "shell should define formatMoneyCompact");
assert.match(shell, /formatMoneyCompact\(me\.cash\)/, "top HUD should render compact cash");
assert.match(
  shell,
  /animateNumber\(\s*cashEl[\s\S]*formatMoneyCompact/,
  "cash HUD animation should format with compact money"
);
assert.match(
  shell,
  /title="现金 \$\{formatMoney\(me\.cash\)\}"/,
  "cash HUD card should expose full money on hover"
);

const start = shell.indexOf("function formatMoney(value)");
const end = shell.indexOf("function formatNumber(value)");
assert.ok(start >= 0 && end > start, "should locate money helpers in client shell");
const chunk = shell.slice(start, end).replace(/^export /gm, "");
const ctx = vm.runInNewContext(`${chunk}; ({ formatMoney, formatMoneyCompact })`);

const cases = [
  [0, "¥0"],
  [9999, "¥9,999"],
  [10_000, "¥1万"],
  [28_250, "¥2.8万"],
  [282_116, "¥28.2万"],
  [1_005_000, "¥100.5万"],
  [12_500_000, "¥1250万"],
  [125_000_000, "¥1.25亿"],
  [-282_116, "-¥28.2万"]
];

for (const [input, expected] of cases) {
  assert.equal(ctx.formatMoneyCompact(input), expected, `formatMoneyCompact(${input})`);
}

assert.equal(ctx.formatMoney(282_116), "¥282,116", "full formatMoney must stay unchanged");

console.log("money-compact-smoke: HUD compact cash formatting ok");
