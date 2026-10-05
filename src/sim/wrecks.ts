import type { Celestial } from './gravity';
import { ShipGrid } from './grid';
import { MATERIALS, Mat } from './materials';
import { hash2, mulberry32, type Rng } from './rng';
import { buildBossBattleship, buildFighter, buildScout, buildFreighter, playerShip } from './ships';

/**
 * Wrecks in space: hulks of every size and shape that lie where they were left (they do not move, but they break
 * under fire). Four kinds: the broken hull of a station, the wreck of a ship of the player's own classes, the hulks of
 * enemy ships, and ancient wreckage of something that was not ours. Flying close and staying a while looks them over
 * (see `inspect`): there may be metal, a survivor, a cache, or a trap. Shooting one to pieces gives its metal.
 */

export type WreckKind = 'station' | 'player' | 'enemy' | 'ancient';
export const WRECK_KINDS: WreckKind[] = ['station', 'player', 'enemy', 'ancient'];

export const WRECK = {
  /** How close to the hull the ship must come (cells from its edge), and how slowly, to look it over; and how long it takes (seconds). */
  inspectRange: 90,
  inspectSpeed: 45,
  inspectTime: 3,
  /** The chance that there is a trap. */
  trapChance: 0.25,
  /** Metal a wreck gives for every cell shot away. */
  salvagePerCell: 0.12,
  /** The delay of a reactor trap, seconds. */
  reactorFuse: 2.5,
};

export interface WreckSpec {
  kind: WreckKind;
  /** Which of the ships it was (for a ship's wreck). */
  ship?: string;
  /** Rough size in cells, across. */
  size: number;
}

const SHIP_SIZE: Record<string, number> = { fighter: 62, cruiser: 76, battleship: 190, scout: 28, raider: 44, hunter: 44, freighter: 40, boss: 190 };

/** What a wreck is, from its seed and kind: the same every time. */
export function wreckSpec(c: Celestial): WreckSpec {
  const kind = (c.variant as WreckKind) ?? 'station';
  const r = mulberry32(c.seed * 6151 + 3);
  if (kind === 'station') return { kind, size: Math.round(60 + r() * 100) };
  if (kind === 'ancient') return { kind, size: Math.round(50 + r() * 90) };
  if (kind === 'player') {
    const ship = r() < 0.5 ? 'fighter' : r() < 0.7 ? 'cruiser' : 'battleship';
    return { kind, ship, size: SHIP_SIZE[ship] };
  }
  const t = r();
  const ship = t < 0.25 ? 'scout' : t < 0.55 ? 'raider' : t < 0.75 ? 'hunter' : t < 0.92 ? 'freighter' : 'boss';
  return { kind, ship, size: SHIP_SIZE[ship] };
}

export function wreckBody(x: number, y: number, seed: number, kind: WreckKind): Celestial {
  const c: Celestial = { kind: 'wreck', x, y, radius: 1, mu: 0, soft: 1, seed, variant: kind };
  c.radius = wreckSpec(c).size * 0.6;
  return c;
}

// ------------------------------------------------------------------ building

type Marks = Array<[number, number, number]>;

function crater(g: ShipGrid, cx: number, cy: number, r: number, marks?: Marks): void {
  marks?.push([cx, cy, r]);
  for (let z = 0; z < g.depth; z++) {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(g.height - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(g.width - 1, Math.ceil(cx + r)); x++) {
        const i = g.idx(x, y, z);
        if (g.mat[i] !== 0 && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) g.removeCell(i);
      }
    }
  }
}

