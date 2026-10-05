import { Application, Container, Graphics } from 'pixi.js';
import type { GridBody } from '../sim/body';
import { moduleEfficiency } from '../sim/grid';
import { DRIVES, driveOf, isNozzle, liveCentroid } from '../sim/propulsion';
import type { World } from '../sim/world';
import { CombatFx } from './combatFx';
import { CrewView } from './crewView';
import { DecorView } from './decorView';
import type { Celestial } from '../sim/gravity';
import { createCelestialView, type CelestialView } from './celestials';
import { Particles } from './particles';
import { BodyView, OUTER_VIEW } from './shipView';
import { Starfield } from './starfield';

export const BASE_PX = 4;

export class Scene {
  readonly app: Application;
  readonly starfield = new Starfield();
  readonly worldLayer = new Container();
  readonly celestialLayer = new Container();
  private celestialViews = new Map<Celestial, CelestialView>();
  readonly bodyLayer = new Container();
  readonly particles = new Particles();
  readonly combat = new CombatFx();
  readonly decorView = new DecorView();
  readonly crewView = new CrewView();
  readonly debug = new Graphics();
  private views = new Map<number, BodyView>();
  camX = 0;
  camY = 0;
  zoom = 1.2;
  follow = true;
  layerView = OUTER_VIEW;
  showDebug = false;
  cursor: { x: number; y: number } | null = null;
  craterPreview = 0;

  constructor(app: Application) {
    this.app = app;
    app.stage.addChild(this.starfield.container);
    app.stage.addChild(this.worldLayer);
    this.worldLayer.addChild(this.celestialLayer, this.bodyLayer, this.decorView.container, this.combat.container, this.crewView.container, this.particles.container, this.debug);
  }

  get scale(): number {
    return BASE_PX * this.zoom;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const s = this.scale;
    return { x: (sx - this.app.screen.width / 2) / s + this.camX, y: (sy - this.app.screen.height / 2) / s + this.camY };
  }

  reset(world: World): void {
    for (const v of this.views.values()) {
      this.bodyLayer.removeChild(v.sprite);
      v.destroy();
    }
    this.views.clear();
    this.particles.clear();
    this.combat.reset();
    this.crewView.reset();
    this.decorView.reset();
    for (const [, v] of this.celestialViews) v.dispose?.();
    for (const c of [...this.celestialLayer.children]) c.destroy({ children: true });
    this.celestialViews.clear();
    this.syncCelestials(world);
    this.starfield.setSector(world.sector, world.skySeed);
    if (world.player) {
      this.camX = world.player.x;
      this.camY = world.player.y;
    }
  }

  /** The sky changes as the player flies (sim/sky.ts): views for what has come into the world, away with what has left it. */
  private syncCelestials(world: World): void {
    const live = new Set(world.celestials);
    for (const [c, v] of this.celestialViews) {
      if (live.has(c)) continue;
      v.dispose?.();
      v.root.destroy({ children: true });
      this.celestialViews.delete(c);
    }
    for (const c of world.celestials) {
      if (this.celestialViews.has(c)) continue;
      const v = createCelestialView(c);
      this.celestialViews.set(c, v);
      this.celestialLayer.addChild(v.root);
    }
  }

  render(world: World, dt: number, simDt: number): void {
    const p = world.player;
    if (this.follow && p) {
      const k = Math.min(1, dt * 6);
      this.camX += (p.x - this.camX) * k;
      this.camY += (p.y - this.camY) * k;
    }
    const s = this.scale;
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    this.worldLayer.scale.set(s);
    this.worldLayer.position.set(sw / 2 - this.camX * s, sh / 2 - this.camY * s);
    this.starfield.update(this.camX, this.camY, s, sw, sh);
    const now = performance.now() / 1000;
    this.syncCelestials(world);
    for (const v of this.celestialViews.values()) v.update(now, this.camX - sw / 2 / s, this.camY - sh / 2 / s, this.camX + sw / 2 / s, this.camY + sh / 2 / s, world.time);

    const alive = new Set<number>();
    for (const b of world.bodies) alive.add(b.id);
    for (const [id, v] of this.views) {
      if (!alive.has(id)) {
        this.bodyLayer.removeChild(v.sprite);
        v.destroy();
        this.views.delete(id);
      }
    }
    for (const b of world.bodies) {
      let v = this.views.get(b.id);
      if (!v) {
        v = new BodyView(b);
        this.views.set(b.id, v);
        this.bodyLayer.addChild(v.sprite);
      }
      v.update(this.layerView, performance.now() / 1000);
    }

    if (simDt > 0) {
      for (const b of world.bodies) if (b.isPlayer || (b.sys && !b.sys.dead)) this.emitFlames(b);
    }
    this.particles.handleEvents(world.events);
    this.combat.handleEvents(world.events, this.particles);
    world.events.length = 0;
    this.particles.update(simDt);
    this.combat.update(world, simDt, s, this.layerView);
    this.decorView.update(world.player, this.layerView, s, now);
    this.crewView.update(world, this.layerView);
    this.drawDebug(world);
  }

