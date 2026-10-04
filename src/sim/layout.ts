/**
 * The interior of a ship as the player arranges it, as designed in «Концепт обшивки»
 * (the "Модули и системы" panel) and «Док Antimatter»: each deck is a black field
 * inside the hull's outer wall; modules are rooms of 10×10 cells (walls included) that sit
 * on a grid, and two modules side by side share ONE wall, with a door in it. Corridors are
 * drawn freely, and a 5×5 ladder joins two neighbouring decks.
 *
 * This file is pure geometry: where things may stand and what the walls and doors come out
 * as. `applyLayout` in ships.ts turns the result into real cells.
 */

export const TILE = 9; // grid pitch: neighbours overlap by one wall cell
export const FOOT = 10; // a module is 10×10 cells including its wall

export type BaseModuleId = 'core' | 'bridge' | 'shield';
export type PoolModuleId = 'gun' | 'eng' | 'rcs' | 'work' | 'med' | 'crew' | 'store' | 'helm' | 'pod';
export type ModuleId = BaseModuleId | PoolModuleId;

export interface ModuleInfo {
  name: string;
  kind: string;
  desc: string;
}

export const MODULE_INFO: Record<ModuleId | 'ladder', ModuleInfo> = {
  core: { name: 'Ядро корабля', kind: 'база', desc: 'Реактор: энергия и главный риск. Взрыв при разрушении, пока не заглушен.' },
  bridge: { name: 'Капитанский мостик', kind: 'база', desc: 'Пост основного пилота; отсюда корабль летит и воюет.' },
  shield: { name: 'Генератор щита', kind: 'база', desc: 'Купол щита и его перезарядка.' },
  gun: { name: 'Орудийный пост', kind: 'пост', desc: 'Управление орудиями. Орудия остаются на обшивке; без экипажа на посту они стреляют хуже.' },
  eng: { name: 'Инженерный пост', kind: 'пост', desc: 'Управление маршевыми двигателями и энергией. Экипаж на посту ускоряет раскрутку.' },
  rcs: { name: 'Манёвровый пост', kind: 'пост', desc: 'Управление манёвровыми и поворотными соплами; без него корабль хуже слушается руля.' },
  work: { name: 'Мастерская', kind: 'служба', desc: 'Экипаж чинит клетки быстрее, хранит запас деталей для ремонта.' },
  med: { name: 'Медотсек', kind: 'служба', desc: 'Лечение раненых космонавтов между боями и в бою.' },
  crew: { name: 'Кубрик', kind: 'служба', desc: 'Жильё экипажа: даёт места для космонавтов и отдых.' },
  store: { name: 'Склад', kind: 'служба', desc: 'Трюм для добычи и запасных деталей.' },
  helm: { name: 'Резервный пост пилота', kind: 'пост', desc: 'Запасной мостик: если капитанский разрушен, пилот пересаживается сюда.' },
  pod: { name: 'Спасательные капсулы', kind: 'служба', desc: 'Если корабль погибнет, экипаж уходит в капсулах: сколько мест и какой шанс спастись, зависит от уровня. Без капсул гибнут все.' },
  ladder: { name: 'Лестница', kind: 'проход', desc: 'Шахта 5×5 клеток между двумя соседними палубами. Космонавты ходят между палубами только по ней.' },
};

/** The modules the player can take from the pool, in the order the dock shows them. */
export const POOL: PoolModuleId[] = ['gun', 'eng', 'rcs', 'work', 'med', 'crew', 'store', 'helm', 'pod'];

export interface PlacedModule {
  id: number;
  type: ModuleId;
  deck: number;
  /** Grid position in tiles: the footprint starts at origin + TILE × (i, j). */
  i: number;
  j: number;
  tw: number;
  th: number;
  base: boolean;
  /** Upgrade level 1…5 (levels.ts); a module without one is level 1. */
  lv?: number;
}

