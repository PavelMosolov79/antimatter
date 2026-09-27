import { describe, expect, it } from 'vitest';
import { CoreScene, RRING, makeSky } from '../src/title/coreArt';
import { titleLayout } from '../src/title/titleScreen';

function frame(W: number, H: number): ImageData {
  return { data: new Uint8ClampedArray(W * H * 4), width: W, height: H, colorSpace: 'srgb' } as ImageData;
}

function pixel(img: ImageData, x: number, y: number): [number, number, number] {
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

describe('title layout', () => {
  it('keeps the 256×144 design on a 16:9 screen, the core to the right of the list', () => {
    const L = titleLayout(1280, 720);
    expect(L.mode).toBe('landscape');
    expect(L.u).toBeCloseTo(5, 6);
    expect([L.W, L.H]).toEqual([256, 144]);
    expect(L.loadCore).toEqual({ x: 128, y: 78 });
    expect(L.menuCore).toEqual({ x: 176, y: 78 });
  });

  it('widens the sky on a wide screen and keeps the core clear of the menu', () => {
    const L = titleLayout(2560, 1080);
    expect(L.H).toBe(144);
    expect(L.W).toBeGreaterThan(256);
    // The list runs from x 14 to 116 art pixels; the core and its clamps start past it.
    expect(L.menuCore.x - RRING - 6).toBeGreaterThan(116);
  });

  it('turns portrait on a tall phone: 144 art pixels across, the list below the core', () => {
    const L = titleLayout(390, 844);
    expect(L.mode).toBe('portrait');
    expect(L.W).toBe(144);
    expect(L.H).toBeGreaterThanOrEqual(256);
    expect(L.menuCore.y + RRING + 6).toBeLessThan(167);
  });

  it('keeps a squarish window in landscape, never narrower than the design', () => {
    const L = titleLayout(800, 800);
    expect(L.mode).toBe('landscape');
    expect(L.W).toBeGreaterThanOrEqual(256);
    expect(L.H).toBeGreaterThanOrEqual(144);
  });
});

describe('core art', () => {
  const L = titleLayout(1280, 720);

  it('draws the same sky every time', () => {
    const a = makeSky(L.W, L.H, L.sky);
    const b = makeSky(L.W, L.H, L.sky);
    expect(a.base).toEqual(b.base);
  });

  it('fills the chamber with antimatter as loading goes on', () => {
    const sky = makeSky(L.W, L.H, L.sky);
    const empty = new CoreScene(sky, 128, 78);
    const full = new CoreScene(sky, 128, 78);
    empty.p = 0;
    full.p = 1;
    const a = frame(L.W, L.H);
    const b = frame(L.W, L.H);
    empty.render(a, frame(L.W, L.H));
    full.render(b, frame(L.W, L.H));
    // Between the centre and the wall, off the lattice's spokes and rings: dark glass when
    // empty, substance when full.
    const glass = pixel(a, 128 + 15, 78 + 7);
    const anti = pixel(b, 128 + 15, 78 + 7);
    expect(glass[0] + glass[1] + glass[2]).toBeLessThan(90);
    expect(anti).not.toEqual(glass);
    expect(anti[2]).toBeGreaterThan(anti[1]); // violet, not green
  });

  it('lights the eight clamps one by one with the fill', () => {
    const sky = makeSky(L.W, L.H, L.sky);
    const lit = (p: number) => {
      const s = new CoreScene(sky, 128, 78);
      s.p = p;
      const img = frame(L.W, L.H);
      s.render(img, frame(L.W, L.H));
      // Count lit (magenta) pixels on the ring's radius only — the substance's rim is the same colour.
      let n = 0;
      for (let y = 0; y < L.H; y++) {
        for (let x = 0; x < L.W; x++) {
          const d = Math.hypot(x + 0.5 - 128, y + 0.5 - 78);
          if (d < RRING - 3.5 || d > RRING + 3.5) continue;
          const [r, g, b] = pixel(img, x, y);
          if (r > 180 && g < 120 && b > 140) n++;
        }
      }
      return n;
    };
    const quarter = lit(0.25);
    const all = lit(1);
    expect(lit(0)).toBe(0);
    expect(quarter).toBeGreaterThan(0);
    expect(all).toBeGreaterThan(quarter * 3);
  });

  it('turns the left pipe down through a junction box when the menu needs the room', () => {
    const sky = makeSky(L.W, L.H, L.sky);
    const s = new CoreScene(sky, 176, 78, { leftDown: true });
    s.p = 1;
    const img = frame(L.W, L.H);
    s.render(img, frame(L.W, L.H));
    const bend = 176 - RRING - 10;
    expect(pixel(img, bend, 78)).toEqual([90, 220, 255]); // the junction's status light
    // No pipe on the far left at the core's height any more; the vertical run is below the box.
    const farLeft = pixel(img, 10, 77);
    expect(farLeft).not.toEqual([34, 78, 96]);
    expect(pixel(img, bend - 1, 120)).toEqual([34, 78, 96]);
  });
});
