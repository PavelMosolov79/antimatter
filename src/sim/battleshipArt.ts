import { Mat } from './materials';
import { hash2 } from './rng';

/**
 * The battleship's look, ported as-is from the approved visual concept. Every function
 * here draws exactly what the concept drew; the only addition is that each pixel also
 * records what it *is* in the game (hull, wall, door, console, part of which module),
 * so ships.ts can build the real grid underneath the same picture.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

const hex = (h: number): RGB => ({ r: (h >> 16) & 255, g: (h >> 8) & 255, b: h & 255 });
const mix = (c: RGB, f: number): RGB => ({ r: c.r * f, g: c.g * f, b: c.b * f });
const toWhite = (c: RGB, a: number): RGB => ({ r: c.r + (255 - c.r) * a, g: c.g + (255 - c.g) * a, b: c.b + (255 - c.b) * a });

const C = {
  hull: hex(0x8c96a8),
  armor: hex(0x5d6b82),
  engine: hex(0xd9822b),
  module: hex(0x3fb8a6),
  thruster: hex(0x52d4ee),
  turret: hex(0x5b6478),
  reactor: hex(0xe0507a),
  shieldgen: hex(0x6a86ff),
  wall: hex(0x596273),
  bridge: hex(0xd8e6ff),
  stripe: hex(0xd23c3c),
  door: hex(0xe0b34e),
  ladder: hex(0x4fae7a),
};
const HAZARD_DARK: RGB = { r: 20, g: 20, b: 22 };
const HAZARD_YELLOW: RGB = { r: 232, g: 196, b: 80 };

export type ArtModuleKind = 'turret' | 'engine' | 'bridge' | 'reactor' | 'shield' | 'generic';

export interface ArtModule {
  kind: ArtModuleKind;
  /** Primary helm vs. reserve console, for bridges. */
  reserve?: boolean;
  cells: Array<[number, number, number]>;
  core: [number, number, number];
}

/** One z-slice of the picture: colour + emissive flag + game material + module tag per cell. */
export class ArtLayer {
  readonly color: Float32Array;
  readonly mat: Uint8Array;
  readonly glow: Uint8Array;
  /** 0 = none, otherwise an index+1 into the owner's tag list. */
  readonly tag: Uint16Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.color = new Float32Array(w * h * 3);
    this.mat = new Uint8Array(w * h);
    this.glow = new Uint8Array(w * h);
    this.tag = new Uint16Array(w * h);
  }

  setColor(i: number, c: RGB): void {
    this.color[i * 3] = c.r;
    this.color[i * 3 + 1] = c.g;
    this.color[i * 3 + 2] = c.b;
  }
}

// ---------------------------------------------------------------- hull silhouette

export const ART_W = 130;
export const ART_H = 190;
const CX = 65;
const PROFILE: Array<[number, number]> = [
  [0, 0],
  [20, 9],
  [168, 57],
  [186, 62],
  [186.01, 0],
];