/** A module taken off the deck with a level above the first: it waits in the pool as itself. */
export interface StockItem {
  id: number;
  type: PoolModuleId;
  lv: number;
}

export interface PlacedLadder {
  id: number;
  /** Top-left cell of the 5×5 shaft. */
  x: number;
  y: number;
  /** The upper of the two decks it joins; it also stands on z0 + 1. */
  z0: number;
}

export interface ShipLayout {
  mods: PlacedModule[];
  lads: PlacedLadder[];
  /** Corridor floor cells by deck, as grid cell indices (y × width + x). */
  corr: Record<number, number[]>;
  next: number;
  /** Upgraded modules put back in the pool. */
  stock?: StockItem[];
}

/** What every ship starts with, sized to the class: [type, tiles wide, tiles tall, deck, aim cell]. */
interface BaseSpec {
  type: BaseModuleId;
  tw: number;
  th: number;
  deck: number;
  aim: [number, number];
}

export const BASE_MODULES: Record<string, BaseSpec[]> = {
  fighter: [
    { type: 'bridge', tw: 1, th: 1, deck: 1, aim: [19.5, 25] },
    { type: 'shield', tw: 1, th: 1, deck: 1, aim: [19.5, 34] },
    { type: 'core', tw: 1, th: 1, deck: 2, aim: [19.5, 50] },
  ],
  cruiser: [
    { type: 'bridge', tw: 2, th: 1, deck: 1, aim: [24, 26] },
    { type: 'shield', tw: 1, th: 1, deck: 1, aim: [24, 50] },
    { type: 'core', tw: 2, th: 2, deck: 2, aim: [24, 52] },
  ],
  battleship: [
    { type: 'bridge', tw: 3, th: 2, deck: 1, aim: [65, 105] },
    { type: 'shield', tw: 2, th: 2, deck: 1, aim: [65, 70] },
    { type: 'core', tw: 3, th: 3, deck: 1, aim: [65, 148] },
  ],
};

/** Hand fixes to a deck's grid, where the best-fit shift leaves a module off-centre. */
const ORIGIN_FIX: Record<string, Record<number, { ox: number; oy: number }>> = {};

// ------------------------------------------------------------------ deck geometry

