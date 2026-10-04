import { K, TILE, type DeckPlan, type ModuleId } from './layout';
import { hash2 } from './rng';

/**
 * How a ship's interior looks: the pictures of the modules from the dock's module menu
 * (same pixels as in «Концепт обшивки») and the colours of floor, walls and doors.
 * Pure data, no drawing library: the menu paints it on a canvas, the game stores it as
 * the decks' hand-painted cell colours.
 */

type RGB = [number, number, number];

const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mul = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
const white = (c: RGB, a: number): RGB => [c[0] + (255 - c[0]) * a, c[1] + (255 - c[1]) * a, c[2] + (255 - c[2]) * a];

const C = {
  hull: hex(0x8c96a8),
  wall: hex(0x596273),
  module: hex(0x3fb8a6),
  thruster: hex(0x52d4ee),
  shield: hex(0x6a86ff),
  bridge: hex(0xd8e6ff),
  stripe: hex(0xd23c3c),
  door: hex(0xe0b34e),
  engine: hex(0xd9822b),
  amber: hex(0xf0a851),
  hazY: hex(0xb9732a),
  hazK: hex(0x16171c),
  crate: hex(0x9a6a34),
  blanket: hex(0x4a5f9c),
  sheet: hex(0xc4cdd9),
  cross: hex(0x3fb8a6),
  field: hex(0x05080c),
  anti: hex(0xb06bff),
  antiDeep: hex(0x2e2250),
  antiMid: hex(0x56428a),
  antiLight: hex(0xe8dcf6),
};

/** A picture of a room's inside (without its wall): RGBA. */
export class Art {
  readonly px: Uint8ClampedArray;
  constructor(
    readonly iw: number,
    readonly ih: number,
  ) {
    this.px = new Uint8ClampedArray(iw * ih * 4);
  }
  set(x: number, y: number, c: RGB): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.iw || y >= this.ih) return;
    const o = (y * this.iw + x) * 4;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
    this.px[o + 3] = 255;
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  floor(base?: RGB): void {
    const b = base ?? mul(C.hull, 0.6);
    for (let y = 0; y < this.ih; y++) {
      for (let x = 0; x < this.iw; x++) {
        let s = [0.9, 0.97, 1.04, 1.1][Math.floor(hash2(Math.floor(x / 4), Math.floor(y / 4), 401) * 4)];
        if (x % 4 === 0 || y % 4 === 0) s *= 0.88;
        if (hash2(x, y, 402) < 0.03) s *= 0.7;
        this.set(x, y, mul(b, s));
      }
    }
  }
  chair(cx: number, cy: number, dir: 'up' | 'down', acc?: RGB): void {
    const seat = mul(C.wall, 0.95);
    const back = mul(C.wall, 0.5);
    this.rect(cx - 1, cy - 1, cx + 1, cy + 1, seat);
    if (dir === 'up') this.rect(cx - 1, cy + 2, cx + 1, cy + 2, back);
    else this.rect(cx - 1, cy - 2, cx + 1, cy - 2, back);
    this.set(cx, cy, acc ?? white(C.wall, 0.4));
  }
  console(x0: number, y0: number, x1: number, y1: number): void {
    this.rect(x0, y0, x1, y1, mul(C.wall, 0.4));
    const scr = [mul(C.thruster, 1.1), mul(C.module, 1.15), mul(C.shield, 1.2)];
    for (let x = x0; x <= x1; x++) this.set(x, y0, scr[Math.floor((x - x0) / 2) % 3]);
    if (y1 > y0) {
      const btn = [C.module, C.shield, C.thruster];
      let k = 0;
      for (let x = x0; x <= x1; x++) if ((x - x0) % 2 === 0) this.set(x, y1, mul(btn[k++ % 3], 1.3));
    }
  }
  hazard(x0: number, x1: number, y: number): void {
    for (let x = x0; x <= x1; x++) this.set(x, y, x % 4 < 2 ? C.hazK : C.hazY);
  }
}

// --- the eight pool modules: a fixed 8×8 inside

