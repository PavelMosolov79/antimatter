import type { Game } from '../game';
import type { ShipGrid } from '../sim/grid';
import { SHIPS } from '../sim/ships';
import { buildDockBase, dockLayout, makeDockSprite, renderDock, type DockBase, type DockLayout, type DockSprite } from './dockArt';

/**
 * The dock, as designed in «Док Antimatter»: the ship held at a berth in a space station's
 * hangar, its card and the ways out (a run, the sandbox, the menu). Switching ships and
 * leaving for a run play out as the ship undocking through the hangar doors.
 */

const CLASS: Record<string, string> = { fighter: 'лёгкий', cruiser: 'средний', battleship: 'тяжёлый' };
const LAYER_NAMES = ['Снаружи', 'Обшивка', 'П1', 'П2', 'П3', 'П4'];

type Phase = 'docked' | 'release' | 'leave' | 'arrive' | 'grab';
const DUR: Record<Exclude<Phase, 'docked'>, number> = { release: 0.35, leave: 0.8, arrive: 0.9, grab: 0.35 };
const STATUS: Record<Phase, string> = {
  docked: 'Корабль в захватах',
  release: 'Захваты открыты',
  leave: 'Отстыковка…',
  arrive: 'Заход на причал…',
  grab: 'Захваты закрываются…',
};

// ------------------------------------------------------------------ ship pictures

const sprites = new Map<string, { cells: number; sprite: DockSprite }>();
/**
 * Paints every ship for the dock — every layer of the battleship included, which is real
 * work — so the loading screen does it up front and the dock opens instantly.
 */
export function prepareDockSprites(): void {
  for (const s of SHIPS) {
    if (sprites.has(s.id)) continue;
    const grid = s.build();
    sprites.set(s.id, { cells: grid.cells, sprite: makeDockSprite(grid) });
  }
}
/** The picture of the ship actually at the berth: the prepared one while it's pristine, else painted fresh. */
function spriteFor(shipId: string, grid: ShipGrid): DockSprite {
  const cached = sprites.get(shipId);
  if (cached && cached.cells === grid.cells) return cached.sprite;
  return makeDockSprite(grid);
}

// ------------------------------------------------------------------ styles

