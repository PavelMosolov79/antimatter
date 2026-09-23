import { GridBody } from './body';
import { remapRoomGraph } from './compartments';
import { remapCrew } from './crew';
import { ShipGrid, type Module } from './grid';
import { MATERIALS } from './materials';
import type { Rng } from './rng';

export const DUST_MIN_COLUMNS = 3;

export interface DustCell {
  x: number;
  y: number;
  color: number;
}

export interface SplitResult {
  main: GridBody | null;
  pieces: GridBody[];
  dust: DustCell[];
}

interface Components {
  labels: Int32Array;
  count: number;
  columns: number[];
  mass: number[];
}

export function findComponents(grid: ShipGrid): Components {
  const { width: w, height: h, layerSize } = grid;
  const labels = new Int32Array(layerSize).fill(-1);
  const stack = new Int32Array(layerSize);
  const columns: number[] = [];
  const mass: number[] = [];
  let count = 0;
  for (let start = 0; start < layerSize; start++) {
    if (grid.colCount[start] === 0 || labels[start] !== -1) continue;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = count;
    let cols = 0;
    let m = 0;
    while (sp > 0) {
      const c = stack[--sp];
      cols++;
      const x = c % w;
      const y = (c - x) / w;
      for (let z = 0; z < grid.depth; z++) m += MATERIALS[grid.mat[grid.idx(x, y, z)]].mass;
      if (x > 0 && grid.colCount[c - 1] > 0 && labels[c - 1] === -1) {
        labels[c - 1] = count;
        stack[sp++] = c - 1;
      }
      if (x < w - 1 && grid.colCount[c + 1] > 0 && labels[c + 1] === -1) {
        labels[c + 1] = count;
        stack[sp++] = c + 1;
      }
      if (y > 0 && grid.colCount[c - w] > 0 && labels[c - w] === -1) {
        labels[c - w] = count;
        stack[sp++] = c - w;
      }
      if (y < h - 1 && grid.colCount[c + w] > 0 && labels[c + w] === -1) {
        labels[c + w] = count;
        stack[sp++] = c + w;
      }
    }
    columns.push(cols);
    mass.push(m);
    count++;
  }
  return { labels, count, columns, mass };
}

function extractComponent(src: ShipGrid, labels: Int32Array, label: number): { grid: ShipGrid; bx: number; by: number; moduleMap: number[] } {
  const { width: w, height: h, depth } = src;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] !== label) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const grid = new ShipGrid(maxX - minX + 1, maxY - minY + 1, depth);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (labels[y * w + x] !== label) continue;
      for (let z = 0; z < depth; z++) grid.copyCellFrom(src, src.idx(x, y, z), x - minX, y - minY, z);
    }
  }
  const moduleMap: number[] = new Array(src.modules.length).fill(-1);
  for (let mi = 0; mi < src.modules.length; mi++) {
    const m = src.modules[mi];
    const cells: number[] = [];
    let core = -1;
    for (const i of m.cells) {
      if (src.mat[i] === 0) continue;
      const x = src.xOf(i);
      const y = src.yOf(i);
      if (labels[y * w + x] !== label) continue;
      const ni = grid.idx(x - minX, y - minY, src.zOf(i));
      cells.push(ni);
      if (i === m.core) core = ni;
    }
    if (cells.length === 0) continue;
    moduleMap[mi] = grid.modules.length;
    const nm: Module = {
      kind: m.kind,
      cells,
      total: m.total,
      alive: cells.length,
      core,
      coreAlive: m.coreAlive && core !== -1,
      thrust: m.thrust,
      rcs: m.rcs,
      dirX: m.dirX,
      dirY: m.dirY,
      weapon: m.weapon ? { ...m.weapon } : undefined,
      power: m.power,
      capacity: m.capacity,
      blast: m.blast,
      shieldMax: m.shieldMax,
      regen: m.regen,
    };
    grid.modules.push(nm);
    const id = grid.modules.length;
    for (const i of cells) grid.mod[i] = id;
  }
  for (const d of src.doors) {
    if (src.mat[d.cell] === 0) continue;
    const x = src.xOf(d.cell);
    const y = src.yOf(d.cell);
    if (labels[y * w + x] !== label) continue;
    const ni = grid.idx(x - minX, y - minY, src.zOf(d.cell));
    grid.doors.push({ cell: ni, open: d.open, destroyed: d.destroyed });
    grid.doorIdx[ni] = grid.doors.length;
  }
  return { grid, bx: minX, by: minY, moduleMap };
}

