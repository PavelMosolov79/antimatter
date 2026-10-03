/**
 * What the modules look like from above: every module has a floor of its own colour and one big thing
 * that says what it is (a rack of missiles for the guns, beds with red crosses for the medical bay, crates
 * for the store, a glowing sphere for the core). Each is drawn on a 64×64 sheet that covers the 8×8 cells
 * of the room inside (8 pixels to a cell), props lying on the tiled floor with shadows to the lower right.
 * The same drawings are in the concept document ("Модули и системы").
 */

const OUT = '#141a26';
const SIZE = 64;

type Rgb = [number, number, number];
const parse = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function hx(c: Rgb): string {
  const t = (v: number): string => {
    const n = Math.max(0, Math.min(255, Math.round(v)));
    return (n < 16 ? '0' : '') + n.toString(16);
  };
  return '#' + t(c[0]) + t(c[1]) + t(c[2]);
}
/** f < 1 darker, f > 1 lighter (towards white). */
function sh(col: string, f: number): string {
  const c = parse(col);
  if (f <= 1) return hx([c[0] * f, c[1] * f, c[2] * f]);
  const k = f - 1;
  return hx([c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k]);
}
function rnd(x: number, y: number, s = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

class Pen {
  readonly c = document.createElement('canvas');
  readonly g: CanvasRenderingContext2D;
  constructor() {
    this.c.width = this.c.height = SIZE;
    this.g = this.c.getContext('2d')!;
    this.g.imageSmoothingEnabled = false;
  }
  r(x: number, y: number, w: number, h: number, col: string): this {
    this.g.fillStyle = col;
    this.g.fillRect(x, y, w, h);
    return this;
  }
  p(x: number, y: number, col: string): this {
    return this.r(x, y, 1, 1, col);
  }
  /** an object's shadow: a dark rectangle moved down and to the right */
  shadow(x: number, y: number, w: number, h: number): this {
    return this.r(x + 2, y + 2, w, h, 'rgba(0,0,0,0.30)');
  }
  /** an outlined object with its shadow, lit from the upper left */
  box(x: number, y: number, w: number, h: number, fill: string, hi?: string, lo?: string): this {
    this.shadow(x, y, w, h);
    this.r(x, y, w, h, OUT).r(x + 1, y + 1, w - 2, h - 2, fill);
    this.r(x + 1, y + 1, w - 2, 1, hi || sh(fill, 1.28)).r(x + 1, y + 1, 1, h - 2, hi || sh(fill, 1.28));
    this.r(x + 1, y + h - 2, w - 2, 1, lo || sh(fill, 0.7)).r(x + w - 2, y + 1, 1, h - 2, lo || sh(fill, 0.7));
    return this;
  }
  disc(cx: number, cy: number, rad: number, fill: string, out?: string | false, noShadow = false): this {
    if (!noShadow && out !== false) {
      for (let yy = Math.floor(cy - rad); yy <= Math.ceil(cy + rad); yy++) for (let xx = Math.floor(cx - rad); xx <= Math.ceil(cx + rad); xx++) if (Math.hypot(xx + 0.5 - cx - 2, yy + 0.5 - cy - 2) <= rad + 1) this.p(xx, yy, 'rgba(0,0,0,0.30)');
    }
    for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++) {
      for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= rad) this.p(x, y, fill);
        else if (d <= rad + 1 && out !== false) this.p(x, y, out || OUT);
      }
    }
    return this;
  }
  ring(cx: number, cy: number, rad: number, th: number, col: string): this {
    for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++) {
      for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= rad && d > rad - th) this.p(x, y, col);
      }
    }
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, col: string): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.p(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), col);
    return this;
  }
}

/** Whether the sheet carries its own wall round the edge (the document's picture does; in the game the walls are cells). */
let frame = false;

