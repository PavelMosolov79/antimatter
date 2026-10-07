import { describe, expect, it } from 'vitest';
import { CORRIDOR, hullChunk, planCorridor } from '../src/sim/corridor';
import { makeRock } from '../src/sim/rocks';
import { buildFighter } from '../src/sim/ships';
import { planetBody } from '../src/sim/space';
import { MINE, World } from '../src/sim/world';

const DT = 1 / 60;

describe('the way to the beacon', () => {
  it('has 4 to 7 places along it, clear of the start, the beacon, the task and anything big', () => {
    const beacon = { x: 300, y: -2800 };
    const site = { x: 100, y: -1300 };
    const planet = planetBody(900, -1800, 3, 'rocky');
    for (let seed = 1; seed < 30; seed++) {
      const c = planCorridor(seed, 2, { x: 0, y: 0 }, beacon, site, [planet]);
      expect(c.places.length).toBeGreaterThanOrEqual(CORRIDOR.minPlaces - 1);
      expect(c.places.length).toBeLessThanOrEqual(CORRIDOR.maxPlaces);
      for (const p of c.places) {
        expect(Math.hypot(p.x, p.y)).toBeGreaterThan(CORRIDOR.clearStart);
        expect(Math.hypot(p.x - site.x, p.y - site.y)).toBeGreaterThan(CORRIDOR.clearSite);
        expect(Math.hypot(p.x - planet.x, p.y - planet.y)).toBeGreaterThan(planet.radius + CORRIDOR.clearBig);
      }
      // there is something to look at all along: rocks and hull every couple of hundred cells, buoys on both sides
      expect(c.rocks.length + c.chunks.length).toBeGreaterThan(20);
      expect(c.buoys.filter((b) => b.red).length).toBeGreaterThan(3);
      expect(c.buoys.filter((b) => !b.red).length).toBeGreaterThan(3);
    }
    // the same seed is the same way
    expect(JSON.stringify(planCorridor(7, 2, { x: 0, y: 0 }, beacon, site, []))).toBe(JSON.stringify(planCorridor(7, 2, { x: 0, y: 0 }, beacon, site, [])));
  });

  it('pieces of hull are ragged blobs of plating', () => {
    const g = hullChunk(5, 10);
    expect(g.cells).toBeGreaterThan(30);
    expect(g.cells).toBeLessThan(144);
  });
});

describe('a raised shield', () => {
  function rockAt(w: World, x: number, vx: number) {
    const r = w.spawn(makeRock(9, 8, 0), x, 0, 0, 'debris');
    r.vx = vx;
    return r;
  }

  it('pushes a rock off, pays for it, and keeps the hull whole', () => {
    const w = new World(1);
    const p = w.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    w.autopilot = false;
    const cells = p.grid.cells;
    const shield = p.sys!.shield;
    const rock = rockAt(w, 120, -40);
    let least = shield;
    for (let i = 0; i < 60 * 4; i++) {
      w.step(DT);
      least = Math.min(least, p.sys!.shield);
    }
    expect(p.grid.cells).toBe(cells);
    expect(least).toBeLessThan(shield);
    // it went back the way it came
    expect(rock.vx).toBeGreaterThan(0);
  });

  it('down, lets the rock strike the hull', () => {
    const w = new World(1);
    const p = w.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    for (const m of p.grid.modules) if (m.kind === 'shield') m.shieldMax = 0;
    p.sys!.shieldMax = 0;
    p.sys!.shield = 0;
    w.autopilot = false;
    const cells = p.grid.cells;
    rockAt(w, 120, -60);
    for (let i = 0; i < 60 * 4; i++) w.step(DT);
    expect(p.grid.cells).toBeLessThan(cells);
  });
});

describe('old mines', () => {
  it('go off when a ship comes near', () => {
    const w = new World(1);
    const p = w.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    w.mines = [{ x: p.radius * 0.5 + MINE.trigger - 5, y: 0 }, { x: 900, y: 0 }];
    w.step(DT);
    expect(w.mines.length).toBe(1);
    let blew = false;
    for (let i = 0; i < 60; i++) {
      w.step(DT);
      if (w.events.some((e) => e.t === 'detonate')) blew = true;
      w.events.length = 0;
    }
    expect(blew).toBe(true);
  });
});