function artGun(a: Art): void {
  a.floor();
  a.console(1, 0, 6, 1);
  for (let y = 2; y <= 6; y++) {
    for (let x = 1; x <= 6; x++) {
      const d = Math.hypot(x + 0.5 - 4, y + 0.5 - 4.4);
      if (d <= 0.9) a.set(x, y, mul(C.thruster, 1.25));
      else if (d <= 1.9) a.set(x, y, (x + y) % 2 ? mul(C.engine, 0.8) : mul(C.wall, 0.35));
      else if (d <= 2.5) a.set(x, y, white(C.wall, 0.3));
    }
  }
  for (let r = 3; r <= 5; r++) {
    a.set(0, r, mul(C.module, 0.75 + r * 0.05));
    a.set(7, r, mul(C.module, 0.75 + r * 0.05));
  }
  a.chair(4, 7, 'up');
  a.set(3, 7, mul(C.wall, 0.6));
}
function artEng(a: Art): void {
  a.floor();
  a.console(1, 0, 6, 1);
  for (const y of [2, 4]) {
    for (let x = 1; x <= 6; x++) a.set(x, y, mul(C.engine, x % 3 < 2 ? 0.95 : 0.6));
    a.set(1, y, mul(C.thruster, 1.25));
    a.set(6, y, mul(C.thruster, 1.25));
  }
  a.hazard(1, 6, 5);
  a.chair(2, 7, 'up');
  a.chair(5, 7, 'up');
  a.set(3, 3, mul(C.thruster, 1.1));
  a.set(4, 3, mul(C.module, 1.2));
}
function artRcs(a: Art): void {
  a.floor();
  for (const p of [
    [1.6, 1.4],
    [6.2, 1.4],
  ]) {
    for (let y = 0; y <= 3; y++) {
      for (let x = 0; x <= 7; x++) {
        const d = Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]);
        if (d > 1.9) continue;
        a.set(x, y, d < 0.9 ? mul(C.thruster, 1.35) : d > 1.5 ? white(C.hull, 0.2) : mul(C.wall, 0.55));
      }
    }
  }
  for (let y = 3; y <= 4; y++) {
    a.set(3, y, mul(C.engine, 0.85));
    a.set(4, y, mul(C.engine, 0.85));
  }
  a.console(1, 4, 6, 5);
  a.chair(3, 7, 'up');
  a.set(5, 7, mul(C.wall, 0.6));
}
function artWork(a: Art): void {
  a.floor();
  for (let i = 0; i < 3; i++) {
    const y = i * 2;
    a.rect(0, y, 1, y + 1, mul(C.wall, 0.45));
    a.set(0, y, mul(C.module, 1.1));
    a.set(1, y + 1, mul(C.wall, 0.3));
  }
  for (let t = 0; t < 4; t++) a.set(7, 1 + t * 1.5, mul(C.engine, t % 2 ? 0.75 : 1));
  a.rect(6, 0, 6, 6, mul(C.wall, 0.5));
  a.rect(3, 3, 5, 4, mul(C.wall, 0.4));
  a.set(4, 3, mul(C.hazY, 1.3));
  a.set(3, 4, mul(C.thruster, 1.1));
  a.rect(2, 6, 4, 7, mul(C.wall, 0.36));
  a.set(3, 6, mul(C.module, 1.2));
  a.set(5, 7, mul(C.engine, 0.85));
}
function artMed(a: Art): void {
  a.floor();
  a.rect(1, 0, 2, 0, mul(C.cross, 1.2));
  a.rect(5, 0, 6, 0, mul(C.cross, 1.2));
  for (const p of [
    [1, 1],
    [5, 1],
  ]) {
    a.rect(p[0], p[1], p[0] + 1, p[1] + 3, C.sheet);
    a.rect(p[0], p[1], p[0] + 1, p[1], white(C.sheet, 0.5));
    a.rect(p[0], p[1] + 2, p[0] + 1, p[1] + 3, mul(C.blanket, 1.1));
  }
  a.rect(3, 1, 4, 2, mul(C.wall, 0.4));
  a.set(3, 1, mul(C.thruster, 1.2));
  a.set(4, 2, mul(C.cross, 1.2));
  a.rect(3, 5, 4, 7, C.cross);
  a.rect(2, 6, 5, 6, C.cross);
  a.set(3, 6, white(C.cross, 0.7));
  a.set(4, 6, white(C.cross, 0.7));
}
function artCrew(a: Art): void {
  a.floor();
  for (const p of [
    [1, 0],
    [5, 0],
    [1, 4],
    [5, 4],
  ]) {
    a.rect(p[0], p[1], p[0] + 1, p[1] + 2, mul(C.blanket, 1.05));
    a.rect(p[0], p[1], p[0] + 1, p[1], C.sheet);
    a.set(p[0], p[1] + 2, mul(C.blanket, 0.75));
  }
  a.rect(3, 3, 4, 4, mul(C.wall, 0.42));
  a.set(3, 3, mul(C.hazY, 1.4));
  a.set(4, 4, mul(C.hazY, 0.9));
  a.set(3, 7, mul(C.wall, 0.5));
  a.set(4, 7, mul(C.wall, 0.5));
}
function artPod(a: Art): void {
  a.floor();
  // three capsules side by side: white body, orange band, a window at the top
  [1, 3, 5].forEach((x) => {
    a.rect(x, 1, x, 6, mul(C.sheet, 1.0));
    a.rect(x, 3, x, 3, mul(C.amber, 1.0));
    a.set(x, 1, mul(C.thruster, 1.2));
    a.set(x, 7, mul(C.stripe, 0.9));
  });
  a.set(7, 7, mul(C.stripe, 1.1));
}
function artStore(a: Art): void {
  a.floor();
  [
    [0, 0],
    [2, 0],
    [6, 0],
    [0, 3],
    [5, 3],
    [2, 6],
    [6, 6],
    [4, 6],
  ].forEach((p, i) => {
    const w = i % 3 === 1 ? 1 : 2;
    const h = 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(p[0] + x, p[1] + y, mul(C.crate, x === 0 && y === 0 ? 1.2 : x === w - 1 || y === h - 1 ? 0.72 : 0.95));
    a.set(p[0], p[1] + 1, mul(C.crate, 0.62));
  });
  a.set(3, 4, mul(C.module, 1.1));
  a.set(4, 3, mul(C.stripe, 0.9));
}
function artHelm(a: Art): void {
  a.floor();
  a.rect(1, 0, 6, 0, mul(C.thruster, 1.1));
  for (let s = 0; s < 4; s++) a.set(1 + Math.floor(hash2(s, 3, 7) * 6), 0, white(C.hull, 0.9));
  a.console(1, 1, 6, 2);
  a.rect(3, 4, 4, 5, mul(C.bridge, 1));
  a.chair(3, 5, 'up', mul(C.bridge, 1.25));
  a.chair(4, 5, 'up', mul(C.bridge, 1.25));
  a.set(0, 3, mul(C.wall, 0.55));
  a.set(7, 3, mul(C.wall, 0.55));
  a.set(2, 6, mul(C.engine, 0.9));
  a.set(5, 6, mul(C.module, 1.1));
}

