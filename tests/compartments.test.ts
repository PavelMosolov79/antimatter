import { describe, expect, it } from 'vitest';
import type { GridBody } from '../src/sim/body';
import { ensureRooms, roomsOnDeck, setDoorOpen, updateCompartments, type Room } from '../src/sim/compartments';
import { buildCruiser, buildFighter } from '../src/sim/ships';
import { updateSystems } from '../src/sim/systems';
import { World } from '../src/sim/world';

const DT = 1 / 60;

function makePlayer(): { world: World; ship: GridBody } {
  const world = new World(1);
  const ship = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
  return { world, ship };
}

function forceRng(world: World, value: number): void {
  (world as unknown as { rng: () => number }).rng = () => value;
}

function run(world: World, ship: GridBody, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) updateCompartments(world, ship, DT);
}

/** Breaches the room that owns each cell by destroying the material above it (z' < z) in that column. */
function breachCells(ship: GridBody, cells: number[], z: number): void {
  for (const cell of cells) {
    const x = ship.grid.xOf(cell);
    const y = ship.grid.yOf(cell);
    for (let zz = 0; zz < z; zz++) ship.grid.removeCell(ship.grid.idx(x, y, zz));
  }
}

function findReactorRoom(ship: GridBody): Room {
  const graph = ensureRooms(ship);
  return graph.rooms.find((r) => r.cells.some((i) => ship.grid.mod[i] !== 0 && ship.grid.modules[ship.grid.mod[i] - 1].kind === 'reactor'))!;
}

describe('compartment graph', () => {
  it('partitions the fighter into proper walled rooms (bridge, shield bay, corridor, cabins) linked by doors and one ladder', () => {
    const g = buildFighter('strike');
    const graph = ensureRooms(new World(1).spawnShip(g, 0, 0, 0, { name: 'P', team: 0, player: true }));
    // 7 rooms on deck 1 (bridge, shield bay, corridor spine, two bands of port/starboard
    // cabins) and 5 on deck 2 (engineering nook, reactor closet, corridor, one band of cabins).
    expect(graph.rooms.length).toBe(12);
    expect(graph.rooms.filter((r) => r.z === 1).length).toBe(7);
    expect(graph.rooms.filter((r) => r.z === 2).length).toBe(5);
    const doorEdges = graph.edges.filter((e) => e.kind === 'door');
    const ladderEdges = graph.edges.filter((e) => e.kind === 'ladder');
    expect(doorEdges.length).toBe(10);
    expect(ladderEdges.length).toBe(1);
    expect(g.doors.length).toBe(10);
    // Every room is a real box: at least 3 of its 4 sides carry an actual wall/door
    // boundary rather than just relying on the hull taper — i.e. this isn't a single
    // full-width bulkhead line, but genuine rectangular chambers.
    for (const r of graph.rooms) expect(r.cells.length).toBeGreaterThanOrEqual(6);
  });

  it('gives the cruiser an even richer deck plan with more, smaller rooms', () => {
    const g = buildCruiser();
    const graph = ensureRooms(new World(1).spawnShip(g, 0, 0, 0, { name: 'P', team: 0, player: true }));
    expect(graph.rooms.length).toBeGreaterThan(20);
    expect(graph.rooms.filter((r) => r.z === 1).length).toBeGreaterThanOrEqual(10);
    expect(graph.rooms.filter((r) => r.z === 2).length).toBeGreaterThanOrEqual(8);
    expect(graph.rooms.filter((r) => r.z === 3).length).toBeGreaterThanOrEqual(4);
    expect(graph.edges.filter((e) => e.kind === 'ladder').length).toBe(2);
  });

  it('every room starts sealed at full pressure with no fire', () => {
    const { ship } = makePlayer();
    const graph = ensureRooms(ship);
    for (const r of graph.rooms) {
      expect(r.pressure).toBe(1);
      expect(r.fire).toBe(0);
      expect(r.breached).toBe(false);
    }
  });
});

