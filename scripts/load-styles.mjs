import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IMPORT_RE = /@import\s+url\("([^"]+)"\)\s*;/g;

/**
 * Resolve a CSS entry file and its relative @import url(...) chain into one string.
 * Used by smokes so they keep asserting against the full stylesheet after the split.
 */
export function loadResolvedStyles(entryPath = "public/styles.css") {
  const absolute = resolve(entryPath);
  return resolveFile(absolute, new Set());
}

function resolveFile(absolutePath, seen) {
  if (seen.has(absolutePath)) {
    throw new Error(`circular css import: ${absolutePath}`);
  }
  seen.add(absolutePath);
  const source = readFileSync(absolutePath, "utf8");
  const baseDir = dirname(absolutePath);
  let out = "";
  let lastIndex = 0;
  for (const match of source.matchAll(IMPORT_RE)) {
    out += source.slice(lastIndex, match.index);
    const imported = resolve(baseDir, match[1]);
    out += resolveFile(imported, seen);
    lastIndex = match.index + match[0].length;
  }
  out += source.slice(lastIndex);
  return out;
}

export function stylesEntryFromMeta(metaUrl, relative = "../public/styles.css") {
  return fileURLToPath(new URL(relative, metaUrl));
}
