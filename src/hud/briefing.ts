import type { Game } from '../game';
import { GENERAL_SIZE, generalPixels } from '../render/general';

/**
 * The start of a mission (design: artifact «Путь миссии»): the screen goes dark, the mission's number and type
 * come up out of a blur, then General Stone's plate rises with the words typed out while the portrait blinks and
 * talks. «Принято» (or a tap on the screen when the text is out) starts the world. The button «Цель» of the battle
 * screen opens the plate again, without the dark and without stopping the world.
 */

const CSS = `
#brief { position: fixed; inset: 0; z-index: 7; pointer-events: none; font: 400 14px/1.55 'JetBrains Mono', ui-monospace, Menlo, monospace; color: #cfe0ff; }
#brief[hidden] { display: none; }
#brief .ov { position: absolute; inset: 0; background: rgba(2, 4, 9, .9); opacity: 0; transition: opacity .5s; pointer-events: auto; }
#brief.again .ov { background: rgba(2, 4, 9, .35); }
#brief .ov.on { opacity: 1; }
#brief .mt { position: absolute; left: 0; right: 0; top: 30%; text-align: center; }
#brief .mt .n { font: 900 clamp(30px, 7vw, 72px)/1 'Unbounded', 'Arial Black', system-ui, sans-serif; letter-spacing: .18em; color: #fff; opacity: 0; transform: scale(1.25); filter: blur(8px); transition: opacity .7s cubic-bezier(.2, .8, .2, 1), transform .7s cubic-bezier(.2, .8, .2, 1), filter .7s; }
#brief .mt .ln { height: 2px; width: 0; margin: 16px auto; background: linear-gradient(90deg, transparent, #59e6ff, transparent); transition: width .7s .3s; }
#brief .mt .ty { font: 700 clamp(13px, 2.4vw, 20px)/1 'JetBrains Mono', monospace; letter-spacing: .4em; color: #59e6ff; opacity: 0; transform: translateY(8px); transition: opacity .5s .55s, transform .5s .55s; }
#brief .mt .sub { margin-top: 12px; font-size: clamp(10px, 1.5vw, 13px); letter-spacing: .14em; color: #7f95bf; opacity: 0; transition: opacity .5s .8s; text-transform: uppercase; }
#brief .mt.on .n { opacity: 1; transform: none; filter: none; }
#brief .mt.on .ln { width: min(60%, 460px); }
#brief .mt.on .ty, #brief .mt.on .sub { opacity: 1; transform: none; }
#brief .mt.up { transition: transform .6s, opacity .6s; transform: translateY(-40%); opacity: 0; }
#brief .gen { position: absolute; left: 50%; bottom: max(150px, 18vh); width: min(680px, calc(100% - 32px)); transform: translate(-50%, 30px); display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; align-items: start; padding: 16px; border: 1px solid #2c3d63; border-radius: 14px; background: linear-gradient(180deg, rgba(13, 22, 42, .97), rgba(7, 11, 22, .97)); box-shadow: 0 0 0 1px rgba(89, 230, 255, .08), 0 20px 50px rgba(0, 0, 0, .6); opacity: 0; transition: opacity .45s, transform .45s cubic-bezier(.2, .8, .2, 1); pointer-events: auto; }
#brief .gen.on { opacity: 1; transform: translate(-50%, 0); }
#brief .pf { width: 104px; height: 104px; border-radius: 10px; border: 1px solid #2c3d63; overflow: hidden; position: relative; background: #0b1428; }
#brief .pf canvas { width: 100%; height: 100%; image-rendering: pixelated; display: block; }
#brief .pf::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(255, 255, 255, .04) 0 1px, transparent 1px 3px); }
#brief .who { font: 700 11px/1 'JetBrains Mono', monospace; letter-spacing: .16em; color: #ffd24a; text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
#brief .who i { width: 7px; height: 7px; border-radius: 50%; background: #ff6a5a; animation: brec 1s infinite alternate; }
@keyframes brec { to { opacity: .2; } }
#brief .tx { margin-top: 8px; font-size: 14px; color: #e6efff; min-height: 4.7em; }
#brief .tx::after { content: '▍'; color: #59e6ff; animation: brec .5s infinite alternate; }
#brief .gen.done .tx::after { content: ''; }
#brief .go { margin-top: 10px; display: flex; justify-content: flex-end; }
#brief .go button { background: #59e6ff; color: #04202a; border: 0; border-radius: 8px; padding: 10px 16px; font: 700 12.5px/1 'JetBrains Mono', monospace; cursor: pointer; opacity: 0; pointer-events: none; transition: opacity .3s; }
#brief .gen.done .go button { opacity: 1; pointer-events: auto; }
#brief .skip { position: absolute; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); background: none; border: 0; color: #7f95bf; font: 700 11px/1 'JetBrains Mono', monospace; letter-spacing: .1em; padding: 8px; cursor: pointer; pointer-events: auto; }
#brief.again .skip, #brief.again .mt { display: none; }
#brief button:focus-visible { outline: 2px solid #b06bff; outline-offset: 2px; }
@media (max-width: 720px) {
  #brief .gen { grid-template-columns: minmax(0, 1fr); bottom: max(120px, 16vh); }
  #brief .pf { width: 72px; height: 72px; }
  #brief .tx { font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) { #brief * { transition-duration: .01s !important; animation: none !important; } }
`;

const CHARS_PER_SEC = 44;

