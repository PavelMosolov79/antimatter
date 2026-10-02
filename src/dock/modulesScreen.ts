import { moduleSprite, paintDeck } from '../sim/interiorArt';
import { yardLayout, currentLayout } from '../sim/interior';
import {
  MODULE_INFO,
  POOL,
  TILE,
  canPlaceLadder,
  canPlaceModule,
  cloneLayout,
  decksWithoutLadder,
  paintCorridor,
  planDeck,
  putLadder,
  putModule,
  removeLadder,
  removeModuleToStock,
  takeFromStock,
  tileCapacity,
  type DeckGeo,
  type ModuleId,
  type PoolModuleId,
  type ShipLayout,
} from '../sim/layout';
import { saveLayout } from '../sim/layoutStore';
import type { Game } from '../game';
import { LEVELS, LV_MAX, effectText, levelOf, upgradeCost } from '../sim/levels';
import { SHIPS, shipDeckGeo } from '../sim/ships';

/**
 * The module menu of the dock, as designed in «Док Antimatter»: the deck cut open on the
 * dock's night-blue plate, the pool of modules beside it, drag a module onto the deck.
 * The layout is saved as it is edited; "Готово" returns to the berth, which rebuilds the ship.
 */

const KIND_NAMES: Record<string, string> = { fighter: 'Истребитель', cruiser: 'Крейсер', battleship: 'Линкор' };
const ZOOM: Record<string, number> = { fighter: 14, cruiser: 9, battleship: 5 };

