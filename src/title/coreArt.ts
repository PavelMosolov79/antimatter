import { hash2 as hash } from '../sim/rng';

/**
 * The title screen's art, ported as-is from the approved design («Главное меню Antimatter»):
 * a star field with two nebulae, and the antimatter core — a containment ring with eight
 * magnetic clamps, a glass chamber with the field lattice, and the substance itself, a
 * cluster of drifting droplets that grows as the game loads. Everything is drawn pixel by
 * pixel at a small resolution and scaled up, like the game itself.
 */

type RGB = [number, number, number];

export const RIN = 41;
export const RRING = 51;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number): number => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mul = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

const C = {
  void: hex(0x05060c),
  hull: hex(0x8c96a8),
  armor: hex(0x5d6b82),
  dark: hex(0x2a3144),
  wall: hex(0x3b4460),
  field: hex(0x59e6ff),
  glass: hex(0x070918),
  a2: hex(0x5a16a0),
  a3: hex(0x9a2dff),
  rim: hex(0xff4fd8),
  edge: hex(0xffe6ff),
  white: hex(0xfff2ff),
  hazY: hex(0xe8c450),
  hazD: hex(0x141416),
  lamp: hex(0xff4fd8),
  lampOff: hex(0x1f5566),
};
const AMS: RGB[] = [hex(0x0c0216), hex(0x2c0a55), C.a2, C.a3];
/** Clamp angles, lit one by one clockwise from the top. */
const CLAMPS = Array.from({ length: 8 }, (_, k) => -Math.PI / 2 + (k * Math.PI) / 4 + Math.PI / 8);

// ------------------------------------------------------------------ nebulae

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, seed: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 5; o++) {
    s += amp * vnoise(x * f, y * f, seed + o * 17);
    f *= 2.03;
    amp *= 0.5;
  }
  return s / 0.97;
}
function blob(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return Math.max(0, 1 - (dx * dx + dy * dy));
}
const NEB_VIOLET = [0x0c0620, 0x1f0f3d, 0x3d1d68, 0x6c38a4, 0xa872e0].map(hex);
const NEB_ORANGE = [0x160904, 0x3d1707, 0x80320f, 0xd0621e, 0xffb36a].map(hex);
const NEB_GREEN = [0x03120c, 0x08291b, 0x115236, 0x21955f, 0x7af0b4].map(hex);
const level = (v: number, x: number, y: number, steps: number): number => Math.max(-1, Math.min(steps - 1, Math.floor(v * steps + bayer(x, y) - 0.5)));

export interface Ellipse {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** How strongly the nebulae are held back inside it (0..1). */
  k: number;
}

export interface SkyLayout {
  /** Nebula centres and radii as fractions of the screen. */
  violet: { x: number; y: number; rx: number; ry: number };
  green: { x: number; y: number; rx: number; ry: number };
  /** Places kept calm (the core, the logo, the captions), in pixels. */
  calm: Ellipse[];
}

export interface Sky {
  W: number;
  H: number;
  base: Float32Array;
  glow: Float32Array;
}

