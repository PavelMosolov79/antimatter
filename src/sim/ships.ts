import { ShipGrid, type WeaponState, type WeaponType } from './grid';
import { buildBattleshipArt } from './battleshipArt';
import { Mat } from './materials';

function addLadder(grid: ShipGrid, x: number, y: number, z0: number, z1: number): void {
  for (let z = z0; z <= z1; z++) {
    const i = grid.idx(x, y, z);
    if (grid.mat[i] === Mat.DECK) grid.setCell(x, y, z, Mat.LADDER);
  }
}

/**
 * Deckplan toolkit: rooms are carved as proper rectangular chambers with their own
 * walls on every side that needs one, connected by doors to a corridor or to each
 * other — not a single bulkhead line across the whole hull. Every helper here only
 * ever overwrites plain DECK cells, so it can never damage a module or double-wall
 * a boundary another room already sealed.
 */
function wallRowWindow(grid: ShipGrid, y: number, xa: number, xb: number, z: number, doorX?: number): void {
  const lo = Math.min(xa, xb);
  const hi = Math.max(xa, xb);
  for (let x = lo; x <= hi; x++) {
    const i = grid.idx(x, y, z);
    if (grid.mat[i] !== Mat.DECK) continue;
    if (x === doorX) grid.addDoor(x, y, z);
    else grid.setCell(x, y, z, Mat.WALL);
  }
}

function wallColWindow(grid: ShipGrid, x: number, ya: number, yb: number, z: number, doorY?: number): void {
  const lo = Math.min(ya, yb);
  const hi = Math.max(ya, yb);
  for (let y = lo; y <= hi; y++) {
    const i = grid.idx(x, y, z);
    if (grid.mat[i] !== Mat.DECK) continue;
    if (y === doorY) grid.addDoor(x, y, z);
    else grid.setCell(x, y, z, Mat.WALL);
  }
}

interface RoomSides {
  /** Wall this side, with a door at the given coordinate (x for n/s, y for e/w). Omit a side entirely to leave it open — typically because a neighboring room already sealed that boundary, or the hull itself bounds it there. */
  n?: number;
  s?: number;
  e?: number;
  w?: number;
}

/** Carves a rectangular room [x0,x1]x[y0,y1] at deck z, walling only the requested sides. */
function room(grid: ShipGrid, z: number, x0: number, x1: number, y0: number, y1: number, sides: RoomSides = {}): void {
  if (sides.n !== undefined) wallRowWindow(grid, y0, x0, x1, z, sides.n);
  if (sides.s !== undefined) wallRowWindow(grid, y1, x0, x1, z, sides.s);
  if (sides.w !== undefined) wallColWindow(grid, x0, y0, y1, z, sides.w);
  if (sides.e !== undefined) wallColWindow(grid, x1, y0, y1, z, sides.e);
}

type Profile = Array<[number, number]>;

function halfWidthAt(profile: Profile, y: number): number {
  if (y <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    const [y1, w1] = profile[i];
    const [y0, w0] = profile[i - 1];
    if (y <= y1) return y1 === y0 ? w1 : w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
  }
  return profile[profile.length - 1][1];
}

function edgeDistance(mask: Uint8Array, w: number, h: number): Uint8Array {
  const dist = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w];
    if (edge) {
      dist[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    const y = (i - x) / w;
    const d = dist[i] + 1;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const n of nb) {
      if (n >= 0 && mask[n] && dist[n] === 0) {
        dist[n] = Math.min(d, 255);
        queue.push(n);
      }
    }
  }
  return dist;
}

function hullShip(width: number, height: number, depth: number, profile: Profile): ShipGrid {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const hw = halfWidthAt(profile, y + 0.5);
    for (let x = 0; x < width; x++) {
      if (Math.abs(x + 0.5 - width / 2) <= hw) mask[y * width + x] = 1;
    }
  }
  const dist = edgeDistance(mask, width, height);
  const grid = new ShipGrid(width, height, depth);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = dist[y * width + x];
      if (d === 0) continue;
      grid.setCell(x, y, 0, d === 1 ? Mat.ARMOR : Mat.HULL);
      for (let z = 1; z < depth; z++) {
        if (d >= 2 * z + 1) grid.setCell(x, y, z, Mat.DECK);
      }
    }
  }
  return grid;
}

