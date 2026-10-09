// Pixel masks for the icon renderers, with no Three.js, so Node tests can check them. render.ts rings chassis portraits
// and stripes them by rank, and blueprint.ts keeps inner lines clear of the outline.

export type Pixels = { w: number; h: number; data: Uint8ClampedArray };
export type Mask = { w: number; h: number; bits: Uint8Array };
export type Bounds = { x0: number; y0: number; x1: number; y1: number };
export type Rgba = readonly [number, number, number, number];

export function emptyMask(w: number, h: number): Mask {
  return { w, h, bits: new Uint8Array(w * h) };
}

export function solidMask({ w, h, data }: Pixels): Mask {
  const mask = emptyMask(w, h);
  for (let i = 0; i < w * h; i++) mask.bits[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return mask;
}

export function edgeBand(solid: Mask, half: number): Mask {
  const on = (x: number, y: number): boolean => isOn(solid, x, y);
  const edge = maskWhere(solid, (x, y) => on(x, y) && !(on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1)));
  return thicken(edge, half);
}

export function thicken(mask: Mask, half: number): Mask {
  return grow(mask, discOf(half));
}

function grow(mask: Mask, offsets: readonly (readonly [number, number])[]): Mask {
  const out = emptyMask(mask.w, mask.h);
  eachOn(mask, (x, y) => {
    for (const [dx, dy] of offsets) {
      const i = indexAt(out, x + dx, y + dy);
      if (i >= 0) out.bits[i] = 1;
    }
  });
  return out;
}

function discOf(half: number): [number, number][] {
  const r = Math.floor(half);
  const out: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= half * half) out.push([dx, dy]);
  return out;
}

function indexAt({ w, h }: Mask, x: number, y: number): number {
  return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1;
}

function isOn(mask: Mask, x: number, y: number): boolean {
  const i = indexAt(mask, x, y);
  return i >= 0 && mask.bits[i] === 1;
}

function maskWhere(like: Mask, test: (x: number, y: number) => boolean): Mask {
  const out = emptyMask(like.w, like.h);
  for (let y = 0; y < like.h; y++) for (let x = 0; x < like.w; x++) out.bits[y * like.w + x] = test(x, y) ? 1 : 0;
  return out;
}

function eachOn(mask: Mask, visit: (x: number, y: number) => void): void {
  for (let i = 0; i < mask.bits.length; i++) if (mask.bits[i]) visit(i % mask.w, Math.floor(i / mask.w));
}

export function boundsOf({ w, h, bits }: Mask): Bounds {
  let [x0, y0, x1, y1] = [w, h, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (bits[y * w + x]) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
  }
  if (x1 <= x0) throw new Error('The mask is empty');
  return { x0, y0, x1, y1 };
}

export function stripes(solid: Mask, box: Bounds, count: number, width: number): Mask {
  const { w, h } = solid;
  const out = emptyMask(w, h);
  const from = box.x0 + box.y0;
  const span = box.x1 + box.y1 - from;
  const at = Array.from({ length: count }, (_, k) => from + (span * (k + 1)) / (count + 1));
  const half = (width * Math.SQRT2) / 2;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = y * w + x;
      if (solid.bits[i] && at.some((d) => Math.abs(x + y - d) <= half)) out.bits[i] = 1;
    }
  }
  return out;
}
