import { describe, expect, it } from 'vitest';
import type { GridBody } from '../src/sim/body';
import { ensureRooms, roomsOnDeck } from '../src/sim/compartments';
import { pilotAvailable, updateCrew } from '../src/sim/crew';
import { splitBody } from '../src/sim/fragment';
import { buildFighter } from '../src/sim/ships';
import { World } from '../src/sim/world';

const DT = 1 / 60;

function makePlayer(): { world: World; ship: GridBody } {
  const world = new World(1);
  const ship = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
  return { world, ship };
}

function run(world: World, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) world.step(DT);
}

function forceRng(world: World, value: number): void {
  (world as unknown as { rng: () => number }).rng = () => value;
}

/** Steps tick by tick (instead of a single before/after snapshot) and reports whether
 * position ever changed — a wander target is a random cell in the room, so a plain
 * before/after check over a fixed window can land on the same spot again by chance and
 * read as "never moved" even though they genuinely walked somewhere in between. */
function everMoves(world: World, crew: { x: number; y: number; z: number }, seconds: number): boolean {
  const start = { x: crew.x, y: crew.y, z: crew.z };
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    world.step(DT);
    if (Math.hypot(crew.x - start.x, crew.y - start.y) > 0.05 || crew.z !== start.z) return true;
  }
  return false;
}

describe('crew roster', () => {
  it('spawns one crew per combat post plus mobile engineers, with only the primary bridge staffed', () => {
    const { ship } = makePlayer();
    const crew = ship.sys!.crew!;
    const bridges = ship.grid.modules.filter((m) => m.kind === 'bridge').length;
    const turrets = ship.grid.modules.filter((m) => m.kind === 'turret').length;
    const shields = ship.grid.modules.filter((m) => m.kind === 'shield').length;

    expect(bridges).toBe(2); // primary helm + one reserve console
    expect(crew.filter((c) => c.role === 'pilot').length).toBe(1); // reserve starts empty
    expect(crew.filter((c) => c.role === 'gunner').length).toBe(turrets);
    expect(crew.filter((c) => c.role === 'shieldop').length).toBe(shields);
    expect(crew.filter((c) => c.role === 'engineer').length).toBeGreaterThanOrEqual(1);
    expect(crew.every((c) => !c.dead)).toBe(true);
  });

  it('starts every stationary crew member at their post', () => {
    const { ship } = makePlayer();
    const crew = ship.sys!.crew!;
    for (const c of crew) {
      if (c.mobile) continue;
      expect(c.task).toBe('atPost');
    }
  });
});

describe('pilot post and flight control', () => {
  it('flight control is available while a pilot is at a working bridge', () => {
    const { ship } = makePlayer();
    expect(pilotAvailable(ship)).toBe(true);
  });

  it('dies if the bridge is destroyed while they are physically standing in it', () => {
    const { world, ship } = makePlayer();
    run(world, 2); // let the crew settle onto their posts first
    const pilot = ship.sys!.crew!.find((c) => c.role === 'pilot')!;
    const bridge = ship.grid.modules.find((m) => m.kind === 'bridge')!;
    for (const cell of [...bridge.cells]) ship.grid.removeCell(cell);
    run(world, 1);
    expect(pilot.dead).toBe(true);
    expect(pilotAvailable(ship)).toBe(false);
  });

  it('is orphaned, not killed, if the bridge is destroyed while they are elsewhere, and relocates to the reserve post', () => {
    const { world, ship } = makePlayer();
    const pilot = ship.sys!.crew!.find((c) => c.role === 'pilot')!;
    // Move the pilot away from the bridge before it's hit.
    pilot.x = 15;
    pilot.y = 33;
    pilot.z = 2;
    pilot.roomId = -1;

    const primary = ship.grid.modules.findIndex((m) => m.kind === 'bridge');
    for (const cell of [...ship.grid.modules[primary].cells]) ship.grid.removeCell(cell);

    run(world, 15);
    expect(pilot.dead).toBe(false);
    expect(pilot.orphaned).toBe(false);
    expect(pilot.homeModule).not.toBe(primary);
    expect(ship.grid.modules[pilot.homeModule].kind).toBe('bridge');
    expect(pilot.task).toBe('atPost');
    expect(pilotAvailable(ship)).toBe(true);
  });

  it('disables autopilot thrust once no pilot is at any working post', () => {
    const { world, ship } = makePlayer();
    world.target = { x: 500, y: 0 };
    run(world, 1);
    const vBefore = Math.hypot(ship.vx, ship.vy);
    expect(vBefore).toBeGreaterThan(0);

    for (const m of ship.grid.modules) {
      if (m.kind !== 'bridge') continue;
      for (const cell of [...m.cells]) ship.grid.removeCell(cell);
    }
    run(world, 15); // long enough for every pilot candidate to end up dead or permanently orphaned with no post left
    const vx0 = ship.vx;
    const vy0 = ship.vy;
    run(world, 0.5);
    expect(ship.vx).toBeCloseTo(vx0, 5);
    expect(ship.vy).toBeCloseTo(vy0, 5);
  });
});

