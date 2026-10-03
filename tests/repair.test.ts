import { beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import type { Scene } from '../src/render/scene';
import { ROAD } from '../src/sim/road';
import { damageOf, quantaFor, quote, repairedDiff, severity, wreckOf } from '../src/sim/repair';
import { QUANTA_PER_BOSS, REPAIR, SPARE_SHIP } from '../src/sim/repairConfig';
import { loadGarage } from '../src/sim/garage';
import { captureShip, loadWallet, restoreShip } from '../src/sim/runSave';
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

/** A ship of the class with a stretch of its hull and one module shot away, as a difference from its blueprint. */
function damaged(shipId: string, hullShare = 0.1) {
  const spec = SHIPS.find((s) => s.id === shipId)!;
  const bp = spec.build();
  const body = new World(1).spawnShip(spec.build(), 0, 0, 0, { name: 'P', team: 0, player: true });
  const g = body.grid;
  const n = Math.floor(g.cells * hullShare);
  let k = 0;
  for (let i = 0; i < g.mat.length && k < n; i++) if (g.mat[i] !== 0 && g.mod[i] === 0) {
    g.removeCell(i);
    k++;
  }
  const m = g.modules[0];
  for (const i of [...m.cells]) if (g.mat[i] !== 0) g.removeCell(i);
  return { bp, diff: captureShip(body, bp) };
}

describe('the damage of a ship', () => {
  it('counts the cells gone and the modules out of action against the blueprint', () => {
    const { bp, diff } = damaged('cruiser');
    const d = damageOf(diff, bp);
    expect(d.any).toBe(true);
    expect(d.cells).toBeGreaterThan(100);
    expect(d.modules).toBeGreaterThanOrEqual(1);
    expect(d.hull).toBeLessThan(0.95);
    expect(d.hull).toBeGreaterThan(0.5);
    expect(damageOf(null, bp)).toMatchObject({ any: false, cells: 0, modules: 0, hull: 1 });
  });

  it('is total for a wreck: almost nothing of the hull, nobody alive, a ship that can still be built from', () => {
    const bp = SHIPS[1].build();
    const w = wreckOf(bp);
    const d = damageOf(w, bp);
    expect(d.wreck).toBe(true);
    expect(d.hull).toBeLessThan(0.1);
    expect(d.modules).toBe(d.modulesTotal);
    const back = restoreShip(SHIPS[1].id, w);
    expect(back.grid.cells).toBeGreaterThan(0);
    expect(back.sys!.crew!.every((c) => c.dead)).toBe(true);
  });
});

describe('what a repair costs', () => {
  it('takes ten, fifteen or twenty seconds by how bad the damage is, and costs metal by the damage', () => {
    const q = (share: number, id = 'cruiser') => {
      const d = damaged(id, share);
      return { dmg: damageOf(d.diff, d.bp), q: quote(damageOf(d.diff, d.bp), id, 'home') };
    };
    const light = q(0.03);
    const medium = q(0.15);
    const heavy = q(0.4);
    expect(severity(light.dmg)).toBe('light');
    expect(severity(medium.dmg)).toBe('medium');
    expect(severity(heavy.dmg)).toBe('heavy');
    expect(light.q.secs).toBe(10);
    expect(medium.q.secs).toBe(15);
    expect(heavy.q.secs).toBe(20);
    expect(heavy.q.metal).toBeGreaterThan(medium.q.metal);
    expect(medium.q.metal).toBeGreaterThan(light.q.metal);
    // the same on any ship, free on the spare
    expect(q(0.15, 'battleship').q.secs).toBe(15);
    const sp = q(0.03, SPARE_SHIP);
    expect(sp.q.metal).toBe(0);
    expect(sp.q.secs).toBe(10);
    const wr = SHIPS[1].build();
    const qw = quote(damageOf(wreckOf(wr), wr), 'cruiser', 'home');
    expect(qw.secs).toBe(20);
  });

  it('is quicker and cheaper at a dock on the road', () => {
    const { bp, diff } = damaged('cruiser', 0.2);
    const d = damageOf(diff, bp);
    const home = quote(d, 'cruiser', 'home');
    const road = quote(d, 'cruiser', 'road');
    expect(road.design).toBeCloseTo(home.design * REPAIR.roadTime, 5);
    expect(road.metal).toBe(Math.ceil(home.metal * REPAIR.roadCost));
  });

  it('prices speeding up by the time left, at least one', () => {
    expect(quantaFor(0.001)).toBe(1);
    expect(quantaFor(60)).toBe(Math.ceil(REPAIR.quantaPerMinute));
    expect(quantaFor(120)).toBeGreaterThan(quantaFor(10));
  });
});

describe('a repair under way', () => {
  it('puts the hull back first and the modules last, and brings the crew back only at the end', () => {
    const { bp, diff } = damaged('cruiser', 0.2);
    const full = damageOf(diff, bp);
    let prev = full.cells;
    for (const p of [0.25, 0.5, 0.75, 0.95]) {
      const d = damageOf(repairedDiff(diff, bp, p), bp);
      expect(d.cells).toBeLessThan(prev);
      prev = d.cells;
    }
    // the plain hull comes back before the broken module's cells
    const half = damageOf(repairedDiff(diff, bp, 0.5), bp);
    expect(half.modules).toBe(full.modules);
    expect(repairedDiff(diff, bp, 1)).toBeNull();
    const withDead = { ...diff, dead: [['gunner', -1]] as Array<[string, number]> };
    expect(repairedDiff(withDead, bp, 0.99)!.dead.length).toBe(1);
    expect(repairedDiff(withDead, bp, 1)).toBeNull();
  });
});

describe('the garage and the dock', () => {
  it('keeps the damage of a given-up run in the garage and starts the next run on the damaged ship', () => {
    const g = newGame();
    g.startRun();
    const { diff } = damaged('fighter', 0.1);
    g.run!.ship = restoreShip('fighter', diff);
    g.openDock('fighter');
    expect(g.garage.fighter.damage).not.toBeNull();
    expect(loadGarage().fighter.damage).not.toBeNull();
    expect(g.shipStatus('fighter').kind).toBe('damaged');
    expect(g.world.player!.grid.cells).toBeLessThan(g.blueprint('fighter').cells);
    expect(g.startRun()).toBe(true);
    expect(g.run!.ship).not.toBeNull();
    expect(g.run!.ship!.grid.cells).toBeLessThan(g.run!.blueprint.cells);
    expect(g.garage.fighter.damage).toBeNull();
  });

  it('repairs for metal on a timer, and a ship under repair cannot start a run', () => {
    const g = newGame();
    g.garage.cruiser = { damage: damaged('cruiser', 0.1).diff, job: null };
    g.openDock('cruiser');
    g.wallet.metal = 1;
    expect(g.startRepair()).toBe('metal');
    const st = g.repairState();
    g.wallet.metal = st.quote.metal + 5;
    expect(g.startRepair()).toBe('ok');
    expect(g.wallet.metal).toBe(5);
    expect(g.shipStatus('cruiser').kind).toBe('repair');
    expect(g.startRun()).toBe(false);
    // it mends as the clock runs, and is whole when the time is up
    const job = g.garage.cruiser.job!;
    const mid = g.repairState('cruiser', job.start + (job.total * 1000) / 2);
    expect(mid.damage.cells).toBeLessThan(st.damage.cells);
    expect(g.tickRepairs(job.start + job.total * 1000 + 10)).toBe(true);
    expect(g.shipStatus('cruiser').kind).toBe('ready');
    expect(g.dockNotes.join(' ')).toContain('Ремонт закончен');
    expect(g.startRun()).toBe(true);
  });

  it('does not fly a wreck until it is repaired', () => {
    const g = newGame();
    g.garage.cruiser = { damage: wreckOf(SHIPS[1].build()), job: null };
    g.openDock('cruiser');
    expect(g.startRun()).toBe(false);
    g.wallet.metal = 999999;
    g.wallet.quanta = 999;
    expect(g.startRepair()).toBe('ok');
    expect(g.startRun()).toBe(false);
    expect(g.speedUpRepair('full')).toBe(true);
    expect(g.startRun()).toBe(true);
  });

  it('speeds a repair up for quanta', () => {
    const g = newGame();
    g.garage.cruiser = { damage: damaged('cruiser', 0.2).diff, job: null };
    g.openDock('cruiser');
    g.wallet.metal = 99999;
    g.startRepair();
    const full = g.speedUpPrice('full')!;
    const half = g.speedUpPrice('half')!;
    expect(full).toBeGreaterThanOrEqual(half);
    g.wallet.quanta = 0;
    expect(g.speedUpRepair('half')).toBe(false);
    g.wallet.quanta = full + 10;
    const before = g.garage.cruiser.job!.total;
    expect(g.speedUpRepair('half')).toBe(true);
    expect(g.garage.cruiser.job!.total).toBeLessThan(before);
    expect(g.wallet.quanta).toBe(full + 10 - half);
    expect(g.speedUpRepair('full')).toBe(true);
    expect(g.shipStatus('cruiser').kind).toBe('ready');
  });

  it('leaves a ship that is lost as a wreck in the garage, and the run goes on on the spare', () => {
    const g = newGame();
    g.shipId = 'cruiser';
    g.startRun();
    g.travel(1);
    g.state = 'lost';
    g.continueRun();
    expect(g.run!.shipId).toBe(SPARE_SHIP);
    expect(g.shipId).toBe(SPARE_SHIP);
    expect(g.garage.cruiser.damage!.allDead).toBe(true);
    expect(g.shipStatus('cruiser').kind).toBe('wreck');
    g.resumeAfterLoss();
    expect(g.run!.ship!.grid.cells).toBe(g.blueprint(SPARE_SHIP).cells);
  });

  it('repairs at a dock on the road and lets the ship leave with what is mended so far', () => {
    const g = newGame();
    g.startRun();
    g.run!.ship = restoreShip('fighter', damaged('fighter', 0.2).diff);
    g.run!.cleared = ROAD.dockSlot - 1;
    g.travel(ROAD.dockSlot);
    expect(g.runPhase).toBe('roaddock');
    const st0 = g.repairState();
    expect(st0.where).toBe('road');
    expect(st0.damage.any).toBe(true);
    expect(g.startRepair()).toBe('ok');
    const job = g.run!.job!;
    // half the time passes, then the ship leaves
    const t = job.start + (job.total * 1000) / 2;
    const mid = g.repairState(SPARE_SHIP, t);
    expect(mid.damage.cells).toBeLessThan(st0.damage.cells);
    g.leaveRoadDock();
    expect(g.run!.job).toBeNull();
    expect(g.run!.ship).not.toBeNull();
    expect(g.runPhase).toBe('map');
  });

  it('gives quanta for a boss, and tops the wallet up to ten at the start of a run', () => {
    const g = newGame();
    expect(loadWallet().quanta).toBe(10);
    g.wallet.quanta = 3;
    g.startRun();
    expect(g.wallet.quanta).toBe(10);
    const bossIndex = g.run!.road.points.findIndex((p) => p.kind === 'boss');
    g.run!.cleared = bossIndex - 1;
    g.travel(bossIndex);
    g.state = 'won';
    g.continueRun();
    expect(g.wallet.quanta).toBe(10 + QUANTA_PER_BOSS);
    expect(loadWallet().quanta).toBe(10 + QUANTA_PER_BOSS);
  });
});
