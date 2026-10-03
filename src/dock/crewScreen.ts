import type { Game } from '../game';
import { portraitURL } from '../render/portrait';
import { CREW, RARITY } from '../sim/crewConfig';
import { ROLE_NAMES, atPost, engineerPlaces, hirePrice, inBarracks, onShip, postsOf, traitOf, type Member } from '../sim/roster';
import { SHIPS } from '../sim/ships';

/**
 * The crew of the ship at the berth, as designed in «Экипаж Antimatter»: the posts of the ship and
 * who stands at them, the barracks, the people the dock offers to hire. Everybody has a name, a
 * portrait, a level, a rarity and a few traits. On a dock on the road the screen is only for looking.
 */

type Tab = 'crew' | 'barracks' | 'hire';
const ROLE_COLOR: Record<string, string> = { pilot: '#59e6ff', gunner: '#ff6a5a', shieldop: '#b43cff', engineer: '#e8c450' };

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
#crew .btn.prem { border-color: rgba(255,79,216,.6); color: #ffd0f4; background: rgba(58,10,70,.7); }
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
#crew .tabs .sp { flex: 1; }
#crew .body { position: absolute; left: U(3.2); right: U(3.2); top: calc(U(13.8) + env(safe-area-inset-top, 0px)); bottom: U(3); display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: U(2); }
#crew .col { display: flex; flex-direction: column; gap: U(.9); min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #243052 transparent; padding-right: U(.4); }
#crew h5 { margin: 0; font-family: ${SANS}; font-weight: 500; font-size: U(1.1); letter-spacing: .16em; text-transform: uppercase; color: #aab3d6; display: flex; justify-content: space-between; gap: U(1); }
#crew h5 small { font-family: ${MONO}; letter-spacing: .04em; text-transform: none; color: #8a93b8; font-size: U(1.05); }
#crew .row { display: grid; grid-template-columns: U(8) 1fr auto; gap: U(1.3); align-items: center; padding: U(.9) U(1.2); background: rgba(7,10,20,.84); border: 1px solid rgba(89,230,255,.18); }
#crew .row.empty { border-style: dashed; border-color: rgba(255,106,90,.5); }
#crew .row.pick { border-color: #59e6ff; box-shadow: 0 0 U(1.2) rgba(89,230,255,.25); }
#crew .row.sel { border-color: #59e6ff; }
#crew .row.plain { grid-template-columns: 1fr; }
#crew .face { width: U(8); height: U(8); background: #080b16; border: 2px solid #243052; position: relative; overflow: hidden; }
#crew .face img { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
#crew .face.r2 { border-color: #63e07a; }
#crew .face.r3 { border-color: #59e6ff; }
#crew .face.r4 { border-color: #b43cff; box-shadow: 0 0 U(.8) rgba(180,60,255,.5); }
#crew .face.r5 { border-color: #e8c450; box-shadow: 0 0 U(1) rgba(232,196,80,.6); }
#crew .face .lv { position: absolute; right: 0; bottom: 0; background: #0a0d18; color: #fff3c8; font-size: U(1.2); font-weight: 700; padding: 0 U(.45); }
#crew .face.hurt::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(45deg, rgba(255,106,90,.25) 0 3px, transparent 3px 6px); }
#crew .who { display: flex; flex-direction: column; gap: U(.35); min-width: 0; }
#crew .who b { font-size: U(1.45); font-weight: 700; color: #e9eeff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#crew .who .role { color: #59e6ff; letter-spacing: .12em; text-transform: uppercase; font-size: U(.95); }
#crew .who small { font-size: U(1); color: #8a93b8; }
#crew .chips { display: flex; flex-wrap: wrap; gap: U(.45); }
#crew .tg { font-size: U(.9); letter-spacing: .05em; padding: U(.15) U(.6); border: 1px solid #243052; color: #aab3d6; }
#crew .tg.bad { border-color: rgba(255,106,90,.5); color: #ffb0a6; }
#crew .tg.st { border-color: rgba(255,106,90,.55); color: #ff6a5a; }
#crew .note { padding: U(1.1) U(1.4); font-size: U(1.05); line-height: 1.5; color: #9aa4cc; background: rgba(7,10,20,.84); border: 1px solid rgba(89,230,255,.18); }
#crew .note b { color: #e4e8fb; font-weight: 500; }
#crew .toast { position: absolute; left: 50%; top: calc(U(6.4) + env(safe-area-inset-top, 0px)); transform: translateX(-50%); padding: U(1) U(2); font-size: U(1.2); background: rgba(10,14,30,.96); border: 1px solid #59e6ff; color: #e4e8fb; pointer-events: none; opacity: 0; transition: opacity .25s; z-index: 6; text-align: center; max-width: 80%; }
#crew .toast.on { opacity: 1; }
#crew.portrait .top { left: U(2.2); right: U(2.2); align-items: center; }
#crew.portrait .ttl b { font-size: U(4.4); }
#crew.portrait .ttl span { font-size: U(1.7); }
#crew.portrait .chip-res { font-size: U(2.2); padding: U(.9) U(1.3); }
#crew.portrait .chip-res small { display: none; }
#crew.portrait .tabs { left: U(2.2); right: U(2.2); top: calc(U(12) + env(safe-area-inset-top, 0px)); flex-wrap: wrap; }
#crew.portrait .tabs button { font-size: U(1.9); padding: U(1.3) U(1.8); }
#crew.portrait .tabs .n { font-size: U(1.7); }
#crew.portrait .body { left: U(2.2); right: U(2.2); top: calc(U(22) + env(safe-area-inset-top, 0px)); bottom: U(2.2); grid-template-columns: 1fr; grid-template-rows: auto; overflow-y: auto; align-content: start; }
#crew.portrait .col { overflow: visible; }
#crew.portrait h5 { font-size: U(2); }
#crew.portrait h5 small { font-size: U(1.8); }
#crew.portrait .row { grid-template-columns: U(14) 1fr auto; gap: U(2); padding: U(1.4); }
#crew.portrait .row.plain { grid-template-columns: 1fr; }
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
#crew.portrait .toast { font-size: U(2.3); top: calc(U(18) + env(safe-area-inset-top, 0px)); }
`);

const num = (v: number): string => Math.round(v).toLocaleString('ru-RU');

export class CrewScreen {
  private root = document.createElement('div');
  private tab: Tab = 'crew';
  private shipId = '';
  /** The post being filled (a module key, or -1 for an engineer's place) and the person looked at in the barracks. */
  private pick: number | null = null;
  private sel: number | null = null;
  private readOnly = false;
  private open_ = false;
  private changed = false;
  private toastText = '';
  private toastUntil = 0;

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
    window.addEventListener('keydown', (e) => {
      if (this.open_ && e.key === 'Escape') this.close();
    });
    window.addEventListener('resize', () => {
      if (this.open_) this.fit();
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** Opens the crew of a ship; on a dock on the road it is only for looking. */
  open(shipId: string, readOnly = false): void {
    this.shipId = SHIPS.some((s) => s.id === shipId) ? shipId : SHIPS[0].id;
    this.readOnly = readOnly;
    this.changed = false;
    this.open_ = true;
    this.pick = null;
    this.sel = null;
    this.tab = 'crew';
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
    const hurt = m.status === 'hurt' ? '<span class="tg st">ранен</span>' : '';
    return `<div class="who"><b>${m.name}</b><span class="role">${ROLE_NAMES[m.role]} · ${RARITY[m.rar - 1].name}</span><small>${m.fights} боёв${extra}</small><div class="chips">${chips}${hurt}</div></div>`;
  }

  private postRow(label: string, role: string, key: number, m: Member | undefined): string {
    const picking = this.pick === key;
    if (!m) {
      return `<div class="row empty${picking ? ' pick' : ''}"><div class="face"><img alt="" src="${emptySlot()}"></div><div class="who"><b>${label}</b><span class="role" style="color:${ROLE_COLOR[role]}">${ROLE_NAMES[role as keyof typeof ROLE_NAMES]}</span><small style="color:#ff9a8f">пост пуст: модуль не работает</small></div>${this.readOnly ? '<span></span>' : `<button type="button" class="btn pri" data-act="pick" data-key="${key}">Поставить</button>`}</div>`;
    }
    return `<div class="row${picking ? ' pick' : ''}">${this.face(m)}${this.who(m, ` · ${label}`)}${this.readOnly ? '<span></span>' : `<button type="button" data-act="unpost" data-id="${m.id}">В казарму</button>`}</div>`;
  }

  // ---------------------------------------------------------------- the three tabs

  private crewCols(): [string, string] {
    const g = this.game;
    const grid = g.blueprint(this.shipId);
    const posts = postsOf(grid).filter((p) => !p.reserve);
    const engineers = onShip(g.roster, this.shipId).filter((m) => m.role === 'engineer');
    const places = engineerPlaces(grid);
    const manned = posts.filter((p) => atPost(g.roster, this.shipId, p.key)).length + engineers.length;
    let left = `<h5>Посты<small>${manned} из ${posts.length + places}</small></h5>`;
    for (const p of posts) left += this.postRow(p.label, p.role, p.key, atPost(g.roster, this.shipId, p.key));
    for (let i = 0; i < places; i++) left += this.postRow('Инженер', 'engineer', -1 - i, engineers[i]);
    if (!this.readOnly) left += `<button type="button" data-act="auto">Лучшие на посты<small>из казармы</small></button>`;
    let right: string;
    if (this.pick !== null) {
      const role = this.pick >= 0 ? (posts.find((p) => p.key === this.pick)?.role ?? 'engineer') : 'engineer';
      const list = inBarracks(g.roster).filter((m) => m.role === role && m.status === 'ok');
      right = `<h5>Кого поставить<small>${ROLE_NAMES[role as keyof typeof ROLE_NAMES]}</small></h5>`;
      right += list.length
        ? list.map((m) => `<div class="row">${this.face(m)}${this.who(m)}<button type="button" class="btn pri" data-act="seat" data-id="${m.id}">Сюда</button></div>`).join('')
        : '<div class="note"><b>В казарме нет подходящего специалиста.</b> Наймите на вкладке «Найм».</div>';
    } else {
      right = `<h5>Корабль<small>${SHIPS.find((s) => s.id === this.shipId)?.label ?? ''}</small></h5>`;
      right += `<div class="note"><b>Пост без человека не работает:</b> модуль молчит. Нажмите «Поставить» и выберите человека нужной профессии из казармы. Лишних инженеров на борту не будет: мест ${places}. ${this.readOnly ? '<br><br><b>В доке на пути экипаж можно только смотреть.</b>' : ''}</div>`;
    }
    return [left, right];
  }

  private barracksCols(): [string, string] {
    const r = this.game.roster;
    const all = inBarracks(r);
    let left = `<h5>Казарма<small>${all.length} из ${CREW.barracksMax}</small></h5>`;
    left += all.length ? all.map((m) => `<div class="row${this.sel === m.id ? ' sel' : ''}" data-sel="${m.id}">${this.face(m)}${this.who(m)}<span></span></div>`).join('') : '<div class="note">Казарма пуста. Новых людей можно нанять на вкладке «Найм».</div>';
    const m = all.find((x) => x.id === this.sel);
    let right = '<h5>Человек</h5>';
    if (!m) right += '<div class="note">Выберите человека слева.</div>';
    else {
      right += `<div class="row plain" style="grid-template-columns:auto 1fr;display:grid">${this.face(m)}${this.who(m)}</div>`;
      if (!this.readOnly) right += `<button type="button" data-act="release" data-id="${m.id}">Отпустить<small>уйдёт навсегда</small></button>`;
    }
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
        return `<div class="row">${this.face(m)}${this.who(m)}<button type="button" class="btn pri" data-act="hire" data-id="${m.id}"${off ? ' disabled' : ''}>Нанять<small>${num(price)} кр.</small></button></div>`;
      })
      .join('');
    let right = '<h5>Найм</h5>';
    right += `<div class="note"><b>Как это работает.</b> Кандидатов в доке ${CREW.candidates}. Цена зависит от уровня и редкости. Нанятый попадает в казарму (до ${CREW.barracksMax} человек), поставить его на пост можно на вкладке «Экипаж».${full ? '<br><br><b>Казарма полна:</b> отпустите кого-нибудь.' : ''}</div>`;
    right += `<button type="button" data-act="refresh"${g.wallet.credits < CREW.refreshPrice ? ' disabled' : ''}>Обновить кандидатов<small>−${CREW.refreshPrice} кр.</small></button>`;
    return [left, right];
  }

  private render(): void {
    const g = this.game;
    const cols = this.tab === 'crew' ? this.crewCols() : this.tab === 'barracks' ? this.barracksCols() : this.hireCols();
    const r = g.roster;
    const n = { crew: onShip(r, this.shipId).length, barracks: inBarracks(r).length, hire: r.candidates.length };
    const tabs = (
      [
        ['crew', 'Экипаж'],
        ['barracks', 'Казарма'],
        ['hire', 'Найм'],
      ] as Array<[Tab, string]>
    )
      .map(([id, label]) => `<button type="button" data-tab="${id}" aria-pressed="${this.tab === id}">${label} <span class="n">${n[id]}</span></button>`)
      .join('');
    const keep = Array.from(this.root.querySelectorAll('.col')).map((c) => c.scrollTop);
    const spec = SHIPS.find((s) => s.id === this.shipId);
    this.root.innerHTML = `<div class="top"><div class="ttl"><b>ЭКИПАЖ</b><span>${spec?.label ?? ''}${this.readOnly ? ' · док на пути' : ' · причал 1'}</span></div>
      <div class="res"><div class="chip-res"><i style="background:#e8c450"></i><small>Кредиты</small>${num(g.wallet.credits)}</div><div class="chip-res"><i style="background:#ff4fd8;transform:rotate(45deg)"></i><small>Кванты</small>${num(g.wallet.quanta)}</div><button type="button" class="go" data-act="done">Готово ▸</button></div></div>
      <div class="tabs">${tabs}</div>
      <div class="body"><div class="col">${cols[0]}</div><div class="col">${cols[1]}</div></div><div class="toast${Date.now() < this.toastUntil ? ' on' : ''}">${this.toastText}</div>`;
    this.root.querySelectorAll('.col').forEach((c, i) => {
      if (keep[i]) c.scrollTop = keep[i];
    });
  }

  // ---------------------------------------------------------------- actions

  private click(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const tab = t.closest('[data-tab]') as HTMLElement | null;
    if (tab) {
      this.tab = tab.dataset.tab as Tab;
      this.pick = null;
      this.render();
      return;
    }
    const b = t.closest('[data-act]') as HTMLButtonElement | null;
    if (!b) {
      const sel = t.closest('[data-sel]') as HTMLElement | null;
      if (sel) {
        this.sel = Number(sel.dataset.sel);
        this.render();
      }
      return;
    }
    if (b.disabled) return;
    const g = this.game;
    const act = b.dataset.act!;
    const id = b.dataset.id ? Number(b.dataset.id) : -1;
    if (act === 'done') {
      this.close();
      return;
    }
    if (this.readOnly) return;
    if (act !== 'pick' && act !== 'refresh') this.changed = true;
    const name = (i: number) => g.roster.members.find((m) => m.id === i)?.name ?? '';
    if (act === 'pick') this.pick = this.pick === Number(b.dataset.key) ? null : Number(b.dataset.key);
    else if (act === 'seat' && this.pick !== null) {
      const key = this.pick >= 0 ? this.pick : null;
      if (g.postMember(id, this.shipId, key)) this.toast(`${name(id)} на посту`);
      this.pick = null;
    } else if (act === 'unpost') {
      g.unpostMember(id);
      this.toast(`${name(id)} в казарме`);
    } else if (act === 'release') {
      const n = name(id);
      g.releaseMember(id);
      this.sel = null;
      this.toast(`${n} отпущен`);
    } else if (act === 'hire') {
      const n = name(id) || g.roster.candidates.find((m) => m.id === id)?.name || '';
      const r = g.hireCandidate(id);
      this.toast(r === 'ok' ? `${n} нанят, ждёт в казарме` : r === 'credits' ? 'Не хватает кредитов' : r === 'full' ? 'Казарма полна' : '');
    } else if (act === 'refresh') {
      if (g.refreshCandidatesPaid()) this.toast('Новые кандидаты');
    } else if (act === 'auto') {
      const n = g.autoPost(this.shipId);
      this.toast(n ? 'Лучшие из казармы на постах' : 'В казарме некого ставить');
    }
    this.render();
  }
}

/** The picture of an empty post: a dark square with a plus. */
let emptyURL = '';
function emptySlot(): string {
  if (emptyURL) return emptyURL;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 12;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#0b1020';
  c.fillRect(0, 0, 12, 12);
  c.fillStyle = '#4c5470';
  c.fillRect(5, 3, 2, 6);
  c.fillRect(3, 5, 6, 2);
  emptyURL = cv.toDataURL();
  return emptyURL;
}
