import type { DockLayout } from './dockArt';
import { PAL, makeProp, pickKind, planProp, type Prop } from './dockProps';

/** How wide the walkway round the berth is, in dock-picture pixels (about a plate and a half). */
export const RING = 16;

/**
 * Life on the station deck round the berth: crates, barrels, consoles, parts and the like
 * standing on the walkway, at its edges or out in the middle, and a few spacesuited crew who
 * find their way round them, stop at the consoles to work and carry a crate from one pile to
 * another. They know nothing about the ship.
 */

type RGB = [number, number, number];

export type { Prop } from './dockProps';

/** A place the crew go to and what they do there. */
interface Stop {
  x: number;
  y: number;
  kind: 'console' | 'crate' | 'idle';
  prop: Prop | null;
}

export interface Walker {
  x: number;
  y: number;
  /** Waypoints still to walk, nearest last. */
  route: Array<[number, number]>;
  speed: number;
  state: 'walk' | 'wait';
  timer: number;
  /** Where it is going, and what it does on arrival. */
  target: Stop;
  carry: boolean;
  suit: RGB;
  /** Distance walked, for the stride. */
  stride: number;
  /** Which way it looks (unit step). */
  fx: number;
  fy: number;
  work: Prop | null;
}

export interface DockLife {
  W: number;
  H: number;
  props: Prop[];
  walkers: Walker[];
  stops: Stop[];
  /** Where a spacesuit fits: 1 on the walkway's floor clear of everything standing on it. */
  floor: Uint8Array;
  rng: () => number;
  /** Scratch space for finding a way. */
  scratch: { g: Float32Array; from: Int32Array; seen: Uint32Array; stamp: number };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUITS: RGB[] = [
  [232, 131, 42],
  [207, 216, 240],
  [47, 179, 168],
  [232, 196, 80],
  [150, 120, 230],
];

/** How far outside the berth's rim a point is (the walkway runs from 4 to 3 + RING). */
function ringDist(L: DockLayout, x: number, y: number): number {
  const dx = x < L.bx ? L.bx - x : x >= L.bx + L.bayW ? x - (L.bx + L.bayW) + 1 : 0;
  const dy = y < L.by ? L.by - y : y >= L.by + L.bayH ? y - (L.by + L.bayH) + 1 : 0;
  return Math.max(dx, dy);
}

const BODY = 2;

export function makeLife(L: DockLayout, _shipW: number, shipH: number, seed = 7): DockLife {
  const rng = mulberry32(seed * 1000 + L.bx * 31 + L.by * 17 + shipH);
  const W = L.W;
  const H = L.H;
  const props: Prop[] = [];
  // the rows the clamp arms, the tube and the fuel line use: keep the props off them
  const feedY = L.sy + Math.round(shipH * (shipH > 120 ? 0.36 : 0.5));
  const outerL = L.bx - 3 - RING;
  const outerR = L.bx + L.bayW + 3 + RING - 1;
  const outerB = L.by + L.bayH + 3 + RING - 1;

  // the fuel tank on the left feeds the line into the berth wall (drawn live, see renderDock)
  props.push(makeProp(planProp('tank', rng), { side: 'l', outer: outerL, pos: feedY - 5 }, rng));

  // things along each side: some against the outer edge, some against the inner, some out in the middle
  const row = (side: 'l' | 'r' | 'b', outer: number, from: number, to: number) => {
    let pos = from;
    while (pos < to - 3) {
      const plan = planProp(pickKind(rng), rng);
      if (side !== 'b' && pos < feedY + 8 && pos + plan.L > feedY - 9) {
        pos = feedY + 8;
        continue;
      }
      if (pos + plan.L > to) break;
      const room = RING - plan.D;
      const r = rng();
      const lat = r < 0.3 ? 0 : r < 0.5 ? room : 1 + Math.floor(rng() * Math.max(1, room - 1));
      const o = side === 'l' ? outer + lat : outer - lat;
      props.push(makeProp(plan, { side, outer: o, pos }, rng));
      pos += plan.L;
      // a gap wide enough to walk through, whichever sides the neighbours lean to
      pos += 6 + Math.floor(rng() * 4);
      if (rng() < 0.4) {
        props.push(makeProp(planProp('lamp', rng), { side, outer, pos: pos - 4 }, rng));
      }
    }
  };
  row('l', outerL, L.by + 2, L.by + L.bayH - 2);
  row('r', outerR, L.by + 2, L.by + L.bayH - 2);
  row('b', outerB, outerL + 8, outerR - 7);

  // where a spacesuit fits: on the walkway, clear of the rim, the door leaves and everything standing on it
  const floor = new Uint8Array(W * H);
  const dl = Math.max(3, Math.min(10, Math.round(L.bayW * 0.06)));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = ringDist(L, x, y);
      if (d < 3 + BODY + 1 || d > 3 + RING - BODY) continue;
      if (y < L.by && x >= L.door.x0 - dl - BODY && x < L.door.x1 + dl + BODY) continue;
      floor[y * W + x] = 1;
    }
  }
  for (const p of props) {
    if (p.kind === 'lamp') continue;
    for (let y = Math.max(0, p.y - BODY); y < Math.min(H, p.y + p.h + BODY); y++) for (let x = Math.max(0, p.x - BODY); x < Math.min(W, p.x + p.w + BODY); x++) floor[y * W + x] = 0;
  }
  // keep only the biggest connected stretch, so every stop can be reached from every other
  const comp = new Int32Array(W * H).fill(-1);
  let best = -1;
  let bestN = 0;
  for (let i = 0, c = 0; i < W * H; i++) {
    if (!floor[i] || comp[i] >= 0) continue;
    let n = 0;
    const stack = [i];
    comp[i] = c;
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      const x = j % W;
      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= W * H || !floor[k] || comp[k] >= 0) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue;
        comp[k] = c;
        stack.push(k);
      }
    }
    if (n > bestN) {
      bestN = n;
      best = c;
    }
    c++;
  }
  for (let i = 0; i < W * H; i++) if (comp[i] !== best) floor[i] = 0;

  const life: DockLife = { W, H, props, walkers: [], stops: [], floor, rng, scratch: { g: new Float32Array(W * H), from: new Int32Array(W * H), seen: new Uint32Array(W * H), stamp: 0 } };

  // the stops: a spot beside every console and pile, and a few places to idle at
  for (const p of props) {
    const kind = p.kind === 'console' ? 'console' : p.pile ? 'crate' : null;
    if (!kind) continue;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    let bestI = -1;
    let bestD = Infinity;
    for (let y = Math.max(0, p.y - 9); y < Math.min(H, p.y + p.h + 9); y++) {
      for (let x = Math.max(0, p.x - 9); x < Math.min(W, p.x + p.w + 9); x++) {
        if (!floor[y * W + x]) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < bestD) {
          bestD = d;
          bestI = y * W + x;
        }
      }
    }
    if (bestI >= 0) life.stops.push({ x: bestI % W, y: Math.floor(bestI / W), kind, prop: p });
  }
  const cells: number[] = [];
  for (let i = 0; i < W * H; i++) if (floor[i]) cells.push(i);
  for (let i = 0; i < 6 && cells.length; i++) {
    const c = cells[Math.floor(rng() * cells.length)];
    life.stops.push({ x: c % W, y: Math.floor(c / W), kind: 'idle', prop: null });
  }
  if (!life.stops.length) return life;

  const n = Math.max(3, Math.min(8, Math.round(cells.length / 600)));
  for (let i = 0; i < n; i++) {
    const c = cells[Math.floor(rng() * cells.length)];
    life.walkers.push({
      x: c % W,
      y: Math.floor(c / W),
      route: [],
      speed: 7 + rng() * 5,
      state: 'wait',
      timer: rng() * 3,
      target: life.stops[Math.floor(rng() * life.stops.length)],
      carry: false,
      suit: SUITS[i % SUITS.length],
      stride: rng() * 10,
      fx: 0,
      fy: 1,
      work: null,
    });
  }
  return life;
}

