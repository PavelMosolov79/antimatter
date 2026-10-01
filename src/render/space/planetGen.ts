import { hash2 } from '../../sim/rng';
import { planetType, type PlanetSpec } from '../../sim/space';
import { LIGHT, bayer, fbm3, hex, mix, mul, vn3, type RGB } from './noise';

/**
 * A planet picture from its spec, ported from the approved design. The surface is 3D noise
 * sampled on a sphere, quantised to five dithered steps of a palette, lit from the upper
 * left, with the atmosphere as a dithered halo and the ring as a flat ellipse.
 */

const RAMP = {
  rock: [0x2a2623, 0x463f39, 0x6b6258, 0x8e8374, 0xb5a994].map(hex),
  basalt: [0x0c0706, 0x1a0f0c, 0x2a1913, 0x3d261c, 0x543629].map(hex),
  lavaGlow: [0xc4310f, 0xff6a1a, 0xffb030, 0xfff0a0].map(hex),
  desert: [0x5a3418, 0x8a5224, 0xc2803a, 0xe0a860, 0xf2d29a].map(hex),
  water: [0x041838, 0x0a3470, 0x1559a6, 0x2f86c8, 0x78c0ea].map(hex),
  land: [0x1d4a22, 0x2f7a34, 0x5f9a3c, 0x9a8a52, 0xcfc4a4].map(hex),
  ice: [0x2a4a78, 0x4a7ab0, 0x86b4de, 0xc4e2f8, 0xf6fcff].map(hex),
  cloud: [0x7a8aa6, 0xc2cfe2, 0xf2f6ff].map(hex),
  gasTan: [0x5a2f1c, 0x8a502c, 0xc27d45, 0xe3a766, 0xf3d29c].map(hex),
  gasViolet: [0x2e2250, 0x56428a, 0x8a70b8, 0xb8a4dc, 0xe8dcf6].map(hex),
  gasCream: [0x6a5a44, 0x9a8666, 0xc8b48a, 0xe6d8b4, 0xf8f0d8].map(hex),
  iceTeal: [0x123a48, 0x226a7a, 0x44a0a8, 0x88d0c8, 0xe0f4ee].map(hex),
  iceBlue: [0x182a60, 0x2a4ca0, 0x4a80d8, 0x8cb8f4, 0xe0eeff].map(hex),
};

/** The colour of the atmosphere's halo, per type; rocky planets have none. */
export const ATMOSPHERE: Partial<Record<PlanetSpec['type'], RGB>> = {
  desert: hex(0xe0a060),
  ocean: hex(0x6cb8ff),
  ice: hex(0xbfe0ff),
  lava: hex(0xff6a3a),
  gas: hex(0xf0c890),
  icegiant: hex(0x8ae8e8),
};

function giantRamp(sp: PlanetSpec): RGB[] {
  return sp.type === 'gas' ? [RAMP.gasTan, RAMP.gasViolet, RAMP.gasCream][sp.palette % 3] : [RAMP.iceTeal, RAMP.iceBlue][sp.palette % 2];
}

function shiftPick(ramp: RGB[], lv: number, lam: number, x: number, y: number): RGB {
  const i = Math.max(0, Math.min(ramp.length - 1, lv + Math.floor((lam - 0.55) * 3.2 + bayer(x, y))));
  return ramp[i];
}
function lvl5(v: number, x: number, y: number): number {
  return Math.max(0, Math.min(4, Math.floor(v * 5 + (bayer(x, y) - 0.5) * 0.5)));
}

export interface Shade {
  c: RGB;
  /** The point glows (lava): it stays bright on the night side. */
  glow: boolean;
}
const shade: Shade = { c: [0, 0, 0], glow: false };

