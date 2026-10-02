import { beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import type { Scene } from '../src/render/scene';
import { HOLD_CAP, addToHold, deposit, emptyCargo, holdCap, previewAdd, rewardFor } from '../src/sim/cargo';
import { ROAD, Road, genLink } from '../src/sim/road';
import { captureShip, loadRun, loadWallet, restoreShip } from '../src/sim/runSave';
import { SHIPS } from '../src/sim/ships';
import { World } from '../src/sim/world';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

function newGame(): Game {
  const scene = { reset() {}, render() {}, layerView: -1 } as unknown as Scene;
  return new Game(scene);
}

describe('hold and rewards', () => {
  it('sizes the hold by class and gives unknown ships the smallest', () => {
    expect(holdCap('fighter')).toBe(40);
    expect(holdCap('cruiser')).toBe(120);
    expect(holdCap('battleship')).toBe(400);
    expect(holdCap('mystery')).toBe(HOLD_CAP.fighter);
  });

  it('pays more for harder points and nothing for points without a fight', () => {
    const link = genLink(1, 0);
    const combat = link[1];
    const boss = link[ROAD.bossSlot];
    const dock = link[ROAD.dockSlot];
    expect(rewardFor(boss).credits).toBeGreaterThan(rewardFor(combat).credits);
    expect(rewardFor(boss).metal).toBeGreaterThan(rewardFor(combat).metal);
    expect(rewardFor(dock)).toEqual(emptyCargo());
    expect(rewardFor(genLink(1, 6)[1]).credits).toBeGreaterThan(rewardFor(combat).credits);
  });

  it('only metal takes room: what does not fit stays in space, credits always go in', () => {
    const hold = { credits: 10, metal: 36 };
    const preview = previewAdd(hold, 40, { credits: 25, metal: 8 });
    expect(preview).toEqual({ gained: { credits: 25, metal: 4 }, lostMetal: 4 });
    expect(hold).toEqual({ credits: 10, metal: 36 });
    const got = addToHold(hold, 40, { credits: 25, metal: 8 });
    expect(got.lostMetal).toBe(4);
    expect(hold).toEqual({ credits: 35, metal: 40 });
    expect(addToHold(hold, 40, { credits: 0, metal: 5 }).lostMetal).toBe(5);
  });

  it('empties the hold into the wallet', () => {
    const hold = { credits: 30, metal: 12 };
    const wallet = { credits: 100, metal: 50 };
    expect(deposit(hold, wallet)).toEqual({ credits: 30, metal: 12 });
    expect(hold).toEqual(emptyCargo());
    expect(wallet).toEqual({ credits: 130, metal: 62 });
  });
});

describe('falling back on the road', () => {
  it('writes the stretch after a dock anew and leaves everything up to it alone', () => {
    const road = new Road(77);
    road.ensure(20);
    const before = road.points.map((p) => ({ ...p }));
    const dock = ROAD.dockSlot;
    road.regenAfter(dock);
    for (let i = 0; i <= dock; i++) expect(road.points[i]).toEqual(before[i]);
    const changed = road.points.slice(dock + 1).filter((p, k) => JSON.stringify(p) !== JSON.stringify(before[dock + 1 + k]));
    expect(changed.length).toBeGreaterThan(5);
    // The structure of a link does not move: the boss is still tenth, the dock fifth.
    expect(road.points[ROAD.bossSlot].kind).toBe('boss');
    expect(road.points[ROAD.stride + ROAD.dockSlot].kind).toBe('dock');
  });

  it('is rebuilt exactly from the seed, the number of links and the list of falls', () => {
    const road = new Road(5);
    road.ensure(7);
    road.regenAfter(5);
    road.ensure(18);
    road.regenAfter(11);
    road.ensure(25);
    const again = new Road(5, road.links, road.regens);
    expect(again.points).toEqual(road.points);
  });

  it('finds the last dock or gate at or before a point', () => {
    const road = new Road(3);
    road.ensure(15);
    expect(road.lastDock(3)).toBe(0);
    expect(road.lastDock(ROAD.dockSlot)).toBe(ROAD.dockSlot);
    expect(road.lastDock(ROAD.stride - 1)).toBe(ROAD.dockSlot);
    expect(road.lastDock(ROAD.stride)).toBe(ROAD.stride);
    expect(road.lastDock(ROAD.stride + 3)).toBe(ROAD.stride);
  });
});

describe('saving a run', () => {
  it('writes the ship as damage against its blueprint and puts it back the same', () => {
    const spec = SHIPS.find((s) => s.id === 'cruiser')!;
    const blueprint = spec.build();
    const world = new World(1);
    const ship = world.spawnShip(spec.build(), 0, 0, 0, { name: 'P', team: 0, player: true });
    world.explode(ship.x + 8, ship.y - 6, 5, 140, 0.6);
    for (let i = 0; i < 30; i++) world.step(1 / 60);
    const carried = world.player!;
    carried.sys!.crew![0].dead = true;
    for (let i = 0; i < carried.grid.mat.length; i++) if (carried.grid.mat[i] !== 0 && i % 97 === 0) carried.grid.hp[i] *= 0.5;
    const saved = captureShip(carried, blueprint);
    const wire = JSON.parse(JSON.stringify(saved));
    const back = restoreShip('cruiser', wire);
    expect(back.grid.cells).toBe(carried.grid.cells);
    expect(back.sys!.crew!.filter((c) => c.dead).map((c) => c.role)).toEqual(carried.sys!.crew!.filter((c) => c.dead).map((c) => c.role));
    expect(back.sys!.crew!.filter((c) => c.dead).length).toBe(1);
    for (const [bi, hp] of saved.hp) expect(back.grid.hp[bi]).toBeCloseTo(hp, 1);
    for (let z = 0; z < blueprint.depth; z++) {
      for (let y = 0; y < blueprint.height; y++) {
        for (let x = 0; x < blueprint.width; x++) {
          const i = carried.grid.idx(x - carried.frameX, y - carried.frameY, z);
          const here = x - carried.frameX >= 0 && y - carried.frameY >= 0 && x - carried.frameX < carried.grid.width && y - carried.frameY < carried.grid.height && carried.grid.mat[i] !== 0;
          expect(back.grid.mat[blueprint.idx(x, y, z)] !== 0).toBe(here);
        }
      }
    }
  });

  it('keeps an untouched ship tiny', () => {
    const spec = SHIPS[0];
    const world = new World(1);
    const ship = world.spawnShip(spec.build(), 0, 0, 0, { name: 'P', team: 0, player: true });
    const saved = captureShip(ship, spec.build());
    expect(saved.hp).toEqual([]);
    expect(saved.dead).toEqual([]);
    expect(restoreShip(spec.id, saved).grid.cells).toBe(ship.grid.cells);
  });
});

describe('a run through the game', () => {
  function toDock(g: Game): void {
    const run = g.run!;
    run.cleared = ROAD.dockSlot - 1;
    g.travel(ROAD.dockSlot);
  }

  function winFight(g: Game, index: number): void {
    g.travel(index);
    expect(g.runPhase).toBe('battle');
    g.state = 'won';
    g.continueRun();
  }

  it('puts the winnings in the hold, not in the wallet, and clamps metal to the hold', () => {
    const g = newGame();
    g.startRun();
    const reward = rewardFor(g.run!.road.points[1]);
    winFight(g, 1);
    expect(g.runPhase).toBe('map');
    expect(g.run!.cleared).toBe(1);
    expect(g.run!.cargo).toEqual(reward);
    expect(g.wallet).toMatchObject(emptyCargo());
    g.run!.cargo.metal = 39;
    const lost = g.run!.road.points[2];
    g.travel(2);
    expect(g.pendingReward()!.lostMetal).toBe(rewardFor(lost).metal - 1);
    g.state = 'won';
    g.continueRun();
    expect(g.run!.cargo.metal).toBe(40);
  });

  it('empties the hold into the wallet on entering a dock on the road, and saves', () => {
    const g = newGame();
    g.startRun();
    g.run!.cargo = { credits: 70, metal: 18 };
    toDock(g);
    expect(g.runPhase).toBe('roaddock');
    expect(g.run!.cargo).toEqual(emptyCargo());
    expect(g.run!.deposited).toEqual({ credits: 70, metal: 18 });
    expect(g.wallet).toMatchObject({ credits: 70, metal: 18 });
    expect(loadWallet()).toMatchObject({ credits: 70, metal: 18 });
    expect(loadRun()!.phase).toBe('roaddock');
    g.leaveRoadDock();
    expect(g.runPhase).toBe('map');
    expect(g.run!.cleared).toBe(ROAD.dockSlot);
  });

  it('on losing the ship loses the hold, falls back to the last dock on a whole ship and writes the stretch anew', () => {
    const g = newGame();
    g.startRun();
    toDock(g);
    g.leaveRoadDock();
    winFight(g, ROAD.dockSlot + 1);
    const walked = g.run!.road.points.slice(ROAD.dockSlot + 2).map((p) => ({ ...p }));
    const carried = { ...g.run!.cargo };
    expect(carried.credits).toBeGreaterThan(0);
    g.travel(ROAD.dockSlot + 2);
    g.state = 'lost';
    g.continueRun();
    expect(g.runPhase).toBe('over');
    expect(g.run!.lost).toEqual(carried);
    expect(g.run!.cargo).toEqual(emptyCargo());
    expect(g.wallet).toMatchObject(emptyCargo());
    expect(g.run!.cleared).toBe(ROAD.dockSlot);
    expect(g.run!.ship).toBeNull();
    expect(g.run!.road.regens).toEqual([ROAD.dockSlot]);
    expect(g.run!.road.points.slice(ROAD.dockSlot + 2)).not.toEqual(walked);
    // A reload on the result screen lands at the dock, not before the lost fight.
    expect(loadRun()!.cleared).toBe(ROAD.dockSlot);
    expect(loadRun()!.cargo).toEqual(emptyCargo());
    g.resumeAfterLoss();
    expect(g.runPhase).toBe('roaddock');
  });

  it('retreating banks the hold at the last dock and gives up the points past it', () => {
    const g = newGame();
    g.startRun();
    toDock(g);
    g.leaveRoadDock();
    winFight(g, ROAD.dockSlot + 1);
    winFight(g, ROAD.dockSlot + 2);
    const hold = { ...g.run!.cargo };
    expect(g.pointsToDock()).toBe(2);
    g.retreat();
    expect(g.runPhase).toBe('roaddock');
    expect(g.run!.cleared).toBe(ROAD.dockSlot);
    expect(g.wallet).toMatchObject(hold);
    expect(g.run!.cargo).toEqual(emptyCargo());
    // Nothing to fall back to when already at the dock.
    g.leaveRoadDock();
    g.retreat();
    expect(g.runPhase).toBe('map');
  });

  it('picks a saved run up where it was left, hold and damage included', () => {
    const g = newGame();
    g.startRun();
    winFight(g, 1);
    const ship = g.run!.ship!;
    for (let i = 0; i < 40; i++) if (ship.grid.mat[i * 31] !== 0) ship.grid.removeCell(i * 31);
    ship.syncMassProps();
    g.saveRun();
    const cells = ship.grid.cells;
    const hold = { ...g.run!.cargo };
    const h = newGame();
    expect(h.hasRun()).toBe(true);
    expect(h.continueSaved()).toBe(true);
    expect(h.runPhase).toBe('map');
    expect(h.run!.cleared).toBe(1);
    expect(h.run!.cargo).toEqual(hold);
    expect(h.run!.ship!.grid.cells).toBe(cells);
    expect(h.run!.road.points).toEqual(g.run!.road.points);
    // Giving the run up wipes the save, hold and all.
    h.abandonRun();
    expect(h.hasRun()).toBe(false);
  });

  it('does not save in the middle of a fight, so a reload cannot keep a win', () => {
    const g = newGame();
    g.startRun();
    g.travel(1);
    expect(g.runPhase).toBe('battle');
    expect(loadRun()!.cleared).toBe(0);
    g.saveRun();
    expect(loadRun()!.cleared).toBe(0);
  });
});
