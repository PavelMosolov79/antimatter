import { Application, Container, Graphics, Text } from 'pixi.js';
import { Game, STEP } from '../src/game';
import { Scene } from '../src/render/scene';
import { OUTER_VIEW } from '../src/render/shipView';
import type { World } from '../src/sim/world';
import { renderAudio } from './audio';
import { Mp4Writer } from './encode';
import { CAPTIONS, SHOTS, type Ctx, type Shot } from './shots';

/**
 * The promo film: 15 seconds, 1080×1920, 30 frames a second, made frame by frame out of the real game (its world,
 * its renderer) with a camera, captions and effects on top. Nothing here is real time: every frame the world is
 * stepped by an exact amount, so the film comes out the same however fast the machine is.
 */
const W = 1080;
const H = 1920;
const FPS = 30;
const TOTAL = 15;

declare global {
  interface Window {
    __ready: Promise<void>;
    __render: (o: { mode: 'preview' | 'final' | 'still'; from: number; to: number }) => Promise<string>;
  }
}

const upload = async (name: string, body: Blob | ArrayBuffer): Promise<void> => {
  await fetch(`http://127.0.0.1:5599/save?name=${encodeURIComponent(name)}`, { method: 'POST', body });
};

async function boot(): Promise<Ctx> {
  const app = new Application();
  await app.init({ width: W, height: H, background: 0x05070d, antialias: false, resolution: 1, autoDensity: false, preserveDrawingBuffer: true });
  document.body.appendChild(app.canvas);
  await Promise.race([document.fonts.load('900 60px Unbounded', 'КАЖДАЯ КЛЕТКА РАЗРУШАЕМА ПОЖАРЫ ЭКИПАЖ ПУЛЬСАР abc'), new Promise((r) => setTimeout(r, 4000))]);
  await Promise.race([document.fonts.load('700 40px "JetBrains Mono"', 'Осмотр остова'), new Promise((r) => setTimeout(r, 2000))]);
  const scene = new Scene(app);
  scene.follow = false;
  const game = new Game(scene);
  const fx = new Container();
  app.stage.addChild(fx);
  const ctx: Ctx = {
    app, scene, game, fx, W, H, FPS,
    shake: 0, flash: 0, flashColor: 0xffffff, time: 0, audio: [],
    observe(): void {
      let lastShot = -1;
      for (const e of game.world.events) {
        if (e.t === 'impact') {
          ctx.shake = Math.min(26, ctx.shake + Math.min(5, e.energy / 220));
          ctx.audio.push({ t: ctx.time, kind: 'thump', v: Math.min(1, e.energy / 3000) });
        } else if (e.t === 'detonate') {
          ctx.shake = 42;
          ctx.flash = 0.85;
          ctx.flashColor = 0xfff0c0;
          ctx.audio.push({ t: ctx.time, kind: 'boom', v: Math.min(1, e.r / 60) });
        } else if (e.t === 'bolt') {
          ctx.flash = Math.max(ctx.flash, 0.5);
          ctx.flashColor = 0xbfd8ff;
        } else if (e.t === 'shot' && lastShot < 0) {
          lastShot = 1;
          ctx.audio.push({ t: ctx.time, kind: 'zap', v: 0.5 });
        }
      }
    },
    draw(speed: number): void {
      ctx.observe();
      const s = scene;
      const cx = s.camX;
      const cy = s.camY;
      if (ctx.shake > 0.3) {
        s.camX += ((Math.random() - 0.5) * 2 * ctx.shake) / s.scale;
        s.camY += ((Math.random() - 0.5) * 2 * ctx.shake) / s.scale;
      }
      s.render(game.world, 1 / FPS, speed / FPS);
      s.camX = cx;
      s.camY = cy;
      ctx.shake *= 0.86;
    },
    get world(): World {
      return game.world;
    },
    step(n: number): void {
      for (let i = 0; i < n; i++) game.world.step(STEP);
    },
    layer: OUTER_VIEW,
  };
  return ctx;
}

const ease = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const back = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  const c1 = 2.2;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

interface CapView {
  box: Container;
  lines: Array<{ text: Text; delay: number }>;
  t0: number;
  t1: number;
  fit: number;
}

function buildCaptions(ctx: Ctx): CapView[] {
  return CAPTIONS.map((c) => {
    const box = new Container();
    const lines: CapView['lines'] = [];
    let y = 0;
    for (const [line, color, delay] of c.lines) {
      const t = new Text({
        text: line,
        style: {
          fontFamily: 'Unbounded, Arial Black, sans-serif',
          fontWeight: '900',
          fontSize: c.size ?? 76,
          fill: color,
          stroke: { color: 0x05070d, width: 18, join: 'round' },
          dropShadow: { color: 0x000000, alpha: 0.75, blur: 0, distance: 10, angle: Math.PI / 2 },
          align: 'center',
          letterSpacing: 1,
        },
      });
      t.anchor.set(0.5);
      const h = t.height * 0.9;
      t.y = y + h / 2;
      y += h;
      box.addChild(t);
      lines.push({ text: t, delay: delay ?? 0 });
    }
    // never wider than the screen with a margin
    const widest = Math.max(...lines.map((l) => l.text.width));
    const fit = Math.min(1, 940 / widest);
    box.pivot.set(0, y / 2);
    box.position.set(W / 2, c.y);
    box.scale.set(fit);
    box.visible = false;
    ctx.fx.addChild(box);
    return { box, lines, t0: c.t0, t1: c.t1, fit };
  });
}

