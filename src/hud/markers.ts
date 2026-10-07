/**
 * Marks for the objects round the ship that are off screen: each stands on the edge of a frame inside the screen,
 * in the direction of its object. Pure geometry; the screen draws what this returns.
 */
export type MarkerKind = 'foe' | 'ally' | 'big' | 'hole' | 'wreck' | 'gate' | 'rocks' | 'comet' | 'hazard' | 'beacon' | 'foeidle' | 'trail' | 'crate' | 'foeexit';

export interface MarkerObj {
  id: string;
  kind: MarkerKind;
  /** Where the object is in the world (what a tap on its mark flies to). */
  x: number;
  y: number;
  /** Where the object is on the screen, in pixels (may be far outside it). */
  sx: number;
  sy: number;
  /** Distance from the ship, for the label and for choosing the nearest. */
  dist: number;
  /** What to write under the mark instead of the distance (a rough fix: «≈1 800 кл»). */
  label?: string;
}

export interface MarkerFrame {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface Placed {
  obj: MarkerObj;
  x: number;
  y: number;
  edge: 'l' | 'r' | 't' | 'b';
  /** Direction from the middle of the frame to the object, radians. */
  ang: number;
}

export const MARKERS = {
  /** At most this many marks at once; enemies come first, then the nearest. */
  max: 7,
};

/** Where on the frame's edge the line from its middle to (sx, sy) comes out. */
export function edgePoint(f: MarkerFrame, sx: number, sy: number): { x: number; y: number; edge: Placed['edge']; ang: number } {
  const mx = (f.l + f.r) / 2;
  const my = (f.t + f.b) / 2;
  const dx = sx - mx;
  const dy = sy - my;
  const kx = dx ? ((dx > 0 ? f.r : f.l) - mx) / dx : Infinity;
  const ky = dy ? ((dy > 0 ? f.b : f.t) - my) / dy : Infinity;
  const k = Math.min(kx, ky);
  const x = mx + dx * k;
  const y = my + dy * k;
  const edge: Placed['edge'] = k === kx ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'b' : 't';
  return { x, y, edge, ang: Math.atan2(dy, dx) };
}

/**
 * Chooses and places the marks. Objects whose centre is on the screen get none. `gapAcross` is the room a mark takes along a
 * top or bottom edge, `gapAlong` along a left or right one (a mark there carries its distance under it).
 */
export function placeMarkers(objs: MarkerObj[], W: number, H: number, frame: MarkerFrame, gapAcross: number, gapAlong: number): Placed[] {
  const off = objs.filter((o) => !(o.sx > 0 && o.sx < W && o.sy > 0 && o.sy < H));
  const foe = (k: MarkerKind): number => (k === 'foe' ? 2 : k === 'foeidle' ? 1 : 0);
  off.sort((a, b) => foe(b.kind) - foe(a.kind) || a.dist - b.dist);
  const placed: Placed[] = off.slice(0, MARKERS.max).map((obj) => ({ obj, ...edgePoint(frame, obj.sx, obj.sy) }));
  for (const edge of ['l', 'r', 't', 'b'] as const) {
    const group = placed.filter((p) => p.edge === edge);
    const horizontal = edge === 't' || edge === 'b';
    const gap = horizontal ? gapAcross : gapAlong;
    group.sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    for (let pass = 0; pass < 40; pass++) {
      for (let i = 1; i < group.length; i++) {
        const a = group[i - 1];
        const b = group[i];
        const d = horizontal ? b.x - a.x : b.y - a.y;
        if (d >= gap) continue;
        const push = (gap - d) / 2;
        if (horizontal) {
          a.x -= push;
          b.x += push;
        } else {
          a.y -= push;
          b.y += push;
        }
      }
    }
    for (const p of group) {
      if (horizontal) p.x = Math.max(frame.l, Math.min(frame.r, p.x));
      else p.y = Math.max(frame.t, Math.min(frame.b, p.y));
    }
  }
  return placed;
}