export interface DeckGeo {
  shipId: string;
  w: number;
  h: number;
  /** Number of layers: layer 0 is the hull, layers 1… are the decks. */
  depth: number;
  /** Per layer, 1 where the deck has a cell. */
  masks: Uint8Array[];
  org: Array<{ ox: number; oy: number }>;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function inMask(g: DeckGeo, z: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.w && y < g.h && g.masks[z][y * g.w + x] !== 0;
}

/**
 * The grid shift on one deck that fits the most 1×1 modules; on a tie the one that keeps
 * the same rows as the deck above, then the most symmetrical, then the most central.
 */
function bestOrigin(g: DeckGeo, z: number, prefOy: number): { ox: number; oy: number } {
  const pitch = TILE;
  const valid = (x0: number, y0: number): boolean => {
    for (let y = y0; y < y0 + FOOT; y++) for (let x = x0; x < x0 + FOOT; x++) if (!inMask(g, z, x, y)) return false;
    return true;
  };
  let best: { n: number; po: number; sym: number; cen: number; ox: number; oy: number } | null = null;
  for (let ox = 0; ox < pitch; ox++) {
    for (let oy = 0; oy < pitch; oy++) {
      let n = 0;
      let sym = 0;
      let cen = 0;
      for (let ty = -1; ty <= Math.ceil(g.h / pitch); ty++) {
        for (let tx = -1; tx <= Math.ceil(g.w / pitch); tx++) {
          const x0 = ox + tx * pitch;
          const y0 = oy + ty * pitch;
          if (!valid(x0, y0)) continue;
          n++;
          if (valid(g.w - FOOT - x0, y0)) sym++;
          cen += Math.abs(x0 + FOOT / 2 - g.w / 2);
        }
      }
      const po = oy === prefOy ? 1 : 0;
      const better =
        !best ||
        n > best.n ||
        (n === best.n && (po > best.po || (po === best.po && (sym > best.sym || (sym === best.sym && (cen < best.cen - 1e-9 || (Math.abs(cen - best.cen) < 1e-9 && ox >= best.ox)))))));
      if (better) best = { n, po, sym, cen, ox, oy };
    }
  }
  return { ox: best!.ox, oy: best!.oy };
}

/** Builds a deck geometry from the cells each deck layer has. */
export function makeDeckGeo(shipId: string, w: number, h: number, depth: number, hasCell: (x: number, y: number, z: number) => boolean): DeckGeo {
  const masks: Uint8Array[] = [new Uint8Array(w * h)];
  for (let z = 1; z < depth; z++) {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (hasCell(x, y, z)) m[y * w + x] = 1;
    masks.push(m);
  }
  const geo: DeckGeo = { shipId, w, h, depth, masks, org: [{ ox: 0, oy: 0 }] };
  for (let z = 1; z < depth; z++) {
    const fix = ORIGIN_FIX[shipId]?.[z];
    geo.org.push(fix ?? bestOrigin(geo, z, z > 1 ? geo.org[z - 1].oy : -1));
  }
  return geo;
}

// ------------------------------------------------------------------ rectangles and placement

export function moduleRect(g: DeckGeo, z: number, q: { i: number; j: number; tw: number; th: number }): Rect {
  const o = g.org[z];
  const x0 = o.ox + TILE * q.i;
  const y0 = o.oy + TILE * q.j;
  return { x0, y0, x1: x0 + TILE * q.tw, y1: y0 + TILE * q.th };
}

export function ladderRect(l: PlacedLadder): Rect {
  return { x0: l.x, y0: l.y, x1: l.x + 4, y1: l.y + 4 };
}

export function ladderOnDeck(l: PlacedLadder, z: number): boolean {
  return l.z0 === z || l.z0 + 1 === z;
}

function isBorder(r: Rect, x: number, y: number): boolean {
  return x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
}

/** Two rooms may overlap only on a shared wall: every common cell is on the border of both. */
export function rectsOk(a: Rect, b: Rect): boolean {
  const x0 = Math.max(a.x0, b.x0);
  const x1 = Math.min(a.x1, b.x1);
  const y0 = Math.max(a.y0, b.y0);
  const y1 = Math.min(a.y1, b.y1);
  if (x0 > x1 || y0 > y1) return true;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!(isBorder(a, x, y) && isBorder(b, x, y))) return false;
  return true;
}

function tilesOverlap(a: { i: number; j: number; tw: number; th: number }, b: { i: number; j: number; tw: number; th: number }): boolean {
  return a.i < b.i + b.tw && b.i < a.i + a.tw && a.j < b.j + b.th && b.j < a.j + a.th;
}

/** Whole footprint inside the deck. */
export function footValid(g: DeckGeo, z: number, i: number, j: number, tw: number, th: number): boolean {
  const r = moduleRect(g, z, { i, j, tw, th });
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (!inMask(g, z, x, y)) return false;
  return true;
}

/** May a module of this size stand on tile (i, j) of deck z? `ignoreId` is the module being moved. */
export function canPlaceModule(g: DeckGeo, layout: ShipLayout, z: number, i: number, j: number, tw: number, th: number, ignoreId: number | null): boolean {
  if (!footValid(g, z, i, j, tw, th)) return false;
  const t = { i, j, tw, th };
  for (const m of layout.mods) if (m.deck === z && m.id !== ignoreId && tilesOverlap(t, m)) return false;
  const r = moduleRect(g, z, t);
  for (const l of layout.lads) if (ladderOnDeck(l, z) && !rectsOk(r, ladderRect(l))) return false;
  return true;
}