/** Keeps only the biggest piece of the grid (a wreck is one hull) and the second one now and then, a part torn off. */
function keepPieces(g: ShipGrid, rng: Rng, keepSecond: boolean): void {
  const label = new Int32Array(g.width * g.height).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < g.width * g.height; s++) {
    if (g.colCount[s] === 0 || label[s] !== -1) continue;
    const id = sizes.length;
    let n = 0;
    const stack = [s];
    label[s] = id;
    while (stack.length) {
      const c = stack.pop()!;
      n++;
      const x = c % g.width;
      const y = (c - x) / g.width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue;
        const ni = ny * g.width + nx;
        if (g.colCount[ni] > 0 && label[ni] === -1) {
          label[ni] = id;
          stack.push(ni);
        }
      }
    }
    sizes.push(n);
  }
  if (sizes.length <= 1) return;
  const order = sizes.map((n, i) => [n, i] as const).sort((a, b) => b[0] - a[0]);
  const keep = new Set<number>([order[0][1]]);
  if (keepSecond && order.length > 1 && order[1][0] > 20 && rng() < 0.6) keep.add(order[1][1]);
  for (let s = 0; s < g.width * g.height; s++) {
    if (g.colCount[s] === 0 || keep.has(label[s])) continue;
    for (let z = 0; z < g.depth; z++) {
      const i = z * g.layerSize + s;
      if (g.mat[i] !== 0) g.removeCell(i);
    }
  }
}

function station(seed: number, size: number): ShipGrid {
  const rng = mulberry32(seed);
  const W = size + 16;
  const H = Math.round(size * (0.55 + rng() * 0.4)) + 16;
  const g = new ShipGrid(W, H, 1);
  const cx = W / 2;
  const cy = H / 2;
  const fill = (x0: number, y0: number, x1: number, y1: number, mat: number): void => {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) if (x >= 0 && y >= 0 && x < W && y < H) g.setCell(x, y, 0, mat);
  };
  // the spine, then the pods hung on it; a hull is an outer skin of hull cells, deck inside, a few machines
  const horizontal = rng() < 0.6;
  const L = size * (0.6 + rng() * 0.3);
  const T = Math.max(8, size * (0.12 + rng() * 0.1));
  const rects: Array<[number, number, number, number]> = [];
  rects.push(horizontal ? [cx - L / 2, cy - T / 2, cx + L / 2, cy + T / 2] : [cx - T / 2, cy - L / 2, cx + T / 2, cy + L / 2]);
  const pods = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < pods; i++) {
    const along = (rng() - 0.5) * L * 0.8;
    const len = size * (0.12 + rng() * 0.18);
    const off = T / 2 + len / 2 - 1;
    const side = rng() < 0.5 ? -1 : 1;
    const w = size * (0.1 + rng() * 0.14);
    rects.push(horizontal ? [cx + along - w / 2, cy + side * off - len / 2, cx + along + w / 2, cy + side * off + len / 2] : [cx + side * off - len / 2, cy + along - w / 2, cx + side * off + len / 2, cy + along + w / 2]);
  }
  if (rng() < 0.5) {
    // a ring (a habitat wheel)
    const R = size * (0.18 + rng() * 0.08);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - R) < 3.2) g.setCell(x, y, 0, Mat.HULL);
  }
  for (const [x0, y0, x1, y1] of rects) fill(x0, y0, x1, y1, Mat.DECK);
  // skin: a deck cell with an empty neighbour becomes hull
  const skin: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = g.idx(x, y, 0);
      if (g.mat[i] === Mat.DECK && ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= H || g.mat[g.idx(x + dx, y + dy, 0)] === 0))) skin.push(i);
    }
  }
  // (re-set the skin cells as hull and armour; the hull is two cells thick)
  const thick: number[] = [];
  for (const i of skin) {
    const x = i % W;
    const y = Math.floor(i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= H) continue;
      const j = g.idx(x + dx, y + dy, 0);
      if (g.mat[j] === Mat.DECK) thick.push(j);
    }
  }
  for (const i of [...skin, ...thick]) {
    const x = i % W;
    const y = Math.floor(i / W);
    g.removeCell(i);
    g.setCell(x, y, 0, hash2(x, y, seed) < 0.3 ? Mat.ARMOR : Mat.HULL);
  }
  // bulkheads: rooms of a dozen cells with doorways
  const ox = Math.floor(rng() * 11);
  const oy = Math.floor(rng() * 13);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = g.idx(x, y, 0);
      if (g.mat[i] !== Mat.DECK) continue;
      if (((x + ox) % 11 === 0 || (y + oy) % 13 === 0) && hash2(Math.floor(x / 3), Math.floor(y / 3), seed + 4) > 0.3) {
        g.removeCell(i);
        g.setCell(x, y, 0, Mat.WALL);
      }
    }
  }
  // machinery inside
  for (let k = 0; k < pods * 3; k++) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * H);
    const i = g.idx(x, y, 0);
    if (g.mat[i] === Mat.DECK) fill(x, y, x + 1 + Math.floor(rng() * 3), y + 1 + Math.floor(rng() * 2), rng() < 0.5 ? Mat.MODULE : Mat.CONSOLE);
  }
  // the mast: a thin line from the spine
  const mastLen = size * (0.12 + rng() * 0.12);
  if (horizontal) for (let y = 0; y < mastLen; y++) g.setCell(Math.floor(cx), Math.max(0, Math.floor(cy - T / 2 - 1 - y)), 0, Mat.WALL);
  else for (let x = 0; x < mastLen; x++) g.setCell(Math.max(0, Math.floor(cx - T / 2 - 1 - x)), Math.floor(cy), 0, Mat.WALL);
  // solar wings on struts
  const solar = new Set<number>();
  for (let w = 0; w < 2; w++) {
    const along = (w === 0 ? -1 : 1) * L * (0.2 + rng() * 0.2);
    const side = rng() < 0.5 ? -1 : 1;
    const wl = size * (0.22 + rng() * 0.14);
    const ww = 6 + Math.floor(rng() * 5);
    const start = T / 2 + 1;
    const rect: Array<[number, number, number, number]> = horizontal
      ? [[cx + along, cy + side * start, cx + along, cy + side * (start + 6)], [cx + along - ww, cy + side * (start + 6), cx + along + ww, cy + side * (start + 6 + wl)]]
      : [[cx + side * start, cy + along, cx + side * (start + 6), cy + along], [cx + side * (start + 6), cy + along - ww, cx + side * (start + 6 + wl), cy + along + ww]];
    rect.forEach(([x0, y0, x1, y1], n) => {
      for (let y = Math.floor(Math.min(y0, y1)); y <= Math.ceil(Math.max(y0, y1)); y++) {
        for (let x = Math.floor(Math.min(x0, x1)); x <= Math.ceil(Math.max(x0, x1)); x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          g.setCell(x, y, 0, Mat.HULL);
          if (n === 1) solar.add(g.idx(x, y, 0));
        }
      }
    });
  }
  // torn apart: craters, a bite taken out of one end
  const holes = 4 + Math.floor(rng() * 5);
  for (let h = 0; h < holes; h++) crater(g, rng() * W, rng() * H, 3 + rng() * size * 0.08);
  crater(g, cx + (horizontal ? (rng() < 0.5 ? -1 : 1) * L * 0.5 : 0), cy + (horizontal ? 0 : (rng() < 0.5 ? -1 : 1) * L * 0.5), size * 0.15);
  keepPieces(g, rng, true);
  paintStation(g, seed, solar);
  return g;
}

