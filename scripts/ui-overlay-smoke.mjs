import { readFileSync } from "node:fs";

const index = readFileSync("public/index.html", "utf8");
const main = readFileSync("public/main.js", "utf8");
const styles = readFileSync("public/styles.css", "utf8");
const server = readFileSync("server.js", "utf8");

const expectations = [
  [index, /id="floatingTextLayer"/, "index.html should mount a global floating text layer outside refreshed views"],
  [index, /id="modalRoot"/, "index.html should mount a global modal root outside refreshed views"],
  [main, /floatingTextLayer:\s*document\.querySelector\("#floatingTextLayer"\)/, "main.js should cache the floating text layer"],
  [main, /modalRoot:\s*document\.querySelector\("#modalRoot"\)/, "main.js should cache the modal root"],
  [main, /function spawnFloatingText\b/, "main.js should expose a floating text spawner"],
  [main, /function openGameModal\b/, "main.js should expose a modal opener"],
  [main, /function closeGameModal\b/, "main.js should expose a modal closer"],
  [main, /function handleUiEvent\b/, "main.js should route structured UI events"],
  [main, /socket\.on\("ui:event",\s*handleUiEvent\)/, "main.js should listen for server-driven UI events"],
  [main, /function maybeShowStateDrivenModals\b/, "main.js should surface state-driven summary modals once"],
  [main, /shownUiEventIds/, "main.js should dedupe replayed modal or floating text events"],
  [styles, /\.floating-text-layer\b/, "styles.css should style the global floating text layer"],
  [styles, /@keyframes\s+floatTextRise\b/, "styles.css should animate floating text upward"],
  [styles, /\.modal-root\b/, "styles.css should style the modal overlay root"],
  [styles, /\.game-modal\b/, "styles.css should style game modal panels"],
  [server, /function emitUiEvent\b/, "server.js should provide a structured UI event emitter"],
  [server, /"ui:event"/, "server.js should emit structured UI events for game feedback"]
];

for (const [source, pattern, message] of expectations) {
  if (!pattern.test(source)) throw new Error(message);
}
