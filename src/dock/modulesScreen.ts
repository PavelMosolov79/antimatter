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
  removeModule,
  tileCapacity,
  type DeckGeo,
  type ModuleId,
  type ShipLayout,
} from '../sim/layout';
import { saveLayout } from '../sim/layoutStore';
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
#mods .deck { left: U(30); right: U(35); top: calc(U(9.2) + env(safe-area-inset-top, 0px)); bottom: U(3); display: flex; align-items: center; justify-content: center; }
#mods canvas.view { max-width: 100%; max-height: 100%; image-rendering: pixelated; image-rendering: crisp-edges; touch-action: none; filter: drop-shadow(0 0 U(1.6) rgba(89,230,255,.12)); }
#mods canvas.view.tool-module { cursor: grab; }
#mods .pool { right: U(3.2); width: U(29.6); top: calc(U(9.2) + env(safe-area-inset-top, 0px)); display: flex; flex-direction: column; gap: U(.8); padding: U(1.2); background: rgba(6,9,18,.72); border: 1px solid rgba(89,230,255,.18); }
#mods .head { font-family: 'Unbounded', 'Arial Black', system-ui, sans-serif; font-weight: 700; font-size: U(1.1); letter-spacing: .16em; text-transform: uppercase; color: #f3e8ff; }
#mods .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: U(.6); }
#mods .pc { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: U(.4); padding: U(.6) U(.2); border: 1px solid rgba(89,230,255,.14); background: rgba(10,13,24,.8); cursor: grab; touch-action: none;
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
#mods .tools { left: U(3.2); top: calc(U(11.2) + env(safe-area-inset-top, 0px)); width: U(23); display: flex; flex-direction: column; gap: U(.6); }
#mods .tools button { justify-content: flex-start; }
#mods .actions { right: U(3.2); bottom: calc(U(3) + env(safe-area-inset-bottom, 0px)); width: U(29.6); display: flex; flex-direction: column; gap: U(.8); }
.mfloat { position: fixed; z-index: 70; pointer-events: none; transform: translate(-50%, -50%); filter: drop-shadow(0 4px 10px rgba(0,0,0,.6)); }
.mfloat canvas { image-rendering: pixelated; display: block; }

#mods.portrait { display: flex; flex-direction: column; gap: U(1.8); padding: calc(U(3.5) + env(safe-area-inset-top, 0px)) U(4) calc(U(4) + env(safe-area-inset-bottom, 0px)); }
#mods.portrait[hidden] { display: none; }
#mods.portrait > * { position: static; }
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
#mods.portrait .pool { width: auto; padding: U(2.2); gap: U(1.4); }
#mods.portrait .head { font-size: U(2.3); }
#mods.portrait .cards { display: flex; overflow-x: auto; gap: U(1.3); padding-bottom: U(1); scrollbar-width: thin; }
#mods.portrait .pc { flex: 0 0 U(17); font-size: U(2); padding: U(1.2) U(.3); gap: U(.8); }
#mods.portrait .pc canvas { width: U(10); }
#mods.portrait .pc.lad canvas { width: U(5); margin: U(2.5) 0; }
#mods.portrait .note { display: none; }
#mods.portrait .tools { width: auto; flex-direction: row; flex-wrap: wrap; gap: U(1.2); }
#mods.portrait .tools button { justify-content: center; flex: 1 1 auto; font-size: U(2.2); padding: U(1.5) U(1.4); }
#mods.portrait .card { width: auto; padding: U(2.2) U(2.6); gap: U(1.2); border-left-width: U(.8); flex-direction: row; flex-wrap: wrap; align-items: center; }
#mods.portrait .name { font-size: U(3.4); }
#mods.portrait .stats { grid-template-columns: repeat(3, auto); gap: U(1.2) U(3); }
#mods.portrait .stats small { font-size: U(1.8); }
#mods.portrait .stats strong { font-size: U(3.2); }
#mods.portrait .chip { font-size: U(1.9); padding: U(.6) U(1.3); }
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

  constructor(
    private onDone: (shipId: string) => void,
    parent: HTMLElement,
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
    const deck = div('deck');
    this.els.canvas.className = 'view';
    deck.appendChild(this.els.canvas);
    const pool = div('pool');
    const head = div('head', 'Пул модулей');
    this.els.pool.className = 'cards';
    for (const id of POOL) {
      const c = div('pc');
      c.title = `${MODULE_INFO[id].name} — ${MODULE_INFO[id].desc}`;
      c.append(spriteCanvas(id, 1, 1, 5), span(MODULE_INFO[id].name));
      c.addEventListener('pointerdown', (e) => this.startDrag(e, { type: id, tw: 1, th: 1, id: null, ladder: false }));
      this.els.pool.appendChild(c);
    }
    const lc = div('pc lad');
    lc.title = `Лестница 5×5: ${MODULE_INFO.ladder.desc}`;
    lc.append(spriteCanvas('ladder', 1, 1, 10), span('Лестница'));
    lc.addEventListener('pointerdown', (e) => this.startDrag(e, { type: 'ladder', tw: 1, th: 1, id: null, ladder: true }));
    this.els.pool.appendChild(lc);
    pool.append(head, this.els.pool, div('note', 'Тяните в палубу. Чтобы убрать, верните в пул.'));
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
      saveLayout(this.shipId, null);
      this.layout = yardLayout(this.shipId, this.geo);
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
    this.fillCard(plan);
  }

  private fillCard(plan: ReturnType<typeof planDeck>): void {
    const g = this.geo;
    const { slots, free } = tileCapacity(g, this.layout);
    const missing = decksWithoutLadder(g, this.layout).map((z) => `П${z}–П${z + 1}`);
    let doors = 0;
    const set = new Set(plan.doors);
    for (const i of plan.doors) if (!set.has(i - 1) && !set.has(i - g.w)) doors++;
    const c = this.els.info;
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
    const g = this.geo;
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * g.w),
      y: Math.floor(((e.clientY - r.top) / r.height) * g.h),
      inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom,
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

  private startDrag(e: PointerEvent, spec: { type: ModuleId | 'ladder'; tw: number; th: number; id: number | null; ladder: boolean }): void {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const cur = spec.ladder && spec.id !== null ? this.layout.lads.find((l) => l.id === spec.id) : undefined;
    this.drag = { ...spec, z0: cur ? cur.z0 : this.deck < this.geo.depth - 1 ? this.deck : this.deck - 1, over: false, valid: false, i: 0, j: 0, tab: null };
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
    if (this.painting) {
      this.paintAt(e);
      return;
    }
    const c = this.cellOf(e);
    const d = this.drag;
    if (d) {
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
    if (c.inside && d.valid) putModule(g, this.layout, d.type as ModuleId, this.deck, d.i, d.j, d.tw, d.th, d.id);
    else if (cur && overPool) removeModule(this.layout, cur.id);
    this.save();
    this.refresh();
  }

  private canvasDown(e: PointerEvent): void {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    if (this.tool === 'module') {
      const k = this.entAt(this.cellOf(e));
      if (k < 0 || !this.lastPlan) return;
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

