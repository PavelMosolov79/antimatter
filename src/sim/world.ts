import { createAi, updateAi, type AiKind } from './ai';
import { computeControl, type Control, type NavMode, type Target } from './autopilot';
import { collideGridCircle, collideGridGrid, type DamageSink } from './collision';
import { updateCompartments } from './compartments';
import { GridBody } from './body';
import { pilotAvailable, spawnCrew, updateCrew } from './crew';
import type { DutyCrew } from './roster';
import { DUST_MIN_COLUMNS, splitBody, type SplitResult } from './fragment';
import { gravityAt, isSolid, swallows, type Celestial } from './gravity';
import type { Module, ShipGrid } from './grid';
import { MATERIALS } from './materials';
import { applyPropulsion } from './propulsion';
import { mulberry32, type Rng } from './rng';
import { PULSAR, STORM, pulsarAngle, stormBolt, type SectorId } from './space';
import { fieldRocks, makeRock } from './rocks';
import { WRECK, buildWreck, inspect, wreckSpec, type Find, type Trap } from './wrecks';
import { KEEP, chunkIndex, chunkKey, genChunk } from './sky';
import { SYSTEMS, absorbShield, createSys, updateSystems, type EnergyPriority, type Nav } from './systems';
import { stepProjectiles, updateWeapons, type Beam, type Projectile } from './weapons';

export type SimEvent =
  | { t: 'cell'; x: number; y: number; color: number }
  | { t: 'impact'; x: number; y: number; energy: number }
  | { t: 'split'; x: number; y: number }
  | { t: 'shot'; x: number; y: number; color: number }
  | { t: 'shield'; x: number; y: number; shipId: number }
  | { t: 'warning'; x: number; y: number }
  | { t: 'detonate'; x: number; y: number; r: number }
  | { t: 'bolt'; x: number; y: number }
  /** Air going out through a hole in the hull: where, which way (a unit vector away from the room) and how strongly (0…1). */
  | { t: 'vent'; x: number; y: number; dx: number; dy: number; k: number }
  | { t: 'dead'; x: number; y: number; shipId: number }
  | { t: 'crewLost'; x: number; y: number };

export interface ShipOptions {
  name: string;
  team: number;
  player?: boolean;
  ai?: AiKind;
  priority?: EnergyPriority;
  /** For the player's ship: the named people on duty (the roster's); without it the crew is the old anonymous one. */
  duty?: DutyCrew[];
}

interface Blast {
  x: number;
  y: number;
  r: number;
  dmg: number;
  /** The exploding ship itself: it breaks apart instead of being hit by its own blast. */
  src: GridBody | null;
}

/** What the world tells the game about wrecks, for the game to act on (the hold, the barracks, new enemies, the screen). */
export type WorldNote =
  | { type: 'find'; find: Find }
  | { type: 'salvage'; metal: number }
  | { type: 'trap'; trap: Trap; text: string }
  | { type: 'ambush'; x: number; y: number; n: number };

interface PendingTrap {
  trap: 'mine' | 'reactor';
  t: number;
  x: number;
  y: number;
  r: number;
}

/** Wreck pieces of a detonated ship get thrown outward once the split has happened. */
interface Shatter {
  body: GridBody;
  x: number;
  y: number;
  speed: number;
}

/** Not a game limit — ships have none — just a ceiling that keeps the numbers (and the collisions) sane. */
const MAX_SPEED = 6000;
const MAX_SPIN = 12;
const MAX_EVENTS = 2500;
const FAR_LIMIT = 40000;
const GHOST_TIME = 0.5;

const tmpPt = { x: 0, y: 0 };

