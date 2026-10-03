import { shipEffects } from './effects';
import { crewPlaces, effectValue, levelOf } from './levels';
import type { GridBody } from './body';
import { COMPARTMENTS, type Room, type RoomEdge, type RoomGraph, edgeLocked, ensureRooms } from './compartments';
import { moduleEfficiency, type ShipGrid } from './grid';
import { Mat } from './materials';
import { refineRoute } from './walk';
import type { World } from './world';

export type CrewRole = 'pilot' | 'gunner' | 'shieldop' | 'engineer';
export type CrewTask = 'atPost' | 'toPost' | 'seal' | 'extinguish' | 'flee' | 'idle' | 'ejected' | 'wander';

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
  /** The room graph's structVersion this `roomId` was captured against. A structural
   * change anywhere on the ship (any wall/door/ladder destroyed, not just nearby)
   * rebuilds the whole graph with fresh, renumbered rooms — a cached id from before
   * that could now point at a completely different room. Only trusted while it matches. */
  roomVersion: number;
  /** The room id this crew is currently walking toward (for change detection only). */
  destRoom: number;
  task: CrewTask;
  orphaned: boolean;
  dead: boolean;
  dangerTime: number;
  /** Always false for now — no spacesuit mechanic exists yet, so nobody is protected
   * from being pulled out through a breach. Kept as a field so that feature can hook in
   * later without touching the ejection logic itself. */
  suited: boolean;
  /** Countdown to the next random step while wandering (see wanderBehavior). */
  wanderCooldown: number;
  /** Seconds spent without a post; after `dashAfter` of them the way to a spare post may lead through an unsafe room. */
  orphanTime: number;
  /** On the way to a spare post straight through an unsafe room (the last resort): no turning back, a smaller chance of being lost. */
  dash: boolean;
  /** Seconds a pilot still needs at a reserve helm before the ship can be flown from it (levels.ts: the helm module's level). */
  seat: number;
  /** The named person (the roster's id, name and level); null for a crew member nobody knows by name. */
  memberId: number | null;
  name: string;
  level: number;
  /** An engineer sent to a room in trouble (a room id of the current room graph), and how long they have worked there. */
  incident: number | null;
  workTime: number;
}

const CREW = {
  speed: 3.2, // cells/sec
  arriveEps: 0.15,
  dangerPressure: 0.2,
  dangerFire: 0.3,
  deathTime: 6,
  ejectSpeed: 14, // cells/sec — a decompression yanks you out far faster than anyone walks
  ejectChance: 0.5, // per second, while exposed and unsuited
  ejectOvershoot: 10, // cells to sail past the breach before being considered lost
  runBoost: 1.3, // fleeing and answering a call: people run
  sealTime: 1.5, // seconds an engineer works a breach before the patch holds
  safePressure: 0.3, // below this a room is not a place to be
  dashAfter: 12, // seconds without a post and without a safe way to a spare one, before a person risks the unsafe way
  dashEjectFactor: 0.15, // on a dash the chance of being pulled out is this share of the usual (he runs for it, holding his breath)
  sealMaxHoles: COMPARTMENTS.sealMaxHoles, // an engineer can patch a breach of this many cells; a wider one is beyond them (and too dangerous to go near)
};

/**
 * A room people do not stay in: a hole open to space nobody has patched, too little air, or fire.
 * They leave as soon as the hole is made, not when the air is nearly gone.
 */
function hazard(room: Room | null): boolean {
  if (!room) return false;
  return (room.holes > 0 && !room.patched) || room.pressure < CREW.safePressure || room.fire > CREW.dangerFire;
}

/** Only the fire half: standing in a burning room kills slowly (see updateCrew). */
function isDangerousFire(room: Room | null): boolean {
  return !!room && room.fire > CREW.dangerFire;
}

/**
 * A room in trouble: a hole nobody has patched, or fire, but only a hole an engineer can close (`sealMaxHoles`). Even a room that has already lost its air is
 * worth a patch, because the air comes back once the hole is closed and the people can return.
 */
