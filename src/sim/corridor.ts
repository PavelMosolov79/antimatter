import type { Celestial } from './gravity';
import { isSolid } from './gravity';
import { ShipGrid } from './grid';
import { Mat } from './materials';
import { mulberry32 } from './rng';

/**
 * The way of a mission (GDD 9.3.2, «Насыщенный космос»): the corridor from the start to the beacon is no longer
 * empty. Along it lie 4–7 places — a cluster of rocks (some with ore), the debris of an old fight with a container
 * in it (and, now and then, an ambush), an old minefield — and between them single rocks and pieces of hull. Buoys
 * mark the way. Everything is laid out from the point's seed, clear of planets, fields and the task's own place.
 * Pure: the game spawns what this returns.
 */

export const CORRIDOR = {
  /** Places: one per this many cells of the way (4 to 7), kept this far apart along it and this far off its line at most. */
  placeEvery: 550,
  minPlaces: 4,
  maxPlaces: 7,
  side: 350,
  /** No place this near the start, the beacon, or the task's place. */
  clearStart: 350,
  clearBeacon: 300,
  clearSite: 500,
  /** Kept off anything big by this much. */
  clearBig: 120,
  /**
   * Single things between the places: near the line one per this many cells of the way (this far off it at most),
   * so every screen of the way has a few things on it; further out, sparser. A screen is ~270×170 cells.
   */
  scatterEvery: 26,
  scatterSide: 260,
  outerEvery: 120,
  outerSide: 700,
  /** Buoys mark the way every this many cells, this far to each side of the line. */
  buoyEvery: 420,
  buoyOff: 260,
  /** The share of debris places with an ambush in them. */
  ambushShare: 0.5,
};

export type PlaceKind = 'rocks' | 'debris' | 'mines';

export interface RockSpec {
  x: number;
  y: number;
  r: number;
  ore: 0 | 1 | 2;
  seed: number;
}

export interface ChunkSpec {
  x: number;
  y: number;
  size: number;
  seed: number;
}

export interface CorridorPlan {
  places: Array<{ kind: PlaceKind; x: number; y: number; ambush: boolean }>;
  rocks: RockSpec[];
  chunks: ChunkSpec[];
  mines: Array<{ x: number; y: number }>;
  loot: Array<{ x: number; y: number; credits: number; metal: number }>;
  buoys: Array<{ x: number; y: number; red: boolean }>;
}

type P = { x: number; y: number };

function clearOf(celestials: Celestial[], x: number, y: number, pad: number): boolean {
  return celestials.every((c) => {
    const big = isSolid(c) || c.kind === 'asteroids' || c.kind === 'blackhole' || c.kind === 'wreck' || c.kind === 'storm';
    return !big || Math.hypot(c.x - x, c.y - y) > c.radius + pad;
  });
}

