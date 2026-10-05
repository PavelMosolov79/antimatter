import type { Celestial } from '../../sim/gravity';
import { hash2 } from '../../sim/rng';
import { PULSAR, pulsarAngle, stormBolt } from '../../sim/space';
import { bayer, hex, mix, mul, rampPick, type RGB } from './noise';
import type { Picture } from './planetGen';

/**
 * The pulsar, the ion storm, the comet and the jump gate, ported from the approved drawings in «Космос Antimatter».
 * The drawings are made in "design pixels" (the pulsar's beams 64 long, the storm 46 by 27, the gate 24 across); here
 * every design pixel is `k` pixels of the picture and a picture pixel is `texel` cells of the world, so the same drawing
 * serves at any size, and the dither still falls on whole picture pixels.
 */

function newPicture(w: number, h: number, texel: number, into?: Picture): Picture {
  if (into) {
    into.data.fill(0);
    return into;
  }
  return { w, h, data: new Uint8ClampedArray(w * h * 4), texel };
}

function putPx(p: Picture, x: number, y: number, c: RGB): void {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const o = (y * p.w + x) * 4;
  p.data[o] = c[0];
  p.data[o + 1] = c[1];
  p.data[o + 2] = c[2];
  p.data[o + 3] = 255;
}

function lineP(p: Picture, x0: number, y0: number, x1: number, y1: number, c: RGB, width = 1): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let n = 0;
  for (;;) {
    for (let a = 0; a < width; a++) for (let b = 0; b < width; b++) putPx(p, x0 + a, y0 + b, c);
    if ((x0 === x1 && y0 === y1) || ++n > 2000) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function vn(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x: number, y: number, seed: number, oct: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * vn(x * f, y * f, seed + o * 17);
    norm += amp;
    f *= 2;
    amp *= 0.5;
  }
  return s / norm;
}

// ------------------------------------------------------------------ pulsar

const PULS = [0x1c4a7a, 0x59e6ff, 0xd8f6ff, 0xffffff].map(hex);

/** Cells to the picture pixel of the pulsar, and the picture's size. */
export function pulsarSize(): { texel: number; size: number; k: number } {
  const texel = 10;
  const L = PULSAR.beamLength / texel;
  return { texel, size: Math.ceil(2 * (L + 4)), k: L / 64 };
}

/** The pulsar at time t of the world: a neutron star and two beams that turn with it, and a ring that rolls out once a sweep. */
export function renderPulsar(c: Celestial, t: number, into?: Picture): Picture {
  const { texel, size, k } = pulsarSize();
  const pic = newPicture(size, size, texel, into);
  const cx = size / 2;
  const cy = size / 2;
  const th = pulsarAngle(c, t);
  const dx0 = Math.cos(th);
  const dy0 = Math.sin(th);
  const L = 64;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5 - cx) / k;
      const py = (y + 0.5 - cy) / k;
      const r = Math.hypot(px, py);
      if (r > L + 2) continue;
      let col: RGB | null = null;
      for (let s = -1; s <= 1; s += 2) {
        const along = (px * dx0 + py * dy0) * s;
        const perp = Math.abs(px * dy0 - py * dx0);
        if (along > 2.5 && along < L) {
          const w = 1.0 + along * 0.055;
          const f = (1 - perp / w) * (1 - along / L);
          if (f > 0) {
            const cc = rampPick(PULS, f * 1.4, x, y);
            if (cc) col = cc;
          }
        }
      }
      if (r < 2.6) col = r < 1.3 ? [255, 255, 255] : hex(0xcfeaff);
      else if (!col && r < 9) {
        const h = rampPick(PULS, (1 - r / 9) * 0.55, x, y);
        if (h) col = mul(h, 0.8);
      }
      if (col) putPx(pic, x, y, col);
    }
  }
  // a faint ring rolls out once per sweep (half a turn)
  const kk = ((th / Math.PI) % 1 + 1) % 1;
  const rr = (2 + kk * (L - 6)) * k;
  for (let a = 0; a < 240; a++) {
    const ang = (a / 240) * 6.2832;
    const rx = cx + Math.cos(ang) * rr;
    const ry = cy + Math.sin(ang) * rr;
    if (bayer(Math.floor(rx), Math.floor(ry)) > kk * 0.9 + 0.05) putPx(pic, rx, ry, hex(0x2a6a9a));
  }
  return pic;
}