/** The sky for one screen size: two nebulae (violet with orange dust, green), stars, a few bright crosses. */
export function makeSky(W: number, H: number, layout: SkyLayout): Sky {
  const base = new Float32Array(W * H * 3);
  const glow = new Float32Array(W * H * 3);
  const V = layout.violet;
  const G = layout.green;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let c: RGB = [C.void[0], C.void[1], C.void[2]];
      let g: RGB | null = null;
      let calm = 1;
      for (const z of layout.calm) calm *= 1 - z.k * blob(x, y, z.x, z.y, z.rx, z.ry);
      const vd = fbm(x / 46, y / 40, 101) * 1.25 * blob(x, y, V.x * W, V.y * H, V.rx * W, V.ry * H);
      const wisp = 1 - Math.abs(2 * fbm(x / 22 + 3, y / 19, 131) - 1);
      const dust = fbm(x / 30 + 9, y / 26, 151);
      const vn = vd * (0.7 + 0.5 * wisp) * calm;
      const li = level(vn, x, y, 5);
      if (li >= 0) {
        const pal = dust > 0.56 && wisp > 0.55 ? NEB_ORANGE : NEB_VIOLET;
        c = [pal[li][0], pal[li][1], pal[li][2]];
        if (li >= 3) g = mul(pal[li], 0.28);
      }
      const gd = fbm(x / 38 + 20, y / 34, 171) * 1.3 * blob(x, y, G.x * W, G.y * H, G.rx * W, G.ry * H);
      const gw = 1 - Math.abs(2 * fbm(x / 18 + 7, y / 16, 191) - 1);
      const gn = gd * (0.65 + 0.55 * gw) * calm;
      const gi = level(gn, x, y, 5);
      if (gi >= 0) {
        const gc = NEB_GREEN[gi];
        c = li >= 0 ? [Math.min(255, c[0] + gc[0] * 0.7), Math.min(255, c[1] + gc[1] * 0.7), Math.min(255, c[2] + gc[2] * 0.7)] : [gc[0], gc[1], gc[2]];
        if (gi >= 3) g = mul(gc, 0.3);
      }
      if ((li >= 1 || gi >= 1) && Math.abs(fbm(x / 26 + 40, y / 20, 211) - 0.5) < 0.035) c = mul(c, 0.45);
      const cloud = Math.max(vn, gn);
      const sr = hash(x, y, 7);
      if (sr < 0.004 + 0.01 * cloud) c = mix([170, 176, 215], [255, 255, 255], hash(x, y, 8));
      else if (sr < 0.01 + 0.012 * cloud) c = mix(c, [110, 118, 160], 0.6);
      base[i * 3] = c[0];
      base[i * 3 + 1] = c[1];
      base[i * 3 + 2] = c[2];
      if (g) {
        glow[i * 3] = g[0];
        glow[i * 3 + 1] = g[1];
        glow[i * 3 + 2] = g[2];
      }
    }
  }
  const stars = Math.round((W * H) / 2600);
  for (let n = 0; n < stars; n++) {
    const sx = Math.floor(hash(n, 1, 77 + W) * W);
    const sy = Math.floor(hash(n, 2, 77 + H) * H);
    if (layout.calm.some((z) => blob(sx, sy, z.x, z.y, z.rx, z.ry) > 0.1)) continue;
    const tint: RGB = hash(n, 3, 77) < 0.5 ? [255, 236, 210] : [210, 236, 255];
    for (const [ox, oy, w] of [
      [0, 0, 1],
      [1, 0, 0.45],
      [-1, 0, 0.45],
      [0, 1, 0.45],
      [0, -1, 0.45],
    ]) {
      const xx = sx + ox;
      const yy = sy + oy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const ii = yy * W + xx;
      const m = mix([base[ii * 3], base[ii * 3 + 1], base[ii * 3 + 2]], tint, w);
      base[ii * 3] = m[0];
      base[ii * 3 + 1] = m[1];
      base[ii * 3 + 2] = m[2];
      if (w === 1) {
        glow[ii * 3] = tint[0] * 0.6;
        glow[ii * 3 + 1] = tint[1] * 0.6;
        glow[ii * 3 + 2] = tint[2] * 0.6;
      }
    }
  }
  return { W, H, base, glow };
}

// ------------------------------------------------------------------ the core sprite

const enum K {
  None = 0,
  Chamber = 1,
  Lamp = 2,
  Metal = 3,
}

interface CoreSprite {
  x0: number;
  y0: number;
  w: number;
  h: number;
  col: Float32Array;
  kind: Uint8Array;
  lamp: Int8Array;
}

