import { spawn } from "node:child_process";
import { once } from "node:events";

const port = Number(process.env.WORKSHOP_TEST_PORT || 3137);
const origin = `http://127.0.0.1:${port}`;
const integrationBaseline = process.argv.includes("--integration-baseline");
const serverBaseline = process.argv.includes("--server-baseline") || integrationBaseline;
try {
  await fetch(origin);
  throw new Error(`Test port ${port} is occupied; choose WORKSHOP_TEST_PORT, never reuse a live game`);
} catch (error) {
  if (error.message.includes("occupied")) throw error;
}
const server = spawn(process.execPath, ["scripts/workshop-visual-server.mjs"], {
  env: { ...process.env, WORKSHOP_TEST_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
server.stdout.on("data", data => { output += data; });
server.stderr.on("data", data => { output += data; });
try {
  const deadline = Date.now() + 10000;
  while (true) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    if (Date.now() > deadline || server.exitCode != null) throw new Error(`Static test server did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const runner = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.workshop.config.mjs", ...process.argv.slice(2).filter(arg => !["--server-baseline", "--integration-baseline"].includes(arg))], {
    env: { ...process.env, WORKSHOP_TEST_PORT: String(port),
      ...(serverBaseline ? { WORKSHOP_BASELINE_DIR: "scripts/fixtures/workshop-server-baseline" } : {}),
      ...(integrationBaseline ? { WORKSHOP_PRESERVE_DRAFTS: "1" } : {}) }, stdio: "inherit"
  });
  const [code] = await once(runner, "exit");
  process.exitCode = code ?? 1;
} finally {
  if (server.exitCode == null) { const stopped = once(server, "exit"); server.kill(); await stopped; }
}
