import { readFileSync } from "node:fs";
import fs from "node:fs";
import { readClientShellSource } from "./load-client-shell.mjs";
import { loadResolvedStyles } from "./load-styles.mjs";

const mainEntry = fs.readFileSync("public/main.js", "utf8");
const mainSource = readClientShellSource();
const styleSource = loadResolvedStyles();
const serverSource = fs.readFileSync("server.js", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

if (fs.existsSync("public/jade-rough-3d.js")) {
  throw new Error("Rough jade should render with Canvas only; remove public/jade-rough-3d.js");
}

if (/paintRough3DCanvases|jade-rough-3d/.test(mainSource)) {
  throw new Error("main.js should not import or call the rough 3D renderer");
}

if (/jade-3d-wrap|jade-3d-canvas|has-3d/.test(styleSource)) {
  throw new Error("styles.css should not keep rough 3D wrapper styles");
}

if (/vendor\/three|node_modules\/three/.test(serverSource)) {
  throw new Error("server.js should not serve Three.js when Canvas-only rendering is active");
}

if (packageJson.dependencies?.three || packageJson.scripts?.["test:3d"]) {
  throw new Error("package.json should not keep Three.js or the rough 3D smoke test");
}

console.log("Canvas-only jade rendering checks passed");
