import { mulberry32, type Rng } from './rng';
import type { Celestial } from './gravity';
import { buildArena, type SectorId } from './space';

/**
 * The campaign road: one endless line of points, written ten missions at a time. A link
 * is a gate followed by ten missions; the fifth is a dock and the tenth a boss, and the
 * gate after it opens the next link in the next sector. Every link comes from the run's
 * seed and its number alone, so a saved run only needs the seed and how far it got.
 *
 * Index 0 is the start gate, 1..10 the first link's missions, 11 the next gate, and so on.
 */

export type PointKind = 'combat' | 'elite' | 'dock' | 'boss' | 'gate' | 'mining' | 'event' | 'shop';

export interface RoadPoint {
  /** Position on the road, 0 being the start gate. */
  index: number;
  kind: PointKind;
  /** Which link of ten this point belongs to (a gate belongs to the link it opens). */
  link: number;
  /** Mission number across the whole run, 1-based; 0 for a gate. */
  mission: number;
  /** Place within the link, 1..10; 0 for a gate. */
  slot: number;
  /** The nebula of the link. */
  sector: SectorId;
  /** How dangerous this point is, growing without limit along the road. */
  tier: number;
  enemies: string[];
  seed: number;
}

export const ROAD = {
  linkLen: 10,
  /** Points per link counting its gate. */
  stride: 11,
  dockSlot: 5,
  bossSlot: 10,
  /** The next link is written when the player takes this mission of the current one. */
  writeNextAtSlot: 6,
  eliteFromMission: 4,
  /** Share of the hull lost so far that one dock patches back (until repairs run on timers at the dock). */
  repairShare: 0.5,
};

/**
 * Kinds the game can play so far. The rest are drawn and designed (GDD 9.1) but wait for
 * the cargo hold and the trader; the generator leaves them out until they are switched on.
 */
export const ENABLED: Record<PointKind, boolean> = {
  combat: true,
  elite: true,
  dock: true,
  boss: true,
  gate: true,
  mining: false,
  event: false,
  shop: false,
};

export const SECTOR_ORDER: readonly SectorId[] = ['violet', 'green', 'ice', 'crimson', 'clear'];

const WEIGHTS: Partial<Record<PointKind, number>> = { combat: 0.46, elite: 0.12, mining: 0.17, event: 0.17, shop: 0.08 };

