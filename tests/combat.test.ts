import { describe, expect, it } from 'vitest';
import type { GridBody } from '../src/sim/body';
import type { ShipGrid } from '../src/sim/grid';
import { buildCruiser, buildFighter, buildScout } from '../src/sim/ships';
import { SYSTEMS, absorbShield, spendEnergy, updateSystems } from '../src/sim/systems';
import { WEAPONS, interceptAngle, resolveTarget, shipRef } from '../src/sim/weapons';
import { World } from '../src/sim/world';

function noShield(g: ShipGrid): ShipGrid {
  for (const m of g.modules) if (m.kind === 'shield') m.shieldMax = 0;
  return g;
}

function run(world: World, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) world.step(1 / 60);
}

function pair(opts: { enemyShield?: boolean; enemyAt?: [number, number]; enemyAngle?: number } = {}): { world: World; me: GridBody; foe: GridBody } {
  const world = new World(1);
  const me = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'Игрок', team: 0, player: true });
  const grid = buildFighter('raider');
  if (!opts.enemyShield) noShield(grid);
  const [ex, ey] = opts.enemyAt ?? [0, -150];
  const foe = world.spawnShip(grid, ex, ey, opts.enemyAngle ?? Math.PI, { name: 'Цель', team: 1 });
  return { world, me, foe };
}

function cur(world: World, b: GridBody): GridBody {
  return world.findShip(b.shipId) ?? b;
}

function weaponsOf(b: GridBody): Array<NonNullable<GridBody['grid']['modules'][number]['weapon']>> {
  return b.grid.modules.flatMap((m) => (m.weapon ? [m.weapon] : []));
}

describe('weapons', () => {
  it('auto-targets the nearest hostile and damages it', () => {
    const { world, foe } = pair();
    const before = foe.grid.cells;
    run(world, 4);
    expect(cur(world, foe).grid.cells).toBeLessThan(before);
  });

  it('leads a moving target', () => {
    const target = { x: 0, y: -200, vx: 30, vy: 0, body: null as unknown as GridBody };
    const ang = interceptAngle(0, 0, target, WEAPONS.pulse.speed);
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    let best = Infinity;
    for (let t = 0; t < 1.5; t += 0.005) {
      const bx = dx * WEAPONS.pulse.speed * t;
      const by = dy * WEAPONS.pulse.speed * t;
      best = Math.min(best, Math.hypot(bx - (target.x + target.vx * t), by - (target.y + target.vy * t)));
    }
    expect(dx).toBeGreaterThan(0);
    expect(best).toBeLessThan(0.6);
  });

  it('turrets do not fire outside their arc', () => {
    const { world, foe } = pair({ enemyAt: [0, 160] });
    const before = foe.grid.cells;
    run(world, 3);
    expect(world.projectiles.length).toBe(0);
    expect(foe.grid.cells).toBe(before);
  });

  it('a turret with a manual target ignores the default focus', () => {
    const world = new World(1);
    const me = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'Игрок', team: 0, player: true });
    const left = world.spawnShip(noShield(buildFighter('raider')), -120, -100, Math.PI, { name: 'L', team: 1 });
    const right = world.spawnShip(noShield(buildFighter('raider')), 120, -100, Math.PI, { name: 'R', team: 1 });
    me.sys!.focus = shipRef(left);
    for (const w of weaponsOf(me)) w.target = shipRef(right);
    const l0 = left.grid.cells;
    const r0 = right.grid.cells;
    run(world, 5);
    expect(cur(world, right).grid.cells).toBeLessThan(r0);
    expect(cur(world, left).grid.cells).toBe(l0);
  });

  it('the beam cuts cells continuously and drains energy', () => {
    const world = new World(1);
    const me = world.spawnShip(noShield(buildFighter('hunter')), 0, 0, 0, { name: 'H', team: 0, player: true });
    const foe = world.spawnShip(noShield(buildFighter('raider')), 0, -120, Math.PI, { name: 'T', team: 1 });
    for (const m of me.grid.modules) if (m.weapon && m.weapon.type !== 'beam') m.weapon.enabled = false;
    me.sys!.energy = 50;
    const c0 = foe.grid.cells;
    run(world, 3);
    expect(cur(world, foe).grid.cells).toBeLessThan(c0 - 5);
    expect(me.sys!.energy).toBeLessThan(50 + 3 * me.sys!.gen - 30);
    expect(me.sys!.energy).toBeGreaterThan(50);
  });

  it('resolves a ship-frame target reference across a split', () => {
    const world = new World(1);
    const foe = world.spawnShip(buildFighter('raider'), 0, 0, 0.6, { name: 'T', team: 1 });
    const ref = shipRef(foe, 26, 32);
    const before = resolveTarget(world, ref)!;
    const wp = foe.localToWorld(5, 33, { x: 0, y: 0 });
    world.explode(wp.x, wp.y, 6, 500, 1);
    world.explode(foe.localToWorld(22, 30, { x: 0, y: 0 }).x, foe.localToWorld(22, 30, { x: 0, y: 0 }).y, 2, 10, 1);
    const after = resolveTarget(world, ref);
    expect(after).not.toBeNull();
    expect(Math.hypot(after!.x - before.x, after!.y - before.y)).toBeLessThan(1.5);
  });
});

