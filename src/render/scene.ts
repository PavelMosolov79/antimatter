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
  /** Dust and far traffic, drawn on the screen over the stars and under the world (they move at their own depths). */
  private readonly backdrop = new Graphics();
  /** The buoys marking the mission's way (sim/corridor.ts). */
  buoys: Array<{ x: number; y: number; red: boolean }> = [];
  /** Distant convoys crossing the sky: lanes in the far layer, each with a few ships (made anew for each world). */
  private traffic: Array<{ x: number; y: number; dx: number; dy: number; speed: number; n: number; len: number }> = [];
  private views = new Map<number, BodyView>();
  camX = 0;
  camY = 0;
  zoom = 1.2;
  follow = true;
  /** Pixels the middle of the view is moved down (negative: up), so the ship sits in the free part of the screen over the panels. */
  viewOffY = 0;
  layerView = OUTER_VIEW;
  showDebug = false;
  cursor: { x: number; y: number } | null = null;
  /** Rings round things the game points at (what is under the pointer, the rock being mined, the wreck being looked over), redrawn every frame. */
  rings: Array<{ x: number; y: number; r: number; color: number; solid?: boolean; alpha?: number }> = [];
  /** A "!" over each ship whose alarm has just gone off. */
  alarms: Array<{ x: number; y: number }> = [];
  /** The mission's exit beacon (sim/mission.ts): green and turning once the tasks are done, dim before. */
  beacon: { x: number; y: number; r: number; open: boolean } | null = null;
  craterPreview = 0;

  constructor(app: Application) {
    this.app = app;
    app.stage.addChild(this.starfield.container);
    app.stage.addChild(this.backdrop);
    app.stage.addChild(this.worldLayer);
    this.worldLayer.addChild(this.celestialLayer, this.bodyLayer, this.decorView.container, this.combat.container, this.crewView.container, this.particles.container, this.debug);
  }

  get scale(): number {
    return BASE_PX * this.zoom;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const s = this.scale;
    return { x: (sx - this.app.screen.width / 2) / s + this.camX, y: (sy - this.app.screen.height / 2 - this.viewOffY) / s + this.camY };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const s = this.scale;
    return { x: this.app.screen.width / 2 + (wx - this.camX) * s, y: this.app.screen.height / 2 + this.viewOffY + (wy - this.camY) * s };
  }

  reset(world: World): void {
    this.traffic = [];
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      this.traffic.push({ x: (Math.random() - 0.5) * 1600, y: (Math.random() - 0.5) * 1000, dx: Math.cos(a), dy: Math.sin(a), speed: 6 + Math.random() * 6, n: 2 + Math.floor(Math.random() * 3), len: 2400 });
    }
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
    this.worldLayer.position.set(sw / 2 - this.camX * s, sh / 2 + this.viewOffY - this.camY * s);
    this.starfield.update(this.camX, this.camY, s, sw, sh);
    this.drawBackdrop(world, s, sw, sh);
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
    this.combat.handleEvents(world.events, this.particles, world);
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

  /**
   * Dust on three layers of depth (the nearest moves with the world, the far ones slower), so the speed of the ship
   * shows even in empty space; and far convoys crossing the sky. Screen space; nothing here touches the world.
   */
  private drawBackdrop(world: World, s: number, sw: number, sh: number): void {
    const g = this.backdrop;
    g.clear();
    if (!world.player) return;
    const layers = [
      { f: 0.35, tile: 240, size: 1.5, alpha: 0.3, n: 6 },
      { f: 0.6, tile: 220, size: 2, alpha: 0.4, n: 5 },
      { f: 1, tile: 200, size: 2.5, alpha: 0.5, n: 4 },
    ];
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      // the layer's own offset: the camera seen through its depth
      const ox = this.camX * s * L.f;
      const oy = this.camY * s * L.f;
      const tx0 = Math.floor((ox - sw / 2) / L.tile);
      const ty0 = Math.floor((oy - sh / 2) / L.tile);
      const tx1 = Math.floor((ox + sw / 2) / L.tile);
      const ty1 = Math.floor((oy + sh / 2) / L.tile);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          let h = (tx * 73856093) ^ (ty * 19349663) ^ (li * 83492791);
          for (let k = 0; k < L.n; k++) {
            h = Math.imul(h ^ (h >>> 13), 1274126177) ^ k;
            const rx = ((h >>> 0) % 1000) / 1000;
            const ry = (((h >>> 10) >>> 0) % 1000) / 1000;
            const x = tx * L.tile + rx * L.tile - ox + sw / 2;
            const y = ty * L.tile + ry * L.tile - oy + sh / 2 + this.viewOffY;
            g.rect(x, y, L.size, L.size).fill({ color: k % 3 === 0 ? 0xb8a890 : 0x8c96a8, alpha: L.alpha });
          }
        }
      }
    }
    // far convoys: a few dim ships in a line, slowly crossing, at a fifth of the world's depth
    const t = performance.now() / 1000;
    const f = 0.2;
    for (const lane of this.traffic) {
      const along = ((t * lane.speed) % lane.len) - lane.len / 2;
      for (let i = 0; i < lane.n; i++) {
        const d = along - i * 22;
        const x = lane.x + lane.dx * d - this.camX * s * f + sw / 2;
        const y = lane.y + lane.dy * d - this.camY * s * f + sh / 2 + this.viewOffY;
        if (x < -20 || y < -20 || x > sw + 20 || y > sh + 20) continue;
        const px = -lane.dy;
        const py = lane.dx;
        g.moveTo(x + lane.dx * 5, y + lane.dy * 5)
          .lineTo(x - lane.dx * 3 + px * 3, y - lane.dy * 3 + py * 3)
          .lineTo(x - lane.dx * 3 - px * 3, y - lane.dy * 3 - py * 3)
          .closePath()
          .fill({ color: 0x8f86b8, alpha: 0.35 });
        g.circle(x - lane.dx * 4, y - lane.dy * 4, 1.2).fill({ color: 0xffd24a, alpha: 0.5 + 0.3 * Math.sin(t * 9 + i) });
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

    // the buoys of the way: a light blinking on a small float, green on the left, red on the right
    {
      const t = performance.now() / 1000;
      for (const b of this.buoys) {
        const on = Math.sin(t * 3 + b.x * 0.01) > 0;
        const col = b.red ? 0xff6a5a : 0x63e07a;
        g.rect(b.x - 1.5, b.y - 1.5, 3, 3).fill({ color: 0x4a5568 });
        g.circle(b.x, b.y, on ? 2.2 : 1.2).fill({ color: col, alpha: on ? 0.95 : 0.45 });
        if (on) g.circle(b.x, b.y, 6).stroke({ width: px, color: col, alpha: 0.35 });
      }
      // old mines: seen only near the ship, a red blinking eye in a ring
      const p = world.player;
      for (const m of world.mines) {
        const d = p ? Math.hypot(m.x - p.x, m.y - p.y) : Infinity;
        if (d > 420) continue;
        const k = Math.max(0, Math.min(1, (420 - d) / 200));
        const blink = 0.5 + 0.5 * Math.sin(t * 7 + m.x);
        g.circle(m.x, m.y, 3).fill({ color: 0x3a2a2a, alpha: k });
        g.circle(m.x, m.y, 1.4).fill({ color: 0xff3b2a, alpha: k * (0.4 + 0.6 * blink) });
        g.circle(m.x, m.y, 9).stroke({ width: px, color: 0xff6a5a, alpha: k * 0.35 });
      }
    }

    // containers left after a fight: a violet box with a ring pulsing round it
    for (const l of world.loot) {
      const t = performance.now() / 1000;
      g.rect(l.x - 4, l.y - 3, 8, 6).fill({ color: 0x8a52d6 });
      g.rect(l.x - 4, l.y - 0.5, 8, 1).fill({ color: 0xd9c4ff });
      g.circle(l.x, l.y, 9 + 2 * Math.sin(t * 4)).stroke({ width: px * 1.3, color: 0xb06bff, alpha: 0.7 });
    }
    const bc = this.beacon;
    if (bc) {
      const t = performance.now() / 1000;
      const col = bc.open ? 0x63e07a : 0x4d7a66;
      const a = bc.open ? 0.95 : 0.55;
      // the ring of the jump field, six pylons on it, and the core
      g.circle(bc.x, bc.y, bc.r).stroke({ width: px * 2, color: col, alpha: a * 0.8 });
      g.circle(bc.x, bc.y, bc.r * (0.55 + 0.08 * Math.sin(t * 2.4))).stroke({ width: px * 1.2, color: col, alpha: a * 0.5 });
      const spin = bc.open ? t * 0.6 : 0;
      for (let i = 0; i < 6; i++) {
        const ang = spin + (i / 6) * Math.PI * 2;
        const x = bc.x + Math.cos(ang) * bc.r;
        const y = bc.y + Math.sin(ang) * bc.r;
        g.rect(x - 2, y - 2, 4, 4).fill({ color: col, alpha: a });
        g.moveTo(x, y).lineTo(bc.x + Math.cos(ang) * bc.r * 0.72, bc.y + Math.sin(ang) * bc.r * 0.72).stroke({ width: px * 1.2, color: col, alpha: a * 0.6 });
      }
      g.circle(bc.x, bc.y, 6 + (bc.open ? 2 * Math.sin(t * 5) : 0)).fill({ color: col, alpha: a * 0.85 });
    }

    for (const r of this.rings) {
      // a dashed ring, slowly turning (a solid one for what is under the pointer)
      const n = Math.max(16, Math.min(48, Math.round(r.r / 2)));
      const turn = performance.now() / 2400;
      const ra = r.alpha ?? 1;
      if (r.solid) g.circle(r.x, r.y, r.r).stroke({ width: px * 1.3, color: r.color, alpha: 0.75 * ra });
      else {
        for (let i = 0; i < n; i += 2) {
          const a0 = turn + (i / n) * Math.PI * 2;
          const a1 = turn + ((i + 1) / n) * Math.PI * 2;
          g.moveTo(r.x + Math.cos(a0) * r.r, r.y + Math.sin(a0) * r.r).lineTo(r.x + Math.cos(a1) * r.r, r.y + Math.sin(a1) * r.r);
        }
        g.stroke({ width: px * 1.6, color: r.color, alpha: 0.85 * ra });
      }
    }
    // the alarm: a "!" a fixed size on the screen, over the ship
    for (const m of this.alarms) {
      const k = px / 1.5;
      g.rect(m.x - 2.5 * k, m.y - 26 * k, 5 * k, 15 * k).fill({ color: 0xffd24a });
      g.rect(m.x - 2.5 * k, m.y - 8 * k, 5 * k, 5 * k).fill({ color: 0xffd24a });
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
