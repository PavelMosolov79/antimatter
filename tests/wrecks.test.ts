import { beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import type { Scene } from '../src/render/scene';
import { buildFighter } from '../src/sim/ships';
import { WRECK, WRECK_KINDS, buildWreck, inspect, wreckBody, wreckSpec, type WreckKind } from '../src/sim/wrecks';
import { genChunk } from '../src/sim/sky';
import { SECTOR_IDS } from '../src/sim/space';
import { inBarracks } from '../src/sim/roster';
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

const DT = 1 / 60;

describe('wrecks', () => {
  it('are built for every kind and seed, as one hull of cells, in different sizes and shapes', () => {
    const sizes = new Map<WreckKind, Set<number>>();
    for (const kind of WRECK_KINDS) {
      sizes.set(kind, new Set());
      for (let seed = 1; seed <= 12; seed++) {
        const c = wreckBody(0, 0, seed, kind);
        const g = buildWreck(c);
        expect(g.cells).toBeGreaterThan(20);
        sizes.get(kind)!.add(g.width * 1000 + g.height);
        expect(c.radius).toBeGreaterThan(10);
        // the same every time
        expect(buildWreck(c).cells).toBe(g.cells);
      }
      expect(sizes.get(kind)!.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('are the player\'s own classes and the enemies\' for ship wrecks, and hurt', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const p = wreckSpec(wreckBody(0, 0, seed, 'player'));
      const e = wreckSpec(wreckBody(0, 0, seed, 'enemy'));
      seen.add('p:' + p.ship);
      seen.add('e:' + e.ship);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
    const whole = buildFighter('strike');
    const g = buildWreck(wreckBody(0, 0, 3, 'player'));
    expect(g.cells).toBeLessThan(g.width * g.height * g.depth);
    void whole;
  });

  it('hold something decided by the seed: metal, money, a survivor, nothing, or a trap now and then', () => {
    const kinds = new Set<string>();
    let traps = 0;
    for (const kind of WRECK_KINDS) {
      for (let seed = 1; seed <= 200; seed++) {
        const c = wreckBody(0, 0, seed, kind);
        const a = inspect(c);
        expect(JSON.stringify(inspect(c))).toBe(JSON.stringify(a));
        if (a.trap) traps++;
        else kinds.add(a.find!.type);
      }
    }
    expect([...kinds].sort()).toEqual(['credits', 'metal', 'nothing', 'survivor']);
    expect(traps / 800).toBeGreaterThan(0.15);
    expect(traps / 800).toBeLessThan(0.35);
  });

  it('turn up in the sky of every sector, and stand clear of the rest', () => {
    for (const sector of SECTOR_IDS) {
      let n = 0;
      for (let cx = -6; cx <= 6; cx++) for (let cy = -6; cy <= 6; cy++) n += genChunk(sector, 3, cx, cy).filter((c) => c.kind === 'wreck').length;
      expect(n).toBeGreaterThanOrEqual(3);
    }
  });
});

function wreckWorld(kind: WreckKind, seed: number): { w: World; c: ReturnType<typeof wreckBody>; ship: ReturnType<World['spawnShip']> } {
  const w = new World(1);
  const c = wreckBody(0, 0, seed, kind);
  w.addCelestial(c);
  const body = w.bodies[0];
  const ship = w.spawnShip(buildFighter('strike'), body.x + body.radius + 60, body.y, 0, { name: 'P', team: 0, player: true });
  w.autopilot = false;
  return { w, c, ship };
}

describe('wrecks in the world', () => {
  it('lie where they are, as hulls that can be shot to pieces for metal', () => {
    const { w } = wreckWorld('station', 4);
    const hull = w.bodies[0];
    expect(hull.anchored).toBe(true);
    const x = hull.x;
    for (let i = 0; i < 60; i++) w.step(DT);
    expect(hull.x).toBe(x);
    w.explode(hull.x, hull.y, 14, 400, 1);
    for (let i = 0; i < 5; i++) w.step(DT);
    const metal = w.notes.filter((n) => n.type === 'salvage').reduce((s, n) => s + (n.type === 'salvage' ? n.metal : 0), 0);
    expect(metal).toBeGreaterThan(0);
  });

  it('are looked over by staying close and slow, once, and give what the seed holds', () => {
    // find a seed with a find, and one with a trap
    let plain = 0;
    let trapped = 0;
    for (let s = 1; s < 200 && (!plain || !trapped); s++) {
      const a = inspect(wreckBody(0, 0, s, 'enemy'));
      if (a.find && a.find.type !== 'nothing' && !plain) plain = s;
      if (a.trap && !trapped) trapped = s;
    }
    const { w, c } = wreckWorld('enemy', plain);
    const want = inspect(c).find!;
    for (let i = 0; i < 60 * (WRECK.inspectTime + 1); i++) w.step(DT);
    const finds = w.notes.filter((n) => n.type === 'find');
    expect(finds.length).toBe(1);
    expect(finds[0].type === 'find' && finds[0].find.type).toBe(want.type);
    // not again
    w.notes.length = 0;
    for (let i = 0; i < 60 * 5; i++) w.step(DT);
    expect(w.notes.filter((n) => n.type === 'find').length).toBe(0);
    void trapped;
  });

  it('are not looked over by a ship flying by fast', () => {
    const { w, ship } = wreckWorld('enemy', 5);
    ship.vx = -200;
    for (let i = 0; i < 60; i++) {
      ship.vx = -200;
      w.step(DT);
    }
    expect(w.inspecting).toBeNull();
    expect(w.notes.filter((n) => n.type === 'find' || n.type === 'trap').length).toBe(0);
  });

  it('spring a trap now and then: a mine, a reactor on a fuse, an ambush', () => {
    const seen = new Set<string>();
    for (const kind of WRECK_KINDS) {
      for (let s = 1; s < 300; s++) {
        const a = inspect(wreckBody(0, 0, s, kind));
        if (a.trap) seen.add(a.trap);
      }
    }
    expect([...seen].sort()).toEqual(['ambush', 'mine', 'reactor']);
    // a station's reactor
    let reactor = 0;
    for (let s = 1; s < 300 && !reactor; s++) if (inspect(wreckBody(0, 0, s, 'station')).trap === 'reactor') reactor = s;
    const { w } = wreckWorld('station', reactor);
    for (let i = 0; i < 60 * (WRECK.inspectTime + 0.5); i++) w.step(DT);
    expect(w.notes.some((n) => n.type === 'trap' && n.trap === 'reactor')).toBe(true);
    let boom = false;
    for (let i = 0; i < 60 * (WRECK.reactorFuse + 1); i++) {
      w.step(DT);
      if (w.events.some((e) => e.t === 'detonate')) boom = true;
      w.events.length = 0;
    }
    expect(boom).toBe(true);
  });

  it('do not come back once looked over or shot away, when the sky is laid out again', () => {
    const w = new World(1);
    const c = wreckBody(5000, 5000, 9, 'ancient');
    w.addCelestial(c);
    const hull = w.bodies[0];
    hull.removed = true; // shot to pieces
    w.step(DT);
    w.removeCelestial(c);
    w.addCelestial(wreckBody(5000, 5000, 9, 'ancient'));
    expect(w.bodies.filter((b) => !b.removed).length).toBe(0);
  });
});

describe('wrecks in the game', () => {
  function newGame(): Game {
    const scene = { reset() {}, render() {}, layerView: -1 } as unknown as Scene;
    return new Game(scene);
  }

  it('put metal and money in the hold, and a survivor wounded in the barracks', () => {
    const g = newGame();
    g.screen = 'game';
    g.startRun();
    g.travel(1);
    // the briefing stands the world still; close it as the player would
    g.endBriefing();
    const before = { ...g.run!.cargo };
    g.world.notes.push({ type: 'find', find: { type: 'metal', amount: 5, text: 'm' } }, { type: 'find', find: { type: 'credits', amount: 40, text: 'c' } }, { type: 'salvage', metal: 2 });
    g.tick(DT);
    expect(g.run!.cargo.metal).toBe(before.metal + 7);
    expect(g.run!.cargo.credits).toBe(before.credits + 40);
    const people = inBarracks(g.roster).length;
    g.world.notes.push({ type: 'find', find: { type: 'survivor', text: 's' } });
    g.tick(DT);
    const now = inBarracks(g.roster);
    expect(now.length).toBe(people + 1);
    expect(now.some((m) => m.status === 'hurt')).toBe(true);
    expect(g.toasts.length).toBeGreaterThan(0);
  });

  it('send enemies out of an ambush', () => {
    const g = newGame();
    g.screen = 'game';
    g.startRun();
    g.travel(1);
    g.endBriefing();
    const enemies = () => g.world.bodies.filter((b) => b.kind === 'ship' && b.sys?.team === 1).length;
    const n = enemies();
    g.world.notes.push({ type: 'ambush', x: 800, y: 800, n: 2 });
    g.tick(DT);
    expect(enemies()).toBe(n + 2);
  });
});
