import { buildOpeningStone, renderJadeOpeningProductSvg, openingPaletteForColor } from "./jade-opening-engine.js";
import { SETTING_GEMS, finishedJadeGeometry, fullHaloLayout, settingGemLayout, offsetContour, contourPath, sampleClosedContour } from "../shared/domain/workshop/finished-product-design.js";
import { jadePieceFor } from "../shared/domain/jade/jade-piece.js";
import { resolveSourceMaterialPlacement } from "../shared/domain/jade/product-meta.js";
import { isBangle, bangleFinishRecord } from "../shared/domain/workshop/bangle-finish.js";
import { accessoryArt, gemstoneArt, inlayArtworkDefs, jadeAndMountArtworkDefs, paintedJadeArt } from "./inlay-artwork.js";
import { paintedMountFrame, paintedRibbon, paintedBacking } from "./inlay-painted-mounts.js";

const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (value) => Number(value.toFixed(3));
let instance = 0;
const stoneCache = new Map();
const POLISH = {
  bright: { strength: 0.66, soft: 0.12, shadow: 0.22, blur: 0.2 },
  soft: { strength: 0.24, soft: 0.26, shadow: 0.15, blur: 1.8 },
  matte: { strength: 0.035, soft: 0.07, shadow: 0.10, blur: 2.8 }
};
const path = (d, attrs = "") => `<path d="${d}" ${attrs}/>`;

// Keep accessory grain separate from the jade's original material pass.
export function accessorySurfaceFilter(id, frequency = 2.4) {
  return `<filter id="${escape(id)}" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="2" seed="17" stitchTiles="stitch" result="surface-noise"/>
    <feColorMatrix in="surface-noise" type="saturate" values="0" result="surface-grey"/>
    <feComponentTransfer in="surface-grey" result="surface-soft">
      <feFuncR type="linear" slope=".16" intercept=".84"/><feFuncG type="linear" slope=".16" intercept=".84"/><feFuncB type="linear" slope=".16" intercept=".84"/>
    </feComponentTransfer>
    <feComposite in="surface-soft" in2="SourceAlpha" operator="in" result="surface-grain"/>
    <feBlend in="SourceGraphic" in2="surface-grain" mode="multiply"/>
  </filter>`;
}

function channelRailMarkup(layout, id) {
  return (layout.channels || []).map((channel) => [-1, 1].map((side) => paintedRibbon(id, channel.points.map((p) => ({ x: p.x + side * layout.diameter * .47, y: p.y })), .38, { attrs: 'class="craft-channel-rail"' })).join("")).join("");
}

function sourceMaterialMarkup(item, geometry, id) {
  const piece = jadePieceFor(item);
  const jade = item.components?.find((c) => c.type === "jade");
  const source = jade?.sourceMaterial || item.sourceMaterial || {};
  if (!piece && (!source?.visual || !source.placement)) return "";
  const p = piece?.placement || resolveSourceMaterialPlacement(source);
  const roughId = source.roughId || item.sourceRoughId || item.id;
  const seed = source.openingSeed || source.visual?.openingSeed || source.visual?.seed || roughId;
  const key = JSON.stringify([roughId, seed, source.visual, source.qualityKey || item.qualityKey, source.quality || item.quality, source.color || item.color]);
  let stone = piece ? { ...piece.material, id: `${piece.material.id}:piece:${piece.signature}` } : stoneCache.get(key);
  if (!stone) {
    stone = buildOpeningStone({ seed: `${roughId}:${seed}`, roughId, qualityKey: source.qualityKey || item.qualityKey,
      quality: source.quality || item.quality, color: source.color || item.color });
    stoneCache.set(key, stone);
    if (stoneCache.size > 32) stoneCache.delete(stoneCache.keys().next().value);
  }
  const percent = Number(p.x) <= 100 && Number(p.y) <= 100 && !p.svgSpace;
  const svg = renderJadeOpeningProductSvg(stone, piece ? { ...piece.kit, uid: piece.id } : {
    tpl: geometry.tplId, uid: item.id || "preview", x: Number(p.x) * (percent ? 6 : 1), y: Number(p.y) * (percent ? 6 : 1),
    rot: Number(p.rot ?? p.rotation) || 0, scale: Number(p.scale) || 1
  }, { idPrefix: `${id}-material`, surfaceOnly: true, shape: geometry.shape });
  return `<g class="craft-source-material" data-jade-source="${escape(piece?.roughId || source.roughId || "original")}" data-jade-piece="${escape(piece?.id || item.id)}" data-material-signature="${escape(piece?.signature || "legacy")}">${svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>$/, "")}</g>`;
}