// ------------------------------------------------------------------ ion storm

const STORM_RAMP = [0x1a1040, 0x33227a, 0x5b45d0, 0x9a8cff, 0xdcd6ff].map(hex);

/** The storm at time t of the world: a cloud of purple swirls lit from inside when the lightning strikes. */
export function renderStorm(c: Celestial, t: number, into?: Picture): Picture {
  const rxCells = c.radius;
  const ryCells = c.ry ?? c.radius;
  const texel = Math.max(6, rxCells / 90);
  const rx = rxCells / texel;
  const ry = ryCells / texel;
  const k = rx / 46;
  const W = Math.ceil(2 * rx) + 4;
  const H = Math.ceil(2 * ry) + 4;
  const pic = newPicture(W, H, texel, into);
  const cx = W / 2;
  const cy = H / 2;
  const bolt = stormBolt(c, t);
  const flash = bolt.on && bolt.phase < 0.07 ? 1 - bolt.phase / 0.07 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const m = 1 - (nx * nx + ny * ny);
      if (m <= 0) continue;
      const n = fbm2((x / k) * 0.055 + t * 0.18, (y / k) * 0.07 - t * 0.1, 17, 3);
      const v = m * (0.35 + 0.95 * n) + flash * 0.22 * m;
      const li = Math.floor(v * 4.2 + bayer(x, y) - 0.5);
      if (li < 0) continue;
      putPx(pic, x, y, STORM_RAMP[Math.min(4, li)]);
    }
  }
  if (flash > 0) {
    const b = bolt.index;
    const sx = cx + (hash2(b, 1, 2) - 0.5) * rx * 0.8;
    const sy = cy - ry * 0.85;
    const ex = sx + (hash2(b, 2, 2) - 0.5) * 30 * k;
    const ey = cy + ry * 0.85;
    let px = sx;
    let py = sy;
    const segs = 7;
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const nx2 = sx + (ex - sx) * f + (i < segs ? (hash2(b, i, 3) - 0.5) * 11 * k : 0);
      const ny2 = sy + (ey - sy) * f;
      lineP(pic, px, py, nx2, ny2, [235, 245, 255], Math.max(1, Math.round(k * 0.8)));
      if (hash2(b, i, 4) < 0.4) lineP(pic, nx2, ny2, nx2 + (hash2(b, i, 5) - 0.5) * 22 * k, ny2 + (8 + hash2(b, i, 6) * 8) * k, [170, 205, 255], Math.max(1, Math.round(k * 0.5)));
      px = nx2;
      py = ny2;
    }
  }
  return pic;
}

// ------------------------------------------------------------------ comet