export class World implements DamageSink {
  bodies: GridBody[] = [];
  celestials: Celestial[] = [];
  /** Which sector's sky hangs behind this arena, and the seed that arranges its clouds (render only). */
  sector: SectorId = 'violet';
  skySeed = 0;
  player: GridBody | null = null;
  time = 0;
  target: Target | null = null;
  autopilot = true;
  lockFace = true;
  private playerNav: Nav = { target: null, face: null };
  events: SimEvent[] = [];
  projectiles: Projectile[] = [];
  beams: Beam[] = [];
  private blasts: Blast[] = [];
  private shatters: Shatter[] = [];
  readonly rng: Rng;
  private damaged = new Set<GridBody>();
  private buf: number[] = [];
  private grav = { ax: 0, ay: 0 };
  /** The rocks of each field of rocks that is in the world. */
  private rocksOf = new Map<Celestial, GridBody[]>();
  /** The hull of each wreck that is in the world, how far its looking-over has got, and where it was looked over or shot to pieces (by place: it does not come back when the sky is laid out again). */
  private wrecksOf = new Map<Celestial, GridBody>();
  private looking = new Map<Celestial, number>();
  private spent = new Set<string>();
  /** Bodies whose lost cells give metal (a wreck and its pieces), and the part of a metal not yet given. */
  private salvage = new Set<GridBody>();
  private salvageRest = 0;
  private traps: PendingTrap[] = [];
  /** Told to the game, which empties it every tick. */
  notes: WorldNote[] = [];
  /** The wreck the player is looking over now, and how far along it is (0…1), for the screen. */
  inspecting: { x: number; y: number; frac: number } | null = null;
  /** Ships with a module knocked out by lightning. */
  private stunned = new Set<GridBody>();
  /** The chunks of the sky that have been laid out (sim/sky.ts), and when the sky was last looked at. */
  private chunks = new Set<string>(['0,0']);
  private skyClock = 0;
  /** Whether the sky lays itself out as the player flies (on for an arena given by `setCelestials`, off for a bare test world). */
  streaming = false;
  private ctl: Control = { main: 0, back: 0, right: 0, left: 0, torque: 0, arrived: false, heading: null };
  /** The player's drive commands from the last step (for the HUD and tests). */
  readonly playerControl: Control = { main: 0, back: 0, right: 0, left: 0, torque: 0, arrived: false, heading: null };

  constructor(seed = 1) {
    this.rng = mulberry32(seed);
  }

  /** The arena's own bodies replace whatever the world had; nothing else of the sky is in yet (see `streamSky`). */
  setCelestials(list: Celestial[]): void {
    for (const c of this.celestials) this.dropBodies(c);
    this.celestials = [];
    this.spent.clear();
    this.looking.clear();
    this.traps.length = 0;
    this.chunks = new Set(['0,0']);
    this.streaming = true;
    for (const c of list) this.addCelestial(c);
  }

  addCelestial(c: Celestial): void {
    this.celestials.push(c);
    if (c.kind === 'asteroids') this.spawnRocks(c);
    else if (c.kind === 'wreck') this.spawnWreck(c);
  }

  removeCelestial(c: Celestial): void {
    const i = this.celestials.indexOf(c);
    if (i >= 0) this.celestials.splice(i, 1);
    this.dropBodies(c);
  }

  private dropBodies(c: Celestial): void {
    this.dropRocks(c);
    const w = this.wrecksOf.get(c);
    if (w) {
      if (!w.removed) this.removeBody(w);
      this.wrecksOf.delete(c);
    }
    this.looking.delete(c);
  }

  private wreckKey(c: Celestial): string {
    return `${Math.round(c.x)},${Math.round(c.y)}`;
  }

  /** Whether a wreck still lies there to be looked over (not shot to pieces, not already looked over). */
  wreckLive(c: Celestial): boolean {
    const body = this.wrecksOf.get(c);
    return !!body && !body.removed && !this.spent.has(this.wreckKey(c));
  }

  private spawnWreck(c: Celestial): void {
    if (this.spent.has(this.wreckKey(c))) return;
    const g = buildWreck(c);
    const b = this.spawn(g, c.x, c.y, mulberry32(c.seed + 5)() * Math.PI * 2, 'debris');
    b.anchored = true;
    this.wrecksOf.set(c, b);
    this.salvage.add(b);
  }