/** Plating with seams, a dark deck with tiles, a few lit windows, and the cold glow of consoles. */
function paintStation(g: ShipGrid, seed: number, solar: Set<number>): void {
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const i = g.idx(x, y, 0);
      const m = g.mat[i];
      if (m === 0) continue;
      const f = 0.86 + 0.28 * hash2(x, y, seed + 9);
      if (solar.has(i)) {
        const cell = x % 5 === 0 || y % 5 === 0 ? 0.55 : 1;
        g.setPaint(i, 34 * f * cell, 84 * f * cell, 150 * f * cell, false);
      } else if (m === Mat.WALL) {
        g.setPaint(i, 112 * f, 124 * f, 142 * f, false);
      } else if (m === Mat.HULL || m === Mat.ARMOR) {
        const base = m === Mat.ARMOR ? [112, 120, 134] : [78, 90, 108];
        const seam = x % 7 === 0 || y % 7 === 0 ? 0.68 : 1;
        if (hash2(x >> 1, y >> 1, seed + 21) < 0.025) g.setPaint(i, 255, 214, 130, true); // a lit window
        else g.setPaint(i, base[0] * f * seam, base[1] * f * seam, base[2] * f * seam, false);
      } else if (m === Mat.DECK) {
        const tile = (x + y) % 2 === 0 ? 1 : 0.88;
        g.setPaint(i, 44 * f * tile, 54 * f * tile, 68 * f * tile, false);
      } else if (m === Mat.CONSOLE) {
        g.setPaint(i, 90, 235, 230, true);
      } else if (m === Mat.MODULE) {
        g.setPaint(i, 170 * f, 110 * f, 60 * f, false);
      }
    }
  }
}

