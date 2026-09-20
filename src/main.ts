import { Application } from 'pixi.js';
import { Game } from './game';
import { Scene } from './render/scene';
import { Hud } from './ui';

async function main(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#05070d',
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.body.insertBefore(app.canvas, document.body.firstChild);

  const scene = new Scene(app);
  const game = new Game(scene);
  const hud = new Hud(game, document.getElementById('hud')!);

  let panning = false;
  let lastX = 0;
  let lastY = 0;
  const canvas = app.canvas;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (e.button === 0) {
      const w = scene.screenToWorld(sx, sy);
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
    const rect = canvas.getBoundingClientRect();
    scene.cursor = scene.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    if (panning) {
      const s = scene.scale;
      scene.camX -= (e.clientX - lastX) / s;
      scene.camY -= (e.clientY - lastY) / s;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 2) panning = false;
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
    if (e.code === 'Space') {
      game.paused = !game.paused;
      e.preventDefault();
    } else if (e.code === 'KeyR') game.reset();
  });

  app.ticker.add((t) => {
    game.tick(t.deltaMS / 1000);
    hud.update(performance.now());
  });

  (window as unknown as { game: Game }).game = game;
}

void main();
