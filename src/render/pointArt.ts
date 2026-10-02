import type { PointKind } from '../sim/road';
import type { SectorId } from '../sim/space';

/**
 * Pixel scenes for the points of the campaign road, as designed in «Карта похода Antimatter»:
 * every point is a small picture of what waits there — a planet with enemy ships circling it,
 * a black hole, a docking ring, asteroids with veins of ore. All are drawn from the point's
 * seed, so one kind has many looks. Sprites are 64×64 and drawn scaled up with hard pixels.
 */

type RGB = [number, number, number];

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInt(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

const hash2 = (x: number, y: number, s: number): number => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, s: number, octaves = 4): number {
  let t = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    t += a * vnoise(x * f, y * f, s + i * 17);
    f *= 2;
    a *= 0.5;
  }
  return t;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const ramp = (list: string[]): RGB[] => list.map(hex);

/** A colour from a ramp at position t, dithered with a 4×4 matrix between neighbouring steps. */
export function rampPick(cols: RGB[], t: number, x: number, y: number): RGB {
  const n = cols.length - 1;
  const v = clamp(t) * n;
  const i = Math.min(n - 1, Math.floor(v));
  const f = v - i;
  return cols[i + (f > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? 1 : 0)];
}

export class Px {
  readonly c: HTMLCanvasElement;
  private readonly x: CanvasRenderingContext2D;
  private readonly img: ImageData;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.c = document.createElement('canvas');
    this.c.width = w;
    this.c.height = h;
    this.x = this.c.getContext('2d')!;
    this.img = this.x.createImageData(w, h);
  }
  set(x: number, y: number, col: RGB | string, a = 255): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const c = typeof col === 'string' ? hex(col) : col;
    const d = this.img.data;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = a;
  }
  done(): HTMLCanvasElement {
    this.x.putImageData(this.img, 0, 0);
    return this.c;
  }
}

// ------------------------------------------------------------------ sprites

interface Sprite {
  rows: string[];
  w: number;
  h: number;
  pal: Record<string, RGB>;
}

/** Sprites are drawn from the left half and mirrored; the last column of each row is the centre. */
function mkSprite(half: string[], pal: Record<string, string>): Sprite {
  const rows = half.map((h) => h + [...h.slice(0, -1)].reverse().join(''));
  const p: Record<string, RGB> = {};
  for (const k of Object.keys(pal)) p[k] = hex(pal[k]);
  return { rows, w: rows[0].length, h: rows.length, pal: p };
}

const RED = { a: '#6a1f2c', b: '#d8504a', w: '#ffe9c0', c: '#ffb347' };
const SPR = {
  scout: mkSprite(['..a', '.ab', '.aw', '.ab', 'ac.', '..c'], RED),
  raider: mkSprite(['....a', '...ab', '..abw', '..abb', '.aabb', 'aabbb', 'a.abb', '..acb', '...c.'], RED),
  hunter: mkSprite(['....a', '....a', '...ab', 'a..ab', '.a.ab', 'aaabw', 'aabbb', '.aabb', '..acb', '...cc'], RED),
  boss: mkSprite(
    ['.......a', '......ab', '......ab', '.....abw', '.....abb', '....aabb', '...aabbb', '..aabbbb', '.aaabbbb', 'aaabbcbb', 'aabbbbbb', 'a.abbbcb', '..aabbbb', '..acbcbb', '...c.c.c'],
    { a: '#4a1220', b: '#b8403f', w: '#ffe9c0', c: '#ffb347' },
  ),
  player: mkSprite(['...a', '..ab', '..aw', '.aab', 'aabb', 'a.ab', '..cb'], { a: '#1f6a8a', b: '#8fe8ff', w: '#ffffff', c: '#ffb347' }),
  trader: mkSprite(['..a', '.ab', 'aab', 'abb', 'abw', 'abb', 'a.b', '.cc'], { a: '#8a6a3a', b: '#f0dcae', w: '#ffffff', c: '#ffd24a' }),
};

