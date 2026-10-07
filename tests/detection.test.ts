import { describe, expect, it } from 'vitest';
import { AI_SENSE, engaged, setPatrol } from '../src/sim/ai';
import { buildFighter, buildScout } from '../src/sim/ships';
import { World } from '../src/sim/world';

const DT = 1 / 60;
function run(w: World, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) w.step(DT);
}

/** A player far off and a patrol of two raiders round a loop. */
function patrolWorld(playerAt: [number, number]) {
  const w = new World(4);
  const p = w.spawnShip(buildFighter('strike'), playerAt[0], playerAt[1], 0, { name: 'P', team: 0, player: true });
  const route = [{ x: 0, y: -300 }, { x: 300, y: 0 }, { x: 0, y: 300 }, { x: -300, y: 0 }];
  const foes = [0, 1].map((i) => {
    const b = w.spawnShip(buildFighter('raider'), -40 + i * 90, -300, 0, { name: `R${i}`, team: 1, ai: 'raider' });
    setPatrol(b.sys!.ai!, 1, route, { x: 0, y: 0 });
    return b;
  });
  return { w, p, foes };
}

describe('a patrol', () => {
  it('flies its route and holds its fire while nobody is within its radius', () => {
    const { w, p, foes } = patrolWorld([2000, 0]);
    const hull = p.grid.cells;
    const start = { x: foes[0].x, y: foes[0].y };
    run(w, 12);
    expect(foes.every((f) => f.sys!.ai!.aware === 'patrol')).toBe(true);
    expect(Math.hypot(foes[0].x - start.x, foes[0].y - start.y)).toBeGreaterThan(100);
    // it stays round its loop
    expect(Math.hypot(foes[0].x, foes[0].y)).toBeLessThan(700);
    expect(p.grid.cells).toBe(hull);
  });

  it('sees whoever comes within its radius: the whole group turns, then fights', () => {
    const { w, foes } = patrolWorld([2000, 0]);
    const p = w.player!;
    p.x = foes[1].x + AI_SENSE.radius.raider * 0.6;
    p.y = foes[1].y;
    run(w, 0.5);
    expect(foes.every((f) => f.sys!.ai!.aware === 'alert')).toBe(true);
    run(w, 1.5);
    expect(foes.every((f) => f.sys!.ai!.aware === 'fight' && engaged(f.sys!.ai!))).toBe(true);
  });

  it('is set off by a hit from out of its sight too', () => {
    const { w, foes } = patrolWorld([2000, 0]);
    foes[0].sys!.lastHit = w.time;
    run(w, 0.3);
    expect(foes.every((f) => engaged(f.sys!.ai!))).toBe(true);
  });

  it('loses an enemy that keeps away, searches, and goes back to the route', () => {
    const { w, foes } = patrolWorld([2000, 0]);
    const p = w.player!;
    for (const f of foes) f.sys!.ai!.aware = 'fight';
    // far out of reach, and kept there
    p.x = 5000;
    p.y = 0;
    p.anchored = true;
    run(w, AI_SENSE.loseAfter + 1);
    expect(foes.every((f) => f.sys!.ai!.aware === 'search')).toBe(true);
    run(w, AI_SENSE.search + 1);
    expect(foes.every((f) => f.sys!.ai!.aware === 'patrol')).toBe(true);
  });

  it('a ship set on no patrol fights at once, as before', () => {
    const w = new World(1);
    w.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const s = w.spawnShip(buildScout(), 0, -900, 0, { name: 'S', team: 1, ai: 'scout' });
    expect(s.sys!.ai!.aware).toBe('fight');
  });
});
