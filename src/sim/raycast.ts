import type { GridBody } from './body';

const STEP = 0.4;

export function segmentVsCells(b: GridBody, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const cx = b.x - x0;
  const cy = b.y - y0;
  const tc = len2 > 0 ? Math.max(0, Math.min(1, (cx * dx + cy * dy) / len2)) : 0;
  const px = x0 + dx * tc - b.x;
  const py = y0 + dy * tc - b.y;
  if (px * px + py * py > b.radius * b.radius) return -1;

  const ax = b.comX + b.c * (x0 - b.x) + b.s * (y0 - b.y);
  const ay = b.comY - b.s * (x0 - b.x) + b.c * (y0 - b.y);
  const bx = b.comX + b.c * (x1 - b.x) + b.s * (y1 - b.y);
  const by = b.comY - b.s * (x1 - b.x) + b.c * (y1 - b.y);
  const len = Math.sqrt(len2);
  const steps = Math.max(1, Math.ceil(len / STEP));
  const g = b.grid;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const lx = ax + (bx - ax) * t;
    const ly = ay + (by - ay) * t;
    if (g.isOccupied(Math.floor(lx), Math.floor(ly))) return t;
  }
  return -1;
}

export function shieldRadius(b: GridBody): number {
  return b.radius + 1.5;
}

export function segmentVsShield(b: GridBody, x0: number, y0: number, x1: number, y1: number): number {
  const R = shieldRadius(b);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - b.x;
  const fy = y0 - b.y;
  if (fx * fx + fy * fy < R * R) return -1;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return -1;
  const bb = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - R * R;
  const disc = bb * bb - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t = (-bb - sq) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