export class Briefing {
  private readonly game: Game;
  private root = document.createElement('div');
  private ov!: HTMLElement;
  private mt!: HTMLElement;
  private gen!: HTMLElement;
  private tx!: HTMLElement;
  private ctx!: CanvasRenderingContext2D;
  private frames = new Map<string, ImageData>();
  private shown: 'intro' | 'again' | null = null;
  private timers: number[] = [];
  private text = '';
  private typed = 0;
  private typing = false;
  private reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private last = 0;

  constructor(game: Game, parent: HTMLElement) {
    this.game = game;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.id = 'brief';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="ov"></div>
      <div class="mt"><div class="n"></div><div class="ln"></div><div class="ty"></div><div class="sub"></div></div>
      <div class="gen" role="dialog" aria-label="Брифинг">
        <div class="pf"><canvas width="${GENERAL_SIZE}" height="${GENERAL_SIZE}"></canvas></div>
        <div><div class="who"><i></i>Генерал Стоун · штаб флота</div><div class="tx" aria-live="polite"></div><div class="go"><button type="button">Принято ▸</button></div></div>
      </div>
      <button type="button" class="skip">пропустить ▸▸</button>`;
    parent.appendChild(this.root);
    this.ov = this.root.querySelector('.ov')!;
    this.mt = this.root.querySelector('.mt')!;
    this.gen = this.root.querySelector('.gen')!;
    this.tx = this.root.querySelector('.tx')!;
    this.ctx = this.root.querySelector('canvas')!.getContext('2d')!;
    this.root.querySelector('.go button')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.root.querySelector('.skip')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    // a tap: the words all at once, then (a second tap, or a tap on the dark) away
    const tap = (e: Event) => {
      e.stopPropagation();
      if (!this.gen.classList.contains('on')) return;
      if (this.typing) this.finishTyping();
      else this.close();
    };
    this.gen.addEventListener('click', tap);
    this.ov.addEventListener('click', tap);
  }

  /** Called every frame: opens and closes with the game's briefing, types the words, moves the face. */
  update(now: number): void {
    const want = this.game.screen === 'game' && this.game.runPhase === 'battle' ? this.game.briefing : null;
    if (want !== this.shown) {
      if (want) this.open(want);
      else this.hide();
    }
    if (!this.shown) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.typing) {
      this.typed += dt * CHARS_PER_SEC;
      const n = Math.min(this.text.length, Math.floor(this.typed));
      if (this.tx.textContent!.length !== n) this.tx.textContent = this.text.slice(0, n);
      if (n >= this.text.length) this.finishTyping();
    }
    const t = now / 1000;
    const blink = t % 4 > 3.86;
    const mouth: 0 | 1 | 2 = this.typing ? (Math.sin(t * 22) > 0.3 ? 2 : Math.sin(t * 22) > -0.4 ? 1 : 0) : 0;
    this.face(blink, mouth);
  }

  private face(blink: boolean, mouth: 0 | 1 | 2): void {
    const key = `${blink ? 1 : 0}${mouth}`;
    let img = this.frames.get(key);
    if (!img) {
      img = new ImageData(generalPixels(blink, mouth), GENERAL_SIZE, GENERAL_SIZE);
      this.frames.set(key, img);
    }
    this.ctx.putImageData(img, 0, 0);
  }

  private later(ms: number, f: () => void): void {
    this.timers.push(window.setTimeout(f, this.reduce ? Math.min(ms, 30) : ms));
  }

  private open(kind: 'intro' | 'again'): void {
    const plan = this.game.plan;
    if (!plan) return;
    this.clearTimers();
    this.shown = kind;
    this.last = performance.now();
    this.root.hidden = false;
    this.root.classList.toggle('again', kind === 'again');
    this.mt.classList.remove('on', 'up');
    this.gen.classList.remove('on', 'done');
    this.ov.classList.remove('on');
    this.text = plan.brief;
    this.typed = 0;
    this.tx.textContent = '';
    (this.mt.querySelector('.n') as HTMLElement).textContent = `МИССИЯ ${plan.number}`;
    (this.mt.querySelector('.ty') as HTMLElement).textContent = plan.type;
    (this.mt.querySelector('.sub') as HTMLElement).textContent = [`звено ${plan.link + 1}`, plan.kindLabel.toLowerCase(), plan.sector].filter(Boolean).join(' · ');
    if (kind === 'again') {
      this.later(20, () => this.ov.classList.add('on'));
      this.showPlate(true);
      return;
    }
    this.later(60, () => this.ov.classList.add('on'));
    this.later(500, () => this.mt.classList.add('on'));
    this.later(2700, () => this.mt.classList.add('up'));
    this.later(3100, () => this.showPlate(false));
  }

  private showPlate(full: boolean): void {
    this.gen.classList.add('on');
    if (full || this.reduce) this.finishTyping();
    else this.typing = true;
    (this.root.querySelector('.go button') as HTMLButtonElement).focus({ preventScroll: true });
  }

  private finishTyping(): void {
    this.typing = false;
    this.tx.textContent = this.text;
    this.gen.classList.add('done');
  }

  private close(): void {
    this.hide();
    this.game.endBriefing();
  }

  private hide(): void {
    this.clearTimers();
    this.typing = false;
    this.shown = null;
    this.ov.classList.remove('on');
    this.mt.classList.remove('on');
    this.gen.classList.remove('on');
    this.root.hidden = true;
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
