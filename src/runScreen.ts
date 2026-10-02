import type { Game } from './game';
import { SHIPS } from './sim/ships';

const CSS = `
#runscreen { position: fixed; inset: 0; display: none; pointer-events: none; z-index: 4; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; color: #cfe0ff; }
#runscreen.dim { background: rgba(3,6,12,.74); }
#runscreen .rs-box { pointer-events: auto; position: absolute; left: 50%; transform: translateX(-50%); background: rgba(8,12,22,.94); border: 1px solid #2c3d63; border-radius: 12px; padding: 18px 22px; box-sizing: border-box; width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; }
#runscreen.dim .rs-box { top: 50%; transform: translate(-50%, -50%); }
#runscreen h2 { margin: 0 0 4px; font-size: 20px; letter-spacing: .14em; }
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
`;

/** The result of a run — the screen after it ends (the dock and the road have screens of their own: dock/dockScreen.ts, roadScreen.ts). */
export class RunScreen {
  private readonly game: Game;
  private readonly root = document.createElement('div');
  private key = '';

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
    const visible = phase === 'over';
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this.key = '';
      return;
    }
    const run = g.run;
    const key = [phase, g.shipId, run?.cleared, run?.outcome, window.innerWidth > window.innerHeight].join('|');
    if (key === this.key) return;
    this.key = key;
    this.root.className = 'dim';
    this.root.replaceChildren();
    const box = el('div', 'rs-box');
    this.root.appendChild(box);
    this.renderOver(box);
  }

  private renderOver(box: HTMLElement): void {
    const run = this.game.run!;
    const outcome = run.outcome ?? 'defeat';
    const heading = outcome === 'retreat' ? 'ОТСТУПЛЕНИЕ' : 'КОРАБЛЬ ПОТЕРЯН';
    const sub =
      outcome === 'retreat'
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
    stat('Пройдено миссий', String(run.road.missionsDone(run.cleared)));
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