describe('engineers', () => {
  it('holds a breached room steady instead of letting it fully vent', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const shieldBay = roomsOnDeck(graph, 1)[1];
    const [cell] = shieldBay.cells;
    const x = ship.grid.xOf(cell);
    const y = ship.grid.yOf(cell);
    ship.grid.removeCell(ship.grid.idx(x, y, 0));

    run(world, 3); // engineer arrives and starts sealing before it fully vents
    expect(shieldBay.sealing).toBe(true);
    const pressureAtSeal = shieldBay.pressure;
    expect(pressureAtSeal).toBeGreaterThan(0);

    run(world, 5);
    expect(shieldBay.pressure).toBeCloseTo(pressureAtSeal, 2);
  });

  it('extinguishes a fire faster than it would decay on its own in vacuum', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const bridge = roomsOnDeck(graph, 1)[0];
    bridge.fire = 0.9;
    run(world, 6);
    expect(bridge.fire).toBe(0);
  });
});

describe('crew across a hull fragmentation split', () => {
  it('carries surviving crew over with their position remapped onto the new (cropped) grid', () => {
    const { ship } = makePlayer();
    const crew = ship.sys!.crew!;
    const shieldop = crew.find((c) => c.role === 'shieldop')!;

    for (let x = 0; x < ship.grid.width; x++) {
      for (let z = 0; z < ship.grid.depth; z++) ship.grid.removeCell(ship.grid.idx(x, 34, z));
    }
    const res = splitBody(ship, () => 0.5, 0);
    const survivor = res!.main!;
    expect(survivor.grid).not.toBe(ship.grid);

    const stillThere = survivor.sys!.crew!.find((c) => c.id === shieldop.id);
    expect(stillThere).toBeDefined();
    // The crop shifts local coordinates by some offset — what matters is that the
    // translated position lands on solid ground in the new grid, not off in space.
    const g = survivor.grid;
    const xi = Math.floor(stillThere!.x);
    const yi = Math.floor(stillThere!.y);
    expect(xi).toBeGreaterThanOrEqual(0);
    expect(yi).toBeGreaterThanOrEqual(0);
    expect(g.mat[g.idx(xi, yi, stillThere!.z)]).not.toBe(0);
  });

  it('loses crew standing on the piece that breaks away', () => {
    const { ship } = makePlayer();
    const crew = ship.sys!.crew!;
    const pilot = crew.find((c) => c.role === 'pilot')!;
    // The pilot's post (z=1) is on the front half; sever the ship well behind it so the
    // piece that snaps off is a small chunk far from the bridge, then move the pilot onto
    // that same doomed piece before the cut.
    pilot.x = 15;
    pilot.y = 40;
    pilot.z = 1;

    for (let x = 0; x < ship.grid.width; x++) {
      for (let z = 0; z < ship.grid.depth; z++) ship.grid.removeCell(ship.grid.idx(x, 34, z));
    }
    const res = splitBody(ship, () => 0.5, 0);
    const survivor = res!.main!;
    const stillThere = survivor.sys!.crew!.find((c) => c.id === pilot.id);
    expect(stillThere).toBeUndefined();
  });

  it('remaps a surviving stationary crew member onto their post\'s new module index instead of crashing on the next tick', () => {
    // extractComponent() rebuilds grid.modules per piece by scanning the old array in
    // order and skipping any module with zero surviving cells on this side of the
    // break — so a module's index in the new (cropped) grid almost never matches its
    // old index once an earlier module loses every cell here. If a crew member's
    // homeModule is left pointing at the old index, it ends up referring to the wrong
    // module (or past the end of the new, shorter array), and the next updateCrew()
    // call throws reading `coreAlive` off undefined inside moduleEfficiency().
    const { world, ship } = makePlayer();
    const crew = ship.sys!.crew!;
    const gunner = crew.find((c) => c.role === 'gunner')!;
    const shieldop = crew.find((c) => c.role === 'shieldop')!;

    // Destroy an earlier-indexed module (an engine, added before any turret or shield
    // generator in ships.ts) entirely, so every later module's index shifts down by one
    // once the grid is rebuilt for this piece.
    const engine = ship.grid.modules.find((m) => m.kind === 'engine')!;
    for (const cell of [...engine.cells]) ship.grid.removeCell(cell);

    // Also sever the hull so this actually triggers a fragmentation split (destroying
    // the engine alone doesn't disconnect anything).
    for (let x = 0; x < ship.grid.width; x++) {
      for (let z = 0; z < ship.grid.depth; z++) ship.grid.removeCell(ship.grid.idx(x, 34, z));
    }

    const res = splitBody(ship, () => 0.5, 0);
    const survivor = res!.main!;
    expect(survivor.grid).not.toBe(ship.grid);

    expect(() => updateCrew(world, survivor, DT)).not.toThrow();

    const survivingGunner = survivor.sys!.crew!.find((c) => c.id === gunner.id);
    const survivingShieldop = survivor.sys!.crew!.find((c) => c.id === shieldop.id);
    expect(survivingGunner).toBeDefined();
    expect(survivingShieldop).toBeDefined();
    if (!survivingGunner!.orphaned) expect(survivor.grid.modules[survivingGunner!.homeModule].kind).toBe('turret');
    if (!survivingShieldop!.orphaned) expect(survivor.grid.modules[survivingShieldop!.homeModule].kind).toBe('shield');
  });
});

