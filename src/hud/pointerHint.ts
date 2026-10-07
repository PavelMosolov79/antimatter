/**
 * What a click would do, said next to the pointer ("Цель орудий", "Добывать", "Осмотреть"), and the menu a long
 * press opens on a phone (the same choices, picked with a tap). Both float over the battle in the game's colours.
 */

const CSS = `
#ph-hint { position: fixed; z-index: 5; pointer-events: none; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--c, #59e6ff); color: var(--c, #59e6ff); background: rgba(8, 12, 22, .9); font: 700 11px/1.2 'JetBrains Mono', ui-monospace, Menlo, monospace; letter-spacing: .04em; white-space: nowrap; transform: translate(14px, 14px); }
#ph-hint small { display: block; font-weight: 400; color: #7f95bf; margin-top: 2px; }
#ph-menu { position: fixed; z-index: 6; min-width: 170px; padding: 6px; border-radius: 12px; border: 1px solid #2c3d63; background: rgba(8, 12, 22, .96); box-shadow: 0 12px 30px rgba(0, 0, 0, .6); display: flex; flex-direction: column; gap: 4px; font: 400 13px/1.3 'JetBrains Mono', ui-monospace, Menlo, monospace; color: #cfe0ff; }
#ph-menu h5 { margin: 2px 6px 4px; font: 700 10.5px/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: .16em; color: #7f95bf; text-transform: uppercase; }
#ph-menu button { text-align: left; padding: 11px 12px; border-radius: 8px; border: 1px solid #1c2742; background: #0d1424; color: var(--c, #cfe0ff); font: 700 13px/1 'JetBrains Mono', ui-monospace, monospace; cursor: pointer; }
#ph-menu button.cancel { color: #7f95bf; font-weight: 400; }
#ph-menu button:active { background: #16213a; }
#ph-hint[hidden], #ph-menu[hidden] { display: none; }
`;

export interface MenuItem {
  label: string;
  color?: string;
  run: () => void;
}

export class PointerHint {
  private hint = document.createElement('div');
  private menuEl = document.createElement('div');
  private shownText = '';

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.hint.id = 'ph-hint';
    this.hint.hidden = true;
    this.menuEl.id = 'ph-menu';
    this.menuEl.hidden = true;
    this.menuEl.setAttribute('role', 'menu');
    parent.append(this.hint, this.menuEl);
    // a tap anywhere else closes the menu
    window.addEventListener('pointerdown', (e) => {
      if (!this.menuEl.hidden && !this.menuEl.contains(e.target as Node)) this.closeMenu();
    }, true);
  }

  get menuOpen(): boolean {
    return !this.menuEl.hidden;
  }

  show(text: string, sub: string, color: string, x: number, y: number): void {
    const key = text + '|' + sub + '|' + color;
    if (key !== this.shownText) {
      this.shownText = key;
      this.hint.textContent = text;
      if (sub) {
        const s = document.createElement('small');
        s.textContent = sub;
        this.hint.appendChild(s);
      }
      this.hint.style.setProperty('--c', color);
    }
    // keep it on the screen near the right and bottom edges
    const w = this.hint.offsetWidth || 160;
    const h = this.hint.offsetHeight || 24;
    this.hint.style.left = Math.min(x, window.innerWidth - w - 20) + 'px';
    this.hint.style.top = Math.min(y, window.innerHeight - h - 20) + 'px';
    this.hint.hidden = false;
  }

  hide(): void {
    this.hint.hidden = true;
  }

  menu(x: number, y: number, title: string, items: MenuItem[]): void {
    this.hide();
    this.menuEl.replaceChildren();
    const h = document.createElement('h5');
    h.textContent = title;
    this.menuEl.appendChild(h);
    const all: MenuItem[] = [...items, { label: 'Отмена', run: () => undefined }];
    all.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      b.setAttribute('role', 'menuitem');
      if (i === all.length - 1) b.className = 'cancel';
      if (it.color) b.style.setProperty('--c', it.color);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeMenu();
        it.run();
      });
      this.menuEl.appendChild(b);
    });
    this.menuEl.hidden = false;
    const w = this.menuEl.offsetWidth;
    const hh = this.menuEl.offsetHeight;
    this.menuEl.style.left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8)) + 'px';
    this.menuEl.style.top = Math.max(8, Math.min(y - hh - 16, window.innerHeight - hh - 8)) + 'px';
  }

  closeMenu(): void {
    this.menuEl.hidden = true;
  }
}
