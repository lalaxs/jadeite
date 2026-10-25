import { existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const targets = [".refactor-test-results", ".tmp", ".superpowers/brainstorm", "dist", "coverage",
  "playwright-report", "test-results", "test-task-e2e.mjs"];

for (const name of readdirSync(root)) {
  if (name === ".DS_Store" || name === "server.log" || name.startsWith("npm-debug.log")
    || /^\.codex-.*-(?:results\.json|tests\.log)$/.test(name)) targets.push(name);
}

for (const name of readdirSync(path.join(root, "public"))) {
  if (name.endsWith(".bak") || /^styles\.css\..*bak$/.test(name) || name === ".DS_Store") {
    targets.push(`public/${name}`);
  }
}

const workbuddy = path.join(root, ".workbuddy");
if (existsSync(workbuddy)) {
  for (const entry of readdirSync(workbuddy, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("balance_doc_render_")) {
      targets.push(`.workbuddy/${entry.name}`);
    }
  }
}

function collectReportOutputs(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) collectReportOutputs(location);
    else if (/\.(?:png|jpe?g|log|html)$/i.test(entry.name)) {
      targets.push(path.relative(root, location));
    }
  }
}

collectReportOutputs(path.join(root, "docs/reports"));
targets.push("docs/reports/2026-10-23-economy-implementation/simulation.json");

for (const target of targets) {
  const location = path.join(root, target);
  if (!existsSync(location)) continue;
  rmSync(location, { recursive: true, force: true });
  console.log(`Removed ${target}`);
}
