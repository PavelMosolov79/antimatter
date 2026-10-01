import type { Celestial } from './gravity';
import { mulberry32, type Rng } from './rng';

/**
 * The space around an arena, as designed in «Космос Antimatter»: planets ten times the
 * size of the battleship whose pull grows with their size, black holes from small to
 * huge, and the five kinds of sector sky. Everything is generated from a seed, so the
 * same seed always gives the same planet.
 */

export const SPACE = {
  /** Battleship length in cells — the yardstick planets are measured in. */
  battleship: 190,
  /** A planet of this radius (cells) is the reference for the pull formula. */
  planetRef: 1900,
  /** Scales the planet size so the median planet is ten battleships across. */
  sizeK: 1.15,
  minRadius: 320,
  maxRadius: 2400,
  planetSoft: 2,
  holeSoft: 8,
};

export type PlanetTypeId = 'rocky' | 'desert' | 'ocean' | 'ice' | 'lava' | 'gas' | 'icegiant';

export interface PlanetType {
  id: PlanetTypeId;
  name: string;
  /** Relative chance of meeting it. */
  weight: number;
  /** Size relative to the typical planet. */
  sizeScale: number;
  /** Density: how hard it pulls for its size. */
  density: number;
  giant: boolean;
}

export const PLANET_TYPES: PlanetType[] = [
  { id: 'rocky', name: 'Каменистая', weight: 20, sizeScale: 0.62, density: 1.1, giant: false },
  { id: 'desert', name: 'Пустынная', weight: 16, sizeScale: 0.78, density: 1.0, giant: false },
  { id: 'ocean', name: 'Океаническая', weight: 16, sizeScale: 0.85, density: 1.0, giant: false },
  { id: 'ice', name: 'Ледяная', weight: 12, sizeScale: 0.7, density: 0.85, giant: false },
  { id: 'lava', name: 'Лавовая', weight: 8, sizeScale: 0.6, density: 1.1, giant: false },
  { id: 'gas', name: 'Газовый гигант', weight: 18, sizeScale: 1.55, density: 0.75, giant: true },
  { id: 'icegiant', name: 'Ледяной гигант', weight: 10, sizeScale: 1.3, density: 0.8, giant: true },
];

export function planetType(id: PlanetTypeId): PlanetType {
  return PLANET_TYPES.find((t) => t.id === id) ?? PLANET_TYPES[0];
}

export interface PlanetSpec {
  seed: number;
  type: PlanetTypeId;
  /** Radius in cells. */
  R: number;
  /** Pull at the surface, cells/s². */
  g0: number;
  /** Gravitational parameter: g(d) = mu / (d² + soft²). */
  mu: number;
  density: number;
  ring: boolean;
  /** Atmosphere thickness as a share of the radius. */
  atmoK: number;
  rot: number;
  tilt: number;
  sea: number;
  bands: number;
  /** Which colour scheme of its type (gas giants have three). */
  palette: number;
  storm: boolean;
  /** Direction of the big storm on a giant, a unit vector. */
  sx: number;
  sy: number;
  sz: number;
}

export interface PlanetOptions {
  type?: PlanetTypeId;
  ring?: boolean;
  /** Force the diameter, in battleships. */
  diamShips?: number;
}

function seeded(seed: number): Rng {
  return mulberry32((seed * 2654435761) >>> 0 || 1);
}

/**
 * A planet from a seed. Size is log-normal around ten battleships across; the pull at the
 * surface is g₀ = (4 + 10·√(R / 1900)) × density — a bigger planet drags harder, but more
 * slowly than it grows — and mu = g₀ · R².
 */
