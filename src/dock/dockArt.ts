import { OUTER_VIEW, paintGrid } from '../render/shipView';
import type { ShipGrid } from '../sim/grid';
import { hash2 as hash } from '../sim/rng';

/**
 * The dock's art, ported from the approved design («Док Antimatter»): the player's ship
 * held in clamps at a berth inside a space station's hangar, seen from above like the
 * game. The hangar is sized to the ship; the station's decks fill the rest of the screen;
 * the hangar doors at the top open onto a strip of space behind a force field.
 */

type RGB = [number, number, number];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number): number => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mul = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const C = {
  void: hex(0x05060c),
  hull: hex(0x8c96a8),
  armor: hex(0x5d6b82),
  dark: hex(0x2a3144),
  wall: hex(0x3b4460),
  deck: hex(0x3e475e),
  floor: hex(0x0d1220),
  field: hex(0x59e6ff),
  hazY: hex(0xe8c450),
  hazD: hex(0x141416),
  warm: hex(0xffcf7a),
  lock: hex(0x63e07a),
  amber: hex(0xffb347),
  red: hex(0xff4a4a),
  anti: hex(0xff4fd8),
  antiDim: hex(0x5a1a58),
  cable: hex(0x241a33),
  channel: [34, 78, 96] as RGB,
  drone: hex(0x9aa4ba),
};

// ------------------------------------------------------------------ the ship picture

export interface DockSprite {
  w: number;
  h: number;
  /** views[0] is the ship from outside; views[1..] the hull layer and each deck (RGBA). */
  views: Uint8Array[];
  /** Per row, the first and last cell of the hull (−1 where the row is empty) — where the arms reach. */
  left: number[];
  right: number[];
}

/** Paints the ship exactly as the game draws it: from outside, then every layer (hull, decks). */
export function makeDockSprite(grid: ShipGrid): DockSprite {
  const w = grid.width;
  const h = grid.height;
  const views: Uint8Array[] = [];
  for (const layer of [OUTER_VIEW, ...Array.from({ length: grid.depth }, (_, z) => z)]) {
    const buf = new Uint8Array(w * h * 4);
    paintGrid(grid, buf, layer);
    views.push(buf);
  }
  const px = views[0];
  const left: number[] = [];
  const right: number[] = [];
  for (let y = 0; y < h; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 0) {
        if (l < 0) l = x;
        r = x;
      }
    }
    left.push(l);
    right.push(r);
  }
  return { w, h, views, left, right };
}

// ------------------------------------------------------------------ layout

export interface DockLayout {
  W: number;
  H: number;
  m: number;
  side: number;
  bx: number;
  by: number;
  bayW: number;
  bayH: number;
  /** Where the ship sits in its clamps. */
  sx: number;
  sy: number;
  door: { x0: number; x1: number };
  pipeTop: number;
  pipeBot: number;
  pipeL: number;
  pipeR: number;
}

/**
 * The hangar around one ship, stretched to the screen's aspect: a sunk berth with room
 * for the clamp arms, station decks around it. Portrait keeps the ship a third of the way
 * down, clear of the panel stacked at the bottom.
 */
export function dockLayout(shipW: number, shipH: number, aspect: number, portrait: boolean): DockLayout {
  const m = Math.round(Math.max(10, 0.16 * Math.max(shipW, shipH)));
  const side = m + 8;
  const bayW = shipW + 2 * side;
  const bayH = shipH + 2 * m;
  const t = Math.max(16, Math.round(0.2 * Math.max(bayW, bayH)));
  let W = bayW + 2 * t;
  let H = bayH + 2 * t;
  if (W / H < aspect) W = Math.ceil(H * aspect);
  else H = Math.ceil(W / aspect);
  const bx = Math.floor((W - bayW) / 2);
  const by = portrait ? Math.max(0, Math.min(H - bayH, Math.round(0.34 * H - m - shipH / 2))) : Math.floor((H - bayH) / 2);
  const dw = Math.round(bayW * 0.62);
  const dx0 = bx + Math.floor((bayW - dw) / 2);
  return {
    W,
    H,
    m,
    side,
    bx,
    by,
    bayW,
    bayH,
    sx: bx + side,
    sy: by + m,
    door: { x0: dx0, x1: dx0 + dw },
    pipeTop: Math.max(4, Math.floor(by / 2)),
    pipeBot: by + bayH + Math.max(4, Math.floor((H - by - bayH) / 2)),
    pipeL: Math.max(4, Math.floor(bx / 2)),
    pipeR: bx + bayW + Math.max(4, Math.floor((W - bx - bayW) / 2)),
  };
}