/** The shortest way over the floor from one cell to another (eight directions, no cutting corners), or null. */
export function findRoute(life: DockLife, sx: number, sy: number, tx: number, ty: number): Array<[number, number]> | null {
  const { W, H, floor, scratch } = life;
  const s = sy * W + sx;
  const t = ty * W + tx;
  if (!floor[s] || !floor[t]) return null;
  if (s === t) return [];
  const stamp = ++scratch.stamp;
  const { g, from, seen } = scratch;
  const open: Array<[number, number]> = [];
  const push = (f: number, i: number) => {
    open.push([f, i]);
    let k = open.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (open[p][0] <= open[k][0]) break;
      [open[p], open[k]] = [open[k], open[p]];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top = open[0];
    const last = open.pop()!;
    if (open.length) {
      open[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < open.length && open[l][0] < open[m][0]) m = l;
        if (r < open.length && open[r][0] < open[m][0]) m = r;
        if (m === k) break;
        [open[m], open[k]] = [open[k], open[m]];
        k = m;
      }
    }
    return top;
  };
  const h = (i: number) => {
    const dx = Math.abs((i % W) - tx);
    const dy = Math.abs(Math.floor(i / W) - ty);
    return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
  };
  seen[s] = stamp;
  g[s] = 0;
  from[s] = -1;
  push(h(s), s);
  while (open.length) {
    const [, i] = pop();
    if (i === t) break;
    const x = i % W;
    const y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!floor[j]) continue;
        if (dx && dy && (!floor[y * W + nx] || !floor[ny * W + x])) continue;
        const cost = g[i] + (dx && dy ? 1.41 : 1);
        if (seen[j] === stamp && cost >= g[j]) continue;
        seen[j] = stamp;
        g[j] = cost;
        from[j] = i;
        push(cost + h(j), j);
      }
    }
  }
  if (seen[t] !== stamp) return null;
  const out: Array<[number, number]> = [];
  for (let i = t; i !== s && i >= 0; i = from[i]) out.push([i % W, Math.floor(i / W)]);
  return out;
}

