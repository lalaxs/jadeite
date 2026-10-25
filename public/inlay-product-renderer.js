import { renderFinishedProduct, accessorySurfaceFilter } from "./finished-product-renderer.js";
import { gemstoneArt, inlayArtworkDefs } from "./inlay-artwork.js";
let swatchInstance = 0;
function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeIdPart(value) {
  return String(value || "product")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || "product";
}

const CRAFT_METALS = {
  goldPure: { light: "#b9a678", mid: "#aa935e", dark: "#91805d", line: "#7e745c" },
  gold18k: { light: "#b7ad92", mid: "#a89b7e", dark: "#8e846e", line: "#797565" },
  silver925: { light: "#a7b3b3", mid: "#929fa1", dark: "#7c898e", line: "#6e7c7f" },
  platinum: { light: "#c0c3b9", mid: "#adb4ac", dark: "#959f98", line: "#7e8982" }
};

const CRAFT_GEMS = {
  diamond: { fill: "#ccd0ca", light: "#daddd5", dark: "#aeb7b0", line: "#899690" },
  ruby: { fill: "#864e58", light: "#9b676c", dark: "#70404c", line: "#69424a" },
  sapphire: { fill: "#4e6478", light: "#718396", dark: "#3c5163", line: "#3b515e" }
};

export { CRAFT_METALS, CRAFT_GEMS };

const METAL_ART = {
  goldPure: { file: "gold-pure", frame: "120 367 1039 590" },
  silver925: { file: "silver-925", frame: "138 403 1002 570" },
  gold18k: { file: "gold-18k", frame: "106 323 1054 693" },
  platinum: { file: "platinum-pt950", frame: "120 343 1032 637" }
};

/** 商铺/库存镶嵌材料图标：与工坊镶嵌预览同一套金属/配石色板 */
export function materialSwatchHtml(material = {}, options = {}) {
  const key = material.key || material.id || "";
  const group = material.group
    || (CRAFT_GEMS[key] ? "gem" : (material.unit === "g" || material.unit === "piece" || material.unit === "克" || material.unit === "颗"
      ? (material.unit === "g" || material.unit === "克" ? "metal" : "gem")
      : (CRAFT_METALS[key] ? "metal" : "gem")));
  const sizeClass = options.sizeClass ? ` ${options.sizeClass}` : "";
  const art = METAL_ART[key];
  if (art) return `<div class="material-swatch material-swatch-metal shop-metal-swatch${sizeClass}" data-material-key="${escapeAttr(key)}" data-group="metal" aria-hidden="true"><svg viewBox="${art.frame}" preserveAspectRatio="xMidYMid meet" focusable="false"><image href="/assets/materials/${art.file}-handpainted-v1.png" width="1254" height="1254"/></svg></div>`;
  const gradId = `material-swatch-${safeIdPart(key || group)}-${++swatchInstance}`;
  if (group === "gem" || CRAFT_GEMS[key]) {
    const gem = CRAFT_GEMS[key] || CRAFT_GEMS.diamond;
    return `
      <div class="material-swatch material-swatch-gem${sizeClass}" data-material-key="${escapeAttr(key)}" data-group="gem" aria-hidden="true">
        <svg viewBox="0 0 64 64" focusable="false">
          <defs>${inlayArtworkDefs(gradId, "platinum", key)}</defs>
          <circle cx="32" cy="32" r="23" fill="${gem.fill}"/>
          ${gemstoneArt(gradId, false, 8, 8, 48, 48)}
        </svg>
      </div>
    `;
  }
  const metal = CRAFT_METALS[key] || CRAFT_METALS.gold18k;
  return `
    <div class="material-swatch material-swatch-metal${sizeClass}" data-material-key="${escapeAttr(key)}" data-group="metal" aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${metal.light}"/>
            <stop offset=".58" stop-color="${metal.mid}"/>
            <stop offset="1" stop-color="${metal.dark}"/>
          </linearGradient>
          ${accessorySurfaceFilter(`${gradId}-surface`, .8)}
        </defs>
        <g filter="url(#${gradId}-surface)">
          <ellipse cx="32" cy="36" rx="23" ry="17" fill="url(#${gradId})" stroke="${metal.line}" stroke-width="1"/>
          <ellipse cx="32" cy="30" rx="16" ry="7" fill="${metal.light}" opacity=".12"/>
          <path d="M14 34c6 8 30 8 36 0" fill="none" stroke="${metal.line}" stroke-width=".8" opacity=".24"/>
        </g>
      </svg>
    </div>
  `;
}


export function componentJewelrySvg(item, size = "finished", options = {}) {
  return renderFinishedProduct(item, size, { metals: CRAFT_METALS, gems: CRAFT_GEMS }, options);
}
