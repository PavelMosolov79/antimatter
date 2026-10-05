import { Assets, BlurFilter, Container, Graphics, Rectangle, Sprite, Text, Texture, type Application } from 'pixi.js';
import type { Game } from '../src/game';
import type { Scene } from '../src/render/scene';
import { OUTER_VIEW } from '../src/render/shipView';
import type { GridBody } from '../src/sim/body';
import type { Celestial } from '../src/sim/gravity';
import { ENEMIES, SHIPS } from '../src/sim/ships';
import { type SectorId } from '../src/sim/space';
import { inspect, wreckBody } from '../src/sim/wrecks';
import { World } from '../src/sim/world';

export interface AudioEv {
  t: number;
  kind: string;
  v: number;
}

export interface Ctx {
  app: Application;
  scene: Scene;
  game: Game;
  fx: Container;
  W: number;
  H: number;
  FPS: number;
  shake: number;
  flash: number;
  flashColor: number;
  readonly world: World;
  step(n: number): void;
  layer: number;
  /** The film's clock, seconds. */
  time: number;
  /** Sounds to make, from what happened (cinema/audio.ts). */
  audio: AudioEv[];
  observe(): void;
  draw(speed: number): void;
}

export interface Shot {
  dur: number;
  setup(ctx: Ctx): void | Promise<void>;
  /** `t` is the time inside the shot, `T` in the whole film (seconds). */
  frame(ctx: Ctx, t: number, T: number, f: number): void | Promise<void>;
  /** Called when the film moves on to the next shot. */
  leave?(ctx: Ctx): void;
}

export interface Caption {
  /** Lines, each with its colour and the second (after the caption's start) it appears at. */
  lines: Array<[string, number, number?]>;
  t0: number;
  t1: number;
  y: number;
  size?: number;
}

const WHITE = 0xffffff;
const CYAN = 0x59e6ff;
const YELLOW = 0xffd24a;
const PINK = 0xff5fd8;
const RED = 0xff6a5a;

export const CAPTIONS: Caption[] = [
  { lines: [['РЕАЛИСТИЧНЫЕ', WHITE], ['РАЗРУШЕНИЯ', YELLOW]], t0: 0.2, t1: 2.9, y: 1560 },
  { lines: [['ПОЖАРЫ,', YELLOW, 0], ['ПРОБОИНЫ,', RED, 0.5], ['ЭКИПАЖ', CYAN, 1.0]], t0: 3.3, t1: 5.9, y: 1560 },
  { lines: [['РЕМОНТ', WHITE], ['В ДОКЕ', CYAN]], t0: 6.05, t1: 7.35, y: 1770, size: 84 },
  { lines: [['ИССЛЕДУЙ', WHITE], ['ДАЛЬНИЙ КОСМОС', YELLOW]], t0: 7.5, t1: 8.95, y: 1560 },
  { lines: [['ТВОЙ ДОК', WHITE]], t0: 9.1, t1: 9.95, y: 1770, size: 90 },
  { lines: [['СОБЕРИ КОРАБЛЬ', CYAN]], t0: 10.05, t1: 11.5, y: 1770, size: 90 },
  { lines: [['НАЙМИ ЭКИПАЖ', YELLOW]], t0: 11.6, t1: 12.95, y: 1770, size: 90 },
];
void PINK;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

let simDebt = 0;
const fired = new Set<string>();
/** Makes a sound once, when the shot's clock `t` passes `at` (film seconds are added by the shot's start). */
function sfx(ctx: Ctx, key: string, t: number, at: number, kind: string, v = 1): void {
  if (t >= at && !fired.has(key)) {
    fired.add(key);
    ctx.audio.push({ t: ctx.time, kind, v });
  }
}
/** Steps the world by `speed` × real time (1 = normal, 0.25 = slow motion). */
function stepSpeed(ctx: Ctx, speed: number): void {
  simDebt += 2 * speed;
  const n = Math.floor(simDebt);
  simDebt -= n;
  ctx.step(n);
}

interface Foe {
  id: string;
  x: number;
  y: number;
  /** Heading in radians; 0 faces up. */
  a?: number;
}

