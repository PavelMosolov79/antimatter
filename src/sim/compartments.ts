import type { GridBody } from './body';
import type { ShipGrid } from './grid';
import { Mat } from './materials';
import type { World } from './world';

export type EdgeKind = 'door' | 'ladder';

export interface Room {
  id: number;
  z: number;
  cells: number[];
  pressure: number;
  fire: number;
  prevHp: number;
  breached: boolean;
}

export interface RoomEdge {
  a: number;
  b: number;
  kind: EdgeKind;
  doorId?: number;
}

export interface RoomGraph {
  grid: ShipGrid;
  structVersion: number;
  rooms: Room[];
  edges: RoomEdge[];
  cellRoom: Int32Array;
}

export const COMPARTMENTS = {
  breachRate: 0.3,
  flowRate: 1.1,
  fireGrowth: 0.14,
  fireVacuumDecay: 1.4,
  fireSpreadChance: 0.3,
  fireDamagePerSec: 26,
  fireDamageCells: 3,
  ignitionDivisor: 55,
  ignitionFeed: 220,
  minOxygen: 0.12,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function sumHp(grid: ShipGrid, cells: number[]): number {
  let s = 0;
  for (const i of cells) s += grid.hp[i];
  return s;
}

function edgeOpen(grid: ShipGrid, edge: RoomEdge): boolean {
  if (edge.kind === 'ladder') return true;
  const door = edge.doorId !== undefined ? grid.doors[edge.doorId] : undefined;
  return !!door && (door.open || door.destroyed);
}

/**
 * Hull tapering means a hand-placed wall almost never lines up with the hull edge on
 * every row it crosses, so a stray sliver of floor can end up sealed on all sides with
 * no door — structurally sound but pointless. Rather than chase every such sliver by
 * hand, we just don't dignify anything this small with a room: its cells stay
 * unassigned (cellRoom -1), inert for pressure/fire purposes, same as a wall.
 */
const MIN_ROOM_CELLS = 6;

export function buildRooms(grid: ShipGrid): RoomGraph {
  const n = grid.mat.length;
  const cellRoom = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const rooms: Room[] = [];
  const stack: number[] = [];

  for (let z = 1; z < grid.depth; z++) {
    const base = z * grid.layerSize;
    for (let start = base; start < base + grid.layerSize; start++) {
      const m = grid.mat[start];
      if (m === 0 || m === Mat.WALL || m === Mat.DOOR || visited[start]) continue;
      const cells: number[] = [];
      stack.length = 0;
      stack.push(start);
      visited[start] = 1;
      while (stack.length > 0) {
        const i = stack.pop()!;
        cells.push(i);
        const x = grid.xOf(i);
        const y = grid.yOf(i);
        const nb = [x > 0 ? i - 1 : -1, x < grid.width - 1 ? i + 1 : -1, y > 0 ? i - grid.width : -1, y < grid.height - 1 ? i + grid.width : -1];
        for (const ni of nb) {
          if (ni < 0) continue;
          const nm = grid.mat[ni];
          if (nm === 0 || nm === Mat.WALL || nm === Mat.DOOR || visited[ni]) continue;
          visited[ni] = 1;
          stack.push(ni);
        }
      }
      if (cells.length < MIN_ROOM_CELLS) continue;
      const id = rooms.length;
      for (const c of cells) cellRoom[c] = id;
      rooms.push({ id, z, cells, pressure: 1, fire: 0, prevHp: sumHp(grid, cells), breached: false });
    }
  }

  const edges: RoomEdge[] = [];
  for (let di = 0; di < grid.doors.length; di++) {
    const door = grid.doors[di];
    const x = grid.xOf(door.cell);
    const y = grid.yOf(door.cell);
    const nb = [x > 0 ? door.cell - 1 : -1, x < grid.width - 1 ? door.cell + 1 : -1, y > 0 ? door.cell - grid.width : -1, y < grid.height - 1 ? door.cell + grid.width : -1];
    const found = new Set<number>();
    for (const ni of nb) if (ni >= 0 && cellRoom[ni] !== -1) found.add(cellRoom[ni]);
    const ids = [...found];
    if (ids.length === 2) edges.push({ a: ids[0], b: ids[1], kind: 'door', doorId: di });
  }
  for (let z = 1; z < grid.depth - 1; z++) {
    const base = z * grid.layerSize;
    for (let i = base; i < base + grid.layerSize; i++) {
      if (grid.mat[i] !== Mat.LADDER) continue;
      const x = grid.xOf(i);
      const y = grid.yOf(i);
      const upper = grid.idx(x, y, z + 1);
      if (grid.mat[upper] !== Mat.LADDER) continue;
      const ra = cellRoom[i];
      const rb = cellRoom[upper];
      if (ra !== -1 && rb !== -1) edges.push({ a: ra, b: rb, kind: 'ladder' });
    }
  }

  return { grid, structVersion: grid.structVersion, rooms, edges, cellRoom };
}

/**
 * A new room can inherit cells from several old rooms at once when a wall or door
 * between them is destroyed and the flood fill merges them into one region. Picking
 * only the single largest contributor (as an earlier version of this did) throws away
 * every other contributor's state: merging a nearly-vented closet into a big, still
 * fully pressurized corridor room would silently reset the closet back to full
 * pressure, because the corridor's cell count wins the vote. Air mixing between
 * connected spaces is what actually happens physically, so instead we average
 * pressure/fire across all contributing old rooms weighted by how many of the new
 * room's cells came from each one. `oldCellFor` maps a new-graph cell index back to
 * the corresponding old-graph cell index, which is the identity for an in-place
 * rebuild but needs a coordinate translation when the new grid is a cropped copy
 * (see `remapRoomGraph`).
 */
function blend(oldGraph: RoomGraph, newGraph: RoomGraph, oldCellFor: (newCell: number) => number): void {
  for (const nr of newGraph.rooms) {
    let matchedCells = 0;
    let pressureSum = 0;
    let fireSum = 0;
    let breached = false;
    for (const cell of nr.cells) {
      const oldId = oldGraph.cellRoom[oldCellFor(cell)];
      if (oldId === -1) continue;
      const or = oldGraph.rooms[oldId];
      pressureSum += or.pressure;
      fireSum += or.fire;
      if (or.breached) breached = true;
      matchedCells++;
    }
    if (matchedCells > 0) {
      nr.pressure = pressureSum / matchedCells;
      nr.fire = fireSum / matchedCells;
      nr.breached = breached;
    }
  }
}

function migrate(oldGraph: RoomGraph, newGraph: RoomGraph): void {
  blend(oldGraph, newGraph, (cell) => cell);
}

/**
 * Rebuilds the room graph for a ship grid that was cropped out of a larger one (see
 * `extractComponent` in fragment.ts), carrying over pressure/fire instead of starting
 * every room back at full pressure. This is the split/fragmentation counterpart of the
 * in-place rebuild `ensureRooms` does: when a piece breaks off the ship (even a tiny,
 * structurally unrelated piece elsewhere), the surviving hull gets an entirely new
 * `ShipGrid` object, so `ensureRooms`'s `old.grid === g` identity check can never match
 * and would otherwise silently drop all compartment state for the whole ship.
 */
export function remapRoomGraph(oldGraph: RoomGraph, newGrid: ShipGrid, offsetX: number, offsetY: number): RoomGraph {
  const fresh = buildRooms(newGrid);
  const oldGrid = oldGraph.grid;
  blend(oldGraph, fresh, (cell) => oldGrid.idx(newGrid.xOf(cell) + offsetX, newGrid.yOf(cell) + offsetY, newGrid.zOf(cell)));
  return fresh;
}

export function ensureRooms(body: GridBody): RoomGraph {
  const sys = body.sys!;
  const g = body.grid;
  const old = sys.rooms;
  if (old && old.grid === g && old.structVersion === g.structVersion) return old;
  const fresh = buildRooms(g);
  if (old && old.grid === g) migrate(old, fresh);
  sys.rooms = fresh;
  return fresh;
}

function autoCloseDoors(grid: ShipGrid, graph: RoomGraph, roomId: number): void {
  for (const edge of graph.edges) {
    if (edge.kind !== 'door' || edge.doorId === undefined) continue;
    if (edge.a !== roomId && edge.b !== roomId) continue;
    const door = grid.doors[edge.doorId];
    if (!door.destroyed) door.open = false;
  }
}

export function setDoorOpen(grid: ShipGrid, doorId: number, open: boolean): void {
  const door = grid.doors[doorId];
  if (door && !door.destroyed) door.open = open;
}

function applyFireDamage(world: World, body: GridBody, room: Room, budget: number): void {
  if (budget <= 0) return;
  const grid = body.grid;
  const alive = room.cells.filter((i) => grid.mat[i] !== 0);
  if (alive.length === 0) return;
  const n = Math.min(COMPARTMENTS.fireDamageCells, alive.length);
  const chosen: number[] = [];
  const pool = [...alive];
  for (let k = 0; k < n; k++) {
    const idx = Math.floor(world.rng() * pool.length);
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  world.burnCells(body, chosen, budget);
}

export function updateCompartments(world: World, body: GridBody, dt: number): void {
  const sys = body.sys;
  if (!sys) return;
  const graph = ensureRooms(body);
  const grid = body.grid;

  for (const room of graph.rooms) {
    let breachedCells = 0;
    for (const i of room.cells) {
      // Breached means nothing shallower than this level still shields the column from
      // outside: either this cell itself is now the exposed surface (topLayer === room.z),
      // or it — and everything above it — is gone entirely (topLayer > room.z, some
      // deeper deck now exposed, or -1, nothing left at all). If something shallower
      // survives, the room stays sealed even if this specific cell was blown away (e.g.
      // fire gutting an interior floor tile while the outer hull above it holds).
      const top = grid.topLayer(grid.xOf(i), grid.yOf(i));
      if (top === -1 || top >= room.z) breachedCells++;
    }
    const wasBreached = room.breached;
    room.breached = breachedCells > 0;
    if (breachedCells > 0) room.pressure = clamp01(room.pressure - COMPARTMENTS.breachRate * breachedCells * dt);
    if (!wasBreached && room.breached) autoCloseDoors(grid, graph, room.id);
  }

  for (const edge of graph.edges) {
    if (!edgeOpen(grid, edge)) continue;
    const a = graph.rooms[edge.a];
    const b = graph.rooms[edge.b];
    const flow = (a.pressure - b.pressure) * COMPARTMENTS.flowRate * dt;
    a.pressure = clamp01(a.pressure - flow);
    b.pressure = clamp01(b.pressure + flow);
  }

  for (const room of graph.rooms) {
    const hpNow = sumHp(grid, room.cells);
    const dmg = Math.max(0, room.prevHp - hpNow);
    room.prevHp = hpNow;
    if (dmg > 0) {
      if (room.fire <= 0) {
        const chance = Math.min(0.9, dmg / COMPARTMENTS.ignitionDivisor);
        if (world.rng() < chance) room.fire = 0.3;
      } else {
        room.fire = Math.min(1, room.fire + dmg / COMPARTMENTS.ignitionFeed);
      }
    }
    if (room.fire > 0) {
      if (room.pressure < COMPARTMENTS.minOxygen) {
        room.fire = Math.max(0, room.fire - COMPARTMENTS.fireVacuumDecay * dt);
      } else {
        room.fire = Math.min(1, room.fire + COMPARTMENTS.fireGrowth * dt);
        applyFireDamage(world, body, room, COMPARTMENTS.fireDamagePerSec * room.fire * dt);
      }
    }
  }

  for (const edge of graph.edges) {
    if (!edgeOpen(grid, edge)) continue;
    const a = graph.rooms[edge.a];
    const b = graph.rooms[edge.b];
    if (a.fire > 0.5 && b.fire < a.fire && b.pressure >= COMPARTMENTS.minOxygen && world.rng() < COMPARTMENTS.fireSpreadChance * dt) {
      b.fire = Math.max(b.fire, 0.2);
    }
    if (b.fire > 0.5 && a.fire < b.fire && a.pressure >= COMPARTMENTS.minOxygen && world.rng() < COMPARTMENTS.fireSpreadChance * dt) {
      a.fire = Math.max(a.fire, 0.2);
    }
  }
}

export function roomsOnDeck(graph: RoomGraph, z: number): Room[] {
  return graph.rooms.filter((r) => r.z === z);
}

export interface DoorInfo {
  id: number;
  x: number;
  y: number;
  z: number;
  open: boolean;
  destroyed: boolean;
  roomA: number;
  roomB: number;
}

export function doorsOnDeck(grid: ShipGrid, graph: RoomGraph, z: number): DoorInfo[] {
  const out: DoorInfo[] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== 'door' || edge.doorId === undefined) continue;
    const door = grid.doors[edge.doorId];
    if (grid.zOf(door.cell) !== z) continue;
    out.push({
      id: edge.doorId,
      x: grid.xOf(door.cell),
      y: grid.yOf(door.cell),
      z,
      open: door.open,
      destroyed: door.destroyed,
      roomA: edge.a,
      roomB: edge.b,
    });
  }
  return out;
}