function relief(kind, id) {
  const shadow = `fill="none" stroke="#163f32" stroke-opacity=".28" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"`;
  const lit = `fill="none" stroke="url(#${id}-relief)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"`;
  if (kind === "leafPendant" || kind === "fuBeanPendant") return `<g class="craft-carved-relief" data-jade-relief="leaf">
    ${path("M0,-91 C7,-20 5,52 0,94", shadow)}
    ${path("M-3,-89 C0,-29 -1,54 -3,92 M0,-43 C-26,-62 -29,-51 -37,-37 M1,-9 C-29,-28 -40,-9 -44,8 M1,29 C-23,13 -31,33 -35,48 M4,-44 C30,-58 30,-39 39,-24 M5,-7 C31,-18 39,4 41,19 M4,31 C29,20 28,45 29,58", lit)}
    ${path("M-3,-38 C-18,-42 -30,-29 -37,-15 M-2,0 C-22,-4 -32,13 -36,27 M3,-29 C22,-35 32,-16 37,-4 M3,11 C24,8 31,27 32,38", shadow)}
  </g>`;
  if (kind === "gourdPendant") return `<g class="craft-carved-relief" data-jade-relief="gourd">${path("M-15,-74 C-38,-68 -33,-43 -18,-37 M-27,17 C-58,42 -40,73 -15,78 M-17,-18 Q0,-8 18,-18", lit)}${path("M-22,-23 Q0,-13 23,-23", shadow)}</g>`;
  if (kind === "guanyinPendant") return `<g class="craft-carved-relief" data-jade-relief="guanyin"><ellipse cx="0" cy="-70" rx="22" ry="29" fill="url(#${id}-volume)"/>${path("M-13,-73 Q-7,-78 -2,-73 M2,-73 Q7,-78 13,-73 M-7,-57 Q0,-52 7,-57 M-25,-29 Q0,-6 25,-29 M-19,-14 Q-35,32 -36,73 M19,-14 Q35,32 36,73 M-42,83 Q0,60 42,83", shadow)}${path("M-14,-94 Q0,-106 15,-94 M-17,1 Q-24,48 -28,65 M-34,87 Q0,74 34,87", lit)}</g>`;
  return "";
}