function needsHelp(room: Room): boolean {
  if (room.holes > CREW.sealMaxHoles) return false; // too wide to patch, and no place for a person
  return (room.holes > 0 && !room.patched) || room.fire > 0;
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
 * confirmed room keeps every BFS/decision call fed a real room id instead of a dead end —
 * but only if that cached id was captured against the *current* room graph generation.
 * Destroying a wall, door or ladder anywhere on the ship (not necessarily anywhere near
 * this crew member) rebuilds the whole graph with fresh, renumbered rooms; trusting an id
 * cached before that happened could silently hand back a completely different room,
 * which is exactly what made crew "stick" exactly on doorways — every decision made while
 * standing there kept re-targeting whatever that stale id now happened to mean, instead
 * of the room they were actually about to step into.
 */
function currentRoom(grid: ShipGrid, graph: RoomGraph, crew: Crew): number {
  const r = roomIdAt(grid, graph, crew.x, crew.y, crew.z);
  if (r >= 0) {
    crew.roomId = r;
    crew.roomVersion = graph.structVersion;
    return r;
  }
  if (crew.roomVersion === graph.structVersion) return crew.roomId;
  return -1;
}

/**
 * The room of a point, or, for a spot that belongs to no room (a turret on the open deck), the room of
 * the nearest cell that has one: where a person who stands there goes on from.
 */
function roomNearPoint(grid: ShipGrid, graph: RoomGraph, x: number, y: number, z: number): number {
  const r = roomIdAt(grid, graph, x, y, z);
  if (r >= 0) return r;
  for (let rad = 1; rad <= 3; rad++) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const near = roomIdAt(grid, graph, x + dx, y + dy, z);
        if (near >= 0) return near;
      }
    }
  }
  return -1;
}

