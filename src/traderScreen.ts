import type { Game } from './game';
import { RARITY } from './sim/crewConfig';
import { effectText } from './sim/levels';
import { MODULE_INFO } from './sim/layout';
import { ROLE_NAMES, traitOf } from './sim/roster';
import { shipHoldCap } from './sim/ships';
import { holdUsed } from './sim/cargo';
import type { Offer } from './sim/trader';

const CSS = `
#trader { position: fixed; inset: 0; display: none; z-index: 4; background: rgba(3,6,12,.82); font: 12px/1.45 'JetBrains Mono', ui-monospace, Menlo, monospace; color: #cfe0ff; overflow-y: auto; }
#trader .tr-box { margin: 5vh auto; width: min(760px, calc(100vw - 24px)); background: rgba(8,12,22,.96); border: 1px solid #2c3d63; border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
#trader h2 { margin: 0; font: 800 18px/1.2 'Unbounded', 'Arial Black', sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #ffd24a; }
#trader .tr-sub { color: #8fa4cc; }
#trader .tr-hold { display: flex; flex-wrap: wrap; gap: 6px; }
#trader .tr-hold span { border: 1px solid #ffd24a; color: #ffd24a; border-radius: 6px; padding: 5px 9px; font-weight: 700; }
#trader h3 { margin: 6px 0 0; font: 700 11px/1 'JetBrains Mono', monospace; letter-spacing: .2em; text-transform: uppercase; color: #59e6ff; }
#trader .tr-offer { display: grid; grid-template-columns: 1fr auto; gap: 4px 14px; align-items: center; border: 1px solid #1c2742; border-radius: 10px; padding: 10px 12px; background: rgba(10,15,28,.7); }
#trader .tr-offer.sold { opacity: .45; }
#trader .tr-offer b { color: #eef5ff; font-size: 13px; }
#trader .tr-tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 6px; border: 1px solid #b06bff; color: #b06bff; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
#trader .tr-desc { color: #8fa4cc; grid-column: 1; }
#trader .tr-buy { grid-column: 2; grid-row: 1 / span 2; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
#trader .tr-price { color: #ffd24a; font-weight: 700; }
#trader button { background: #182238; color: #cfe0ff; border: 1px solid #2a3a5c; border-radius: 6px; padding: 8px 14px; font: inherit; font-weight: 700; cursor: pointer; }
#trader button:hover { background: #22304f; }
#trader button:disabled { opacity: .4; cursor: default; }
#trader button.primary { border-color: #ffd24a; color: #ffd24a; background: #2a2210; }
#trader .tr-msg { min-height: 16px; color: #ffe9a8; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const priceText = (p: { credits: number; metal: number }): string => [p.credits ? `${p.credits} кр.` : '', p.metal ? `${p.metal} мет.` : ''].filter(Boolean).join(' · ') || 'даром';

/** The trader's window (the point «Торговец» of the road): the offers, bought out of the hold. */
export class TraderScreen {
  private readonly game: Game;
  private readonly root = document.createElement('div');
  private key = '';
  private message = '';

  constructor(game: Game, parent: HTMLElement) {
    this.game = game;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.id = 'trader';
    parent.appendChild(this.root);
  }

  update(): void {
    const g = this.game;
    const visible = g.screen === 'game' && g.mode === 'run' && g.runPhase === 'trade' && !!g.trade && !!g.run;
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this.key = '';
      return;
    }
    const run = g.run!;
    const key = [g.trade!.point.index, [...g.trade!.sold].join(','), run.cargo.credits, run.cargo.metal, this.message].join('|');
    if (key === this.key) return;
    this.key = key;
    this.render();
  }

  private render(): void {
    const g = this.game;
    const run = g.run!;
    const t = g.trade!;
    this.root.replaceChildren();
    const box = el('div', 'tr-box');
    this.root.appendChild(box);
    box.append(el('h2', '', 'Торговец'), el('div', 'tr-sub', 'Торговый корабль: уникальные модули и космонавты. Платить можно только тем, что лежит в трюме.'));
    const hold = el('div', 'tr-hold');
    hold.append(el('span', '', `Трюм: ${run.cargo.credits} кр. · ${run.cargo.metal} мет.`), el('span', '', `Места: ${holdUsed(run.cargo)}/${shipHoldCap(run.shipId)}`));
    box.appendChild(hold);
    box.append(el('h3', '', 'Модули'));
    for (const o of t.modules) box.appendChild(this.offerRow(o));
    box.append(el('h3', '', 'Космонавты'));
    for (const o of t.crew) box.appendChild(this.offerRow(o));
    const msg = el('div', 'tr-msg', this.message);
    const leave = el('button', 'primary', 'Улететь ▸');
    leave.addEventListener('click', () => {
      this.message = '';
      g.leaveTrade();
    });
    box.append(msg, leave);
  }

  private offerRow(o: Offer): HTMLElement {
    const g = this.game;
    const run = g.run!;
    const sold = g.trade!.sold.has(o.id);
    const row = el('div', 'tr-offer' + (sold ? ' sold' : ''));
    const head = el('div');
    const desc = el('div', 'tr-desc');
    if (o.kind === 'module') {
      head.append(el('b', '', `${MODULE_INFO[o.type].name}, уровень ${o.lv}`), el('span', 'tr-tag', 'уникальный'));
      desc.textContent = effectText(o.type, o.lv, run.shipId);
    } else {
      const m = o.member;
      head.append(el('b', '', `${m.name}, ${ROLE_NAMES[m.role].toLowerCase()} ур. ${m.lv}`), el('span', 'tr-tag', RARITY[m.rar - 1].name));
      desc.textContent = m.traits.length ? `Особенности: ${m.traits.map((id) => traitOf(id)?.title ?? id).join(', ')}` : 'Без особенностей';
    }
    const buy = el('div', 'tr-buy');
    buy.append(el('span', 'tr-price', priceText(o.price)));
    const b = el('button', '', sold ? 'Куплено' : 'Купить');
    b.disabled = sold || run.cargo.credits < o.price.credits || run.cargo.metal < o.price.metal;
    b.addEventListener('click', () => {
      const r = g.buyOffer(o.id);
      this.message = r === 'ok' ? '' : r === 'credits' ? 'Не хватает кредитов в трюме.' : r === 'metal' ? 'Не хватает металла в трюме.' : r === 'barracks' ? 'В казарме нет места.' : '';
      this.key = '';
    });
    buy.appendChild(b);
    row.append(head, buy, desc);
    return row;
  }
}