const U = (css: string) => css.replace(/U\(([-\d.]+)\)/g, 'calc(var(--u) * $1)');
const CSS = U(`
#mods { position: fixed; inset: 0; z-index: 45; overflow: hidden; color: #c9d2ef; -webkit-user-select: none; user-select: none; touch-action: manipulation;
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; text-shadow: 0 0 U(.5) #000, 0 0 U(.25) #000;
  background-color: #04060d; background-image: linear-gradient(rgba(89,230,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(89,230,255,.045) 1px, transparent 1px); background-size: U(2.2) U(2.2); }
#mods[hidden] { display: none; }
#mods > * { position: absolute; }
#mods button { font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 500; font-size: U(1.15); letter-spacing: .14em; text-transform: uppercase; cursor: pointer; text-align: left;
  color: #c9d2ef; background: rgba(6,9,18,.78); border: 1px solid rgba(89,230,255,.22); padding: U(.85) U(1.1); display: flex; justify-content: space-between; align-items: center; gap: U(1); text-shadow: none; touch-action: manipulation; }
#mods button:hover { border-color: rgba(89,230,255,.6); color: #fff; }
#mods button:focus-visible { outline: 2px solid #ff4fd8; outline-offset: 2px; }
#mods button[aria-pressed="true"] { color: #59e6ff; border-color: #59e6ff; background: rgba(20,48,74,.8); }
#mods button.go { color: #fbf2ff; border-color: #ff4fd8; background: rgba(58,10,70,.78); box-shadow: 0 0 U(1.4) rgba(255,79,216,.35); font-weight: 700; }
#mods .ttl { left: U(3.2); top: calc(U(2.8) + env(safe-area-inset-top, 0px)); display: flex; flex-direction: column; gap: U(.3); }
#mods .ttl b { font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 900; font-size: U(3.4); letter-spacing: .3em; color: #f3e8ff; text-shadow: 0 0 U(1.2) rgba(180,60,255,.6), 0 0 U(.4) #000; }
#mods .ttl span { font-size: U(1.15); letter-spacing: .24em; text-transform: uppercase; color: #8a93b8; }
#mods .nav { left: 50%; transform: translateX(-50%); top: calc(U(2.4) + env(safe-area-inset-top, 0px)); display: flex; gap: U(1); align-items: center; }
#mods .nav .sw { width: U(3.4); height: U(3.4); padding: 0; justify-content: center; font-size: U(2.2); }
#mods .decks { display: flex; gap: U(.5); }
#mods .decks button { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: U(1.1); letter-spacing: .12em; padding: U(.7) U(1.1); justify-content: center; }
#mods .decks button.drop { background: rgba(80,230,150,.28); border-color: #50e696; color: #aaffd0; }
#mods .status { left: 0; right: 0; top: calc(U(6.4) + env(safe-area-inset-top, 0px)); text-align: center; font-size: U(1.05); letter-spacing: .22em; text-transform: uppercase; color: #6c77a0; pointer-events: none; }
#mods .status.hot { color: #63e07a; }
#mods .deck { left: U(30); right: U(35); top: calc(U(9.2) + env(safe-area-inset-top, 0px)); bottom: U(3); display: flex; align-items: center; justify-content: center; overflow: hidden; touch-action: none; }
#mods .zoom { position: absolute; right: U(.8); bottom: U(.8); display: flex; flex-direction: column; gap: U(.6); z-index: 2; }
#mods .zoom button { width: U(3.4); height: U(3.4); padding: 0; justify-content: center; font-size: U(2); letter-spacing: 0; }
#mods canvas.view { transform-origin: 50% 50%; will-change: transform; max-width: 100%; max-height: 100%; image-rendering: pixelated; image-rendering: crisp-edges; touch-action: none; filter: drop-shadow(0 0 U(1.6) rgba(89,230,255,.12)); }
#mods canvas.view.tool-module { cursor: grab; }
#mods .pool { right: U(3.2); width: U(29.6); top: calc(U(9.2) + env(safe-area-inset-top, 0px)); display: flex; flex-direction: column; gap: U(.8); padding: U(1.2); background: rgba(6,9,18,.72); border: 1px solid rgba(89,230,255,.18); max-height: calc(100% - U(23.5) - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; touch-action: pan-y; }
#mods .head { font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 700; font-size: U(1.1); letter-spacing: .16em; text-transform: uppercase; color: #f3e8ff; }
#mods .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: U(.6); }
#mods .pc { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: U(.4); padding: U(.6) U(.2); border: 1px solid rgba(89,230,255,.14); background: rgba(10,13,24,.8); cursor: grab; touch-action: pan-y;
  text-align: center; font-size: U(.95); line-height: 1.25; color: #9aa4c8; text-shadow: none; }
#mods .pc:hover { border-color: rgba(89,230,255,.5); color: #fff; }
#mods .pc canvas { width: U(4.6); height: auto; image-rendering: pixelated; }
#mods .pc.lad canvas { width: U(2.3); margin: U(1.15) 0; }
#mods .note { font-size: U(.85); line-height: 1.4; color: #6c77a0; text-shadow: none; }
#mods .card { left: U(3.2); bottom: calc(U(3) + env(safe-area-inset-bottom, 0px)); width: U(25); display: flex; flex-direction: column; gap: U(.6); padding: U(1.2) U(1.4);
  background: rgba(6,9,18,.72); border: 1px solid rgba(89,230,255,.18); border-left: U(.35) solid #59e6ff; }
#mods .name { font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 700; font-size: U(1.7); letter-spacing: .14em; text-transform: uppercase; color: #f3e8ff; }
#mods .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: U(.6) U(1); }
#mods .stats div { display: flex; flex-direction: column; }
#mods .stats small { font-size: U(.85); letter-spacing: .16em; text-transform: uppercase; color: #6c77a0; }
#mods .stats strong { font-size: U(1.5); font-weight: 700; color: #e9eeff; font-variant-numeric: tabular-nums; }
#mods .chip { font-size: U(.9); letter-spacing: .12em; text-transform: uppercase; padding: U(.3) U(.7); border: 1px solid; align-self: flex-start; }
#mods .chip.ok { color: #63e07a; border-color: rgba(99,224,122,.45); }
#mods .chip.warn { color: #ff4fd8; border-color: rgba(255,79,216,.5); }
#mods .card.sel { gap: U(.7); }
#mods .kind { font-size: U(.95); letter-spacing: .16em; text-transform: uppercase; color: #8a93b8; }
#mods .lvl { display: flex; align-items: center; gap: U(.8); }
#mods .pips { display: flex; gap: U(.3); }
#mods .pips i { width: U(1.6); height: U(.8); background: #2a3452; }
#mods .pips i.on { background: #e8c450; box-shadow: 0 0 U(.6) rgba(232,196,80,.6); }
#mods .lvl b { font-size: U(1.05); letter-spacing: .14em; color: #e8c450; font-weight: 700; }
#mods .eff { font-size: U(1); line-height: 1.35; color: #c9d2ef; text-shadow: none; }
#mods .eff small { display: block; font-size: U(.8); letter-spacing: .16em; text-transform: uppercase; color: #6c77a0; }
#mods .eff.nxt { color: #aaffd0; }
#mods .eff.later { color: #8a93b8; }
#mods .cost { display: flex; gap: U(.6); flex-wrap: wrap; }
#mods .cost span { font-size: U(1); padding: U(.3) U(.7); border: 1px solid rgba(99,224,122,.45); color: #63e07a; text-shadow: none; }
#mods .cost span.bad { color: #ff6a5a; border-color: rgba(255,106,90,.55); }
#mods .card button { font-size: U(1.05); padding: U(.7) U(1); }
#mods .card button:disabled { opacity: .45; cursor: default; }
#mods .res { font-size: U(.9); color: #8a93b8; text-shadow: none; }
#mods .res b { color: #63e07a; font-weight: 500; }
#mods .pc .lvb { color: #e8c450; font-size: U(.8); letter-spacing: .1em; }
#mods .stockhead { margin-top: U(.4); }
#mods .tools { left: U(3.2); top: calc(U(11.2) + env(safe-area-inset-top, 0px)); width: U(25); display: grid; grid-template-columns: 1fr 1fr; gap: U(.6); }
#mods .tools button { justify-content: flex-start; }
#mods .actions { right: U(3.2); bottom: calc(U(3) + env(safe-area-inset-bottom, 0px)); width: U(29.6); display: flex; flex-direction: column; gap: U(.8); }
.mfloat { position: fixed; z-index: 70; pointer-events: none; transform: translate(-50%, -50%); filter: drop-shadow(0 4px 10px rgba(0,0,0,.6)); }
.mfloat canvas { image-rendering: pixelated; display: block; }

#mods.portrait { display: flex; flex-direction: column; gap: U(1.8); padding: calc(U(3.5) + env(safe-area-inset-top, 0px)) U(4) calc(U(4) + env(safe-area-inset-bottom, 0px)); }
#mods.portrait[hidden] { display: none; }
#mods.portrait > * { position: static; }
#mods.portrait .deck { position: relative; left: auto; right: auto; top: auto; bottom: auto; }
#mods.portrait .zoom button { width: U(7.2); height: U(7.2); font-size: U(4.2); }
#mods.portrait .zoom { right: U(1.4); bottom: U(1.4); gap: U(1.2); }
#mods.portrait button { font-size: U(2.5); padding: U(1.8) U(2.2); }
#mods.portrait .ttl { align-items: center; text-align: center; gap: U(.6); }
#mods.portrait .ttl b { font-size: U(5.6); }
#mods.portrait .ttl span { font-size: U(2.2); }
#mods.portrait .nav { transform: none; align-self: center; gap: U(2); }
#mods.portrait .nav .sw { width: U(7.2); height: U(7.2); font-size: U(4.6); padding: 0; }
#mods.portrait .decks { gap: U(1.2); }
#mods.portrait .decks button { font-size: U(2.5); padding: U(1.7) U(2.4); }
#mods.portrait .status { font-size: U(2); }
#mods.portrait .deck { flex: 1 1 0; min-height: 0; }
#mods.portrait .pool { width: auto; padding: U(2.2); gap: U(1.4); overflow: visible; max-height: none; touch-action: auto; }
#mods.portrait .head { font-size: U(2.3); }
#mods.portrait .cards { display: flex; overflow-x: auto; gap: U(1.3); padding-bottom: U(1); scrollbar-width: thin; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; touch-action: pan-x; }
#mods.portrait .pc { touch-action: pan-x; flex: 0 0 U(17); font-size: U(2); padding: U(1.2) U(.3); gap: U(.8); }
#mods.portrait .pc canvas { width: U(10); }
#mods.portrait .pc.lad canvas { width: U(5); margin: U(2.5) 0; }
#mods.portrait .note { display: none; }
#mods.portrait .tools { width: auto; display: flex; flex-direction: row; flex-wrap: wrap; gap: U(1.2); }
#mods.portrait .tools button { justify-content: center; flex: 1 1 auto; font-size: U(2.2); padding: U(1.5) U(1.4); }
#mods.portrait .card { width: auto; padding: U(2.2) U(2.6); gap: U(1.2); border-left-width: U(.8); flex-direction: row; flex-wrap: wrap; align-items: center; }
#mods.portrait .name { font-size: U(3.4); }
#mods.portrait .stats { grid-template-columns: repeat(3, auto); gap: U(1.2) U(3); }
#mods.portrait .stats small { font-size: U(1.8); }
#mods.portrait .stats strong { font-size: U(3.2); }
#mods.portrait .chip { font-size: U(1.9); padding: U(.6) U(1.3); }
#mods.portrait .card.sel { flex-direction: column; align-items: stretch; }
#mods.portrait .pips i { width: U(3.4); height: U(1.6); }
#mods.portrait .lvl b { font-size: U(2.3); }
#mods.portrait .kind { font-size: U(1.9); }
#mods.portrait .eff { font-size: U(2.2); }
#mods.portrait .eff small { font-size: U(1.7); }
#mods.portrait .cost span { font-size: U(2.1); padding: U(.6) U(1.4); }
#mods.portrait .card button { font-size: U(2.4); padding: U(1.4) U(2); }
#mods.portrait .res { font-size: U(2); }
#mods.portrait .pc .lvb { font-size: U(1.7); }
#mods.portrait .actions { width: auto; flex-direction: row; gap: U(1.6); }
#mods.portrait .actions button { flex: 1 1 0; }
#mods.portrait .actions button.go { flex: 1.6 1 0; font-size: U(2.9); }
`);

