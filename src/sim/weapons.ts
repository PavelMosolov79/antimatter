import type { GridBody } from './body';
import { moduleEfficiency, type TargetRef, type WeaponType } from './grid';
import { segmentVsCells, segmentVsShield } from './raycast';
import { absorbShield, shieldActive, spendEnergy } from './systems';
import type { World } from './world';

export interface WeaponDef {
  type: WeaponType;
  label: string;
  short: string;
  color: number;
  range: number;
  turnRate: number;
  rof: number;
  energy: number;
  speed: number;
  damage: number;
  radius: number;
  pen: number;
  dps: number;
  energyPerSec: number;
}

export const WEAPONS: Record<WeaponType, WeaponDef> = {
  pulse: {
    type: 'pulse',
    label: 'Импульсный лазер',
    short: 'ИМП',
    color: 0x8ff0ff,
    range: 260,
    turnRate: 3.5,
    rof: 4,
    energy: 5,
    speed: 340,
    damage: 30,
    radius: 1.3,
    pen: 0.45,
    dps: 0,
    energyPerSec: 0,
  },
  heavy: {
    type: 'heavy',
    label: 'Тяжёлый лазер',
    short: 'ТЯЖ',
    color: 0xffb347,
    range: 340,
    turnRate: 1.5,
    rof: 0.45,
    energy: 42,
    speed: 190,
    damage: 240,
    radius: 4,
    pen: 1,
    dps: 0,
    energyPerSec: 0,
  },
  beam: {
    type: 'beam',
    label: 'Лучевой лазер',
    short: 'ЛУЧ',
    color: 0xff6a6a,
    range: 200,
    turnRate: 2.2,
    rof: 0,
    energy: 0,
    speed: 0,
    damage: 0,
    radius: 1.1,
    pen: 0.9,
    dps: 130,
    energyPerSec: 16,
  },
};

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  pen: number;
  team: number;
  shipId: number;
  life: number;
  type: WeaponType;
  color: number;
  skip: number[];
}

export interface Beam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: number;
  team: number;
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export interface TargetPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  body: GridBody;
}

export function resolveTarget(world: World, ref: TargetRef | null): TargetPoint | null {
  if (!ref) return null;
  const s = world.findShip(ref.shipId);
  if (!s) return null;
  const p = s.localToWorld(ref.fx - s.frameX, ref.fy - s.frameY, { x: 0, y: 0 });
  const v = s.pointVelocity(p.x, p.y, { x: 0, y: 0 });
  return { x: p.x, y: p.y, vx: v.x, vy: v.y, body: s };
}

export function shipRef(b: GridBody, lx?: number, ly?: number): TargetRef {
  return { shipId: b.shipId, fx: (lx ?? b.comX) + b.frameX, fy: (ly ?? b.comY) + b.frameY };
}

