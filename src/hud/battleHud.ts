import type { Game } from '../game';
import { OUTER_VIEW } from '../render/shipView';
import { ensureRooms, roomsOnDeck, type Room } from '../sim/compartments';
import { isSolid, type Celestial } from '../sim/gravity';
import { moduleEfficiency, type Module } from '../sim/grid';
import { DISPATCH, roomLabel, type DispatchMsg, type Severity } from '../sim/dispatch';
import { MODULE_INFO } from '../sim/layout';
import { WEAPONS } from '../sim/weapons';
import { BATTLE_CSS } from './battleHud.css';
import { placeMarkers, type MarkerKind, type MarkerObj } from './markers';

/**
 * The battle screen: the three status bars, marks on the screen's edge for what lies off screen, one dispatcher message
 * at a time with a log, the control panel in four labelled groups (flight, time, decks, modules), and over a deck the
 * air in its compartments. Two layouts of the same thing: a phone's and a computer's. Designed in the player-screen
 * artifact (cinema/hud-artifact.html).
 */

const ICONS: Record<string, string> = {
  foe: '<path d="M12 3l8 5v8l-8 5-8-5V8z"/><path d="M8.5 10.5L12 8l3.5 2.5M9 14l3-2 3 2"/>',
  big: '<circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="10" ry="3.4" transform="rotate(-18 12 12)"/>',
  hole: '<circle cx="12" cy="12" r="3.4"/><path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5"/>',
  wreck: '<path d="M4 15l5-8 3 3 3-6 5 11z"/><path d="M4 19h16"/>',
  gate: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  rocks: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="8" r="2"/><circle cx="14" cy="16" r="3.4"/><circle cx="6" cy="17" r="1.6"/>',
  comet: '<circle cx="17" cy="7" r="3"/><path d="M14.6 9.4L4 20M16 11L8 21M12.6 7L3 14"/>',
  hazard: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  module: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9l6 6M15 9l-6 6"/>',
  killed: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/><path d="M3 3l4 4M21 3l-4 4"/>',
  hurt: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/><path d="M17 3v5M14.5 5.5h5"/>',
  fire: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .2 1.6 1 2.4 2 2.4C11 9 10.6 6 12 3z"/>',
  breach: '<path d="M4 8l5 2-2 4 5 1-1 5"/><path d="M14 4h6v6"/><path d="M20 4l-6 6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.6 8-8 9-4.4-1-8-4-8-9V6z"/><path d="M9 9l6 6"/>',
  shieldp: '<path d="M12 3l8 3v6c0 5-3.6 8-8 9-4.4-1-8-4-8-9V6z"/>',
  hull: '<path d="M12 2.5l6.5 5.5v8.5L15.5 21h-7L5.5 16.5V8z"/><path d="M12 8v8M9 12h6"/>',
  ok: '<path d="M4 12.5l5 5L20 6.5"/>',
  energy: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  reactor: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  nav: '<circle cx="12" cy="12" r="9"/><path d="M12 6l4 11-4-2.4L8 17z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  slow: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<circle cx="12" cy="12" r="6"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1.6"/>',
  untarget: '<circle cx="12" cy="12" r="6"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
  follow: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2.4"/>',
  gun: '<path d="M3 14h12l3-3h3v4h-3l-3 3H9l-2 3H5v-3"/><path d="M8 14V10h5"/>',
  engine: '<path d="M7 4h10l-2 8H9z"/><path d="M9 12l-1 4M15 12l1 4M12 12v8"/>',
  work: '<path d="M14 4a4 4 0 0 0-3.5 5.5L4 16l4 4 6.5-6.5A4 4 0 0 0 20 10l-3 1-2-2z"/>',
  med: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  pod: '<path d="M12 3c4 2 6 6 6 10l-3 4H9l-3-4c0-4 2-8 6-10z"/><circle cx="12" cy="11" r="2"/><path d="M9 17l-1 4M15 17l1 4"/>',
  crew: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/>',
  store: '<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v9"/>',
  menu: '<path d="M5 7h14M5 12h14M5 17h9"/>',
};
const svg = (n: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] ?? ''}</svg>`;

/** The modules the panel lists, in this order, with how they are named, grouped and drawn. */
interface ChipDef {
  id: string;
  name: string;
  icon: string;
  of: (m: Module) => boolean;
}
const poolIs = (id: string) => (m: Module): boolean => m.pool === id;
const CHIPS: ChipDef[] = [
  { id: 'guns', name: 'Орудия', icon: 'gun', of: (m) => m.kind === 'turret' },
  { id: 'shield', name: 'Щит', icon: 'shieldp', of: (m) => m.kind === 'shield' },
  { id: 'engine', name: 'Двигатели', icon: 'engine', of: (m) => m.kind === 'engine' },
  { id: 'nozzles', name: 'Сопла', icon: 'engine', of: (m) => m.kind === 'thruster' || m.kind === 'brake' || m.kind === 'turn' },
  { id: 'reactor', name: 'Реактор', icon: 'reactor', of: (m) => m.kind === 'reactor' },
  { id: 'bridge', name: 'Мостик', icon: 'nav', of: (m) => m.kind === 'bridge' },
  { id: 'gun', name: 'Пост орудий', icon: 'gun', of: poolIs('gun') },
  { id: 'eng', name: 'Инж. пост', icon: 'engine', of: poolIs('eng') },
  { id: 'rcs', name: 'Манёвр. пост', icon: 'engine', of: poolIs('rcs') },
  { id: 'helm', name: 'Рез. пост', icon: 'nav', of: poolIs('helm') },
  { id: 'work', name: 'Мастерская', icon: 'work', of: poolIs('work') },
  { id: 'med', name: 'Медотсек', icon: 'med', of: poolIs('med') },
  { id: 'crew', name: 'Кубрик', icon: 'crew', of: poolIs('crew') },
  { id: 'store', name: 'Склад', icon: 'store', of: poolIs('store') },
  { id: 'pod', name: 'Капсулы', icon: 'pod', of: poolIs('pod') },
];
void MODULE_INFO;

const EXTRA_CSS = `
#bh .weap { position: absolute; left: calc(2.4 * var(--u)); right: calc(2.4 * var(--u)); display: flex; flex-direction: column; gap: calc(.8 * var(--u)); padding: calc(1.6 * var(--u)); background: var(--panel); border: 1px solid var(--cyan); border-radius: calc(2.2 * var(--u)); z-index: 4; pointer-events: auto; }
#bh.desk .weap { left: 50%; right: auto; transform: translateX(-50%); width: calc(120 * var(--u)); }
#bh .weap[hidden] { display: none; }
#bh .weap .wh { display: flex; justify-content: space-between; align-items: center; font: 700 calc(2.1 * var(--u))/1 var(--mono); letter-spacing: .16em; color: var(--cyan); text-transform: uppercase; }
#bh .weap .wh button { background: transparent; border: 1px solid var(--line); color: var(--dim); border-radius: calc(1.2 * var(--u)); font: 600 calc(2 * var(--u))/1 var(--mono); padding: calc(1 * var(--u)) calc(1.8 * var(--u)); cursor: pointer; }
#bh .wr { display: grid; grid-template-columns: calc(16 * var(--u)) 1fr calc(11 * var(--u)); gap: calc(1.4 * var(--u)); align-items: center; }
#bh .wr button { background: rgba(12, 18, 34, .9); border: 1px solid var(--line); color: var(--fg); border-radius: calc(1.3 * var(--u)); font: 700 calc(2.3 * var(--u))/1 var(--mono); padding: calc(1.1 * var(--u)) calc(1 * var(--u)); cursor: pointer; }
#bh .wr button.sel { border-color: var(--amber); color: var(--amber); background: rgba(255, 210, 74, .1); }
#bh .wr button.tg.on { border-color: var(--green); color: var(--green); background: rgba(99, 224, 122, .1); }
#bh .wr .st { font: 400 calc(2.2 * var(--u))/1.2 var(--mono); color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#bh .wr .st.off { color: var(--red); }
#bh .look { position: absolute; left: 50%; transform: translateX(-50%); top: calc(11 * var(--u)); padding: calc(1.2 * var(--u)) calc(2.8 * var(--u)); background: var(--panel); border: 1px solid var(--amber); border-radius: 99px; color: var(--amber); font: 700 calc(2.4 * var(--u))/1 var(--mono); letter-spacing: .06em; white-space: nowrap; display: none; }
#bh.desk .look { top: calc(3 * var(--u)); }
#bh .look.on { display: block; }
#bh .devbtn { position: absolute; background: var(--panel); border: 1px solid var(--line); color: var(--dim); border-radius: calc(1.6 * var(--u)); padding: calc(1.2 * var(--u)) calc(2.2 * var(--u)); font: 600 calc(2 * var(--u))/1 var(--mono); cursor: pointer; display: none; }
#bh .devbtn.on { display: block; }
#bh.mob .devbtn { top: calc(11 * var(--u)); right: calc(3 * var(--u)); }
#bh.desk .devbtn { left: calc(3 * var(--u)); bottom: calc(3 * var(--u)); }
#bh .bar { cursor: default; }
#bh .bar.energy { cursor: pointer; }
#bh .bar span em.pri { font-style: normal; opacity: .75; margin-right: calc(1 * var(--u)); font-size: .8em; letter-spacing: .06em; }
#bh .deck:disabled { opacity: .35; cursor: default; }
#bh .mod.tog.open { border-color: var(--cyan); }
#bh.desk #bh-deckNote { display: none; }
#overlay { z-index: 6; }
#bh .pill { position: absolute; }
`;

interface MarkerEl {
  root: HTMLElement;
  arrow: HTMLElement;
  dist: HTMLElement;
  kind: MarkerKind;
}

const SEV_CLASS: Record<Severity, string> = { crit: 'sev-crit', warn: 'sev-warn', good: 'sev-good', info: 'sev-info' };
const SEV_RANK: Record<Severity, number> = { info: 0, good: 1, warn: 2, crit: 3 };
const SHOW_MS: Record<Severity, number> = { crit: 8000, warn: 6000, good: 4500, info: 4500 };
/** A message stays this long at least before another one may take its place. */
const MIN_SHOW_MS = 1700;
/** Things farther than this (cells, from their surface) get no mark; the nearest ones are what the player needs. Enemies always do. */
const MARK_RANGE = 4200;

const fmtTime = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class BattleHud {
  private readonly game: Game;
  private readonly root = document.createElement('div');
  private readonly q = <T extends HTMLElement>(sel: string): T => this.root.querySelector(sel) as T;
  private mobile = true;
  private u = 4;
  private markerEls = new Map<string, MarkerEl>();
  private pillEls = new Map<number, HTMLElement>();
  private deckBtns: HTMLButtonElement[] = [];
  private deckCount = -1;
  private chipEls = new Map<string, HTMLElement>();
  private chipKey = '';
  private weapOpen = false;
  private weapKey = '';
  private weapRows: Array<{ id: number; name: HTMLButtonElement; st: HTMLElement; tg: HTMLButtonElement }> = [];
  private roomsSig = '';
  private slow = 0;
  private offY = 0;
  // the dispatcher card
  private seenId = 0;
  private seenVersion = -1;
  private queue: DispatchMsg[] = [];
  private shown: { msg: DispatchMsg; node: HTMLElement; since: number; until: number; n: number } | null = null;
  private logOpen = false;
  private logFilter: Severity | 'all' = 'all';
  private lastDispatcher: unknown = null;
  private flashUntil = 0;

  constructor(game: Game, parent: HTMLElement) {
    this.game = game;
    const style = document.createElement('style');
    style.textContent = BATTLE_CSS + EXTRA_CSS;
    document.head.appendChild(style);
    this.root.id = 'bh';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div id="bh-markers"></div>
      <div id="bh-pills"></div>
      <div class="left" id="bh-left">
        <div class="bars">
          <div class="bar hull" id="bh-hull" title="Корпус" role="img" aria-label="Корпус"><i></i><span><b>${svg('hull')}</b><em>—</em></span></div>
          <div class="bar shield" id="bh-shield" title="Щит" role="img" aria-label="Щит"><i></i><span><b>${svg('shieldp')}</b><em>—</em></span></div>
          <div class="bar energy" id="bh-energy" title="Энергия: нажмите, чтобы отдать приоритет щиту или оружию" role="button" aria-label="Энергия"><i></i><span><b>${svg('energy')}</b><em>—</em></span></div>
        </div>
        <div class="rooms" id="bh-rooms"></div>
      </div>
      <div class="disp" id="bh-disp">
        <button class="disp-head" id="bh-dispHead" type="button" aria-label="Открыть журнал диспетчера"><span class="dot"></span>ДИСПЕТЧЕР <em id="bh-dispN">0</em></button>
        <div id="bh-feed" style="display:flex;flex-direction:column;gap:calc(1.4 * var(--u))" aria-live="polite"></div>
      </div>
      <div class="log" id="bh-log" hidden>
        <h3>Журнал диспетчера <button type="button" id="bh-logClose">Закрыть</button></h3>
        <div class="log-chips" id="bh-logChips"></div>
        <div class="log-list" id="bh-logList"></div>
      </div>
      <div class="look" id="bh-look"></div>
      <div class="weap" id="bh-weap" hidden></div>
      <div class="dock" id="bh-dock">
        <div class="grp g-fly"><div class="gh">Полёт</div><div class="grow" id="bh-gFly"></div></div>
        <div class="grp g-time"><div class="gh">Время</div><div class="grow" id="bh-gTime"></div></div>
        <div class="grp g-deck"><div class="gh">Палубы <b id="bh-deckNote"></b></div><div class="grow" id="bh-gDeck"></div></div>
        <div class="grp g-mod"><div class="gh">Модули</div><div class="mods" id="bh-gMod"></div></div>
      </div>
      <button class="devbtn" id="bh-dev" type="button">Панели разработчика</button>`;
    parent.appendChild(this.root);
    this.buildControls();
    this.buildLog();
    this.q('#bh-dispHead').addEventListener('click', () => this.toggleLog());
    this.q('#bh-energy').addEventListener('click', () => {
      const sys = this.game.world.player?.sys;
      if (sys) this.game.setPriority(sys.priority === 'shield' ? 'weapons' : 'shield');
    });
    this.q('#bh-dev').addEventListener('click', () => (this.game.hudNew = false));
    window.addEventListener('resize', () => this.measure());
  }

  // ------------------------------------------------------------------ building

  private button(parent: HTMLElement, icon: string, label: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.innerHTML = `${svg(icon)}<span>${label}</span>`;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => onClick(b));
    parent.appendChild(b);
    return b;
  }

  private flags: Array<{ el: HTMLElement; get: () => boolean }> = [];

  private buildControls(): void {
    const g = this.game;
    const on = (el: HTMLElement, get: () => boolean) => this.flags.push({ el, get });
    const fly = this.q('#bh-gFly');
    on(this.button(fly, 'nav', 'Автопилот', () => (g.world.autopilot = !g.world.autopilot)), () => g.world.autopilot);
    on(this.button(fly, 'lock', 'Нос→цель', () => g.setLockFace(!g.world.lockFace)), () => g.world.lockFace);
    this.button(fly, 'untarget', 'Сброс цели', (b) => {
      g.clearTargets();
      b.classList.add('act');
      setTimeout(() => b.classList.remove('act'), 250);
    });
    on(this.button(fly, 'follow', 'Следить', () => (g.scene.follow = !g.scene.follow)), () => g.scene.follow);
    const time = this.q('#bh-gTime');
    on(this.button(time, 'pause', 'Пауза', () => (g.paused = !g.paused)), () => g.paused);
    on(this.button(time, 'slow', 'Замедл.', () => (g.slowMo = !g.slowMo)), () => g.slowMo);
  }

  private buildDecks(depth: number): void {
    const box = this.q('#bh-gDeck');
    box.replaceChildren();
    this.deckBtns = [];
    const make = (label: string, aria: string, view: number): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'deck';
      b.innerHTML = `${label}<span class="al"></span>`;
      b.setAttribute('aria-label', aria);
      b.dataset.view = String(view);
      b.addEventListener('click', () => {
        this.game.scene.layerView = view;
        this.roomsSig = '';
        this.placeRooms();
      });
      box.appendChild(b);
      this.deckBtns.push(b);
    };
    make('Вне', 'Вид снаружи', OUTER_VIEW);
    for (let z = 1; z < depth; z++) make(`П${z}`, `Палуба ${z}`, z);
    this.deckCount = depth;
  }

  private buildLog(): void {
    const chips = this.q('#bh-logChips');
    const defs: Array<[Severity | 'all', string]> = [['all', 'Все'], ['crit', 'Критичные'], ['warn', 'Внимание'], ['good', 'Успех'], ['info', 'Сведения']];
    for (const [id, label] of defs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (id === 'all' ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        this.logFilter = id;
        for (const c of Array.from(chips.children)) c.classList.remove('on');
        b.classList.add('on');
        this.paintLog();
      });
      chips.appendChild(b);
    }
    this.q('#bh-logClose').addEventListener('click', () => this.toggleLog(false));
  }

  private toggleLog(open = !this.logOpen): void {
    this.logOpen = open;
    this.q('#bh-log').hidden = !open;
    if (open) this.paintLog();
  }

  // ------------------------------------------------------------------ layout

  /** Phone or computer, and the size of one unit in pixels. */
  private measure(): void {
    const mobile = window.innerWidth < 720;
    if (mobile !== this.mobile || !this.root.classList.contains(mobile ? 'mob' : 'desk')) {
      this.mobile = mobile;
      this.root.classList.toggle('mob', mobile);
      this.root.classList.toggle('desk', !mobile);
      this.placeRooms();
    }
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:calc(100 * var(--u));height:0';
    this.root.appendChild(probe);
    this.u = probe.offsetWidth / 100 || 4;
    probe.remove();
  }

  /** On a computer the compartments panel sits in the left column; on a phone it is a strip over the control panel. */
  private placeRooms(): void {
    const rooms = this.q<HTMLElement>('#bh-rooms');
    const show = this.game.scene.layerView !== OUTER_VIEW;
    rooms.classList.toggle('show', show);
    if (this.mobile) {
      if (rooms.parentElement !== this.root) this.root.appendChild(rooms);
    } else if (rooms.parentElement !== this.q('#bh-left')) this.q('#bh-left').appendChild(rooms);
  }

  // ------------------------------------------------------------------ the frame

  update(now: number): void {
    const g = this.game;
    const active = g.screen === 'game' && g.useNewHud && (g.mode === 'sandbox' || g.runPhase === 'battle');
    if (this.root.hidden === active) this.root.hidden = !active;
    if (!active) {
      g.scene.viewOffY = 0;
      return;
    }
    if (this.u <= 0 || !this.root.classList.contains('mob') && !this.root.classList.contains('desk')) this.measure();
    if (this.lastDispatcher !== g.dispatcher) {
      // a new battle: forget what was on the card
      this.lastDispatcher = g.dispatcher;
      this.seenId = 0;
      this.seenVersion = -1;
      this.queue = [];
      this.hideCard(true);
      this.logOpen = false;
      this.q('#bh-log').hidden = true;
    }
    this.q('#bh-dev').classList.toggle('on', g.mode === 'sandbox');
    for (const f of this.flags) f.el.classList.toggle('on', f.get());
    const p = g.world.player;
    this.paintBars();
    this.paintDispatcher(now);
    this.paintInspect();
    const depth = p?.grid.depth ?? 0;
    if (depth !== this.deckCount) this.buildDecks(depth);
    if (g.scene.layerView !== OUTER_VIEW && g.scene.layerView >= depth) g.scene.layerView = OUTER_VIEW;
    for (const b of this.deckBtns) b.classList.toggle('on', Number(b.dataset.view) === g.scene.layerView);
    this.placeRooms();
    this.layoutView();
    this.paintMarkers();
    this.paintPills();
    if (now - this.slow >= 150) {
      this.slow = now;
      this.paintDeckAlerts();
      this.paintModules();
      this.paintRooms();
      this.paintWeapons();
    }
  }

  /** Moves the camera's middle up so the ship sits in the free part of the screen, clear of the bars and the panels. */
  private layoutView(): void {
    const sh = this.game.scene.app.screen.height;
    const bars = this.q('#bh-left .bars').getBoundingClientRect();
    const dock = this.q('#bh-dock').getBoundingClientRect();
    let bottom = dock.top;
    const rooms = this.q<HTMLElement>('#bh-rooms');
    if (this.mobile && rooms.classList.contains('show')) bottom = Math.min(bottom, rooms.getBoundingClientRect().top);
    const top = this.mobile ? bars.bottom + 12 * this.u : 6 * this.u;
    const target = (top + bottom) / 2 - sh / 2;
    this.offY += (target - this.offY) * 0.12;
    this.game.scene.viewOffY = this.offY;
  }

  // ------------------------------------------------------------------ bars

  private paintBars(): void {
    const sys = this.game.world.player?.sys;
    const p = this.game.world.player;
    const set = (id: string, frac: number, text: string, low: boolean): void => {
      const el = this.q<HTMLElement>(id);
      (el.querySelector('i') as HTMLElement).style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      el.querySelector('em')!.innerHTML = text;
      el.classList.toggle('low', low);
    };
    if (!p || !sys) {
      set('#bh-hull', 0, '—', false);
      set('#bh-shield', 0, '—', false);
      set('#bh-energy', 0, '—', false);
      return;
    }
    const hull = p.grid.cells / Math.max(1, sys.cellsMax);
    set('#bh-hull', hull, `${(hull * 100).toFixed(0)}%`, hull < 0.4);
    set('#bh-shield', sys.shieldMax > 0 ? sys.shield / sys.shieldMax : 0, sys.shieldMax > 0 ? `${sys.shieldDown ? '↓ ' : ''}${sys.shield.toFixed(0)}` : '—', sys.shieldMax > 0 && sys.shieldDown);
    set('#bh-energy', sys.energyMax > 0 ? sys.energy / sys.energyMax : 0, `<em class="pri">${sys.priority === 'shield' ? 'щит' : 'оруж.'}</em>${sys.energy.toFixed(0)}`, false);
  }

  // ------------------------------------------------------------------ marks on the edge

  private kindOf(c: Celestial): MarkerKind | null {
    switch (c.kind) {
      case 'planet':
      case 'moon':
      case 'star':
        return 'big';
      case 'blackhole':
        return 'hole';
      case 'pulsar':
      case 'storm':
        return 'hazard';
      case 'comet':
        return 'comet';
      case 'gate':
        return 'gate';
      case 'asteroids':
        return 'rocks';
      case 'wreck':
        return this.game.world.wreckLive(c) ? 'wreck' : null;
    }
  }

  private paintMarkers(): void {
    const g = this.game;
    const sc = g.scene;
    const p = g.world.player;
    const W = sc.app.screen.width;
    const H = sc.app.screen.height;
    const objs: MarkerObj[] = [];
    if (p) {
      for (const b of g.world.bodies) {
        if (b.removed || b.kind !== 'ship' || !b.sys || b.sys.team !== 1 || b.sys.dead) continue;
        const s = sc.worldToScreen(b.x, b.y);
        objs.push({ id: `s${b.id}`, kind: 'foe', x: b.x, y: b.y, sx: s.x, sy: s.y, dist: Math.hypot(b.x - p.x, b.y - p.y) });
      }
      g.world.celestials.forEach((c, i) => {
        const kind = this.kindOf(c);
        if (!kind) return;
        if (Math.hypot(c.x - p.x, c.y - p.y) - c.radius > MARK_RANGE) return;
        const s = sc.worldToScreen(c.x, c.y);
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        const solid = isSolid(c) || c.kind === 'blackhole' || c.kind === 'asteroids';
        objs.push({ id: `c${i}${c.kind}${Math.round(c.x)}`, kind, x: c.x, y: c.y, sx: s.x, sy: s.y, dist: solid ? Math.max(0, d - c.radius) : d });
      });
    }
    const u = this.u;
    const pad = 11 * u;
    const left = this.q('#bh-left').getBoundingClientRect();
    const dock = this.q('#bh-dock').getBoundingClientRect();
    let bottom = dock.top - 0.8 * pad;
    const rooms = this.q<HTMLElement>('#bh-rooms');
    if (this.mobile && rooms.classList.contains('show')) bottom = Math.min(bottom, rooms.getBoundingClientRect().top - 0.5 * pad);
    const frame = { l: this.mobile ? pad : left.right + 0.4 * pad + 2 * u, t: (this.mobile ? 12 * u : 3 * u) + 0.9 * pad, r: W - pad, b: bottom };
    const placed = p ? placeMarkers(objs, W, H, frame, 13 * u, 19 * u) : [];
    const keep = new Set<string>();
    const layer = this.q('#bh-markers');
    for (const m of placed) {
      keep.add(m.obj.id);
      let el = this.markerEls.get(m.obj.id);
      if (!el) {
        el = this.makeMarker(m.obj);
        layer.appendChild(el.root);
        this.markerEls.set(m.obj.id, el);
      }
      const fade = Math.max(0.4, Math.min(1, 1.15 - m.obj.dist / 2600));
      el.root.style.opacity = String(fade);
      el.root.style.transform = `translate(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px)`;
      el.arrow.style.transform = `rotate(${((m.ang * 180) / Math.PI).toFixed(1)}deg)`;
      el.dist.textContent = `${Math.round(m.obj.dist)} кл`;
      el.dist.style.top = `${6 * u}px`;
    }
    for (const [id, el] of this.markerEls) {
      if (keep.has(id)) continue;
      el.root.remove();
      this.markerEls.delete(id);
    }
  }

  private makeMarker(o: MarkerObj): MarkerEl {
    const root = document.createElement('div');
    root.className = `mk ${o.kind}`;
    root.innerHTML = `<span class="arr"><i></i></span><span class="core" role="button" tabindex="-1" aria-label="Взять курс">${svg(o.kind)}</span><span class="d"></span>`;
    root.querySelector('.core')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.tool = 'fly';
      this.game.pointerAction(o.x, o.y);
    });
    return { root, arrow: root.querySelector('.arr') as HTMLElement, dist: root.querySelector('.d') as HTMLElement, kind: o.kind };
  }

  // ------------------------------------------------------------------ the dispatcher

  private paintDispatcher(now: number): void {
    const d = this.game.dispatcher;
    this.q('#bh-dispN').textContent = String(d.log.length);
    if (d.version !== this.seenVersion) {
      this.seenVersion = d.version;
      for (const m of d.log) {
        if (m.id > this.seenId) {
          this.seenId = m.id;
          this.queue.push(m);
        }
      }
      // the same message said again: keep it on the card a while longer
      if (this.shown) {
        const m = this.shown.msg;
        if (m.n !== this.shown.n) {
          this.shown.n = m.n;
          this.shown.until = now + SHOW_MS[m.sev];
          this.paintCard(this.shown.node, m);
        }
      }
      if (this.logOpen) this.paintLog();
      // too many waiting: drop the least important of the oldest
      while (this.queue.length > 4) {
        let k = 0;
        for (let i = 1; i < this.queue.length - 1; i++) if (SEV_RANK[this.queue[i].sev] < SEV_RANK[this.queue[k].sev]) k = i;
        this.queue.splice(k, 1);
      }
    }
    if (this.shown && now > this.shown.until) this.hideCard(false);
    if (this.queue.length > 0) {
      const next = this.queue[0];
      if (!this.shown) this.showCard(this.queue.shift()!, now);
      else if (now - this.shown.since > MIN_SHOW_MS || SEV_RANK[next.sev] > SEV_RANK[this.shown.msg.sev] + 1) this.showCard(this.queue.shift()!, now);
    }
    if (now < this.flashUntil) this.root.classList.add('hit');
    else this.root.classList.remove('hit');
  }

  private paintCard(node: HTMLElement, m: DispatchMsg): void {
    node.querySelector('.t')!.innerHTML = this.esc(m.title) + (m.n > 1 ? ` <span class="x">×${m.n}</span>` : '');
    node.querySelector('.s')!.textContent = m.sub;
    node.querySelector('.tm')!.textContent = fmtTime(m.at);
  }

  private esc(s: string): string {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  }

  private makeCard(m: DispatchMsg): HTMLElement {
    const n = document.createElement('div');
    n.className = `msg ${SEV_CLASS[m.sev]}${m.sev === 'crit' ? ' crit' : ''}`;
    n.innerHTML = `<span class="ic">${svg(m.icon)}</span><div><div class="t"></div><div class="s"></div></div><span class="tm"></span>`;
    this.paintCard(n, m);
    return n;
  }

  private showCard(m: DispatchMsg, now: number): void {
    this.hideCard(true);
    const node = this.makeCard(m);
    this.q('#bh-feed').appendChild(node);
    this.shown = { msg: m, node, since: now, until: now + SHOW_MS[m.sev], n: m.n };
    if (m.sev === 'crit') this.flashUntil = now + 350;
  }

  private hideCard(instant: boolean): void {
    if (!this.shown) return;
    const node = this.shown.node;
    this.shown = null;
    if (instant) node.remove();
    else {
      node.classList.add('out');
      setTimeout(() => node.remove(), 650);
    }
  }

  private paintLog(): void {
    const list = this.q('#bh-logList');
    list.replaceChildren();
    const msgs = this.game.dispatcher.log.slice().reverse().filter((m) => this.logFilter === 'all' || m.sev === this.logFilter);
    for (const m of msgs) {
      const n = this.makeCard(m);
      n.style.animation = 'none';
      list.appendChild(n);
    }
    if (msgs.length === 0) {
      const e = document.createElement('div');
      e.style.cssText = 'color:var(--dim);font-size:13px;padding:8px';
      e.textContent = 'Пока ничего.';
      list.appendChild(e);
    }
  }

  private paintInspect(): void {
    const look = this.game.world.inspecting;
    const el = this.q('#bh-look');
    el.classList.toggle('on', !!look);
    if (look) el.textContent = `Осмотр остова ${Math.round(look.frac * 100)}%`;
  }

  // ------------------------------------------------------------------ decks and compartments

  private deckRooms(z: number): Room[] {
    const p = this.game.world.player;
    return p?.sys ? roomsOnDeck(ensureRooms(p), z) : [];
  }

  private paintDeckAlerts(): void {
    let bad = '';
    for (const b of this.deckBtns) {
      const z = Number(b.dataset.view);
      b.classList.remove('crit', 'warn');
      if (z < 1) continue;
      let worst = 1;
      let fire = 0;
      for (const r of this.deckRooms(z)) {
        worst = Math.min(worst, r.pressure);
        fire = Math.max(fire, r.fire);
      }
      if (worst < 0.5) b.classList.add('crit');
      else if (worst < 0.92 || fire > 0.05) b.classList.add('warn');
      if (worst < 0.92 || fire > 0.05) bad += (bad ? ', ' : '') + b.textContent;
    }
    this.q('#bh-deckNote').textContent = bad ? `· тревога: ${bad}` : '';
  }

  private problemRooms(z: number): Room[] {
    return this.deckRooms(z)
      .filter((r) => r.pressure < 0.96 || r.fire > 0.02 || (r.holes > 0 && !r.patched))
      .sort((a, b) => a.pressure - b.pressure);
  }

  private paintRooms(): void {
    const g = this.game;
    const z = g.scene.layerView;
    const el = this.q<HTMLElement>('#bh-rooms');
    const p = g.world.player;
    if (z === OUTER_VIEW || !p?.sys) return;
    const bad = this.problemRooms(z);
    const lim = this.mobile ? 2 : 6;
    const shown = bad.slice(0, lim);
    const sig = `${z}|${this.mobile}|${shown.map((r) => `${r.cells[0]}:${Math.round(r.pressure * 100)}:${r.fire > 0.02 ? 1 : 0}:${r.holes > 0 && !r.patched ? 1 : 0}`).join(',')}|${bad.length}|${this.deckRooms(z).length}`;
    if (sig === this.roomsSig) return;
    this.roomsSig = sig;
    const total = this.deckRooms(z).length;
    let h = `<h4>ОТСЕКИ · ПАЛУБА ${z}<em>${bad.length ? `${bad.length} требуют внимания` : 'всё в норме'}</em></h4>`;
    shown.forEach((r, i) => {
      const c = r.pressure < 0.3 ? 'var(--red)' : r.pressure < 0.75 ? 'var(--amber)' : 'var(--green)';
      const breach = r.holes > 0 && !r.patched;
      h += `<div class="rrow" data-i="${i}" style="--c:${c}"><span class="nm">${breach ? `<span class="bi">${svg('breach')}</span>` : ''}${r.fire > 0.02 ? `<span class="fi">${svg('fire')}</span>` : ''}${this.esc(roomLabel(p.grid, r))}</span><span class="pb"><i style="width:${Math.round(r.pressure * 100)}%"></i></span><span class="pc">${Math.round(r.pressure * 100)}%</span></div>`;
    });
    if (bad.length > lim) h += `<div class="rnote">Ещё в списке: ${bad.length - lim}</div>`;
    if (!bad.length) h += `<div class="rnote">Воздух в норме во всех ${total} отсеках.</div>`;
    if (!this.mobile) h += `<div class="rleg"><span><i style="background:#1d4766"></i>норма</span><span><i style="background:#9a7a1f"></i>утечка</span><span><i style="background:#a33a33"></i>тревога</span><span><i style="background:#07080c;border:1px solid #444"></i>вакуум</span></div>`;
    el.innerHTML = h;
    el.querySelectorAll<HTMLElement>('.rrow').forEach((row) => {
      row.addEventListener('click', () => {
        const room = shown[Number(row.dataset.i)];
        const c = room && this.roomCentre(room);
        if (c) {
          g.scene.follow = false;
          g.scene.camX = c.x;
          g.scene.camY = c.y;
        }
      });
    });
    if (this.mobile) {
      const dock = this.q('#bh-dock').getBoundingClientRect();
      el.style.bottom = `${window.innerHeight - dock.top + 0.4 * this.u}px`;
    }
  }

  private roomCentre(r: Room): { x: number; y: number } | null {
    const p = this.game.world.player;
    if (!p || r.cells.length === 0) return null;
    const grid = p.grid;
    let sx = 0;
    let sy = 0;
    for (const i of r.cells) {
      sx += grid.xOf(i) + 0.5;
      sy += grid.yOf(i) + 0.5;
    }
    const w = p.localToWorld(sx / r.cells.length, sy / r.cells.length, { x: 0, y: 0 });
    return { x: w.x, y: w.y };
  }

  /** Over a deck, a label on every compartment that has something wrong: its air and whether it burns. */
  private paintPills(): void {
    const g = this.game;
    const sc = g.scene;
    const z = sc.layerView;
    const layer = this.q('#bh-pills');
    const keep = new Set<number>();
    const px = sc.scale;
    if (z !== OUTER_VIEW && g.world.player?.sys && px >= 2.4) {
      for (const r of this.problemRooms(z)) {
        const c = this.roomCentre(r);
        if (!c) continue;
        const s = sc.worldToScreen(c.x, c.y);
        const key = r.cells[0];
        keep.add(key);
        let el = this.pillEls.get(key);
        if (!el) {
          el = document.createElement('div');
          el.className = 'pill';
          el.style.display = 'block';
          layer.appendChild(el);
          this.pillEls.set(key, el);
        }
        const col = r.pressure < 0.3 ? '#ff6a5a' : r.pressure < 0.75 ? '#ffd24a' : '#63e07a';
        el.style.setProperty('--c', col);
        el.style.transform = `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px) translate(-50%,-50%)`;
        el.innerHTML = `${r.fire > 0.02 ? svg('fire') : ''}${Math.round(r.pressure * 100)}%`;
      }
    }
    for (const [key, el] of this.pillEls) {
      if (keep.has(key)) continue;
      el.remove();
      this.pillEls.delete(key);
    }
  }

  // ------------------------------------------------------------------ modules and weapons

  private paintModules(): void {
    const p = this.game.world.player;
    const box = this.q('#bh-gMod');
    const mods = p ? p.grid.modules : [];
    const groups = CHIPS.map((def) => ({ def, list: mods.filter(def.of) })).filter((x) => x.list.length > 0);
    const key = groups.map((x) => x.def.id).join(',');
    if (key !== this.chipKey) {
      this.chipKey = key;
      box.replaceChildren();
      this.chipEls.clear();
      for (const { def } of groups) {
        const tog = def.id === 'guns';
        const b = document.createElement(tog ? 'button' : 'div');
        if (tog) (b as HTMLButtonElement).type = 'button';
        b.className = 'mod' + (tog ? ' tog' : '');
        b.innerHTML = `<div class="mt">${svg(def.icon)}<span>${def.name}</span></div><div class="mn"><span class="a"></span><span class="b"></span></div><div class="mb"><i></i></div>`;
        if (tog) b.addEventListener('click', () => this.toggleWeaponPanel());
        box.appendChild(b);
        this.chipEls.set(def.id, b);
      }
    }
    for (const { def, list } of groups) {
      const el = this.chipEls.get(def.id);
      if (!el) continue;
      const alive = list.filter((m) => m.alive > 0 && m.coreAlive).length;
      const total = list.length;
      let hp = 0;
      let all = 0;
      for (const m of list) {
        hp += m.coreAlive ? m.alive : 0;
        all += m.total;
      }
      const frac = all > 0 ? hp / all : 0;
      el.classList.toggle('dead', alive === 0);
      el.classList.toggle('dmg', alive > 0 && (alive < total || frac < 0.9));
      el.querySelector('.a')!.textContent = `${alive}/${total}`;
      if (def.id === 'guns') {
        const rows = this.game.weaponRows();
        const on = rows.filter((r) => r.weapon.enabled && moduleEfficiency(r.module) > 0).length;
        el.classList.toggle('off', rows.length > 0 && on === 0);
        el.classList.toggle('open', this.weapOpen);
        el.querySelector('.b')!.textContent = on === 0 ? 'ВЫКЛ' : `${on} ВКЛ`;
      } else el.querySelector('.b')!.textContent = `${Math.round(frac * 100)}%`;
      (el.querySelector('.mb i') as HTMLElement).style.width = `${Math.round((alive / Math.max(1, total)) * frac * 100)}%`;
    }
  }

  private toggleWeaponPanel(): void {
    this.weapOpen = !this.weapOpen;
    this.q<HTMLElement>('#bh-weap').hidden = !this.weapOpen;
    this.weapKey = '';
    this.paintWeapons();
  }

  private paintWeapons(): void {
    const box = this.q<HTMLElement>('#bh-weap');
    if (!this.weapOpen) return;
    const g = this.game;
    const rows = g.weaponRows();
    const key = rows.map((r) => r.weapon.id).join(',');
    if (key !== this.weapKey) {
      this.weapKey = key;
      box.replaceChildren();
      this.weapRows = [];
      const head = document.createElement('div');
      head.className = 'wh';
      head.innerHTML = '<span>Орудия</span>';
      const all = document.createElement('div');
      for (const [label, v] of [['Вкл все', true], ['Выкл все', false]] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.marginLeft = '6px';
        b.addEventListener('click', () => {
          for (const r of g.weaponRows()) r.weapon.enabled = v;
        });
        all.appendChild(b);
      }
      head.appendChild(all);
      box.appendChild(head);
      for (const r of rows) {
        const row = document.createElement('div');
        row.className = 'wr';
        const name = document.createElement('button');
        name.type = 'button';
        name.textContent = r.weapon.name;
        name.addEventListener('click', () => g.selectWeapon(r.weapon.id));
        const st = document.createElement('span');
        st.className = 'st';
        const tg = document.createElement('button');
        tg.type = 'button';
        tg.className = 'tg';
        tg.addEventListener('click', () => g.toggleWeapon(r.weapon.id));
        row.append(name, st, tg);
        box.appendChild(row);
        this.weapRows.push({ id: r.weapon.id, name, st, tg });
      }
    }
    const sys = g.world.player?.sys;
    const dock = this.q('#bh-dock').getBoundingClientRect();
    box.style.bottom = `${window.innerHeight - dock.top + 0.8 * this.u}px`;
    for (const el of this.weapRows) {
      const r = rows.find((x) => x.weapon.id === el.id);
      if (!r || !sys) continue;
      const w = r.weapon;
      const eff = moduleEfficiency(r.module);
      let text: string;
      if (eff <= 0) text = 'разрушено';
      else {
        const mode = w.target ? 'ручная' : sys.focus ? 'фокус' : 'авто';
        text = `${WEAPONS[w.type].short} · ${mode}${w.firing ? ' ●' : w.cooldown > 0.05 ? ' ◌' : ''}`;
      }
      el.st.textContent = text;
      el.st.classList.toggle('off', eff <= 0);
      el.name.classList.toggle('sel', g.selectedWeapon === el.id);
      el.tg.textContent = w.enabled ? 'ВКЛ' : 'ВЫКЛ';
      el.tg.classList.toggle('on', w.enabled && eff > 0);
    }
  }
}

void DISPATCH;
