import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const version = process.env.APP_VERSION;
if (!version || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version)) {
  throw new Error("APP_VERSION must be a release label containing letters, numbers, dots, underscores or hyphens");
}
const output = path.resolve("dist/static");
const prefix = `/releases/${version}`;
const release = path.join(output, "releases", version);
mkdirSync(release, { recursive: true });
cpSync("public", path.join(release, "public"), { recursive: true });
cpSync("shared", path.join(release, "shared"), { recursive: true });
mkdirSync(path.join(release, "public/vendor"), { recursive: true });
cpSync("node_modules/socket.io/client-dist/socket.io.min.js", path.join(release, "public/vendor/socket.io.min.js"));

function rewrite(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) rewrite(file);
    else if (/\.(?:js|css|html)$/.test(entry.name)) {
      const source = readFileSync(file, "utf8").replace(/(["'`(])\/(assets|shared)\//g,
        (_, quote, directory) => `${quote}${prefix}/${directory === "assets" ? "public/assets" : "shared"}/`);
      writeFileSync(file, source);
    }
  }
}
rewrite(release);
const html = readFileSync(path.join(release, "public/index.html"), "utf8")
  .replace('src="/socket.io/socket.io.js"', `src="${prefix}/public/vendor/socket.io.min.js"`)
  .replace('src="/main.js"', `src="${prefix}/public/main.js"`)
  .replace('href="/styles.css"', `href="${prefix}/public/styles.css"`)
  .replace(/<details\s+class="debug-panel[\s\S]*?<\/details>/, "");
writeFileSync(path.join(output, "index.html"), html);
console.log(`Static release ${version} written to ${output}`);