function blit(p: Px, s: Sprite, cx: number, cy: number, ang = 0): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const R = Math.ceil(Math.hypot(s.w, s.h) / 2) + 1;
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const ix = Math.floor(x * ca + y * sa + s.w / 2);
      const iy = Math.floor(-x * sa + y * ca + s.h / 2);
      if (ix < 0 || iy < 0 || ix >= s.w || iy >= s.h) continue;
      const ch = s.rows[iy][ix];
      if (ch === '.' || !s.pal[ch]) continue;
      p.set(Math.round(cx + x), Math.round(cy + y), s.pal[ch]);
    }
  }
}

/** The player's little ship, for the marker on the road. */
export function playerMarker(): HTMLCanvasElement {
  const p = new Px(7, 8);
  blit(p, SPR.player, 3, 4, 0);
  return p.done();
}

// ------------------------------------------------------------------ looks

export interface SectorLook {
  name: string;
  accent: string;
  planet: RGB[];
  nebula: RGB[];
}

export const SECTOR_LOOK: Record<SectorId, SectorLook> = {
  violet: { name: 'Фиолетовая туманность', accent: '#b06bff', planet: ramp(['#1b1030', '#3b2470', '#6b45b8', '#a07ae0', '#d9c3ff']), nebula: ramp(['#0b0620', '#2a1450', '#7a2f9a']) },
  green: { name: 'Изумрудная туманность', accent: '#4fe0a0', planet: ramp(['#08241c', '#0f5a44', '#1f9a6a', '#5fd49a', '#c9ffd9']), nebula: ramp(['#04140f', '#07402f', '#12805e']) },
  ice: { name: 'Ледяная туманность', accent: '#7ac8ff', planet: ramp(['#0c1a2e', '#1f4a7a', '#4a8fc4', '#9ad0f0', '#e8f8ff']), nebula: ramp(['#050f1e', '#0a2a4a', '#2070a8']) },
  crimson: { name: 'Багровая туманность', accent: '#ff6a5a', planet: ramp(['#2a0a0e', '#6a1620', '#b32c2c', '#ee6a3a', '#ffc27a']), nebula: ramp(['#16050a', '#4a0e1a', '#a02a30']) },
  clear: { name: 'Чистое небо', accent: '#9ab0d8', planet: ramp(['#1a1a24', '#4a4a60', '#8a8aa8', '#c4c4dc', '#f4f4ff']), nebula: ramp(['#06080e', '#121c2a', '#2c4058']) },
};

export interface KindLook {
  name: string;
  color: string;
}

export const KIND_LOOK: Record<PointKind, KindLook> = {
  combat: { name: 'Бой', color: '#ff6a5a' },
  elite: { name: 'Элитный бой', color: '#ff9a4a' },
  boss: { name: 'Рубеж', color: '#ff3a4a' },
  dock: { name: 'Док', color: '#63e07a' },
  shop: { name: 'Торговец', color: '#ffd24a' },
  mining: { name: 'Добыча', color: '#4ff0d0' },
  event: { name: 'Сигнал', color: '#ff4fd8' },
  gate: { name: 'Врата и док', color: '#b06bff' },
};

// ------------------------------------------------------------------ drawing

function planet(p: Px, cx: number, cy: number, r: number, cols: RGB[], seed: number, band = false): void {
  const lx = -0.55;
  const ly = -0.5;
  const lz = 0.66;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = (x + 0.5 - cx) / r;
      const dy = (y + 0.5 - cy) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const dz = Math.sqrt(1 - d2);
      const light = Math.max(0, dx * lx + dy * ly + dz * lz);
      let n = fbm(dx * 2.3 + seed * 0.13, dy * 2.3, seed, 4);
      if (band) n = n * 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(dy * 7 + n * 3.2));
      p.set(x, y, rampPick(cols, clamp(light * 0.9 + (n - 0.45) * 0.55 - (d2 > 0.85 ? 0.12 : 0)), x, y));
    }
  }
}

