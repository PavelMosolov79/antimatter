import type { GridBody } from './body';
import { type Room, type RoomEdge, type RoomGraph, ensureRooms } from './compartments';
import { moduleEfficiency, type ShipGrid } from './grid';
import { Mat } from './materials';
import type { World } from './world';

export type CrewRole = 'pilot' | 'gunner' | 'shieldop' | 'engineer';
export type CrewTask = 'atPost' | 'toPost' | 'seal' | 'extinguish' | 'flee' | 'idle';

interface Waypoint {
  x: number;
  y: number;
  z: number;
}

export interface Crew {
  id: number;
  role: CrewRole;
  /** Mobile roles (engineer) have no fixed post; stationary roles are tied to one module. */
  mobile: boolean;
  /** Index into grid.modules for the post this crew is assigned to. -1 for mobile roles. */
  homeModule: number;
  x: number;
  y: number;
  z: number;
  waypoints: Waypoint[];
  /**
   * Last room this crew was confirmed to be standing in. Doors and ladders aren't part
   * of any room's cell set, so while mid-transit through a doorway `roomIdAt` briefly
   * returns -1 — this holds the last real answer so pathing decisions never see a gap.
   */
  roomId: number;
  /** The room id this crew is currently walking toward (for change detection only). */
  destRoom: number;
  task: CrewTask;
  orphaned: boolean;
  dead: boolean;
  dangerTime: number;
}

const CREW = {
  speed: 3.2, // cells/sec
  arriveEps: 0.15,
  dangerPressure: 0.2,
  dangerFire: 0.3,
  deathTime: 6,
};

function isDangerous(room: Room | null): boolean {
  if (!room) return false;
  return room.pressure < CREW.dangerPressure || room.fire > CREW.dangerFire;
}

function needsHelp(room: Room): boolean {
  return (room.breached && room.pressure < 0.95) || room.fire > 0;
}

function moduleCore(grid: ShipGrid, moduleId: number): { x: number; y: number; z: number } {
  const m = grid.modules[moduleId];
  return { x: grid.xOf(m.core), y: grid.yOf(m.core), z: grid.zOf(m.core) };
}

function roomIdAt(grid: ShipGrid, graph: RoomGraph, x: number, y: number, z: number): number {
  const xi = Math.max(0, Math.min(grid.width - 1, Math.floor(x)));
  const yi = Math.max(0, Math.min(grid.height - 1, Math.floor(y)));
  if (z < 0 || z >= grid.depth) return -1;
  return graph.cellRoom[grid.idx(xi, yi, z)];
}

/**
 * Door and ladder cells aren't part of any room's cell set, so a crew member mid-transit
 * through one gets a hard -1 from roomIdAt for that instant. Falling back to their last
 * confirmed room keeps every BFS/decision call fed a real room id instead of a dead end.
 */
function currentRoom(grid: ShipGrid, graph: RoomGraph, crew: Crew): number {
  const r = roomIdAt(grid, graph, crew.x, crew.y, crew.z);
  if (r >= 0) crew.roomId = r;
  return crew.roomId;
}

function roomCentroid(grid: ShipGrid, room: Room): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const i of room.cells) {
    sx += grid.xOf(i);
    sy += grid.yOf(i);
  }
  return { x: sx / room.cells.length + 0.5, y: sy / room.cells.length + 0.5 };
}

