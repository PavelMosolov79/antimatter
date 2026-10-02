import { Game, SCENARIOS, type Tool } from './game';
import { OUTER_VIEW } from './render/shipView';
import { RunScreen } from './runScreen';
import { SHIPS } from './sim/ships';
import { SECTOR_IDS, SECTORS } from './sim/space';
import { moduleEfficiency } from './sim/grid';
import { WEAPONS } from './sim/weapons';

const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; font: 11px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #cfe0ff; }
.panel { position: absolute; background: rgba(10,14,24,.85); border: 1px solid #26324a; border-radius: 6px; padding: 6px 8px; pointer-events: auto; backdrop-filter: blur(4px); }
.panel h4 { margin: 0 0 4px; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; color: #7f95bf; font-weight: 600; }
.panel h5 { margin: 6px 0 3px; font-size: 9px; letter-spacing: .05em; text-transform: uppercase; color: #5f759f; font-weight: 600; border-top: 1px solid #202c46; padding-top: 5px; }
.panel h5:first-child { border-top: none; padding-top: 0; margin-top: 0; }
.panel .row { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 5px; }
.panel .row:last-child { margin-bottom: 0; }
.panel button { background: #182238; color: #cfe0ff; border: 1px solid #2a3a5c; border-radius: 4px; padding: 2px 6px; font: inherit; font-size: 10px; cursor: pointer; }
.panel button:hover { background: #22304f; }
.panel button.on { border-color: #59e6ff; color: #59e6ff; background: #14304a; }
.panel button:disabled { opacity: .4; cursor: default; }
.panel label { display: flex; align-items: center; gap: 4px; width: 100%; }
.panel label span { width: 52px; flex-shrink: 0; color: #8fa4cc; }
.panel input[type=range] { flex: 1; accent-color: #59e6ff; }
.panel .val { width: 26px; text-align: right; flex-shrink: 0; }
#left { position: absolute; left: 8px; top: 8px; display: flex; flex-direction: column; gap: 6px; width: 208px; max-height: calc(100vh - 16px); overflow-y: auto; pointer-events: auto; }
#left .panel { position: static; }
#controls { right: 8px; top: 8px; width: 208px; max-height: calc(100vh - 34px); overflow-y: auto; }
#stats { white-space: pre; font-size: 9.5px; color: #93a8cf; }
.scrollbox { max-height: 130px; overflow-y: auto; margin-bottom: 2px; }
.bar { position: relative; height: 12px; background: #101a2c; border: 1px solid #24304a; border-radius: 3px; margin-bottom: 3px; overflow: hidden; }
.bar > i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; }
.bar > span { position: absolute; left: 4px; right: 4px; top: -1px; line-height: 12px; font-size: 9.5px; display: flex; justify-content: space-between; text-shadow: 0 0 3px #000; }
.bar.hull > i { background: #3fae5a; }
.bar.shield > i { background: #3f8fe0; }
.bar.energy > i { background: #d9a52b; }
.room { display: flex; align-items: center; gap: 3px; margin-bottom: 2px; font-size: 9.5px; }
.room .rname { width: 12px; flex-shrink: 0; color: #8fa4cc; }
.room .mbar { position: relative; flex: 1; height: 9px; background: #101a2c; border: 1px solid #24304a; border-radius: 2px; overflow: hidden; }
.room .mbar > i { position: absolute; left: 0; top: 0; bottom: 0; background: #59b8ff; }
.room .pct { width: 24px; text-align: right; color: #8fa4cc; flex-shrink: 0; }
.room .fire { width: 24px; text-align: right; color: #ff6a3a; flex-shrink: 0; visibility: hidden; }
.room .fire.on { visibility: visible; }
.drow { display: flex; align-items: center; gap: 4px; margin-bottom: 3px; font-size: 9.5px; }
.drow .dlabel { flex: 1; color: #8fa4cc; }
.drow button { width: 58px; padding: 1px 4px; }
.drow button.on { border-color: #63e07a; color: #63e07a; background: #12301e; }
.drow button.destroyed { border-color: #ff5a4a; color: #ff5a4a; background: #301414; cursor: default; }
.deckhint { color: #8fa4cc; font-size: 9.5px; }
.crow { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; font-size: 9.5px; }
.crow .cdot { width: 7px; height: 7px; border-radius: 2px; flex-shrink: 0; }
.crow .cname { color: #cfe0ff; width: 62px; flex-shrink: 0; }
.crow .cstate { color: #8fa4cc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wrow { display: flex; align-items: center; gap: 3px; margin-bottom: 3px; }
.wrow .wname { width: 46px; padding: 2px 4px; }
.wrow .wname.sel { border-color: #ffb347; color: #ffb347; background: #3a2a10; }
.wrow .wstate { flex: 1; color: #8fa4cc; font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wrow .wstate.off { color: #6a4a4a; }
.wrow .wtoggle { width: 34px; padding: 2px 4px; }
.wrow .wtoggle.on { border-color: #63e07a; color: #63e07a; background: #12301e; }
.tinfo { color: #ffb0a0; font-size: 9.5px; min-height: 12px; white-space: pre; margin-bottom: 4px; }
#overlay { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; pointer-events: none; }
#overlay .box { pointer-events: auto; text-align: center; background: rgba(8,12,22,.9); border: 1px solid #2c3d63; border-radius: 12px; padding: 22px 34px; }
#overlay h2 { margin: 0 0 12px; font-size: 26px; letter-spacing: .12em; }
#overlay h2.won { color: #63e07a; }
#overlay h2.lost { color: #ff5a4a; }
#overlay button { margin: 0 4px; padding: 6px 14px; font-size: 13px; }
#hint { left: 8px; bottom: 8px; color: #7f95bf; font-size: 9.5px; max-width: 340px; pointer-events: none; }
#panelToggle { position: fixed; right: 8px; bottom: 8px; pointer-events: auto; background: rgba(10,14,24,.85); color: #cfe0ff; border: 1px solid #2a3a5c; border-radius: 6px; padding: 3px 10px; font: inherit; font-size: 10px; cursor: pointer; z-index: 5; }
.collapsed #left, .collapsed #controls, .collapsed #hint { display: none; }

/* ---- phone / touch layout: status strip on top, tabbed toolbar at the bottom, details in a sheet ---- */
#hud.mobile { font-size: 12px; }
#hud.mobile .panel button { font-size: 12px; padding: 6px 9px; min-height: 34px; touch-action: manipulation; }
#hud.mobile .panel h4 { font-size: 11px; }
#hud.mobile .panel h5 { font-size: 10.5px; }
#hud.mobile .panel .row { gap: 6px; margin-bottom: 8px; }
#hud.mobile .bar { height: 17px; }
#hud.mobile .bar > span { line-height: 17px; font-size: 11px; }
#hud.mobile .wrow .wname, #hud.mobile .wrow .wtoggle { width: auto; min-width: 56px; }
#hud.mobile .drow button { width: auto; min-width: 72px; }
#hud.mobile .scrollbox { max-height: none; }
#hud.mobile #runscreen button { padding: 10px 14px; font-size: 13px; }
#hud.mobile #overlay button { padding: 10px 16px; }
#hud.mobile .panel label span { width: auto; }

#mstatus { position: fixed; left: 0; right: 0; top: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; border-radius: 0 0 10px 10px; border-top: none;
  padding: calc(6px + env(safe-area-inset-top, 0px)) max(8px, env(safe-area-inset-right, 0px)) 6px max(8px, env(safe-area-inset-left, 0px)); }
#mstatus .bar { margin: 0; height: 16px; }
#mstatus .bar > span { font-size: 10.5px; line-height: 16px; left: 3px; right: 3px; }
#mstatus[hidden], #mbar[hidden] { display: none; }

#mbar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; gap: 6px; border-radius: 10px 10px 0 0; border-bottom: none;
  padding: 6px max(8px, env(safe-area-inset-right, 0px)) calc(4px + env(safe-area-inset-bottom, 0px)) max(8px, env(safe-area-inset-left, 0px)); }
#mbar .mpage { display: flex; flex-direction: column; gap: 6px; }
#mbar .mpage[hidden] { display: none; }
#mbar .mrow { display: flex; gap: 5px; align-items: center; overflow-x: auto; scrollbar-width: none; margin: 0; padding-bottom: 1px; }
#mbar .mrow::-webkit-scrollbar { display: none; }
/* Rows that run off the edge fade out there, hinting they scroll sideways. */
#mbar .mrow.scroll { -webkit-mask-image: linear-gradient(to right, #000 85%, transparent); mask-image: linear-gradient(to right, #000 85%, transparent); padding-right: 24px; }
#mbar .mrow > * { flex: 0 0 auto; }
#mbar .mlabel { color: #5f759f; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; margin-right: 2px; }
#hud.mobile #mbar button { min-height: 32px; padding: 4px 9px; font-size: 11.5px; }
#hud.mobile #mbar button.icon { width: 38px; height: 38px; min-height: 0; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
#mbar button.icon svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
#mbar button.icon svg .f { fill: currentColor; stroke: none; }
#mbar .mrow.icons { justify-content: space-between; }
#mbar .sliders { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 4px 12px; }
#mbar .sliders label { display: flex; align-items: center; gap: 6px; }
#mbar .sliders label span { color: #8fa4cc; font-size: 10.5px; }
#mbar .sliders input[type=range] { flex: 1; min-width: 0; accent-color: #59e6ff; }
#mbar .sliders .val { width: 30px; text-align: right; font-size: 10.5px; }
#mbar .mtabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) 40px; gap: 4px; border-top: 1px solid #202c46; padding-top: 5px; }
#hud.mobile #mbar .mtabs button.info { font-style: italic; font-weight: 700; font-family: Georgia, 'Times New Roman', serif; font-size: 14px; padding: 0; }
#mbar .help { max-height: min(42vh, 320px); overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 8px; padding-right: 2px; }
#mbar .help h6 { margin: 4px 0 0; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; color: #5f759f; font-weight: 600; }
#mbar .help .hitem { display: grid; grid-template-columns: 30px 1fr; gap: 8px; align-items: start; font-size: 11.5px; line-height: 1.4; color: #8fa4cc; }
#mbar .help .hitem b { color: #cfe0ff; font-weight: 600; }
#mbar .help .hico { width: 30px; height: 30px; border: 1px solid #2a3a5c; border-radius: 5px; background: #182238; color: #cfe0ff; display: flex; align-items: center; justify-content: center; font-size: 10px; }
#mbar .help .hico svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
#mbar .help .hico svg .f { fill: currentColor; stroke: none; }
#hud.mobile #mbar .mtabs button { min-height: 30px; font-size: 11px; background: transparent; border-color: transparent; color: #7f95bf; }
#hud.mobile #mbar .mtabs button.on { color: #59e6ff; border-color: #2a4a66; background: #14304a; }

#sheet { position: fixed; left: 0; right: 0; bottom: var(--mbar-h, 140px); top: auto; max-height: 55vh; display: flex; flex-direction: column; border-radius: 10px 10px 0 0; padding: 8px 10px; }
#sheet[hidden] { display: none; }
#sheet .tabs { display: flex; gap: 6px; margin-bottom: 8px; flex-shrink: 0; }
#sheet .tabs button { flex: 1 1 0; }
#sheet .tabs button.close { flex: 0 0 auto; min-width: 44px; }
#sheet .tabbody { overflow-y: auto; flex: 1; min-height: 0; overscroll-behavior: contain; }
#sheet .tabbody > div[hidden] { display: none; }
#sheet .tabbody .panel { position: static; width: auto; max-height: none; overflow: visible; border: none; background: none; padding: 0; backdrop-filter: none; }
#sheet .tabbody .panel + .panel { margin-top: 10px; border-top: 1px solid #202c46; padding-top: 8px; border-radius: 0; }
#sheet #hint { max-width: none; color: #7f95bf; }
#sheet #combat > h4, #sheet #combat > .bar { display: none; } /* already in the status strip */
@media (orientation: landscape) {
  #mstatus { left: 50%; right: auto; width: min(560px, 70vw); transform: translateX(-50%); }
  #mbar { left: 50%; right: auto; width: min(620px, 94vw); transform: translateX(-50%); }
  #sheet { left: auto; top: var(--top-h, 30px); bottom: var(--mbar-h, 140px); width: min(360px, 50vw); max-height: none; border-radius: 10px 0 0 10px; }
}
`;

/** Line icons for the phone toolbar (24×24, stroked in the button's text colour). */
const ICONS = {
  autopilot: '<circle cx="12" cy="12" r="8.5"/><path class="f" d="M12 6.2l3.4 9.6-3.4-2.1-3.4 2.1z"/>',
  pause: '<path d="M9 6.5v11M15 6.5v11"/>',
  slow: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v4.8l3 1.8"/>',
  lock: '<circle cx="12" cy="12" r="6"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle class="f" cx="12" cy="12" r="1.6"/>',
  untarget: '<circle cx="12" cy="12" r="6"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
  follow: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle class="f" cx="12" cy="12" r="2.4"/>',
  panels: '<path d="M5 7h14M5 12h14M5 17h9"/>',
};

/** Phones and tablets: a finger is the pointer, or the screen is too small for the desktop panels. */
export function isTouchLayout(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;
}

interface BtnOpts {
  toggle?: boolean;
}

interface BarEls {
  root: HTMLDivElement;
  fill: HTMLElement;
  left: HTMLSpanElement;
  right: HTMLSpanElement;
}

function makeBar(cls: string): BarEls {
  const root = document.createElement('div');
  root.className = `bar ${cls}`;
  const fill = document.createElement('i');
  const label = document.createElement('span');
  const left = document.createElement('span');
  const right = document.createElement('span');
  label.append(left, right);
  root.append(fill, label);
  return { root, fill, left, right };
}

interface WeaponEls {
  id: number;
  row: HTMLDivElement;
  name: HTMLButtonElement;
  state: HTMLSpanElement;
  toggle: HTMLButtonElement;
}

interface RoomEls {
  id: number;
  row: HTMLDivElement;
  name: HTMLSpanElement;
  pressureBar: HTMLElement;
  pct: HTMLSpanElement;
  fire: HTMLSpanElement;
}

interface DoorEls {
  id: number;
  label: HTMLSpanElement;
  btn: HTMLButtonElement;
}

interface CrewEls {
  id: number;
  dot: HTMLSpanElement;
  name: HTMLSpanElement;
  state: HTMLSpanElement;
}

const ROLE_LABEL: Record<string, string> = { pilot: 'Пилот', gunner: 'Арт.', shieldop: 'Щит', engineer: 'Инж.' };
const TASK_LABEL: Record<string, string> = { atPost: 'на посту', toPost: 'к посту', seal: 'герметизирует', extinguish: 'тушит', flee: 'бежит', idle: 'свободен', ejected: 'ВЫБРОШЕН В ПРОБОИНУ', wander: 'бродит' };
const ROLE_DOT: Record<string, string> = { pilot: '#ffffff', gunner: '#ffb347', shieldop: '#6a86ff', engineer: '#ffe066' };

export class Hud {
  private game: Game;
  private stats: HTMLDivElement;
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private layerBtns: HTMLButtonElement[] = [];
  private shipBtns = new Map<string, HTMLButtonElement>();
  private scenarioBtns = new Map<string, HTMLButtonElement>();
  private sectorBtns = new Map<string, HTMLButtonElement>();
  private priorityBtns = new Map<string, HTMLButtonElement>();
  private toggles: Array<{ el: HTMLButtonElement; get: () => boolean }> = [];
  private hull = makeBar('hull');
  private shield = makeBar('shield');
  private energy = makeBar('energy');
  private targetInfo = document.createElement('div');
  private weaponBox = document.createElement('div');
  private weaponEls: WeaponEls[] = [];
  private weaponKey = '';
  private overlay = document.createElement('div');
  private overlayTitle = document.createElement('h2');
  private sandboxButtons = document.createElement('div');
  private runButton = document.createElement('button');
  private runScreen: RunScreen;
  private compartBody = document.createElement('div');
  private compartKey = '';
  private roomEls: RoomEls[] = [];
  private doorEls: DoorEls[] = [];
  private crewBody = document.createElement('div');
  private crewKey = '';
  private crewEls: CrewEls[] = [];
  private last = 0;
  /** Phone layout: compact copies of the status bars, kept in step with the full ones. */
  private mirrors = new Map<BarEls, { copy: BarEls; label: string }>();
  private mbar: HTMLDivElement | null = null;
  private mstatus: HTMLDivElement | null = null;
  /** Phone-only controls that are unavailable in some states (sandbox-only tools in a run). */
  private disablers: Array<{ el: HTMLButtonElement; get: () => boolean }> = [];
  private mDecks: Array<{ el: HTMLButtonElement; idx: number }> = [];

  constructor(game: Game, root: HTMLElement) {
    this.game = game;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const section = (container: HTMLElement, title: string): HTMLDivElement => {
      const h = document.createElement('h4');
      h.textContent = title;
      container.appendChild(h);
      const row = document.createElement('div');
      row.className = 'row';
      container.appendChild(row);
      return row;
    };
    const subsection = (container: HTMLElement, title: string): HTMLDivElement => {
      const h = document.createElement('h5');
      h.textContent = title;
      container.appendChild(h);
      const row = document.createElement('div');
      row.className = 'row';
      container.appendChild(row);
      return row;
    };
    const button = (row: HTMLElement, label: string, onClick: () => void, opts: BtnOpts = {}): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', onClick);
      if (opts.toggle) b.dataset.toggle = '1';
      row.appendChild(b);
      return b;
    };
    const slider = (row: HTMLElement, label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void): void => {
      const l = document.createElement('label');
      const s = document.createElement('span');
      s.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      const v = document.createElement('span');
      v.className = 'val';
      v.textContent = String(value);
      input.addEventListener('input', () => {
        v.textContent = input.value;
        onChange(Number(input.value));
      });
      l.append(s, input, v);
      row.appendChild(l);
    };
    const flag = (row: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void): void => {
      const b = button(row, label, () => set(!get()), { toggle: true });
      this.toggles.push({ el: b, get });
    };

    // ---- LEFT: the in-game HUD (what a player would eventually see) ----
    const left = document.createElement('div');
    left.id = 'left';
    root.appendChild(left);

    const combat = document.createElement('div');
    combat.id = 'combat';
    combat.className = 'panel';
    const ch = document.createElement('h4');
    ch.textContent = 'Бой';
    this.targetInfo.className = 'tinfo';
    combat.append(ch, this.hull.root, this.shield.root, this.energy.root, this.targetInfo);
    const power = subsection(combat, 'Энергия и цели');
    this.priorityBtns.set('shield', button(power, 'Щит', () => this.game.setPriority('shield')));
    this.priorityBtns.set('weapons', button(power, 'Оружие', () => this.game.setPriority('weapons')));
    const lockBtn = button(power, 'Нос → цель', () => this.game.setLockFace(!this.game.world.lockFace), { toggle: true });
    this.toggles.push({ el: lockBtn, get: () => this.game.world.lockFace });
    button(power, 'Снять цель', () => this.game.clearTargets());
    const wh = document.createElement('h5');
    wh.textContent = 'Орудия';
    combat.append(wh, this.weaponBox);
    left.appendChild(combat);

    const runMode = document.createElement('div');
    runMode.className = 'panel';
    const rmRow = section(runMode, 'Управление');
    flag(rmRow, 'Пауза', () => game.paused, (v) => (game.paused = v));
    flag(rmRow, 'Замедление', () => game.slowMo, (v) => (game.slowMo = v));
    flag(rmRow, 'Автопилот', () => game.world.autopilot, (v) => (game.world.autopilot = v));
    left.appendChild(runMode);

    const ship = document.createElement('div');
    ship.className = 'panel';
    const layers = section(ship, 'Палуба');
    const names = ['Вне', 'Обш.', 'П1', 'П2', 'П3'];
    for (let i = 0; i < names.length; i++) {
      const idx = i === 0 ? OUTER_VIEW : i - 1;
      this.layerBtns.push(button(layers, names[i], () => (this.game.scene.layerView = idx)));
    }
    subsection(ship, 'Отсеки');
    const compartScroll = document.createElement('div');
    compartScroll.className = 'scrollbox';
    compartScroll.appendChild(this.compartBody);
    ship.appendChild(compartScroll);
    subsection(ship, 'Экипаж');
    const crewScroll = document.createElement('div');
    crewScroll.className = 'scrollbox';
    crewScroll.appendChild(this.crewBody);
    ship.appendChild(crewScroll);
    left.appendChild(ship);

    // ---- RIGHT: development / testing tools ----
    const controls = document.createElement('div');
    controls.id = 'controls';
    controls.className = 'panel';
    root.appendChild(controls);

    this.stats = document.createElement('div');
    this.stats.id = 'stats';
    subsection(controls, 'Статы');
    controls.appendChild(this.stats);

    const scen = subsection(controls, 'Сценарий');
    button(scen, 'Главное меню', () => (this.game.screen = 'title'));
    button(scen, 'Забег (док)', () => this.game.openDock());
    for (const sc of SCENARIOS) this.scenarioBtns.set(sc.id, button(scen, sc.label, () => this.game.reset(undefined, sc.id)));

    const sectors = subsection(controls, 'Сектор');
    for (const id of SECTOR_IDS) this.sectorBtns.set(id, button(sectors, SECTORS[id].name, () => this.game.setSector(id)));

    const ships = subsection(controls, 'Корабль игрока');
    for (const s of SHIPS) this.shipBtns.set(s.id, button(ships, s.label, () => this.game.reset(s.id)));
    button(ships, 'Заново', () => this.game.reset());

    const tools = subsection(controls, 'Инструмент (ЛКМ)');
    this.toolBtns.set('fly', button(tools, 'Полёт / цель', () => this.setTool('fly')));
    this.toolBtns.set('crater', button(tools, 'Удар: кратер', () => this.setTool('crater')));
    slider(tools, 'Радиус', 1, 14, 0.5, game.crater.radius, (v) => (game.crater.radius = v));
    slider(tools, 'Урон', 5, 300, 5, game.crater.damage, (v) => (game.crater.damage = v));
    slider(tools, 'Пробитие', 0, 1, 0.05, game.crater.pen, (v) => (game.crater.pen = v));

    const sandbox = subsection(controls, 'Песочница');
    button(sandbox, '+ Мишень', () => this.game.spawnTarget());
    button(sandbox, 'Сломать двиг.', () => this.game.breakEngine());

    const devFlags = subsection(controls, 'Режимы (dev)');
    flag(devFlags, 'Следить', () => game.scene.follow, (v) => (game.scene.follow = v));
    flag(devFlags, 'Отладка', () => game.scene.showDebug, (v) => (game.scene.showDebug = v));

    const hint = document.createElement('div');
    hint.id = 'hint';
    hint.className = 'panel';
    hint.textContent = 'ЛКМ по врагу — цель; по пустому месту — лететь. ПКМ+drag — камера. Колесо — масштаб.';
    root.appendChild(hint);

    this.overlay.id = 'overlay';
    const box = document.createElement('div');
    box.className = 'box';
    const again = document.createElement('button');
    again.textContent = 'Ещё раз';
    again.addEventListener('click', () => this.game.reset());
    const sandboxBtn = document.createElement('button');
    sandboxBtn.textContent = 'В песочницу';
    sandboxBtn.addEventListener('click', () => this.game.reset(undefined, 'sandbox'));
    this.sandboxButtons.append(again, sandboxBtn);
    this.runButton.addEventListener('click', () => this.game.continueRun());
    box.append(this.overlayTitle, this.sandboxButtons, this.runButton);
    this.overlay.appendChild(box);
    root.appendChild(this.overlay);
    this.runScreen = new RunScreen(game, root);

    const toggle = document.createElement('button');
    toggle.id = 'panelToggle';
    toggle.textContent = 'Панели';
    toggle.addEventListener('click', () => root.classList.toggle('collapsed'));
    root.appendChild(toggle);

    if (isTouchLayout()) this.buildPhoneLayout(root, { left, toggle, combat, ship, controls, hint, button });

    this.setTool('fly');
  }

  /**
   * Phone layout: the status bars in one strip at the top; at the bottom a toolbar with
   * three tabs — ship control (icon buttons and decks), the scene around the ship (add
   * enemies, allies, targets; scenarios and ships), and destruction (the crater tool);
   * the detailed panels (weapons, compartments, crew, stats) open as a sheet.
   */
  private buildPhoneLayout(
    root: HTMLElement,
    parts: {
      left: HTMLElement;
      toggle: HTMLElement;
      combat: HTMLElement;
      ship: HTMLElement;
      controls: HTMLElement;
      hint: HTMLElement;
      button: (row: HTMLElement, label: string, onClick: () => void) => HTMLButtonElement;
    },
  ): void {
    const g = this.game;
    const { button } = parts;
    root.classList.add('mobile');
    parts.hint.textContent = 'Тап по врагу — цель; по пустому месту — лететь. Палец — камера, два пальца — масштаб.';
    const on = (el: HTMLButtonElement, get: () => boolean) => this.toggles.push({ el, get });
    const row = (parent: HTMLElement, cls = 'mrow', label?: string) => {
      const r = document.createElement('div');
      r.className = cls;
      if (label) {
        const l = document.createElement('span');
        l.className = 'mlabel';
        l.textContent = label;
        r.appendChild(l);
      }
      parent.appendChild(r);
      return r;
    };
    const icon = (parent: HTMLElement, name: keyof typeof ICONS, title: string, onClick: () => void) => {
      const b = button(parent, '', onClick);
      b.className = 'icon';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
      return b;
    };

    // ---- top: status strip ----
    const status = document.createElement('div');
    status.id = 'mstatus';
    status.className = 'panel';
    const labels = ['Корп', 'Щит', 'Эн'];
    [this.hull, this.shield, this.energy].forEach((full, i) => {
      const copy = makeBar(full.root.className.replace('bar ', ''));
      this.mirrors.set(full, { copy, label: labels[i] });
      status.appendChild(copy.root);
    });

    // ---- bottom: tabbed toolbar ----
    const bar = document.createElement('div');
    bar.id = 'mbar';
    bar.className = 'panel';
    const pages: HTMLDivElement[] = [];
    const page = () => {
      const p = document.createElement('div');
      p.className = 'mpage';
      bar.appendChild(p);
      pages.push(p);
      return p;
    };

    // Tab 1: ship control.
    const ctl = page();
    const icons = row(ctl, 'mrow icons');
    on(icon(icons, 'autopilot', 'Автопилот', () => (g.world.autopilot = !g.world.autopilot)), () => g.world.autopilot);
    on(icon(icons, 'pause', 'Пауза', () => (g.paused = !g.paused)), () => g.paused);
    on(icon(icons, 'slow', 'Замедление', () => (g.slowMo = !g.slowMo)), () => g.slowMo);
    on(icon(icons, 'lock', 'Нос → цель', () => g.setLockFace(!g.world.lockFace)), () => g.world.lockFace);
    icon(icons, 'untarget', 'Снять цель', () => g.clearTargets());
    on(icon(icons, 'follow', 'К кораблю', () => (g.scene.follow = !g.scene.follow)), () => g.scene.follow);
    const sheetBtn = icon(icons, 'panels', 'Панели: орудия, отсеки, экипаж', () => (sheet.hidden = !sheet.hidden));
    on(sheetBtn, () => !sheet.hidden);
    const decks = row(ctl, 'mrow', 'Палуба');
    ['Вне', 'Обшивка', 'П1', 'П2', 'П3'].forEach((label, i) => {
      const idx = i === 0 ? OUTER_VIEW : i - 1;
      this.mDecks.push({ el: button(decks, label, () => (g.scene.layerView = idx)), idx });
    });

    // Tab 2: the scene around the ship (sandbox).
    const env = page();
    const add = row(env, 'mrow scroll', 'Добавить');
    const sandboxOnly = (b: HTMLButtonElement) => this.disablers.push({ el: b, get: () => g.mode === 'run' });
    sandboxOnly(button(add, '+ Разведчик', () => g.spawnShip('scout')));
    sandboxOnly(button(add, '+ Налётчик', () => g.spawnShip('raider')));
    sandboxOnly(button(add, '+ Охотник', () => g.spawnShip('hunter')));
    sandboxOnly(button(add, '+ Линкор-босс', () => g.spawnShip('boss')));
    sandboxOnly(button(add, '+ Союзник', () => g.spawnShip('raider', true)));
    sandboxOnly(button(add, '+ Мишень', () => g.spawnTarget()));
    sandboxOnly(button(add, 'Убрать всех', () => g.clearScene()));
    const scen = row(env, 'mrow scroll', 'Сцена');
    for (const sc of SCENARIOS) on(button(scen, sc.label, () => g.reset(undefined, sc.id)), () => g.mode === 'sandbox' && g.scenarioId === sc.id);
    button(scen, 'Меню', () => (g.screen = 'title'));
    button(scen, 'Заново', () => g.reset());
    button(scen, 'Док', () => g.openDock());
    const sectors = row(env, 'mrow scroll', 'Сектор');
    for (const id of SECTOR_IDS) on(button(sectors, SECTORS[id].name.split(' ')[0], () => g.setSector(id)), () => g.mode === 'sandbox' && g.sandboxSector === id);
    const ships = row(env, 'mrow scroll', 'Корабль');
    for (const sp of SHIPS) on(button(ships, sp.label, () => g.reset(sp.id)), () => g.mode === 'sandbox' && g.shipId === sp.id);

    // Tab 3: destruction.
    const dmg = page();
    const tools = row(dmg, 'mrow');
    on(button(tools, 'Полёт / цель', () => this.setTool('fly')), () => g.tool === 'fly');
    on(button(tools, 'Удар: кратер', () => this.setTool('crater')), () => g.tool === 'crater');
    sandboxOnly(button(tools, 'Сломать двигатель', () => g.breakEngine()));
    const sliders = row(dmg, 'sliders');
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      const l = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(get());
      const v = document.createElement('span');
      v.className = 'val';
      v.textContent = String(get());
      input.addEventListener('input', () => {
        set(Number(input.value));
        v.textContent = input.value;
      });
      l.append(name, input, v);
      sliders.appendChild(l);
    };
    slider('Радиус', 1, 14, 0.5, () => g.crater.radius, (v) => (g.crater.radius = v));
    slider('Урон', 5, 300, 5, () => g.crater.damage, (v) => (g.crater.damage = v));
    slider('Пробитие', 0, 1, 0.05, () => g.crater.pen, (v) => (g.crater.pen = v));

    // Tab 4: help — what every icon and gesture does.
    const help = document.createElement('div');
    help.className = 'help';
    page().appendChild(help);
    const heading = (text: string) => {
      const h = document.createElement('h6');
      h.textContent = text;
      help.appendChild(h);
    };
    const item = (mark: keyof typeof ICONS | string, title: string, text: string) => {
      const it = document.createElement('div');
      it.className = 'hitem';
      const ico = document.createElement('span');
      ico.className = 'hico';
      if (mark in ICONS) ico.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[mark as keyof typeof ICONS]}</svg>`;
      else ico.textContent = mark;
      const t = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = title;
      t.append(b, document.createTextNode(` — ${text}`));
      it.append(ico, t);
      help.appendChild(it);
    };
    heading('Жесты');
    item('☝', 'Тап', 'по врагу — выбрать его целью (нос и орудия наводятся на него); по пустому месту — лететь туда. В режиме «Удар: кратер» тап взрывает точку.');
    item('↔', 'Палец по экрану', 'двигает камеру. Камера перестаёт следовать за кораблём — вернуть её можно значком «К кораблю».');
    item('⤢', 'Два пальца', 'сведите или разведите — масштаб; камера двигается вслед за пальцами.');
    heading('Строка сверху');
    item('Корп', 'Корпус', 'сколько корабля осталось. Корабль гибнет, когда остаётся пятая часть корпуса или меньше — или когда взрывается реактор.');
    item('Щит', 'Щит', 'заряд щита; стрелка ↓ — щит упал и восстанавливается.');
    item('Эн', 'Энергия', 'запас энергии и сколько реактор даёт в секунду; её тратят орудия и щит.');
    heading('Управление');
    item('autopilot', 'Автопилот', 'включён: корабль летит к точке и останавливается на ней. Выключен: долетает до точки, точка пропадает, корабль летит дальше с набранной скоростью.');
    item('pause', 'Пауза', 'останавливает время. Приказы (точка, цель, двери) можно отдавать и на паузе.');
    item('slow', 'Замедление', 'время идёт вчетверо медленнее — удобно в горячем бою.');
    item('lock', 'Нос → цель', 'нос всё время смотрит на выбранного врага, а к точке корабль летит боком или задом на соплах. Выключено — нос смотрит туда, куда летим.');
    item('untarget', 'Снять цель', 'сбрасывает цель корабля и всех орудий; они снова выбирают ближайшего врага сами.');
    item('follow', 'К кораблю', 'камера снова следует за кораблём.');
    item('panels', 'Панели', 'подробности: орудия и приоритет энергии, отсеки и двери, экипаж, статистика.');
    item('П1', 'Палуба', '«Вне» — корабль снаружи, «Обшивка» — внешний слой, П1–П3 — палубы внутри: отсеки, экипаж, пожары. Серые кнопки — таких палуб на корабле нет.');
    heading('Окружение (песочница)');
    item('+', 'Добавить', 'разведчик, налётчик, охотник за реактором, линкор-босс — враги; союзник — истребитель на вашей стороне; мишень — неподвижная цель для стрельбы.');
    item('✕', 'Убрать всех', 'оставляет на сцене только ваш корабль.');
    item('▶', 'Сцена и корабль', '«Меню» — главное меню; готовые сценарии боя, «Заново», выход в док, смена своего корабля.');
    item('◌', 'Сектор', 'небо и планета арены: туманность, пыль, огромная планета у края поля (отдалите камеру — её видно), в багровом секторе ещё и чёрная дыра.');
    heading('Разрушение');
    item('✺', 'Удар: кратер', 'тап взрывает точку с заданным радиусом, уроном и пробитием (насколько глубоко уходит в палубы). «Полёт / цель» возвращает обычное управление.');
    item('⚙', 'Сломать двигатель', 'выбивает случайный двигатель корабля — посмотреть, как он летит без него.');

    const tabs = row(bar, 'mtabs');
    const tabBtns = ['Управление', 'Окружение', 'Разрушение', 'i'].map((label, n) =>
      button(tabs, label, () => {
        pages.forEach((p, i) => (p.hidden = i !== n));
        tabBtns.forEach((b, i) => b.classList.toggle('on', i === n));
      }),
    );
    tabBtns[3].className = 'info';
    tabBtns[3].title = 'Справка';
    tabBtns[3].setAttribute('aria-label', 'Справка');
    tabBtns[0].click();

    // ---- details sheet: weapons, compartments, crew, dev stats ----
    const sheet = document.createElement('div');
    sheet.id = 'sheet';
    sheet.className = 'panel';
    sheet.hidden = true;
    const stabs = document.createElement('div');
    stabs.className = 'tabs';
    const body = document.createElement('div');
    body.className = 'tabbody';
    sheet.append(stabs, body);
    const sheetPages: Array<[string, HTMLElement[]]> = [
      ['Бой', [parts.combat, parts.hint]],
      ['Корабль', [parts.ship]],
      ['Статы', [parts.controls]],
    ];
    const sBtns: HTMLButtonElement[] = [];
    const sEls: HTMLDivElement[] = [];
    const show = (n: number) => {
      sEls.forEach((p, i) => (p.hidden = i !== n));
      sBtns.forEach((b, i) => b.classList.toggle('on', i === n));
    };
    sheetPages.forEach(([label, els], n) => {
      const p = document.createElement('div');
      for (const el of els) p.appendChild(el);
      body.appendChild(p);
      sEls.push(p);
      sBtns.push(button(stabs, label, () => show(n)));
    });
    button(stabs, '✕', () => (sheet.hidden = true)).className = 'close';
    show(0);

    parts.left.remove();
    parts.toggle.remove();
    root.append(status, sheet, bar);
    this.mbar = bar;
    this.mstatus = status;
    // The sheet sits between the strip and the toolbar; keep it there as they resize.
    const place = () => {
      root.style.setProperty('--mbar-h', `${bar.offsetHeight}px`);
      root.style.setProperty('--top-h', `${status.offsetHeight}px`);
    };
    const ro = new ResizeObserver(place);
    ro.observe(bar);
    ro.observe(status);
    place();
  }

  private setTool(t: Tool): void {
    this.game.tool = t;
    this.game.scene.craterPreview = 0;
  }

  private rebuildWeapons(): void {
    const rows = this.game.weaponRows();
    const key = rows.map((r) => r.weapon.id).join(',');
    if (key === this.weaponKey) return;
    this.weaponKey = key;
    this.weaponBox.replaceChildren();
    this.weaponEls = [];
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'wrow';
      const name = document.createElement('button');
      name.className = 'wname';
      name.textContent = r.weapon.name;
      name.addEventListener('click', () => this.game.selectWeapon(r.weapon.id));
      const state = document.createElement('span');
      state.className = 'wstate';
      const toggle = document.createElement('button');
      toggle.className = 'wtoggle';
      toggle.addEventListener('click', () => this.game.toggleWeapon(r.weapon.id));
      row.append(name, state, toggle);
      this.weaponBox.appendChild(row);
      this.weaponEls.push({ id: r.weapon.id, row, name, state, toggle });
    }
  }

  private setBar(bar: BarEls, frac: number, left: string, right: string): void {
    bar.fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    bar.left.textContent = left;
    bar.right.textContent = right;
    const m = this.mirrors.get(bar);
    if (m) this.setBar(m.copy, frac, left.includes('упал') ? `${m.label}↓` : m.label, right);
  }

  update(now: number): void {
    const g = this.game;
    g.scene.craterPreview = g.tool === 'crater' ? g.crater.radius : 0;
    for (const [t, b] of this.toolBtns) b.classList.toggle('on', g.tool === t);
    for (const [id, b] of this.shipBtns) b.classList.toggle('on', g.mode === 'sandbox' && g.shipId === id);
    for (const [id, b] of this.scenarioBtns) b.classList.toggle('on', g.mode === 'sandbox' && g.scenarioId === id);
    for (const [id, b] of this.sectorBtns) b.classList.toggle('on', g.mode === 'sandbox' && g.sandboxSector === id);
    const pri = g.world.player?.sys?.priority;
    for (const [id, b] of this.priorityBtns) b.classList.toggle('on', pri === id);
    const depth = g.world.player?.grid.depth ?? 0;
    this.layerBtns.forEach((b, i) => {
      const idx = i === 0 ? OUTER_VIEW : i - 1;
      b.classList.toggle('on', idx === g.scene.layerView);
      b.disabled = idx >= 0 && idx >= depth;
      if (b.disabled && idx === g.scene.layerView) g.scene.layerView = OUTER_VIEW;
    });
    for (const t of this.toggles) t.el.classList.toggle('on', t.get());
    for (const w of this.weaponEls) w.name.classList.toggle('sel', g.selectedWeapon === w.id);

    const inRun = g.mode === 'run';
    const over = g.state !== 'playing' && (!inRun || g.runPhase === 'battle');
    this.overlay.style.display = over ? 'flex' : 'none';
    if (over) {
      const boss = g.run?.fighting?.kind === 'boss';
      this.overlayTitle.textContent = !inRun ? (g.state === 'won' ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ') : g.state === 'won' ? (boss ? 'РУБЕЖ ВЗЯТ' : 'БОЙ ВЫИГРАН') : 'КОРАБЛЬ УНИЧТОЖЕН';
      this.overlayTitle.className = g.state;
      this.sandboxButtons.style.display = inRun ? 'none' : '';
      this.runButton.style.display = inRun ? '' : 'none';
      this.runButton.textContent = g.state === 'won' ? 'На карту ▸' : 'Итоги забега';
    }
    this.runScreen.update();
    // The dock and the sector map are full screens of their own: no battle bar under them.
    if (this.mbar && this.mstatus) {
      const offScreen = g.mode === 'run' && g.runPhase !== 'battle';
      this.mbar.hidden = offScreen;
      this.mstatus.hidden = offScreen;
      for (const d of this.disablers) d.el.disabled = d.get();
      for (const d of this.mDecks) {
        d.el.classList.toggle('on', d.idx === g.scene.layerView);
        d.el.disabled = d.idx >= 0 && d.idx >= depth;
      }
    }

    if (now - this.last < 150) return;
    this.last = now;
    this.updateCombat();
    this.updateCompartmentsPanel();
    this.updateCrewPanel();
    this.updateStats();
  }

  private updateCompartmentsPanel(): void {
    const info = this.game.currentDeckCompartments();
    if (!info) {
      if (this.compartKey !== '') {
        this.compartKey = '';
        this.roomEls = [];
        this.doorEls = [];
        this.compartBody.replaceChildren();
        const hint = document.createElement('div');
        hint.className = 'deckhint';
        hint.textContent = 'Выберите палубу выше.';
        this.compartBody.appendChild(hint);
      }
      return;
    }

    const nameOf = (i: number): string => String.fromCharCode(65 + (i % 26));
    const roomIndex = new Map(info.rooms.map((r, i) => [r.id, i]));
    const key = `${info.rooms.map((r) => r.id).join(',')}|${info.doors.map((d) => d.id).join(',')}`;
    if (key !== this.compartKey) {
      this.compartKey = key;
      this.compartBody.replaceChildren();
      this.roomEls = [];
      this.doorEls = [];
      info.rooms.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'room';
        const name = document.createElement('span');
        name.className = 'rname';
        name.textContent = nameOf(i);
        const mbar = document.createElement('div');
        mbar.className = 'mbar';
        const fill = document.createElement('i');
        mbar.appendChild(fill);
        const pct = document.createElement('span');
        pct.className = 'pct';
        const fire = document.createElement('span');
        fire.className = 'fire';
        fire.textContent = '🔥';
        row.append(name, mbar, pct, fire);
        this.compartBody.appendChild(row);
        this.roomEls.push({ id: r.id, row, name, pressureBar: fill, pct, fire });
      });
      for (const d of info.doors) {
        const row = document.createElement('div');
        row.className = 'drow';
        const label = document.createElement('span');
        label.className = 'dlabel';
        const btn = document.createElement('button');
        btn.addEventListener('click', () => this.game.toggleDoor(d.id));
        row.append(label, btn);
        this.compartBody.appendChild(row);
        this.doorEls.push({ id: d.id, label, btn });
      }
    }

    for (const el of this.roomEls) {
      const r = info.rooms[roomIndex.get(el.id) ?? -1];
      if (!r) continue;
      el.pressureBar.style.width = `${Math.max(0, Math.min(1, r.pressure)) * 100}%`;
      el.pct.textContent = `${(r.pressure * 100).toFixed(0)}%`;
      el.fire.classList.toggle('on', r.fire > 0);
    }
    for (const el of this.doorEls) {
      const d = info.doors.find((x) => x.id === el.id);
      if (!d) continue;
      const ai = roomIndex.get(d.roomA) ?? -1;
      const bi = roomIndex.get(d.roomB) ?? -1;
      el.label.textContent = `${nameOf(ai)}↔${nameOf(bi)}`;
      if (d.destroyed) {
        el.btn.textContent = 'НЕТ';
        el.btn.className = 'destroyed';
        el.btn.disabled = true;
      } else {
        el.btn.disabled = false;
        el.btn.textContent = d.open ? 'ОТКР' : 'ЗАКР';
        el.btn.className = d.open ? 'on' : '';
      }
    }
  }

  private updateCrewPanel(): void {
    const crew = this.game.currentDeckCrew();
    if (!crew) {
      if (this.crewKey !== '') {
        this.crewKey = '';
        this.crewEls = [];
        this.crewBody.replaceChildren();
        const hint = document.createElement('div');
        hint.className = 'deckhint';
        hint.textContent = 'Выберите палубу выше.';
        this.crewBody.appendChild(hint);
      }
      return;
    }

    const key = crew.map((c) => `${c.id}:${c.role}:${c.homeModule}`).join(',');
    if (key !== this.crewKey) {
      this.crewKey = key;
      this.crewBody.replaceChildren();
      this.crewEls = [];
      if (crew.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'deckhint';
        hint.textContent = 'Никого нет.';
        this.crewBody.appendChild(hint);
      }
      for (const c of crew) {
        const row = document.createElement('div');
        row.className = 'crow';
        const dot = document.createElement('span');
        dot.className = 'cdot';
        dot.style.background = ROLE_DOT[c.role] ?? '#8fa4cc';
        const name = document.createElement('span');
        name.className = 'cname';
        name.textContent = ROLE_LABEL[c.role] ?? c.role;
        const state = document.createElement('span');
        state.className = 'cstate';
        row.append(dot, name, state);
        this.crewBody.appendChild(row);
        this.crewEls.push({ id: c.id, dot, name, state });
      }
    }
    for (const el of this.crewEls) {
      const c = crew.find((x) => x.id === el.id);
      if (!c) continue;
      el.state.textContent = (c.orphaned ? 'без поста, ' : '') + (TASK_LABEL[c.task] ?? c.task);
    }
  }

  private updateCombat(): void {
    const g = this.game;
    const p = g.world.player;
    const sys = p?.sys;
    if (!p || !sys) {
      this.setBar(this.hull, 0, 'Корпус', '—');
      this.setBar(this.shield, 0, 'Щит', '—');
      this.setBar(this.energy, 0, 'Энергия', '—');
      this.targetInfo.textContent = '';
      this.rebuildWeapons();
      return;
    }
    const hull = p.grid.cells / sys.cellsMax;
    this.setBar(this.hull, hull, 'Корпус', `${(hull * 100).toFixed(0)}%`);
    this.setBar(this.shield, sys.shieldMax > 0 ? sys.shield / sys.shieldMax : 0, sys.shieldDown ? 'Щит (упал)' : 'Щит', sys.shieldMax > 0 ? `${sys.shield.toFixed(0)}/${sys.shieldMax.toFixed(0)}` : '—');
    this.setBar(this.energy, sys.energyMax > 0 ? sys.energy / sys.energyMax : 0, `Энергия +${sys.gen.toFixed(0)}/с`, `${sys.energy.toFixed(0)}/${sys.energyMax.toFixed(0)}`);

    const ref = sys.focus ?? sys.autoTarget;
    const t = ref ? g.world.findShip(ref.shipId) : null;
    if (t?.sys) {
      const th = t.grid.cells / t.sys.cellsMax;
      const shield = t.sys.shieldMax > 0 ? ` · щит ${((t.sys.shield / t.sys.shieldMax) * 100).toFixed(0)}%${t.sys.shieldDown ? ' (упал)' : ''}` : '';
      const warn = t.sys.countdown >= 0 ? `\nРЕАКТОР: ${Math.max(0, t.sys.countdown).toFixed(1)}с` : '';
      this.targetInfo.textContent = `${sys.focus ? 'Цель' : 'Авто'}: ${t.sys.name} · ${(th * 100).toFixed(0)}%${shield}${warn}`;
    } else {
      this.targetInfo.textContent = 'Цели нет';
    }

    this.rebuildWeapons();
    const rows = g.weaponRows();
    for (const el of this.weaponEls) {
      const r = rows.find((x) => x.weapon.id === el.id);
      if (!r) continue;
      const w = r.weapon;
      const eff = moduleEfficiency(r.module);
      let text: string;
      if (eff <= 0) text = 'разрушена';
      else {
        const mode = w.target ? 'ручная' : sys.focus ? 'фокус' : 'авто';
        const act = w.firing ? '●' : w.cooldown > 0.05 ? '◌' : '';
        text = `${WEAPONS[w.type].short} · ${mode} ${act}`;
      }
      el.state.textContent = text;
      el.state.classList.toggle('off', eff <= 0 || !w.enabled);
      el.toggle.textContent = w.enabled ? 'ВКЛ' : 'ВЫКЛ';
      el.toggle.classList.toggle('on', w.enabled && eff > 0);
    }
  }

  private updateStats(): void {
    const g = this.game;
    const tot = g.totals();
    const p = g.world.player;
    const lines: string[] = [];
    lines.push(`FPS ${g.scene.app.ticker.FPS.toFixed(0)}  физ ${g.stepMs.toFixed(1)}мс`);
    lines.push(`тел ${tot.bodies} (обл. ${tot.debris})  клеток ${tot.cells}`);
    if (p) {
      const e = p.engineSummary();
      const a = e.thrust / Math.max(p.mass, 1e-6);
      const gr = g.world.gravityAt(p.x, p.y);
      const deg = ((((p.angle * 180) / Math.PI) % 360) + 360) % 360;
      lines.push(`поз ${p.x.toFixed(0)},${p.y.toFixed(0)}  масса ${p.mass.toFixed(0)}`);
      const tg = g.world.target;
      if (tg) lines.push(`цель ${tg.x.toFixed(0)},${tg.y.toFixed(0)} d=${Math.hypot(tg.x - p.x, tg.y - p.y).toFixed(0)}`);
      lines.push(`дв. ${e.alive}/${e.total}  тяга ${a.toFixed(1)}кл/с²`);
      lines.push(`v ${Math.hypot(p.vx, p.vy).toFixed(1)}кл/с  курс ${deg.toFixed(0)}°`);
      lines.push(`газ ${(p.throttle * 100).toFixed(0)}%  вращ ${p.w.toFixed(2)}рад/с`);
      lines.push(`грав ${Math.hypot(gr.ax, gr.ay).toFixed(2)}кл/с²`);
    } else {
      lines.push('корабль уничтожен');
    }
    const cur = g.scene.cursor;
    if (cur) lines.push(`курсор ${cur.x.toFixed(0)},${cur.y.toFixed(0)}`);
    this.stats.textContent = lines.join('\n');
  }
}