export function splitBody(body: GridBody, rng: Rng, time: number): SplitResult | null {
  const comps = findComponents(body.grid);
  if (comps.count <= 1) return null;

  let mainLabel = 0;
  for (let i = 1; i < comps.count; i++) if (comps.mass[i] > comps.mass[mainLabel]) mainLabel = i;

  const pieces: GridBody[] = [];
  const dust: DustCell[] = [];
  let main: GridBody | null = null;
  let mainBx = 0;
  let mainBy = 0;
  let mainModuleMap: number[] = [];
  let kickPx = 0;
  let kickPy = 0;
  const g = body.grid;
  const ox = body.x;
  const oy = body.y;

  for (let label = 0; label < comps.count; label++) {
    if (comps.columns[label] < DUST_MIN_COLUMNS) {
      for (let y = 0; y < g.height; y++) {
        for (let x = 0; x < g.width; x++) {
          if (comps.labels[y * g.width + x] !== label) continue;
          const z = g.topLayer(x, y);
          const p = body.localToWorld(x + 0.5, y + 0.5, { x: 0, y: 0 });
          dust.push({ x: p.x, y: p.y, color: MATERIALS[g.mat[g.idx(x, y, z)]].color });
        }
      }
      continue;
    }
    const { grid, bx, by, moduleMap } = extractComponent(g, comps.labels, label);
    const mp = grid.massProps();
    const wp = body.localToWorld(mp.comX + bx, mp.comY + by, { x: 0, y: 0 });
    const piece = new GridBody(grid, wp.x, wp.y, body.angle, label === mainLabel ? body.kind : 'debris');
    const v = body.pointVelocity(wp.x, wp.y, { x: 0, y: 0 });
    piece.vx = v.x;
    piece.vy = v.y;
    piece.w = body.w;
    piece.splitTag = body.id;
    piece.splitTime = time;
    piece.frameX = body.frameX + bx;
    piece.frameY = body.frameY + by;
    piece.team = -1;
    if (label === mainLabel) {
      main = piece;
      mainBx = bx;
      mainBy = by;
      mainModuleMap = moduleMap;
    } else {
      const dx = wp.x - ox;
      const dy = wp.y - oy;
      const d = Math.hypot(dx, dy) || 1;
      const kick = 1.5 + rng() * 2;
      piece.vx += (dx / d) * kick;
      piece.vy += (dy / d) * kick;
      kickPx += piece.mass * (dx / d) * kick;
      kickPy += piece.mass * (dy / d) * kick;
      piece.w += (rng() - 0.5) * 0.8;
    }
    pieces.push(piece);
  }
  if (main) {
    main.isPlayer = body.isPlayer;
    main.shipId = body.shipId;
    main.team = body.team;
    main.sys = body.sys;
    main.vx -= kickPx / main.mass;
    main.vy -= kickPy / main.mass;
    if (main.sys?.rooms && main.sys.rooms.grid === g) {
      main.sys.rooms = remapRoomGraph(main.sys.rooms, main.grid, mainBx, mainBy);
    }
    if (main.sys?.crew) {
      main.sys.crew = remapCrew(main.sys.crew, main.grid, mainBx, mainBy, mainModuleMap);
    }
  }
  return { main, pieces, dust };
}
