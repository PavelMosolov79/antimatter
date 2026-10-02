import { describe, expect, it } from 'vitest';
import { buildDockBase, dockLayout, makeDockSprite, renderDock } from '../src/dock/dockArt';
import { makeLife } from '../src/dock/dockLife';
import { SHIPS, buildBattleship, buildFighter } from '../src/sim/ships';

function frame(W: number, H: number): ImageData {
  return { data: new Uint8ClampedArray(W * H * 4), width: W, height: H, colorSpace: 'srgb' } as ImageData;
}
const px = (img: ImageData, x: number, y: number) => {
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};

describe('dock layout', () => {
  it('sizes the hangar to each ship and fills the screen around it', () => {
    for (const spec of SHIPS) {
      const g = spec.build();
      for (const [aspect, portrait] of [
        [16 / 9, false],
        [9 / 16, true],
        [21 / 9, false],
      ] as const) {
        const L = dockLayout(g.width, g.height, aspect, portrait);
        expect(Math.abs(L.W / L.H - aspect)).toBeLessThan(0.02);
        // The ship sits inside the berth with room for the clamp arms either side.
        expect(L.sx).toBeGreaterThanOrEqual(L.bx + 8);
        expect(L.sx + g.width).toBeLessThanOrEqual(L.bx + L.bayW - 8);
        expect(L.sy).toBeGreaterThanOrEqual(L.by);
        expect(L.sy + g.height).toBeLessThanOrEqual(L.by + L.bayH);
        expect(L.by + L.bayH).toBeLessThanOrEqual(L.H);
        // The doors open in the berth's top wall.
        expect(L.door.x0).toBeGreaterThan(L.bx);
        expect(L.door.x1).toBeLessThan(L.bx + L.bayW);
      }
    }
  });

  it('keeps the ship in the upper part on a phone, clear of the panel at the bottom', () => {
    const g = buildBattleship();
    const L = dockLayout(g.width, g.height, 9 / 16, true);
    expect((L.sy + g.height / 2) / L.H).toBeCloseTo(0.34, 1);
    expect((L.sy + g.height) / L.H).toBeLessThan(0.55);
  });
});

describe('dock picture', () => {
  it('paints the ship from outside and every layer, like the game draws it', () => {
    const g = buildFighter();
    const s = makeDockSprite(g);
    expect(s.views.length).toBe(g.depth + 1);
    for (const v of s.views) expect(v.length).toBe(g.width * g.height * 4);
    // The arms' reach: every row of the hull has a left and a right edge inside the grid.
    const rows = s.left.filter((l) => l >= 0).length;
    expect(rows).toBeGreaterThan(g.height * 0.8);
    for (let y = 0; y < g.height; y++) if (s.left[y] >= 0) expect(s.right[y]).toBeGreaterThanOrEqual(s.left[y]);
  });

  it('draws the ship at its berth, clamps locked green, and a deck over a dimmed hull', () => {
    const g = buildFighter();
    const s = makeDockSprite(g);
    const L = dockLayout(s.w, s.h, 16 / 9, false);
    const B = buildDockBase(L, s.w, s.h, makeLife(L, s.w, s.h));
    const img = frame(L.W, L.H);
    renderDock(L, B, s, { t: 1, shipY: L.sy, e: 1, docked: true, layer: 0 }, img, frame(L.W, L.H));
    // A hull cell of the ship shows exactly the game's colour for it.
    const y = Math.floor(s.h / 2);
    const x = s.left[y] + 2;
    const o = (y * s.w + x) * 4;
    expect(px(img, L.sx + x, L.sy + y)).toEqual([s.views[0][o], s.views[0][o + 1], s.views[0][o + 2]]);
    // Some clamp lamp is lit green (locked).
    let green = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 0x63 && img.data[i + 1] === 0xe0 && img.data[i + 2] === 0x7a) green++;
    expect(green).toBeGreaterThanOrEqual(4);
  });

  it('shows a deck over a dimmed silhouette of the hull where the deck ends (the drawn battleship)', () => {
    const s = makeDockSprite(buildBattleship());
    const L = dockLayout(s.w, s.h, 16 / 9, false);
    const B = buildDockBase(L, s.w, s.h, makeLife(L, s.w, s.h));
    const deck = frame(L.W, L.H);
    renderDock(L, B, s, { t: 1, shipY: L.sy, e: 1, docked: true, layer: s.views.length - 1 }, deck, frame(L.W, L.H));
    const top = s.views[s.views.length - 1];
    let dimmed = 0;
    for (let yy = 0; yy < s.h; yy++)
      for (let xx = 0; xx < s.w; xx++) {
        const oo = (yy * s.w + xx) * 4;
        if (s.views[0][oo + 3] > 0 && top[oo + 3] === 0) {
          const c = px(deck, L.sx + xx, L.sy + yy);
          expect(c[0]).toBeLessThanOrEqual(s.views[0][oo] * 0.3 + 1);
          dimmed++;
        }
      }
    expect(dimmed).toBeGreaterThan(100);
  });

  it('draws no locked clamps while the arms are pulled back', () => {
    const g = buildFighter();
    const s = makeDockSprite(g);
    const L = dockLayout(s.w, s.h, 16 / 9, false);
    const B = buildDockBase(L, s.w, s.h, makeLife(L, s.w, s.h));
    const img = frame(L.W, L.H);
    renderDock(L, B, s, { t: 1, shipY: -s.h - 6, e: 0, docked: false, layer: 0 }, img, frame(L.W, L.H));
    let green = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 0x63 && img.data[i + 1] === 0xe0 && img.data[i + 2] === 0x7a) green++;
    expect(green).toBe(0);
  });
});
