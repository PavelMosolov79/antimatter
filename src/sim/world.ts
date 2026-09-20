import { computeControl, type Control, type Target } from './autopilot';
import { collideGridCircle, collideGridGrid, type DamageSink } from './collision';
import { GridBody } from './body';
import { DUST_MIN_COLUMNS, splitBody, type SplitResult } from './fragment';
import { gravityAt, isSolid, type Celestial } from './gravity';
import type { ShipGrid } from './grid';
import { MATERIALS } from './materials';
import { mulberry32, type Rng } from './rng';

export type SimEvent =
  | { t: 'cell'; x: number; y: number; color: number }
  | { t: 'impact'; x: number; y: number; energy: number }
  | { t: 'split'; x: number; y: number };

const MAX_SPEED = 500;
const MAX_SPIN = 12;
const MAX_EVENTS = 2500;
const FAR_LIMIT = 40000;
const GHOST_TIME = 0.5;

const tmpPt = { x: 0, y: 0 };

export class World implements DamageSink {
  bodies: GridBody[] = [];
  celestials: Celestial[] = [];
  player: GridBody | null = null;
  time = 0;
  target: Target | null = null;
  autopilot = true;
  events: SimEvent[] = [];
  readonly rng: Rng;
  private damaged = new Set<GridBody>();
  private buf: number[] = [];
  private grav = { ax: 0, ay: 0 };
  private ctl: Control = { main: 0, back: 0, right: 0, left: 0, torque: 0 };

  constructor(seed = 1) {
    this.rng = mulberry32(seed);
  }

  spawn(grid: ShipGrid, x: number, y: number, angle = 0, kind: 'ship' | 'debris' = 'ship'): GridBody {
    const b = new GridBody(grid, x, y, angle, kind);
    this.bodies.push(b);
    return b;
  }

  spawnPlayer(grid: ShipGrid, x: number, y: number, angle = 0): GridBody {
    const b = this.spawn(grid, x, y, angle, 'ship');
    b.isPlayer = true;
    this.player = b;
    return b;
  }

  gravityAt(x: number, y: number): { ax: number; ay: number } {
    gravityAt(this.celestials, x, y, this.grav);
    return this.grav;
  }

  removeBody(b: GridBody): void {
    b.removed = true;
    this.damaged.delete(b);
    if (this.player === b) this.player = null;
  }

  private push(e: SimEvent): void {
    if (this.events.length < MAX_EVENTS) this.events.push(e);
  }

  hitColumn(body: GridBody, x: number, y: number, dmg: number, pen: number): number {
    this.buf.length = 0;
    const n = body.grid.damageColumn(x, y, dmg, pen, this.buf);
    if (n > 0) {
      this.flushDestroyed(body);
      this.damaged.add(body);
    }
    return body.grid.lastAbsorbed;
  }

  impact(wx: number, wy: number, energy: number): void {
    this.push({ t: 'impact', x: wx, y: wy, energy });
  }

  private flushDestroyed(body: GridBody): void {
    const buf = this.buf;
    for (let k = 0; k < buf.length; k += 4) {
      const p = body.localToWorld(buf[k] + 0.5, buf[k + 1] + 0.5, tmpPt);
      this.push({ t: 'cell', x: p.x, y: p.y, color: MATERIALS[buf[k + 3]].color });
    }
  }

  damageCrater(body: GridBody, wx: number, wy: number, radius: number, dmg: number, pen: number): number {
    const lp = body.worldToLocal(wx, wy, tmpPt);
    this.buf.length = 0;
    const n = body.grid.applyCrater(lp.x, lp.y, radius, dmg, pen, this.buf);
    if (n > 0) {
      this.flushDestroyed(body);
      this.damaged.add(body);
    }
    return n;
  }

  explode(wx: number, wy: number, radius: number, dmg: number, pen: number): number {
    let total = 0;
    for (const b of this.bodies) {
      if (b.removed) continue;
      const d = Math.hypot(b.x - wx, b.y - wy);
      if (d > radius + b.radius) continue;
      total += this.damageCrater(b, wx, wy, radius, dmg, pen);
    }
    this.impact(wx, wy, dmg * radius * 4);
    this.processDamaged();
    return total;
  }