/** A room from above: a tiled floor of its own colour, and, in the document's picture, a wall round it with lamps. */
function room(P: Pen, floorCol: string, wallCol: string): void {
  P.r(0, 0, 64, 64, floorCol);
  for (let y = 0; y < 64; y += 8) {
    for (let x = 0; x < 64; x += 8) {
      const t = rnd(x / 8, y / 8, 3) * 0.12 - 0.04;
      P.r(x, y, 8, 8, sh(floorCol, 1 + t));
      P.r(x, y, 8, 1, sh(floorCol, 0.84));
      P.r(x, y, 1, 8, sh(floorCol, 0.84));
    }
  }
  if (!frame) return;
  P.r(0, 0, 64, 5, wallCol).r(0, 59, 64, 5, wallCol).r(0, 0, 4, 64, wallCol).r(60, 0, 4, 64, wallCol);
  P.r(0, 4, 64, 1, OUT).r(4, 5, 56, 1, sh(wallCol, 0.55));
  P.r(4, 58, 56, 1, sh(wallCol, 0.55)).r(3, 5, 1, 54, sh(wallCol, 0.55)).r(60, 5, 1, 54, sh(wallCol, 0.55));
  P.r(0, 0, 64, 1, sh(wallCol, 1.3)).r(0, 0, 1, 64, sh(wallCol, 1.3));
  P.r(0, 63, 64, 1, OUT).r(63, 0, 1, 64, OUT);
  for (let i = 0; i < 4; i++) P.r(12 + i * 14, 1, 6, 2, '#fff3b0');
}
function hazard(P: Pen, x: number, y: number, w: number, h: number): void {
  for (let xx = x; xx < x + w; xx += 4) {
    P.r(xx, y, 2, h, '#f6c445');
    P.r(xx + 2, y, 2, h, OUT);
  }
}
/** a chair seen from above: round seat, the back on the south side, armrests */
function chair(P: Pen, cx: number, cy: number, col: string, back?: string): void {
  P.r(cx - 5, cy - 1, 2, 5, OUT).r(cx + 4, cy - 1, 2, 5, OUT);
  P.shadow(cx - 4, cy - 4, 9, 9);
  P.r(cx - 5, cy + 3, 11, 4, OUT).r(cx - 4, cy + 4, 9, 2, back || sh(col, 0.65));
  P.disc(cx + 0.5, cy + 0.5, 4, col, OUT, true).disc(cx, cy, 2, sh(col, 1.25), false, true);
}
/** a console against the wall: the case, lit screens, buttons */
function desk(P: Pen, x: number, y: number, w: number, h: number, screens?: number): void {
  P.box(x, y, w, h, '#4a5368');
  const n = screens || Math.floor((w - 2) / 7);
  for (let i = 0; i < n; i++) {
    const sx = x + 2 + Math.floor(((w - 4) * i) / n);
    const sw = Math.floor((w - 4) / n) - 1;
    const col = ['#58d4ff', '#58f2a0', '#f6c445'][i % 3];
    P.r(sx, y + 2, sw, 4, '#0b1a28').r(sx + 1, y + 3, Math.max(1, sw - 2), 2, col);
  }
  for (let b = 0; b < Math.floor((w - 4) / 3); b++) P.p(x + 2 + b * 3, y + h - 3, ['#e23b3b', '#f6c445', '#58f2a0', '#58d4ff'][b % 4]);
}
/** a bed from above: frame, pillow, blanket */
function bed(P: Pen, x: number, y: number, w: number, h: number, blanket: string, cross: boolean): void {
  P.box(x, y, w, h, '#d9dee8', '#ffffff', '#aab1c0');
  P.r(x + 2, y + 2, w - 4, 6, '#ffffff').r(x + 2, y + 7, w - 4, 1, '#c9d0d8');
  P.r(x + 1, y + 9, w - 2, h - 10, blanket).r(x + 1, y + 9, w - 2, 1, sh(blanket, 1.35)).r(x + 1, y + 12, w - 2, 1, sh(blanket, 0.8));
  if (cross) {
    const cx = x + Math.floor(w / 2);
    const cy = y + 9 + Math.floor((h - 10) / 2);
    P.r(cx - 3, cy - 1, 7, 3, '#ffffff').r(cx - 1, cy - 3, 3, 7, '#ffffff').r(cx - 2, cy, 5, 1, '#e23b3b').r(cx, cy - 2, 1, 5, '#e23b3b');
  }
}
/** a crate from above: planks, a cross brace, corner pieces */
function crate(P: Pen, x: number, y: number, w: number, h: number, tone?: string): void {
  const c = tone || '#b07a3c';
  P.shadow(x, y, w, h);
  P.r(x, y, w, h, OUT).r(x + 1, y + 1, w - 2, h - 2, c);
  for (let yy = y + 4; yy < y + h - 2; yy += 4) P.r(x + 1, yy, w - 2, 1, sh(c, 0.76));
  P.line(x + 2, y + 2, x + w - 3, y + h - 3, sh(c, 0.6)).line(x + w - 3, y + 2, x + 2, y + h - 3, sh(c, 0.6));
  P.r(x + 1, y + 1, w - 2, 1, sh(c, 1.3)).r(x + 1, y + 1, 1, h - 2, sh(c, 1.3));
  for (const q of [[x + 1, y + 1], [x + w - 3, y + 1], [x + 1, y + h - 3], [x + w - 3, y + h - 3]]) P.r(q[0], q[1], 2, 2, '#9aa0b0');
}
/** a barrel or cylinder from above */
function barrel(P: Pen, cx: number, cy: number, rad: number, col: string): void {
  P.disc(cx, cy, rad, col).ring(cx, cy, rad - 1, 1, sh(col, 1.3)).ring(cx, cy, rad - 3, 1, sh(col, 0.7)).disc(cx, cy, 1, sh(col, 0.55), false, true);
}
function missile(P: Pen, x: number, y: number, len: number): void {
  P.shadow(x, y, len + 5, 6);
  P.r(x, y, len, 6, OUT).r(x + 1, y + 1, len - 2, 4, '#d8403e').r(x + 1, y + 1, len - 2, 1, '#ff8a80').r(x + 1, y + 4, len - 2, 1, '#8c2224');
  P.r(x + 5, y + 1, 2, 4, '#f4f1ea').r(x + 10, y + 1, 2, 4, '#f4f1ea');
  P.r(x + len, y + 1, 2, 4, OUT).r(x + len, y + 2, 1, 2, '#9aa0b0').p(x + len + 1, y + 2, '#f6c445');
  P.r(x - 1, y - 1, 3, 2, OUT).r(x - 1, y + 5, 3, 2, OUT);
}
function gauge(P: Pen, cx: number, cy: number): void {
  P.disc(cx, cy, 3, '#e9eef8').p(cx, cy, '#e23b3b').line(cx, cy, cx + 1, cy - 2, '#e23b3b');
}

