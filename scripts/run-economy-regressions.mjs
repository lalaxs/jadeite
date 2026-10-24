// Expand the repository's npm test graph for environments with Node but no npm.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const output = "docs/reports/2026-10-23-economy-implementation";
fs.mkdirSync(output, { recursive: true });
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
function expand(command) {
  return command.split("&&").flatMap((part) => {
    const words = part.trim().split(/\s+/);
    if (words[0] === "npm" && words[1] === "run") return expand(pkg.scripts[words[2]]);
    if (words[0] !== "node") throw new Error(`Unsupported test command: ${part}`);
    return [words.slice(1)];
  });
}
const filter = process.argv.slice(2);
const commands = filter.length ? filter.map((name) => [name]) : expand(pkg.scripts.test);
const results = [];
for (const args of commands) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 180_000,
    env: { ...process.env, JADE_WORLD_PERSIST: "0", LOG_LEVEL: "warn" }, maxBuffer: 4 * 1024 * 1024 });
  const row = { script: args.join(" "), exitCode: result.status, ms: Date.now() - startedAt,
    output: `${result.stdout || ""}${result.stderr || ""}`, error: result.error?.message };
  results.push(row);
  if (row.exitCode !== 0) console.log(JSON.stringify({ failed: row.script, error: row.output.slice(-1400) || row.error }));
  if (results.length % 10 === 0) console.log(JSON.stringify({ completed: results.length, total: commands.length, failures: results.filter((row) => row.exitCode !== 0).length }));
  fs.writeFileSync(`${output}/regressions${filter.length ? "-rerun" : ""}.json`, JSON.stringify(results, null, 2));
}
const failures = results.filter((row) => row.exitCode !== 0);
console.log(JSON.stringify({ total: results.length, passed: results.length - failures.length, failures: failures.map((row) => row.script) }, null, 2));
process.exitCode = failures.length ? 1 : 0;