  /** Looking a wreck over: close to it and slow for a few seconds. What is found (or what goes off) is decided by `inspect`. */
  private wrecks(dt: number): void {
    this.inspecting = null;
    for (const b of this.salvage) if (b.removed) this.salvage.delete(b);
    for (const t of this.traps) t.t -= dt;
    for (const t of this.traps) {
      if (t.t > 0) continue;
      this.blasts.push({ x: t.x, y: t.y, r: t.r, dmg: SYSTEMS.blastDamage * (t.trap === 'mine' ? 0.35 : 1), src: null });
      this.push({ t: 'detonate', x: t.x, y: t.y, r: t.r });
    }
    this.traps = this.traps.filter((t) => t.t > 0);
    const p = this.player;
    for (const [c, body] of this.wrecksOf) {
      if (body.removed) {
        // shot to pieces, or the hull is gone: nothing more to look at
        this.spent.add(this.wreckKey(c));
        this.wrecksOf.delete(c);
        this.looking.delete(c);
        continue;
      }
      if (!p || p.removed || this.spent.has(this.wreckKey(c))) continue;
      const near = Math.hypot(p.x - body.x, p.y - body.y) - body.radius - p.radius < WRECK.inspectRange;
      const slow = Math.hypot(p.vx, p.vy) < WRECK.inspectSpeed;
      const was = this.looking.get(c) ?? 0;
      const t = near && slow ? was + dt : Math.max(0, was - dt * 0.5);
      this.looking.set(c, t);
      if (t > 0 && near) this.inspecting = { x: body.x, y: body.y, frac: Math.min(1, t / WRECK.inspectTime) };
      if (t < WRECK.inspectTime) continue;
      this.spent.add(this.wreckKey(c));
      this.looking.delete(c);
      this.inspecting = null;
      const res = inspect(c);
      if (res.find) this.notes.push({ type: 'find', find: res.find });
      if (res.trap === 'mine') {
        this.notes.push({ type: 'trap', trap: 'mine', text: 'Осмотр остова: мина! Уходите от обломков.' });
        this.traps.push({ trap: 'mine', t: 1.2, x: p.x, y: p.y, r: 14 });
        this.push({ t: 'warning', x: p.x, y: p.y });
      } else if (res.trap === 'reactor') {
        this.notes.push({ type: 'trap', trap: 'reactor', text: `Осмотр остова: реактор станции разгоняется! Взрыв через ${WRECK.reactorFuse} с, уходите.` });
        this.traps.push({ trap: 'reactor', t: WRECK.reactorFuse, x: body.x, y: body.y, r: Math.max(30, c.radius * 0.8) });
        this.push({ t: 'warning', x: body.x, y: body.y });
      } else if (res.trap === 'ambush') {
        this.notes.push({ type: 'trap', trap: 'ambush', text: wreckSpec(c).kind === 'ancient' ? 'Осмотр: древний сторож просыпается, из обломков выходят чужие.' : 'Осмотр остова: засада! Из-за обломков выходят враги.' });
        this.notes.push({ type: 'ambush', x: body.x, y: body.y, n: 2 });
      }
    }
  }


  private spawnRocks(c: Celestial): void {
    const list: GridBody[] = [];
    for (const r of fieldRocks(c)) {
      const b = this.spawn(makeRock(r.seed, r.r, r.ore), r.x, r.y, r.angle, 'debris');
      b.anchored = true;
      list.push(b);
    }
    this.rocksOf.set(c, list);
  }

  private dropRocks(c: Celestial): void {
    for (const b of this.rocksOf.get(c) ?? []) if (!b.removed) this.removeBody(b);
    this.rocksOf.delete(c);
  }

  /**
   * Flying on meets new things: the chunks of the sky round the player are laid out when he comes near
   * (and the far ones taken away again, to come back the same). The arena's own chunk stays.
   */
  private streamSky(): void {
    const p = this.player;
    if (!p) return;
    const cx = chunkIndex(p.x);
    const cy = chunkIndex(p.y);
    for (let dx = -KEEP; dx <= KEEP; dx++) {
      for (let dy = -KEEP; dy <= KEEP; dy++) {
        const key = chunkKey(cx + dx, cy + dy);
        if (this.chunks.has(key)) continue;
        this.chunks.add(key);
        for (const c of genChunk(this.sector, this.skySeed, cx + dx, cy + dy, this.celestials)) this.addCelestial(c);
      }
    }
    for (const c of [...this.celestials]) {
      if (!c.chunk) continue;
      const [x, y] = c.chunk.split(',').map(Number);
      if (Math.abs(x - cx) > KEEP + 1 || Math.abs(y - cy) > KEEP + 1) this.removeCelestial(c);
    }
    for (const k of [...this.chunks]) {
      if (k === '0,0') continue;
      const [x, y] = k.split(',').map(Number);
      if (Math.abs(x - cx) > KEEP + 1 || Math.abs(y - cy) > KEEP + 1) this.chunks.delete(k);
    }
  }