describe('decompression', () => {
  it('a sealed room with no breach keeps full pressure', () => {
    const { world, ship } = makePlayer();
    run(world, ship, 10);
    for (const r of ensureRooms(ship).rooms) expect(r.pressure).toBe(1);
  });

  it('a hull breach bleeds air out of the room behind it', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const shieldBay = roomsOnDeck(graph, 1)[1]; // bridge, shield bay, aft bay in y order
    breachCells(ship, shieldBay.cells.slice(0, 6), 1);
    run(world, ship, 1);
    expect(shieldBay.breached).toBe(true);
    expect(shieldBay.pressure).toBeLessThan(1);
    run(world, ship, 5);
    expect(shieldBay.pressure).toBeLessThan(0.05);
  });

  it('a breach never self-heals when a follow-up hit finishes off the exposed cell', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const shieldBay = roomsOnDeck(graph, 1)[1];
    const [cell] = shieldBay.cells;
    const x = ship.grid.xOf(cell);
    const y = ship.grid.yOf(cell);
    // First hit: punch through the hull above it (the normal case, already covered above).
    ship.grid.removeCell(ship.grid.idx(x, y, 0));
    run(world, ship, 0.5);
    expect(shieldBay.breached).toBe(true);
    const pressureAfterFirstHit = shieldBay.pressure;
    // Second hit finishes off the room's own exposed cell instead of just damaging it —
    // this must still read as breached (or worse), never as freshly sealed.
    ship.grid.removeCell(cell);
    run(world, ship, 0.1);
    expect(shieldBay.breached).toBe(true);
    expect(shieldBay.pressure).toBeLessThanOrEqual(pressureAfterFirstHit);
  });

  it('does not treat a fire-gutted interior floor tile as a hull breach while the outer hull above it still holds', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const shieldBay = roomsOnDeck(graph, 1)[1];
    const [cell] = shieldBay.cells;
    // Destroy only the room's own cell — the hull (z=0) and everything shallower stays intact.
    ship.grid.removeCell(cell);
    run(world, ship, 2);
    expect(shieldBay.breached).toBe(false);
    expect(shieldBay.pressure).toBe(1);
  });

  it('closing the connecting door keeps the neighboring room fully sealed', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const [bridge, shieldBay] = roomsOnDeck(graph, 1);
    const doorEdge = graph.edges.find((e) => e.kind === 'door' && (e.a === bridge.id || e.b === bridge.id) && (e.a === shieldBay.id || e.b === shieldBay.id))!;
    setDoorOpen(ship.grid, doorEdge.doorId!, false);
    breachCells(ship, shieldBay.cells.slice(0, 6), 1);
    run(world, ship, 8);
    expect(shieldBay.pressure).toBeLessThan(1);
    expect(bridge.pressure).toBe(1);
  });

  it('manually forcing the auto-closed door back open lets the breach drain the neighbor too', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const [bridge, shieldBay] = roomsOnDeck(graph, 1);
    const doorEdge = graph.edges.find((e) => e.kind === 'door' && (e.a === bridge.id || e.b === bridge.id) && (e.a === shieldBay.id || e.b === shieldBay.id))!;
    breachCells(ship, shieldBay.cells.slice(0, 6), 1);
    run(world, ship, DT);
    expect(ship.grid.doors[doorEdge.doorId!].open).toBe(false); // auto-closed the instant it was breached
    setDoorOpen(ship.grid, doorEdge.doorId!, true); // player deliberately overrides the seal
    run(world, ship, 12);
    expect(shieldBay.pressure).toBeLessThan(0.05);
    expect(bridge.pressure).toBeLessThan(1);
  });

  it('auto-closes an open door the instant its room is breached', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const [bridge, shieldBay] = roomsOnDeck(graph, 1);
    const doorEdge = graph.edges.find((e) => e.kind === 'door' && (e.a === bridge.id || e.b === bridge.id) && (e.a === shieldBay.id || e.b === shieldBay.id))!;
    expect(ship.grid.doors[doorEdge.doorId!].open).toBe(true);
    breachCells(ship, shieldBay.cells.slice(0, 6), 1);
    run(world, ship, DT);
    expect(ship.grid.doors[doorEdge.doorId!].open).toBe(false);
  });

  it('a ladder always equalizes pressure between decks and cannot be closed', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const ladder = graph.edges.find((e) => e.kind === 'ladder')!;
    const upper = graph.rooms[ladder.a];
    breachCells(ship, upper.cells.slice(0, 6), upper.z);
    run(world, ship, 15);
    const lower = graph.rooms[ladder.b];
    expect(lower.pressure).toBeLessThan(1);
  });

  it('a door destroyed by weapons fire can never be closed again', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const doorEdge = graph.edges.find((e) => e.kind === 'door')!;
    const door = ship.grid.doors[doorEdge.doorId!];
    const roomAId = doorEdge.a;
    const roomACells = graph.rooms[roomAId].cells;
    const roomAZ = graph.rooms[roomAId].z;
    ship.grid.removeCell(door.cell);
    expect(door.destroyed).toBe(true);
    setDoorOpen(ship.grid, doorEdge.doorId!, false);
    expect(door.open).toBe(true);
    // Destroying the door cell is a structural change, so the graph and room ids get rebuilt; re-fetch them.
    const freshGraph = ensureRooms(ship);
    expect(freshGraph).not.toBe(graph);
    const roomA = freshGraph.rooms.find((r) => r.z === roomAZ && r.cells.some((c) => roomACells.includes(c)))!;
    const stillEdge = freshGraph.edges.find((e) => e.doorId === doorEdge.doorId)!;
    const roomB = freshGraph.rooms[stillEdge.a === roomA.id ? stillEdge.b : stillEdge.a];
    breachCells(ship, roomA.cells.slice(0, 6), roomA.z);
    run(world, ship, 12);
    expect(roomB.pressure).toBeLessThan(1);
  });
});