/** May a ladder shaft stand with its top-left at (x, y), joining deck z0 and z0 + 1? */
export function canPlaceLadder(g: DeckGeo, layout: ShipLayout, x: number, y: number, z0: number, ignoreId: number | null): boolean {
  if (z0 < 1 || z0 + 1 >= g.depth) return false;
  const r: Rect = { x0: x, y0: y, x1: x + 4, y1: y + 4 };
  for (let z = z0; z <= z0 + 1; z++) {
    for (let yy = y; yy <= y + 4; yy++) for (let xx = x; xx <= x + 4; xx++) if (!inMask(g, z, xx, yy)) return false;
    for (const m of layout.mods) if (m.deck === z && !rectsOk(r, moduleRect(g, z, m))) return false;
    for (const l of layout.lads) if (l.id !== ignoreId && ladderOnDeck(l, z) && !rectsOk(r, ladderRect(l))) return false;
  }
  return true;
}

/** Can the crew get from the ladder just placed to every room on both decks it joins? */
function ladderReachesRooms(g: DeckGeo, layout: ShipLayout, ladderId: number): boolean {
  const lad = layout.lads.find((l) => l.id === ladderId);
  if (!lad) return false;
  for (const z of [lad.z0, lad.z0 + 1]) {
    const plan = planDeck(g, layout, z);
    const start = plan.ents.findIndex((e) => e.kind === 'lad' && e.ref === lad);
    if (start < 0) return false;
    const seen = new Uint8Array(g.w * g.h);
    const queue: number[] = [];
    for (let i = 0; i < plan.entAt.length; i++) if (plan.entAt[i] === start) queue.push(i);
    for (const i of queue) seen[i] = 1;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = i % g.w;
      for (const n of [x > 0 ? i - 1 : -1, x < g.w - 1 ? i + 1 : -1, i - g.w, i + g.w]) {
        if (n < 0 || n >= seen.length || seen[n]) continue;
        const k = plan.kind[n];
        if (k !== K.FIELD && k !== K.FLOOR && k !== K.MINT && k !== K.DOOR) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    for (let e = 0; e < plan.ents.length; e++) {
      let hit = false;
      for (let i = 0; i < plan.entAt.length && !hit; i++) if (plan.entAt[i] === e && seen[i]) hit = true;
      if (!hit) return false;
    }
  }
  return true;
}

/**
 * The ladder joining these two decks that is closest to the middle of the hull, found by
 * search. On a small ship, where every room counts, the ladder goes first where it takes
 * the fewest free places from the modules, and only where the crew can walk from it to
 * every room on both decks.
 */
function placeLadders(g: DeckGeo, layout: ShipLayout): void {
  const small = tileCapacity(g, { mods: [], lads: [], corr: {}, next: 1 }).slots <= 20;
  for (let z0 = 1; z0 + 1 < g.depth; z0++) {
    const aim = [g.w / 2 - 2, g.h * 0.6];
    const found: Array<{ free: number; d: number; x: number; y: number }> = [];
    for (let y = 0; y < g.h - 4; y++) {
      for (let x = 0; x < g.w - 4; x++) {
        if (!canPlaceLadder(g, layout, x, y, z0, null)) continue;
        const d = Math.hypot(x - aim[0], y - aim[1]);
        let free = 0;
        if (small) {
          layout.lads.push({ id: -1, x, y, z0 });
          free = tileCapacity(g, layout).free;
          layout.lads.pop();
        }
        found.push({ free, d, x, y });
      }
    }
    found.sort((a, b) => b.free - a.free || a.d - b.d);
    let pick = found[0];
    if (small) {
      for (const c of found) {
        const id = layout.next;
        layout.lads.push({ id, x: c.x, y: c.y, z0 });
        const ok = ladderReachesRooms(g, layout, id);
        layout.lads.pop();
        if (ok) {
          pick = c;
          break;
        }
      }
    }
    if (pick) layout.lads.push({ id: layout.next++, x: pick.x, y: pick.y, z0 });
  }
}

/** The ship as it comes from the yard: base modules where the design puts them, one ladder per pair of decks. */
export function defaultLayout(g: DeckGeo): ShipLayout {
  const layout: ShipLayout = { mods: [], lads: [], corr: {}, next: 1 };
  for (const b of BASE_MODULES[g.shipId] ?? []) {
    let best: { d: number; i: number; j: number } | null = null;
    for (let j = -2; j < Math.ceil(g.h / TILE) + 2; j++) {
      for (let i = -2; i < Math.ceil(g.w / TILE) + 2; i++) {
        if (!footValid(g, b.deck, i, j, b.tw, b.th)) continue;
        if (layout.mods.some((m) => m.deck === b.deck && tilesOverlap({ i, j, tw: b.tw, th: b.th }, m))) continue;
        const r = moduleRect(g, b.deck, { i, j, tw: b.tw, th: b.th });
        const d = Math.hypot((r.x0 + r.x1) / 2 - b.aim[0], (r.y0 + r.y1) / 2 - b.aim[1]);
        if (!best || d < best.d) best = { d, i, j };
      }
    }
    if (best) layout.mods.push({ id: layout.next++, type: b.type, deck: b.deck, i: best.i, j: best.j, tw: b.tw, th: b.th, base: true });
  }
  placeLadders(g, layout);
  return layout;
}

export function cloneLayout(l: ShipLayout): ShipLayout {
  return { mods: l.mods.map((m) => ({ ...m })), lads: l.lads.map((x) => ({ ...x })), corr: Object.fromEntries(Object.entries(l.corr).map(([k, v]) => [k, v.slice()])), next: l.next, stock: (l.stock ?? []).map((x) => ({ ...x })) };
}

/** A saved layout is trusted only if everything in it still fits the ship's decks. */
export function layoutFits(g: DeckGeo, l: ShipLayout): boolean {
  const probe: ShipLayout = { mods: [], lads: [], corr: {}, next: 1 };
  for (const m of l.mods) {
    if (!canPlaceModule(g, probe, m.deck, m.i, m.j, m.tw, m.th, null)) return false;
    probe.mods.push(m);
  }
  for (const x of l.lads) {
    if (!canPlaceLadder(g, probe, x.x, x.y, x.z0, null)) return false;
    probe.lads.push(x);
  }
  return true;
}

// ------------------------------------------------------------------ the plan of one deck

/** What a cell of a planned deck is. */
export const K = { OUT: 0, FIELD: 1, HULL: 2, FLOOR: 3, MINT: 4, MWALL: 5, DOOR: 6, FENCE: 7 } as const;

export interface DeckEnt {
  kind: 'mod' | 'lad';
  ref: PlacedModule | PlacedLadder;
  type: ModuleId | 'ladder';
  tw: number;
  th: number;
  /** Footprint including the wall. */
  r: Rect;
  /** For a ladder: this deck is the upper one (the way down). */
  down: boolean;
}

export interface DeckPlan {
  z: number;
  kind: Uint8Array;
  /** Index into `ents` for interior cells, else -1. */
  entAt: Int16Array;
  ents: DeckEnt[];
  /** Door cells (indices), two per door in a wall, one at a corridor's end. */
  doors: number[];
  /** Groups of rooms the crew cannot leave. */
  issues: string[];
  floor: number[];
}

/**
 * Lays out one deck: the hull's outer wall, every room's wall (shared where rooms touch),
 * corridor floors with a wall around them, and the doors that appear by themselves — in a
 * shared wall, where a room meets a corridor, and out of a group of rooms to the open field.
 */
export function planDeck(g: DeckGeo, layout: ShipLayout, z: number): DeckPlan {
  const w = g.w;
  const h = g.h;
  const N = w * h;
  const kind = new Uint8Array(N);
  const entAt = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (g.masks[z][i]) kind[i] = K.FIELD;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!g.masks[z][i]) continue;
      if (!inMask(g, z, x - 1, y) || !inMask(g, z, x + 1, y) || !inMask(g, z, x, y - 1) || !inMask(g, z, x, y + 1)) kind[i] = K.HULL;
    }
  }
  const ents: DeckEnt[] = [];
  for (const q of layout.mods) if (q.deck === z) ents.push({ kind: 'mod', ref: q, type: q.type, tw: q.tw, th: q.th, r: moduleRect(g, z, q), down: false });
  for (const l of layout.lads) if (ladderOnDeck(l, z)) ents.push({ kind: 'lad', ref: l, type: 'ladder', tw: 1, th: 1, r: ladderRect(l), down: l.z0 === z });
  ents.forEach((e, qi) => {
    const r = e.r;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const idx = y * w + x;
        if (idx < 0 || idx >= N) continue;
        if (x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1) kind[idx] = K.MWALL;
        else {
          kind[idx] = K.MINT;
          entAt[idx] = qi;
        }
      }
    }
  });
  // Corridors: floor only on the open field, a wall around the floor.
  const floor: number[] = [];
  for (const idx of layout.corr[z] ?? []) {
    if (kind[idx] === K.FIELD) {
      kind[idx] = K.FLOOR;
      floor.push(idx);
    }
  }
  const fence: number[] = [];
  for (const idx of floor) {
    const cx = idx % w;
    const cy = (idx - cx) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (kind[(cy + dy) * w + cx + dx] === K.FIELD) fence.push((cy + dy) * w + cx + dx);
  }
  for (const n of fence) kind[n] = K.FENCE;

  // Doors.
  const doors: number[] = [];
  const issues: string[] = [];
  const parent = ents.map((_, k) => k);
  const outlet = ents.map(() => false);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const door = (x: number, y: number): void => {
    const idx = y * w + x;
    if (kind[idx] === K.MWALL || kind[idx] === K.FENCE) {
      kind[idx] = K.DOOR;
      doors.push(idx);
    }
  };
  for (let a = 0; a < ents.length; a++) {
    for (let b = a + 1; b < ents.length; b++) {
      const r1 = ents[a].r;
      const r2 = ents[b].r;
      const ix0 = Math.max(r1.x0, r2.x0);
      const ix1 = Math.min(r1.x1, r2.x1);
      const iy0 = Math.max(r1.y0, r2.y0);
      const iy1 = Math.min(r1.y1, r2.y1);
      if (ix0 > ix1 || iy0 > iy1 || (ix0 === ix1 && iy0 === iy1)) continue;
      const cand: Array<[number, number]> = [];
      const vertical = ix0 === ix1;
      for (let t = vertical ? iy0 : ix0; t <= (vertical ? iy1 : ix1); t++) {
        const cx = vertical ? ix0 : t;
        const cy = vertical ? t : iy0;
        if ((cx === r1.x0 || cx === r1.x1) && (cy === r1.y0 || cy === r1.y1)) continue;
        if ((cx === r2.x0 || cx === r2.x1) && (cy === r2.y0 || cy === r2.y1)) continue;
        cand.push([cx, cy]);
      }
      if (!cand.length) continue;
      const mid = Math.floor((cand.length - 1) / 2);
      door(cand[mid][0], cand[mid][1]);
      if (cand.length > 1) door(cand[mid + 1][0], cand[mid + 1][1]);
      parent[find(a)] = find(b);
    }
  }
  type Side = Array<[number, number, number, number]>;
  const sides = (e: DeckEnt): Side[] => {
    const r = e.r;
    const out: Side[] = [[], [], [], []];
    for (let x = r.x0 + 1; x < r.x1; x++) {
      out[0].push([x, r.y0, x, r.y0 - 1]);
      out[1].push([x, r.y1, x, r.y1 + 1]);
    }
    for (let y = r.y0 + 1; y < r.y1; y++) {
      out[2].push([r.x0, y, r.x0 - 1, y]);
      out[3].push([r.x1, y, r.x1 + 1, y]);
    }
    return out;
  };
  const outside = (c: [number, number, number, number]): number => (c[2] < 0 || c[3] < 0 || c[2] >= w || c[3] >= h ? K.OUT : kind[c[3] * w + c[2]]);
  const runs = (side: Side, want: number): Side[] => {
    const res: Side[] = [];
    let cur: Side = [];
    for (const c of side) {
      if (outside(c) === want) cur.push(c);
      else {
        if (cur.length) res.push(cur);
        cur = [];
      }
    }
    if (cur.length) res.push(cur);
    return res;
  };
  const doorOnRun = (run: Side): void => {
    const mid = Math.floor((run.length - 1) / 2);
    door(run[mid][0], run[mid][1]);
    if (run.length > 1) door(run[mid + 1][0], run[mid + 1][1]);
  };
  ents.forEach((e, qi) => {
    for (const side of sides(e)) {
      for (const run of runs(side, K.FLOOR)) {
        if (run.length >= 2) {
          doorOnRun(run);
          outlet[qi] = true;
        }
      }
    }
  });
  const groups = new Map<number, number[]>();
  ents.forEach((_, qi) => {
    const gr = find(qi);
    if (!groups.has(gr)) groups.set(gr, []);
    groups.get(gr)!.push(qi);
  });
  for (const members of groups.values()) {
    if (members.some((qi) => outlet[qi])) continue;
    let best: Side | null = null;
    for (const qi of members) for (const side of sides(ents[qi])) for (const run of runs(side, K.FIELD)) if (run.length >= 2 && (!best || run.length > best.length)) best = run;
    if (best) doorOnRun(best);
    else issues.push(members.map((qi) => MODULE_INFO[ents[qi].type].name).join(', '));
  }
  // Dead ends of a corridor open into the field beyond.
  const nb = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const idx of floor) {
    const cx = idx % w;
    const cy = (idx - cx) / w;
    let cnt = 0;
    let dir: number[] | null = null;
    for (const d of nb) {
      if (kind[(cy + d[1]) * w + cx + d[0]] === K.FLOOR) {
        cnt++;
        dir = d;
      }
    }
    if (cnt === 1 && dir) {
      const n1 = (cy - dir[1]) * w + cx - dir[0];
      const n2 = (cy - 2 * dir[1]) * w + cx - 2 * dir[0];
      if (kind[n1] === K.FENCE && kind[n2] === K.FIELD) {
        kind[n1] = K.DOOR;
        doors.push(n1);
      }
    }
  }
  return { z, kind, entAt, ents, doors, issues, floor };
}