  /** Comets fly on; a pulsar's beam drains the shield of what it sweeps; a storm keeps shields down and lightning knocks a module out. */
  private hazards(dt: number): void {
    for (const c of this.celestials) {
      if (c.kind === 'comet') {
        c.x += (c.vx ?? 0) * dt;
        c.y += (c.vy ?? 0) * dt;
      } else if (c.kind === 'pulsar') {
        const th = pulsarAngle(c, this.time);
        const ct = Math.cos(th);
        const st = Math.sin(th);
        for (const b of this.bodies) {
          if (b.removed || !b.sys || b.sys.dead) continue;
          const dx = b.x - c.x;
          const dy = b.y - c.y;
          if (dx * dx + dy * dy > (PULSAR.beamLength + b.radius) ** 2) continue;
          const along = Math.abs(dx * ct + dy * st);
          const perp = Math.abs(dx * st - dy * ct);
          if (along > c.radius + 10 && perp < PULSAR.beamWidth + along * PULSAR.beamSlope + b.radius * 0.5) absorbShield(b.sys, PULSAR.shieldPerSecond * dt, this.time);
        }
      } else if (c.kind === 'storm') {
        const ry = c.ry ?? c.radius;
        const inside: GridBody[] = [];
        for (const b of this.bodies) {
          if (b.removed || !b.sys || b.sys.dead) continue;
          const nx = (b.x - c.x) / c.radius;
          const ny = (b.y - c.y) / ry;
          if (nx * nx + ny * ny < 1) {
            inside.push(b);
            b.sys.lastHit = this.time; // the shield does not come back in a storm
          }
        }
        const bolt = stormBolt(c, this.time);
        if (bolt.on && bolt.phase * STORM.boltEvery < dt && inside.length > 0) {
          const b = inside[bolt.index % inside.length];
          const live = b.grid.modules.filter((m) => m.alive > 0 && m.stun <= 0);
          if (live.length > 0) {
            const m = live[Math.floor(this.rng() * live.length)];
            m.stun = STORM.stun;
            this.stunned.add(b);
            this.push({ t: 'bolt', x: b.x, y: b.y });
            this.impact(b.x, b.y, 400);
          }
        }
      }
    }
    for (const b of this.stunned) {
      let any = false;
      for (const m of b.grid.modules) {
        if (m.stun > 0) m.stun = Math.max(0, m.stun - dt);
        if (m.stun > 0) any = true;
      }
      if (!any || b.removed) this.stunned.delete(b);
    }
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

  spawnShip(grid: ShipGrid, x: number, y: number, angle: number, o: ShipOptions): GridBody {
    const b = this.spawn(grid, x, y, angle, 'ship');
    b.team = o.team;
    b.sys = createSys(b, o.name, o.team);
    if (o.priority) b.sys.priority = o.priority;
    if (o.player) {
      b.isPlayer = true;
      this.player = b;
      b.sys.crew = spawnCrew(b.grid, o.duty);
    }
    if (o.ai) b.sys.ai = createAi(o.ai, this.rng);
    return b;
  }

  /**
   * Brings the player's ship over from a previous battle exactly as it left it — hull
   * damage, crew, compartments — parked at (x, y) and at rest. Only what can't outlive
   * the old world is dropped: motion, targets that pointed at its ships, the manual nav.
   */
  adoptPlayer(b: GridBody, x: number, y: number, angle = 0): GridBody {
    b.removed = false;
    b.x = x;
    b.y = y;
    b.angle = angle;
    b.vx = 0;
    b.vy = 0;
    b.w = 0;
    b.throttle = 0;
    b.rcsTorque = 0;
    b.tBack = 0;
    b.tRight = 0;
    b.tLeft = 0;
    for (const m of b.grid.modules) m.out = 0;
    b.splitTag = 0;
    b.splitTime = -1;
    b.syncTrig();
    b.isPlayer = true;
    b.kind = 'ship';
    if (b.sys) {
      b.sys.focus = null;
      b.sys.autoTarget = null;
      b.sys.nav = { target: null, face: null };
      b.sys.lastHit = -100;
    }
    for (const m of b.grid.modules) if (m.weapon) m.weapon.target = null;
    this.bodies.push(b);
    this.player = b;
    return b;
  }

  findShip(shipId: number): GridBody | null {
    for (const b of this.bodies) {
      if (!b.removed && b.shipId === shipId && b.kind === 'ship' && b.sys && !b.sys.dead) return b;
    }
    return null;
  }

  killShip(b: GridBody): void {
    const sys = b.sys;
    if (!sys || sys.dead) return;
    sys.dead = true;
    b.kind = 'debris';
    if (b.isPlayer) {
      b.isPlayer = false;
      if (this.player === b) this.player = null;
    }
    this.push({ t: 'dead', x: b.x, y: b.y, shipId: b.shipId });
  }

  detonate(b: GridBody): void {
    const sys = b.sys;
    if (!sys || sys.dead) return;
    const reactor = b.grid.modules.find((m) => m.kind === 'reactor');
    const r = reactor && reactor.blast > 0 ? reactor.blast : 40;
    sys.dead = true;
    b.kind = 'debris';
    if (b.isPlayer) {
      b.isPlayer = false;
      if (this.player === b) this.player = null;
    }
    this.push({ t: 'detonate', x: b.x, y: b.y, r });
    this.fracture(b, reactor);
    this.blasts.push({ x: b.x, y: b.y, r, dmg: SYSTEMS.blastDamage, src: b });
    this.shatters.push({ body: b, x: b.x, y: b.y, speed: 14 + Math.min(26, b.radius * 0.5) });
    this.push({ t: 'dead', x: b.x, y: b.y, shipId: b.shipId });
  }

  /** The reactor blows a hole in its own hull and sends cracks out to the rim: the wreck falls into chunks. */
  private fracture(b: GridBody, reactor: Module | undefined): void {
    const g = b.grid;
    let cx = g.width / 2;
    let cy = g.height / 2;
    if (reactor) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const i of reactor.cells) {
        sx += g.xOf(i) + 0.5;
        sy += g.yOf(i) + 0.5;
        n++;
      }
      if (n > 0) {
        cx = sx / n;
        cy = sy / n;
      }
    }
    const reach = Math.hypot(g.width, g.height);
    this.buf.length = 0;
    g.applyCrater(cx, cy, Math.max(3, b.radius * 0.28), 1e4, 1, this.buf);
    const rays = 4 + Math.round(b.radius / 12);
    const a0 = this.rng() * Math.PI * 2;
    for (let k = 0; k < rays; k++) {
      const a = a0 + ((k + this.rng() * 0.6) / rays) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      for (let t = 0; t < reach; t += 0.6) g.applyCrater(cx + dx * t, cy + dy * t, 1.1, 1e4, 1, this.buf);
    }
    this.flushDestroyed(b);
    this.damaged.add(b);
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