type Tool = 'module' | 'corr' | 'erase';

interface Drag {
  type: ModuleId | 'ladder';
  tw: number;
  th: number;
  /** The id of the module or ladder already on the deck, or null for a new one from the pool. */
  id: number | null;
  ladder: boolean;
  z0: number;
  over: boolean;
  valid: boolean;
  /** Tile (module) or cell (ladder) under the pointer. */
  i: number;
  j: number;
  tab: number | null;
  /** Upgrade level the module carries (a stocked one), and the stock card it came from. */
  lv: number;
  stockId: number | null;
  moved: boolean;
  sx: number;
  sy: number;
}

export class ModulesScreen {
  private root = document.createElement('div');
  private open_ = false;
  private shipId = 'fighter';
  private geo!: DeckGeo;
  private layout!: ShipLayout;
  private deck = 1;
  private tool: Tool = 'module';
  private brush = 2;
  private showGrid = true;
  private portrait = false;

  private els = {
    sub: document.createElement('span'),
    decks: document.createElement('div'),
    status: document.createElement('div'),
    canvas: document.createElement('canvas'),
    pool: document.createElement('div'),
    info: document.createElement('div'),
    tools: document.createElement('div'),
  };
  private ctx = this.els.canvas.getContext('2d')!;
  private lastPlan: ReturnType<typeof planDeck> | null = null;
  private drag: Drag | null = null;
  private floater: HTMLElement | null = null;
  private hover: number | null = null;
  private painting = false;
  private lastCell: { x: number; y: number } | null = null;
  private flashTimer = 0;
  private deckBox = document.createElement('div');
  /** View of the deck: zoom and the shift of the picture, kept in CSS pixels from the centred position. */
  private view = { s: 1, tx: 0, ty: 0 };
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; s: number; tx: number; ty: number; mx: number; my: number } | null = null;
  /** After a pinch the lifted fingers must not start a drag or a stroke until every finger is up. */
  private gestureLock = false;
  private panning: { x: number; y: number; tx: number; ty: number } | null = null;
  /** A touch on a pool card waits to see whether it scrolls the pool or pulls a module out of it. */
  private pending: { id: number; x: number; y: number; spec: { type: ModuleId | 'ladder'; tw: number; th: number; id: number | null; ladder: boolean; lv?: number; stockId?: number | null } } | null = null;

  /** The module whose card is open. */
  private sel: number | null = null;
  private stock = document.createElement('div');
  private stockHead = div('head stockhead', 'В запасе');

  constructor(
    private onDone: (shipId: string) => void,
    parent: HTMLElement,
    private game: Game,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const r = this.root;
    r.id = 'mods';
    r.hidden = true;
    const ttl = div('ttl');
    const b = document.createElement('b');
    b.textContent = 'МОДУЛИ';
    ttl.append(b, this.els.sub);
    const nav = div('nav');
    const prev = button('‹', () => this.cycle(-1));
    prev.className = 'sw';
    prev.setAttribute('aria-label', 'Предыдущий корабль');
    const next = button('›', () => this.cycle(1));
    next.className = 'sw';
    next.setAttribute('aria-label', 'Следующий корабль');
    this.els.decks.className = 'decks';
    nav.append(prev, this.els.decks, next);
    this.els.status.className = 'status';
    const deck = this.deckBox;
    deck.className = 'deck';
    this.els.canvas.className = 'view';
    const zoom = div('zoom');
    for (const [label, name, fn] of [
      ['+', 'Приблизить', () => this.zoomBy(1.5)],
      ['−', 'Отдалить', () => this.zoomBy(1 / 1.5)],
      ['⤢', 'Вся палуба', () => this.resetView()],
    ] as Array<[string, string, () => void]>) {
      const zb = button(label, fn);
      zb.setAttribute('aria-label', name);
      zb.title = name;
      zoom.appendChild(zb);
    }
    deck.append(this.els.canvas, zoom);
    deck.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    const pool = div('pool');
    const head = div('head', 'Пул модулей');
    this.els.pool.className = 'cards';
    for (const id of POOL) {
      const c = div('pc');
      c.title = `${MODULE_INFO[id].name} — ${MODULE_INFO[id].desc}`;
      c.append(spriteCanvas(id, 1, 1, 5), span(MODULE_INFO[id].name));
      c.addEventListener('pointerdown', (e) => this.poolDown(e, { type: id, tw: 1, th: 1, id: null, ladder: false }));
      this.els.pool.appendChild(c);
    }
    const lc = div('pc lad');
    lc.title = `Лестница 5×5: ${MODULE_INFO.ladder.desc}`;
    lc.append(spriteCanvas('ladder', 1, 1, 10), span('Лестница'));
    lc.addEventListener('pointerdown', (e) => this.poolDown(e, { type: 'ladder', tw: 1, th: 1, id: null, ladder: true }));
    this.els.pool.appendChild(lc);
    this.stock.className = 'cards';
    pool.append(head, this.els.pool, this.stockHead, this.stock, div('note', 'Тяните в палубу. Нажмите на модуль, чтобы улучшить. Чтобы убрать, верните в пул: уровень сохранится. Колесо или щипок — масштаб.'));
    this.els.info.className = 'card';
    this.els.tools.className = 'tools';
    for (const [t, label] of [
      ['module', 'Модули'],
      ['corr', 'Коридор'],
      ['erase', 'Ластик'],
    ] as Array<[Tool, string]>) {
      const bt = button(label, () => {
        this.tool = t;
        this.refresh();
      });
      bt.dataset.tool = t;
      this.els.tools.appendChild(bt);
    }
    const brush = button('', () => {
      this.brush = (this.brush % 4) + 1;
      this.refresh();
    });
    brush.className = 'brush';
    const gridBtn = button('Сетка', () => {
      this.showGrid = !this.showGrid;
      this.refresh();
    });
    gridBtn.className = 'grid';
    this.els.tools.append(brush, gridBtn);
    const actions = div('actions');
    const reset = button('По умолчанию', () => {
      // Back to the yard's arrangement, but what the player paid for stays: base modules keep their levels, upgraded ones wait in the pool.
      const old = this.layout;
      const fresh = yardLayout(this.shipId, this.geo);
      for (const m of fresh.mods) {
        const o = old.mods.find((q) => q.base && q.type === m.type);
        if (o?.lv) m.lv = o.lv;
      }
      fresh.stock = (old.stock ?? []).map((x) => ({ ...x }));
      for (const o of old.mods) if (!o.base && levelOf(o) > 1) fresh.stock.push({ id: fresh.next++, type: o.type as PoolModuleId, lv: levelOf(o) });
      this.layout = fresh;
      this.sel = null;
      this.save();
      this.refresh();
      this.flash('Расстановка по умолчанию');
    });
    const done = button('', () => this.close());
    done.className = 'go';
    done.innerHTML = '<span>Готово</span><span>▸</span>';
    actions.append(reset, done);
    r.append(ttl, nav, this.els.status, deck, pool, this.els.info, this.els.tools, actions);
    parent.appendChild(r);

    this.els.canvas.addEventListener('pointerdown', (e) => this.canvasDown(e));
    this.els.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('keydown', (e) => {
      if (this.open_ && e.key === 'Escape') this.close();
    });
    let t = 0;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = window.setTimeout(() => this.open_ && this.fit(), 150);
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(shipId: string): void {
    this.open_ = true;
    this.root.hidden = false;
    this.load(shipId);
    this.fit();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    this.drag = null;
    this.floater?.remove();
    this.floater = null;
    this.onDone(this.shipId);
  }

  private load(shipId: string): void {
    if (!SHIPS.some((s) => s.id === shipId)) shipId = SHIPS[0].id;
    this.shipId = shipId;
    this.geo = shipDeckGeo(shipId);
    this.layout = currentLayout(shipId, this.geo);
    this.deck = 1;
    this.hover = null;
    this.view = { s: 1, tx: 0, ty: 0 };
    this.applyView();
    this.refresh();
  }

  private cycle(dir: number): void {
    const i = SHIPS.findIndex((s) => s.id === this.shipId);
    this.load(SHIPS[(i + dir + SHIPS.length) % SHIPS.length].id);
  }

  private fit(): void {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    this.portrait = vh / vw >= 1.4;
    this.root.classList.toggle('portrait', this.portrait);
    const u = this.portrait ? Math.min(vw, (vh * 9) / 16) / 100 : Math.min(vw, (vh * 16) / 9) / 100;
    this.root.style.setProperty('--u', `${u}px`);
  }

  // ---------------------------------------------------------------- zoom

  private applyView(): void {
    const v = this.view;
    this.els.canvas.style.transform = v.s === 1 && v.tx === 0 && v.ty === 0 ? '' : `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;
  }

  private resetView(): void {
    this.view = { s: 1, tx: 0, ty: 0 };
    this.applyView();
  }

  /** Zoom by `k` keeping the point (cx, cy) in client pixels where it is; the deck centre by default. */
  private zoomAt(k: number, cx?: number, cy?: number): void {
    const v = this.view;
    const rect = this.els.canvas.getBoundingClientRect();
    const box = this.deckBox.getBoundingClientRect();
    const px = cx ?? box.left + box.width / 2;
    const py = cy ?? box.top + box.height / 2;
    const s2 = Math.max(1, Math.min(8, v.s * k));
    const c0x = rect.left + rect.width / 2 - v.tx;
    const c0y = rect.top + rect.height / 2 - v.ty;
    const qx = (px - c0x - v.tx) / v.s;
    const qy = (py - c0y - v.ty) / v.s;
    this.view = { s: s2, tx: px - c0x - qx * s2, ty: py - c0y - qy * s2 };
    this.clampView();
  }

  private zoomBy(k: number): void {
    this.zoomAt(k);
  }

  /** Keep the picture over the deck: it can be pulled aside only by as much as it overhangs. */
  private clampView(): void {
    const v = this.view;
    if (v.s <= 1.001) {
      this.view = { s: 1, tx: 0, ty: 0 };
    } else {
      const box = this.deckBox.getBoundingClientRect();
      const w = this.els.canvas.offsetWidth * v.s;
      const h = this.els.canvas.offsetHeight * v.s;
      const mx = Math.max(0, (w - box.width) / 2) + box.width * 0.2;
      const my = Math.max(0, (h - box.height) / 2) + box.height * 0.2;
      v.tx = Math.max(-mx, Math.min(mx, v.tx));
      v.ty = Math.max(-my, Math.min(my, v.ty));
    }
    this.applyView();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.zoomAt(Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY);
  }

  private pinchStart(): void {
    const [a, b] = [...this.touches.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: this.view.s, tx: this.view.tx, ty: this.view.ty, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    this.gestureLock = true;
    this.panning = null;
    if (this.drag) {
      this.drag = null;
      this.floater?.remove();
      this.floater = null;
    }
    if (this.painting) {
      this.painting = false;
      this.lastCell = null;
      this.save();
    }
    this.draw();
  }

  private pinchMove(): void {
    const p = this.pinch;
    if (!p || this.touches.size < 2) return;
    const [a, b] = [...this.touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // Restore the state the pinch began in, then zoom about its first midpoint and follow the fingers' drift.
    this.view = { s: p.s, tx: p.tx, ty: p.ty };
    this.applyView();
    this.zoomAt(d / p.d, p.mx, p.my);
    this.view.tx += mx - p.mx;
    this.view.ty += my - p.my;
    this.clampView();
  }

  private flash(msg: string): void {
    const s = this.els.status;
    s.textContent = msg;
    s.classList.add('hot');
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      s.classList.remove('hot');
      s.textContent = 'Перетащите модуль из пула на палубу';
    }, 2200);
  }

  private save(): void {
    saveLayout(this.shipId, cloneLayout(this.layout));
  }

  // ---------------------------------------------------------------- drawing

  private refresh(): void {
    const g = this.geo;
    this.els.sub.textContent = `${KIND_NAMES[this.shipId] ?? ''} · Причал 1`;
    this.els.decks.replaceChildren();
    for (let z = 1; z < g.depth; z++) {
      const b = button(`П${z}`, () => {
        this.deck = z;
        this.refresh();
      });
      b.dataset.deck = String(z);
      b.setAttribute('aria-pressed', String(z === this.deck));
      b.title = `Палуба ${z} (перетащите модуль на кнопку, чтобы перенести на неё)`;
      this.els.decks.appendChild(b);
    }
    this.els.tools.querySelectorAll<HTMLButtonElement>('button[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === this.tool)));
    const brush = this.els.tools.querySelector<HTMLButtonElement>('button.brush')!;
    brush.textContent = `Кисть ${this.brush}`;
    brush.style.display = this.tool === 'module' ? 'none' : '';
    this.els.tools.querySelector('button.grid')!.setAttribute('aria-pressed', String(this.showGrid));
    this.els.canvas.classList.toggle('tool-module', this.tool === 'module');
    const Z = ZOOM[this.shipId] ?? 6;
    if (this.els.canvas.width !== g.w * Z) {
      this.els.canvas.width = g.w * Z;
      this.els.canvas.height = g.h * Z;
    }
    if (!this.els.status.textContent) this.els.status.textContent = 'Перетащите модуль из пула на палубу';
    this.renderStock();
    this.draw();
  }

  private draw(): void {
    const g = this.geo;
    const z = this.deck;
    const Z = ZOOM[this.shipId] ?? 6;
    const plan = planDeck(g, this.layout, z);
    this.lastPlan = plan;
    const off = document.createElement('canvas');
    off.width = g.w;
    off.height = g.h;
    off.getContext('2d')!.putImageData(new ImageData(paintDeck(plan, g.w, g.h) as unknown as Uint8ClampedArray<ArrayBuffer>, g.w, g.h), 0, 0);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.els.canvas.width, this.els.canvas.height);
    ctx.drawImage(off, 0, 0, g.w * Z, g.h * Z);
    const o = g.org[z];
    if (this.showGrid) {
      ctx.strokeStyle = 'rgba(111,211,255,0.2)';
      ctx.lineWidth = 1;
      for (let j = -2; j < Math.ceil(g.h / TILE) + 2; j++) {
        for (let i = -2; i < Math.ceil(g.w / TILE) + 2; i++) {
          if (!canPlaceModule(g, this.layout, z, i, j, 1, 1, null)) continue;
          ctx.strokeRect((o.ox + TILE * i + 0.5) * Z, (o.oy + TILE * j + 0.5) * Z, TILE * Z, TILE * Z);
        }
      }
    }
    for (const e of plan.ents) {
      if (e.kind !== 'lad') continue;
      const cx = (e.r.x0 + 2.5) * Z;
      const cy = (e.r.y0 + 2.5) * Z;
      const u = Math.min(Z * 0.95, 16);
      const dir = e.down ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(cx - u, cy - dir * u * 0.75);
      ctx.lineTo(cx + u, cy - dir * u * 0.75);
      ctx.lineTo(cx, cy + dir * u * 0.85);
      ctx.closePath();
      ctx.fillStyle = e.down ? '#f0a851' : '#6fd3ff';
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(5,8,12,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const d = this.drag;
    if (d && d.over) {
      if (!d.ladder) {
        for (let j = -2; j < Math.ceil(g.h / TILE) + 2; j++) {
          for (let i = -2; i < Math.ceil(g.w / TILE) + 2; i++) {
            if (!canPlaceModule(g, this.layout, z, i, j, d.tw, d.th, d.id)) continue;
            ctx.fillStyle = 'rgba(80,230,150,0.16)';
            ctx.fillRect((o.ox + TILE * i + 1) * Z, (o.oy + TILE * j + 1) * Z, (TILE * d.tw - 1) * Z, (TILE * d.th - 1) * Z);
          }
        }
      }
      const spr = moduleSprite(d.type, d.tw, d.th);
      const gc = spriteCanvas(d.type, d.tw, d.th, 1);
      const gx = d.ladder ? d.i : o.ox + TILE * d.i;
      const gy = d.ladder ? d.j : o.oy + TILE * d.j;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(gc, gx * Z, gy * Z, spr.w * Z, spr.h * Z);
      ctx.globalAlpha = 1;
      ctx.fillStyle = d.valid ? 'rgba(80,230,150,0.28)' : 'rgba(255,80,90,0.4)';
      ctx.fillRect(gx * Z, gy * Z, spr.w * Z, spr.h * Z);
      ctx.strokeStyle = d.valid ? '#50e696' : '#ff5a64';
      ctx.lineWidth = 2;
      ctx.strokeRect(gx * Z, gy * Z, spr.w * Z, spr.h * Z);
    }
    if (this.hover !== null && !this.drag && plan.ents[this.hover]) {
      const r = plan.ents[this.hover].r;
      ctx.strokeStyle = 'rgba(240,168,81,0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x0 * Z, r.y0 * Z, (r.x1 - r.x0 + 1) * Z, (r.y1 - r.y0 + 1) * Z);
    }
    for (const e of plan.ents) {
      if (e.kind !== 'mod') continue;
      const m = e.ref as { id: number; lv?: number };
      const lv = levelOf(m);
      const sel = this.sel === m.id;
      const ps = Math.max(2, Z * 0.9);
      const gap = Math.max(1, Z * 0.35);
      for (let k = 0; k < LV_MAX; k++) {
        if (k >= lv && !sel) continue;
        ctx.fillStyle = k < lv ? '#e8c450' : 'rgba(255,255,255,0.18)';
        ctx.fillRect(e.r.x0 * Z + Z * 1.6 + k * (ps + gap), e.r.y1 * Z - Z * 2.2, ps, ps * 0.8);
      }
      if (sel) {
        ctx.strokeStyle = '#59e6ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(e.r.x0 * Z, e.r.y0 * Z, (e.r.x1 - e.r.x0 + 1) * Z, (e.r.y1 - e.r.y0 + 1) * Z);
      }
    }
    this.fillCard(plan);
  }

  /** Modules put back in the pool with a level above the first wait here as themselves. */
  private renderStock(): void {
    const list = this.layout.stock ?? [];
    this.stock.replaceChildren();
    this.stockHead.hidden = list.length === 0;
    for (const it of list) {
      const c = div('pc');
      c.title = `${MODULE_INFO[it.type].name}, уровень ${it.lv}`;
      c.append(spriteCanvas(it.type, 1, 1, 5), span(MODULE_INFO[it.type].name), Object.assign(span(`ур. ${it.lv} / ${LV_MAX}`), { className: 'lvb' }));
      c.addEventListener('pointerdown', (e) => this.poolDown(e, { type: it.type as PoolModuleId, tw: 1, th: 1, id: null, ladder: false, lv: it.lv, stockId: it.id }));
      this.stock.appendChild(c);
    }
  }

  /** The open card of one module: its level, what it does now and next, and the price of the next level. */
  private moduleCard(m: { id: number; type: ModuleId; tw: number; th: number; base: boolean; lv?: number }): void {
    const c = this.els.info;
    const lv = levelOf(m);
    const def = LEVELS[m.type];
    const info = MODULE_INFO[m.type];
    c.replaceChildren();
    c.classList.add('sel');
    const pips = div('pips');
    for (let k = 1; k <= LV_MAX; k++) pips.appendChild(Object.assign(document.createElement('i'), { className: k <= lv ? 'on' : '' }));
    const lvl = div('lvl');
    lvl.append(pips, Object.assign(document.createElement('b'), { textContent: `ур. ${lv} / ${LV_MAX}` }));
    c.append(div('name', info.name), div('kind', `${info.kind}${m.base ? ' · базовый' : ''} · ${m.tw}×${m.th}`), lvl);
    const eff = (cls: string, label: string, text: string) => {
      const d = div(`eff ${cls}`);
      d.append(Object.assign(document.createElement('small'), { textContent: label }), document.createTextNode(text));
      return d;
    };
    if (!def.live) {
      c.append(eff('later', 'Эффект', 'появится позже: пока такой модуль только занимает комнату, улучшать его нечем'));
    } else {
      c.append(eff('', 'Сейчас', effectText(m.type, lv, this.shipId)));
      if (lv < LV_MAX) {
        const cost = upgradeCost(m.tw, m.th, lv + 1);
        const w = this.game.wallet;
        const okC = w.credits >= cost.credits;
        const okM = w.metal >= cost.metal;
        const price = div('cost');
        price.append(Object.assign(span(`Кредиты ${cost.credits}`), { className: okC ? '' : 'bad' }), Object.assign(span(`Металл ${cost.metal}`), { className: okM ? '' : 'bad' }));
        const up = button('', () => this.upgrade(m.id));
        up.className = 'go';
        up.innerHTML = '<span>Улучшить</span><span>▸</span>';
        up.disabled = !(okC && okM);
        c.append(eff('nxt', `Уровень ${lv + 1}`, effectText(m.type, lv + 1, this.shipId)), price, up);
      } else c.append(chip('ok', 'максимальный уровень'));
    }
    const w = this.game.wallet;
    const res = div('res');
    res.append(document.createTextNode('Ресурсы: Кредиты '), Object.assign(document.createElement('b'), { textContent: String(w.credits) }), document.createTextNode(' · Металл '), Object.assign(document.createElement('b'), { textContent: String(w.metal) }));
    c.appendChild(res);
  }

  private upgrade(id: number): void {
    const m = this.layout.mods.find((q) => q.id === id);
    if (!m) return;
    const lv = levelOf(m);
    if (lv >= LV_MAX || !LEVELS[m.type].live) return;
    if (!this.game.spendWallet(upgradeCost(m.tw, m.th, lv + 1))) return;
    m.lv = lv + 1;
    this.save();
    this.refresh();
    this.flash(`Модуль улучшен до уровня ${lv + 1}`);
  }

  private fillCard(plan: ReturnType<typeof planDeck>): void {
    const g = this.geo;
    const { slots, free } = tileCapacity(g, this.layout);
    const missing = decksWithoutLadder(g, this.layout).map((z) => `П${z}–П${z + 1}`);
    let doors = 0;
    const set = new Set(plan.doors);
    for (const i of plan.doors) if (!set.has(i - 1) && !set.has(i - g.w)) doors++;
    const c = this.els.info;
    const selMod = this.sel !== null ? this.layout.mods.find((q) => q.id === this.sel) : undefined;
    if (this.sel !== null && !selMod) this.sel = null;
    c.classList.toggle('sel', !!selMod);
    if (selMod) {
      this.moduleCard(selMod);
      return;
    }
    c.replaceChildren();
    const name = div('name', `Палуба ${this.deck}`);
    const stats = div('stats');
    for (const [k, v] of [
      ['модулей', String(this.layout.mods.length)],
      ['свободно', `${free}/${slots}`],
      ['лестниц', String(this.layout.lads.length)],
      ['дверей', String(doors)],
    ] as Array<[string, string]>) {
      const d = document.createElement('div');
      const s = document.createElement('small');
      s.textContent = k;
      const st = document.createElement('strong');
      st.textContent = v;
      d.append(s, st);
      stats.appendChild(d);
    }
    c.append(name, stats);
    if (missing.length) c.appendChild(chip('warn', `нет лестницы ${missing.join(', ')}`));
    else c.appendChild(chip('ok', 'экипаж проходит по всем палубам'));
    if (plan.issues.length) c.appendChild(chip('warn', `нет выхода: ${plan.issues.join('; ')}`));
  }

  // ---------------------------------------------------------------- pointer

  private cellOf(e: PointerEvent): { x: number; y: number; inside: boolean } {
    const r = this.els.canvas.getBoundingClientRect();
    const box = this.deckBox.getBoundingClientRect();
    const g = this.geo;
    const inBox = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * g.w),
      y: Math.floor(((e.clientY - r.top) / r.height) * g.h),
      inside: inBox && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom,
    };
  }

  private entAt(c: { x: number; y: number }): number {
    const plan = this.lastPlan;
    if (!plan) return -1;
    for (let k = 0; k < plan.ents.length; k++) {
      const r = plan.ents[k].r;
      if (c.x >= r.x0 && c.x <= r.x1 && c.y >= r.y0 && c.y <= r.y1) return k;
    }
    return -1;
  }

  private poolDown(e: PointerEvent, spec: { type: ModuleId | 'ladder'; tw: number; th: number; id: number | null; ladder: boolean; lv?: number; stockId?: number | null }): void {
    if (e.pointerType === 'mouse') {
      this.startDrag(e, spec);
      return;
    }
    this.pending = { id: e.pointerId, x: e.clientX, y: e.clientY, spec };
  }

  private startDrag(e: PointerEvent, spec: { type: ModuleId | 'ladder'; tw: number; th: number; id: number | null; ladder: boolean; lv?: number; stockId?: number | null }): void {
    if (e.type === 'pointerdown' && e.button !== 0) return;
    e.preventDefault();
    const cur = spec.ladder && spec.id !== null ? this.layout.lads.find((l) => l.id === spec.id) : undefined;
    this.drag = { ...spec, lv: spec.lv ?? 1, stockId: spec.stockId ?? null, moved: false, sx: e.clientX, sy: e.clientY, z0: cur ? cur.z0 : this.deck < this.geo.depth - 1 ? this.deck : this.deck - 1, over: false, valid: false, i: 0, j: 0, tab: null };
    const f = div('mfloat');
    f.appendChild(spriteCanvas(spec.type, spec.tw, spec.th, 3));
    document.body.appendChild(f);
    this.floater = f;
    this.moveFloater(e);
    this.move(e);
  }

  private moveFloater(e: PointerEvent): void {
    if (!this.floater) return;
    this.floater.style.left = `${e.clientX}px`;
    this.floater.style.top = `${e.clientY}px`;
  }

  private nearestTile(c: { x: number; y: number }, d: Drag): { i: number; j: number; ok: boolean } {
    const o = this.geo.org[this.deck];
    const ci = Math.round((c.x - (TILE * d.tw) / 2 - o.ox) / TILE);
    const cj = Math.round((c.y - (TILE * d.th) / 2 - o.oy) / TILE);
    let best: { i: number; j: number; dist: number } | null = null;
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        if (!canPlaceModule(this.geo, this.layout, this.deck, ci + di, cj + dj, d.tw, d.th, d.id)) continue;
        const dist = Math.hypot(di, dj);
        if (!best || dist < best.dist) best = { i: ci + di, j: cj + dj, dist };
      }
    }
    return best ? { i: best.i, j: best.j, ok: true } : { i: ci, j: cj, ok: false };
  }

  private nearestCell(c: { x: number; y: number }, d: Drag): { i: number; j: number; ok: boolean } {
    const ci = c.x - 2;
    const cj = c.y - 2;
    let best: { i: number; j: number; dist: number } | null = null;
    for (let dj = -3; dj <= 3; dj++) {
      for (let di = -3; di <= 3; di++) {
        if (!canPlaceLadder(this.geo, this.layout, ci + di, cj + dj, d.z0, d.id)) continue;
        const dist = Math.hypot(di, dj);
        if (!best || dist < best.dist) best = { i: ci + di, j: cj + dj, dist };
      }
    }
    return best ? { i: best.i, j: best.j, ok: true } : { i: ci, j: cj, ok: false };
  }

  private deckTabAt(e: PointerEvent): number | null {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const b = el?.closest?.('#mods .decks button') as HTMLElement | null;
    return b ? Number(b.dataset.deck) : null;
  }

  private move(e: PointerEvent): void {
    if (!this.open_) return;
    if (this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch) {
        this.pinchMove();
        return;
      }
    }
    if (this.gestureLock) return;
    const pd = this.pending;
    if (pd && pd.id === e.pointerId) {
      const dx = e.clientX - pd.x;
      const dy = e.clientY - pd.y;
      if (Math.hypot(dx, dy) > 8) {
        this.pending = null;
        // The pool scrolls along one axis; pulling across it takes the module out.
        if (this.portrait ? Math.abs(dy) > Math.abs(dx) : Math.abs(dx) > Math.abs(dy)) this.startDrag(e, pd.spec);
      }
      return;
    }
    if (this.panning) {
      const pn = this.panning;
      this.view.tx = pn.tx + e.clientX - pn.x;
      this.view.ty = pn.ty + e.clientY - pn.y;
      this.clampView();
      return;
    }
    if (this.painting) {
      this.paintAt(e);
      return;
    }
    const c = this.cellOf(e);
    const d = this.drag;
    if (d) {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
      this.moveFloater(e);
      d.over = c.inside;
      if (this.floater) this.floater.style.opacity = c.inside ? '0' : '1';
      const tab = this.deckTabAt(e);
      this.els.decks.querySelectorAll('button').forEach((b) => b.classList.toggle('drop', tab !== null && Number((b as HTMLElement).dataset.deck) === tab));
      d.tab = tab;
      if (c.inside) {
        const t = d.ladder ? this.nearestCell(c, d) : this.nearestTile(c, d);
        d.i = t.i;
        d.j = t.j;
        d.valid = t.ok;
      } else d.valid = false;
      this.draw();
      return;
    }
    if (c.inside && this.tool === 'module') {
      const k = this.entAt(c);
      const nv = k >= 0 ? k : null;
      if (nv !== this.hover) {
        this.hover = nv;
        this.draw();
      }
    } else if (this.hover !== null) {
      this.hover = null;
      this.draw();
    }
  }

  private up(e: PointerEvent): void {
    if (!this.open_) return;
    if (this.pending && this.pending.id === e.pointerId) this.pending = null;
    if (this.touches.delete(e.pointerId)) {
      if (this.touches.size < 2) this.pinch = null;
      if (this.touches.size === 0) this.gestureLock = false;
    }
    this.panning = null;
    if (this.gestureLock) return;
    if (this.painting) {
      this.painting = false;
      this.lastCell = null;
      this.save();
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.floater?.remove();
    this.floater = null;
    this.els.decks.querySelectorAll('button').forEach((b) => b.classList.remove('drop'));
    const c = this.cellOf(e);
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const overPool = !!under?.closest?.('#mods .pool');
    const g = this.geo;
    if (!d.moved && d.id !== null && !d.ladder) {
      this.sel = d.id;
      this.refresh();
      return;
    }
    if (d.ladder) {
      if (c.inside && d.valid) putLadder(g, this.layout, d.i, d.j, d.z0, d.id);
      else if (d.id !== null && overPool) removeLadder(this.layout, d.id);
      this.save();
      this.refresh();
      return;
    }
    const cur = d.id !== null ? this.layout.mods.find((m) => m.id === d.id) : undefined;
    if (d.tab !== null && d.tab !== this.deck && cur) {
      let best: { i: number; j: number; dist: number } | null = null;
      for (let j = -2; j < Math.ceil(g.h / TILE) + 2; j++) {
        for (let i = -2; i < Math.ceil(g.w / TILE) + 2; i++) {
          if (!canPlaceModule(g, this.layout, d.tab, i, j, cur.tw, cur.th, cur.id)) continue;
          const dist = Math.hypot(i - cur.i, j - cur.j);
          if (!best || dist < best.dist) best = { i, j, dist };
        }
      }
      if (best && putModule(g, this.layout, cur.type, d.tab, best.i, best.j, cur.tw, cur.th, cur.id)) {
        this.deck = d.tab;
        this.save();
        this.refresh();
        return;
      }
    }
    if (c.inside && d.valid) {
      if (putModule(g, this.layout, d.type as ModuleId, this.deck, d.i, d.j, d.tw, d.th, d.id, d.lv) && d.stockId !== null) takeFromStock(this.layout, d.stockId);
    } else if (cur && overPool) {
      if (removeModuleToStock(this.layout, cur.id) && this.sel === cur.id) this.sel = null;
    }
    this.save();
    this.refresh();
  }

  private canvasDown(e: PointerEvent): void {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.pinchStart();
        return;
      }
      if (this.gestureLock) return;
    }
    if (this.tool === 'module') {
      const k = this.entAt(this.cellOf(e));
      if (k < 0 || !this.lastPlan) {
        if (this.sel !== null) {
          this.sel = null;
          this.refresh();
        }
        if (this.view.s > 1) this.panning = { x: e.clientX, y: e.clientY, tx: this.view.tx, ty: this.view.ty };
        return;
      }
      const ent = this.lastPlan.ents[k];
      if (ent.kind === 'lad') this.startDrag(e, { type: 'ladder', tw: 1, th: 1, id: (ent.ref as { id: number }).id, ladder: true });
      else this.startDrag(e, { type: ent.type as ModuleId, tw: ent.tw, th: ent.th, id: (ent.ref as { id: number }).id, ladder: false });
    } else {
      this.painting = true;
      this.lastCell = null;
      this.paintAt(e);
    }
  }

  private paintAt(e: PointerEvent): void {
    const c = this.cellOf(e);
    paintCorridor(this.geo, this.layout, this.deck, this.lastCell ?? c, c, this.brush, this.tool === 'corr');
    this.lastCell = { x: c.x, y: c.y };
    this.draw();
  }
}

// ------------------------------------------------------------------ small DOM helpers

function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

function span(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function chip(kind: 'ok' | 'warn', text: string): HTMLDivElement {
  return div(`chip ${kind}`, text);
}

/** A module's picture with its wall on a canvas, `scale` times the size of a cell. */
function spriteCanvas(type: ModuleId | 'ladder', tw: number, th: number, scale: number): HTMLCanvasElement {
  const s = moduleSprite(type, tw, th);
  const c = document.createElement('canvas');
  c.width = s.w;
  c.height = s.h;
  c.getContext('2d')!.putImageData(new ImageData(s.px as unknown as Uint8ClampedArray<ArrayBuffer>, s.w, s.h), 0, 0);
  if (scale === 1) return c;
  const out = document.createElement('canvas');
  out.width = s.w * scale;
  out.height = s.h * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

