import { beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import type { Scene } from '../src/render/scene';
import { yardLayout } from '../src/sim/interior';
import { canPlaceModule, putModule } from '../src/sim/layout';
import { clearLayouts, saveLayout, savedLayout } from '../src/sim/layoutStore';
import { QUANTA_START } from '../src/sim/repairConfig';
import { loadRoster } from '../src/sim/roster';
import { loadRun, loadWallet } from '../src/sim/runSave';
import { SHIPS, shipDeckGeo } from '../src/sim/ships';
import { loadGarage } from '../src/sim/garage';

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
  clearLayouts();
});

function newGame(): Game {
  const scene = { reset() {}, render() {}, layerView: -1 } as unknown as Scene;
  return new Game(scene);
}

describe('a new game', () => {
  it('wipes the run, the resources, the damage, the people, the memory and the layouts', () => {
    const g = newGame();
    g.startRun();
    g.wallet.credits = 777;
    g.wallet.metal = 55;
    g.wallet.quanta = 1;
    g.travel(1);
    g.state = 'won';
    g.continueRun();
    // a ship in the garage with damage, a death, a changed layout
    g.garage.cruiser = { damage: { gone: 'AAAA', hp: [], dead: [] }, job: null };
    g.roster.memory.push({ name: 'Старый Герой', role: 'pilot', lv: 4, rar: 2, fights: 9, ship: 'cruiser', how: 'battle' });
    const geo = shipDeckGeo('fighter');
    const layout = yardLayout('fighter', geo);
    let placed = false;
    for (let z = 1; z < geo.depth && !placed; z++) for (let j = -2; j < 12 && !placed; j++) for (let i = -2; i < 12 && !placed; i++) if (canPlaceModule(geo, layout, z, i, j, 1, 1, null)) placed = putModule(geo, layout, 'gun', z, i, j, 1, 1, null, 3);
    expect(placed).toBe(true);
    saveLayout('fighter', layout);
    const had = g.newGameSummary();
    expect(had.credits).toBe(777);
    expect(had.fallen).toBe(1);
    expect(had.damaged).toBe(1);
    expect(had.upgraded).toBe(1);
    expect(had.run).not.toBeNull();

    g.newGame();

    expect(g.run).toBeNull();
    expect(loadRun()).toBeNull();
    expect(g.wallet).toEqual({ credits: 0, metal: 0, quanta: QUANTA_START });
    expect(loadWallet()).toEqual({ credits: 0, metal: 0, quanta: QUANTA_START });
    expect(Object.values(g.garage).every((e) => !e.damage && !e.job)).toBe(true);
    expect(Object.values(loadGarage()).every((e) => !e.damage && !e.job)).toBe(true);
    expect(g.roster.memory.length).toBe(0);
    expect(loadRoster().memory.length).toBe(0);
    expect(savedLayout('fighter')).toBeNull();
    // every ship has its first crew again, and the dock is open on the first ship
    for (const spec of SHIPS) expect(g.roster.members.some((m) => m.ship === spec.id)).toBe(true);
    expect(g.shipId).toBe(SHIPS[0].id);
    expect(g.runPhase).toBe('dock');
    const none = g.newGameSummary();
    expect(none.run).toBeNull();
    expect(none.fallen).toBe(0);
    expect(none.damaged).toBe(0);
    expect(none.upgraded).toBe(0);
  });

  it('tells the screens to forget what they kept', () => {
    const g = newGame();
    let called = 0;
    g.onNewGame.push(() => called++);
    g.newGame();
    expect(called).toBe(1);
  });
});
