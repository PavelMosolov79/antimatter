import { clearOf, exclusion as exclusionFn, type Celestial } from './gravity';
import { mulberry32, type Rng } from './rng';
import { WRECK_KINDS, wreckBody } from './wrecks';

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

// ------------------------------------------------------------------ the things that are in space

/** A planet as a body of the world. */
export function planetBody(x: number, y: number, seed: number, type: PlanetTypeId, opts: PlanetOptions = {}): Celestial {
  const spec = genPlanet(seed, { type, ...opts });
  return { kind: 'planet', x, y, radius: spec.R, mu: spec.mu, soft: SPACE.planetSoft, seed, variant: spec.type, ring: spec.ring };
}

export function holeBody(x: number, y: number, h: HoleSpec): Celestial {
  return { kind: 'blackhole', x, y, radius: h.R0, mu: h.mu, soft: SPACE.holeSoft, seed: h.seed };
}

/** A pulsar: a small, heavy star with two beams that sweep the sky. */
export const PULSAR = { radius: 30, mu: 110000, soft: 20, beamLength: 1400, beamWidth: 22, beamSlope: 0.055, rate: 0.45, shieldPerSecond: 70 };
export function pulsarBody(x: number, y: number, seed: number): Celestial {
  return { kind: 'pulsar', x, y, radius: PULSAR.radius, mu: PULSAR.mu, soft: PULSAR.soft, seed };
}

/** An ion storm: an ellipse of purple cloud; no shield recovers in it and lightning knocks modules out. */
export const STORM = { boltEvery: 3.2, boltChance: 0.7, stun: 4 };
/** The angle (radians) a pulsar's beams point at, at this time of the world. */
export const pulsarAngle = (c: Celestial, time: number): number => c.seed * 0.7 + time * PULSAR.rate;