/** A fresh world with the player's ship and chosen enemies at exact places; replaces the game's world. */
function arena(ctx: Ctx, o: { ship: string; sector?: SectorId; px?: number; py?: number; pa?: number; foes: Foe[]; celestials?: Celestial[] }): World {
  const g = ctx.game;
  const w = new World(7);
  w.setCelestials(o.celestials ?? []);
  w.sector = o.sector ?? 'violet';
  w.skySeed = 11;
  w.streaming = false;
  const spec = SHIPS.find((s) => s.id === o.ship)!;
  w.spawnShip(spec.build(), o.px ?? 0, o.py ?? 0, o.pa ?? 0, { name: spec.label, team: 0, player: true, duty: g.duty(spec.id) });
  for (const f of o.foes) {
    const es = ENEMIES.find((e) => e.id === f.id)!;
    w.spawnShip(es.build(), f.x, f.y, f.a ?? Math.PI, { name: es.label, team: 1, ai: es.ai });
  }
  g.world = w;
  g.state = 'playing';
  ctx.scene.reset(w);
  ctx.world.events.length = 0;
  return w;
}

const foesOf = (w: World): GridBody[] => w.bodies.filter((b) => !b.removed && b.sys && b.sys.team === 1 && !b.sys.dead);

/** Camera: eases to a point and a zoom. */
function camTo(ctx: Ctx, x: number, y: number, zoom: number, k = 0.12): void {
  ctx.scene.camX = lerp(ctx.scene.camX, x, k);
  ctx.scene.camY = lerp(ctx.scene.camY, y, k);
  ctx.scene.zoom = lerp(ctx.scene.zoom, zoom, k);
}

/** 1. The hook: a cluster of enemy ships, one reactor blows, and the blast takes the others with it. */
let hookBoom = false;
let boomAt = { x: 0, y: -60 };
const hook: Shot = {
  dur: 3,
  setup(ctx) {
    hookBoom = false;
    simDebt = 0;
    const w = arena(ctx, {
      ship: 'battleship',
      px: 0,
      py: 150,
      foes: [
        { id: 'hunter', x: 0, y: -90, a: Math.PI },
        { id: 'raider', x: -34, y: -62, a: Math.PI },
        { id: 'raider', x: 36, y: -66, a: Math.PI },
        { id: 'scout', x: 4, y: -128, a: Math.PI },
      ],
    });
    for (const b of foesOf(w)) {
      b.sys!.ai = null; // they come on in a line, steady, for the shot
      b.vy = 34;
    }
    if (w.player) w.player.vy = -16;
    ctx.scene.layerView = OUTER_VIEW;
    ctx.scene.camX = 0;
    ctx.scene.camY = -35;
    ctx.scene.zoom = 1.55;
    ctx.shake = 14;
    ctx.game.pointerAction(0, -90);
  },
  frame(ctx, t) {
    const w = ctx.world;
    const foes = foesOf(w);
    let speed = 1;
    if (!hookBoom && t >= 1.0 && foes.length) {
      hookBoom = true;
      const hub = foes.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a));
      boomAt = { x: hub.x, y: hub.y };
      w.detonate(hub);
    }
    if (hookBoom) speed = lerp(0.2, 1, smooth((t - 1.0) / 1.6));
    camTo(ctx, hookBoom ? boomAt.x : 0, hookBoom ? boomAt.y - 25 : foes.length ? foes[0].y + 45 : -35, hookBoom ? 2.5 : 2.05, hookBoom ? 0.07 : 0.1);
    stepSpeed(ctx, speed);
    ctx.draw(speed);
  },
};

