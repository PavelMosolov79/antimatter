import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEVELS, LV_MAX, crewPlaces, effectText, holdCapacity, shortEffect, sizeFactor, upgradeCost } from '../src/sim/levels';
import { buildPlayerShip, yardLayout } from '../src/sim/interior';
import { canPlaceModule, cloneLayout, putModule, removeModuleToStock, takeFromStock, type DeckGeo, type ShipLayout } from '../src/sim/layout';
import { saveLayout } from '../src/sim/layoutStore';
import { SHIPS, buildCruiser, shipDeckGeo, shipHoldCap } from '../src/sim/ships';
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
afterEach(() => {
  for (const s of SHIPS) saveLayout(s.id, null);
});

/** Puts a module of the pool on the first free tile of any deck. */
function addPool(geo: DeckGeo, layout: ShipLayout, type: 'store' | 'crew' | 'gun', lv: number): number {
  for (let z = 1; z < geo.depth; z++) {
    for (let j = -2; j < Math.ceil(geo.h / 9) + 2; j++) {
      for (let i = -2; i < Math.ceil(geo.w / 9) + 2; i++) {
        if (!canPlaceModule(geo, layout, z, i, j, 1, 1, null)) continue;
        expect(putModule(geo, layout, type, z, i, j, 1, 1, null, lv)).toBe(true);
        return layout.mods[layout.mods.length - 1].id;
      }
    }
  }
  throw new Error('no free tile');
}

describe('module levels', () => {
  it('has five levels, and only the effects that exist in the game can be upgraded', () => {
    expect(LV_MAX).toBe(5);
    for (const d of Object.values(LEVELS)) expect(d.values).toHaveLength(LV_MAX);
    expect(LEVELS.store.live).toBe(true);
    expect(LEVELS.crew.live).toBe(true);
    expect(LEVELS.gun.live).toBe(false);
  });

  it('prices a level by its step and the size of the module', () => {
    expect(sizeFactor(1, 1)).toBe(1);
    expect(sizeFactor(2, 1)).toBe(1.5);
    expect(sizeFactor(2, 2)).toBe(2.5);
    expect(sizeFactor(3, 2)).toBe(3.5);
    expect(sizeFactor(3, 3)).toBe(5);
    expect(upgradeCost(1, 1, 2)).toEqual({ credits: 60, metal: 12 });
    expect(upgradeCost(1, 1, 5)).toEqual({ credits: 520, metal: 110 });
    expect(upgradeCost(3, 3, 5)).toEqual({ credits: 2600, metal: 550 });
    let total = 0;
    for (let lv = 2; lv <= LV_MAX; lv++) total += upgradeCost(1, 1, lv).credits;
    expect(total).toBe(1000);
  });

  it('words the effect of a level', () => {
    expect(shortEffect('gun', 1)).toBe('база');
    expect(shortEffect('gun', 3)).toBe('+20%');
    expect(shortEffect('work', 2)).toBe('×1,25');
    expect(shortEffect('crew', 5)).toBe('+6');
    expect(shortEffect('helm', 5)).toBe('2 с');
    expect(effectText('store', 3, 'fighter')).toContain('40 → 80');
  });

  it('grows the hold with every storeroom on the ship and nothing else', () => {
    const geo = shipDeckGeo('cruiser');
    const layout = yardLayout('cruiser', geo);
    expect(holdCapacity('cruiser', layout)).toBe(120);
    addPool(geo, layout, 'store', 1);
    expect(holdCapacity('cruiser', layout)).toBe(180);
    addPool(geo, layout, 'store', 5);
    expect(holdCapacity('cruiser', layout)).toBe(Math.round(120 * (1 + (50 + 170) / 100)));
    addPool(geo, layout, 'gun', 3);
    expect(holdCapacity('cruiser', layout)).toBe(Math.round(120 * 3.2));
  });

  it('reads the saved layout for the ship the player flies', () => {
    const base = shipHoldCap('cruiser');
    expect(base).toBe(120);
    const geo = shipDeckGeo('cruiser');
    const layout = yardLayout('cruiser', geo);
    addPool(geo, layout, 'store', 3);
    saveLayout('cruiser', layout);
    expect(shipHoldCap('cruiser')).toBe(240);
  });

  it('keeps the level of a module put back in the pool, and a first-level one simply returns to the endless pool', () => {
    const geo = shipDeckGeo('cruiser');
    const layout = yardLayout('cruiser', geo);
    const high = addPool(geo, layout, 'store', 4);
    const plain = addPool(geo, layout, 'crew', 1);
    expect(removeModuleToStock(layout, plain)).toBe(true);
    expect(layout.stock ?? []).toHaveLength(0);
    expect(removeModuleToStock(layout, high)).toBe(true);
    expect(layout.stock).toHaveLength(1);
    expect(layout.stock![0]).toMatchObject({ type: 'store', lv: 4 });
    const copy = cloneLayout(layout);
    expect(copy.stock).toEqual(layout.stock);
    const stockId = layout.stock![0].id;
    const id = addPool(geo, layout, 'store', layout.stock![0].lv);
    takeFromStock(layout, stockId);
    expect(layout.stock).toHaveLength(0);
    expect(layout.mods.find((m) => m.id === id)!.lv).toBe(4);
    // Base modules can never be taken away.
    expect(removeModuleToStock(layout, layout.mods.find((m) => m.base)!.id)).toBe(false);
  });

  it("carries the level into the ship and adds the quarters' places to the crew", () => {
    const geo = shipDeckGeo('cruiser');
    const bare = yardLayout('cruiser', geo);
    const withQuarters = cloneLayout(bare);
    addPool(geo, withQuarters, 'crew', 3);
    const mk = (layout: ShipLayout) => {
      const grid = buildPlayerShip('cruiser', buildCruiser, layout);
      const ship = new World(1).spawnShip(grid, 0, 0, 0, { name: 'P', team: 0, player: true });
      return { ship, grid };
    };
    const a = mk(bare);
    const b = mk(withQuarters);
    expect(b.grid.modules.find((m) => m.pool === 'crew')!.lv).toBe(3);
    expect(b.ship.sys!.crew!.length).toBe(a.ship.sys!.crew!.length + 4);
    expect(crewPlaces(withQuarters.mods)).toBe(4);
    expect(crewPlaces(b.grid.modules)).toBe(4);
  });
});
