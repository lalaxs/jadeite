import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const arg = (key) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const name = arg("name");
const kind = arg("kind");
const controlName = arg("control");
assert.ok(name && /^[\w-]+$/.test(name), "Use a unique --name=...");
assert.ok(["baseline", "candidate"].includes(kind), "Use --kind=baseline|candidate");
assert.ok(!controlName || (kind === "baseline" && /^[\w-]+$/.test(controlName)), "A control overlay is only valid for a baseline");
const root = process.cwd();
const destination = path.resolve(root, ".refactor-test-results", "game-instance", name);
const report = "docs/reports/2026-10-23-game-instance-refactor";
const controlDirectory = controlName && path.resolve(root, ".refactor-test-results", "game-instance", controlName);
const control = controlDirectory && JSON.parse(readFileSync(path.join(controlDirectory, "source-manifest.json"), "utf8"));
const controlFiles = new Map(control?.files.map(file => [file.path, file]) || []);
const overlayPaths = [];
assert.ok(destination.startsWith(root + path.sep));
assert.ok(!existsSync(destination), "Never overwrite a source snapshot");
const files = new Set([
  "server.js", "workshop-start-handler.js", "package.json", "package-lock.json", "README.md", ".gitignore", ".dockerignore", ".env.production.example", "Dockerfile", "compose.yaml", "playwright.workshop.config.mjs",
  "docs/reports/2026-10-23-workshop-server-refactor/baseline-manifest.json",
  "docs/reports/2026-10-23-trading-service-refactor/integration-manifest.json",
  "docs/operations-runbook.md", "docs/predeploy-checklist.md", "docs/server-deployment-plan.md", "docs/server-architecture.md",
  "docs/art/2026-10-23-buddha-original-lines/buddha-original-clean-lines-v1.png",
  ".tmp/detail-parity-layout-qa.mjs",
  ...(kind === "candidate" ? [`${report}/baseline-manifest.json`] : [])
]);
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
  const useControl = control && (file === "server.js" || file.startsWith("server/") || ["scripts/runtime-ticks-smoke.mjs", "scripts/world-persist-smoke.mjs"].includes(file));
  // A later approved UI task can be integrated without changing the original
  // pre-refactor server control. Never mutate either historical snapshot.
  if (useControl && !controlFiles.has(file)) continue;
  const source = useControl ? path.join(controlDirectory, file) : file;
  const bytes = readFileSync(source);
  if (useControl) {
    assert.equal(sha(bytes), controlFiles.get(file).sha256, `Control snapshot changed: ${file}`);
    overlayPaths.push(file);
  }
  const target = path.join(destination, file);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target);
  assert.equal(sha(readFileSync(target)), sha(bytes), `${file} changed while copying`);
  const isText = /\.(js|mjs|json|css|html|svg|md|ya?ml|sql|sh)$/.test(file);
  entries.push({ path: file, bytes: bytes.length, sha256: sha(bytes), ...(isText ? { normalizedSha256: sha(bytes.toString("utf8").replaceAll("\r\n", "\n")) } : {}) });
}
for (const entry of entries) {
  const source = overlayPaths.includes(entry.path) ? path.join(controlDirectory, entry.path) : entry.path;
  assert.equal(sha(readFileSync(source)), entry.sha256, `${entry.path} changed while capturing`);
}
const manifest = {
  capturedAt: new Date().toISOString(), name, snapshotPath: destination,
  ...(control ? { controlSourceSnapshot: controlDirectory, overlayPaths } : {}),
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
  excludes: [".git", "actual player data", ".env secrets", "node_modules (local junction only)", "historical reports except test manifests"],
  files: entries
};
mkdirSync(report, { recursive: true });
writeFileSync(`${report}/${kind}-manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(path.join(destination, "source-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(path.join(destination, "git-status.txt"), execFileSync("git", ["status", "--porcelain=v1", "-uall"], { encoding: "utf8" }));
symlinkSync(path.join(root, "node_modules"), path.join(destination, "node_modules"), "junction");
console.log(JSON.stringify({ destination, kind, files: entries.length }));