export function nearestHostile(world: World, b: GridBody): TargetRef | null {
  const sys = b.sys;
  if (!sys) return null;
  let best: GridBody | null = null;
  let bd = Infinity;
  for (const o of world.bodies) {
    if (o.removed || o.kind !== 'ship' || !o.sys || o.sys.dead || o.sys.team === sys.team) continue;
    const d = Math.hypot(o.x - b.x, o.y - b.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best ? shipRef(best) : null;
}

export function interceptAngle(sx: number, sy: number, t: TargetPoint, speed: number): number {
  const rx = t.x - sx;
  const ry = t.y - sy;
  let time = Math.hypot(rx, ry) / speed;
  const a = t.vx * t.vx + t.vy * t.vy - speed * speed;
  const b = 2 * (rx * t.vx + ry * t.vy);
  const c = rx * rx + ry * ry;
  if (Math.abs(a) < 1e-6) {
    if (b < 0) time = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      const cand = [t1, t2].filter((v) => v > 0).sort((p, q) => p - q);
      if (cand.length > 0) time = cand[0];
    }
  }
  const ax = rx + t.vx * time;
  const ay = ry + t.vy * time;
  return Math.atan2(ax, -ay);
}

interface SegHit {
  t: number;
  body: GridBody;
  shield: boolean;
}

function castSegment(world: World, x0: number, y0: number, x1: number, y1: number, team: number, skip: number[]): SegHit | null {
  let best: SegHit | null = null;
  for (const o of world.bodies) {
    if (o.removed || (team >= 0 && o.team === team)) continue;
    if (o.sys && shieldActive(o.sys) && !skip.includes(o.id)) {
      const ts = segmentVsShield(o, x0, y0, x1, y1);
      if (ts >= 0 && (!best || ts < best.t)) best = { t: ts, body: o, shield: true };
    }
    const tc = segmentVsCells(o, x0, y0, x1, y1);
    if (tc >= 0 && (!best || tc < best.t)) best = { t: tc, body: o, shield: false };
  }
  return best;
}

function resolveHit(world: World, hit: SegHit, x0: number, y0: number, x1: number, y1: number, damage: number, radius: number, pen: number, skip: number[]): { done: boolean; damage: number } {
  const hx = x0 + (x1 - x0) * hit.t;
  const hy = y0 + (y1 - y0) * hit.t;
  if (hit.shield) {
    const overflow = absorbShield(hit.body.sys!, damage, world.time);
    world.push({ t: 'shield', x: hx, y: hy, shipId: hit.body.shipId });
    if (overflow <= 0) return { done: true, damage: 0 };
    skip.push(hit.body.id);
    return { done: false, damage: overflow };
  }
  world.damageCrater(hit.body, hx, hy, radius, damage, pen);
  world.impact(hx, hy, damage * 6);
  return { done: true, damage: 0 };
}

export function stepProjectiles(world: World, dt: number): void {
  const out: Projectile[] = [];
  for (const p of world.projectiles) {
    p.life -= dt;
    if (p.life <= 0) continue;
    const x0 = p.x;
    const y0 = p.y;
    const x1 = x0 + p.vx * dt;
    const y1 = y0 + p.vy * dt;
    let alive = true;
    for (let guard = 0; guard < 4; guard++) {
      const hit = castSegment(world, x0, y0, x1, y1, p.team, p.skip);
      if (!hit) break;
      const r = resolveHit(world, hit, x0, y0, x1, y1, p.damage, p.radius, p.pen, p.skip);
      if (r.done) {
        alive = false;
        break;
      }
      p.damage = r.damage;
    }
    if (!alive) continue;
    p.x = x1;
    p.y = y1;
    out.push(p);
  }
  world.projectiles = out;
}

function fireBeam(world: World, x0: number, y0: number, dirx: number, diry: number, def: WeaponDef, team: number, dt: number): void {
  const x1 = x0 + dirx * def.range;
  const y1 = y0 + diry * def.range;
  const skip: number[] = [];
  let dmg = def.dps * dt;
  let ex = x1;
  let ey = y1;
  for (let guard = 0; guard < 3; guard++) {
    const hit = castSegment(world, x0, y0, x1, y1, team, skip);
    if (!hit) break;
    ex = x0 + (x1 - x0) * hit.t;
    ey = y0 + (y1 - y0) * hit.t;
    const r = resolveHit(world, hit, x0, y0, x1, y1, dmg, def.radius, def.pen, skip);
    if (r.done) break;
    dmg = r.damage;
  }
  world.beams.push({ x0, y0, x1: ex, y1: ey, color: def.color, team });
}

export function updateWeapons(world: World, dt: number): void {
  for (const b of world.bodies) {
    const sys = b.sys;
    if (b.removed || !sys || sys.dead) continue;
    if (world.time - sys.autoTime > 0.3) {
      sys.autoTime = world.time;
      sys.autoTarget = nearestHostile(world, b);
    }
    for (const m of b.grid.modules) {
      const w = m.weapon;
      if (m.kind !== 'turret' || !w) continue;
      const def = WEAPONS[w.type];
      const eff = moduleEfficiency(m);
      w.firing = false;
      w.cooldown = Math.max(0, w.cooldown - dt);
      if (eff <= 0) continue;

      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const i of m.cells) {
        if (b.grid.mat[i] === 0) continue;
        sx += b.grid.xOf(i) + 0.5;
        sy += b.grid.yOf(i) + 0.5;
        n++;
      }
      if (n === 0) continue;
      const mount = b.localToWorld(sx / n, sy / n, { x: 0, y: 0 });

      let tp = resolveTarget(world, w.target);
      if (!tp) tp = resolveTarget(world, sys.focus);
      if (!tp) tp = resolveTarget(world, sys.autoTarget);

      let desired = 0;
      let inArc = false;
      let dist = Infinity;
      if (tp) {
        dist = Math.hypot(tp.x - mount.x, tp.y - mount.y);
        const aimWorld = def.type === 'beam' ? Math.atan2(tp.x - mount.x, -(tp.y - mount.y)) : interceptAngle(mount.x, mount.y, tp, def.speed);
        const rel = wrapPi(aimWorld - b.angle - w.arcCenter);
        inArc = Math.abs(rel) <= w.arcHalf;
        desired = Math.max(-w.arcHalf, Math.min(w.arcHalf, rel));
      }
      const step = def.turnRate * dt * eff;
      w.off += Math.max(-step, Math.min(step, desired - w.off));

      if (!tp || !w.enabled || !inArc || dist > def.range || Math.abs(desired - w.off) > 0.05) continue;

      const ang = b.angle + w.arcCenter + w.off;
      const dx = Math.sin(ang);
      const dy = -Math.cos(ang);
      const mx = mount.x + dx * 2.4;
      const my = mount.y + dy * 2.4;

      if (def.type === 'beam') {
        if (spendEnergy(sys, def.energyPerSec * dt)) {
          w.firing = true;
          fireBeam(world, mx, my, dx, dy, def, sys.team, dt * eff);
        }
      } else if (w.cooldown <= 0 && spendEnergy(sys, def.energy)) {
        w.cooldown = 1 / (def.rof * eff);
        world.projectiles.push({
          x: mx,
          y: my,
          vx: dx * def.speed,
          vy: dy * def.speed,
          damage: def.damage,
          radius: def.radius,
          pen: def.pen,
          team: sys.team,
          shipId: b.shipId,
          life: def.range / def.speed,
          type: def.type,
          color: def.color,
          skip: [],
        });
        world.push({ t: 'shot', x: mx, y: my, color: def.color });
      }
    }
  }
}
