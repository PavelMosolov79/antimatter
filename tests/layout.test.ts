import { describe, expect, it } from 'vitest';
import { buildRooms, ensureRooms } from '../src/sim/compartments';
import { buildPlayerShip, stripInterior } from '../src/sim/interior';
import {
  K,
  TILE,
  canPlaceLadder,
  canPlaceModule,
  cloneLayout,
  decksWithoutLadder,
  defaultLayout,
  layoutFits,
  moduleRect,
  planDeck,
  rectsOk,
  tileCapacity,
  type ShipLayout,
} from '../src/sim/layout';
import { Mat } from '../src/sim/materials';
import { SHIPS, buildBattleship, buildCruiser, buildFighter, playerShip, shipDeckGeo } from '../src/sim/ships';
import { splitBody } from '../src/sim/fragment';
import { World } from '../src/sim/world';

const IDS = ['fighter', 'cruiser', 'battleship'];

describe('deck grid', () => {
  it('fits seven 10×10 modules on the new fighter (four and three by deck) and many more on the big ships', () => {
    const cap = IDS.map((id) => tileCapacity(shipDeckGeo(id), { mods: [], lads: [], corr: {}, next: 1 }).slots);
    expect(cap[0]).toBe(7);
    expect(cap[1]).toBeGreaterThan(20);
    expect(cap[2]).toBeGreaterThan(150);
  });

  it('lets two rooms overlap only on one shared wall', () => {
    const a = { x0: 0, y0: 0, x1: 9, y1: 9 };
    expect(rectsOk(a, { x0: 9, y0: 0, x1: 18, y1: 9 })).toBe(true); // shared wall: pitch 9
    expect(rectsOk(a, { x0: 10, y0: 0, x1: 19, y1: 9 })).toBe(true); // a gap is fine
    expect(rectsOk(a, { x0: 8, y0: 0, x1: 17, y1: 9 })).toBe(false); // two walls inside each other
    expect(rectsOk(a, { x0: 9, y0: 4, x1: 14, y1: 9 })).toBe(true);
    expect(rectsOk(a, { x0: 5, y0: 5, x1: 14, y1: 14 })).toBe(false);
  });
});

describe('the yard layout', () => {
  it.each(IDS)('%s has its base modules, one ladder per pair of decks, and nothing stranded', (id) => {
    const geo = shipDeckGeo(id);
    const l = defaultLayout(geo);
    expect(l.mods.map((m) => m.type).sort()).toEqual(['bridge', 'core', 'shield']);
    expect(l.mods.every((m) => m.base)).toBe(true);
    expect(decksWithoutLadder(geo, l)).toEqual([]);
    expect(layoutFits(geo, l)).toBe(true);
    for (let z = 1; z < geo.depth; z++) expect(planDeck(geo, l, z).issues).toEqual([]);
  });

  it('puts the new fighter base modules on its two decks and leaves four places free', () => {
    const geo = shipDeckGeo('fighter');
    const layout = defaultLayout(geo);
    expect(layout.mods.map((m) => [m.type, m.deck])).toEqual([
      ['bridge', 1],
      ['shield', 1],
      ['core', 2],
    ]);
    const { slots, free } = tileCapacity(geo, layout);
    expect(slots).toBe(7);
    expect(free).toBe(4);
    // The bridge is the forward-most room, the core sits aft near the drives.
    const centre = (t: string) => {
      const m = layout.mods.find((q) => q.type === t)!;
      const r = moduleRect(geo, m.deck, m);
      return (r.y0 + r.y1) / 2;
    };
    expect(centre('bridge')).toBeLessThan(centre('shield'));
    expect(centre('core')).toBeGreaterThan(40);
  });

  it('makes base modules bigger on bigger ships', () => {
    const size = (id: string, type: string) => {
      const m = defaultLayout(shipDeckGeo(id)).mods.find((q) => q.type === type)!;
      return m.tw * m.th;
    };
    expect(size('fighter', 'core')).toBe(1);
    expect(size('cruiser', 'core')).toBe(4);
    expect(size('battleship', 'core')).toBe(9);
  });
});

