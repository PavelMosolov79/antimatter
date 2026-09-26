import { describe, expect, it } from 'vitest';
import { ensureRooms } from '../src/sim/compartments';
import { splitBody } from '../src/sim/fragment';
import { RUN, encounterFor, generateMap, repairShip, restAfterBattle, type RunMap } from '../src/sim/run';
import { BOSS, ENEMIES, buildBattleship, buildBossBattleship, buildFighter } from '../src/sim/ships';
import { World } from '../src/sim/world';

const DT = 1 / 60;

function reachableFrom(map: RunMap, start: number): Set<number> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const n = map.nodes[queue.shift()!];
    for (const t of n.next) if (!seen.has(t)) (seen.add(t), queue.push(t));
  }
  return seen;
}

describe('run map', () => {
  it('is the same map for the same seed and a different one for another', () => {
    expect(generateMap(42)).toEqual(generateMap(42));
    expect(generateMap(42)).not.toEqual(generateMap(43));
  });

  for (const seed of [1, 7, 99, 1234, 98765]) {
    it(`seed ${seed}: one start, one boss at the end, and every node is on some start→boss path`, () => {
      const map = generateMap(seed);
      const starts = map.nodes.filter((n) => n.kind === 'start');
      const bosses = map.nodes.filter((n) => n.kind === 'boss');
      expect(starts).toHaveLength(1);
      expect(bosses).toHaveLength(1);
      expect(starts[0].col).toBe(0);
      expect(bosses[0].col).toBe(map.cols - 1);
      const fromStart = reachableFrom(map, starts[0].id);
      for (const n of map.nodes) {
        expect(fromStart.has(n.id)).toBe(true);
        expect(reachableFrom(map, n.id).has(bosses[0].id)).toBe(true);
        for (const t of n.next) expect(map.nodes[t].col).toBe(n.col + 1);
      }
    });

    it(`seed ${seed}: repair stations midway and just before the boss; elites only once the run is under way`, () => {
      const map = generateMap(seed);
      const repairs = map.nodes.filter((n) => n.kind === 'repair');
      expect(repairs.map((n) => n.col).sort()).toEqual([Math.floor((map.cols - 1) / 2), map.cols - 2].sort());
      for (const n of map.nodes) if (n.kind === 'elite') expect(n.col).toBeGreaterThanOrEqual(RUN.eliteFromCol);
    });
  }

  it('gives every fight enemies that exist, the boss node the battleship, and repair nodes none', () => {
    for (const seed of [5, 6, 7, 8, 9, 10]) for (const n of generateMap(seed).nodes) {
      const map = generateMap(seed);
      const enc = encounterFor(map, n);
      if (n.kind === 'boss') expect(enc.enemies).toEqual(['boss']);
      else if (n.kind === 'combat' || n.kind === 'elite') expect(enc.enemies.length).toBeGreaterThan(0);
      else expect(enc.enemies).toEqual([]);
      for (const id of enc.enemies) expect(ENEMIES.some((e) => e.id === id)).toBe(true);
      expect(enc.celestials.some((c) => c.kind === 'planet')).toBe(true);
      // Nothing sits on top of where the player or the enemies (boss furthest, straight up) spawn.
      for (const c of enc.celestials) {
        expect(Math.hypot(c.x, c.y) - c.radius).toBeGreaterThan(420);
        expect(Math.hypot(c.x, c.y + 520) - c.radius).toBeGreaterThan(400);
      }
    }
  });
});

describe('carrying the ship between battles', () => {
  it('arrives in the next battle with exactly the damage, crew and rooms it left with, at rest', () => {
    const a = new World(1);
    const ship = a.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    a.explode(ship.x + 6, ship.y, 4, 120, 0.5);
    for (let i = 0; i < 30; i++) a.step(DT);
    const carried = a.player!;
    carried.vx = 40;
    carried.w = 2;
    const cells = carried.grid.cells;
    const crew = carried.sys!.crew!.filter((c) => !c.dead).length;

    const b = new World(2);
    b.adoptPlayer(carried, 0, 0, 0);
    expect(b.player).toBe(carried);
    expect(carried.grid.cells).toBe(cells);
    expect(carried.sys!.crew!.filter((c) => !c.dead).length).toBe(crew);
    expect(carried.vx).toBe(0);
    expect(carried.w).toBe(0);
    for (let i = 0; i < 60; i++) b.step(DT);
    expect(b.player).toBe(carried);
  });

  it('between battles refills air in whole rooms but leaves rooms open to space vented', () => {
    const world = new World(1);
    const ship = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const graph = ensureRooms(ship);
    const whole = graph.rooms[0];
    whole.pressure = 0.3;
    whole.fire = 0.5;
    restAfterBattle(ship);
    expect(whole.pressure).toBe(1);
    expect(whole.fire).toBe(0);

    const cell = whole.cells[0];
    ship.grid.removeCell(ship.grid.idx(ship.grid.xOf(cell), ship.grid.yOf(cell), 0));
    whole.pressure = 0;
    restAfterBattle(ship);
    expect(whole.breached).toBe(true);
    expect(whole.pressure).toBe(0);
  });
});

