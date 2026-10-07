import type { GridBody } from './body';
import type { TargetRef } from './grid';
import { MINING, isOre } from './mining';
import { WEAPONS, shipRef } from './weapons';
import { WRECK } from './wrecks';
import type { World } from './world';

/**
 * What a click (or a tap) means, and the orders it gives. One rule: a click on a thing makes it a target, a
 * click on empty space sends the ship there. An enemy becomes the guns' target and the ship flies on as it
 * was told (a second click on it at once is an attack: the autopilot keeps the guns' range round it); a rock
 * with ore becomes the beam's target and the ship comes to the beam's reach and stops; a wreck is looked
 * over: the ship comes close and stays until it is done. Orders live outside the world and steer it through
 * `world.target`, `world.hold` and `world.mineTarget`, so the sim knows nothing of clicks.
 */

export const ORDERS = {
  /** An attack keeps this share of the shortest gun range, and goes round the target this fast (rad/s). */
  attackShare: 0.75,
  attackOrbit: 0.2,
  /**
   * Mining: the ship turns its nose to the rock and stands with the tip of its nose this many cells off the rock's
   * edge, or nearer, so that the beam's turret is this share of its range from the vein; never nearer than the gap.
   */
  mineGap: 6,
  mineReach: 0.65,
  /** Seconds between looks for the vein nearest to the ship. */
  mineLook: 0.25,
  /** Looking a wreck over: the ship stays this share of the inspect range off its hull. */
  inspectShare: 0.4,
  /** A click lands on a thing within this many cells of one of its cells. */
  pickSlop: 3.5,
};

export type Order =
  | { kind: 'attack'; shipId: number; angle: number }
  | { kind: 'mine'; body: number; look: number; standX: number; standY: number; has: boolean }
  | { kind: 'inspect'; body: number };

export type Pick =
  | { kind: 'enemy'; body: GridBody; ref: TargetRef }
  | { kind: 'ore'; body: GridBody }
  | { kind: 'wreck'; body: GridBody }
  | { kind: 'space' };

/** How far a world point is from the nearest cell of a body, in cells (and that cell's centre in the body's grid), looking a few cells round. */
function nearCell(b: GridBody, wx: number, wy: number, reach: number): { d: number; x: number; y: number } | null {
  const lp = b.worldToLocal(wx, wy, { x: 0, y: 0 });
  const ix = Math.floor(lp.x);
  const iy = Math.floor(lp.y);
  const n = Math.ceil(reach);
  let best: { d: number; x: number; y: number } | null = null;
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      if (!b.grid.isOccupied(ix + i, iy + j)) continue;
      const cx = ix + i + 0.5;
      const cy = iy + j + 0.5;
      const d = Math.hypot(cx - lp.x, cy - lp.y);
      if (d <= reach && (!best || d < best.d)) best = { d, x: cx, y: cy };
    }
  }
  return best;
}

const oreSeen = new WeakMap<GridBody, { version: number; has: boolean }>();

/** Whether a rock still has any ore in it (remembered per change of the rock). */
export function hasOre(b: GridBody): boolean {
  const seen = oreSeen.get(b);
  if (seen && seen.version === b.grid.version) return seen.has;
  let has = false;
  const mat = b.grid.mat;
  for (let i = 0; i < mat.length && !has; i++) if (isOre(mat[i])) has = true;
  oreSeen.set(b, { version: b.grid.version, has });
  return has;
}

/** The enemy ship under a point, as a target on the cell clicked (or on its middle, for a click just off its hull). */
export function pickEnemy(world: World, wx: number, wy: number): TargetRef | null {
  const p = world.player;
  if (!p?.sys) return null;
  let best: { ref: TargetRef; d: number } | null = null;
  for (const b of world.bodies) {
    if (b.removed || b.kind !== 'ship' || !b.sys || b.sys.dead || b.sys.team === p.sys.team) continue;
    const near = nearCell(b, wx, wy, 3);
    if (near && near.d <= ORDERS.pickSlop) {
      if (!best || near.d < best.d) best = { ref: shipRef(b, near.x, near.y), d: near.d };
    } else {
      const dc = Math.hypot(b.x - wx, b.y - wy);
      if (dc < b.radius + 3 && (!best || dc + 4 < best.d)) best = { ref: shipRef(b), d: dc + 4 };
    }
  }
  return best ? best.ref : null;
}

/** What is under a point, for a click: an enemy first, then a rock with ore, then a wreck to look over; else empty space. */
export function pickAt(world: World, wx: number, wy: number): Pick {
  const ref = pickEnemy(world, wx, wy);
  if (ref) {
    const body = world.findShip(ref.shipId);
    if (body) return { kind: 'enemy', body, ref };
  }
  for (const b of world.bodies) {
    if (b.removed || b.kind !== 'debris') continue;
    if (Math.hypot(b.x - wx, b.y - wy) > b.radius + ORDERS.pickSlop) continue;
    if (!nearCell(b, wx, wy, ORDERS.pickSlop)) continue;
    if (hasOre(b)) return { kind: 'ore', body: b };
  }
  for (const b of world.inspectable()) {
    if (Math.hypot(b.x - wx, b.y - wy) > b.radius + ORDERS.pickSlop) continue;
    if (nearCell(b, wx, wy, ORDERS.pickSlop)) return { kind: 'wreck', body: b };
  }
  return { kind: 'space' };
}

