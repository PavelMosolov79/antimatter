import type { GridBody } from './body';
import { nearestHostile, resolveTarget, shipRef } from './weapons';
import { moduleCentroid } from './systems';
import type { Rng } from './rng';
import type { World } from './world';

export type AiKind = 'scout' | 'raider' | 'hunter';

export interface AiState {
  kind: AiKind;
  nextThink: number;
  orbit: 1 | -1;
  flipAt: number;
}

interface AiParams {
  range: number;
  orbitAngle: number;
}

const PARAMS: Record<AiKind, AiParams> = {
  scout: { range: 150, orbitAngle: 0.6 },
  raider: { range: 95, orbitAngle: 0.45 },
  hunter: { range: 75, orbitAngle: 0.35 },
};

export function createAi(kind: AiKind, rng: Rng): AiState {
  return { kind, nextThink: rng() * 0.2, orbit: rng() < 0.5 ? 1 : -1, flipAt: 6 + rng() * 6 };
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

  const ref = nearestHostile(world, b);
  const tp = resolveTarget(world, ref);
  if (!tp) {
    sys.nav = { target: null, face: null };
    sys.focus = null;
    return;
  }
  const foe = tp.body;
  const p = PARAMS[ai.kind];
  const hullLow = b.grid.cells < sys.cellsMax * 0.45;
  const range = p.range * (hullLow ? 1.7 : 1);

  let dx = b.x - foe.x;
  let dy = b.y - foe.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  const a = p.orbitAngle * ai.orbit;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  sys.nav = {
    target: { x: foe.x + rx * range, y: foe.y + ry * range },
    face: Math.atan2(foe.x - b.x, -(foe.y - b.y)),
  };

  if (ai.kind === 'hunter') {
    const rc = moduleCentroid(foe, 'reactor');
    sys.focus = rc ? shipRef(foe, rc.x, rc.y) : ref;
  } else {
    sys.focus = null;
  }
}
