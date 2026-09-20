import { describe, expect, it } from 'vitest';
import { buildCruiser, buildFighter } from '../src/sim/ships';
import { World } from '../src/sim/world';

interface Click {
  t: number;
  x: number;
  y: number;
}

interface Result {
  arrived: boolean;
  finalDist: number;
  rotTotal: number;
  rotAfter: number;
  maxDriftAfter: number;
}

function fly(opts: { ship?: 'fighter' | 'cruiser'; planet?: boolean; clicks: Click[]; seconds?: number }): Result {
  const world = new World(1);
  if (opts.planet) world.celestials.push({ kind: 'planet', x: 650, y: 220, radius: 100, mu: 90000, soft: 2, seed: 4 });
  const p = world.spawnPlayer(opts.ship === 'cruiser' ? buildCruiser() : buildFighter(), 0, 0, 0);
  const pending = [...opts.clicks];
  let target = { x: 0, y: 0 };
  let last = p.angle;
  let rotTotal = 0;
  let rotAfter = 0;
  let maxDrift = 0;
  let arrived = false;
  const steps = 60 * (opts.seconds ?? 45);
  for (let i = 0; i < steps; i++) {
    while (pending.length > 0 && pending[0].t * 60 <= i) {
      const c = pending.shift()!;
      target = { x: c.x, y: c.y };
      world.target = target;
      arrived = false;
      rotTotal = 0;
      rotAfter = 0;
      maxDrift = 0;
    }
    world.step(1 / 60);
    const dr = Math.abs(p.angle - last);
    last = p.angle;
    rotTotal += dr;
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (!arrived && d < 3 && Math.hypot(p.vx, p.vy) < 1) arrived = true;
    else if (arrived) {
      rotAfter += dr;
      maxDrift = Math.max(maxDrift, d);
    }
  }
  return { arrived, finalDist: Math.hypot(p.x - target.x, p.y - target.y), rotTotal, rotAfter, maxDriftAfter: maxDrift };
}

describe('autopilot does not spin the ship', () => {
  it('holds still after arrival, with and without gravity', () => {
    for (const planet of [false, true]) {
      const r = fly({ planet, clicks: [{ t: 0, x: 260, y: -270 }] });
      expect(r.arrived).toBe(true);
      expect(r.finalDist).toBeLessThan(1);
      expect(r.rotAfter).toBeLessThan(0.05);
      expect(r.maxDriftAfter).toBeLessThan(3);
    }
  });

  it('does not rotate at all on a short sideways hop', () => {
    const r = fly({ clicks: [{ t: 0, x: 10, y: 0 }] });
    expect(r.arrived).toBe(true);
    expect(r.rotTotal).toBeLessThan(0.5);
    expect(r.finalDist).toBeLessThan(1);
  });

  it('short hops in gravity use few turns', () => {
    const back = fly({ planet: true, clicks: [{ t: 0, x: 0, y: 25 }] });
    expect(back.arrived).toBe(true);
    expect(back.rotTotal).toBeLessThan(3.5);
    expect(back.rotAfter).toBeLessThan(0.05);
    const diag = fly({ planet: true, clicks: [{ t: 0, x: 40, y: -45 }] });
    expect(diag.arrived).toBe(true);
    expect(diag.rotTotal).toBeLessThan(4.5);
  });

  it('long trips turn at most once to aim and once to brake', () => {
    const ahead = fly({ clicks: [{ t: 0, x: 260, y: -270 }] });
    expect(ahead.rotTotal).toBeLessThan(5);
    const behind = fly({ clicks: [{ t: 0, x: 0, y: 300 }] });
    expect(behind.arrived).toBe(true);
    expect(behind.rotTotal).toBeLessThan(7.2);
  });

  it('handles a series of retargets without endless spinning', () => {
    const r = fly({
      planet: true,
      clicks: [
        { t: 0, x: 100, y: -80 },
        { t: 6, x: -60, y: -150 },
        { t: 12, x: 80, y: 60 },
        { t: 18, x: 0, y: 0 },
      ],
    });
    expect(r.arrived).toBe(true);
    expect(r.finalDist).toBeLessThan(1);
    expect(r.rotAfter).toBeLessThan(0.05);
  });

  it('cruiser settles calmly too', () => {
    const far = fly({ ship: 'cruiser', clicks: [{ t: 0, x: -300, y: -200 }], seconds: 60 });
    expect(far.arrived).toBe(true);
    expect(far.rotAfter).toBeLessThan(0.05);
    const hop = fly({ ship: 'cruiser', planet: true, clicks: [{ t: 0, x: 30, y: -20 }] });
    expect(hop.arrived).toBe(true);
    expect(hop.rotAfter).toBeLessThan(0.05);
    expect(hop.rotTotal).toBeLessThan(2.5);
  });

  it('hovers steadily under moderate gravity near a planet', () => {
    const r = fly({ planet: true, clicks: [{ t: 0, x: 650, y: 70 }], seconds: 60 });
    expect(r.arrived).toBe(true);
    expect(r.rotAfter).toBeLessThan(0.3);
    expect(r.finalDist).toBeLessThan(2);
  });
});

describe('maneuvering thrusters', () => {
  it('scale with surviving engines', () => {
    const world = new World();
    const p = world.spawnPlayer(buildFighter(), 0, 0);
    const full = p.engineSummary().maneuver;
    expect(full / p.mass).toBeCloseTo(0.16 * 30, 3);
    for (const m of p.grid.modules) if (m.kind === 'engine') p.grid.removeCell(m.core);
    expect(p.engineSummary().maneuver).toBe(0);
  });
});
