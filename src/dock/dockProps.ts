/**
 * The things standing about on the station deck round the berth: consoles, crates, barrels,
 * gas racks, lockers, cable reels, stacks of hull plates, engine nozzles, wings and turrets
 * waiting for a ship, workbenches, containers. Each is a small top-down picture painted
 * pixel by pixel in its own local coordinates (d: depth, 0 at the outer edge; l: along the
 * side it stands on), then placed against the outer edge of the walkway or on the deck beyond.
 */

export type RGB = [number, number, number];

export type PropKind =
  | 'console'
  | 'barrel'
  | 'crate'
  | 'rack'
  | 'locker'
  | 'reel'
  | 'plates'
  | 'cart'
  | 'engine'
  | 'bin'
  | 'generator'
  | 'lamp'
  | 'tank'
  | 'wing'
  | 'hullpile'
  | 'bench'
  | 'bigtank'
  | 'turret';

export type AnimKind = 'screen' | 'blink' | 'pulse' | 'lamp' | 'spark';

export interface PropPixel {
  x: number;
  y: number;
  c: RGB;
}
export interface PropAnim extends PropPixel {
  type: AnimKind;
  ph: number;
}

export interface Prop {
  kind: PropKind;
  /** Bounding box in the dock picture. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Somebody is working at it right now (consoles light up). */
  busy: boolean;
  /** The crew can lift crates from here and set them down. */
  pile: boolean;
  px: PropPixel[];
  anim: PropAnim[];
}

const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mul = (c: RGB, f: number): RGB => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];

export const PAL = {
  steel: hex(0x6f7c92),
  steelD: hex(0x485268),
  steelL: hex(0x96a2b8),
  dark: hex(0x222a3a),
  darker: hex(0x161b2a),
  body: hex(0x232a3d),
  orange: hex(0xe28028),
  orangeD: hex(0x964e14),
  red: hex(0xc44038),
  redD: hex(0x782422),
  teal: hex(0x2caaa0),
  tealD: hex(0x186462),
  blue: hex(0x466ebe),
  blueD: hex(0x284282),
  green: hex(0x46b060),
  greenD: hex(0x246438),
  yellow: hex(0xe8c450),
  brown: hex(0x7a5a38),
  brownD: hex(0x4d3822),
  brownL: hex(0xa27c4f),
  white: hex(0xdce4f4),
  cyan: hex(0x59e6ff),
  warm: hex(0xffcf7a),
  magenta: hex(0xff4fd8),
  magentaD: hex(0x5a1a58),
};
const P = PAL;

interface Painter {
  s: (d: number, l: number, c: RGB) => void;
  a: (d: number, l: number, c: RGB, type: AnimKind) => void;
  rect: (d0: number, l0: number, d1: number, l1: number, c: RGB) => void;
  rng: () => number;
}

interface Spec {
  D: number;
  L: number;
  pile?: boolean;
  paint: (p: Painter, D: number, L: number) => void;
}

const pick = <T>(rng: () => number, a: T[]): T => a[Math.floor(rng() * a.length)];

function circle(p: Painter, cd: number, cl: number, r: number, f: (dist: number, d: number, l: number) => RGB | null): void {
  for (let d = Math.floor(cd - r); d <= Math.ceil(cd + r); d++)
    for (let l = Math.floor(cl - r); l <= Math.ceil(cl + r); l++) {
      const dist = Math.hypot(d - cd, l - cl);
      if (dist > r) continue;
      const c = f(dist, d, l);
      if (c) p.s(d, l, c);
    }
}

function barrelAt(p: Painter, d0: number, l0: number, col: RGB): void {
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) {
      if ((a === 0 || a === 2) && (b === 0 || b === 2)) continue;
      p.s(d0 + a, l0 + b, a === 1 && b === 1 ? mul(col, 1.35) : mul(col, a === 2 || b === 2 ? 0.7 : 1));
    }
}

function crateAt(p: Painter, d0: number, l0: number, col: RGB, edge: RGB): void {
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++) p.s(d0 + a, l0 + b, a === 0 || b === 0 || a === 3 || b === 3 ? edge : a === b || a + b === 3 ? mul(col, 1.18) : col);
}

