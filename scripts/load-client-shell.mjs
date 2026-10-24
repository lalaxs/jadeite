/**
 * Aggregate client shell sources for smoke string assertions after main.js split.
 * Includes public/main.js, public/shell/**, and shell-oriented public/features
 * (chat / hud / opening / overview + root helpers). Business *-module domains under
 * features/ are excluded so relocating them does not bloat or skew shell asserts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FEATURE_SHELL_DIRS = new Set(["chat", "hud", "opening", "overview"]);

function walkJs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJs(p, out);
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

export function listClientShellPaths({
  root = process.cwd(),
  includeMain = true
} = {}) {
  const paths = [];
  if (includeMain) paths.push(join(root, "public/main.js"));
  paths.push(...walkJs(join(root, "public/shell")).sort());

  const featuresRoot = join(root, "public/features");
  if (existsSync(featuresRoot)) {
    const featurePaths = [];
    for (const name of readdirSync(featuresRoot)) {
      const p = join(featuresRoot, name);
      if (statSync(p).isDirectory()) {
        if (FEATURE_SHELL_DIRS.has(name)) walkJs(p, featurePaths);
      } else if (name.endsWith(".js")) {
        featurePaths.push(p);
      }
    }
    paths.push(...featurePaths.sort());
  }
  return paths;
}

export function readClientShellSource(options = {}) {
  return listClientShellPaths(options)
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
}