function addEngine(grid: ShipGrid, x0: number, y0: number, w: number, h: number): void {
  const cells: Array<[number, number, number]> = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!grid.isOccupied(x, y)) continue;
      grid.setCell(x, y, 0, Mat.ENGINE);
      cells.push([x, y, 0]);
    }
  }
  const core: [number, number, number] = [x0 + Math.floor(w / 2), y0 + Math.floor(h / 2), 0];
  grid.addModule('engine', cells, { core, dirX: 0, dirY: -1 });
}

function addBlock(grid: ShipGrid, x0: number, y0: number, w: number, h: number, z: number): void {
  const cells: Array<[number, number, number]> = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!grid.isOccupied(x, y)) continue;
      grid.setCell(x, y, z, Mat.MODULE);
      cells.push([x, y, z]);
    }
  }
  if (cells.length === 0) return;
  grid.addModule('generic', cells, { core: [x0 + Math.floor(w / 2), y0 + Math.floor(h / 2), z] });
}

/**
 * A pilot post. The first bridge module a ship's build function adds is its primary
 * helm — crew.ts assigns the starting pilot there. Any further bridge modules (e.g. a
 * console tucked into engineering) are reserve posts: empty until an orphaned pilot
 * needs somewhere else to fly the ship from.
 */
function addBridge(grid: ShipGrid, x0: number, y0: number, w: number, h: number, z: number): void {
  const cells: Array<[number, number, number]> = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!grid.isOccupied(x, y)) continue;
      grid.setCell(x, y, z, Mat.BRIDGE);
      cells.push([x, y, z]);
    }
  }
  if (cells.length === 0) return;
  grid.addModule('bridge', cells, { core: [x0 + Math.floor(w / 2), y0 + Math.floor(h / 2), z] });
}

function addThruster(grid: ShipGrid, x0: number, y0: number, dirX: number, dirY: number): boolean {
  const cells: Array<[number, number, number]> = [];
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      if (!grid.isOccupied(x0 + dx, y0 + dy)) return false;
      cells.push([x0 + dx, y0 + dy, 0]);
    }
  }
  for (const [x, y] of cells) grid.setCell(x, y, 0, Mat.THRUSTER);
  grid.addModule('thruster', cells, { core: cells[0], dirX, dirY });
  return true;
}

function topOccupied(grid: ShipGrid, x: number): number {
  for (let y = 0; y < grid.height; y++) if (grid.isOccupied(x, y)) return y;
  return -1;
}

function addNoseThruster(grid: ShipGrid, x0: number): void {
  const y0 = Math.max(topOccupied(grid, x0), topOccupied(grid, x0 + 1));
  addThruster(grid, x0, y0, 0, 1);
}

function addSideThruster(grid: ShipGrid, y0: number, side: 'left' | 'right'): void {
  const first = (y: number): number => {
    for (let x = 0; x < grid.width; x++) if (grid.isOccupied(x, y)) return x;
    return -1;
  };
  const last = (y: number): number => {
    for (let x = grid.width - 1; x >= 0; x--) if (grid.isOccupied(x, y)) return x;
    return -1;
  };
  if (side === 'left') addThruster(grid, Math.max(first(y0), first(y0 + 1)), y0, 1, 0);
  else addThruster(grid, Math.min(last(y0), last(y0 + 1)) - 1, y0, -1, 0);
}

interface Tuning {
  accel: number;
  rcsPerThrust: number;
  backShare: number;
  sideShare: number;
}

function tuneShip(grid: ShipGrid, t: Tuning): void {
  const engines = grid.modules.filter((m) => m.kind === 'engine');
  const totalCells = engines.reduce((s, m) => s + m.total, 0);
  const mainThrust = t.accel * grid.mass;
  for (const m of engines) {
    m.thrust = (mainThrust * m.total) / totalCells;
    m.rcs = m.thrust * t.rcsPerThrust;
  }
  const groups: Array<{ match: (dx: number, dy: number) => boolean; share: number }> = [
    { match: (_dx, dy) => dy > 0.5, share: t.backShare },
    { match: (dx) => dx > 0.5, share: t.sideShare },
    { match: (dx) => dx < -0.5, share: t.sideShare },
  ];
  for (const grp of groups) {
    const mods = grid.modules.filter((m) => m.kind === 'thruster' && grp.match(m.dirX, m.dirY));
    for (const m of mods) m.thrust = (mainThrust * grp.share) / mods.length;
  }
}