/** 2. Inside: the cruiser's deck, its people running, hits tearing the hull, fire, and the engineers at work. */
let deckHits: boolean[] = [];
const deck: Shot = {
  dur: 3,
  setup(ctx) {
    simDebt = 0;
    deckHits = [];
    const w = arena(ctx, {
      ship: 'cruiser',
      px: 0,
      py: 0,
      foes: [
        { id: 'raider', x: -70, y: -150, a: Math.PI },
        { id: 'hunter', x: 80, y: -170, a: Math.PI },
      ],
    });
    // the engineers come up to the first deck, one to a room, ready for whatever burns
    const pl = ctx.world.player!;
    ctx.step(4);
    const rooms = (pl.sys!.rooms?.rooms ?? []).filter((r) => r.z === 1 && r.cells.length > 40);
    const eng = (pl.sys!.crew ?? []).filter((c) => c.role === 'engineer');
    eng.forEach((c, i) => {
      const r = rooms[(i * 2 + 1) % Math.max(1, rooms.length)];
      if (!r) return;
      const mid = r.cells[Math.floor(r.cells.length / 2) + (i % 3) * 3];
      c.x = pl.grid.xOf(mid) + 0.5;
      c.y = pl.grid.yOf(mid) + 0.5;
      c.z = 1;
      c.roomId = r.id;
      c.waypoints = [];
      c.task = 'idle';
    });
    ctx.scene.layerView = 1;
    ctx.scene.camX = 0;
    ctx.scene.camY = 0;
    ctx.scene.zoom = 4.2;
    ctx.step(30);
    ctx.world.events.length = 0;
    void w;
  },
  frame(ctx, t) {
    const w = ctx.world;
    const p = w.player;
    if (p) {
      const hits: Array<[number, number, number, number]> = [
        // time, local x, local y, radius
        [0.5, 0.3, 0.45, 4],
        [1.0, 0.7, 0.3, 5],
        [1.5, 0.35, 0.65, 6],
        [2.0, 0.5, 0.15, 7],
      ];
      hits.forEach(([ht, fx, fy, r], i) => {
        if (t >= ht && !deckHits[i]) {
          deckHits[i] = true;
          const wp = p.localToWorld(p.grid.width * fx, p.grid.height * fy, { x: 0, y: 0 });
          w.explode(wp.x, wp.y, r, 140, 0.9);
        }
      });
    }
    camTo(ctx, p ? p.x : 0, p ? p.y : 0, 4.2 + t * 0.3, 0.2);
    stepSpeed(ctx, 1);
    ctx.draw(1);
  },
};

/** Steps `n` fixed ticks, then renders one frame; the world's clock may be pushed on by `extra` seconds besides (time-lapse). */
function advance(ctx: Ctx, speed: number, extra = 0): void {
  stepSpeed(ctx, speed);
  ctx.world.time += extra;
  ctx.draw(speed);
}

/** 4. A station's wreck: the ship looks it over, and its reactor was a trap. */
let wreckHud: { g: Graphics; label: Text } | null = null;
let wreckAlert = -1;
const wreck: Shot = {
  dur: 1.6,
  setup(ctx) {
    simDebt = 0;
    wreckAlert = -1;
    let seed = 1;
    while (inspect(wreckBody(0, 0, seed, 'station')).trap !== 'reactor') seed++;
    const c = wreckBody(0, -30, seed, 'station');
    const w = arena(ctx, { ship: 'fighter', px: 0, py: 0, sector: 'green', celestials: [c], foes: [] });
    const hull = w.bodies.find((b) => b.anchored)!;
    if (w.player) {
      w.player.x = hull.x + hull.radius + 40;
      w.player.y = hull.y + 10;
      w.player.angle = -0.5;
    }
    w.autopilot = false;
    if (!wreckHud) {
      wreckHud = {
        g: new Graphics(),
        label: new Text({ text: '', style: { fontFamily: 'JetBrains Mono, monospace', fontWeight: '700', fontSize: 54, fill: 0xffd24a, stroke: { color: 0x05070d, width: 8 }, align: 'center' } }),
      };
      wreckHud.label.anchor.set(0.5);
      ctx.fx.addChildAt(wreckHud.g, 1);
      ctx.fx.addChildAt(wreckHud.label, 2);
    }
    wreckHud.g.visible = true;
    wreckHud.label.visible = true;
    ctx.scene.layerView = OUTER_VIEW;
    ctx.scene.camX = hull.x + hull.radius * 0.5;
    ctx.scene.camY = hull.y;
    ctx.scene.zoom = 1.3;
    ctx.step(1);
    ctx.world.events.length = 0;
  },
  frame(ctx, t) {
    const w = ctx.world;
    const hull = w.bodies.find((b) => b.anchored) ?? null;
    const pl = w.player;
    const cx = hull && pl ? (hull.x + pl.x) / 2 : pl ? pl.x : 0;
    const cy = hull && pl ? (hull.y + pl.y) / 2 : pl ? pl.y : 0;
    camTo(ctx, cx, cy, 1.3 + t * 0.1, 0.1);
    advance(ctx, 5);
    const hud = wreckHud!;
    hud.g.clear();
    const sc = ctx.scene.scale;
    const toScreen = (x: number, y: number): [number, number] => [ctx.W / 2 + (x - ctx.scene.camX) * sc, ctx.H / 2 + (y - ctx.scene.camY) * sc];
    for (const n of w.notes) if (n.type === 'trap' && wreckAlert < 0) wreckAlert = t;
    w.notes.length = 0;
    if (hull && !hull.removed) {
      const [sx, sy] = toScreen(hull.x, hull.y);
      const R = (hull.radius + 12) * sc;
      if (wreckAlert >= 0) {
        const blink = Math.floor((t - wreckAlert) * 8) % 2 === 0;
        hud.g.circle(sx, sy, R).stroke({ width: 8, color: 0xff3b2e, alpha: blink ? 1 : 0.35 });
        hud.label.text = 'ЛОВУШКА!\nРЕАКТОР РАЗГОНЯЕТСЯ';
        hud.label.style.fill = 0xff6a5a;
        hud.label.position.set(Math.min(780, Math.max(300, sx)), Math.max(160, sy - R - 70));
      } else {
        const ins = w.inspecting;
        const frac = ins ? ins.frac : 0;
        hud.g.circle(sx, sy, R).stroke({ width: 4, color: 0xffd24a, alpha: 0.35 });
        if (frac > 0) hud.g.arc(sx, sy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac).stroke({ width: 10, color: 0xffd24a });
        hud.label.text = 'ОСМОТР ОСТОВА ' + Math.round(frac * 100) + '%';
        hud.label.style.fill = 0xffd24a;
        hud.label.position.set(Math.min(780, Math.max(300, sx)), Math.max(160, sy - R - 50));
      }
    } else {
      hud.label.text = '';
    }
  },
  leave() {
    if (wreckHud) {
      wreckHud.g.visible = false;
      wreckHud.label.visible = false;
    }
  },
};

