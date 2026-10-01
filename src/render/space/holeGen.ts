import type { HoleSpec } from '../../sim/space';
import { hex, rampPick, type RGB } from './noise';
import type { Picture } from './planetGen';

/**
 * A black hole picture, ported from the approved design: a dark core with a thin bright
 * ring, a hot accretion disk that is brighter on the side turning toward us, and the lensed
 * image of the disk's far side bent over the top and under the bottom of the core.
 */

const DISK = [0x5a0f08, 0xc4410f, 0xff9a2a, 0xffe7a0, 0xfff8e8].map(hex);

/**
 * The hole as a picture at time t (the disk turns), optionally painted over `into`, an
 * earlier picture of the same hole. ~24 pixels to the horizon, so a pixel is R0/24 cells
 * (at least one).
 */
export function renderHole(spec: HoleSpec, t = 0, into?: Picture): Picture {
  const texel = Math.max(1, spec.R0 / 24);
  const R0 = spec.R0 / texel;
  const k = R0 / 6;
  const a = 34 * k;
  const b = 8.5 * k;
  const W = Math.ceil(2 * (a + 5 * k)) + 2;
  const H = Math.ceil(2 * 32 * k) + 2;
  const data = into ? into.data : new Uint8ClampedArray(W * H * 4);
  if (into) data.fill(0);
  const tilt = -0.14;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const thick = 1.5 * Math.max(1, k * 0.7);
  const cx = W / 2;
  const cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      let col: RGB | null = null;
      const rx = dx * ct + dy * st;
      const ry = -dx * st + dy * ct;
      const e = Math.hypot(rx / a, ry / b);
      const ang = Math.atan2(ry / b, rx / a);
      const dop = 1 + 0.5 * (-rx / a);
      if (r < R0) col = [4, 4, 7];
      else if (r < R0 + thick) {
        const v = (0.85 + 0.35 * Math.sin(ang * 2 - t * 1.2)) * dop;
        col = rampPick(DISK, 0.6 + 0.4 * Math.min(1, v), x, y) ?? DISK[2];
      }
      const front = ry > 0;
      if (e >= 0.22 && e <= 1 && (front || r >= R0)) {
        const s = 0.5 + 0.5 * Math.sin(ang * 2 - t * 1.6 + e * 14);
        const v2 = Math.pow(1 - (e - 0.22) / 0.78, 1.25) * (0.45 + 0.75 * s) * dop;
        const c2 = rampPick(DISK, Math.min(1.1, v2), x, y);
        if (c2 && (front || !col || col[0] < 10)) col = c2;
      }
      const rl = r / R0;
      if (!col && ((ry < 0 && rl > 1.55 && rl < 2.45) || (ry >= 0 && rl > 1.5 && rl < 1.9))) {
        const fall = ry < 0 ? 1 - Math.abs(rl - 2.0) / 0.5 : 0.55 * (1 - Math.abs(rl - 1.7) / 0.2);
        const c3 = rampPick(DISK, Math.max(0, fall) * (0.7 + 0.3 * Math.sin(ang * 3 + t)) * dop * 0.95, x, y);
        if (c3) col = c3;
      }
      if (!col) continue;
      const o = (y * W + x) * 4;
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = 255;
    }
  }
  return { w: W, h: H, data, texel };
}
