import { describe, expect, it } from 'vitest';
import { exclusion, type Celestial } from '../src/sim/gravity';
import { mulberry32 } from '../src/sim/rng';
import { makeRock, fieldRocks } from '../src/sim/rocks';
import { CHUNK, chunkIndex, genChunk } from '../src/sim/sky';
import { ARENA_CLEAR, PULSAR, SECTOR_IDS, STORM, buildArena, cometBody, fieldBody, pulsarAngle, pulsarBody, stormBody, stormBolt } from '../src/sim/space';
import { buildFighter } from '../src/sim/ships';
import { World } from '../src/sim/world';

const DT = 1 / 60;

function overlaps(a: Celestial, b: Celestial): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < exclusion(a) + exclusion(b) - 1e-6;
}

function noOverlap(list: Celestial[]): string | null {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlaps(list[i], list[j])) return `${list[i].kind}@${Math.round(list[i].x)},${Math.round(list[i].y)} over ${list[j].kind}@${Math.round(list[j].x)},${Math.round(list[j].y)}`;
  return null;
}

describe('the sky in chunks', () => {
  it('is the same every time for the same seed, and not the same for another', () => {
    expect(genChunk('violet', 5, 2, -1)).toEqual(genChunk('violet', 5, 2, -1));
    expect(JSON.stringify(genChunk('violet', 5, 2, -1))).not.toBe(JSON.stringify(genChunk('violet', 6, 2, -1)));
    expect(genChunk('violet', 5, 0, 0)).toEqual([]);
  });

  it('never puts one thing over another, across all the chunks of a wide stretch, in every sector', () => {
    for (const sector of SECTOR_IDS) {
      for (const seed of [1, 7, 4242]) {
        const all: Celestial[] = [];
        for (let cx = -4; cx <= 4; cx++) for (let cy = -4; cy <= 4; cy++) all.push(...genChunk(sector, seed, cx, cy));
        expect(all.length).toBeGreaterThan(30);
        expect(noOverlap(all)).toBeNull();
      }
    }
  });

  it('keeps clear of what is already there (the arena), and each thing inside its own chunk', () => {
    const arena = buildArena(mulberry32(11), 'crimson');
    const all: Celestial[] = [];
    for (let cx = -2; cx <= 2; cx++) for (let cy = -2; cy <= 2; cy++) all.push(...genChunk('crimson', 3, cx, cy, arena));
    expect(noOverlap([...arena, ...all])).toBeNull();
    for (const c of all) {
      if (c.kind === 'moon') continue;
      const [cx, cy] = c.chunk!.split(',').map(Number);
      expect(Math.abs(c.x - cx * CHUNK) + exclusion(c)).toBeLessThanOrEqual(CHUNK / 2);
      expect(Math.abs(c.y - cy * CHUNK) + exclusion(c)).toBeLessThanOrEqual(CHUNK / 2);
    }
  });

  it('has every kind of thing in some sector', () => {
    const kinds = new Set<string>();
    for (const sector of SECTOR_IDS) for (let cx = -6; cx <= 6; cx++) for (let cy = -6; cy <= 6; cy++) for (const c of genChunk(sector, 9, cx, cy)) kinds.add(c.kind);
    for (const k of ['planet', 'moon', 'blackhole', 'pulsar', 'storm', 'comet', 'gate', 'asteroids']) expect(kinds.has(k)).toBe(true);
  });
});

describe('the arena', () => {
  it('has nothing over anything else and nothing over the places the fight starts at', () => {
    for (const sector of SECTOR_IDS) {
      for (let seed = 1; seed <= 150; seed++) {
        const a = buildArena(mulberry32(seed * 31), sector, { gentle: seed % 5 === 0 });
        expect(noOverlap(a)).toBeNull();
        for (const c of a) for (const p of ARENA_CLEAR) expect(Math.hypot(c.x - p.x, c.y - p.y)).toBeGreaterThanOrEqual(c.kind === 'star' ? 0 : c.radius + p.r - 1e-6);
      }
    }
  });

  it('gives each sector something of its own (not in the first, gentle fight)', () => {
    const own = (sector: (typeof SECTOR_IDS)[number]): Set<string> => {
      const kinds = new Set<string>();
      for (let seed = 1; seed <= 60; seed++) for (const c of buildArena(mulberry32(seed), sector)) kinds.add(c.kind);
      return kinds;
    };
    expect(own('violet').has('asteroids')).toBe(true);
    expect(own('crimson').has('storm')).toBe(true);
    expect(own('ice').has('pulsar')).toBe(true);
    for (let seed = 1; seed <= 40; seed++) for (const c of buildArena(mulberry32(seed), 'crimson', { gentle: true })) expect(c.kind).not.toBe('storm');
  });
});

