import type { Control } from './autopilot';
import type { GridBody } from './body';
import { shipEffects } from './effects';
import { moduleEfficiency, type DriveType, type Module, type ModuleKind, type ShipGrid } from './grid';
import { Mat } from './materials';

/**
 * The drive family. Every one is a block of cells on the hull that pushes along its own
 * direction from where it sits, so each one's push also turns the ship by its lever arm
 * about the centre of mass:
 * - маршевый (cruise, red) and импульсный (impulse, yellow) are the main drives — the
 *   same mechanic with different balance: cruise is heavier and stronger but winds up
 *   slowly, impulse is lighter and weaker but answers the throttle at once;
 * - тормозной (brake, white): nose nozzles pushing aft — braking and backing up;
 * - маневровый (maneuver, cyan): side nozzles — sliding sideways;
 * - поворотный (turn, purple): nozzles at the bow and stern pushing sideways in pairs,
 *   bow one way and stern the other, so together they turn the ship without moving it.
 */
export interface DriveSpec {
  label: string;
  kind: ModuleKind;
  mat: number;
  /** Thrust per cell of the module (force units; a ship's acceleration is thrust / mass). */
  thrustPerCell: number;
  spoolUp: number;
  spoolDown: number;
  /** Exhaust particle colours. */
  exhaust: number[];
}

export const DRIVES: Record<DriveType, DriveSpec> = {
  cruise: { label: 'Маршевый', kind: 'engine', mat: Mat.CRUISE, thrustPerCell: 1250, spoolUp: 1.2, spoolDown: 0.4, exhaust: [0xffd2b0, 0xff7a4a, 0xff4a2a, 0xd8262a] },
  impulse: { label: 'Импульсный', kind: 'engine', mat: Mat.ENGINE, thrustPerCell: 700, spoolUp: 0.1, spoolDown: 0.1, exhaust: [0xfff6c8, 0xffe070, 0xffc040, 0xff9a30] },
  maneuver: { label: 'Маневровый', kind: 'thruster', mat: Mat.THRUSTER, thrustPerCell: 1300, spoolUp: 0, spoolDown: 0, exhaust: [0xd8f6ff, 0x7fdcff] },
  brake: { label: 'Тормозной', kind: 'brake', mat: Mat.BRAKE, thrustPerCell: 2500, spoolUp: 0, spoolDown: 0, exhaust: [0xffffff, 0xdde6f0] },
  turn: { label: 'Поворотный', kind: 'turn', mat: Mat.TURN, thrustPerCell: 4000, spoolUp: 0, spoolDown: 0, exhaust: [0xf0dcff, 0xb77cff] },
};

export const PROPULSION = {
  /** Side maneuvering nozzles help turn the ship when the turning ones run short. */
  sideReserve: true,
};

/** Which drive a module is; ships built before the family existed default by kind. */
export function driveOf(m: Module): DriveType | null {
  if (m.drive) return m.drive;
  if (m.kind === 'engine') return 'impulse';
  if (m.kind === 'thruster') return 'maneuver';
  if (m.kind === 'brake') return 'brake';
  if (m.kind === 'turn') return 'turn';
  return null;
}

export function isNozzle(m: Module): boolean {
  return m.kind === 'thruster' || m.kind === 'brake' || m.kind === 'turn';
}

/** Pushes aft — a nose brake, or an old-style nose maneuvering thruster. */
function pushesAft(m: Module): boolean {
  return m.kind === 'brake' || (m.kind === 'thruster' && m.dirY > 0.5);
}

/** Nozzles the rotation controller may fire for torque: turning ones, and side maneuvering ones as a reserve. */
function turnTier(m: Module): 0 | 1 | -1 {
  if (m.kind === 'turn') return 0;
  if (PROPULSION.sideReserve && m.kind === 'thruster' && Math.abs(m.dirX) > 0.5) return 1;
  return -1;
}

const tmpC = { x: 0, y: 0 };

/** Centroid of a module's surviving cells in grid coordinates, or null if none survive. */
export function liveCentroid(g: ShipGrid, m: Module, out = tmpC): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const i of m.cells) {
    if (g.mat[i] === 0) continue;
    sx += g.xOf(i) + 0.5;
    sy += g.yOf(i) + 0.5;
    n++;
  }
  if (n === 0) return null;
  out.x = sx / n;
  out.y = sy / n;
  return out;
}

/** Torque about the centre of mass from pushing with force f along the module's direction. */
function torqueOf(b: GridBody, c: { x: number; y: number }, m: Module, f: number): number {
  return (c.x - b.comX) * m.dirY * f - (c.y - b.comY) * m.dirX * f;
}

