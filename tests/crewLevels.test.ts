import { beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import type { Scene } from '../src/render/scene';
import { CREW } from '../src/sim/crewConfig';
import { mannedBy, pilotBonus } from '../src/sim/crew';
import { mulberry32 } from '../src/sim/rng';
import { applyBattle, bonusPct, dutyOf, emptyRoster, giveXp, makeMember, onShip, staffShip, xpNeed, xpShare } from '../src/sim/roster';
import { buildFighter, playerShip, SHIPS } from '../src/sim/ships';
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

/** Counts the shots of the player's ship (the enemy shoots too): each of its projectiles once. */
function ownShots(world: World, steps: number, refill?: () => void): number {
  const seen = new Set<object>();
  for (let i = 0; i < steps; i++) {
    refill?.();
    world.step(DT);
    for (const p of world.projectiles) if (p.team === 0) seen.add(p);
    world.events.length = 0;
  }
  return seen.size;
}

describe('levels and experience', () => {
  it('gives a post a bonus by level, the first level half a step, keen and nervy changing it', () => {
    expect(bonusPct('pilot', 1, [])).toBe(CREW.bonusPerLevel.pilot * 0.5);
    expect(bonusPct('pilot', 3, [])).toBe(CREW.bonusPerLevel.pilot * 2.5);
    expect(bonusPct('gunner', 10, [])).toBeGreaterThan(bonusPct('gunner', 9, []));
    expect(bonusPct('engineer', 4, ['keen'])).toBeCloseTo(bonusPct('engineer', 4, []) * 1.1, 6);
    expect(bonusPct('engineer', 4, ['nervy'])).toBeCloseTo(bonusPct('engineer', 4, []) * 0.9, 6);
  });

  it('raises levels as experience fills, up to the top, and a veteran learns faster', () => {
    const r = emptyRoster();
    const m = makeMember(r, mulberry32(1), 'gunner', 1, 1);
    m.traits = [];
    expect(giveXp(m, xpNeed(1) - 1)).toEqual({ from: 1, to: 1 });
    expect(giveXp(m, 1)).toEqual({ from: 1, to: 2 });
    expect(m.xp).toBe(0);
    // two levels at once
    expect(giveXp(m, xpNeed(2) + xpNeed(3))).toEqual({ from: 2, to: 4 });
    m.lv = CREW.levelMax;
    giveXp(m, 99999);
    expect(m.lv).toBe(CREW.levelMax);
    const v = makeMember(r, mulberry32(2), 'gunner', 1, 1);
    v.traits = ['vet'];
    giveXp(v, 50);
    expect(v.xp).toBeCloseTo(50 * CREW.vetXp, 6);
  });

  it('shares the experience by what a person did', () => {
    expect(xpShare('gunner', 0)).toBeCloseTo(CREW.xpShareMin, 6);
    expect(xpShare('gunner', CREW.deedRef.gunner)).toBeCloseTo(CREW.xpShareMin + CREW.xpShareSpan, 6);
    expect(xpShare('gunner', CREW.deedRef.gunner * 10)).toBeCloseTo(CREW.xpShareMin + CREW.xpShareSpan, 6);
    expect(xpShare('pilot', 10)).toBeLessThan(xpShare('pilot', 30));
  });

  it('pays the living for a battle by their work, the wounded too, and the dead nothing', () => {
    const r = emptyRoster();
    staffShip(r, SHIPS[0].id, SHIPS[0].build(), mulberry32(1));
    const crew = onShip(r, SHIPS[0].id);
    const [a, b, c] = crew;
    const out = applyBattle(
      r,
      SHIPS[0].id,
      [
        { memberId: a.id, dead: false, hurt: false, deed: CREW.deedRef[a.role] },
        { memberId: b.id, dead: false, hurt: true, deed: 0 },
        { memberId: c.id, dead: true, hurt: false, deed: 999 },
        ...crew.slice(3).map((m) => ({ memberId: m.id, dead: false, hurt: false, deed: 0 })),
      ],
      undefined,
      100,
    );
    const row = (id: number) => out.rows.find((x) => x.id === id)!;
    expect(row(a.id).xp).toBeGreaterThan(row(b.id).xp);
    expect(row(b.id).fate).toBe('hurt');
    expect(row(b.id).xp).toBeGreaterThan(0);
    expect(row(c.id).fate).toBe('dead');
    expect(row(c.id).xp).toBe(0);
  });
});

describe('the post and the person at it', () => {
  it('an empty turret does not fire, and a manned one does', () => {
    const grid = buildFighter('raider');
    for (const m of grid.modules) if (m.kind === 'shield') m.shieldMax = 0;
    // a ship with a roster crew and nobody on the gun posts
    const r = emptyRoster();
    const spec = SHIPS[0];
    staffShip(r, spec.id, spec.build(), mulberry32(3));
    const duty = dutyOf(r, spec.id).filter((d) => d.role !== 'gunner');
    const world = new World(1);
    const me = world.spawnShip(playerShip('fighter'), 0, 0, 0, { name: 'P', team: 0, player: true, duty });
    world.spawnShip(grid, 0, -150, Math.PI, { name: 'T', team: 1 });
    expect(ownShots(world, 240)).toBe(0);
    expect(me.sys!.crew!.some((c) => c.role === 'gunner')).toBe(false);

    const world2 = new World(1);
    world2.spawnShip(playerShip('fighter'), 0, 0, 0, { name: 'P', team: 0, player: true, duty: dutyOf(r, spec.id) });
    const grid2 = buildFighter('raider');
    for (const m of grid2.modules) if (m.kind === 'shield') m.shieldMax = 0;
    world2.spawnShip(grid2, 0, -150, Math.PI, { name: 'T', team: 1 });
    expect(ownShots(world2, 240)).toBeGreaterThan(0);
  });

  it('a high-level gunner fires faster and earns his share by the damage his turret does', () => {
    const run = (lv: number): { shots: number; deed: number } => {
      const r = emptyRoster();
      const spec = SHIPS[0];
      staffShip(r, spec.id, spec.build(), mulberry32(3));
      for (const m of onShip(r, spec.id)) {
        m.traits = [];
        if (m.role === 'gunner') m.lv = lv;
      }
      const world = new World(1);
      const me = world.spawnShip(playerShip('fighter'), 0, 0, 0, { name: 'P', team: 0, player: true, duty: dutyOf(r, spec.id) });
      const grid = buildFighter('raider');
      for (const m of grid.modules) if (m.kind === 'shield') m.shieldMax = 0;
      world.spawnShip(grid, 0, -150, Math.PI, { name: 'T', team: 1 });
      // energy is never short, so the guns' own pace is what is measured
      const shots = ownShots(world, 360, () => {
        const cur = world.findShip(me.shipId) ?? me;
        cur.sys!.energy = cur.sys!.energyMax;
      });
      const cur = world.findShip(me.shipId) ?? me;
      return { shots, deed: (cur.sys!.crew ?? []).filter((c) => c.role === 'gunner').reduce((n, c) => n + c.deed, 0) };
    };
    const low = run(1);
    const high = run(10);
    expect(high.shots).toBeGreaterThan(low.shots);
    expect(low.deed).toBeGreaterThan(0);
  });

  it('the pilot at the helm earns by his time, and steers better with a level', () => {
    const r = emptyRoster();
    const spec = SHIPS[0];
    staffShip(r, spec.id, spec.build(), mulberry32(3));
    const pilot = onShip(r, spec.id).find((m) => m.role === 'pilot')!;
    pilot.traits = [];
    const world = new World(1);
    const base = pilotBonus(world.spawnShip(playerShip('fighter'), 0, 0, 0, { name: 'P', team: 0, player: true, duty: dutyOf(r, spec.id) }));
    pilot.lv = 8;
    const world2 = new World(1);
    const me2 = world2.spawnShip(playerShip('fighter'), 0, 0, 0, { name: 'P', team: 0, player: true, duty: dutyOf(r, spec.id) });
    expect(pilotBonus(me2)).toBeGreaterThan(base);
    expect(pilotBonus(me2)).toBeCloseTo(bonusPct('pilot', 8, []), 6);
    for (let i = 0; i < 600; i++) world2.step(DT);
    const c = me2.sys!.crew!.find((x) => x.role === 'pilot')!;
    expect(c.deed).toBeGreaterThan(8);
    // and the gunners at their turrets are found by mannedBy
    const turret = me2.grid.modules.findIndex((m) => m.kind === 'turret');
    expect(mannedBy(me2, turret)).not.toBeNull();
  });
});

describe('the run gives experience', () => {
  function newGame(): Game {
    const scene = { reset() {}, render() {}, layerView: -1 } as unknown as Scene;
    return new Game(scene);
  }

  it('after a won battle everybody who lived has more experience, and the report says so', () => {
    const g = newGame();
    g.startRun();
    const shipId = g.run!.shipId;
    const mine = g.roster.members.filter((m) => m.ship === shipId);
    mine.forEach((m) => (m.traits = []));
    g.travel(1);
    for (const c of g.world.player!.sys!.crew!) c.deed = CREW.deedRef[c.role];
    g.state = 'won';
    g.continueRun();
    const rep = g.run!.report!;
    expect(rep.rows.length).toBe(mine.length);
    for (const m of mine) {
      const row = rep.rows.find((x) => x.id === m.id)!;
      expect(row.xp).toBe(Math.round(CREW.xpBattle.combat * (CREW.xpShareMin + CREW.xpShareSpan)));
      expect(m.xp).toBeGreaterThan(0);
    }
  });

  it('a boss pays more than an ordinary fight', () => {
    expect(CREW.xpBattle.boss).toBeGreaterThan(CREW.xpBattle.elite);
    expect(CREW.xpBattle.elite).toBeGreaterThan(CREW.xpBattle.combat);
  });
});
