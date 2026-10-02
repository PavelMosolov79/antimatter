import type { GridBody } from './sim/body';
import { doorsOnDeck, ensureRooms, roomsOnDeck, setDoorOpen, type DoorInfo, type Room } from './sim/compartments';
import { crewOnDeck, type Crew } from './sim/crew';
import type { EnergyPriority } from './sim/systems';
import { ENEMIES, SHIPS, buildFreighter } from './sim/ships';
import type { ShipGrid } from './sim/grid';
import { repairShip, restAfterBattle } from './sim/run';
import { ENABLED, Road, encounterFor, type RoadPoint } from './sim/road';
import { addToHold, deposit, emptyCargo, holdCap, previewAdd, rewardFor, type Cargo, type HoldResult } from './sim/cargo';
import { captureShip, loadRun, loadWallet, restoreShip, storeRun, storeWallet, type SavedRun } from './sim/runSave';
import { mulberry32 } from './sim/rng';
import { SECTOR_IDS, buildArena, type SectorId } from './sim/space';
import { shipRef } from './sim/weapons';
import type { Module, TargetRef, WeaponState } from './sim/grid';
import { World } from './sim/world';
import { Scene } from './render/scene';
import { OUTER_VIEW } from './render/shipView';

export type Tool = 'fly' | 'crater';
export type BattleState = 'playing' | 'won' | 'lost';
export type Mode = 'sandbox' | 'run';
export type RunPhase = 'dock' | 'roaddock' | 'map' | 'battle' | 'over';
export type RunOutcome = 'defeat';

/** A run in progress: the road, how far along it the player is, and the ship they carry between points. */
export interface RunSession {
  shipId: string;
  road: Road;
  /** Index of the last point cleared (0 is the start gate); the current mission is the next one. */
  cleared: number;
  outcome: RunOutcome | null;
  /** The player's ship as it left the last battle; null until the first fight builds it. */
  ship: GridBody | null;
  blueprint: ShipGrid;
  battlesWon: number;
  fighting: RoadPoint | null;
  note: string;
  /** What the hold carries: lost if the ship is, added to the player's resources at a dock. */
  cargo: Cargo;
  /** What the last dock took out of the hold, for the dock's animation. */
  deposited: Cargo | null;
  /** What was in the hold when the ship was lost, for the result screen. */
  lost: Cargo | null;
  /** The dock the player fell back to after losing the ship, for the result screen. */
  fellBackTo: number | null;
}

export interface Scenario {
  id: string;
  label: string;
  enemies: string[];
}

export const SCENARIOS: Scenario[] = [
  { id: 'sandbox', label: 'Песочница', enemies: [] },
  { id: 'duel-raider', label: 'Дуэль: налётчик', enemies: ['raider'] },
  { id: 'duel-hunter', label: 'Дуэль: охотник', enemies: ['hunter'] },
  { id: 'three-scouts', label: '1 на 3: разведчики', enemies: ['scout', 'scout', 'scout'] },
  { id: 'squad', label: 'Отряд', enemies: ['raider', 'scout', 'hunter'] },
];

export const STEP = 1 / 60;

export interface WeaponRow {
  weapon: WeaponState;
  module: Module;
}

export class Game {
  world: World;
  readonly scene: Scene;
  tool: Tool = 'fly';
  crater = { radius: 5, damage: 60, pen: 0.6 };
  paused = false;
  slowMo = false;
  shipId = 'fighter';
  scenarioId = 'sandbox';
  state: BattleState = 'playing';
  mode: Mode = 'run';
  runPhase: RunPhase = 'dock';
  /** What's on screen: the title (loading screen and main menu) or the game itself. */
  screen: 'title' | 'game' = 'title';
  /** The player has been into the game since loading — the menu can offer "Continue". */
  hasSession = false;
  /** The sector the sandbox arena is in. */
  sandboxSector: SectorId = 'violet';
  run: RunSession | null = null;
  /** What the player owns outside any run (Кредиты, Металл): survives deaths and new runs. */
  wallet: Cargo = loadWallet();
  selectedWeapon: number | null = null;
  stepMs = 0;
  private acc = 0;
  private seed = 1;

  constructor(scene: Scene) {
    this.scene = scene;
    this.world = new World(this.seed);
    this.openDock();
  }

  get scenario(): Scenario {
    return SCENARIOS.find((s) => s.id === this.scenarioId) ?? SCENARIOS[0];
  }

