import { describe, expect, it } from 'vitest';
import { keepClear } from '../src/sim/ai';
import type { GridBody } from '../src/sim/body';
import { buildCruiser, buildFighter, buildScout } from '../src/sim/ships';
import { World } from '../src/sim/world';

/** A target that does not shoot back, so nobody is crippled and every touch is the flying's fault. */
function harmlessCruiser(): ReturnType<typeof buildCruiser> {
  const g = buildCruiser();
  for (const m of g.modules) m.weapon = undefined;
  return g;
}

/** Counts the times two enemy ships touched (once a second at most for the same two). */
function touchesBetweenEnemies(seed: number, seconds: number): number {
  const world = new World(seed);
  world.spawnShip(harmlessCruiser(), 0, 0, 0, { name: 'P', team: 0, player: true });
  for (let i = 0; i < 3; i++) world.spawnShip(buildFighter('raider'), -260 + i * 100 + seed, -300, Math.PI, { name: `R${i}`, team: 1, ai: 'raider' });
  for (let i = 0; i < 2; i++) world.spawnShip(buildScout(), 200 + i * 70, -280 - seed * 10, Math.PI, { name: `S${i}`, team: 1, ai: 'scout' });
  let touches = 0;
  const last = new Map<string, number>();
  const impact = world.impact.bind(world);
  world.impact = (x: number, y: number, energy: number) => {
    const ships = world.bodies.filter((b) => !b.removed && b.kind === 'ship').sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    const [a, b] = ships;
    if (a && b && !a.isPlayer && !b.isPlayer && Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius) {
      const key = [a.shipId, b.shipId].sort().join('-');
      if ((last.get(key) ?? -9) < world.time - 1) touches++;
      last.set(key, world.time);
    }
    impact(x, y, energy);
  };
  for (let i = 0; i < seconds * 60; i++) world.step(1 / 60);
  return touches;
}

describe('ships flown by the computer keep clear of each other', () => {
  it('a pack round a ship that stands still does not ram itself', () => {
    // before the spacing this was 8, 8 and 17 touches in the same minute
    for (const seed of [1, 2, 3]) expect(touchesBetweenEnemies(seed, 60)).toBe(0);
  });

  it('of two meeting head on, the younger gives way and steps aside', () => {
    const world = new World(1);
    const a = world.spawnShip(buildFighter('raider'), 0, 0, 0, { name: 'A', team: 1, ai: 'raider' });
    const b = world.spawnShip(buildFighter('raider'), 120, 0, 0, { name: 'B', team: 1, ai: 'raider' });
    a.vx = 30;
    b.vx = -30;
    const older = keepClear(world, a, null);
    const younger = keepClear(world, b, null);
    expect(older.giveWay).toBeNull();
    expect(younger.giveWay).toBe(a);
    // aside means off the line they fly along
    expect(Math.abs(younger.y)).toBeGreaterThan(10);
  });

  it('is pushed off a neighbour that is too close, but not off the ship it fights', () => {
    const world = new World(1);
    const foe = world.spawnShip(buildFighter('strike'), 0, -60, 0, { name: 'F', team: 0 });
    const me = world.spawnShip(buildFighter('raider'), 0, 0, 0, { name: 'M', team: 1, ai: 'raider' });
    const mate = world.spawnShip(buildFighter('raider'), 40, 0, 0, { name: 'N', team: 1, ai: 'raider' });
    const push = keepClear(world, me, foe as GridBody);
    expect(push.x).toBeLessThan(0);
    expect(Math.abs(push.y)).toBeLessThan(Math.abs(push.x));
    void mate;
  });
});
