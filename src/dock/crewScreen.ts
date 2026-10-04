import type { Game } from '../game';
import { portraitURL } from '../render/portrait';
import { CREW, RARITY } from '../sim/crewConfig';
import { ROLE_NAMES, atPost, engineerPlaces, healLeft, healPrice, healSpeedUpPrice, hirePrice, inBarracks, onShip, postsOf, traitOf, type Fallen, type Member, type Post } from '../sim/roster';
import { shipEffects } from '../sim/effects';
import { SHIPS } from '../sim/ships';
import { makeDockSprite, type DockSprite } from './dockArt';

/**
 * The crew of the ship at the berth, as designed in «Экипаж Antimatter»: the ship itself with its
 * posts marked on it, the barracks beside it, the people the dock offers to hire. People are put on
 * the ship: tap a person and then a post (or the post and then the person), or drag a card onto a
 * post with the mouse. Everybody has a name, a portrait, a level, a rarity and a few traits. On a dock
 * on the road the screen is only for looking.
 */

type Tab = 'crew' | 'hire' | 'memory';
const ROLE_COLOR: Record<string, string> = { pilot: '#59e6ff', gunner: '#ff6a5a', shieldop: '#b43cff', engineer: '#e8c450' };
const ROLE_GLYPH: Record<string, string> = { pilot: '✈', gunner: '✛', shieldop: '◈', engineer: '⚙' };