function halfWidthAt(profile: Array<[number, number]>, y: number): number {
  if (y <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    const [y1, w1] = profile[i];
    const [y0, w0] = profile[i - 1];
    if (y <= y1) return y1 === y0 ? w1 : w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
  }
  return profile[profile.length - 1][1];
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

/** Straight-profile wedge with small clustered notches bitten out of its rim. */
function silhouette(): { mask: Uint8Array; dist: Uint8Array } {
  const raw = new Uint8Array(ART_W * ART_H);
  for (let y = 0; y < ART_H; y++) {
    const hw = halfWidthAt(PROFILE, y + 0.5);
    for (let x = 0; x < ART_W; x++) if (Math.abs(x + 0.5 - CX) <= hw) raw[y * ART_W + x] = 1;
  }
  const rawDist = edgeDistance(raw, ART_W, ART_H);
  const mask = raw.slice();
  for (let i = 0; i < ART_W * ART_H; i++) {
    if (!raw[i] || rawDist[i] > 2) continue;
    const x = i % ART_W;
    const y = (i - x) / ART_W;
    if (hash2(Math.floor(x / 3), Math.floor(y / 3), 9) < 0.22 && hash2(x, y, 10) < 0.55) mask[i] = 0;
  }
  return { mask, dist: edgeDistance(mask, ART_W, ART_H) };
}

// ---------------------------------------------------------------- exterior

const dist2 = (x: number, y: number, cx: number, cy: number): number => Math.hypot(x + 0.5 - cx, y + 0.5 - cy);

function edgeDepth(x: number, y: number): number {
  const hw = halfWidthAt(PROFILE, y + 0.5);
  const cx = x + 0.5;
  return cx <= CX ? hw - (CX - cx) : hw - (cx - CX);
}

const SHADES = [0.8, 0.9, 0.98, 1.07, 1.16];
function panelShade(x: number, y: number): number {
  const s = SHADES[Math.floor(hash2(Math.floor(x / 5), Math.floor(y / 6), 7) * SHADES.length)];
  return x % 5 === 0 || y % 6 === 0 ? s * 0.82 : s;
}
function fineGreebleFactor(x: number, y: number): number {
  const h = hash2(x, y, 11);
  if (h < 0.03) return 0.4;
  if (h < 0.055) return 1.4;
  return 1;
}
const SEAM_ROWS = [24, 50, 78, 106, 134, 160, 182];
function seamFactor(x: number, y: number): number {
  if (!SEAM_ROWS.includes(y)) return 1;
  return x % 5 === 2 ? 0.62 : 0.85;
}
const panelMix = (base: RGB, x: number, y: number): RGB => mix(base, panelShade(x, y) * fineGreebleFactor(x, y) * seamFactor(x, y));

function inStripe(x: number, y: number): boolean {
  if (Math.abs(x - CX) <= 1 && ((y >= 18 && y <= 58) || (y >= 112 && y <= 128))) return true;
  const d = edgeDepth(x, y);
  return d >= 4 && d <= 6 && y >= 14 && y <= 176;
}

function hangarBay(x: number, y: number): boolean {
  if (y < 62 || y > 100) return false;
  const d = edgeDepth(x, y);
  return d >= 2 && d <= 15;
}

const TOWER_Y0 = 128;
const TOWER_Y1 = 172;
function tower(x: number, y: number): RGB | null {
  if (y < TOWER_Y0 || y > TOWER_Y1) return null;
  const half = 11 - (6 * Math.max(0, y - TOWER_Y0 - 30)) / (TOWER_Y1 - TOWER_Y0 - 30 || 1);
  if (Math.abs(x - CX) > half) return null;
  if (dist2(x, y, CX - 5, TOWER_Y0 + 9) <= 2.4 || dist2(x, y, CX + 5, TOWER_Y0 + 9) <= 2.4) return toWhite(C.hull, 0.6);
  return Math.abs(x - CX) > half - 1.4 ? mix(C.wall, 0.85) : toWhite(C.wall, 0.12);
}

const NOZZLES = [
  { x: 28, y: 181, r: 11, hub: C.thruster },
  { x: 65, y: 181, r: 11, hub: C.reactor },
  { x: 102, y: 181, r: 11, hub: C.thruster },
  { x: 44, y: 165, r: 8, hub: C.thruster },
  { x: 86, y: 165, r: 8, hub: C.thruster },
];

interface Px {
  c: RGB;
  glow?: boolean;
  turret?: number;
  engine?: number;
}

function nozzle(x: number, y: number): Px | null {
  for (let n = 0; n < NOZZLES.length; n++) {
    const nz = NOZZLES[n];
    const R = nz.r;
    const d = dist2(x, y, nz.x, nz.y);
    if (d > R) continue;
    const ang = Math.atan2(y + 0.5 - nz.y, x + 0.5 - nz.x);
    const ao = 1 - 0.34 * Math.max(0, Math.cos(ang - Math.PI * 0.72));
    if (d > R - 1) return { c: toWhite(C.hull, (0.24 - 0.08 * (R - d)) * ao), engine: n };
    if (d > R - 3.4) return { c: mix(C.wall, (0.4 + 0.05 * (R - d)) * ao), engine: n };
    if (d < R * 0.3) return { c: mix(nz.hub, (1.4 - 0.75 * (d / (R * 0.3))) * Math.min(1, ao + 0.3)), glow: true, engine: n };
    const blade = Math.sin(ang * 8 + d * 0.12) > 0;
    return { c: mix(blade ? C.turret : C.wall, (0.55 + 0.35 * (d / R)) * ao), engine: n };
  }
  return null;
}

/** Turret blisters scattered procedurally: one chance per 20×22 block. Returns the block id as the turret's identity. */
function turret(x: number, y: number): Px | null {
  const gw = 20;
  const gh = 22;
  const gi = Math.floor(x / gw);
  const gj = Math.floor(y / gh);
  if (hash2(gi, gj, 31) > 0.62) return null;
  const tx = gi * gw + 5 + Math.floor(hash2(gi, gj, 32) * (gw - 10));
  const ty = gj * gh + 5 + Math.floor(hash2(gi, gj, 33) * (gh - 10));
  if (ty < 20 || ty > 176) return null;
  const d = dist2(x, y, tx, ty);
  if (d > 3.2) return null;
  return { c: d <= 1.1 ? mix(C.turret, 0.55) : mix(C.turret, 1.08 - 0.06 * d), turret: gj * 64 + gi };
}

function hatchColor(x: number, y: number): RGB | null {
  const gw = 13;
  const gh = 15;
  const gi = Math.floor(x / gw);
  const gj = Math.floor(y / gh);
  if (hash2(gi, gj, 21) > 0.4) return null;
  const cx = gi * gw + 4 + Math.floor(hash2(gi, gj, 22) * (gw - 8));
  const cy = gj * gh + 4 + Math.floor(hash2(gi, gj, 23) * (gh - 8));
  if (Math.abs(x - cx) > 2 || Math.abs(y - cy) > 2) return null;
  return x === cx - 2 || x === cx + 2 || y === cy - 2 || y === cy + 2 ? mix(C.module, 0.55) : C.module;
}

function greeble(x: number, y: number): Px | null {
  if (x === 8 && Math.abs(y - 170) <= 1) return { c: { r: 255, g: 70, b: 70 }, glow: true };
  if (x === 122 && Math.abs(y - 170) <= 1) return { c: { r: 80, g: 255, b: 130 }, glow: true };
  const dNose = dist2(x, y, CX, 4);
  if (dNose <= 2.5) return { c: toWhite(C.hull, 0.65 - 0.12 * dNose) };
  const tw = tower(x, y);
  if (tw) return { c: tw };
  const dSh = dist2(x, y, CX, 98);
  if (dSh <= 9) return { c: mix(C.shieldgen, 1.22 - 0.078 * dSh) };
  const nz = nozzle(x, y);
  if (nz) return nz;
  if (y >= 155) return { c: panelMix(C.engine, x, y) };
  const tur = turret(x, y);
  if (tur) return tur;
  if (hangarBay(x, y)) return { c: mix(HAZARD_DARK, 0.85 + 0.3 * hash2(x, y, 40)) };
  const hatch = hatchColor(x, y);
  if (hatch) return { c: hatch };
  if (inStripe(x, y)) return { c: panelMix(C.stripe, x, y) };
  return null;
}

// ---------------------------------------------------------------- interior rooms

function roomFloorTile(x: number, y: number): number {
  const shades = [0.9, 0.97, 1.04, 1.1];
  let s = shades[Math.floor(hash2(Math.floor(x / 4), Math.floor(y / 4), 401) * shades.length)];
  if (hash2(x, y, 402) < 0.025) s *= 0.6;
  return x % 4 === 0 || y % 4 === 0 ? s * 0.86 : s;
}

const TAG_BRIDGE = 1;
const TAG_BRIDGE_RESERVE = 2;
const TAG_REACTOR = 3;
const TAG_SHIELD = 4;
const TAG_GENERIC = 5;

/** A room drawn in its own local coordinates. Its outer ring is always bulkhead (wall or door). */
class Room extends ArtLayer {
  constructor(w: number, h: number) {
    super(w, h);
    this.mat.fill(Mat.DECK);
    this.floor(1, w - 2, 1, h - 2, C.hull);
    for (let x = 0; x < w; x++) {
      this.wallPix(x, 0, mix(C.wall, x % 5 === 0 ? 0.65 : 0.85));
      this.wallPix(x, h - 1, mix(C.wall, x % 5 === 0 ? 0.65 : 0.85));
    }
    for (let y = 0; y < h; y++) {
      this.wallPix(0, y, mix(C.wall, y % 5 === 0 ? 0.65 : 0.85));
      this.wallPix(w - 1, y, mix(C.wall, y % 5 === 0 ? 0.65 : 0.85));
    }
  }

  private border(x: number, y: number): boolean {
    return x === 0 || y === 0 || x === this.w - 1 || y === this.h - 1;
  }

  private wallPix(x: number, y: number, c: RGB): void {
    const i = y * this.w + x;
    this.setColor(i, c);
    this.mat[i] = Mat.WALL;
  }

  /** Paints a pixel; the bulkhead ring keeps its wall material whatever is drawn over it. */
  pix(x: number, y: number, c: RGB, mat: number = Mat.DECK, tag = 0): void {
    const i = y * this.w + x;
    this.setColor(i, c);
    if (!this.border(x, y)) this.mat[i] = mat;
    if (tag) this.tag[i] = tag;
  }

  glowPix(x: number, y: number, c: RGB, mat: number = Mat.DECK, tag = 0): void {
    this.pix(x, y, c, mat, tag);
    this.glow[y * this.w + x] = 1;
  }

  rect(x0: number, x1: number, y0: number, y1: number, c: RGB, mat: number = Mat.DECK, tag = 0): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.pix(x, y, c, mat, tag);
  }

  floor(x0: number, x1: number, y0: number, y1: number, base: RGB): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.pix(x, y, mix(base, roomFloorTile(x, y)));
  }

  door(x0: number, x1: number): void {
    for (let x = x0; x <= x1; x++) {
      const i = (this.h - 1) * this.w + x;
      this.setColor(i, C.door);
      this.mat[i] = Mat.DOOR;
    }
  }

  chair(cx: number, cy: number, dir: 'up' | 'down' | 'left' | 'right', accent?: RGB, mat: number = Mat.SEAT, tag = 0): void {
    this.rect(cx - 1, cx + 1, cy - 1, cy + 1, mix(C.wall, 0.92), mat, tag);
    const back = mix(C.wall, 0.5);
    if (dir === 'up') this.rect(cx - 1, cx + 1, cy + 2, cy + 2, back, mat, tag);
    else if (dir === 'down') this.rect(cx - 1, cx + 1, cy - 2, cy - 2, back, mat, tag);
    else if (dir === 'left') this.rect(cx + 2, cx + 2, cy - 1, cy + 1, back, mat, tag);
    else this.rect(cx - 2, cx - 2, cy - 1, cy + 1, back, mat, tag);
    this.pix(cx, cy, accent ?? toWhite(C.wall, 0.35), mat, tag);
  }

  consoleH(x0: number, x1: number, y0: number, y1: number): void {
    this.rect(x0, x1, y0, y1, mix(C.wall, 0.4), Mat.CONSOLE);
    const mid = Math.floor((x0 + x1) / 2);
    this.rect(x0 + 1, mid - 1, y0, y0, mix(C.thruster, 1.2), Mat.CONSOLE);
    this.rect(mid + 1, x1 - 1, y0, y0, mix(C.reactor, 1.05), Mat.CONSOLE);
    const btn = [C.module, C.shieldgen, C.stripe];
    for (let x = x0; x <= x1; x++) if ((x - x0) % 2 === 0) this.pix(x, y1, mix(btn[(x - x0) % btn.length], 1.3), Mat.CONSOLE);
    this.pix(x0, y0, C.stripe, Mat.CONSOLE);
  }

  consoleV(x0: number, x1: number, y0: number, y1: number): void {
    this.rect(x0, x1, y0, y1, mix(C.wall, 0.4), Mat.CONSOLE);
    const mid = Math.floor((y0 + y1) / 2);
    this.rect(x0, x0, y0 + 1, mid - 1, mix(C.thruster, 1.2), Mat.CONSOLE);
    this.rect(x0, x0, mid + 1, y1 - 1, mix(C.reactor, 1.05), Mat.CONSOLE);
    const btn = [C.module, C.shieldgen, C.stripe];
    for (let y = y0; y <= y1; y++) if ((y - y0) % 2 === 0) this.pix(x1, y, mix(btn[(y - y0) % btn.length], 1.3), Mat.CONSOLE);
    this.pix(x0, y0, C.stripe, Mat.CONSOLE);
  }

  pitStep(x0: number, x1: number, y0: number, y1: number): void {
    const c = toWhite(C.wall, 0.3);
    this.rect(x0, x1, y0, y0, c);
    this.rect(x0, x1, y1, y1, c);
    this.rect(x0, x0, y0, y1, c);
    this.rect(x1, x1, y0, y1, c);
  }

  gauge(x: number, y0: number, y1: number, level: number, color: RGB): void {
    const n = y1 - y0 + 1;
    const filled = Math.round(n * level);
    for (let i = 0; i < n; i++) this.pix(x, y1 - i, i < filled ? mix(color, 1.25) : mix(C.wall, 0.35), Mat.CONSOLE);
  }
}

