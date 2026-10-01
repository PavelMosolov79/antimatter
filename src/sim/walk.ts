import type { ShipGrid } from './grid';
import { Mat } from './materials';

export interface Step {
  x: number;
  y: number;
  z: number;
}

function walkable(grid: ShipGrid, z: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
  const m = grid.mat[grid.idx(x, y, z)];
  return m !== 0 && m !== Mat.WALL;
}

/** Can a crew member walk the straight line between two points on a deck without touching a wall? */
function clear(grid: ShipGrid, z: number, ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(d * 3));
  for (let k = 0; k <= n; k++) {
    const x = Math.floor(ax + ((bx - ax) * k) / n);
    const y = Math.floor(ay + ((by - ay) * k) / n);
    if (!walkable(grid, z, x, y)) return false;
  }
  return true;
}

/**
 * The way from one point of a deck to another around walls: a shortest walk over free
 * cells, pulled straight wherever the line is clear. A room with a module in the middle
 * isn't convex, so a straight line from door to door would go through it.
 */
export function walkPath(grid: ShipGrid, z: number, from: { x: number; y: number }, to: { x: number; y: number }): Array<{ x: number; y: number }> {
  if (clear(grid, z, from.x, from.y, to.x, to.y)) return [{ x: to.x, y: to.y }];
  const w = grid.width;
  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  const tx = Math.floor(to.x);
  const ty = Math.floor(to.y);
  if (!walkable(grid, z, tx, ty)) return [{ x: to.x, y: to.y }];
  const prev = new Int32Array(w * grid.height).fill(-2);
  const start = sy * w + sx;
  const goal = ty * w + tx;
  prev[start] = -1;
  const queue = [start];
  for (let qi = 0; qi < queue.length && prev[goal] === -2; qi++) {
    const c = queue[qi];
    const cx = c % w;
    const cy = (c - cx) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(grid, z, nx, ny)) continue;
      const ni = ny * w + nx;
      if (prev[ni] !== -2) continue;
      prev[ni] = c;
      queue.push(ni);
    }
  }
  if (prev[goal] === -2) return [{ x: to.x, y: to.y }];
  const cells: Array<{ x: number; y: number }> = [];
  for (let c = goal; c !== -1; c = prev[c]) cells.push({ x: (c % w) + 0.5, y: Math.floor(c / w) + 0.5 });
  cells.reverse();
  cells[cells.length - 1] = { x: to.x, y: to.y };
  // Pull the path straight: from each anchor, jump to the farthest point it can see.
  const out: Array<{ x: number; y: number }> = [];
  let anchor = { x: from.x, y: from.y };
  let i = 0;
  while (i < cells.length) {
    let far = i;
    for (let j = cells.length - 1; j > i; j--) {
      if (clear(grid, z, anchor.x, anchor.y, cells[j].x, cells[j].y)) {
        far = j;
        break;
      }
    }
    out.push(cells[far]);
    anchor = cells[far];
    i = far + 1;
  }
  return out;
}

/** Expands a list of waypoints so that every leg on one deck goes around the walls. */
export function refineRoute(grid: ShipGrid, start: Step, waypoints: Step[]): Step[] {
  const out: Step[] = [];
  let at: Step = start;
  for (const wp of waypoints) {
    if (wp.z === at.z && at.z >= 1 && at.z < grid.depth) {
      for (const p of walkPath(grid, at.z, at, wp)) out.push({ x: p.x, y: p.y, z: wp.z });
    } else out.push(wp);
    at = wp;
  }
  return out;
}
