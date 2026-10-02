import type { DriveType } from './grid';
import { hash2 } from './rng';

/**
 * The player's fighter, as approved in «Концепт обшивки» (panel «Новый истребитель»): the
 * battleship's look — wedge hull, panel seams, trench stripe, intake bays, bridge tower,
 * a cluster of turbofan nozzles — at fighter size (39×62 cells) and painted in blue steel.
 * Like the battleship's art it records for every pixel which part it belongs to, so
 * ships.ts builds the real grid under the same picture.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const hex = (h: number): Rgb => ({ r: (h >> 16) & 255, g: (h >> 8) & 255, b: h & 255 });
const mix = (c: Rgb, f: number): Rgb => ({ r: c.r * f, g: c.g * f, b: c.b * f });
const toWhite = (c: Rgb, a: number): Rgb => ({ r: c.r + (255 - c.r) * a, g: c.g + (255 - c.g) * a, b: c.b + (255 - c.b) * a });

export const FIGHTER_W = 39;
export const FIGHTER_H = 62;
const CX = 19.5;
const PROFILE: Array<[number, number]> = [
  [0, 0],
  [8, 3.5],
  [52, 16],
  [58, 17.5],
  [58.01, 7],
  [62, 6.5],
];

const C = {
  hull: hex(0x7a92c0),
  armor: hex(0x3a5896),
  wall: hex(0x3f5486),
  plate: hex(0x2c4a8c),
  stripe: hex(0x3aa0ff),
  hatch: hex(0x3a9ad8),
  turret: hex(0x4b6396),
  dome: hex(0x6aa0ff),
  core: hex(0xb43cff),
  thruster: hex(0x52d4ee),
  // The drive family, in the game's material colours (materials.ts).
  cruise: hex(0xd8423a),
  impulse: hex(0xf2cf3a),
  brake: hex(0xeef2f6),
  turn: hex(0xa362e8),
};

export interface FighterPart {
  /** Which part of the ship this is. */
  kind: 'turret' | 'engine' | 'pod';
  drive?: DriveType;
  /** The way a nozzle pushes the ship (x right, y toward the stern). */
  dirX?: number;
  dirY?: number;
  /** Turret class, by size. */
  heavy?: boolean;
  cells: Array<[number, number]>;
}

export interface FighterArt {
  w: number;
  h: number;
  mask: Uint8Array;
  /** Distance to the rim: 1 on the outermost cells. */
  dist: Uint8Array;
  /** RGB per cell, 3 floats. */
  color: Float32Array;
  glow: Uint8Array;
  /** 0 for plain hull, else index + 1 into `parts`. */
  part: Uint16Array;
  parts: FighterPart[];
}

function halfWidthAt(y: number): number {
  if (y <= PROFILE[0][0]) return PROFILE[0][1];
  for (let i = 1; i < PROFILE.length; i++) {
    const [y1, w1] = PROFILE[i];
    const [y0, w0] = PROFILE[i - 1];
    if (y <= y1) return y1 === y0 ? w1 : w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
  }
  return PROFILE[PROFILE.length - 1][1];
}

function edgeDistance(mask: Uint8Array, w: number, h: number): Uint8Array {
  const dist = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) {
      dist[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    const y = (i - x) / w;
    const d = dist[i] + 1;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (n >= 0 && mask[n] && dist[n] === 0) {
        dist[n] = Math.min(d, 255);
        queue.push(n);
      }
    }
  }
  return dist;
}

const d2 = (x: number, y: number, cx: number, cy: number): number => Math.hypot(x + 0.5 - cx, y + 0.5 - cy);

const PODS: Array<{ drive: DriveType; x: number; y: number; r: number; dx: number; dy: number }> = [
  { drive: 'brake', x: 17.5, y: 9, r: 1.25, dx: 0, dy: 1 },
  { drive: 'brake', x: 21.5, y: 9, r: 1.25, dx: 0, dy: 1 },
  { drive: 'turn', x: 16.5, y: 15, r: 1.25, dx: 1, dy: 0 },
  { drive: 'turn', x: 22.5, y: 15, r: 1.25, dx: -1, dy: 0 },
  { drive: 'maneuver', x: 11.5, y: 33, r: 1.3, dx: 1, dy: 0 },
  { drive: 'maneuver', x: 27.5, y: 33, r: 1.3, dx: -1, dy: 0 },
  { drive: 'maneuver', x: 9, y: 41, r: 1.3, dx: 1, dy: 0 },
  { drive: 'maneuver', x: 30, y: 41, r: 1.3, dx: -1, dy: 0 },
  { drive: 'turn', x: 7, y: 50, r: 1.3, dx: 1, dy: 0 },
  { drive: 'turn', x: 32, y: 50, r: 1.3, dx: -1, dy: 0 },
];

