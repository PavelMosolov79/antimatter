import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { GridBody } from '../sim/body';
import type { Decor } from '../sim/grid';
import { MATERIALS } from '../sim/materials';
import { hash2 } from '../sim/rng';
import { moduleSheetCanvas } from './moduleArt';

/** Pixels of the picture to a cell of the ship at full detail (coarser copies, 4, 2 and 1, are used when the ship is small on the screen). */
const FULL = 8;

function scaled(src: HTMLCanvasElement, step: number): HTMLCanvasElement {
  if (step === FULL) return src;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((src.width * step) / FULL));
  c.height = Math.max(1, Math.round((src.height * step) / FULL));
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

interface ModView {
  d: Decor;
  box: Container;
  sprite: Sprite;
  mask: Graphics;
  shade: Graphics;
  sheet: HTMLCanvasElement;
  textures: Map<number, Texture>;
  step: number;
  /** Cells to ask which room the module is in. */
  probes: number[];
  tint: number;
}

/**
 * The modules of the player's ship, drawn over the room of every one: each has a floor of its own colour
 * and a big thing that says what it is. The picture lies over cells that are still there only: a cell that
 * has been shot away shows what is under it, a damaged one is darker, and a room without air or on fire
 * is dimmed or reddened like the rest of the deck. When the ship is small on the screen a coarser copy of
 * the picture is used, so it stays clean instead of sparkling.
 */
export class DecorView {
  readonly container = new Container();
  private grid: GridBody['grid'] | null = null;
  private mods: ModView[] = [];
  private version = -1;
  private layer = -2;

  update(body: GridBody | null, layerView: number, pxPerCell: number, time: number): void {
    if (!body || layerView < 0 || body.grid.decor.length === 0) {
      this.container.visible = false;
      return;
    }
    if (body.grid !== this.grid) this.build(body);
    this.container.visible = true;
    this.container.position.set(body.x, body.y);
    this.container.pivot.set(body.comX, body.comY);
    this.container.rotation = body.angle;
    const grid = body.grid;
    const step = pxPerCell >= 8 ? 8 : pxPerCell >= 4 ? 4 : pxPerCell >= 2 ? 2 : 1;
    const changed = grid.version !== this.version || layerView !== this.layer;
    const rooms = body.sys?.rooms ?? null;
    for (const m of this.mods) {
      const on = m.d.z === layerView;
      m.box.visible = on;
      if (!on) continue;
      if (m.step !== step) this.setStep(m, step);
      if (changed) this.redraw(grid, m);
      // the air and the fire of the room it is in
      let dark = 1;
      let fire = 0;
      if (rooms) {
        for (const p of m.probes) {
          const r = rooms.cellRoom[p];
          if (r >= 0 && rooms.rooms[r]) {
            const room = rooms.rooms[r];
            dark = 1 - 0.5 * (1 - room.pressure);
            fire = room.fire > 0 ? room.fire * (0.7 + 0.3 * Math.sin(time * 22)) : 0;
            break;
          }
        }
      }
      const r = Math.round(255 * dark);
      const g = Math.round(255 * dark * (1 - 0.35 * fire));
      const b = Math.round(255 * dark * (1 - 0.6 * fire));
      const tint = (r << 16) | (g << 8) | b;
      if (tint !== m.tint) {
        m.tint = tint;
        m.sprite.tint = tint;
      }
    }
    this.grid = grid;
    this.version = grid.version;
    this.layer = layerView;
  }

  private build(body: GridBody): void {
    this.clear();
    this.grid = body.grid;
    this.version = -1;
    this.layer = -2;
    for (const d of body.grid.decor) {
      const box = new Container();
      const sprite = new Sprite(Texture.EMPTY);
      sprite.position.set(d.x0, d.y0);
      sprite.width = d.w;
      sprite.height = d.h;
      const mask = new Graphics();
      const shade = new Graphics();
      box.addChild(sprite, shade, mask);
      sprite.mask = mask;
      this.container.addChild(box);
      const probes: number[] = [];
      for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) probes.push(body.grid.idx(d.x0 + Math.floor(d.w * fx), d.y0 + Math.floor(d.h * fy), d.z));
      this.mods.push({ d, box, sprite, mask, shade, sheet: moduleSheetCanvas(d.type, d.w, d.h, d.tw, d.th), textures: new Map(), step: 0, probes, tint: -1 });
    }
  }

  private setStep(m: ModView, step: number): void {
    let t = m.textures.get(step);
    if (!t) {
      t = Texture.from(scaled(m.sheet, step));
      t.source.scaleMode = step === FULL ? 'nearest' : 'linear';
      m.textures.set(step, t);
    }
    m.step = step;
    m.sprite.texture = t;
    m.sprite.width = m.d.w;
    m.sprite.height = m.d.h;
  }

  /** The cells that are still there show the picture; damaged ones are darker. */
  private redraw(grid: GridBody['grid'], m: ModView): void {
    const { d } = m;
    m.mask.clear();
    m.shade.clear();
    const buckets: number[][] = [[], [], [], []];
    for (let y = d.y0; y < d.y0 + d.h; y++) {
      for (let x = d.x0; x < d.x0 + d.w; x++) {
        const i = grid.idx(x, y, d.z);
        const mat = grid.mat[i];
        if (mat === 0) continue;
        m.mask.rect(x, y, 1, 1);
        const ratio = grid.hp[i] / MATERIALS[mat].hp;
        let dim = ratio >= 0.999 ? 0 : (1 - ratio) * 0.5;
        if (ratio < 0.5 && hash2(x * 7, y * 13, d.z) > 0.72) dim += 0.25;
        const level = dim < 0.05 ? 0 : dim < 0.2 ? 1 : dim < 0.35 ? 2 : 3;
        if (level > 0) buckets[level].push(x, y);
      }
    }
    m.mask.fill(0xffffff);
    const alphas = [0, 0.15, 0.3, 0.5];
    for (let l = 1; l < buckets.length; l++) {
      const b = buckets[l];
      if (b.length === 0) continue;
      for (let k = 0; k < b.length; k += 2) m.shade.rect(b[k], b[k + 1], 1, 1);
      m.shade.fill({ color: 0x000000, alpha: alphas[l] });
    }
  }

  private clear(): void {
    for (const m of this.mods) {
      for (const t of m.textures.values()) t.destroy(true);
      m.box.destroy({ children: true });
    }
    this.mods = [];
  }

  reset(): void {
    this.clear();
    this.grid = null;
  }
}