export function genPlanet(seed: number, opts: PlanetOptions = {}): PlanetSpec {
  const r = seeded(seed);
  r();
  r();
  let type: PlanetType | undefined;
  if (opts.type) {
    type = planetType(opts.type);
    r();
  } else {
    const total = PLANET_TYPES.reduce((s, t) => s + t.weight, 0);
    let x = r() * total;
    for (const t of PLANET_TYPES) {
      x -= t.weight;
      if (x <= 0) {
        type = t;
        break;
      }
    }
    type ??= PLANET_TYPES[0];
  }
  const gz = (r() + r() + r() - 1.5) * 2;
  let R = (SPACE.planetRef / 2) * SPACE.sizeK * Math.exp(0.38 * gz) * type.sizeScale;
  if (opts.diamShips) R = (opts.diamShips * SPACE.battleship) / 2;
  R = Math.max(SPACE.minRadius, Math.min(SPACE.maxRadius, R));
  const density = type.density * (0.88 + 0.26 * r());
  const g0 = (4 + 10 * Math.sqrt(R / SPACE.planetRef)) * density;
  const ring = opts.ring !== undefined ? opts.ring : type.giant ? r() < 0.4 : r() < 0.07;
  const palette = Math.floor(r() * 3);
  const sa = (r() - 0.5) * 1.0;
  const sb = r() * 6.28;
  return {
    seed,
    type: type.id,
    R,
    g0,
    mu: g0 * R * R,
    density,
    ring,
    atmoK: 0.022 + 0.04 * r(),
    rot: r() * 6.28,
    tilt: (r() - 0.5) * (ring ? 0.8 : 2.4),
    sea: 0.47 + 0.1 * r(),
    bands: 9 + r() * 9,
    palette,
    storm: type.giant && r() < 0.6,
    sx: Math.cos(sa) * Math.cos(sb),
    sy: Math.sin(sa),
    sz: Math.cos(sa) * Math.sin(sb),
  };
}

export interface HoleSpec {
  seed: number;
  /** Mass in conventional units: ~1–6 is a small hole, ~30–120 a huge one. */
  M: number;
  small: boolean;
  /** Horizon radius, cells. */
  R0: number;
  mu: number;
  /** Outer radius of the accretion disk. */
  disk: number;
  /** Inside this radius the disk is hot enough to hurt. */
  heat: number;
}

export interface HoleOptions {
  cls?: 'small' | 'large';
  M?: number;
}

/** Black hole: the horizon is 12·M cells and the pull mu = 80 000·M·(1 + M/20). M = 2 is the hole the game had before. */
export function genHole(seed: number, opts: HoleOptions = {}): HoleSpec {
  const r = seeded(seed + 500);
  r();
  const cls = opts.cls ?? (r() < 0.55 ? 'small' : 'large');
  const M = opts.M ?? (cls === 'small' ? 1 + r() * 5 : 30 + r() * 90);
  const R0 = 12 * M;
  return { seed, M, small: M < 12, R0, mu: 80000 * M * (1 + M / 20), disk: 5.6 * R0, heat: 2.4 * R0 };
}

// ------------------------------------------------------------------ sectors

export type SectorId = 'violet' | 'green' | 'crimson' | 'ice' | 'clear';
export const SECTOR_IDS: SectorId[] = ['violet', 'green', 'crimson', 'ice', 'clear'];

export interface SectorDef {
  id: SectorId;
  name: string;
  sub: string;
  /** Planet types the arena's planet is drawn from. */
  planetTypes: PlanetTypeId[];
  /** The black hole this sector's arena has, if any. */
  hole: 'none' | 'small' | 'large';
}

export const SECTORS: Record<SectorId, SectorDef> = {
  violet: { id: 'violet', name: 'Фиолетовая туманность', sub: 'пыль с оранжевым', planetTypes: ['gas', 'desert', 'rocky'], hole: 'none' },
  green: { id: 'green', name: 'Изумрудная туманность', sub: 'спокойный сектор', planetTypes: ['ocean', 'rocky', 'desert'], hole: 'none' },
  crimson: { id: 'crimson', name: 'Багровая туманность', sub: 'опасный сектор', planetTypes: ['lava', 'rocky', 'desert'], hole: 'small' },
  ice: { id: 'ice', name: 'Ледяная туманность', sub: 'холодный сектор', planetTypes: ['ice', 'icegiant', 'rocky'], hole: 'none' },
  clear: { id: 'clear', name: 'Чистое небо', sub: 'почти пустота', planetTypes: ['ocean', 'rocky'], hole: 'none' },
};

