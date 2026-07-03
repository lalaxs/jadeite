import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const outDir = new URL("../public/assets/template-icons/", import.meta.url);
mkdirSync(outDir, { recursive: true });

const sharedDefs = `
  <defs>
    <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#0f201d" flood-opacity=".2"/>
    </filter>
    <linearGradient id="templateMetal" x1="18" y1="12" x2="110" y2="118" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f2f0e8" stop-opacity=".72"/>
      <stop offset=".44" stop-color="#9daaa5" stop-opacity=".72"/>
      <stop offset="1" stop-color="#5d6a69" stop-opacity=".68"/>
    </linearGradient>
    <linearGradient id="blueEdge" x1="20" y1="12" x2="108" y2="122" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9cd8f0" stop-opacity=".75"/>
      <stop offset="1" stop-color="#27485c" stop-opacity=".86"/>
    </linearGradient>
    <radialGradient id="paperTone" cx="45%" cy="36%" r="64%">
      <stop offset="0" stop-color="#f8f4e7" stop-opacity=".88"/>
      <stop offset=".68" stop-color="#bec8c0" stop-opacity=".7"/>
      <stop offset="1" stop-color="#78827e" stop-opacity=".66"/>
    </radialGradient>
    <pattern id="rings" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="2.2" fill="none" stroke="#40505a" stroke-width=".45" opacity=".35"/>
    </pattern>
  </defs>
`;

const iconStyle = `
  <style>
    .fill{fill:url(#templateMetal);filter:url(#softShadow)}
    .paper{fill:url(#paperTone);filter:url(#softShadow)}
    .edge{fill:none;stroke:url(#blueEdge);stroke-width:5.4;stroke-linecap:round;stroke-linejoin:round}
    .line{fill:none;stroke:#35454b;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;opacity:.7}
    .fine{fill:none;stroke:#39474d;stroke-width:1.15;stroke-linecap:round;stroke-linejoin:round;opacity:.45}
    .pale{fill:#d9dfd6;opacity:.45}
  </style>
`;

