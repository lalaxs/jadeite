import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const directory = mkdtempSync(path.join(tmpdir(), "jade-sqlite-socket-release-"));
const port = 35000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    JADE_WORLD_PERSIST: "1",
    JADE_WORLD_PERSIST_DRIVER: "sqlite",
    JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite"),
    JADE_WORLD_PATH: path.join(directory, "nonexistent.json"),
    LOG_LEVEL: "warn",
    APP_VERSION: "sqlite-socket-release-e2e"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

async function waitReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`SQLite release server did not become ready\n${serverOutput}`);
}

function runCheck(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, origin], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${script} exited ${code}\n${output}\n${serverOutput}`));
    });
  });
}

try {
  await waitReady();
  const results = [];
  for (const script of [
    "scripts/player-session-socket-e2e.mjs",
    "scripts/mutation-idempotency-socket-e2e.mjs",
    "scripts/socket-payload-hardening-e2e.mjs"
  ]) {
    results.push(await runCheck(script));
  }
  assert.equal(results.length, 3);
  console.log("sqlite-socket-release-e2e: session + idempotency + payload hardening ok");
} finally {
  if (server.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((_, reject) => setTimeout(() => reject(new Error("SQLite release server shutdown timeout")), 5000))
    ]);
  }
  rmSync(directory, { recursive: true, force: true });
}
