import type { Game } from './game';
import { KIND_LOOK, Px, SECTOR_LOOK, clamp, fbm, hashInt, makePointIcon, mulberry, playerMarker, rampPick } from './render/pointArt';
import { holdCap } from './sim/cargo';
import { ROAD, sectorOfLink, type RoadPoint } from './sim/road';
import { SHIPS } from './sim/ships';

/**
 * The campaign map, as designed in «Карта похода Antimatter»: one endless road that runs
 * up the screen, a pixel scene on every point showing what waits there, the nebula colours
 * blending from sector to sector without a seam. The road is long, so the screen scrolls;
 * the mission to fly next (the current one) is lit in amber with a reticle and rings.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const CSS = `
#road { position: fixed; inset: 0; z-index: 40; background: #02030a; color: #e4e8fb; overflow: hidden; font: 400 14px/1.5 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace; -webkit-user-select: none; user-select: none; }
#road[hidden] { display: none; }
#road .rd-vp { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #2a3358 transparent; cursor: grab; overscroll-behavior: contain; }
#road .rd-vp.drag { cursor: grabbing; }
#road .rd-map { position: relative; width: 100%; }
#road .rd-back { position: absolute; left: 0; top: 0; overflow: hidden; }
#road .rd-back canvas { position: absolute; left: 0; top: 0; image-rendering: pixelated; image-rendering: crisp-edges; }
#road .rd-back canvas.rd-stars { opacity: .9; }
#road .rd-sector { position: absolute; left: 14px; z-index: 1; pointer-events: none; font: 600 10px/1 'Unbounded', 'Trebuchet MS', sans-serif; letter-spacing: .22em; text-transform: uppercase; text-shadow: 0 0 8px #000, 0 0 3px #000; }
#road svg.rd-paths { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
#road svg.rd-paths path { fill: none; stroke-linecap: round; }
#road .p-future { stroke: #5a6a9a; stroke-width: 2; stroke-dasharray: 3 9; opacity: .75; }
#road .p-done-glow { stroke: #59e6ff; stroke-width: 9; opacity: .18; }
#road .p-done { stroke: #59e6ff; stroke-width: 3; }
#road .p-leg-glow { stroke: #ffd24a; stroke-width: 10; opacity: .2; }
#road .p-leg { stroke: #ffd24a; stroke-width: 3; stroke-dasharray: 10 8; animation: rd-march 1s linear infinite; }
@keyframes rd-march { to { stroke-dashoffset: -18; } }
#road .rd-fog { position: absolute; left: 0; right: 0; top: 0; height: 240px; background: linear-gradient(#02030a 8%, rgba(2,3,10,.85) 40%, transparent); pointer-events: none; display: flex; align-items: flex-start; justify-content: center; padding-top: 150px; }
#road .rd-fog span { font: 600 10px/1.7 'Unbounded', 'Trebuchet MS', sans-serif; letter-spacing: .22em; text-transform: uppercase; color: #6d77a3; text-align: center; padding-inline: 20px; }

#road .rd-node { --k: #ff6a5a; --ico: 150px; position: absolute; transform: translate(-50%, -50%); width: 0; height: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
#road .rd-node:focus-visible { outline: 2px solid #ff4fd8; outline-offset: 3px; }
#road .rd-box { position: absolute; left: calc(var(--ico) / -2); top: calc(var(--ico) / -2); width: var(--ico); height: var(--ico); transition: transform .15s ease; }
#road .rd-node:hover .rd-box { transform: scale(1.07); }
#road .rd-halo { position: absolute; inset: -28%; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--k) 38%, transparent), transparent 66%); opacity: .55; pointer-events: none; }
#road .rd-node canvas.rd-ico { position: relative; display: block; width: 100%; height: 100%; image-rendering: pixelated; image-rendering: crisp-edges; }
#road .rd-node.boss .rd-box { transform: scale(1.3); }
#road .rd-node.boss:hover .rd-box { transform: scale(1.36); }
#road .rd-lab { position: absolute; top: calc(var(--ico) / 2 + 2px); left: -95px; width: 190px; text-align: center; display: flex; flex-direction: column; gap: 2px; text-shadow: 0 0 6px #000, 0 0 3px #000, 0 0 12px #000; pointer-events: none; }
#road .rd-node.boss .rd-lab { top: calc(var(--ico) / 2 + 26px); }
#road .rd-lab b { font: 600 11px/1.2 'Unbounded', 'Trebuchet MS', sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--k); }
#road .rd-lab span { font-size: 11px; color: #b9c0e0; line-height: 1.3; }
#road .rd-num { position: absolute; left: -2px; top: 0; font: 600 11px/1 'JetBrains Mono', monospace; color: #cfd6f5; background: rgba(5,7,15,.8); border: 1px solid #232a44; padding: 4px 6px; pointer-events: none; }
#road .rd-node.done canvas.rd-ico { filter: grayscale(.6) brightness(.55); }
#road .rd-node.done .rd-halo { opacity: .12; }
#road .rd-node.done .rd-lab b, #road .rd-node.done .rd-num { color: #6f86a8; }
#road .rd-node.done .rd-lab span { color: #66709a; }
#road .rd-chk { display: none; position: absolute; right: -2px; top: -2px; width: 22px; height: 22px; border-radius: 50%; background: #59e6ff; color: #04202a; font: 800 13px/1 'Unbounded', sans-serif; align-items: center; justify-content: center; box-shadow: 0 0 10px rgba(89,230,255,.6); }
#road .rd-node.done .rd-chk { display: flex; }
#road .rd-node.far canvas.rd-ico { filter: saturate(.75) brightness(.78); }
#road .rd-node.far .rd-halo { opacity: .3; }
#road .rd-node.far .rd-lab span { color: #7b84ab; }
#road .rd-node.next .rd-box::after { content: ''; position: absolute; inset: -6px; border: 1px dashed rgba(180,190,230,.55); border-radius: 50%; }
#road .rd-node.sel .rd-box::before { content: ''; position: absolute; inset: -10px; border: 1px solid #59e6ff; border-radius: 50%; opacity: .8; }
#road .rd-node.current .rd-halo { inset: -55%; opacity: 1; background: radial-gradient(circle, rgba(255,210,74,.42), rgba(255,210,74,.1) 45%, transparent 68%); }
#road .rd-ring { display: none; position: absolute; inset: -8px; border: 2px solid #ffd24a; border-radius: 50%; animation: rd-ping 2.4s ease-out infinite; pointer-events: none; }
#road .rd-ring.r2 { animation-delay: 1.2s; }
#road .rd-node.current .rd-ring { display: block; }
@keyframes rd-ping { 0% { transform: scale(.85); opacity: .9; } 100% { transform: scale(1.7); opacity: 0; } }
#road .rd-ret { display: none; position: absolute; inset: -14px; pointer-events: none; animation: rd-pulse 1.6s ease-in-out infinite; }
#road .rd-node.current .rd-ret { display: block; }
#road .rd-ret i { position: absolute; width: 18px; height: 18px; border: 0 solid #ffd24a; }
#road .rd-ret i:nth-child(1) { left: 0; top: 0; border-left-width: 3px; border-top-width: 3px; }
#road .rd-ret i:nth-child(2) { right: 0; top: 0; border-right-width: 3px; border-top-width: 3px; }
#road .rd-ret i:nth-child(3) { left: 0; bottom: 0; border-left-width: 3px; border-bottom-width: 3px; }
#road .rd-ret i:nth-child(4) { right: 0; bottom: 0; border-right-width: 3px; border-bottom-width: 3px; }
@keyframes rd-pulse { 50% { transform: scale(1.06); opacity: .75; } }
#road .rd-tag { display: none; position: absolute; left: 50%; top: calc(var(--ico) / -2 - 38px); transform: translateX(-50%); white-space: nowrap; font: 800 10px/1 'Unbounded', 'Trebuchet MS', sans-serif; letter-spacing: .16em; text-transform: uppercase; color: #1a1204; background: #ffd24a; padding: 6px 9px; box-shadow: 0 0 16px rgba(255,210,74,.55); pointer-events: none; }
#road .rd-node.current .rd-tag { display: block; }
#road .rd-node.boss .rd-tag { top: calc(var(--ico) / -2 - 58px); }
#road .rd-node.current .rd-lab b { color: #ffd24a; }
#road .rd-node.current .rd-lab span { color: #fff2c4; }
#road .rd-node.current .rd-num { color: #ffd24a; border-color: #ffd24a; }

#road .rd-ship { position: absolute; width: 0; height: 0; pointer-events: none; z-index: 3; }
#road .rd-ship canvas { position: absolute; left: -17px; top: -22px; width: 34px; image-rendering: pixelated; filter: drop-shadow(0 0 8px rgba(89,230,255,.8)); }
#road .rd-ship.idle canvas { animation: rd-bob 3s ease-in-out infinite; }
@keyframes rd-bob { 50% { transform: translateY(-5px); } }
#road .rd-ship .you { position: absolute; left: 22px; top: -8px; font: 600 9px/1 'Unbounded', sans-serif; letter-spacing: .16em; color: #59e6ff; text-shadow: 0 0 6px #000; white-space: nowrap; }
#road .rd-ship.left .you { left: auto; right: 22px; }

#road .rd-hud { position: absolute; left: 0; right: 0; top: 0; padding: calc(12px + env(safe-area-inset-top, 0px)) 14px 30px; display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-start; justify-content: space-between; background: linear-gradient(rgba(2,3,10,.92), rgba(2,3,10,.55) 60%, transparent); pointer-events: none; z-index: 5; }
#road .rd-where { font: 600 10px/1.5 'Unbounded', 'Trebuchet MS', sans-serif; letter-spacing: .18em; text-transform: uppercase; }
#road .rd-where small { display: block; font: 400 11px/1.3 'JetBrains Mono', monospace; letter-spacing: .04em; text-transform: none; color: #8c93b4; }
#road .rd-stats { display: flex; flex-wrap: wrap; gap: 6px; pointer-events: auto; }
#road .rd-stats span { font-size: 11px; color: #8c93b4; background: rgba(8,11,24,.85); border: 1px solid #232a44; padding: 5px 8px; }
#road .rd-stats b { color: #e4e8fb; font-weight: 600; margin-left: 4px; }
#road .rd-sheet { position: absolute; left: 0; right: 0; bottom: 0; padding: 40px 14px calc(14px + env(safe-area-inset-bottom, 0px)); background: linear-gradient(transparent, rgba(2,3,10,.9) 38%); z-index: 5; pointer-events: none; }
#road .rd-card { --k: #ffd24a; pointer-events: auto; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px 16px; align-items: center; max-width: 720px; margin: 0 auto; background: rgba(9,13,28,.96); border: 1px solid #232a44; border-left: 3px solid var(--k); padding: 12px 14px; }
#road .rd-pic { width: 64px; height: 64px; grid-row: span 2; }
#road .rd-pic canvas { width: 100%; height: 100%; image-rendering: pixelated; }
#road .rd-meta { font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: #8c93b4; }
#road .rd-ttl { font: 600 14px/1.3 'Unbounded', 'Trebuchet MS', sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #e4e8fb; }
#road .rd-desc { font-size: 12px; color: #b9c0e0; }
#road .rd-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
#road .rd-chip { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; padding: 3px 7px; border: 1px solid #232a44; color: #8c93b4; white-space: nowrap; }
#road .rd-chip.k { color: var(--k); border-color: color-mix(in srgb, var(--k) 50%, transparent); }
#road .rd-chip.cur { color: #ffd24a; border-color: #ffd24a; }
#road .rd-acts { display: flex; flex-direction: column; gap: 6px; }
#road .rd-btn { font: 600 11px/1 'Unbounded', 'Trebuchet MS', sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #e4e8fb; background: rgba(8,11,24,.85); border: 1px solid #232a44; padding: 11px 14px; cursor: pointer; text-align: center; }
#road .rd-btn:hover { border-color: #59e6ff; }
#road .rd-btn:focus-visible { outline: 2px solid #ff4fd8; outline-offset: 3px; }
#road .rd-btn.go { color: #1a1204; background: #ffd24a; border-color: #ffd24a; }
#road .rd-btn.go:hover { background: #ffe27a; }
#road .rd-btn[disabled] { opacity: .45; cursor: default; }
#road .rd-btn[disabled]:hover { border-color: #232a44; }
#road .rd-btn.small { padding: 7px 9px; font-size: 9px; }
#road .rd-toast { position: absolute; left: 50%; bottom: 168px; transform: translate(-50%, 10px); max-width: calc(100% - 28px); background: rgba(10,14,30,.96); border: 1px solid #59e6ff; color: #e4e8fb; font-size: 12px; padding: 9px 14px; opacity: 0; transition: opacity .25s, transform .25s; pointer-events: none; z-index: 8; text-align: center; }
#road .rd-toast.on { opacity: 1; transform: translate(-50%, 0); }
#road.phone .rd-card { grid-template-columns: auto minmax(0, 1fr); }
#road.phone .rd-acts { grid-column: 1 / -1; flex-direction: row; }
#road.phone .rd-acts .rd-btn { flex: 1; }
#road.phone .rd-pic { width: 52px; height: 52px; }
#road.phone .rd-stats .rd-shipname { display: none; }
#road.phone .rd-toast { bottom: 210px; }
#road .rd-stats span.safe { border-color: rgba(99,224,122,.4); }
#road .rd-stats span.safe b { color: #63e07a; }
#road .rd-stats span.risk { color: #ffd24a; border-color: rgba(255,210,74,.6); }
#road .rd-stats span.risk b { color: #ffd24a; }
#road .rd-stats span.full { color: #ff6a5a; border-color: rgba(255,106,90,.7); }
#road .rd-stats span.full b { color: #ff6a5a; }
#road .rd-chip.risk { color: #ffd24a; border-color: rgba(255,210,74,.6); }
#road .rd-modal { position: absolute; inset: 0; z-index: 12; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(2,3,10,.78); }
#road .rd-modal[hidden] { display: none; }
#road .rd-dialog { width: min(420px, 100%); background: #090d1c; border: 1px solid #232a44; border-left: 3px solid #ffd24a; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
#road .rd-dialog h3 { margin: 0; font: 800 14px/1.2 'Unbounded', sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #ffd24a; }
#road .rd-dialog .ln { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; color: #cdd3ee; }
#road .rd-dialog .ln b { font-variant-numeric: tabular-nums; }
#road .rd-dialog .hint { font-size: 11.5px; color: #8c93b4; line-height: 1.5; }
#road .rd-dialog .btns { display: flex; gap: 8px; flex-wrap: wrap; }
@media (prefers-reduced-motion: reduce) { #road .rd-ring, #road .rd-ret, #road .p-leg, #road .rd-ship.idle canvas { animation: none; } }
`;

const NAMES: Record<string, [string, string, string]> = {
  scout: ['разведчик', 'разведчика', 'разведчиков'],
  raider: ['налётчик', 'налётчика', 'налётчиков'],
  hunter: ['охотник', 'охотника', 'охотников'],
  boss: ['линкор', 'линкора', 'линкоров'],
};

function enemyText(list: string[]): string {
  const count = new Map<string, number>();
  for (const e of list) count.set(e, (count.get(e) ?? 0) + 1);
  return [...count.entries()]
    .map(([e, n]) => {
      const f = NAMES[e] ?? [e, e, e];
      const word = n === 1 ? f[0] : n < 5 ? f[1] : f[2];
      return n > 1 ? `${n} ${word}` : word;
    })
    .join(' + ');
}

/** The words that go with a point: its name and one line about what waits there. */
function describe(p: RoadPoint): { title: string; sub: string } {
  switch (p.kind) {
    case 'combat':
      return { title: 'Бой', sub: enemyText(p.enemies) };
    case 'elite':
      return { title: 'Элитный бой', sub: enemyText(p.enemies) };
    case 'boss':
      return { title: 'Рубеж', sub: `линкор-страж, звено ${p.link + 1}` };
    case 'dock':
      return { title: 'Док', sub: 'починить корпус и перевести дух' };
    case 'gate':
      return p.link === 0 ? { title: 'Старт похода', sub: 'врата дока' } : { title: 'Врата', sub: `прыжок в «${SECTOR_LOOK[p.sector].name}»` };
    case 'shop':
      return { title: 'Торговец', sub: 'уникальные модули и космонавты' };
    case 'mining':
      return { title: 'Добыча', sub: 'жила металла в астероидах' };
    default:
      return { title: 'Сигнал', sub: 'неизвестный сигнал' };
  }
}