/** The core in its own coordinates (origin at its centre): ring, clamps and, optionally, the pedestal. */
function makeCoreSprite(withPedestal: boolean): CoreSprite {
  const x0 = -66;
  const y0 = -60;
  const w = 132;
  const h = 128;
  const col = new Float32Array(w * h * 3);
  const kind = new Uint8Array(w * h);
  const lamp = new Int8Array(w * h).fill(-1);
  const pedTop = RRING - 9;
  const pedH = 24;
  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx < w; lx++) {
      const X = lx + x0;
      const Y = ly + y0;
      const i = ly * w + lx;
      const dx = X + 0.5;
      const dy = Y + 0.5;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      let c: RGB | null = null;
      // pedestal: a trapezoid cradle under the ring with a hazard-striped lip
      const half = 34 + (Y - pedTop) * 1.3;
      if (withPedestal && Y >= pedTop && Y < pedTop + pedH && Math.abs(dx) <= half) {
        const shade = 0.55 + 0.25 * hash(Math.floor((X + 200) / 6), Math.floor((Y + 200) / 5), 3);
        c = mul(C.wall, shade * ((X + 400) % 12 === 0 ? 0.8 : 1));
        if (Y < pedTop + 3) c = Math.floor((X + Y + 800) / 3) % 2 === 0 ? C.hazY : C.hazD;
        else if (Math.abs(dx) > half - 1.5 || Y === pedTop + pedH - 1) c = mul(C.wall, 0.4);
        else if (Y === pedTop + 3) c = mul(C.hull, 0.9);
        if (Y > pedTop + 8 && Y < pedTop + 11 && Math.abs(dx) < 24 && (X + 400) % 6 === 0) c = [90, 220, 255];
      }
      // containment ring: bevelled metal lit from the upper left, with seams and rivets
      if (d >= RIN && d < RRING) {
        const lit = 0.72 + 0.42 * Math.max(0, Math.cos(a + Math.PI * 0.75));
        c = mul(d > RRING - 2.2 ? C.armor : C.hull, lit);
        if (d < RIN + 1.3) c = mul(C.hull, 1.25);
        else if (d > RRING - 1.1) c = mul(C.armor, 0.55);
        if (Math.abs(angDiff(a * 6, 0)) < 0.09 * 6 && d > RIN + 1.3) c = mul(c, 0.62);
        if (Math.abs(d - (RIN + RRING) / 2) < 0.8 && Math.abs(Math.sin(a * 12)) < 0.13) c = mix(c, [230, 236, 255], 0.5);
      }
      if (c) {
        kind[i] = K.Metal;
        col[i * 3] = c[0];
        col[i * 3 + 1] = c[1];
        col[i * 3 + 2] = c[2];
      }
      // eight magnetic clamps bolted across the ring, each with a lamp strip
      for (let k = 0; k < 8; k++) {
        const across = Math.abs(angDiff(a, CLAMPS[k])) * d;
        if (d >= RRING - 5 && d <= RRING + 5 && across <= 4) {
          let cc = mul(C.dark, 1.05 + 0.25 * Math.max(0, Math.cos(a + Math.PI * 0.75)));
          if (across > 3.2 || d > RRING + 4) cc = mul(C.dark, 0.6);
          kind[i] = K.Metal;
          col[i * 3] = cc[0];
          col[i * 3 + 1] = cc[1];
          col[i * 3 + 2] = cc[2];
          if (across <= 1.3 && d >= RRING - 3 && d <= RRING + 3) {
            kind[i] = K.Lamp;
            lamp[i] = k;
          }
        }
      }
      if (d < RIN) kind[i] = K.Chamber;
    }
  }
  return { x0, y0, w, h, col, kind, lamp };
}

let spriteStand: CoreSprite | null = null;
let spriteBare: CoreSprite | null = null;
const sprite = (bare: boolean): CoreSprite =>
  bare ? (spriteBare ??= makeCoreSprite(false)) : (spriteStand ??= makeCoreSprite(true));

// ------------------------------------------------------------------ pipes

const CHANNEL: RGB = [34, 78, 96];
/** A pipe cross-section: `across` is the offset from its axis, `along` runs down its length (for the flanges). */
function pipeColor(along: number, across: number): RGB | null {
  const ad = Math.abs(across + 0.5);
  if (ad > 4) return null;
  if (ad <= 0.6) return CHANNEL;
  let c = mul(C.armor, 0.75 + 0.35 * (1 - (across + 4) / 8));
  if (ad > 3.2) c = C.dark;
  if ((((along % 18) + 18) % 18) < 2) c = mul(C.hull, 1.05);
  return c;
}
/** The junction box at a pipe's bend: bevelled casing, corner bolts, a status light. */
function junction(bx: number, by: number): RGB {
  const ax = Math.abs(bx);
  const ay = Math.abs(by);
  if (ax > 4.6 || ay > 4.6) return bx < 0 || by < 0 ? mul(C.hull, 1.05) : mul(C.dark, 0.7);
  if (ax > 3.4 && ay > 3.4) return mix(C.hull, [230, 236, 255], 0.4);
  if (ax < 1.1 && ay < 1.1) return [90, 220, 255];
  return mul(C.armor, 0.9 + 0.12 * (by < 0 ? 1 : 0));
}

