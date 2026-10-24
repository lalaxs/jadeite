import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const name = process.argv.find(arg => arg.startsWith("--name="))?.slice(7);
assert.ok(name && /^[\w-]+$/.test(name), "Use a unique --name=...");
const root = process.cwd();
const destination = path.resolve(root, ".refactor-test-results", "trading", name);
assert.ok(destination.startsWith(root + path.sep), "Snapshot stays inside this workspace");
assert.ok(!existsSync(destination), "Never overwrite a source snapshot");
const files = new Set(["server.js", "workshop-start-handler.js", "package.json", "package-lock.json", "README.md", ".gitignore", ".dockerignore", ".env.production.example", "Dockerfile", "compose.yaml", "playwright.workshop.config.mjs",
  "docs/reports/2026-10-23-workshop-server-refactor/baseline-manifest.json", "docs/operations-runbook.md", "docs/predeploy-checklist.md", "docs/server-deployment-plan.md", "docs/server-architecture.md",
  "docs/art/2026-10-23-buddha-original-lines/buddha-original-clean-lines-v1.png"]);
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) visit(file);
    else if (entry.isFile()) files.add(file);
  }
}
for (const directory of ["public", "server", "shared", "scripts", ".github", "ops"]) if (existsSync(directory)) visit(directory);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const entries = [];
for (const file of [...files].filter(file => existsSync(file)).sort()) {
  const bytes = readFileSync(file);
  const target = path.join(destination, file);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(file, target);
  assert.equal(sha(readFileSync(target)), sha(bytes), `${file} changed while copying`);
  const text = /\.(js|mjs|json|css|html|svg|md|ya?ml|sql|sh)$/.test(file);
  entries.push({ path: file, bytes: bytes.length, sha256: sha(bytes), ...(text ? { normalizedSha256: sha(bytes.toString("utf8").replaceAll("\r\n", "\n")) } : {}) });
}
for (const entry of entries) assert.equal(sha(readFileSync(entry.path)), entry.sha256, `${entry.path} changed while capturing`);
const manifest = { capturedAt: new Date().toISOString(), name, snapshotPath: destination,
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
  excludes: [".git", "actual player data", ".env secrets", "node_modules (local junction only)", "historical reports"], files: entries };
writeFileSync(path.join(destination, "baseline-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(path.join(destination, "git-status.txt"), execFileSync("git", ["status", "--porcelain=v1", "-uall"], { encoding: "utf8" }));
symlinkSync(path.join(root, "node_modules"), path.join(destination, "node_modules"), "junction");
const report = "docs/reports/2026-10-23-trading-service-refactor";
mkdirSync(report, { recursive: true });
writeFileSync(`${report}/baseline-manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ destination, files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) }));
