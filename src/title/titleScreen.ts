import type { Game } from '../game';

import { Road } from '../sim/road';
import { SHIPS, shipHoldCap } from '../sim/ships';
import { CoreScene, makeSky, type Sky, type SkyLayout } from './coreArt';

/**
 * The title: the loading screen (the core filling with antimatter as the game really
 * loads) and the main menu over the same core, as designed in «Главное меню Antimatter».
 * It's a DOM overlay with its own small pixel canvas, scaled up like the game.
 */

export const VERSION = 'v0.3 · MVP-3а';

export interface TitleLayout {
  mode: 'landscape' | 'portrait';
  /** Screen pixels per art pixel. */
  u: number;
  /** Art-pixel size of the canvas (covers the whole window). */
  W: number;
  H: number;
  loadCore: { x: number; y: number };
  menuCore: { x: number; y: number };
  sky: SkyLayout;
}

/**
 * Fits the design to a window. Landscape keeps the 256×144 composition (the core to the
 * right, the list on the left) and just widens or deepens the sky; a tall phone gets the
 * portrait one (logo, the core, the list below it) at 144 art pixels across.
 */
export function titleLayout(vw: number, vh: number): TitleLayout {
  // A window with no size yet (a background tab, a hidden frame): lay out for 16:9 and
  // let the resize handler fit the real size once there is one.
  if (!(vw > 0) || !(vh > 0)) {
    vw = 1280;
    vh = 720;
  }
  if (vh / vw >= 1.4) {
    const u = Math.min(vw / 144, vh / 256);
    const W = Math.ceil(vw / u);
    const H = Math.ceil(vh / u);
    const cx = Math.round(W / 2);
    return {
      mode: 'portrait',
      u,
      W,
      H,
      loadCore: { x: cx, y: Math.round(H / 2) },
      menuCore: { x: cx, y: 98 },
      sky: {
        violet: { x: 0.85, y: 0.3, rx: 0.8, ry: 0.4 },
        green: { x: 0.1, y: 0.62, rx: 0.7, ry: 0.35 },
        calm: [
          { x: cx, y: 98, rx: 74, ry: 66, k: 1 },
          { x: cx, y: H / 2, rx: 74, ry: 66, k: 0.7 },
          { x: cx, y: 14, rx: 70, ry: 16, k: 0.55 },
          { x: cx, y: 200, rx: 80, ry: 60, k: 0.55 },
        ],
      },
    };
  }
  const u = Math.min(vh / 144, vw / 256);
  const W = Math.ceil(vw / u);
  const H = Math.ceil(vh / u);
  const cy = Math.round(H / 2 + 6);
  const mx = W - 80;
  return {
    mode: 'landscape',
    u,
    W,
    H,
    loadCore: { x: Math.round(W / 2), y: cy },
    menuCore: { x: mx, y: cy },
    sky: {
      violet: { x: 0.8, y: 0.4, rx: 0.47, ry: 0.67 },
      green: { x: 0.2, y: 0.43, rx: 0.34, ry: 0.51 },
      calm: [
        { x: mx, y: cy, rx: 74, ry: 67, k: 1 },
        { x: W / 2, y: cy, rx: 62, ry: 58, k: 0.6 },
        { x: 52, y: cy - 12, rx: 62, ry: 70, k: 0.55 },
        { x: W / 2, y: 8, rx: 70, ry: 14, k: 0.45 },
        { x: W / 2, y: H + 6, rx: 200, ry: 30, k: 0.6 },
      ],
    },
  };
}

