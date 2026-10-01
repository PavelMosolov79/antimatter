import { describe, expect, it } from 'vitest';
import { buildCruiser, buildFighter } from '../src/sim/ships';
import { AUTOPILOT } from '../src/sim/autopilot';
import { World } from '../src/sim/world';

interface Click {
  t: number;
  x: number;
  y: number;
}

interface Result {
  finalAngle: number;
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
  return { finalAngle: p.angle, arrived, finalDist: Math.hypot(p.x - target.x, p.y - target.y), rotTotal, rotAfter, maxDriftAfter: maxDrift };
}

function angleTo(x: number, y: number): number {
  return Math.atan2(x, -y);
}

function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
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
    expect(diag.rotTotal).toBeLessThan(2);
  });

  it('long trips turn once to aim and never flip around to brake', () => {
    const ahead = fly({ clicks: [{ t: 0, x: 260, y: -270 }] });
    expect(ahead.arrived).toBe(true);
    expect(ahead.rotTotal).toBeLessThan(1.5);
    expect(angDiff(ahead.finalAngle, angleTo(260, -270))).toBeLessThan(0.4);
    const behind = fly({ clicks: [{ t: 0, x: 0, y: 300 }] });
    expect(behind.arrived).toBe(true);
    expect(behind.rotTotal).toBeLessThan(3.8);
    expect(angDiff(behind.finalAngle, angleTo(0, 300))).toBeLessThan(0.4);
    const cruiser = fly({ ship: 'cruiser', clicks: [{ t: 0, x: -300, y: -200 }], seconds: 70 });
    expect(cruiser.arrived).toBe(true);
    expect(cruiser.rotTotal).toBeLessThan(2.5);
    expect(angDiff(cruiser.finalAngle, angleTo(-300, -200))).toBeLessThan(0.4);
  });

  it('falls back to flip-and-burn when the brake nozzles are destroyed', () => {
    const world = new World(1);
    const p = world.spawnPlayer(buildFighter(), 0, 0, 0);
    for (const m of p.grid.modules) if (m.kind === 'brake') p.grid.removeCell(m.core);
    p.syncMassProps();
    world.target = { x: 0, y: -300 };
    let rot = 0;
    let last = p.angle;
    for (let i = 0; i < 60 * 45; i++) {
      world.step(1 / 60);
      rot += Math.abs(p.angle - last);
      last = p.angle;
    }
    expect(Math.hypot(p.x, p.y + 300)).toBeLessThan(3);
    expect(rot).toBeGreaterThan(2.5);
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

  it('backs up on the brake nozzles when the point is just behind', () => {
    const r = fly({ clicks: [{ t: 0, x: 0, y: 6 }] });
    expect(r.arrived).toBe(true);
    expect(r.rotTotal).toBeLessThan(0.1);
  });

  it('hovers steadily under moderate gravity near a planet', () => {
    const r = fly({ planet: true, clicks: [{ t: 0, x: 650, y: 70 }], seconds: 60 });
    expect(r.arrived).toBe(true);
    expect(r.rotAfter).toBeLessThan(0.3);
    expect(r.finalDist).toBeLessThan(2);
  });
});