function jadeBody(item, geometry, id, polishId, original = false) {
  const { shape, unit, kind, nativeBounds } = geometry;
  const source = sourceMaterialMarkup(item, geometry, id);
  const piece = jadePieceFor(item);
  const water = piece ? Math.max(0, Math.min(1, Number(piece.material.grade.water) || 0)) : 1;
  // Finish changes the surface response within the original jade's water
  // grade. Coarse jade cannot acquire glass-like shine through polishing.
  const p = { ...POLISH[polishId], strength: POLISH[polishId].strength * (.35 + water * .65) };
  const outer = contourPath(geometry.points);
  const round = ["bracelet", "peacePendant"].includes(kind);
  const plaque = kind === "plaque";
  const painted = ["cabochon", "buddhaPendant"].includes(kind);
  const shine = plaque
    ? path("M-53,-70 Q-57,-73 -56,-55 L-56,53", `fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"`)
    : round ? `<ellipse cx="-12" cy="-10" rx="${geometry.tplId === "ping" ? 62 : 74}" ry="${geometry.tplId === "ping" ? 62 : 74}" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="90 430" transform="rotate(-45)"/>`
      : `<ellipse cx="${num(nativeBounds.minX * .36)}" cy="${num(nativeBounds.minY * .38)}" rx="${num((nativeBounds.maxX - nativeBounds.minX) * .105)}" ry="${num((nativeBounds.maxY - nativeBounds.minY) * .20)}" fill="#fff" transform="rotate(24)"/>`;
  return `<g class="craft-jade-main" data-jade-component-kind="${escape(kind)}" data-jade-polish="${polishId}">
    ${kind === "bracelet" ? `<g class="craft-jade-contact-shadow" fill="#143b2c" opacity=".14" transform="translate(0 .6) scale(${num(unit)})">${shape.replace("/>", ' fill-rule="evenodd"/>')}</g>` : path(outer, `class="craft-jade-contact-shadow" fill="#143b2c" opacity=".14" transform="translate(0 .6)"`)}
    <g transform="scale(${num(unit)})" mask="url(#${id}-drill-mask)">
      <g clip-path="url(#${id}-jade-clip)">
        <g fill="url(#${id}-jade)">${shape}</g>${source}
        ${original ? "" : painted ? paintedJadeArt(id, geometry, p.strength) : `<g opacity="${p.shadow}"><g fill="url(#${id}-volume)">${shape}</g></g>
        <g opacity="${polishId === "bright" ? .78 : polishId === "soft" ? .60 : .40}">${relief(kind, id)}</g>
        <g fill="url(#${id}-satin)" opacity="${p.soft}">${shape}</g>
        <g class="craft-polish-highlight" opacity="${p.strength}" filter="url(#${id}-polish-blur)">${shine}</g>`}
      </g>
      <g fill="none" stroke="rgba(22,72,52,.45)" stroke-width="${num(.38 / unit)}" fill-rule="evenodd">${shape}</g>
      <g fill="none" stroke="rgba(243,255,245,.48)" stroke-width="${num(.17 / unit)}" transform="scale(.987)" fill-rule="evenodd">${shape}</g>
    </g>
  </g>`;
}

function attachment(type, g, id, cord) {
  const top = g.top, w = g.width;
  const metal = `fill="none" stroke="url(#${id}-metal)" stroke-linecap="round" stroke-linejoin="round"`;
  if (cord) {
    if (type === "bracelet" && g.kind === "bracelet") return "";
    return `<g class="craft-cord" data-jewelry-setting="cord">${accessoryArt(id, "cordLoop", -5.5, top - 13, 11, 12.5)}</g>`;
  }
  // The wide painted shank sits behind the actual jade, not inside a baked
  // finished-product image. Its size follows the captured stone's geometry.
  if (type === "ring") return `<g class="craft-ring-layer" data-jewelry-layer="ring">${accessoryArt(id, "ring", -w * 1.075, -g.height * .30, w * 2.15, w * .80, 'class="craft-ring-shank"')}</g>`;
  if (type === "earring") {
    const hook = `M0,${top - 2} C-3,${top - 6} 1,${top - 7} 2,${top - 5} C4,${top - 10} 8,${top - 17} 3,${top - 19} C-2,${top - 21} -3,${top - 14} -2,${top - 12}`;
    return `<g class="craft-earring-layer" data-jewelry-layer="ring"><ellipse class="craft-attachment-link" cx="0" cy="${top - 1}" rx="1.2" ry="1.8" ${metal} stroke-width=".6"/>${path(hook, 'fill="none" stroke="#617367" stroke-width="1.15" stroke-linecap="round"')}${path(hook, `${metal} class="craft-ear-hook" stroke-width=".75"`)}</g>`;
  }
  if (type === "bangle") return "";
  return `<g class="craft-pendant-layer" data-jewelry-layer="ring">${accessoryArt(id, "link", -1.45, top - 2.5, 2.9, 3.9, 'class="craft-attachment-link"')}${accessoryArt(id, "bail", -2.6, top - 9.8, 5.2, 8.1, 'class="craft-bail"')}</g>`;
}

