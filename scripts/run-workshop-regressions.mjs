import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";

// Run every check even when the starting worktree already has failures.
// Separate processes preserve the singleton/test-clock isolation of npm scripts.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const full = process.argv.includes("--full");
const tradingPhase = process.argv.includes("--trading");
const gameInstancePhase = process.argv.includes("--game-instance");
const integrationPhase = process.argv.includes("--integration") || gameInstancePhase;
const serverPhase = process.argv.includes("--server") || tradingPhase || integrationPhase;
const baseline = process.argv.includes("--baseline");
const release = process.argv.includes("--release");
const reportArg = process.argv.find((arg) => arg.startsWith("--report="));
const report = reportArg?.slice("--report=".length) || ".refactor-test-results/workshop-regression";
const focused = [
  "test:quality", "test:contracts", "test:shared-domain", "test:planning-authority",
  "test:atomic-mutation", "test:durable-mutation", "test:state-patch", "test:socket-schemas",
  "test:workshop-service", "test:workshop-planner-ui", "test:finish-plan-model",
  "test:finish-plan-controller", "test:inlay-preview-tester", "test:craft-scoring",
  "test:worker-detail-view", "test:inventory", "test:styles-split", "test:action-router",
  "test:flow", "test:ui", "test:ui-stability", "test:modal-lifecycle", "test:responsive",
  "test:bangle-finish", "test:inlay", "test:world-store", "test:world-persist",
  "test:sqlite-persist", "test:crash-recovery", "test:market-service", "test:blackmarket-service", "test:employee"
];
function expand(command) {
  return command.split(/\s*&&\s*/).flatMap((part) => {
    const nested = /^npm (?:run )?([\w:-]+)$/.exec(part);
    if (nested) return expand(pkg.scripts[nested[1]]);
    if (!/^node scripts\/[\w./-]+\.mjs$/.test(part)) throw new Error(`Unsupported test command: ${part}`);
    return [part.slice(5)];
  });
}
const required = ["test:durable-mutation", "test:state-patch", "test:socket-schemas", "test:starter-economy",
  ...(serverPhase ? ["test:economy-overhaul", "test:e2e:commission", "test:workshop-material-analysis", "test:workshop-delivery-details",
    ...(integrationPhase ? ["test:planning-finance", "test:inventory-detail-analysis", ...(!baseline ? [gameInstancePhase ? "test:game-instance" : "test:trading-integration"] : gameInstancePhase ? ["test:trading-current-rules"] : [])] : tradingPhase ? ["test:workshop-server-parity", "test:workshop-server-equivalence",
      ...(!baseline ? ["test:trading-refactor"] : [])] : !baseline ? ["test:workshop-server-refactor"] : [])] : ["test:workshop-refactor"])]
  .filter(name => pkg.scripts[name]);
const commands = [...new Set([...(full ? expand(pkg.scripts.test) : focused.flatMap((name) => expand(pkg.scripts[name]))),
  ...(release ? expand(pkg.scripts["test:server-release"]) : []),
  ...required.flatMap(name => expand(pkg.scripts[name]))])];
mkdirSync(path.dirname(report), { recursive: true });
const results = [];
for (const script of commands) {
  const started = Date.now();
  const result = await new Promise((resolve) => execFile(process.execPath, [script], {
    env: { ...process.env, JADE_WORLD_PERSIST: "0" }, timeout: 180_000, maxBuffer: 4_000_000
  }, (error, stdout, stderr) => resolve({ script, exitCode: error?.code ?? 0, elapsedMs: Date.now() - started, stdout, stderr })));
  results.push(result);
  writeFileSync(`${report}.json`, JSON.stringify({ mode: full ? "full" : "workshop", serverPhase, tradingPhase, integrationPhase, gameInstancePhase, baseline, release, results }, null, 2) + "\n");
  writeFileSync(`${report}.log`, results.map((r) => `${r.script} [${r.exitCode}]\n${r.stdout}${r.stderr}`).join("\n"));
  console.log(`${result.exitCode === 0 ? "PASS" : "FAIL"} ${script} (${result.elapsedMs} ms)`);
}
const failures = results.filter((r) => r.exitCode !== 0);
console.log(JSON.stringify({ total: results.length, passed: results.length - failures.length, failures: failures.map((r) => r.script), report }, null, 2));
process.exitCode = failures.length ? 1 : 0;