// ------------------------------------------------------------------ the modules

/** Guns: a rack of missiles and the gunner's console. */
function gun(): Pen {
  const P = new Pen();
  room(P, '#6a2a36', '#8f3a48');
  P.box(6, 9, 36, 31, '#3b3f4d');
  for (let i = 0; i < 3; i++) {
    P.r(7, 10 + i * 10, 34, 1, '#6b6f7c');
    missile(P, 9, 13 + i * 9, 24);
  }
  P.box(44, 8, 14, 11, '#4a5368').r(46, 10, 10, 6, '#0b1a28').ring(51, 13, 3, 1, '#58f2a0').r(51, 10, 1, 6, '#58f2a0').r(46, 13, 10, 1, '#58f2a0');
  P.r(46, 17, 2, 1, '#e23b3b').r(50, 17, 2, 1, '#f6c445').r(54, 17, 2, 1, '#58d4ff');
  chair(P, 51, 28, '#9a2f40');
  crate(P, 8, 44, 14, 10, '#58633a');
  P.r(14, 44, 2, 10, '#f6c445');
  hazard(P, 28, 52, 30, 3);
  return P;
}

/** Engineering: tanks, pipes, the drive block. */
function eng(): Pen {
  const P = new Pen();
  room(P, '#1f3a6e', '#3b5fa8');
  for (let i = 0; i < 2; i++) {
    const y = 9 + i * 15;
    P.box(6, y, 26, 12, '#3b82d8');
    for (let x = 10; x < 30; x += 6) P.r(x, y + 1, 1, 10, '#2a5fae');
    P.r(7, y + 2, 24, 2, '#7fb8ff').disc(27, y + 6, 3, '#f6c445').p(27, y + 6, '#fff3b0');
  }
  P.r(32, 15, 12, 3, OUT).r(32, 15, 12, 1, '#aab4c8').r(32, 30, 12, 3, OUT).r(32, 30, 12, 1, '#aab4c8');
  P.r(42, 15, 3, 18, OUT).r(42, 15, 1, 18, '#aab4c8');
  P.box(44, 8, 14, 28, '#6a7388');
  for (let k = 0; k < 4; k++) P.r(47, 11 + k * 6, 8, 4, '#2a3144').r(48, 12 + k * 6, 6, 2, k % 2 ? '#ffd36b' : '#ff9a2e');
  gauge(P, 12, 7);
  gauge(P, 20, 7);
  gauge(P, 28, 7);
  desk(P, 8, 43, 30, 9, 4);
  chair(P, 22, 56, '#2a5fae');
  hazard(P, 42, 52, 16, 3);
  return P;
}

