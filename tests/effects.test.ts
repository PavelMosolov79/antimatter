import { beforeEach, describe, expect, it } from 'vitest';
import { shipEffects } from '../src/sim/effects';
import { updateCompartments, ensureRooms } from '../src/sim/compartments';
import { updateCrew, pilotAvailable } from '../src/sim/crew';
import { buildPlayerShip, yardLayout } from '../src/sim/interior';
import { canPlaceModule, cloneLayout, putModule, type DeckGeo, type ShipLayout } from '../src/sim/layout';
import { applyPropulsion } from '../src/sim/propulsion';
import { buildCruiser, buildFighter, shipDeckGeo } from '../src/sim/ships';
import { World } from '../src/sim/world';
import { FIELD_REPAIR_BASE, LEVELS } from '../src/sim/levels';

class MemoryStorage {
  private d = new Map<string, string>();
  getItem(k: string): string | null {
    return this.d.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.d.set(k, v);
  }
  removeItem(k: string): void {
    this.d.delete(k);
  }
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

type Pool = 'gun' | 'eng' | 'rcs' | 'work' | 'med' | 'crew' | 'store' | 'helm';

const geo = (): DeckGeo => shipDeckGeo('cruiser');

function add(layout: ShipLayout, type: Pool, lv: number): void {
  const g = geo();
  for (let z = 1; z < g.depth; z++) {
    for (let j = -2; j < Math.ceil(g.h / 9) + 2; j++) {
      for (let i = -2; i < Math.ceil(g.w / 9) + 2; i++) {
        if (!canPlaceModule(g, layout, z, i, j, 1, 1, null)) continue;
        expect(putModule(g, layout, type, z, i, j, 1, 1, null, lv)).toBe(true);
        return;
      }
    }
  }
  throw new Error('no room');
}

/** A cruiser with the given pool modules aboard and the base ones raised to `baseLv`. */
function ship(mods: Array<[Pool, number]>, baseLv = 1) {
  const layout: ShipLayout = cloneLayout(yardLayout('cruiser', geo()));
  for (const m of layout.mods) if (m.base) m.lv = baseLv;
  for (const [t, lv] of mods) add(layout, t, lv);
  const grid = buildPlayerShip('cruiser', buildCruiser, layout);
  const world = new World(1);
  const body = world.spawnShip(grid, 0, 0, 0, { name: 'P', team: 0, player: true });
  return { grid, world, body };
}

describe('module effects', () => {
  it('has a working effect for every module now', () => {
    for (const d of Object.values(LEVELS)) expect(d.live).toBe(true);
  });

  it('is all ones for a ship without upgraded modules, enemies included', () => {
    const fx = shipEffects(buildFighter('raider'));
    expect(fx).toMatchObject({ fireRate: 1, range: 1, spoolCut: 0, steer: 1, fieldRepair: 0, rescue: 0, helmSeconds: null });
    const plain = ship([]);
    expect(plain.grid.modules.filter((m) => m.pool === 'gun')).toHaveLength(0);
    expect(shipEffects(plain.grid).fireRate).toBe(1);
  });

  it('adds up what the modules give, in proportion to what is left of them', () => {
    const s = ship([['gun', 3], ['gun', 5], ['eng', 5], ['rcs', 4], ['med', 2], ['work', 5], ['helm', 3]], 5);
    const fx = shipEffects(s.grid);
    expect(fx.fireRate).toBeCloseTo(1 + 0.2 + 0.45);
    expect(fx.range).toBeCloseTo(1.4); // the bridge at level 5
    expect(fx.spoolCut).toBeCloseTo(0.6);
    expect(fx.steer).toBeCloseTo(1.3);
    expect(fx.rescue).toBeCloseTo(0.15);
    expect(fx.fieldRepair).toBeCloseTo(FIELD_REPAIR_BASE * 2);
    expect(fx.helmSeconds).toBe(4);
    // Knock out the core of one gun post: half its effect is gone.
    const post = s.grid.modules.filter((m) => m.pool === 'gun').find((m) => m.lv === 5)!;
    s.grid.removeCell(post.core);
    expect(shipEffects(s.grid).fireRate).toBeCloseTo(1 + 0.2);
  });

  it('winds the main drives up sooner with an upgraded engineering post', () => {
    const out = (mods: Array<[Pool, number]>) => {
      const s = ship(mods);
      for (let i = 0; i < 3; i++) applyPropulsion(s.body, { main: 1, back: 0, right: 0, left: 0, torque: 0, arrived: false, heading: null }, 1 / 60);
      return Math.max(...s.grid.modules.filter((m) => m.kind === 'engine').map((m) => m.out), 0);
    };
    const plain = out([]);
    const quick = out([['eng', 5]]);
    expect(quick).toBeGreaterThan(plain);
  });

  it('makes the reactor and the shield bigger with their own levels', () => {
    const base = ship([], 1).grid;
    const top = ship([], 5).grid;
    const rb = base.modules.find((m) => m.kind === 'reactor')!;
    const rt = top.modules.find((m) => m.kind === 'reactor')!;
    expect(rt.power).toBeCloseTo(rb.power * 1.4);
    expect(rt.blast).toBeCloseTo(rb.blast * 1.32);
    const sb = base.modules.find((m) => m.kind === 'shield')!;
    const st = top.modules.find((m) => m.kind === 'shield')!;
    expect(st.shieldMax).toBeCloseTo(sb.shieldMax * 1.6);
    expect(st.regen).toBeCloseTo(sb.regen * 1.42);
  });

  it('fires more shots with upgraded gun posts', () => {
    const shots = (mods: Array<[Pool, number]>) => {
      const s = ship(mods);
      s.world.spawnShip(buildFighter('raider'), 0, -180, Math.PI, { name: 'T', team: 1 });
      for (const b of s.world.bodies) if (b.sys && b.sys.team === 1) for (const m of b.grid.modules) if (m.weapon) m.weapon.enabled = false;
      let n = 0;
      for (let i = 0; i < 60 * 6; i++) {
        s.world.step(1 / 60);
        n += s.world.events.filter((e) => e.t === 'shot').length;
        s.world.events.length = 0;
      }
      return n;
    };
    expect(shots([['gun', 5], ['gun', 5]])).toBeGreaterThan(shots([]));
  });

  it('can save a crew member from a module that is destroyed under them, but only with a medical bay', () => {
    const tryIt = (mods: Array<[Pool, number]>) => {
      const s = ship(mods);
      const crew = s.body.sys!.crew!.find((c) => c.role === 'engineer')!;
      const x = Math.floor(crew.x);
      const y = Math.floor(crew.y);
      s.grid.removeCell(s.grid.idx(x, y, crew.z));
      updateCrew(s.world, s.body, 1 / 60);
      return { crew, moved: Math.floor(crew.x) !== x || Math.floor(crew.y) !== y };
    };
    expect(tryIt([]).crew.dead).toBe(true);
    const saved = tryIt([['med', 5], ['med', 5]]);
    expect(saved.crew.dead).toBe(false);
    expect(saved.moved).toBe(true);
  });

  it('takes a reserve helm\'s level in seconds before the pilot can fly from it', () => {
    const s = ship([['helm', 2]]);
    const pilot = s.body.sys!.crew!.find((c) => c.role === 'pilot')!;
    const bridge = s.grid.modules.findIndex((m) => m.kind === 'bridge' && m.pool === 'bridge');
    // The helm's core is gone, so the module is dead, but the pilot's own cell stands.
    pilot.x += 1;
    s.grid.removeCell(s.grid.modules[bridge].core);
    for (let i = 0; i < 60 * 60 && !(pilot.homeModule !== bridge && pilot.task === 'atPost'); i++) updateCrew(s.world, s.body, 1 / 60);
    expect(pilot.homeModule).not.toBe(bridge);
    expect(pilot.seat).toBeGreaterThan(0);
    expect(pilotAvailable(s.body)).toBe(false);
    for (let i = 0; i < 60 * 6; i++) updateCrew(s.world, s.body, 1 / 60);
    expect(pilot.seat).toBe(0);
    expect(pilotAvailable(s.body)).toBe(true);
  });

  it('lets engineers put the damaged cells of the room they work back in order, if there is a workshop', () => {
    const heal = (mods: Array<[Pool, number]>) => {
      const s = ship(mods);
      const graph = ensureRooms(s.body);
      const room = graph.rooms.find((r) => r.cells.length > 10)!;
      const i = room.cells[0];
      const full = s.grid.hp[i];
      s.grid.hp[i] = full * 0.2;
      room.sealing = true;
      updateCompartments(s.world, s.body, 1);
      return { before: full * 0.2, after: s.grid.hp[i] };
    };
    const none = heal([]);
    expect(none.after).toBeCloseTo(none.before);
    const shop = heal([['work', 3]]);
    expect(shop.after).toBeGreaterThan(shop.before + FIELD_REPAIR_BASE * 1.4);
  });
});