function settingMarkup(mount, g, halo, id) {
  if (!mount) return { back: "", front: "" };
  const setting = mount.settingId;
  if (setting === "micro") {
    // One continuous seat spans from the jade lip to the outer gemstone edge.
    // Separate base, front rim and halo frames produced offset silhouettes.
    const width = (halo?.diameter || 1.8) + .8;
    const track = offsetContour(g.points, width * .38 - .15);
    return { back: `<g class="craft-base-layer craft-micro-setting" data-jewelry-layer="base">${paintedMountFrame(id, g, track, width, "micro", 'class="craft-metal-seat"')}${mount.backingId === "closed" ? paintedBacking(id, g) : ""}</g>`, front: "" };
  }
  let back = `<g class="craft-base-layer" data-jewelry-layer="base">${paintedMountFrame(id, g, g.points, setting === "bezel" ? 1.5 : .85, "base", 'class="craft-metal-seat"')}${mount.backingId === "closed" ? paintedBacking(id, g) : ""}</g>`;
  let front = "";
  if (setting === "bezel") front = `<g class="craft-bezel-setting">${paintedMountFrame(id, g, g.points, 1.25, "bezel", 'class="craft-bezel craft-metal-rim"')}</g>`;
  else if (setting === "claw") {
    const samples = sampleClosedContour(g.points, 12);
    front = `<g class="craft-claw-setting">${[2, 4, 8, 10].map((n, i) => {
      const p = samples[n], prev = samples[(n + 11) % 12], next = samples[(n + 1) % 12];
      // The wide painted head grips the jade; the narrow foot faces outward.
      // Keep a broad, short silhouette readable in inventory thumbnails too.
      const angle = num(Math.atan2(next.y - prev.y, next.x - prev.x) * 180 / Math.PI + 180);
      return `<g class="craft-prong-foot" data-prong-index="${i}" transform="translate(${num(p.x)} ${num(p.y)}) rotate(${angle})">${accessoryArt(id, "prong", -1.2, -2.1, 2.4, 3.6, 'class="craft-prong"')}</g>`;
    }).join("")}</g>`;
  } else if (setting === "channel" && halo?.kind === "channel") {
    back += `<g class="craft-channel-galleries">${halo.channels.map((channel) => paintedRibbon(id, channel.points, halo.diameter + .7)).join("")}</g>`;
    front = `<g class="craft-channel-setting">${halo.stones.length ? "" : channelRailMarkup(halo, id)}</g>`;
  } else if (setting === "channel") {
    const centre = halo?.track || offsetContour(g.points, 1);
    front = `<g class="craft-channel-setting">${[-1, 1].map((s, i) => paintedMountFrame(id, g, offsetContour(centre, s * (halo ? halo.diameter / 2 + .17 : .45)), .55, `channel-${i}`, 'class="craft-channel-rail"')).join("")}</g>`;
  } else front = `<g class="craft-invisible-setting">${paintedMountFrame(id, g, g.points, .3, "invisible", 'class="craft-invisible-frame" opacity=".6"')}</g>`;
  if (halo?.track) back += `<g class="craft-halo-backing">${paintedMountFrame(id, g, halo.track, halo.diameter + .45, "halo")}</g>`;
  return { back, front: `<g data-jewelry-layer="claw-top">${front}</g>` };
}