interface Metrics {
  w: number;
  h: number;
  phone: boolean;
  step: number;
  ico: number;
  padB: number;
  padT: number;
  /** Width of the column the road winds in, and its left edge. */
  col: number;
  off: number;
}

export class RoadScreen {
  private readonly root = document.createElement('div');
  private readonly vp = document.createElement('div');
  private readonly map = document.createElement('div');
  private readonly hud = document.createElement('div');
  private readonly where = document.createElement('div');
  private readonly stats = document.createElement('div');
  private readonly card = document.createElement('div');
  private readonly toastEl = document.createElement('div');
  private readonly modal = document.createElement('div');
  private key = '';
  private noteShown = '';
  private sel: number | null = null;
  private busy = false;
  private M!: Metrics;
  private pts: Array<{ x: number; y: number }> = [];
  private shipEl: HTMLElement | null = null;
  private legPath: SVGPathElement | null = null;
  private moved = false;
  private toastTimer = 0;
  private nebula: { key: string; canvas: HTMLCanvasElement } | null = null;

  constructor(
    private readonly game: Game,
    parent: HTMLElement,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const r = this.root;
    r.id = 'road';
    r.hidden = true;
    this.vp.className = 'rd-vp';
    this.map.className = 'rd-map';
    this.vp.appendChild(this.map);
    this.hud.className = 'rd-hud';
    this.where.className = 'rd-where';
    this.stats.className = 'rd-stats';
    this.hud.append(this.where, this.stats);
    const sheet = document.createElement('div');
    sheet.className = 'rd-sheet';
    this.card.className = 'rd-card';
    sheet.appendChild(this.card);
    this.toastEl.className = 'rd-toast';
    this.modal.className = 'rd-modal';
    this.modal.hidden = true;
    r.append(this.vp, this.hud, sheet, this.toastEl, this.modal);
    parent.appendChild(r);

    // Dragging with a mouse scrolls the road; touch and the wheel scroll it natively.
    let y0 = 0;
    let s0 = 0;
    let down = false;
    this.vp.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true;
      y0 = e.clientY;
      s0 = this.vp.scrollTop;
      this.moved = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dy = e.clientY - y0;
      if (Math.abs(dy) > 5) {
        this.moved = true;
        this.vp.classList.add('drag');
      }
      if (this.moved) this.vp.scrollTop = s0 - dy;
    });
    window.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      this.vp.classList.remove('drag');
      setTimeout(() => (this.moved = false), 0);
    });
    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = window.setTimeout(() => {
        if (!this.root.hidden) {
          this.key = '';
        }
      }, 150);
    });
  }

  /** Called every frame: shows the road whenever the run is between points. */
  update(): void {
    const g = this.game;
    const show = g.screen === 'game' && g.mode === 'run' && g.runPhase === 'map' && !!g.run;
    if (!show) {
      if (!this.root.hidden) {
        this.root.hidden = true;
        this.key = '';
      }
      return;
    }
    const run = g.run!;
    const key = [run.cleared, run.road.links, g.shipId, window.innerWidth, window.innerHeight, run.note, run.cargo.credits, run.cargo.metal, g.wallet.credits, g.wallet.metal, run.road.regens.length].join('|');
    if (!this.root.hidden && key === this.key) return;
    const wasHidden = this.root.hidden;
    const fresh = this.key.split('|')[0] !== String(run.cleared) || wasHidden;
    this.root.hidden = false;
    this.key = key;
    if (fresh) this.sel = null;
    this.busy = false;
    this.build();
    if (fresh) this.scrollToPoint(run.cleared + 1, false);
    if (run.note && run.note !== this.noteShown) {
      this.noteShown = run.note;
      this.toast(run.note);
    }
  }

  private metrics(): Metrics {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const phone = w < 560;
    const col = Math.min(w, 900);
    return { w, h, phone, step: phone ? 206 : 250, ico: phone ? 124 : 156, padB: 190, padT: 300, col, off: (w - col) / 2 };
  }

  private xOf(p: RoadPoint, M: Metrics): number {
    if (p.kind === 'gate') return M.off + 0.5 * M.col;
    const v = clamp(0.5 + 0.27 * Math.sin(p.index * 0.9 + 0.5) + 0.06 * Math.sin(p.index * 2.4 + 1), M.phone ? 0.26 : 0.2, M.phone ? 0.74 : 0.8);
    return M.off + v * M.col;
  }

  private stateOf(i: number): 'done' | 'current' | 'next' | 'far' {
    const c = this.game.run!.cleared;
    return i <= c ? 'done' : i === c + 1 ? 'current' : i === c + 2 ? 'next' : 'far';
  }

  private build(): void {
    const g = this.game;
    const run = g.run!;
    const road = run.road;
    const points = road.points;
    this.root.classList.toggle('phone', this.root.clientWidth < 560);
    const M = (this.M = this.metrics());
    const H = M.padB + (points.length - 1) * M.step + M.padT;
    const W = M.w;
    this.map.style.height = H + 'px';
    this.map.textContent = '';
    const Y = (i: number) => H - M.padB - i * M.step;
    const P = points.map((p) => ({ x: this.xOf(p, M), y: Y(p.index) }));
    this.pts = P;

    this.map.appendChild(this.backdrop(W, H, M, road.links));
    for (let b = 0; b < road.links; b++) {
      const look = SECTOR_LOOK[sectorOfLink(b)];
      const nm = document.createElement('div');
      nm.className = 'rd-sector';
      nm.style.color = look.accent;
      nm.style.top = Y(b * ROAD.stride) - 6 + 'px';
      nm.textContent = `Звено ${b + 1} · ${look.name}`;
      this.map.appendChild(nm);
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'rd-paths');
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.legPath = null;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)];
      const p1 = P[i];
      const p2 = P[i + 1];
      const p3 = P[Math.min(points.length - 1, i + 2)];
      const d = `M${p1.x},${p1.y} C${p1.x + (p2.x - p0.x) / 5},${p1.y + (p2.y - p0.y) / 5} ${p2.x - (p3.x - p1.x) / 5},${p2.y - (p3.y - p1.y) / 5} ${p2.x},${p2.y}`;
      const add = (cls: string): SVGPathElement => {
        const e = document.createElementNS(SVG_NS, 'path');
        e.setAttribute('d', d);
        e.setAttribute('class', cls);
        svg.appendChild(e);
        return e;
      };
      if (i + 1 <= run.cleared) {
        add('p-done-glow');
        add('p-done');
      } else if (i === run.cleared) {
        add('p-leg-glow');
        this.legPath = add('p-leg');
      } else add('p-future');
    }
    this.map.appendChild(svg);

    const current = run.cleared + 1;
    for (const p of points) this.map.appendChild(this.nodeEl(p, P[p.index], M));

    const ship = document.createElement('div');
    ship.className = 'rd-ship idle';
    const sc = playerMarker();
    ship.appendChild(sc);
    ship.insertAdjacentHTML('beforeend', '<div class="you">ВЫ</div>');
    this.shipEl = ship;
    this.placeShip(P[run.cleared]);
    this.map.appendChild(ship);

    const fog = document.createElement('div');
    fog.className = 'rd-fog';
    const top = road.links * ROAD.linkLen;
    fog.innerHTML = `<span>Дальше туман<br>миссии ${top + 1}–${top + 10} появятся, когда вы возьмёте миссию ${top - ROAD.linkLen + ROAD.writeNextAtSlot}</span>`;
    this.map.appendChild(fog);

    this.renderHud(current);
    this.renderCard();
  }

  /** One backdrop for the whole road: nebula colours blend from sector to sector around every gate. */
  private backdrop(W: number, H: number, M: Metrics, links: number): HTMLElement {
    const back = document.createElement('div');
    back.className = 'rd-back';
    back.style.width = W + 'px';
    back.style.height = H + 'px';
    const scale = M.phone ? 5 : 6;
    const w0 = Math.ceil(W / scale);
    const h0 = Math.ceil(H / scale);
    const nkey = `${w0}x${h0}|${links}`;
    if (!this.nebula || this.nebula.key !== nkey) {
      const neb = new Px(w0, h0);
      const win = 0.16;
      const smooth = (a: number, b: number, x: number) => {
        const t = clamp((x - a) / (b - a));
        return t * t * (3 - 2 * t);
      };
      for (let y = 0; y < h0; y++) {
        const bf = (H - M.padB - y * scale) / M.step / ROAD.stride;
        const bs = Math.max(0, bf) + win;
        const k = Math.floor(bs);
        const u = smooth(0, 2 * win, bs - k);
        const cur = SECTOR_LOOK[sectorOfLink(Math.min(links - 1, k))].nebula;
        const prev = SECTOR_LOOK[sectorOfLink(Math.max(0, Math.min(links - 1, k) - 1))].nebula;
        const edge = Math.min(1, (h0 - y) / 12, y / 30);
        for (let x = 0; x < w0; x++) {
          const v = (fbm(x * 0.06, y * 0.06, 41, 5) - 0.3) * 0.95 * Math.max(0.2, edge);
          const c1 = rampPick(cur, v, x, y);
          if (k < 1 || u >= 1) {
            neb.set(x, y, c1);
            continue;
          }
          const c0 = rampPick(prev, v, x, y);
          neb.set(x, y, [Math.round(c0[0] + (c1[0] - c0[0]) * u), Math.round(c0[1] + (c1[1] - c0[1]) * u), Math.round(c0[2] + (c1[2] - c0[2]) * u)]);
        }
      }
      this.nebula = { key: nkey, canvas: neb.done() };
    }
    const nc = document.createElement('canvas');
    nc.width = w0;
    nc.height = h0;
    nc.getContext('2d')!.drawImage(this.nebula.canvas, 0, 0);
    nc.style.width = w0 * scale + 'px';
    nc.style.height = h0 * scale + 'px';
    back.appendChild(nc);
    const stars = new Px(Math.round(W / 2), Math.round(H / 2));
    const rs = mulberry(hashInt(31, 5));
    for (let i = 0; i < (stars.w * stars.h) / 60; i++) {
      stars.set(rs() * stars.w, rs() * stars.h, rs() < 0.15 ? '#ffffff' : rs() < 0.5 ? '#9fb0e0' : '#5a678f', 120 + ((rs() * 130) | 0));
    }
    const sc = stars.done();
    sc.className = 'rd-stars';
    sc.style.width = W + 'px';
    sc.style.height = H + 'px';
    back.appendChild(sc);
    return back;
  }

  private nodeEl(p: RoadPoint, pos: { x: number; y: number }, M: Metrics): HTMLElement {
    const st = this.stateOf(p.index);
    const look = KIND_LOOK[p.kind];
    const text = describe(p);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `rd-node ${st} ${p.kind}` + (this.sel === p.index && st !== 'current' ? ' sel' : '');
    b.style.setProperty('--k', look.color);
    b.style.setProperty('--ico', M.ico + 'px');
    b.style.left = pos.x + 'px';
    b.style.top = pos.y + 'px';
    b.dataset.index = String(p.index);
    b.setAttribute('aria-label', (p.mission ? `Миссия ${p.mission}: ` : '') + text.title + ', ' + text.sub);
    const box = document.createElement('div');
    box.className = 'rd-box';
    box.innerHTML = '<div class="rd-halo"></div>';
    const icon = makePointIcon(p);
    icon.className = 'rd-ico';
    box.appendChild(icon);
    box.insertAdjacentHTML('beforeend', '<div class="rd-ring"></div><div class="rd-ring r2"></div><div class="rd-ret"><i></i><i></i><i></i><i></i></div><div class="rd-chk">✓</div>');
    if (p.mission) box.insertAdjacentHTML('beforeend', `<div class="rd-num">№${p.mission}</div>`);
    b.appendChild(box);
    const tag = document.createElement('div');
    tag.className = 'rd-tag';
    tag.textContent = p.kind === 'gate' || p.kind === 'dock' ? 'Текущая точка' : 'Текущая миссия';
    const lab = document.createElement('div');
    lab.className = 'rd-lab';
    const t = document.createElement('b');
    t.textContent = text.title;
    const s = document.createElement('span');
    s.textContent = text.sub;
    lab.append(t, s);
    b.append(tag, lab);
    b.addEventListener('click', () => {
      if (this.moved) return;
      this.select(p.index, true);
    });
    return b;
  }

  private placeShip(pt: { x: number; y: number }): void {
    const ship = this.shipEl!;
    const M = this.M;
    const right = pt.x < M.off + M.col * 0.6;
    ship.style.left = pt.x + (right ? M.ico * 0.62 : -M.ico * 0.62) + 'px';
    ship.style.top = pt.y - 4 + 'px';
    ship.classList.toggle('left', !right);
    ship.style.transform = '';
  }

  private scrollToPoint(i: number, smooth: boolean): void {
    const pt = this.pts[i] ?? this.pts[this.pts.length - 1];
    const y = pt.y - this.vp.clientHeight * (this.M.phone ? 0.44 : 0.55);
    this.vp.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
  }

  private select(i: number, center: boolean): void {
    this.sel = i;
    const cur = this.game.run!.cleared + 1;
    this.map.querySelectorAll<HTMLElement>('.rd-node').forEach((n) => n.classList.toggle('sel', Number(n.dataset.index) === i && i !== cur));
    this.renderCard();
    if (center) this.scrollToPoint(i, true);
  }

  private renderHud(current: number): void {
    const g = this.game;
    const run = g.run!;
    const p = run.road.points[current] ?? run.road.points[run.cleared];
    const look = SECTOR_LOOK[p.sector];
    this.where.innerHTML = '';
    const a = document.createElement('span');
    a.style.color = look.accent;
    a.textContent = `Звено ${p.link + 1} · ${look.name}`;
    const small = document.createElement('small');
    small.textContent = p.kind === 'gate' ? 'врата в следующее звено' : `точка ${p.slot} из ${ROAD.linkLen} · миссия №${p.mission}`;
    this.where.append(a, small);
    this.stats.replaceChildren();
    const stat = (label: string, value: string, cls = '') => {
      const s = document.createElement('span');
      if (cls) s.className = cls;
      const b = document.createElement('b');
      b.textContent = value;
      s.append(document.createTextNode(label), b);
      this.stats.appendChild(s);
    };
    stat('Корабль', SHIPS.find((s) => s.id === run.shipId)?.label ?? run.shipId, 'rd-shipname');
    stat('Корпус', `${Math.round(g.runHull() * 100)}%`);
    stat('Экипаж', run.ship ? String(g.runCrewAlive()) : '—');
    stat('Кредиты', String(g.wallet.credits), 'safe');
    stat('Металл', String(g.wallet.metal), 'safe');
    const cap = holdCap(run.shipId);
    const c = run.cargo;
    const full = c.metal >= cap;
    const holdChip = document.createElement('span');
    holdChip.className = full ? 'full' : c.credits + c.metal > 0 ? 'risk' : '';
    holdChip.title = 'Пропадёт, если корабль погибнет, пока не сдан в доке';
    const hb = document.createElement('b');
    hb.textContent = `${c.credits} кр. · ${c.metal}/${cap}${full ? ' · полон' : ''}`;
    holdChip.append(document.createTextNode(c.credits + c.metal > 0 ? '⚠ Трюм' : 'Трюм'), hb);
    this.stats.appendChild(holdChip);
    this.stats.append(button('Меню', () => (g.screen = 'title'), 'small'));
  }

  private renderCard(): void {
    const g = this.game;
    const run = g.run!;
    const i = this.sel ?? run.cleared + 1;
    const p = run.road.points[i];
    if (!p) return;
    const st = this.stateOf(i);
    const look = KIND_LOOK[p.kind];
    const text = describe(p);
    const card = this.card;
    card.style.setProperty('--k', look.color);
    card.replaceChildren();
    const pic = document.createElement('div');
    pic.className = 'rd-pic';
    pic.appendChild(makePointIcon(p));
    const info = document.createElement('div');
    info.style.minWidth = '0';
    const meta = div('rd-meta', p.kind === 'gate' ? `Звено ${p.link + 1} · врата` : `Миссия №${p.mission} · звено ${p.link + 1} · точка ${p.slot} из ${ROAD.linkLen}`);
    const chips = div('rd-chips', '');
    const stLabel = { done: 'пройдена', current: 'текущая миссия', next: 'следующая', far: 'впереди' }[st];
    chips.append(div('rd-chip k', look.name), div('rd-chip' + (st === 'current' ? ' cur' : ''), stLabel));
    if (p.tier) chips.append(div('rd-chip', `угроза ${p.tier}`));
    const risky = p.kind === 'combat' || p.kind === 'elite' || p.kind === 'boss';
    const cg = run.cargo;
    if (risky && st === 'current' && cg.credits + cg.metal > 0) {
      chips.append(div('rd-chip risk', `⚠ Под угрозой ${cg.credits} кр. · ${cg.metal} мет.`));
      const back = g.pointsToDock();
      if (back > 0) chips.append(div('rd-chip', `последний док ${back} ${back === 1 ? 'точка' : back < 5 ? 'точки' : 'точек'} назад`));
    }
    info.append(meta, div('rd-ttl', text.title), div('rd-desc', text.sub), chips);
    const acts = div('rd-acts', '');
    const go = button(st === 'current' ? (p.kind === 'dock' ? 'Зайти в док ▸' : p.kind === 'gate' ? 'Через врата ▸' : 'Начать миссию ▸') : st === 'done' ? 'Пройдена' : 'Откроется позже', () => this.fly(), 'go');
    go.disabled = st !== 'current' || this.busy;
    const loc = button('⌖ К текущей', () => this.select(run.cleared + 1, true));
    const back = button('↩ В последний док', () => this.askRetreat());
    back.disabled = this.busy || g.pointsToDock() === 0;
    acts.append(go, loc, back);
    card.append(pic, info, acts);
  }

  /** The ship flies the last leg of the road, then the game takes over (a fight, a dock). */
  private fly(): void {
    const g = this.game;
    const run = g.run!;
    const to = run.cleared + 1;
    if (this.busy || !g.canTravel(to)) return;
    this.busy = true;
    this.renderCard();
    const ship = this.shipEl!;
    ship.classList.remove('idle');
    const path = this.legPath;
    const len = path ? path.getTotalLength() : 0;
    const t0 = performance.now();
    const dur = 1300;
    this.scrollToPoint(to, true);
    const step = (now: number) => {
      const k = clamp((now - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      if (path) {
        const a = path.getPointAtLength(len * e);
        const b = path.getPointAtLength(Math.min(len, len * e + 2));
        ship.style.left = a.x + 'px';
        ship.style.top = a.y + 'px';
        ship.style.transform = `rotate(${Math.atan2(b.x - a.x, -(b.y - a.y))}rad)`;
        const you = ship.querySelector<HTMLElement>('.you');
        if (you) you.style.display = 'none';
      }
      if (k < 1 && !this.root.hidden) requestAnimationFrame(step);
      else {
        this.busy = false;
        g.travel(to);
      }
    };
    requestAnimationFrame(step);
  }

  private askRetreat(): void {
    const g = this.game;
    const run = g.run!;
    if (this.busy || g.pointsToDock() === 0) return;
    const dock = run.road.points[run.road.lastDock(run.cleared)];
    const lost: number[] = [];
    for (let i = dock.index + 1; i <= run.cleared; i++) if (run.road.points[i].mission) lost.push(run.road.points[i].mission);
    const c = run.cargo;
    const where = dock.kind === 'gate' ? (dock.link === 0 ? 'старт похода' : `врата звена ${dock.link + 1}`) : `миссия ${dock.mission}, звено ${dock.link + 1}`;
    const m = this.modal;
    m.replaceChildren();
    const box = div('rd-dialog', '');
    box.append(h3('Вернуться в док?'), div('hint', `Последний док: ${where}. Груз добавится к вашим ресурсам.`));
    const ln = (a: string, b: string) => {
      const d = div('ln', '');
      const x = document.createElement('span');
      x.textContent = a;
      const y = document.createElement('b');
      y.textContent = b;
      d.append(x, y);
      return d;
    };
    box.append(ln('Сдать', c.credits + c.metal > 0 ? `+${c.credits} кр. · +${c.metal} мет.` : 'трюм пуст'));
    if (lost.length) box.append(ln('Не засчитаются', lost.length > 3 ? `миссии ${lost[0]}–${lost[lost.length - 1]}` : `миссии ${lost.join(', ')}`));
    box.append(div('hint', 'Участок дороги после дока соберётся заново.'));
    const btns = div('btns', '');
    btns.append(button('Вернуться', () => {
      m.hidden = true;
      g.retreat();
    }, 'go'), button('Остаться', () => (m.hidden = true)));
    box.append(btns);
    m.appendChild(box);
    m.hidden = false;
  }

  private toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 3400);
  }
}

function h3(text: string): HTMLElement {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

function div(cls: string, text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  return d;
}

function button(label: string, onClick: () => void, extra = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rd-btn' + (extra ? ' ' + extra : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