  /** Nozzle puffs: every brake, maneuvering and turning nozzle shows what it fired this tick, in its own colour. */
  private emitThrusters(b: GridBody): void {
    const g = b.grid;
    for (const m of g.modules) {
      if (!isNozzle(m)) continue;
      const act = m.out * moduleEfficiency(m);
      if (act < 0.04) continue;
      const c = liveCentroid(g, m);
      if (!c) continue;
      const colors = DRIVES[driveOf(m)!].exhaust;
      const wp = b.localToWorld(c.x, c.y, { x: 0, y: 0 });
      const ex = -(b.c * m.dirX - b.s * m.dirY);
      const ey = -(b.s * m.dirX + b.c * m.dirY);
      const count = act * 3;
      let emit = Math.floor(count) + (Math.random() < count % 1 ? 1 : 0);
      while (emit-- > 0) {
        const speed = 14 + Math.random() * 10;
        const jitter = (Math.random() - 0.5) * 3;
        const off = 1.2 + Math.random() * 0.8;
        this.particles.emit(
          wp.x + ex * off,
          wp.y + ey * off,
          b.vx + ex * speed - ey * jitter,
          b.vy + ey * speed + ex * jitter,
          0.14 + Math.random() * 0.18,
          1 + Math.random() * 0.9,
          colors[Math.floor(Math.random() * colors.length)],
          true,
          2,
        );
      }
    }
  }

  /** Main drive flames, sized by each drive's actual (spooled) output and coloured by its type. */
  private emitFlames(b: GridBody): void {
    this.emitThrusters(b);
    const g = b.grid;
    for (const m of g.modules) {
      if (m.kind !== 'engine') continue;
      const act = m.out * moduleEfficiency(m);
      if (act < 0.02) continue;
      const c = liveCentroid(g, m);
      if (!c) continue;
      const colors = DRIVES[driveOf(m)!].exhaust;
      const wp = b.localToWorld(c.x, c.y, { x: 0, y: 0 });
      const bx = -(b.c * m.dirX - b.s * m.dirY);
      const by = -(b.s * m.dirX + b.c * m.dirY);
      const count = act * 2.5;
      let emit = Math.floor(count) + (Math.random() < count % 1 ? 1 : 0);
      while (emit-- > 0) {
        const speed = 22 + Math.random() * 16;
        const jitter = (Math.random() - 0.5) * 6;
        const vx = b.vx + bx * speed - by * jitter;
        const vy = b.vy + by * speed + bx * jitter;
        const off = 1 + Math.random() * 2;
        this.particles.emit(wp.x + bx * off, wp.y + by * off, vx, vy, 0.18 + Math.random() * 0.25, 1 + Math.random() * 1.2, colors[Math.floor(Math.random() * colors.length)], true, 1.5);
      }
    }
  }

  private drawDebug(world: World): void {
    const g = this.debug;
    g.clear();
    const px = 1.5 / this.scale;

    if (world.target) {
      const t = world.target;
      const pulse = 1 + 0.15 * Math.sin(performance.now() / 180);
      g.circle(t.x, t.y, 3.5 * pulse).stroke({ width: px * 1.4, color: 0x59e6ff, alpha: 0.9 });
      g.moveTo(t.x - 5, t.y).lineTo(t.x + 5, t.y).stroke({ width: px, color: 0x59e6ff, alpha: 0.7 });
      g.moveTo(t.x, t.y - 5).lineTo(t.x, t.y + 5).stroke({ width: px, color: 0x59e6ff, alpha: 0.7 });
      const p = world.player;
      if (p) g.moveTo(p.x, p.y).lineTo(t.x, t.y).stroke({ width: px, color: 0x59e6ff, alpha: 0.18 });
    }

    if (this.craterPreview > 0 && this.cursor) {
      g.circle(this.cursor.x, this.cursor.y, this.craterPreview).stroke({ width: px, color: 0xff8a4a, alpha: 0.9 });
    }

    if (!this.showDebug) return;
    for (const b of world.bodies) {
      g.circle(b.x, b.y, b.radius).stroke({ width: px, color: 0x88a0c8, alpha: 0.25 });
      g.moveTo(b.x - 1.5, b.y).lineTo(b.x + 1.5, b.y).stroke({ width: px, color: 0xffe066 });
      g.moveTo(b.x, b.y - 1.5).lineTo(b.x, b.y + 1.5).stroke({ width: px, color: 0xffe066 });
      g.moveTo(b.x, b.y).lineTo(b.x + b.vx, b.y + b.vy).stroke({ width: px, color: 0x66ff88, alpha: 0.9 });
    }
    const p = world.player;
    if (p) {
      const gv = world.gravityAt(p.x, p.y);
      g.moveTo(p.x, p.y).lineTo(p.x + gv.ax * 10, p.y + gv.ay * 10).stroke({ width: px, color: 0x6aa0ff });
      const fwdx = p.s;
      const fwdy = -p.c;
      g.moveTo(p.x, p.y).lineTo(p.x + fwdx * 12, p.y + fwdy * 12).stroke({ width: px, color: 0xffffff, alpha: 0.6 });
    }
  }
}
