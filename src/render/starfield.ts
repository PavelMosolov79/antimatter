import { Container, Graphics, Texture, TilingSprite } from 'pixi.js';
import { hash2, mulberry32 } from '../sim/rng';
import type { SectorId } from '../sim/space';
import { generateSky } from './space/skyGen';

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

/** A wrapping tile from raw RGBA: nearest-neighbour, repeating, so the clouds stay pixel art and tile for ever. */
function tileTexture(data: Uint8ClampedArray, size: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  tex.source.style.addressMode = 'repeat';
  return tex;
}

interface Layer {
  sprite: TilingSprite;
  parallax: number;
}
interface SkyTextures {
  far: Texture;
  near: Texture;
  dust: Texture;
}

/**
 * The sky behind the arena, back to front: stars, a far nebula, stars, a near nebula, dust,
 * stars. Each layer drifts at its own parallax — the farther, the slower. The nebulae and
 * the dust belong to the sector (see `setSector`); the stars are the same everywhere.
 */
export class Starfield {
  readonly container = new Container();
  private layers: Layer[] = [];
  private neb: { far: Layer; near: Layer; dust: Layer };
  private cache = new Map<string, SkyTextures>();
  private current = '';
  private sector: SectorId = 'violet';
  /** Meteors of the crimson sector's sky, drawn on the screen (they are far behind everything). */
  private readonly meteors = new Graphics();

  constructor() {
    const stars = [
      { seed: 11, count: 260, bright: 0.5, parallax: 0.04, scale: 2 },
      { seed: 23, count: 170, bright: 0.8, parallax: 0.1, scale: 2 },
      { seed: 37, count: 90, bright: 1, parallax: 0.22, scale: 3 },
    ];
    const starLayer = (d: (typeof stars)[number]): Layer => {
      const sprite = new TilingSprite({ texture: starTexture(d.seed, d.count, d.bright), width: 1, height: 1 });
      sprite.tileScale.set(d.scale);
      return { sprite, parallax: d.parallax };
    };
    const nebLayer = (parallax: number, alpha: number): Layer => {
      const sprite = new TilingSprite({ texture: Texture.EMPTY, width: 1, height: 1 });
      sprite.tileScale.set(4);
      sprite.alpha = alpha;
      sprite.visible = false;
      return { sprite, parallax };
    };
    this.neb = { far: nebLayer(0.07, 0.9), near: nebLayer(0.15, 0.85), dust: nebLayer(0.19, 1) };
    this.layers = [starLayer(stars[0]), this.neb.far, starLayer(stars[1]), this.neb.near, this.neb.dust, starLayer(stars[2])];
    for (const l of this.layers) this.container.addChild(l.sprite);
    this.container.addChild(this.meteors);
  }

  /** Hangs a sector's nebulae and dust behind the arena; the same sector and seed reuse their textures. */
  setSector(sector: SectorId, seed: number): void {
    const key = `${sector}:${Math.abs(Math.floor(seed)) % 997}`;
    if (key === this.current) return;
    let t = this.cache.get(key);
    if (!t) {
      const sky = generateSky(sector, seed);
      t = { far: tileTexture(sky.far, sky.size), near: tileTexture(sky.near, sky.size), dust: tileTexture(sky.dust, sky.size) };
      this.cache.set(key, t);
      // Keep a handful: the sky of the last few arenas, the rest freed.
      if (this.cache.size > 6) {
        const oldest = this.cache.keys().next().value as string;
        const old = this.cache.get(oldest)!;
        this.cache.delete(oldest);
        for (const tex of [old.far, old.near, old.dust]) tex.destroy(true);
      }
    }
    this.neb.far.sprite.texture = t.far;
    this.neb.near.sprite.texture = t.near;
    this.neb.dust.sprite.texture = t.dust;
    for (const l of [this.neb.far, this.neb.near, this.neb.dust]) l.sprite.visible = true;
    this.current = key;
    this.sector = sector;
  }

  /** A meteor shower: short bright streaks cross the sky on a slant and go out, each at its own pace. */
  private drawMeteors(screenW: number, screenH: number): void {
    const g = this.meteors;
    g.clear();
    if (this.sector !== 'crimson') return;
    const t = performance.now() / 1000;
    const u = Math.max(2, Math.round(screenW / 256));
    for (let i = 0; i < 16; i++) {
      const P = 2 + hash2(i, 1, 81) * 2.4;
      const ph = ((t + hash2(i, 2, 81) * P) % P) / P;
      const sx = hash2(i, 3, 81) * 1.5 * screenW;
      const sy = -10 + hash2(i, 4, 81) * screenH * 0.5;
      const dx = -0.82;
      const dy = 0.57;
      const hx = sx + dx * screenW * ph;
      const hy = sy + dy * screenW * ph;
      const len = 7 + Math.floor(hash2(i, 5, 81) * 8);
      for (let k = 0; k < len; k++) {
        const f = 1 - k / len;
        const color = k < 2 ? 0xffffff : k / len < 0.5 ? 0xa0dcff : 0x6e46aa;
        g.rect(Math.round(hx - dx * k * u), Math.round(hy - dy * k * u), u, u).fill({ color, alpha: 0.25 + 0.75 * f });
      }
    }
  }

  update(camX: number, camY: number, pxPerCell: number, screenW: number, screenH: number): void {
    this.drawMeteors(screenW, screenH);
    for (const l of this.layers) {
      l.sprite.width = screenW;
      l.sprite.height = screenH;
      l.sprite.tilePosition.set(-camX * pxPerCell * l.parallax, -camY * pxPerCell * l.parallax);
    }
  }
}