/** The colour of one point of the sphere; (nx, ny, nz) is its normal, facing the viewer. */
export function planetShade(sp: PlanetSpec, nx: number, ny: number, nz: number, t: number, x: number, y: number): Shade {
  const lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  const a = sp.rot + t * 0.012;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const qx = nx * ca + nz * sa;
  let qz = -nx * sa + nz * ca;
  let qy = ny;
  const ct = Math.cos(sp.tilt);
  const st = Math.sin(sp.tilt);
  const q1 = qy * ct - qz * st;
  const q2 = qy * st + qz * ct;
  qy = q1;
  qz = q2;
  const s = sp.seed * 7 + 3;
  let col: RGB;
  let glowing = false;
  switch (sp.type) {
    case 'gas':
    case 'icegiant': {
      const n = fbm3(qx * 2.4, qy * 5, qz * 2.4, s, 4);
      const b = 0.5 + 0.5 * Math.sin(qy * sp.bands + (n - 0.5) * 5);
      let lv = lvl5(b * 0.62 + n * 0.5, x, y);
      if (sp.storm) {
        const sd = qx * sp.sx + qy * sp.sy + qz * sp.sz;
        if (sd > 0.986) lv = Math.min(4, lv + 2);
        else if (sd > 0.972) lv = Math.max(0, lv - 1);
      }
      col = shiftPick(giantRamp(sp), lv, lam, x, y);
      break;
    }
    case 'rocky': {
      const e = fbm3(qx * 3.6, qy * 3.6, qz * 3.6, s, 5);
      const pit = vn3(qx * 13, qy * 13, qz * 13, s + 5);
      col = shiftPick(RAMP.rock, lvl5(e - (pit < 0.14 ? 0.2 : 0), x, y), lam, x, y);
      break;
    }
    case 'desert': {
      const d1 = fbm3(qx * 3, qy * 3, qz * 3, s, 5);
      const band = 0.5 + 0.5 * Math.sin(qy * 14 + d1 * 5);
      col = shiftPick(RAMP.desert, lvl5(band * 0.45 + d1 * 0.65, x, y), lam, x, y);
      break;
    }
    case 'ocean': {
      const h = fbm3(qx * 2.3, qy * 2.3, qz * 2.3, s, 5);
      if (Math.abs(qy) > 0.84 + (fbm3(qx * 5, qy * 5, qz * 5, s + 9, 3) - 0.5) * 0.14) col = shiftPick(RAMP.ice, lvl5(0.45 + h * 0.5, x, y), lam, x, y);
      else if (h < sp.sea) col = shiftPick(RAMP.water, Math.max(0, Math.min(4, Math.floor((1 - ((sp.sea - h) / sp.sea) * 1.5) * 5))), lam, x, y);
      else col = shiftPick(RAMP.land, lvl5(((h - sp.sea) / (1 - sp.sea)) * 1.1, x, y), lam, x, y);
      const c = fbm3(qx * 3.4 + t * 0.03, qy * 3.4, qz * 3.4, s + 21, 4);
      if (c > 0.6 + (bayer(x, y) - 0.5) * 0.1) col = shiftPick(RAMP.cloud, c > 0.7 ? 2 : 1, lam + 0.2, x, y);
      break;
    }
    case 'ice': {
      const ie = fbm3(qx * 3, qy * 3, qz * 3, s, 5);
      const crack = Math.abs(fbm3(qx * 7, qy * 7, qz * 7, s + 5, 3) - 0.5) < 0.018;
      col = shiftPick(RAMP.ice, crack ? 0 : lvl5(ie * 0.8 + 0.2, x, y), lam, x, y);
      break;
    }
    default: {
      const le = fbm3(qx * 3.6, qy * 3.6, qz * 3.6, s, 5);
      const cr = 1 - Math.abs(2 * fbm3(qx * 3, qy * 3, qz * 3, s + 3, 3) - 1);
      if (cr > 0.92) {
        col = RAMP.lavaGlow[Math.min(3, Math.floor(((cr - 0.92) / 0.08) * 4))];
        glowing = true;
      } else col = shiftPick(RAMP.basalt, lvl5(le * 0.9, x, y), lam, x, y);
    }
  }
  if (lam < 0.04 && !glowing) col = mul(col, 0.5);
  const atmo = ATMOSPHERE[sp.type];
  if (atmo && nz < 0.34 && lam > 0.15) col = mix(col, atmo, 0.4 * (1 - nz / 0.34));
  shade.c = col;
  shade.glow = glowing;
  return shade;
}

