import { Container, Sprite, Texture } from 'pixi.js';
import type { Celestial } from '../sim/gravity';
import { hash2 } from '../sim/rng';

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, seed: number, oct = 4): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x * f, y * f, seed + i * 17);
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

function canvasTexture(size: number, paint: (img: ImageData) => void): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  paint(img);
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

function put(img: ImageData, x: number, y: number, color: number, alpha = 255): void {
  const o = (y * img.width + x) * 4;
  img.data[o] = (color >> 16) & 255;
  img.data[o + 1] = (color >> 8) & 255;
  img.data[o + 2] = color & 255;
  img.data[o + 3] = alpha;
}

function sphereTexture(c: Celestial, palette: { deep: number; shallow: number; land: number; peak: number; rim: number }, waterLevel: number): Texture {
  const size = Math.ceil(c.radius * 2) + 2;
  const R = c.radius;
  return canvasTexture(size, (img) => {
    const mid = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - mid) / R;
        const dy = (y + 0.5 - mid) / R;
        const r2 = dx * dx + dy * dy;
        if (r2 > 1) continue;
        const nz = Math.sqrt(1 - r2);
        const n = fbm((x / R) * 3.2 + c.seed, (y / R) * 3.2, c.seed);
        let col: number;
        if (n < waterLevel) col = mix(palette.deep, palette.shallow, n / waterLevel);
        else col = mix(palette.land, palette.peak, (n - waterLevel) / (1 - waterLevel));
        let light = Math.max(0, -0.5 * dx - 0.6 * dy + 0.62 * nz);
        light = Math.round(light * 5) / 5;
        col = mix(0x05060a, col, 0.25 + 0.85 * light);
        if (r2 > 0.86) col = mix(col, palette.rim, (r2 - 0.86) / 0.14 * 0.55);
        put(img, x, y, col);
      }
    }
  });
}

function glowTexture(inner: number, outer: number): Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const hex = (v: number, a: number) => `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  grad.addColorStop(0, hex(inner, 0.9));
  grad.addColorStop(0.35, hex(outer, 0.45));
  grad.addColorStop(1, hex(outer, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

function starTexture(c: Celestial): Texture {
  const size = Math.ceil(c.radius * 2) + 2;
  const R = c.radius;
  return canvasTexture(size, (img) => {
    const mid = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - mid) / R;
        const dy = (y + 0.5 - mid) / R;
        const r2 = dx * dx + dy * dy;
        if (r2 > 1) continue;
        const n = fbm((x / R) * 5 + c.seed, (y / R) * 5, c.seed, 5);
        const limb = Math.sqrt(1 - r2);
        let t = 0.15 + 0.7 * limb * (0.45 + 0.9 * n);
        t = Math.round(Math.min(1, t) * 6) / 6;
        put(img, x, y, t < 0.6 ? mix(0xb52d06, 0xff8a1e, t / 0.6) : mix(0xff8a1e, 0xfff0a0, (t - 0.6) / 0.4));
      }
    }
  });
}

function blackHoleTexture(c: Celestial): Texture {
  const R = c.radius;
  const size = Math.ceil(R * 7);
  return canvasTexture(size, (img) => {
    const mid = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - mid;
        const dy = y + 0.5 - mid;
        const r = Math.hypot(dx, dy) / R;
        if (r < 1) {
          put(img, x, y, 0x000000, 255);
          continue;
        }
        if (r < 1.12) {
          put(img, x, y, 0xffd9a0, 255);
          continue;
        }
        if (r > 3.4) continue;
        const ang = Math.atan2(dy, dx) + r * 1.5;
        const swirl = fbm(Math.cos(ang) * r * 1.6 + 20 + c.seed, Math.sin(ang) * r * 1.6 + 20, c.seed, 3);
        let k = 1 - (r - 1.12) / 2.28;
        k = Math.pow(Math.max(0, k), 1.6) * (0.5 + 0.9 * swirl);
        k = Math.min(1, k);
        if (k < 0.04) continue;
        const col = mix(0x8a1a05, 0xfff0d0, Math.pow(k, 0.8));
        put(img, x, y, col, Math.round(Math.min(1, k * 1.4) * 255));
      }
    }
  });
}

export function createCelestialView(c: Celestial): Container {
  const root = new Container();
  root.position.set(c.x, c.y);
  const add = (tex: Texture, scale = 1, blend: 'normal' | 'add' = 'normal', alpha = 1) => {
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.scale.set(scale);
    s.blendMode = blend;
    s.alpha = alpha;
    root.addChild(s);
    return s;
  };
  switch (c.kind) {
    case 'planet':
      add(glowTexture(0x5a8cff, 0x3a6cff), (c.radius * 2.6) / 256, 'add', 0.55);
      add(sphereTexture(c, { deep: 0x1c3f7a, shallow: 0x2f78b8, land: 0x4d8a3c, peak: 0xc9b98a, rim: 0x7fb8ff }, 0.5));
      break;
    case 'moon':
      add(sphereTexture(c, { deep: 0x55575e, shallow: 0x7b7d85, land: 0x9b9da6, peak: 0xd0d2d8, rim: 0xb0b2ba }, 0.35));
      break;
    case 'star':
      add(glowTexture(0xffc060, 0xff6a10), (c.radius * 4.5) / 256, 'add', 0.5);
      add(starTexture(c));
      break;
    case 'blackhole':
      add(glowTexture(0x9a4a1a, 0x5a2a80), (c.radius * 9) / 256, 'add', 0.6);
      add(blackHoleTexture(c));
      break;
  }
  return root;
}
