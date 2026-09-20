import { Game, type Tool } from './game';
import { OUTER_VIEW } from './render/shipView';
import { SHIPS } from './sim/ships';

const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; color: #cfe0ff; }
.panel { position: absolute; background: rgba(10,14,24,.8); border: 1px solid #26324a; border-radius: 8px; padding: 10px 12px; pointer-events: auto; backdrop-filter: blur(4px); }
.panel h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #7f95bf; font-weight: 600; }
.panel .row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.panel .row:last-child { margin-bottom: 0; }
.panel button { background: #182238; color: #cfe0ff; border: 1px solid #2a3a5c; border-radius: 5px; padding: 4px 8px; font: inherit; cursor: pointer; }
.panel button:hover { background: #22304f; }
.panel button.on { border-color: #59e6ff; color: #59e6ff; background: #14304a; }
.panel label { display: flex; align-items: center; gap: 6px; width: 100%; }
.panel label span { width: 78px; color: #8fa4cc; }
.panel input[type=range] { flex: 1; accent-color: #59e6ff; }
.panel .val { width: 34px; text-align: right; }
#stats { left: 12px; top: 12px; min-width: 260px; white-space: pre; }
#controls { right: 12px; top: 12px; width: 300px; }
#hint { left: 12px; bottom: 12px; color: #8fa4cc; max-width: 460px; }
`;

interface BtnOpts {
  toggle?: boolean;
}

export class Hud {
  private game: Game;
  private stats: HTMLDivElement;
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private layerBtns: HTMLButtonElement[] = [];
  private shipBtns = new Map<string, HTMLButtonElement>();
  private toggles: Array<{ el: HTMLButtonElement; get: () => boolean }> = [];
  private last = 0;

  constructor(game: Game, root: HTMLElement) {
    this.game = game;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.stats = document.createElement('div');
    this.stats.id = 'stats';
    this.stats.className = 'panel';
    root.appendChild(this.stats);

    const controls = document.createElement('div');
    controls.id = 'controls';
    controls.className = 'panel';
    root.appendChild(controls);

    const section = (title: string): HTMLDivElement => {
      const h = document.createElement('h4');
      h.textContent = title;
      controls.appendChild(h);
      const row = document.createElement('div');
      row.className = 'row';
      controls.appendChild(row);
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

    const tools = section('Инструмент (ЛКМ)');
    this.toolBtns.set('fly', button(tools, 'Полёт: цель', () => this.setTool('fly')));
    this.toolBtns.set('crater', button(tools, 'Удар: кратер', () => this.setTool('crater')));
    slider(tools, 'Радиус', 1, 14, 0.5, game.crater.radius, (v) => (game.crater.radius = v));
    slider(tools, 'Урон', 5, 300, 5, game.crater.damage, (v) => (game.crater.damage = v));
    slider(tools, 'Пробитие', 0, 1, 0.05, game.crater.pen, (v) => (game.crater.pen = v));

    const ships = section('Корабль');
    for (const s of SHIPS) this.shipBtns.set(s.id, button(ships, s.label, () => this.game.reset(s.id)));
    button(ships, 'Сброс сцены', () => this.game.reset());
    button(ships, '+ Мишень', () => this.game.spawnTarget());
    button(ships, 'Сломать двигатель', () => this.game.breakEngine());

    const layers = section('Вид (слой палубы)');
    const names = ['Внешний', 'Палуба 1', 'Палуба 2', 'Палуба 3'];
    for (let i = 0; i < 4; i++) {
      const idx = i === 0 ? OUTER_VIEW : i - 1;
      this.layerBtns.push(button(layers, names[i], () => (this.game.scene.layerView = idx)));
    }

    const flags = section('Режимы');
    const flag = (label: string, get: () => boolean, set: (v: boolean) => void): void => {
      const b = button(flags, label, () => set(!get()), { toggle: true });
      this.toggles.push({ el: b, get });
    };
    flag('Пауза', () => game.paused, (v) => (game.paused = v));
    flag('Замедление', () => game.slowMo, (v) => (game.slowMo = v));
    flag('Автопилот', () => game.world.autopilot, (v) => (game.world.autopilot = v));
    flag('Следить', () => game.scene.follow, (v) => (game.scene.follow = v));
    flag('Отладка', () => game.scene.showDebug, (v) => (game.scene.showDebug = v));

    const hint = document.createElement('div');
    hint.id = 'hint';
    hint.className = 'panel';
    hint.textContent = 'ЛКМ — куда лететь / куда бить (по инструменту). ПКМ + перетаскивание — камера. Колесо — масштаб.';
    root.appendChild(hint);

    this.setTool('fly');
  }

  private setTool(t: Tool): void {
    this.game.tool = t;
    this.game.scene.craterPreview = 0;
  }

  update(now: number): void {
    const g = this.game;
    g.scene.craterPreview = g.tool === 'crater' ? g.crater.radius : 0;
    for (const [t, b] of this.toolBtns) b.classList.toggle('on', g.tool === t);
    for (const [id, b] of this.shipBtns) b.classList.toggle('on', g.shipId === id);
    this.layerBtns.forEach((b, i) => b.classList.toggle('on', (i === 0 ? OUTER_VIEW : i - 1) === g.scene.layerView));
    for (const t of this.toggles) t.el.classList.toggle('on', t.get());

    if (now - this.last < 200) return;
    this.last = now;
    const tot = g.totals();
    const p = g.world.player;
    const lines: string[] = [];
    lines.push(`FPS ${g.scene.app.ticker.FPS.toFixed(0)}   физика ${g.stepMs.toFixed(2)} мс`);
    lines.push(`тел ${tot.bodies} (обломков ${tot.debris})   клеток ${tot.cells}`);
    if (p) {
      const e = p.engineSummary();
      const a = e.thrust / Math.max(p.mass, 1e-6);
      const gr = g.world.gravityAt(p.x, p.y);
      const deg = ((((p.angle * 180) / Math.PI) % 360) + 360) % 360;
      lines.push(`масса ${p.mass.toFixed(0)}   палуб ${p.grid.depth}`);
      lines.push(`двигатели ${e.alive}/${e.total}   тяга ${a.toFixed(1)} кл/с²`);
      lines.push(`скорость ${Math.hypot(p.vx, p.vy).toFixed(1)} кл/с   курс ${deg.toFixed(0)}°`);
      lines.push(`газ ${(p.throttle * 100).toFixed(0)}%   вращ ${p.w.toFixed(2)} рад/с`);
      lines.push(`маневровые ${Math.hypot(p.rcsAx, p.rcsAy).toFixed(1)}/${(e.maneuver / Math.max(p.mass, 1e-6)).toFixed(1)} кл/с²`);
      lines.push(`гравитация ${Math.hypot(gr.ax, gr.ay).toFixed(2)} кл/с²`);
    } else {
      lines.push('корабль уничтожен — «Сброс сцены»');
    }
    this.stats.textContent = lines.join('\n');
  }
}