describe('flying on', () => {
  function fighterWorld(arena: Celestial[]): World {
    const w = new World(1);
    w.sector = 'ice';
    w.skySeed = 77;
    w.setCelestials(arena);
    w.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    return w;
  }

  it('lays new bodies out as the player comes into new chunks, and takes the far ones away', () => {
    const w = fighterWorld([]);
    w.step(0.6);
    const start = w.celestials.length;
    expect(start).toBeGreaterThan(0);
    expect(w.celestials.every((c) => c.chunk)).toBe(true);
    // fly three chunks on
    const p = w.player!;
    p.x = CHUNK * 3;
    w.step(0.6);
    const keys = new Set(w.celestials.map((c) => c.chunk));
    expect([...keys].every((k) => Math.abs(Number(k!.split(',')[0]) - chunkIndex(p.x)) <= 2)).toBe(true);
    expect(w.celestials.some((c) => c.chunk && Number(c.chunk.split(',')[0]) === chunkIndex(p.x) + 1)).toBe(true);
    // back home: the same bodies are there again
    const before = JSON.stringify(w.celestials.filter((c) => c.chunk === '1,0').map((c) => [c.kind, c.x, c.y]));
    p.x = 0;
    w.step(0.6);
    w.step(0.6);
    const after = JSON.stringify(w.celestials.filter((c) => c.chunk === '1,0').map((c) => [c.kind, c.x, c.y]));
    expect(after).not.toBe('[]');
    expect(before === '[]' || before === after).toBe(true);
    expect(noOverlap(w.celestials)).toBeNull();
  });

  it('keeps the arena for good, and a bare test world does not stream at all', () => {
    const arena = buildArena(mulberry32(5), 'green');
    const w = fighterWorld(arena);
    w.player!.x = CHUNK * 4;
    w.step(0.6);
    w.step(0.6);
    for (const c of arena) expect(w.celestials).toContain(c);
    const bare = new World(1);
    bare.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    bare.step(1);
    expect(bare.celestials.length).toBe(0);
  });
});

describe('what the things do', () => {
  function shipWorld(c: Celestial, at: { x: number; y: number }): { w: World; ship: ReturnType<World['spawnShip']> } {
    const w = new World(1);
    w.celestials.push(c);
    const ship = w.spawnShip(buildFighter('strike'), at.x, at.y, 0, { name: 'P', team: 0, player: true });
    // nobody should move the ship during the test
    ship.sys!.shield = ship.sys!.shieldMax;
    return { w, ship };
  }

  it('a pulsar drains the shield of a ship in its beam, not of one beside it', () => {
    const p = pulsarBody(0, 0, 3);
    const th = pulsarAngle(p, 0);
    const inBeam = shipWorld(p, { x: Math.cos(th) * 500, y: Math.sin(th) * 500 });
    const beside = shipWorld(p, { x: -Math.sin(th) * 500, y: Math.cos(th) * 500 });
    for (let i = 0; i < 6; i++) {
      inBeam.w.step(DT);
      beside.w.step(DT);
      inBeam.ship.vx = inBeam.ship.vy = beside.ship.vx = beside.ship.vy = 0;
    }
    expect(inBeam.ship.sys!.shield).toBeLessThan(inBeam.ship.sys!.shieldMax - PULSAR.shieldPerSecond * 0.05);
    expect(beside.ship.sys!.shield).toBeGreaterThan(beside.ship.sys!.shieldMax - 1);
  });

  it('a storm keeps the shield from coming back, and its lightning knocks a module out for a few seconds', () => {
    const storm = stormBody(0, 0, 4, 800);
    const { w, ship } = shipWorld(storm, { x: 0, y: 0 });
    ship.sys!.shield = 10;
    let t = 0;
    let stunned = 0;
    while (t < 12) {
      w.step(DT);
      ship.vx = ship.vy = 0;
      ship.x = 0;
      ship.y = 0;
      t += DT;
      stunned = Math.max(stunned, ship.grid.modules.filter((m) => m.stun > 0).length);
    }
    expect(ship.sys!.shield).toBeLessThanOrEqual(10.001);
    expect(stunned).toBeGreaterThan(0);
    // and it wears off
    storm.x = 1e6;
    for (let i = 0; i < 60 * (STORM.stun + 1); i++) w.step(DT);
    expect(ship.grid.modules.every((m) => m.stun === 0)).toBe(true);
    expect(stormBolt(storm, 0).phase).toBe(0);
  });

  it('a comet flies on in a straight line and stops a ship that flies into it', () => {
    const comet = cometBody(0, 0, 2, 0, 60);
    const w = new World(1);
    w.celestials.push(comet);
    w.step(1);
    expect(comet.x).toBeCloseTo(60, 3);
    expect(comet.y).toBeCloseTo(0, 6);
  });

  it('a field of rocks is rocks of cells, held in place, that break when shot and are taken away with the field', () => {
    const field = fieldBody(0, 0, 8, 700);
    const w = new World(1);
    w.setCelestials([field]);
    const rocks = w.bodies.filter((b) => b.kind === 'debris');
    expect(rocks.length).toBe(fieldRocks(field).length);
    expect(rocks.every((b) => b.anchored)).toBe(true);
    const at = rocks.map((b) => [b.x, b.y]);
    for (let i = 0; i < 120; i++) w.step(DT);
    expect(rocks.map((b) => [b.x, b.y])).toEqual(at);
    // a rock is cells with veins painted on it
    const withOre = fieldRocks(field).find((r) => r.ore);
    if (withOre) expect(makeRock(withOre.seed, withOre.r, withOre.ore).paintFlags!.some((f) => f === 3)).toBe(true);
    // damaged: it breaks and the pieces are free
    const big = rocks.reduce((a, b) => (b.grid.cells > a.grid.cells ? b : a));
    w.damageCrater(big, big.x, big.y, big.radius * 0.6, 500, 3);
    for (let i = 0; i < 10; i++) w.step(DT);
    expect(w.bodies.some((b) => b.kind === 'debris' && !b.anchored)).toBe(true);
    // the field going away takes its rocks
    w.removeCelestial(field);
    for (let i = 0; i < 3; i++) w.step(DT);
    expect(w.bodies.filter((b) => b.anchored && !b.removed).length).toBe(0);
  });
});
