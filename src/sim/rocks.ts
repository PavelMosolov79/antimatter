import { ShipGrid } from './grid';
import { Mat } from './materials';
import { hash2, mulberry32 } from './rng';
import type { Celestial } from './gravity';

/**
 * Asteroids, as designed in «Космос Antimatter»: rocks of three sizes with lumpy outlines, craters, and glowing veins
 * (gold: metal, purple: antimatter ore). They are bodies of the world made of cells, like the wrecks of ships: they
 * can be shot at and hidden behind. Until something hits them they stay where they lie.
 */

const ROCK = [0x3a3531, 0x57504a, 0x7a7064, 0xa09483].map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255] as [number, number, number]);
const LIGHT = [-0.55, -0.6, 0.58];

/** A rock of radius r (cells) from a seed; ore 1 has gold veins, 2 purple ones. */
export function makeRock(seed: number, r: number, ore: 0 | 1 | 2): ShipGrid {
  const rng = mulberry32(seed * 7919 + 13);
  const p1 = rng() * 6.28;
  const p2 = rng() * 6.28;
  const p3 = rng() * 6.28;
  const size = Math.ceil(r * 2 * 1.5) + 4;
  const g = new ShipGrid(size, size, 1);
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const phi = Math.atan2(dy, dx);
      const rr = r * (1 + 0.22 * Math.sin(2 * phi + p1) + 0.14 * Math.sin(3 * phi + p2) + 0.08 * Math.sin(5 * phi + p3));
      if (d > rr) continue;
      g.setCell(x, y, 0, Mat.ROCK);
      const nx = dx / rr;
      const ny = dy / rr;
      const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, (d * d) / (rr * rr))));
      const lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      const li = Math.max(0, Math.min(3, Math.floor(lam * 3.3 + hash2(x, y, seed) - 0.3)));
      let col = ROCK[li];
      if (r > 8 && hash2(Math.floor(x * 0.5), Math.floor(y * 0.5), seed + 5) < 0.1) col = [col[0] * 0.62, col[1] * 0.62, col[2] * 0.62];
      const vein = ore && r > 6 && d < rr * 0.8 && hash2(Math.floor(x * 0.5), Math.floor(y * 0.5), seed + 90) < 0.18;
      if (vein) {
        const c = ore === 1 ? [255, 207, 90] : [255, 79, 216];
        g.setPaint(g.idx(x, y, 0), c[0], c[1], c[2], true);
      } else g.setPaint(g.idx(x, y, 0), col[0], col[1], col[2], false);
    }
  }
  return g;
}

export interface RockSpec {
  seed: number;
  r: number;
  ore: 0 | 1 | 2;
  x: number;
  y: number;
  angle: number;
}

/** Where the rocks of a field lie and what each is like; the same field is always the same. */
export function fieldRocks(field: Celestial): RockSpec[] {
  const rng = mulberry32(field.seed * 104729 + 7);
  const n = 16 + Math.floor(rng() * 14);
  const out: RockSpec[] = [];
  for (let i = 0; i < n; i++) {
    const t = rng();
    const r = t < 0.12 ? 22 + rng() * 18 : t < 0.4 ? 10 + rng() * 10 : 4 + rng() * 5;
    for (let tries = 0; tries < 30; tries++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * field.radius * 0.9;
      const x = field.x + Math.cos(a) * d;
      const y = field.y + Math.sin(a) * d;
      if (out.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + r) * 1.7 + 14)) continue;
      const ore: 0 | 1 | 2 = r > 8 && rng() < 0.4 ? (rng() < 0.5 ? 1 : 2) : 0;
      out.push({ seed: Math.floor(rng() * 1e6), r, ore, x, y, angle: rng() * Math.PI * 2 });
      break;
    }
  }
  return out;
}