const icons = {
  "bangle.png": `
    <path class="fill" fill-rule="evenodd" d="M64 12a52 52 0 1 1 0 104 52 52 0 0 1 0-104Zm0 31a21 21 0 1 0 0 42 21 21 0 0 0 0-42Z"/>
    <circle class="edge" cx="64" cy="64" r="50"/>
    <circle class="edge" cx="64" cy="64" r="22"/>
    <path class="fine" d="M24 50c16-24 54-31 78-9"/>
    <path class="fine" d="M104 77c-17 24-54 28-78 8"/>
  `,
  "cabochon.png": `
    <ellipse class="paper" cx="64" cy="68" rx="33" ry="47"/>
    <ellipse class="edge" cx="64" cy="68" rx="33" ry="47"/>
    <path class="line" d="M46 48c9-9 27-9 36 0"/>
    <path class="fine" d="M45 73c13 10 25 10 38 0"/>
    <path class="fine" d="M51 88c9 5 17 5 26 0"/>
  `,
  "blank-plaque.png": `
    <rect class="paper" x="35" y="14" width="58" height="100" rx="14"/>
    <rect class="edge" x="35" y="14" width="58" height="100" rx="14"/>
    <circle class="line" cx="64" cy="31" r="5"/>
    <path class="line" d="M45 47c10-7 28-7 38 0"/>
    <path class="line" d="M45 98c10 7 28 7 38 0"/>
    <path class="fine" d="M47 61c12 5 22 5 34 0"/>
    <path class="fine" d="M47 75c12 5 22 5 34 0"/>
  `,
  "buddha.png": `
    <path class="paper" d="M64 14c18 0 29 13 28 29 14 6 20 21 12 34 17 27 5 43-40 43S7 104 24 77c-8-13-2-28 12-34-1-16 10-29 28-29z"/>
    <path class="edge" d="M64 14c18 0 29 13 28 29 14 6 20 21 12 34 17 27 5 43-40 43S7 104 24 77c-8-13-2-28 12-34-1-16 10-29 28-29z"/>
    <path class="line" d="M47 50c9 7 25 7 34 0"/>
    <path class="fine" d="M51 61c8 5 18 5 26 0"/>
    <path class="line" d="M38 78c13 15 39 15 52 0"/>
    <path class="fine" d="M45 97c14 8 24 8 38 0"/>
  `,
  "guanyin.png": `
    <path class="paper" d="M64 13c18 10 29 28 21 46 18 21 12 47-21 64-33-17-39-43-21-64-8-18 3-36 21-46z"/>
    <path class="edge" d="M64 13c18 10 29 28 21 46 18 21 12 47-21 64-33-17-39-43-21-64-8-18 3-36 21-46z"/>
    <path class="line" d="M50 57c8 8 20 8 28 0"/>
    <path class="fine" d="M47 78c11 12 23 12 34 0"/>
    <path class="fine" d="M51 101c9 6 17 6 26 0"/>
  `,
  "peace-buckle.png": `
    <path class="fill" fill-rule="evenodd" d="M64 16a48 48 0 1 1 0 96 48 48 0 0 1 0-96Zm0 20a28 28 0 1 0 0 56 28 28 0 0 0 0-56Z"/>
    <circle class="edge" cx="64" cy="64" r="47"/>
    <circle class="edge" cx="64" cy="64" r="19"/>
    <circle cx="64" cy="64" r="39" fill="url(#rings)" opacity=".58"/>
  `,
  "ruyi.png": `
    <path class="paper" d="M23 48c-7-26 25-35 43-14 23-29 61-4 49 27-7 17-26 20-43 9l10 38c-15 9-33 7-43-6l10-35c-17 11-29 3-26-19z"/>
    <path class="edge" d="M23 48c-7-26 25-35 43-14 23-29 61-4 49 27-7 17-26 20-43 9l10 38c-15 9-33 7-43-6l10-35c-17 11-29 3-26-19z"/>
    <path class="line" d="M41 57c14 11 39 11 53 0"/>
    <path class="fine" d="M53 84c8 8 20 8 28 0"/>
  `,
  "fu-bean.png": `
    <path class="paper" d="M68 12c30 21 34 51 13 70 17 20 1 44-25 49-28-21-22-47-2-60-18-28-10-52 14-59z"/>
    <path class="edge" d="M68 12c30 21 34 51 13 70 17 20 1 44-25 49-28-21-22-47-2-60-18-28-10-52 14-59z"/>
    <path class="line" d="M50 45c13 8 27 8 39 0"/>
    <path class="line" d="M48 76c13 8 27 8 40 0"/>
    <path class="fine" d="M52 106c10 5 18 5 28 0"/>
  `,
  "leaf.png": `
    <path class="paper" d="M79 8c35 46 19 95-37 119C12 84 28 32 79 8z"/>
    <path class="edge" d="M79 8c35 46 19 95-37 119C12 84 28 32 79 8z"/>
    <path class="line" d="M75 18c-6 35-19 67-36 99"/>
    <path class="fine" d="M61 52c-15 6-26 15-35 28"/>
    <path class="fine" d="M56 78c-13 5-22 13-29 24"/>
  `,
  "gourd.png": `
    <path class="paper" d="M64 12c22 0 34 22 17 40 31 14 29 69-17 79-46-10-48-65-17-79-17-18-5-40 17-40z"/>
    <path class="edge" d="M64 12c22 0 34 22 17 40 31 14 29 69-17 79-46-10-48-65-17-79-17-18-5-40 17-40z"/>
    <path class="line" d="M49 53c10 8 20 8 30 0"/>
    <path class="fine" d="M45 83c13 10 25 10 38 0"/>
    <path class="fine" d="M50 108c9 5 19 5 28 0"/>
  `
};

const tmp = mkdtempSync(join(tmpdir(), "jade-template-icons-"));
try {
  for (const [fileName, body] of Object.entries(icons)) {
    const svgPath = join(tmp, fileName.replace(/\.png$/, ".svg"));
    const pngPath = new URL(fileName, outDir);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${sharedDefs}${iconStyle}${body}</svg>`;
    writeFileSync(svgPath, svg);
    execFileSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath.pathname], { stdio: "ignore" });
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`Generated ${Object.keys(icons).length} template icons in ${outDir.pathname}`);