// ------------------------------------------------------------------ editing

/** Removes the corridor floor on and right around a room that has just been put down. */
export function clearCorridorUnder(g: DeckGeo, layout: ShipLayout, z: number, r: Rect): void {
  const list = layout.corr[z];
  if (!list) return;
  layout.corr[z] = list.filter((idx) => {
    const x = idx % g.w;
    const y = (idx - x) / g.w;
    return !(x >= r.x0 - 1 && x <= r.x1 + 1 && y >= r.y0 - 1 && y <= r.y1 + 1);
  });
}

/** Puts a module down (or moves one that is already in the layout). Returns false if it would not fit. */
export function putModule(g: DeckGeo, layout: ShipLayout, type: ModuleId, z: number, i: number, j: number, tw: number, th: number, movingId: number | null, lv = 1): boolean {
  if (!canPlaceModule(g, layout, z, i, j, tw, th, movingId)) return false;
  const r = moduleRect(g, z, { i, j, tw, th });
  if (movingId !== null) {
    const m = layout.mods.find((q) => q.id === movingId);
    if (!m) return false;
    m.deck = z;
    m.i = i;
    m.j = j;
  } else layout.mods.push({ id: layout.next++, type, deck: z, i, j, tw, th, base: false, lv });
  clearCorridorUnder(g, layout, z, r);
  return true;
}