type Orbit = (th: number) => [number, number];

function orbitPts(cx: number, cy: number, rx: number, ry: number, tilt: number): Orbit {
  return (th) => [cx + rx * Math.cos(th) * Math.cos(tilt) - ry * Math.sin(th) * Math.sin(tilt), cy + rx * Math.cos(th) * Math.sin(tilt) + ry * Math.sin(th) * Math.cos(tilt)];
}

function orbitLine(p: Px, pt: Orbit, col: RGB, front: boolean, a = 140): void {
  for (let th = 0; th < Math.PI * 2; th += 0.018) {
    if (Math.sin(th) >= 0 !== front) continue;
    if (Math.floor(th / 0.06) % 3 === 2) continue;
    const [x, y] = pt(th);
    p.set(x, y, col, a);
  }
}

function orbitShips(p: Px, pt: Orbit, list: Array<keyof typeof SPR>, th0: number, front: boolean): void {
  list.forEach((kind, i) => {
    const th = th0 + i * ((Math.PI * 2) / list.length);
    if (Math.sin(th) >= 0 !== front) return;
    const [x, y] = pt(th);
    const [x2, y2] = pt(th + 0.06);
    blit(p, SPR[kind], x, y, Math.atan2(x2 - x, -(y2 - y)));
  });
}

function hole(p: Px, cx: number, cy: number, r: number, rx: number, tilt: number, seed: number, cols: RGB[]): void {
  const ry = rx * tilt;
  const inner = (r * 1.12) / rx;
  const W = Math.ceil(rx) + 2;
  const H = Math.ceil(ry) + 2;
  const col = (x: number, y: number): RGB | null => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    const q = Math.hypot(dx, dy);
    if (q > 1 || q < inner) return null;
    const t = 1 - (q - inner) / (1 - inner);
    const n = fbm(Math.atan2(dy, dx) * 2 + q * 6, q * 9, seed, 3);
    return rampPick(cols, clamp(t * 0.92 + (n - 0.45) * 0.5), x, y);
  };
  for (let y = cy - H; y < cy; y++) for (let x = cx - W; x <= cx + W; x++) {
    const c = col(x, y);
    if (c) p.set(x, y, c);
  }
  for (let y = cy - r - 1; y <= cy + r + 1; y++) {
    for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r) p.set(x, y, '#010208');
      else if (d <= r + 1.3) p.set(x, y, cols[cols.length - 2]);
      else if (d <= r * 1.5 && y < cy - r * 0.2) {
        const t = 1 - (d - r - 1.3) / (r * 0.5);
        if (t > 0) p.set(x, y, rampPick(cols, t * 0.8, x, y), Math.round(255 * clamp(t * 1.4)));
      }
    }
  }
  for (let y = cy; y <= cy + H; y++) for (let x = cx - W; x <= cx + W; x++) {
    const c = col(x, y);
    if (c) p.set(x, y, c);
  }
}

const HOLE_COLS = ramp(['#2a0a2a', '#7a1a4a', '#d03a3a', '#ff8a2a', '#ffd24a', '#fff4c0']);
const METAL = ramp(['#2e3548', '#5a647c', '#98a4c0', '#dce6f4']);

function ringShape(p: Px, cx: number, cy: number, r0: number, r1: number, seed: number, lightAng = -2.2): void {
  for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++) {
    for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < r0 || d > r1) continue;
      const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      const t = 0.5 + 0.5 * Math.cos(a - lightAng);
      p.set(x, y, rampPick(METAL, t * 0.85 + ((d - r0) / (r1 - r0)) * 0.15 + (vnoise(x * 0.6, y * 0.6, seed) - 0.5) * 0.2, x, y));
    }
  }
}

function glyph(p: Px, rows: string[], x0: number, y0: number, col: string, s = 1): void {
  rows.forEach((r, j) => [...r].forEach((ch, i) => {
    if (ch !== '#') return;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) p.set(x0 + i * s + dx, y0 + j * s + dy, col);
  }));
}