/** Soot round the wounds and a few embers still alive in them; the hull as a whole is darker for its time in space. */
function scorch(g: ShipGrid, marks: Marks, seed: number): void {
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const i = g.idx(x, y, 0);
      const m = g.mat[i];
      if (m === 0) continue;
      if (!g.paintRGB || !g.paintFlags![i]) {
        const c = MATERIALS[m].color;
        g.setPaint(i, (c >> 16) & 255, (c >> 8) & 255, c & 255, false);
      }
      if (g.paintFlags![i] & 2) continue;
      let k = 0.82;
      let ember = false;
      for (const [cx, cy, r] of marks) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / (r * 1.8);
        if (d < 1) {
          k = Math.min(k, 0.38 + 0.44 * d);
          if (d > 0.6 && hash2(x, y, seed + 31) < 0.05) ember = true;
        }
      }
      if (ember) {
        g.setPaint(i, 255, 140, 40, true);
      } else {
        const p = g.paintRGB!;
        g.setPaint(i, p[i * 3] * k, p[i * 3 + 1] * k, p[i * 3 + 2] * k, false);
      }
    }
  }
}

/** A ship of the game's, broken: craters and bites, hit points down, the biggest pieces left. */
function broken(src: ShipGrid, seed: number, heavy: number): ShipGrid {
  const rng = mulberry32(seed);
  const g = new ShipGrid(src.width, src.height, src.depth);
  for (let z = 0; z < src.depth; z++) for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const i = src.idx(x, y, z);
    if (src.mat[i] !== 0) g.copyCellFrom(src, i, x, y, z);
  }
  const scale = Math.max(src.width, src.height) / 60;
  const marks: Marks = [];
  const holes = Math.round((3 + rng() * 6) * heavy * Math.max(0.5, scale * 0.9));
  for (let h = 0; h < holes; h++) crater(g, rng() * g.width, rng() * g.height, (2 + rng() * 6) * Math.max(0.6, scale * 0.6), marks);
  // one big bite: the ship is broken across
  const a = rng() * Math.PI * 2;
  crater(g, g.width / 2 + Math.cos(a) * g.width * 0.15, g.height / 2 + Math.sin(a) * g.height * 0.15, Math.max(g.width, g.height) * (0.08 + rng() * 0.08), marks);
  keepPieces(g, rng, true);
  scorch(g, marks, seed);
  // what is left is hurt
  for (let i = 0; i < g.mat.length; i++) if (g.mat[i] !== 0) g.hp[i] *= 0.25 + rng() * 0.6;
  g.version++;
  return g;
}

const ANCIENT = [
  [0x1f6a72, 0x2fa6a6, 0x7de8d6],
  [0x6a4a14, 0xc89a2c, 0xffe08a],
  [0x3a2a72, 0x7a5ad0, 0xc8b0ff],
];

/** Something not ours: a many-armed shape, or a ring with spokes, in strange colours, with runes that still glow. */
function ancient(seed: number, size: number): ShipGrid {
  const rng = mulberry32(seed);
  const R = Math.round(size / 2);
  const W = R * 2 + 6;
  const g = new ShipGrid(W, W, 1);
  const cx = W / 2;
  const cy = W / 2;
  const arms = 3 + Math.floor(rng() * 4);
  const twist = (rng() - 0.5) * 0.12;
  const form = Math.floor(rng() * 3); // 0 arms, 1 ring with spokes, 2 spire
  const pal = ANCIENT[Math.floor(rng() * ANCIENT.length)].map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      if (r > R) continue;
      const phi = Math.atan2(dy, dx);
      const sector = ((phi * arms) / (Math.PI * 2) + r * twist * arms) % 1;
      const s = Math.abs(sector - Math.floor(sector + 0.5));
      let solid = false;
      if (r < R * 0.16) solid = true;
      else if (form === 0) solid = s < 0.5 * (0.5 - (r / R) * 0.35) && r > R * 0.12;
      else if (form === 1) solid = (Math.abs(r - R * 0.8) < R * 0.07 || Math.abs(r - R * 0.4) < R * 0.045 || s < 0.05) && r > R * 0.12;
      else solid = s < 0.22 * (1 - r / R) + 0.04 && r > R * 0.1;
      if (!solid) continue;
      g.setCell(x, y, 0, Mat.ARMOR);
      const t = r / R;
      const base = t < 0.5 ? pal[0] : pal[1];
      const f = 0.8 + 0.4 * hash2(x, y, seed);
      if (hash2(x >> 1, y >> 1, seed + 3) < 0.035) g.setPaint(g.idx(x, y, 0), pal[2][0], pal[2][1], pal[2][2], true);
      else g.setPaint(g.idx(x, y, 0), base[0] * f, base[1] * f, base[2] * f, false);
    }
  }
  for (let h = 0; h < 2 + Math.floor(rng() * 3); h++) crater(g, rng() * W, rng() * W, 2 + rng() * R * 0.18);
  keepPieces(g, rng, true);
  return g;
}

