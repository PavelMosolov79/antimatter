import { describe, expect, it } from 'vitest';
import { ShipGrid } from '../src/sim/grid';
import { Mat } from '../src/sim/materials';
import { buildCruiser } from '../src/sim/ships';
import { World } from '../src/sim/world';

function blob(w: number, h: number): ShipGrid {
  const g = new ShipGrid(w, h, 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      g.setCell(x, y, 0, Mat.HULL);
      g.setCell(x, y, 1, Mat.DECK);
    }
  }
  return g;
}

describe('performance', () => {
  it('steps a cruiser plus 200 colliding debris pieces well under the frame budget', () => {
    const world = new World(5);
    world.celestials.push({ kind: 'planet', x: 400, y: 0, radius: 100, mu: 90000, soft: 2, seed: 1 });
    world.spawnPlayer(buildCruiser(), 0, 0);
    for (let i = 0; i < 200; i++) {
      const b = world.spawn(blob(3 + (i % 8), 3 + ((i * 3) % 8)), ((i * 37) % 160) - 80, ((i * 53) % 160) - 80, i, 'debris');
      b.vx = ((i * 7) % 20) - 10;
      b.vy = ((i * 11) % 20) - 10;
      b.w = ((i * 5) % 10) / 5 - 1;
    }
    for (let i = 0; i < 60; i++) world.step(1 / 60);
    const n = 300;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) world.step(1 / 60);
    const avg = (performance.now() - t0) / n;
    console.log(`bodies=${world.bodies.length} avg step ${avg.toFixed(3)} ms`);
    expect(avg).toBeLessThan(4);
  });

  it('shatters a cruiser into many pieces without blowing the step time', () => {
    const world = new World(9);
    const p = world.spawnPlayer(buildCruiser(), 0, 0);
    const w = p.grid.width;
    const h = p.grid.height;
    const b0 = world.bodies[0];
    for (let k = 0; k < 40; k++) {
      const lp = b0.localToWorld(((k * 13) % (w - 6)) + 3, ((k * 29) % (h - 6)) + 3, { x: 0, y: 0 });
      world.explode(lp.x, lp.y, 6, 500, 1);
    }
    expect(world.bodies.length).toBeGreaterThan(1);
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) world.step(1 / 60);
    const avg = (performance.now() - t0) / 300;
    console.log(`shattered bodies=${world.bodies.length} avg step ${avg.toFixed(3)} ms`);
    expect(avg).toBeLessThan(4);
    for (const b of world.bodies) expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
  });
});
