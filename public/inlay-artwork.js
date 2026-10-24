// Generated hand-painted artwork. Crop with SVG symbols so the original PNG
// alpha and paint stay intact; image URLs are shared by all product instances.
export const INLAY_ART_ATLASES = Object.freeze({
  accessories: { href: "/assets/inlay/accessories-handpainted-v1.png", width: 1254, height: 1254 },
  gems: { href: "/assets/inlay/gems-handpainted-v1.png", width: 1536, height: 1024 },
  core: { href: "/assets/inlay/jade-and-mounts-handpainted-v2.png", width: 1774, height: 887 },
  buddha: { href: "/assets/inlay/buddha-original-clean-lines-v1.png", width: 1278, height: 1230 }
});

// Original Buddha with redundant carving lines removed; exclude canvas margins.
export const BUDDHA_ART_FRAME = Object.freeze([146, 140, 1000, 944]);

export const INLAY_CORE_FRAMES = Object.freeze({
  jadeOval: [94, 72, 252, 343],
  ovalFrameGold: [968, 60, 273, 364], ovalFrameSilver: [1416, 60, 273, 364],
  buddhaFrameGold: [44, 481, 353, 344], buddhaFrameSilver: [489, 481, 352, 343],
  // Crop inside the ribbon ends: no end-cap seams when following a contour.
  rimGold: [947, 602, 319, 74], rimSilver: [1390, 602, 322, 74],
  // A narrow cross-section bends around a contour without compressing the
  // whole ribbon's horizontal brush grain into a row of visible ridges.
  rimProfileGold: [1102, 602, 8, 74], rimProfileSilver: [1547, 602, 8, 74]
});

export const INLAY_ART_FRAMES = Object.freeze({
  ringGold: [39, 109, 301, 150], ringSilver: [376, 109, 305, 150],
  bailGold: [756, 60, 141, 219], bailSilver: [1042, 59, 140, 221],
  prongGold: [128, 360, 89, 214], prongSilver: [444, 360, 89, 214],
  roundSeatGold: [680, 379, 210, 203], roundSeatSilver: [997, 379, 208, 202],
  squareSeatGold: [70, 662, 205, 199], squareSeatSilver: [383, 662, 206, 200],
  linkGold: [723, 678, 148, 200], linkSilver: [1014, 677, 149, 200],
  cordKnot: [52, 914, 239, 269], cordLoop: [368, 921, 232, 264],
  textureGold: [665, 950, 235, 210], textureSilver: [980, 950, 230, 210],
  diamondRound: [102, 108, 353, 352], rubyRound: [591, 106, 356, 355], sapphireRound: [1079, 106, 356, 355],
  diamondSquare: [101, 545, 358, 347], rubySquare: [588, 546, 361, 346], sapphireSquare: [1077, 545, 360, 347]
});

const n = (v) => Number(v.toFixed(4));

/** A symbol use is cheap even for a full halo; its atlas is declared once. */
export function accessoryArt(id, part, x, y, width, height, attrs = "") {
  return `<use href="#${id}-art-${part}" x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" data-inlay-sprite="${part}" ${attrs}/>`;
}

export function gemstoneArt(id, square, x, y, width, height) {
  return accessoryArt(id, square ? "gem-square" : "gem-round", x, y, width, height);
}

/** Luminance art supplies the painted carving; the captured jade supplies color
 * and inclusions. Never bake a fixed green stone over a player's real cut. */
