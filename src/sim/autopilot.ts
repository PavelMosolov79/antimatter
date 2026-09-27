import type { EngineSummary, GridBody } from './body';

/**
 * Flight control: turns a target point (and optionally a heading to hold) into drive
 * commands. Two modes share one controller:
 * - 'stop' (autopilot on): fly to the point and come to rest on it;
 * - 'pass' (autopilot off): fly to the point without braking for it — once it is reached
 *   or passed the point is done and the ship coasts on at the speed it has.
 *
 * Each tick the controller decides one acceleration the ship should have, then has every
 * drive produce its share of it at once — main drives forward, brakes back, maneuvering
 * nozzles sideways — whatever the nose is doing. The heading is chosen so the nose looks
 * at the point and only swings away from it as far as the nozzles alone can't manage,
 * which changes smoothly with the situation instead of flipping between strategies.
 */

export interface Control {
  main: number;
  back: number;
  right: number;
  left: number;
  /** Net torque wanted on the ship (the propulsion makes it from whatever can turn). */
  torque: number;
  /** 'stop': at rest on the point; 'pass': the point was reached or passed. */
  arrived: boolean;
  /** The heading the controller is bringing the nose to, if any (for display). */
  heading: number | null;
}

export interface Target {
  x: number;
  y: number;
}

export type NavMode = 'stop' | 'pass';

export const AUTOPILOT = {
  /** Cruise speed: this many seconds of full main-drive thrust. */
  speedTime: 2.2,
  /** Share of the braking capacity a stop is planned with (the rest is margin). */
  brakeShare: 0.7,
  /** Planned deceleration with the nose brakes gone (turn round and burn). */
  flipShare: 0.45,
  /** Velocity-error time constant, s: how briskly the speed is corrected. */
  velTau: 0.7,
  /** Final approach: over the last stretch speed eases to distance / this many seconds. */
  finalTau: 0.5,
  /** Closer than this the nose stops following the point (it would swing wildly). */
  holdDist: 14,
  /** Close in, an acceleration this big the drives can't give facing as they are turns the nose. */
  stuckAccel: 0.5,
  /** At rest: inside this distance and under this speed, with no gravity, nothing fires. */
  restDist: 0.6,
  restSpeed: 0.5,
  /** 'pass' mode: the point counts as reached inside this distance. */
  passDist: 6,
  /** Accelerations smaller than this (per axis) aren't worth firing a drive for. */
  deadband: 0.05,
  /** Brakes weaker than this share of the main drives count as gone (flip and burn). */
  weakBrakes: 0.2,
  /** Sideways drift the side nozzles are trusted with before the nose starts to lead. */
  sideTrust: 0.8,
  /** The most the nose ever leads off the point into a drift (rad, ~25°)... */
  maxLead: 0.45,
  /** ...reached when the drift wants this share of the main drives beyond the side nozzles. */
  leadAt: 0.5,
  /** Share of the side nozzles' power a drift is planned to be killed with on the way in. */
  driftShare: 0.7,
  /** The main drives stay off while the nose is further than this off its heading (rad)... */
  alignOff: 0.6,
  /** ...and open up fully once it's within this. */
  alignOn: 0.15,
  turnKp: 2.6,
  turnGain: 5,
  /** Share of the turning authority a turn is planned with. */
  turnShare: 0.5,
  maxTurnRate: 1.6,
};

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

interface Caps {
  fwd: number;
  back: number;
  side: number;
}

/**
 * How hard the ship can accelerate in a direction `g` radians off its nose: the largest
 * k with k·(cos g, sin g) inside the box of what the drives can push each way.
 */
function reach(g: number, caps: Caps): number {
  const c = Math.cos(g);
  const s = Math.abs(Math.sin(g));
  let k = Infinity;
  if (c > 1e-6) k = Math.min(k, caps.fwd / c);
  else if (c < -1e-6) k = Math.min(k, caps.back / -c);
  if (s > 1e-6) k = Math.min(k, caps.side / s);
  return k;
}