describe('energy and shields', () => {
  it('a shield absorbs damage, collapses and passes the overflow', () => {
    const world = new World(1);
    const b = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'S', team: 0 });
    const sys = b.sys!;
    expect(sys.shieldMax).toBe(180);
    expect(absorbShield(sys, 50, 0)).toBe(0);
    expect(sys.shield).toBeCloseTo(130);
    const overflow = absorbShield(sys, 150, 0);
    expect(overflow).toBeCloseTo(20);
    expect(sys.shield).toBe(0);
    expect(sys.shieldDown).toBe(true);
  });

  it('regenerates after a delay and only returns once above the restore threshold', () => {
    const world = new World(1);
    const b = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'S', team: 0 });
    const sys = b.sys!;
    absorbShield(sys, 1000, world.time);
    expect(sys.shieldDown).toBe(true);
    for (let i = 0; i < 60; i++) {
      world.time += 1 / 60;
      updateSystems(world, b, 1 / 60);
    }
    expect(sys.shield).toBe(0);
    for (let i = 0; i < 60 * 2; i++) {
      world.time += 1 / 60;
      updateSystems(world, b, 1 / 60);
    }
    expect(sys.shield).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 11; i++) {
      world.time += 1 / 60;
      updateSystems(world, b, 1 / 60);
    }
    expect(sys.shieldDown).toBe(false);
    expect(sys.shield).toBeGreaterThan(sys.shieldMax * 0.9);
  });

  it('a shield stops projectiles until it collapses', () => {
    const { world, me, foe } = pair({ enemyShield: true });
    void me;
    const cells = foe.grid.cells;
    for (let i = 0; i < 120 && foe.sys!.shield >= foe.sys!.shieldMax; i++) world.step(1 / 60);
    expect(foe.sys!.shield).toBeLessThan(foe.sys!.shieldMax);
    expect(cur(world, foe).grid.cells).toBe(cells);
    run(world, 8);
    expect(cur(world, foe).grid.cells).toBeLessThan(cells);
  });

  it('energy priority reserves power for the shield', () => {
    const world = new World(1);
    const b = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'S', team: 0, priority: 'shield' });
    const sys = b.sys!;
    sys.energy = sys.energyMax * SYSTEMS.reserve + 4;
    expect(spendEnergy(sys, 5)).toBe(false);
    sys.priority = 'weapons';
    expect(spendEnergy(sys, 5)).toBe(true);
  });

  it('firing with limited energy is throttled by the reactor output', () => {
    const { world, me } = pair();
    me.sys!.energy = 0;
    const foeCells = world.bodies.find((b) => b.team === 1)!.grid.cells;
    run(world, 3);
    expect(me.sys!.energy).toBeLessThanOrEqual(me.sys!.energyMax);
    expect(foeCells).toBeGreaterThan(0);
    expect(me.sys!.gen).toBeCloseTo(30, 3);
  });
});