describe('flight control works the drives in tandem', () => {
  interface Trace {
    world: World;
    overlap: number;
    headingJump: number;
    wFlips: number;
    minDist: number;
    distAfterReach: number;
    clearedAt: number;
    /** Once the nose has come round onto the point, the furthest it strays off it (far out). */
    strayAfterAim: number;
    /** Frames the main drives burned while the nose was still well off its heading. */
    burnOnTurn: number;
    maxTurnRate: number;
  }

  function trace(opts: { autopilot: boolean; clicks: Click[]; seconds: number }): Trace {
    const world = new World(1);
    world.autopilot = opts.autopilot;
    const p = world.spawnPlayer(buildFighter(), 0, 0, 0);
    const pending = [...opts.clicks];
    let target = { x: 0, y: 0 };
    let overlap = 0;
    let headingJump = 0;
    let lastHeading: number | null = null;
    let wFlips = 0;
    let lastW = 0;
    let minDist = Infinity;
    let reached = false;
    let distAfterReach = 0;
    let clearedAt = -1;
    let aimed = false;
    let strayAfterAim = 0;
    let burnOnTurn = 0;
    let maxTurnRate = 0;
    const wrap = (a: number) => {
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return a;
    };
    for (let i = 0; i < opts.seconds * 60; i++) {
      let retargeted = false;
      while (pending.length > 0 && pending[0].t * 60 <= i) {
        const c = pending.shift()!;
        target = { x: c.x, y: c.y };
        world.target = target;
        retargeted = true;
      }
      const had = world.target !== null;
      world.step(1 / 60);
      const ctl = world.playerControl;
      if (ctl.main > 0.02 && ctl.back > 0.02) overlap++;
      if (ctl.heading !== null && lastHeading !== null && !retargeted) {
        let d = ctl.heading - lastHeading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        headingJump = Math.max(headingJump, Math.abs(d));
      }
      lastHeading = ctl.heading;
      const sw = Math.sign(Math.round(p.w * 10));
      if (sw !== 0 && sw !== lastW) {
        wFlips++;
        lastW = sw;
      }
      const dist = Math.hypot(p.x - target.x, p.y - target.y);
      if (pending.length === 0) {
        minDist = Math.min(minDist, dist);
        if (dist < 1) reached = true;
        if (reached) distAfterReach = Math.max(distAfterReach, dist);
      }
      if (had && world.target === null && clearedAt < 0) clearedAt = i / 60;
      if (retargeted) aimed = false;
      const off = Math.abs(wrap(p.angle - Math.atan2(target.x - p.x, -(target.y - p.y))));
      if (dist > AUTOPILOT.holdDist) {
        if (off < 0.1) aimed = true;
        else if (aimed) strayAfterAim = Math.max(strayAfterAim, off);
      }
      if (ctl.main > 0.01 && ctl.heading !== null && Math.abs(wrap(ctl.heading - p.angle)) > AUTOPILOT.alignOff) burnOnTurn++;
      maxTurnRate = Math.max(maxTurnRate, Math.abs(p.w));
    }
    return { world, overlap, headingJump, wFlips, minDist, distAfterReach, clearedAt, strayAfterAim, burnOnTurn, maxTurnRate };
  }

  const retarget = [
    { t: 0, x: 0, y: -600 },
    { t: 3, x: 250, y: -250 },
  ];

  it('never burns the main drives against the brakes', () => {
    for (const autopilot of [true, false]) {
      for (const clicks of [[{ t: 0, x: 300, y: -100 }], [{ t: 0, x: 0, y: 300 }], retarget]) {
        expect(trace({ autopilot, clicks, seconds: 20 }).overlap).toBe(0);
      }
    }
  });

  it('changes course at speed by turning steadily onto the point, not swinging the nose about', () => {
    const turns = [retarget, [retarget[0], { t: 3, x: -300, y: -150 }], [retarget[0], { t: 3, x: 50, y: 100 }]];
    for (const clicks of turns) {
      const r = trace({ autopilot: true, clicks, seconds: 22 });
      // The heading it steers for moves continuously — no jumping between strategies.
      expect(r.headingJump).toBeLessThan(0.15);
      // Once round, the nose only ever leads a little into the drift.
      expect(r.strayAfterAim).toBeLessThan(AUTOPILOT.maxLead + 0.1);
      // A steady turn, not a whip, and the spin changes direction only a few times.
      expect(r.maxTurnRate).toBeLessThan(AUTOPILOT.maxTurnRate + 0.1);
      expect(r.wFlips).toBeLessThanOrEqual(3);
      // No burning on the turn: the main drives wait for the nose to come round.
      expect(r.burnOnTurn).toBe(0);
      expect(r.distAfterReach).toBeLessThan(1.5);
    }
  });

  it('with the autopilot on, comes to rest on the point without overshooting it', () => {
    for (const clicks of [[{ t: 0, x: 300, y: -100 }], [{ t: 0, x: 0, y: 300 }], retarget]) {
      const r = trace({ autopilot: true, clicks, seconds: 22 });
      const p = r.world.player!;
      expect(r.distAfterReach).toBeLessThan(1.5);
      expect(Math.hypot(p.x - clicks[clicks.length - 1].x, p.y - clicks[clicks.length - 1].y)).toBeLessThan(0.7);
      expect(Math.hypot(p.vx, p.vy)).toBeLessThan(0.1);
      expect(Math.abs(p.w)).toBeLessThan(0.01);
      // Once at rest, nothing keeps firing.
      const ctl = r.world.playerControl;
      expect(ctl.main + ctl.back + ctl.right + ctl.left).toBeLessThan(0.02);
    }
  });

  it('with the autopilot off, flies to the point, drops it and keeps its speed', () => {
    const r = trace({ autopilot: false, clicks: [{ t: 0, x: 300, y: -100 }], seconds: 8 });
    expect(r.clearedAt).toBeGreaterThan(0);
    expect(r.minDist).toBeLessThan(6);
    const p = r.world.player!;
    const v0 = Math.hypot(p.vx, p.vy);
    expect(v0).toBeGreaterThan(30);
    const heading = p.angle;
    for (let i = 0; i < 180; i++) r.world.step(1 / 60);
    // Coasting: same speed, no spin, nothing firing.
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(v0, 3);
    expect(Math.abs(p.angle - heading)).toBeLessThan(0.02);
    expect(r.world.playerControl.main).toBe(0);
  });

  it('with the autopilot off, has no speed cap: a far point keeps it accelerating past cruise speed', () => {
    const cruise = AUTOPILOT.speedTime * 30;
    const off = trace({ autopilot: false, clicks: [{ t: 0, x: 0, y: -60000 }], seconds: 20 });
    const vOff = Math.hypot(off.world.player!.vx, off.world.player!.vy);
    expect(vOff).toBeGreaterThan(cruise * 2);
    // Autopilot on keeps to the cruise speed.
    const on = trace({ autopilot: true, clicks: [{ t: 0, x: 0, y: -60000 }], seconds: 20 });
    expect(Math.hypot(on.world.player!.vx, on.world.player!.vy)).toBeLessThan(cruise * 1.2);
  });
});
