import type { SectorId } from '../../sim/space';
import { bayer, hex, mul, smooth, tfbm, type RGB } from './noise';

/**
 * Sector skies, ported from the approved design: two nebula layers (five dithered steps,
 * a second palette as an accent, dark filaments) and a layer of dark dust. They are tiles
 * that wrap, so the sky can be scrolled for ever; each sector has its own palette.
 */

export const SKY_TILE = 256;

const RAMPS = {
  violet: [0x0c0620, 0x1f0f3d, 0x3d1d68, 0x6c38a4, 0xa872e0].map(hex),
  orange: [0x160904, 0x3d1707, 0x80320f, 0xd0621e, 0xffb36a].map(hex),
  green: [0x03120c, 0x08291b, 0x115236, 0x21955f, 0x7af0b4].map(hex),
  teal: [0x02141a, 0x07303a, 0x0f5a68, 0x1f9aa8, 0x84ecf2].map(hex),
  crimson: [0x14040a, 0x3a0a18, 0x7a1426, 0xc42a3a, 0xff7a78].map(hex),
  ember: [0x120704, 0x40150a, 0x8a3012, 0xe0661e, 0xffc07a].map(hex),
  ice: [0x050c1c, 0x0d2250, 0x1d4a96, 0x4a8fe0, 0xbfe0ff].map(hex),
  frost: [0x06141c, 0x0f3646, 0x1f6a84, 0x59b4d0, 0xe6faff].map(hex),
  haze: [0x07080f, 0x10142a, 0x1c2348, 0x2d3a6e, 0x55689e].map(hex),
};

interface NebulaCfg {
  seed: number;
  lo: number;
  hi: number;
  gain: number;
  A: RGB[];
  B: RGB[];
  /** Share of the cloud painted in the second palette: higher means less of it; 1 means none. */
  accent: number;
}
interface DustCfg {
  seed: number;
  lo: number;
  hi: number;
  gain: number;
}
export interface SkyLook {
  far: NebulaCfg;
  near: NebulaCfg;
  dust: DustCfg;
}

export const SKY_LOOKS: Record<SectorId, SkyLook> = {
  violet: {
    far: { seed: 101, lo: 0.4, hi: 0.78, gain: 1.0, A: RAMPS.violet, B: RAMPS.orange, accent: 0.6 },
    near: { seed: 211, lo: 0.46, hi: 0.82, gain: 0.8, A: RAMPS.violet, B: RAMPS.ember, accent: 0.66 },
    dust: { seed: 303, lo: 0.45, hi: 0.8, gain: 0.9 },
  },
  green: {
    far: { seed: 131, lo: 0.38, hi: 0.76, gain: 1.0, A: RAMPS.green, B: RAMPS.teal, accent: 0.58 },
    near: { seed: 241, lo: 0.48, hi: 0.84, gain: 0.7, A: RAMPS.teal, B: RAMPS.green, accent: 0.7 },
    dust: { seed: 333, lo: 0.5, hi: 0.85, gain: 0.7 },
  },
  crimson: {
    far: { seed: 161, lo: 0.36, hi: 0.72, gain: 1.1, A: RAMPS.crimson, B: RAMPS.ember, accent: 0.64 },
    near: { seed: 271, lo: 0.42, hi: 0.78, gain: 0.95, A: RAMPS.crimson, B: RAMPS.crimson, accent: 1 },
    dust: { seed: 363, lo: 0.4, hi: 0.75, gain: 1.15 },
  },
  ice: {
    far: { seed: 191, lo: 0.44, hi: 0.8, gain: 0.9, A: RAMPS.ice, B: RAMPS.frost, accent: 0.62 },
    near: { seed: 281, lo: 0.5, hi: 0.86, gain: 0.7, A: RAMPS.frost, B: RAMPS.ice, accent: 0.7 },
    dust: { seed: 393, lo: 0.5, hi: 0.85, gain: 0.6 },
  },
  clear: {
    far: { seed: 221, lo: 0.55, hi: 0.9, gain: 0.55, A: RAMPS.haze, B: RAMPS.haze, accent: 1 },
    near: { seed: 291, lo: 0.62, hi: 0.95, gain: 0.35, A: RAMPS.haze, B: RAMPS.haze, accent: 1 },
    dust: { seed: 423, lo: 0.6, hi: 0.9, gain: 0.4 },
  },
};

/** One nebula tile as RGBA (transparent where there is no cloud). */
export function makeNebulaTile(cfg: NebulaCfg, shift: number, T = SKY_TILE): Uint8ClampedArray {
  const out = new Uint8ClampedArray(T * T * 4);
  const s = cfg.seed + shift;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const u = x / T;
      const v = y / T;
      const cloud = smooth(cfg.lo, cfg.hi, tfbm(u, v, 2, s, 5)) * cfg.gain;
      if (cloud <= 0.02) continue;
      const wisp = 1 - Math.abs(2 * tfbm(u, v, 3, s + 31, 4) - 1);
      const val = cloud * (0.55 + 0.65 * wisp);
      const b = bayer(x, y);
      let lvl = Math.floor(val * 5 + b - 0.5);
      if (lvl < 0) continue;
      if (lvl > 4) lvl = 4;
      const hue = tfbm(u, v, 3, s + 77, 3);
      const useB = cfg.accent < 1 && hue + (b - 0.5) * 0.12 > cfg.accent;
      let col: RGB = (useB ? cfg.B : cfg.A)[lvl];
      if (lvl >= 1 && Math.abs(tfbm(u, v, 4, s + 101, 3) - 0.5) < 0.028) col = mul(col, 0.45);
      const o = (y * T + x) * 4;
      out[o] = col[0];
      out[o + 1] = col[1];
      out[o + 2] = col[2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/** The dust tile: thin ridged filaments in three steps of translucent black. */
export function makeDustTile(cfg: DustCfg, shift: number, T = SKY_TILE): Uint8ClampedArray {
  const out = new Uint8ClampedArray(T * T * 4);
  const s = cfg.seed + shift;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const u = x / T;
      const v = y / T;
      const den = tfbm(u, v, 2, s, 5);
      const fil = 1 - Math.abs(2 * tfbm(u, v, 3, s + 9, 5) - 1);
      const val = smooth(cfg.lo, cfg.hi, den) * Math.pow(fil, 2.2) * cfg.gain * 1.6;
      let lvl = Math.floor(val * 3 + bayer(x, y) - 0.5);
      if (lvl < 0) continue;
      if (lvl > 2) lvl = 2;
      const o = (y * T + x) * 4;
      out[o] = 6;
      out[o + 1] = 4;
      out[o + 2] = 12;
      out[o + 3] = [120, 175, 225][lvl];
    }
  }
  return out;
}

export interface SkyTiles {
  size: number;
  far: Uint8ClampedArray;
  near: Uint8ClampedArray;
  dust: Uint8ClampedArray;
}

/** The three sky layers of a sector; `seed` moves the clouds about so no two arenas look alike. */
export function generateSky(sector: SectorId, seed: number): SkyTiles {
  const look = SKY_LOOKS[sector];
  const shift = (Math.abs(Math.floor(seed)) % 997) * 13;
  return {
    size: SKY_TILE,
    far: makeNebulaTile(look.far, shift),
    near: makeNebulaTile(look.near, shift + 7),
    dust: makeDustTile(look.dust, shift + 3),
  };
}