function line(p: Px, x0: number, y0: number, x1: number, y1: number, col: string, a = 255, dash = 0): void {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= n; i++) {
    if (dash && i % dash === dash - 1) continue;
    p.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, col, a);
  }
}

const ROCK = ramp(['#1d1a1f', '#3d3640', '#6a5e66', '#a3949a', '#d9ccce']);

function rock(p: Px, cx: number, cy: number, r: number, seed: number): void {
  for (let y = Math.floor(cy - r - 3); y <= Math.ceil(cy + r + 3); y++) {
    for (let x = Math.floor(cx - r - 3); x <= Math.ceil(cx + r + 3); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const rr = r * (0.72 + 0.5 * vnoise(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6, seed));
      if (d > rr) continue;
      const light = clamp(0.55 - (dx * 0.55 + dy * 0.5) / (rr * 1.5));
      const n = vnoise(x * 0.5, y * 0.5, seed + 3);
      p.set(x, y, rampPick(ROCK, light * 0.85 + (n - 0.5) * 0.35 + (d / rr > 0.85 ? -0.12 : 0), x, y));
    }
  }
}

function vein(p: Px, x: number, y: number): void {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) p.set(x + dx, y + dy, '#1a8a7a', 200);
  p.set(x, y, '#6ffff0');
}

interface IconSpec {
  kind: PointKind;
  seed: number;
  sector: SectorId;
  enemies: string[];
}

type ShipKind = keyof typeof SPR;
const enemyKinds = (list: string[]): ShipKind[] => list.map((e) => (e === 'raider' || e === 'hunter' || e === 'scout' || e === 'boss' ? e : 'scout'));

function iconCombat(p: Px, m: IconSpec, r: () => number): void {
  const cx = 32;
  const cy = 34;
  const pr = 14 + ((r() * 3) | 0);
  const pt = orbitPts(cx, cy, 29, 12, -0.28);
  const th0 = r() * 6;
  const band = r() < 0.4;
  const ships = enemyKinds(m.enemies).slice(0, 3);
  orbitLine(p, pt, [200, 90, 100], false);
  orbitShips(p, pt, ships, th0, false);
  planet(p, cx, cy, pr, SECTOR_LOOK[m.sector].planet, m.seed % 997, band);
  orbitLine(p, pt, [220, 110, 110], true);
  orbitShips(p, pt, ships, th0, true);
}

function iconElite(p: Px, m: IconSpec, r: () => number): void {
  const pt = orbitPts(32, 33, 28, 12, -0.22);
  const th0 = r() * 6;
  const ships = enemyKinds(m.enemies).slice(0, 3);
  while (ships.length < 3) ships.push('raider');
  orbitShips(p, pt, ships, th0, false);
  hole(p, 32, 33, 9, 24, 0.3, m.seed % 991, HOLE_COLS);
  orbitLine(p, pt, [255, 106, 90], true, 120);
  orbitShips(p, pt, ships, th0, true);
  for (let i = 0; i < 16; i++) {
    const a = r() * 6.28;
    const d = 24 + r() * 5;
    p.set(32 + Math.cos(a) * d, 33 + Math.sin(a) * d * 0.5, '#ff6a5a', 160);
  }
}

function iconBoss(p: Px, m: IconSpec, r: () => number): void {
  hole(p, 33, 38, 12, 31, 0.28, m.seed % 983, HOLE_COLS);
  blit(p, SPR.boss, 24, 21, -0.5);
  for (let i = 0; i < 4; i++) p.set(33 + (r() - 0.5) * 50, 36 + (r() - 0.5) * 22, '#ffb347', 200);
}