let nextWeaponId = 1;

const WEAPON_SHORT: Record<WeaponType, string> = { pulse: 'ИМП', heavy: 'ТЯЖ', beam: 'ЛУЧ' };

function addTurret(grid: ShipGrid, x0: number, y0: number, size: 2 | 3, type: WeaponType, arcCenter: number, arcHalf: number): void {
  const cells: Array<[number, number, number]> = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (!grid.isOccupied(x0 + dx, y0 + dy)) continue;
      grid.setCell(x0 + dx, y0 + dy, 0, Mat.TURRET);
      cells.push([x0 + dx, y0 + dy, 0]);
    }
  }
  if (cells.length === 0) return;
  const core: [number, number, number] = [x0 + Math.floor(size / 2), y0 + Math.floor(size / 2), 0];
  grid.addModule('turret', cells, { core, weapon: makeWeapon(grid, type, arcCenter, arcHalf) });
}

function makeWeapon(grid: ShipGrid, type: WeaponType, arcCenter: number, arcHalf: number): WeaponState {
  const count = grid.modules.filter((m) => m.weapon?.type === type).length + 1;
  return {
    id: nextWeaponId++,
    name: `${WEAPON_SHORT[type]}-${count}`,
    type,
    arcCenter,
    arcHalf,
    off: 0,
    cooldown: 0,
    enabled: true,
    target: null,
    firing: false,
  };
}

function addReactor(grid: ShipGrid, x0: number, y0: number, z: number, size: number, power: number, capacity: number, blast: number): void {
  const cells: Array<[number, number, number]> = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (!grid.isOccupied(x0 + dx, y0 + dy)) continue;
      grid.setCell(x0 + dx, y0 + dy, z, Mat.REACTOR);
      cells.push([x0 + dx, y0 + dy, z]);
    }
  }
  const core: [number, number, number] = [x0 + Math.floor(size / 2), y0 + Math.floor(size / 2), z];
  grid.addModule('reactor', cells, { core, power, capacity, blast });
}

function addShieldGen(grid: ShipGrid, x0: number, y0: number, z: number, shieldMax: number, regen: number): void {
  const cells: Array<[number, number, number]> = [];
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      if (!grid.isOccupied(x0 + dx, y0 + dy)) continue;
      grid.setCell(x0 + dx, y0 + dy, z, Mat.SHIELDGEN);
      cells.push([x0 + dx, y0 + dy, z]);
    }
  }
  grid.addModule('shield', cells, { core: cells[0], shieldMax, regen });
}

export interface ShipSpec {
  id: string;
  label: string;
  build: () => ShipGrid;
}

const FIGHTER_PROFILE: Array<[number, number]> = [
  [0, 0],
  [3, 1.5],
  [9, 3.5],
  [16, 5],
  [20, 6],
  [35, 15],
  [40, 15],
  [40.01, 7],
  [44, 6.5],
];

function fighterHull(): ShipGrid {
  const g = hullShip(31, 44, 3, FIGHTER_PROFILE);
  addEngine(g, 13, 40, 5, 4);
  addEngine(g, 4, 36, 3, 4);
  addEngine(g, 24, 36, 3, 4);
  addBridge(g, 13, 12, 5, 3, 1);
  addNoseThruster(g, 11);
  addNoseThruster(g, 18);
  for (const y of [22, 30]) {
    addSideThruster(g, y, 'left');
    addSideThruster(g, y, 'right');
  }
  return g;
}

export type FighterLoadout = 'strike' | 'raider' | 'hunter';

