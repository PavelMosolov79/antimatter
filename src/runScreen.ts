import type { Game } from './game';
import type { NodeKind } from './sim/run';
import { SHIPS } from './sim/ships';

const CSS = `
#runscreen { position: fixed; inset: 0; display: none; pointer-events: none; z-index: 4; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; color: #cfe0ff; }
#runscreen.dim { background: rgba(3,6,12,.74); }
#runscreen .rs-box { pointer-events: auto; position: absolute; left: 50%; transform: translateX(-50%); background: rgba(8,12,22,.94); border: 1px solid #2c3d63; border-radius: 12px; padding: 18px 22px; box-sizing: border-box; width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; }
#runscreen.dim .rs-box { top: 50%; transform: translate(-50%, -50%); }
#runscreen.dock .rs-box { bottom: 16px; }
#runscreen h2 { margin: 0 0 4px; font-size: 20px; letter-spacing: .14em; }
#runscreen h2.victory { color: #63e07a; }
#runscreen h2.defeat { color: #ff5a4a; }
#runscreen h2.retreat { color: #ffb347; }
#runscreen .rs-sub { color: #8fa4cc; margin-bottom: 12px; }
#runscreen .rs-note { color: #ffe9a8; min-height: 18px; margin: 6px 0 8px; }
#runscreen .rs-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
#runscreen button { background: #182238; color: #cfe0ff; border: 1px solid #2a3a5c; border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; }
#runscreen button:hover { background: #22304f; }
#runscreen button.primary { border-color: #59e6ff; color: #59e6ff; background: #14304a; font-weight: 600; }
#runscreen .ship { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 190px; text-align: left; }
#runscreen .ship.on { border-color: #59e6ff; background: #14304a; }
#runscreen .ship b { font-size: 13px; }
#runscreen .ship span { color: #8fa4cc; font-size: 10.5px; }
#runscreen .stats { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 4px 0 10px; color: #8fa4cc; }
#runscreen .stats span { white-space: nowrap; }
#runscreen .stats b { color: #cfe0ff; }
#runscreen svg { display: block; width: 100%; height: auto; margin: 4px 0 8px; }
#runscreen svg .node { cursor: default; }
#runscreen svg .node.reach { cursor: pointer; }
#runscreen svg .node.reach circle { stroke: #59e6ff; stroke-width: 2.5; }
#runscreen svg .node.reach:hover circle { stroke: #ffffff; }
#runscreen svg .node.here circle { stroke: #ffffff; stroke-width: 3; }
#runscreen svg text { font: 11px ui-monospace, Menlo, Consolas, monospace; fill: #0a0e18; font-weight: 700; pointer-events: none; }
#runscreen .legend { display: flex; flex-wrap: wrap; gap: 12px; color: #8fa4cc; font-size: 10.5px; margin-bottom: 10px; }
#runscreen .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
`;

const KIND: Record<NodeKind, { color: string; letter: string; label: string }> = {
  start: { color: '#8fa4cc', letter: 'С', label: 'Старт' },
  combat: { color: '#ff7a5a', letter: 'Б', label: 'Бой' },
  elite: { color: '#ffb347', letter: 'Э', label: 'Элитный бой' },
  repair: { color: '#63e07a', letter: 'Р', label: 'Ремонт' },
  boss: { color: '#c77dff', letter: '★', label: 'Босс' },
};

interface ShipCard {
  id: string;
  label: string;
  cells: number;
  guns: number;
  shield: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Dock, sector map and run result — the screens between battles. */
export class RunScreen {
  private readonly game: Game;
  private readonly root = document.createElement('div');
  private key = '';
  private cards: ShipCard[] | null = null;

  constructor(game: Game, parent: HTMLElement) {
    this.game = game;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.id = 'runscreen';
    parent.appendChild(this.root);
  }

  update(): void {
    const g = this.game;
    const phase = g.mode === 'run' ? g.runPhase : null;
    const visible = phase === 'dock' || phase === 'map' || phase === 'over';
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this.key = '';
      return;
    }
    const run = g.run;
    const key = [phase, g.shipId, run?.current, run?.visited.length, run?.note, run?.outcome].join('|');
    if (key === this.key) return;
    this.key = key;
    this.root.className = phase === 'dock' ? 'dock' : 'dim';
    this.root.replaceChildren();
    const box = el('div', 'rs-box');
    this.root.appendChild(box);
    if (phase === 'dock') this.renderDock(box);
    else if (phase === 'map') this.renderMap(box);
    else this.renderOver(box);
  }

  private shipCards(): ShipCard[] {
    if (!this.cards) {
      this.cards = SHIPS.map((s) => {
        const grid = s.build();
        let shield = 0;
        let guns = 0;
        for (const m of grid.modules) {
          if (m.weapon) guns++;
          shield += m.shieldMax;
        }
        return { id: s.id, label: s.label, cells: grid.cells, guns, shield };
      });
    }
    return this.cards;
  }

  private renderDock(box: HTMLElement): void {
    box.append(title('ДОК'), text('rs-sub', 'Выберите корабль для вылета. Повреждения будут переноситься между узлами забега.'));
    const row = el('div', 'rs-row');
    for (const c of this.shipCards()) {
      const b = document.createElement('button');
      b.className = 'ship' + (c.id === this.game.shipId ? ' on' : '');
      const name = document.createElement('b');
      name.textContent = c.label;
      const info = document.createElement('span');
      info.textContent = `клеток ${c.cells} · орудий ${c.guns} · щит ${c.shield}`;
      b.append(name, info);
      b.addEventListener('click', () => this.game.openDock(c.id));
      row.appendChild(b);
    }
    box.appendChild(row);
    const go = el('div', 'rs-row');
    go.style.marginTop = '12px';
    go.appendChild(btn('В поход ▸', () => this.game.startRun(), true));
    box.appendChild(go);
  }