/**
 * Torque the nozzles can make turning each way: (positive, negative) magnitudes. Only
 * turning nozzles and side maneuvering ones count — a nose brake barely turns the ship
 * and would brake it as a side effect.
 */
export function nozzleTorqueCaps(b: GridBody): { pos: number; neg: number } {
  const g = b.grid;
  let pos = 0;
  let neg = 0;
  for (const m of g.modules) {
    if (turnTier(m) < 0) continue;
    const eff = moduleEfficiency(m);
    if (eff <= 0) continue;
    const c = liveCentroid(g, m);
    if (!c) continue;
    const t = torqueOf(b, c, m, m.thrust * eff);
    if (t > 0) pos += t;
    else neg -= t;
  }
  return { pos, neg };
}

interface Nozzle {
  m: Module;
  /** Force at full output. */
  f: number;
  /** Torque at full output. */
  tau: number;
}

const nozzles: Nozzle[] = [];

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/**
 * Fires the tier's nozzles that turn the ship the wanted way, all by the same share of
 * whatever output each has left, until the torque is met. Returns the torque still wanted.
 */
function spendTier(tier: 0 | 1, want: number): number {
  if (Math.abs(want) < 1e-6) return want;
  const s = Math.sign(want);
  let cap = 0;
  for (const n of nozzles) if (turnTier(n.m) === tier && n.tau * s > 0) cap += Math.abs(n.tau) * (1 - n.m.out);
  if (cap <= 1e-9) return want;
  const a = Math.min(1, Math.abs(want) / cap);
  for (const n of nozzles) if (turnTier(n.m) === tier && n.tau * s > 0) n.m.out += (1 - n.m.out) * a;
  return want - s * a * cap;
}

/**
 * One tick of the ship's drives under a control command: the main drives wind toward
 * the throttle at their own pace, the nozzles fire for braking and sliding, and the
 * torque the controller asked for comes from turning nozzles first, then the old
 * built-in turning of legacy main drives, then side maneuvering nozzles as a reserve.
 * Every push then acts from where its module actually sits on the hull.
 */
export function applyPropulsion(b: GridBody, ctl: Control, dt: number): void {
  const g = b.grid;
  let fx = 0;
  let fy = 0;
  let tauEng = 0;
  let legacy = 0;
  const bonus = shipEffects(g);
  nozzles.length = 0;
  for (const m of g.modules) {
    if (m.kind === 'engine') {
      const eff = moduleEfficiency(m);
      const c = eff > 0 ? liveCentroid(g, m) : null;
      const want = c ? ctl.main : 0;
      const time = want > m.out ? m.spoolUp * (1 - bonus.spoolCut) : m.spoolDown;
      m.out = time > 0 ? approach(m.out, want, dt / time) : want;
      if (!c) continue;
      legacy += m.rcs * eff;
      const f = m.thrust * eff * m.out;
      fx += m.dirX * f;
      fy += m.dirY * f;
      tauEng += torqueOf(b, c, m, f);
      continue;
    }
    if (!isNozzle(m)) continue;
    m.out = 0;
    const eff = moduleEfficiency(m);
    const c = eff > 0 ? liveCentroid(g, m) : null;
    if (!c) continue;
    if (pushesAft(m)) m.out = ctl.back;
    else if (m.kind === 'thruster') m.out = m.dirX > 0.5 ? ctl.right : m.dirX < -0.5 ? ctl.left : 0;
    const f = m.thrust * eff * (m.kind === 'turn' || m.kind === 'thruster' ? bonus.steer : 1);
    nozzles.push({ m, f, tau: torqueOf(b, c, m, f) });
  }

  // The controller asks for the net torque on the ship. The turning nozzles make up the
  // difference from what the other drives already twist it by: a lopsided or spooling
  // main drive, and brake and side nozzles sitting off the centre of mass.
  let tauTrans = 0;
  for (const n of nozzles) tauTrans += n.tau * n.m.out;
  let want = ctl.torque - tauEng - tauTrans;
  b.rcsTorque = want;
  want = spendTier(0, want);
  const built = Math.max(-legacy, Math.min(legacy, want));
  want -= built;
  want = spendTier(1, want);

  let tau = tauEng + built;
  for (const n of nozzles) {
    if (n.m.out <= 0) continue;
    const f = n.f * n.m.out;
    fx += n.m.dirX * f;
    fy += n.m.dirY * f;
    tau += n.tau * n.m.out;
  }
  b.vx += (b.c * fx - b.s * fy) * b.invMass * dt;
  b.vy += (b.s * fx + b.c * fy) * b.invMass * dt;
  b.w += tau * b.invInertia * dt;
}