describe('walls and doors', () => {
  const geo = shipDeckGeo('battleship');

  function layoutWith(extra: Array<{ i: number; j: number; type: 'med' | 'crew' | 'gun' }>): ShipLayout {
    const l: ShipLayout = { mods: [], lads: [], corr: {}, next: 1 };
    for (const e of extra) l.mods.push({ id: l.next++, type: e.type, deck: 1, i: e.i, j: e.j, tw: 1, th: 1, base: false });
    return l;
  }

  it('gives two neighbouring modules one shared wall with a door in it', () => {
    const l = layoutWith([
      { i: 6, j: 6, type: 'med' },
      { i: 7, j: 6, type: 'crew' },
    ]);
    expect(canPlaceModule(geo, l, 1, 6, 6, 1, 1, null)).toBe(false); // the tile is taken
    const plan = planDeck(geo, l, 1);
    const [a, b] = plan.ents;
    expect(a.r.x1).toBe(b.r.x0); // the same column of cells is both rooms' wall
    const doorsInShared = plan.doors.filter((d) => d % geo.w === a.r.x1);
    expect(doorsInShared.length).toBe(2);
    expect(plan.kind[doorsInShared[0]]).toBe(K.DOOR);
  });

  it('opens a lone module to the free field with a door of its own', () => {
    const plan = planDeck(geo, layoutWith([{ i: 6, j: 6, type: 'gun' }]), 1);
    expect(plan.doors.length).toBe(2);
    expect(plan.issues).toEqual([]);
  });

  it('fences a corridor and opens a door where it meets a module', () => {
    const l = layoutWith([{ i: 6, j: 6, type: 'med' }]);
    const r = moduleRect(geo, 1, l.mods[0]);
    // a vertical corridor two cells wide running past the module's right wall
    const cells: number[] = [];
    for (let y = r.y0 - 4; y <= r.y1 + 4; y++) for (let x = r.x1 + 1; x <= r.x1 + 2; x++) cells.push(y * geo.w + x);
    l.corr[1] = cells;
    const plan = planDeck(geo, l, 1);
    expect(plan.floor.length).toBe(cells.length);
    const fences = plan.kind.filter((k) => k === K.FENCE).length;
    expect(fences).toBeGreaterThan(10);
    const doorOnModule = plan.doors.some((d) => d % geo.w === r.x1);
    expect(doorOnModule).toBe(true);
  });

  it('lets a ladder stand anywhere both decks have room, and no module on its shaft', () => {
    const l = layoutWith([{ i: 6, j: 6, type: 'med' }]);
    const r = moduleRect(geo, 1, l.mods[0]);
    expect(canPlaceLadder(geo, l, r.x0 + 2, r.y0 + 2, 1, null)).toBe(false);
    expect(canPlaceLadder(geo, l, r.x1, r.y0, 1, null)).toBe(true); // sharing the wall
    expect(canPlaceLadder(geo, l, 60, 100, 2, null)).toBe(false); // there is no deck 3
    expect(canPlaceLadder(geo, l, 2, 2, 1, null)).toBe(false); // outside the hull
  });
});