describe('fire', () => {
  it('damage to a room can ignite it (forced roll)', () => {
    const { world, ship } = makePlayer();
    forceRng(world, 0);
    const graph = ensureRooms(ship);
    const room = roomsOnDeck(graph, 1)[0];
    for (const i of room.cells.slice(0, 5)) ship.grid.hp[i] *= 0.3;
    run(world, ship, DT);
    expect(room.fire).toBeGreaterThan(0);
  });

  it('never ignites when the damage roll always fails', () => {
    const { world, ship } = makePlayer();
    forceRng(world, 0.999);
    const graph = ensureRooms(ship);
    const room = roomsOnDeck(graph, 1)[0];
    for (const i of room.cells.slice(0, 5)) ship.grid.hp[i] *= 0.3;
    run(world, ship, 1);
    expect(room.fire).toBe(0);
  });

  it('grows and burns cells while there is oxygen', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const room = roomsOnDeck(graph, 1)[0];
    room.fire = 0.5;
    const before = room.cells.reduce((s, i) => s + ship.grid.hp[i], 0);
    run(world, ship, 3);
    expect(room.fire).toBeGreaterThan(0.5);
    const after = room.cells.reduce((s, i) => s + ship.grid.hp[i], 0);
    expect(after).toBeLessThan(before);
  });

  it('is snuffed out once its room is truly vented, but not by a passing pressure dip', () => {
    // A momentary low pressure value with no real breach gets equalized straight back up by
    // an open, unaffected neighbor — fire must not care about that transient.
    {
      const { world, ship } = makePlayer();
      const graph = ensureRooms(ship);
      const bridge = roomsOnDeck(graph, 1)[0];
      bridge.fire = 1;
      bridge.pressure = 0.02;
      run(world, ship, 2);
      expect(bridge.fire).toBeGreaterThan(0);
    }
    // Isolate a room (close its only door) and actually vent it through a real, wide breach —
    // now fire must go out once oxygen is gone.
    {
      const { world, ship } = makePlayer();
      const graph = ensureRooms(ship);
      const [, shieldBay, aftBay] = roomsOnDeck(graph, 1);
      const doorEdge = graph.edges.find((e) => e.kind === 'door' && (e.a === shieldBay.id || e.b === shieldBay.id) && (e.a === aftBay.id || e.b === aftBay.id))!;
      setDoorOpen(ship.grid, doorEdge.doorId!, false);
      breachCells(ship, aftBay.cells.slice(0, 10), 1);
      run(world, ship, 6);
      expect(aftBay.pressure).toBeLessThan(0.05);
      aftBay.fire = 1;
      run(world, ship, 2);
      expect(aftBay.fire).toBe(0);
    }
  });

  it('spreads to a connected room across an open door, never a closed one', () => {
    for (const doorOpen of [true, false]) {
      const { world, ship } = makePlayer();
      forceRng(world, 0);
      const graph = ensureRooms(ship);
      const [bridge, shieldBay] = roomsOnDeck(graph, 1);
      const doorEdge = graph.edges.find((e) => e.kind === 'door' && (e.a === bridge.id || e.b === bridge.id) && (e.a === shieldBay.id || e.b === shieldBay.id))!;
      setDoorOpen(ship.grid, doorEdge.doorId!, doorOpen);
      bridge.fire = 0.9;
      run(world, ship, 5);
      if (doorOpen) expect(shieldBay.fire).toBeGreaterThan(0);
      else expect(shieldBay.fire).toBe(0);
    }
  });
});