function iconDock(p: Px, m: IconSpec, r: () => number): void {
  planet(p, 51, 51, 8, SECTOR_LOOK[m.sector].planet, m.seed % 977);
  const cx = 28;
  const cy = 30;
  ringShape(p, cx, cy, 11, 15, m.seed);
  for (const a of [0, 1.57, 3.14, 4.71]) for (let d = 5; d < 11; d += 0.5) p.set(cx + Math.cos(a) * d, cy + Math.sin(a) * d, METAL[1]);
  for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 5; x <= cx + 5; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 5) p.set(x, y, '#141a2c');
  for (let i = -2; i <= 2; i++) {
    p.set(cx + i, cy, '#63e07a');
    p.set(cx, cy + i, '#63e07a');
  }
  p.set(cx, cy, '#d8ffe0');
  const lights: RGB[] = [hex('#59e6ff'), hex('#ffd24a')];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.set(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, lights[i % 2]);
  }
  blit(p, SPR.player, 50, 14, 0.5);
  for (let i = 0; i < 5; i++) p.set(44 + r() * 5, 20 + r() * 5, '#fff4c0', 220);
  line(p, 47, 18, 38, 24, '#63e07a', 150, 3);
  for (const [x, y] of [[8, 50], [14, 50], [11, 45]]) {
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) p.set(x + i, y + j, j === 0 ? '#ffe27a' : j === 4 ? '#8a5a10' : i === 2 ? '#a87a10' : '#e0a040');
  }
}

function iconShop(p: Px, _m: IconSpec, r: () => number): void {
  const gold = hex('#ffd24a');
  for (let x = 6; x <= 50; x++) {
    p.set(x, 31, METAL[2]);
    p.set(x, 32, METAL[1]);
    p.set(x, 33, METAL[0]);
  }
  const cols: Array<[string, string]> = [['#e0a040', '#a86c20'], ['#3fb8a0', '#1d7a68'], ['#c0603a', '#843a20'], ['#d8d0b8', '#8a8470'], ['#7a8cf0', '#4050a8']];
  const box = (x0: number, y0: number, c: number): void => {
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 7; x++) p.set(x0 + x, y0 + y, y === 0 ? hex(cols[c][0]).map((v) => Math.round(v * 0.65 + 89)) as RGB : y === 5 ? cols[c][1] : x === 3 ? cols[c][1] : cols[c][0]);
    }
  };
  [[8, 25], [16, 25], [24, 25], [32, 25], [40, 25]].forEach(([x, y], i) => box(x, y, (i + ((r() * 5) | 0)) % 5));
  [[12, 34], [20, 34], [28, 34], [36, 34]].forEach(([x, y], i) => box(x, y, (i * 2 + ((r() * 5) | 0)) % 5));
  for (let i = 0; i < 6; i++) p.set(9 + i * 7, 31, gold);
  for (let y = 6; y <= 18; y++) {
    for (let x = 24; x <= 38; x++) {
      const d = Math.hypot(x - 31, y - 12);
      if (d <= 6) p.set(x, y, d > 4.4 ? '#a87a10' : (x + y) % 2 ? '#ffd24a' : '#ffe27a');
    }
  }
  glyph(p, ['.#.', '###', '.#.'], 30, 11, '#7a5a08');
  blit(p, SPR.trader, 52, 50, -0.9);
  for (let i = 0; i < 5; i++) p.set(50 + (r() - 0.5) * 8, 56 + r() * 4, '#ffd24a', 150);
}

function iconMining(p: Px, m: IconSpec, r: () => number): void {
  rock(p, 38, 36, 12, m.seed % 101);
  rock(p, 52, 20, 6, (m.seed % 103) + 5);
  rock(p, 50, 52, 7, (m.seed % 107) + 9);
  for (const [x, y] of [[36, 33], [41, 40], [34, 41], [53, 21], [50, 53]]) vein(p, x, y);
  blit(p, SPR.player, 13, 48, 0.95);
  line(p, 19, 44, 34, 33, '#8ffff0', 230, 3);
  for (let i = 0; i < 7; i++) p.set(32 + r() * 6, 31 + r() * 5, '#e8fffa', 230);
  for (let i = 0; i < 8; i++) p.set(26 + r() * 20, 44 + r() * 14, '#9a8a90', 160);
}