// ------------------------------------------------------------------ the dock, from screenshots of the real screens

const shotUrl = (name: string): string => `/cinema/assets/${name}.png`;
const textures: Record<string, Texture> = {};
async function tex(name: string): Promise<Texture> {
  if (!textures[name]) textures[name] = await Assets.load(shotUrl(name));
  textures[name].source.scaleMode = 'nearest';
  return textures[name];
}

const CARD = { s: 0.8, x: 108, y: 48, r: 36 };

interface DockView {
  root: Container;
  bg: Graphics;
  card: Container;
  img: Sprite;
  mask: Graphics;
  extras: Container;
  frame: Graphics;
}

let dock: DockView | null = null;
function dockView(ctx: Ctx): DockView {
  if (dock) return dock;
  const root = new Container();
  const bg = new Graphics();
  bg.rect(0, 0, ctx.W, ctx.H).fill(0x05070d);
  for (let i = 0; i < 12; i++) bg.circle(ctx.W / 2, 900, 900 - i * 60).fill({ color: 0x1a1040, alpha: 0.05 });
  const card = new Container();
  const img = new Sprite();
  const mask = new Graphics();
  mask.roundRect(0, 0, ctx.W, ctx.H, 44).fill(0xffffff);
  const extras = new Container();
  const frame = new Graphics();
  card.addChild(img, extras, mask);
  img.mask = mask;
  extras.mask = mask;
  root.addChild(bg, card, frame);
  dock = { root, bg, card, img, mask, extras, frame };
  return dock;
}

function ring(g: Graphics, x: number, y: number, t: number, color: number, max = 120): void {
  if (t < 0 || t > 1) return;
  g.circle(x, y, 10 + max * t).stroke({ width: 8 * (1 - t) + 1, color, alpha: 1 - t });
}