function bridgeRoom(): Room {
  const r = new Room(52, 36);
  r.rect(18, 33, 0, 0, mix(C.thruster, 1.15));
  r.rect(13, 38, 1, 1, mix(C.thruster, 1.05));
  r.rect(8, 43, 2, 2, mix(C.shieldgen, 0.6));
  for (let s = 0; s < 16; s++) {
    const sx = 9 + Math.floor(hash2(s, 7, 301) * 34);
    const sy = 1 + Math.floor(hash2(s, 11, 302) * 2);
    r.pix(sx, sy, toWhite(C.hull, 0.9));
  }
  r.door(24, 27);
  r.floor(3, 20, 5, 30, mix(C.hull, 0.72));
  r.floor(31, 48, 5, 30, mix(C.hull, 0.72));
  r.pitStep(3, 20, 5, 30);
  r.pitStep(31, 48, 5, 30);
  r.floor(21, 30, 3, r.h - 2, mix(C.hull, 1.14));
  r.rect(25, 26, 3, r.h - 2, mix(C.thruster, 0.55));
  for (const cy of [9, 17, 25]) {
    r.consoleV(4, 8, cy - 2, cy + 2);
    r.chair(12, cy, 'left');
    r.consoleV(43, 47, cy - 2, cy + 2);
    r.chair(39, cy, 'right');
  }
  r.consoleH(15, 19, 29, 30);
  r.chair(17, 27, 'up');
  r.consoleH(32, 36, 29, 30);
  r.chair(34, 27, 'up');
  r.rect(19, 32, 13, 23, mix(C.hull, 1.22));
  r.pitStep(19, 32, 13, 23);
  // Captain's chair: the ship's primary helm post.
  const cx = 26;
  const cy = 18;
  r.chair(cx, cy, 'up', mix(C.bridge, 1.25), Mat.BRIDGE, TAG_BRIDGE);
  r.pix(cx - 2, cy, mix(C.wall, 0.6), Mat.BRIDGE, TAG_BRIDGE);
  r.pix(cx + 2, cy, mix(C.wall, 0.6), Mat.BRIDGE, TAG_BRIDGE);
  r.pix(cx - 1, cy - 2, mix(C.wall, 0.7), Mat.BRIDGE, TAG_BRIDGE);
  r.pix(cx, cy - 2, mix(C.wall, 0.7), Mat.BRIDGE, TAG_BRIDGE);
  r.pix(cx + 1, cy - 2, mix(C.wall, 0.7), Mat.BRIDGE, TAG_BRIDGE);
  return r;
}