/** Standing on a door or a ladder: on the way from one room to another. */
function inTransit(grid: ShipGrid, crew: Crew): boolean {
  const xi = Math.floor(crew.x);
  const yi = Math.floor(crew.y);
  if (xi < 0 || yi < 0 || xi >= grid.width || yi >= grid.height || crew.z < 0 || crew.z >= grid.depth) return false;
  const m = grid.mat[grid.idx(xi, yi, crew.z)];
  return m === Mat.DOOR || m === Mat.LADDER;
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

const floorCache = new WeakMap<Room, boolean>();
/** A room with somewhere to stand (a ladder shaft is only a way between decks, not a place to wait out trouble). */
function hasFloor(grid: ShipGrid, room: Room): boolean {
  let v = floorCache.get(room);
  if (v === undefined) {
    v = room.cells.some((i) => standable(grid, i));
    floorCache.set(room, v);
  }
  return v;
}

/** A cell a person can stand on: there is a floor (not a wall, not a hole where a module was blown out). */
function standable(grid: ShipGrid, i: number): boolean {
  const m = grid.mat[i];
  // a doorway or a ladder is a way through, never a place to stop
  return m !== 0 && m !== Mat.WALL && m !== Mat.DOOR && m !== Mat.LADDER;
}

/**
 * A spot to walk to in a room: the room's own cell nearest its centroid. A room that is not
 * a rectangle (the open field round the modules of a deck) can have a centroid that is
 * inside a module or a wall.
 */
function roomPoint(grid: ShipGrid, room: Room): { x: number; y: number } {
  const c = roomCentroid(grid, room);
  let best = c;
  let bestD = Infinity;
  for (const i of room.cells) {
    if (!standable(grid, i)) continue;
    const x = grid.xOf(i) + 0.5;
    const y = grid.yOf(i) + 0.5;
    const d = (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y);
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

/** Breadth-first search over the room graph. Returns the edge sequence from `from` to `to`, or null if unreachable. */
function bfsPathTo(graph: RoomGraph, from: number, to: number, avoidHazard = true): RoomEdge[] | null {
  if (from === to) return [];
  const prevEdge = new Map<number, RoomEdge>();
  const visited = new Set<number>([from]);
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    // nobody plans a way through a room that is unsafe (the room they stand in, and the one they are bound for, may be)
    if (avoidHazard && cur !== from && hazard(graph.rooms[cur])) continue;
    for (const edge of graph.edges) {
      if (edge.a !== cur && edge.b !== cur) continue;
      if (edgeLocked(graph.grid, edge)) continue;
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
      if (edgeLocked(graph.grid, edge)) continue;
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

function buildRoute(grid: ShipGrid, graph: RoomGraph, fromRoomId: number, toRoomId: number, crew: Crew, avoidHazard = true): Waypoint[] {
  const edges = bfsPathTo(graph, fromRoomId, toRoomId, avoidHazard);
  if (!edges) return [];
  const waypoints: Waypoint[] = [];
  let cur = fromRoomId;
  for (const edge of edges) {
    const next = edge.a === cur ? edge.b : edge.a;
    if (edge.kind === 'door') {
      const door = grid.doors[edge.doorId!];
      waypoints.push({ x: grid.xOf(door.cell) + 0.5, y: grid.yOf(door.cell) + 0.5, z: grid.zOf(door.cell) });
    } else {
      // Ladder: the shaft cell that stands in the room we leave and has a shaft cell of the next room right above or below it.
      const zFrom = graph.rooms[cur].z;
      const zTo = graph.rooms[next].z;
      let lx = -1;
      let ly = -1;
      outer: for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          const i = grid.idx(x, y, zFrom);
          if (graph.cellRoom[i] === cur && grid.mat[i] === Mat.LADDER) {
            const other = grid.idx(x, y, zTo);
            if (grid.mat[other] === Mat.LADDER && graph.cellRoom[other] === next) {
              lx = x;
              ly = y;
              break outer;
            }
          }
        }
      }
      if (lx >= 0) {
        waypoints.push({ x: lx + 0.5, y: ly + 0.5, z: zFrom });
        waypoints.push({ x: lx + 0.5, y: ly + 0.5, z: zTo });
      }
    }
    cur = next;
  }
  const dest = graph.rooms[toRoomId];
  if (dest) {
    const c = roomPoint(grid, dest);
    waypoints.push({ x: c.x, y: c.y, z: dest.z });
  }
  return refineRoute(grid, { x: crew.x, y: crew.y, z: crew.z }, waypoints);
}

/** The way from a room to a point that is in no room: through the doors to the room beside it, then straight on. */
function buildRouteToPoint(grid: ShipGrid, graph: RoomGraph, fromRoom: number, crew: Crew, to: Waypoint): Waypoint[] {
  const toRoom = roomNearPoint(grid, graph, to.x, to.y, to.z);
  const wps = toRoom >= 0 && fromRoom >= 0 && toRoom !== fromRoom ? buildRoute(grid, graph, fromRoom, toRoom, crew) : [];
  return refineRoute(grid, { x: crew.x, y: crew.y, z: crew.z }, [...wps, to]);
}

/** Nearest cell in `room` that's currently exposed to space (same test compartments.ts
 * uses for breach detection), to aim an ejected crew member at the actual hole rather
 * than the room's center. */
function findNearestBreach(grid: ShipGrid, room: Room, fromX: number, fromY: number): { x: number; y: number } | null {
  let bestX = -1;
  let bestY = -1;
  let bestD = Infinity;
  for (const i of room.cells) {
    const x = grid.xOf(i);
    const y = grid.yOf(i);
    const top = grid.topLayer(x, y);
    if (top !== -1 && top < room.z) continue; // still shielded by something shallower
    const dx = x + 0.5 - fromX;
    const dy = y + 0.5 - fromY;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      bestX = x + 0.5;
      bestY = y + 0.5;
    }
  }
  return bestX >= 0 ? { x: bestX, y: bestY } : null;
}

/** Sends a crew member flying toward the nearest hole and out past the hull, along a
 * straight line from where they're standing through the breach — the same direction the
 * escaping air is going. */
function beginEjection(crew: Crew, grid: ShipGrid, room: Room): void {
  const breach = findNearestBreach(grid, room, crew.x, crew.y);
  if (!breach) return;
  const dx = breach.x - crew.x;
  const dy = breach.y - crew.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  crew.waypoints = [
    { x: breach.x, y: breach.y, z: crew.z },
    { x: breach.x + ux * CREW.ejectOvershoot, y: breach.y + uy * CREW.ejectOvershoot, z: crew.z },
  ];
  crew.task = 'ejected';
  crew.destRoom = -1;
}

function moveAlong(crew: Crew, dt: number, speed: number = CREW.speed): void {
  let remaining = speed * dt;
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

function makeCrew(role: CrewRole, mobile: boolean, homeModule: number, pos: { x: number; y: number; z: number }, who?: { id: number; name: string; lv: number }): Crew {
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
    roomVersion: -1,
    destRoom: -1,
    task: mobile ? 'idle' : 'atPost',
    orphaned: false,
    dead: false,
    dangerTime: 0,
    suited: false,
    wanderCooldown: 0,
    orphanTime: 0,
    dash: false,
    seat: 0,
    incident: null,
    workTime: 0,
    memberId: who ? who.id : null,
    name: who ? who.name : '',
    level: who ? who.lv : 1,
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

/**
 * The crew of a ship. With `duty` (the roster's people on this ship) each post gets the person
 * posted to it and each engineer place a named engineer; a post nobody is posted to stays empty.
 * Without it (the old anonymous crew, for tests): one crew per combat post (the first bridge is the
 * primary helm, any further bridge starts empty as a reserve post), plus a handful of engineers.
 */
export function spawnCrew(grid: ShipGrid, duty?: Array<{ id: number; name: string; lv: number; role: CrewRole; post: number | null }>): Crew[] {
  const posts = findPosts(grid);
  const crew: Crew[] = [];
  let pilotAssigned = false;
  for (const post of posts) {
    if (post.role === 'pilot') {
      if (pilotAssigned) continue; // reserve post — starts empty
      pilotAssigned = true;
    }
    const who = duty ? duty.find((d) => d.role === post.role && d.post === grid.modules[post.moduleId].key) : undefined;
    if (duty && !who) continue;
    crew.push(makeCrew(post.role, false, post.moduleId, moduleCore(grid, post.moduleId), who));
  }
  // Roaming engineers: one for every three posts, and the quarters' places on top (modules of the pool carry their level).
  const reactorModule = grid.modules.findIndex((m) => m.kind === 'reactor');
  const spawnAt = reactorModule >= 0 ? moduleCore(grid, reactorModule) : { x: grid.width / 2, y: grid.height / 2, z: 1 };
  if (duty) {
    for (const d of duty) if (d.role === 'engineer') crew.push(makeCrew('engineer', true, -1, spawnAt, d));
  } else {
    const engineerCount = Math.max(1, Math.round(posts.length / 3)) + crewPlaces(grid.modules);
    for (let i = 0; i < engineerCount; i++) crew.push(makeCrew('engineer', true, -1, spawnAt));
  }
  return crew;
}

function targetRoomForStationary(grid: ShipGrid, graph: RoomGraph, crew: Crew): number | null {
  const module = grid.modules[crew.homeModule];
  if (moduleEfficiency(module) <= 0) return null; // orphaned — caller looks for a reserve post instead
  const core = moduleCore(grid, crew.homeModule);
  return roomIdAt(grid, graph, core.x + 0.5, core.y + 0.5, core.z);
}

/** Everything the decisions of one tick share. */
interface Ctx {
  world: World;
  grid: ShipGrid;
  graph: RoomGraph;
  crew: Crew[];
  rng: () => number;
}

/** Hop distances over the room graph from one room (Infinity where unreachable). */
function hopsFrom(graph: RoomGraph, from: number, throughUnsafe = false): number[] {
  const dist = new Array<number>(graph.rooms.length).fill(Infinity);
  if (from < 0 || from >= dist.length) return dist;
  dist[from] = 0;
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (!throughUnsafe && cur !== from && hazard(graph.rooms[cur])) continue; // a way does not lead through an unsafe room
    for (const edge of graph.edges) {
      if (edge.a !== cur && edge.b !== cur) continue;
      if (edgeLocked(graph.grid, edge)) continue;
      const next = edge.a === cur ? edge.b : edge.a;
      if (dist[next] !== Infinity) continue;
      dist[next] = dist[cur] + 1;
      queue.push(next);
    }
  }
  return dist;
}

/**
 * The nearest free post of the same kind for someone whose own was blown away: counted in rooms to
 * walk through from where they stand, only among modules that still work and sit in a room that is
 * not unsafe. Null when there is none, and then they just wander.
 */
function findNearestFreePost(ctx: Ctx, crew: Crew, from: number, risky = false): number | null {
  const { grid, graph } = ctx;
  const wantKind = crew.role === 'pilot' ? 'bridge' : crew.role === 'gunner' ? 'turret' : crew.role === 'shieldop' ? 'shield' : null;
  if (!wantKind) return null;
  const dist = hopsFrom(graph, from, risky);
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < grid.modules.length; i++) {
    const m = grid.modules[i];
    if (m.kind !== wantKind || moduleEfficiency(m) <= 0) continue;
    if (ctx.crew.some((c) => !c.dead && c.role === crew.role && c.homeModule === i)) continue; // already taken
    const core = moduleCore(grid, i);
    const r = roomNearPoint(grid, graph, core.x + 0.5, core.y + 0.5, core.z);
    if (r >= 0 && hazard(graph.rooms[r])) continue;
    let d: number;
    if (from >= 0 && r >= 0) d = dist[r];
    else if (core.z === crew.z) d = Math.hypot(core.x + 0.5 - crew.x, core.y + 0.5 - crew.y); // the open deck has no rooms: by the way over it
    else continue;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Sends the nearest free engineer to each room in trouble — one to a breach or a small fire, two to
 * a big fire or a wide hole — and nobody else: the rest of the engineers keep to their rounds.
 * An engineer keeps their call until the room is out of trouble.
 */
function dispatchEngineers(ctx: Ctx): void {
  const { graph, crew } = ctx;
  const engineers = crew.filter((c) => !c.dead && c.role === 'engineer' && c.task !== 'ejected');
  for (const e of engineers) {
    if (e.incident !== null) {
      const room = graph.rooms[e.incident];
      if (!room || !needsHelp(room)) e.incident = null;
    }
  }
  const trouble = graph.rooms.filter(needsHelp).sort((a, b) => b.fire + b.holes * 0.1 - (a.fire + a.holes * 0.1));
  for (const room of trouble) {
    const want = room.fire > 0.5 || room.holes >= 4 ? 2 : 1;
    let have = engineers.filter((e) => e.incident === room.id).length;
    if (have >= want) continue;
    const dist = hopsFrom(graph, room.id);
    while (have < want) {
      let best: Crew | null = null;
      let bestD = Infinity;
      for (const e of engineers) {
        if (e.incident !== null) continue;
        const at = currentRoom(ctx.grid, graph, e);
        const d = at >= 0 ? dist[at] : Infinity;
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (!best || bestD === Infinity) break;
      best.incident = room.id;
      best.destRoom = -1;
      best.waypoints = [];
      have++;
    }
  }
}

/** Standing in a doorway or on a ladder with nowhere to go: take a step into the room we came from. */
function stepIntoRoom(ctx: Ctx, crew: Crew, roomId: number): boolean {
  const room = ctx.graph.rooms[roomId];
  if (!room || room.cells.length === 0) return false;
  let best = -1;
  let bestD = Infinity;
  for (const i of room.cells) {
    if (!standable(ctx.grid, i)) continue;
    const d = Math.hypot(ctx.grid.xOf(i) + 0.5 - crew.x, ctx.grid.yOf(i) + 0.5 - crew.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return false; // nowhere to step (a ladder shaft)
  crew.waypoints = refineRoute(ctx.grid, { x: crew.x, y: crew.y, z: crew.z }, [{ x: ctx.grid.xOf(best) + 0.5, y: ctx.grid.yOf(best) + 0.5, z: room.z }]);
  crew.destRoom = -1;
  return true;
}

/** Runs from a room that is not safe to the nearest one that is. */
function flee(ctx: Ctx, crew: Crew, cur: number): void {
  const safe = bfsNearest(ctx.graph, cur, (r) => !hazard(r) && hasFloor(ctx.grid, r));
  if (safe !== null && safe !== cur && crew.destRoom !== safe) {
    crew.waypoints = buildRoute(ctx.grid, ctx.graph, cur, safe, crew, false);
    crew.destRoom = safe;
  }
  crew.task = 'flee';
}

/**
 * Walking about with nothing to do. Engineers spread out: they pick the room farthest from the
 * other engineers, so a call is always answered by someone near. Everyone else just wanders, mostly
 * about the room they are in and now and then to another one. Never into a room that is not safe.
 */
function roam(ctx: Ctx, crew: Crew, cur: number, dt: number, spread: boolean): void {
  crew.task = 'wander';
  crew.destRoom = -1;
  if (crew.waypoints.length > 0) return;
  if (crew.wanderCooldown > 0) {
    crew.wanderCooldown -= dt;
    return;
  }
  const { graph, grid, rng } = ctx;
  const room = graph.rooms[cur];
  if (!room || (crew.z === 0 && roomIdAt(grid, graph, crew.x, crew.y, crew.z) < 0)) {
    // on the open deck, which has no rooms: a stroll over the plating nearby
    crew.wanderCooldown = 2 + rng() * 4;
    for (let k = 0; k < 8; k++) {
      const tx = Math.floor(crew.x + (rng() - 0.5) * 12);
      const ty = Math.floor(crew.y + (rng() - 0.5) * 12);
      if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
      if (!standable(grid, grid.idx(tx, ty, crew.z))) continue;
      crew.waypoints = refineRoute(grid, { x: crew.x, y: crew.y, z: crew.z }, [{ x: tx + 0.5, y: ty + 0.5, z: crew.z }]);
      return;
    }
    return;
  }
  crew.wanderCooldown = 2 + rng() * 4;
  const dist = hopsFrom(graph, cur);
  const candidates = graph.rooms.filter((r) => r.cells.length > 0 && !hazard(r) && hasFloor(grid, r) && dist[r.id] !== Infinity);
  let target: Room = room;
  if (spread) {
    const others = ctx.crew.filter((c) => !c.dead && c !== crew && c.role === 'engineer').map((c) => (c.destRoom >= 0 ? c.destRoom : currentRoom(grid, graph, c)));
    let bestScore = -Infinity;
    for (let k = 0; k < 4 && candidates.length; k++) {
      const r = candidates[Math.floor(rng() * candidates.length)];
      const d = hopsFrom(graph, r.id);
      let near = Infinity;
      for (const o of others) if (o >= 0) near = Math.min(near, d[o]);
      const score = (near === Infinity ? 6 : near) + rng() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        target = r;
      }
    }
  } else if (candidates.length > 0 && rng() < 0.45) target = candidates[Math.floor(rng() * candidates.length)];
  if (target.id !== cur) {
    crew.waypoints = buildRoute(grid, graph, cur, target.id, crew);
    crew.destRoom = target.id;
    return;
  }
  const floor = room.cells.filter((i) => standable(grid, i));
  if (floor.length === 0) return;
  const cell = floor[Math.floor(rng() * floor.length)];
  crew.waypoints = refineRoute(grid, { x: crew.x, y: crew.y, z: crew.z }, [{ x: grid.xOf(cell) + 0.5, y: grid.yOf(cell) + 0.5, z: room.z }]);
}

function decideStationary(ctx: Ctx, crew: Crew, dt: number): void {
  const { grid, graph } = ctx;
  const curId = currentRoom(grid, graph, crew);
  // a spot in no room (a turret on the open deck) goes on from the nearest room
  const here = curId >= 0 ? curId : roomNearPoint(grid, graph, crew.x, crew.y, crew.z);
  // In a doorway or on a ladder: finish the walk we are on, never re-plan from a cached room.
  if (inTransit(grid, crew)) {
    // (in a shaft with no floor to step onto, decide like anyone else)
    if (crew.waypoints.length > 0 || stepIntoRoom(ctx, crew, here)) return;
  }
  const room = graph.rooms[curId] ?? null;

  // Personal safety always comes first, whether or not there's a post to worry about (a dash for a spare post is the one exception)
  if (hazard(room) && !(crew.dash && crew.waypoints.length > 0)) {
    crew.dash = false;
    flee(ctx, crew, curId);
    return;
  }

  if (crew.orphaned) {
    let spare = findNearestFreePost(ctx, crew, here);
    crew.dash = false;
    if (spare === null) {
      crew.orphanTime += dt;
      // no safe way to a spare post for a long while: risk the unsafe one
      if (crew.orphanTime >= CREW.dashAfter) {
        spare = findNearestFreePost(ctx, crew, here, true);
        crew.dash = spare !== null;
      }
    }
    if (spare !== null) {
      crew.orphanTime = 0;
      crew.destRoom = -1;
      crew.homeModule = spare;
      crew.orphaned = false;
      const post = grid.modules[spare];
      crew.seat = post.pool === 'helm' ? effectValue('helm', levelOf(post)) : 0;
    } else {
      roam(ctx, crew, here, dt, false);
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

  const targetRoom = targetRoomForStationary(grid, graph, crew);
  if (targetRoom === null) return; // post just got destroyed this tick; orphan handling kicks in next tick
  if (targetRoom < 0) {
    // the post is in no room (a turret): it is reached on foot, straight to its core
    const core = moduleCore(grid, crew.homeModule);
    const tx = core.x + 0.5;
    const ty = core.y + 0.5;
    if (core.z === crew.z && Math.hypot(crew.x - tx, crew.y - ty) < 1.5) {
      crew.waypoints = [];
      crew.destRoom = -1;
      crew.task = 'atPost';
      return;
    }
    if (crew.waypoints.length === 0 || crew.destRoom !== -2) {
      crew.waypoints = buildRouteToPoint(grid, graph, here, crew, { x: tx, y: ty, z: core.z });
      crew.destRoom = -2;
    }
    crew.task = 'toPost';
    return;
  }
  if (here === targetRoom) {
    crew.waypoints = [];
    crew.destRoom = -1;
    crew.dash = false;
    crew.task = 'atPost';
    return;
  }
  // The post's room is not safe yet: wait where it is safe instead of walking back into it.
  if (hazard(graph.rooms[targetRoom] ?? null)) {
    roam(ctx, crew, here, dt, false);
    return;
  }
  if (crew.destRoom !== targetRoom) {
    crew.waypoints = buildRoute(grid, graph, here, targetRoom, crew, !crew.dash);
    crew.destRoom = targetRoom;
    if (crew.waypoints.length === 0) {
      // no safe way there just now: wait about, and look again
      crew.destRoom = -1;
      roam(ctx, crew, here, dt, false);
      return;
    }
  }
  crew.task = 'toPost';
}

function decideEngineer(ctx: Ctx, crew: Crew, dt: number): void {
  const { grid, graph } = ctx;
  const cached = currentRoom(grid, graph, crew);
  const curId = cached >= 0 ? cached : roomNearPoint(grid, graph, crew.x, crew.y, crew.z);
  if (inTransit(grid, crew)) {
    if (crew.waypoints.length > 0 || stepIntoRoom(ctx, crew, curId)) return;
  }
  if (crew.incident !== null) {
    const room = graph.rooms[crew.incident];
    if (!room) {
      crew.incident = null;
    } else if (curId === crew.incident) {
      // in the room: no need to reach its middle, the work starts here
      crew.waypoints = [];
      crew.destRoom = -1;
      crew.task = room.fire > 0 ? 'extinguish' : 'seal';
      return;
    } else {
      if (crew.destRoom !== crew.incident) {
        crew.waypoints = buildRoute(grid, graph, curId, crew.incident, crew);
        crew.destRoom = crew.incident;
        if (crew.waypoints.length === 0) {
          // no safe way to the trouble just now: stay on the round, and look again
          crew.destRoom = -1;
          roam(ctx, crew, curId, dt, true);
          return;
        }
      }
      crew.task = 'toPost';
      return;
    }
  }
  // No call: an engineer in a room that has become unsafe gets out of it, otherwise walks their round.
  if (hazard(graph.rooms[curId] ?? null)) {
    flee(ctx, crew, curId);
    return;
  }
  roam(ctx, crew, curId, dt, true);
}

export function updateCrew(world: World, body: GridBody, dt: number): void {
  const sys = body.sys;
  if (!sys || !sys.crew) return;
  const graph = ensureRooms(body);
  const grid = body.grid;

  for (const room of graph.rooms) {
    room.sealing = false;
    room.firefighting = false;
  }

  const rescue = shipEffects(grid).rescue;
  const ctx: Ctx = { world, grid, graph, crew: sys.crew, rng: world.rng };
  dispatchEngineers(ctx);
  for (const crew of sys.crew) {
    if (crew.dead) continue;

    if (crew.task === 'ejected') {
      moveAlong(crew, dt, CREW.ejectSpeed);
      if (crew.waypoints.length === 0) {
        crew.dead = true;
        const wp = body.localToWorld(crew.x, crew.y, { x: 0, y: 0 });
        world.push({ t: 'crewLost', x: wp.x, y: wp.y });
      }
      continue;
    }

    if (crew.role === 'engineer') decideEngineer(ctx, crew, dt);
    else decideStationary(ctx, crew, dt);

    // people run when they flee or answer a call
    moveAlong(crew, dt, crew.task === 'flee' || (crew.incident !== null && crew.task === 'toPost') ? CREW.speed * CREW.runBoost : CREW.speed);
    if (crew.task === 'atPost' && crew.seat > 0) crew.seat = Math.max(0, crew.seat - dt);

    const roomId = currentRoom(grid, graph, crew);
    const room = roomId >= 0 ? graph.rooms[roomId] : null;

    if (crew.waypoints.length === 0 && room && crew.task === 'seal') {
      room.sealing = true;
      // the work done, the patch holds without them (until a new hole is made)
      crew.workTime += dt;
      if (crew.workTime >= CREW.sealTime) {
        room.patched = true;
        room.patchHoles = room.holes;
      }
    } else if (crew.waypoints.length === 0 && room && crew.task === 'extinguish') {
      room.firefighting = true;
      crew.workTime = 0;
    } else crew.workTime = 0;

    // Standing in a cell that's destroyed out from under them is fatal outright,
    // regardless of role or task — this is what "died inside the wrecked module" means.
    const xi = Math.floor(crew.x);
    const yi = Math.floor(crew.y);
    if (xi < 0 || yi < 0 || xi >= grid.width || yi >= grid.height || grid.mat[grid.idx(xi, yi, crew.z)] === 0) {
      // A medical bay may get them out: the survivor lands on the nearest cell of the deck still standing.
      if (world.rng() < rescue && rescueTo(crew, grid)) continue;
      crew.dead = true;
      continue;
    }

    // A hull breach doesn't just make a room unpleasant — while it's actively venting,
    // anyone without a suit risks being pulled out through the breach and lost, same as
    // a real decompression accident. Rolled per tick rather than at a fixed instant so
    // someone who reacts immediately has a real chance to reach safety before the dice
    // catch up with them. Engineers are exempt entirely: they only ever enter a
    // dangerous room deliberately, responding to exactly this kind of emergency (see
    // needsHelp/decideEngineer) — dying en route before they even get a chance to help,
    // through no fault of their own, made every rescue attempt a coin flip against the
    // room simply finishing its own vent first. A civilian caught in the same room
    // without that training or purpose still isn't so lucky.
    if (!crew.suited && crew.role !== 'engineer' && room && room.holes > 0 && !room.patched && room.pressure < CREW.dangerPressure && world.rng() < CREW.ejectChance * (crew.dash ? CREW.dashEjectFactor : 1) * dt) {
      beginEjection(crew, grid, room);
      continue;
    }

    if (isDangerousFire(room)) {
      crew.dangerTime += dt;
      if (crew.dangerTime > CREW.deathTime) crew.dead = true;
    } else {
      crew.dangerTime = 0;
    }
  }
}

/** Moves a crew member whose cell was destroyed to the nearest cell of the same deck that still stands; false if there is none near. */
function rescueTo(crew: Crew, grid: ShipGrid): boolean {
  const cx = Math.floor(crew.x);
  const cy = Math.floor(crew.y);
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
        const m = grid.mat[grid.idx(x, y, crew.z)];
        if (m === 0 || m === Mat.WALL || m === Mat.DOOR) continue;
        crew.x = x + 0.5;
        crew.y = y + 0.5;
        crew.waypoints = [];
        crew.roomId = -1;
        crew.roomVersion = -1;
        crew.destRoom = -1;
        crew.task = 'idle';
        return true;
      }
    }
  }
  return false;
}

export function pilotAvailable(body: GridBody): boolean {
  const crew = body.sys?.crew;
  if (!crew) return true;
  const hasBridge = body.grid.modules.some((m) => m.kind === 'bridge');
  if (!hasBridge) return true;
  return crew.some((c) => c.role === 'pilot' && !c.dead && c.task === 'atPost' && c.seat <= 0);
}

export function crewOnDeck(crew: Crew[], z: number): Crew[] {
  return crew.filter((c) => !c.dead && c.z === z);
}

/**
 * Counterpart to remapRoomGraph: translates crew positions into a cropped grid's local
 * coordinates after a hull fragmentation split. Crew whose position falls outside the
 * new grid (they were on the piece that broke away) are lost with it.
 *
 * `moduleMap` maps each module index in the *old* grid to its index in this new
 * (cropped) grid, or -1 if that module has no surviving cells on this piece —
 * extractComponent() in fragment.ts rebuilds `grid.modules` from scratch per piece, in
 * whatever order it finds surviving modules, which essentially never matches the old
 * indices once even one earlier module lost every cell on this side of the break.
 * `homeModule` is a raw index into that array, so leaving it unmapped anywhere a crew
 * member's own module (or bridge module, for a pilot who's off elsewhere) got split
 * differently than expected left it pointing at the wrong module, or past the end of
 * the new (usually shorter) array — moduleEfficiency() would then throw reading
 * `coreAlive` off undefined the next time this crew member's post was checked. A
 * post that didn't survive in this piece orphans its crew instead, same as if it had
 * simply been destroyed.
 */
export function remapCrew(crew: Crew[], newGrid: ShipGrid, offsetX: number, offsetY: number, moduleMap: number[]): Crew[] {
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
    c.roomVersion = -1;
    c.destRoom = -1;
    c.incident = null;
    c.workTime = 0;
    c.dash = false;
    if (!c.mobile) {
      const mapped = c.homeModule >= 0 && c.homeModule < moduleMap.length ? moduleMap[c.homeModule] : -1;
      if (mapped >= 0) {
        c.homeModule = mapped;
      } else {
        c.homeModule = -1;
        c.orphaned = true;
        c.task = 'idle';
      }
    }
    out.push(c);
  }
  return out;
}
