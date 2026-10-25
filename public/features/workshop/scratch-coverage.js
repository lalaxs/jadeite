// A small occupancy grid counts unique erased area inside the actual stone.
export const SCRATCH_BRUSH_RADIUS = .048;

export class ScratchCoverage {
  constructor(mask, size = 160, saved = "") {
    this.mask = mask;
    this.size = size;
    this.erased = new Uint8Array(mask.length);
    this.total = mask.reduce((sum, value) => sum + Boolean(value), 0);
    this.count = 0;
    try {
      const bytes = atob(saved);
      if (bytes.length === Math.ceil(mask.length / 8)) {
        for (let i = 0; i < mask.length; i++) {
          if (mask[i] && (bytes.charCodeAt(i >> 3) & (1 << (i & 7)))) {
            this.erased[i] = 1;
            this.count++;
          }
        }
      }
    } catch { /* Corrupt/blocked local storage must never block revealing. */ }
  }

  get ratio() { return this.total ? this.count / this.total : 0; }

  erase(from, to, radius = SCRATCH_BRUSH_RADIUS, onErase = null) {
    const size = this.size;
    const ax = from.x * size, ay = from.y * size, bx = to.x * size, by = to.y * size;
    const r = radius * size, dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + r));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by) + r));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const i = y * size + x;
      if (!this.mask[i] || this.erased[i]) continue;
      const t = length2 ? Math.max(0, Math.min(1, ((x + .5 - ax) * dx + (y + .5 - ay) * dy) / length2)) : 0;
      if ((x + .5 - ax - t * dx) ** 2 + (y + .5 - ay - t * dy) ** 2 <= r * r) {
        this.erased[i] = 1;
        this.count++;
        onErase?.(i);
      }
    }
    return this.ratio;
  }

  serialize() {
    const bytes = new Uint8Array(Math.ceil(this.mask.length / 8));
    for (let i = 0; i < this.erased.length; i++) if (this.erased[i]) bytes[i >> 3] |= 1 << (i & 7);
    return btoa(String.fromCharCode(...bytes));
  }
}