function reactorRoom(): Room {
  const r = new Room(46, 46);
  const cx = 23;
  const cy = 23;
  r.door(21, 24);
  for (let y = 1; y < r.h - 1; y++) {
    for (let x = 1; x < r.w - 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      if (d <= 3) r.glowPix(x, y, mix(toWhite(C.reactor, 0.55), 0.85 + 0.3 * Math.sin(a * 6 + d * 2)), Mat.CORE, TAG_REACTOR);
      else if (d <= 5) r.pix(x, y, Math.abs(Math.sin(a * 8)) > 0.88 ? mix(C.thruster, 0.8) : mix(C.wall, 0.4), Mat.REACTOR, TAG_REACTOR);
      else if (d <= 7.3) {
        const blade = Math.sin(a * 10 + d * 0.3) > 0;
        r.pix(x, y, mix(blade ? C.reactor : C.wall, blade ? 1.05 : 0.5), Mat.REACTOR, TAG_REACTOR);
      } else if (d <= 8.3) r.pix(x, y, Math.floor((a * 12) / (2 * Math.PI) + d) % 2 === 0 ? HAZARD_DARK : HAZARD_YELLOW, Mat.REACTOR, TAG_REACTOR);
      else if (d <= 9.6) r.pix(x, y, mix(toWhite(C.hull, 0.12), roomFloorTile(x, y)));
    }
  }
  for (let p = 0; p < 8; p++) {
    const pa = (p * Math.PI) / 4;
    for (let rr = 9.6; rr < 15; rr += 0.6) {
      const px = Math.round(cx + Math.cos(pa) * rr);
      const py = Math.round(cy + Math.sin(pa) * rr);
      if (px > 0 && px < r.w - 1 && py > 0 && py < r.h - 1) r.pix(px, py, mix(C.wall, 0.55));
    }
    const ca = pa + Math.PI / 8;
    for (let rr = 9.6; rr < 19; rr += 0.6) {
      const px = Math.round(cx + Math.cos(ca) * rr);
      const py = Math.round(cy + Math.sin(ca) * rr);
      if (px > 0 && px < r.w - 1 && py > 0 && py < r.h - 1) r.pix(px, py, mix(C.engine, 0.85));
    }
  }
  r.consoleH(10, 14, 1, 2);
  r.chair(12, 5, 'up');
  r.consoleH(31, 35, 1, 2);
  r.chair(33, 5, 'up');
  r.consoleV(1, 2, 10, 14);
  r.chair(5, 12, 'left');
  r.consoleV(r.w - 3, r.w - 2, 31, 35);
  r.chair(r.w - 6, 33, 'right');
  return r;
}