// --- the three base modules scale with the room

function artCore(a: Art): void {
  const { iw, ih } = a;
  const cx = iw / 2;
  const cy = ih / 2;
  const R = Math.min(iw, ih) / 2;
  a.floor(C.antiDeep);
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
      const ang = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      if (d <= 0.28) a.set(x, y, mul(C.antiLight, 0.85 + 0.2 * Math.sin(ang * 6 + d * 8)));
      else if (d <= 0.5) a.set(x, y, Math.abs(Math.sin(ang * 8)) > 0.86 ? mul(C.thruster, 0.95) : mul(C.antiDeep, 0.9));
      else if (d <= 0.72) a.set(x, y, Math.sin(ang * 10 + d * 6) > 0 ? mul(C.anti, 1) : mul(C.antiMid, 0.9));
      else if (d <= 0.86 && R > 3.5) a.set(x, y, Math.floor((ang * 12) / 6.283 + d * 6) % 2 === 0 ? mul(C.antiDeep, 0.7) : mul(C.antiMid, 1.1));
    }
  }
  if (R >= 6) {
    a.console(1, 0, Math.min(iw - 2, 6), 1);
    a.console(Math.max(1, iw - 7), ih - 2, iw - 2, ih - 1);
    for (let p = 0; p < 4; p++) {
      const pa = (p * Math.PI) / 2 + Math.PI / 4;
      for (let r = R * 0.86; r < R * 1.2; r += 0.5) a.set(cx + Math.cos(pa) * r, cy + Math.sin(pa) * r, mul(C.anti, 0.7));
    }
  }
}
function artBridge(a: Art): void {
  const { iw, ih } = a;
  const vh = Math.max(1, Math.round(ih * 0.13));
  a.floor(mul(C.hull, 0.7));
  for (let y = 0; y < vh; y++) for (let x = 0; x < iw; x++) a.set(x, y, y === 0 ? mul(C.thruster, 1.15) : mul(C.shield, 0.6));
  for (let s = 0; s < iw * vh * 0.45; s++) a.set(Math.floor(hash2(s, 7, 301) * iw), Math.floor(hash2(s, 11, 302) * vh), white(C.hull, 0.9));
  const consoles = Math.max(1, Math.floor(iw / 8));
  const cw = Math.floor((iw - 2) / consoles);
  for (let c = 0; c < consoles; c++) a.console(1 + c * cw, vh, Math.min(iw - 2, c * cw + cw - 1), vh + 1);
  const cy = Math.min(ih - 3, Math.round(ih * 0.7));
  if (iw >= 16) {
    for (let k = 0; k < Math.max(1, Math.floor((ih - vh - 4) / 6)); k++) {
      const yy = vh + 4 + k * 6;
      if (yy + 2 >= ih) break;
      a.console(0, yy, 1, yy + 2);
      a.console(iw - 2, yy, iw - 1, yy + 2);
      a.chair(4, yy + 1, 'up');
      a.chair(iw - 5, yy + 1, 'up');
    }
  }
  const mid = Math.floor(iw / 2);
  a.rect(mid - 3, cy - 1, mid + 2, cy + 1, mul(C.hull, 1.18));
  a.chair(mid - 1, cy, 'up', mul(C.bridge, 1.25));
  a.chair(mid + 1, cy, 'up', mul(C.bridge, 1.25));
  a.rect(mid - 1, 0, mid, Math.min(ih - 1, vh + 1), mul(C.thruster, 0.55));
}
function artShield(a: Art): void {
  const { iw, ih } = a;
  const cx = iw / 2;
  const cy = ih / 2;
  const R = Math.min(iw, ih) / 2;
  a.floor();
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
      const ang = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      if (d <= 0.34) a.set(x, y, mul(white(C.shield, 0.35), 0.9 + 0.25 * Math.sin(ang * 5 + d * 9)));
      else if (d <= 0.58) a.set(x, y, Math.abs(Math.sin(ang * 6)) > 0.85 ? mul(C.thruster, 0.9) : mul(C.wall, 0.42));
      else if (d <= 0.72) a.set(x, y, mul(white(C.shield, 0.5), 0.8 + 0.2 * Math.sin(ang * 14)));
    }
  }
  for (let r = R * 0.72; r < R; r += 0.5) {
    a.set(cx, cy - r, mul(C.shield, 0.7));
    a.set(cx, cy + r, mul(C.shield, 0.7));
    a.set(cx - r, cy, mul(C.shield, 0.7));
    a.set(cx + r, cy, mul(C.shield, 0.7));
  }
  if (R >= 4) a.set(Math.floor(iw / 2) - 1, ih - 1, mul(C.shield, 1));
}
function artLadder(a: Art): void {
  a.floor(mul(C.hull, 0.42));
  for (let y = 0; y < 3; y++) {
    a.set(0, y, white(C.wall, 0.4));
    a.set(2, y, white(C.wall, 0.4));
  }
  a.set(1, 0, mul(C.amber, 0.95));
  a.set(1, 2, mul(C.amber, 0.95));
  a.set(1, 1, [8, 12, 18]);
}

