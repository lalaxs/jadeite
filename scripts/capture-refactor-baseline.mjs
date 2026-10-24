import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const name = process.argv.find(arg => arg.startsWith("--name="))?.slice(7);
if (!name || !/^[\w-]+$/.test(name)) throw new Error("Use an explicit unique --name=...; snapshots are never overwritten");
const root = process.cwd();
const destination = path.resolve(root, "..", "jade-market-refactor-baselines", name);
if (existsSync(destination)) throw new Error(`Snapshot exists: ${destination}`);
const directories = ["public", "server", "shared", "scripts", ".github", "ops"];
const files = ["server.js", "workshop-start-handler.js", "package.json", "package-lock.json", "README.md", ".gitignore", "Dockerfile", "compose.yaml", "playwright.workshop.config.mjs",
  "docs/art/2026-10-23-buddha-original-lines/buddha-original-clean-lines-v1.png"];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.isFile()) files.push(file);
  }
}
for (const directory of directories) if (existsSync(directory)) visit(directory);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const entries = [];
mkdirSync(destination, { recursive: true });
for (const file of files.filter(file => existsSync(file))) {
  const relative = file.replaceAll("\\", "/");
  const bytes = readFileSync(file);
  const target = path.join(destination, file);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(file, target);
  if (sha(readFileSync(target)) !== sha(bytes)) throw new Error(`File changed during baseline capture: ${file}`);
  const text = /\.(js|mjs|json|css|html|svg|md|ya?ml|sql|sh)$/.test(file);
  entries.push({ path: relative, bytes: bytes.length, sha256: sha(bytes),
    ...(text ? { normalizedSha256: sha(bytes.toString("utf8").replaceAll("\r\n", "\n")) } : {}) });
}
for (const entry of entries) {
  if (sha(readFileSync(entry.path)) !== entry.sha256) throw new Error(`Worktree changed during baseline capture: ${entry.path}`);
}
const manifest = {
  capturedAt: new Date().toISOString(), name, snapshotPath: destination,
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
  excludes: ["node_modules", ".git", "data", ".env secrets", "historical docs/reports"],
  files: entries.sort((a, b) => a.path.localeCompare(b.path))
};
writeFileSync(path.join(destination, "baseline-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(path.join(destination, "git-status.txt"), execFileSync("git", ["status", "--porcelain=v1", "-uall"], { encoding: "utf8" }));
// Dependencies are reproducible from package-lock; this local junction is only
// a convenience for inspecting/running the isolated source snapshot.
symlinkSync(path.join(root, "node_modules"), path.join(destination, "node_modules"), "junction");
writeFileSync("docs/reports/2026-10-23-workshop-refactor/baseline-final-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ destination, files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) }, null, 2));