const SPECS: Record<PropKind, (rng: () => number) => Spec> = {
  console: () => ({
    D: 4,
    L: 6,
    paint: (p, D, L) => {
      p.rect(0, 0, D - 1, L - 1, P.darker);
      p.rect(1, 1, D - 2, L - 2, P.body);
      for (let l = 1; l < L - 1; l += 2) p.s(1, l, P.steelD);
      for (let l = 1; l < L - 1; l++) p.a(D - 2, l, P.cyan, 'screen');
    },
  }),
  barrel: (rng) => {
    const n = 1 + Math.floor(rng() * 3);
    const cols = Array.from({ length: n }, () => pick(rng, [P.orange, P.blue, P.green, P.steelL, P.red]));
    return { D: 3, L: n * 3 + (n - 1), paint: (p) => cols.forEach((c, i) => barrelAt(p, 0, i * 4, c)) };
  },
  crate: (rng) => {
    const n = rng() < 0.5 ? 1 : 2;
    const col = pick(rng, [P.brown, hex(0x5f6b3a), hex(0x59606e)]);
    return {
      D: 4,
      L: n * 4,
      pile: true,
      paint: (p) => {
        for (let i = 0; i < n; i++) crateAt(p, 0, i * 4, col, mul(col, 0.6));
        p.s(1, 1, P.yellow);
      },
    };
  },
  rack: () => ({
    D: 3,
    L: 7,
    paint: (p) => {
      p.rect(0, 0, 2, 6, P.dark);
      const cols = [P.green, P.yellow, P.blue];
      for (let i = 0; i < 3; i++) {
        const l = i * 2 + (i > 0 ? 0 : 0);
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) p.s(a, l + b, a === 0 && b === 0 ? P.white : cols[i]);
      }
      for (let l = 0; l < 7; l++) p.s(2, l, P.steelD);
    },
  }),
  locker: (rng) => {
    const L = 8 + (rng() < 0.4 ? 0 : 0);
    return {
      D: 3,
      L,
      paint: (p, D) => {
        p.rect(0, 0, D - 1, L - 1, P.steelD);
        p.rect(0, 0, 1, L - 1, P.steel);
        for (let l = 2; l < L - 1; l += 3) for (let d = 0; d < D; d++) p.s(d, l, P.darker);
        p.a(D - 1, 1, P.green, 'blink');
        p.a(D - 1, 4, P.red, 'blink');
        p.s(0, 1, P.dark);
        p.s(0, 5, P.dark);
      },
    };
  },
  reel: (rng) => {
    const cable = pick(rng, [P.teal, P.orange, P.magenta]);
    return {
      D: 5,
      L: 5,
      paint: (p) =>
        circle(p, 2, 2, 2.5, (dist) => (dist > 1.9 ? P.brownD : dist > 0.9 ? mul(cable, 0.6 + 0.4 * ((Math.floor(dist * 3) % 2))) : P.steelL)),
    };
  },
  plates: () => ({
    D: 5,
    L: 8,
    pile: true,
    paint: (p) => {
      p.rect(0, 0, 3, 6, P.steelD);
      p.rect(1, 1, 4, 7, P.steel);
      p.rect(1, 1, 4, 1, P.steelL);
      for (let l = 2; l <= 6; l++) if (l % 2 === 0) p.s(2, l, P.yellow), p.s(3, l, P.yellow);
      p.s(1, 7, P.white);
      p.s(4, 7, P.steelD);
    },
  }),
  cart: () => ({
    D: 4,
    L: 5,
    pile: true,
    paint: (p) => {
      p.rect(0, 0, 3, 4, P.redD);
      p.rect(1, 1, 2, 3, P.red);
      p.s(1, 1, P.cyan);
      p.s(2, 3, P.yellow);
      p.s(1, 3, P.white);
      for (const [d, l] of [[0, 0], [0, 4], [3, 0], [3, 4]]) p.s(d, l, P.darker);
    },
  }),
  engine: () => ({
    D: 5,
    L: 9,
    paint: (p, D, L) => {
      for (let l = 0; l < L; l++) {
        const r = l < 2 ? 1 : 1 + 1.6 * Math.pow((l - 1) / (L - 2), 1.4);
        for (let d = 0; d < D; d++) {
          const off = Math.abs(d - 2);
          if (off > r) continue;
          const shade = d < 2 ? 1.12 : d > 2 ? 0.8 : 1;
          p.s(d, l, mul(l >= L - 2 && off < r - 0.5 ? P.darker : P.steel, shade));
        }
      }
      for (let d = 1; d <= 3; d++) p.s(d, 1, P.yellow);
      for (let d = 1; d <= 3; d++) p.a(d, L - 1, P.orange, 'pulse');
    },
  }),
  bin: (rng) => ({
    D: 5,
    L: 5,
    pile: true,
    paint: (p, D, L) => {
      p.rect(0, 0, D - 1, L - 1, P.steelD);
      const junk = [P.steel, P.orange, P.tealD, P.brownL, P.red, P.steelL, P.greenD];
      for (let d = 1; d < D - 1; d++) for (let l = 1; l < L - 1; l++) p.s(d, l, rng() < 0.7 ? pick(rng, junk) : P.darker);
    },
  }),
  generator: () => ({
    D: 5,
    L: 5,
    paint: (p, D, L) => {
      p.rect(0, 0, D - 1, L - 1, P.steelD);
      p.rect(1, 1, D - 2, L - 2, P.steel);
      for (let l = 1; l < L - 1; l += 2) for (let d = 1; d < D - 1; d++) p.s(d, l, P.darker);
      p.a(D - 1, 0, P.green, 'blink');
      p.s(0, 2, P.yellow);
    },
  }),
  lamp: () => ({ D: 1, L: 1, paint: (p) => p.a(0, 0, P.warm, 'lamp') }),
  tank: () => ({
    D: 6,
    L: 10,
    paint: (p, D, L) => {
      for (let d = 0; d < D; d++)
        for (let l = 0; l < L; l++) {
          if ((d === 0 || d === D - 1) && (l === 0 || l === L - 1)) continue;
          p.s(d, l, d === 1 ? mul(P.magenta, 0.5) : d === D - 1 || l === 0 || l === L - 1 ? P.magentaD : mul(P.magentaD, 1.25));
        }
      for (let l = 2; l < L - 2; l += 2) p.a(2, l, P.magenta, 'pulse');
    },
  }),
  wing: () => ({
    D: 6,
    L: 14,
    paint: (p, D, L) => {
      for (let l = 0; l < L; l++) {
        const w = Math.max(1, Math.round(1 + (D - 1) * Math.pow(l / (L - 1), 0.9)));
        for (let d = 0; d < w; d++) {
          let c = d === w - 1 ? P.steelL : P.steel;
          if (l % 4 === 3) c = mul(c, 0.7);
          if (d === 0) c = mul(c, 0.85);
          p.s(d, l, c);
        }
      }
      for (let l = 5; l < 9; l++) p.s(1, l, P.yellow);
      p.s(0, L - 1, P.red);
      p.s(1, L - 1, P.red);
    },
  }),
  hullpile: (rng) => ({
    D: 6,
    L: 10,
    pile: true,
    paint: (p) => {
      const cols = [P.steelD, P.steel, P.steelL, mul(P.steel, 0.9)];
      for (const [d0, l0, d1, l1] of [[0, 0, 3, 6], [2, 3, 5, 9], [1, 5, 4, 9]] as const) {
        const c = pick(rng, cols);
        p.rect(d0, l0, d1, l1, c);
        p.rect(d0, l0, d0, l1, mul(c, 1.25));
        p.s(d1, l1, P.darker);
      }
      p.s(2, 6, P.yellow);
      p.s(3, 6, P.yellow);
      p.s(3, 4, P.orange);
    },
  }),
  bench: () => ({
    D: 5,
    L: 12,
    paint: (p, D, L) => {
      p.rect(0, 0, D - 1, L - 1, P.brownD);
      p.rect(1, 1, D - 2, L - 2, P.brown);
      p.rect(1, 1, 1, L - 2, P.brownL);
      p.rect(2, 1, 3, 2, P.steelL);
      p.s(2, 5, P.orange);
      p.s(3, 6, P.cyan);
      p.s(2, 8, P.yellow);
      p.s(3, 9, P.white);
      p.a(2, 3, P.white, 'spark');
      p.a(D - 1, L - 1, P.warm, 'lamp');
    },
  }),
  bigtank: (rng) => {
    const band = pick(rng, [P.blue, P.orange, P.green, P.red]);
    return {
      D: 6,
      L: 6,
      paint: (p) => {
        circle(p, 2.5, 2.5, 3, (dist, _d, l) => {
          let c = mul(P.steel, 1.2 - dist * 0.2);
          if (dist > 2.4) c = P.steelD;
          if (Math.abs(l - 2.5) < 0.9 && dist < 2.6) c = band;
          return c;
        });
        p.s(2, 2, P.yellow);
        p.s(3, 2, P.yellow);
        p.a(2, 3, P.green, 'blink');
      },
    };
  },
  turret: () => ({
    D: 6,
    L: 7,
    paint: (p) => {
      circle(p, 2.5, 2.5, 2.8, (dist) => (dist > 2.1 ? P.steelD : dist > 1 ? P.steel : P.steelL));
      for (let l = 5; l < 7; l++) p.s(2, l, l === 6 ? P.darker : P.steelD);
      p.s(2, 2, P.cyan);
    },
  }),
};