const ARTS: Record<ModuleId | 'ladder', (a: Art) => void> = {
  gun: artGun,
  eng: artEng,
  rcs: artRcs,
  work: artWork,
  med: artMed,
  crew: artCrew,
  store: artStore,
  helm: artHelm,
  pod: artPod,
  core: artCore,
  bridge: artBridge,
  shield: artShield,
  ladder: artLadder,
};

const cache = new Map<string, Art>();
/** The inside of a room of this type and size (in tiles). A ladder's inside is 3×3. */
export function moduleArt(type: ModuleId | 'ladder', tw = 1, th = 1): Art {
  const key = `${type}:${tw}x${th}`;
  let a = cache.get(key);
  if (!a) {
    a = type === 'ladder' ? new Art(3, 3) : new Art(TILE * tw - 1, TILE * th - 1);
    ARTS[type](a);
    cache.set(key, a);
  }
  return a;
}

/** Size in cells of a module of this type and tile size, wall included. */
export function moduleCells(type: ModuleId | 'ladder', tw: number, th: number): [number, number] {
  return type === 'ladder' ? [5, 5] : [TILE * tw + 1, TILE * th + 1];
}

// --- colours of the plain parts of a deck

export function fieldColor(x: number, y: number): RGB {
  return hash2(x, y, 91) < 0.035 ? [16, 26, 34] : C.field;
}
export function corridorColor(x: number, y: number): RGB {
  return mul([38, 80, 102], (x % 4 === 0 || y % 4 === 0 ? 0.78 : 1) * (0.9 + 0.2 * hash2(Math.floor(x / 4), Math.floor(y / 4), 17)));
}
export function hullWallColor(x: number, y: number): RGB {
  return mul(white(C.wall, 0.2), (x + y) % 5 === 0 ? 0.72 : 0.9);
}
export function wallColor(x: number, y: number): RGB {
  return mul(C.wall, (x + y) % 5 === 0 ? 0.68 : 0.86);
}
export const DOOR_COLOR: RGB = C.door;