function shieldRoom(): Room {
  const r = new Room(34, 30);
  const cx = 17;
  const cy = 13;
  r.door(15, 18);
  for (let y = 1; y < r.h - 1; y++) {
    for (let x = 1; x < r.w - 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      if (d <= 4) r.glowPix(x, y, mix(toWhite(C.shieldgen, 0.35), 0.9 + 0.25 * Math.sin(a * 5 + d * 2)), Mat.SHIELDGEN, TAG_SHIELD);
      else if (d <= 6) r.pix(x, y, Math.abs(Math.sin(a * 6)) > 0.85 ? mix(C.thruster, 0.85) : mix(C.wall, 0.42), Mat.SHIELDGEN, TAG_SHIELD);
      else if (d <= 7) r.pix(x, y, mix(toWhite(C.shieldgen, 0.5), 0.8 + 0.2 * Math.sin(a * 20)), Mat.SHIELDGEN, TAG_SHIELD);
    }
  }
  for (const a0 of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (let rr = 7; rr < 12; rr += 0.6) {
      const px = Math.round(cx + Math.cos(a0) * rr);
      const py = Math.round(cy + Math.sin(a0) * rr);
      if (px > 0 && px < r.w - 1 && py > 0 && py < r.h - 1) r.pix(px, py, mix(C.shieldgen, 0.7));
    }
  }
  r.consoleH(8, 13, 20, 21);
  r.consoleH(21, 26, 20, 21);
  r.gauge(16, 17, 21, 0.8, C.shieldgen);
  r.gauge(17, 17, 21, 0.55, C.thruster);
  r.chair(10, 24, 'up');
  r.chair(24, 24, 'up');
  return r;
}

