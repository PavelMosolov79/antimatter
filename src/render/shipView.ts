import { BufferImageSource, Sprite, Texture } from 'pixi.js';
import type { GridBody } from '../sim/body';
import type { RoomGraph } from '../sim/compartments';
import type { ShipGrid } from '../sim/grid';
import { Mat, MATERIALS } from '../sim/materials';
import { hash2 } from '../sim/rng';

export const OUTER_VIEW = -1;

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

export type Tint = [number, number, number];

/** Plate-and-seam texture: a coarse grid of slightly different tones with darker seams between them. */
function plating(x: number, y: number, z: number, pw: number, ph: number): number {
  const shades = [0.92, 0.97, 1.02, 1.07];
  const s = shades[Math.floor(hash2(Math.floor(x / pw), Math.floor(y / ph), z + 700) * shades.length)];
  return x % pw === 0 || y % ph === 0 ? s * 0.88 : s;
}

export function paintGrid(grid: ShipGrid, buf: Uint8Array, layer: number, tint: Tint = [1, 1, 1], rooms?: RoomGraph | null, time = 0): void {
  const w = grid.width;
  const h = grid.height;
  if (layer >= grid.depth) {
    buf.fill(0);
    return;
  }
  const visible = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return layer < 0 ? grid.colCount[y * w + x] > 0 : grid.mat[grid.idx(x, y, layer)] !== 0;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let z = -1;
      if (layer < 0) z = grid.topLayer(x, y);
      else if (grid.mat[grid.idx(x, y, layer)] !== 0) z = layer;
      if (z < 0) {
        // Interior deck view, but this column has no cell at this exact z: the hull
        // tapers here, so nothing was ever built at this slice. Still part of the ship's
        // footprint (colCount>0 elsewhere in the column) though, so paint it as solid
        // hull-wall backing rather than leaving it blank — otherwise it reads as open
        // space instead of the ship's own outer wall. A hand-painted ship shows its deck
        // exactly as drawn instead, which is just the deck's own footprint.
        if (layer >= 0 && grid.colCount[y * w + x] > 0 && !grid.paintFlags) {
          const def = MATERIALS[Mat.WALL];
          let f = 1 - 0.14 * layer;
          f *= 0.94 + 0.12 * hash2(x, y, layer);
          buf[o] = clamp255(((def.color >> 16) & 255) * f * tint[0]);
          buf[o + 1] = clamp255(((def.color >> 8) & 255) * f * tint[1]);
          buf[o + 2] = clamp255((def.color & 255) * f * tint[2]);
          buf[o + 3] = 255;
          continue;
        }
        buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 0;
        continue;
      }
      const i = grid.idx(x, y, z);
      const m = grid.mat[i];
      const def = MATERIALS[m];
      const ratio = grid.hp[i] / def.hp;
      const pf = grid.paintFlags ? grid.paintFlags[i] : 0;
      let r: number;
      let g: number;
      let bl: number;
      if (pf) {
        // Hand-painted cell: the drawn colour with the drawing's own shading (no depth
        // dimming, same noise and bevel), plus damage darkening as gameplay feedback.
        let f = 0.6 + 0.4 * ratio;
        if (!(pf & 2)) {
          f *= 0.94 + 0.12 * hash2(x, y, 0);
          if (!visible(x, y - 1) || !visible(x - 1, y)) f *= 1.22;
          else if (!visible(x, y + 1) || !visible(x + 1, y)) f *= 0.82;
          if (ratio < 0.5 && hash2(x * 7, y * 13, z) > 0.72) f *= 0.55;
        }
        const p = grid.paintRGB!;
        r = p[i * 3] * f * tint[0];
        g = p[i * 3 + 1] * f * tint[1];
        bl = p[i * 3 + 2] * f * tint[2];
      } else {
        let f = 1 - 0.14 * z;
        f *= 0.6 + 0.4 * ratio;
        f *= 0.94 + 0.12 * hash2(x, y, z);
        if (m === Mat.HULL || m === Mat.ARMOR) f *= plating(x, y, z, 5, 6);
        else if (m === Mat.DECK) f *= plating(x, y, z, 4, 4);
        if (!visible(x, y - 1) || !visible(x - 1, y)) f *= 1.22;
        else if (!visible(x, y + 1) || !visible(x + 1, y)) f *= 0.8;
        if (ratio < 0.5 && hash2(x * 7, y * 13, z) > 0.72) f *= 0.55;
        r = ((def.color >> 16) & 255) * f * tint[0];
        g = ((def.color >> 8) & 255) * f * tint[1];
        bl = (def.color & 255) * f * tint[2];
      }
      if (layer >= 0 && rooms) {
        const rid = rooms.cellRoom[i];
        if (rid >= 0) {
          const room = rooms.rooms[rid];
          const vac = 1 - room.pressure;
          const dark = 1 - 0.5 * vac;
          r *= dark;
          g *= dark;
          bl *= 0.85 * dark + 0.15 * dark * (1 - vac);
          if (room.fire > 0) {
            const flick = 0.7 + 0.3 * Math.sin(time * 22 + x * 1.7 + y * 2.3);
            const k = room.fire * flick;
            r = r + (255 - r) * 0.7 * k;
            g = g + (140 - g) * 0.35 * k;
            bl *= 1 - 0.6 * k;
          }
        }
      }
      buf[o] = clamp255(r);
      buf[o + 1] = clamp255(g);
      buf[o + 2] = clamp255(bl);
      buf[o + 3] = 255;
    }
  }
}

export class BodyView {
  readonly body: GridBody;
  readonly sprite: Sprite;
  private readonly source: BufferImageSource;
  private readonly texture: Texture;
  private readonly buffer: Uint8Array;
  private version = -1;
  private layer = -2;
  private look = -1;

  constructor(body: GridBody) {
    this.body = body;
    const { width, height } = body.grid;
    this.buffer = new Uint8Array(width * height * 4);
    this.source = new BufferImageSource({
      resource: this.buffer,
      width,
      height,
      format: 'rgba8unorm',
      scaleMode: 'nearest',
    });
    this.texture = new Texture({ source: this.source });
    this.sprite = new Sprite(this.texture);
  }

  update(layer: number, time = 0): void {
    const b = this.body;
    const look = (b.team + 1) * 2 + (b.sys?.dead ? 1 : 0);
    const rooms = layer >= 0 ? (b.sys?.rooms ?? null) : null;
    const live = rooms !== null;
    if (live || b.grid.version !== this.version || layer !== this.layer || look !== this.look) {
      let tint: Tint = [1, 1, 1];
      if (b.team === 1) tint = [1.2, 0.76, 0.76];
      if (b.sys?.dead) tint = [tint[0] * 0.55, tint[1] * 0.55, tint[2] * 0.55];
      paintGrid(b.grid, this.buffer, layer, tint, rooms, time);
      this.source.update();
      this.version = b.grid.version;
      this.layer = layer;
      this.look = look;
    }
    this.sprite.pivot.set(b.comX, b.comY);
    this.sprite.position.set(b.x, b.y);
    this.sprite.rotation = b.angle;
  }

  destroy(): void {
    this.sprite.destroy();
    this.texture.destroy(true);
  }
}