/** Takes a module out of the layout; the base modules stay (they can only be moved). */
export function removeModule(layout: ShipLayout, id: number): boolean {
  const m = layout.mods.find((q) => q.id === id);
  if (!m || m.base) return false;
  layout.mods = layout.mods.filter((q) => q.id !== id);
  return true;
}

/** Takes an upgraded module off the deck into the pool, where it waits with its level; a first-level one just goes back to the endless pool. */
export function removeModuleToStock(layout: ShipLayout, id: number): boolean {
  const m = layout.mods.find((q) => q.id === id);
  if (!m || m.base || !removeModule(layout, id)) return false;
  const lv = m.lv ?? 1;
  if (lv > 1) (layout.stock ??= []).push({ id: layout.next++, type: m.type as PoolModuleId, lv });
  return true;
}

/** Forgets a stocked module once it is on a deck again. */
export function takeFromStock(layout: ShipLayout, stockId: number): void {
  if (layout.stock) layout.stock = layout.stock.filter((x) => x.id !== stockId);
}

/** Puts a ladder down (or moves one) joining decks z0 and z0 + 1. */
export function putLadder(g: DeckGeo, layout: ShipLayout, x: number, y: number, z0: number, movingId: number | null): boolean {
  if (!canPlaceLadder(g, layout, x, y, z0, movingId)) return false;
  let l = movingId !== null ? layout.lads.find((q) => q.id === movingId) : undefined;
  if (movingId !== null && !l) return false;
  if (l) {
    l.x = x;
    l.y = y;
  } else {
    l = { id: layout.next++, x, y, z0 };
    layout.lads.push(l);
  }
  const r = ladderRect(l);
  clearCorridorUnder(g, layout, z0, r);
  clearCorridorUnder(g, layout, z0 + 1, r);
  return true;
}

