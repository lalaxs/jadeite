import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// All tests own disposable worlds. This runner never starts or restarts the
// regular game service, and keeps its evidence separate from earlier reports.
const directory = "docs/reports/2026-10-23-planning-finance";
mkdirSync(directory, { recursive: true });
const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
function expand(command) {
  return command.split("&&").flatMap((part) => {
    const words = part.trim().split(/\s+/);
    if (words[0] === "npm" && words[1] === "run") return expand(scripts[words[2]]);
    if (words[0] !== "node") throw new Error(`Unsupported test command: ${part}`);
    return [words.slice(1)];
  });
}
const argumentsList = process.argv.slice(2);
const reportArgument = argumentsList.find((arg) => arg.startsWith("--report="));
const reportName = reportArgument?.slice("--report=".length);
if (reportName && !/^[a-z0-9_-]+$/.test(reportName)) throw new Error("Invalid report name");
const requested = argumentsList.filter((arg) => !arg.startsWith("--report="));
const commands = requested.length ? requested.flatMap((name) => scripts[name] ? expand(scripts[name]) : [[name]]) : expand(scripts.test);
const results = [];
for (const args of commands) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 180_000,
    env: { ...process.env, JADE_WORLD_PERSIST: "0", LOG_LEVEL: "warn" }, maxBuffer: 4 * 1024 * 1024 });
  const row = { script: args.join(" "), exitCode: result.status, ms: Date.now() - started,
    output: `${result.stdout || ""}${result.stderr || ""}`, error: result.error?.message };
  results.push(row);
  if (row.exitCode !== 0) console.log(JSON.stringify({ failed: row.script, detail: row.output.slice(-2000) || row.error }));
  if (results.length % 10 === 0) console.log(JSON.stringify({ completed: results.length, total: commands.length,
    failures: results.filter((item) => item.exitCode !== 0).length }));
  writeFileSync(`${directory}/${reportName || (requested.length ? "targeted" : "regressions")}.json`, JSON.stringify(results, null, 2));
}
const failures = results.filter((row) => row.exitCode !== 0);
console.log(JSON.stringify({ total: results.length, passed: results.length - failures.length,
  failures: failures.map((row) => row.script) }, null, 2));
process.exitCode = failures.length ? 1 : 0;
