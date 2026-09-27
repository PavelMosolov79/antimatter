import { Application } from 'pixi.js';
import { Game } from './game';
import { Scene } from './render/scene';
import { prepareShipCards } from './runScreen';
import { TitleScreen } from './title/titleScreen';
import { Hud } from './ui';

/** Lets the loading screen draw a frame between two pieces of work. */
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function main(): Promise<void> {
  // The loading screen goes up first; each real step of the start-up moves the core on.
  const title = new TitleScreen(document.body);
  title.step(0, 'Запуск магнитной ловушки');
  await nextFrame();
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#05070d',
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.body.insertBefore(app.canvas, document.body.firstChild);

  title.step(0.15, 'Сборка корпусов');
  await nextFrame();
  prepareShipCards();

  title.step(0.4, 'Расчёт сектора');
  await nextFrame();
  const scene = new Scene(app);
  const game = new Game(scene);

  title.step(0.65, 'Прогрев реактора');
  await nextFrame();
  const hud = new Hud(game, document.getElementById('hud')!);
  hud.update(performance.now());

  title.step(0.9, 'Стабилизация ядра');
  await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
  title.finish(game);

  let panning = false;
  let lastX = 0;
  let lastY = 0;
  const canvas = app.canvas;
  // Fingers are ours, not the browser's: no page scroll, pinch-zoom or double-tap zoom.
  canvas.style.touchAction = 'none';

  const local = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Touch: a tap acts like a left click, one finger dragging moves the camera, two fingers
  // pinch to zoom around the point between them (and drag the camera with it).
  const TAP_SLOP = 10;
  const TAP_TIME = 450;
  const touches = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  let tapCandidate = false;
  let pinch: { dist: number; zoom: number; mx: number; my: number } | null = null;
  const pinchState = () => {
    const [a, b] = [...touches.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    if (e.pointerType !== 'mouse') {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser no longer tracks can't be captured; the gesture still works.
      }
      touches.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now() });
      scene.cursor = scene.screenToWorld(p.x, p.y);
      if (touches.size === 1) tapCandidate = true;
      else {
        tapCandidate = false;
        if (touches.size === 2) pinch = { ...pinchState(), zoom: scene.zoom };
      }
      return;
    }
    if (e.button === 0) {
      const w = scene.screenToWorld(p.x, p.y);
      game.pointerAction(w.x, w.y);
    } else if (e.button === 2) {
      panning = true;
      lastX = e.clientX;
      lastY = e.clientY;
      scene.follow = false;
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (e.pointerType !== 'mouse') {
      const t = touches.get(e.pointerId);
      if (!t) return;
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      t.x = p.x;
      t.y = p.y;
      if (touches.size === 1) {
        if (tapCandidate && Math.hypot(p.x - t.sx, p.y - t.sy) < TAP_SLOP) return;
        tapCandidate = false;
        scene.follow = false;
        scene.camX -= dx / scene.scale;
        scene.camY -= dy / scene.scale;
      } else if (touches.size === 2 && pinch) {
        const now = pinchState();
        scene.follow = false;
        // The camera follows the fingers' midpoint...
        scene.camX -= (now.mx - pinch.mx) / scene.scale;
        scene.camY -= (now.my - pinch.my) / scene.scale;
        pinch.mx = now.mx;
        pinch.my = now.my;
        // ...and zooms around it, keeping the world point under it in place.
        const before = scene.screenToWorld(now.mx, now.my);
        scene.zoom = Math.max(0.15, Math.min(4, (pinch.zoom * now.dist) / pinch.dist));
        const after = scene.screenToWorld(now.mx, now.my);
        scene.camX += before.x - after.x;
        scene.camY += before.y - after.y;
      }
      return;
    }
    scene.cursor = scene.screenToWorld(p.x, p.y);
    if (panning) {
      const s = scene.scale;
      scene.camX -= (e.clientX - lastX) / s;
      scene.camY -= (e.clientY - lastY) / s;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  const touchEnd = (e: PointerEvent, cancelled: boolean) => {
    const t = touches.get(e.pointerId);
    if (!t) return;
    touches.delete(e.pointerId);
    if (!cancelled && tapCandidate && touches.size === 0 && performance.now() - t.t < TAP_TIME) {
      const w = scene.screenToWorld(t.x, t.y);
      game.pointerAction(w.x, w.y);
    }
    if (touches.size < 2) pinch = null;
    if (touches.size === 0) tapCandidate = false;
  };
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') touchEnd(e, false);
    else if (e.button === 2) panning = false;
  });
  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType !== 'mouse') touchEnd(e, true);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0012);
      scene.zoom = Math.max(0.15, Math.min(4, scene.zoom * f));
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    if (game.screen === 'title') return;
    if (e.code === 'Space') {
      game.paused = !game.paused;
      e.preventDefault();
    } else if (e.code === 'KeyR' && game.mode === 'sandbox') game.reset();
  });

  app.ticker.add((t) => {
    game.tick(t.deltaMS / 1000);
    hud.update(performance.now());
    title.watch();
  });

  (window as unknown as { game: Game }).game = game;
}

void main();