  private renderMap(box: HTMLElement): void {
    const g = this.game;
    const run = g.run!;
    box.append(title('СЕКТОР'), text('rs-sub', `Выберите следующий узел — подсвечены доступные. Сектор #${run.map.seed.toString(16)}.`));
    box.appendChild(this.statsRow());
    box.appendChild(text('rs-note', run.note));

    const W = 700;
    const H = 300;
    const pad = 34;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const pos = (id: number) => {
      const n = run.map.nodes[id];
      return { x: pad + (n.col * (W - pad * 2)) / (run.map.cols - 1), y: pad + n.row * (H - pad * 2) };
    };
    const visited = new Set(run.visited);
    for (const n of run.map.nodes) {
      for (const t of n.next) {
        const a = pos(n.id);
        const b = pos(t);
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(a.x));
        line.setAttribute('y1', String(a.y));
        line.setAttribute('x2', String(b.x));
        line.setAttribute('y2', String(b.y));
        const walked = visited.has(n.id) && visited.has(t);
        line.setAttribute('stroke', walked ? '#59e6ff' : '#2a3a5c');
        line.setAttribute('stroke-width', walked ? '3' : '1.5');
        svg.appendChild(line);
      }
    }
    for (const n of run.map.nodes) {
      const p = pos(n.id);
      const reach = g.canTravel(n.id);
      const grp = document.createElementNS(SVG_NS, 'g');
      grp.setAttribute('class', 'node' + (reach ? ' reach' : '') + (n.id === run.current ? ' here' : ''));
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', String(p.x));
      c.setAttribute('cy', String(p.y));
      c.setAttribute('r', n.kind === 'boss' ? '17' : '13');
      c.setAttribute('fill', KIND[n.kind].color);
      c.setAttribute('fill-opacity', visited.has(n.id) && n.id !== run.current ? '0.35' : '1');
      c.setAttribute('stroke', '#0a0e18');
      c.setAttribute('stroke-width', '2');
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(p.x));
      t.setAttribute('y', String(p.y + 4));
      t.setAttribute('text-anchor', 'middle');
      t.textContent = KIND[n.kind].letter;
      const tip = document.createElementNS(SVG_NS, 'title');
      tip.textContent = KIND[n.kind].label;
      grp.append(c, t, tip);
      if (reach) grp.addEventListener('click', () => this.game.travel(n.id));
      svg.appendChild(grp);
    }
    box.appendChild(svg);

    const legend = el('div', 'legend');
    for (const k of ['combat', 'elite', 'repair', 'boss'] as NodeKind[]) {
      const item = document.createElement('span');
      const dot = document.createElement('i');
      dot.style.background = KIND[k].color;
      item.append(dot, document.createTextNode(KIND[k].label));
      legend.appendChild(item);
    }
    box.appendChild(legend);
    const row = el('div', 'rs-row');
    row.appendChild(btn('Отступить в док', () => this.game.retreat()));
    box.appendChild(row);
  }

  private renderOver(box: HTMLElement): void {
    const run = this.game.run!;
    const outcome = run.outcome ?? 'defeat';
    const heading = outcome === 'victory' ? 'ЗАБЕГ ПРОЙДЕН' : outcome === 'retreat' ? 'ОТСТУПЛЕНИЕ' : 'КОРАБЛЬ ПОТЕРЯН';
    const sub =
      outcome === 'victory'
        ? 'Линкор уничтожен, сектор пройден. Корабль возвращается в док со всеми повреждениями.'
        : outcome === 'retreat'
          ? 'Корабль вернулся в док раньше времени — с тем, что осталось.'
          : 'Корабль уничтожен. В MVP-4 он вернётся в док с максимальным ремонтом.';
    const h = title(heading);
    h.className = outcome;
    box.append(h, text('rs-sub', sub), this.statsRow());
    const row = el('div', 'rs-row');
    row.appendChild(btn('В док', () => this.game.openDock(), true));
    box.appendChild(row);
  }

  private statsRow(): HTMLElement {
    const g = this.game;
    const run = g.run!;
    const row = el('div', 'stats');
    const stat = (label: string, value: string) => {
      const s = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = value;
      s.append(document.createTextNode(label + ' '), b);
      row.appendChild(s);
    };
    stat('Корабль', SHIPS.find((s) => s.id === run.shipId)?.label ?? run.shipId);
    stat('Корпус', run.outcome === 'defeat' ? '0%' : `${Math.round(g.runHull() * 100)}%`);
    stat('Экипаж', run.ship ? String(g.runCrewAlive()) : run.outcome === 'defeat' ? '0' : '—');
    stat('Пройдено узлов', String(run.visited.length - 1));
    stat('Боёв выиграно', String(run.battlesWon));
    return row;
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function title(s: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = s;
  return h;
}

function text(cls: string, s: string): HTMLElement {
  const d = el('div', cls);
  d.textContent = s;
  return d;
}

function btn(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (primary) b.className = 'primary';
  b.addEventListener('click', onClick);
  return b;
}
