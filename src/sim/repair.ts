import type { ShipGrid } from './grid';
import { Mat } from './materials';
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
  /** Real seconds (after `timeScale`), the seconds before it, and the metal. */
  secs: number;
  design: number;
  metal: number;
}

/** How bad the damage is, for how long its repair takes. */
export function severity(d: Damage): 'light' | 'medium' | 'heavy' {
  if (d.wreck) return 'heavy';
  const loss = 1 - d.hull;
  const mods = d.modulesTotal > 0 ? d.modules / d.modulesTotal : 0;
  if (loss < REPAIR.lightMaxLoss && mods < REPAIR.lightMaxModules) return 'light';
  if (loss < REPAIR.mediumMaxLoss && mods < REPAIR.mediumMaxModules) return 'medium';
  return 'heavy';
}

export function quote(d: Damage, shipId: string, where: 'home' | 'road'): Quote {
  if (!d.any) return { secs: 0, design: 0, metal: 0 };
  const spare = shipId === SPARE_SHIP;
  let design = REPAIR.tierSeconds[severity(d)] * (REPAIR.classTime[shipId] ?? 1);
  let metal = spare ? 0 : Math.ceil(d.cells * REPAIR.metalPerCell + d.hurt * REPAIR.metalPerHurtCell + d.modules * REPAIR.metalPerModule);
  if (where === 'road') {
    design *= REPAIR.roadTime;
    metal = Math.ceil(metal * REPAIR.roadCost);
  }
  return { secs: Math.max(REPAIR.minSeconds, design * REPAIR.timeScale), design, metal };
}

/** The premium price of what is left of a repair. */
export function quantaFor(secsLeft: number): number {
  return Math.max(1, Math.ceil((secsLeft / 60) * REPAIR.quantaPerMinute));
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
  const order = repairOrder(saved, bp);
  const back = Math.floor(order.length * p);
  for (let k = 0; k < back; k++) bytes[order[k] >> 3] &= ~(1 << (order[k] & 7));
  const hp = saved.hp.slice(Math.floor(saved.hp.length * p));
  const left = order.length - back;
  if (left === 0 && hp.length === 0 && saved.dead.length === 0 && !saved.allDead) return null;
  return { gone: toBase64(bytes), hp, dead: saved.dead, allDead: saved.allDead };
}

/** The cells (as blueprint indices) a repair puts back, in the order it does: plain hull first, the cells of modules last. */
export function repairOrder(saved: SavedShip | null, bp: ShipGrid): number[] {
  if (!saved) return [];
  const bytes = fromBase64(saved.gone);
  const total = bp.width * bp.height * bp.depth;
  const plain: number[] = [];
  const inModule: number[] = [];
  for (let bi = 0; bi < total; bi++) {
    if (!goneBit(bytes, bi)) continue;
    (bp.mod[bi] !== 0 ? inModule : plain).push(bi);
  }
  return [...plain, ...inModule];
}

/** A ship freshly built as `fresh` with the damage of `saved` put on it (the cells shot away removed, the hurt ones hurt). */
export function damagedGrid(fresh: ShipGrid, saved: SavedShip | null): ShipGrid {
  if (!saved) return fresh;
  const bytes = fromBase64(saved.gone);
  const total = fresh.width * fresh.height * fresh.depth;
  for (let bi = 0; bi < total; bi++) if (goneBit(bytes, bi) && fresh.mat[bi] !== 0) fresh.removeCell(bi);
  for (const [bi, hp] of saved.hp) if (fresh.mat[bi] !== 0) fresh.hp[bi] = hp;
  fresh.version++;
  return fresh;
}

/** Puts one cell of the blueprint back on a ship that was built from it (the cell, its paint, its place in its module). */
export function putBack(g: ShipGrid, bp: ShipGrid, bi: number): void {
  const m = bp.mat[bi];
  if (m === 0 || g.mat[bi] !== 0) return;
  const x = bp.xOf(bi);
  const y = bp.yOf(bi);
  const z = bp.zOf(bi);
  if (m === Mat.DOOR) {
    const did = g.doorIdx[bi];
    if (did !== 0) {
      g.setCell(x, y, z, Mat.DOOR);
      g.doors[did - 1].destroyed = false;
    } else g.addDoor(x, y, z);
  } else g.setCell(x, y, z, m);
  if (bp.paintFlags && bp.paintFlags[bi]) {
    const pr = bp.paintRGB!;
    g.setPaint(bi, pr[bi * 3], pr[bi * 3 + 1], pr[bi * 3 + 2], (bp.paintFlags[bi] & 2) !== 0);
  }
  const bm = bp.mod[bi];
  if (bm !== 0) {
    const mod = g.modules[bm - 1];
    g.mod[bi] = bm;
    mod.alive++;
    if (bi === mod.core) mod.coreAlive = true;
    if (!mod.cells.includes(bi)) mod.cells.push(bi);
  }
}