const dockShot: Shot = {
  dur: 4,
  async setup(ctx) {
    fired.clear();
    const d = dockView(ctx);
    ctx.fx.addChildAt(d.root, 1);
    d.root.visible = true;
    for (const n of ['hangar', 'modules', 'crew']) await tex(n);
    ctx.scene.worldLayer.visible = false;
  },
  async frame(ctx, t) {
    const d = dockView(ctx);
    const cuts: Array<[number, string]> = [[0, 'hangar'], [1.0, 'modules'], [2.55, 'crew']];
    let name = 'hangar';
    let start = 0;
    for (const [c, n] of cuts) if (t >= c) {
      name = n;
      start = c;
    }
    const local = t - start;
    sfx(ctx, 'cut-' + name, t, start, 'swish', 1);
    if (name === 'hangar') sfx(ctx, 'tap-h', t, 0.5, 'tap');
    if (name === 'modules') {
      sfx(ctx, 'tap-m', local, 0.1, 'tap');
      sfx(ctx, 'fly-m', local, 0.25, 'fly');
      sfx(ctx, 'land-m', local, 0.8, 'land');
    }
    if (name === 'crew') {
      sfx(ctx, 'tap-c1', local, 0.15, 'tap');
      sfx(ctx, 'tap-c2', local, 0.37, 'tap');
      sfx(ctx, 'tap-c3', local, 0.59, 'tap');
      sfx(ctx, 'pop-c', local, 0.7, 'pop');
    }
    if (local < 1 / 30 && start > 0) {
      ctx.flash = 0.4;
      ctx.flashColor = 0xcfe8ff;
    }
    const texture = await tex(name);
    d.img.texture = texture;
    d.img.scale.set(CARD.s * (1 + 0.1 * Math.min(1, local / 1.2)) );
    // the card: a slow push towards a point of the screen, and a punch at every cut
    const focus: Record<string, [number, number]> = { hangar: [540, 760], modules: [560, 700], crew: [540, 650] };
    const [fx, fy] = focus[name];
    const k = CARD.s * (1 + 0.1 * Math.min(1, local / 1.2)) * (1 + 0.05 * Math.max(0, 1 - local / 0.18));
    d.img.scale.set(k);
    d.img.position.set(CARD.x + (540 - fx) * (k - CARD.s) * 0 + 0, CARD.y);
    d.img.position.set(CARD.x - fx * (k - CARD.s), CARD.y - fy * (k - CARD.s));
    d.mask.clear();
    d.mask.roundRect(CARD.x, CARD.y, 1080 * CARD.s, 1920 * CARD.s, CARD.r).fill(0xffffff);
    d.extras.removeChildren().forEach((c) => c.destroy());
    d.frame.clear();
    d.frame.roundRect(CARD.x - 4, CARD.y - 4, 1080 * CARD.s + 8, 1920 * CARD.s + 8, CARD.r + 4).stroke({ width: 5, color: 0x59e6ff, alpha: 0.85 });
    d.frame.roundRect(CARD.x - 14, CARD.y - 14, 1080 * CARD.s + 28, 1920 * CARD.s + 28, CARD.r + 12).stroke({ width: 2, color: 0xff5fd8, alpha: 0.4 });

    const g = new Graphics();
    d.extras.addChild(g);
    const place = (x: number, y: number): [number, number] => [CARD.x + x * k - fx * (k - CARD.s), CARD.y + y * k - fy * (k - CARD.s)];
    if (name === 'hangar') {
      // a tap on "Модули"
      const [x, y] = place(540, 1790);
      ring(g, x, y, (local - 0.5) / 0.4, 0xffffff, 90);
    } else if (name === 'modules') {
      // a card from the pool flies on to the deck
      const src = new Rectangle(110, 1140, 108, 108);
      const sprite = new Sprite(new Texture({ source: texture.source, frame: src }));
      sprite.anchor.set(0.5);
      const t0 = 0.25;
      const t1 = 0.8;
      const a = Math.min(1, Math.max(0, (local - t0) / (t1 - t0)));
      const e = a * a * (3 - 2 * a);
      const from = [164, 1194];
      const to = [655, 770];
      const mx = (from[0] + to[0]) / 2 + 120;
      const my = Math.min(from[1], to[1]) - 160;
      const bx = (1 - e) * (1 - e) * from[0] + 2 * (1 - e) * e * mx + e * e * to[0];
      const by = (1 - e) * (1 - e) * from[1] + 2 * (1 - e) * e * my + e * e * to[1];
      const sc = 1 - 0.28 * e + (a > 0 && a < 1 ? 0.25 * Math.sin(Math.PI * e) : 0);
      const [px, py] = place(bx, by);
      sprite.position.set(px, py);
      sprite.scale.set(k * sc * (a === 0 ? 1 : 1));
      sprite.rotation = a > 0 && a < 1 ? 0.25 * Math.sin(Math.PI * e) : 0;
      sprite.visible = local >= 0.0;
      // trail
      for (let i = 1; i <= 5 && a > 0 && a < 1; i++) {
        const ee = Math.max(0, e - i * 0.05);
        const tx = (1 - ee) * (1 - ee) * from[0] + 2 * (1 - ee) * ee * mx + ee * ee * to[0];
        const ty = (1 - ee) * (1 - ee) * from[1] + 2 * (1 - ee) * ee * my + ee * ee * to[1];
        const [qx, qy] = place(tx, ty);
        g.circle(qx, qy, 26 * k * (1 - i * 0.14)).fill({ color: 0x59e6ff, alpha: 0.22 - i * 0.03 });
      }
      d.extras.addChild(sprite);
      ring(g, ...place(164, 1194), (local - 0.1) / 0.35, 0x59e6ff, 100);
      if (local > t1) {
        const [lx, ly] = place(to[0], to[1]);
        ring(g, lx, ly, (local - t1) / 0.5, 0x63e07a, 140);
        g.roundRect(lx - 44 * k, ly - 44 * k, 88 * k, 88 * k, 6).stroke({ width: 5, color: 0x63e07a, alpha: Math.max(0, 1 - (local - t1) / 0.9) });
        if (local - t1 < 1 / 30) {
          ctx.flash = 0.25;
          ctx.flashColor = 0xb8ffd0;
        }
      }
    } else {
      // portraits: a tap, then one of them is pulled out large
      const picks = [[385, 665], [567, 425], [690, 725]];
      picks.forEach(([x, y], i) => {
        const [qx, qy] = place(x, y);
        ring(g, qx, qy, (local - 0.15 - i * 0.22) / 0.4, 0xffd24a, 70);
      });
      const popT = (local - 0.7) / 0.28;
      if (popT > 0) {
        const crop = new Sprite(new Texture({ source: texture.source, frame: new Rectangle(334, 614, 104, 104) }));
        crop.anchor.set(0.5);
        const sc = 4.2 * Math.min(1.12, 1 + 0.12 * Math.sin(Math.min(1, popT) * Math.PI)) * Math.min(1, popT);
        crop.scale.set(sc * k);
        const [cx, cy] = place(540, 1020);
        crop.position.set(cx, cy);
        crop.rotation = -0.04;
        const bd = new Graphics();
        bd.roundRect(cx - 52 * sc * k - 6, cy - 52 * sc * k - 6, 104 * sc * k + 12, 104 * sc * k + 12, 8).fill({ color: 0x05070d, alpha: 0.9 }).stroke({ width: 6, color: 0xffd24a });
        d.extras.addChild(bd, crop);
      }
    }
  },
  leave(ctx) {
    if (dock) dock.root.visible = false;
    ctx.scene.worldLayer.visible = true;
  },
};

