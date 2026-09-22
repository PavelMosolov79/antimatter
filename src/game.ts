import type { GridBody } from './sim/body';
import { doorsOnDeck, ensureRooms, roomsOnDeck, setDoorOpen, type DoorInfo, type Room } from './sim/compartments';
import type { Celestial } from './sim/gravity';
import type { EnergyPriority } from './sim/systems';
import { ENEMIES, SHIPS, buildFreighter } from './sim/ships';
import { shipRef } from './sim/weapons';
import type { Module, TargetRef, WeaponState } from './sim/grid';
import { World } from './sim/world';
import { Scene } from './render/scene';
import { OUTER_VIEW } from './render/shipView';

export type Tool = 'fly' | 'crater';
export type BattleState = 'playing' | 'won' | 'lost';

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
  selectedWeapon: number | null = null;
  stepMs = 0;
  private acc = 0;
  private seed = 1;

  constructor(scene: Scene) {
    this.scene = scene;
    this.world = new World(this.seed);
    this.reset();
  }

  get scenario(): Scenario {
    return SCENARIOS.find((s) => s.id === this.scenarioId) ?? SCENARIOS[0];
  }

  reset(shipId = this.shipId, scenarioId = this.scenarioId): void {
    this.shipId = shipId;
    this.scenarioId = scenarioId;
    const spec = SHIPS.find((s) => s.id === shipId) ?? SHIPS[0];
    const lock = this.world ? this.world.lockFace : true;
    this.world = new World(this.seed++);
    this.world.lockFace = lock;
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
    if (this.state !== 'playing' || this.scenario.enemies.length === 0) return;
    if (!this.world.player) {
      this.state = 'lost';
      return;
    }
    const enemyAlive = this.world.bodies.some((b) => !b.removed && b.kind === 'ship' && b.sys && !b.sys.dead && b.sys.team === 1);
    if (!enemyAlive) this.state = 'won';
  }

  tick(frameDt: number): void {
    const dt = Math.min(frameDt, 0.05);
    let simDt = 0;
    if (!this.paused) {
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