  processDamaged(): void {
    if (this.damaged.size > 0) {
      const list = [...this.damaged];
      this.damaged.clear();
      for (const b of list) {
        if (b.removed) continue;
        b.syncMassProps();
        if (b.grid.columns === 0 || b.mass <= 0) {
          this.removeBody(b);
          continue;
        }
        const res = splitBody(b, this.rng, this.time);
        if (res) {
          this.replace(b, res);
        } else if (b.kind === 'debris' && b.grid.columns < DUST_MIN_COLUMNS) {
          this.dustBody(b);
        }
      }
    }
    this.bodies = this.bodies.filter((b) => !b.removed);
  }

  private dustBody(b: GridBody): void {
    const g = b.grid;
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const z = g.topLayer(x, y);
        if (z < 0) continue;
        const p = b.localToWorld(x + 0.5, y + 0.5, tmpPt);
        this.push({ t: 'cell', x: p.x, y: p.y, color: MATERIALS[g.mat[g.idx(x, y, z)]].color });
      }
    }
    this.removeBody(b);
  }

  private replace(b: GridBody, res: SplitResult): void {
    const wasPlayer = this.player === b;
    this.removeBody(b);
    for (const piece of res.pieces) this.bodies.push(piece);
    if (wasPlayer) this.player = res.main;
    for (const d of res.dust) this.push({ t: 'cell', x: d.x, y: d.y, color: d.color });
    this.push({ t: 'split', x: b.x, y: b.y });
  }

  step(dt: number): void {
    this.time += dt;

    const p = this.player;
    if (p && !p.removed) {
      const eng = p.engineSummary();
      const g = this.gravityAt(p.x, p.y);
      const ctl = this.ctl;
      if (this.autopilot) computeControl(p, this.target, g.ax, g.ay, eng, ctl);
      else {
        ctl.main = 0;
        ctl.back = 0;
        ctl.right = 0;
        ctl.left = 0;
        ctl.torque = 0;
      }
      p.throttle = ctl.main;
      p.tBack = ctl.back;
      p.tRight = ctl.right;
      p.tLeft = ctl.left;
      p.rcsTorque = ctl.torque;
      const th = ctl.main;
      const fx = eng.fx * th + eng.capRight * ctl.right - eng.capLeft * ctl.left;
      const fy = eng.fy * th + eng.capBack * ctl.back;
      p.vx += (p.c * fx - p.s * fy) * p.invMass * dt;
      p.vy += (p.s * fx + p.c * fy) * p.invMass * dt;
      p.w += (eng.torque * th + ctl.torque) * p.invInertia * dt;
    }

    for (const b of this.bodies) {
      const g = this.gravityAt(b.x, b.y);
      b.vx += g.ax * dt;
      b.vy += g.ay * dt;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > MAX_SPEED) {
        b.vx *= MAX_SPEED / sp;
        b.vy *= MAX_SPEED / sp;
      }
      if (b.w > MAX_SPIN) b.w = MAX_SPIN;
      else if (b.w < -MAX_SPIN) b.w = -MAX_SPIN;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.angle += b.w * dt;
      b.syncTrig();
    }

    this.collide();
    this.processDamaged();

    for (const b of this.bodies) {
      if (b.kind === 'debris' && Math.hypot(b.x, b.y) > FAR_LIMIT) this.removeBody(b);
    }
    this.bodies = this.bodies.filter((b) => !b.removed);
  }

  private collide(): void {
    const bodies = this.bodies;
    for (const c of this.celestials) {
      if (isSolid(c)) {
        for (const b of bodies) if (!b.removed) collideGridCircle(this, b, c);
      } else {
        for (const b of bodies) if (!b.removed) this.consume(b, c);
      }
    }
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (a.removed) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (b.removed) continue;
        if (a.splitTag !== 0 && a.splitTag === b.splitTag && this.time - Math.max(a.splitTime, b.splitTime) < GHOST_TIME) continue;
        collideGridGrid(this, a, b);
      }
    }
  }

  private consume(b: GridBody, c: Celestial): void {
    const dx = b.x - c.x;
    const dy = b.y - c.y;
    const lim = c.radius + b.radius;
    if (dx * dx + dy * dy > lim * lim) return;
    const g = b.grid;
    const r2 = c.radius * c.radius;
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        if (g.colCount[y * g.width + x] === 0) continue;
        const p = b.localToWorld(x + 0.5, y + 0.5, tmpPt);
        const ex = p.x - c.x;
        const ey = p.y - c.y;
        if (ex * ex + ey * ey < r2) this.hitColumn(b, x, y, 1e9, 1);
      }
    }
  }
}
