import { describe, expect, it } from 'vitest';
import { ASTRO_H, ASTRO_W, astronautPixels } from '../src/render/astronaut';
import type { CrewRole } from '../src/sim/crew';

const ROLES: CrewRole[] = ['pilot', 'gunner', 'shieldop', 'engineer'];
const at = (px: Uint8ClampedArray, x: number, y: number) => ({ r: px[(y * ASTRO_W + x) * 4], g: px[(y * ASTRO_W + x) * 4 + 1], b: px[(y * ASTRO_W + x) * 4 + 2], a: px[(y * ASTRO_W + x) * 4 + 3] });

describe('astronaut sprites', () => {
  it('are 41×20 and have something drawn', () => {
    for (const role of ROLES) {
      const px = astronautPixels(role);
      expect(px.length).toBe(ASTRO_W * ASTRO_H * 4);
      let filled = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] === 255) filled++;
      expect(filled).toBeGreaterThan(400);
    }
  });

  it('wear the colour of their profession', () => {
    // a pixel of the sleeve, in the same place for every profession
    const sleeve = (role: CrewRole) => at(astronautPixels(role), 3, 2);
    const p = sleeve('pilot');
    expect(p.b).toBeGreaterThan(p.r + 40);
    const g = sleeve('gunner');
    expect(g.r).toBeGreaterThan(g.g + 60);
    expect(g.r).toBeGreaterThan(g.b + 60);
    const s = sleeve('shieldop');
    expect(s.b).toBeGreaterThan(s.g + 40);
    expect(s.r).toBeGreaterThan(s.g + 20);
    const e = sleeve('engineer');
    expect(e.r).toBeGreaterThan(e.b + 80);
    expect(e.g).toBeGreaterThan(e.b + 40);
  });

  it('carry their own gear in the left hand, and keep both hands', () => {
    const left = (role: CrewRole) => at(astronautPixels(role), 3, 12);
    const seen = new Set(ROLES.map((r) => JSON.stringify(left(r))));
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (const role of ROLES) {
      const px = astronautPixels(role);
      // a hand at the bottom of each side
      expect(at(px, 5, 17).a).toBe(255);
      expect(at(px, ASTRO_W - 1 - 5, 17).a).toBe(255);
    }
  });
});