/** Manoeuvring: a gyroscope, thruster pods in the corners. */
function rcs(): Pen {
  const P = new Pen();
  room(P, '#145960', '#2a8d99');
  for (const q of [[7, 8], [50, 8], [7, 46], [50, 46]]) P.box(q[0], q[1], 8, 9, '#8a94a8').r(q[0] + 1, q[1] + 3, 6, 3, OUT).r(q[0] + 2, q[1] + 4, 4, 1, '#58e6ff');
  P.disc(32, 28, 15, '#0e3f48').ring(32, 28, 15, 2, '#8fdcea').ring(32, 28, 11, 1, '#58e6ff').ring(32, 28, 7, 1, '#2a8fa0');
  P.r(17, 28, 31, 1, '#58e6ff').r(32, 13, 1, 31, '#58e6ff');
  P.disc(32, 28, 4, '#ffd36b', false, true).disc(32, 28, 2, '#ffffff', false, true);
  P.box(12, 47, 18, 7, '#37505a').disc(18, 49, 2, '#e23b3b').r(23, 50, 5, 2, '#58f2a0');
  P.box(36, 47, 18, 7, '#37505a').r(38, 49, 3, 3, '#f6c445').r(43, 49, 3, 3, '#58d4ff').r(48, 49, 3, 3, '#e23b3b');
  return P;
}

/** Workshop: a bench with tools, a lathe, a welder throwing sparks. */
function work(): Pen {
  const P = new Pen();
  room(P, '#4d4a44', '#7a756a');
  P.box(8, 8, 34, 11, '#9a6a34', '#c58a4b', '#6e4a22');
  P.r(10, 11, 12, 2, '#cfd5e2').disc(10, 12, 2, '#cfd5e2', false, true).p(10, 12, '#6e4a22');
  P.r(25, 10, 2, 7, '#7b4a22').r(23, 10, 6, 3, '#aab4c8');
  P.box(32, 10, 8, 7, '#d8403e').r(33, 12, 6, 1, '#8c2224');
  P.box(46, 8, 12, 24, '#c9a018').r(48, 11, 8, 18, '#3b3f4d').r(50, 14, 4, 12, '#aab4c8').r(51, 16, 2, 8, '#58d4ff');
  hazard(P, 46, 33, 12, 2);
  P.disc(20, 32, 5, '#6a7388').disc(20, 32, 2, '#3b3f4d', false, true);
  P.line(20, 32, 29, 40, OUT).line(21, 32, 30, 40, '#8a94a8');
  P.disc(31, 42, 3, '#f6c445', false, true).p(31, 42, '#ffffff');
  for (const s of [[34, 40], [28, 45], [35, 46], [32, 38], [37, 43]]) P.p(s[0], s[1], '#fff3b0');
  P.disc(12, 46, 5, '#3b3f4d', false);
  for (let a = 0; a < 8; a++) {
    const an = (a * Math.PI) / 4;
    P.r(Math.round(12 + Math.cos(an) * 6) - 1, Math.round(46 + Math.sin(an) * 6) - 1, 3, 3, '#3b3f4d');
  }
  P.disc(12, 46, 2, '#4d4a44', false, true);
  P.box(40, 44, 16, 11, '#d8403e').r(41, 48, 14, 1, '#8c2224').r(46, 42, 4, 2, '#cfd5e2');
  return P;
}

