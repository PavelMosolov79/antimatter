import { beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import type { Scene } from '../src/render/scene';
import { CREW } from '../src/sim/crewConfig';
import { ROAD } from '../src/sim/road';
import { inBarracks, emptyRoster } from '../src/sim/roster';
import { savedLayout } from '../src/sim/layoutStore';
import { TRADER, crewOffers, moduleOffers } from '../src/sim/trader';

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

function atTrader(): Game {
  const g = newGame();
  g.startRun();
  const p = g.run!.road.points[1];
  p.kind = 'shop';
  p.enemies = [];
  g.travel(1);
  return g;
}

describe('the trader', () => {
  it('offers the same things for the same point, modules of a higher level than the shop and people of a better rank', () => {
    const g = newGame();
    g.startRun();
    const p = g.run!.road.points[3];
    const a = moduleOffers(p);
    expect(a.length).toBe(TRADER.modules);
    expect(JSON.stringify(moduleOffers(p))).toBe(JSON.stringify(a));
    for (const o of a) {
      expect(o.lv).toBeGreaterThanOrEqual(TRADER.baseLevel);
      expect(o.price.credits).toBeGreaterThan(0);
    }
    expect(new Set(a.map((o) => o.type)).size).toBe(a.length);
    const c = crewOffers(p, emptyRoster());
    expect(c.length).toBe(TRADER.crew);
    for (const o of c) expect(o.member.rar).toBeGreaterThanOrEqual(3);
  });

  it('is a stop on the road with its own screen, and leaving it goes on to the next point', () => {
    const g = atTrader();
    expect(g.runPhase).toBe('trade');
    expect(g.trade!.modules.length).toBe(TRADER.modules);
    g.leaveTrade();
    expect(g.runPhase).toBe('map');
    expect(g.run!.cleared).toBe(1);
    expect(g.trade).toBeNull();
    expect(g.run!.note).toContain('ничего не куплено');
  });

  it('is paid for out of the hold: not enough there, nothing is bought; enough, the module goes to the stock', () => {
    const g = atTrader();
    const m = g.trade!.modules[0];
    expect(g.buyOffer(m.id)).toBe('credits');
    g.run!.cargo.credits = m.price.credits + 5;
    g.run!.cargo.metal = m.price.metal - 1 < 0 ? 0 : m.price.metal - 1;
    if (m.price.metal > 0) expect(g.buyOffer(m.id)).toBe('metal');
    g.run!.cargo.metal = m.price.metal;
    expect(g.buyOffer(m.id)).toBe('ok');
    expect(g.run!.cargo.credits).toBe(5);
    expect(g.run!.cargo.metal).toBe(0);
    expect(g.buyOffer(m.id)).toBe('sold');
    const layout = savedLayout(g.run!.shipId)!;
    expect(layout.stock!.some((s) => s.type === m.type && s.lv === m.lv)).toBe(true);
    g.leaveTrade();
    expect(g.run!.note).toContain('куплено 1');
  });

  it('hires a person into the barracks, unless it is full', () => {
    const g = atTrader();
    const c = g.trade!.crew[0];
    g.run!.cargo.credits = 10000;
    const before = inBarracks(g.roster).length;
    expect(g.buyOffer(c.id)).toBe('ok');
    expect(inBarracks(g.roster).length).toBe(before + 1);
    // fill the barracks
    while (inBarracks(g.roster).length < CREW.barracksMax) g.roster.members.push({ ...c.member, id: 9000 + g.roster.members.length, name: 'x' + g.roster.members.length, ship: null, post: null });
    expect(g.buyOffer(g.trade!.crew[1].id)).toBe('barracks');
  });

  it('is one of the kinds of the road now', () => {
    const g = newGame();
    g.startRun();
    // enough links that a shop is all but sure (each point has a small chance of being one)
    g.run!.road.ensure(ROAD.stride * 20);
    expect(g.run!.road.points.some((p) => p.kind === 'shop')).toBe(true);
  });
});