const WEIGHTS: Array<[PropKind, number]> = [
  ['console', 8],
  ['barrel', 9],
  ['crate', 10],
  ['rack', 5],
  ['locker', 5],
  ['reel', 4],
  ['plates', 5],
  ['cart', 4],
  ['engine', 4],
  ['bin', 5],
  ['generator', 4],
  ['wing', 3],
  ['hullpile', 4],
  ['bench', 3],
  ['bigtank', 3],
  ['turret', 3],
];

export function pickKind(rng: () => number): PropKind {
  let t = rng() * WEIGHTS.reduce((a, b) => a + b[1], 0);
  for (const [k, v] of WEIGHTS) {
    t -= v;
    if (t <= 0) return k;
  }
  return WEIGHTS[0][0];
}

/** Where the local axes of a prop point in the dock picture. */
export type Place =
  | { side: 'l'; outer: number; pos: number }
  | { side: 'r'; outer: number; pos: number }
  | { side: 'b'; outer: number; pos: number };

export interface Plan {
  kind: PropKind;
  spec: Spec;
  D: number;
  L: number;
}

/** Decides how big a prop of this kind is (some come in several lengths) before it is placed. */
export function planProp(kind: PropKind, rng: () => number): Plan {
  const spec = SPECS[kind](rng);
  return { kind, spec, D: spec.D, L: spec.L };
}