/** 3. The dock mends a ship shot to pieces: the real repair screen, time-lapse, drones and all. */
const REPAIR_FRAMES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17];
let repairIndex = -1;
const repair: Shot = {
  dur: 1.4,
  async setup(ctx) {
    fired.clear();
    repairIndex = -1;
    const d = dockView(ctx);
    ctx.fx.addChildAt(d.root, 1);
    d.root.visible = true;
    for (const n of REPAIR_FRAMES) await tex('repair-' + n);
    ctx.scene.worldLayer.visible = false;
  },
  async frame(ctx, t) {
    const d = dockView(ctx);
    // the damaged ship, a tap on "Начать ремонт", then the whole mending in a rush, and the finished ship
    const idx = t < 0.3 ? 0 : t > 1.25 ? REPAIR_FRAMES.length - 1 : 1 + Math.min(15, Math.floor(((t - 0.3) / 0.95) * 16));
    if (idx !== repairIndex) {
      if (repairIndex >= 0 && idx > 0 && idx < REPAIR_FRAMES.length - 1) ctx.audio.push({ t: ctx.time, kind: 'weld', v: idx / 16 });
      repairIndex = idx;
    }
    sfx(ctx, 'tap-r', t, 0.12, 'tap');
    sfx(ctx, 'done-r', t, 1.25, 'land');
    const texture = await tex('repair-' + REPAIR_FRAMES[idx]);
    d.img.texture = texture;
    const fx = 540;
    const fy = 620;
    const k = CARD.s * (1 + 0.07 * (t / 1.4)) * (1 + 0.04 * Math.max(0, 1 - t / 0.15));
    d.img.scale.set(k);
    d.img.position.set(CARD.x - fx * (k - CARD.s), CARD.y - fy * (k - CARD.s));
    d.mask.clear();
    d.mask.roundRect(CARD.x, CARD.y, 1080 * CARD.s, 1920 * CARD.s, CARD.r).fill(0xffffff);
    d.extras.removeChildren().forEach((c) => c.destroy());
    d.frame.clear();
    d.frame.roundRect(CARD.x - 4, CARD.y - 4, 1080 * CARD.s + 8, 1920 * CARD.s + 8, CARD.r + 4).stroke({ width: 5, color: 0x59e6ff, alpha: 0.85 });
    d.frame.roundRect(CARD.x - 14, CARD.y - 14, 1080 * CARD.s + 28, 1920 * CARD.s + 28, CARD.r + 12).stroke({ width: 2, color: 0xff5fd8, alpha: 0.4 });
    const g = new Graphics();
    d.extras.addChild(g);
    const place = (x: number, y: number): [number, number] => [CARD.x + x * k - fx * (k - CARD.s), CARD.y + y * k - fy * (k - CARD.s)];
    if (t < 0.3) {
      const [bx, by] = place(540, 1458);
      ring(g, bx, by, (t - 0.12) / 0.2, 0xffffff, 110);
    }
    if (t > 1.25) {
      const [sx, sy] = place(540, 650);
      ring(g, sx, sy, (t - 1.25) / 0.15, 0x63e07a, 420);
    }
  },
  leave(ctx) {
    if (dock) dock.root.visible = false;
    ctx.scene.worldLayer.visible = true;
  },
};

