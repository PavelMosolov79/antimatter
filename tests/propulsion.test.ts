import { describe, expect, it } from 'vitest';
import type { Control } from '../src/sim/autopilot';
import type { GridBody } from '../src/sim/body';
import type { DriveType } from '../src/sim/grid';
import { DRIVES, PROPULSION, applyPropulsion } from '../src/sim/propulsion';
import { buildFighter } from '../src/sim/ships';
import { World } from '../src/sim/world';

const DT = 1 / 60;

function fighter(): GridBody {
  return new World(1).spawnPlayer(buildFighter(), 0, 0, 0);
}

function drives(p: GridBody, type: DriveType) {
  return p.grid.modules.filter((m) => m.drive === type);
}

function command(p: GridBody, ctl: Partial<Control>, seconds: number): void {
  const full: Control = { main: 0, back: 0, right: 0, left: 0, torque: 0, ...ctl };
  for (let i = 0; i < seconds / DT; i++) applyPropulsion(p, full, p.engineSummary(), DT);
}

describe('the drive family on the fighter', () => {
  it('carries all five drive types as hull modules, each in its own colour', () => {
    const p = fighter();
    const counts: Record<DriveType, number> = { cruise: 1, impulse: 2, brake: 2, maneuver: 4, turn: 4 };
    for (const type of Object.keys(counts) as DriveType[]) {
      const mods = drives(p, type);
      expect(mods.length).toBe(counts[type]);
      for (const m of mods) {
        expect(m.kind).toBe(DRIVES[type].kind);
        for (const i of m.cells) {
          expect(p.grid.mat[i]).toBe(DRIVES[type].mat);
          expect(p.grid.zOf(i)).toBe(0);
        }
      }
    }
  });

  it('flies about as before: 30 forward, half that braking, a quarter sideways', () => {
    const p = fighter();
    const e = p.engineSummary();
    expect(e.thrust / p.mass).toBeCloseTo(30, 0);
    expect(e.capBack / p.mass).toBeGreaterThan(13);
    expect(e.capBack / p.mass).toBeLessThan(16);
    expect(e.capRight / p.mass).toBeCloseTo(7.5, 0);
    expect(e.capLeft).toBeCloseTo(e.capRight, 6);
  });

  it('brakes with the nose nozzles, and braking scales with the ones that survive', () => {
    const p = fighter();
    const before = p.engineSummary().capBack;
    const brakes = drives(p, 'brake');
    expect(before).toBeCloseTo(brakes.reduce((s, m) => s + m.thrust, 0), 6);
    p.grid.removeCell(brakes[0].core);
    expect(p.engineSummary().capBack).toBeCloseTo(before / 2, 6);
  });

  it('a cruise drive winds up slowly, an impulse drive answers at once', () => {
    const p = fighter();
    command(p, { main: 1 }, 0.2);
    expect(drives(p, 'impulse')[0].out).toBe(1);
    const cruise = drives(p, 'cruise')[0].out;
    expect(cruise).toBeGreaterThan(0.1);
    expect(cruise).toBeLessThan(0.25);
    command(p, { main: 1 }, 1.2);
    expect(drives(p, 'cruise')[0].out).toBe(1);
    // ...and lets go faster than it winds up.
    command(p, { main: 0 }, DRIVES.cruise.spoolDown);
    expect(drives(p, 'cruise')[0].out).toBeCloseTo(0, 6);
  });

  it('turns on its turning nozzles, fired in pairs so the ship spins on the spot', () => {
    const p = fighter();
    // Within what the turning nozzles alone can do, the side nozzles stay quiet.
    const rcs = p.engineSummary().rcs;
    command(p, { torque: rcs * 0.7 }, 0.5);
    expect(p.w).toBeGreaterThan(0.4);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThan(1e-6);
    const turn = drives(p, 'turn');
    expect(turn.filter((m) => m.out > 0.5).length).toBe(2);
    expect(turn.filter((m) => m.out === 0).length).toBe(2);
    for (const m of drives(p, 'maneuver')) expect(m.out).toBe(0);
  });

  it('has no built-in turning any more: without the turning nozzles it barely turns', () => {
    const p = fighter();
    const full = p.engineSummary().rcs;
    for (const m of drives(p, 'turn')) p.grid.removeCell(m.core);
    const reserve = p.engineSummary().rcs;
    expect(reserve).toBeGreaterThan(0);
    expect(reserve).toBeLessThan(full * 0.25);
    PROPULSION.sideReserve = false;
    try {
      expect(p.engineSummary().rcs).toBe(0);
    } finally {
      PROPULSION.sideReserve = true;
    }
  });

  it('losing one turning nozzle of a pair makes turning shove the ship sideways', () => {
    const p = fighter();
    const bowLeft = drives(p, 'turn').find((m) => m.dirX > 0 && p.grid.yOf(m.core) < p.comY)!;
    p.grid.removeCell(bowLeft.core);
    for (const dir of [1, -1]) {
      p.vx = 0;
      p.vy = 0;
      p.w = 0;
      command(p, { torque: dir * 1e6 }, 0.3);
      if (dir === 1) expect(Math.abs(p.vx) + Math.abs(p.vy)).toBeGreaterThan(0.5);
    }
  });

  it('sliding sideways does not twist the ship, even though the side nozzles sit off the centre', () => {
    const p = fighter();
    command(p, { right: 1 }, 1);
    expect(p.vx).toBeGreaterThan(5);
    expect(Math.abs(p.w)).toBeLessThan(1e-3);
  });
});