const CSS = `
#title { position: fixed; inset: 0; z-index: 50; overflow: hidden; background: #05060c; color: #dde2f2;
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; -webkit-user-select: none; user-select: none; touch-action: manipulation;
  transition: opacity .45s ease; }
#title.gone { opacity: 0; pointer-events: none; }
#title[hidden] { display: none; }
#title canvas { position: absolute; left: 0; top: 0; image-rendering: pixelated; image-rendering: crisp-edges; }
#title canvas.glow { filter: blur(calc(var(--u) * 2.8)) saturate(1.25); mix-blend-mode: screen; opacity: .8; }
#title[data-phase="ready"] { cursor: pointer; }
#title .t-logo { position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; pointer-events: none;
  font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 900; letter-spacing: .34em; padding-left: .34em;
  color: #f3e8ff; text-shadow: 0 0 calc(var(--u) * 3) rgba(180,60,255,.75), 0 0 calc(var(--u) * 7.7) rgba(255,79,216,.35);
  top: calc(var(--u) * 11.8); font-size: calc(var(--u) * 11.8);
  transition: left .9s cubic-bezier(.6,0,.2,1), transform .9s cubic-bezier(.6,0,.2,1), font-size .9s cubic-bezier(.6,0,.2,1), top .9s cubic-bezier(.6,0,.2,1); }
#title[data-phase="menu"] .t-logo { left: calc(var(--u) * 14); transform: translateX(0); font-size: calc(var(--u) * 8.7); top: calc(var(--u) * 13.3); }
#title .t-tag { position: absolute; left: calc(var(--u) * 14); top: calc(var(--u) * 26.6); font-size: calc(var(--u) * 3.1); letter-spacing: .24em; text-transform: uppercase;
  color: #8a93b8; opacity: 0; transition: opacity .6s .6s; pointer-events: none; }
#title[data-phase="menu"] .t-tag { opacity: 1; }
#title .t-items { position: absolute; left: calc(var(--u) * 14); top: calc(var(--u) * (var(--cy) - 36)); width: calc(var(--u) * 102);
  display: flex; flex-direction: column; gap: calc(var(--u) * 2.3); }
#title .t-item { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: calc(var(--u) * .5);
  background: none; border: 0; margin: 0; cursor: pointer; text-align: left;
  padding: calc(var(--u) * 1.4) 0 calc(var(--u) * 1.9) calc(var(--u) * 6.7);
  font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 500; font-size: calc(var(--u) * 5.5); letter-spacing: .22em; text-transform: uppercase;
  color: #a9b2d6; text-shadow: 0 0 calc(var(--u) * 1.3) #000;
  opacity: 0; transform: translateX(calc(var(--u) * -5)); pointer-events: none;
  transition: opacity .45s, transform .45s cubic-bezier(.2,.8,.2,1), color .15s, text-shadow .15s; }
#title .t-item[hidden] { display: none; }
#title[data-phase="menu"] .t-item { opacity: 1; transform: none; pointer-events: auto; }
#title[data-phase="menu"] .t-item:nth-child(1) { transition-delay: .55s, .55s, 0s, 0s; }
#title[data-phase="menu"] .t-item:nth-child(2) { transition-delay: .65s, .65s, 0s, 0s; }
#title[data-phase="menu"] .t-item:nth-child(3) { transition-delay: .75s, .75s, 0s, 0s; }
#title[data-phase="menu"] .t-item:nth-child(4) { transition-delay: .85s, .85s, 0s, 0s; }
#title[data-phase="menu"] .t-item:nth-child(5) { transition-delay: .95s, .95s, 0s, 0s; }
#title .t-item::before { content: ''; position: absolute; left: 0; top: calc(var(--u) * 3.5); width: calc(var(--u) * 2.7); height: calc(var(--u) * 2.7);
  background: #ff4fd8; box-shadow: 0 0 calc(var(--u) * 2) #ff4fd8, 0 0 calc(var(--u) * 4.6) rgba(180,60,255,.8);
  transform: translateY(-50%) scale(0); transition: transform .18s cubic-bezier(.2,.8,.2,1); }
#title .t-item::after { content: ''; position: absolute; left: calc(var(--u) * 6.7); bottom: 0; height: calc(var(--u) * .56); width: 0;
  background: linear-gradient(90deg, #ff4fd8, rgba(180,60,255,0)); transition: width .25s; }
#title .t-item.on { color: #fbf2ff; text-shadow: 0 0 calc(var(--u) * 2.6) rgba(255,79,216,.65), 0 0 var(--u) #000; }
#title .t-item.on::before { transform: translateY(-50%) scale(1); }
#title .t-item.on::after { width: 70%; }
#title .t-item:focus-visible { outline: none; }
#title .t-item:disabled { cursor: default; color: #5d6688; }
#title .t-modal { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; background: rgba(3,4,10,.86); }
#title .t-modal[hidden] { display: none; }
#title .t-box { width: calc(var(--u) * 96); max-width: 92%; box-sizing: border-box; padding: calc(var(--u) * 4.4) calc(var(--u) * 5); background: rgba(8,11,22,.97);
  border: 1px solid rgba(255,106,90,.55); border-left: calc(var(--u) * .9) solid #ff6a5a; box-shadow: 0 0 calc(var(--u) * 6) rgba(255,79,216,.25); display: flex; flex-direction: column; gap: calc(var(--u) * 2.2); }
#title .t-box h3 { margin: 0; font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 700; font-size: calc(var(--u) * 4.4); letter-spacing: .12em; text-transform: uppercase; color: #fbf2ff; }
#title .t-box p, #title .t-box li { margin: 0; font-size: calc(var(--u) * 2.9); line-height: 1.5; color: #b9c2e4; }
#title .t-box ul { margin: 0; padding-left: calc(var(--u) * 3.4); display: flex; flex-direction: column; gap: calc(var(--u) * .8); }
#title .t-box b { color: #fff3c8; font-weight: 500; }
#title .t-box .t-risk { color: #ffb0a0; }
#title .t-btns { display: flex; gap: calc(var(--u) * 2); margin-top: calc(var(--u) * 1); }
#title .t-btns button { flex: 1; font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 500; font-size: calc(var(--u) * 3); letter-spacing: .14em; text-transform: uppercase; cursor: pointer;
  padding: calc(var(--u) * 2) calc(var(--u) * 2.4); color: #dde2f2; background: rgba(10,14,28,.9); border: 1px solid rgba(89,230,255,.4); }
#title .t-btns button:hover, #title .t-btns button:focus-visible { outline: none; border-color: #59e6ff; color: #fff; }
#title .t-btns button.danger { color: #ffd9d2; border-color: #ff6a5a; background: rgba(70,12,12,.85); }
#title .t-btns button.danger:hover, #title .t-btns button.danger:focus-visible { background: rgba(110,18,18,.95); color: #fff; }
#title .t-item .t-sub { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-weight: 400; font-size: calc(var(--u) * 2.9);
  letter-spacing: .06em; text-transform: none; color: #7f89ad; }
#title .t-item.on .t-sub { color: #c8b2e6; }
#title .t-item.warn .t-sub { color: #ffb0a0; }
#title .t-foot { position: absolute; left: calc(var(--u) * 14); bottom: calc(var(--u) * 7.7); font-size: calc(var(--u) * 2.8); letter-spacing: .16em;
  text-transform: uppercase; color: #5d6688; opacity: 0; transition: opacity .6s 1s; pointer-events: none; }
#title[data-phase="menu"] .t-foot { opacity: 1; }
#title .t-ready { position: absolute; left: 0; right: 0; bottom: calc(var(--u) * 15.9); text-align: center; pointer-events: none;
  font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 500; font-size: calc(var(--u) * 4.4); letter-spacing: .3em; text-transform: uppercase;
  color: #f3e8ff; text-shadow: 0 0 calc(var(--u) * 2.6) rgba(255,79,216,.8); animation: t-blink 1.6s ease-in-out infinite; }
#title:not([data-phase="ready"]) .t-ready { display: none; }
@keyframes t-blink { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
#title .t-readout { position: absolute; left: calc(var(--u) * 8.7); right: calc(var(--u) * 8.7); bottom: calc(var(--u) * 7.2); pointer-events: none;
  display: flex; justify-content: space-between; align-items: flex-end; gap: calc(var(--u) * 5);
  font-size: calc(var(--u) * 4); letter-spacing: .12em; text-transform: uppercase; color: #b9c3e6; text-shadow: 0 0 calc(var(--u) * 1.5) #000, 0 0 var(--u) #000; }
#title .t-readout .pct { font-size: calc(var(--u) * 6.7); font-weight: 700; color: #f3e8ff; font-variant-numeric: tabular-nums; letter-spacing: .06em; }
#title .t-readout .pct small { font-size: .5em; color: #8189a8; font-weight: 500; letter-spacing: .18em; margin-right: .6em; }
#title[data-phase="menu"] .t-readout { display: none; }

/* portrait: logo on top, the core under it, the list below the core */
#title.portrait .t-logo { top: calc(var(--u) * 13); font-size: calc(var(--u) * 9.2); }
#title.portrait[data-phase="menu"] .t-logo { left: 50%; transform: translateX(-50%); top: calc(var(--u) * 8.6); font-size: calc(var(--u) * 8.6); }
#title.portrait .t-tag { left: 0; right: 0; text-align: center; top: calc(var(--u) * 21.6); font-size: calc(var(--u) * 3.5); }
#title.portrait .t-items { left: calc(var(--u) * 13); right: calc(var(--u) * 13); width: auto; top: calc(var(--u) * 167); gap: calc(var(--u) * 1.7); }
#title.portrait .t-item { font-size: calc(var(--u) * 6.2); padding: calc(var(--u) * 1.6) 0 calc(var(--u) * 2.2) calc(var(--u) * 7.8); }
#title.portrait .t-item::before { width: calc(var(--u) * 3.2); height: calc(var(--u) * 3.2); top: calc(var(--u) * 5.3); }
#title.portrait .t-item::after { left: calc(var(--u) * 7.8); height: calc(var(--u) * .65); }
#title.portrait .t-item .t-sub { font-size: calc(var(--u) * 3.6); }
#title.portrait .t-foot { left: 0; right: 0; text-align: center; bottom: calc(var(--u) * 5.8); font-size: calc(var(--u) * 3.3); }
#title.portrait .t-ready { font-size: calc(var(--u) * 4.9); bottom: calc(var(--u) * 23); }
#title.portrait .t-readout { left: calc(var(--u) * 8); right: calc(var(--u) * 8); bottom: calc(var(--u) * 8); font-size: calc(var(--u) * 3.6); }
#title.portrait .t-readout .pct { font-size: calc(var(--u) * 6); }
@media (prefers-reduced-motion: reduce) {
  #title *, #title { transition-duration: .01s !important; transition-delay: 0s !important; animation: none !important; }
}
`;

