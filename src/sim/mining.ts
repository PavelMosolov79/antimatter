import type { GridBody } from './body';
import type { Module, WeaponState } from './grid';
import { Mat } from './materials';
import { spendEnergy } from './systems';
import type { World } from './world';

/**
 * Mining: the beam burns the veins of ore out of a rock cell by cell; each cell gives a crystal that flies to the ship
 * when it is near enough, and goes into the hold (gold: metal; violet: antimatter ore, which takes more room).
 * The beam passes through the rock and takes only ore; it needs the ship almost still, energy all the time it burns,
 * and a gunner at its post; a hit on the ship knocks it out for a moment.
 */
export const MINING = {
  range: 80,
  /** Seconds the beam takes over a cell of gold ore; the violet one is tougher (its hit points). */
  secondsPerCell: 1.1,
  energyPerSec: 14,
  /** The ship may not move faster than this (cells a second) while it burns. */
  maxSpeed: 22,
  /** Seconds the beam is out after the ship is hit. */
  hitStun: 1.2,
  /** A crystal is drawn to the ship from this far, and is gone after this long. */
  pull: 45,
  crystalLife: 25,
  /** Room in the hold, per crystal. */
  weight: { metal: 1, ore: 3 },
  /** Antimatter ore a quantum is worth. */
  oreToQuantum: 5,
  /** Waves of enemies come while the player mines: the first this long after the first cell is burned, then at this interval; the player is warned this long before. */
  patrolFirst: 35,
  patrolEvery: 35,
  patrolWarn: 15,
};

export const isOre = (mat: number): boolean => mat === Mat.ORE || mat === Mat.ORE2;
/** 1: gold (metal), 2: violet (antimatter ore). */
export const oreKind = (mat: number): 1 | 2 => (mat === Mat.ORE2 ? 2 : 1);

export interface Crystal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: 1 | 2;
  age: number;
}

/** The gold ore takes `secondsPerCell`; the damage rate that does it. */
export const MINER_DPS = 22 / MINING.secondsPerCell;

interface Found {
  body: GridBody;
  cell: number;
  x: number;
  y: number;
}

function cellWorld(b: GridBody, cell: number): { x: number; y: number } {
  const g = b.grid;
  return b.localToWorld(g.xOf(cell) + 0.5, g.yOf(cell) + 0.5, { x: 0, y: 0 });
}

/** The nearest ore cell of any rock within reach of the mount (or of that one rock only, given its id). */
export function nearestOre(world: World, mx: number, my: number, range: number, only: number | null = null): Found | null {
  let best: Found | null = null;
  let bd = range;
  for (const o of world.bodies) {
    if (o.removed || o.kind !== 'debris') continue;
    if (only !== null && o.id !== only) continue;
    if (Math.hypot(o.x - mx, o.y - my) - o.radius > range) continue;
    const g = o.grid;
    for (let i = 0; i < g.mat.length; i++) {
      if (!isOre(g.mat[i])) continue;
      const p = cellWorld(o, i);
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bd) {
        bd = d;
        best = { body: o, cell: i, x: p.x, y: p.y };
      }
    }
  }
  return best;
}

/** One tick of a mining beam on its turret: pick a vein, aim at it, burn it. `mine` on the weapon remembers the cell it holds. */
export function mineStep(world: World, b: GridBody, m: Module, w: WeaponState, mount: { x: number; y: number }, range: number, dt: number, eff: number, rate: number): void {
  const sys = b.sys!;
  w.firing = false;
  if (!w.enabled) return;
  // the player's beam keeps to the rock the player chose, if there is one
  const only = b.isPlayer ? world.mineTarget : null;
  let cur = w.mine ? world.bodies.find((o) => o.id === w.mine!.body && !o.removed) : undefined;
  if (cur && only !== null && cur.id !== only) cur = undefined;
  let cell = w.mine ? w.mine.cell : -1;
  if (cur) {
    const p = cell >= 0 && cur.grid.mat[cell] !== 0 && isOre(cur.grid.mat[cell]) ? cellWorld(cur, cell) : null;
    if (!p || Math.hypot(p.x - mount.x, p.y - mount.y) > range) cur = undefined;
  }
  if (!cur && world.time - (w.mineLook ?? -1) > 0.25) {
    w.mineLook = world.time;
    const f = nearestOre(world, mount.x, mount.y, range, only);
    if (f) {
      cur = f.body;
      cell = f.cell;
    }
  }
  if (!cur) {
    w.mine = undefined;
    return;
  }
  w.mine = { body: cur.id, cell };
  const p = cellWorld(cur, cell);
  // turn the barrel to the vein
  const aim = Math.atan2(p.x - mount.x, -(p.y - mount.y));
  let rel = aim - b.angle - w.arcCenter;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  const desired = Math.max(-w.arcHalf, Math.min(w.arcHalf, rel));
  const step = 3 * dt * eff;
  w.off += Math.max(-step, Math.min(step, desired - w.off));
  if (Math.abs(rel) > w.arcHalf || Math.abs(desired - w.off) > 0.05) return;
  if (Math.hypot(b.vx, b.vy) > MINING.maxSpeed) return;
  if (world.time - sys.lastHit < 0.15) {
    // a hit knocks the beam out for a moment
    m.stun = Math.max(m.stun, MINING.hitStun);
    return;
  }
  if (!spendEnergy(sys, MINING.energyPerSec * dt)) return;
  w.firing = true;
  world.beams.push({ x0: mount.x, y0: mount.y, x1: p.x, y1: p.y, color: 0x4ff0d0, team: sys.team });
  world.burnCells(cur, [cell], MINER_DPS * dt * eff * rate);
}

/** Crystals drift, are drawn to the ship, and go into the hold while it has room (`world.holdRoom`). */
export function stepCrystals(world: World, dt: number): void {
  const p = world.player;
  const keep: Crystal[] = [];
  for (const c of world.crystals) {
    c.age += dt;
    if (c.age > MINING.crystalLife) continue;
    c.vx *= Math.max(0, 1 - dt * 1.3);
    c.vy *= Math.max(0, 1 - dt * 1.3);
    if (p && !p.removed) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d = Math.hypot(dx, dy);
      const weight = c.kind === 2 ? MINING.weight.ore : MINING.weight.metal;
      if (d < MINING.pull + p.radius * 0.5 && world.holdRoom >= weight) {
        c.vx += (dx / (d || 1)) * 260 * dt;
        c.vy += (dy / (d || 1)) * 260 * dt;
        if (d < p.radius * 0.6 + 3) {
          world.holdRoom -= weight;
          world.notes.push({ type: 'ore', kind: c.kind });
          continue;
        }
      }
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    keep.push(c);
  }
  world.crystals = keep;
}