// ------------------------------------------------------------------ the scene

const CELLS = Array.from({ length: 7 }, (_, c) => ({
  ph: hash(c, 1, 11) * 6.283,
  sp: (hash(c, 2, 11) - 0.5) * 1.1,
  orb: 0.25 + hash(c, 3, 11) * 0.55,
  rf: 0.42 + hash(c, 4, 11) * 0.26,
  wob: hash(c, 5, 11) * 6.283,
}));

interface Cell {
  x: number;
  y: number;
  r2: number;
}

export interface SceneOptions {
  /** The left feed pipe turns down to the floor through a junction box (keeps a menu clear). */
  leftDown?: boolean;
  /** The core floats on its pipes, no pedestal. */
  bare?: boolean;
}

/** The sky plus a core that can sit anywhere, with its pulses, motes and sparks. */
export class CoreScene {
  /** Fill 0..1 — how much antimatter is in the chamber. */
  p = 0;
  t = 0;
  /** 0..1: a menu item is hovered — more sparks, faster pulses. */
  excite = 0;
  /** 1 on a menu choice, decaying: a burst of energy. */
  flash = 0;
  cx: number;
  cy: number;
  leftDown: boolean;
  private spr: CoreSprite;
  private sparks: Array<{ x: number; y: number; life: number }> = [];
  private pulses: Array<{ side: number; x: number; v: number }> = [];
  private motes: Array<{ side: number; r: number; a: number; v: number }> = [];

  constructor(
    public sky: Sky,
    cx: number,
    cy: number,
    opts: SceneOptions = {},
  ) {
    this.cx = cx;
    this.cy = cy;
    this.leftDown = !!opts.leftDown;
    this.spr = sprite(!!opts.bare);
  }

  setBare(bare: boolean): void {
    this.spr = sprite(bare);
  }

  get W(): number {
    return this.sky.W;
  }
  get H(): number {
    return this.sky.H;
  }

  private field(x: number, y: number, cells: Cell[]): number {
    let f = 0;
    for (const c of cells) {
      const dx = x - c.x;
      const dy = y - c.y;
      f += c.r2 / (dx * dx + dy * dy + 0.6);
    }
    return f;
  }

  private cells(): Cell[] {
    const p = this.p;
    const t = this.t;
    const ccx = Math.round(this.cx);
    const ccy = Math.round(this.cy);
    const Rb = p < 0.015 ? 1.6 + p * 60 : (RIN - 2) * Math.sqrt(p) * 1.02;
    return CELLS.map((c) => {
      const a = c.ph + t * c.sp * (1 + this.excite * 1.5);
      const o = c.orb * Rb * 0.55 * (0.85 + 0.15 * Math.sin(t * 0.9 + c.wob));
      const r = Rb * c.rf * (0.92 + 0.08 * Math.sin(t * 1.7 + c.wob));
      return { x: ccx + Math.cos(a) * o, y: ccy + Math.sin(a) * o, r2: r * r };
    });
  }