const U = (css: string) => css.replace(/U\(([-\d.]+)\)/g, 'calc(var(--u) * $1)');
const CSS = U(`
#dock { position: fixed; inset: 0; z-index: 40; overflow: hidden; background: #05060c; color: #c9d2ef;
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; -webkit-user-select: none; user-select: none; }
#dock[hidden] { display: none; }
#dock canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; image-rendering: pixelated; image-rendering: crisp-edges; }
#dock canvas.glow { filter: blur(U(0.9)) saturate(1.2); mix-blend-mode: screen; opacity: .75; }
#dock .hud { position: absolute; inset: 0; pointer-events: none; text-shadow: 0 0 U(.5) #000, 0 0 U(.25) #000; }
#dock .title { position: absolute; left: U(3.2); top: calc(U(2.8) + env(safe-area-inset-top, 0px)); display: flex; flex-direction: column; gap: U(.3); }
#dock .title b { font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 900; font-size: U(3.4); letter-spacing: .3em; color: #f3e8ff;
  text-shadow: 0 0 U(1.2) rgba(180,60,255,.6), 0 0 U(.4) #000; }
#dock .title span { font-size: U(1.15); letter-spacing: .24em; text-transform: uppercase; color: #8a93b8; }
#dock .dots { position: absolute; left: 0; right: 0; top: calc(U(3.4) + env(safe-area-inset-top, 0px)); display: flex; justify-content: center; gap: U(.8); }
#dock .dots i { width: U(1); height: U(1); background: #2a3452; }
#dock .dots i.on { background: #59e6ff; box-shadow: 0 0 U(.8) #59e6ff; }
#dock .status { position: absolute; left: 0; right: 0; top: calc(U(6.2) + env(safe-area-inset-top, 0px)); text-align: center; font-size: U(1.1); letter-spacing: .24em; text-transform: uppercase; color: #63e07a; }
#dock .status.moving { color: #e8c450; }
#dock button { font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 500; font-size: U(1.35); letter-spacing: .18em; text-transform: uppercase; text-align: left; cursor: pointer;
  color: #c9d2ef; background: rgba(6,9,18,.72); border: 1px solid rgba(89,230,255,.22); padding: U(1) U(1.3); display: flex; justify-content: space-between; align-items: center; gap: U(1);
  pointer-events: auto; touch-action: manipulation; }
#dock button:hover { border-color: rgba(89,230,255,.6); color: #fff; }
#dock button:focus-visible { outline: 2px solid #ff4fd8; outline-offset: 2px; }
#dock button.go { color: #fbf2ff; border-color: #ff4fd8; background: rgba(58,10,70,.72); box-shadow: 0 0 U(1.4) rgba(255,79,216,.35); font-weight: 700; }
#dock button:disabled { cursor: default; color: #5d6688; border-color: rgba(93,102,136,.3); }
#dock button small { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: U(.9); letter-spacing: .12em; color: #5d6688; }
/* landscape: the ship switcher sits at the top, "‹ • • • ›" round the dots, clear of the card and the buttons */
#dock .switch { position: absolute; top: calc(U(1.9) + env(safe-area-inset-top, 0px)); width: U(4); height: U(4); font-size: U(2.2); padding: 0; justify-content: center; }
#dock .switch.prev { left: calc(50% - U(8.5)); }
#dock .switch.next { right: calc(50% - U(8.5)); }
#dock .bottom { display: contents; }
#dock .card { position: absolute; left: U(3.2); bottom: calc(U(3) + env(safe-area-inset-bottom, 0px)); width: U(30); display: flex; flex-direction: column; gap: U(.7); pointer-events: auto;
  padding: U(1.4) U(1.6); background: rgba(6,9,18,.72); border: 1px solid rgba(89,230,255,.18); border-left: U(.35) solid #59e6ff; }
#dock .card .name { font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 700; font-size: U(2.4); letter-spacing: .14em; text-transform: uppercase; color: #f3e8ff; }
#dock .card .cls { font-size: U(1.1); letter-spacing: .16em; text-transform: uppercase; color: #8a93b8; }
#dock .card .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: U(.6) U(1.2); margin-top: U(.4); }
#dock .card .stats div { display: flex; flex-direction: column; }
#dock .card .stats small { font-size: U(.95); letter-spacing: .16em; text-transform: uppercase; color: #6c77a0; }
#dock .card .stats strong { font-size: U(1.7); font-weight: 700; color: #e9eeff; font-variant-numeric: tabular-nums; }
#dock .card .state { display: flex; gap: U(.8); flex-wrap: wrap; margin-top: U(.3); }
#dock .chip { font-size: U(1); letter-spacing: .14em; text-transform: uppercase; padding: U(.3) U(.7); border: 1px solid; }
#dock .chip.ok { color: #63e07a; border-color: rgba(99,224,122,.45); }
#dock .chip.fuel { color: #ff4fd8; border-color: rgba(255,79,216,.45); }
#dock .decks { display: flex; flex-wrap: wrap; gap: U(.5); margin-top: U(.4); }
#dock .decks button { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: U(1.05); letter-spacing: .12em; padding: U(.45) U(.8); justify-content: center; }
#dock .decks button[aria-pressed="true"] { color: #59e6ff; border-color: #59e6ff; background: rgba(20,48,74,.8); }
#dock .decks .lbl { font-size: U(.95); letter-spacing: .16em; text-transform: uppercase; color: #6c77a0; align-self: center; margin-right: U(.3); }
#dock .actions { position: absolute; right: U(3.2); bottom: calc(U(3) + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: U(.9); width: U(19); }

/* portrait: the card and the buttons stack from the bottom edge up, so they can't overlap */
#dock.portrait .title { left: 0; right: 0; top: calc(U(4.5) + env(safe-area-inset-top, 0px)); align-items: center; }
#dock.portrait .title b { font-size: U(7); }
#dock.portrait .title span { font-size: U(2.4); }
#dock.portrait .dots { top: calc(U(17.5) + env(safe-area-inset-top, 0px)); gap: U(1.8); }
#dock.portrait .dots i { width: U(2); height: U(2); }
#dock.portrait .status { top: calc(U(21.5) + env(safe-area-inset-top, 0px)); font-size: U(2.4); }
#dock.portrait .switch { top: calc(var(--shipcy, .5) * 100%); transform: translateY(-50%); width: U(8); height: U(12); font-size: U(5); }
#dock.portrait .switch.prev { left: U(3); right: auto; }
#dock.portrait .switch.next { right: U(3); left: auto; }
#dock.portrait .bottom { display: flex; flex-direction: column; gap: U(2); position: absolute; left: U(4); right: U(4); bottom: calc(U(4) + env(safe-area-inset-bottom, 0px)); }
#dock.portrait .card, #dock.portrait .actions { position: static; width: auto; }
#dock.portrait .card { padding: U(3) U(3.4); gap: U(1.2); border-left-width: U(.8); }
#dock.portrait .card .name { font-size: U(5.4); }
#dock.portrait .card .cls { font-size: U(2.4); }
#dock.portrait .card .stats { gap: U(1.2) U(2.6); }
#dock.portrait .card .stats small { font-size: U(2.1); }
#dock.portrait .card .stats strong { font-size: U(3.8); }
#dock.portrait .chip { font-size: U(2.2); padding: U(.7) U(1.5); }
#dock.portrait .actions { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: U(1.6); }
#dock.portrait button { font-size: U(2.9); padding: U(2.3) U(2.6); }
#dock.portrait .actions button { grid-column: span 3; }
#dock.portrait .actions button.go { grid-column: 1 / -1; font-size: U(3.4); order: 0; }
#dock.portrait .actions button.later { grid-column: span 2; order: 1; font-size: U(2.3); padding: U(1.8) U(1.6); flex-direction: column; align-items: flex-start; gap: U(.4); }
#dock.portrait .actions button.sand, #dock.portrait .actions button.menu { order: 2; }
#dock.portrait button small { font-size: U(1.8); }
#dock.portrait .decks { gap: U(1.2); }
#dock.portrait .decks button { font-size: U(2.4); padding: U(1.1) U(1.8); }
#dock.portrait .decks .lbl { font-size: U(2.1); }
`);