const U = (css: string) => css.replace(/U\(([-\d.]+)\)/g, 'calc(var(--u) * $1)');
const SANS = "'Unbounded', 'Arial Black', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";
const CSS = U(`
#crew { position: fixed; inset: 0; z-index: 45; overflow: hidden; color: #c9d2ef; -webkit-user-select: none; user-select: none; touch-action: manipulation; font-family: ${MONO};
  background-color: #04060d; background-image: linear-gradient(rgba(89,230,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(89,230,255,.045) 1px, transparent 1px); background-size: U(2.2) U(2.2); }
#crew[hidden] { display: none; }
#crew button { font-family: ${SANS}; font-weight: 500; font-size: U(1.1); letter-spacing: .12em; text-transform: uppercase; cursor: pointer; text-align: left; color: #c9d2ef; background: rgba(6,9,18,.82);
  border: 1px solid rgba(89,230,255,.25); padding: U(.85) U(1.2); display: flex; justify-content: space-between; align-items: center; gap: U(.9); touch-action: manipulation; }
#crew button:hover { border-color: rgba(89,230,255,.6); color: #fff; }
#crew button:focus-visible { outline: 2px solid #ff4fd8; outline-offset: 2px; }
#crew button:disabled { opacity: .45; cursor: default; }
#crew button small { font-family: ${MONO}; font-weight: 400; letter-spacing: .04em; text-transform: none; color: #9aa4cc; font-size: U(.95); }
#crew .btn.pri { border-color: #59e6ff; color: #59e6ff; background: rgba(14,40,64,.9); }
#crew .go { color: #fbf2ff; border-color: #ff4fd8; background: rgba(58,10,70,.78); box-shadow: 0 0 U(1.4) rgba(255,79,216,.35); font-weight: 700; font-size: U(1.3); padding: U(1) U(1.8); }
#crew .top { position: absolute; left: U(3.2); right: U(3.2); top: calc(U(2.4) + env(safe-area-inset-top, 0px)); display: flex; justify-content: space-between; align-items: flex-start; gap: U(1.5); }
#crew .ttl { display: flex; flex-direction: column; gap: U(.3); }
#crew .ttl b { font-family: ${SANS}; font-weight: 900; font-size: U(3.2); letter-spacing: .28em; color: #f3e8ff; text-shadow: 0 0 U(1.2) rgba(180,60,255,.6), 0 0 U(.4) #000; }
#crew .ttl span { font-size: U(1.15); letter-spacing: .22em; text-transform: uppercase; color: #8a93b8; }
#crew .res { display: flex; gap: U(.8); align-items: stretch; }
#crew .chip-res { display: flex; align-items: center; gap: U(.8); padding: U(.7) U(1.3); font-size: U(1.4); font-weight: 500; color: #e9eeff; background: rgba(7,10,20,.84); border: 1px solid rgba(89,230,255,.18); white-space: nowrap; }
#crew .chip-res i { width: U(1.1); height: U(1.1); display: block; }
#crew .chip-res small { font-size: U(.85); letter-spacing: .14em; text-transform: uppercase; color: #6c77a0; }
#crew .tabs { position: absolute; left: U(3.2); right: U(3.2); top: calc(U(9.4) + env(safe-area-inset-top, 0px)); display: flex; gap: U(.8); align-items: center; }
#crew .tabs button[aria-pressed="true"] { color: #59e6ff; border-color: #59e6ff; background: rgba(14,40,64,.9); }
#crew .tabs .n { font-family: ${MONO}; font-size: U(1); color: #8a93b8; letter-spacing: .04em; }
#crew .body { position: absolute; left: U(3.2); right: U(3.2); top: calc(U(13.8) + env(safe-area-inset-top, 0px)); bottom: U(3); display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: U(2.2); }
#crew .col { display: flex; flex-direction: column; gap: U(1.1); min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #243052 transparent; padding: U(.3) U(.5) U(.3) U(.3); }
#crew h5 { margin: 0; font-family: ${SANS}; font-weight: 500; font-size: U(1.1); letter-spacing: .16em; text-transform: uppercase; color: #aab3d6; display: flex; justify-content: space-between; gap: U(1); }
#crew h5 small { font-family: ${MONO}; letter-spacing: .04em; text-transform: none; color: #8a93b8; font-size: U(1.05); }

/* a person's card: its own plate with a bar in the colour of the profession, so neighbours never run together */
#crew .row { display: grid; grid-template-columns: U(8) 1fr auto; gap: U(1.4); align-items: center; padding: U(1) U(1.3) U(1) U(1.5); position: relative;
  background: linear-gradient(180deg, #111a33, #0a1022); border: 1px solid #2e3d6b; border-left: U(.45) solid var(--rc, #2e3d6b); box-shadow: 0 U(.3) U(.9) rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.03); }
#crew .row:hover { border-color: #59e6ff; border-left-color: var(--rc, #59e6ff); }
#crew .row[data-drag] { cursor: grab; }
#crew .row.ok { border-color: #63e07a; box-shadow: 0 0 U(1.1) rgba(99,224,122,.3), 0 U(.3) U(.9) rgba(0,0,0,.55); }
#crew .row.dim { opacity: .55; }
#crew .row.sel { border-color: #59e6ff; box-shadow: 0 0 U(1.2) rgba(89,230,255,.35), 0 U(.3) U(.9) rgba(0,0,0,.55); }
#crew .row.empty { border-style: dashed; border-color: rgba(255,106,90,.5); }
#crew .row.plain { grid-template-columns: U(8) 1fr; }
#crew .face { width: U(8); height: U(8); background: #080b16; border: 2px solid #243052; position: relative; overflow: hidden; }
#crew .face img { width: 100%; height: 100%; display: block; image-rendering: pixelated; pointer-events: none; }
#crew .face.r2 { border-color: #63e07a; }
#crew .face.r3 { border-color: #59e6ff; }
#crew .face.r4 { border-color: #b43cff; box-shadow: 0 0 U(.8) rgba(180,60,255,.5); }
#crew .face.r5 { border-color: #e8c450; box-shadow: 0 0 U(1) rgba(232,196,80,.6); }
#crew .face .lv { position: absolute; right: 0; bottom: 0; background: #0a0d18; color: #fff3c8; font-size: U(1.2); font-weight: 700; padding: 0 U(.45); }
#crew .face.dead { filter: grayscale(1) brightness(.65); }
#crew .pods { margin-top: U(.8); }
#crew .pods.bad { border-color: rgba(255,106,90,.55); }
#crew .row.hurtrow { opacity: .92; }
#crew .face.hurt::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(45deg, rgba(255,106,90,.25) 0 3px, transparent 3px 6px); }
#crew .who { display: flex; flex-direction: column; gap: U(.35); min-width: 0; }
#crew .who b { font-size: U(1.45); font-weight: 700; color: #e9eeff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#crew .who .role { color: var(--rc, #59e6ff); letter-spacing: .12em; text-transform: uppercase; font-size: U(.95); }
#crew .who small { font-size: U(1); color: #8a93b8; }
#crew .chips { display: flex; flex-wrap: wrap; gap: U(.45); }
#crew .tg { font-size: U(.9); letter-spacing: .05em; padding: U(.15) U(.6); border: 1px solid #243052; color: #aab3d6; }
#crew .tg.bad { border-color: rgba(255,106,90,.5); color: #ffb0a6; }
#crew .tg.st { border-color: rgba(255,106,90,.55); color: #ff6a5a; }
#crew .note { padding: U(1.1) U(1.4); font-size: U(1.05); line-height: 1.5; color: #9aa4cc; background: rgba(7,10,20,.84); border: 1px solid #2e3d6b; }
#crew .note b { color: #e4e8fb; font-weight: 500; }
#crew .barracks { display: flex; flex-direction: column; gap: U(1.1); min-height: U(6); padding: U(.4); border: 1px dashed transparent; }
#crew .barracks.over { border-color: #59e6ff; background: rgba(89,230,255,.06); }

/* the ship with its posts */
#crew .shipcol { display: flex; flex-direction: column; gap: U(1); min-height: 0; flex: 1; }
#crew .layers { display: flex; flex-wrap: wrap; gap: U(.5); }
#crew .shiphead { display: flex; justify-content: space-between; align-items: center; gap: U(1); flex-wrap: wrap; }
#crew .layers button { font-family: ${MONO}; font-size: U(1); letter-spacing: .1em; padding: U(.5) U(.9); justify-content: center; }
#crew .layers button[aria-pressed="true"] { color: #59e6ff; border-color: #59e6ff; background: rgba(14,40,64,.9); }
#crew .shipwrap { flex: 1; min-height: 0; display: flex; justify-content: center; align-items: center; background: radial-gradient(ellipse at 50% 45%, rgba(40,70,140,.22), rgba(4,6,13,0) 70%); border: 1px solid #1d2748; }
#crew .shipbox { position: relative; height: 100%; max-width: 100%; }
#crew .shipbox canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; image-rendering: crisp-edges; filter: drop-shadow(0 0 U(1) rgba(89,230,255,.25)); }
#crew .mk { position: absolute; width: U(5.4); height: U(5.4); margin: U(-2.7) 0 0 U(-2.7); border: 2px solid var(--rc); background: rgba(5,8,18,.9); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 0 U(1) rgba(0,0,0,.8); }
#crew .mk img { width: 100%; height: 100%; image-rendering: pixelated; display: block; pointer-events: none; }
#crew .mk.empty { border-style: dashed; color: var(--rc); font-size: U(2.2); background: rgba(5,8,18,.7); animation: crew-pulse 1.6s ease-in-out infinite; }
#crew .mk .lv { position: absolute; right: -2px; bottom: -2px; background: #0a0d18; color: #fff3c8; font-size: U(1); font-weight: 700; padding: 0 U(.35); }
#crew .mk.wrecked { border-color: #ff6a5a; border-style: solid; background: rgba(60,10,10,.85); filter: grayscale(.8); animation: none; }
#crew .mk.wrecked.empty { color: #ff6a5a; }
#crew .mk.sel { box-shadow: 0 0 0 U(.35) #fff, 0 0 U(1.6) var(--rc); z-index: 3; }
#crew .mk.want { box-shadow: 0 0 0 U(.3) #63e07a, 0 0 U(1.6) #63e07a; animation: crew-pulse 1s ease-in-out infinite; }
#crew .mk.over { box-shadow: 0 0 0 U(.4) #63e07a, 0 0 U(2) #63e07a; transform: scale(1.12); }
#crew .mk[data-drag] { cursor: grab; }
@keyframes crew-pulse { 0%, 100% { opacity: .65; } 50% { opacity: 1; } }
#crew .eng { display: flex; align-items: center; gap: U(1.1); flex-wrap: wrap; }
#crew .eng .lbl { font-size: U(1); letter-spacing: .14em; text-transform: uppercase; color: #8a93b8; }
#crew .eng .mk { position: relative; margin: 0; width: U(6.4); height: U(6.4); }
#crew.portrait .eng .mk { width: U(11); height: U(11); margin: 0; }
#crew .ghost { position: fixed; z-index: 60; width: U(8); height: U(8); pointer-events: none; border: 2px solid #59e6ff; box-shadow: 0 0 U(2) rgba(89,230,255,.6); transform: translate(-50%, -50%); opacity: .92; }
#crew .ghost img { width: 100%; height: 100%; image-rendering: pixelated; display: block; }
#crew .toast { position: absolute; left: 50%; top: calc(U(6.4) + env(safe-area-inset-top, 0px)); transform: translateX(-50%); padding: U(1) U(2); font-size: U(1.2); background: rgba(10,14,30,.96); border: 1px solid #59e6ff; color: #e4e8fb; pointer-events: none; opacity: 0; transition: opacity .25s; z-index: 6; text-align: center; max-width: 80%; }
#crew .toast.on { opacity: 1; }
#crew.portrait .top { left: U(2.2); right: U(2.2); align-items: center; }
#crew.portrait .ttl b { font-size: U(4.4); }
#crew.portrait .ttl span { font-size: U(1.7); }
#crew.portrait .chip-res { font-size: U(2.2); padding: U(.9) U(1.3); }
#crew.portrait .chip-res small { display: none; }
#crew.portrait .tabs { left: U(2.2); right: U(2.2); top: calc(U(12) + env(safe-area-inset-top, 0px)); }
#crew.portrait .tabs button { font-size: U(1.9); padding: U(1.3) U(1.8); }
#crew.portrait .tabs .n { font-size: U(1.7); }
#crew.portrait .body { left: U(2.2); right: U(2.2); top: calc(U(22) + env(safe-area-inset-top, 0px)); bottom: U(2.2); grid-template-columns: 1fr; overflow-y: auto; align-content: start; gap: U(2); }
#crew.portrait .col { overflow: visible; }
#crew.portrait .shipwrap { height: U(78); flex: none; }
#crew.portrait h5 { font-size: U(2); }
#crew.portrait h5 small { font-size: U(1.8); }
#crew.portrait .row { grid-template-columns: U(14) 1fr auto; gap: U(2); padding: U(1.6) U(1.8); }
#crew.portrait .row.plain { grid-template-columns: U(14) 1fr; }
#crew.portrait .face { width: U(14); height: U(14); }
#crew.portrait .face .lv { font-size: U(2.2); }
#crew.portrait .who b { font-size: U(2.8); }
#crew.portrait .who .role { font-size: U(1.8); }
#crew.portrait .who small { font-size: U(1.9); }
#crew.portrait .tg { font-size: U(1.7); padding: U(.3) U(1); }
#crew.portrait button { font-size: U(2); padding: U(1.5) U(2); }
#crew.portrait button small { font-size: U(1.8); }
#crew.portrait .go { font-size: U(2.4); }
#crew.portrait .note { font-size: U(2); }
#crew.portrait .layers button { font-size: U(1.8); padding: U(1) U(1.6); }
#crew.portrait .mk { width: U(9); height: U(9); margin: U(-4.5) 0 0 U(-4.5); }
#crew.portrait .mk.empty { font-size: U(3.8); }
#crew.portrait .mk .lv { font-size: U(1.8); }
#crew.portrait .eng .lbl { font-size: U(1.8); }
#crew.portrait .toast { font-size: U(2.3); top: calc(U(18) + env(safe-area-inset-top, 0px)); }
#crew.portrait .ghost { width: U(14); height: U(14); }
`);

