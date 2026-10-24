// SVG outlines used by stone generation contain absolute M/C/Z commands only.
export function sampleCubicOutline(path, steps = 16) {
  const numbers = String(path).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
  const points = [[numbers[0], numbers[1]]];
  let [x, y] = points[0];
  for (let index = 2; index + 5 < numbers.length; index += 6) {
    const [ax, ay, bx, by, endX, endY] = numbers.slice(index, index + 6);
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const u = 1 - t;
      points.push([u ** 3 * x + 3 * u ** 2 * t * ax + 3 * u * t ** 2 * bx + t ** 3 * endX,
        u ** 3 * y + 3 * u ** 2 * t * ay + 3 * u * t ** 2 * by + t ** 3 * endY]);
    }
    x = endX; y = endY;
  }
  return points;
}

export function pointInOutline(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function segmentDistance(x, y, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

export function distanceToOutline(x, y, polygon) {
  let result = Infinity;
  for (let i = 0; i < polygon.length; i += 1) result = Math.min(result, segmentDistance(x, y, polygon[i], polygon[(i + 1) % polygon.length]));
  return result;
}

export function transformOutline(polygon, kit) {
  const angle = (kit.rot || 0) * Math.PI / 180;
  const cos = Math.cos(angle); const sin = Math.sin(angle);
  return polygon.map(([x, y]) => [kit.x + (x * cos - y * sin) * kit.scale, kit.y + (x * sin + y * cos) * kit.scale]);
}

export function outlineArea(polygon) {
  return Math.abs(polygon.reduce((sum, a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0)) / 2;
}

const boundsCache = new WeakMap();
function boundsFor(polygon) {
  if (!boundsCache.has(polygon)) boundsCache.set(polygon, {
    left: Math.min(...polygon.map((p) => p[0])), right: Math.max(...polygon.map((p) => p[0])),
    top: Math.min(...polygon.map((p) => p[1])), bottom: Math.max(...polygon.map((p) => p[1]))
  });
  return boundsCache.get(polygon);
}

export function outlinesSeparated(a, b, gap = 0) {
  const boxA = boundsFor(a); const boxB = boundsFor(b);
  if (boxA.right + gap < boxB.left || boxB.right + gap < boxA.left || boxA.bottom + gap < boxB.top || boxB.bottom + gap < boxA.top) return true;
  if (a.some(([x, y]) => pointInOutline(x, y, b) || distanceToOutline(x, y, b) <= gap)
    || b.some(([x, y]) => pointInOutline(x, y, a) || distanceToOutline(x, y, a) <= gap)) return false;
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      const p = a[i]; const q = a[(i + 1) % a.length];
      const r = b[j]; const s = b[(j + 1) % b.length];
      if (side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0) return false;
    }
  }
  return true;
}