  step(dt: number, active: boolean): void {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const p = this.p;
    const ccx = Math.round(this.cx);
    const rate = (active ? 0.6 + 2.2 * p : 0.3) + this.excite * 4 + this.flash * 10;
    const leftEnd = ccx - RRING;
    const rightLen = this.W - 1 - (ccx + RRING);
    if (Math.random() < rate * dt * 6) {
      const side = Math.random() < 0.5 ? -1 : 1;
      if ((side < 0 && leftEnd > 6 && !this.leftDown) || (side > 0 && rightLen > 6)) this.pulses.push({ side, x: 0, v: 55 + 50 * p + 70 * this.excite });
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const q = this.pulses[i];
      q.x += q.v * dt;
      if ((q.side < 0 && q.x >= leftEnd) || (q.side > 0 && q.x >= rightLen)) {
        this.pulses.splice(i, 1);
        if (p > 0.01) this.motes.push({ side: q.side, r: RIN - 1, a: q.side < 0 ? Math.PI : 0, v: 30 + 20 * Math.random() });
      }
    }
    for (let m = this.motes.length - 1; m >= 0; m--) {
      const o = this.motes[m];
      o.r -= o.v * dt;
      o.a += 0.8 * dt * o.side;
      if (o.r < 2) this.motes.splice(m, 1);
    }
    for (let s = this.sparks.length - 1; s >= 0; s--) {
      this.sparks[s].life -= dt;
      if (this.sparks[s].life <= 0) this.sparks.splice(s, 1);
    }
  }