/** The range an attack keeps: a share of the shortest range of the ship's guns that are on (the mining beam does not count). */
export function attackRange(b: GridBody): number {
  let r = Infinity;
  for (const m of b.grid.modules) {
    const w = m.weapon;
    if (!w || !w.enabled || w.type === 'miner' || m.alive <= 0) continue;
    r = Math.min(r, WEAPONS[w.type].range);
  }
  if (!isFinite(r)) r = WEAPONS.pulse.range;
  return r * ORDERS.attackShare;
}

export function attackOrder(world: World, target: GridBody): Order {
  const p = world.player;
  const angle = p ? Math.atan2(p.y - target.y, p.x - target.x) : 0;
  return { kind: 'attack', shipId: target.shipId, angle };
}

export function mineOrder(rock: GridBody): Order {
  return { kind: 'mine', body: rock.id, look: -1, standX: 0, standY: 0, has: false };
}

export function inspectOrder(wreck: GridBody): Order {
  return { kind: 'inspect', body: wreck.id };
}

/**
 * How far forward of its centre of mass a ship reaches with its nose, and how far forward its mining turret sits
 * (cells; the nose is the ship's -y). Null for the turret without a mining beam.
 */
export function noseAndBeam(b: GridBody): { nose: number; beam: number | null } {
  const g = b.grid;
  let nose = 0;
  for (let y = 0; y < g.height; y++) {
    let any = false;
    for (let x = 0; x < g.width && !any; x++) any = g.colCount[y * g.width + x] > 0;
    if (any) {
      nose = b.comY - y;
      break;
    }
  }
  let beam: number | null = null;
  for (const m of g.modules) if (m.weapon?.type === 'miner' && m.alive > 0) beam = b.comY - (g.yOf(m.core) + 0.5);
  return { nose: Math.max(0, nose), beam };
}

/** The ore cell of a rock nearest to a point, in world coordinates. */
function veinNear(rock: GridBody, x: number, y: number): { x: number; y: number } | null {
  const g = rock.grid;
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  const tmp = { x: 0, y: 0 };
  for (let i = 0; i < g.mat.length; i++) {
    if (!isOre(g.mat[i])) continue;
    rock.localToWorld(g.xOf(i) + 0.5, g.yOf(i) + 0.5, tmp);
    const d = Math.hypot(tmp.x - x, tmp.y - y);
    if (d < bd) {
      bd = d;
      best = { x: tmp.x, y: tmp.y };
    }
  }
  return best;
}

/**
 * One tick of an order: it steers the world (the point to fly to, whether to stop on it, the rock to mine) and
 * says whether it goes on. Null: the order is over (the target is gone, the rock is empty, the wreck looked over).
 */
export function stepOrder(world: World, order: Order, dt: number): Order | null {
  const p = world.player;
  if (!p || p.removed) return null;
  if (order.kind === 'attack') {
    const t = world.findShip(order.shipId);
    if (!t || t.removed || !t.sys || t.sys.dead) return null;
    world.holdFace = null;
    const r = Math.max(attackRange(p), t.radius + p.radius + 12);
    order.angle += ORDERS.attackOrbit * dt;
    world.target = { x: t.x + Math.cos(order.angle) * r, y: t.y + Math.sin(order.angle) * r };
    world.hold = true;
    return order;
  }
  if (order.kind === 'mine') {
    const rock = world.bodies.find((b) => b.id === order.body && !b.removed);
    if (!rock || !hasOre(rock)) {
      if (world.mineTarget === order.body) world.mineTarget = null;
      world.holdFace = null;
      return null;
    }
    world.mineTarget = rock.id;
    order.look -= dt;
    if (order.look <= 0 || !order.has) {
      order.look = ORDERS.mineLook;
      const v = veinNear(rock, p.x, p.y);
      if (!v) return null;
      // stand off the rock on the side of the vein nearest to the ship, nose to the rock: far enough that the nose
      // clears the rock, near enough that the beam's turret reaches the vein
      const dx = v.x - rock.x;
      const dy = v.y - rock.y;
      const dv = Math.hypot(dx, dy);
      const away = Math.hypot(p.x - rock.x, p.y - rock.y) || 1;
      const ux = dv > 1e-3 ? dx / dv : (p.x - rock.x) / away;
      const uy = dv > 1e-3 ? dy / dv : (p.y - rock.y) / away;
      const { nose, beam } = noseAndBeam(p);
      const clear = rock.radius + nose + ORDERS.mineGap;
      const reach = dv + (beam ?? 0) + MINING.range * ORDERS.mineReach;
      const off = Math.max(clear, Math.min(reach, clear + MINING.range));
      const sx = rock.x + ux * off;
      const sy = rock.y + uy * off;
      // keep the spot while the ship is near it, so it does not wander from vein to vein
      if (!order.has || Math.hypot(order.standX - sx, order.standY - sy) > MINING.range * 0.5) {
        order.standX = sx;
        order.standY = sy;
        order.has = true;
      }
    }
    world.holdFace = Math.atan2(rock.x - p.x, -(rock.y - p.y));
    world.target = { x: order.standX, y: order.standY };
    world.hold = true;
    return order;
  }
  world.holdFace = null;
  const w = world.inspectable().find((b) => b.id === order.body);
  if (!w) return null;
  const dx = p.x - w.x;
  const dy = p.y - w.y;
  const d = Math.hypot(dx, dy) || 1;
  const off = w.radius + p.radius + WRECK.inspectRange * ORDERS.inspectShare;
  // come to it on the near side, then stay put while the inspection runs
  if (!world.target || world.inspecting === null) world.target = { x: w.x + (dx / d) * off, y: w.y + (dy / d) * off };
  world.hold = true;
  return order;
}
