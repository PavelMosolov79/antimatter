import type { GridBody } from './body';
import { nearestHostile, resolveTarget, shipRef } from './weapons';
import { moduleCentroid } from './systems';
import type { Rng } from './rng';
import type { World } from './world';

export type AiKind = 'scout' | 'raider' | 'hunter';

/**
 * What a computer ship knows of the enemy (GDD 9.3.2): on patrol it flies its route (or holds its post) and sees
 * nothing beyond its sensing radius; whoever comes inside it, or hits it, sets off the alarm for its whole group;
 * after a moment to turn round it fights; an enemy that keeps out of reach long enough is lost, searched for at
 * the place last seen, and then the patrol goes back to its route.
 */
export type Aware = 'patrol' | 'alert' | 'fight' | 'search';

export interface AiState {
  kind: AiKind;
  nextThink: number;
  orbit: 1 | -1;
  flipAt: number;
  aware: Aware;
  /** Ships of one group are alarmed together (0: alone). */
  group: number;
  /** How far it sees (cells). */
  sense: number;
  /** The patrol route (a loop) and the leg it is on; with no route it holds `post`. */
  route: Array<{ x: number; y: number }> | null;
  leg: number;
  post: { x: number; y: number } | null;
  /** When the alarm went off, how long the enemy has been out of reach, the place it was last seen, the end of the search. */
  alertAt: number;
  lostFor: number;
  lastSeen: { x: number; y: number } | null;
  searchUntil: number;
}

export const AI_SENSE = {
  /** The sensing radius by kind of ship (cells); a capital ship sees further. Not balanced. */
  radius: { scout: 600, raider: 420, hunter: 380 } as Record<AiKind, number>,
  capital: 700,
  /** Seconds to turn round on the alarm before fighting. */
  turn: 1,
  /** Out of this many radii for this many seconds, the enemy is lost; the search lasts this long. */
  loseAt: 1.7,
  loseAfter: 6,
  search: 8,
  /** A hit taken this recently sets off the alarm. */
  hitAlarm: 0.3,
  /** A patrol goes this fast a share of what it can (cells a second it aims at round its route). */
  patrolReach: 30,
};

interface AiParams {
  range: number;
  orbitAngle: number;
}

/**
 * How ships flown by the computer keep clear of each other and of whatever else floats near (rocks, wrecks,
 * hulks): every think the point a ship flies for is pushed away from its neighbours, and a ship about to cross
 * another's path steps aside. Without it two of the same kind want the same spot round their target and ram.
 */
export const AI_SPACING = {
  /** Air kept between two hulls, in cells, on top of both bounding radii. */
  gap: 16,
  /** A neighbour is felt from this many times that distance; inside it the push grows to its full share. */
  feel: 1.6,
  /** The push, as a share of the distance kept, at full strength; and the most the point is ever moved. */
  push: 1.4,
  maxPush: 110,
  /** A crossing seen this many seconds ahead makes the younger ship (or the one meeting a ship that does not give way) step aside this far. */
  lookAhead: 2.5,
  sidestep: 50,
  /** Floating things smaller than this radius are not worth going round. */
  minObstacle: 6,
};

const PARAMS: Record<AiKind, AiParams> = {
  scout: { range: 150, orbitAngle: 0.6 },
  raider: { range: 95, orbitAngle: 0.45 },
  hunter: { range: 75, orbitAngle: 0.35 },
};

export function createAi(kind: AiKind, rng: Rng): AiState {
  return {
    kind,
    nextThink: rng() * 0.2,
    orbit: rng() < 0.5 ? 1 : -1,
    flipAt: 6 + rng() * 6,
    // a ship nobody sets on patrol fights at once, as before (waves, ambushes, the sandbox)
    aware: 'fight',
    group: 0,
    sense: AI_SENSE.radius[kind],
    route: null,
    leg: 0,
    post: null,
    alertAt: -100,
    lostFor: 0,
    lastSeen: null,
    searchUntil: 0,
  };
}

/** Puts a ship on patrol: round a route (a loop of points) or at a post, in a group that is alarmed together. */
export function setPatrol(ai: AiState, group: number, route: Array<{ x: number; y: number }> | null, post: { x: number; y: number } | null, sense?: number): void {
  ai.aware = 'patrol';
  ai.group = group;
  ai.route = route && route.length ? route : null;
  ai.leg = 0;
  ai.post = post;
  if (sense !== undefined) ai.sense = sense;
}

/** Whether the ship is fighting (its guns fire only then). */
export const engaged = (ai: AiState): boolean => ai.aware === 'fight' || ai.aware === 'alert';

