import { describe, expect, it } from 'vitest';
import { MARKERS, edgePoint, placeMarkers, type MarkerObj } from '../src/hud/markers';

const frame = { l: 40, t: 100, r: 360, b: 700 };
const W = 400;
const H = 800;
const obj = (id: string, sx: number, sy: number, kind: MarkerObj['kind'] = 'big', dist = 500): MarkerObj => ({ id, kind, x: 0, y: 0, sx, sy, dist });

describe('edge marks', () => {
  it('stand on the edge of the frame in the direction of the object', () => {
    const right = edgePoint(frame, 5000, 400);
    expect(right.edge).toBe('r');
    expect(right.x).toBeCloseTo(360);
    expect(right.y).toBeCloseTo(400);
    const top = edgePoint(frame, 200, -3000);
    expect(top.edge).toBe('t');
    expect(top.y).toBeCloseTo(100);
    const corner = edgePoint(frame, 5000, -5000);
    expect(corner.x).toBeLessThanOrEqual(360);
    expect(corner.y).toBeGreaterThanOrEqual(100);
    expect(right.ang).toBeCloseTo(0);
  });

  it('are made for objects off screen only', () => {
    const list = placeMarkers([obj('in', 200, 400), obj('out', 900, 400)], W, H, frame, 50, 80);
    expect(list.some((p) => p.obj.id === 'out')).toBe(true);
    expect(list.some((p) => p.obj.id === 'in')).toBe(false);
  });

  it('keep seven, enemies first and then the nearest', () => {
    const objs: MarkerObj[] = [];
    for (let i = 0; i < 10; i++) objs.push(obj('o' + i, 1000 + i * 100, 400, 'big', 1000 - i * 10));
    objs.push(obj('foe', -900, 300, 'foe', 5000));
    const list = placeMarkers(objs, W, H, frame, 50, 80);
    expect(list.length).toBe(MARKERS.max);
    expect(list[0].obj.id).toBe('foe');
    // the nearest of the others are the last made ones (smallest distance)
    expect(list.slice(1).every((p) => p.obj.dist <= 1000 - 4 * 10)).toBe(true);
  });

  it('spread apart on one edge and stay inside the frame', () => {
    const objs = [0, 1, 2, 3].map((i) => obj('r' + i, 2000, 380 + i * 5, 'big', 100 + i));
    const list = placeMarkers(objs, W, H, frame, 50, 80);
    const ys = list.map((p) => p.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(80 - 1e-6);
    for (const p of list) {
      expect(p.y).toBeGreaterThanOrEqual(frame.t);
      expect(p.y).toBeLessThanOrEqual(frame.b);
      expect(p.x).toBeCloseTo(frame.r);
    }
  });
});