function chooseTarget(life: DockLife, w: Walker): void {
  const { stops, rng } = life;
  // a carrier heads for a pile of crates, a free hand for whatever calls
  let pool = stops.filter((s) => s !== w.target && (w.carry ? s.kind === 'crate' : true));
  if (pool.length === 0) pool = stops;
  for (let tries = 0; tries < 4; tries++) {
    const t = pool[Math.floor(rng() * pool.length)];
    const route = findRoute(life, Math.round(w.x), Math.round(w.y), t.x, t.y);
    if (route) {
      w.target = t;
      w.route = route;
      w.state = 'walk';
      return;
    }
  }
  w.state = 'wait';
  w.timer = 1;
}

/** Moves the crew on: walk to a stop round whatever stands in the way, work or lift a crate there, pick the next. */
export function stepLife(life: DockLife, dt: number): void {
  for (const p of life.props) p.busy = false;
  for (const w of life.walkers) {
    if (w.state === 'wait') {
      w.timer -= dt;
      if (w.work) w.work.busy = true;
      if (w.timer <= 0) {
        w.work = null;
        chooseTarget(life, w);
      }
    } else {
      let step = w.speed * dt;
      while (step > 0 && w.route.length) {
        const [tx, ty] = w.route[w.route.length - 1];
        const dx = tx - w.x;
        const dy = ty - w.y;
        const d = Math.hypot(dx, dy);
        if (d <= step) {
          w.x = tx;
          w.y = ty;
          w.route.pop();
          step -= d;
          w.stride += d;
        } else {
          w.x += (dx / d) * step;
          w.y += (dy / d) * step;
          w.stride += step;
          step = 0;
          if (Math.abs(dx) >= Math.abs(dy)) {
            w.fx = Math.sign(dx);
            w.fy = 0;
          } else {
            w.fx = 0;
            w.fy = Math.sign(dy);
          }
        }
      }
      if (!w.route.length) {
        w.state = 'wait';
        const k = w.target.kind;
        if (k === 'console') {
          w.timer = 4 + life.rng() * 6;
          w.work = w.target.prop;
        } else if (k === 'crate') {
          w.timer = 1.5 + life.rng() * 1.5;
          w.carry = !w.carry;
        } else w.timer = 1.5 + life.rng() * 3;
        // face what it is working at
        const p = w.target.prop;
        if (p && k !== 'idle') {
          const dx = p.x + p.w / 2 - w.x;
          const dy = p.y + p.h / 2 - w.y;
          if (Math.abs(dx) > Math.abs(dy)) {
            w.fx = Math.sign(dx);
            w.fy = 0;
          } else {
            w.fx = 0;
            w.fy = Math.sign(dy) || 1;
          }
        }
      }
    }
  }
}

/** Where a walker stands in the dock picture. */
export function walkerPos(_life: DockLife, w: Walker): { x: number; y: number } {
  return { x: w.x, y: w.y };
}

// ------------------------------------------------------------------ painting