export function buildFighter(loadout: FighterLoadout = 'strike'): ShipGrid {
  const g = fighterHull();
  if (loadout === 'hunter') {
    addTurret(g, 14, 15, 3, 'beam', 0, 1.4);
    addTurret(g, 14, 31, 3, 'heavy', 0, 1.2);
  } else {
    addTurret(g, 12, 16, 2, 'pulse', -0.2, 1.75);
    addTurret(g, 17, 16, 2, 'pulse', 0.2, 1.75);
    addTurret(g, 14, 31, 3, 'heavy', 0, 1.2);
  }
  addReactor(g, 14, 25, 2, 3, 30, 140, 46);
  addShieldGen(g, 14, 20, 1, loadout === 'hunter' ? 120 : 180, 20);
  addBridge(g, 14, 21, 3, 2, 2); // reserve helm console in the engineering nook

  // Deck 1: bow → bridge (own room) → shield bay (own room) → a wide aft section split
  // into two bands of left/right cabins flanking the open central corridor.
  room(g, 1, 11, 19, 4, 16, { s: 15 });
  room(g, 1, 11, 19, 17, 23, { s: 15, w: -1, e: -1 });
  wallRowWindow(g, 23, 0, g.width - 1, 1); // full-width cap: no leaking around the chamber into the aft bands
  room(g, 1, 5, 12, 25, 30, { n: -1, s: -1, e: 27 });
  room(g, 1, 18, 25, 25, 30, { n: -1, s: -1, w: 27 });
  room(g, 1, 2, 12, 31, 37, { n: -1, s: -1, e: 34 });
  room(g, 1, 18, 28, 31, 37, { n: -1, s: -1, w: 34 });
  // Deck 2: bow → engineering nook → reactor closet (its own sealed room) → a wide
  // aft band with cabins either side of the corridor.
  room(g, 2, 11, 19, 11, 23, { s: 15 });
  room(g, 2, 11, 19, 24, 28, { s: 15, w: -1, e: -1 });
  wallRowWindow(g, 28, 0, g.width - 1, 2);
  room(g, 2, 4, 12, 29, 35, { n: -1, s: -1, e: 32 });
  room(g, 2, 18, 26, 29, 35, { n: -1, s: -1, w: 32 });
  addLadder(g, 15, 30, 1, 2);

  tuneShip(g, { accel: loadout === 'hunter' ? 32 : 30, rcsPerThrust: 10, backShare: 0.5, sideShare: 0.25 });
  return g;
}

