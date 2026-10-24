const windows = process.platform === "win32";
export const serverProcessArgs = windows
  ? ["--import", "./scripts/fixtures/test-signal-bridge.mjs", "server.js"]
  : ["server.js"];
export const serverProcessStdio = windows ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"];

export async function stopTestServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timer;
  try {
    await new Promise((resolve, reject) => {
      child.once("exit", resolve);
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("test server did not shut down gracefully"));
      }, 5000);
      if (windows) child.send({ type: "test-signal", signal: "SIGTERM" }, error => { if (error) reject(error); });
      else child.kill("SIGTERM");
    });
  } finally {
    clearTimeout(timer);
  }
}
