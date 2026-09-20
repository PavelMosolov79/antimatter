import type { EngineSummary, GridBody } from './body';

export interface Control {
  main: number;
  back: number;
  right: number;
  left: number;
  torque: number;
}

export interface Target {
  x: number;
  y: number;
}

export const AUTOPILOT = {
  speedTime: 2.2,
  brakeBack: 0.75,
  brakeFlip: 0.5,
  minRetroShare: 0.2,
  kv: 2,
  arriveK: 0.5,
  aimDist: 15,
  feasMargin: 1.5,
  alignedErr: 0.35,
  alignMin: 0.8,
  turnKp: 3,
  turnGain: 6,
  maxTurnRate: 3.5,
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
  right: number;
  left: number;
}

function brakeCap(uf: number, ur: number, caps: Caps): number {
  const fcap = -uf > 0 ? caps.fwd : caps.back;
  const rcap = -ur > 0 ? caps.right : caps.left;
  let s = Infinity;
  if (Math.abs(uf) > 1e-6) s = Math.min(s, fcap / Math.abs(uf));
  if (Math.abs(ur) > 1e-6) s = Math.min(s, rcap / Math.abs(ur));
  return s === Infinity ? 0 : s;
}

function fitsWithin(f: number, c: number, caps: Caps, margin: number): boolean {
  if (f < 0 && -f > caps.back * margin) return false;
  if (c > 0 && c > caps.right * margin) return false;
  if (c < 0 && -c > caps.left * margin) return false;
  return true;
}

export function computeControl(
  body: GridBody,
  target: Target | null,
  gx: number,
  gy: number,
  eng: EngineSummary,
  out: Control,
  faceAngle: number | null = null,
): void {
  const P = AUTOPILOT;
  const m = body.mass > 0 ? body.mass : 1;
  const caps: Caps = { fwd: eng.thrust / m, back: eng.capBack / m, right: eng.capRight / m, left: eng.capLeft / m };
  const rcsTorque = eng.rcs;
  const alphaMax = rcsTorque / body.inertia;
  const hx = body.s;
  const hy = -body.c;
  const rx = body.c;
  const ry = body.s;

  let wantAngle: number | null = null;
  let acx = 0;
  let acy = 0;

  const anyCap = caps.fwd + caps.back + caps.right + caps.left > 1e-6;
  if (target && anyCap) {
    const tx = target.x - body.x;
    const ty = target.y - body.y;
    const dist = Math.hypot(tx, ty);
    const ux = dist > 1e-6 ? tx / dist : 0;
    const uy = dist > 1e-6 ? ty / dist : 0;

    const aimMode = faceAngle === null && dist > P.aimDist;
    const uf = aimMode ? 1 : ux * hx + uy * hy;
    const ur = aimMode ? 0 : ux * rx + uy * ry;
    const sCap = brakeCap(uf, ur, caps);
    const vToward = body.vx * ux + body.vy * uy;
    let vBrake: number;
    let ffDecel: number;
    if (sCap >= P.minRetroShare * caps.fwd) {
      vBrake = Math.sqrt(2 * P.brakeBack * sCap * dist);
      ffDecel = P.brakeBack * sCap;
    } else {
      const tFlip = alphaMax > 1e-6 ? Math.min(2 * Math.sqrt(Math.PI / alphaMax), 6) : 6;
      const distEff = Math.max(dist - 0.5 * Math.max(vToward, 0) * tFlip, 0);
      vBrake = Math.sqrt(2 * P.brakeFlip * caps.fwd * distEff);
      ffDecel = P.brakeFlip * caps.fwd;
    }
    const capRef = Math.max(caps.fwd, caps.back, caps.right, caps.left);
    const vLimit = Math.min(P.speedTime * capRef, P.arriveK * dist);
    const vDes = Math.min(vLimit, vBrake);
    const ff = vBrake < vLimit ? ffDecel * clamp01(vToward / Math.max(vDes, 1e-3)) : 0;
    acx = P.kv * (ux * vDes - body.vx) - ux * ff - gx;
    acy = P.kv * (uy * vDes - body.vy) - uy * ff - gy;

    if (faceAngle !== null) {
      wantAngle = faceAngle;
    } else if (aimMode) {
      const along = acx * ux + acy * uy;
      const cross = -acx * uy + acy * ux;
      wantAngle = fitsWithin(along, cross, caps, P.feasMargin) ? Math.atan2(ux, -uy) : Math.atan2(acx, -acy);
    } else {
      const f = acx * hx + acy * hy;
      const c = acx * rx + acy * ry;
      if (!fitsWithin(f, c, caps, P.feasMargin)) wantAngle = Math.atan2(acx, -acy);
    }
    if (caps.fwd <= 1e-6) wantAngle = null;
  }

  const err = wantAngle === null ? 0 : wrapPi(wantAngle - body.angle);
  const absErr = Math.abs(err);
  let wDes = Math.sign(err) * Math.min(Math.sqrt(2 * alphaMax * 0.7 * absErr), P.turnKp * absErr);
  wDes = Math.max(-P.maxTurnRate, Math.min(P.maxTurnRate, wDes));
  const alphaCmd = Math.max(-alphaMax, Math.min(alphaMax, P.turnGain * (wDes - body.w)));

  const af = acx * hx + acy * hy;
  const ar = acx * rx + acy * ry;
  const align = wantAngle === null ? 1 : clamp01((Math.cos(err) - P.alignMin) / (1 - P.alignMin));
  let main = caps.fwd > 1e-6 && af > 0 ? clamp01(af / caps.fwd) * align : 0;
  const fullTorque = Math.abs(eng.torque);
  if (main > 0 && fullTorque > 1e-6) {
    const cap = Math.max(0.1, Math.min(1, (0.9 * rcsTorque) / fullTorque));
    if (main > cap) main = cap;
  }

  const settled = absErr < P.alignedErr;
  out.main = main;
  out.back = settled && caps.back > 1e-6 && af < 0 ? clamp01(-af / caps.back) : 0;
  out.right = settled && caps.right > 1e-6 && ar > 0 ? clamp01(ar / caps.right) : 0;
  out.left = settled && caps.left > 1e-6 && ar < 0 ? clamp01(-ar / caps.left) : 0;
  out.torque = Math.max(-rcsTorque, Math.min(rcsTorque, alphaCmd * body.inertia - eng.torque * main));
}