export function buildCruiser(): ShipGrid {
  const g = hullShip(49, 76, 4, [
    [0, 0],
    [3, 2.5],
    [10, 6],
    [24, 11],
    [36, 15],
    [52, 22],
    [64, 22],
    [68, 20],
    [68.01, 10],
    [76, 9],
  ]);
  addEngine(g, 22, 70, 5, 6);
  addEngine(g, 17, 70, 3, 6);
  addEngine(g, 29, 70, 3, 6);
  addEngine(g, 6, 62, 3, 6);
  addEngine(g, 40, 62, 3, 6);
  addBridge(g, 21, 16, 7, 6, 1);
  addBlock(g, 10, 48, 6, 6, 1);
  addBlock(g, 33, 48, 6, 6, 1);
  for (const x0 of [15, 9]) {
    addNoseThruster(g, x0);
    addNoseThruster(g, 47 - x0);
  }
  for (const y of [30, 52]) {
    addSideThruster(g, y, 'left');
    addSideThruster(g, y, 'right');
  }
  addTurret(g, 18, 26, 3, 'heavy', -0.15, 1.2);
  addTurret(g, 28, 26, 3, 'heavy', 0.15, 1.2);
  addTurret(g, 15, 34, 2, 'pulse', -0.3, 1.75);
  addTurret(g, 32, 34, 2, 'pulse', 0.3, 1.75);
  addTurret(g, 11, 56, 2, 'pulse', Math.PI, 1.6);
  addTurret(g, 36, 56, 2, 'pulse', Math.PI, 1.6);
  addTurret(g, 23, 40, 3, 'beam', 0, 1.5);
  addReactor(g, 23, 44, 2, 3, 55, 260, 60);
  addShieldGen(g, 21, 50, 1, 420, 35);
  addShieldGen(g, 26, 50, 1, 0, 0);
  addBridge(g, 20, 56, 9, 6, 2); // reserve helm console in the aft engineering bay

  // Deck 1: bridge (own room) → three bands of port/starboard cabins flanking the open
  // spine corridor → port/starboard crew quarters either side of a sealed shield bay.
  room(g, 1, 16, 32, 2, 23, { s: 24 });
  room(g, 1, 14, 19, 24, 29, { n: -1, s: -1, e: 26 });
  room(g, 1, 30, 35, 24, 29, { n: -1, s: -1, w: 26 });
  room(g, 1, 11, 19, 30, 37, { n: -1, s: -1, e: 33 });
  room(g, 1, 30, 38, 30, 37, { n: -1, s: -1, w: 33 });
  room(g, 1, 7, 19, 38, 46, { n: -1, s: -1, e: 42 });
  room(g, 1, 30, 42, 38, 46, { n: -1, s: -1, w: 42 });
  room(g, 1, 9, 17, 47, 54, { n: -1, s: -1, e: 51 });
  room(g, 1, 31, 39, 47, 54, { n: -1, s: -1, w: 51 });
  room(g, 1, 20, 29, 49, 52, { n: 24, s: 24, w: -1, e: -1 });
  wallRowWindow(g, 49, 0, g.width - 1, 1);
  wallRowWindow(g, 52, 0, g.width - 1, 1);
  room(g, 1, 4, 17, 55, 59, { n: -1, s: -1, e: 57 });
  room(g, 1, 32, 44, 55, 59, { n: -1, s: -1, w: 57 });

  // Deck 2: open forward corridor with one pair of cabins → sealed reactor closet
  // (bypassable via the side corridors) → aft engineering bay.
  room(g, 2, 11, 19, 38, 42, { n: -1, s: -1, e: 40 });
  room(g, 2, 30, 37, 38, 42, { n: -1, s: -1, w: 40 });
  room(g, 2, 18, 31, 43, 49, { n: 24, s: 24, w: -1, e: -1 });
  wallRowWindow(g, 43, 0, g.width - 1, 2);
  wallRowWindow(g, 49, 0, g.width - 1, 2);
  room(g, 2, 18, 30, 55, 63, { n: 24, s: 24, w: -1, e: -1 });
  wallRowWindow(g, 55, 0, g.width - 1, 2);
  wallRowWindow(g, 63, 0, g.width - 1, 2);
  addLadder(g, 24, 30, 1, 2);
  addLadder(g, 24, 64, 2, 3);

  // Deck 3: empty hold, laid out the same way — bands of small rooms off the corridor.
  room(g, 3, 13, 19, 40, 50, { n: -1, s: -1, e: 45 });
  room(g, 3, 30, 36, 40, 50, { n: -1, s: -1, w: 45 });
  room(g, 3, 8, 19, 51, 61, { n: -1, s: -1, e: 56 });
  room(g, 3, 30, 40, 51, 61, { n: -1, s: -1, w: 56 });

  tuneShip(g, { accel: 18, rcsPerThrust: 20, backShare: 0.5, sideShare: 0.22 });
  return g;
}

/**
 * Wedge-hulled capital ship, built pixel-for-pixel from the approved concept art
 * (battleshipArt.ts): the drawing decides both what every cell looks like and what it
 * is — hull, wall, door, console, or part of which module. Hull plus two decks.
 * The manoeuvring thrusters aren't in the drawing; they sit hidden under the painted
 * hull at the nose and flanks, so the ship can still brake and turn.
 */