const num = (v: number): string => Math.round(v).toLocaleString('ru-RU');
const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

interface Drag {
  id: number;
  from: 'card' | 'mark';
  x: number;
  y: number;
  ghost: HTMLElement | null;
}

export class CrewScreen {
  private root = document.createElement('div');
  private tab: Tab = 'crew';
  private shipId = '';
  /** The post chosen on the ship (a module key; an engineer's place is -1 - its number) and the person chosen in the list. */
  private selPost: number | null = null;
  private selPerson: number | null = null;
  private layer = 0;
  private sprite: DockSprite | null = null;
  private posts: Post[] = [];
  private places = 0;
  private readOnly = false;
  private road = false;
  /** Keys of the wrecked modules of the ship, looked up when the screen is drawn. */
  private broken = new Set<number>();
  private open_ = false;
  private changed = false;
  private toastText = '';
  private toastUntil = 0;
  private drag: Drag | null = null;
  private justDragged = false;

  constructor(
    private game: Game,
    parent: HTMLElement,
    private onDone: (shipId: string, changed: boolean) => void,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.id = 'crew';
    this.root.hidden = true;
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => this.click(e));
    this.root.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('keydown', (e) => {
      if (this.open_ && e.key === 'Escape') this.close();
    });
    // the healing clocks run: look again every second while anybody is being healed
    window.setInterval(() => {
      if (this.open_ && !this.drag && this.game.roster.members.some((m) => m.status === 'hurt' && m.healEnd)) this.render();
    }, 1000);
    window.addEventListener('resize', () => {
      if (this.open_) this.fit();
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** Opens the crew of a ship. On a dock on the road people can be hired, healed and put on posts too (`road` only changes the title). */
  open(shipId: string, road = false): void {
    this.shipId = SHIPS.some((s) => s.id === shipId) ? shipId : SHIPS[0].id;
    this.readOnly = false;
    this.road = road;
    this.changed = false;
    this.open_ = true;
    this.selPost = null;
    this.selPerson = null;
    this.layer = 0;
    this.tab = 'crew';
    const grid = this.game.blueprint(this.shipId);
    this.sprite = makeDockSprite(grid);
    this.posts = postsOf(grid).filter((p) => !p.reserve);
    this.places = engineerPlaces(grid);
    this.root.hidden = false;
    this.fit();
    this.render();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    this.onDone(this.shipId, this.changed);
  }

  private fit(): void {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const portrait = vh / vw >= 1.4;
    this.root.classList.toggle('portrait', portrait);
    const u = (portrait ? Math.min(vw, (vh * 9) / 16) : Math.min(vw, (vh * 16) / 9)) / 100;
    this.root.style.setProperty('--u', `${u}px`);
  }

  private toast(t: string): void {
    this.toastText = t;
    this.toastUntil = Date.now() + 3200;
    window.setTimeout(() => {
      if (Date.now() >= this.toastUntil) this.root.querySelector('.toast')?.classList.remove('on');
    }, 3300);
  }

  // ---------------------------------------------------------------- pieces

  private face(m: Member): string {
    return `<div class="face r${m.rar}${m.status === 'hurt' ? ' hurt' : ''}"><img alt="" src="${portraitURL(m.name, m.role, m.rar)}"><span class="lv">${m.lv}</span></div>`;
  }

  private who(m: Member, extra = ''): string {
    const chips = m.traits
      .map((id) => {
        const t = traitOf(id);
        return t ? `<span class="tg${t.bad ? ' bad' : ''}" title="${t.desc}">${t.title}</span>` : '';
      })
      .join('');
    const hurt = m.status === 'hurt' ? `<span class="tg st">${m.healEnd ? 'лечится ' + clock(healLeft(m, Date.now())) : 'ранен'}</span>` : '';
    return `<div class="who"><b>${m.name}</b><span class="role">${ROLE_NAMES[m.role]} · ${RARITY[m.rar - 1].name}</span><small>${m.fights} боёв${extra}</small><div class="chips">${chips}${hurt}</div></div>`;
  }

  /** A person's card; `id` makes it draggable and `act` the button on its right. */
  private card(m: Member, o: { cls?: string; drag?: boolean; btn?: string; extra?: string } = {}): string {
    return `<div class="row ${o.cls ?? ''}" style="--rc:${ROLE_COLOR[m.role]}" data-card="${m.id}"${o.drag && !this.readOnly ? ` data-drag="${m.id}"` : ''}>${this.face(m)}${this.who(m, o.extra ?? '')}${o.btn ?? ''}</div>`;
  }

  /** The marker of a post on the ship (or in the row of engineers' places). */
  private marker(key: number, role: string, label: string, m: Member | undefined, at?: { x: number; y: number }): string {
    const sprite = this.sprite!;
    const eligible = this.selPerson !== null && this.personRole(this.selPerson) === role;
    const wrecked = key >= 0 && this.broken.has(key);
    const cls = `mk${m ? '' : ' empty'}${wrecked ? ' wrecked' : ''}${this.selPost === key ? ' sel' : ''}${eligible && !wrecked ? ' want' : ''}`;
    const pos = at ? ` style="--rc:${ROLE_COLOR[role]};left:${((at.x + 0.5) / sprite.w) * 100}%;top:${((at.y + 0.5) / sprite.h) * 100}%"` : ` style="--rc:${ROLE_COLOR[role]}"`;
    const inner = m ? `<img alt="" src="${portraitURL(m.name, m.role, m.rar)}"><span class="lv">${m.lv}</span>` : wrecked ? '✕' : ROLE_GLYPH[role];
    const tip = wrecked ? `${label}: модуль разрушен, пост займут после ремонта` : m ? `${label}: ${m.name}` : `${label}: пост пуст`;
    return `<div class="${cls}"${pos} data-mark="${key}" data-drop="${key}" data-role="${role}" title="${tip}"${m && !this.readOnly ? ` data-drag="${m.id}"` : ''}>${inner}</div>`;
  }

  private personRole(id: number): string | null {
    return this.game.roster.members.find((m) => m.id === id)?.role ?? null;
  }

  private personAt(key: number): Member | undefined {
    if (key >= 0) return atPost(this.game.roster, this.shipId, key);
    const engineers = onShip(this.game.roster, this.shipId).filter((m) => m.role === 'engineer');
    return engineers[-1 - key];
  }

  // ---------------------------------------------------------------- the tabs

  /** The button on a wounded person's card: pay to start the healing, or finish it at once for quanta. */
  private healButton(m: Member): string {
    const g = this.game;
    if (!m.healEnd) return `<button type="button" class="btn pri" data-act="heal" data-id="${m.id}"${g.wallet.credits < healPrice(m) ? ' disabled' : ''}>Лечить<small>${num(healPrice(m))} кр.</small></button>`;
    const q = healSpeedUpPrice(m, Date.now());
    return `<button type="button" class="btn prem" data-act="speed" data-id="${m.id}"${g.wallet.quanta < q ? ' disabled' : ''}>Ускорить<small>${q} кв.</small></button>`;
  }

  /** What the escape pods of the ship are worth: the figure the crew's fate in a lost ship hangs on. */
  private podsNote(): string {
    const fx = shipEffects(this.game.blueprint(this.shipId));
    if (fx.podSeats === 0) return '<div class="note pods bad"><b>Капсул нет.</b> Если корабль погибнет, погибнет весь экипаж. Модуль «Спасательные капсулы» ставится в меню «Модули».</div>';
    const crew = onShip(this.game.roster, this.shipId).length;
    return `<div class="note pods"><b>Капсулы:</b> ${fx.podSeats} мест, шанс спастись ${Math.round(fx.podChance * 100)}%${crew > fx.podSeats ? `. Людей на корабле ${crew}: места займут самые опытные, остальные погибнут.` : '.'}</div>`;
  }

  private memoryCols(): [string, string] {
    const fallen: Fallen[] = [...this.game.roster.memory].reverse();
    let left = `<h5>Память<small>${fallen.length}</small></h5>`;
    left += fallen.length
      ? fallen
          .map(
            (f) =>
              `<div class="row" style="--rc:${ROLE_COLOR[f.role]}"><div class="face dead r${f.rar}"><img alt="" src="${portraitURL(f.name, f.role, f.rar)}"><span class="lv">${f.lv}</span></div><div class="who"><b>${f.name}</b><span class="role">${ROLE_NAMES[f.role]} · ур. ${f.lv}</span><small>${f.fights} боёв · ${f.how === 'battle' ? 'погиб в бою' : 'погиб вместе с кораблём'}</small></div></div>`,
          )
          .join('')
      : '<div class="note">Пока никто не погиб.</div>';
    const right = '<h5>О чём это</h5><div class="note"><b>Погибших не вернуть.</b> Кто погиб в бою или вместе с кораблём, остаётся здесь: имя, уровень, сколько боёв прошёл. Раненые не здесь, они лечатся в казарме на вкладке «Экипаж».</div>';
    return [left, right];
  }

  private crewCols(): [string, string] {
    const g = this.game;
    const sprite = this.sprite!;
    const manned = this.posts.filter((p) => atPost(g.roster, this.shipId, p.key)).length + onShip(g.roster, this.shipId).filter((m) => m.role === 'engineer').length;
    const layerNames = ['Снаружи', 'Обшивка', 'П1', 'П2', 'П3', 'П4'];
    let left = `<div class="shiphead"><h5 style="flex:1">Корабль<small>${manned} из ${this.posts.length + this.places} мест занято</small></h5><div class="layers">`;
    sprite.views.forEach((_, i) => (left += `<button type="button" data-layer="${i}" aria-pressed="${this.layer === i}">${layerNames[i]}</button>`));
    left += `</div></div><div class="shipcol"><div class="shipwrap"><div class="shipbox" style="aspect-ratio:${sprite.w} / ${sprite.h}"><canvas width="${sprite.w}" height="${sprite.h}"></canvas>`;
    for (const p of this.posts) if (this.layer === 0 || p.z === this.layer - 1) left += this.marker(p.key, p.role, p.label, atPost(g.roster, this.shipId, p.key), p);
    left += '</div></div></div>';
    left += this.podsNote();

    // the right side: the post chosen, then the barracks
    const barracks = inBarracks(g.roster);
    const selRole = this.selPost !== null ? (this.selPost >= 0 ? this.posts.find((p) => p.key === this.selPost)?.role : 'engineer') : this.selPerson !== null ? this.personRole(this.selPerson) : null;
    let right = '';
    if (this.selPost !== null) {
      const p = this.posts.find((x) => x.key === this.selPost);
      const label = p ? p.label : 'Инженер';
      const m = this.personAt(this.selPost);
      right += `<h5>Пост: ${label}<small>${ROLE_NAMES[(selRole ?? 'engineer') as keyof typeof ROLE_NAMES]}</small></h5>`;
      right += m
        ? this.card(m, { cls: 'sel', btn: this.readOnly ? '' : `<button type="button" data-act="unpost" data-id="${m.id}">В казарму</button>` })
        : '<div class="note"><b>Пост пуст: модуль не работает.</b> Выберите человека из казармы ниже или перетащите его карточку на пост.</div>';
    } else {
      right += `<h5>Экипаж<small>выберите пост на корабле</small></h5>`;
      right += '<div class="note"><b>Пост без человека не работает.</b> Нажмите на пост на корабле или на человека в казарме, потом на второе. Карточку можно перетащить мышью на пост, а человека с поста обратно в казарму.</div>';
    }
    right += `<div class="eng"><span class="lbl">Инженеры</span>`;
    for (let i = 0; i < this.places; i++) right += this.marker(-1 - i, 'engineer', 'Инженер', this.personAt(-1 - i));
    right += '</div>';
    if (!this.readOnly) right += '<button type="button" data-act="auto">Лучшие на посты<small>из казармы</small></button>';
    const unpaid = barracks.filter((m) => m.status === 'hurt' && !m.healEnd);
    if (unpaid.length > 1) right += `<button type="button" data-act="healall">Лечить всех<small>${num(unpaid.reduce((n, m) => n + healPrice(m), 0))} кр.</small></button>`;
    right += `<h5>Казарма<small>${barracks.length} из ${CREW.barracksMax}</small></h5><div class="barracks" data-drop="barracks">`;
    right += barracks.length
      ? barracks
          .map((m) => {
            const fit = selRole !== null && selRole !== undefined && m.role === selRole && m.status === 'ok';
            const dim = selRole !== null && selRole !== undefined && !fit;
            if (m.status === 'hurt') return this.card(m, { cls: 'hurtrow', btn: this.healButton(m) });
            return this.card(m, { cls: `${fit ? 'ok ' : ''}${dim ? 'dim ' : ''}${this.selPerson === m.id ? 'sel' : ''}`, drag: true, btn: this.selPerson === m.id && !this.readOnly ? `<button type="button" data-act="release" data-id="${m.id}">Отпустить<small>навсегда</small></button>` : '' });
          })
          .join('')
      : '<div class="note">Казарма пуста. Новых людей можно нанять на вкладке «Найм».</div>';
    right += '</div>';
    return [left, right];
  }

  private hireCols(): [string, string] {
    const g = this.game;
    const r = g.roster;
    const full = inBarracks(r).length >= CREW.barracksMax;
    let left = `<h5>Кандидаты<small>${r.candidates.length} в доке</small></h5>`;
    left += r.candidates
      .map((m) => {
        const price = hirePrice(m);
        const off = this.readOnly ? false : g.wallet.credits < price || full;
        return this.card(m, { btn: `<button type="button" class="btn pri" data-act="hire" data-id="${m.id}"${off ? ' disabled' : ''}>Нанять<small>${num(price)} кр.</small></button>` });
      })
      .join('');
    let right = '<h5>Найм</h5>';
    right += `<div class="note"><b>Как это работает.</b> Кандидатов в доке ${CREW.candidates}. Цена зависит от уровня и редкости. Нанятый попадает в казарму (до ${CREW.barracksMax} человек), поставить его на пост можно на вкладке «Экипаж».${full ? '<br><br><b>Казарма полна:</b> отпустите кого-нибудь.' : ''}</div>`;
    right += `<button type="button" data-act="refresh"${g.wallet.credits < CREW.refreshPrice ? ' disabled' : ''}>Обновить кандидатов<small>−${CREW.refreshPrice} кр.</small></button>`;
    return [left, right];
  }

  private render(): void {
    const g = this.game;
    this.broken = g.brokenPosts(this.shipId);
    const cols = this.tab === 'crew' ? this.crewCols() : this.tab === 'hire' ? this.hireCols() : this.memoryCols();
    const r = g.roster;
    const n = { crew: onShip(r, this.shipId).length, hire: r.candidates.length, memory: r.memory.length };
    const tabs = (
      [
        ['crew', 'Экипаж'],
        ['hire', 'Найм'],
        ['memory', 'Память'],
      ] as Array<[Tab, string]>
    )
      .map(([id, label]) => `<button type="button" data-tab="${id}" aria-pressed="${this.tab === id}">${label} <span class="n">${n[id]}</span></button>`)
      .join('');
    const keep = Array.from(this.root.querySelectorAll('.col')).map((c) => c.scrollTop);
    const spec = SHIPS.find((s) => s.id === this.shipId);
    this.root.innerHTML = `<div class="top"><div class="ttl"><b>ЭКИПАЖ</b><span>${spec?.label ?? ''}${this.road ? ' · док на пути' : ' · причал 1'}</span></div>
      <div class="res"><div class="chip-res"><i style="background:#e8c450"></i><small>Кредиты</small>${num(g.wallet.credits)}</div><div class="chip-res"><i style="background:#ff4fd8;transform:rotate(45deg)"></i><small>Кванты</small>${num(g.wallet.quanta)}</div><button type="button" class="go" data-act="done">Готово ▸</button></div></div>
      <div class="tabs">${tabs}</div>
      <div class="body"><div class="col">${cols[0]}</div><div class="col">${cols[1]}</div></div><div class="toast${Date.now() < this.toastUntil ? ' on' : ''}">${this.toastText}</div>`;
    this.root.querySelectorAll('.col').forEach((c, i) => {
      if (keep[i]) c.scrollTop = keep[i];
    });
    this.spread();
    const cv = this.root.querySelector('.shipbox canvas') as HTMLCanvasElement | null;
    if (cv && this.sprite) {
      const sp = this.sprite;
      cv.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(sp.views[Math.min(this.layer, sp.views.length - 1)]), sp.w, sp.h), 0, 0);
    }
  }

