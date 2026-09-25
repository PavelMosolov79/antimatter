import { describe, expect, it } from 'vitest';
import { buildBattleshipArt } from '../src/sim/battleshipArt';
import { buildRooms, type RoomGraph } from '../src/sim/compartments';
import { spawnCrew } from '../src/sim/crew';
import { Mat } from '../src/sim/materials';
import { buildBattleship } from '../src/sim/ships';
import { World } from '../src/sim/world';

function roomAt(graph: RoomGraph, x: number, y: number, z: number): number {
  return graph.cellRoom[graph.grid.idx(x, y, z)];
}

/** Room ids reachable from `start` through doors and ladders. */
function reachable(graph: RoomGraph, start: number): Set<number> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const r = queue.shift()!;
    for (const e of graph.edges) {
      const other = e.a === r ? e.b : e.b === r ? e.a : -1;
      if (other >= 0 && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen;
}

describe('battleship', () => {
  it('is a 130×190 hull with two decks', () => {
    const g = buildBattleship();
    expect(g.width).toBe(130);
    expect(g.height).toBe(190);
    expect(g.depth).toBe(3);
  });

  it('looks exactly like the concept art: every drawn pixel is on the ship in its drawn colour', () => {
    const art = buildBattleshipArt();
    const g = buildBattleship();
    let drawn = 0;
    art.layers.forEach((layer, z) => {
      for (let y = 0; y < art.h; y++) {
        for (let x = 0; x < art.w; x++) {
          const li = y * art.w + x;
          const gi = g.idx(x, y, z);
          if (layer.mat[li] === 0) {
            expect(g.mat[gi]).toBe(0);
            continue;
          }
          drawn++;
          expect(g.mat[gi]).not.toBe(0);
          expect(g.paintFlags![gi] & 1).toBe(1);
          for (let c = 0; c < 3; c++) expect(Math.abs(g.paintRGB![gi * 3 + c] - layer.color[li * 3 + c])).toBeLessThanOrEqual(0.5);
          expect((g.paintFlags![gi] & 2) !== 0).toBe(layer.glow[li] !== 0);
        }
      }
    });
    expect(drawn).toBeGreaterThan(30000);
  });

  it('builds every module intact — nothing was placed on top of anything else', () => {
    const g = buildBattleship();
    for (const m of g.modules) {
      expect(m.total).toBeGreaterThan(0);
      expect(m.alive).toBe(m.total);
      expect(m.coreAlive).toBe(true);
    }
    const count = (kind: string) => g.modules.filter((m) => m.kind === kind).length;
    expect(count('turret')).toBeGreaterThanOrEqual(10);
    expect(count('engine')).toBe(5);
    expect(count('bridge')).toBe(2);
    expect(count('reactor')).toBe(1);
    expect(count('shield')).toBe(1);
    expect(count('thruster')).toBeGreaterThanOrEqual(4);
  });

  it('uses the new decor materials inside, and the reactor core is part of the reactor module', () => {
    const g = buildBattleship();
    const has = (m: number) => g.mat.some((v) => v === m);
    expect(has(Mat.SEAT)).toBe(true);
    expect(has(Mat.CONSOLE)).toBe(true);
    const reactor = g.modules.find((m) => m.kind === 'reactor')!;
    expect(reactor.cells.some((i) => g.mat[i] === Mat.CORE)).toBe(true);
  });

  it('connects every room on both decks through doors and ladders', () => {
    const graph = buildRooms(buildBattleship());
    const rooms = [
      roomAt(graph, 65, 29, 1), // thruster access
      roomAt(graph, 60, 48, 1), // service bay
      roomAt(graph, 60, 70, 1), // shield bay
      roomAt(graph, 64, 100, 1), // bridge
      roomAt(graph, 55, 135, 1), // reactor
      roomAt(graph, 50, 150, 2), // turret access
      roomAt(graph, 80, 150, 2), // engine control
    ];
    for (const r of rooms) expect(r).toBeGreaterThanOrEqual(0);
    expect(new Set(rooms).size).toBe(rooms.length);
    const fromBow = reachable(graph, rooms[0]);
    for (const r of rooms) expect(fromBow.has(r)).toBe(true);
  });

  it('crews every post: a pilot, a gunner per turret, a shield operator and engineers', () => {
    const g = buildBattleship();
    const crew = spawnCrew(g);
    const n = (role: string) => crew.filter((c) => c.role === role).length;
    expect(n('pilot')).toBe(1);
    expect(n('gunner')).toBe(g.modules.filter((m) => m.kind === 'turret').length);
    expect(n('shieldop')).toBe(1);
    expect(n('engineer')).toBeGreaterThanOrEqual(1);
  });

  it('flies as the player ship without errors', () => {
    const world = new World(1);
    world.spawnShip(buildBattleship(), 0, 0, 0, { name: 'Линкор', team: 0, player: true });
    expect(() => {
      for (let i = 0; i < 120; i++) world.step(1 / 60);
    }).not.toThrow();
  });
});
