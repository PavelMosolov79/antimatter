import { Container, Texture, TilingSprite } from 'pixi.js';
import { mulberry32 } from '../sim/rng';

function starTexture(seed: number, count: number, bright: number): Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * size);
    const y = Math.floor(rnd() * size);
    const b = 0.35 + rnd() * 0.65 * bright;
    const tint = rnd();
    const r = 200 + Math.floor(55 * b);
    const g = 200 + Math.floor(55 * b * (tint > 0.7 ? 0.7 : 1));
    const bl = 220 + Math.floor(35 * b * (tint < 0.3 ? 1 : 0.6));
    ctx.fillStyle = `rgba(${r},${g},${bl},${b})`;
    const s = rnd() > 0.93 ? 2 : 1;
    ctx.fillRect(x, y, s, s);
  }
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

export class Starfield {
  readonly container = new Container();
  private layers: Array<{ sprite: TilingSprite; parallax: number }> = [];

  constructor() {
    const defs = [
      { seed: 11, count: 260, bright: 0.5, parallax: 0.04, scale: 2 },
      { seed: 23, count: 170, bright: 0.8, parallax: 0.1, scale: 2 },
      { seed: 37, count: 90, bright: 1, parallax: 0.22, scale: 3 },
    ];
    for (const d of defs) {
      const sprite = new TilingSprite({ texture: starTexture(d.seed, d.count, d.bright), width: 1, height: 1 });
      sprite.tileScale.set(d.scale);
      this.container.addChild(sprite);
      this.layers.push({ sprite, parallax: d.parallax });
    }
  }

  update(camX: number, camY: number, pxPerCell: number, screenW: number, screenH: number): void {
    for (const l of this.layers) {
      l.sprite.width = screenW;
      l.sprite.height = screenH;
      l.sprite.tilePosition.set(-camX * pxPerCell * l.parallax, -camY * pxPerCell * l.parallax);
    }
  }
}