function pipeColor(along: number, across: number): RGB | null {
  const ad = Math.abs(across + 0.5);
  if (ad > 2.6) return null;
  if (ad <= 0.6) return C.channel;
  let c = mul(C.armor, 0.8 + 0.3 * (1 - (across + 2.6) / 5.2));
  if (ad > 1.9) c = C.dark;
  if ((((along % 16) + 16) % 16) < 2) c = mul(C.hull, 1.05);
  return c;
}

// ------------------------------------------------------------------ the static hangar

export interface DockBase {
  base: Float32Array;
  glow: Float32Array;
  /** Rim light positions (pixel index + order) for the chasing lights. */
  lamps: Array<{ i: number; n: number }>;
  beacons: Array<[number, number]>;
}

/** Decks, the berth floor with its markings, the rim, the door opening and the strip of space. */
export function buildDockBase(L: DockLayout, shipW: number, shipH: number): DockBase {
  const W = L.W;
  const H = L.H;
  const base = new Float32Array(W * H * 3);
  const glow = new Float32Array(W * H * 3);
  const lamps: Array<{ i: number; n: number }> = [];
  const bx0 = L.bx;
  const by0 = L.by;
  const bx1 = L.bx + L.bayW;
  const by1 = L.by + L.bayH;
  const dl = Math.max(3, Math.min(10, Math.round(L.bayW * 0.06)));
  const put = (i: number, c: RGB, g: RGB | null) => {
    base[i * 3] = c[0];
    base[i * 3 + 1] = c[1];
    base[i * 3 + 2] = c[2];
    if (g) {
      glow[i * 3] = g[0];
      glow[i * 3 + 1] = g[1];
      glow[i * 3 + 2] = g[2];
    }
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // outside, through the open doors: a strip of space with a faint violet haze
      if (x >= L.door.x0 && x < L.door.x1 && y < by0) {
        const hz = 0.5 + 0.25 * Math.sin(x * 0.09 + y * 0.03) + 0.25 * Math.sin(y * 0.11 - x * 0.04);
        let c: RGB = C.void;
        if (hz + bayer(x, y) * 0.4 > 1.08) c = [26, 12, 46];
        if (hash(x, y, 5) < 0.02) c = mix([160, 170, 210], [255, 255, 255], hash(x, y, 6));
        put(i, c, null);
        continue;
      }
      // the berth floor: plates, a faint grid, the landing frame, chevrons to the doors
      if (x >= bx0 && x < bx1 && y >= by0 && y < by1) {
        const fx = x - bx0;
        const fy = y - by0;
        let c = mul(C.floor, 0.85 + 0.25 * hash(Math.floor(fx / 8), Math.floor(fy / 8), 21));
        if (fx % 8 === 0 || fy % 8 === 0) c = mul(C.floor, 0.75);
        if (fx % 16 === 0 || fy % 16 === 0) c = mix(c, C.field, 0.1);
        const lx0 = L.sx - 3;
        const ly0 = L.sy - 3;
        const lx1 = L.sx + shipW + 2;
        const ly1 = L.sy + shipH + 2;
        const onX = (x === lx0 || x === lx1) && y >= ly0 && y <= ly1;
        const onY = (y === ly0 || y === ly1) && x >= lx0 && x <= lx1;
        if (onX || onY) {
          const near = Math.min(Math.abs(x - lx0), Math.abs(x - lx1)) < 5 && Math.min(Math.abs(y - ly0), Math.abs(y - ly1)) < 5;
          if (near) c = C.hazY;
          else if ((x + y) % 5 < 3) c = mul(C.hazY, 0.42);
        }
        const cx = L.sx + Math.floor(shipW / 2);
        if (y > by0 + 2 && y < L.sy - 4) {
          const k = (y - by0) % 7;
          const dx = Math.abs(x - cx);
          if (dx <= 4 && dx === k) c = mix(c, C.field, 0.45);
        }
        put(i, c, null);
        continue;
      }
      // the rim: three pixels round the berth — lip, hazard stripes, raised edge
      const dRim = Math.max(x < bx0 ? bx0 - x : x >= bx1 ? x - bx1 + 1 : 0, y < by0 ? by0 - y : y >= by1 ? y - by1 + 1 : 0);
      if (dRim >= 1 && dRim <= 3 && x >= bx0 - 3 && x < bx1 + 3 && y >= by0 - 3 && y < by1 + 3) {
        const c = dRim === 1 ? mul(C.dark, 0.8) : dRim === 2 ? (((x + y) >> 1) & 1 ? C.hazY : C.hazD) : mul(C.hull, 1.08);
        put(i, c, null);
        if (dRim === 2 && (x + y) % 9 === 0) lamps.push({ i, n: lamps.length });
        continue;
      }
      // the door leaves, pulled back into the wall either side of the opening
      if (y < by0 && y >= Math.max(0, by0 - Math.min(by0, 26)) && ((x >= L.door.x0 - dl && x < L.door.x0) || (x >= L.door.x1 && x < L.door.x1 + dl))) {
        let c = mul(C.wall, (x + y) % 4 === 0 ? 1.1 : 0.9);
        if (x === L.door.x0 - 1 || x === L.door.x1) c = (y >> 1) & 1 ? C.hazY : C.hazD;
        put(i, c, null);
        continue;
      }
      // station decks: plates, rivets, vents, lit skylights, status lights, service pipes
      const px0 = Math.floor(x / 10);
      const py0 = Math.floor(y / 10);
      const hsh = hash(px0, py0, 31);
      let c = mul(C.deck, 0.82 + 0.3 * hash(px0, py0, 32));
      let g: RGB | null = null;
      if (x % 10 === 0 || y % 10 === 0) c = mul(C.deck, 0.62);
      if ((x % 10 === 2 || x % 10 === 8) && (y % 10 === 2 || y % 10 === 8) && hash(px0, py0, 33) < 0.5) c = mul(C.hull, 1.1);
      if (hsh < 0.07 && x % 10 > 1 && x % 10 < 9 && y % 10 > 1 && y % 10 < 9) c = y % 2 === 0 ? mul(C.dark, 0.7) : mul(C.deck, 0.5);
      else if (hsh < 0.12 && x % 10 > 2 && x % 10 < 8 && y % 10 > 3 && y % 10 < 7) {
        c = mul(C.warm, 0.7 + 0.3 * hash(x, y, 34));
        g = mul(C.warm, 0.55);
      } else if (hsh > 0.97 && x % 10 === 5 && y % 10 === 5) {
        c = hash(px0, py0, 35) < 0.5 ? C.field : C.amber;
        g = c;
      }
      let pc: RGB | null = null;
      if (y < by0 - 4 || y > by1 + 3) pc = pipeColor(x, y + 0.5 - (y < by0 ? L.pipeTop : L.pipeBot));
      if (!pc && (x < bx0 - 4 || x > bx1 + 3)) pc = pipeColor(y, x + 0.5 - (x < bx0 ? L.pipeL : L.pipeR));
      if (pc) {
        c = pc;
        g = null;
      }
      put(i, c, g);
    }
  }
  const beacons: Array<[number, number]> = [
    [bx0 - 2, by0 - 2],
    [bx1 + 1, by0 - 2],
    [bx0 - 2, by1 + 1],
    [bx1 + 1, by1 + 1],
  ];
  return { base, glow, lamps, beacons };
}

