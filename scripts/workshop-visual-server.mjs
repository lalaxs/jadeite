import express from "express";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
// Static assets only: browser tests inject an isolated recorded Socket transport.
// Freeze files at startup so both comparison clients see exactly the same
// dependencies even if another development task writes to the shared worktree.
const files = new Map();
function capture(directory, prefix) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const key = `${prefix}/${entry.name}`;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) capture(file, key);
    else if (entry.isFile()) files.set(key, readFileSync(file));
  }
}
capture("public", "");
capture("shared", "/shared");
if (process.env.WORKSHOP_CANDIDATE_DIR) {
  const directory = process.env.WORKSHOP_CANDIDATE_DIR;
  for (const name of readdirSync(directory).filter(name => name.endsWith(".js"))) {
    files.set(`/features/workshop/${name}`, readFileSync(path.join(directory, name)));
  }
}
const app = express();
app.get(/.*/, (req, res) => {
  const key = req.path === "/" ? "/index.html" : req.path;
  const bytes = files.get(key);
  if (!bytes) return res.sendStatus(404);
  res.type(path.extname(key)).send(bytes);
});
app.listen(Number(process.env.WORKSHOP_TEST_PORT || 3137), "127.0.0.1");