function gemsMarkup(accent, layout, id, gems, mount) {
  if (!accent || !layout?.stones.length) return "";
  const gem = gems[accent.gemId] || gems.diamond;
  const r = layout.diameter / 2;
  const individualSeat = ["pair", "squarePair", "single"].includes(layout.kind);
  const face = r * (individualSeat ? .90 : .95);
  const square = layout.kind === "squarePair";
  const shape = (radius, attrs) => square
    ? `<rect x="${-radius}" y="${-radius}" width="${radius * 2}" height="${radius * 2}" rx=".13" ${attrs}/>`
    : `<circle r="${radius}" ${attrs}/>`;
  const at = (p, content, attrs = "") => `<g transform="translate(${num(p.x)} ${num(p.y)})" ${attrs}>${content}</g>`;
  const seats = layout.stones.map((p) => at(p, `
    ${p.side && ["pair", "squarePair"].includes(layout.kind) ? path(`M${-p.side * (r + .85)},${-r * .65} Q0,${-r - .4} ${p.side * (r + .25)},${-r * .65} L${p.side * (r + .25)},${r * .65} Q0,${r + .4} ${-p.side * (r + .85)},${r * .65} Z`, `fill="url(#${id}-metal)" stroke="url(#${id}-metal-line)" stroke-width=".12"`) : ""}
    ${shape(r + (individualSeat ? .22 : .08), `class="craft-stone-seat" fill="url(#${id}-metal-paint)" stroke="url(#${id}-metal-line)" stroke-width=".12"`)}
    ${shape(r + .015, 'class="craft-stone-socket" fill="#43504a" opacity=".48"')}
    ${individualSeat ? accessoryArt(id, square ? "squareSeat" : "roundSeat", -r - .25, -r - .25, (r + .25) * 2, (r + .25) * 2) : ""}
  `)).join("");
  const faces = layout.stones.map((p, i) => at(p, `
    ${shape(face, `fill="${gem.fill}"`)}
    ${gemstoneArt(id, square, -face, -face, face * 2, face * 2)}
  `, `class="craft-accent-stone" data-gem-index="${i}"`)).join("");
  const caps = layout.stones.map((p) => at(p, `
    ${shape(r * .96, `class="craft-stone-lip" fill="none" stroke="url(#${id}-metal)" stroke-width=".17"`)}
    ${mount?.settingId === "channel" && layout.kind === "channel" ? "" : square
      ? [-1, 1].map((side) => path(`M${side * r * .95},${-r * .65} V${r * .65}`, `fill="none" stroke="url(#${id}-metal)" stroke-width=".22"`)).join("")
      : (mount?.settingId === "micro" ? [Math.PI / 4, Math.PI * 1.25] : [Math.PI / 4, Math.PI * .75, Math.PI * 1.25, Math.PI * 1.75]).map((angle) => `<circle class="craft-stone-prong" cx="${num(Math.cos(angle) * r * .85)}" cy="${num(Math.sin(angle) * r * .85)}" r="${mount?.settingId === "micro" ? .13 : .17}" fill="url(#${id}-metal)" stroke="url(#${id}-metal-line)" stroke-width=".045"/>`).join("")}
  `)).join("");
  return `<g class="craft-accent-stones" data-jewelry-gem="${escape(accent.gemId)}" data-gem-count="${layout.stones.length}" data-gem-layout="${escape(accent.layout || "legacy")}" data-stone-arrangement="${layout.kind || "legacyHalo"}">
    <g data-assembly-layer="gem-seats">${layout.kind === "channel" ? layout.channels.map((channel) => paintedRibbon(id, channel.points, 1.9, { attrs: 'opacity=".48"' })).join("") : ""}${seats}</g>
    <g data-assembly-layer="gem-faces">${faces}</g>
    <g data-assembly-layer="gem-fasteners">${caps}${layout.kind === "channel" ? channelRailMarkup(layout, id) : ""}</g>
  </g>`;
}