const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const K = { crate: hex(0x7a5a38), crateEdge: hex(0x4d3822), crateX: hex(0xa27c4f) };
const mul = (c: RGB, f: number): RGB => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];

/** The still part of every prop, into the base picture, each with a shadow thrown down and to the right (light from the top left). */
export function paintProps(life: DockLife, put: (x: number, y: number, c: RGB) => void, shade: (x: number, y: number, k: number) => void): void {
  for (const p of life.props) {
    if (p.kind === 'lamp') continue;
    const own = new Set<number>();
    for (const q of [...p.px, ...p.anim]) own.add(q.y * 4096 + q.x);
    // bigger things stand taller, so their shadows reach further
    const reach = Math.min(p.w, p.h) >= 5 ? 2 : 1;
    for (let o = 1; o <= reach; o++) {
      for (const q of [...p.px, ...p.anim]) {
        const sx = q.x + o;
        const sy = q.y + o;
        if (!own.has(sy * 4096 + sx)) shade(sx, sy, o === 1 ? 0.5 : 0.7);
      }
    }
  }
  for (const p of life.props) for (const q of p.px) put(q.x, q.y, q.c);
}

/** The moving parts: lit screens and lamps, blinking lights, glowing nozzles, welding sparks, and the crew. */
export function paintLife(
  life: DockLife,
  t: number,
  set: (x: number, y: number, c: RGB, em?: RGB | null) => void,
  darken: (x: number, y: number, k: number) => void,
): void {
  for (const p of life.props) {
    for (const a of p.anim) {
      if (a.type === 'screen') {
        const on = p.busy ? (Math.sin(t * 14 + a.ph * 3) > -0.5 ? 1 : 0.35) : 0.5 + 0.18 * Math.sin(t * 1.3 + a.ph);
        set(a.x, a.y, mul(a.c, on), mul(a.c, 0.55 * on));
      } else if (a.type === 'blink') {
        const on = Math.sin(t * 2.6 + a.ph) > 0.2;
        set(a.x, a.y, mul(a.c, on ? 1 : 0.3), on ? mul(a.c, 0.7) : null);
      } else if (a.type === 'pulse') {
        const k = 0.55 + 0.45 * Math.sin(t * 2 + a.ph);
        set(a.x, a.y, mul(a.c, k), mul(a.c, 0.5 * k));
      } else if (a.type === 'lamp') {
        const k = 0.9 + 0.1 * Math.sin(t * 5 + a.ph);
        set(a.x, a.y, mul(a.c, k), mul(a.c, 0.6 * k));
      } else {
        const r = Math.sin(t * 17 + a.ph) * 43758.5453;
        const on = r - Math.floor(r) > 0.78;
        set(a.x, a.y, on ? [255, 240, 200] : PAL.steelD, on ? [255, 190, 90] : null);
      }
    }
  }
  for (const w of life.walkers) {
    const x = Math.round(w.x);
    const y = Math.round(w.y);
    const stepNow = w.state === 'walk' && Math.floor(w.stride / 2) % 2 === 0;
    for (let a = -1; a <= 1; a++) for (let b = -2; b <= 2; b++) darken(x + a + 1, y + b + 1, 0.55);
    const suit = w.suit;
    const helmet = hex(0xdfe6f5);
    const visor = hex(0x2a3d66);
    // legs
    set(x - 1, y + 2, mul(suit, 0.55));
    set(x + 1, y + 2, mul(suit, 0.55));
    if (w.state === 'walk') set(stepNow ? x - 1 : x + 1, y + 2, mul(suit, 0.35));
    // body
    for (let a = -1; a <= 1; a++) {
      set(x + a, y, mul(suit, 1.15));
      set(x + a, y + 1, suit);
    }
    // head and visor
    set(x, y - 2, helmet);
    set(x - 1, y - 1, helmet);
    set(x, y - 1, helmet);
    set(x + 1, y - 1, helmet);
    set(x + w.fx, y - 1 + (w.fy > 0 ? 0 : w.fy < 0 ? -1 : 0), visor);
    if (w.carry) {
      const cx = x + (w.fx === 0 ? 0 : w.fx * 2);
      const cy = y - 3 + (w.fy > 0 ? 1 : 0);
      set(cx, cy, K.crate);
      set(cx + 1, cy, K.crateX);
      set(cx, cy + 1, K.crateEdge);
      set(cx + 1, cy + 1, K.crate);
    }
  }
}