function turretRoom(): Room {
  const r = new Room(24, 24);
  const cx = 12;
  const cy = 11;
  r.door(10, 13);
  for (let y = 1; y < r.h - 1; y++) {
    for (let x = 1; x < r.w - 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > 5) continue;
      if (d <= 1.6) r.glowPix(x, y, mix(C.thruster, 1.2));
      else if (d <= 3.4) r.pix(x, y, Math.abs(Math.sin(Math.atan2(y + 0.5 - cy, x + 0.5 - cx) * 10)) > 0.5 ? mix(C.stripe, 0.85) : mix(C.wall, 0.35));
      else r.pix(x, y, toWhite(C.wall, 0.3));
    }
  }
  for (let x = 1; x < r.w - 1; x++) r.pix(x, r.h - 2, x % 4 < 2 ? HAZARD_DARK : HAZARD_YELLOW);
  for (let i = 0; i < 4; i++) r.rect(2, 3, 3 + i * 3, 4 + i * 3, mix(C.module, 0.7 + 0.08 * i), Mat.CONSOLE);
  r.consoleH(9, 14, 17, 18);
  r.chair(11, 15, 'up');
  r.chair(13, 15, 'up');
  return r;
}

function engineRoom(): Room {
  const r = new Room(38, 26);
  r.door(17, 20);
  for (let p = 0; p < 3; p++) {
    const py = 6 + p * 6;
    for (let x = 2; x < r.w - 2; x++) r.pix(x, py, mix(C.engine, x % 6 < 4 ? 0.9 : 0.6));
    r.pix(3, py, mix(C.thruster, 1.2));
    r.pix(r.w - 4, py, mix(C.thruster, 1.2));
  }
  for (let x = 2; x < r.w - 2; x++) r.pix(x, 20, x % 4 < 2 ? HAZARD_DARK : HAZARD_YELLOW);
  r.rect(6, 31, 2, 3, mix(C.wall, 0.4), Mat.CONSOLE);
  for (const cx of [9, 18, 27]) r.rect(cx - 2, cx + 1, 2, 2, mix([C.thruster, C.reactor, C.shieldgen][(cx / 9) % 3], 1.15), Mat.CONSOLE);
  const btn = [C.module, C.stripe, C.shieldgen];
  for (let x = 6; x <= 31; x++) if ((x - 6) % 2 === 0) r.pix(x, 3, mix(btn[(x - 6) % 3], 1.3), Mat.CONSOLE);
  r.gauge(4, 2, 3, 0.7, C.engine);
  r.gauge(33, 2, 3, 0.7, C.engine);
  r.chair(11, 6, 'up');
  r.chair(19, 6, 'up', undefined, Mat.BRIDGE, TAG_BRIDGE_RESERVE); // reserve helm
  r.chair(27, 6, 'up');
  return r;
}

function thrusterRoom(): Room {
  const r = new Room(20, 18);
  r.door(8, 11);
  for (const [cx, cy] of [
    [6, 3],
    [13, 3],
  ]) {
    const R = 3.4;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > R) continue;
        if (d > R - 0.8) r.pix(x, y, toWhite(C.hull, 0.2));
        else if (d < R * 0.4) r.glowPix(x, y, mix(C.thruster, 1.3));
        else r.pix(x, y, mix(C.wall, 0.5 + 0.2 * (d / R)));
      }
    }
  }
  for (let y = 7; y < 12; y++) {
    r.pix(9, y, mix(C.engine, 0.85));
    r.pix(10, y, mix(C.engine, 0.85));
  }
  r.consoleH(7, 12, 12, 13);
  r.chair(9, 15, 'up');
  return r;
}