/** Breadth-first search over the room graph. Returns the edge sequence from `from` to `to`, or null if unreachable. */
function bfsPathTo(graph: RoomGraph, from: number, to: number): RoomEdge[] | null {
  if (from === to) return [];
  const prevEdge = new Map<number, RoomEdge>();
  const visited = new Set<number>([from]);
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (const edge of graph.edges) {
      if (edge.a !== cur && edge.b !== cur) continue;
      const next = edge.a === cur ? edge.b : edge.a;
      if (visited.has(next)) continue;
      visited.add(next);
      prevEdge.set(next, edge);
      if (next === to) {
        const path: RoomEdge[] = [];
        let n = to;
        while (n !== from) {
          const e = prevEdge.get(n)!;
          path.unshift(e);
          n = e.a === n ? e.b : e.a;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Breadth-first search for the nearest room (by hop count) matching `pred`, starting from and including `from`. */
function bfsNearest(graph: RoomGraph, from: number, pred: (r: Room) => boolean): number | null {
  const startRoom = graph.rooms[from];
  if (startRoom && pred(startRoom)) return from;
  const visited = new Set<number>([from]);
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (const edge of graph.edges) {
      if (edge.a !== cur && edge.b !== cur) continue;
      const next = edge.a === cur ? edge.b : edge.a;
      if (visited.has(next)) continue;
      visited.add(next);
      const r = graph.rooms[next];
      if (r && pred(r)) return next;
      queue.push(next);
    }
  }
  return null;
}

function buildRoute(grid: ShipGrid, graph: RoomGraph, fromRoomId: number, toRoomId: number): Waypoint[] {
  const edges = bfsPathTo(graph, fromRoomId, toRoomId);
  if (!edges) return [];
  const waypoints: Waypoint[] = [];
  for (const edge of edges) {
    if (edge.kind === 'door') {
      const door = grid.doors[edge.doorId!];
      waypoints.push({ x: grid.xOf(door.cell) + 0.5, y: grid.yOf(door.cell) + 0.5, z: grid.zOf(door.cell) });
    } else {
      // Ladder: find the shared (x,y) column between the two z-layers it connects.
      const a = graph.rooms[edge.a];
      const b = graph.rooms[edge.b];
      const lowZ = Math.min(a.z, b.z);
      const highZ = Math.max(a.z, b.z);
      let lx = -1;
      let ly = -1;
      outer: for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          const i = grid.idx(x, y, lowZ);
          if (graph.cellRoom[i] !== -1 && grid.mat[i] === Mat.LADDER) {
            const above = grid.idx(x, y, highZ);
            if (grid.mat[above] === Mat.LADDER) {
              lx = x;
              ly = y;
              break outer;
            }
          }
        }
      }
      if (lx >= 0) {
        waypoints.push({ x: lx + 0.5, y: ly + 0.5, z: lowZ });
        waypoints.push({ x: lx + 0.5, y: ly + 0.5, z: highZ });
      }
    }
  }
  const dest = graph.rooms[toRoomId];
  if (dest) {
    const c = roomCentroid(grid, dest);
    waypoints.push({ x: c.x, y: c.y, z: dest.z });
  }
  return waypoints;
}

function moveAlong(crew: Crew, dt: number): void {
  let remaining = CREW.speed * dt;
  while (remaining > 0 && crew.waypoints.length > 0) {
    const wp = crew.waypoints[0];
    if (wp.z !== crew.z) {
      crew.z = wp.z;
      crew.x = wp.x;
      crew.y = wp.y;
      crew.waypoints.shift();
      continue;
    }
    const dx = wp.x - crew.x;
    const dy = wp.y - crew.y;
    const d = Math.hypot(dx, dy);
    if (d <= remaining || d < CREW.arriveEps) {
      crew.x = wp.x;
      crew.y = wp.y;
      remaining -= d;
      crew.waypoints.shift();
    } else {
      crew.x += (dx / d) * remaining;
      crew.y += (dy / d) * remaining;
      remaining = 0;
    }
  }
}

let nextCrewId = 1;

function makeCrew(role: CrewRole, mobile: boolean, homeModule: number, pos: { x: number; y: number; z: number }): Crew {
  return {
    id: nextCrewId++,
    role,
    mobile,
    homeModule,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    waypoints: [],
    roomId: -1,
    destRoom: -1,
    task: mobile ? 'idle' : 'atPost',
    orphaned: false,
    dead: false,
    dangerTime: 0,
  };
}

export function findPosts(grid: ShipGrid): Array<{ role: CrewRole; moduleId: number }> {
  const posts: Array<{ role: CrewRole; moduleId: number }> = [];
  grid.modules.forEach((m, i) => {
    if (m.kind === 'bridge') posts.push({ role: 'pilot', moduleId: i });
    else if (m.kind === 'turret') posts.push({ role: 'gunner', moduleId: i });
    else if (m.kind === 'shield') posts.push({ role: 'shieldop', moduleId: i });
  });
  return posts;
}

/** Starting roster: one crew per combat post (first bridge is the primary helm, any further
 * bridge modules start empty as reserve posts), plus a handful of mobile engineers. */
export function spawnCrew(grid: ShipGrid): Crew[] {
  const posts = findPosts(grid);
  const crew: Crew[] = [];
  let pilotAssigned = false;
  for (const post of posts) {
    if (post.role === 'pilot') {
      if (pilotAssigned) continue; // reserve post — starts empty
      pilotAssigned = true;
    }
    crew.push(makeCrew(post.role, false, post.moduleId, moduleCore(grid, post.moduleId)));
  }
  const engineerCount = Math.max(1, Math.round(posts.length / 3));
  const reactorModule = grid.modules.findIndex((m) => m.kind === 'reactor');
  const spawnAt = reactorModule >= 0 ? moduleCore(grid, reactorModule) : { x: grid.width / 2, y: grid.height / 2, z: 1 };
  for (let i = 0; i < engineerCount; i++) crew.push(makeCrew('engineer', true, -1, spawnAt));
  return crew;
}

function targetRoomForStationary(grid: ShipGrid, graph: RoomGraph, crew: Crew): number | null {
  const module = grid.modules[crew.homeModule];
  if (moduleEfficiency(module) <= 0) return null; // orphaned — caller looks for a reserve post instead
  const core = moduleCore(grid, crew.homeModule);
  return roomIdAt(grid, graph, core.x + 0.5, core.y + 0.5, core.z);
}

function findFreeReservePost(grid: ShipGrid, crew: Crew[], role: CrewRole, excludeModule: number): number | null {
  for (let i = 0; i < grid.modules.length; i++) {
    const m = grid.modules[i];
    const wantKind = role === 'pilot' ? 'bridge' : role === 'gunner' ? 'turret' : role === 'shieldop' ? 'shield' : null;
    if (m.kind !== wantKind || i === excludeModule || moduleEfficiency(m) <= 0) continue;
    if (crew.some((c) => !c.dead && c.role === role && c.homeModule === i)) continue; // already taken
    return i;
  }
  return null;
}

function decideStationary(crew: Crew, grid: ShipGrid, graph: RoomGraph, roster: Crew[]): void {
  const curId = currentRoom(grid, graph, crew);
  const room = graph.rooms[curId] ?? null;

  if (crew.orphaned) {
    const spare = findFreeReservePost(grid, roster, crew.role, -1);
    if (spare !== null) {
      crew.homeModule = spare;
      crew.orphaned = false;
    } else {
      crew.task = 'idle';
      return;
    }
  } else {
    const module = grid.modules[crew.homeModule];
    if (moduleEfficiency(module) <= 0) {
      crew.orphaned = true;
      crew.task = 'idle';
      crew.destRoom = -1;
      crew.waypoints = [];
      return;
    }
  }

  if (isDangerous(room) && crew.task !== 'flee') {
    const safe = bfsNearest(graph, curId, (r) => !isDangerous(r));
    if (safe !== null && safe !== curId) {
      crew.waypoints = buildRoute(grid, graph, curId, safe);
      crew.destRoom = safe;
    }
    crew.task = 'flee';
    return;
  }

  const targetRoom = targetRoomForStationary(grid, graph, crew);
  if (targetRoom === null) return; // post just got destroyed this tick; orphan handling kicks in next tick
  if (curId === targetRoom && crew.waypoints.length === 0) {
    crew.task = 'atPost';
    return;
  }
  if (room && isDangerous(room)) return; // still fleeing until it's actually safe to head back
  if (crew.destRoom !== targetRoom) {
    crew.waypoints = buildRoute(grid, graph, curId, targetRoom);
    crew.destRoom = targetRoom;
  }
  crew.task = 'toPost';
}

function decideEngineer(crew: Crew, grid: ShipGrid, graph: RoomGraph): void {
  const curId = currentRoom(grid, graph, crew);
  const target = bfsNearest(graph, curId, needsHelp);
  if (target === null) {
    crew.task = 'idle';
    crew.destRoom = -1;
    crew.waypoints = [];
    return;
  }
  if (target !== curId && crew.destRoom !== target) {
    crew.waypoints = buildRoute(grid, graph, curId, target);
    crew.destRoom = target;
  }
  if (target === curId && crew.waypoints.length === 0) {
    const room = graph.rooms[target];
    crew.task = room.fire > 0 ? 'extinguish' : 'seal';
  } else {
    crew.task = 'toPost';
  }
}

export function updateCrew(_world: World, body: GridBody, dt: number): void {
  const sys = body.sys;
  if (!sys || !sys.crew) return;
  const graph = ensureRooms(body);
  const grid = body.grid;

  for (const room of graph.rooms) {
    room.sealing = false;
    room.firefighting = false;
  }

  for (const crew of sys.crew) {
    if (crew.dead) continue;

    if (crew.role === 'engineer') decideEngineer(crew, grid, graph);
    else decideStationary(crew, grid, graph, sys.crew);

    moveAlong(crew, dt);

    const roomId = currentRoom(grid, graph, crew);
    const room = roomId >= 0 ? graph.rooms[roomId] : null;

    if (crew.waypoints.length === 0) {
      if (crew.task === 'seal' && room) room.sealing = true;
      else if (crew.task === 'extinguish' && room) room.firefighting = true;
    }

    // Standing in a cell that's destroyed out from under them is fatal outright,
    // regardless of role or task — this is what "died inside the wrecked module" means.
    const xi = Math.floor(crew.x);
    const yi = Math.floor(crew.y);
    if (xi < 0 || yi < 0 || xi >= grid.width || yi >= grid.height || grid.mat[grid.idx(xi, yi, crew.z)] === 0) {
      crew.dead = true;
      continue;
    }

    if (isDangerous(room)) {
      crew.dangerTime += dt;
      if (crew.dangerTime > CREW.deathTime) crew.dead = true;
    } else {
      crew.dangerTime = 0;
    }
  }
}

export function pilotAvailable(body: GridBody): boolean {
  const crew = body.sys?.crew;
  if (!crew) return true;
  const hasBridge = body.grid.modules.some((m) => m.kind === 'bridge');
  if (!hasBridge) return true;
  return crew.some((c) => c.role === 'pilot' && !c.dead && c.task === 'atPost');
}

export function crewOnDeck(crew: Crew[], z: number): Crew[] {
  return crew.filter((c) => !c.dead && c.z === z);
}

/** Counterpart to remapRoomGraph: translates crew positions into a cropped grid's local
 * coordinates after a hull fragmentation split. Crew whose position falls outside the
 * new grid (they were on the piece that broke away) are lost with it. */
export function remapCrew(crew: Crew[], newGrid: ShipGrid, offsetX: number, offsetY: number): Crew[] {
  const out: Crew[] = [];
  for (const c of crew) {
    if (c.dead) continue;
    const nx = c.x - offsetX;
    const ny = c.y - offsetY;
    const xi = Math.floor(nx);
    const yi = Math.floor(ny);
    if (xi < 0 || yi < 0 || xi >= newGrid.width || yi >= newGrid.height || newGrid.mat[newGrid.idx(xi, yi, c.z)] === 0) continue;
    c.x = nx;
    c.y = ny;
    c.waypoints = [];
    c.roomId = -1;
    c.destRoom = -1;
    out.push(c);
  }
  return out;
}