interface Item {
  el: HTMLButtonElement;
  sub: HTMLSpanElement;
  act: () => void;
}

/** Loading screen and main menu. */
export class TitleScreen {
  private root = document.createElement('div');
  private px = document.createElement('canvas');
  private glowCv = document.createElement('canvas');
  private logo = document.createElement('div');
  private label = document.createElement('span');
  private pct = document.createElement('span');
  private items: Item[] = [];
  private confirmItem = -1;
  private layout!: TitleLayout;
  private sky!: Sky;
  private scene!: CoreScene;
  private img!: ImageData;
  private glow!: ImageData;
  private pxCtx!: CanvasRenderingContext2D;
  private glowCtx!: CanvasRenderingContext2D;
  private game: Game | null = null;
  /** Share of the loading work actually done (the core fills toward it). */
  private target = 0;
  private loaded = false;
  private anim: { t: number; dur: number; from: { x: number; y: number } } | null = null;
  private active = -1;
  private confirmNew = false;
  /** The question before a new game wipes everything. */
  private dialog = document.createElement('div');
  private running = false;
  private last = 0;
  private readonly reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const r = this.root;
    r.id = 'title';
    r.dataset.phase = 'loading';
    this.glowCv.className = 'glow';
    this.logo.className = 't-logo';
    this.logo.textContent = 'ANTIMATTER';
    const tag = div('t-tag', 'Экспедиция в сектор ловушек');
    const nav = document.createElement('nav');
    nav.className = 't-items';
    nav.setAttribute('aria-label', 'Главное меню');
    const ready = div('t-ready', 'Коснитесь, чтобы начать');
    const readout = div('t-readout', '');
    const pctWrap = document.createElement('span');
    pctWrap.className = 'pct';
    const small = document.createElement('small');
    small.textContent = 'ядро';
    pctWrap.append(small, this.pct, document.createTextNode('%'));
    readout.append(this.label, pctWrap);
    const foot = div('t-foot', VERSION);
    r.append(this.px, this.glowCv, this.logo, tag, nav, ready, readout, foot);
    r.append(this.dialog);
    this.dialog.className = 't-modal';
    this.dialog.hidden = true;
    this.dialog.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === this.dialog) this.closeDialog();
    });
    parent.appendChild(r);

    this.item(nav, 'Продолжить', () => this.resume());
    this.item(nav, 'Новый забег', () => this.askNewGame());
    this.item(nav, 'Док', () => this.leaveRun(2, () => this.game!.openDock()));
    this.item(nav, 'Песочница', () => this.go(() => this.game!.reset(this.game!.shipId, 'sandbox')));
    this.item(nav, 'Настройки', () => {});
    this.items[4].el.disabled = true;
    this.items[4].sub.textContent = 'скоро';
    this.items[0].el.hidden = true;

    r.addEventListener('click', () => {
      if (r.dataset.phase === 'ready') this.openMenu();
    });
    window.addEventListener('keydown', (e) => {
      if (r.hidden) return;
      if (!this.dialog.hidden) {
        if (e.key === 'Escape') this.closeDialog();
        return;
      }
      if (r.dataset.phase === 'ready' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.openMenu();
      } else if (r.dataset.phase === 'menu' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !this.items.some((i) => i.el === document.activeElement)) {
        // The keyboard picks up the list from its first item; mouse and touch never see a stray highlight.
        e.preventDefault();
        this.items.find((i) => !i.el.hidden && !i.el.disabled)?.el.focus();
      }
    });
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this.fit(), 150);
    });
    this.fit();
    this.label.textContent = 'Запуск магнитной ловушки';
    this.start();
  }

  // ---------------------------------------------------------------- loading

  /** A loading step has started: its caption, and how much of the work is done before it. */
  step(done: number, label: string): void {
    this.target = Math.max(this.target, done);
    this.label.textContent = label;
  }

  /** Loading finished: the core fills up, then "tap to start". */
  finish(game: Game): void {
    this.game = game;
    this.target = 1;
    this.loaded = true;
  }

  /** The main loop checks whether the game has asked to come back to the menu. */
  watch(): void {
    if (this.game?.screen === 'title' && this.root.hidden) this.showMenu();
  }

  // ---------------------------------------------------------------- layout

  private fit(): void {
    const L = titleLayout(window.innerWidth, window.innerHeight);
    this.layout = L;
    const r = this.root;
    r.classList.toggle('portrait', L.mode === 'portrait');
    r.style.setProperty('--u', `${L.u}px`);
    r.style.setProperty('--cy', String(L.menuCore.y));
    for (const cv of [this.px, this.glowCv]) {
      cv.width = L.W;
      cv.height = L.H;
      cv.style.width = `${L.W * L.u}px`;
      cv.style.height = `${L.H * L.u}px`;
    }
    this.pxCtx = this.px.getContext('2d')!;
    this.glowCtx = this.glowCv.getContext('2d')!;
    this.img = this.pxCtx.createImageData(L.W, L.H);
    this.glow = this.glowCtx.createImageData(L.W, L.H);
    this.sky = makeSky(L.W, L.H, L.sky);
    const inMenu = r.dataset.phase === 'menu';
    const at = inMenu ? L.menuCore : L.loadCore;
    const old = this.scene;
    // Loading shows both feed pipes straight; the menu turns the left one down out of the list's way.
    this.scene = new CoreScene(this.sky, at.x, at.y, { leftDown: inMenu && L.mode === 'landscape', bare: L.mode === 'portrait' });
    if (old) {
      this.scene.p = old.p;
      this.scene.t = old.t;
    }
    this.anim = null;
  }

  // ---------------------------------------------------------------- menu

  private item(nav: HTMLElement, title: string, act: () => void): void {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 't-item';
    const t = document.createElement('span');
    t.textContent = title;
    const sub = document.createElement('span');
    sub.className = 't-sub';
    el.append(t, sub);
    nav.appendChild(el);
    const n = this.items.length;
    el.addEventListener('mouseenter', () => this.select(n));
    el.addEventListener('focus', () => this.select(n));
    el.addEventListener('mouseleave', () => {
      if (document.activeElement !== el) this.select(-1);
    });
    el.addEventListener('blur', () => this.select(-1));
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.select(n);
      this.scene.flash = 1;
      act();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const live = this.items.filter((i) => !i.el.hidden && !i.el.disabled);
      const k = live.findIndex((i) => i.el === el);
      live[(k + (e.key === 'ArrowDown' ? 1 : live.length - 1)) % live.length].el.focus();
    });
    this.items.push({ el, sub, act });
  }

  private select(n: number): void {
    this.active = n;
    this.items.forEach((it, i) => it.el.classList.toggle('on', i === n));
    if (n !== this.confirmItem && this.confirmNew) this.resetNewRunPrompt();
  }

  /** The tap: the core glides to its menu spot while the logo and the list move in. */
  private openMenu(): void {
    // "Continue" is display:none until its run is known; show it first and flush the style so it slides in like the rest instead of just appearing.
    this.refreshItems();
    void this.root.offsetWidth;
    this.root.dataset.phase = 'menu';
    this.scene.leftDown = this.layout.mode === 'landscape';
    this.anim = { t: 0, dur: this.reduce ? 0.01 : 0.9, from: { x: this.scene.cx, y: this.scene.cy } };
  }

  /** Back from the game: straight to the menu, the core already full and in place. */
  private showMenu(): void {
    const r = this.root;
    r.hidden = false;
    r.classList.remove('gone');
    r.dataset.phase = 'menu';
    this.scene.p = 1;
    this.scene.cx = this.layout.menuCore.x;
    this.scene.cy = this.layout.menuCore.y;
    this.scene.leftDown = this.layout.mode === 'landscape';
    this.anim = null;
    this.refreshItems();
    this.start();
  }

  /** "Continue" appears when there's something to go back to — in this session, or a run saved in the browser. */
  private refreshItems(): void {
    const g = this.game;
    const cont = this.items[0];
    let sub = '';
    if (g && g.hasSession) {
      if (g.mode === 'run' && g.run && g.runPhase !== 'over' && g.runPhase !== 'dock') {
        sub = this.runLine(g.run.shipId, g.run.road.missionsDone(g.run.cleared) + 1, g.run.cargo.metal, Math.round(g.runHull() * 100));
      } else if (g.mode === 'sandbox') {
        sub = `Песочница · ${SHIPS.find((s) => s.id === g.shipId)?.label ?? ''}`;
      } else if (g.mode === 'run' && g.runPhase === 'dock') {
        sub = 'Док';
      }
    }
    if (!sub && g && !g.hasSession) {
      const d = g.savedRun();
      if (d) {
        const road = new Road(d.seed, d.links, d.regens);
        sub = this.runLine(d.shipId, road.missionsDone(d.cleared) + 1, d.cargo.metal, null);
      }
    }
    cont.el.hidden = sub === '';
    cont.sub.textContent = sub;
    this.resetNewRunPrompt();
  }

  private runLine(shipId: string, mission: number, metal: number, hull: number | null): string {
    const ship = SHIPS.find((s) => s.id === shipId)?.label ?? '';
    return `Забег · миссия ${mission} · ${ship}${hull !== null ? ` · корпус ${hull} %` : ''} · трюм ${metal}/${shipHoldCap(shipId)}`;
  }

  private resetNewRunPrompt(): void {
    this.confirmNew = false;
    this.confirmItem = -1;
    for (const i of [1, 2]) {
      this.items[i].sub.textContent = '';
      this.items[i].el.classList.remove('warn');
    }
  }

  private resume(): void {
    this.go(() => {
      const g = this.game!;
      if (!g.hasSession && g.savedRun()) g.continueSaved();
    });
  }

  /** «Новый забег» starts from nothing, so it asks first, in a window of its own that says what goes. */
  private askNewGame(): void {
    const g = this.game;
    if (!g) return;
    const s = g.newGameSummary();
    const box = div('t-box', '');
    const h = document.createElement('h3');
    h.textContent = 'Начать с нуля?';
    const lead = document.createElement('p');
    lead.textContent = 'Новый забег стирает весь прогресс:';
    const ul = document.createElement('ul');
    const li = (html: string): void => {
      const e = document.createElement('li');
      e.innerHTML = html;
      ul.appendChild(e);
    };
    li(`Ресурсы: <b>${s.credits}</b> кр. · <b>${s.metal}</b> мет. · <b>${s.quanta}</b> кв.`);
    if (s.run) li(`Забег в пути: миссия <b>${s.run.mission}</b>, груз в трюме <b>${s.run.credits}</b> кр. · <b>${s.run.metal}</b> мет.`);
    li(`Экипаж: <b>${s.people}</b> чел., в «Памяти» <b>${s.fallen}</b>`);
    li(`Корабли: поломки и ремонты (<b>${s.damaged}</b>), расстановка модулей и их уровни (улучшенных <b>${s.upgraded}</b>)`);
    const btns = div('t-btns', '');
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'danger';
    ok.textContent = 'Начать заново';
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = 'Отмена';
    btns.append(ok, no);
    box.append(h, lead, ul, div('t-risk', 'Это нельзя отменить. Все корабли получат стандартную расстановку и первый экипаж.'), btns);
    this.dialog.replaceChildren(box);
    this.dialog.hidden = false;
    ok.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeDialog();
      this.go(() => g.newGame());
    });
    no.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeDialog();
    });
    no.focus();
  }

  private closeDialog(): void {
    this.dialog.hidden = true;
    this.dialog.replaceChildren();
  }

  private leaveRun(item: number, action: () => void): void {
    const g = this.game!;
    const inRun = g.hasRun() && !(g.hasSession && g.mode === 'run' && g.runPhase === 'dock') && !(g.hasSession && g.mode === 'sandbox');
    if (inRun && !(this.confirmNew && this.confirmItem === item)) {
      this.resetNewRunPrompt();
      this.confirmNew = true;
      this.confirmItem = item;
      const cargo = g.run ? g.run.cargo : g.savedRun()?.cargo;
      const risk = cargo && cargo.credits + cargo.metal > 0 ? `, груз в трюме (${cargo.credits} кр. · ${cargo.metal} мет.) пропадёт` : '';
      this.items[item].sub.textContent = `Нажмите ещё раз — текущий забег будет брошен${risk}`;
      this.items[item].el.classList.add('warn');
      return;
    }
    this.go(() => {
      if (inRun) g.abandonRun();
      action();
    });
  }

  /** Leaves for the game: runs the action, fades the title out. */
  private go(action: () => void): void {
    const g = this.game;
    if (!g) return;
    action();
    g.screen = 'game';
    g.hasSession = true;
    this.root.classList.add('gone');
    window.setTimeout(() => {
      if (g.screen !== 'game') return;
      this.root.hidden = true;
      this.running = false;
    }, 450);
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
    const sc = this.scene;
    const phase = this.root.dataset.phase;
    if (phase === 'loading') {
      // Fill toward the work actually done, no faster than a steady pour.
      sc.p = this.reduce ? this.target : Math.min(this.target, sc.p + dt * 0.45);
      this.pct.textContent = String(Math.round(sc.p * 100)).padStart(3, '0');
      if (this.loaded && sc.p >= 1) {
        this.root.dataset.phase = 'ready';
        this.label.textContent = 'Загрузка завершена';
      }
    }
    sc.excite += ((this.active >= 0 ? 1 : 0) - sc.excite) * Math.min(1, dt * 5);
    if (this.anim) {
      const A = this.anim;
      A.t += dt;
      const k = Math.min(1, A.t / A.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const to = this.layout.menuCore;
      sc.cx = A.from.x + (to.x - A.from.x) * e;
      sc.cy = A.from.y + (to.y - A.from.y) * e;
      if (k >= 1) this.anim = null;
    }
    sc.step(this.reduce ? 0 : dt, true);
    sc.render(this.img, this.glow);
    this.pxCtx.putImageData(this.img, 0, 0);
    this.glowCtx.putImageData(this.glow, 0, 0);
    requestAnimationFrame((t) => this.frame(t));
  }
}

function div(cls: string, text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
}