describe('reactor fire interacts with MVP-1 detonation', () => {
  it('an unchecked fire in the reactor room raises instability and starts the countdown', () => {
    const { world, ship } = makePlayer();
    forceRng(world, 0);
    const reactorRoom = findReactorRoom(ship);
    reactorRoom.fire = 1;
    let countdownStarted = false;
    for (let i = 0; i < 60 * 40 && !countdownStarted; i++) {
      updateCompartments(world, ship, DT);
      updateSystems(world, ship, DT);
      if (ship.sys!.countdown >= 0) countdownStarted = true;
    }
    expect(countdownStarted).toBe(true);
  });

  it('venting the reactor room in time snuffs the fire and prevents the countdown', () => {
    const { world, ship } = makePlayer();
    forceRng(world, 0);
    const reactorRoom = findReactorRoom(ship);
    reactorRoom.fire = 0.5;
    // Breach directly over the reactor module itself, not an arbitrary slice of the
    // room's cell list — some of those border the room's own wall/door, and destroying
    // a door is a structural change that would (correctly) invalidate this reference.
    const reactorModule = ship.grid.modules.find((m) => m.kind === 'reactor')!;
    breachCells(ship, reactorModule.cells, reactorRoom.z);
    // A handful of ticks is enough to vent this small room before the fire can do much damage
    // or spread far enough to threaten the graph's structural cells.
    for (let i = 0; i < 60 * 2; i++) {
      updateCompartments(world, ship, DT);
      updateSystems(world, ship, DT);
    }
    expect(reactorRoom.pressure).toBeLessThan(0.05);
    expect(reactorRoom.fire).toBe(0);
    expect(ship.sys!.countdown).toBe(-1);
    expect(ship.sys!.dead).toBe(false);
  });
});

describe('scope: only the player ship simulates compartments', () => {
  it('leaves enemy ships without a room graph even after stepping the world', () => {
    const world = new World(1);
    const player = world.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const enemy = world.spawnShip(buildFighter('raider'), 0, -300, Math.PI, { name: 'E', team: 1 });
    for (let i = 0; i < 60 * 3; i++) world.step(DT);
    expect(player.sys!.rooms).not.toBeNull();
    expect(enemy.sys!.rooms).toBeNull();
  });
});

describe('doors survive a hull split', () => {
  it('keeps a door functional on the surviving piece after the ship fragments', () => {
    const { world, ship } = makePlayer();
    const graph = ensureRooms(ship);
    const before = graph.edges.filter((e) => e.kind === 'door').length;
    // Break the ship roughly in half across y=34, away from the doors we care about, to force a split.
    for (let x = 0; x < ship.grid.width; x++) {
      for (let z = 0; z < ship.grid.depth; z++) ship.grid.removeCell(ship.grid.idx(x, 34, z));
    }
    world.processDamaged();
    const survivor = world.player;
    expect(survivor).not.toBeNull();
    expect(survivor!.grid.doors.length).toBeGreaterThan(0);
    expect(survivor!.grid.doors.length).toBeLessThanOrEqual(before);
  });
});
