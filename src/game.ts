import type { GridBody } from './sim/body';
import type { Celestial } from './sim/gravity';
import { SHIPS, buildFreighter } from './sim/ships';
import { World } from './sim/world';
import { Scene } from './render/scene';

export type Tool = 'fly' | 'crater';

export const STEP = 1 / 60;

function arena(): Celestial[] {
  return [
    { kind: 'planet', x: 650, y: 220, radius: 100, mu: 90000, soft: 2, seed: 4 },
    { kind: 'moon', x: 260, y: -330, radius: 28, mu: 6000, soft: 1, seed: 9 },
    { kind: 'star', x: -2200, y: -1700, radius: 220, mu: 677000, soft: 5, seed: 2 },
    { kind: 'blackhole', x: 2100, y: -1300, radius: 22, mu: 160000, soft: 8, seed: 6 },
  ];
}

export class Game {
  world: World;
  readonly scene: Scene;
  tool: Tool = 'fly';
  crater = { radius: 5, damage: 60, pen: 0.6 };
  paused = false;
  slowMo = false;
  shipId = 'fighter';
  stepMs = 0;
  private acc = 0;
  private seed = 1;

  constructor(scene: Scene) {
    this.scene = scene;
    this.world = new World(this.seed);
    this.reset();
  }

  reset(shipId = this.shipId): void {
    this.shipId = shipId;
    const spec = SHIPS.find((s) => s.id === shipId) ?? SHIPS[0];
    this.world = new World(this.seed++);
    this.world.celestials = arena();
    this.world.spawnPlayer(spec.build(), 0, 0, 0);
    this.spawnTarget(150, -130, 0.5);
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
    }
    this.scene.render(this.world, dt, simDt);
  }

  pointerAction(wx: number, wy: number): void {
    if (this.tool === 'fly') {
      this.world.target = { x: wx, y: wy };
    } else {
      this.world.explode(wx, wy, this.crater.radius, this.crater.damage, this.crater.pen);
    }
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
