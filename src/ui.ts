import { Game, SCENARIOS, type Tool } from './game';
import { OUTER_VIEW } from './render/shipView';
import { SHIPS } from './sim/ships';
import { moduleEfficiency } from './sim/grid';
import { WEAPONS } from './sim/weapons';

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
#left { position: absolute; left: 12px; top: 12px; display: flex; flex-direction: column; gap: 8px; width: 300px; pointer-events: none; }
#left .panel { position: static; }
#stats { white-space: pre; }
#controls { right: 12px; top: 12px; width: 300px; max-height: calc(100vh - 62px); overflow-y: auto; }
.bar { position: relative; height: 14px; background: #101a2c; border: 1px solid #24304a; border-radius: 4px; margin-bottom: 5px; overflow: hidden; }
.bar > i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; }
.bar > span { position: absolute; left: 6px; right: 6px; top: -1px; line-height: 14px; font-size: 11px; display: flex; justify-content: space-between; text-shadow: 0 0 3px #000; }
.bar.hull > i { background: #3fae5a; }
.bar.shield > i { background: #3f8fe0; }
.bar.energy > i { background: #d9a52b; }
.wrow { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.wrow .wname { width: 62px; text-align: left; }
.wrow .wname.sel { border-color: #ffb347; color: #ffb347; background: #3a2a10; }
.wrow .wstate { flex: 1; color: #8fa4cc; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wrow .wstate.off { color: #6a4a4a; }
.wrow .wtoggle { width: 44px; }
.wrow .wtoggle.on { border-color: #63e07a; color: #63e07a; background: #12301e; }
.tinfo { color: #ffb0a0; font-size: 11px; min-height: 16px; white-space: pre; }
#overlay { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; pointer-events: none; }
#overlay .box { pointer-events: auto; text-align: center; background: rgba(8,12,22,.9); border: 1px solid #2c3d63; border-radius: 12px; padding: 22px 34px; }
#overlay h2 { margin: 0 0 12px; font-size: 26px; letter-spacing: .12em; }
#overlay h2.won { color: #63e07a; }
#overlay h2.lost { color: #ff5a4a; }
#overlay button { margin: 0 4px; padding: 6px 14px; font-size: 13px; }
#hint { left: 12px; bottom: 12px; color: #8fa4cc; max-width: 460px; }
#hint { pointer-events: none; }
#panelToggle { position: fixed; right: 12px; bottom: 12px; pointer-events: auto; background: rgba(10,14,24,.8); color: #cfe0ff; border: 1px solid #2a3a5c; border-radius: 6px; padding: 4px 12px; font: inherit; cursor: pointer; z-index: 5; }
.collapsed #left, .collapsed #controls, .collapsed #hint { display: none; }
`;

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

export class Hud {
  private game: Game;
  private stats: HTMLDivElement;
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private layerBtns: HTMLButtonElement[] = [];
  private shipBtns = new Map<string, HTMLButtonElement>();
  private scenarioBtns = new Map<string, HTMLButtonElement>();
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
  private last = 0;

  constructor(game: Game, root: HTMLElement) {
    this.game = game;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const left = document.createElement('div');
    left.id = 'left';
    root.appendChild(left);

    this.stats = document.createElement('div');
    this.stats.id = 'stats';
    this.stats.className = 'panel';
    left.appendChild(this.stats);

    const combat = document.createElement('div');
    combat.id = 'combat';
    combat.className = 'panel';
    const ch = document.createElement('h4');
    ch.textContent = 'Бой';
    this.targetInfo.className = 'tinfo';
    const wh = document.createElement('h4');
    wh.textContent = 'Орудия (выберите и кликните врага)';
    wh.style.marginTop = '8px';
    combat.append(ch, this.hull.root, this.shield.root, this.energy.root, this.targetInfo, wh, this.weaponBox);
    left.appendChild(combat);

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

    const scen = section('Сценарий');
    for (const sc of SCENARIOS) this.scenarioBtns.set(sc.id, button(scen, sc.label, () => this.game.reset(undefined, sc.id)));

    const ships = section('Корабль игрока');
    for (const s of SHIPS) this.shipBtns.set(s.id, button(ships, s.label, () => this.game.reset(s.id)));
    button(ships, 'Заново', () => this.game.reset());

    const power = section('Энергия и цели');
    this.priorityBtns.set('shield', button(power, 'Приоритет: щит', () => this.game.setPriority('shield')));
    this.priorityBtns.set('weapons', button(power, 'Приоритет: оружие', () => this.game.setPriority('weapons')));
    button(power, 'Все орудия: авто', () => this.game.clearTargets());

    const tools = section('Инструмент (ЛКМ)');
    this.toolBtns.set('fly', button(tools, 'Полёт / цель', () => this.setTool('fly')));
    this.toolBtns.set('crater', button(tools, 'Удар: кратер', () => this.setTool('crater')));
    slider(tools, 'Радиус', 1, 14, 0.5, game.crater.radius, (v) => (game.crater.radius = v));
    slider(tools, 'Урон', 5, 300, 5, game.crater.damage, (v) => (game.crater.damage = v));
    slider(tools, 'Пробитие', 0, 1, 0.05, game.crater.pen, (v) => (game.crater.pen = v));

    const sandbox = section('Песочница');
    button(sandbox, '+ Мишень', () => this.game.spawnTarget());
    button(sandbox, 'Сломать двигатель', () => this.game.breakEngine());

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
    hint.textContent = 'ЛКМ по врагу — цель орудий (клик по конкретной клетке наводит на неё, например на реактор), по пустому месту — лететь. Выберите орудие в списке и кликните врага — цель только для него. ПКМ + перетаскивание — камера. Колесо — масштаб. Пауза не мешает отдавать приказы.';
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
    box.append(this.overlayTitle, again, sandboxBtn);
    this.overlay.appendChild(box);
    root.appendChild(this.overlay);

    const toggle = document.createElement('button');
    toggle.id = 'panelToggle';
    toggle.textContent = 'Панели';
    toggle.addEventListener('click', () => root.classList.toggle('collapsed'));
    root.appendChild(toggle);

    this.setTool('fly');
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
  }

  update(now: number): void {
    const g = this.game;
    g.scene.craterPreview = g.tool === 'crater' ? g.crater.radius : 0;
    for (const [t, b] of this.toolBtns) b.classList.toggle('on', g.tool === t);
    for (const [id, b] of this.shipBtns) b.classList.toggle('on', g.shipId === id);
    for (const [id, b] of this.scenarioBtns) b.classList.toggle('on', g.scenarioId === id);
    const pri = g.world.player?.sys?.priority;
    for (const [id, b] of this.priorityBtns) b.classList.toggle('on', pri === id);
    this.layerBtns.forEach((b, i) => b.classList.toggle('on', (i === 0 ? OUTER_VIEW : i - 1) === g.scene.layerView));
    for (const t of this.toggles) t.el.classList.toggle('on', t.get());
    for (const w of this.weaponEls) w.name.classList.toggle('sel', g.selectedWeapon === w.id);

    const over = g.state !== 'playing';
    this.overlay.style.display = over ? 'flex' : 'none';
    if (over) {
      this.overlayTitle.textContent = g.state === 'won' ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
      this.overlayTitle.className = g.state;
    }

    if (now - this.last < 150) return;
    this.last = now;
    this.updateCombat();
    this.updateStats();
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
      const warn = t.sys.countdown >= 0 ? `\nРЕАКТОР НЕСТАБИЛЕН: ${Math.max(0, t.sys.countdown).toFixed(1)} с` : '';
      this.targetInfo.textContent = `Цель: ${t.sys.name} · корпус ${(th * 100).toFixed(0)}%${shield}${warn}`;
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
        const mode = w.target ? 'ручная цель' : sys.focus ? 'фокус' : 'авто';
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
    lines.push(`FPS ${g.scene.app.ticker.FPS.toFixed(0)}   физика ${g.stepMs.toFixed(2)} мс`);
    lines.push(`тел ${tot.bodies} (обломков ${tot.debris})   клеток ${tot.cells}`);
    if (p) {
      const e = p.engineSummary();
      const a = e.thrust / Math.max(p.mass, 1e-6);
      const gr = g.world.gravityAt(p.x, p.y);
      const deg = ((((p.angle * 180) / Math.PI) % 360) + 360) % 360;
      lines.push(`позиция ${p.x.toFixed(0)}, ${p.y.toFixed(0)}`);
      const tg = g.world.target;
      if (tg) lines.push(`цель ${tg.x.toFixed(0)}, ${tg.y.toFixed(0)}   дистанция ${Math.hypot(tg.x - p.x, tg.y - p.y).toFixed(0)}`);
      lines.push(`масса ${p.mass.toFixed(0)}   палуб ${p.grid.depth}`);
      lines.push(`двигатели ${e.alive}/${e.total}   тяга ${a.toFixed(1)} кл/с²`);
      lines.push(`скорость ${Math.hypot(p.vx, p.vy).toFixed(1)} кл/с   курс ${deg.toFixed(0)}°`);
      lines.push(`газ ${(p.throttle * 100).toFixed(0)}%   вращ ${p.w.toFixed(2)} рад/с`);
      lines.push(`маневровые: тормоз ${(e.capBack / Math.max(p.mass, 1e-6)).toFixed(1)}  бок ${(e.capLeft / Math.max(p.mass, 1e-6)).toFixed(1)}/${(e.capRight / Math.max(p.mass, 1e-6)).toFixed(1)}`);
      lines.push(`гравитация ${Math.hypot(gr.ax, gr.ay).toFixed(2)} кл/с²`);
    } else {
      lines.push('корабль уничтожен');
    }
    const cur = g.scene.cursor;
    if (cur) lines.push(`курсор ${cur.x.toFixed(0)}, ${cur.y.toFixed(0)}`);
    this.stats.textContent = lines.join('\n');
  }
}
