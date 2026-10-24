import { readFileSync } from "node:fs";
import { readClientShellSource } from "./load-client-shell.mjs";
import { loadResolvedStyles } from "./load-styles.mjs";

const index = readFileSync("public/index.html", "utf8");
const mainEntry = readFileSync("public/main.js", "utf8");
const main = readClientShellSource();
const styles = loadResolvedStyles();
const server = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const serverContext = readFileSync("server/shell/server-context.js", "utf8");
const boot = `${server}\n${wireSource}\n${serverContext}`;

const expectations = [
  [index, /id="floatingTextLayer"/, "index.html should mount a global floating text layer outside refreshed views"],
  [index, /id="modalRoot"/, "index.html should mount a global modal root outside refreshed views"],
  [index, /id="toast" class="toast-stack"/, "index.html should mount a dedicated toast stack"],
  [main, /floatingTextLayer:\s*document\.querySelector\("#floatingTextLayer"\)/, "main.js should cache the floating text layer"],
  [main, /modalRoot:\s*document\.querySelector\("#modalRoot"\)/, "main.js should cache the modal root"],
  [main, /function spawnFloatingText\b/, "main.js should expose a floating text spawner"],
  [main, /function showToast\b/, "main.js should expose a dedicated toast renderer"],
  [main, /MAX_FLOATS\s*=\s*3/, "floating feedback should cap simultaneous messages"],
  [main, /MAX_TOASTS\s*=\s*3/, "toast feedback should cap simultaneous messages"],
  [main, /floatAnchorSelector/, "numeric floating feedback should anchor to related HUD regions"],
  [main, /function openGameModal\b/, "main.js should expose a modal opener"],
  [main, /function closeGameModal\b/, "main.js should expose a modal closer"],
  [main, /function handleUiEvent\b/, "main.js should route structured UI events"],
  [main, /socket\.on\("ui:event",\s*handleUiEvent\)/, "main.js should listen for server-driven UI events"],
  [main, /function maybeShowStateDrivenModals\b/, "main.js should surface state-driven summary modals once"],
  [main, /pendingAuctionSettle/, "main.js should surface pending auction settle modals from state"],
  [main, /pendingLivestreamSettle/, "main.js should surface pending livestream settle modals from state"],
  [main, /isGameModalOpenWithId/, "main.js should avoid clearing auction settle pending before the modal is open"],
  [main, /ackAuctionSettle/, "main.js should ack auction settle only when the player dismisses the modal"],
  [main, /ackLivestreamSettle/, "main.js should ack livestream settle when the player dismisses the modal"],
  [main, /shownUiEventIds/, "main.js should dedupe replayed modal or floating text events"],
  [styles, /\.floating-text-layer\b/, "styles.css should style the global floating text layer"],
  [styles, /@keyframes\s+floatTextRise\b/, "styles.css should animate floating text upward"],
  [styles, /\.toast-stack\b/, "styles.css should keep informational feedback in an edge lane"],
  [styles, /\.toast-item\b/, "styles.css should style individual toast messages"],
  [styles, /\.modal-root\b/, "styles.css should style the modal overlay root"],
  [styles, /\.game-modal\b/, "styles.css should style game modal panels"],
  [boot, /function emitUiEvent\b/, "server.js should provide a structured UI event emitter"],
  [boot, /"ui:event"/, "server.js should emit structured UI events for game feedback"]
];

for (const [source, pattern, message] of expectations) {
  if (!pattern.test(source)) throw new Error(message);
}