/** The ring's colour at (dx, dy) from the centre in the same units as R, or null; `front` says whether it passes in front of the planet. */
function ringAt(sp: PlanetSpec, dx: number, dy: number, R: number, out: { front: boolean }): RGB | null {
  const rot = -0.31 + sp.tilt * 0.3;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const rx = dx * cr + dy * sr;
  const ry = -dx * sr + dy * cr;
  const e = Math.hypot(rx / (R * 2.15), ry / (R * 0.5));
  if (e < 0.6 || e > 1) return null;
  const rr = (e - 0.6) / 0.4;
  if (rr > 0.5 && rr < 0.58) return null;
  const tone = 0.72 + 0.26 * Math.sin(rr * 47 + 1.3) + 0.2 * (hash2(Math.floor(rr * 60), 0, 3) - 0.5);
  const base = planetType(sp.type).giant ? hex(0xd9c8a4) : hex(0xb8b0a4);
  let c = mul(base, tone * (0.55 + 0.5 * (1 - rr)));
  const al = dx * LIGHT[0] + dy * LIGHT[1];
  const pp = Math.abs(dx * LIGHT[1] - dy * LIGHT[0]);
  if (al < 0 && pp < R * 0.95) c = mul(c, 0.33);
  out.front = ry > 0;
  return c;
}

export interface Picture {
  w: number;
  h: number;
  /** RGBA, transparent where nothing is painted. */
  data: Uint8ClampedArray;
  /** Cells per picture pixel: the sprite is scaled by this. */
  texel: number;
}

/**
 * The planet as a picture. The resolution is capped (a planet near two thousand cells
 * across can't have a pixel per cell), so a pixel here is a few cells wide — the planet
 * is seen from far away, and up close it looks coarse.
 *
 * It is painted by rows so that the game can redraw it for a later moment (the planet
 * turns, its clouds drift) a few rows per frame instead of all at once.
 */
export class PlanetPainter {
  readonly picture: Picture;
  private readonly Rt: number;
  private readonly atmT: number;

  constructor(private readonly sp: PlanetSpec) {
    const R = sp.R;
    const atm = ATMOSPHERE[sp.type] ? R * sp.atmoK : 0;
    const half = sp.ring ? R * 2.3 : R + atm + 2;
    const N = sp.ring ? 640 : 384;
    const texel = (2 * half) / N;
    this.Rt = R / texel;
    this.atmT = atm / texel;
    this.picture = { w: N, h: N, data: new Uint8ClampedArray(N * N * 4), texel };
  }

  /** Paints rows [y0, y1) of the planet as it is at time t (seconds). */
  paintRows(t: number, y0: number, y1: number): void {
    const { sp, Rt, atmT } = this;
    const { w: N, data } = this.picture;
    const front = { front: false };
    const mid = N / 2;
    const atmo = ATMOSPHERE[sp.type];
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - mid;
        const dy = y + 0.5 - mid;
        const d = Math.hypot(dx, dy);
        let col: RGB | null = null;
        const rc = sp.ring ? ringAt(sp, dx, dy, Rt, front) : null;
        if (d <= Rt) {
          const nx = dx / Rt;
          const ny = dy / Rt;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          col = planetShade(sp, nx, ny, nz, t, x, y).c;
        } else if (atmo && atmT > 0.4 && d <= Rt + atmT) {
          const f = 1 - (d - Rt) / atmT;
          const lam = (dx * LIGHT[0] + dy * LIGHT[1]) / d;
          if (lam > -0.1 && f * (0.5 + 0.6 * lam) > bayer(x, y)) col = mul(atmo, 0.5 + 0.6 * Math.max(0, lam));
        }
        if (rc && (front.front || !col)) col = rc;
        const o = (y * N + x) * 4;
        if (!col) {
          data[o + 3] = 0;
          continue;
        }
        data[o] = col[0];
        data[o + 1] = col[1];
        data[o + 2] = col[2];
        data[o + 3] = 255;
      }
    }
  }
}

/** The whole planet at time t. */
export function renderPlanet(sp: PlanetSpec, t = 0): Picture {
  const painter = new PlanetPainter(sp);
  painter.paintRows(t, 0, painter.picture.h);
  return painter.picture;
}