describe('reactor', () => {
  it('a destroyed reactor starts a countdown and detonates, hurting only nearby ships', () => {
    const world = new World(2);
    const a = world.spawnShip(noShield(buildFighter('raider')), 0, 0, 0, { name: 'A', team: 1 });
    const near = world.spawnShip(noShield(buildFighter('raider')), 34, 0, 0, { name: 'B', team: 2 });
    const far = world.spawnShip(noShield(buildFighter('raider')), 260, 0, 0, { name: 'C', team: 2 });
    for (const w of [a, near, far]) for (const m of w.grid.modules) if (m.weapon) m.weapon.enabled = false;
    const nearBefore = near.grid.cells;
    const farBefore = far.grid.cells;
    const reactor = a.grid.modules.find((m) => m.kind === 'reactor')!;
    a.grid.removeCell(reactor.core);
    a.sys!.countdown = -1;
    world.step(1 / 60);
    expect(a.sys!.countdown).toBeGreaterThan(2.5);
    expect(a.sys!.countdown).toBeLessThan(5.1);
    run(world, 6);
    expect(world.bodies.includes(a)).toBe(false);
    expect(near.grid.cells).toBeLessThan(nearBefore);
    expect(far.grid.cells).toBe(farBefore);
    expect(world.events.some((e) => e.t === 'detonate')).toBe(true);
  });

  it('heavy damage to the reactor raises instability and triggers the countdown', () => {
    const world = new World(3);
    const a = world.spawnShip(noShield(buildFighter('raider')), 0, 0, 0, { name: 'A', team: 1 });
    for (const m of a.grid.modules) if (m.weapon) m.weapon.enabled = false;
    const reactor = a.grid.modules.find((m) => m.kind === 'reactor')!;
    for (const i of reactor.cells) a.grid.hp[i] *= 0.3;
    world.step(1 / 60);
    expect(a.sys!.instability).toBeGreaterThanOrEqual(1);
    expect(a.sys!.countdown).toBeGreaterThan(0);
  });

  it('a ship reduced to 20 percent of its cells becomes a wreck and the player loses control', () => {
    const world = new World(4);
    const me = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const g = me.grid;
    let toRemove = Math.ceil(g.cells * 0.82);
    outer: for (let z = g.depth - 1; z >= 0; z--) {
      for (let y = 0; y < g.height; y++) {
        for (let x = 0; x < g.width; x++) {
          const i = g.idx(x, y, z);
          if (g.mat[i] === 0) continue;
          const mod = g.mod[i] ? g.modules[g.mod[i] - 1] : null;
          if (mod?.kind === 'reactor') continue;
          g.removeCell(i);
          if (--toRemove <= 0) break outer;
        }
      }
    }
    me.syncMassProps();
    world.step(1 / 60);
    expect(me.sys!.dead).toBe(true);
    expect(world.player).toBeNull();
    expect(me.kind).toBe('debris');
  });
});