function updateCaptions(caps: CapView[], t: number): void {
  for (const c of caps) {
    const on = t >= c.t0 && t < c.t1;
    c.box.visible = on;
    if (!on) continue;
    const out = Math.min(1, (c.t1 - t) / 0.12);
    c.box.alpha = out;
    for (const l of c.lines) {
      const a = (t - c.t0 - l.delay) / 0.28;
      l.text.visible = a > 0;
      const s = back(a);
      l.text.scale.set(s * (0.94 + 0.06 * out));
      l.text.rotation = (1 - ease(a)) * -0.05;
      l.text.alpha = Math.min(1, a * 4);
    }
  }
}

/** A vignette, a white flash, scanlines: the finishing layer over everything. */
function buildOverlay(ctx: Ctx): { flash: Graphics; vignette: Graphics; update: (t: number) => void } {
  const vignette = new Graphics();
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const k = 1 - i / steps;
    const inset = k * 220;
    vignette.rect(inset - 220, inset - 220, W - 2 * (inset - 220), H - 2 * (inset - 220)).stroke({ width: 220 / steps + 2, color: 0x000000, alpha: 0.05 + 0.03 * (1 - k) });
  }
  vignette.alpha = 0.9;
  const flash = new Graphics();
  flash.rect(0, 0, W, H).fill(0xffffff);
  flash.alpha = 0;
  ctx.fx.addChildAt(vignette, 0);
  ctx.fx.addChild(flash);
  return {
    flash,
    vignette,
    update(): void {
      flash.tint = ctx.flashColor;
      flash.alpha = Math.min(1, ctx.flash);
      ctx.flash *= 0.78;
    },
  };
}

window.__ready = (async () => {
  const ctx = await boot();
  const caps = buildCaptions(ctx);
  const overlay = buildOverlay(ctx);
  (window as unknown as { __ctx: Ctx }).__ctx = ctx;

  window.__render = async ({ mode, from, to }) => {
    const shots: Shot[] = SHOTS;
    let writer: Mp4Writer | null = null;
    if (mode === 'final') writer = await Mp4Writer.create(W, H, FPS);
    const thumbs: HTMLCanvasElement[] = [];
    const TW = 216;
    const TH = 384;
    let current: Shot | null = null;
    let tStart = 0;
    const f0 = Math.round(from * FPS);
    const f1 = Math.round(Math.min(to, TOTAL) * FPS);
    // shots before `from` still have to be set up in order, silently, so that what carries over (the world) is right
    for (let f = mode === 'final' || from === 0 ? f0 : 0; f < f1; f++) {
      const t = f / FPS;
      let acc = 0;
      let shot = shots[0];
      for (const s of shots) {
        if (t >= acc && t < acc + s.dur) {
          shot = s;
          tStart = acc;
          break;
        }
        acc += s.dur;
      }
      if (shot !== current) {
        current?.leave?.(ctx);
        if (current) ctx.audio.push({ t, kind: 'swish', v: 1 });
        current = shot;
        await shot.setup(ctx);
      }
      ctx.time = t;
      const tl = t - tStart;
      await shot.frame(ctx, tl, t, f);
      updateCaptions(caps, t);
      overlay.update(t);
      ctx.app.renderer.render(ctx.app.stage);
      if (f < f0) continue;
      if (mode === 'final' && writer) await writer.add(ctx.app.canvas, f - f0);
      if (mode === 'preview' && (f - f0) % 9 === 0) {
        const c = document.createElement('canvas');
        c.width = TW;
        c.height = TH;
        const g = c.getContext('2d')!;
        g.drawImage(ctx.app.canvas, 0, 0, TW, TH);
        g.fillStyle = '#fff';
        g.font = '16px monospace';
        g.fillText(t.toFixed(1), 6, 18);
        thumbs.push(c);
      }
      if (mode === 'still') {
        const blob: Blob = await new Promise((r) => ctx.app.canvas.toBlob((b) => r(b!), 'image/png'));
        await upload(`still-${t.toFixed(2)}.png`, blob);
        return 'still';
      }
    }
    if (mode === 'preview') {
      const cols = 10;
      const rows = Math.ceil(thumbs.length / cols);
      const sheet = document.createElement('canvas');
      sheet.width = cols * TW;
      sheet.height = rows * TH;
      const g = sheet.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, sheet.width, sheet.height);
      thumbs.forEach((c, i) => g.drawImage(c, (i % cols) * TW, Math.floor(i / cols) * TH));
      const blob: Blob = await new Promise((r) => sheet.toBlob((b) => r(b!), 'image/png'));
      await upload(`sheet-${from}-${to}.png`, blob);
      return 'sheet';
    }
    if (writer) {
      const sound = await renderAudio(ctx.audio, TOTAL);
      let peak = 0;
      const ch = sound.getChannelData(0);
      for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
      const secs: string[] = [];
      for (let sec = 0; sec < TOTAL; sec++) {
        let sum = 0;
        for (let i = sec * 48000; i < (sec + 1) * 48000; i++) sum += ch[i] * ch[i];
        secs.push(Math.sqrt(sum / 48000).toFixed(2));
      }
      if (peak > 0.92) {
        const k = 0.92 / peak;
        for (let c = 0; c < sound.numberOfChannels; c++) {
          const d = sound.getChannelData(c);
          for (let i = 0; i < d.length; i++) d[i] *= k;
        }
      }
      console.log('audio peak', peak.toFixed(2), 'rms per second', secs.join(' '), 'events', ctx.audio.length);
      await writer.addAudio(sound);
      const bytes = await writer.finish();
      await upload('antimatter-promo.mp4', bytes);
      return `mp4 ${bytes.byteLength}`;
    }
    return 'ok';
  };
})();
