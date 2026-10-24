import { offsetContour, contourPath, sampleClosedContour } from "../shared/domain/workshop/finished-product-design.js";
import { accessoryArt } from "./inlay-artwork.js";

const n = (v) => Number(v.toFixed(4));

// Place painted ribbon pieces, rather than stroking a path with a flat texture.
// Layout still follows the exact captured outline and physical gemstone slots.
export function paintedRibbon(id, points, width, { closed = false, attrs = "" } = {}) {
  if (points.length < 2) return "";
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i-1].x, points[i].y - points[i-1].y);
  if (closed) length += Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y);
  const track = closed ? sampleClosedContour(points, Math.max(20, Math.min(240, Math.ceil(length / .5)))) : points;
  const count = closed ? track.length : track.length - 1;
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const a = track[i], b = track[(i + 1) % track.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < .001) continue;
    const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    pieces.push(`<g transform="translate(${n(a.x)} ${n(a.y)}) rotate(${n(angle)})">${accessoryArt(id, closed ? "rimProfile" : "rim", -width * .15, -width / 2, d + width * .3, width)}</g>`);
  }
  return `<g data-mount-art="painted-ribbon" ${attrs}>${pieces.join("")}</g>`;
}

/** Fit one painted edge to the real stone. The oval uses its full frame;
 * carved outlines bend the painted profile along the exact captured contour. */
export function paintedMountFrame(id, geometry, points, width, tag, attrs = "") {
  const outer = offsetContour(points, width * .62), inner = offsetContour(points, -width * .38);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs) - width * .65, y = Math.min(...ys) - width * .65;
  const w = Math.max(...xs) - x + width * .65, h = Math.max(...ys) - y + width * .65;
  const part = geometry.kind === "cabochon" ? "ovalFrame" : null;
  const mask = `${id}-painted-frame-${tag}`;
  return `<g data-mount-art="${part || "contour-frame"}" ${attrs}>
    <defs><mask id="${mask}" maskUnits="userSpaceOnUse" x="${n(x - 2)}" y="${n(y - 2)}" width="${n(w + 4)}" height="${n(h + 4)}"><path d="${contourPath(outer)}" fill="#fff"/><path d="${contourPath(inner)}" fill="#000"/></mask></defs>
    <g mask="url(#${mask})">${part ? accessoryArt(id, part, x, y, w, h) : paintedRibbon(id, points, width, { closed: true })}</g>
  </g>`;
}

export function paintedBacking(id, geometry) {
  const x = Math.min(...geometry.points.map((p) => p.x)), y = geometry.top;
  return `<g class="craft-closed-backing" opacity=".8"><defs><clipPath id="${id}-closed-art-clip"><path d="${contourPath(geometry.points)}"/></clipPath></defs><g clip-path="url(#${id}-closed-art-clip)">${accessoryArt(id, "texture", x, y, geometry.width, geometry.height)}</g>${accessoryArt(id, "rim", x + geometry.width * .16, geometry.bottom - .1, geometry.width * .68, .9, 'class="craft-closed-base-plate"')}</g>`;
}