/** The lightning of a storm: one chance every few seconds; `phase` is how far into the interval it is (the flash is the start of it). */
export function stormBolt(c: Celestial, time: number): { index: number; phase: number; on: boolean } {
  const index = Math.floor(time / STORM.boltEvery);
  return { index, phase: (time - index * STORM.boltEvery) / STORM.boltEvery, on: hashOf(index, c.seed) < STORM.boltChance };
}
function hashOf(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function stormBody(x: number, y: number, seed: number, rx: number): Celestial {
  return { kind: 'storm', x, y, radius: rx, ry: rx * 0.6, mu: 0, soft: 1, seed };
}

/** A comet flies straight across; the ion tail points away from where it is going. */
export function cometBody(x: number, y: number, seed: number, angle: number, speed: number): Celestial {
  return { kind: 'comet', x, y, radius: 28, mu: 0, soft: 1, seed, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

export function gateBody(x: number, y: number, seed: number): Celestial {
  return { kind: 'gate', x, y, radius: 170, mu: 0, soft: 1, seed };
}

/** Where a field of rocks lies; the rocks themselves are made by the world (sim/rocks.ts). */
export function fieldBody(x: number, y: number, seed: number, radius: number): Celestial {
  return { kind: 'asteroids', x, y, radius, mu: 0, soft: 1, seed };
}

/**
 * The bodies of one arena. The arena sits in the weak field of a huge planet — the pull
 * at the player's spawn is 1–3 cells/s² — so the planet shows up at the edge of the view
 * when the camera pulls back, in the lower half where no enemy comes from. A small moon
 * gives cover, a distant star the light, and some sectors a black hole off to the side
 * and something of their own: a field of rocks, a comet, a storm, a pulsar. Nothing lies
 * over anything else, and nothing over the places the fight starts at.
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
    for (let tries = 0; tries < 24; tries++) {
      const ma = pa + (rng() - 0.5) * 1.8;
      const md = 480 + rng() * 220;
      const mx = Math.cos(ma) * md;
      const my = Math.sin(ma) * md;
      if (my < -120 || !clearOfSpawns(mx, my, mr)) continue;
      const moon: Celestial = { kind: 'moon', x: mx, y: my, radius: mr, mu: mr * mr * 4, soft: 1, seed: Math.floor(rng() * 1000) };
      if (!clearOf(out, mx, my, exclusionFn(moon))) continue;
      out.push(moon);
      break;
    }
  }

  // The star only gives the light, so it may sit anywhere clear: round the sky at 2800 first, then further out.
  const sa = rng() * Math.PI * 2;
  for (let tries = 0; tries < 40; tries++) {
    const a = sa + tries * 0.55;
    const d = 2800 + Math.floor(tries / 12) * 1800;
    const sx = Math.cos(a) * d;
    const sy = Math.sin(a) * d;
    if (clearOf(out, sx, sy, 220 * 2 + 100)) {
      out.push({ kind: 'star', x: sx, y: sy, radius: 220, mu: 677000, soft: 5, seed: Math.floor(rng() * 1000) });
      break;
    }
  }

  const hole = opts.hole ?? def.hole;
  if (hole !== 'none') {
    const h = genHole(1 + Math.floor(rng() * 99999), hole === 'small' ? { M: 1.5 + rng() * 3.5 } : { M: 40 + rng() * 30 });
    // A small hole sits where its pull at the origin is 0.4–0.8; a huge one just outside its own disk.
    const d = hole === 'small' ? Math.max(Math.sqrt(h.mu / (0.4 + rng() * 0.4)), h.R0 + 700) : h.disk * 1.25;
    const side = rng() < 0.5 ? 0.2 : Math.PI - 0.2;
    for (let tries = 0; tries < 30; tries++) {
      const ba = side + (rng() - 0.5) * 0.6 + (tries > 14 ? Math.PI : 0);
      const dd = d * (1 + Math.floor(tries / 10) * 0.35);
      const bx = Math.cos(ba) * dd;
      const by = Math.sin(ba) * dd;
      const hb = holeBody(bx, by, h);
      if (clearOf(out, bx, by, h.R0 * 5.6 + 100) && clearOfSpawns(bx, by, h.R0 * 2)) {
        out.push(hb);
        break;
      }
    }
  }

  // Something of the sector's own, off to the side of the fight (not in the first one of a run, which is gentle).
  if (!opts.gentle) {
    const roll = rng();
    const make = (): Celestial | null => {
      const fseed = 1 + Math.floor(rng() * 99999);
      if (sector === 'violet') return fieldBody(0, 0, fseed, 650 + rng() * 300);
      if (sector === 'green') return roll < 0.5 ? fieldBody(0, 0, fseed, 650 + rng() * 300) : cometBody(0, 0, fseed, rng() * Math.PI * 2, 55 + rng() * 25);
      if (sector === 'crimson') return stormBody(0, 0, fseed, 700 + rng() * 300);
      if (sector === 'ice') return roll < 0.55 ? pulsarBody(0, 0, fseed) : cometBody(0, 0, fseed, rng() * Math.PI * 2, 55 + rng() * 25);
      return null;
    };
    const f = make();
    if (f) {
      const ex = exclusionOf(f);
      for (let tries = 0; tries < 40; tries++) {
        const a = rng() * Math.PI * 2;
        const d = 1500 + rng() * 1800 + ex;
        const fx = Math.cos(a) * d;
        const fy = Math.sin(a) * d;
        if (clearOf(out, fx, fy, ex) && clearOfSpawns(fx, fy, ex)) {
          f.x = fx;
          f.y = fy;
          out.push(f);
          break;
        }
      }
    }
    // and now and then a wreck lying about, to fly round and look over
    if (rng() < 0.4) {
      const w = wreckBody(0, 0, 1 + Math.floor(rng() * 99999), WRECK_KINDS[Math.floor(rng() * WRECK_KINDS.length)]);
      const ex = exclusionOf(w);
      for (let tries = 0; tries < 40; tries++) {
        const a = rng() * Math.PI * 2;
        const d = 1100 + rng() * 1600 + ex;
        const wx = Math.cos(a) * d;
        const wy = Math.sin(a) * d;
        if (clearOf(out, wx, wy, ex) && clearOfSpawns(wx, wy, ex)) {
          w.x = wx;
          w.y = wy;
          out.push(w);
          break;
        }
      }
    }
  }
  return out;
}

function exclusionOf(c: Celestial): number {
  return exclusionFn(c);
}