/** A deterministic random generator for the sparks. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sat = (x: number): number => Math.min(1, Math.max(0, x));
const eo = (x: number): number => 1 - Math.pow(1 - sat(x), 3);

interface EndView {
  root: Container;
  glow: Graphics;
  burst: Graphics;
  texts: Text[];
  title: { halo: Text; mid: Text; cyan: Text; main: Text };
  sub: Text;
  pill: Graphics;
  pillText: Text;
}
let endView: EndView | null = null;
let endWorld: World | null = null;

/** Soft light as many faint circles added together. */
function glowAt(g: Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
  const n = 22;
  for (let i = 0; i < n; i++) {
    const k = 1 - i / n;
    g.circle(x, y, r * k).fill({ color, alpha: alpha / n });
  }
}

/**
 * 6. The end of the first trailer, as it was drawn there: the core glows in the violet sky, then the annihilation —
 * rings and sparks flying out — and the name settles in with the glow round it.
 */
const endCard: Shot = {
  dur: 2,
  setup(ctx) {
    if (!endView) {
      const mk = (text: string, size: number, color: number, family: string, weight: string): Text => {
        const t = new Text({ text, style: { fontFamily: family, fontWeight: weight as never, fontSize: size, fill: color, align: 'center' } });
        t.anchor.set(0.5);
        return t;
      };
      const root = new Container();
      const dim = new Graphics();
      dim.rect(0, 0, ctx.W, ctx.H).fill({ color: 0x03020a, alpha: 0.5 });
      const glow = new Graphics();
      glow.blendMode = 'add';
      const burst = new Graphics();
      burst.blendMode = 'add';
      const U = 'Unbounded, Arial Black, sans-serif';
      const halo = mk('ANTIMATTER', 100, 0xb06bff, U, '800');
      halo.filters = [new BlurFilter({ strength: 26, quality: 3 })];
      halo.alpha = 0.75;
      const mid = mk('ANTIMATTER', 100, 0xb06bff, U, '800');
      mid.filters = [new BlurFilter({ strength: 9, quality: 3 })];
      const cyan = mk('ANTIMATTER', 100, 0x5ce6ff, U, '800');
      cyan.filters = [new BlurFilter({ strength: 3, quality: 2 })];
      cyan.alpha = 0.7;
      const main = mk('ANTIMATTER', 100, 0xffffff, U, '800');
      const sub = mk('ЭКСПЕДИЦИЯ В СЕКТОР ЛОВУШЕК', 36, 0xd9c8ff, 'JetBrains Mono, monospace', '600');
      sub.style.letterSpacing = 8;
      const pill = new Graphics();
      const pillText = mk('В РАЗРАБОТКЕ', 30, 0xff9a2a, 'JetBrains Mono, monospace', '400');
      pillText.style.letterSpacing = 7;
      root.addChild(dim, glow, burst, halo, mid, cyan, main, sub, pill, pillText);
      endView = { root, glow, burst, texts: [halo, mid, cyan, main], title: { halo, mid, cyan, main }, sub, pill, pillText };
    }
    ctx.fx.addChildAt(endView.root, 1);
    endView.root.visible = true;
    ctx.scene.worldLayer.visible = false;
    // an empty violet sky for the stars and the dust behind
    const w = new World(3);
    w.sector = 'violet';
    w.skySeed = 17;
    endWorld = w;
    ctx.game.world = w;
    ctx.scene.reset(w);
    ctx.scene.layerView = OUTER_VIEW;
    ctx.scene.camX = 0;
    ctx.scene.camY = 0;
    ctx.scene.zoom = 0.9;
    ctx.flash = 1;
    ctx.flashColor = 0xffffff;
    fired.clear();
  },
  frame(ctx, t) {
    const v = endView!;
    const cx = ctx.W / 2;
    const cy = ctx.H / 2;
    ctx.scene.camY = 40 * t;
    ctx.scene.render(endWorld!, 1 / ctx.FPS, 0);
    // the core, pulsing
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + 1);
    v.glow.clear();
    glowAt(v.glow, cx, cy, 1040, 0x9650ff, 0.5 + 0.1 * pulse);
    glowAt(v.glow, cx, cy, 560, 0x5ce6ff, 0.14);
    // the burst
    v.burst.clear();
    const b = t - 0.25;
    if (b > 0) {
      sfx(ctx, 'end-hit', t, 0.25, 'hit', 1);
      if (!fired.has('end-shake')) {
        fired.add('end-shake');
        ctx.shake = 30;
        ctx.flash = 0.6;
        ctx.flashColor = 0xe9d8ff;
      }
      const rr = 330 * 4 * (1 - Math.exp(-b * 4.2));
      const cols = [0xffffff, 0xb06bff, 0x5ce6ff];
      for (let i = 0; i < 3; i++) {
        const al = Math.max(0, 0.8 - b * (1.1 + i * 0.25));
        if (al > 0) v.burst.circle(cx, cy, Math.max(0, rr - i * 48)).stroke({ width: (3 - i) * 4, color: cols[i], alpha: al });
      }
      const rs = rng(3);
      for (let j = 0; j < 90; j++) {
        const an = rs() * 6.283;
        const sp = 40 + rs() * 260;
        const d = (1 - Math.exp(-2.4 * b)) / 2.4;
        const fl = sat(1 - b / (0.8 + rs() * 1.2));
        const col = rs() > 0.5 ? 0xd9b8ff : 0x8af0ff;
        const size = rs() > 0.85 ? 2 : 1;
        if (fl > 0) v.burst.rect(cx + Math.cos(an) * sp * d * 4 - size * 2, cy + Math.sin(an) * sp * d * 4 - size * 2, size * 4, size * 4).fill({ color: col, alpha: fl });
      }
    }
    // the name settles in: bigger and wide-spaced, then home
    const tu = t - 0.25;
    const ta = sat(tu / 0.18);
    const scale = 1 + 0.16 * Math.pow(1 - eo(tu / 0.6), 2);
    const spacing = (0.05 + 0.16 * Math.pow(1 - eo(tu / 0.9), 2)) * 100;
    const ty = cy - 100;
    for (const tx of v.texts) {
      tx.style.letterSpacing = spacing;
      tx.position.set(cx + spacing / 2, ty);
      tx.scale.set(scale);
      tx.alpha = ta * (tx === v.title.halo ? 0.75 : tx === v.title.cyan ? 0.7 : 1);
    }
    v.sub.position.set(cx + 4, cy + 60);
    v.sub.alpha = ta;
    v.pillText.position.set(cx + 3, cy + 175);
    v.pillText.alpha = ta;
    v.pill.clear();
    const pw = v.pillText.width + 96;
    v.pill.roundRect(cx - pw / 2, cy + 175 - 36, pw, 72, 10).stroke({ width: 2, color: 0xff9a2a, alpha: 0.5 * ta });
  },
  leave(ctx) {
    if (endView) endView.root.visible = false;
    ctx.scene.worldLayer.visible = true;
  },
};

export const SHOTS: Shot[] = [hook, deck, repair, wreck, dockShot, endCard];