/** The alarm for a whole group (or the one ship, alone): it turns on whoever set it off. */
export function raiseAlarm(world: World, b: GridBody, at: { x: number; y: number }): void {
  const ai = b.sys?.ai;
  if (!ai) return;
  const all = ai.group === 0 ? [b] : world.bodies.filter((o) => !o.removed && o.sys?.ai && !o.sys.dead && o.sys.ai.group === ai.group);
  for (const o of all) {
    const a = o.sys!.ai!;
    if (engaged(a)) continue;
    a.aware = 'alert';
    a.alertAt = world.time;
    a.lostFor = 0;
    a.lastSeen = { x: at.x, y: at.y };
  }
}

/** The nearest enemy of a ship within a reach (or null). */
function hostileWithin(world: World, b: GridBody, reach: number): GridBody | null {
  let best: GridBody | null = null;
  let bd = reach;
  for (const o of world.bodies) {
    if (o.removed || o.kind !== 'ship' || !o.sys || o.sys.dead || o.sys.team === b.sys!.team) continue;
    const d = Math.hypot(o.x - b.x, o.y - b.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** On patrol or searching: watch for an enemy, else fly the route, hold the post, or look round where it was seen. */
function watch(world: World, b: GridBody, ai: AiState): void {
  const sys = b.sys!;
  sys.focus = null;
  const seen = hostileWithin(world, b, ai.sense);
  const hit = world.time - sys.lastHit < AI_SENSE.hitAlarm;
  if (seen || hit) {
    const at = seen ?? (nearestHostile(world, b) ? world.findShip(nearestHostile(world, b)!.shipId) : null);
    raiseAlarm(world, b, at ? { x: at.x, y: at.y } : { x: b.x, y: b.y });
    return;
  }
  let goal: { x: number; y: number } | null = null;
  if (ai.aware === 'search') {
    if (world.time > ai.searchUntil) {
      ai.aware = 'patrol';
      ai.lastSeen = null;
    } else goal = ai.lastSeen;
  }
  if (!goal && ai.route) {
    const r = ai.route[ai.leg % ai.route.length];
    if (Math.hypot(r.x - b.x, r.y - b.y) < 60) ai.leg = (ai.leg + 1) % ai.route.length;
    // not all the way to the point, so the ship cruises rather than stops at every one
    const n = ai.route[ai.leg % ai.route.length];
    const dx = n.x - b.x;
    const dy = n.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, AI_SENSE.patrolReach * 4);
    goal = { x: b.x + (dx / d) * step, y: b.y + (dy / d) * step };
  }
  if (!goal) goal = ai.post;
  const away = keepClear(world, b, null);
  sys.nav = goal ? { target: { x: goal.x + away.x, y: goal.y + away.y }, face: null } : { target: Math.hypot(away.x, away.y) > 1 ? { x: b.x + away.x, y: b.y + away.y } : null, face: null };
}

export function updateAi(world: World, b: GridBody): void {
  const sys = b.sys;
  const ai = sys?.ai;
  if (!sys || !ai || sys.dead || world.time < ai.nextThink) return;
  ai.nextThink = world.time + 0.2;
  if (world.time > ai.flipAt) {
    ai.orbit = ai.orbit === 1 ? -1 : 1;
    ai.flipAt = world.time + 6 + world.rng() * 8;
  }

  if (ai.aware === 'patrol' || ai.aware === 'search') {
    watch(world, b, ai);
    return;
  }
  const ref = nearestHostile(world, b);
  const tp = resolveTarget(world, ref);
  // the alarm: a moment to turn round, then the fight; an enemy kept out of reach long enough is lost
  if (ai.aware === 'alert' && world.time - ai.alertAt >= AI_SENSE.turn) ai.aware = 'fight';
  if (tp && (ai.route || ai.post)) {
    const far = Math.hypot(tp.body.x - b.x, tp.body.y - b.y) > ai.sense * AI_SENSE.loseAt;
    ai.lostFor = far ? ai.lostFor + 0.2 : 0;
    if (!far) ai.lastSeen = { x: tp.body.x, y: tp.body.y };
    if (ai.lostFor >= AI_SENSE.loseAfter) {
      ai.aware = 'search';
      ai.searchUntil = world.time + AI_SENSE.search;
      ai.lostFor = 0;
      watch(world, b, ai);
      return;
    }
  }
  if (!tp) {
    // nobody to fight: drift, but still out of each other's way
    const away = keepClear(world, b, null);
    const idle = Math.hypot(away.x, away.y) < 1;
    sys.nav = { target: idle ? null : { x: b.x + away.x, y: b.y + away.y }, face: null };
    sys.focus = null;
    return;
  }
  const foe = tp.body;
  const p = PARAMS[ai.kind];
  const hullLow = b.grid.cells < sys.cellsMax * 0.45;
  // Big hulls keep a berth proportional to both ships' size; for the small classes this
  // never exceeds their own preferred range, so it only ever pushes a capital ship out.
  const range = Math.max(p.range, (b.radius + foe.radius) * 1.3) * (hullLow ? 1.7 : 1);

  let dx = b.x - foe.x;
  let dy = b.y - foe.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  const a = p.orbitAngle * ai.orbit;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  const tx = foe.x + rx * range;
  const ty = foe.y + ry * range;
  const away = keepClear(world, b, foe);
  if (away.giveWay) {
    // about to cross another's path: stop short and step aside this think; one meeting an ally head on turns its orbit round too
    const o = away.giveWay;
    if (o.sys?.ai && b.vx * o.vx + b.vy * o.vy < 0) {
      ai.orbit = ai.orbit === 1 ? -1 : 1;
      ai.flipAt = world.time + 6 + world.rng() * 8;
    }
    sys.nav = { target: { x: b.x + away.x, y: b.y + away.y }, face: Math.atan2(foe.x - b.x, -(foe.y - b.y)) };
    return;
  }
  // a push off a neighbour must not bring the ship in onto its own target: the point stays out at the range
  let px = tx + away.x - foe.x;
  let py = ty + away.y - foe.y;
  const pd = Math.hypot(px, py) || 1;
  const least = Math.max(range, b.radius + foe.radius + AI_SPACING.gap * 1.5);
  if (pd < least) {
    px *= least / pd;
    py *= least / pd;
  }
  sys.nav = {
    target: { x: foe.x + px, y: foe.y + py },
    face: Math.atan2(foe.x - b.x, -(foe.y - b.y)),
  };

  if (ai.kind === 'hunter') {
    const rc = moduleCentroid(foe, 'reactor');
    sys.focus = rc ? shipRef(foe, rc.x, rc.y) : ref;
  } else {
    sys.focus = null;
  }
}

/**
 * How far to move the point a ship flies for, so it keeps clear of the others: pushed off every neighbour it is
 * too close to (ships, living or dead, and floating bodies big enough to matter), and aside from one whose path
 * it is about to cross. The target it is fighting is left out: its own range keeps that distance.
 */
export function keepClear(world: World, b: GridBody, foe: GridBody | null): { x: number; y: number; giveWay: GridBody | null } {
  const S = AI_SPACING;
  let ox = 0;
  let oy = 0;
  let giveWay: GridBody | null = null;
  let tooClose: GridBody | null = null;
  let soonest = Infinity;
  let sx = 0;
  let sy = 0;
  for (const o of world.bodies) {
    if (o === b || o === foe || o.removed) continue;
    if (o.kind !== 'ship' && o.radius < S.minObstacle) continue;
    const ex = b.x - o.x;
    const ey = b.y - o.y;
    const d = Math.hypot(ex, ey) || 0.01;
    const keep = b.radius + o.radius + S.gap;
    const feel = keep * S.feel;
    if (d < feel) {
      const k = ((feel - d) / feel) * keep * S.push;
      ox += (ex / d) * k;
      oy += (ey / d) * k;
    }
    // already closer than the air kept: no waiting for a crossing, both back off from each other now
    if (d < keep && o.kind === 'ship' && !tooClose) tooClose = o;
    // a crossing ahead: where the two will be closest, if that is soon and too close
    const rvx = b.vx - o.vx;
    const rvy = b.vy - o.vy;
    const rv2 = rvx * rvx + rvy * rvy;
    if (rv2 < 1e-3) continue;
    const tc = -(ex * rvx + ey * rvy) / rv2;
    if (tc <= 0 || tc > S.lookAhead) continue;
    const cx = ex + rvx * tc;
    const cy = ey + rvy * tc;
    const cd = Math.hypot(cx, cy);
    if (cd >= keep) continue;
    // the younger of two computer ships gives way; anyone else (the player, a hulk, a rock) does not, so this one does
    const givesWay = !o.sys?.ai || o.sys.dead || b.shipId > o.shipId;
    if (!givesWay) continue;
    // aside, on the side it would pass anyway (or to its right if it would hit dead on)
    let nx = cx;
    let ny = cy;
    if (cd < 1e-3) {
      const rv = Math.sqrt(rv2);
      nx = -rvy / rv;
      ny = rvx / rv;
    } else {
      nx /= cd;
      ny /= cd;
    }
    if (tc < soonest) {
      soonest = tc;
      giveWay = o;
      sx = nx * S.sidestep;
      sy = ny * S.sidestep;
    }
  }
  // giving way: the step aside is the whole answer (plus the push off whoever is too close)
  if (giveWay) {
    ox += sx;
    oy += sy;
  }
  if (!giveWay && tooClose) {
    giveWay = tooClose;
    // the push alone, made at least a full step long
    const m0 = Math.hypot(ox, oy) || 1;
    const k = Math.max(1, S.sidestep / m0);
    ox *= k;
    oy *= k;
  }
  const m = Math.hypot(ox, oy);
  if (m > S.maxPush) {
    ox *= S.maxPush / m;
    oy *= S.maxPush / m;
  }
  return { x: ox, y: oy, giveWay };
}