/** Medical bay: two beds with red crosses, a drip, a monitor, cabinets. */
function med(): Pen {
  const P = new Pen();
  room(P, '#c7d8e2', '#e6eef4');
  P.r(25, 46, 14, 5, '#ffffff').r(29, 42, 6, 13, '#ffffff').r(26, 47, 12, 3, '#e23b3b').r(30, 43, 4, 11, '#e23b3b');
  bed(P, 8, 10, 17, 30, '#3b82d8', true);
  bed(P, 39, 10, 17, 30, '#3b82d8', true);
  P.disc(32, 18, 2, '#8a94a8').r(32, 18, 1, 8, '#8a94a8').box(29, 11, 6, 5, '#e8f4ff').r(30, 13, 4, 2, '#58d4ff');
  P.box(28, 28, 8, 8, '#252b3c', '#3b4358').r(29, 29, 6, 6, '#10281f').line(29, 33, 31, 33, '#58f2a0').line(31, 33, 32, 30, '#58f2a0').line(32, 30, 33, 34, '#58f2a0').line(33, 34, 34, 33, '#58f2a0');
  P.box(6, 45, 12, 10, '#e8f1f7').r(8, 47, 3, 3, '#e23b3b').r(12, 47, 3, 3, '#58d4ff').r(8, 51, 3, 2, '#f6c445').r(12, 51, 3, 2, '#58f2a0');
  P.box(46, 45, 12, 10, '#e8f1f7').r(50, 47, 4, 1, '#e23b3b').r(52, 46, 1, 5, '#e23b3b');
  return P;
}

/** Crew quarters: four bunks and a table. */
function crew(): Pen {
  const P = new Pen();
  room(P, '#245a3c', '#3d8a5c');
  bed(P, 7, 8, 14, 24, '#4f86d8', false);
  bed(P, 43, 8, 14, 24, '#4f86d8', false);
  bed(P, 7, 36, 14, 21, '#c9a020', false);
  bed(P, 43, 36, 14, 21, '#c9a020', false);
  P.disc(32, 30, 6, '#a5703a').ring(32, 30, 5, 1, '#c58a4b').disc(30, 29, 1, '#f4f1ea', false, true).disc(34, 31, 1, '#e23b3b', false, true);
  P.box(25, 8, 14, 5, '#5b6272').r(31, 9, 1, 3, OUT);
  P.r(28, 52, 8, 3, '#2a1f14').r(29, 53, 6, 1, '#4a3a28');
  return P;
}

/** Store: crates, barrels, a shelf of canisters. */
function store(): Pen {
  const P = new Pen();
  room(P, '#4a3d30', '#7a6048');
  P.box(8, 8, 48, 10, '#3a2f26').r(9, 12, 46, 1, '#7a808c');
  for (const c of [[11, '#d8403e'], [18, '#f6c445'], [25, '#58b4d8'], [32, '#58633a'], [39, '#d8403e'], [46, '#f6c445']] as Array<[number, string]>) P.box(c[0], 9, 5, 7, c[1]);
  crate(P, 8, 22, 18, 16);
  crate(P, 28, 22, 12, 12, '#9a6a34');
  crate(P, 8, 40, 14, 14, '#c58a4b');
  crate(P, 24, 38, 20, 16);
  crate(P, 46, 38, 12, 16, '#9a6a34');
  barrel(P, 49, 25, 6, '#3b82d8');
  barrel(P, 54, 31, 4, '#d8403e');
  hazard(P, 8, 56, 22, 2);
  return P;
}

/** The reserve helm: a console, one chair, a window. */
function helm(): Pen {
  const P = new Pen();
  room(P, '#8a6a1c', '#c79a1e');
  P.r(14, 5, 36, 5, '#0b1428');
  for (let s = 0; s < 12; s++) P.p(15 + Math.floor(rnd(s, 3, 5) * 34), 6 + Math.floor(rnd(s, 7, 5) * 3), '#ffffff');
  P.r(14, 5, 36, 1, '#58d4ff');
  desk(P, 16, 12, 32, 10, 3);
  P.box(5, 22, 11, 16, '#7a5a1c').r(7, 25, 7, 4, '#0b1a28').r(8, 26, 5, 2, '#58f2a0').r(7, 31, 2, 2, '#e23b3b').r(11, 31, 2, 2, '#58d4ff');
  P.box(48, 22, 11, 16, '#7a5a1c').r(50, 25, 7, 4, '#0b1a28').r(51, 26, 5, 2, '#58d4ff').r(50, 31, 2, 2, '#f6c445').r(54, 31, 2, 2, '#58f2a0');
  chair(P, 32, 34, '#8c5a2c');
  P.disc(32, 46, 3, '#aab4c8').disc(32, 46, 1, '#e23b3b', false, true);
  P.disc(54, 52, 3, '#f6c445', false, true).p(54, 52, '#ffffff');
  return P;
}

