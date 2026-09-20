import { ShipGrid } from './grid';
import { Mat } from './materials';

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

function tuneEngines(grid: ShipGrid, accel: number, rcsPerThrust: number): void {
  const engines = grid.modules.filter((m) => m.kind === 'engine');
  const totalCells = engines.reduce((s, m) => s + m.total, 0);
  const totalThrust = accel * grid.mass;
  for (const m of engines) {
    m.thrust = (totalThrust * m.total) / totalCells;
    m.rcs = m.thrust * rcsPerThrust;
  }
}

export interface ShipSpec {
  id: string;
  label: string;
  build: () => ShipGrid;
}

export function buildFighter(): ShipGrid {
  const g = hullShip(31, 44, 3, [
    [0, 0],
    [3, 1.5],
    [9, 3.5],
    [16, 5],
    [20, 6],
    [35, 15],
    [40, 15],
    [40.01, 7],
    [44, 6.5],
  ]);
  addEngine(g, 13, 40, 5, 4);
  addEngine(g, 4, 36, 3, 4);
  addEngine(g, 24, 36, 3, 4);
  addBlock(g, 13, 14, 5, 4, 1);
  addBlock(g, 13, 26, 5, 6, 1);
  addBlock(g, 14, 20, 3, 3, 2);
  tuneEngines(g, 30, 10);
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
  addBlock(g, 21, 16, 7, 6, 1);
  addBlock(g, 20, 30, 9, 8, 1);
  addBlock(g, 21, 32, 7, 4, 2);
  addBlock(g, 10, 48, 6, 6, 1);
  addBlock(g, 33, 48, 6, 6, 1);
  addBlock(g, 20, 52, 9, 8, 2);
  addBlock(g, 22, 54, 5, 4, 3);
  tuneEngines(g, 18, 20);
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
  { id: 'fighter', label: 'Истребитель', build: buildFighter },
  { id: 'cruiser', label: 'Крейсер', build: buildCruiser },
];
