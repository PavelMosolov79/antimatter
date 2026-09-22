import type { AiState } from './ai';
import type { GridBody } from './body';
import type { RoomGraph } from './compartments';
import { moduleEfficiency, type TargetRef } from './grid';
import { MATERIALS, Mat } from './materials';
import type { World } from './world';

export interface Nav {
  target: { x: number; y: number } | null;
  face: number | null;
}

export type EnergyPriority = 'shield' | 'weapons';

export interface ShipSys {
  name: string;
  team: number;
  cellsMax: number;
  energy: number;
  energyMax: number;
  gen: number;
  shield: number;
  shieldMax: number;
  shieldDown: boolean;
  lastHit: number;
  shieldFlash: number;
  priority: EnergyPriority;
  instability: number;
  countdown: number;
  dead: boolean;
  focus: TargetRef | null;
  nav: Nav;
  ai: AiState | null;
  autoTarget: TargetRef | null;
  autoTime: number;
  rooms: RoomGraph | null;
}

export const SYSTEMS = {
  reserve: 0.25,
  shieldDelay: 2,
  shieldRestore: 0.3,
  shieldEnergyPerPoint: 0.35,
  brokenRegenMult: 0.6,
  countdownMin: 3,
  countdownMax: 5,
  instabilityHpLoss: 0.6,
  blastDamage: 700,
  deadCellFraction: 0.2,
};

export function createSys(body: GridBody, name: string, team: number): ShipSys {
  const sys: ShipSys = {
    name,
    team,
    cellsMax: body.grid.cells,
    energy: 0,
    energyMax: 0,
    gen: 0,
    shield: 0,
    shieldMax: 0,
    shieldDown: false,
    lastHit: -100,
    shieldFlash: 0,
    priority: 'weapons',
    instability: 0,
    countdown: -1,
    dead: false,
    focus: null,
    nav: { target: null, face: null },
    ai: null,
    autoTarget: null,
    autoTime: -100,
    rooms: null,
  };
  aggregate(body, sys);
  sys.energy = sys.energyMax;
  sys.shield = sys.shieldMax;
  return sys;
}

interface Agg {
  gen: number;
  cap: number;
  shieldMax: number;
  regen: number;
  reactorHp: number;
  reactorTotal: number;
  coreDead: boolean;
  hasReactor: boolean;
}

const agg: Agg = { gen: 0, cap: 0, shieldMax: 0, regen: 0, reactorHp: 0, reactorTotal: 0, coreDead: false, hasReactor: false };

function gather(body: GridBody): Agg {
  agg.gen = 0;
  agg.cap = 0;
  agg.shieldMax = 0;
  agg.regen = 0;
  agg.reactorHp = 0;
  agg.reactorTotal = 0;
  agg.coreDead = false;
  agg.hasReactor = false;
  const g = body.grid;
  for (const m of g.modules) {
    if (m.kind === 'reactor') {
      const eff = moduleEfficiency(m);
      agg.hasReactor = true;
      agg.gen += m.power * eff;
      agg.cap += m.capacity * eff;
      if (!m.coreAlive) agg.coreDead = true;
      for (const i of m.cells) {
        agg.reactorTotal += MATERIALS[Mat.REACTOR].hp;
        if (g.mat[i] !== 0) agg.reactorHp += g.hp[i];
      }
    } else if (m.kind === 'shield') {
      const eff = moduleEfficiency(m);
      agg.shieldMax += m.shieldMax * eff;
      agg.regen += m.regen * eff;
    }
  }
  return agg;
}

function aggregate(body: GridBody, sys: ShipSys): void {
  const a = gather(body);
  sys.gen = a.gen;
  sys.energyMax = a.cap;
  sys.shieldMax = a.shieldMax;
}

export function shieldActive(sys: ShipSys | null): boolean {
  return !!sys && !sys.dead && sys.shieldMax > 0 && sys.shield > 0 && !sys.shieldDown;
}

export function spendEnergy(sys: ShipSys, amount: number): boolean {
  const floor = sys.priority === 'shield' ? SYSTEMS.reserve * sys.energyMax : 0;
  if (sys.energy - amount < floor) return false;
  sys.energy -= amount;
  return true;
}

export function absorbShield(sys: ShipSys, dmg: number, time: number): number {
  sys.lastHit = time;
  sys.shieldFlash = 1;
  sys.shield -= dmg;
  if (sys.shield > 0) return 0;
  const overflow = -sys.shield;
  sys.shield = 0;
  sys.shieldDown = true;
  return overflow;
}

export function updateSystems(world: World, b: GridBody, dt: number): void {
  const sys = b.sys;
  if (!sys || sys.dead) return;
  const a = gather(b);
  sys.gen = a.gen;
  sys.energyMax = a.cap;
  sys.energy = Math.min(sys.energyMax, sys.energy + a.gen * dt);

  sys.shieldMax = a.shieldMax;
  if (sys.shieldMax <= 0) {
    sys.shield = 0;
  } else {
    sys.shield = Math.min(sys.shield, sys.shieldMax);
    if (sys.shieldDown && sys.shield >= SYSTEMS.shieldRestore * sys.shieldMax) sys.shieldDown = false;
    if (world.time - sys.lastHit >= SYSTEMS.shieldDelay && sys.shield < sys.shieldMax) {
      const floor = sys.priority === 'weapons' ? SYSTEMS.reserve * sys.energyMax : 0;
      const rate = a.regen * (sys.shieldDown ? SYSTEMS.brokenRegenMult : 1);
      const affordable = Math.max(0, (sys.energy - floor) / SYSTEMS.shieldEnergyPerPoint);
      const add = Math.min(rate * dt, affordable, sys.shieldMax - sys.shield);
      sys.shield += add;
      sys.energy -= add * SYSTEMS.shieldEnergyPerPoint;
    }
  }
  sys.shieldFlash = Math.max(0, sys.shieldFlash - dt * 3);

  if (a.hasReactor) {
    sys.instability = a.reactorTotal > 0 ? Math.min(1, (1 - a.reactorHp / a.reactorTotal) / SYSTEMS.instabilityHpLoss) : 1;
    if (sys.countdown < 0 && (a.coreDead || sys.instability >= 1)) {
      sys.countdown = SYSTEMS.countdownMin + (SYSTEMS.countdownMax - SYSTEMS.countdownMin) * world.rng();
      world.push({ t: 'warning', x: b.x, y: b.y });
    }
  }
  if (sys.countdown >= 0) {
    sys.countdown -= dt;
    if (sys.countdown <= 0) {
      world.detonate(b);
      return;
    }
  }

  if (b.grid.cells <= sys.cellsMax * SYSTEMS.deadCellFraction) world.killShip(b);
}

export function moduleCentroid(b: GridBody, kind: 'reactor' | 'turret' | 'shield' | 'engine'): { x: number; y: number } | null {
  const g = b.grid;
  for (const m of g.modules) {
    if (m.kind !== kind) continue;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const i of m.cells) {
      if (g.mat[i] === 0) continue;
      sx += g.xOf(i) + 0.5;
      sy += g.yOf(i) + 0.5;
      n++;
    }
    if (n > 0) return { x: sx / n, y: sy / n };
  }
  return null;
}
