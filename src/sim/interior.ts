import { ShipGrid, type ModuleKind, type ModuleOptions } from './grid';
import { paintDeck } from './interiorArt';
import {
  K,
  cloneLayout,
  defaultLayout,
  layoutFits,
  makeDeckGeo,
  planDeck,
  type DeckEnt,
  type DeckGeo,
  type DeckPlan,
  type PlacedLadder,
  type PlacedModule,
  type ShipLayout,
} from './layout';
import { levelOf } from './levels';
import { savedLayout } from './layoutStore';
import { Mat } from './materials';

/**
 * Turns a ship's layout (layout.ts) into cells: the hull and its drives, turrets and
 * nozzles stay as the yard built them, and the decks are rebuilt from the player's plan —
 * the outer wall, every room's wall, doors, corridors, ladders, and in each module the
 * cells that make it work (the reactor's core, the helm's consoles, the shield's emitter).
 */

/** What the systems modules do, per ship: the figures the yard's own builders used. */
const SYSTEMS: Record<string, { power: number; capacity: number; blast: number; shield: number; regen: number }> = {
  fighter: { power: 30, capacity: 140, blast: 46, shield: 180, regen: 20 },
  cruiser: { power: 55, capacity: 260, blast: 60, shield: 420, regen: 35 },
  battleship: { power: 110, capacity: 600, blast: 70, shield: 900, regen: 60 },
};

type Cell = [number, number, number];

/**
 * The yard's ship without its interior: the hull layer and every module that lives on it
 * (drives, nozzles, turrets) as they were, and the decks as bare floor where the yard had
 * any cell at all.
 */
export function stripInterior(src: ShipGrid): ShipGrid {
  const dst = new ShipGrid(src.width, src.height, src.depth);
  for (let z = 0; z < src.depth; z++) {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = src.idx(x, y, z);
        if (src.mat[i] === 0) continue;
        if (z === 0) dst.copyCellFrom(src, i, x, y, 0);
        else dst.setCell(x, y, z, Mat.DECK);
      }
    }
  }
  for (const m of src.modules) {
    if (m.cells.some((c) => src.zOf(c) !== 0)) continue; // lived inside: the layout brings its own
    const cells: Cell[] = m.cells.map((c) => [src.xOf(c), src.yOf(c), 0]);
    const opts: ModuleOptions = {
      core: [src.xOf(m.core), src.yOf(m.core), 0],
      thrust: m.thrust,
      rcs: m.rcs,
      dirX: m.dirX,
      dirY: m.dirY,
      drive: m.drive,
      spoolUp: m.spoolUp,
      spoolDown: m.spoolDown,
      weapon: m.weapon,
      power: m.power,
      capacity: m.capacity,
      blast: m.blast,
      shieldMax: m.shieldMax,
      regen: m.regen,
    };
    dst.addModule(m.kind, cells, opts);
  }
  return dst;
}

interface InnerRect {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

function inner(e: DeckEnt): InnerRect {
  return { x0: e.r.x0 + 1, y0: e.r.y0 + 1, w: e.r.x1 - e.r.x0 - 1, h: e.r.y1 - e.r.y0 - 1 };
}

/** A centred block of cells inside a room's interior. */
function centred(r: InnerRect, w: number, h: number, dy = 0): Cell[] {
  const x0 = r.x0 + Math.floor((r.w - w) / 2);
  const y0 = r.y0 + Math.floor((r.h - h) / 2) + dy;
  const out: Cell[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y, 0]);
  return out;
}

/** The cells that make a module work, as (x, y) in the room, and the material they are made of. */
function systemCells(e: DeckEnt, z: number): { mat: number; kind: ModuleKind; cells: Cell[] } {
  const r = inner(e);
  const type = e.type;
  if (type === 'core') {
    const side = Math.max(2, Math.round(Math.min(r.w, r.h) * 0.4));
    return { mat: Mat.REACTOR, kind: 'reactor', cells: centred(r, side, side).map(([x, y]) => [x, y, z]) };
  }
  if (type === 'bridge') {
    const w = Math.max(3, Math.min(7, r.w - 3));
    const h = Math.max(2, Math.min(5, Math.round(r.h * 0.4)));
    return { mat: Mat.BRIDGE, kind: 'bridge', cells: centred(r, w, h, Math.round(r.h * 0.12)).map(([x, y]) => [x, y, z]) };
  }
  if (type === 'shield') {
    const side = r.w >= 16 ? 3 : 2;
    return { mat: Mat.SHIELDGEN, kind: 'shield', cells: centred(r, side, side).map(([x, y]) => [x, y, z]) };
  }
  if (type === 'helm') return { mat: Mat.BRIDGE, kind: 'bridge', cells: centred(r, 3, 2, 1).map(([x, y]) => [x, y, z]) };
  return { mat: Mat.MODULE, kind: 'generic', cells: centred(r, 2, 2).map(([x, y]) => [x, y, z]) };
}

