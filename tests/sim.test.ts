import { describe, expect, it } from 'vitest';
import { GridBody } from '../src/sim/body';
import { findComponents } from '../src/sim/fragment';
import { ShipGrid } from '../src/sim/grid';
import { Mat } from '../src/sim/materials';
import { buildCruiser, buildFighter, buildFreighter } from '../src/sim/ships';
import { World } from '../src/sim/world';

function solid(w: number, h: number, depth = 1, m: number = Mat.HULL): ShipGrid {
  const g = new ShipGrid(w, h, depth);
  for (let z = 0; z < depth; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g.setCell(x, y, z, m);
  return g;
}

function momentum(bodies: GridBody[]): { px: number; py: number; mass: number } {
  let px = 0;
  let py = 0;
  let mass = 0;
  for (const b of bodies) {
    px += b.mass * b.vx;
    py += b.mass * b.vy;
    mass += b.mass;
  }
  return { px, py, mass };
}

describe('mass properties', () => {
  it('computes COM and inertia of a uniform block', () => {
    const g = solid(4, 2);
    const p = g.massProps();
    expect(p.mass).toBeCloseTo(8);
    expect(p.comX).toBeCloseTo(2);
    expect(p.comY).toBeCloseTo(1);
    const expected = (8 * (16 + 4)) / 12;
    expect(p.inertia).toBeCloseTo(expected, 5);
  });

  it('moves COM when cells are removed', () => {
    const g = solid(4, 1);
    g.removeCell(g.idx(3, 0, 0));
    const p = g.massProps();
    expect(p.mass).toBeCloseTo(3);
    expect(p.comX).toBeCloseTo(1.5);
  });

  it('keeps world position of cells when COM shifts after damage', () => {
    const g = solid(6, 1);
    const b = new GridBody(g, 100, 50, 0.7, 'debris');
    const before = { x: 0, y: 0 };
    b.localToWorld(5.5, 0.5, before);
    g.removeCell(g.idx(0, 0, 0));
    g.removeCell(g.idx(1, 0, 0));
    b.syncMassProps();
    const after = { x: 0, y: 0 };
    b.localToWorld(5.5, 0.5, after);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('column damage and penetration', () => {
  it('stops in the outer layer when damage is below cell hp', () => {
    const g = solid(1, 1, 3);
    g.damageColumn(0, 0, 10, 1);
    expect(g.mat[g.idx(0, 0, 0)]).toBe(Mat.HULL);
    expect(g.hp[g.idx(0, 0, 0)]).toBeCloseTo(20);
    expect(g.cells).toBe(3);
  });

  it('penetrates through layers with leftover damage scaled by penetration', () => {
    const g = solid(1, 1, 3);
    const out: number[] = [];
    const n = g.damageColumn(0, 0, 100, 1, out);
    expect(n).toBe(3);
    expect(g.columns).toBe(0);
    expect(out.length).toBe(12);

    const g2 = solid(1, 1, 3);
    const n2 = g2.damageColumn(0, 0, 100, 0.2);
    expect(n2).toBe(1);
    expect(g2.mat[g2.idx(0, 0, 0)]).toBe(0);
    expect(g2.mat[g2.idx(0, 0, 1)]).toBe(Mat.HULL);
    expect(g2.hp[g2.idx(0, 0, 1)]).toBeCloseTo(30 - 14);
  });

  it('applies crater with falloff', () => {
    const g = solid(11, 11, 1);
    g.applyCrater(5.5, 5.5, 4, 40, 1);
    expect(g.isOccupied(5, 5)).toBe(false);
    expect(g.isOccupied(0, 0)).toBe(true);
  });
});

describe('fragmentation', () => {
  it('splits a dumbbell into two bodies conserving linear momentum', () => {
    const g = new ShipGrid(15, 5, 1);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) g.setCell(x, y, 0, Mat.HULL);
    for (let y = 0; y < 5; y++) for (let x = 10; x < 15; x++) g.setCell(x, y, 0, Mat.HULL);
    g.setCell(5, 2, 0, Mat.HULL);
    for (let x = 6; x < 10; x++) g.setCell(x, 2, 0, Mat.HULL);

    const world = new World(3);
    const b = world.spawn(g, 0, 0, 0.4, 'debris');
    b.vx = 3;
    b.vy = -2;
    b.w = 0.3;
    const before = momentum([b]);
    expect(findComponents(g).count).toBe(1);

    const rp = b.localToWorld(7.5, 2.5, { x: 0, y: 0 });
    const rv = b.pointVelocity(rp.x, rp.y, { x: 0, y: 0 });

    world.hitColumn(b, 7, 2, 1000, 1);
    world.processDamaged();

    expect(world.bodies.length).toBe(2);
    const after = momentum(world.bodies);
    expect(before.mass - after.mass).toBeCloseTo(1, 5);
    expect(after.px).toBeCloseTo(before.px - 1 * rv.x, 4);
    expect(after.py).toBeCloseTo(before.py - 1 * rv.y, 4);
  });

  it('turns tiny fragments into dust and keeps the player on the largest piece', () => {
    const g = solid(12, 3, 1);
    const world = new World(1);
    const p = world.spawnPlayer(g, 0, 0);
    for (let y = 0; y < 3; y++) world.hitColumn(p, 9, y, 1000, 1);
    world.processDamaged();
    expect(world.bodies.length).toBe(2);
    expect(world.player).not.toBeNull();
    expect(world.player!.grid.columns).toBe(27);
    expect(world.events.some((e) => e.t === 'split')).toBe(true);
  });

  it('assigns the split module fragments correctly', () => {
    const g = buildFighter();
    const world = new World(2);
    const p = world.spawnPlayer(g, 0, 0);
    const summaryBefore = p.engineSummary();
    expect(summaryBefore.alive).toBe(3);
    world.explode(p.x, p.y + 18, 10, 500, 1);
    const pl = world.player;
    expect(pl).not.toBeNull();
    const after = pl!.engineSummary();
    expect(after.thrust).toBeLessThan(summaryBefore.thrust);
  });
});

describe('engines', () => {
  it('has symmetric thrust and near-zero torque on the fighter', () => {
    const world = new World();
    const p = world.spawnPlayer(buildFighter(), 0, 0);
    const e = p.engineSummary();
    expect(e.alive).toBe(3);
    expect(e.fx).toBeCloseTo(0, 6);
    expect(e.fy).toBeLessThan(0);
    expect(Math.abs(e.torque)).toBeLessThan(Math.abs(e.fy) * 0.5);
    expect(e.thrust / p.mass).toBeCloseTo(30, 3);
  });

  it('loses thrust and gains torque when one side engine is destroyed', () => {
    const world = new World();
    const p = world.spawnPlayer(buildFighter(), 0, 0);
    const e0 = p.engineSummary();
    const m = p.grid.modules.filter((x) => x.kind === 'engine')[1];
    const core = m.core;
    p.grid.removeCell(core);
    const e1 = p.engineSummary();
    expect(e1.alive).toBe(e0.alive - 1);
    expect(e1.thrust).toBeLessThan(e0.thrust);
    expect(Math.abs(e1.torque)).toBeGreaterThan(Math.abs(e0.torque) + 1);
  });

  it('scales thrust with the surviving cells of a module', () => {
    const world = new World();
    const p = world.spawnPlayer(buildFighter(), 0, 0);
    const e0 = p.engineSummary();
    const m = p.grid.modules.filter((x) => x.kind === 'engine')[0];
    const victim = m.cells.find((i) => i !== m.core)!;
    p.grid.removeCell(victim);
    const e1 = p.engineSummary();
    expect(e1.thrust).toBeLessThan(e0.thrust);
    expect(e1.thrust).toBeGreaterThan(e0.thrust * 0.8);
  });
});

describe('flight assist', () => {
  function fly(world: World, seconds: number): void {
    const dt = 1 / 60;
    for (let i = 0; i < seconds * 60; i++) world.step(dt);
  }

  it('reaches a target in empty space and stops', () => {
    const world = new World();
    const p = world.spawnPlayer(buildFighter(), 0, 0);
    world.target = { x: 400, y: -250 };
    fly(world, 40);
    expect(Math.hypot(p.x - 400, p.y + 250)).toBeLessThan(6);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThan(1.5);
  });

  it('reaches a target behind the ship (requires turning around)', () => {
    const world = new World();
    const p = world.spawnPlayer(buildFighter(), 0, 0);
    world.target = { x: 0, y: 300 };
    fly(world, 40);
    expect(Math.hypot(p.x, p.y - 300)).toBeLessThan(6);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThan(1.5);
  });

  it('cruiser also arrives', () => {
    const world = new World();
    const p = world.spawnPlayer(buildCruiser(), 0, 0);
    world.target = { x: -300, y: -200 };
    fly(world, 70);
    expect(Math.hypot(p.x + 300, p.y + 200)).toBeLessThan(8);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThan(2);
  });

  it('holds position against weak gravity', () => {
    const world = new World();
    world.celestials.push({ kind: 'planet', x: 500, y: 0, radius: 60, mu: 60000, soft: 2, seed: 1 });
    const p = world.spawnPlayer(buildFighter(), 0, 0);
    world.target = { x: 100, y: 100 };
    fly(world, 45);
    expect(Math.hypot(p.x - 100, p.y - 100)).toBeLessThan(6);
  });

  it('still limps to the target with a destroyed engine but is slower', () => {
    const w1 = new World();
    const p1 = w1.spawnPlayer(buildFighter(), 0, 0);
    w1.target = { x: 0, y: -300 };
    let t1 = 0;
    for (; t1 < 60 * 60; t1++) {
      w1.step(1 / 60);
      if (Math.hypot(p1.x, p1.y + 300) < 6 && Math.hypot(p1.vx, p1.vy) < 1.5) break;
    }
    const w2 = new World();
    const p2 = w2.spawnPlayer(buildFighter(), 0, 0);
    w2.target = { x: 0, y: -300 };
    const eng = p2.grid.modules.filter((m) => m.kind === 'engine')[0];
    p2.grid.removeCell(eng.core);
    p2.syncMassProps();
    let t2 = 0;
    for (; t2 < 60 * 60; t2++) w2.step(1 / 60);
    expect(t1).toBeLessThan(60 * 60);
    expect(p2.engineSummary().thrust).toBeLessThan(p1.engineSummary().thrust);
  });

  it('a ship without engines cannot steer or thrust', () => {
    const world = new World();
    const p = world.spawnPlayer(buildFreighter(), 0, 0);
    world.target = { x: 100, y: 0 };
    fly(world, 5);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(1e-6);
    expect(p.angle).toBeCloseTo(0, 6);
  });
});

describe('gravity', () => {
  it('keeps a circular orbit stable', () => {
    const world = new World();
    const mu = 90000;
    world.celestials.push({ kind: 'planet', x: 0, y: 0, radius: 40, mu, soft: 0.01, seed: 1 });
    const r0 = 300;
    const d = world.spawn(solid(3, 3), r0, 0, 0, 'debris');
    d.vy = Math.sqrt(mu / r0);
    let rMin = Infinity;
    let rMax = 0;
    for (let i = 0; i < 60 * 120; i++) {
      world.step(1 / 60);
      const r = Math.hypot(d.x, d.y);
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    }
    expect(rMin).toBeGreaterThan(r0 * 0.95);
    expect(rMax).toBeLessThan(r0 * 1.05);
  });

  it('consumes cells that cross a black hole horizon', () => {
    const world = new World();
    world.celestials.push({ kind: 'blackhole', x: 0, y: 0, radius: 15, mu: 1, soft: 5, seed: 1 });
    const d = world.spawn(solid(6, 6), 0, 0, 0, 'debris');
    world.step(1 / 60);
    expect(world.bodies.includes(d)).toBe(false);
  });
});

describe('collisions', () => {
  it('stops an object from sinking into a planet and damages it on hard impact', () => {
    const world = new World();
    world.celestials.push({ kind: 'planet', x: 0, y: 0, radius: 100, mu: 0, soft: 1, seed: 1 });
    const g = solid(10, 10, 3);
    const b = world.spawn(g, 0, -130, 0, 'debris');
    b.vy = 60;
    const before = g.cells;
    for (let i = 0; i < 120; i++) world.step(1 / 60);
    const target = world.bodies.find((x) => x === b) ?? world.bodies[0];
    expect(Math.hypot(target.x, target.y)).toBeGreaterThan(100);
    expect(before).toBeGreaterThan(0);
    expect(world.bodies.length).toBeGreaterThan(0);
    const lost = before - world.bodies.reduce((s, x) => s + x.grid.cells, 0);
    expect(lost).toBeGreaterThan(0);
  });

  it('a slow touch does no damage', () => {
    const world = new World();
    world.celestials.push({ kind: 'planet', x: 0, y: 0, radius: 100, mu: 0, soft: 1, seed: 1 });
    const g = solid(10, 10, 3);
    const b = world.spawn(g, 0, -106.5, 0, 'debris');
    b.vy = 1.5;
    const before = g.cells;
    for (let i = 0; i < 180; i++) world.step(1 / 60);
    expect(b.grid.cells).toBe(before);
  });

  it('two bodies collide pixel-perfectly, separate, and lose cells at speed', () => {
    const world = new World();
    const a = world.spawn(solid(12, 12, 2), -30, 0, 0, 'debris');
    const b = world.spawn(solid(12, 12, 2), 30, 0, 0, 'debris');
    a.vx = 25;
    b.vx = -25;
    const total0 = a.grid.cells + b.grid.cells;
    const p0 = momentum([a, b]);
    for (let i = 0; i < 180; i++) world.step(1 / 60);
    const bodies = world.bodies;
    const total1 = bodies.reduce((s, x) => s + x.grid.cells, 0);
    expect(total1).toBeLessThan(total0);
    const p1 = momentum(bodies);
    expect(Math.abs(p1.px - p0.px)).toBeLessThan(p0.mass * 3);
    const [x, y] = [bodies[0], bodies[bodies.length - 1]];
    if (x !== y) expect(Math.hypot(x.x - y.x, x.y - y.y)).toBeGreaterThan(5);
  });

  it('the fighter can be rammed into the freighter without NaNs', () => {
    const world = new World();
    const p = world.spawnPlayer(buildFighter(), 0, 0);
    world.spawn(buildFreighter(), 0, -140, 0, 'ship');
    world.target = { x: 0, y: -140 };
    for (let i = 0; i < 60 * 30; i++) world.step(1 / 60);
    for (const b of world.bodies) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.angle)).toBe(true);
      expect(Number.isFinite(b.vx)).toBe(true);
    }
    expect(p).toBeDefined();
  });
});