export function planCorridor(seed: number, tier: number, start: P, beacon: P, site: P | null, celestials: Celestial[]): CorridorPlan {
  const rng = mulberry32(seed * 2654435761 + 977);
  const dx = beacon.x - start.x;
  const dy = beacon.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const at = (t: number, off: number): P => ({ x: start.x + ux * len * t + nx * off, y: start.y + uy * len * t + ny * off });
  const away = (q: P, pad: number): boolean =>
    Math.hypot(q.x - start.x, q.y - start.y) > CORRIDOR.clearStart &&
    Math.hypot(q.x - beacon.x, q.y - beacon.y) > CORRIDOR.clearBeacon + pad &&
    (!site || Math.hypot(q.x - site.x, q.y - site.y) > CORRIDOR.clearSite + pad) &&
    clearOf(celestials, q.x, q.y, CORRIDOR.clearBig + pad);
  const out: CorridorPlan = { places: [], rocks: [], chunks: [], mines: [], loot: [], buoys: [] };

  // the places, spread along the way
  const n = Math.max(CORRIDOR.minPlaces, Math.min(CORRIDOR.maxPlaces, Math.round(len / CORRIDOR.placeEvery)));
  for (let i = 0; i < n; i++) {
    let spot: P | null = null;
    for (let k = 0; k < 12 && !spot; k++) {
      const t = (i + 0.5 + (rng() - 0.5) * 0.6) / n;
      const q = at(Math.min(0.92, Math.max(0.08, t)), (rng() - 0.5) * 2 * CORRIDOR.side);
      if (away(q, 60)) spot = q;
    }
    if (!spot) continue;
    const r = rng();
    const kind: PlaceKind = r < 0.45 ? 'rocks' : r < 0.8 ? 'debris' : 'mines';
    const ambush = kind === 'debris' && rng() < CORRIDOR.ambushShare;
    out.places.push({ kind, x: spot.x, y: spot.y, ambush });
    if (kind === 'rocks') {
      const count = 3 + Math.floor(rng() * 10);
      for (let j = 0; j < count; j++) {
        const a = rng() * Math.PI * 2;
        const d = 20 + rng() * 130;
        const rr = 5 + rng() * 9;
        const ore: 0 | 1 | 2 = rr > 8 && rng() < 0.45 ? (rng() < 0.15 ? 2 : 1) : 0;
        out.rocks.push({ x: spot.x + Math.cos(a) * d, y: spot.y + Math.sin(a) * d, r: rr, ore, seed: 1 + Math.floor(rng() * 99999) });
      }
    } else if (kind === 'debris') {
      const count = 4 + Math.floor(rng() * 5);
      for (let j = 0; j < count; j++) {
        const a = rng() * Math.PI * 2;
        const d = 15 + rng() * 110;
        out.chunks.push({ x: spot.x + Math.cos(a) * d, y: spot.y + Math.sin(a) * d, size: 5 + Math.floor(rng() * 9), seed: 1 + Math.floor(rng() * 99999) });
      }
      out.loot.push({ x: spot.x + (rng() - 0.5) * 40, y: spot.y + (rng() - 0.5) * 40, credits: 10 + 3 * tier, metal: 4 + tier });
    } else {
      const count = 5 + Math.floor(rng() * 5);
      for (let j = 0; j < count; j++) {
        const a = rng() * Math.PI * 2;
        const d = 30 + rng() * 140;
        out.mines.push({ x: spot.x + Math.cos(a) * d, y: spot.y + Math.sin(a) * d });
      }
      out.chunks.push({ x: spot.x, y: spot.y, size: 7 + Math.floor(rng() * 5), seed: 1 + Math.floor(rng() * 99999) });
    }
  }

  // single rocks and pieces of hull between the places: thick near the line, sparse further out
  const lay = (count: number, side: number) => {
    for (let i = 0; i < count; i++) {
      const q = at(0.04 + 0.92 * ((i + rng()) / count), (rng() - 0.5) * 2 * side);
      if (!away(q, 0)) continue;
      if (out.places.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 170)) continue;
      // not right on the line, so a ship flying straight is not forever bumping into things
      if (Math.abs((q.x - start.x) * nx + (q.y - start.y) * ny) < 40) continue;
      if (rng() < 0.72) out.rocks.push({ x: q.x, y: q.y, r: 2.5 + rng() * 4, ore: 0, seed: 1 + Math.floor(rng() * 99999) });
      else out.chunks.push({ x: q.x, y: q.y, size: 4 + Math.floor(rng() * 5), seed: 1 + Math.floor(rng() * 99999) });
    }
  };
  lay(Math.floor(len / CORRIDOR.scatterEvery), CORRIDOR.scatterSide);
  lay(Math.floor(len / CORRIDOR.outerEvery), CORRIDOR.outerSide);

  // the buoys along the way, green to the left, red to the right
  for (let s = CORRIDOR.buoyEvery * 0.5; s < len - 120; s += CORRIDOR.buoyEvery) {
    for (const side of [-1, 1]) {
      const q = at(s / len, side * CORRIDOR.buoyOff);
      if (clearOf(celestials, q.x, q.y, 40)) out.buoys.push({ x: q.x, y: q.y, red: side > 0 });
    }
  }
  return out;
}

/** A piece of a ship's hull adrift: a ragged blob of armour and plating, one layer. */
export function hullChunk(seed: number, size: number): ShipGrid {
  const rng = mulberry32(seed * 40503 + 7);
  const w = size + 2;
  const g = new ShipGrid(w, w, 1);
  const c = w / 2;
  const a1 = rng() * 6.28;
  const a2 = rng() * 6.28;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const ang = Math.atan2(dy, dx);
      // a jagged edge: a lumpy radius with bites out of it
      const r = (size / 2) * (0.7 + 0.2 * Math.sin(ang * 3 + a1) + 0.15 * Math.sin(ang * 5 + a2));
      if (Math.hypot(dx, dy) > r) continue;
      if (rng() < 0.06) continue;
      g.setCell(x, y, 0, rng() < 0.35 ? Mat.ARMOR : rng() < 0.15 ? Mat.DECK : Mat.HULL);
    }
  }
  return g;
}
