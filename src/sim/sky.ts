import { clearOf, exclusion, type Celestial } from './gravity';
import { hash2, mulberry32 } from './rng';
import { WRECK_KINDS, wreckBody, type WreckKind } from './wrecks';
import { SECTORS, cometBody, fieldBody, gateBody, genHole, holeBody, planetBody, pulsarBody, stormBody, type SectorId } from './space';

/**
 * The sky is laid out in chunks, so that flying on always meets something new and the same place is the same
 * every time: a chunk is a square of CHUNK cells, what is in it comes from the seed of the sector and the chunk's
 * own number. Everything is kept inside its chunk by its whole exclusion circle (see `exclusion`), so bodies of
 * two chunks never overlap, and inside a chunk each is placed clear of the others and of whatever the world
 * already has (the arena's own bodies).
 *
 * The chunk the arena lies in (0, 0) is the arena's: it has what `buildArena` made and nothing else is added there.
 */
export const CHUNK = 16000;
/** How many chunks round the player's one are kept in the world (the others are taken away). */
export const KEEP = 1;

export const chunkIndex = (v: number): number => Math.floor((v + CHUNK / 2) / CHUNK);
export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;
const centreOf = (c: number): number => c * CHUNK;

type Kind = 'planet' | 'hole' | 'pulsar' | 'gate' | 'storm' | 'asteroids' | 'comet' | 'wreck' | 'none';

/** What a sector's chunks are made of, as relative chances. */
const MIX: Record<SectorId, Partial<Record<Kind, number>>> = {
  violet: { planet: 46, asteroids: 24, gate: 8, storm: 5, comet: 5, wreck: 8, none: 4 },
  green: { planet: 36, asteroids: 28, comet: 14, gate: 5, wreck: 10, none: 7 },
  crimson: { planet: 22, hole: 13, storm: 22, asteroids: 12, gate: 5, pulsar: 6, wreck: 14, none: 6 },
  ice: { planet: 28, pulsar: 17, comet: 16, asteroids: 16, gate: 5, wreck: 10, none: 8 },
  clear: { planet: 56, asteroids: 6, gate: 6, wreck: 8, none: 24 },
};

function pick(mix: Partial<Record<Kind, number>>, r: number): Kind {
  const entries = Object.entries(mix) as Array<[Kind, number]>;
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let x = r * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return 'none';
}

function make(kind: Kind, sector: SectorId, rng: () => number): Celestial | null {
  const seed = 1 + Math.floor(rng() * 99999);
  switch (kind) {
    case 'planet': {
      const types = SECTORS[sector].planetTypes;
      return planetBody(0, 0, seed, types[Math.floor(rng() * types.length)]);
    }
    case 'hole':
      return holeBody(0, 0, genHole(seed, rng() < 0.6 ? { M: 1.5 + rng() * 3.5 } : { M: 30 + rng() * 40 }));
    case 'pulsar':
      return pulsarBody(0, 0, seed);
    case 'gate':
      return gateBody(0, 0, seed);
    case 'storm':
      return stormBody(0, 0, seed, 700 + rng() * 400);
    case 'asteroids':
      return fieldBody(0, 0, seed, 450 + rng() * 550);
    case 'comet':
      return cometBody(0, 0, seed, rng() * Math.PI * 2, 55 + rng() * 30);
    case 'wreck':
      return wreckBody(0, 0, seed, WRECK_KINDS[Math.floor(rng() * WRECK_KINDS.length)] as WreckKind);
    default:
      return null;
  }
}

/**
 * The bodies of a chunk, as they will always be. `taken` is what is already in the world, which the new ones keep
 * clear of (the arena's); with the same seed and sector the answer does not depend on anything else.
 */
export function genChunk(sector: SectorId, worldSeed: number, cx: number, cy: number, taken: Celestial[] = []): Celestial[] {
  if (cx === 0 && cy === 0) return [];
  const rng = mulberry32((Math.imul(worldSeed | 0, 2654435761) ^ Math.floor(hash2(cx, cy, 77) * 4294967296)) >>> 0 || 1);
  const key = chunkKey(cx, cy);
  const placed: Celestial[] = [];
  const count = 1 + (rng() < 0.55 ? 1 : 0) + (rng() < 0.2 ? 1 : 0);
  const half = CHUNK / 2;
  for (let n = 0; n < count; n++) {
    const kind = pick(MIX[sector], rng());
    if (kind === 'none') continue;
    const c = make(kind, sector, rng);
    if (!c) continue;
    const e = exclusion(c);
    if (e * 2 > CHUNK - 300) continue;
    for (let tries = 0; tries < 16; tries++) {
      const x = centreOf(cx) - half + e + 100 + rng() * (CHUNK - 2 * e - 200);
      const y = centreOf(cy) - half + e + 100 + rng() * (CHUNK - 2 * e - 200);
      if (!clearOf(placed, x, y, e) || !clearOf(taken, x, y, e)) continue;
      c.x = x;
      c.y = y;
      c.chunk = key;
      placed.push(c);
      // a planet sometimes has a moon, in its own circle's reach
      if (c.kind === 'planet' && rng() < 0.45) {
        const mr = 90 + rng() * 120;
        for (let m = 0; m < 10; m++) {
          const a = rng() * Math.PI * 2;
          const d = c.radius * (c.ring ? 2.3 : 1.2) + 150 + mr + 200 + rng() * 800;
          const mx = x + Math.cos(a) * d;
          const my = y + Math.sin(a) * d;
          const moon: Celestial = { kind: 'moon', x: mx, y: my, radius: mr, mu: mr * mr * 4, soft: 1, seed: Math.floor(rng() * 1000), chunk: key };
          const me = exclusion(moon);
          const inside = Math.abs(mx - centreOf(cx)) + me < half && Math.abs(my - centreOf(cy)) + me < half;
          if (inside && clearOf(placed, mx, my, me) && clearOf(taken, mx, my, me)) {
            placed.push(moon);
            break;
          }
        }
      }
      break;
    }
  }
  return placed;
}