  /** Sandbox: moves to another sector's arena (its sky, its planet), keeping the ship and the scenario. */
  setSector(id: SectorId): void {
    this.sandboxSector = id;
    if (this.mode === 'sandbox') this.reset();
  }

  reset(shipId = this.shipId, scenarioId = this.scenarioId): void {
    this.mode = 'sandbox';
    this.run = null;
    this.shipId = shipId;
    this.scenarioId = scenarioId;
    const spec = SHIPS.find((s) => s.id === shipId) ?? SHIPS[0];
    const lock = this.world ? this.world.lockFace : true;
    const autopilot = this.world ? this.world.autopilot : true;
    this.world = new World(this.seed++);
    this.world.lockFace = lock;
    this.world.autopilot = autopilot;
    // The sandbox arena is one sector's own: its planet, moon, star and (in the crimson one) black hole.
    const sectorSeed = this.seed * 977 + SECTOR_IDS.indexOf(this.sandboxSector);
    this.world.celestials = buildArena(mulberry32(sectorSeed), this.sandboxSector);
    this.world.sector = this.sandboxSector;
    this.world.skySeed = sectorSeed;
    this.world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true });
    const enemies = this.scenario.enemies;
    if (enemies.length === 0) {
      this.spawnTarget(150, -130, 0.5);
    } else {
      enemies.forEach((id, i) => {
        const es = ENEMIES.find((e) => e.id === id)!;
        const spread = enemies.length === 1 ? 0 : (i / (enemies.length - 1) - 0.5) * 1.5;
        const a = -Math.PI / 2 + spread;
        const ex = Math.cos(a) * 380;
        const ey = Math.sin(a) * 380;
        const heading = Math.atan2(-ex, ey);
        this.world.spawnShip(es.build(), ex, ey, heading, { name: es.label, team: 1, ai: es.ai });
      });
    }
    this.state = 'playing';
    this.selectedWeapon = null;
    this.scene.reset(this.world);
    this.acc = 0;
  }

  // ---------------------------------------------------------------- run flow

  /**
   * The dock between runs (stand-in until MVP-4): pick a ship, then launch. Going back to it
   * from a run gives the run up, hold and all: only a dock on the road banks what the hold carries.
   */
  openDock(shipId = this.shipId): void {
    if (this.run) {
      this.run = null;
      storeRun(null);
    }
    this.mode = 'run';
    this.runPhase = 'dock';
    this.shipId = shipId;
    const spec = SHIPS.find((s) => s.id === shipId) ?? SHIPS[0];
    this.world = new World(this.seed++);
    this.world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true });
    this.state = 'playing';
    this.selectedWeapon = null;
    this.scene.reset(this.world);
    this.acc = 0;
  }

  /** Throws away the run in progress, in memory or saved in the browser: the hold goes with it. */
  abandonRun(): void {
    this.run = null;
    storeRun(null);
  }

  /** Is there a run to continue, here or in the browser's save? */
  hasRun(): boolean {
    return !!this.run || !!loadRun();
  }

  startRun(): void {
    const spec = SHIPS.find((s) => s.id === this.shipId) ?? SHIPS[0];
    this.run = {
      shipId: spec.id,
      road: new Road((Math.random() * 2 ** 31) >>> 0),
      cleared: 0,
      outcome: null,
      ship: null,
      blueprint: spec.build(),
      battlesWon: 0,
      fighting: null,
      note: 'Вылет из дока. Впереди первая миссия.',
      cargo: emptyCargo(),
      deposited: null,
      lost: null,
      fellBackTo: null,
    };
    this.runPhase = 'map';
    this.saveRun();
  }

  // ---------------------------------------------------------------- saving

  /** The run as it stands, written to the browser after every point (never in the middle of a battle). */
  saveRun(): void {
    const run = this.run;
    if (!run || this.runPhase === 'battle') return;
    const saved: SavedRun = {
      v: 1,
      seed: run.road.seed,
      links: run.road.links,
      regens: [...run.road.regens],
      shipId: run.shipId,
      cleared: run.cleared,
      cargo: { ...run.cargo },
      battlesWon: run.battlesWon,
      // After a lost ship the result screen is not saved: a reload goes to the dock the run fell back to.
      phase: this.runPhase === 'roaddock' || this.runPhase === 'over' ? 'roaddock' : 'map',
      note: run.note,
      ship: run.ship ? captureShip(run.ship, run.blueprint) : null,
    };
    storeRun(saved);
  }

  /** A run saved in the browser, if any (for the main menu's "Continue"). */
  savedRun(): SavedRun | null {
    return loadRun();
  }

  /** Picks the saved run up where it was left: on the road, or at the dock it stopped at. */
  continueSaved(): boolean {
    const d = loadRun();
    if (!d) return false;
    const spec = SHIPS.find((s) => s.id === d.shipId) ?? SHIPS[0];
    const road = new Road(d.seed, d.links, d.regens);
    this.shipId = spec.id;
    this.mode = 'run';
    this.run = {
      shipId: spec.id,
      road,
      cleared: d.cleared,
      outcome: null,
      ship: d.ship ? restoreShip(spec.id, d.ship) : null,
      blueprint: spec.build(),
      battlesWon: d.battlesWon,
      fighting: null,
      note: d.note,
      cargo: { ...d.cargo },
      deposited: null,
      lost: null,
      fellBackTo: null,
    };
    road.ensure(d.cleared);
    if (d.phase === 'roaddock') this.enterRoadDock(false);
    else this.runPhase = 'map';
    this.hasSession = true;
    return true;
  }

  // ---------------------------------------------------------------- the road

  /** The point the player flies to next: the road has no forks, so there is exactly one. */
  canTravel(index: number): boolean {
    const run = this.run;
    if (!run || this.runPhase !== 'map') return false;
    return index === run.cleared + 1 && !!run.road.points[index];
  }

  travel(index: number): void {
    const run = this.run;
    if (!run || !this.canTravel(index)) return;
    const point = run.road.points[index];
    if (point.kind === 'combat' || point.kind === 'elite' || point.kind === 'boss') {
      this.startBattle(point);
      return;
    }
    run.cleared = index;
    if (point.kind === 'dock' || point.kind === 'gate') {
      this.enterRoadDock(true);
      return;
    }
    run.note = ENABLED[point.kind] ? '' : 'Эта точка пока пуста.';
    run.road.ensure(run.cleared);
    this.saveRun();
  }

  /**
   * The dock on the road: the hold is emptied into the player's resources, the hull is
   * patched (until repairs run on timers at the dock) and the dock screen opens on the
   * ship as it is.
   */
  private enterRoadDock(arriving: boolean): void {
    const run = this.run!;
    const point = run.road.points[run.cleared];
    if (arriving) {
      run.deposited = deposit(run.cargo, this.wallet);
      storeWallet(this.wallet);
      if (run.ship) {
        const rep = repairShip(run.ship, run.blueprint);
        restAfterBattle(run.ship);
        run.note = `${point.kind === 'gate' ? 'Врата и док' : 'Док'}: залатано ${rep.rebuilt.length} клеток, укреплено ${rep.healed}.` + (rep.lostForGood > 0 ? ` Не восстановить в пути: ${rep.lostForGood} (оторвано или модуль уничтожен).` : '');
      } else run.note = 'Док: корабль цел, чинить нечего.';
      run.road.ensure(run.cleared);
    } else run.deposited = null;
    const spec = SHIPS.find((s) => s.id === run.shipId) ?? SHIPS[0];
    this.world = new World(this.seed++);
    if (run.ship) this.world.adoptPlayer(run.ship, 0, 0, 0);
    else run.ship = this.world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true });
    this.runPhase = 'roaddock';
    this.state = 'playing';
    this.selectedWeapon = null;
    this.scene.reset(this.world);
    this.acc = 0;
    this.saveRun();
  }

  /** Leaves the dock on the road: back to the map, on to the next point. */
  leaveRoadDock(): void {
    if (this.runPhase !== 'roaddock' || !this.run) return;
    this.run.deposited = null;
    this.runPhase = 'map';
    this.saveRun();
  }

  /** What winning the fight in progress would put in the hold, and what wouldn't fit. */
  pendingReward(): HoldResult | null {
    const run = this.run;
    if (!run || !run.fighting) return null;
    return previewAdd(run.cargo, holdCap(run.shipId), rewardFor(run.fighting));
  }

  private startBattle(point: RoadPoint): void {
    const run = this.run!;
    const enc = encounterFor(point);
    const spec = SHIPS.find((s) => s.id === run.shipId) ?? SHIPS[0];
    const lock = this.world.lockFace;
    const autopilot = this.world.autopilot;
    this.world = new World(this.seed++);
    this.world.lockFace = lock;
    this.world.autopilot = autopilot;
    this.world.celestials = enc.celestials;
    this.world.sector = enc.sector;
    this.world.skySeed = enc.skySeed;
    if (run.ship) this.world.adoptPlayer(run.ship, 0, 0, 0);
    else run.ship = this.world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true });
    enc.enemies.forEach((id, i) => {
      const es = ENEMIES.find((e) => e.id === id)!;
      const spread = enc.enemies.length === 1 ? 0 : (i / (enc.enemies.length - 1) - 0.5) * 1.5;
      const a = -Math.PI / 2 + spread;
      const dist = id === 'boss' ? 520 : 380;
      const ex = Math.cos(a) * dist;
      const ey = Math.sin(a) * dist;
      this.world.spawnShip(es.build(), ex, ey, Math.atan2(-ex, ey), { name: es.label, team: 1, ai: es.ai });
    });
    run.fighting = point;
    this.runPhase = 'battle';
    this.state = 'playing';
    this.selectedWeapon = null;
    this.scene.reset(this.world);
    this.acc = 0;
  }

  /** After the battle's end screen: the winnings go into the hold and the player is back on the road; a lost ship ends in the result screen. */
  continueRun(): void {
    const run = this.run;
    if (!run || this.runPhase !== 'battle') return;
    const point = run.fighting!;
    const ship = this.world.player;
    if (this.state === 'lost' || !ship) {
      this.loseShip();
      return;
    }
    run.ship = ship;
    restAfterBattle(ship);
    run.battlesWon++;
    const got = addToHold(run.cargo, holdCap(run.shipId), rewardFor(point));
    run.cleared = point.index;
    run.fighting = null;
    run.road.ensure(run.cleared);
    const name = point.kind === 'boss' ? 'Рубеж взят' : point.kind === 'elite' ? 'Элитный бой выигран' : 'Бой выигран';
    run.note = `${name}: в трюм +${got.gained.credits} кр. и +${got.gained.metal} мет.` + (got.lostMetal > 0 ? ` (трюм полон, ${got.lostMetal} мет. не влезло)` : '');
    this.runPhase = 'map';
    this.saveRun();
  }

  /** The ship is gone: what it carried goes with it, and the run falls back to the last dock on a whole ship of the same class. */
  private loseShip(): void {
    const run = this.run!;
    const dock = run.road.lastDock(run.cleared);
    run.lost = { ...run.cargo };
    run.cargo = emptyCargo();
    run.fellBackTo = dock;
    run.cleared = dock;
    run.road.regenAfter(dock);
    run.road.ensure(run.cleared);
    run.ship = null;
    run.fighting = null;
    run.outcome = 'defeat';
    this.runPhase = 'over';
    this.saveRun();
  }

  /** From the result screen after a lost ship back to the road, at the dock. */
  resumeAfterLoss(): void {
    const run = this.run;
    if (!run || this.runPhase !== 'over') return;
    run.outcome = null;
    run.lost = null;
    run.note = 'Вы получили такой же целый корабль у последнего дока. Участок дороги собран заново.';
    this.enterRoadDock(true);
  }

  /** Falls back to the last dock on purpose: the hold is deposited there, the points past it don't count and the stretch is written anew. */
  retreat(): void {
    const run = this.run;
    if (!run || this.runPhase !== 'map') return;
    const dock = run.road.lastDock(run.cleared);
    if (dock === run.cleared) return;
    run.cleared = dock;
    run.road.regenAfter(dock);
    this.enterRoadDock(true);
  }

  /** How many points back the last dock is, for the warning on a dangerous point. */
  pointsToDock(): number {
    const run = this.run;
    return run ? run.cleared - run.road.lastDock(run.cleared) : 0;
  }

  /** The run's ship as it is right now — mid-battle a hull split may have replaced the body. */
  private runShip(): GridBody | null {
    const run = this.run;
    if (!run) return null;
    return this.runPhase === 'battle' ? this.world.player : run.ship;
  }

  /** Hull left on the carried ship, as a share of the ship as built. */
  runHull(): number {
    const run = this.run;
    if (!run) return 1;
    const ship = this.runShip();
    if (ship) return ship.grid.cells / run.blueprint.cells;
    // No ship yet (before the first battle) is a whole one; no ship any more is a lost one.
    return this.runPhase === 'battle' || run.outcome === 'defeat' ? 0 : 1;
  }

  runCrewAlive(): number {
    const crew = this.runShip()?.sys?.crew;
    return crew ? crew.filter((c) => !c.dead).length : 0;
  }

  spawnTarget(x?: number, y?: number, angle?: number): GridBody {
    const p = this.world.player;
    const ang = this.world.rng() * Math.PI * 2;
    const dist = 130 + this.world.rng() * 80;
    const cx = x ?? (p ? p.x : 0) + Math.cos(ang) * dist;
    const cy = y ?? (p ? p.y : 0) + Math.sin(ang) * dist;
    const b = this.world.spawn(buildFreighter(), cx, cy, angle ?? this.world.rng() * Math.PI * 2, 'ship');
    b.w = (this.world.rng() - 0.5) * 0.3;
    return b;
  }

  /**
   * Sandbox: a ship of the given enemy kind appears some way off the player, facing it.
   * An ally flies for the player's side (same team) and picks fights with the enemies.
   */
  spawnShip(id: string, ally = false): void {
    if (this.mode === 'run') return;
    const es = ENEMIES.find((e) => e.id === id);
    if (!es) return;
    const p = this.world.player;
    const a = this.world.rng() * Math.PI * 2;
    const dist = ally ? 120 : id === 'boss' ? 560 : 360;
    const x = (p ? p.x : 0) + Math.cos(a) * dist;
    const y = (p ? p.y : 0) + Math.sin(a) * dist;
    const heading = p ? Math.atan2(p.x - x, -(p.y - y)) : 0;
    this.world.spawnShip(es.build(), x, y, ally ? (p?.angle ?? 0) : heading, { name: ally ? 'Союзник' : es.label, team: ally ? 0 : 1, ai: es.ai });
  }

  /** Sandbox: everything but the player's own ship leaves the scene. */
  clearScene(): void {
    if (this.mode === 'run') return;
    for (const b of this.world.bodies) if (b !== this.world.player) b.removed = true;
    this.clearTargets();
  }

  breakEngine(): void {
    const p = this.world.player;
    if (!p) return;
    const engines = p.grid.modules.filter((m) => m.kind === 'engine' && m.coreAlive);
    if (engines.length === 0) return;
    const m = engines[Math.floor(this.world.rng() * engines.length)];
    const x = p.grid.xOf(m.core);
    const y = p.grid.yOf(m.core);
    const wp = p.localToWorld(x + 0.5, y + 0.5, { x: 0, y: 0 });
    this.world.explode(wp.x, wp.y, 3.2, 200, 0.4);
  }

  weaponRows(): WeaponRow[] {
    const p = this.world.player;
    if (!p) return [];
    const rows: WeaponRow[] = [];
    for (const m of p.grid.modules) if (m.weapon) rows.push({ weapon: m.weapon, module: m });
    return rows.sort((a, b) => a.weapon.id - b.weapon.id);
  }

  selectWeapon(id: number): void {
    this.selectedWeapon = this.selectedWeapon === id ? null : id;
  }

  toggleWeapon(id: number): void {
    const row = this.weaponRows().find((r) => r.weapon.id === id);
    if (row) row.weapon.enabled = !row.weapon.enabled;
  }

  setPriority(p: EnergyPriority): void {
    const sys = this.world.player?.sys;
    if (sys) sys.priority = p;
  }

  setLockFace(v: boolean): void {
    this.world.lockFace = v;
  }

  clearTargets(): void {
    const sys = this.world.player?.sys;
    if (sys) sys.focus = null;
    for (const r of this.weaponRows()) r.weapon.target = null;
    this.selectedWeapon = null;
  }

  private assignTarget(ref: TargetRef): void {
    const sys = this.world.player?.sys;
    if (!sys) return;
    if (this.selectedWeapon !== null) {
      const row = this.weaponRows().find((r) => r.weapon.id === this.selectedWeapon);
      if (row) row.weapon.target = ref;
      this.selectedWeapon = null;
    } else {
      sys.focus = ref;
      for (const r of this.weaponRows()) r.weapon.target = null;
    }
  }

  pickEnemy(wx: number, wy: number): TargetRef | null {
    const p = this.world.player;
    if (!p?.sys) return null;
    let best: { ref: TargetRef; d: number } | null = null;
    for (const b of this.world.bodies) {
      if (b.removed || b.kind !== 'ship' || !b.sys || b.sys.dead || b.sys.team === p.sys.team) continue;
      const lp = b.worldToLocal(wx, wy, { x: 0, y: 0 });
      let bd = Infinity;
      let bx = 0;
      let by = 0;
      const ix = Math.floor(lp.x);
      const iy = Math.floor(lp.y);
      for (let j = -3; j <= 3; j++) {
        for (let i = -3; i <= 3; i++) {
          if (!b.grid.isOccupied(ix + i, iy + j)) continue;
          const cx = ix + i + 0.5;
          const cy = iy + j + 0.5;
          const d = Math.hypot(cx - lp.x, cy - lp.y);
          if (d < bd) {
            bd = d;
            bx = cx;
            by = cy;
          }
        }
      }
      if (bd <= 3.5) {
        if (!best || bd < best.d) best = { ref: shipRef(b, bx, by), d: bd };
      } else {
        const dc = Math.hypot(b.x - wx, b.y - wy);
        if (dc < b.radius + 3 && (!best || dc + 4 < best.d)) best = { ref: shipRef(b), d: dc + 4 };
      }
    }
    return best ? best.ref : null;
  }

  private evaluate(): void {
    if (this.state !== 'playing') return;
    if (this.mode === 'run' ? this.runPhase !== 'battle' : this.scenario.enemies.length === 0) return;
    if (!this.world.player) {
      this.state = 'lost';
      return;
    }
    const enemyAlive = this.world.bodies.some((b) => !b.removed && b.kind === 'ship' && b.sys && !b.sys.dead && b.sys.team === 1);
    // A ship whose own reactor is already counting down hasn't won anything yet.
    if (!enemyAlive && (this.world.player.sys?.countdown ?? -1) < 0) this.state = 'won';
  }

  tick(frameDt: number): void {
    // Behind the title and the dock (both full screens of their own) the world stands still and isn't drawn.
    if (this.screen === 'title' || (this.mode === 'run' && this.runPhase === 'dock')) return;
    const dt = Math.min(frameDt, 0.05);
    let simDt = 0;
    const halted = this.mode === 'run' && this.runPhase !== 'battle';
    if (!this.paused && !halted) {
      const scale = this.slowMo ? 0.25 : 1;
      this.acc += dt * scale;
      simDt = dt * scale;
      let steps = 0;
      const t0 = performance.now();
      while (this.acc >= STEP && steps < 6) {
        this.world.step(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps > 0) this.stepMs = this.stepMs * 0.9 + ((performance.now() - t0) / steps) * 0.1;
      if (steps === 6) this.acc = 0;
      this.evaluate();
    }
    this.scene.render(this.world, dt, simDt);
  }

  pointerAction(wx: number, wy: number): void {
    if (this.tool === 'fly') {
      const enemy = this.pickEnemy(wx, wy);
      if (enemy) {
        this.assignTarget(enemy);
        return;
      }
      this.world.target = this.clampToSurface(wx, wy);
    } else {
      this.world.explode(wx, wy, this.crater.radius, this.crater.damage, this.crater.pen);
    }
  }

  private clampToSurface(wx: number, wy: number): { x: number; y: number } {
    for (const c of this.world.celestials) {
      if (c.kind === 'blackhole') continue;
      const dx = wx - c.x;
      const dy = wy - c.y;
      const d = Math.hypot(dx, dy);
      const limit = c.radius + 2;
      if (d < limit) {
        const k = d > 1e-6 ? limit / d : 0;
        return d > 1e-6 ? { x: c.x + dx * k, y: c.y + dy * k } : { x: c.x + limit, y: c.y };
      }
    }
    return { x: wx, y: wy };
  }

  currentDeckCompartments(): { rooms: Room[]; doors: DoorInfo[] } | null {
    const p = this.world.player;
    const z = this.scene.layerView;
    if (!p?.sys || z === OUTER_VIEW) return null;
    const graph = ensureRooms(p);
    return { rooms: roomsOnDeck(graph, z), doors: doorsOnDeck(p.grid, graph, z) };
  }

  currentDeckCrew(): Crew[] | null {
    const p = this.world.player;
    const z = this.scene.layerView;
    if (!p?.sys?.crew || z === OUTER_VIEW) return null;
    return crewOnDeck(p.sys.crew, z);
  }

  toggleDoor(doorId: number): void {
    const p = this.world.player;
    if (!p) return;
    const door = p.grid.doors[doorId];
    if (door) setDoorOpen(p.grid, doorId, !door.open);
  }

  totals(): { bodies: number; debris: number; cells: number } {
    let cells = 0;
    let debris = 0;
    for (const b of this.world.bodies) {
      cells += b.grid.cells;
      if (b.kind === 'debris') debris++;
    }
    return { bodies: this.world.bodies.length, debris, cells };
  }
}