/** Every cell of a planned deck as RGBA (transparent outside the deck). */
export function paintDeck(plan: DeckPlan, w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  const put = (i: number, c: RGB): void => {
    px[i * 4] = c[0];
    px[i * 4 + 1] = c[1];
    px[i * 4 + 2] = c[2];
    px[i * 4 + 3] = 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      switch (plan.kind[i]) {
        case K.FIELD:
          put(i, fieldColor(x, y));
          break;
        case K.FLOOR:
          put(i, corridorColor(x, y));
          break;
        case K.HULL:
          put(i, hullWallColor(x, y));
          break;
        case K.MWALL:
        case K.FENCE:
          put(i, wallColor(x, y));
          break;
        case K.DOOR:
          put(i, DOOR_COLOR);
          break;
      }
    }
  }
  for (const e of plan.ents) {
    const art = moduleArt(e.type, e.tw, e.th);
    for (let yy = 0; yy < art.ih; yy++) {
      for (let xx = 0; xx < art.iw; xx++) {
        const ai = (yy * art.iw + xx) * 4;
        const idx = (e.r.y0 + 1 + yy) * w + e.r.x0 + 1 + xx;
        px[idx * 4] = art.px[ai];
        px[idx * 4 + 1] = art.px[ai + 1];
        px[idx * 4 + 2] = art.px[ai + 2];
        px[idx * 4 + 3] = 255;
      }
    }
  }
  return px;
}

/** The picture of a module with its wall, scaled up by `scale` — for the pool cards and the ghost under the cursor. */
export function moduleSprite(type: ModuleId | 'ladder', tw: number, th: number): { w: number; h: number; px: Uint8ClampedArray } {
  const [W, H] = moduleCells(type, tw, th);
  const art = moduleArt(type, tw, th);
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      const c = edge ? mul(C.wall, (x + y) % 5 === 0 ? 0.68 : 0.86) : null;
      if (c) {
        px[o] = c[0];
        px[o + 1] = c[1];
        px[o + 2] = c[2];
      } else {
        const ai = ((y - 1) * art.iw + (x - 1)) * 4;
        px[o] = art.px[ai];
        px[o + 1] = art.px[ai + 1];
        px[o + 2] = art.px[ai + 2];
      }
      px[o + 3] = 255;
    }
  }
  return { w: W, h: H, px };
}