  /** Draws the frame: crisp pixels into `img`, the parts that glow into `glow` (shown blurred). */
  render(img: ImageData, glow: ImageData): void {
    const W = this.W;
    const H = this.H;
    const sky = this.sky;
    const p = this.p;
    const t = this.t;
    const cells = this.cells();
    const ccx = Math.round(this.cx);
    const ccy = Math.round(this.cy);
    const SPR = this.spr;
    const fillAll = smooth(0.86, 1, p) * 1.25;
    const boost = this.excite * 0.5 + this.flash;
    const d8 = img.data;
    const g8 = glow.data;
    const lampsLit = Math.floor(p * 8 + 1e-6);
    const tries = Math.floor(4 + 36 * p + 40 * this.excite + 120 * this.flash);
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * 6.283;
      const rx = ccx + Math.cos(a) * (RIN - 2.5);
      const ry = ccy + Math.sin(a) * (RIN - 2.5);
      if (this.field(rx, ry, cells) + fillAll > 0.9 && Math.random() < 0.35) {
        this.sparks.push({ x: Math.round(ccx + Math.cos(a) * (RIN - 1) - 0.5), y: Math.round(ccy + Math.sin(a) * (RIN - 1) - 0.5), life: 0.06 + Math.random() * 0.12 });
      }
    }
    const frame = Math.floor(t * 8);
    const bend = ccx - RRING - 10;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const o = i * 4;
        let col: RGB;
        let em: RGB | null = null;
        const lx = x - ccx - SPR.x0;
        const ly = y - ccy - SPR.y0;
        let kd = K.None as number;
        let si = -1;
        if (lx >= 0 && ly >= 0 && lx < SPR.w && ly < SPR.h) {
          si = ly * SPR.w + lx;
          kd = SPR.kind[si];
        }
        if (kd === K.Chamber) {
          const px = x + 0.5;
          const py = y + 0.5;
          const d = Math.hypot(px - ccx, py - ccy);
          const an = Math.atan2(py - ccy, px - ccx);
          const f = this.field(px, py, cells) + fillAll;
          if (f >= 1) {
            if (f < 1.07) {
              col = C.edge;
              em = C.edge;
            } else if (f < 1.32) {
              col = mix(C.rim, C.a3, (f - 1.07) / 0.25);
              em = mul(C.rim, 0.9 + boost * 0.4);
            } else {
              const sw =
                0.5 +
                0.18 * Math.sin(px * 0.19 + Math.sin(py * 0.12 + t * 0.7) * 2.2 + t * 0.9) +
                0.17 * Math.sin(py * 0.23 - px * 0.07 - t * 1.3) +
                0.15 * Math.sin(d * 0.35 - t * 1.8);
              const depth = Math.min(1, (f - 1.32) / 1.6);
              const v = sw * (1 - 0.45 * depth) + 0.12 + boost * 0.12;
              const li = Math.max(0, Math.min(3, Math.floor(v * 3.6 + bayer(x, y) - 0.5)));
              col = AMS[li];
              if (li === 3) em = mul(C.a3, 0.35 + boost * 0.3);
              if (hash(x, y, frame) < 0.0035 + boost * 0.004) {
                col = C.white;
                em = C.white;
              }
            }
          } else {
            col = C.glass;
            const ring = d % 7 < 0.7;
            const spoke = Math.abs(Math.sin(6 * (an - t * 0.12))) < 0.05 * (8 / Math.max(d, 4));
            if (ring || spoke) col = mix(C.glass, C.field, 0.16 + bayer(x, y) * 0.06);
            if (d > RIN - 2.6) {
              const sh = 0.35 + 0.3 * Math.sin(an * 9 - t * 3.2) + 0.2 * Math.sin(an * 23 + t * 5);
              col = mix(C.glass, C.field, Math.max(0.1, sh));
              em = mul(C.field, Math.max(0, sh) * 0.7);
            } else if (f > 0.62) {
              const halo = (f - 0.62) / 0.38;
              if (halo * 0.9 > bayer(x, y)) col = mix(C.glass, C.a2, 0.55);
            }
          }
        } else if (kd === K.Lamp) {
          const lit = SPR.lamp[si] < lampsLit;
          col = lit ? C.lamp : C.lampOff;
          if (lit) {
            const pulse = 0.75 + 0.25 * Math.sin(t * (4 + this.excite * 6) + SPR.lamp[si]);
            col = mul(C.lamp, pulse + 0.25 + this.flash * 0.4);
            em = mul(C.lamp, pulse + this.flash);
          }
        } else if (kd === K.Metal) {
          col = [SPR.col[si * 3], SPR.col[si * 3 + 1], SPR.col[si * 3 + 2]];
        } else {
          let pc: RGB | null = null;
          if (this.leftDown && x < ccx) {
            // elbow: from the ring out to a junction box, then straight down to the floor
            const bx = x + 0.5 - bend;
            const by = y + 0.5 - ccy;
            if (Math.abs(bx) <= 5.5 && Math.abs(by + 0.5) <= 5.5) pc = junction(bx, by + 0.5);
            else if (x > bend) pc = pipeColor(x, y + 0.5 - ccy);
            else if (y > ccy) pc = pipeColor(y, x + 0.5 - bend);
          } else pc = pipeColor(x, y + 0.5 - ccy);
          if (pc) col = pc;
          else {
            col = [sky.base[i * 3], sky.base[i * 3 + 1], sky.base[i * 3 + 2]];
            if (sky.glow[i * 3] + sky.glow[i * 3 + 1] + sky.glow[i * 3 + 2] > 0) em = [sky.glow[i * 3], sky.glow[i * 3 + 1], sky.glow[i * 3 + 2]];
          }
        }
        d8[o] = col[0];
        d8[o + 1] = col[1];
        d8[o + 2] = col[2];
        d8[o + 3] = 255;
        if (em) {
          g8[o] = em[0];
          g8[o + 1] = em[1];
          g8[o + 2] = em[2];
          g8[o + 3] = 255;
        } else {
          g8[o] = 0;
          g8[o + 1] = 0;
          g8[o + 2] = 0;
          g8[o + 3] = 0;
        }
      }
    }
    const dot = (x: number, y: number, c: RGB, ge: RGB | null) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const o = (y * W + x) * 4;
      d8[o] = c[0];
      d8[o + 1] = c[1];
      d8[o + 2] = c[2];
      if (ge) {
        g8[o] = ge[0];
        g8[o + 1] = ge[1];
        g8[o + 2] = ge[2];
        g8[o + 3] = 255;
      }
    };
    for (const q of this.pulses) {
      for (let k = 0; k < 4; k++) {
        const x = q.side < 0 ? q.x - k : W - 1 - q.x + k;
        const c = mul(C.field, 1.1 - k * 0.22);
        dot(x, ccy - 1, c, c);
      }
    }
    for (const m of this.motes) {
      const c = m.r < RIN * 0.6 ? C.a3 : C.field;
      dot(ccx + Math.cos(m.a) * m.r - 0.5, ccy + Math.sin(m.a) * m.r - 0.5, c, c);
    }
    const dim = mul(C.field, 0.9);
    for (const s of this.sparks) {
      dot(s.x, s.y, C.white, C.white);
      dot(s.x + 1, s.y, dim, dim);
      dot(s.x - 1, s.y, dim, dim);
      dot(s.x, s.y + 1, dim, dim);
      dot(s.x, s.y - 1, dim, dim);
    }
  }
}
