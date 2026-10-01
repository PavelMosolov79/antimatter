import { hash2 } from '../../sim/rng';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Ordered-dither threshold for a pixel, 0..1 — the same 4×4 matrix everywhere, so every picture dithers alike. */
export const bayer = (x: number, y: number): number => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

export type RGB = [number, number, number];
export const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
export const mul = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Value noise whose lattice wraps with period P — a texture built from it has no seams. */
export function tnoise(x: number, y: number, P: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = mod(xi, P);
  const x1 = (x0 + 1) % P;
  const y0 = mod(yi, P);
  const y1 = (y0 + 1) % P;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Fractal tiling noise over the unit square: u and v in [0, 1) wrap around. */
export function tfbm(u: number, v: number, P: number, seed: number, octaves: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * tnoise(u * P * f, v * P * f, P * f, seed + o * 17);
    norm += amp;
    f *= 2;
    amp *= 0.5;
  }
  return s / norm;
}

const h3 = (x: number, y: number, z: number, s: number): number => hash2(x + z * 5039, y + z * 7919, s);
/** 3D value noise: sampled on a sphere it gives a planet's surface with no pole pinching or seam. */
export function vn3(x: number, y: number, z: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const a = h3(xi, yi, zi, s);
  const b = h3(xi + 1, yi, zi, s);
  const c = h3(xi, yi + 1, zi, s);
  const d = h3(xi + 1, yi + 1, zi, s);
  const e = h3(xi, yi, zi + 1, s);
  const f = h3(xi + 1, yi, zi + 1, s);
  const g = h3(xi, yi + 1, zi + 1, s);
  const h = h3(xi + 1, yi + 1, zi + 1, s);
  const p = a + (b - a) * u;
  const q = c + (d - c) * u;
  const r = e + (f - e) * u;
  const t = g + (h - g) * u;
  const y1 = p + (q - p) * v;
  const y2 = r + (t - r) * v;
  return y1 + (y2 - y1) * w;
}
export function fbm3(x: number, y: number, z: number, s: number, octaves: number): number {
  let t = 0;
  let amp = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < octaves; i++) {
    t += amp * vn3(x * f, y * f, z * f, s + i * 13);
    n += amp;
    f *= 2.02;
    amp *= 0.5;
  }
  return t / n;
}

/** The ramp step a value falls on, with dither between steps; null below the first. */
export function rampPick(ramp: RGB[], v: number, x: number, y: number): RGB | null {
  const i = Math.floor(v * ramp.length + bayer(x, y) - 0.5);
  return i < 0 ? null : ramp[Math.min(ramp.length - 1, i)];
}

/** Light comes from the upper left, as on the ships. */
export const LIGHT = [-0.55, -0.6, 0.58] as const;