/**
 * The heading to fly with: the nose goes to the point. Sideways drift is mostly the side
 * nozzles' job; when they can't keep up, the nose leads a little into the drift so the
 * main drives help kill it — never by more than a small angle, and growing smoothly with
 * the need (pointing straight at the point with a big drift would just orbit it). Only a
 * ship whose brakes are gone turns tail to brake on its main drives.
 */
function chooseHeading(bearing: number, ux: number, uy: number, ax: number, ay: number, caps: Caps): number {
  const P = AUTOPILOT;
  const along = ax * ux + ay * uy;
  const across = -ax * uy + ay * ux;
  if (caps.back < P.weakBrakes * caps.fwd && along < -P.deadband) {
    // Flip and burn: the only way left to slow down is the main drives.
    return Math.atan2(ax, -ay);
  }
  const excess = Math.max(0, Math.abs(across) - P.sideTrust * caps.side);
  return bearing + Math.sign(across) * P.maxLead * clamp01(excess / (P.leadAt * caps.fwd));
}

/** Wanted angular acceleration to bring the nose round to `want` without overshooting. */
function turnAccel(body: GridBody, want: number | null, alphaMax: number): number {
  const P = AUTOPILOT;
  const err = want === null ? 0 : wrapPi(want - body.angle);
  const absErr = Math.abs(err);
  let wDes = Math.sign(err) * Math.min(Math.sqrt(2 * alphaMax * P.turnShare * absErr), P.turnKp * absErr, P.maxTurnRate);
  if (!Number.isFinite(wDes)) wDes = 0;
  return Math.max(-alphaMax, Math.min(alphaMax, P.turnGain * (wDes - body.w)));
}

