// Test-only preload. Windows kill(SIGTERM) terminates Node without running its
// signal listeners. IPC lets these E2E tests exercise the real shutdown handler.
process.on("message", message => {
  if (message?.type === "test-signal" && message.signal === "SIGTERM") process.emit("SIGTERM");
});
