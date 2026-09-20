import type { EngineSummary, GridBody } from './body';

export interface Control {
  throttle: number;
  torque: number;
  rcsAx: number;
  rcsAy: number;
}

export interface Target {
  x: number;
  y: number;
}

export const AUTOPILOT = {
  speedTime: 2.2,
  brakeFactor: 0.5,
  linBrakeFactor: 0.6,
  kv: 2,
  arriveK: 0.5,
  steerRatio: 1.15,
  flipRatio: 1.6,
  lazyAngle: 0.5,
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
  const rcsTorque = eng.rcs;
  const alphaMax = rcsTorque / body.inertia;
  const aMax = body.mass > 0 ? eng.thrust / body.mass : 0;
  const aLin = body.mass > 0 ? eng.maneuver / body.mass : 0;
  const dirAngle = eng.thrust > 0 ? Math.atan2(eng.fx, -eng.fy) : 0;

  let wantHeading: number | null = null;
  let acx = 0;
  let acy = 0;

  if (target && (aMax > 1e-6 || aLin > 1e-6)) {
    const tx = target.x - body.x;
    const ty = target.y - body.y;
    const dist = Math.hypot(tx, ty);
    const ux = dist > 1e-6 ? tx / dist : 0;
    const uy = dist > 1e-6 ? ty / dist : 0;
    const vToward = body.vx * ux + body.vy * uy;
    const tFlip = alphaMax > 1e-6 ? Math.min(2 * Math.sqrt(Math.PI / alphaMax), 6) : 6;
    const distEff = Math.max(dist - 0.5 * Math.max(vToward, 0) * tFlip, 0);
    const vMain = Math.sqrt(2 * P.brakeFactor * aMax * distEff);
    const vLin = Math.sqrt(2 * P.linBrakeFactor * aLin * dist);
    const vDes = Math.min(P.speedTime * Math.max(aMax, aLin), Math.max(vMain, vLin), P.arriveK * dist);
    acx = P.kv * (ux * vDes - body.vx) - gx;
    acy = P.kv * (uy * vDes - body.vy) - gy;
    const need = Math.hypot(acx, acy);
    if (aMax > 1e-6 && need > P.steerRatio * aLin && need > 0.05) {
      const cand = Math.atan2(acx, -acy) - dirAngle;
      const bigTurn = Math.abs(wrapPi(cand - body.angle)) > P.lazyAngle;
      if (!bigTurn || need >= P.flipRatio * aLin) wantHeading = cand;
    }
  }

  const err = wantHeading === null ? 0 : wrapPi(wantHeading - body.angle);
  const absErr = Math.abs(err);
  let wDes = Math.sign(err) * Math.min(Math.sqrt(2 * alphaMax * 0.7 * absErr), P.turnKp * absErr);
  wDes = Math.max(-P.maxTurnRate, Math.min(P.maxTurnRate, wDes));
  const alphaCmd = Math.max(-alphaMax, Math.min(alphaMax, P.turnGain * (wDes - body.w)));

  let throttle = 0;
  let mainAx = 0;
  let mainAy = 0;
  if (wantHeading !== null && eng.thrust > 0) {
    const fx = (body.c * eng.fx - body.s * eng.fy) / eng.thrust;
    const fy = (body.s * eng.fx + body.c * eng.fy) / eng.thrust;
    const proj = acx * fx + acy * fy;
    const align = Math.max(0, Math.min(1, (Math.cos(err) - P.alignMin) / (1 - P.alignMin)));
    throttle = Math.max(0, Math.min(1, proj / aMax)) * align;
    const fullTorque = Math.abs(eng.torque);
    if (fullTorque > 1e-6) {
      const cap = Math.max(0.1, Math.min(1, (0.9 * rcsTorque) / fullTorque));
      if (throttle > cap) throttle = cap;
    }
    mainAx = fx * throttle * aMax;
    mainAy = fy * throttle * aMax;
  }

  let rx = acx - mainAx;
  let ry = acy - mainAy;
  const rm = Math.hypot(rx, ry);
  if (rm > aLin) {
    const k = rm > 0 ? aLin / rm : 0;
    rx *= k;
    ry *= k;
  }

  out.throttle = throttle;
  out.torque = Math.max(-rcsTorque, Math.min(rcsTorque, alphaCmd * body.inertia - eng.torque * throttle));
  out.rcsAx = rx;
  out.rcsAy = ry;
}