/** Paints one prop in place. */
export function makeProp(plan: Plan, at: Place, rng: () => number): Prop {
  const { kind, spec, D, L } = plan;
  const px: PropPixel[] = [];
  const anim: PropAnim[] = [];
  const to = (d: number, l: number): [number, number] => {
    if (at.side === 'l') return [at.outer + d, at.pos + l];
    if (at.side === 'r') return [at.outer - d, at.pos + l];
    return [at.pos + l, at.outer - d];
  };
  const painter: Painter = {
    s: (d, l, c) => {
      const [x, y] = to(d, l);
      px.push({ x, y, c });
    },
    a: (d, l, c, type) => {
      const [x, y] = to(d, l);
      anim.push({ x, y, c, type, ph: rng() * 6.28 });
    },
    rect: (d0, l0, d1, l1, c) => {
      for (let d = d0; d <= d1; d++) for (let l = l0; l <= l1; l++) painter.s(d, l, c);
    },
    rng,
  };
  spec.paint(painter, D, L);
  const xs = [...px, ...anim].map((q) => q.x);
  const ys = [...px, ...anim].map((q) => q.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { kind, x: x0, y: y0, w: Math.max(...xs) - x0 + 1, h: Math.max(...ys) - y0 + 1, busy: false, pile: !!spec.pile, px, anim };
}
