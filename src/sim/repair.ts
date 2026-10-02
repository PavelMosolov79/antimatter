import type { ShipGrid } from './grid';
import { hash2 } from './rng';
import { REPAIR, SPARE_SHIP } from './repairConfig';
import { fromBase64, toBase64, type SavedShip } from './runSave';

/**
 * The damage of a ship is its difference from its blueprint (the `SavedShip` the run save
 * already uses): which cells are gone, which are hurt, who is dead. A dock turns that difference
 * into one repair: the time and the metal it takes, and — as the time passes — a smaller
 * difference, hull first and modules last.
 */

export interface Damage {
  /** Cells gone, cells only hurt, and the cells the ship has as built. */
  cells: number;
  hurt: number;
  hullCells: number;
  /** Modules whose core is gone, and the modules the ship has as built. */
  modules: number;
  modulesTotal: number;
  /** Cells left, as a share of the ship as built (0..1). */
  hull: number;
  /** Every cell and every crew member is gone. */
  wreck: boolean;
  /** Is there anything to repair at all. */
  any: boolean;
}

const goneBit = (bytes: Uint8Array | null, bi: number): boolean => !!bytes && (bytes[bi >> 3] & (1 << (bi & 7))) !== 0;

export function damageOf(saved: SavedShip | null, bp: ShipGrid): Damage {
  const bytes = saved ? fromBase64(saved.gone) : null;
  const total = bp.width * bp.height * bp.depth;
  let hullCells = 0;
  let cells = 0;
  for (let bi = 0; bi < total; bi++) {
    if (bp.mat[bi] === 0) continue;
    hullCells++;
    if (goneBit(bytes, bi)) cells++;
  }
  let modules = 0;
  for (const m of bp.modules) if (goneBit(bytes, m.core)) modules++;
  const hurt = saved ? saved.hp.length : 0;
  const wreck = !!saved?.allDead;
  return {
    cells,
    hurt,
    hullCells,
    modules,
    modulesTotal: bp.modules.length,
    hull: hullCells > 0 ? 1 - cells / hullCells : 1,
    wreck,
    any: cells > 0 || hurt > 0 || modules > 0 || wreck || (saved?.dead.length ?? 0) > 0,
  };
}

/** What is left of a ship that was destroyed: the hull layer in scraps, every deck and module gone, nobody alive. */
export function wreckOf(bp: ShipGrid): SavedShip {
  const total = bp.width * bp.height * bp.depth;
  const bytes = new Uint8Array(Math.ceil(total / 8));
  for (let bi = 0; bi < total; bi++) {
    if (bp.mat[bi] === 0) continue;
    const scrap = bp.zOf(bi) === 0 && bp.mod[bi] === 0 && hash2(bp.xOf(bi), bp.yOf(bi), 77) > 0.85;
    if (!scrap) bytes[bi >> 3] |= 1 << (bi & 7);
  }
  return { gone: toBase64(bytes), hp: [], dead: [], allDead: true };
}

export interface Quote {
  /** Real seconds (after `timeScale`), the designed seconds, and the metal. */
  secs: number;
  design: number;
  metal: number;
}

export function quote(d: Damage, shipId: string, where: 'home' | 'road'): Quote {
  if (!d.any) return { secs: 0, design: 0, metal: 0 };
  const spare = shipId === SPARE_SHIP;
  const mul = REPAIR.classTime[shipId] ?? 1;
  let design: number;
  let metal: number;
  if (spare) {
    const frac = d.hullCells > 0 ? d.cells / d.hullCells : 0;
    design = REPAIR.spareSeconds * Math.max(0.15, Math.min(1, frac * 4 + (d.modules > 0 ? 0.1 : 0)));
    metal = 0;
  } else {
    design = Math.min((d.cells * REPAIR.secPerCell + d.hurt * REPAIR.secPerHurtCell + d.modules * REPAIR.secPerModule) * mul, REPAIR.maxMinutes * 60);
    metal = Math.ceil(d.cells * REPAIR.metalPerCell + d.hurt * REPAIR.metalPerHurtCell + d.modules * REPAIR.metalPerModule);
  }
  if (where === 'road') {
    design *= REPAIR.roadTime;
    metal = Math.ceil(metal * REPAIR.roadCost);
  }
  return { secs: Math.max(REPAIR.minSeconds, design * REPAIR.timeScale), design, metal };
}

/** The premium price of what is left of a repair. */
export function quantaFor(secsLeft: number): number {
  return Math.max(1, Math.ceil((secsLeft / REPAIR.timeScale / 60) * REPAIR.quantaPerMinute));
}

/**
 * The same damage after `p` (0..1) of the repair is done: that share of the missing cells put
 * back, plain hull before modules, that share of the hurt cells healed; the crew come back
 * only with the last of it.
 */
export function repairedDiff(saved: SavedShip | null, bp: ShipGrid, p: number): SavedShip | null {
  if (!saved || p >= 1) return null;
  if (p <= 0) return saved;
  const bytes = fromBase64(saved.gone);
  const total = bp.width * bp.height * bp.depth;
  const plain: number[] = [];
  const inModule: number[] = [];
  for (let bi = 0; bi < total; bi++) {
    if (!goneBit(bytes, bi)) continue;
    (bp.mod[bi] !== 0 ? inModule : plain).push(bi);
  }
  const order = [...plain, ...inModule];
  const back = Math.floor(order.length * p);
  for (let k = 0; k < back; k++) bytes[order[k] >> 3] &= ~(1 << (order[k] & 7));
  const hp = saved.hp.slice(Math.floor(saved.hp.length * p));
  const left = order.length - back;
  if (left === 0 && hp.length === 0 && saved.dead.length === 0 && !saved.allDead) return null;
  return { gone: toBase64(bytes), hp, dead: saved.dead, allDead: saved.allDead };
}
