import { describe, expect, it } from 'vitest';
import { dockLayout } from '../src/dock/dockArt';
import { RING, findRoute, makeLife, stepLife, walkerPos } from '../src/dock/dockLife';
import { SHIPS } from '../src/sim/ships';

/** How far outside the berth's rim a point is (the walkway starts at 4 and ends at 3 + RING). */
function ringDist(L: ReturnType<typeof dockLayout>, x: number, y: number): number {
  const dx = x < L.bx ? L.bx - x : x >= L.bx + L.bayW ? x - (L.bx + L.bayW) + 1 : 0;
  const dy = y < L.by ? L.by - y : y >= L.by + L.bayH ? y - (L.by + L.bayH) + 1 : 0;
  return Math.max(dx, dy);
}

describe('dock layout with room for the interface', () => {
  it('centres the berth where asked and keeps the bottom strip clear below the walkway', () => {
    for (const spec of SHIPS) {
      const g = spec.build();
      const L = dockLayout(g.width, g.height, 16 / 9, false, { cx: 0.41, bottom: 0.2 });
      expect(Math.abs(L.W / L.H - 16 / 9)).toBeLessThan(0.02);
      expect((L.bx + L.bayW / 2) / L.W).toBeCloseTo(0.41, 1);
      // the walkway fits below the berth, and the strip for the row of rooms under it
      expect(L.H - (L.by + L.bayH) - 3 - RING).toBeGreaterThanOrEqual(Math.floor(0.2 * L.H) - 1);
      expect(L.bx).toBeGreaterThanOrEqual(RING + 6);
      expect(L.bx + L.bayW).toBeLessThanOrEqual(L.W - RING - 6);
    }
  });
});

describe('life on the walkway', () => {
  it('stands things on the walkway only, at its edges and out in the middle, none on top of another', () => {
    for (const spec of SHIPS) {
      const g = spec.build();
      const L = dockLayout(g.width, g.height, 16 / 9, false, { cx: 0.41, bottom: 0.2 });
      const life = makeLife(L, g.width, g.height);
      expect(life.props.length).toBeGreaterThan(12);
      expect(new Set(life.props.map((p) => p.kind)).size).toBeGreaterThan(9);
      const seen = new Map<number, unknown>();
      let nearOuter = 0;
      let nearInner = 0;
      let middle = 0;
      for (const p of life.props) {
        for (const q of p.px) {
          const d = ringDist(L, q.x, q.y);
          expect(d).toBeGreaterThanOrEqual(4);
          expect(d).toBeLessThanOrEqual(3 + RING);
          const key = q.y * 4096 + q.x;
          // a prop may paint a pixel twice (layers), but never one that belongs to another prop
          if (seen.has(key)) expect(seen.get(key)).toBe(p);
          seen.set(key, p);
        }
        if (p.kind === 'lamp' || p.kind === 'tank') continue;
        const ds = p.px.map((q) => ringDist(L, q.x, q.y));
        const lo = Math.min(...ds);
        const hi = Math.max(...ds);
        if (hi >= 3 + RING - 1) nearOuter++;
        else if (lo <= 5) nearInner++;
        else middle++;
        // not pressed against both walls at once: it never spans the whole width
        expect(hi - lo + 1).toBeLessThan(RING);
      }
      expect(nearOuter).toBeGreaterThan(0);
      expect(middle).toBeGreaterThan(0);
      expect(nearInner + nearOuter + middle).toBeGreaterThan(10);
    }
  });

  it('keeps the crew on the walkway as they wander round the props, and they do stop and carry things', () => {
    const g = SHIPS[0].build();
    const L = dockLayout(g.width, g.height, 16 / 9, false, { cx: 0.41, bottom: 0.2 });
    const life = makeLife(L, g.width, g.height);
    expect(life.walkers.length).toBeGreaterThanOrEqual(3);
    let waited = 0;
    let carried = 0;
    let worked = 0;
    for (let i = 0; i < 60 * 120; i++) {
      stepLife(life, 1 / 60);
      for (const w of life.walkers) {
        if (w.state === 'wait') waited++;
        if (w.carry) carried++;
        if (w.work) worked++;
        const q = walkerPos(life, w);
        const d = ringDist(L, Math.round(q.x), Math.round(q.y));
        expect(d).toBeGreaterThanOrEqual(4);
        expect(d).toBeLessThanOrEqual(3 + RING);
        // they go round the things on the walkway, never through them
        for (const p of life.props) if (p.kind !== 'lamp') expect(q.x >= p.x && q.x < p.x + p.w && q.y >= p.y && q.y < p.y + p.h).toBe(false);
      }
    }
    expect(waited).toBeGreaterThan(0);
    expect(carried).toBeGreaterThan(0);
    expect(worked).toBeGreaterThan(0);
  });

  it('finds a way between any two stops', () => {
    const g = SHIPS[0].build();
    const L = dockLayout(g.width, g.height, 16 / 9, false, { cx: 0.41, bottom: 0.2 });
    const life = makeLife(L, g.width, g.height);
    expect(life.stops.length).toBeGreaterThan(8);
    for (const a of life.stops) for (const b of life.stops) expect(findRoute(life, a.x, a.y, b.x, b.y)).not.toBeNull();
  });

  it('lights a console only while somebody is at it', () => {
    const g = SHIPS[0].build();
    const L = dockLayout(g.width, g.height, 16 / 9, false);
    const life = makeLife(L, g.width, g.height);
    for (let i = 0; i < 60 * 60; i++) {
      stepLife(life, 1 / 60);
      for (const p of life.props) if (p.busy) expect(p.kind).toBe('console');
    }
  });
});

describe('the crew finding their way', () => {
  it('walks the biggest ship\'s walkway in a phone-shaped dock without stalling the frame', () => {
    const g = SHIPS[SHIPS.length - 1].build();
    const L = dockLayout(g.width, g.height, 390 / 844, true);
    const life = makeLife(L, g.width, g.height);
    const t0 = performance.now();
    // a minute of life, a frame at a time: every walker picks places to go and finds the way there
    for (let i = 0; i < 60 * 60; i++) stepLife(life, 1 / 60);
    // searches that went over the same cells again and again made this take seconds (and froze the page)
    expect(performance.now() - t0).toBeLessThan(1500);
    for (const w of life.walkers) expect(w.route.length).toBeLessThan(life.W * life.H);
  });
});