describe('a player ship', () => {
  it.each(IDS)('%s: walls the decks, keeps the hull, and every module is on the room graph', (id) => {
    const g = playerShip(id);
    const geo = shipDeckGeo(id);
    const graph = buildRooms(g);
    expect(graph.rooms.length).toBeGreaterThan(3);
    // the deck's outer rim is wall
    let rim = 0;
    for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) if (geo.masks[1][y * g.width + x] && g.mat[g.idx(x, y, 1)] === Mat.WALL) rim++;
    expect(rim).toBeGreaterThan(20);
    // module cells are real and every one of them stands in a room
    const kinds = g.modules.map((m) => m.kind);
    expect(kinds).toContain('reactor');
    expect(kinds).toContain('bridge');
    expect(kinds).toContain('shield');
    for (const m of g.modules.filter((q) => ['reactor', 'bridge', 'shield'].includes(q.kind))) expect(graph.cellRoom[m.core]).toBeGreaterThanOrEqual(0);
  });

  it.each(IDS)('%s: the crew can walk from the helm to the reactor, over doors and ladders', (id) => {
    const g = playerShip(id);
    const graph = buildRooms(g);
    const from = graph.cellRoom[g.modules.find((m) => m.kind === 'bridge')!.core];
    const to = graph.cellRoom[g.modules.find((m) => m.kind === 'reactor')!.core];
    const seen = new Set([from]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      for (const e of graph.edges) {
        const n = e.a === queue[i] ? e.b : e.b === queue[i] ? e.a : -1;
        if (n >= 0 && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.has(to)).toBe(true);
  });

  it('keeps the yard\'s acceleration when the interior changes the mass', () => {
    const legacy = buildCruiser();
    const ship = playerShip('cruiser');
    const accel = (grid: typeof ship) => grid.modules.filter((m) => m.kind === 'engine').reduce((s, m) => s + m.thrust, 0) / grid.mass;
    expect(accel(ship)).toBeCloseTo(accel(legacy), 3);
    const bs = playerShip('battleship');
    expect(accel(bs)).toBeCloseTo(accel(buildBattleship()), 3);
  });

  it('keeps every drive, nozzle and turret of the hull', () => {
    for (const id of IDS) {
      const legacy = id === 'fighter' ? buildFighter('strike') : id === 'cruiser' ? buildCruiser() : buildBattleship();
      const kinds = (g: typeof legacy) => g.modules.filter((m) => ['engine', 'thruster', 'brake', 'turn', 'turret'].includes(m.kind)).map((m) => m.kind).sort();
      expect(kinds(playerShip(id))).toEqual(kinds(legacy));
    }
  });

  it('builds the layout the player has set, not the yard one', () => {
    const geo = shipDeckGeo('cruiser');
    const l = defaultLayout(geo);
    // swap in a med bay beside the base modules
    let placed = false;
    for (let j = 0; j < 12 && !placed; j++) {
      for (let i = 0; i < 6 && !placed; i++) {
        if (canPlaceModule(geo, l, 1, i, j, 1, 1, null)) {
          l.mods.push({ id: l.next++, type: 'med', deck: 1, i, j, tw: 1, th: 1, base: false });
          placed = true;
        }
      }
    }
    expect(placed).toBe(true);
    const mine = buildPlayerShip('cruiser', buildCruiser, l);
    const yard = playerShip('cruiser');
    expect(mine.modules.filter((m) => m.kind === 'generic').length).toBe(yard.modules.filter((m) => m.kind === 'generic').length + 1);
    expect(cloneLayout(l).mods.length).toBe(l.mods.length);
  });

  it('drops a saved layout that no longer fits', () => {
    const geo = shipDeckGeo('fighter');
    const bad: ShipLayout = { mods: [{ id: 1, type: 'med', deck: 1, i: 0, j: 0, tw: 1, th: 1, base: false }], lads: [], corr: {}, next: 2 };
    expect(layoutFits(geo, bad)).toBe(false);
  });

  it('strips an interior down to the hull and its drives', () => {
    const legacy = buildCruiser();
    const hull = stripInterior(legacy);
    expect(hull.modules.some((m) => m.kind === 'bridge' || m.kind === 'reactor')).toBe(false);
    expect(hull.modules.filter((m) => m.kind === 'turret').length).toBe(legacy.modules.filter((m) => m.kind === 'turret').length);
    expect(TILE).toBe(9);
  });
});

describe('crew on the new decks', () => {
  it('walks to a fire on another deck without ever stepping through a wall', () => {
    const world = new World(1);
    const ship = world.spawnShip(playerShip('cruiser'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const grid = ship.grid;
    const graph = ensureRooms(ship);
    const bridge = grid.modules.find((m) => m.kind === 'bridge')!;
    const bridgeRoom = graph.cellRoom[bridge.core];
    graph.rooms[bridgeRoom].fire = 0.6;
    // the nearest engineer answers the call, whichever of them that is
    const engineers = ship.sys!.crew!.filter((c) => c.role === 'engineer');
    let reached = false;
    let throughWall = false;
    for (let i = 0; i < 60 * 60 && !reached; i++) {
      graph.rooms[bridgeRoom].fire = Math.max(graph.rooms[bridgeRoom].fire, 0.5);
      world.step(1 / 60);
      for (const eng of engineers) {
        const m = grid.mat[grid.idx(Math.floor(eng.x), Math.floor(eng.y), eng.z)];
        if (m === Mat.WALL) throughWall = true;
        // somewhere on the bridge's deck, on a fire, working on it
        if (eng.z === grid.zOf(bridge.core) && eng.waypoints.length === 0 && (eng.task === 'extinguish' || eng.task === 'seal')) reached = true;
      }
    }
    expect(engineers.some((e) => e.z !== grid.zOf(bridge.core) || e.task === 'extinguish')).toBe(true);
    expect(throughWall).toBe(false);
    expect(reached).toBe(true);
  });

  it('every SHIPS entry builds a ship the world accepts', () => {
    for (const s of SHIPS) {
      const world = new World(1);
      const b = world.spawnShip(s.build(), 0, 0, 0, { name: 'P', team: 0, player: true });
      expect(b.sys!.crew!.some((c) => c.role === 'pilot')).toBe(true);
    }
  });
});

describe('editing a layout', () => {
  const geo = shipDeckGeo('battleship');

  it('puts modules down, moves them, and takes the loose ones out but not the base ones', async () => {
    const { putModule, removeModule } = await import('../src/sim/layout');
    const l = defaultLayout(geo);
    const base = l.mods[0];
    expect(removeModule(l, base.id)).toBe(false);
    expect(putModule(geo, l, 'med', 1, 0, 0, 1, 1, null)).toBe(false); // off the hull
    let spot: [number, number] | null = null;
    for (let j = 0; j < 14 && !spot; j++) for (let i = 0; i < 14 && !spot; i++) if (canPlaceModule(geo, l, 1, i, j, 1, 1, null)) spot = [i, j];
    expect(spot).not.toBeNull();
    expect(putModule(geo, l, 'med', 1, spot![0], spot![1], 1, 1, null)).toBe(true);
    const med = l.mods[l.mods.length - 1];
    expect(putModule(geo, l, 'med', 1, spot![0], spot![1], 1, 1, null)).toBe(false); // the tile is taken now
    expect(removeModule(l, med.id)).toBe(true);
    expect(l.mods.some((m) => m.id === med.id)).toBe(false);
  });

  it('keeps a ladder to two neighbouring decks and clears the corridor under it', async () => {
    const { putLadder, paintCorridor, removeLadder } = await import('../src/sim/layout');
    const l: ShipLayout = { mods: [], lads: [], corr: {}, next: 1 };
    paintCorridor(geo, l, 1, { x: 60, y: 100 }, { x: 70, y: 100 }, 2, true);
    expect(l.corr[1].length).toBeGreaterThan(10);
    expect(putLadder(geo, l, 62, 98, 1, null)).toBe(true);
    // the corridor cells on the shaft and its wall are gone from both decks
    expect(l.corr[1].some((idx) => idx % geo.w >= 61 && idx % geo.w <= 67 && Math.floor(idx / geo.w) >= 97 && Math.floor(idx / geo.w) <= 103)).toBe(false);
    expect(putLadder(geo, l, 62, 98, 2, null)).toBe(false); // there is no deck 3 to join
    removeLadder(l, l.lads[0].id);
    expect(l.lads.length).toBe(0);
  });

  it('erases a corridor with the eraser and only draws inside the deck', async () => {
    const { paintCorridor } = await import('../src/sim/layout');
    const l: ShipLayout = { mods: [], lads: [], corr: {}, next: 1 };
    paintCorridor(geo, l, 1, { x: 0, y: 0 }, { x: 4, y: 0 }, 3, true); // outside the hull: nothing
    expect(l.corr[1]).toEqual([]);
    paintCorridor(geo, l, 1, { x: 60, y: 100 }, { x: 64, y: 100 }, 1, true);
    const n = l.corr[1].length;
    expect(n).toBe(5);
    paintCorridor(geo, l, 1, { x: 62, y: 100 }, { x: 62, y: 100 }, 1, false);
    expect(l.corr[1].length).toBe(n - 1);
  });
});

describe('the pictures of the modules', () => {
  it('are laid over the room inside every module and every ladder shaft of a player ship', () => {
    const ship = playerShip('cruiser');
    const mods = ship.decor.filter((d) => d.type !== 'ladder');
    expect(mods.length).toBe(ship.modules.filter((m) => m.pool).length);
    for (const d of mods) {
      // the room inside: 9 cells to a tile, less the shared wall
      expect(d.w).toBe(9 * d.tw - 1);
      expect(d.h).toBe(9 * d.th - 1);
      // and it is made of deck cells, not wall
      expect(ship.mat[ship.idx(d.x0 + 1, d.y0 + 1, d.z)]).not.toBe(Mat.WALL);
    }
    for (const d of ship.decor.filter((x) => x.type === 'ladder')) {
      expect(d.w).toBe(3);
      expect(ship.mat[ship.idx(d.x0 + 1, d.y0 + 1, d.z)]).toBe(Mat.LADDER);
    }
  });

  it('follow a piece that breaks away, in its own coordinates', () => {
    const world = new World(1);
    const body = world.spawnShip(playerShip('cruiser'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const total = body.grid.decor.length;
    expect(total).toBeGreaterThan(0);
    // cut the ship in two across the middle of one deck's rooms: through every layer
    const g = body.grid;
    const cut = Math.floor(g.height / 2);
    for (let z = 0; z < g.depth; z++) for (let x = 0; x < g.width; x++) if (g.mat[g.idx(x, cut, z)] !== 0) g.removeCell(g.idx(x, cut, z));
    const res = splitBody(body, world.rng, 0);
    expect(res).not.toBeNull();
    const pieces = res!.pieces; // the biggest one, the ship that goes on, is among them
    const sum = pieces.reduce((n, b) => n + b.grid.decor.length, 0);
    expect(sum).toBeLessThanOrEqual(total);
    expect(sum).toBeGreaterThan(0);
    for (const b of pieces) for (const d of b.grid.decor) expect(d.x0 + d.w).toBeLessThanOrEqual(b.grid.width);
  });
});
