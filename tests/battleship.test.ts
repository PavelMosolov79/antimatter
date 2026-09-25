import { describe, expect, it } from 'vitest';
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

  it('builds every module intact — nothing was placed on top of anything else', () => {
    const g = buildBattleship();
    for (const m of g.modules) {
      expect(m.alive).toBe(m.total);
      expect(m.coreAlive).toBe(true);
    }
    const count = (kind: string) => g.modules.filter((m) => m.kind === kind).length;
    expect(count('turret')).toBe(10);
    expect(count('engine')).toBe(5);
    expect(count('bridge')).toBe(2);
    expect(count('reactor')).toBe(1);
    expect(count('shield')).toBe(1);
  });

  it('furnishes the interior with seats, consoles and a glowing reactor core', () => {
    const g = buildBattleship();
    const has = (m: number) => g.mat.some((v) => v === m);
    expect(has(Mat.SEAT)).toBe(true);
    expect(has(Mat.CONSOLE)).toBe(true);
    expect(has(Mat.CORE)).toBe(true);
    const reactor = g.modules.find((m) => m.kind === 'reactor')!;
    expect(reactor.cells.some((i) => g.mat[i] === Mat.CORE)).toBe(true);
  });

  it('connects the whole deck-1 chain and both deck-2 rooms through doors and ladders', () => {
    const graph = buildRooms(buildBattleship());
    const chain = [
      roomAt(graph, 64, 30, 1), // thruster access
      roomAt(graph, 64, 50, 1), // service bay
      roomAt(graph, 60, 70, 1), // shield bay
      roomAt(graph, 64, 100, 1), // bridge
      roomAt(graph, 55, 135, 1), // reactor
      roomAt(graph, 55, 155, 2), // turret access
      roomAt(graph, 70, 155, 2), // engine control
    ];
    for (const r of chain) expect(r).toBeGreaterThanOrEqual(0);
    expect(new Set(chain).size).toBe(chain.length);
    const fromBow = reachable(graph, chain[0]);
    for (const r of chain) expect(fromBow.has(r)).toBe(true);
  });

  it('crews every post: a pilot, ten gunners, a shield operator and engineers', () => {
    const crew = spawnCrew(buildBattleship());
    const n = (role: string) => crew.filter((c) => c.role === role).length;
    expect(n('pilot')).toBe(1);
    expect(n('gunner')).toBe(10);
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
