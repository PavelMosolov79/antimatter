import type { GridBody } from './sim/body';
import { doorsOnDeck, ensureRooms, roomsOnDeck, setDoorOpen, type DoorInfo, type Room } from './sim/compartments';
import { crewOnDeck, type Crew } from './sim/crew';
import type { Celestial } from './sim/gravity';
import type { EnergyPriority } from './sim/systems';
import { ENEMIES, SHIPS, buildFreighter } from './sim/ships';
import type { ShipGrid } from './sim/grid';
import { encounterFor, generateMap, repairShip, restAfterBattle, type MapNode, type RunMap } from './sim/run';
import { shipRef } from './sim/weapons';
import type { Module, TargetRef, WeaponState } from './sim/grid';
import { World } from './sim/world';
import { Scene } from './render/scene';
import { OUTER_VIEW } from './render/shipView';

export type Tool = 'fly' | 'crater';
export type BattleState = 'playing' | 'won' | 'lost';
export type Mode = 'sandbox' | 'run';
export type RunPhase = 'dock' | 'map' | 'battle' | 'over';
export type RunOutcome = 'victory' | 'defeat' | 'retreat';

/** A run in progress: the map, where the player is on it, and the ship they carry between nodes. */
export interface RunSession {
  shipId: string;
  map: RunMap;
  current: number;
  visited: number[];
  outcome: RunOutcome | null;
  /** The player's ship as it left the last battle; null until the first fight builds it. */
  ship: GridBody | null;
  blueprint: ShipGrid;
  battlesWon: number;
  fighting: MapNode | null;
  note: string;
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

function arena(): Celestial[] {
  return [
    { kind: 'planet', x: 650, y: 220, radius: 100, mu: 90000, soft: 2, seed: 4 },
    { kind: 'moon', x: 260, y: -330, radius: 28, mu: 6000, soft: 1, seed: 9 },
    { kind: 'star', x: -2200, y: -1700, radius: 220, mu: 677000, soft: 5, seed: 2 },
    { kind: 'blackhole', x: 2100, y: -1300, radius: 22, mu: 160000, soft: 8, seed: 6 },
  ];
}

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
  run: RunSession | null = null;
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
    this.world.celestials = arena();
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

  /** The dock (stand-in until MVP-4): pick a ship, then launch. The chosen ship idles on screen. */
  openDock(shipId = this.shipId): void {
    this.mode = 'run';
    this.runPhase = 'dock';
    this.run = null;
    this.shipId = shipId;
    const spec = SHIPS.find((s) => s.id === shipId) ?? SHIPS[0];
    this.world = new World(this.seed++);
    this.world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true });
    this.state = 'playing';
    this.selectedWeapon = null;
    this.scene.reset(this.world);
    this.acc = 0;
  }

  startRun(): void {
    const spec = SHIPS.find((s) => s.id === this.shipId) ?? SHIPS[0];
    const map = generateMap((Math.random() * 2 ** 31) >>> 0);
    const start = map.nodes.find((n) => n.kind === 'start')!;
    this.run = {
      shipId: spec.id,
      map,
      current: start.id,
      visited: [start.id],
      outcome: null,
      ship: null,
      blueprint: spec.build(),
      battlesWon: 0,
      fighting: null,
      note: 'Вылет из дока. Выберите следующий узел.',
    };
    this.runPhase = 'map';
  }

  canTravel(nodeId: number): boolean {
    const run = this.run;
    if (!run || this.runPhase !== 'map') return false;
    return run.map.nodes[run.current].next.includes(nodeId);
  }

  travel(nodeId: number): void {
    const run = this.run;
    if (!run || !this.canTravel(nodeId)) return;
    const node = run.map.nodes[nodeId];
    if (node.kind === 'repair') {
      run.current = nodeId;
      run.visited.push(nodeId);
      if (run.ship) {
        const rep = repairShip(run.ship, run.blueprint);
        restAfterBattle(run.ship);
        run.note = `Ремонтная станция: залатано ${rep.rebuilt.length} клеток, укреплено ${rep.healed}.` + (rep.lostForGood > 0 ? ` Не восстановить в пути: ${rep.lostForGood} (оторвано или модуль уничтожен).` : '');
      } else run.note = 'Ремонтная станция: корабль цел, чинить нечего.';
      return;
    }
    this.startBattle(node);
  }

  private startBattle(node: MapNode): void {
    const run = this.run!;
    const enc = encounterFor(run.map, node);
    const spec = SHIPS.find((s) => s.id === run.shipId) ?? SHIPS[0];
    const lock = this.world.lockFace;
    const autopilot = this.world.autopilot;
    this.world = new World(this.seed++);
    this.world.lockFace = lock;
    this.world.autopilot = autopilot;
    this.world.celestials = enc.celestials;
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
    run.fighting = node;
    this.runPhase = 'battle';
    this.state = 'playing';
    this.selectedWeapon = null;
    this.scene.reset(this.world);
    this.acc = 0;
  }

  /** After the battle's end screen: back to the map, or on to the run's result. */
  continueRun(): void {
    const run = this.run;
    if (!run || this.runPhase !== 'battle') return;
    const node = run.fighting!;
    const ship = this.world.player;
    if (this.state === 'lost' || !ship) {
      run.outcome = 'defeat';
      run.ship = null;
      this.runPhase = 'over';
      return;
    }
    run.ship = ship;
    restAfterBattle(ship);
    run.battlesWon++;
    run.current = node.id;
    run.visited.push(node.id);
    run.fighting = null;
    if (node.kind === 'boss') {
      run.outcome = 'victory';
      this.runPhase = 'over';
    } else {
      run.note = node.kind === 'elite' ? 'Элитный бой выигран.' : 'Бой выигран.';
      this.runPhase = 'map';
    }
  }

  retreat(): void {
    const run = this.run;
    if (!run || this.runPhase !== 'map') return;
    run.outcome = 'retreat';
    this.runPhase = 'over';
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
    // Behind the title the world stands still and isn't drawn.
    if (this.screen === 'title') return;
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