/** The core: a glowing reactor ringed with a yellow line, coils at the corners. */
function core(): Pen {
  const P = new Pen();
  room(P, '#241a42', '#4a3c7c');
  P.ring(32, 32, 27, 2, '#f6c445');
  for (let a = 0; a < 32; a++) {
    const an = (a * Math.PI) / 16;
    P.p(Math.round(32 + Math.cos(an) * 26), Math.round(32 + Math.sin(an) * 26), OUT).p(Math.round(32 + Math.cos(an) * 25), Math.round(32 + Math.sin(an) * 25), OUT);
  }
  for (const q of [[10, 10], [48, 10], [10, 48], [48, 48]]) P.box(q[0], q[1], 6, 6, '#6a7388').r(q[0] + 2, q[1] + 2, 2, 2, '#b06bff');
  P.line(16, 13, 24, 21, '#aab4c8').line(48, 13, 40, 21, '#aab4c8').line(16, 51, 24, 43, '#aab4c8').line(48, 51, 40, 43, '#aab4c8');
  P.disc(32, 32, 14, '#56428a').ring(32, 32, 14, 2, '#8a74d8');
  P.disc(32, 32, 10, '#b06bff', false, true).disc(32, 32, 6, '#e8dcf6', false, true).disc(32, 32, 3, '#ffffff', false, true);
  for (let k = 0; k < 8; k++) {
    const an = (k * Math.PI) / 4 + 0.4;
    P.p(Math.round(32 + Math.cos(an) * 8), Math.round(32 + Math.sin(an) * 8), '#e8dcf6');
  }
  return P;
}

/** The captain's bridge: a window, consoles, a holographic table, the captain's chair and two more. */
function bridge(): Pen {
  const P = new Pen();
  room(P, '#8a6a1c', '#c79a1e');
  P.r(10, 5, 44, 5, '#0b1428');
  for (let s = 0; s < 22; s++) P.p(11 + Math.floor(rnd(s, 3, 6) * 42), 6 + Math.floor(rnd(s, 7, 6) * 3), '#ffffff');
  P.r(10, 5, 44, 1, '#58d4ff').disc(46, 7, 2, '#b06bff', false, true);
  desk(P, 6, 12, 22, 9, 3);
  desk(P, 36, 12, 22, 9, 3);
  P.box(5, 24, 9, 22, '#7a5a1c').r(7, 26, 5, 4, '#0b1a28').r(8, 27, 3, 2, '#58f2a0').r(7, 33, 2, 2, '#e23b3b').r(10, 33, 2, 2, '#f6c445').r(7, 38, 2, 2, '#58d4ff');
  P.box(50, 24, 9, 22, '#7a5a1c').r(52, 26, 5, 4, '#0b1a28').r(53, 27, 3, 2, '#58d4ff').r(52, 33, 2, 2, '#58f2a0').r(55, 33, 2, 2, '#e23b3b').r(52, 38, 2, 2, '#f6c445');
  P.disc(32, 30, 7, '#0e4a66').ring(32, 30, 7, 1, '#58d4ff').disc(32, 30, 2, '#58d4ff', false, true);
  chair(P, 32, 46, '#8c5a2c');
  P.r(26, 49, 12, 1, '#b07a3c');
  chair(P, 17, 42, '#7b4a22');
  chair(P, 47, 42, '#7b4a22');
  return P;
}

/** The shield generator: a dome with sparks, banks of capacitors. */
function shield(): Pen {
  const P = new Pen();
  room(P, '#1d2458', '#4a5cb8');
  for (let i = 0; i < 4; i++) {
    barrel(P, 12, 12 + i * 11, 5, '#3b4a9c');
    barrel(P, 52, 12 + i * 11, 5, '#3b4a9c');
    P.p(12, 12 + i * 11, '#fff3b0').p(52, 12 + i * 11, '#fff3b0');
  }
  P.disc(32, 28, 15, '#3b4a9c').ring(32, 28, 15, 2, '#8a94b8');
  P.disc(32, 28, 11, '#6a86ff', false, true).disc(32, 28, 7, '#a8bcff', false, true).disc(32, 28, 3, '#ffffff', false, true);
  for (let k = 0; k < 12; k++) {
    const an = (k * Math.PI) / 6;
    P.line(Math.round(32 + Math.cos(an) * 16), Math.round(28 + Math.sin(an) * 16), Math.round(32 + Math.cos(an) * 20), Math.round(28 + Math.sin(an) * 20), '#9fb8ff');
  }
  desk(P, 20, 49, 24, 7, 3);
  return P;
}

