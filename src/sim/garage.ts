import type { ShipGrid } from './grid';
import { repairedDiff } from './repair';
import type { SavedShip } from './runSave';

/**
 * What the dock remembers of each ship between runs: how it is damaged, and the repair under
 * way. A repair is a start time and a length in real seconds, so it runs on the device's clock
 * even while the game is closed; the damage at any moment follows from the clock.
 */

export interface RepairJob {
  /** Epoch milliseconds, and the real seconds the repair takes from then. */
  start: number;
  total: number;
  /** The damage the repair started with. */
  from: SavedShip | null;
  where: 'home' | 'road';
}

export interface GarageEntry {
  damage: SavedShip | null;
  job: RepairJob | null;
}

export type Garage = Record<string, GarageEntry>;

const KEY = 'antimatter-garage-v1';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadGarage(): Garage {
  try {
    const d = JSON.parse(storage()?.getItem(KEY) ?? 'null') as { v: number; ships: Garage } | null;
    if (d && d.v === 1 && d.ships && typeof d.ships === 'object') return d.ships;
  } catch {
    /* an unreadable save is an empty garage */
  }
  return {};
}

export function storeGarage(g: Garage): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ v: 1, ships: g }));
  } catch {
    /* a full or blocked storage just means no save */
  }
}

export const entryOf = (g: Garage, shipId: string): GarageEntry => (g[shipId] ??= { damage: null, job: null });

export interface Standing {
  /** The damage right now (the repair's progress applied). */
  diff: SavedShip | null;
  /** How much of the repair is done (0 with no repair running), the real seconds left, and whether it is finished. */
  p: number;
  left: number;
  done: boolean;
  running: boolean;
}

/** Where a ship's repair stands at `now` (epoch ms). */
export function standing(entry: GarageEntry, bp: ShipGrid, now: number): Standing {
  const job = entry.job;
  if (!job) return { diff: entry.damage, p: 0, left: 0, done: false, running: false };
  const p = job.total <= 0 ? 1 : Math.max(0, Math.min(1, (now - job.start) / (job.total * 1000)));
  const left = Math.max(0, Math.min(job.total, job.total - (now - job.start) / 1000));
  return { diff: repairedDiff(job.from, bp, p), p, left, done: p >= 1, running: true };
}

/** Speeds a running repair up: the time left is halved, or ended. */
export function speedUp(job: RepairJob, now: number, mode: 'half' | 'full'): void {
  // a repair not yet begun (the drones still on their way) is begun at once
  if (job.start > now) job.start = now;
  const elapsed = Math.max(0, (now - job.start) / 1000);
  const left = Math.max(0, job.total - elapsed);
  job.total = elapsed + (mode === 'half' ? left / 2 : 0);
}

/** A repair that has run its course leaves a whole ship. */
export function settle(entry: GarageEntry, now: number): boolean {
  const job = entry.job;
  if (!job || now - job.start < job.total * 1000) return false;
  entry.damage = null;
  entry.job = null;
  return true;
}

/** Can the ship fly: not while a repair on it runs (the spare's short repair counts too). */
export function canFly(entry: GarageEntry | undefined): boolean {
  return !entry?.job;
}