export function removeLadder(layout: ShipLayout, id: number): void {
  layout.lads = layout.lads.filter((l) => l.id !== id);
}

/** Paints (or erases) corridor floor, `size` cells wide, along a line of cells. Only cells that are on the deck count. */
export function paintCorridor(g: DeckGeo, layout: ShipLayout, z: number, from: { x: number; y: number }, to: { x: number; y: number }, size: number, on: boolean): void {
  const set = new Set(layout.corr[z] ?? []);
  const half = Math.floor(size / 2);
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
  for (let s = 0; s <= steps; s++) {
    const px = Math.round(from.x + ((to.x - from.x) * s) / steps);
    const py = Math.round(from.y + ((to.y - from.y) * s) / steps);
    for (let dy = -half; dy < size - half; dy++) {
      for (let dx = -half; dx < size - half; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (!inMask(g, z, x, y)) continue;
        if (on) set.add(y * g.w + x);
        else set.delete(y * g.w + x);
      }
    }
  }
  layout.corr[z] = [...set];
}

/** Free tiles (1×1) still open on all decks, and how many fit in total. */
export function tileCapacity(g: DeckGeo, layout: ShipLayout): { slots: number; free: number } {
  let slots = 0;
  let free = 0;
  for (let z = 1; z < g.depth; z++) {
    for (let j = -2; j < Math.ceil(g.h / TILE) + 2; j++) {
      for (let i = -2; i < Math.ceil(g.w / TILE) + 2; i++) {
        if (!footValid(g, z, i, j, 1, 1)) continue;
        slots++;
        if (canPlaceModule(g, layout, z, i, j, 1, 1, null)) free++;
      }
    }
  }
  return { slots, free };
}

/** Pairs of neighbouring decks (upper deck numbers) that have no ladder. */
export function decksWithoutLadder(g: DeckGeo, layout: ShipLayout): number[] {
  const out: number[] = [];
  for (let z = 1; z + 1 < g.depth; z++) if (!layout.lads.some((l) => l.z0 === z)) out.push(z);
  return out;
}
