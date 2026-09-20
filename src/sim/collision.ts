import type { GridBody } from './body';
import type { Celestial } from './gravity';

export interface DamageSink {
  hitColumn(body: GridBody, x: number, y: number, dmg: number, pen: number): number;
  impact(wx: number, wy: number, energy: number): void;
}

export const COLLISION = {
  restitution: 0.2,
  friction: 0.25,
  minImpactSpeed: 3,
  damagePerEnergy: 0.002,
  maxDamage: 4000,
  penetration: 0.5,
  maxCorrection: 2,
  correctionFactor: 0.7,
};

const OCC_WINDOW = 3;

const contactS: number[] = [];
const contactL: number[] = [];
const cwx: number[] = [];
const cwy: number[] = [];
const nrm = { x: 0, y: 0 };
const tmp = { x: 0, y: 0 };
const va = { x: 0, y: 0 };
const vb = { x: 0, y: 0 };

function outwardNormal(b: GridBody, wx: number, wy: number, out: { x: number; y: number }): void {
  const lp = b.worldToLocal(wx, wy, tmp);
  const ix = Math.floor(lp.x);
  const iy = Math.floor(lp.y);
  let gx = 0;
  let gy = 0;
  for (let j = -OCC_WINDOW; j <= OCC_WINDOW; j++) {
    for (let i = -OCC_WINDOW; i <= OCC_WINDOW; i++) {
      if (b.grid.isOccupied(ix + i, iy + j)) {
        gx -= i;
        gy -= j;
      }
    }
  }
  out.x = b.c * gx - b.s * gy;
  out.y = b.s * gx + b.c * gy;
  const len = Math.hypot(out.x, out.y);
  if (len > 1e-6) {
    out.x /= len;
    out.y /= len;
  } else {
    out.x = 0;
    out.y = 0;
  }
}

function resolveContact(
  sink: DamageSink,
  a: GridBody,
  b: GridBody | null,
  px: number,
  py: number,
  nx: number,
  ny: number,
  depth: number,
  aCols: number[],
  bCols: number[],
): void {
  const invA = a.invMass;
  const invB = b ? b.invMass : 0;
  const invIA = a.invInertia;
  const invIB = b ? b.invInertia : 0;
  const invSum = invA + invB;
  if (invSum <= 0) return;

  const rAx = px - a.x;
  const rAy = py - a.y;
  const rBx = b ? px - b.x : 0;
  const rBy = b ? py - b.y : 0;
  a.pointVelocity(px, py, va);
  if (b) b.pointVelocity(px, py, vb);
  else {
    vb.x = 0;
    vb.y = 0;
  }
  const rvx = va.x - vb.x;
  const rvy = va.y - vb.y;
  const vn = rvx * nx + rvy * ny;

  if (vn < 0) {
    const raN = rAx * ny - rAy * nx;
    const rbN = rBx * ny - rBy * nx;
    const denom = invSum + raN * raN * invIA + rbN * rbN * invIB;
    const j = (-(1 + COLLISION.restitution) * vn) / denom;
    a.vx += j * nx * invA;
    a.vy += j * ny * invA;
    a.w += invIA * j * raN;
    if (b) {
      b.vx -= j * nx * invB;
      b.vy -= j * ny * invB;
      b.w -= invIB * j * rbN;
    }

    const tx = -ny;
    const ty = nx;
    a.pointVelocity(px, py, va);
    if (b) b.pointVelocity(px, py, vb);
    const vt = (va.x - vb.x) * tx + (va.y - vb.y) * ty;
    const raT = rAx * ty - rAy * tx;
    const rbT = rBx * ty - rBy * tx;
    const denomT = invSum + raT * raT * invIA + rbT * rbT * invIB;
    let jt = -vt / denomT;
    const maxJt = COLLISION.friction * j;
    if (jt > maxJt) jt = maxJt;
    if (jt < -maxJt) jt = -maxJt;
    a.vx += jt * tx * invA;
    a.vy += jt * ty * invA;
    a.w += invIA * jt * raT;
    if (b) {
      b.vx -= jt * tx * invB;
      b.vy -= jt * ty * invB;
      b.w -= invIB * jt * rbT;
    }

    const closing = -vn;
    if (closing > COLLISION.minImpactSpeed) {
      const reduced = 1 / invSum;
      const energy = 0.5 * reduced * closing * closing;
      const total = Math.min(energy * COLLISION.damagePerEnergy, COLLISION.maxDamage);
      const perA = aCols.length > 0 ? total / aCols.length : 0;
      for (const c of aCols) sink.hitColumn(a, c % a.grid.width, Math.floor(c / a.grid.width), perA, COLLISION.penetration);
      if (b) {
        const perB = bCols.length > 0 ? total / bCols.length : 0;
        for (const c of bCols) sink.hitColumn(b, c % b.grid.width, Math.floor(c / b.grid.width), perB, COLLISION.penetration);
      }
      sink.impact(px, py, energy);
    }
  }

  const corr = (Math.min(depth * COLLISION.correctionFactor, COLLISION.maxCorrection)) / invSum;
  a.x += nx * corr * invA;
  a.y += ny * corr * invA;
  if (b) {
    b.x -= nx * corr * invB;
    b.y -= ny * corr * invB;
  }
}

