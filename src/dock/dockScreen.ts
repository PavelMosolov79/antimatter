import type { Game } from '../game';

import type { ShipGrid } from '../sim/grid';
import { SHIPS, shipHoldCap } from '../sim/ships';
import type { ModulesScreen } from './modulesScreen';
import { buildDockBase, dockLayout, makeDockSprite, renderDock, type DockBase, type DockFrame, type DockLayout, type DockSprite } from './dockArt';
import { makeLife, stepLife, type DockLife } from './dockLife';
import { SPARE_SHIP } from '../sim/repairConfig';
import { damagedGrid, putBack, repairOrder } from '../sim/repair';

/**
 * The dock, as designed in «Док Antimatter»: the ship held at a berth in a space station's
 * hangar, with a walkway round it where the crew go about their work. Round the picture
 * sits the interface: the resources, the fleet, the card of the room that's open, the row of
 * rooms of the station and the way out on a run. Switching ships and leaving for a run play
 * out as the ship undocking through the hangar doors.
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

type Room = 'hangar' | 'repair' | 'mods' | 'crew' | 'shop';
const ROOMS: Array<{ id: Room; label: string; icon: string; soon: boolean }> = [
  { id: 'hangar', label: 'Ангар', icon: '<path d="M3 20V9l9-5 9 5v11M7 20v-6h10v6"/>', soon: false },
  { id: 'repair', label: 'Ремонт', icon: '<rect x="3.5" y="3.5" width="17" height="17"/><path d="M12 7.5v9M7.5 12h9"/>', soon: false },
  { id: 'mods', label: 'Модули', icon: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>', soon: false },
  { id: 'crew', label: 'Экипаж', icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6"/><circle cx="17" cy="9" r="2"/><path d="M16 14c3 0 5 2 5 5"/>', soon: true },
  { id: 'shop', label: 'Магазин', icon: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>', soon: true },
];
const SOON: Record<string, { title: string; text: string }> = {
  crew: { title: 'Экипаж', text: 'Здесь будут космонавты корабля: найм, уровни и переназначение между кораблями.' },
  shop: { title: 'Магазин', text: 'Здесь будут новые модули и корабли за кредиты и металл.' },
};
const LINES: Array<[string, string]> = [
  ['Диспетчер', 'Причал 3: отбытие «Серафим» через 4 минуты.'],
  ['Диспетчер', 'Грузовой лифт 2 свободен. Металл принят.'],
  ['Станция', 'Ремонтные дроны: 6 из 6 на линии.'],
  ['Диспетчер', 'Антиматерия в магистрали: давление в норме.'],
  ['Станция', 'Ворота ангара закрыты, поле стабильно.'],
  ['Диспетчер', 'Причал 2 занят, ждите своей очереди.'],
];

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
/** The stock picture of a ship, for the fleet list. */
function stockSprite(shipId: string): DockSprite {
  let c = sprites.get(shipId);
  if (!c) {
    const grid = SHIPS.find((s) => s.id === shipId)!.build();
    c = { cells: grid.cells, sprite: makeDockSprite(grid) };
    sprites.set(shipId, c);
  }
  return c.sprite;
}

// ------------------------------------------------------------------ styles