// ------------------------------------------------------------------ a frame

export interface DockFrame {
  /** Seconds, for the lights and the drones. */
  t: number;
  /** Where the ship's top edge is right now (moves when it leaves or arrives). */
  shipY: number;
  /** 0..1: how far the clamps, the tube and the fuel line reach the hull. */
  e: number;
  /** The ship is locked in (drones out, fuel flowing). */
  docked: boolean;
  /** Which picture of the ship: 0 outside, 1 hull, 2.. decks. */
  layer: number;
}

/** Draws one frame: crisp pixels into `img`, what glows into `glow`. */
export function renderDock(L: DockLayout, B: DockBase, s: DockSprite, f: DockFrame, img: ImageData, glowImg: ImageData): void {
  const W = L.W;
  const H = L.H;
  const t = f.t;
  const e = f.e;
  const d = img.data;
  const g = glowImg.data;
  const base = B.base;
  const bg = B.glow;
  for (let i = 0, n = W * H; i < n; i++) {
    const o = i * 4;
    d[o] = base[i * 3];
    d[o + 1] = base[i * 3 + 1];
    d[o + 2] = base[i * 3 + 2];
    d[o + 3] = 255;
    g[o] = bg[i * 3];
    g[o + 1] = bg[i * 3 + 1];
    g[o + 2] = bg[i * 3 + 2];
    g[o + 3] = bg[i * 3] + bg[i * 3 + 1] + bg[i * 3 + 2] > 0 ? 255 : 0;
  }
  const set = (x: number, y: number, c: RGB, em?: RGB | null) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
    if (em) {
      g[o] = em[0];
      g[o + 1] = em[1];
      g[o + 2] = em[2];
      g[o + 3] = 255;
    }
  };
  const darken = (x: number, y: number, k: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    d[o] *= k;
    d[o + 1] *= k;
    d[o + 2] *= k;
  };

  // force field across the open doors
  for (let fx = L.door.x0; fx < L.door.x1; fx++) {
    for (let fy = L.by - 2; fy < L.by; fy++) {
      const sh = 0.45 + 0.3 * Math.sin(fx * 0.55 - t * 6 + fy) + 0.2 * Math.sin(fx * 0.21 + t * 3.3);
      set(fx, fy, mix(C.void, C.field, Math.max(0.15, sh)), mul(C.field, Math.max(0, sh)));
    }
  }
  // chasing rim lights, blinking corner beacons
  for (const l of B.lamps) {
    const ph = (((l.n - t * 9) % 14) + 14) % 14;
    if (ph < 2.5) {
      const x = l.i % W;
      const c = mix(C.field, [255, 255, 255], 0.2);
      set(x, (l.i - x) / W, c, c);
    }
  }
  if (Math.sin(t * 3.2) > 0.6) for (const [px, py] of B.beacons) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) set(px + a, py + b, C.red, C.red);

  const sx = L.sx;
  const sy = Math.round(f.shipY);
  const px = s.views[0];
  // the ship's shadow on the berth floor
  const so = Math.max(3, Math.round(Math.max(s.w, s.h) * 0.03) + 2);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (px[(y * s.w + x) * 4 + 3] > 0) darken(sx + x + so, sy + y + so, 0.45);

  // clamp arms, the boarding tube and the fuel line reach the hull as e goes 0→1
  const edgeRow = (r: number, side: number) => {
    const a = side < 0 ? s.left : s.right;
    for (let k = 0; k < 8; k++) {
      if (a[r + k] >= 0) return { r: r + k, x: a[r + k] };
      if (r - k >= 0 && a[r - k] >= 0) return { r: r - k, x: a[r - k] };
    }
    return { r, x: side < 0 ? 0 : s.w - 1 };
  };
  const arm = (row: number, side: number) => {
    const hit = edgeRow(row, side);
    const yc = sy + hit.r;
    const wall = side < 0 ? L.bx - 3 : L.bx + L.bayW + 2;
    const hull = side < 0 ? sx + hit.x - 1 : sx + hit.x + 1;
    const end = wall + (hull - wall) * e;
    const len = Math.abs(end - wall);
    for (let k = 0; k <= len; k++) {
      const x = wall - side * k;
      set(x, yc - 1, mul(C.hull, 1.15));
      set(x, yc, k % 5 === 0 ? mul(C.armor, 0.7) : C.armor);
      set(x, yc + 1, k % 5 === 0 ? mul(C.armor, 0.6) : mul(C.armor, 0.85));
      set(x, yc + 2, C.dark);
    }
    if (len > 8) {
      const jx = wall - side * Math.round(len / 2);
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 3; b++) set(jx + a, yc + b, b === -2 ? mul(C.hull, 1.2) : mul(C.dark, 1.1));
      set(jx, yc, C.hull);
    }
    for (let py = -2; py <= 3; py++) for (let q = 0; q < 2; q++) set(end - side * q, yc + py, mul(C.dark, 1.2));
    const lamp = e >= 1 ? C.lock : Math.sin(t * 10) > 0 ? C.amber : mul(C.amber, 0.4);
    set(end, yc, lamp, lamp);
    set(end, yc + 1, lamp, lamp);
  };
  const tube = (row: number) => {
    const hit = edgeRow(row, 1);
    const yc = sy + hit.r;
    const wall = L.bx + L.bayW + 2;
    const end = wall + (sx + hit.x + 1 - wall) * e;
    const len = wall - end;
    for (let k = 0; k <= len; k++) {
      const x = wall - k;
      set(x, yc - 3, mul(C.hull, 1.15));
      set(x, yc + 3, C.dark);
      for (let r = -2; r <= 2; r++) set(x, yc + r, mul(C.wall, 0.75));
      if (k % 3 === 1) {
        set(x, yc - 2, mul(C.warm, 0.85), mul(C.warm, 0.6));
        set(x, yc + 2, mul(C.warm, 0.85), mul(C.warm, 0.6));
      }
    }
    for (let r = -3; r <= 3; r++) {
      set(end, yc + r, mul(C.hull, 1.2));
      set(end + 1, yc + r, mul(C.hull, 0.95));
    }
  };
  const fuel = (row: number) => {
    const hit = edgeRow(row, -1);
    const yc = sy + hit.r;
    const wall = L.bx - 3;
    for (let a = -2; a <= 2; a++) for (let b = 0; b < 3; b++) set(wall + b, yc + a, a === 0 && b === 1 ? C.anti : mul(C.dark, 1.1), a === 0 && b === 1 ? C.anti : null);
    const end = wall + 3 + (sx + hit.x - 1 - wall - 3) * e;
    const len = end - (wall + 3);
    for (let k = 0; k <= len; k++) {
      set(wall + 3 + k, yc, C.cable);
      set(wall + 3 + k, yc + 1, mul(C.cable, 0.7));
    }
    if (e >= 1) {
      for (let q = 0; q < Math.max(2, Math.floor(len / 7)); q++) {
        const p = (t * 22 + q * 7) % Math.max(1, len);
        set(wall + 3 + p, yc, C.anti, C.anti);
        set(wall + 2 + p, yc, C.antiDim, mul(C.anti, 0.5));
      }
    }
  };
  const big = s.h > 120;
  for (const r of big ? [0.2, 0.64, 0.8] : [0.22, 0.78]) {
    arm(Math.round(s.h * r), -1);
    arm(Math.round(s.h * r), 1);
  }
  tube(Math.round(s.h * (big ? 0.36 : 0.5)));
  fuel(Math.round(s.h * (big ? 0.36 : 0.5)));

  // the ship: from outside, or one layer of it over a dimmed silhouette of the hull
  const lay = s.views[Math.min(f.layer, s.views.length - 1)];
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const o2 = (y * s.w + x) * 4;
      if (px[o2 + 3] === 0) continue;
      const X = sx + x;
      const Y = sy + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const oo = (Y * W + X) * 4;
      if (lay[o2 + 3] > 0) {
        d[oo] = lay[o2];
        d[oo + 1] = lay[o2 + 1];
        d[oo + 2] = lay[o2 + 2];
      } else {
        d[oo] = px[o2] * 0.28;
        d[oo + 1] = px[o2 + 1] * 0.28;
        d[oo + 2] = px[o2 + 2] * 0.3;
      }
      g[oo + 3] = 0;
    }
  }
  // maintenance drones circling the ship once it's locked in
  if (f.docked) {
    for (let n = 0; n < 3; n++) {
      const ang = t * (0.35 + n * 0.12) + n * 2.1;
      const dxp = sx + s.w / 2 + Math.cos(ang) * (s.w / 2 + L.side * 0.65);
      const dyp = sy + s.h / 2 + Math.sin(ang) * (s.h / 2 + L.m * 0.55);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) darken(Math.round(dxp) + a + 2, Math.round(dyp) + b + 2, 0.55);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) set(dxp + a, dyp + b, a === 0 && b === 0 ? mul(C.dark, 1.2) : a === -1 || b === -1 ? mul(C.drone, 1.15) : C.drone);
      const on = Math.sin(t * 6 + n) > 0;
      const lc = on ? (n % 2 ? C.lock : C.red) : C.dark;
      set(dxp, dyp - 1, lc, on ? lc : null);
    }
  }
}
