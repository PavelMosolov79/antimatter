import { describe, expect, it } from 'vitest';
import { ORE_PER_QUANTUM, ORE_ROOM, addOre, deposit, emptyCargo, holdUsed, previewAdd } from '../src/sim/cargo';
import { MINING, isOre } from '../src/sim/mining';
import { Mat } from '../src/sim/materials';
import { makeRock } from '../src/sim/rocks';
import { playerShip } from '../src/sim/ships';
import { World } from '../src/sim/world';

const DT = 1 / 60;

function oreCells(g: ReturnType<typeof makeRock>): number {
  let n = 0;
  for (let i = 0; i < g.mat.length; i++) if (isOre(g.mat[i])) n++;
  return n;
}

function mineWorld(ship = 'cruiser') {
  const w = new World(3);
  const p = w.spawnShip(playerShip(ship), 0, 0, 0, { name: 'P', team: 0, player: true });
  const rockGrid = makeRock(12, 16, 1, 0.5);
  const rock = w.spawn(rockGrid, 40, -28, 0, 'debris');
  rock.anchored = true;
  return { w, p, rock, rockGrid };
}

describe('ore in rocks', () => {
  it('is made of cells of its own, gold and violet, only on rocks with veins and big enough', () => {
    expect(oreCells(makeRock(5, 14, 0))).toBe(0);
    expect(oreCells(makeRock(5, 5, 1))).toBe(0);
    expect(oreCells(makeRock(5, 14, 1))).toBeGreaterThan(5);
    const g2 = makeRock(5, 14, 2);
    let violet = 0;
    for (let i = 0; i < g2.mat.length; i++) if (g2.mat[i] === Mat.ORE2) violet++;
    expect(violet).toBeGreaterThan(5);
    expect(oreCells(makeRock(5, 14, 1, 0.5))).toBeGreaterThan(oreCells(makeRock(5, 14, 1, 0.1)));
  });
});

describe('the mining beam', () => {
  it('burns the ore of a rock in reach out cell by cell, and the crystals come to the ship and are counted', () => {
    const { w, rock, rockGrid } = mineWorld();
    const before = oreCells(rockGrid);
    let got = 0;
    for (let t = 0; t < 60 * 14; t++) {
      w.step(DT);
      for (const n of w.notes) if (n.type === 'ore') got++;
      w.notes.length = 0;
      w.events.length = 0;
    }
    expect(oreCells(rock.grid)).toBeLessThan(before);
    expect(got).toBeGreaterThanOrEqual(3);
    expect(before - oreCells(rock.grid)).toBeGreaterThanOrEqual(got);
  });

  it('does not touch the plain rock, only the ore', () => {
    const { w, rock, rockGrid } = mineWorld();
    let rockBefore = 0;
    for (let i = 0; i < rockGrid.mat.length; i++) if (rockGrid.mat[i] === Mat.ROCK) rockBefore++;
    for (let t = 0; t < 60 * 10; t++) {
      w.step(DT);
      w.notes.length = 0;
      w.events.length = 0;
    }
    let rockAfter = 0;
    for (let i = 0; i < rock.grid.mat.length; i++) if (rock.grid.mat[i] === Mat.ROCK) rockAfter++;
    expect(rockAfter).toBe(rockBefore);
  });

  it('wants the ship almost still, and stops when the hold has no room, and when the ship was just hit', () => {
    const fast = mineWorld();
    let before = oreCells(fast.rockGrid);
    for (let t = 0; t < 60; t++) {
      fast.p.vx = -30;
      fast.w.step(DT);
      fast.w.notes.length = 0;
      fast.w.events.length = 0;
    }
    expect(oreCells(fast.rock.grid)).toBe(before);

    const full = mineWorld();
    full.w.holdRoom = 0;
    let got = 0;
    for (let t = 0; t < 60 * 8; t++) {
      full.w.step(DT);
      for (const n of full.w.notes) if (n.type === 'ore') got++;
      full.w.notes.length = 0;
      full.w.events.length = 0;
    }
    expect(got).toBe(0);
    // the crystals wait about, they do not vanish at once
    expect(full.w.crystals.length).toBeGreaterThan(0);

    const hit = mineWorld();
    before = oreCells(hit.rockGrid);
    for (let t = 0; t < 60 * 3; t++) {
      hit.p.sys!.lastHit = hit.w.time;
      hit.w.step(DT);
      hit.w.notes.length = 0;
      hit.w.events.length = 0;
    }
    expect(oreCells(hit.rock.grid)).toBe(before);
  });

  it('is a gun with a gunner: without one it does nothing', () => {
    const { w, p, rock, rockGrid } = mineWorld();
    for (const c of p.sys!.crew!) if (c.role === 'gunner') c.dead = true;
    const before = oreCells(rockGrid);
    for (let t = 0; t < 60 * 4; t++) {
      w.step(DT);
      w.notes.length = 0;
      w.events.length = 0;
    }
    expect(oreCells(rock.grid)).toBe(before);
  });

  it('is on every ship of the player', () => {
    for (const id of ['fighter', 'cruiser', 'battleship']) {
      const g = playerShip(id);
      expect(g.modules.some((m) => m.weapon?.type === 'miner')).toBe(true);
    }
  });
});

describe('ore in the hold', () => {
  it('takes more room, never goes over the hold, and turns into quanta at a dock five pieces to one', () => {
    const hold = emptyCargo();
    expect(addOre(hold, 10, 1)).toBe(true);
    expect(addOre(hold, 10, 2)).toBe(true);
    expect(holdUsed(hold)).toBe(1 + ORE_ROOM);
    for (let i = 0; i < 20; i++) addOre(hold, 10, 2);
    expect(holdUsed(hold)).toBeLessThanOrEqual(10);
    // metal rewards see the ore's room
    expect(previewAdd(hold, 10, { credits: 0, metal: 50 }).gained.metal).toBe(10 - holdUsed(hold));
    const h = emptyCargo();
    h.ore = 7;
    const wallet = { credits: 0, metal: 0, quanta: 10 };
    const moved = deposit(h, wallet);
    expect(wallet.quanta).toBe(10 + Math.floor(7 / ORE_PER_QUANTUM));
    expect(moved.quanta).toBe(1);
    expect(h.ore).toBe(0);
    // what was left over is kept
    expect((wallet as { ore?: number }).ore).toBe(7 % ORE_PER_QUANTUM);
    h.ore = 4;
    deposit(h, wallet);
    expect(wallet.quanta).toBe(12);
  });
});

describe('the numbers', () => {
  it('keep a patrol later than the first cell and warned before it comes', () => {
    expect(MINING.patrolFirst).toBeGreaterThan(MINING.patrolWarn);
  });
});