const NOZZLES: Array<{ x: number; y: number; r: number; drive: 'cruise' | 'impulse' }> = [
  { x: 19.5, y: 57.5, r: 5.4, drive: 'cruise' },
  { x: 9.5, y: 54.5, r: 3.6, drive: 'impulse' },
  { x: 29.5, y: 54.5, r: 3.6, drive: 'impulse' },
];

const TURRETS: Array<{ x: number; y: number; r: number; heavy: boolean }> = [
  { x: 13.5, y: 25, r: 1.6, heavy: false },
  { x: 25.5, y: 25, r: 1.6, heavy: false },
  { x: 19.5, y: 16, r: 2.3, heavy: true },
];

const SHADES = [0.8, 0.9, 0.98, 1.07, 1.16];
const SEAM_ROWS = [12, 22, 32, 42, 52];

function panelMix(base: Rgb, x: number, y: number): Rgb {
  const shade = SHADES[Math.floor(hash2(Math.floor(x / 4), Math.floor(y / 5), 7) * SHADES.length)] * (x % 4 === 0 || y % 5 === 0 ? 0.84 : 1);
  const h = hash2(x, y, 11);
  const fine = h < 0.03 ? 0.45 : h < 0.055 ? 1.35 : 1;
  let seam = 1;
  if (SEAM_ROWS.includes(y)) seam = x % 5 === 2 ? 0.64 : 0.86;
  return mix(base, shade * fine * seam);
}