/** Rebuilds the decks of `grid` (a hull from `stripInterior`) from the layout. */
export function applyLayout(grid: ShipGrid, geo: DeckGeo, layout: ShipLayout, shipId: string): DeckPlan[] {
  const w = geo.w;
  const h = geo.h;
  const plans: DeckPlan[] = [];
  for (let z = 1; z < geo.depth; z++) {
    const plan = planDeck(geo, layout, z);
    plans[z] = plan;
    const px = paintDeck(plan, w, h);
    for (let idx = 0; idx < w * h; idx++) {
      const kd = plan.kind[idx];
      if (kd === K.OUT) continue;
      const x = idx % w;
      const y = (idx - x) / w;
      if (kd === K.DOOR) grid.addDoor(x, y, z);
      else if (kd === K.HULL || kd === K.MWALL || kd === K.FENCE) grid.setCell(x, y, z, Mat.WALL);
      else grid.setCell(x, y, z, Mat.DECK);
      grid.setPaint(grid.idx(x, y, z), px[idx * 4], px[idx * 4 + 1], px[idx * 4 + 2], false);
    }
  }
  // Ladders: the whole 3×3 inside of the shaft, on both decks it joins.
  for (const l of layout.lads) {
    for (const z of [l.z0, l.z0 + 1]) {
      for (let y = l.y + 1; y <= l.y + 3; y++) for (let x = l.x + 1; x <= l.x + 3; x++) grid.setCell(x, y, z, Mat.LADDER);
    }
  }
  // Modules: the cells that make them work, then the module records — the primary
  // helm first (the crew assigns the pilot to the first bridge), reserve helms last.
  const sys = SYSTEMS[shipId] ?? SYSTEMS.fighter;
  const order = (m: PlacedModule): number => (m.type === 'bridge' ? 0 : m.type === 'helm' ? 2 : 1);
  const mods = [...layout.mods].sort((a, b) => order(a) - order(b));
  for (const q of mods) {
    const plan = plans[q.deck];
    const e = plan.ents.find((en) => en.ref === q);
    if (!e) continue;
    const s = systemCells(e, q.deck);
    for (const [x, y, z] of s.cells) grid.setCell(x, y, z, s.mat);
    const core = s.cells[Math.floor(s.cells.length / 2)];
    const opts: ModuleOptions = { core };
    if (s.kind === 'reactor') Object.assign(opts, { power: sys.power, capacity: sys.capacity, blast: sys.blast });
    else if (s.kind === 'shield') Object.assign(opts, { shieldMax: sys.shield, regen: sys.regen });
    opts.lv = levelOf(q);
    if (s.kind === 'generic') opts.pool = q.type;
    grid.addModule(s.kind, s.cells, opts);
  }
  return plans;
}

// ------------------------------------------------------------------ the player's ships

const geos = new Map<string, DeckGeo>();
const defaults = new Map<string, ShipLayout>();

/** Where the decks are on this ship, found from the yard's own hull (once). */
export function deckGeo(shipId: string, yard: () => ShipGrid): DeckGeo {
  let g = geos.get(shipId);
  if (!g) {
    const ship = yard();
    g = makeDeckGeo(shipId, ship.width, ship.height, ship.depth, (x, y, z) => ship.mat[ship.idx(x, y, z)] !== 0);
    geos.set(shipId, g);
  }
  return g;
}

export function yardLayout(shipId: string, geo: DeckGeo): ShipLayout {
  let l = defaults.get(shipId);
  if (!l) {
    l = defaultLayout(geo);
    defaults.set(shipId, l);
  }
  return cloneLayout(l);
}

/** The layout the player has saved for this ship if it still fits, else the one from the yard. */
export function currentLayout(shipId: string, geo: DeckGeo): ShipLayout {
  const s = savedLayout(shipId);
  if (s && layoutFits(geo, s)) return cloneLayout(s);
  return yardLayout(shipId, geo);
}

/** The ship the player flies: the yard's hull with the interior of the saved (or default) layout. */
export function buildPlayerShip(shipId: string, yard: () => ShipGrid, layout?: ShipLayout): ShipGrid {
  const legacy = yard();
  let geo = geos.get(shipId);
  if (!geo) {
    geo = makeDeckGeo(shipId, legacy.width, legacy.height, legacy.depth, (x, y, z) => legacy.mat[legacy.idx(x, y, z)] !== 0);
    geos.set(shipId, geo);
  }
  const hull = stripInterior(legacy);
  applyLayout(hull, geo, layout ?? currentLayout(shipId, geo), shipId);
  // The yard sized every drive to the old interior's mass: scale so the ship keeps its acceleration.
  const k = legacy.mass > 0 ? hull.mass / legacy.mass : 1;
  for (const m of hull.modules) {
    m.thrust *= k;
    m.rcs *= k;
  }
  return hull;
}

export type { PlacedLadder };