  /** Posts that sit close together on the ship are pushed apart a little, so each can be tapped. */
  private spread(): void {
    const box = this.root.querySelector('.shipbox') as HTMLElement | null;
    if (!box) return;
    const rb = box.getBoundingClientRect();
    const mks = Array.from(box.querySelectorAll('.mk')) as HTMLElement[];
    if (mks.length < 2 || rb.width < 10) return;
    const size = mks[0].getBoundingClientRect().width;
    const gap = size * 1.08;
    const pts = mks.map((el) => ({ el, x: (parseFloat(el.style.left) / 100) * rb.width, y: (parseFloat(el.style.top) / 100) * rb.height }));
    for (let it = 0; it < 24; it++) {
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          let dx = pts[j].x - pts[i].x;
          let dy = pts[j].y - pts[i].y;
          let d = Math.hypot(dx, dy);
          if (d >= gap) continue;
          if (d < 0.5) {
            dx = 1;
            dy = 0;
            d = 1;
          }
          const push = (gap - d) / 2;
          pts[i].x -= (dx / d) * push;
          pts[i].y -= (dy / d) * push;
          pts[j].x += (dx / d) * push;
          pts[j].y += (dy / d) * push;
        }
      }
      for (const p of pts) {
        p.x = Math.max(size / 2, Math.min(rb.width - size / 2, p.x));
        p.y = Math.max(size / 2, Math.min(rb.height - size / 2, p.y));
      }
    }
    for (const p of pts) {
      p.el.style.left = `${(p.x / rb.width) * 100}%`;
      p.el.style.top = `${(p.y / rb.height) * 100}%`;
    }
  }

  // ---------------------------------------------------------------- putting people on the ship

  /** Puts a person on a post (a module key, or a negative number for an engineer's place); false with a word why. */
  private seat(id: number, key: number): boolean {
    const g = this.game;
    const m = g.roster.members.find((x) => x.id === id);
    if (!m) return false;
    const role = key >= 0 ? this.posts.find((p) => p.key === key)?.role : 'engineer';
    if (m.status !== 'ok') {
      this.toast(`${m.name} ранен`);
      return false;
    }
    if (role !== m.role) {
      this.toast(`${m.name}: это пост другой профессии`);
      return false;
    }
    if (key >= 0 && g.brokenPosts(this.shipId).has(key)) {
      this.toast('Модуль разрушен: пост займут после ремонта');
      return false;
    }
    if (key < 0) {
      // an engineer's place: no post, but a free one is needed
      const have = onShip(g.roster, this.shipId).filter((x) => x.role === 'engineer' && x.id !== id);
      if (have.length >= this.places) {
        const old = this.personAt(key);
        if (old) g.unpostMember(old.id);
        else g.unpostMember(have[0].id);
      }
      g.postMember(id, this.shipId, null);
    } else g.postMember(id, this.shipId, key);
    this.changed = true;
    this.toast(`${m.name} на посту`);
    return true;
  }

  private click(e: MouseEvent): void {
    if (this.justDragged) return;
    const t = e.target as HTMLElement;
    const tab = t.closest('[data-tab]') as HTMLElement | null;
    if (tab) {
      this.tab = tab.dataset.tab as Tab;
      this.selPost = null;
      this.selPerson = null;
      this.render();
      return;
    }
    const layer = t.closest('[data-layer]') as HTMLElement | null;
    if (layer) {
      this.layer = Number(layer.dataset.layer);
      this.render();
      return;
    }
    const b = t.closest('button[data-act]') as HTMLButtonElement | null;
    if (b) {
      if (b.disabled) return;
      this.act(b);
      return;
    }
    const mk = t.closest('[data-mark]') as HTMLElement | null;
    if (mk) {
      const key = Number(mk.dataset.mark);
      if (this.selPerson !== null && !this.readOnly) {
        if (this.seat(this.selPerson, key)) {
          this.selPerson = null;
          this.selPost = null;
        }
      } else this.selPost = this.selPost === key ? null : key;
      this.render();
      return;
    }
    const card = t.closest('[data-card]') as HTMLElement | null;
    if (card && this.tab === 'crew') {
      const id = Number(card.dataset.card);
      const m = this.game.roster.members.find((x) => x.id === id);
      if (m && !m.ship && m.status === 'ok') {
        if (this.selPost !== null && !this.readOnly) {
          if (this.seat(id, this.selPost)) {
            this.selPost = null;
            this.selPerson = null;
          }
        } else this.selPerson = this.selPerson === id ? null : id;
        this.render();
      }
    }
  }

  private act(b: HTMLButtonElement): void {
    const g = this.game;
    const act = b.dataset.act!;
    const id = b.dataset.id ? Number(b.dataset.id) : -1;
    if (act === 'done') {
      this.close();
      return;
    }
    if (this.readOnly) return;
    const name = (i: number) => g.roster.members.find((m) => m.id === i)?.name ?? '';
    if (act === 'unpost') {
      g.unpostMember(id);
      this.changed = true;
      this.toast(`${name(id)} в казарме`);
      this.selPost = null;
    } else if (act === 'release') {
      const n = name(id);
      g.releaseMember(id);
      this.changed = true;
      this.selPerson = null;
      this.toast(`${n} отпущен`);
    } else if (act === 'hire') {
      const n = g.roster.candidates.find((m) => m.id === id)?.name ?? '';
      const r = g.hireCandidate(id);
      if (r === 'ok') this.changed = true;
      this.toast(r === 'ok' ? `${n} нанят, ждёт в казарме` : r === 'credits' ? 'Не хватает кредитов' : r === 'full' ? 'Казарма полна' : '');
    } else if (act === 'heal') {
      const r = g.healMember(id);
      this.toast(r === 'ok' ? `${name(id)} лечится` : r === 'credits' ? 'Не хватает кредитов' : '');
    } else if (act === 'healall') {
      let n = 0;
      for (const m of g.roster.members.filter((x) => x.status === 'hurt' && !x.healEnd)) if (g.healMember(m.id) === 'ok') n++;
      this.toast(n ? `Лечатся: ${n}` : 'Не хватает кредитов');
    } else if (act === 'speed') {
      const r = g.speedUpHealing(id);
      if (r === 'ok') this.changed = true;
      this.toast(r === 'ok' ? `${name(id)} здоров` : r === 'quanta' ? 'Не хватает квантов' : '');
    } else if (act === 'refresh') {
      if (g.refreshCandidatesPaid()) this.toast('Новые кандидаты');
    } else if (act === 'auto') {
      const n = g.autoPost(this.shipId);
      if (n) this.changed = true;
      this.toast(n ? 'Лучшие из казармы на постах' : 'В казарме некого ставить');
    }
    this.render();
  }

  // ---------------------------------------------------------------- dragging with the mouse

  private pointerDown(e: PointerEvent): void {
    if (this.readOnly || e.pointerType === 'touch' || e.button !== 0) return;
    const el = (e.target as HTMLElement).closest('[data-drag]') as HTMLElement | null;
    if (!el) return;
    this.drag = { id: Number(el.dataset.drag), from: el.classList.contains('mk') ? 'mark' : 'card', x: e.clientX, y: e.clientY, ghost: null };
  }

  private dropTarget(e: PointerEvent): HTMLElement | null {
    return (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-drop]') as HTMLElement | null;
  }

  private pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return;
      const m = this.game.roster.members.find((x) => x.id === d.id);
      if (!m) {
        this.drag = null;
        return;
      }
      const gh = document.createElement('div');
      gh.className = 'ghost';
      gh.innerHTML = `<img alt="" src="${portraitURL(m.name, m.role, m.rar)}">`;
      this.root.appendChild(gh);
      d.ghost = gh;
    }
    d.ghost.style.left = `${e.clientX}px`;
    d.ghost.style.top = `${e.clientY}px`;
    this.root.querySelectorAll('.over').forEach((el) => el.classList.remove('over'));
    this.dropTarget(e)?.classList.add('over');
  }

  private pointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.ghost) return;
    const target = this.dropTarget(e);
    d.ghost.remove();
    this.root.querySelectorAll('.over').forEach((el) => el.classList.remove('over'));
    // the click that follows a drag is not a tap
    this.justDragged = true;
    window.setTimeout(() => (this.justDragged = false), 60);
    if (!target) return;
    const m = this.game.roster.members.find((x) => x.id === d.id);
    if (!m) return;
    const drop = target.dataset.drop!;
    if (drop === 'barracks') {
      if (m.ship) {
        this.game.unpostMember(m.id);
        this.changed = true;
        this.toast(`${m.name} в казарме`);
      }
    } else {
      const key = Number(drop);
      const other = this.personAt(key);
      const fromPost = m.ship === this.shipId ? m.post : null;
      if (this.seat(m.id, key) && fromPost !== null && key >= 0 && other && other !== m && other.role === m.role) {
        // dragged from one post to another: the two swap places
        this.game.postMember(other.id, this.shipId, fromPost);
      }
    }
    this.selPost = null;
    this.selPerson = null;
    this.render();
  }
}