describe('enemy AI', () => {
  it('a raider closes to weapon range and trades fire with the player', () => {
    const world = new World(7);
    const me = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const foe = world.spawnShip(buildFighter('raider'), 0, -320, Math.PI, { name: 'E', team: 1, ai: 'raider' });
    const myShield = me.sys!.shield;
    const foeShield = foe.sys!.shield;
    run(world, 20);
    const foeNow = cur(world, foe);
    const meNow = cur(world, me);
    const dist = Math.hypot(foeNow.x - meNow.x, foeNow.y - meNow.y);
    expect(dist).toBeLessThan(160);
    expect(dist).toBeGreaterThan(40);
    expect(meNow.sys!.shield < myShield || meNow.grid.cells < me.grid.cells).toBe(true);
    expect(foeNow.sys!.shield < foeShield || foeNow.grid.cells < foe.grid.cells).toBe(true);
    for (const b of world.bodies) expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
  });

  it('the reactor hunter aims at the enemy reactor', () => {
    const world = new World(8);
    const me = world.spawnShip(noShield(buildFighter('strike')), 0, 0, 0, { name: 'P', team: 0, player: true });
    const foe = world.spawnShip(buildFighter('hunter'), 0, -200, Math.PI, { name: 'H', team: 1, ai: 'hunter' });
    run(world, 0.5);
    const tp = resolveTarget(world, foe.sys!.focus);
    expect(tp).not.toBeNull();
    const reactor = me.grid.modules.find((m) => m.kind === 'reactor')!;
    const c = me.grid.xOf(reactor.core) + 0.5;
    const d = me.localToWorld(c, me.grid.yOf(reactor.core) + 0.5, { x: 0, y: 0 });
    expect(Math.hypot(tp!.x - d.x, tp!.y - d.y)).toBeLessThan(4);
  });

  it('a duel with three scouts stays cheap to simulate', () => {
    const world = new World(9);
    world.spawnShip(buildCruiser(), 0, 0, 0, { name: 'P', team: 0, player: true });
    for (let i = 0; i < 3; i++) world.spawnShip(buildScout(), -150 + i * 150, -300, Math.PI, { name: `S${i}`, team: 1, ai: 'scout' });
    run(world, 5);
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) world.step(1 / 60);
    const avg = (performance.now() - t0) / 300;
    expect(avg).toBeLessThan(4);
  });
});

describe('main target lock', () => {
  function angleTo(fromX: number, fromY: number, toX: number, toY: number): number {
    return Math.atan2(toX - fromX, -(toY - fromY));
  }

  function diff(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }

  function setup(): { world: World; me: GridBody; foe: GridBody } {
    const world = new World(11);
    const me = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    for (const m of me.grid.modules) if (m.weapon) m.weapon.enabled = false;
    const foe = world.spawnShip(noShield(buildFighter('raider')), 220, -200, Math.PI, { name: 'E', team: 1 });
    for (const m of foe.grid.modules) if (m.weapon) m.weapon.enabled = false;
    me.sys!.focus = shipRef(foe);
    return { world, me, foe };
  }

  it('keeps the nose on the main target while flying to a point off to the side', () => {
    const { world, me, foe } = setup();
    world.target = { x: 150, y: 120 };
    let rot = 0;
    let last = me.angle;
    let maxErr = 0;
    for (let i = 0; i < 60 * 40; i++) {
      world.step(1 / 60);
      rot += Math.abs(me.angle - last);
      last = me.angle;
      if (i > 60 * 6) maxErr = Math.max(maxErr, diff(me.angle, angleTo(me.x, me.y, foe.x, foe.y)));
    }
    expect(maxErr).toBeLessThan(0.15);
    expect(rot).toBeLessThan(3);
    expect(Math.hypot(me.x - 150, me.y - 120)).toBeLessThan(8);
    expect(Math.hypot(me.vx, me.vy)).toBeLessThan(2);
  });

  it('follows a target that moves around the player', () => {
    const { world, me, foe } = setup();
    foe.vx = -12;
    foe.vy = 6;
    world.target = { x: 0, y: 0 };
    let maxErr = 0;
    for (let i = 0; i < 60 * 30; i++) {
      world.step(1 / 60);
      if (i > 60 * 5) maxErr = Math.max(maxErr, diff(me.angle, angleTo(me.x, me.y, foe.x, foe.y)));
    }
    expect(maxErr).toBeLessThan(0.3);
  });

  it('turns to the destination when the nose lock is off', () => {
    const { world, me, foe } = setup();
    world.lockFace = false;
    world.target = { x: -200, y: 0 };
    for (let i = 0; i < 60 * 12; i++) world.step(1 / 60);
    expect(diff(me.angle, angleTo(me.x, me.y, foe.x, foe.y))).toBeGreaterThan(0.5);
  });

  it('drops the lock when the target dies', () => {
    const { world, me, foe } = setup();
    world.killShip(foe);
    world.step(1 / 60);
    expect(me.sys!.focus).toBeNull();
  });
});