export function renderFinishedProduct(item, size, palettes, options = {}) {
  const piece = jadePieceFor(item);
  const bangle = isBangle(item);
  const bare = bangle || options.viewMode === "original" || options.viewMode === "jade";
  const original = options.viewMode === "original";
  const mount = bare ? null : item.components?.find((c) => c.type === "mount");
  const cord = bare ? null : item.components?.find((c) => c.type === "cord");
  const jade = item.components?.find((c) => c.type === "jade");
  const accent = bare ? null : item.components?.find((c) => c.type === "accentStones");
  const type = bangle ? "bangle" : item.productType || mount?.productType || cord?.productType || "pendant";
  const g = finishedJadeGeometry(item);
  const paintedBody = !original && ["cabochon", "buddhaPendant"].includes(g.kind);
  const id = `finished-${++instance}`;
  const metal = palettes.metals[mount?.metalId] || palettes.metals.gold18k;
  const requestedPolish = (bangle ? bangleFinishRecord(item)?.polishId : null) || item.inlay?.polishId || jade?.polishId || cord?.polishId;
  const polishId = POLISH[requestedPolish] ? requestedPolish : "bright";
  const polish = POLISH[polishId];
  const pal = piece?.material.palList[0]?.pal || openingPaletteForColor(item.color || jade?.sourceMaterial?.color);
  const visual = jade?.sourceMaterial?.visual || item.sourceMaterial?.visual || {};
  const base = pal?.base || visual.vein || "#469d78";
  const currentDesign = item.inlay?.gemLayout === SETTING_GEMS || accent?.layout === SETTING_GEMS;
  let halo = currentDesign && !bare ? settingGemLayout(item, { settingId: mount?.settingId || cord?.settingId, productType: type, gemId: accent?.gemId }) : null;
  if (!currentDesign && accent?.count > 0 && mount) {
    const generated = fullHaloLayout(item);
    const count = Math.min(256, Math.max(0, Math.round(accent.count)));
    halo = { ...generated, stones: count === generated.count ? generated.stones : sampleClosedContour(generated.track, count) };
  } else if (!currentDesign && accent?.count > 0 && cord) {
    // Historic cord items keep the stones they already consumed. New cord
    // drafts have no stone seats and are normalized to zero on both sides.
    halo = { diameter: 1.4, stones: Array.from({ length: Math.min(12, Math.round(accent.count)) }, (_, i) => ({
      x: (i % 2 ? 1 : -1) * (2.4 + Math.floor(i / 2) * 1.1), y: g.top - 5 - Math.floor(i / 2) * 1.4
    })) };
  }
  const setting = settingMarkup(mount, g, mount ? halo : null, id);
  const zoom = Math.min(1.6, 83 / (type === "ring" && !bare ? g.width * 2.15 + 4 : g.width + 10), 78 / (g.height + 6));
  // Centre the original outline, including asymmetric cuts, in the preview.
  // Keep source material coordinates intact; only the display frame moves.
  const centerX = bare ? 60 - (g.nativeBounds.minX + g.nativeBounds.maxX) * g.unit * zoom / 2 : 60;
  const centerY = bare ? 60 - (g.top + g.bottom) * zoom / 2 : 67;
  const shadowY = bare ? 60 + g.height * zoom / 2 + 5 : 109;
  // Captured pieces keep their original holes. A cord wraps the existing edge
  // (or passes through the original peace-buckle centre), without drilling.
  const hole = !piece && cord && type !== "bracelet" ? { x: 0, y: (g.top + 2.4) / g.unit, r: .85 / g.unit } : null;
  return `<div class="component-jewelry-product ${escape(size)}" role="img" aria-label="${escape(item.name || "翡翠成品")}" data-jade-piece="${escape(piece?.id || item.id)}" data-material-signature="${escape(piece?.signature || "legacy")}" data-jade-view="${escape(options.viewMode || "finished")}" data-jewelry-style="craft-layer" data-jewelry-detail="jade-craft-finished" data-jewelry-art="${bare && !paintedBody ? "source-jade" : "handpainted-v2"}" data-jewelry-product-type="${escape(type)}" data-jewelry-metal="${escape(mount?.metalId || "")}" data-jewelry-setting="${escape(mount?.settingId || cord?.settingId || "")}" data-jewelry-gem="${escape(accent?.gemId || "")}" data-jewelry-polish="${polishId}">
    <svg class="component-jewelry-svg" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        ${bare ? "" : inlayArtworkDefs(id, mount?.metalId, accent?.gemId)}
        ${paintedBody || !bare ? jadeAndMountArtworkDefs(id, { kind: g.kind, metalId: mount?.metalId, mounts: !bare, jade: paintedBody }) : ""}
        <linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${metal.light}"/><stop offset=".55" stop-color="${metal.mid}"/><stop offset="1" stop-color="${metal.dark}"/></linearGradient>
        <linearGradient id="${id}-metal-line"><stop stop-color="${metal.line}"/><stop offset="1" stop-color="${metal.dark}"/></linearGradient>
        <radialGradient id="${id}-jade" cx=".3" cy=".2" r=".85"><stop stop-color="${pal?.base || "#b5dac5"}"/><stop offset=".57" stop-color="${base}"/><stop offset="1" stop-color="${pal?.vein || "#28654f"}"/></radialGradient>
        <radialGradient id="${id}-volume" cx=".32" cy=".24" r=".8"><stop stop-color="#edffed" stop-opacity=".44"/><stop offset=".42" stop-color="#ecffe9" stop-opacity="0"/><stop offset="1" stop-color="#103f2c" stop-opacity=".5"/></radialGradient>
        <linearGradient id="${id}-relief" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f3fff3" stop-opacity=".8"/><stop offset="1" stop-color="#d5f8dd" stop-opacity=".08"/></linearGradient>
        <radialGradient id="${id}-satin" cx=".3" cy=".2" r=".75"><stop stop-color="#fff"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#102c20" stop-opacity=".5"/></radialGradient>
        <filter id="${id}-polish-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${polish.blur}"/></filter>
        <clipPath id="${id}-jade-clip">${g.shape.replace("/>", ' fill-rule="evenodd" clip-rule="evenodd"/>')}</clipPath>
        <mask id="${id}-drill-mask" maskUnits="userSpaceOnUse" x="-250" y="-250" width="500" height="500"><rect x="-250" y="-250" width="500" height="500" fill="#fff"/>${hole ? `<circle cx="${hole.x}" cy="${hole.y}" r="${hole.r}" fill="#000"/>` : ""}</mask>
      </defs>
      <ellipse cx="60" cy="${num(shadowY)}" rx="${num(Math.min(37, g.width * zoom * .53))}" ry="2.4" fill="#294a39" opacity=".12"/>
      <g data-product-layer="presentation" transform="translate(${num(centerX)} ${num(centerY)}) scale(${zoom})">
        <g data-product-layer="assembly-back">${bare ? "" : attachment(type, g, id, cord)}${setting.back}</g>
        <g data-product-layer="jade">${jadeBody(item, g, id, polishId, original)}</g>
        <g data-product-layer="assembly-front">${setting.front}${gemsMarkup(accent, halo, id, palettes.gems, mount)}
          ${cord && g.kind !== "bracelet" ? accessoryArt(id, "cordKnot", -2.7, g.top - 4, 5.4, 6.1, 'class="craft-cord-knot"') : ""}
          ${piece && cord && g.kind !== "bracelet" ? path(`M-1.5,${g.top - 3} Q-3,${g.top + 1} 0,${g.top + 1.2} Q3,${g.top + 1} 1.5,${g.top - 3}`, 'class="craft-cord-wrap" fill="none" stroke="#45624b" stroke-width="1.1"') : ""}
          ${hole ? `<circle class="craft-drill-rim" cx="0" cy="${num(hole.y * g.unit)}" r="1" fill="none" stroke="#416a52" stroke-width=".25"/>${path(`M0,${g.top - 3} L0,${g.top + 2.3}`, 'class="craft-woven-strand" stroke="#304c3d" stroke-width="1.25" stroke-linecap="round"')}` : ""}
        </g>
      </g>
    </svg>
  </div>`;
}