export function collideGridGrid(sink: DamageSink, A: GridBody, B: GridBody): void {
  const ddx = B.x - A.x;
  const ddy = B.y - A.y;
  const rr = A.radius + B.radius;
  if (ddx * ddx + ddy * ddy > rr * rr) return;

  let S = A;
  let L = B;
  if (A.grid.columns > B.grid.columns) {
    S = B;
    L = A;
  }
  const g = S.grid;
  const lg = L.grid;
  contactS.length = 0;
  contactL.length = 0;
  cwx.length = 0;
  cwy.length = 0;
  const lr2 = L.radius * L.radius;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (g.colCount[y * g.width + x] === 0) continue;
      const ldx = x + 0.5 - S.comX;
      const ldy = y + 0.5 - S.comY;
      const wx = S.x + S.c * ldx - S.s * ldy;
      const wy = S.y + S.s * ldx + S.c * ldy;
      const pdx = wx - L.x;
      const pdy = wy - L.y;
      if (pdx * pdx + pdy * pdy > lr2) continue;
      const lx = L.comX + L.c * pdx + L.s * pdy;
      const ly = L.comY - L.s * pdx + L.c * pdy;
      const ix = Math.floor(lx);
      const iy = Math.floor(ly);
      if (!lg.isOccupied(ix, iy)) continue;
      contactS.push(y * g.width + x);
      contactL.push(iy * lg.width + ix);
      cwx.push(wx);
      cwy.push(wy);
      sumX += wx;
      sumY += wy;
    }
  }
  const n = contactS.length;
  if (n === 0) return;

  const px = sumX / n;
  const py = sumY / n;

  const nS = { x: 0, y: 0 };
  const nL = { x: 0, y: 0 };
  outwardNormal(S, px, py, nS);
  outwardNormal(L, px, py, nL);
  let nx = nL.x - nS.x;
  let ny = nL.y - nS.y;
  let len = Math.hypot(nx, ny);
  const sepx = S.x - L.x;
  const sepy = S.y - L.y;
  if (len < 0.2) {
    nx = sepx;
    ny = sepy;
    len = Math.hypot(nx, ny);
  }
  if (len < 1e-6) return;
  nx /= len;
  ny /= len;
  if (nx * sepx + ny * sepy < 0) {
    nx = -nx;
    ny = -ny;
  }

  const tx = -ny;
  const ty = nx;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = cwx[i] * tx + cwy[i] * ty;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  const depth = Math.min(n / (tMax - tMin + 1), 4);

  resolveContact(sink, S, L, px, py, nx, ny, depth, contactS, contactL);
}

export function collideGridCircle(sink: DamageSink, A: GridBody, c: Celestial): void {
  const dx = A.x - c.x;
  const dy = A.y - c.y;
  const lim = c.radius + A.radius;
  if (dx * dx + dy * dy > lim * lim) return;

  const g = A.grid;
  contactS.length = 0;
  const r2 = (c.radius + 0.5) * (c.radius + 0.5);
  let sumX = 0;
  let sumY = 0;
  let maxPen = 0;
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (g.colCount[y * g.width + x] === 0) continue;
      const ldx = x + 0.5 - A.comX;
      const ldy = y + 0.5 - A.comY;
      const wx = A.x + A.c * ldx - A.s * ldy;
      const wy = A.y + A.s * ldx + A.c * ldy;
      const ex = wx - c.x;
      const ey = wy - c.y;
      const d2 = ex * ex + ey * ey;
      if (d2 >= r2) continue;
      const pen = c.radius + 0.5 - Math.sqrt(d2);
      if (pen > maxPen) maxPen = pen;
      contactS.push(y * g.width + x);
      sumX += wx;
      sumY += wy;
    }
  }
  const n = contactS.length;
  if (n === 0) return;
  const px = sumX / n;
  const py = sumY / n;
  nrm.x = px - c.x;
  nrm.y = py - c.y;
  let len = Math.hypot(nrm.x, nrm.y);
  if (len < 1e-6) {
    nrm.x = A.x - c.x;
    nrm.y = A.y - c.y;
    len = Math.hypot(nrm.x, nrm.y);
    if (len < 1e-6) return;
  }
  resolveContact(sink, A, null, px, py, nrm.x / len, nrm.y / len, maxPen, contactS, []);
}