describe('ejection through a breach', () => {
  it('sucks an unsuited crew member out through an actively venting breach and kills them', () => {
    const { world, ship } = makePlayer();
    forceRng(world, 0); // guarantees the per-tick ejection roll succeeds the instant it's eligible
    const pilot = ship.sys!.crew!.find((c) => c.role === 'pilot')!;
    const bridge = ship.grid.modules.find((m) => m.kind === 'bridge')!;
    const [cell] = bridge.cells;
    const x = ship.grid.xOf(cell);
    const y = ship.grid.yOf(cell);
    ship.grid.removeCell(ship.grid.idx(x, y, 0)); // breach the hull right above the bridge

    expect(pilot.dead).toBe(false);
    run(world, 3); // enough for pressure to fall below the ejection threshold
    expect(pilot.task).toBe('ejected');
    expect(pilot.suited).toBe(false);

    run(world, 2); // enough to sail past the overshoot distance
    expect(pilot.dead).toBe(true);
  });

  it('moves an ejected crew member visibly outward, away from where the breach was, before they die', () => {
    const { world, ship } = makePlayer();
    forceRng(world, 0);
    const pilot = ship.sys!.crew!.find((c) => c.role === 'pilot')!;
    const bridge = ship.grid.modules.find((m) => m.kind === 'bridge')!;
    const [cell] = bridge.cells;
    const x = ship.grid.xOf(cell);
    const y = ship.grid.yOf(cell);
    ship.grid.removeCell(ship.grid.idx(x, y, 0));
    run(world, 3);
    expect(pilot.task).toBe('ejected');
    const atEjection = { x: pilot.x, y: pilot.y };

    run(world, 1 / 60);
    const movedDist = Math.hypot(pilot.x - atEjection.x, pilot.y - atEjection.y);
    expect(movedDist).toBeGreaterThan(0.1); // a real, visible jump in one tick, not a crawl
  });

  it('does not eject an engineer actively bracing against the hull while sealing that exact breach', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const shieldBay = roomsOnDeck(graph, 1)[1];
    const [cell] = shieldBay.cells;
    const x = ship.grid.xOf(cell);
    const y = ship.grid.yOf(cell);
    ship.grid.removeCell(ship.grid.idx(x, y, 0));
    run(world, 3); // drain pressure well below the ejection threshold

    // Place the engineer directly at the post they'd otherwise have walked to, so this
    // test isn't at the mercy of random travel time before they start sealing.
    const engineer = ship.sys!.crew!.find((c) => c.role === 'engineer')!;
    engineer.x = x + 0.5;
    engineer.y = y + 0.5;
    engineer.z = shieldBay.z;
    engineer.roomId = -1;
    engineer.waypoints = [];
    engineer.destRoom = -1;

    forceRng(world, 0); // would guarantee ejection for anyone still eligible
    run(world, 1);
    expect(engineer.task).toBe('seal');
    expect(engineer.dead).toBe(false);
  });
});

describe('wandering when there is nowhere useful to go', () => {
  it('wanders instead of freezing in place when orphaned with no reserve post available anywhere', () => {
    const { world, ship } = makePlayer();
    const pilot = ship.sys!.crew!.find((c) => c.role === 'pilot')!;
    // Move the pilot away first so destroying every bridge orphans them instead of
    // killing them outright (that's covered by a separate test).
    pilot.x = 15;
    pilot.y = 33;
    pilot.z = 2;
    pilot.roomId = -1;

    for (const m of ship.grid.modules) {
      if (m.kind !== 'bridge') continue;
      for (const cell of [...m.cells]) ship.grid.removeCell(cell);
    }

    run(world, 1);
    expect(pilot.orphaned).toBe(true);
    expect(pilot.task).toBe('wander');
    expect(everMoves(world, pilot, 8)).toBe(true);
    expect(pilot.dead).toBe(false);
  });

  it('wanders instead of freezing when an engineer has nothing left to fix', () => {
    const { world, ship } = makePlayer();
    const engineer = ship.sys!.crew!.find((c) => c.role === 'engineer')!;

    run(world, 1); // nothing broken anywhere — should fall back to wandering, not idle forever
    expect(engineer.task).toBe('wander');
    expect(everMoves(world, engineer, 8)).toBe(true);
  });
});