const COMBAT_EARLY = [['scout'], ['scout', 'scout'], ['raider']];
const COMBAT_MID = [['raider', 'scout'], ['hunter'], ['scout', 'scout', 'scout']];
const COMBAT_LATE = [['raider', 'hunter'], ['hunter', 'scout', 'scout'], ['raider', 'raider']];
const ELITE = [['raider', 'raider', 'scout'], ['hunter', 'raider'], ['hunter', 'hunter', 'scout']];

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function hashInt(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

export function sectorOfLink(link: number): SectorId {
  return SECTOR_ORDER[link % SECTOR_ORDER.length];
}

/** The enemies a fight of this kind brings, growing in number and kind the further along the road. */
function enemiesFor(kind: PointKind, mission: number, link: number, rng: Rng): string[] {
  const depth = Math.min(1, (mission - 1) / 24);
  let list: string[] = [];
  if (kind === 'boss') {
    list = ['boss'];
    for (let i = 0; i < Math.min(2, link); i++) list.push('scout');
    return list;
  }
  if (kind === 'elite') list = [...pick(rng, ELITE)];
  else if (kind === 'combat') list = [...pick(rng, depth < 0.34 ? COMBAT_EARLY : depth < 0.67 ? COMBAT_MID : COMBAT_LATE)];
  else return list;
  // Past the point where the lists run out, every few missions add one more ship.
  const extra = Math.min(3, Math.max(0, Math.floor((mission - 20) / 8)));
  for (let i = 0; i < extra; i++) list.push(pick(rng, ['raider', 'hunter']));
  return list;
}

/** A link of the road: its gate (index `link * stride`) and the ten missions after it. */
export function genLink(seed: number, link: number, salt = 0): RoadPoint[] {
  const rng = mulberry32(hashInt(seed + salt * 13, link + 1));
  const sector = sectorOfLink(link);
  const kinds: Array<PointKind | null> = new Array(ROAD.linkLen).fill(null);
  kinds[ROAD.bossSlot - 1] = 'boss';
  kinds[ROAD.dockSlot - 1] = 'dock';
  kinds[0] = 'combat';
  for (let k = 0; k < ROAD.linkLen; k++) {
    if (kinds[k]) continue;
    const mission = link * ROAD.linkLen + k + 1;
    const w: Partial<Record<PointKind, number>> = {};
    for (const [kind, weight] of Object.entries(WEIGHTS) as Array<[PointKind, number]>) {
      if (!ENABLED[kind]) continue;
      if (kind === 'elite' && mission < ROAD.eliteFromMission) continue;
      w[kind] = weight;
    }
    const prev = kinds[k - 1];
    const prev2 = kinds[k - 2];
    const next = kinds[k + 1];
    for (const kind of Object.keys(w) as PointKind[]) {
      if (kind === prev && kind === prev2) w[kind] = 0;
      if (kind === 'shop' && (prev === 'dock' || next === 'dock' || prev === 'shop')) w[kind] = 0;
    }
    let total = 0;
    for (const v of Object.values(w)) total += v;
    let x = rng() * total;
    let chosen: PointKind = 'combat';
    for (const [kind, v] of Object.entries(w) as Array<[PointKind, number]>) {
      x -= v;
      if (x <= 0) {
        chosen = kind;
        break;
      }
    }
    kinds[k] = chosen;
  }
  const points: RoadPoint[] = [
    { index: link * ROAD.stride, kind: 'gate', link, mission: 0, slot: 0, sector, tier: 0, enemies: [], seed: hashInt(seed + 9, link) },
  ];
  kinds.forEach((kind, k) => {
    const mission = link * ROAD.linkLen + k + 1;
    const mrng = mulberry32(hashInt(seed + 77 + salt * 13, mission));
    const tier = 1 + Math.floor((mission - 1) / 4) + (kind === 'elite' ? 1 : 0) + (kind === 'boss' ? 2 : 0);
    points.push({
      index: link * ROAD.stride + k + 1,
      kind: kind!,
      link,
      mission,
      slot: k + 1,
      sector,
      tier,
      enemies: enemiesFor(kind!, mission, link, mrng),
      seed: hashInt(seed + 5, mission * 31 + link + salt * 1000),
    });
  });
  return points;
}

/** The road of one run, grown a link at a time as the player gets near its end. */
export class Road {
  readonly points: RoadPoint[] = [];
  constructor(readonly seed: number) {
    this.addLink();
  }

  get links(): number {
    return Math.ceil(this.points.length / ROAD.stride);
  }

  private addLink(): void {
    this.points.push(...genLink(this.seed, this.links));
  }

  /** Writes the next link when the player is deep enough into the current one; true if the road grew. */
  ensure(cleared: number): boolean {
    const current = cleared + 1;
    const need = Math.floor(current / ROAD.stride) + (current % ROAD.stride >= ROAD.writeNextAtSlot ? 1 : 0);
    let grew = false;
    while (this.links < need + 1) {
      this.addLink();
      grew = true;
    }
    return grew;
  }

  /** How many missions (not gates) lie behind the player. */
  missionsDone(cleared: number): number {
    let n = 0;
    for (let i = 0; i <= cleared && i < this.points.length; i++) if (this.points[i].kind !== 'gate') n++;
    return n;
  }
}

export interface Encounter {
  enemies: string[];
  /** The sky behind the arena and the seed that arranges its clouds. */
  sector: SectorId;
  skySeed: number;
  celestials: Celestial[];
}

/** What waits at a point: its enemies and the bodies of its arena, both from the point's seed. */
export function encounterFor(point: RoadPoint): Encounter {
  const rng = mulberry32(hashInt(point.seed, 104729));
  // Elites and the boss wait in the dangerous crimson sky, the very first fight in a quiet clear one.
  const sector: SectorId = point.kind === 'boss' || point.kind === 'elite' ? 'crimson' : point.mission === 1 ? 'clear' : point.sector;
  const hole = point.kind === 'boss' ? 'large' : undefined;
  return {
    enemies: point.enemies,
    sector,
    skySeed: Math.floor(rng() * 100000),
    celestials: buildArena(rng, sector, { hole, gentle: point.kind === 'combat' && point.mission === 1 }),
  };
}