export interface ArenaOptions {
  /** Override the sector's own black hole. */
  hole?: 'none' | 'small' | 'large';
  /** A small, gentle arena: the first fight of a run. */
  gentle?: boolean;
}

/** Spawn points the arena keeps clear: the player at the origin, the enemies straight above. */
export const ARENA_CLEAR = [
  { x: 0, y: 0, r: 450 },
  { x: 0, y: -380, r: 330 },
  { x: 0, y: -560, r: 330 },
];

function clearOfSpawns(x: number, y: number, radius: number): boolean {
  return ARENA_CLEAR.every((p) => Math.hypot(x - p.x, y - p.y) - radius >= p.r);
}

/**
 * The bodies of one arena. The arena sits in the weak field of a huge planet — the pull
 * at the player's spawn is 1–3 cells/s² — so the planet shows up at the edge of the view
 * when the camera pulls back, in the lower half where no enemy comes from. A small moon
 * gives cover, a distant star the light, and some sectors a black hole off to the side.
 */
export function buildArena(rng: Rng, sector: SectorId, opts: ArenaOptions = {}): Celestial[] {
  const def = SECTORS[sector];
  const out: Celestial[] = [];
  const type = def.planetTypes[Math.floor(rng() * def.planetTypes.length)];
  const seed = 1 + Math.floor(rng() * 99999);
  const spec = genPlanet(seed, { type, diamShips: opts.gentle ? 5 + rng() * 2 : undefined });
  const gTarget = opts.gentle ? 1 : 1 + rng() * 2;
  // Far enough that the pull at the origin is gTarget, and never closer than the spawn-clear distance.
  const dist = Math.max(Math.sqrt(spec.mu / gTarget), spec.R + 520);
  let pa = Math.PI / 2;
  for (let tries = 0; tries < 20; tries++) {
    const a = Math.PI / 2 + (rng() - 0.5) * Math.PI * 0.9;
    if (clearOfSpawns(Math.cos(a) * dist, Math.sin(a) * dist, spec.R)) {
      pa = a;
      break;
    }
  }
  const px = Math.cos(pa) * dist;
  const py = Math.sin(pa) * dist;
  out.push({ kind: 'planet', x: px, y: py, radius: spec.R, mu: spec.mu, soft: SPACE.planetSoft, seed, variant: spec.type, ring: spec.ring });

  if (rng() < 0.7) {
    const mr = 90 + rng() * 70;
    for (let tries = 0; tries < 12; tries++) {
      const ma = pa + (rng() - 0.5) * 1.8;
      const md = 480 + rng() * 220;
      const mx = Math.cos(ma) * md;
      const my = Math.sin(ma) * md;
      if (my < -120 || !clearOfSpawns(mx, my, mr)) continue;
      out.push({ kind: 'moon', x: mx, y: my, radius: mr, mu: mr * mr * 4, soft: 1, seed: Math.floor(rng() * 1000) });
      break;
    }
  }

  const sa = rng() * Math.PI * 2;
  out.push({ kind: 'star', x: Math.cos(sa) * 2800, y: Math.sin(sa) * 2800, radius: 220, mu: 677000, soft: 5, seed: Math.floor(rng() * 1000) });

  const hole = opts.hole ?? def.hole;
  if (hole !== 'none') {
    const h = genHole(1 + Math.floor(rng() * 99999), hole === 'small' ? { M: 1.5 + rng() * 3.5 } : { M: 40 + rng() * 30 });
    // A small hole sits where its pull at the origin is 0.4–0.8; a huge one just outside its own disk.
    const d = hole === 'small' ? Math.max(Math.sqrt(h.mu / (0.4 + rng() * 0.4)), h.R0 + 700) : h.disk * 1.25;
    const side = rng() < 0.5 ? 0.2 : Math.PI - 0.2;
    const ba = side + (rng() - 0.5) * 0.6;
    out.push({ kind: 'blackhole', x: Math.cos(ba) * d, y: Math.sin(ba) * d, radius: h.R0, mu: h.mu, soft: SPACE.holeSoft, seed: h.seed });
  }
  return out;
}