export function computeControl(
  body: GridBody,
  target: Target | null,
  gx: number,
  gy: number,
  eng: EngineSummary,
  out: Control,
  faceAngle: number | null = null,
  mode: NavMode = 'stop',
): void {
  const P = AUTOPILOT;
  const m = body.mass > 0 ? body.mass : 1;
  const caps: Caps = { fwd: eng.thrust / m, back: eng.capBack / m, side: Math.min(eng.capRight, eng.capLeft) / m };
  const alphaMax = eng.rcs / body.inertia;
  const hx = body.s;
  const hy = -body.c;
  const rx = body.c;
  const ry = body.s;
  out.main = 0;
  out.back = 0;
  out.right = 0;
  out.left = 0;
  out.arrived = false;
  out.heading = faceAngle;

  let heading: number | null = faceAngle;
  let ax = 0;
  let ay = 0;
  const anyCap = caps.fwd + caps.back + caps.side > 1e-6;
  const gravity = Math.hypot(gx, gy);
  let settle = false;

  if (target && anyCap) {
    const tx = target.x - body.x;
    const ty = target.y - body.y;
    const dist = Math.hypot(tx, ty);
    const ux = dist > 1e-6 ? tx / dist : 0;
    const uy = dist > 1e-6 ? ty / dist : 0;
    const speed = Math.hypot(body.vx, body.vy);
    const vToward = body.vx * ux + body.vy * uy;
    const cruise = P.speedTime * Math.max(caps.fwd, caps.back, caps.side);

    if (mode === 'pass' && (dist < P.passDist || (dist < P.passDist * 4 && vToward < 0))) {
      // Reached (or just shot past) — the point is done; keep whatever speed we have.
      out.arrived = true;
      out.torque = turnAccel(body, faceAngle, alphaMax) * body.inertia;
      return;
    }
    if (mode === 'stop' && dist < P.restDist && speed < P.restSpeed && gravity < 0.05) {
      // On the point: just soak up what's left of the motion and fire nothing more.
      out.arrived = true;
      ax = -body.vx / P.velTau;
      ay = -body.vy / P.velTau;
      settle = true;
    }

    if (!settle) {
      // Speed wanted along the line to the point.
      let vDes: number;
      let ff = 0;
      if (mode === 'pass') {
        vDes = Math.max(cruise, vToward);
      } else {
        // Plan the stop on what can actually push back along the line: the nose brakes
        // while the nose is on the point, whatever faces that way once it's held still
        // for the last stretch; with the brakes gone, turning round and burning.
        const back = reach(Math.atan2(-ux * rx - uy * ry, -(ux * hx + uy * hy)), caps);
        const decel = back < P.weakBrakes * caps.fwd ? P.flipShare * caps.fwd : P.brakeShare * Math.min(back, caps.fwd);
        // One smooth braking curve: constant deceleration far out, easing into a gentle
        // glide (speed ∝ distance) over the last stretch, so the ship settles on the point
        // instead of overshooting it.
        const c = decel * P.finalTau;
        const vBrake = Math.sqrt(c * c + 2 * decel * dist) - c;
        vDes = Math.min(cruise, vBrake);
        // Don't rush the point while still drifting past it: close in no faster than the
        // drift can be killed on the way, or the ship swings round the point in an arc.
        // Counted on the side nozzles alone — the main drives are off while braking.
        const drift = Math.abs(body.vx * uy - body.vy * ux);
        if (drift > 1 && caps.side > 1e-6) vDes = Math.min(vDes, (P.driftShare * dist * caps.side) / drift);
        // On the braking curve, lean into the deceleration it asks for rather than lag it.
        if (vBrake <= cruise && vToward > 0) ff = ((decel * vToward) / (vToward + c)) * clamp01(vToward / Math.max(vDes, 1e-3));
      }
      // The acceleration wanted: close the gap to that velocity (killing any sideways
      // drift), lean into the braking curve, and hold against gravity.
      ax = (ux * vDes - body.vx) / P.velTau - ux * ff - gx;
      ay = (uy * vDes - body.vy) / P.velTau - uy * ff - gy;

      if (faceAngle === null && caps.fwd > 1e-6) {
        if (dist > P.holdDist) heading = chooseHeading(Math.atan2(ux, -uy), ux, uy, ax, ay, caps);
        else {
          // Close in, the nose stays put — unless the drives facing the way it is simply
          // can't push where the ship has to go (brakes gone): then it turns to face that.
          const a = Math.hypot(ax, ay);
          const dir = Math.atan2(ax, -ay);
          if (a > P.stuckAccel && reach(wrapPi(dir - body.angle), caps) < 0.5 * a) heading = dir;
        }
      }
    }
  } else if (target === null && gravity > 0 && anyCap && mode === 'stop') {
    // No point to fly to: an autopilot still keeps the ship from falling.
    ax = -gx;
    ay = -gy;
  }

  // Everything fires together: split the wanted acceleration along the ship's axes.
  // Settling on the point there's no deadband — the last of the motion is soaked up to zero.
  const db = settle ? 0 : P.deadband;
  const af = ax * hx + ay * hy;
  const ar = ax * rx + ay * ry;
  if (af > db && caps.fwd > 1e-6) out.main = clamp01(af / caps.fwd);
  else if (af < -db && caps.back > 1e-6) out.back = clamp01(-af / caps.back);
  if (ar > db && caps.side > 1e-6) out.right = clamp01(ar / (eng.capRight / m));
  else if (ar < -db && caps.side > 1e-6) out.left = clamp01(-ar / (eng.capLeft / m));

  // No burning on the turn: the main drives wait until the nose is (nearly) round, then
  // open up smoothly. Brakes and side nozzles keep working all through the turn.
  if (out.main > 0 && heading !== null) {
    const err = Math.abs(wrapPi(heading - body.angle));
    out.main *= clamp01((P.alignOff - err) / (P.alignOff - P.alignOn));
  }

  // A lopsided main drive twists the ship; never burn harder than the nose can hold straight.
  const fullTorque = Math.abs(eng.torque);
  if (out.main > 0 && fullTorque > 1e-6) out.main = Math.min(out.main, Math.max(0.1, (0.9 * eng.rcs) / fullTorque));

  out.heading = heading;
  out.torque = turnAccel(body, heading, alphaMax) * body.inertia;
}