/** A ladder shaft seen from above: rails, rungs, hazard stripes. */
function ladder(): Pen {
  const P = new Pen();
  room(P, '#2a3442', '#586a80');
  P.box(16, 8, 32, 48, '#0b1018');
  P.r(20, 10, 4, 44, OUT).r(21, 10, 2, 44, '#aab4c8').r(40, 10, 4, 44, OUT).r(41, 10, 2, 44, '#aab4c8');
  for (let y = 12; y < 54; y += 6) P.r(24, y, 16, 3, OUT).r(24, y + 1, 16, 1, '#f0a851');
  hazard(P, 16, 5, 32, 3);
  hazard(P, 16, 56, 32, 3);
  return P;
}

const DRAW: Record<string, () => Pen> = { gun, eng, rcs, work, med, crew, store, helm, core, bridge, shield, ladder };

/** The kinds of module there is a picture for. */
export const MODULE_ART_TYPES = Object.keys(DRAW);

/** The 64×64 picture of a module; `withWalls` adds the document's wall round the edge. */
export function moduleArtCanvas(type: string, withWalls = false): HTMLCanvasElement {
  const draw = DRAW[type];
  if (!draw) throw new Error(`no picture for module ${type}`);
  frame = withWalls;
  try {
    return draw().c;
  } finally {
    frame = false;
  }
}

const artCache = new Map<string, HTMLCanvasElement>();
function artOf(type: string): HTMLCanvasElement {
  let a = artCache.get(type);
  if (!a) {
    a = moduleArtCanvas(type);
    artCache.set(type, a);
  }
  return a;
}

/** A bridge of several tiles repeats the picture, one to a tile; every other module is stretched whole over its room. */
const TILED = new Set(['bridge']);

const sheetCache = new Map<string, HTMLCanvasElement>();

/**
 * The picture of a module over its whole room: `w`×`h` cells inside (the wall not counted) of `tw`×`th` tiles of the
 * layout, 8 pixels to a cell.
 */
export function moduleSheetCanvas(type: string, w: number, h: number, tw: number, th: number): HTMLCanvasElement {
  const key = `${type}:${w}x${h}:${tw}x${th}`;
  let c = sheetCache.get(key);
  if (c) return c;
  const art = artOf(type);
  c = document.createElement('canvas');
  c.width = w * 8;
  c.height = h * 8;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  if (TILED.has(type) && (tw > 1 || th > 1)) {
    const cw = c.width / tw;
    const ch = c.height / th;
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) g.drawImage(art, Math.round(i * cw), Math.round(j * ch), Math.round((i + 1) * cw) - Math.round(i * cw), Math.round((j + 1) * ch) - Math.round(j * ch));
  } else g.drawImage(art, 0, 0, c.width, c.height);
  sheetCache.set(key, c);
  return c;
}

/** A module with the wall cell round it (for cards and for the picture in hand), `px` pixels to a cell. */
export function moduleFaceCanvas(type: string, tw: number, th: number, px: number): HTMLCanvasElement {
  const ladder = type === 'ladder';
  const iw = ladder ? 3 : 9 * tw - 1;
  const ih = ladder ? 3 : 9 * th - 1;
  const W = iw + 2;
  const H = ih + 2;
  const full = document.createElement('canvas');
  full.width = W * 8;
  full.height = H * 8;
  const g = full.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#596273';
  g.fillRect(0, 0, full.width, full.height);
  g.fillStyle = '#7a8498';
  g.fillRect(0, 0, full.width, 2);
  g.fillRect(0, 0, 2, full.height);
  g.fillStyle = '#3f4756';
  g.fillRect(0, full.height - 2, full.width, 2);
  g.fillRect(full.width - 2, 0, 2, full.height);
  g.drawImage(moduleSheetCanvas(type, iw, ih, tw, th), 8, 8);
  if (px === 8) return full;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(W * px));
  out.height = Math.max(1, Math.round(H * px));
  const o = out.getContext('2d')!;
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = 'high';
  o.drawImage(full, 0, 0, out.width, out.height);
  return out;
}