export function buildFighterArt(): FighterArt {
  const W = FIGHTER_W;
  const H = FIGHTER_H;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const hw = halfWidthAt(y + 0.5);
    for (let x = 0; x < W; x++) if (Math.abs(x + 0.5 - CX) <= hw) mask[y * W + x] = 1;
  }
  const dist = edgeDistance(mask, W, H);
  const color = new Float32Array(W * H * 3);
  const glow = new Uint8Array(W * H);
  const part = new Uint16Array(W * H);
  const parts: FighterPart[] = [];

  const edgeDepth = (x: number, y: number): number => {
    const hw = halfWidthAt(y + 0.5);
    const cx = x + 0.5;
    return cx <= CX ? hw - (CX - cx) : hw - (cx - CX);
  };
  const inStripe = (x: number, y: number): boolean => {
    if (Math.abs(x + 0.5 - CX) <= 1 && y >= 8 && y <= 27) return true;
    const d = edgeDepth(x, y);
    return d >= 3 && d <= 4.4 && y >= 11 && y <= 55;
  };
  const intake = (x: number, y: number): boolean => {
    if (y < 26 || y > 37) return false;
    const d = edgeDepth(x, y);
    return d >= 1.5 && d <= 6;
  };
  const towerY0 = 34;
  const towerY1 = 50;
  const tower = (x: number, y: number): Rgb | null => {
    if (y < towerY0 || y > towerY1) return null;
    const half = 5.2 - (2.0 * Math.max(0, y - towerY0 - 9)) / (towerY1 - towerY0 - 9 || 1);
    if (Math.abs(x + 0.5 - CX) > half) return null;
    if (d2(x, y, CX - 2.8, towerY0 + 3.6) <= 1.45 || d2(x, y, CX + 2.8, towerY0 + 3.6) <= 1.45) return toWhite(C.dome, 0.7);
    return Math.abs(x + 0.5 - CX) > half - 1 ? mix(C.wall, 0.85) : toWhite(C.wall, 0.14);
  };
  const hatch = (x: number, y: number): Rgb | null => {
    const gw = 11;
    const gh = 13;
    const gi = Math.floor(x / gw);
    const gj = Math.floor(y / gh);
    if (hash2(gi, gj, 21) > 0.2) return null;
    const cx = gi * gw + 3 + Math.floor(hash2(gi, gj, 22) * (gw - 6));
    const cy = gj * gh + 3 + Math.floor(hash2(gi, gj, 23) * (gh - 6));
    if (Math.abs(x - cx) > 1.5 || Math.abs(y - cy) > 1.5) return null;
    if (Math.abs(x - cx) === 1 && Math.abs(y - cy) === 1) return mix(C.hatch, 0.55);
    return x <= cx - 1 || x >= cx + 1 || y <= cy - 1 || y >= cy + 1 ? mix(C.hatch, 0.8) : C.hatch;
  };

  // Which parts take which cells, first match wins (nozzles over pods over turrets).
  const turretPart = TURRETS.map(() => -1);
  const nozzlePart = NOZZLES.map(() => -1);
  const podPart = PODS.map(() => -1);
  const claim = (i: number, list: number[], k: number, make: () => FighterPart, x: number, y: number): void => {
    if (list[k] < 0) {
      parts.push(make());
      list[k] = parts.length;
    }
    parts[list[k] - 1].cells.push([x, y]);
    part[i] = list[k];
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      let c: Rgb | null = null;
      let em = false;
      if (x === 3 && y === 56) {
        c = { r: 255, g: 70, b: 70 };
        em = true;
      } else if (x === 35 && y === 56) {
        c = { r: 80, g: 255, b: 130 };
        em = true;
      } else if (d2(x, y, CX, 1.6) <= 1.6) c = toWhite(C.hull, 0.7);
      if (!c) c = tower(x, y);
      if (!c) {
        const ds = d2(x, y, CX, 29);
        if (ds <= 4.6) c = mix(C.dome, 1.25 - 0.1 * ds);
      }
      if (!c) {
        // The nozzle cluster: bells with a dark blade disk, a raised rim and a glowing hub.
        for (let k = 0; k < NOZZLES.length && !c; k++) {
          const nz = NOZZLES[k];
          const d = d2(x, y, nz.x, nz.y);
          if (d > nz.r) continue;
          const ang = Math.atan2(y + 0.5 - nz.y, x + 0.5 - nz.x);
          const ao = 1 - 0.34 * Math.max(0, Math.cos(ang - Math.PI * 0.72));
          const dc = C[nz.drive];
          if (d > nz.r - 1) c = mix(dc, (1.02 - 0.1 * (nz.r - d)) * ao);
          else if (d > nz.r - 2.4) c = mix(dc, (0.42 + 0.06 * (nz.r - d)) * ao);
          else if (d < nz.r * 0.32) {
            c = mix(toWhite(dc, 0.25), (1.4 - 0.75 * (d / (nz.r * 0.32))) * Math.min(1, ao + 0.3));
            em = true;
          } else c = mix(Math.sin(ang * 8 + d * 0.2) > 0 ? C.turret : C.wall, (0.55 + 0.35 * (d / nz.r)) * ao);
          claim(i, nozzlePart, k, () => ({ kind: 'engine', drive: nz.drive, dirX: 0, dirY: -1, cells: [] }), x, y);
        }
      }
      if (!c) {
        for (let k = 0; k < PODS.length && !c; k++) {
          const p = PODS[k];
          const dx = x + 0.5 - p.x;
          const dy = y + 0.5 - p.y;
          const h = p.r + 0.55;
          if (Math.abs(dx) > h || Math.abs(dy) > h) continue;
          const col = p.drive === 'maneuver' ? C.thruster : C[p.drive];
          const d = Math.hypot(dx, dy);
          if (d <= p.r * 0.5) {
            c = mix(toWhite(col, 0.35), 1.15);
            em = true;
          } else if (d <= p.r) c = mix(C.wall, 0.32 + (0.12 * d) / p.r);
          else c = mix(col, Math.abs(dx) > h - 1 || Math.abs(dy) > h - 1 ? 0.68 : 0.92 + 0.08 * hash2(x, y, 501));
          claim(i, podPart, k, () => ({ kind: 'pod', drive: p.drive, dirX: p.dx, dirY: p.dy, cells: [] }), x, y);
        }
      }
      if (!c && y >= 51) c = panelMix(C.plate, x, y);
      if (!c) {
        for (let k = 0; k < TURRETS.length && !c; k++) {
          const t = TURRETS[k];
          const d = d2(x, y, t.x, t.y);
          if (d > t.r) continue;
          c = d <= 1 ? mix(C.turret, 0.5) : mix(C.turret, 1.12 - 0.07 * d);
          claim(i, turretPart, k, () => ({ kind: 'turret', heavy: t.heavy, cells: [] }), x, y);
        }
      }
      if (!c && intake(x, y)) c = mix({ r: 14, g: 18, b: 34 }, 0.85 + 0.3 * hash2(x, y, 40));
      if (!c) c = hatch(x, y);
      if (!c && inStripe(x, y)) c = panelMix(C.stripe, x, y);
      if (!c) c = panelMix(dist[i] === 1 ? C.armor : C.hull, x, y);
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;
      glow[i] = em ? 1 : 0;
    }
  }
  return { w: W, h: H, mask, dist, color, glow, part, parts };
}
