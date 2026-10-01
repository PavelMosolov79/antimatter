import { describe, expect, it } from 'vitest';
import { renderHole } from '../src/render/space/holeGen';
import { tfbm } from '../src/render/space/noise';
import { renderPlanet } from '../src/render/space/planetGen';
import { SKY_TILE, generateSky } from '../src/render/space/skyGen';
import { gravityAt } from '../src/sim/gravity';
import { mulberry32 } from '../src/sim/rng';
import { ARENA_CLEAR, PLANET_TYPES, SECTOR_IDS, SPACE, buildArena, genHole, genPlanet } from '../src/sim/space';

function pullAtOrigin(cels: ReturnType<typeof buildArena>): number {
  const out = { ax: 0, ay: 0 };
  gravityAt(cels, 0, 0, out);
  return Math.hypot(out.ax, out.ay);
}

describe('planets', () => {
  it('are the same for the same seed and differ between seeds', () => {
    expect(genPlanet(220)).toEqual(genPlanet(220));
    expect(genPlanet(220).R).not.toBe(genPlanet(221).R);
  });

  it('are about ten battleships across at the median, never below the minimum or above the maximum', () => {
    const diam: number[] = [];
    for (let s = 1; s <= 600; s++) {
      const p = genPlanet(s);
      expect(p.R).toBeGreaterThanOrEqual(SPACE.minRadius);
      expect(p.R).toBeLessThanOrEqual(SPACE.maxRadius);
      diam.push((2 * p.R) / SPACE.battleship);
    }
    diam.sort((a, b) => a - b);
    const median = diam[diam.length >> 1];
    expect(median).toBeGreaterThan(7);
    expect(median).toBeLessThan(13);
  });

  it('pull harder at the surface the bigger they are, and mu = g0 · R²', () => {
    const small = genPlanet(5, { type: 'rocky', diamShips: 4 });
    const big = genPlanet(5, { type: 'rocky', diamShips: 20 });
    expect(big.g0).toBeGreaterThan(small.g0);
    expect(big.g0 / small.g0).toBeLessThan(big.R / small.R);
    expect(big.mu).toBeCloseTo(big.g0 * big.R * big.R, 3);
  });

  it('have every type reachable', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 300; s++) seen.add(genPlanet(s).type);
    expect(seen.size).toBe(PLANET_TYPES.length);
  });
});

describe('black holes', () => {
  it('with M = 2 are the hole the game had before', () => {
    const h = genHole(1, { M: 2 });
    expect(h.R0).toBe(24);
    expect(h.mu).toBeCloseTo(176000, 0);
    expect(h.small).toBe(true);
  });

  it('pull and size grow with mass; large ones are huge', () => {
    const a = genHole(1, { M: 3 });
    const b = genHole(1, { M: 60 });
    expect(b.mu).toBeGreaterThan(a.mu * 20);
    expect(b.R0).toBeGreaterThan(a.R0);
    expect(genHole(7, { cls: 'large' }).small).toBe(false);
    expect(genHole(7, { cls: 'small' }).small).toBe(true);
  });
});

describe('arena', () => {
  it('always has a planet, a star, and keeps the spawn points clear', () => {
    for (const sector of SECTOR_IDS) {
      for (let s = 1; s <= 80; s++) {
        for (const gentle of [false, true]) {
          const cels = buildArena(mulberry32(s * 31 + 7), sector, { gentle });
          expect(cels.some((c) => c.kind === 'planet')).toBe(true);
          expect(cels.some((c) => c.kind === 'star')).toBe(true);
          for (const c of cels) {
            for (const p of ARENA_CLEAR) expect(Math.hypot(c.x - p.x, c.y - p.y) - c.radius).toBeGreaterThan(p.r - 1);
          }
        }
      }
    }
  });

  it('sits in a weak field at the spawn: the pull there is gentle', () => {
    for (let s = 1; s <= 80; s++) {
      const g = pullAtOrigin(buildArena(mulberry32(s), 'green'));
      expect(g).toBeGreaterThan(0.3);
      expect(g).toBeLessThan(3.6);
    }
  });

  it('puts the planet below the spawn, away from where enemies come from', () => {
    for (let s = 1; s <= 80; s++) {
      const planet = buildArena(mulberry32(s), 'ice').find((c) => c.kind === 'planet')!;
      expect(planet.y).toBeGreaterThan(0);
    }
  });

  it('gives the crimson sector a small hole and the boss arena a huge one, others none', () => {
    const holes = (cels: ReturnType<typeof buildArena>) => cels.filter((c) => c.kind === 'blackhole');
    expect(holes(buildArena(mulberry32(3), 'crimson'))).toHaveLength(1);
    expect(holes(buildArena(mulberry32(3), 'violet'))).toHaveLength(0);
    const big = holes(buildArena(mulberry32(3), 'violet', { hole: 'large' }))[0];
    expect(big.radius).toBeGreaterThan(400);
  });

  it('is the same for the same random stream', () => {
    expect(buildArena(mulberry32(9), 'violet')).toEqual(buildArena(mulberry32(9), 'violet'));
  });
});

describe('space pictures', () => {
  it('sky tiles are the right size, painted, and seamless at the edges', () => {
    for (const sector of SECTOR_IDS) {
      const sky = generateSky(sector, 12);
      for (const layer of [sky.far, sky.near, sky.dust]) {
        expect(layer.length).toBe(SKY_TILE * SKY_TILE * 4);
        let painted = 0;
        for (let i = 3; i < layer.length; i += 4) if (layer[i] > 0) painted++;
        expect(painted).toBeGreaterThan(0);
      }
    }
    // the noise itself wraps: the value one tile along equals the value at the start
    for (const [u, v] of [[0.3, 1.7], [5.2, 0.1]]) {
      expect(tfbm(u + 8, v, 8, 3, 4)).toBeCloseTo(tfbm(u, v, 8, 3, 4), 9);
      expect(tfbm(u, v + 8, 8, 3, 4)).toBeCloseTo(tfbm(u, v, 8, 3, 4), 9);
    }
  });

  it('planets and holes come out painted, with a pixel size that covers their radius', () => {
    for (const type of ['rocky', 'gas', 'lava', 'ocean'] as const) {
      const spec = genPlanet(41, { type });
      const pic = renderPlanet(spec);
      expect(pic.data.length).toBe(pic.w * pic.h * 4);
      expect(pic.texel).toBeGreaterThanOrEqual(1);
      expect(pic.w * pic.texel).toBeGreaterThanOrEqual(spec.R * 1.9);
      let painted = 0;
      for (let i = 3; i < pic.data.length; i += 4) if (pic.data[i] > 0) painted++;
      expect(painted).toBeGreaterThan(pic.w * pic.h * 0.2);
    }
    for (const M of [2, 60]) {
      const spec = genHole(3, { M });
      const pic = renderHole(spec);
      expect(pic.data.length).toBe(pic.w * pic.h * 4);
      let painted = 0;
      for (let i = 3; i < pic.data.length; i += 4) if (pic.data[i] > 0) painted++;
      expect(painted).toBeGreaterThan(100);
    }
  });
});
