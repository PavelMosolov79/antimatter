import type { EngineSummary, GridBody } from './body';

export interface Control {
  throttle: number;
  torque: number;
}

export interface Target {
  x: number;
  y: number;
}

export const AUTOPILOT = {
  speedTime: 3.2,
  brakeFactor: 0.6,
  kv: 1.3,
  stopRadius: 1.5,
  turnKp: 3,
  turnGain: 6,
  maxTurnRate: 3.5,
  alignMin: 0.8,
};

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function computeControl(
  body: GridBody,
  target: Target | null,
  gx: number,
  gy: number,
  eng: EngineSummary,
  out: Control,
): void {
  const P = AUTOPILOT;
  const rcs = eng.rcs;
  const alphaMax = rcs / body.inertia;
  const aMax = body.mass > 0 ? eng.thrust / body.mass : 0;
  const dirAngle = eng.thrust > 0 ? Math.atan2(eng.fx, -eng.fy) : 0;

  let wantHeading: number | null = null;
  let throttleWanted = 0;

  if (target && aMax > 1e-6) {
    const tx = target.x - body.x;
    const ty = target.y - body.y;
    const dist = Math.hypot(tx, ty);
    const ux = dist > 1e-6 ? tx / dist : 0;
    const uy = dist > 1e-6 ? ty / dist : 0;
    const vToward = body.vx * ux + body.vy * uy;
    const vmax = P.speedTime * aMax;
    const tFlip = alphaMax > 1e-6 ? Math.min(2 * Math.sqrt(Math.PI / alphaMax), 6) : 6;
    const distEff = Math.max(dist - P.stopRadius - 0.5 * Math.max(vToward, 0) * tFlip, 0);
    const vDesSpeed = Math.min(vmax, Math.sqrt(2 * P.brakeFactor * aMax * distEff));
    const acx = P.kv * (ux * vDesSpeed - body.vx) - gx;
    const acy = P.kv * (uy * vDesSpeed - body.vy) - gy;
    const amag = Math.hypot(acx, acy);
    if (amag > 0.25) {
      wantHeading = Math.atan2(acx, -acy) - dirAngle;
      throttleWanted = Math.min(1, amag / aMax);
    }
  }

  const err = wantHeading === null ? 0 : wrapPi(wantHeading - body.angle);
  const absErr = Math.abs(err);
  let wDes = Math.sign(err) * Math.min(Math.sqrt(2 * alphaMax * 0.7 * absErr), P.turnKp * absErr);
  wDes = Math.max(-P.maxTurnRate, Math.min(P.maxTurnRate, wDes));
  const alphaCmd = Math.max(-alphaMax, Math.min(alphaMax, P.turnGain * (wDes - body.w)));

  let throttle = 0;
  if (wantHeading !== null) {
    const align = Math.max(0, Math.min(1, (Math.cos(err) - P.alignMin) / (1 - P.alignMin)));
    throttle = throttleWanted * align;
    const fullTorque = Math.abs(eng.torque);
    if (fullTorque > 1e-6) {
      const cap = Math.max(0.1, Math.min(1, (0.9 * rcs) / fullTorque));
      if (throttle > cap) throttle = cap;
    }
  }

  const torque = Math.max(-rcs, Math.min(rcs, alphaCmd * body.inertia - eng.torque * throttle));
  out.throttle = throttle;
  out.torque = torque;
}