/** The grid of a wreck. */
export function buildWreck(c: Celestial): ShipGrid {
  const spec = wreckSpec(c);
  if (spec.kind === 'station') return station(c.seed, spec.size);
  if (spec.kind === 'ancient') return ancient(c.seed, spec.size);
  const builders: Record<string, () => ShipGrid> = {
    fighter: () => playerShip('fighter'),
    cruiser: () => playerShip('cruiser'),
    battleship: () => playerShip('battleship'),
    scout: buildScout,
    raider: () => buildFighter('raider'),
    hunter: () => buildFighter('hunter'),
    freighter: buildFreighter,
    boss: buildBossBattleship,
  };
  return broken((builders[spec.ship!] ?? builders.fighter)(), c.seed, spec.kind === 'enemy' ? 1 : 0.9);
}

// ------------------------------------------------------------------ looking one over

export type Find =
  | { type: 'metal'; amount: number; text: string }
  | { type: 'credits'; amount: number; text: string }
  | { type: 'survivor'; text: string }
  | { type: 'nothing'; text: string };

export type Trap = 'mine' | 'reactor' | 'ambush';

export interface Inspection {
  find: Find | null;
  trap: Trap | null;
}

/** What a wreck holds: decided once, from its seed, the same however it is looked at. */
export function inspect(c: Celestial): Inspection {
  const spec = wreckSpec(c);
  const r = mulberry32(c.seed * 977 + 41);
  if (r() < WRECK.trapChance) {
    const trap: Trap = spec.kind === 'station' ? 'reactor' : spec.kind === 'ancient' ? 'ambush' : r() < 0.5 ? 'mine' : 'ambush';
    return { find: null, trap };
  }
  const weights: Record<WreckKind, Array<[Find['type'], number]>> = {
    station: [['metal', 45], ['survivor', 20], ['credits', 15], ['nothing', 20]],
    player: [['metal', 40], ['survivor', 30], ['nothing', 20], ['credits', 10]],
    enemy: [['metal', 45], ['credits', 25], ['nothing', 25], ['survivor', 5]],
    ancient: [['credits', 40], ['metal', 30], ['nothing', 30]],
  };
  const list = weights[spec.kind];
  let x = r() * list.reduce((n, [, w]) => n + w, 0);
  let type: Find['type'] = 'nothing';
  for (const [t, w] of list) {
    x -= w;
    if (x <= 0) {
      type = t;
      break;
    }
  }
  const scale = spec.size / 60;
  if (type === 'metal') {
    const amount = Math.round((8 + r() * 14) * Math.min(3, scale));
    return { find: { type, amount, text: `Осмотр остова: в трюмах металл, +${amount}.` }, trap: null };
  }
  if (type === 'credits') {
    const amount = Math.round((25 + r() * 45) * Math.min(3, scale) * (spec.kind === 'ancient' ? 1.8 : 1));
    return { find: { type, amount, text: spec.kind === 'ancient' ? `Осмотр: древний тайник, +${amount} кр.` : `Осмотр остова: тайник, +${amount} кр.` }, trap: null };
  }
  if (type === 'survivor') return { find: { type, text: 'Осмотр остова: в спасательной капсуле жив космонавт. Он на борту, ранен.' }, trap: null };
  return { find: { type: 'nothing', text: 'Осмотр остова: пусто, всё вынесли до нас.' }, trap: null };
}
