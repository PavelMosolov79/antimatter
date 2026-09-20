import { moduleEfficiency, type ShipGrid } from './grid';

let nextBodyId = 1;

export type BodyKind = 'ship' | 'debris';

export interface EngineSummary {
  fx: number;
  fy: number;
  torque: number;
  rcs: number;
  maneuver: number;
  thrust: number;
  alive: number;
  total: number;
}

const tmpPt = { x: 0, y: 0 };

export class GridBody {
  readonly id = nextBodyId++;
  readonly grid: ShipGrid;
  kind: BodyKind;
  x = 0;
  y = 0;
  angle = 0;
  vx = 0;
  vy = 0;
  w = 0;
  c = 1;
  s = 0;
  mass = 0;
  invMass = 0;
  comX = 0;
  comY = 0;
  inertia = 1;
  invInertia = 0;
  radius = 0;
  isPlayer = false;
  removed = false;
  splitTag = 0;
  splitTime = -1;
  throttle = 0;
  rcsTorque = 0;
  rcsAx = 0;
  rcsAy = 0;
  private initialized = false;

  constructor(grid: ShipGrid, x: number, y: number, angle: number, kind: BodyKind) {
    this.grid = grid;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.kind = kind;
    this.syncTrig();
    this.syncMassProps();
  }

  syncTrig(): void {
    this.c = Math.cos(this.angle);
    this.s = Math.sin(this.angle);
  }

  syncMassProps(): void {
    const p = this.grid.massProps();
    if (this.initialized) {
      const dxl = p.comX - this.comX;
      const dyl = p.comY - this.comY;
      const ox = this.c * dxl - this.s * dyl;
      const oy = this.s * dxl + this.c * dyl;
      this.vx += -this.w * oy;
      this.vy += this.w * ox;
      this.x += ox;
      this.y += oy;
    }
    this.initialized = true;
    this.mass = p.mass;
    this.comX = p.comX;
    this.comY = p.comY;
    this.inertia = p.inertia;
    this.invMass = p.mass > 0 ? 1 / p.mass : 0;
    this.invInertia = p.mass > 0 ? 1 / p.inertia : 0;
    this.radius = this.computeRadius();
  }

  private computeRadius(): number {
    const g = this.grid;
    let max2 = 0;
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        if (g.colCount[y * g.width + x] === 0) continue;
        const dx = x + 0.5 - this.comX;
        const dy = y + 0.5 - this.comY;
        const d2 = dx * dx + dy * dy;
        if (d2 > max2) max2 = d2;
      }
    }
    return Math.sqrt(max2) + 0.75;
  }

  localToWorld(lx: number, ly: number, out = tmpPt): { x: number; y: number } {
    const dx = lx - this.comX;
    const dy = ly - this.comY;
    out.x = this.x + this.c * dx - this.s * dy;
    out.y = this.y + this.s * dx + this.c * dy;
    return out;
  }

  worldToLocal(wx: number, wy: number, out = tmpPt): { x: number; y: number } {
    const dx = wx - this.x;
    const dy = wy - this.y;
    out.x = this.comX + this.c * dx + this.s * dy;
    out.y = this.comY - this.s * dx + this.c * dy;
    return out;
  }

  pointVelocity(wx: number, wy: number, out = tmpPt): { x: number; y: number } {
    out.x = this.vx - this.w * (wy - this.y);
    out.y = this.vy + this.w * (wx - this.x);
    return out;
  }

  engineSummary(): EngineSummary {
    const g = this.grid;
    let fx = 0;
    let fy = 0;
    let torque = 0;
    let rcs = 0;
    let maneuver = 0;
    let alive = 0;
    let total = 0;
    for (const m of g.modules) {
      if (m.kind !== 'engine') continue;
      total++;
      const eff = moduleEfficiency(m);
      if (eff <= 0) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const i of m.cells) {
        if (g.mat[i] === 0) continue;
        sx += g.xOf(i) + 0.5;
        sy += g.yOf(i) + 0.5;
        n++;
      }
      if (n === 0) continue;
      alive++;
      const f = m.thrust * eff;
      const fxi = m.dirX * f;
      const fyi = m.dirY * f;
      const rx = sx / n - this.comX;
      const ry = sy / n - this.comY;
      fx += fxi;
      fy += fyi;
      torque += rx * fyi - ry * fxi;
      rcs += m.rcs * eff;
      maneuver += m.maneuver * eff;
    }
    return { fx, fy, torque, rcs, maneuver, thrust: Math.hypot(fx, fy), alive, total };
  }
}