const EVENT_RAMP = ramp(['#2a0a3a', '#6a1a7a', '#c02ab0', '#ff6ad8', '#ffd0f4']);

function iconEvent(p: Px, m: IconSpec): void {
  const cx = 30;
  const cy = 36;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.15) / 24;
      const n = fbm(x * 0.09, y * 0.09, m.seed % 89, 4);
      const v = (n - 0.2) * (1 - d * d) * 1.6;
      if (v > 0.08) p.set(x, y, rampPick(EVENT_RAMP, v, x, y));
    }
  }
  const piece = (x0: number, y0: number, w: number, h: number, sd: number): void => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const e = vnoise(x * 0.8, y * 0.8, sd);
        if (x === 0 && y % 2) continue;
        if (e < 0.28 && (x === w - 1 || y === h - 1)) continue;
        p.set(x0 + x, y0 + y, rampPick(METAL, 0.25 + (y / h) * 0.55 + (e - 0.5) * 0.3, x0 + x, y0 + y));
      }
    }
  };
  piece(21, 37, 14, 6, 3);
  piece(36, 29, 8, 4, 7);
  piece(14, 44, 6, 3, 9);
  p.set(24, 38, '#59e6ff');
  p.set(25, 38, '#59e6ff');
  p.set(24, 37, '#59e6ff', 120);
  for (const rr of [7, 11, 15]) for (let a = -1.25; a < -0.2; a += 0.03) p.set(24 + Math.cos(a) * rr, 37 + Math.sin(a) * rr, '#59e6ff', Math.round(230 - rr * 9));
  glyph(p, ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'], 46, 6, '#ffd24a', 2);
}

const GATE_RAMP = ramp(['#0a0420', '#2a1060', '#6a2ac0', '#b06bff', '#e8d0ff']);

function iconGate(p: Px, m: IconSpec): void {
  const cx = 32;
  const cy = 32;
  for (let y = 10; y <= 54; y++) {
    for (let x = 10; x <= 54; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > 16.5) continue;
      const sw = fbm(Math.atan2(dy, dx) * 1.4 + d * 0.18, d * 0.22, m.seed % 79, 3);
      p.set(x, y, rampPick(GATE_RAMP, 1 - d / 17 + (sw - 0.45) * 0.7, x, y));
    }
  }
  ringShape(p, cx, cy, 17, 21, 5);
  for (let a = 0; a < 6.283; a += 0.02) p.set(cx + Math.cos(a) * 16.4, cy + Math.sin(a) * 16.4, '#59e6ff', 220);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 6.283 + 0.39;
    const x = cx + Math.cos(a) * 21.5;
    const y = cy + Math.sin(a) * 21.5;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) p.set(x + dx, y + dy, dx === 0 && dy === 0 ? '#ffd0f4' : '#ff4fd8');
  }
}

const cache = new Map<string, HTMLCanvasElement>();

/** A fresh 64×64 canvas with the picture of a point; the drawing is cached by what it depends on. */
export function makePointIcon(m: IconSpec): HTMLCanvasElement {
  const key = `${m.kind}|${m.seed}|${m.sector}|${m.enemies.join()}`;
  let c = cache.get(key);
  if (!c) {
    const p = new Px(64, 64);
    const r = mulberry(m.seed);
    switch (m.kind) {
      case 'combat': iconCombat(p, m, r); break;
      case 'elite': iconElite(p, m, r); break;
      case 'boss': iconBoss(p, m, r); break;
      case 'dock': iconDock(p, m, r); break;
      case 'shop': iconShop(p, m, r); break;
      case 'mining': iconMining(p, m, r); break;
      case 'event': iconEvent(p, m); break;
      case 'gate': iconGate(p, m); break;
    }
    c = p.done();
    cache.set(key, c);
  }
  const out = document.createElement('canvas');
  out.width = 64;
  out.height = 64;
  out.getContext('2d')!.drawImage(c, 0, 0);
  return out;
}