export function jadeAndMountArtworkDefs(id, { kind, metalId, mounts = true, jade = true } = {}) {
  const buddha = kind === "buddhaPendant";
  const jadeAtlas = buddha ? "buddha" : "core";
  const jadeFrame = buddha ? BUDDHA_ART_FRAME : INLAY_CORE_FRAMES.jadeOval;
  // Match the original atlas's relief brightness: the cleaned grayscale pass
  // is slightly lighter, so removing lines must not lighten the source jade.
  const midpoint = buddha ? 1.06 : 1;
  const tone = ["silver925", "platinum"].includes(metalId) ? "Silver" : "Gold";
  const image = (name) => {
    const atlas = INLAY_ART_ATLASES[name];
    return `<image id="${id}-atlas-${name}" data-inlay-atlas="${name}" href="${atlas.href}" width="${atlas.width}" height="${atlas.height}"/>`;
  };
  const symbol = (name, frame, filter, atlas = "core") => `<symbol id="${id}-art-${name}" viewBox="${frame.join(" ")}" preserveAspectRatio="none" overflow="hidden"><use href="#${id}-atlas-${atlas}" ${filter ? `filter="url(#${id}-${filter})"` : ""}/></symbol>`;
  return `${mounts || (jade && !buddha) ? image("core") : ""}${jade && buddha ? image("buddha") : ""}
    ${jade ? `<filter id="${id}-jade-art-shadow" color-interpolation-filters="sRGB"><feColorMatrix values="0 0 0 0 .05  0 0 0 0 .05  0 0 0 0 .05  -.4252 -1.4304 -.1444 0 ${midpoint}"/><feComposite in2="SourceAlpha" operator="in"/></filter>
    <filter id="${id}-jade-art-light" color-interpolation-filters="sRGB"><feColorMatrix values="0 0 0 0 .98  0 0 0 0 .98  0 0 0 0 .98  .4252 1.4304 .1444 0 -${midpoint}"/><feComposite in2="SourceAlpha" operator="in"/></filter>
    ${symbol("jade-shadow", jadeFrame, "jade-art-shadow", jadeAtlas)}${symbol("jade-light", jadeFrame, "jade-art-light", jadeAtlas)}` : ""}
    ${mounts ? ["ovalFrame", "buddhaFrame", "rim", "rimProfile"].map((part) => symbol(part, INLAY_CORE_FRAMES[`${part}${tone}`], "art-tint")).join("") : ""}`;
}

export function paintedJadeArt(id, geometry, strength) {
  const b = geometry.nativeBounds;
  const width = b.maxX - b.minX, height = b.maxY - b.minY;
  return `<g class="craft-painted-jade" data-jade-body-art="${geometry.kind}" ${geometry.kind === "buddhaPendant" ? 'data-jade-relief="buddha"' : ""}>
    <g opacity=".76">${accessoryArt(id, "jade-shadow", b.minX, b.minY, width, height)}</g>
    <g opacity="${n(.23 + strength * .72)}">${accessoryArt(id, "jade-light", b.minX, b.minY, width, height)}</g>
  </g>`;
}

export function inlayArtworkDefs(id, metalId = "gold18k", gemId = null) {
  const silver = ["silver925", "platinum"].includes(metalId);
  const tone = silver ? "Silver" : "Gold";
  const metal = INLAY_ART_ATLASES.accessories;
  const gems = INLAY_ART_ATLASES.gems;
  const tint = metalId === "goldPure" ? [1.08, 1.03, .92, 1.1]
    : metalId === "silver925" ? [.86, .89, .90, .72]
      : metalId === "platinum" ? [1.02, 1.04, 1.04, .55] : [1.02, 1.01, .98, .9];
  const symbol = (name, frameName, atlas, tinted = true) => `<symbol id="${id}-art-${name}" viewBox="${INLAY_ART_FRAMES[frameName].join(" ")}" preserveAspectRatio="none" overflow="hidden"><use href="#${id}-atlas-${atlas}" ${tinted ? `filter="url(#${id}-art-tint)"` : frameName.startsWith("diamond") ? `filter="url(#${id}-diamond-light)"` : ""}/></symbol>`;
  const gem = ["diamond", "ruby", "sapphire"].includes(gemId) ? gemId : "diamond";
  return `
    <filter id="${id}-art-tint" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix type="saturate" values="${tint[3]}"/>
      <feComponentTransfer><feFuncR type="linear" slope="${tint[0]}"/><feFuncG type="linear" slope="${tint[1]}"/><feFuncB type="linear" slope="${tint[2]}"/></feComponentTransfer>
    </filter>
    <filter id="${id}-diamond-light" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="1.08" intercept=".025"/><feFuncG type="linear" slope="1.08" intercept=".025"/><feFuncB type="linear" slope="1.08" intercept=".025"/></feComponentTransfer></filter>
    <image id="${id}-atlas-accessories" data-inlay-atlas="accessories" href="${metal.href}" width="${metal.width}" height="${metal.height}"/>
    ${["ring", "bail", "prong", "roundSeat", "squareSeat", "link", "texture"].map((part) => symbol(part, `${part}${tone}`, "accessories")).join("")}
    ${symbol("cordKnot", "cordKnot", "accessories", false)}${symbol("cordLoop", "cordLoop", "accessories", false)}
    <pattern id="${id}-metal-paint" patternUnits="userSpaceOnUse" width="10" height="10">${accessoryArt(id, "texture", 0, 0, 10, 10)}</pattern>
    ${gemId ? `<image id="${id}-atlas-gems" data-inlay-atlas="gems" href="${gems.href}" width="${gems.width}" height="${gems.height}"/>${symbol("gem-round", `${gem}Round`, "gems", false)}${symbol("gem-square", `${gem}Square`, "gems", false)}` : ""}
  `;
}