const U = (css: string) => css.replace(/U\(([-\d.]+)\)/g, 'calc(var(--u) * $1)');
const SANS = "'Unbounded', 'Arial Black', system-ui, sans-serif";
const CSS = U(`
#dock { position: fixed; inset: 0; z-index: 40; overflow: hidden; background: #05060c; color: #c9d2ef;
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; -webkit-user-select: none; user-select: none; }
#dock[hidden], #dock [hidden] { display: none !important; }
#dock canvas.pic { position: absolute; left: 0; top: 0; width: 100%; height: 100%; image-rendering: pixelated; image-rendering: crisp-edges; }
#dock canvas.glow { filter: blur(U(0.9)) saturate(1.2); mix-blend-mode: screen; opacity: .75; }
#dock .hud { position: absolute; inset: 0; pointer-events: none; text-shadow: 0 0 U(.5) #000, 0 0 U(.25) #000; }
#dock .glass { background: rgba(7,10,20,.8); border: 1px solid rgba(89,230,255,.18); }
#dock button { font-family: ${SANS}; font-weight: 500; font-size: U(1.2); letter-spacing: .16em; text-transform: uppercase; text-align: left; cursor: pointer;
  color: #c9d2ef; background: rgba(7,10,20,.8); border: 1px solid rgba(89,230,255,.22); padding: U(1) U(1.3); display: flex; justify-content: space-between; align-items: center; gap: U(1);
  pointer-events: auto; touch-action: manipulation; }
#dock button:hover { border-color: rgba(89,230,255,.6); color: #fff; }
#dock button:focus-visible { outline: 2px solid #ff4fd8; outline-offset: 2px; }
#dock button:disabled { cursor: default; color: #5d6688; border-color: rgba(93,102,136,.3); }
#dock button small { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-weight: 400; font-size: U(.95); letter-spacing: .06em; color: #8a93b8; text-transform: none; }

/* the top: the name of the berth and the resources */
#dock .top { position: absolute; left: U(2.4); right: U(2.4); top: calc(U(2) + env(safe-area-inset-top, 0px)); display: flex; justify-content: space-between; align-items: flex-start; gap: U(1.5); }
#dock .brand { display: flex; flex-direction: column; gap: U(.3); min-width: 0; padding: U(.8) U(1.4) U(.9) U(1.2); background: rgba(5,6,12,.62); border-left: U(.3) solid #b43cff; }
#dock .brand b { font-family: ${SANS}; font-weight: 900; font-size: U(2.8); line-height: 1; letter-spacing: .3em; color: #f3e8ff; text-shadow: 0 0 U(1.1) rgba(180,60,255,.6), 0 0 U(.4) #000; }
#dock .brand .sub { font-size: U(1.05); letter-spacing: .2em; text-transform: uppercase; color: #aab3d6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#dock .brand .st { color: #63e07a; }
#dock .brand .st.moving { color: #e8c450; }
#dock.road .brand .sub > span:first-child { color: #e8c450; }
#dock .res { display: flex; gap: U(.8); align-items: stretch; pointer-events: none; }
#dock .chip-res { display: flex; align-items: center; gap: U(.8); padding: U(.7) U(1.2); font-size: U(1.3); font-weight: 500; color: #e9eeff; font-variant-numeric: tabular-nums; pointer-events: auto; white-space: nowrap; }
#dock .chip-res i { width: U(1.1); height: U(1.1); display: block; }
#dock .chip-res small { font-size: U(.85); letter-spacing: .14em; text-transform: uppercase; color: #6c77a0; }
#dock .chip-res .plus { color: #e8c450; font-size: U(1); }
#dock .menu-btn { width: U(4.2); padding: 0; justify-content: center; font-size: U(1.8); letter-spacing: 0; }
#dock .menu-pop { position: absolute; right: U(2.4); top: calc(U(6.4) + env(safe-area-inset-top, 0px)); display: flex; flex-direction: column; gap: U(.6); width: U(20); pointer-events: auto; z-index: 3; }
#dock .menu-pop button { font-size: U(1.15); padding: U(1.1) U(1.3); background: #0a0e1c; }

/* the fleet: a column of berths (a list from a button on a phone) */
#dock .fleet { position: absolute; left: U(2.4); top: calc(U(10) + env(safe-area-inset-top, 0px)); display: flex; flex-direction: column; gap: U(.8); pointer-events: none; }
#dock .fleet-btn { display: none; }
#dock .bays { display: flex; flex-direction: column; gap: U(.8); }
#dock .bay { position: relative; width: U(12.4); padding: U(.6); flex-direction: column; align-items: stretch; gap: U(.4); text-align: left; }
#dock .bay.on { border-color: #59e6ff; box-shadow: 0 0 U(1.2) rgba(89,230,255,.25); }
#dock .bay .th { height: U(5.4); background: #080b16; border: 1px solid #151b2e; display: flex; align-items: center; justify-content: center; }
#dock .bay .th canvas { height: 100%; width: 100%; object-fit: contain; image-rendering: pixelated; }
#dock .bay .tx { display: flex; flex-direction: column; gap: U(.2); min-width: 0; }
#dock .bay b { font-size: U(.9); font-weight: 500; letter-spacing: .05em; text-transform: uppercase; color: #e9eeff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#dock .bay em { font-style: normal; font-size: U(.85); letter-spacing: .06em; color: #63e07a; white-space: nowrap; }
#dock .bay:disabled { opacity: .55; }

/* the card of the open room, and the hold on the road */
#dock .side { position: absolute; right: U(2.4); top: calc(U(8.6) + env(safe-area-inset-top, 0px)); bottom: U(12.2); width: U(30); display: flex; flex-direction: column; gap: U(1); overflow-y: auto; scrollbar-width: none; pointer-events: none; }
#dock .side::-webkit-scrollbar { display: none; }
#dock .card { display: flex; flex-direction: column; gap: U(.8); padding: U(1.3) U(1.7); pointer-events: auto; border-left: U(.35) solid #59e6ff; flex: none; }
#dock .card .name { font-family: ${SANS}; font-weight: 700; font-size: U(2.1); letter-spacing: .14em; text-transform: uppercase; color: #f3e8ff; }
#dock .card .cls { font-size: U(1); letter-spacing: .16em; text-transform: uppercase; color: #8a93b8; }
#dock .card .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: U(.6) U(1.2); margin-top: U(.2); }
#dock .card .stats div { display: flex; flex-direction: column; min-width: 0; }
#dock .card .stats small { font-size: U(.85); letter-spacing: .16em; text-transform: uppercase; color: #6c77a0; }
#dock .card .stats strong { font-size: U(1.6); font-weight: 700; color: #e9eeff; font-variant-numeric: tabular-nums; }
#dock .card .state { display: flex; gap: U(.7); flex-wrap: wrap; }
#dock .chip { font-size: U(.95); letter-spacing: .14em; text-transform: uppercase; padding: U(.3) U(.7); border: 1px solid; }
#dock .chip.ok { color: #63e07a; border-color: rgba(99,224,122,.45); }
#dock .chip.fuel { color: #ff4fd8; border-color: rgba(255,79,216,.45); }
#dock .chip.soon { color: #e8c450; border-color: rgba(232,196,80,.5); }
#dock .layers { display: flex; flex-wrap: wrap; gap: U(.5); }
#dock .layers button { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: U(1); letter-spacing: .1em; padding: U(.5) U(.8); justify-content: center; }
#dock .layers button[aria-pressed="true"] { color: #59e6ff; border-color: #59e6ff; background: rgba(20,48,74,.85); }
#dock .layerbar { display: none; }
#dock .card .note { font-size: U(1.05); line-height: 1.5; color: #9aa4cc; text-shadow: none; }
#dock .cargo { display: flex; flex-direction: column; gap: U(.6); padding: U(1.1) U(1.5); pointer-events: auto; border-left: U(.35) solid #e8c450; flex: none; }
#dock .cargo .ch { display: flex; justify-content: space-between; align-items: baseline; gap: U(1); }
#dock .cargo .ch b { font-family: ${SANS}; font-weight: 700; font-size: U(1.2); letter-spacing: .16em; text-transform: uppercase; color: #fff3c8; }
#dock .cargo .ch span { font-size: U(.95); letter-spacing: .12em; text-transform: uppercase; color: #e8c450; }
#dock .cargo .ch span.safe { color: #63e07a; }
#dock .cargo .grid { display: grid; grid-template-columns: auto 1fr; gap: U(.4) U(1.2); align-items: baseline; }
#dock .cargo .grid small { font-size: U(.85); letter-spacing: .16em; text-transform: uppercase; color: #6c77a0; }
#dock .cargo .grid strong { font-size: U(1.4); font-weight: 700; color: #e8c450; font-variant-numeric: tabular-nums; text-align: right; }
#dock .cargo .grid strong.dim { color: #4c5470; }
#dock .cargo .bar { height: U(.8); background: #10162a; border: 1px solid #1b2134; position: relative; }
#dock .cargo .bar i { position: absolute; inset: 0 auto 0 0; background: #e8c450; }
#dock .cargo .note { font-size: U(.95); line-height: 1.4; color: #8a93b8; text-shadow: none; }
#dock .cargo .note b { color: #fff3c8; font-weight: 500; }
#dock .cargo .sum { display: none; color: #e9eeff; letter-spacing: .02em; text-transform: none; }
#dock .cargo.mini .sum { display: inline; }
#dock .cargo.mini .grid, #dock .cargo.mini .note { display: none; }
#dock:not(.portrait) .rep.rm .cls { display: none; }
#dock:not(.portrait) .rep.rm .big { font-size: U(2.4); }

/* the repair room */
#dock .rep { gap: U(.8); }
#dock .rep .hullbar { height: U(1); background: #10162a; border: 1px solid #1b2440; position: relative; }
#dock .rep .hullbar i { position: absolute; left: 0; top: 0; bottom: 0; background: #63e07a; transition: width .4s; }
#dock .rep .hullbar i.w { background: #e8c450; }
#dock .rep .hullbar i.b { background: #ff6a5a; }
#dock .rep .hullbar i.f { background: #59e6ff; }
#dock .rep .row { display: flex; justify-content: space-between; align-items: baseline; gap: U(1); font-size: U(1.15); }
#dock .rep .row small { font-size: U(.85); letter-spacing: .14em; text-transform: uppercase; color: #6c77a0; }
#dock .rep .row b { font-weight: 700; color: #e9eeff; font-variant-numeric: tabular-nums; }
#dock .rep .row b.free { color: #63e07a; }
#dock .rep .big { font-family: ${SANS}; font-weight: 700; font-size: U(3); letter-spacing: .08em; color: #fff3c8; font-variant-numeric: tabular-nums; }
#dock .rep .btn { text-align: left; }
#dock .rep .btn.pri { border-color: #59e6ff; color: #59e6ff; background: rgba(14,40,64,.9); }
#dock .rep .btn.prem { border-color: rgba(255,79,216,.6); color: #ffd0f4; background: rgba(58,10,70,.7); }
#dock .rep .btn small { font-size: U(1); color: #9aa4cc; }
#dock .rep .btn:disabled small { color: #ff6a5a; }
#dock .rep .btn:disabled { opacity: .85; }
#dock .rep .tag2 { font-size: U(.95); letter-spacing: .12em; text-transform: uppercase; padding: U(.3) U(.7); border: 1px solid; }
#dock .rep .tag2.bd { color: #ff6a5a; border-color: rgba(255,106,90,.55); }
#dock .rep .tag2.in { color: #59e6ff; border-color: rgba(89,230,255,.45); }
#dock .rep .note { font-size: U(1.05); line-height: 1.5; color: #9aa4cc; text-shadow: none; }
#dock .rep .note b { color: #e4e8fb; font-weight: 500; }
#dock .chip-res i.prem { transform: rotate(45deg); }
#dock .bay em.rp { color: #e8c450; }
#dock .bay em.bd { color: #ff6a5a; }
#dock .go:disabled { border-color: rgba(93,102,136,.5); color: #7a84a8; background: rgba(10,13,24,.85); box-shadow: none; }
#dock .go:disabled small { color: #e8c450; }
#dock .room .badge { position: absolute; right: U(.5); top: U(.5); min-width: U(1.7); height: U(1.7); padding: 0 U(.45); font-size: U(.95); font-weight: 700; background: #ff4fd8; color: #1a0618; border-radius: U(.9); display: flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0; }
#dock .toast { position: absolute; left: 50%; top: calc(U(9) + env(safe-area-inset-top, 0px)); transform: translateX(-50%); padding: U(1) U(2); font-size: U(1.2); background: rgba(10,14,30,.96); border: 1px solid #59e6ff; color: #e4e8fb; pointer-events: none; opacity: 0; transition: opacity .25s; z-index: 6; text-align: center; max-width: 80%; text-shadow: none; }
#dock .toast.on { opacity: 1; }

/* the row of rooms below the berth, and the way out */
#dock .bottom { display: contents; }
#dock .deck { position: absolute; left: var(--deckx, 50%); transform: translateX(-50%); bottom: calc(U(2.2) + env(safe-area-inset-bottom, 0px)); display: flex; gap: U(.7); }
#dock .room { position: relative; flex-direction: column; justify-content: center; gap: U(.5); min-width: U(8); padding: U(.9) U(.8); font-size: U(.9); letter-spacing: .14em; color: #aab3d6; text-align: center; }
#dock .room svg { width: U(2.4); height: U(2.4); fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: square; stroke-linejoin: miter; }
#dock .room small { font-size: U(.8); letter-spacing: .06em; color: #e8c450; margin-top: U(-.2); }
#dock .room[aria-pressed="true"] { color: #59e6ff; border-color: #59e6ff; background: rgba(14,40,64,.88); box-shadow: inset 0 U(-.35) 0 #59e6ff; }
#dock .room:disabled { opacity: .5; }
#dock .go { position: absolute; right: U(2.4); bottom: calc(U(2.2) + env(safe-area-inset-bottom, 0px)); width: U(25); font-weight: 700; font-size: U(1.6); letter-spacing: .2em;
  color: #fbf2ff; border-color: #ff4fd8; background: rgba(58,10,70,.82); box-shadow: 0 0 U(1.6) rgba(255,79,216,.4); padding: U(1.3) U(1.8); }
#dock .go span.l { display: flex; flex-direction: column; }
#dock .go small { color: #d9a8ec; margin-top: U(.3); font-size: U(.95); letter-spacing: .06em; }
#dock .ticker { position: absolute; left: U(2.4); bottom: calc(U(2.2) + env(safe-area-inset-bottom, 0px)); width: U(14.6); padding: U(.8) U(1); font-size: U(.95); line-height: 1.45; color: #aab3d6; pointer-events: none;
  background: rgba(7,10,20,.78); border: 1px solid rgba(89,230,255,.14); border-left: U(.3) solid #59e6ff; }
#dock .ticker b { display: block; font-weight: 500; font-size: U(.8); letter-spacing: .14em; text-transform: uppercase; color: #59e6ff; margin-bottom: U(.2); }
#dock .ticker span { display: block; animation: dock-fade 1.2s; }
@keyframes dock-fade { from { opacity: 0; } to { opacity: 1; } }

/* portrait: the picture on top, the card, the way out and the rooms stacked from the bottom edge up */
#dock.portrait .top { left: U(2); right: U(2); top: calc(U(2) + env(safe-area-inset-top, 0px)); align-items: center; }
#dock.portrait .brand { padding: U(.6) U(1.2) U(.7) U(1); }
#dock.portrait .brand b { font-size: U(3.4); letter-spacing: .24em; }
#dock.portrait .brand .sub { font-size: U(1.5); letter-spacing: .12em; }
#dock.portrait .res { gap: U(.6); }
#dock.portrait .chip-res { font-size: U(2.5); padding: U(1) U(1.5); gap: U(1); }
#dock.portrait .chip-res small { display: none; }
#dock.portrait .chip-res i { width: U(2); height: U(2); }
#dock.portrait .menu-btn { width: U(7.4); font-size: U(3.6); }
#dock.portrait .menu-pop { right: U(2); top: calc(U(11.6) + env(safe-area-inset-top, 0px)); width: U(40); }
#dock.portrait .menu-pop button { font-size: U(2.1); padding: U(1.8) U(2); }
#dock.portrait .fleet { left: U(2); top: calc(U(11.6) + env(safe-area-inset-top, 0px)); }
#dock.portrait .fleet-btn { display: flex; font-size: U(2.5); padding: U(1.5) U(2.2); gap: U(1.8); pointer-events: auto; }
#dock.portrait .bays { display: none; position: absolute; left: 0; top: U(7.6); width: U(52); pointer-events: auto; z-index: 3; }
#dock.portrait .fleet.open .bays { display: flex; }
#dock.portrait .bay { width: auto; flex-direction: row; align-items: center; justify-content: flex-start; gap: U(1.6); padding: U(1); background: #0a0e1c; }
#dock.portrait .bay .tx { flex: 1; }
#dock.portrait .bay .th { width: U(11); height: U(8); flex: none; }
#dock.portrait .bay b { font-size: U(2); }
#dock.portrait .bay em { font-size: U(1.6); }
#dock.portrait .bottom { display: flex; flex-direction: column; gap: U(1); position: absolute; left: U(2); right: U(2); bottom: calc(U(2) + env(safe-area-inset-bottom, 0px)); pointer-events: none; }
#dock.portrait .side { position: static; width: auto; max-height: U(62); }
#dock.portrait .go { position: static; width: auto; font-size: U(2.6); padding: U(2.1) U(2); letter-spacing: .16em; }
#dock.portrait .go small { display: none; }
#dock.portrait .deck { position: static; transform: none; gap: U(.8); }
#dock.portrait .room { flex: 1 1 0; min-width: 0; aspect-ratio: 1; padding: U(.5); font-size: U(2.1); letter-spacing: .02em; gap: U(1.2); align-items: center; }
#dock.portrait .room svg { width: U(6.4); height: U(6.4); }
#dock.portrait .room small { display: none; }
#dock.portrait .card { padding: U(1.6) U(2); gap: U(1); border-left-width: U(.6); }
#dock.portrait .card .name { font-size: U(4.2); }
#dock.portrait .card .layers { display: none; }
#dock.portrait .card .cls { font-size: U(2.4); letter-spacing: .06em; margin-top: U(-.4); }
#dock.portrait .chip { font-size: U(2.2); padding: U(.5) U(1.2); }
#dock.portrait .card .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: U(.4) U(1.2); }
#dock.portrait .card .stats small { font-size: U(2.1); letter-spacing: .06em; }
#dock.portrait .card .stats strong { font-size: U(3.6); }
#dock.portrait .card .note { font-size: U(1.7); }
#dock.portrait .layerbar { display: flex; flex-direction: column; gap: U(.9); position: absolute; right: U(2); top: calc(U(11.6) + env(safe-area-inset-top, 0px)); }
#dock.portrait .layerbar button { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: U(2.4); letter-spacing: .06em; padding: U(1.6) U(1.8); justify-content: center; min-width: U(15); }
#dock.portrait .layerbar button[aria-pressed="true"] { color: #59e6ff; border-color: #59e6ff; background: rgba(20,48,74,.85); }
#dock.portrait .cargo { padding: U(1.1) U(1.6); gap: U(.6); border-left-width: U(.6); }
#dock.portrait .cargo .ch b { font-size: U(3.2); }
#dock.portrait .cargo .ch span { font-size: U(2.3); }
#dock.portrait .cargo .grid small { font-size: U(2.1); }
#dock.portrait .cargo .grid strong { font-size: U(3.4); }
#dock.portrait .cargo .bar { height: U(1.1); }
#dock.portrait .cargo .note { display: none; }
#dock.portrait .toast { top: calc(U(18) + env(safe-area-inset-top, 0px)); font-size: U(2.4); padding: U(1.4) U(2.2); }
#dock.portrait .rep .row { font-size: U(2.4); }
#dock.portrait .rep .row small { font-size: U(1.9); }
#dock.portrait .rep .big { font-size: U(5); }
#dock.portrait .rep .btn { font-size: U(2.3); padding: U(1.8) U(2); }
#dock.portrait .rep .btn small { font-size: U(1.9); }
#dock.portrait .rep .tag2 { font-size: U(1.9); }
#dock.portrait .rep .note { font-size: U(2.1); }
#dock.portrait .rep .hullbar { height: U(1.4); }
#dock.portrait .card.rep .cls { display: block; }
#dock.portrait .ticker { position: static; width: auto; font-size: U(2.7); line-height: 1.4; padding: U(1.2) U(1.8); border-left-width: U(.6); }
#dock.portrait .ticker b { display: inline; font-size: U(2.1); margin: 0 U(1.2) 0 0; }
#dock.portrait .ticker span { display: inline; }
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
  private side = document.createElement('div');
  private card = document.createElement('div');
  private bays = document.createElement('div');
  private fleet = document.createElement('div');
  private fleetBtn!: HTMLButtonElement;
  private menuPop = document.createElement('div');
  private layerbar = document.createElement('div');
  private deckEl = document.createElement('div');
  private roomBtns = new Map<Room, HTMLButtonElement>();
  private ticker = document.createElement('div');
  private cargo = document.createElement('div');
  private resCredits = document.createElement('span');
  private resMetal = document.createElement('span');
  private resCreditsPlus = document.createElement('span');
  private resMetalPlus = document.createElement('span');
  private resQuanta = document.createElement('span');
  private toastEl = document.createElement('div');
  private toastTimer = 0;
  private roomBadge: HTMLElement | null = null;
  private repairSig = '';
  private uiAt = 0;
  private bayEm = new Map<string, HTMLElement>();
  private bayCv = new Map<string, HTMLCanvasElement>();
  /** The repair at work: the ship as it is repainted cell by cell, the drones, the cells just put back. */
  private vis: {
    key: string;
    bp: ShipGrid;
    grid: ShipGrid;
    order: number[];
    done: number;
    flashes: Array<{ x: number; y: number; t: number }>;
    paintedAt: number;
    dirty: boolean;
    drones: Array<{ x: number; y: number }>;
  } | null = null;
  /** The three repair drones, in ship cells: they circle the ship, fly to the broken cells, and come back. */
  private drones: Array<{ x: number; y: number }> | null = null;
  private titleSub = document.createElement('span');
  private statusEl = document.createElement('span');
  private goBtn!: HTMLButtonElement;
  private sandBtn!: HTMLButtonElement;
  private room: Room = 'hangar';
  /** The dock is open on the road (mid-run) rather than between runs. */
  private road = false;
  /** The hold emptying into the player's resources, for the little animation on arrival. */
  private flow: { k: number; credits: number; metal: number } | null = null;
  private L!: DockLayout;
  private B!: DockBase;
  private life!: DockLife;
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
  private lineAt = 0;
  private lineIx = 0;
  private hangar: { name: string; cls: string; stats: Array<[string, string, boolean]> } | null = null;
  /** What happens once the ship has left: switch to another ship, or go on a run. */
  private after: { kind: 'switch'; id: string } | { kind: 'run' } | { kind: 'continue' } | null = null;
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
    this.cv.className = 'pic';
    this.gv.className = 'pic glow';
    const hud = div('hud');

    // the top: the berth's name and status, the resources, the menu
    const top = div('top');
    const brand = div('brand');
    const tb = document.createElement('b');
    tb.textContent = 'ДОК';
    const sub = div('sub');
    this.titleSub.textContent = 'Причал 1';
    this.statusEl.className = 'st';
    sub.append(this.titleSub, this.statusEl);
    brand.append(tb, sub);
    const res = div('res');
    res.append(this.chip('#e8c450', 'Кредиты', this.resCredits, this.resCreditsPlus), this.chip('#59e6ff', 'Металл', this.resMetal, this.resMetalPlus), this.chip('#ff4fd8', 'Кванты', this.resQuanta, document.createElement('span'), true));
    const menu = btn('☰', () => this.toggleMenu());
    menu.className = 'menu-btn glass';
    menu.setAttribute('aria-label', 'Меню');
    res.appendChild(menu);
    top.append(brand, res);
    this.menuPop.className = 'menu-pop';
    this.menuPop.hidden = true;
    const sand = btn('Песочница', () => this.leave(() => this.game.reset(this.game.shipId, 'sandbox')));
    this.sandBtn = sand;
    const main = btn('Главное меню', () => this.leave(() => (this.game.screen = 'title')));
    this.menuPop.append(sand, main);

    // the fleet
    this.fleet.className = 'fleet';
    this.fleetBtn = btn('', () => {
      this.menuPop.hidden = true;
      this.fleet.classList.toggle('open');
    });
    this.fleetBtn.className = 'fleet-btn glass';
    this.bays.className = 'bays';
    this.fleet.append(this.fleetBtn, this.bays);

    // the card, the rooms, the way out
    this.side.className = 'side';
    this.card.className = 'card glass';
    this.cargo.className = 'cargo glass';
    this.cargo.hidden = true;
    this.side.append(this.cargo, this.card);
    this.deckEl.className = 'deck';
    for (const rm of ROOMS) {
      const b = btn('', () => this.pickRoom(rm.id));
      b.className = 'room glass';
      b.innerHTML = `<svg viewBox="0 0 24 24">${rm.icon}</svg><span>${rm.label}</span>${rm.soon ? '<small>скоро</small>' : ''}`;
      this.roomBtns.set(rm.id, b);
      if (rm.id === 'repair') {
        this.roomBadge = document.createElement('span');
        this.roomBadge.className = 'badge';
        this.roomBadge.textContent = '!';
        this.roomBadge.hidden = true;
        b.appendChild(this.roomBadge);
      }
      this.deckEl.appendChild(b);
    }
    const go = btn('', () => this.depart());
    go.className = 'go';
    this.goBtn = go;
    this.layerbar.className = 'layerbar';
    this.ticker.className = 'ticker';
    const bottom = div('bottom');
    bottom.append(this.ticker, this.side, go, this.deckEl);
    this.toastEl.className = 'toast';
    hud.append(top, this.menuPop, this.fleet, this.layerbar, bottom, this.toastEl);
    r.append(this.cv, this.gv, hud);
    parent.appendChild(r);
    this.setStatus('docked');

    window.addEventListener('keydown', (e) => {
      if (r.hidden) return;
      if (e.key === 'ArrowLeft') this.cycle(-1);
      else if (e.key === 'ArrowRight') this.cycle(1);
    });
    r.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.menu-pop, .menu-btn')) this.menuPop.hidden = true;
      if (!t.closest('.fleet')) this.fleet.classList.remove('open');
    });
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (!r.hidden) this.fit();
      }, 150);
    });
  }

  private chip(color: string, label: string, val: HTMLElement, plus: HTMLElement, diamond = false): HTMLElement {
    const c = div('chip-res glass');
    const i = document.createElement('i');
    if (diamond) i.className = 'prem';
    i.style.background = color;
    const sm = document.createElement('small');
    sm.textContent = label;
    plus.className = 'plus';
    c.append(i, sm, val, plus);
    return c;
  }

  private modules: ModulesScreen | null = null;

  /** Hooks up the module menu this dock opens from its «Модули» room. */
  setModules(m: ModulesScreen): void {
    this.modules = m;
  }

  private openModules(): void {
    if (this.phase !== 'docked' || !this.modules || this.road) return;
    this.modules.open(this.shipId || this.game.shipId);
  }

  /** The module menu closed: the ship at the berth is built again from the layout, and painted fresh. */
  refreshShip(shipId: string): void {
    sprites.delete(shipId);
    this.game.openDock(shipId);
    this.load();
  }

  /** Called every frame by the game loop: shows the dock whenever the game is at it. */
  update(): void {
    const g = this.game;
    const atDock = g.screen === 'game' && g.mode === 'run' && (g.runPhase === 'dock' || g.runPhase === 'roaddock');
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
      this.room = 'hangar';
      this.menuPop.hidden = true;
      this.fleet.classList.remove('open');
      this.setRoad(g.runPhase === 'roaddock');
      this.load();
      // Coming in from the menu or a finished run: the ship pulls into the berth.
      this.startPhase(this.reduce ? 'docked' : 'arrive');
      this.shipY = this.reduce ? this.L.sy : -this.sprite.h - 6;
      this.e = this.reduce ? 1 : 0;
      this.flushNotes();
      this.start();
    } else if (this.phase === 'docked' && grid !== this.grid) {
      // the ship was mended a little (the repair repaints it): same ship, same berth, only the picture changes
      if (grid && g.shipId === this.shipId && this.grid && grid.width === this.grid.width && grid.height === this.grid.height && this.road === (g.runPhase === 'roaddock')) this.reloadShip(grid);
      else {
        this.setRoad(g.runPhase === 'roaddock');
        this.load();
      }
    }
  }

  // ---------------------------------------------------------------- the dock on the road

  private setRoad(road: boolean): void {
    this.road = road;
    const g = this.game;
    this.root.classList.toggle('road', road);
    this.cargo.hidden = !road;
    this.sandBtn.hidden = road;
    this.roomBtns.get('mods')!.disabled = road;
    const run = g.run;
    this.goBtn.innerHTML = `<span class="l"><span>${road ? 'Продолжить поход' : 'В поход'}</span><small></small></span><span>▸</span>`;
    if (road && run) {
      const p = run.road.points[run.cleared];
      this.titleSub.textContent = p.kind === 'gate' ? (p.link === 0 ? 'Старт похода' : `Врата · звено ${p.link + 1}`) : `Док на пути · звено ${p.link + 1} · миссия ${p.mission}`;
      const d = run.deposited;
      this.flow = d && d.credits + d.metal > 0 ? { k: this.reduce ? 1 : 0, credits: d.credits, metal: d.metal } : null;
    } else {
      this.titleSub.textContent = 'Причал 1';
      this.flow = null;
    }
    this.updateGoNote();
    this.renderCargo();
    this.showRoom();
  }

  /** The way out's button: what the ship's state lets it say, and whether it can be pressed. */
  private updateGoNote(): void {
    const small = this.goBtn.querySelector('small');
    if (!small) return;
    const st = this.game.repairState();
    const hull = Math.round(st.damage.hull * 100);
    let text: string;
    let off = false;
    if (st.job) {
      if (this.road) text = `Ремонт не закончен: корпус ${hull}%`;
      else {
        off = true;
        text = `Идёт ремонт, ещё ${mmss(st.job.left)}` + (st.shipId === SPARE_SHIP ? '' : '. Запасной истребитель свободен');
      }
    } else if (st.damage.wreck && !this.road) {
      off = true;
      text = 'Корабль разрушен: нужен ремонт' + (st.shipId === SPARE_SHIP ? '' : '. Запасной истребитель свободен');
    } else if (st.damage.any) text = `Корпус ${hull}%. Лучше починить`;
    else text = this.road ? 'Корпус 100%' : 'Корабль готов';
    if (small.textContent !== text) small.textContent = text;
    if (this.goBtn.disabled !== off) this.goBtn.disabled = off;
  }

  /** The resources at the top, and (on the road) the hold with the hold's emptying into them. */
  private renderCargo(): void {
    const g = this.game;
    const w = g.wallet;
    const f = this.flow;
    const e = f ? 1 - Math.pow(1 - Math.min(1, f.k), 3) : 1;
    const n = (v: number) => Math.round(v).toLocaleString('ru-RU');
    const run = g.run;
    const inflow = this.road && f ? 1 - e : 0;
    this.resCredits.textContent = n(w.credits - (f ? f.credits * inflow : 0));
    this.resMetal.textContent = n(w.metal - (f ? f.metal * inflow : 0));
    this.resQuanta.textContent = n(w.quanta);
    this.resCreditsPlus.textContent = f && f.credits * inflow >= 1 ? `+${n(f.credits * inflow)}` : '';
    this.resMetalPlus.textContent = f && f.metal * inflow >= 1 ? `+${n(f.metal * inflow)}` : '';
    if (!this.road || !run) return;
    const hc = f ? f.credits * (1 - e) : run.cargo.credits;
    const hm = f ? f.metal * (1 - e) : run.cargo.metal;
    const cap = shipHoldCap(run.shipId);
    const flowing = !!f && f.k < 1;
    const empty = hc < 1 && hm < 1;
    const c = this.cargo;
    c.replaceChildren();
    const head = div('ch');
    head.append(Object.assign(document.createElement('b'), { textContent: 'Трюм' }), Object.assign(document.createElement('span'), { className: 'sum', textContent: `${n(hc)} кр. · ${n(hm)}/${cap} мет.` }), Object.assign(document.createElement('span'), { className: !flowing && empty ? 'safe' : '', textContent: flowing ? 'груз сдаётся…' : empty ? 'груз сдан' : 'груз не сдан' }));
    const grid = div('grid');
    const row = (label: string, value: string, vcls: string) => {
      const sm = document.createElement('small');
      sm.textContent = label;
      const v = document.createElement('strong');
      v.className = vcls;
      v.textContent = value;
      grid.append(sm, v);
    };
    row('Кредиты', n(hc), hc < 1 ? 'dim' : '');
    row('Металл', `${n(hm)} / ${cap}`, hm < 1 ? 'dim' : '');
    const bar = div('bar');
    const fill = document.createElement('i');
    fill.style.width = `${Math.round((hm / cap) * 100)}%`;
    bar.appendChild(fill);
    const note = div('note');
    note.innerHTML = empty && !flowing ? '<b>Трюм пуст.</b> Новая добыча под риском, пока не вернётесь в док.' : flowing ? 'Добыча из трюма добавляется к ресурсам.' : '<b>Не сдан:</b> пропадёт при гибели корабля.';
    c.append(head, grid, bar, note);
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
    this.buildFleet();
    this.updateGoNote();
  }

  private fit(): void {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    this.portrait = vh / vw >= 1.4;
    this.root.classList.toggle('portrait', this.portrait);
    const upx = (this.portrait ? Math.min(vw, (vh * 9) / 16) : Math.min(vw, (vh * 16) / 9)) / 100;
    this.root.style.setProperty('--u', `${upx}px`);
    const s = this.sprite;
    // landscape: the berth sits between the fleet on the left and the card on the right, with the row of rooms below it
    const cx = 0.5 - (9.5 * upx) / vw;
    const L = dockLayout(s.w, s.h, vw / vh, this.portrait, this.portrait ? {} : { cx, bottom: (11.5 * upx) / vh });
    this.root.style.setProperty('--deckx', `${Math.round(cx * 1000) / 10}%`);
    const wasDocked = this.L && this.shipY === this.L.sy;
    this.L = L;
    this.life = makeLife(L, s.w, s.h);
    this.B = buildDockBase(L, s.w, s.h, this.life);
    this.cv.width = this.gv.width = L.W;
    this.cv.height = this.gv.height = L.H;
    this.ctx = this.cv.getContext('2d')!;
    this.gctx = this.gv.getContext('2d')!;
    this.img = this.ctx.createImageData(L.W, L.H);
    this.glow = this.gctx.createImageData(L.W, L.H);
    if (wasDocked || this.phase === 'docked') this.shipY = L.sy;
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
    const n = (v: number) => v.toLocaleString('ru-RU');
    this.hangar = {
      name: spec?.label ?? '',
      cls: `${CLASS[this.shipId] ?? ''} · палуб ${decks} · ${grid.width}×${grid.height} клеток`,
      stats: [
        ['Корпус', n(grid.cells), false],
        ['Орудий', n(guns), false],
        ['Щит', n(shield), false],
        ['Двигателей', n(engines), true],
        ['Масса', n(Math.round(grid.mass)), true],
        ['Палуб', n(decks), true],
      ],
    };
    this.fleetBtn.innerHTML = `<span>${spec?.label ?? ''}</span><span>▾</span>`;
    this.fillLayers(this.layerbar);
    this.layerbar.querySelectorAll('button').forEach((b) => b.classList.add('glass'));
    this.showRoom();
  }

  /** The card for whichever room is open. */
  private showRoom(): void {
    for (const [id, b] of this.roomBtns) b.setAttribute('aria-pressed', id === this.room ? 'true' : 'false');
    const c = this.card;
    c.replaceChildren();
    c.classList.remove('rep', 'rm');
    this.cargo.classList.toggle('mini', this.room !== 'hangar');
    const soon = SOON[this.room];
    if (this.room === 'repair') {
      this.repairSig = '';
      this.updateRepair();
      return;
    }
    if (!soon) {
      const h = this.hangar;
      if (!h) return;
      c.append(div('name', h.name), div('cls', h.cls));
      const stats = div('stats');
      for (const [k, v, more] of h.stats) {
        const d = document.createElement('div');
        if (more) d.className = 'more';
        const sm = document.createElement('small');
        sm.textContent = k;
        const st = document.createElement('strong');
        st.textContent = v;
        d.append(sm, st);
        stats.appendChild(d);
      }
      const state = div('state');
      state.innerHTML = '<span class="chip ok">в захватах</span><span class="chip fuel">заправка</span>';
      const layers = div('layers');
      this.fillLayers(layers);
      c.append(stats, state, layers);
    } else {
      const state = div('state');
      state.innerHTML = '<span class="chip soon">в разработке</span>';
      c.append(div('name', soon.title), state, div('note', soon.text));
    }
  }

  private fillLayers(into: HTMLElement): void {
    into.replaceChildren();
    this.sprite.views.forEach((_, i) => {
      const b = btn(LAYER_NAMES[i], () => this.setLayer(i));
      b.setAttribute('aria-pressed', i === this.layer ? 'true' : 'false');
      into.appendChild(b);
    });
  }

  private setLayer(i: number): void {
    this.layer = i;
    this.root.querySelectorAll('.layers, .layerbar').forEach((g) => g.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false')));
  }

  private pickRoom(id: Room): void {
    this.menuPop.hidden = true;
    if (id === 'mods') {
      this.openModules();
      return;
    }
    this.room = id;
    this.showRoom();
  }

  private toggleMenu(): void {
    this.menuPop.hidden = !this.menuPop.hidden;
    this.fleet.classList.remove('open');
  }

  // ---------------------------------------------------------------- repair

  /** A short message over the berth. */
  private toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 3400);
  }

  /** What the dock has to say about the repairs finished while the player was away. */
  private flushNotes(): void {
    const notes = this.game.dockNotes.splice(0);
    if (notes.length) this.toast(notes.join(' '));
  }

  /** The ship at the berth was repainted (a repair mended some of it): the picture and the card change, the berth does not. */
  private reloadShip(grid: ShipGrid): void {
    this.grid = grid;
    this.sprite = spriteFor(this.shipId, grid);
    this.fillCard(grid);
    this.paintThumb(this.shipId);
  }

  /**
   * While a repair runs the drones do it: each of three works on one of the next cells to come
   * back, a yellow beam on it, and the ship is repainted as the cells return, one by one.
   */
  private tickVis(dt: number, now: number): NonNullable<DockFrame['repair']> | undefined {
    if (this.phase !== 'docked' || this.root.hidden) {
      this.drones = null;
      return undefined;
    }
    const sw = this.sprite.w;
    const sh = this.sprite.h;
    // where a drone circles when it has nothing to do (the same ring as before, round the ship)
    const slot = (i: number): { x: number; y: number } => {
      const ang = this.t * (0.35 + i * 0.12) + i * 2.1;
      return { x: sw / 2 + Math.cos(ang) * (sw / 2 + this.L.side * 0.65), y: sh / 2 + Math.sin(ang) * (sh / 2 + this.L.m * 0.55) };
    };
    if (!this.drones) this.drones = [0, 1, 2].map((i) => slot(i));
    const drones = this.drones;
    const st = this.game.repairState();
    if (!st.job || !st.from) {
      // the repair is over (or never was): paint the last cells at once, and the drones fly back to circle the ship
      if (this.vis?.dirty) {
        this.sprite = makeDockSprite(this.vis.grid);
        this.paintThumb(this.shipId);
      }
      this.vis = null;
      this.flyDrones(drones, [0, 1, 2].map((i) => slot(i)), dt);
      return { drones: drones.map((d) => ({ x: d.x, y: d.y, target: null })), flashes: [] };
    }
    const key = `${st.shipId}|${st.jobId}`;
    let v = this.vis;
    if (!v || v.key !== key) {
      const bp = this.game.blueprint(st.shipId);
      const order = repairOrder(st.from, bp);
      const k0 = Math.min(order.length, Math.floor(order.length * st.job.p));
      const spec = SHIPS.find((x) => x.id === st.shipId) ?? SHIPS[0];
      const grid = damagedGrid(spec.build(), st.from);
      for (let k = 0; k < k0; k++) putBack(grid, bp, order[k]);
      v = this.vis = { key, bp, grid, order, done: k0, flashes: [], paintedAt: now, dirty: false, drones };
      this.sprite = makeDockSprite(grid);
      this.paintThumb(this.shipId);
    }
    const n = v.order.length;
    const k = Math.min(n, Math.floor(n * st.job.p));
    while (v.done < k) {
      const bi = v.order[v.done++];
      v.flashes.push({ x: v.bp.xOf(bi), y: v.bp.yOf(bi), t: now });
      putBack(v.grid, v.bp, bi);
      v.dirty = true;
    }
    // the picture of the ship follows, a few times a second (the big ships cost more to paint)
    const gap = v.grid.width * v.grid.height > 8000 ? 380 : 150;
    if (v.dirty && now - v.paintedAt > gap) {
      this.sprite = makeDockSprite(v.grid);
      v.paintedAt = now;
      v.dirty = false;
      this.paintThumb(this.shipId);
    }
    v.flashes = v.flashes.filter((f) => now - f.t < 400);
    // the drones fly to the next cells to come back; the beam is on only once a drone is there
    const hover = [
      [-15, -13],
      [15, -13],
      [0, 17],
    ];
    const targets = [0, 1, 2].map((i) => {
      const bi = v!.order[k + i];
      return bi === undefined ? null : { x: v!.bp.xOf(bi), y: v!.bp.yOf(bi) };
    });
    const want = targets.map((tg, i) => (tg ? { x: tg.x + hover[i][0], y: tg.y + hover[i][1] } : slot(i)));
    this.flyDrones(drones, want, dt);
    const beams = targets.map((tg, i) => (tg && Math.hypot(drones[i].x - want[i].x, drones[i].y - want[i].y) < 4 ? tg : null));
    return { drones: drones.map((d, i) => ({ x: d.x, y: d.y, target: beams[i] })), flashes: v.flashes.map((f) => ({ x: f.x, y: f.y, age: (now - f.t) / 1000 })) };
  }

  /** Moves the drones toward where they are wanted at a flying speed, so they are seen to go. */
  private flyDrones(drones: Array<{ x: number; y: number }>, want: Array<{ x: number; y: number }>, dt: number): void {
    const step = 70 * dt;
    drones.forEach((d, i) => {
      const dx = want[i].x - d.x;
      const dy = want[i].y - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= step) {
        d.x = want[i].x;
        d.y = want[i].y;
      } else {
        d.x += (dx / dist) * step;
        d.y += (dy / dist) * step;
      }
    });
  }

  /** Four times a second: timers, the fleet's states, the way out's note, the repair card, the wallet. */
  private uiTick(): void {
    this.updateFleetStatus();
    this.updateGoNote();
    this.flushNotes();
    const st = this.game.repairState();
    if (this.roomBadge) this.roomBadge.hidden = !(st.damage.any && !st.job);
    if (this.room === 'repair') this.updateRepair();
  }

  /** The repair room's card: rebuilt when its shape changes (a repair starts, metal runs short), otherwise only its numbers move. */
  private updateRepair(): void {
    const g = this.game;
    const st = g.repairState();
    const w = g.wallet;
    const half = g.speedUpPrice('half');
    const full = g.speedUpPrice('full');
    const sig = [st.shipId, st.where, st.job ? 'j' : '', st.damage.any ? 'd' : '', st.damage.wreck ? 'w' : '', w.metal >= st.quote.metal ? 'm' : '', half !== null && w.quanta >= half ? 'h' : '', full !== null && w.quanta >= full ? 'f' : '', this.portrait ? 'p' : ''].join('|');
    if (sig !== this.repairSig) {
      this.repairSig = sig;
      this.buildRepairCard(st, half, full);
      return;
    }
    const q = (sel: string) => this.card.querySelector(sel) as HTMLElement | null;
    if (st.job) {
      const t = q('[data-timer]');
      if (t) t.textContent = mmss(st.job.left);
      const pr = q('[data-prog]');
      if (pr) pr.style.width = `${Math.round(st.job.p * 100)}%`;
      const c = q('[data-cells]');
      if (c && st.base) c.textContent = `${num(Math.max(0, st.base.cells - st.damage.cells))} / ${num(st.base.cells)}`;
      const h = q('[data-hull]');
      if (h) h.textContent = `${Math.round(st.damage.hull * 100)}%`;
      const b1 = q('[data-price="half"]');
      if (b1 && half !== null) b1.textContent = w.quanta >= half ? `−${half} кв.` : `нужно ${half} кв.`;
      const b2 = q('[data-price="full"]');
      if (b2 && full !== null) b2.textContent = w.quanta >= full ? `−${full} кв.` : `нужно ${full} кв.`;
    }
  }

  private buildRepairCard(st: ReturnType<Game['repairState']>, half: number | null, full: number | null): void {
    const c = this.card;
    c.replaceChildren();
    c.classList.add('rep', 'rm');
    const spec = SHIPS.find((x) => x.id === st.shipId);
    const name = spec?.label ?? '';
    const hull = Math.round(st.damage.hull * 100);
    const cls = hull > 85 ? '' : hull > 40 ? 'w' : 'b';
    const w = this.game.wallet;
    let h = '<div class="name">Ремонт</div>';
    if (st.job) {
      h += `<div class="cls">${name} · идёт работа${this.road ? ' · док на пути' : ''}</div>`;
      h += `<div class="big" data-timer>${mmss(st.job.left)}</div>`;
      h += `<div class="hullbar"><i class="f" data-prog style="width:${Math.round(st.job.p * 100)}%"></i></div>`;
      const base = st.base?.cells ?? 0;
      h += `<div class="row"><small>Починено клеток</small><b data-cells>${num(Math.max(0, base - st.damage.cells))} / ${num(base)}</b></div>`;
      h += `<div class="row"><small>Корпус</small><b data-hull>${hull}%</b></div>`;
      if (st.shipId !== SPARE_SHIP && half !== null && full !== null) {
        h += `<button type="button" class="btn prem" data-act="half"${w.quanta < half ? ' disabled' : ''}>Ускорить вдвое<small data-price="half">${w.quanta >= half ? `−${half} кв.` : `нужно ${half} кв.`}</small></button>`;
        h += `<button type="button" class="btn prem" data-act="full"${w.quanta < full ? ' disabled' : ''}>Завершить сразу<small data-price="full">${w.quanta >= full ? `−${full} кв.` : `нужно ${full} кв.`}</small></button>`;
      }
      h += this.road ? '<div class="note"><b>Можно лететь не дожидаясь.</b> Починится столько, сколько успели.</div>' : '<div class="note">Таймер идёт и пока игра закрыта.</div>';
    } else if (!st.damage.any) {
      h += `<div class="cls">${name}</div><div class="row"><small>Корпус</small><b class="free">100%</b></div><div class="hullbar"><i style="width:100%"></i></div>`;
      h += '<div class="note"><b>Чинить нечего.</b> После вылета здесь появится список повреждений, цена и время.</div>';
    } else {
      h += `<div class="cls">${name} · корпус ${hull}%${this.road ? ' · док на пути' : ''}</div>`;
      h += `<div class="hullbar"><i class="${cls}" style="width:${hull}%"></i></div>`;
      if (st.damage.wreck) h += '<div class="state"><span class="tag2 bd">Разрушен</span></div>';
      h += `<div class="row"><small>Разбито клеток</small><b>${num(st.damage.cells)}</b></div>`;
      h += `<div class="row"><small>Модулей вышло из строя</small><b>${st.damage.modules} из ${st.damage.modulesTotal}</b></div>`;
      h += `<div class="row"><small>Время</small><b>${mmss(st.quote.secs)}</b></div>`;
      h += `<div class="row"><small>Цена</small><b class="${st.quote.metal ? '' : 'free'}">${st.quote.metal ? num(st.quote.metal) + ' металла' : 'бесплатно'}</b></div>`;
      if (this.road) h += '<div class="state"><span class="tag2 in">на пути: быстрее и дешевле</span></div>';
      const short = st.quote.metal - w.metal;
      h += `<button type="button" class="btn pri" data-act="start"${short > 0 ? ' disabled' : ''}>Начать ремонт<small>${short > 0 ? `не хватает ${num(short)} мет.` : st.quote.metal ? `−${num(st.quote.metal)} мет.` : 'без оплаты'}</small></button>`;
      if (st.shipId === SPARE_SHIP) h += '<div class="note"><b>Запасной корабль:</b> ремонт бесплатный и быстрый, вылет никогда не блокируется.</div>';
      else if (!this.road) h += '<div class="note">Пока корабль в ремонте, лететь на нём нельзя. Выберите другой в парке слева.</div>';
      if (st.damage.wreck && !this.road && st.shipId !== SPARE_SHIP) h += '<button type="button" class="btn" data-act="spare">Лететь на запасном<small>истребитель</small></button>';
    }
    c.innerHTML = h;
    c.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', () => this.repairAct((el as HTMLElement).dataset.act!)));
  }

  private repairAct(act: string): void {
    const g = this.game;
    if (act === 'start') {
      const r = g.startRepair();
      if (r === 'metal') this.toast('Не хватает металла.');
      else if (r === 'ok') this.toast('Ремонт начат.');
    } else if (act === 'half' || act === 'full') {
      if (g.speedUpRepair(act)) this.toast(act === 'half' ? 'Ремонт ускорен вдвое.' : 'Ремонт закончен за кванты.');
    } else if (act === 'spare') this.pickShip(SPARE_SHIP);
    this.repairSig = '';
    this.renderResources();
    this.uiTick();
  }

  // ---------------------------------------------------------------- the fleet

  private buildFleet(): void {
    this.bays.replaceChildren();
    this.bayEm.clear();
    this.bayCv.clear();
    for (const s of SHIPS) {
      const b = btn('', () => this.pickShip(s.id));
      b.className = 'bay glass' + (s.id === this.shipId ? ' on' : '');
      b.disabled = this.road && s.id !== this.shipId;
      const th = div('th');
      const cv = document.createElement('canvas');
      this.bayCv.set(s.id, cv);
      th.appendChild(cv);
      this.paintThumb(s.id);
      const tx = div('tx');
      const name = document.createElement('b');
      name.textContent = s.label;
      const st = document.createElement('em');
      this.bayEm.set(s.id, st);
      tx.append(name, st);
      b.append(th, tx);
      this.bays.appendChild(b);
    }
    this.updateFleetStatus();
  }

  /** The small picture of a ship in the fleet list: the one at the berth as it is now, the others as built. */
  private paintThumb(id: string): void {
    const cv = this.bayCv.get(id);
    if (!cv) return;
    const sp = id === this.shipId ? this.sprite : stockSprite(id);
    cv.width = sp.w;
    cv.height = sp.h;
    cv.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(sp.views[0]), sp.w, sp.h), 0, 0);
  }

  private updateFleetStatus(): void {
    const now = Date.now();
    for (const s of SHIPS) {
      const em = this.bayEm.get(s.id);
      if (!em) continue;
      const st = this.game.shipStatus(s.id, now);
      let text: string;
      let cls = '';
      if (st.kind === 'repair') {
        text = `ремонт ${mmss(st.left)}`;
        cls = 'rp';
      } else if (st.kind === 'wreck') {
        text = 'разрушен';
        cls = 'bd';
      } else if (st.kind === 'damaged') {
        text = `корпус ${Math.round(st.hull * 100)}%`;
        cls = 'bd';
      } else text = s.id === this.shipId ? 'в захватах' : 'готов';
      if (em.textContent !== text) em.textContent = text;
      if (em.className !== cls) em.className = cls;
    }
  }

  private pickShip(id: string): void {
    this.fleet.classList.remove('open');
    if (this.phase !== 'docked' || this.road || id === this.shipId) return;
    this.after = { kind: 'switch', id };
    if (this.reduce) this.finishLeaving();
    else this.startPhase('release');
  }

  // ---------------------------------------------------------------- choreography

  private setStatus(p: Phase): void {
    this.statusEl.textContent = p === 'docked' ? '' : ` · ${STATUS[p].toLowerCase()}`;
    this.statusEl.classList.toggle('moving', p !== 'docked');
  }

  private startPhase(p: Phase): void {
    this.phase = p;
    this.k = 0;
    this.setStatus(p);
  }

  private cycle(dir: number): void {
    if (this.phase !== 'docked' || this.road) return;
    const i = SHIPS.findIndex((s) => s.id === this.shipId);
    this.pickShip(SHIPS[(i + dir + SHIPS.length) % SHIPS.length].id);
  }

  private depart(): void {
    if (this.phase !== 'docked') return;
    if (!this.road && ['repair', 'wreck'].includes(this.game.shipStatus(this.shipId).kind)) return;
    this.menuPop.hidden = true;
    this.after = this.road ? { kind: 'continue' } : { kind: 'run' };
    if (this.reduce) this.finishLeaving();
    else this.startPhase('release');
  }

  /** Leaves the dock for somewhere that isn't a flight (sandbox, menu): straight away. */
  private leave(action: () => void): void {
    if (this.phase !== 'docked') return;
    this.menuPop.hidden = true;
    action();
  }

  private finishLeaving(): void {
    const a = this.after;
    this.after = null;
    if (a?.kind === 'continue') {
      this.game.leaveRoadDock();
      this.startPhase('docked');
      this.e = 1;
      return;
    }
    if (a?.kind === 'run') {
      if (!this.game.startRun()) {
        this.shipY = -this.sprite.h - 6;
        this.e = 0;
        this.startPhase('arrive');
        return;
      }
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
    if (!this.reduce && this.life) stepLife(this.life, dt);
    this.tickLines(now);
    this.game.tickRepairs(Date.now());
    const repair = this.tickVis(dt, now);
    if (now - this.uiAt > 250) {
      this.uiAt = now;
      this.uiTick();
    }
    if (this.flow && this.phase === 'docked') {
      this.flow.k = Math.min(1, this.flow.k + dt / 1.4);
      this.renderCargo();
      if (this.flow.k >= 1) {
        this.statusEl.textContent = '';
        this.flow = null;
        this.renderCargo();
      }
    } else if (this.phase === 'docked') this.renderResources();
    if (!this.root.hidden) {
      renderDock(this.L, this.B, this.sprite, { t: this.t, shipY: this.shipY, e: this.e, docked: this.phase === 'docked', layer: this.layer, life: this.life, repair }, this.img, this.glow);
      this.ctx.putImageData(this.img, 0, 0);
      this.gctx.putImageData(this.glow, 0, 0);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /** The wallet in the chips, updated only when it changes. */
  private renderResources(): void {
    const w = this.game.wallet;
    const c = Math.round(w.credits).toLocaleString('ru-RU');
    const m = Math.round(w.metal).toLocaleString('ru-RU');
    if (this.resCredits.textContent !== c) this.resCredits.textContent = c;
    if (this.resMetal.textContent !== m) this.resMetal.textContent = m;
    const q = Math.round(w.quanta).toLocaleString('ru-RU');
    if (this.resQuanta.textContent !== q) this.resQuanta.textContent = q;
  }

  /** The dispatcher's line changes every few seconds. */
  private tickLines(now: number): void {
    if (now - this.lineAt < 5500 && this.ticker.firstChild) return;
    this.lineAt = now;
    const l = LINES[this.reduce ? 0 : this.lineIx++ % LINES.length];
    this.ticker.innerHTML = `<b>${l[0]}</b><span>${l[1]}</span>`;
  }
}

const mmss = (secs: number): string => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${('0' + (s % 60)).slice(-2)}`;
};
const num = (v: number): string => Math.round(v).toLocaleString('ru-RU');

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