  push(e: SimEvent): void {
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
    if (this.salvage.has(body) && buf.length > 0) {
      this.salvageRest += (buf.length / 4) * WRECK.salvagePerCell;
      const whole = Math.floor(this.salvageRest);
      if (whole > 0) {
        this.salvageRest -= whole;
        this.notes.push({ type: 'salvage', metal: whole });
      }
    }
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

  burnCells(body: GridBody, cellIndices: number[], totalDmg: number): void {
    if (cellIndices.length === 0 || totalDmg <= 0) return;
    const per = totalDmg / cellIndices.length;
    let destroyedAny = false;
    for (const i of cellIndices) {
      if (body.grid.mat[i] === 0) continue;
      const before = body.grid.mat[i];
      if (body.grid.burnCell(i, per)) {
        destroyedAny = true;
        const p = body.localToWorld(body.grid.xOf(i) + 0.5, body.grid.yOf(i) + 0.5, tmpPt);
        this.push({ t: 'cell', x: p.x, y: p.y, color: MATERIALS[before].color });
      }
    }
    if (destroyedAny) this.damaged.add(body);
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

  private throwWreck(sh: Shatter): void {
    for (const p of this.bodies) {
      if (p.removed) continue;
      if (p !== sh.body && !(p.splitTag === sh.body.id && p.splitTime === this.time)) continue;
      const dx = p.x - sh.x;
      const dy = p.y - sh.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = sh.speed * (0.5 + this.rng() * 0.8) * Math.min(1, 0.4 + d / 12);
      p.vx += (dx / d) * k;
      p.vy += (dy / d) * k;
      p.w += (this.rng() - 0.5) * 3;
    }
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
    const scrap = this.salvage.has(b);
    for (const piece of res.pieces) {
      this.bodies.push(piece);
      if (scrap) this.salvage.add(piece);
    }
    if (wasPlayer) this.player = res.main;
    for (const d of res.dust) this.push({ t: 'cell', x: d.x, y: d.y, color: d.color });
    this.push({ t: 'split', x: b.x, y: b.y });
  }

  private faceAngleTo(b: GridBody): number | null {
    const ref = b.sys?.focus;
    if (!ref) return null;
    const t = this.findShip(ref.shipId);
    if (!t || t === b) {
      if (b.sys) b.sys.focus = null;
      return null;
    }
    return Math.atan2(t.x - b.x, -(t.y - b.y));
  }

  private drive(b: GridBody, nav: Nav, on: boolean, dt: number, mode: NavMode = 'stop'): Control {
    const eng = b.engineSummary();
    const g = this.gravityAt(b.x, b.y);
    const ctl = this.ctl;
    if (on) computeControl(b, nav.target, g.ax, g.ay, eng, ctl, nav.face, mode);
    else {
      ctl.main = 0;
      ctl.back = 0;
      ctl.right = 0;
      ctl.left = 0;
      ctl.torque = 0;
      ctl.arrived = false;
      ctl.heading = null;
    }
    b.throttle = ctl.main;
    b.tBack = ctl.back;
    b.tRight = ctl.right;
    b.tLeft = ctl.left;
    applyPropulsion(b, ctl, dt);
    return ctl;
  }

  step(dt: number): void {
    this.time += dt;
    this.beams.length = 0;

    for (const b of this.bodies) if (!b.removed && b.sys?.ai) updateAi(this, b);

    for (const b of this.bodies) {
      if (b.removed) continue;
      if (b.isPlayer) {
        this.playerNav.target = this.target;
        this.playerNav.face = this.lockFace ? this.faceAngleTo(b) : null;
        // Autopilot on: fly to the point and stop there. Off: fly to it, then the point
        // is gone and the ship keeps its speed.
        const ctl = this.drive(b, this.playerNav, pilotAvailable(b), dt, this.autopilot ? 'stop' : 'pass');
        Object.assign(this.playerControl, ctl);
        if (!this.autopilot && ctl.arrived) this.target = null;
      }
      else if (b.sys && !b.sys.dead) this.drive(b, b.sys.nav, true, dt);
    }

    updateWeapons(this, dt);
    stepProjectiles(this, dt);

    this.hazards(dt);
    this.wrecks(dt);
    this.skyClock += dt;
    if (this.streaming && this.skyClock >= 0.5) {
      this.skyClock = 0;
      this.streamSky();
    }

    for (const b of this.bodies) {
      if (b.anchored) {
        b.vx = b.vy = b.w = 0;
        continue;
      }
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
    if (this.player && !this.player.removed && this.player.sys) {
      updateCompartments(this, this.player, dt);
      updateCrew(this, this.player, dt);
    }
    for (const b of this.bodies) if (!b.removed && b.sys) updateSystems(this, b, dt);
    if (this.blasts.length > 0) {
      for (const bl of this.blasts) {
        for (const o of this.bodies) {
          if (o.removed || (bl.src && o === bl.src)) continue;
          if (Math.hypot(o.x - bl.x, o.y - bl.y) > bl.r + o.radius) continue;
          this.damageCrater(o, bl.x, bl.y, bl.r, bl.dmg, 1);
        }
        this.impact(bl.x, bl.y, bl.dmg * bl.r);
      }
      this.blasts.length = 0;
    }
    this.processDamaged();
    if (this.shatters.length > 0) {
      for (const sh of this.shatters) this.throwWreck(sh);
      this.shatters.length = 0;
    }

    for (const b of this.bodies) {
      if (b.kind === 'debris' && !b.anchored && Math.hypot(b.x, b.y) > FAR_LIMIT) this.removeBody(b);
    }
    this.bodies = this.bodies.filter((b) => !b.removed);
  }

  private collide(): void {
    const bodies = this.bodies;
    for (const c of this.celestials) {
      if (isSolid(c)) {
        for (const b of bodies) if (!b.removed) collideGridCircle(this, b, c);
      } else if (swallows(c)) {
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
