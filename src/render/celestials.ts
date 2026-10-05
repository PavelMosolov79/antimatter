import { Container, Sprite, Texture } from 'pixi.js';
import type { Celestial } from '../sim/gravity';
import { hash2 } from '../sim/rng';
import { genHole, genPlanet, type PlanetSpec, type PlanetTypeId } from '../sim/space';
import { renderHole } from './space/holeGen';
import { renderComet, renderGate, renderPulsar, renderStorm } from './space/hazardGen';
import { ATMOSPHERE, PlanetPainter, type Picture } from './space/planetGen';

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

/** A picture on a canvas texture, nearest-neighbour; `upload` sends the picture's pixels to the screen again after they changed. */
function pictureTexture(p: Picture): { tex: Texture; upload: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = p.w;
  canvas.height = p.h;
  const ctx = canvas.getContext('2d')!;
  const img = new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.w, p.h);
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return {
    tex,
    upload: () => {
      ctx.putImageData(img, 0, 0);
      tex.source.update();
    },
  };
}

/** Something on the screen that moves: given the clock and the part of the world in view, it redraws itself if it is in view. */
export interface CelestialView {
  root: Container;
  /** `sim` is the time of the world (what the beams and the lightning follow), `now` the clock of the screen. */
  update(now: number, left: number, top: number, right: number, bottom: number, sim?: number): void;
  /** Lets go of what the view made for itself (its pictures). */
  dispose?(): void;
}

interface Animated {
  tex: Texture;
  texel: number;
  /** Called every frame; repaints the picture when it is time. */
  tick(now: number, visible: boolean): void;
  spec?: PlanetSpec;
}

// Planets and holes are expensive to paint and the same ones come back (the dock, the next
// fight on the same arena), so the last few are kept.
const pictures = new Map<string, Animated>();
function cached(key: string, make: () => Animated): Animated {
  let v = pictures.get(key);
  if (!v) {
    v = make();
    pictures.set(key, v);
    if (pictures.size > 8) {
      const oldest = pictures.keys().next().value as string;
      pictures.get(oldest)!.tex.destroy(true);
      pictures.delete(oldest);
    }
  }
  return v;
}

/** The planet turns and its clouds drift: every PLANET_PERIOD seconds a new picture is painted, a few rows per frame, and swapped in when whole. */
const PLANET_PERIOD = 5;
const PLANET_ROWS_PER_FRAME = 16;

/** The generated look of a planet: its spec comes from the seed and type, its size from the body itself. */
function planetPicture(c: Celestial): Animated {
  return cached(`p:${c.seed}:${c.variant}:${c.ring ? 1 : 0}:${Math.round(c.radius)}`, () => {
    const spec = genPlanet(c.seed, { type: c.variant as PlanetTypeId, ring: c.ring });
    spec.R = c.radius;
    const painter = new PlanetPainter(spec);
    const pic = painter.picture;
    painter.paintRows(performance.now() / 1000, 0, pic.h);
    const { tex, upload } = pictureTexture(pic);
    const rows = pic.h > 400 ? 24 : PLANET_ROWS_PER_FRAME;
    let row = pic.h;
    let t = 0;
    let nextAt = 0;
    return {
      tex,
      texel: pic.texel,
      spec,
      tick(now, visible) {
        if (!visible) return;
        if (row >= pic.h) {
          if (now < nextAt) return;
          row = 0;
          t = now;
          nextAt = now + PLANET_PERIOD;
        }
        const end = Math.min(pic.h, row + rows);
        painter.paintRows(t, row, end);
        row = end;
        if (row >= pic.h) {
          upload();
        }
      },
    };
  });
}

/**
 * The hole: its accretion disk turns, redrawn once a second. A frame a second is a step,
 * not a flow, so the disk's phase runs slower than in the design (HOLE_SPEED) to keep the
 * step small.
 */
const HOLE_FRAME = 1;
const HOLE_SPEED = 0.3;

function holePicture(c: Celestial): Animated {
  return cached(`h:${c.seed}:${Math.round(c.radius)}`, () => {
    const hole = genHole(c.seed, { M: c.radius / 12 });
    const pic = renderHole(hole, (performance.now() / 1000) * HOLE_SPEED);
    const { tex, upload } = pictureTexture(pic);
    let last = 0;
    return {
      tex,
      texel: pic.texel,
      tick(now, visible) {
        if (!visible || now - last < HOLE_FRAME) return;
        last = now;
        renderHole(hole, now * HOLE_SPEED, pic);
        upload();
      },
    };
  });
}