function serviceRoom(): Room {
  const r = new Room(22, 18);
  r.door(9, 12);
  for (let i = 0; i < 4; i++) {
    const ly0 = (2 + i * 3.4) | 0;
    r.rect(2, 4, ly0, ly0 + 2, mix(C.wall, 0.44), Mat.CONSOLE);
    r.pix(3, ly0, mix(C.module, 1.1), Mat.CONSOLE);
    r.pix(4, ly0 + 1, mix(C.wall, 0.3), Mat.CONSOLE);
  }
  for (let t = 0; t < 5; t++) r.pix(r.w - 3, (3 + t * 2.4) | 0, mix(C.stripe, t % 2 === 0 ? 1.1 : 0.8), Mat.CONSOLE);
  r.rect(r.w - 4, r.w - 4, 2, 13, mix(C.wall, 0.5), Mat.CONSOLE);
  // Workbench: the bay's generic equipment module.
  r.rect(8, 15, 6, 8, mix(C.wall, 0.46), Mat.MODULE, TAG_GENERIC);
  r.rect(10, 13, 7, 7, toWhite(C.hull, 0.4), Mat.MODULE, TAG_GENERIC);
  r.rect(7, 9, 11, 12, mix(C.module, 0.75), Mat.CONSOLE);
  r.rect(8, 9, 10, 10, mix(C.module, 0.85), Mat.CONSOLE);
  r.chair(12, 10, 'down');
  return r;
}

// ---------------------------------------------------------------- deck composition

interface Placement {
  room: Room;
  x: number;
  y: number;
}

/**
 * Two placed rooms exactly one cell apart with at least three cells of shared edge get
 * a 3-cell door painted into the gap between them. Returns the gap cells it painted.
 */
function autoDoor(a: Placement, b: Placement): Array<[number, number]> {
  const ax1 = a.x + a.room.w - 1;
  const ay1 = a.y + a.room.h - 1;
  const bx1 = b.x + b.room.w - 1;
  const by1 = b.y + b.room.h - 1;
  const out: Array<[number, number]> = [];
  const left = b.x - ax1 === 2 ? a : a.x - bx1 === 2 ? b : null;
  if (left) {
    const right = left === a ? b : a;
    const oy0 = Math.max(left.y, right.y);
    const oy1 = Math.min(left.y + left.room.h - 1, right.y + right.room.h - 1);
    if (oy1 - oy0 >= 2) {
      const mid = Math.floor((oy0 + oy1) / 2);
      for (let dy = -1; dy <= 1; dy++) out.push([left.x + left.room.w, mid + dy]);
      return out;
    }
  }
  const top = b.y - ay1 === 2 ? a : a.y - by1 === 2 ? b : null;
  if (top) {
    const bot = top === a ? b : a;
    const ox0 = Math.max(top.x, bot.x);
    const ox1 = Math.min(top.x + top.room.w - 1, bot.x + bot.room.w - 1);
    if (ox1 - ox0 >= 2) {
      const mid = Math.floor((ox0 + ox1) / 2);
      for (let dx = -1; dx <= 1; dx++) out.push([mid + dx, top.y + top.room.h]);
    }
  }
  return out;
}

export interface BattleshipArt {
  w: number;
  h: number;
  layers: ArtLayer[];
  modules: ArtModule[];
}