// ------------------------------------------------------------------ the screen

export class DockScreen {
  private root = document.createElement('div');
  private cv = document.createElement('canvas');
  private gv = document.createElement('canvas');
  private ctx!: CanvasRenderingContext2D;
  private gctx!: CanvasRenderingContext2D;
  private img!: ImageData;
  private glow!: ImageData;
  private card = document.createElement('div');
  private dots = document.createElement('div');
  private status = document.createElement('div');
  private L!: DockLayout;
  private B!: DockBase;
  private sprite!: DockSprite;
  private shipId = '';
  private grid: ShipGrid | null = null;
  private portrait = false;
  private phase: Phase = 'docked';
  private k = 0;
  private e = 1;
  private shipY = 0;
  private t = 0;
  private layer = 0;
  /** What happens once the ship has left: switch to another ship, or go on a run. */
  private after: { kind: 'switch'; id: string } | { kind: 'run' } | null = null;
  private running = false;
  private last = 0;
  private readonly reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(
    private game: Game,
    parent: HTMLElement,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const r = this.root;
    r.id = 'dock';
    r.hidden = true;
    this.gv.className = 'glow';
    const hud = div('hud');
    const title = div('title');
    const tb = document.createElement('b');
    tb.textContent = 'ДОК';
    const ts = document.createElement('span');
    ts.textContent = 'Причал 1';
    title.append(tb, ts);
    this.dots.className = 'dots';
    this.status.className = 'status';
    const prev = btn('‹', () => this.cycle(-1));
    prev.className = 'switch prev';
    prev.setAttribute('aria-label', 'Предыдущий корабль');
    const next = btn('›', () => this.cycle(1));
    next.className = 'switch next';
    next.setAttribute('aria-label', 'Следующий корабль');
    this.card.className = 'card';
    const actions = div('actions');
    const go = btn('', () => this.depart());
    go.className = 'go';
    go.innerHTML = '<span>В поход</span><span>▸</span>';
    const sand = btn('Песочница', () => this.leave(() => this.game.reset(this.game.shipId, 'sandbox')));
    sand.className = 'sand';
    actions.append(go, sand);
    for (const label of ['Ремонт', 'Модули', 'Экипаж']) {
      const b = btn('', () => {});
      b.className = 'later';
      b.disabled = true;
      b.innerHTML = `<span>${label}</span><small>MVP-4</small>`;
      actions.appendChild(b);
    }
    const menu = btn('Главное меню', () => this.leave(() => (this.game.screen = 'title')));
    menu.className = 'menu';
    actions.appendChild(menu);
    const bottom = div('bottom');
    bottom.append(this.card, actions);
    hud.append(title, this.dots, this.status, prev, next, bottom);
    r.append(this.cv, this.gv, hud);
    parent.appendChild(r);

    window.addEventListener('keydown', (e) => {
      if (r.hidden) return;
      if (e.key === 'ArrowLeft') this.cycle(-1);
      else if (e.key === 'ArrowRight') this.cycle(1);
    });
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (!r.hidden) this.fit();
      }, 150);
    });
  }

  /** Called every frame by the game loop: shows the dock whenever the game is at it. */
  update(): void {
    const g = this.game;
    const atDock = g.screen === 'game' && g.mode === 'run' && g.runPhase === 'dock';
    if (!atDock) {
      if (!this.root.hidden) {
        this.root.hidden = true;
        this.running = false;
      }
      return;
    }
    const grid = g.world.player?.grid ?? null;
    if (this.root.hidden) {
      this.root.hidden = false;
      this.load();
      // Coming in from the menu or a finished run: the ship pulls into the berth.
      this.startPhase(this.reduce ? 'docked' : 'arrive');
      this.shipY = this.reduce ? this.L.sy : -this.sprite.h - 6;
      this.e = this.reduce ? 1 : 0;
      this.start();
    } else if (this.phase === 'docked' && grid !== this.grid) {
      this.load();
    }
  }

  // ---------------------------------------------------------------- ship and layout

  private load(): void {
    const g = this.game;
    this.shipId = g.shipId;
    this.grid = g.world.player?.grid ?? null;
    const grid = this.grid ?? SHIPS.find((s) => s.id === g.shipId)!.build();
    this.sprite = spriteFor(g.shipId, grid);
    this.layer = 0;
    this.fit();
    this.fillCard(grid);
  }

  private fit(): void {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    this.portrait = vh / vw >= 1.4;
    this.root.classList.toggle('portrait', this.portrait);
    const u = this.portrait ? Math.min(vw, (vh * 9) / 16) / 100 : Math.min(vw, (vh * 16) / 9) / 100;
    this.root.style.setProperty('--u', `${u}px`);
    const s = this.sprite;
    const L = dockLayout(s.w, s.h, vw / vh, this.portrait);
    const wasDocked = this.L && this.shipY === this.L.sy;
    this.L = L;
    this.B = buildDockBase(L, s.w, s.h);
    this.cv.width = this.gv.width = L.W;
    this.cv.height = this.gv.height = L.H;
    this.ctx = this.cv.getContext('2d')!;
    this.gctx = this.gv.getContext('2d')!;
    this.img = this.ctx.createImageData(L.W, L.H);
    this.glow = this.gctx.createImageData(L.W, L.H);
    if (wasDocked || this.phase === 'docked') this.shipY = L.sy;
    this.root.style.setProperty('--shipcy', String((L.sy + s.h / 2) / L.H));
  }

  private fillCard(grid: ShipGrid): void {
    let guns = 0;
    let shield = 0;
    let engines = 0;
    for (const m of grid.modules) {
      if (m.weapon) guns++;
      shield += m.shieldMax;
      if (m.kind === 'engine') engines++;
    }
    const spec = SHIPS.find((s) => s.id === this.shipId);
    const decks = grid.depth - 1;
    const c = this.card;
    c.replaceChildren();
    const name = div('name', spec?.label ?? '');
    const cls = div('cls', `${CLASS[this.shipId] ?? ''} · палуб ${decks} · ${grid.width}×${grid.height} клеток`);
    const stats = div('stats');
    const n = (v: number) => v.toLocaleString('ru-RU');
    for (const [k, v] of [
      ['Корпус', n(grid.cells)],
      ['Орудий', n(guns)],
      ['Щит', n(shield)],
      ['Двигателей', n(engines)],
      ['Масса', n(Math.round(grid.mass))],
      ['Палуб', n(decks)],
    ]) {
      const d = document.createElement('div');
      const sm = document.createElement('small');
      sm.textContent = k;
      const st = document.createElement('strong');
      st.textContent = v;
      d.append(sm, st);
      stats.appendChild(d);
    }
    const state = div('state');
    state.innerHTML = '<span class="chip ok">в захватах</span><span class="chip fuel">заправка</span>';
    const deckRow = div('decks');
    deckRow.appendChild(Object.assign(document.createElement('span'), { className: 'lbl', textContent: 'Вид' }));
    this.sprite.views.forEach((_, i) => {
      const b = btn(LAYER_NAMES[i], () => this.setLayer(i));
      b.setAttribute('aria-pressed', i === this.layer ? 'true' : 'false');
      deckRow.appendChild(b);
    });
    c.append(name, cls, stats, state, deckRow);
    this.dots.replaceChildren(
      ...SHIPS.map((s) => {
        const i = document.createElement('i');
        if (s.id === this.shipId) i.className = 'on';
        return i;
      }),
    );
  }

  private setLayer(i: number): void {
    this.layer = i;
    this.card.querySelectorAll('.decks button').forEach((b, j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
  }

  // ---------------------------------------------------------------- choreography

  private startPhase(p: Phase): void {
    this.phase = p;
    this.k = 0;
    this.status.textContent = STATUS[p];
    this.status.classList.toggle('moving', p !== 'docked');
  }

  private cycle(dir: number): void {
    if (this.phase !== 'docked') return;
    const i = SHIPS.findIndex((s) => s.id === this.shipId);
    const id = SHIPS[(i + dir + SHIPS.length) % SHIPS.length].id;
    this.after = { kind: 'switch', id };
    if (this.reduce) this.finishLeaving();
    else this.startPhase('release');
  }

  private depart(): void {
    if (this.phase !== 'docked') return;
    this.after = { kind: 'run' };
    if (this.reduce) this.finishLeaving();
    else this.startPhase('release');
  }

  /** Leaves the dock for somewhere that isn't a flight (sandbox, menu): straight away. */
  private leave(action: () => void): void {
    if (this.phase !== 'docked') return;
    action();
  }

  private finishLeaving(): void {
    const a = this.after;
    this.after = null;
    if (a?.kind === 'run') {
      this.game.startRun();
      this.startPhase('docked');
      this.e = 1;
      return;
    }
    if (a?.kind === 'switch') {
      this.game.openDock(a.id);
      this.load();
      if (this.reduce) {
        this.startPhase('docked');
        this.e = 1;
        this.shipY = this.L.sy;
        return;
      }
      this.shipY = -this.sprite.h - 6;
      this.e = 0;
      this.startPhase('arrive');
    }
  }

  private advance(dt: number): void {
    if (this.phase === 'docked') return;
    this.k += dt / DUR[this.phase];
    const k = Math.min(1, this.k);
    const top = -this.sprite.h - 6;
    const sy = this.L.sy;
    if (this.phase === 'release') this.e = 1 - k;
    else if (this.phase === 'grab') this.e = k;
    else if (this.phase === 'leave') this.shipY = sy + (top - sy) * k * k * k;
    else if (this.phase === 'arrive') this.shipY = top + (sy - top) * (1 - Math.pow(1 - k, 3));
    if (k < 1) return;
    if (this.phase === 'release') this.startPhase('leave');
    else if (this.phase === 'leave') this.finishLeaving();
    else if (this.phase === 'arrive') this.startPhase('grab');
    else if (this.phase === 'grab') {
      this.startPhase('docked');
      this.e = 1;
      this.shipY = sy;
    }
  }

  // ---------------------------------------------------------------- loop

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += this.reduce ? 0 : dt;
    this.advance(dt);
    if (!this.root.hidden) {
      renderDock(this.L, this.B, this.sprite, { t: this.t, shipY: this.shipY, e: this.e, docked: this.phase === 'docked', layer: this.layer }, this.img, this.glow);
      this.ctx.putImageData(this.img, 0, 0);
      this.gctx.putImageData(this.glow, 0, 0);
    }
    requestAnimationFrame((t) => this.frame(t));
  }
}

function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