/** A picture that is painted again as the world's time goes on (a pulsar's beams, a storm, the gate's portal), a few times a second and only when in view. */
function liveView(c: Celestial, reach: number, fps: number, paint: (t: number, into?: Picture) => Picture, glow?: { inner: number; outer: number; size: number }): CelestialView {
  const root = new Container();
  root.position.set(c.x, c.y);
  if (glow) {
    const g = new Sprite(glowTexture(glow.inner, glow.outer));
    g.anchor.set(0.5);
    g.scale.set(glow.size / 256);
    g.blendMode = 'add';
    g.alpha = 0.5;
    root.addChild(g);
  }
  const pic = paint(0);
  const { tex, upload } = pictureTexture(pic);
  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5);
  sprite.scale.set(pic.texel);
  root.addChild(sprite);
  let last = -1e9;
  return {
    root,
    dispose: () => tex.destroy(true),
    update(now, left, top, right, bottom, sim = 0) {
      if (c.x + reach < left || c.x - reach > right || c.y + reach < top || c.y - reach > bottom) return;
      if (now - last < 1 / fps) return;
      last = now;
      paint(sim, pic);
      upload();
    },
  };
}

export function createCelestialView(c: Celestial): CelestialView {
  switch (c.kind) {
    case 'pulsar':
      return liveView(c, 1450, 12, (t, into) => renderPulsar(c, t, into), { inner: 0xcfeaff, outer: 0x59e6ff, size: 420 });
    case 'storm':
      return liveView(c, Math.max(c.radius, c.ry ?? 0) * 1.1, 8, (t, into) => renderStorm(c, t, into));
    case 'gate':
      return liveView(c, 300, 12, (t, into) => renderGate(c, t, into), { inner: 0x59e6ff, outer: 0x1d3f8a, size: 520 });
    case 'comet': {
      const root = new Container();
      const pic = renderComet(c);
      const { tex } = pictureTexture(pic);
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.scale.set(pic.texel);
      root.addChild(sprite);
      root.position.set(c.x, c.y);
      return {
        root,
        dispose: () => tex.destroy(true),
        update() {
          root.position.set(c.x, c.y);
        },
      };
    }
    case 'wreck':
    case 'asteroids':
      return { root: new Container(), update() {} };
    default:
      return createBodyView(c);
  }
}

function createBodyView(c: Celestial): CelestialView {
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
  let anim: Animated | null = null;
  switch (c.kind) {
    case 'planet':
      if (c.variant) {
        const p = planetPicture(c);
        anim = p;
        const atmo = ATMOSPHERE[p.spec!.type];
        if (atmo) add(glowTexture((atmo[0] << 16) | (atmo[1] << 8) | atmo[2], (atmo[0] << 16) | (atmo[1] << 8) | atmo[2]), (c.radius * (2 + 3 * p.spec!.atmoK)) / 256, 'add', 0.3);
        add(p.tex, p.texel);
      } else {
        add(glowTexture(0x5a8cff, 0x3a6cff), (c.radius * 2.6) / 256, 'add', 0.55);
        add(sphereTexture(c, { deep: 0x1c3f7a, shallow: 0x2f78b8, land: 0x4d8a3c, peak: 0xc9b98a, rim: 0x7fb8ff }, 0.5));
      }
      break;
    case 'moon':
      add(sphereTexture(c, { deep: 0x55575e, shallow: 0x7b7d85, land: 0x9b9da6, peak: 0xd0d2d8, rim: 0xb0b2ba }, 0.35));
      break;
    case 'star':
      add(glowTexture(0xffc060, 0xff6a10), (c.radius * 4.5) / 256, 'add', 0.5);
      add(starTexture(c));
      break;
    case 'blackhole': {
      const h = holePicture(c);
      anim = h;
      add(glowTexture(0x9a4a1a, 0x5a2a80), (c.radius * 14) / 256, 'add', 0.5);
      add(h.tex, h.texel);
      break;
    }
  }
  // Anything of it in view? A planet's rings and atmosphere reach a little past its radius; a hole's glow far past.
  const reach = c.kind === 'blackhole' ? c.radius * 7 : c.radius * 2.4;
  return {
    root,
    update(now, left, top, right, bottom) {
      if (!anim) return;
      anim.tick(now, c.x + reach > left && c.x - reach < right && c.y + reach > top && c.y - reach < bottom);
    },
  };
}