export function buildBattleship(): ShipGrid {
  const art = buildBattleshipArt();
  const g = new ShipGrid(art.w, art.h, art.layers.length);
  art.layers.forEach((layer, z) => {
    for (let y = 0; y < art.h; y++) {
      for (let x = 0; x < art.w; x++) {
        const li = y * art.w + x;
        const m = layer.mat[li];
        if (m === 0) continue;
        if (m === Mat.DOOR) g.addDoor(x, y, z);
        else g.setCell(x, y, z, m);
        g.setPaint(g.idx(x, y, z), layer.color[li * 3], layer.color[li * 3 + 1], layer.color[li * 3 + 2], layer.glow[li] !== 0);
      }
    }
  });

  const cx = art.w / 2;
  const turrets = art.modules.filter((m) => m.kind === 'turret');
  turrets.forEach((t, n) => {
    const [tx, ty] = t.core;
    // Forward third fires pulse cannons, middle third heavy guns, aft third beams; each
    // turret covers its own flank, swinging further aft the further back it sits.
    const type: WeaponType = ty < 70 ? 'pulse' : ty < 130 ? 'heavy' : 'beam';
    const side = Math.abs(tx + 0.5 - cx) < 4 ? 0 : Math.sign(tx + 0.5 - cx);
    const arcCenter = side === 0 ? (n % 2 === 0 ? 0 : Math.PI) : side * (0.35 + (1.9 * ty) / art.h);
    g.addModule('turret', t.cells, { core: t.core, weapon: makeWeapon(g, type, arcCenter, side === 0 ? 1.9 : 1.4) });
  });
  for (const e of art.modules.filter((m) => m.kind === 'engine')) g.addModule('engine', e.cells, { core: e.core, dirX: 0, dirY: -1 });
  for (const m of art.modules) {
    if (m.kind === 'bridge' && !m.reserve) g.addModule('bridge', m.cells, { core: m.core });
  }
  for (const m of art.modules) {
    if (m.kind === 'shield') g.addModule('shield', m.cells, { core: m.core, shieldMax: 900, regen: 60 });
    else if (m.kind === 'reactor') g.addModule('reactor', m.cells, { core: m.core, power: 110, capacity: 600, blast: 70 });
    else if (m.kind === 'generic') g.addModule('generic', m.cells, { core: m.core });
  }
  for (const m of art.modules) {
    if (m.kind === 'bridge' && m.reserve) g.addModule('bridge', m.cells, { core: m.core });
  }

  addNoseThruster(g, 64);
  for (const y of [65, 128, 150]) {
    addSideThruster(g, y, 'left');
    addSideThruster(g, y, 'right');
  }

  tuneShip(g, { accel: 12, rcsPerThrust: 30, backShare: 0.5, sideShare: 0.22 });
  return g;
}

export function buildScout(): ShipGrid {
  const g = hullShip(21, 28, 2, [
    [0, 0],
    [2, 1.2],
    [8, 3.5],
    [14, 5],
    [18, 8],
    [24, 9.5],
    [24.01, 5],
    [28, 4.5],
  ]);
  addEngine(g, 9, 24, 3, 4);
  addEngine(g, 2, 19, 2, 4);
  addEngine(g, 17, 19, 2, 4);
  addNoseThruster(g, 6);
  addNoseThruster(g, 13);
  for (const y of [13, 18]) {
    addSideThruster(g, y, 'left');
    addSideThruster(g, y, 'right');
  }
  addTurret(g, 9, 8, 2, 'pulse', 0, 1.9);
  addReactor(g, 9, 14, 1, 3, 20, 80, 30);
  addShieldGen(g, 9, 18, 1, 80, 12);
  tuneShip(g, { accel: 40, rcsPerThrust: 10, backShare: 0.5, sideShare: 0.25 });
  return g;
}

export function buildFreighter(): ShipGrid {
  const g = hullShip(26, 40, 3, [
    [0, 6],
    [4, 10],
    [8, 13],
    [32, 13],
    [36, 10],
    [40, 6],
  ]);
  addBlock(g, 8, 10, 10, 6, 1);
  addBlock(g, 8, 20, 10, 10, 1);
  addBlock(g, 10, 22, 6, 6, 2);
  return g;
}

export const SHIPS: ShipSpec[] = [
  { id: 'fighter', label: 'Истребитель', build: () => buildFighter('strike') },
  { id: 'cruiser', label: 'Крейсер', build: buildCruiser },
  { id: 'battleship', label: 'Линкор', build: buildBattleship },
];

export interface EnemySpec {
  id: string;
  label: string;
  ai: 'scout' | 'raider' | 'hunter';
  build: () => ShipGrid;
}

export const ENEMIES: EnemySpec[] = [
  { id: 'scout', label: 'Разведчик', ai: 'scout', build: buildScout },
  { id: 'raider', label: 'Налётчик', ai: 'raider', build: () => buildFighter('raider') },
  { id: 'hunter', label: 'Охотник за реактором', ai: 'hunter', build: () => buildFighter('hunter') },
];