describe('repair station', () => {
  it('patches half the missing hull, outer hull first, and heals what survived', () => {
    const blueprint = buildFighter('strike');
    const world = new World(1);
    const ship = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const g = ship.grid;
    let removed = 0;
    for (let x = 4; x < 12; x++) {
      for (let y = 25; y < 30; y++) {
        const i = g.idx(x, y, 0);
        if (g.mat[i] !== 0 && g.mod[i] === 0) {
          g.removeCell(i);
          removed++;
        }
      }
    }
    const damaged = g.idx(15, 22, 0);
    g.hp[damaged] = 1;
    const before = g.cells;
    const rep = repairShip(ship, blueprint);
    expect(rep.rebuilt.length).toBe(Math.round(removed * RUN.repairShare));
    expect(g.cells).toBe(before + rep.rebuilt.length);
    for (const i of rep.rebuilt) expect(g.zOf(i)).toBe(0);
    expect(rep.healed).toBeGreaterThan(0);
    expect(g.hp[damaged]).toBeGreaterThan(1);
  });

  it('never brings back a module whose core was destroyed — that needs the dock', () => {
    const blueprint = buildFighter('strike');
    const world = new World(1);
    const ship = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const g = ship.grid;
    const turret = g.modules.findIndex((m) => m.kind === 'turret');
    for (const i of [...g.modules[turret].cells]) g.removeCell(i);
    expect(g.modules[turret].coreAlive).toBe(false);
    repairShip(ship, blueprint, 1);
    expect(g.modules[turret].coreAlive).toBe(false);
    expect(g.modules[turret].alive).toBe(0);
  });

  it('puts cells back where they belong after the hull was split and cropped', () => {
    const blueprint = buildFighter('strike');
    const world = new World(1);
    const ship = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    // Saw the nose off: the surviving grid is cropped, so its (0,0) is no longer the blueprint's.
    for (let x = 0; x < ship.grid.width; x++) for (let z = 0; z < ship.grid.depth; z++) ship.grid.removeCell(ship.grid.idx(x, 10, z));
    const res = splitBody(ship, () => 0.5, 0)!;
    const main = res.main!;
    expect(main.frameY).toBeGreaterThan(0);
    // Punch a hole in the surviving hull and repair everything that can be repaired.
    const hole = main.grid.idx(12, 20, 0);
    const mat = main.grid.mat[hole];
    main.grid.removeCell(hole);
    repairShip(main, blueprint, 1);
    expect(main.grid.mat[hole]).toBe(mat);
    // Every cell the repair put back matches the blueprint at the same (offset) spot.
    for (let y = 0; y < main.grid.height; y++) {
      for (let x = 0; x < main.grid.width; x++) {
        for (let z = 0; z < main.grid.depth; z++) {
          const m = main.grid.mat[main.grid.idx(x, y, z)];
          if (m !== 0) expect(blueprint.mat[blueprint.idx(x + main.frameX, y + main.frameY, z)]).toBe(m);
        }
      }
    }
  });

  it('restores the drawn look too, for a painted ship', () => {
    const blueprint = buildBattleship();
    const world = new World(1);
    const ship = world.spawnShip(buildBattleship(), 0, 0, 0, { name: 'P', team: 0, player: true });
    const i = ship.grid.idx(65, 60, 0);
    ship.grid.removeCell(i);
    ship.grid.paintRGB![i * 3] = 0;
    repairShip(ship, blueprint, 1);
    expect(ship.grid.mat[i]).toBe(blueprint.mat[i]);
    expect(ship.grid.paintRGB![i * 3]).toBe(blueprint.paintRGB![i * 3]);
  });
});

describe('boss', () => {
  it('is the battleship cut down: half its guns armed and half its shield', () => {
    const full = buildBattleship();
    const boss = buildBossBattleship();
    const guns = (g: typeof full) => g.modules.filter((m) => m.weapon).length;
    const shield = (g: typeof full) => g.modules.reduce((s, m) => s + m.shieldMax, 0);
    expect(guns(boss)).toBe(Math.floor(guns(full) / 2));
    expect(shield(boss)).toBeCloseTo(shield(full) * BOSS.shieldShare);
  });

  it('flies and fights a fighter from a distance proportional to its size, without errors', () => {
    const world = new World(3);
    const player = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const boss = world.spawnShip(buildBossBattleship(), 0, -520, Math.PI, { name: 'Линкор', team: 1, ai: 'raider' });
    let closest = Infinity;
    expect(() => {
      for (let i = 0; i < 60 * 20; i++) {
        world.step(DT);
        if (!boss.removed && world.player) closest = Math.min(closest, Math.hypot(boss.x - world.player.x, boss.y - world.player.y));
      }
    }).not.toThrow();
    expect(closest).toBeGreaterThan(boss.radius);
    expect(player.sys!.shield < player.sys!.shieldMax || player.grid.cells < player.sys!.cellsMax).toBe(true);
  });
});