/** The comet's drawing: head at the middle of the picture, an ion tail straight and blue and a dust tail wider, warmer and bent, both pointing along `tail` (a unit vector). */
export function renderComet(c: Celestial): Picture {
  const speed = Math.hypot(c.vx ?? 1, c.vy ?? 0) || 1;
  const tx = -(c.vx ?? 1) / speed;
  const ty = -(c.vy ?? 0) / speed;
  const texel = 8;
  const k = 2.4; // picture pixels to a design pixel
  const reach = Math.ceil(70 * k);
  const W = reach * 2 + 8;
  const pic = newPicture(W, W, texel);
  const hx = W / 2;
  const hy = W / 2;
  // ion tail
  for (let s = 0; s < 62; s += 0.35) {
    const w = 0.4 + s * 0.045;
    for (let j = 0; j < 4; j++) {
      const off = (hash2(Math.floor(s * 10), j, 5) - 0.5) * 2 * w;
      const x = hx + (tx * s - ty * off) * k;
      const y = hy + (ty * s + tx * off) * k;
      const f = (1 - s / 62) * (1 - (Math.abs(off) / w) * 0.6);
      if (f > bayer(Math.floor(x), Math.floor(y))) putPx(pic, x, y, mix([200, 240, 255], [40, 110, 220], s / 62));
    }
  }
  // dust tail
  for (let s = 0; s < 48; s += 0.4) {
    const curve = s * s * 0.012;
    const w = 1 + s * 0.12;
    for (let j = 0; j < 4; j++) {
      const off = (hash2(Math.floor(s * 10), j, 8) - 0.5) * 2 * w + curve;
      const x = hx + (tx * s * 0.92 - ty * off) * k;
      const y = hy + (ty * s * 0.92 + tx * off) * k;
      const f = (1 - s / 48) * 0.75;
      if (f > bayer(Math.floor(x), Math.floor(y))) putPx(pic, x, y, mix([255, 235, 190], [150, 110, 70], s / 48));
    }
  }
  // head
  const ramp = [0x2a4a6a, 0x59e6ff, 0xc8f2ff].map(hex);
  const R = Math.round(7 * k);
  for (let yy = -R; yy <= R; yy++) {
    for (let xx = -R; xx <= R; xx++) {
      const d = Math.hypot(xx, yy) / k;
      if (d < 1.7) putPx(pic, hx + xx, hy + yy, [255, 255, 255]);
      else if (d < 7) {
        const cc = rampPick(ramp, (1 - d / 7) * 0.95, Math.floor(hx + xx), Math.floor(hy + yy));
        if (cc) putPx(pic, hx + xx, hy + yy, cc);
      }
    }
  }
  return pic;
}

// ------------------------------------------------------------------ gate

const PORTAL = [0x0b1030, 0x1d3f8a, 0x59e6ff, 0xc8a8ff, 0xffffff].map(hex);

/** The jump gate at time t: a ring of eight pylons with chasing lights round a turning portal. */
export function renderGate(c: Celestial, t: number, into?: Picture): Picture {
  const texel = 4;
  const Ro = c.radius / texel / (1 + 5 / 24);
  const k = Ro / 24;
  const Ri = 16 * k;
  const W = Math.ceil(2 * (Ro + 5 * k)) + 2;
  const pic = newPicture(W, W, texel, into);
  const cx = W / 2;
  const cy = W / 2;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cx) / k;
      const dy = (y + 0.5 - cy) / k;
      const r = Math.hypot(dx, dy);
      if (r > 24 + 5) continue;
      const ang = Math.atan2(dy, dx);
      let col: RGB | null = null;
      if (r < 16 - 0.4) {
        const rr = r / 16;
        const s = Math.sin(ang * 3 + rr * 9 - t * 3.2) * 0.5 + 0.5;
        const v = s * (0.5 + 0.5 * rr) + 0.18 * (1 - rr) + (rr < 0.15 ? 0.5 : 0);
        col = rampPick(PORTAL, v, x, y) ?? PORTAL[0];
      } else if (r < 24) {
        const lit = 0.55 + 0.6 * Math.max(0, Math.cos(ang + 2.3));
        col = mul(hex(0x8c96a8), lit);
        if (r < 16 + 1.0) col = mul(col, 1.2);
        else if (r > 24 - 1.4) col = mul(col, 0.62);
        if (r < 16 + 0.9 && r >= 16 - 0.4) {
          const p = 0.6 + 0.4 * Math.sin(t * 3);
          col = mix(col, hex(0x59e6ff), 0.55 * p);
        }
      }
      for (let n = 0; n < 8; n++) {
        const a0 = (n * Math.PI) / 4 + Math.PI / 8;
        const da = Math.abs(Math.atan2(Math.sin(ang - a0), Math.cos(ang - a0))) * r;
        if (r >= 24 - 3 && r < 24 + 4.5 && da < 2.6) {
          col = mul(hex(0x2a3144), 0.9 + 0.4 * Math.max(0, Math.cos(ang + 2.3)));
          if (r > 24 + 2.2 && r < 24 + 3.6 && da < 1.1) {
            const on = (t * 6) % 8 >= n && (t * 6) % 8 < n + 2;
            col = on ? hex(0x63e07a) : hex(0x1f5566);
          }
        }
      }
      if (col) putPx(pic, x, y, col);
    }
  }
  void Ri;
  return pic;
}