export function buildBattleshipArt(): BattleshipArt {
  const { mask, dist } = silhouette();
  const W = ART_W;
  const H = ART_H;

  // Exterior hull, z=0.
  const hull = new ArtLayer(W, H);
  const turretCells = new Map<number, Array<[number, number, number]>>();
  const engineCells = new Map<number, Array<[number, number, number]>>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      const g = greeble(x, y);
      hull.mat[i] = dist[i] === 1 ? Mat.ARMOR : Mat.HULL;
      if (g) {
        hull.setColor(i, g.c);
        if (g.glow) hull.glow[i] = 1;
        if (g.turret !== undefined) {
          hull.mat[i] = Mat.TURRET;
          if (!turretCells.has(g.turret)) turretCells.set(g.turret, []);
          turretCells.get(g.turret)!.push([x, y, 0]);
        } else if (g.engine !== undefined) {
          hull.mat[i] = Mat.ENGINE;
          if (!engineCells.has(g.engine)) engineCells.set(g.engine, []);
          engineCells.get(g.engine)!.push([x, y, 0]);
        }
      } else {
        hull.setColor(i, panelMix(dist[i] === 1 ? C.armor : C.hull, x, y));
      }
    }
  }

  const modules: ArtModule[] = [];
  const centroid = (cells: Array<[number, number, number]>): [number, number, number] => {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of cells) {
      sx += x;
      sy += y;
    }
    const mx = sx / cells.length;
    const my = sy / cells.length;
    let best = cells[0];
    let bd = Infinity;
    for (const c of cells) {
      const d = (c[0] - mx) ** 2 + (c[1] - my) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };
  for (const cells of [...turretCells.values()].sort((a, b) => centroid(a)[1] - centroid(b)[1] || centroid(a)[0] - centroid(b)[0])) {
    modules.push({ kind: 'turret', cells, core: centroid(cells) });
  }
  for (const [, cells] of [...engineCells.entries()].sort((a, b) => a[0] - b[0])) {
    modules.push({ kind: 'engine', cells, core: centroid(cells) });
  }

  // Decks: floor wherever the hull is thick enough (same 2z+1 rule as hullShip), rooms blitted on top.
  const layers: ArtLayer[] = [hull];
  const decks: Placement[][] = [
    [
      { room: thrusterRoom(), x: 55, y: 20 },
      { room: serviceRoom(), x: 54, y: 39 },
      { room: shieldRoom(), x: 48, y: 58 },
      { room: bridgeRoom(), x: 39, y: 89 },
      { room: reactorRoom(), x: 42, y: 126 },
    ],
    [
      { room: turretRoom(), x: 40, y: 140 },
      { room: engineRoom(), x: 65, y: 140 },
    ],
  ];
  const tagCells = new Map<number, Array<[number, number, number]>>();
  for (let di = 0; di < decks.length; di++) {
    const z = di + 1;
    const layer = new ArtLayer(W, H);
    const inDeck = (x: number, y: number): boolean => x >= 1 && y >= 1 && x < W - 1 && y < H - 1 && dist[y * W + x] >= 2 * z + 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (dist[y * W + x] < 2 * z + 1) continue;
        const i = y * W + x;
        layer.mat[i] = Mat.DECK;
        layer.setColor(i, mix(C.hull, roomFloorTile(x, y)));
      }
    }
    for (const p of decks[di]) {
      const r = p.room;
      for (let ly = 0; ly < r.h; ly++) {
        for (let lx = 0; lx < r.w; lx++) {
          const gx = p.x + lx;
          const gy = p.y + ly;
          if (!inDeck(gx, gy)) continue;
          const li = ly * r.w + lx;
          const gi = gy * W + gx;
          layer.color[gi * 3] = r.color[li * 3];
          layer.color[gi * 3 + 1] = r.color[li * 3 + 1];
          layer.color[gi * 3 + 2] = r.color[li * 3 + 2];
          layer.mat[gi] = r.mat[li];
          if (r.glow[li]) layer.glow[gi] = 1;
          const t = r.tag[li];
          if (t) {
            if (!tagCells.has(t)) tagCells.set(t, []);
            tagCells.get(t)!.push([gx, gy, z]);
          }
        }
      }
    }
    // The drawn auto-doors in the one-cell gap between touching rooms. The gap itself
    // stays walkable deck; to make the pair actually passable, the neighbouring room's
    // bulkhead facing that gap opens with a matching door as well.
    const ps = decks[di];
    for (let a = 0; a < ps.length; a++) {
      for (let b = a + 1; b < ps.length; b++) {
        const gap = autoDoor(ps[a], ps[b]);
        for (const [x, y] of gap) {
          if (!inDeck(x, y)) continue;
          layer.setColor(y * W + x, C.door);
          for (const [nx, ny] of [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ]) {
            const ni = ny * W + nx;
            if (layer.mat[ni] === Mat.WALL) {
              layer.mat[ni] = Mat.DOOR;
              layer.setColor(ni, C.door);
            }
          }
        }
      }
    }
    layers.push(layer);
  }

  // Ladders between the two decks, out on the open deck behind the reactor room.
  for (const [x, y] of [
    [28, 176],
    [102, 176],
  ]) {
    for (let z = 1; z <= 2; z++) {
      const i = y * W + x;
      layers[z].mat[i] = Mat.LADDER;
      layers[z].setColor(i, C.ladder);
    }
  }

  const tagged = (t: number) => tagCells.get(t) ?? [];
  const bridge = tagged(TAG_BRIDGE);
  modules.push({ kind: 'bridge', cells: bridge, core: centroid(bridge) });
  const shield = tagged(TAG_SHIELD);
  modules.push({ kind: 'shield', cells: shield, core: centroid(shield) });
  const reactor = tagged(TAG_REACTOR);
  modules.push({ kind: 'reactor', cells: reactor, core: centroid(reactor) });
  const generic = tagged(TAG_GENERIC);
  modules.push({ kind: 'generic', cells: generic, core: centroid(generic) });
  const reserve = tagged(TAG_BRIDGE_RESERVE);
  modules.push({ kind: 'bridge', reserve: true, cells: reserve, core: centroid(reserve) });

  return { w: W, h: H, layers, modules };
}
