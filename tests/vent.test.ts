import { describe, expect, it } from 'vitest';
import { COMPARTMENTS, ensureRooms } from '../src/sim/compartments';
import { playerShip } from '../src/sim/ships';
import { World } from '../src/sim/world';

const DT = 1 / 60;

function breached(): { w: World; room: ReturnType<typeof ensureRooms>['rooms'][number] } {
  const w = new World(1);
  const p = w.spawnShip(playerShip('cruiser'), 0, 0, 0, { name: 'P', team: 0, player: true });
  const graph = ensureRooms(p);
  const room = graph.rooms.filter((r) => r.z > 0 && r.cells.length > 30).sort((a, b) => b.cells.length - a.cells.length)[0];
  // blow the hull away above one cell of the room
  const i = room.cells[Math.floor(room.cells.length / 2)];
  const g = p.grid;
  for (let z = 0; z < room.z; z++) {
    const j = g.idx(g.xOf(i), g.yOf(i), z);
    if (g.mat[j] !== 0) g.removeCell(j);
  }
  return { w, room };
}

describe('air going out of a hole', () => {
  it('shows as puffs from the hole, away from the room, while the room still has air', () => {
    const { w, room } = breached();
    let vents = 0;
    for (let t = 0; t < 120; t++) {
      w.step(DT);
      for (const e of w.events) {
        if (e.t !== 'vent') continue;
        vents++;
        expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
        expect(Math.hypot(e.dx, e.dy)).toBeCloseTo(1, 3);
        expect(e.k).toBeGreaterThanOrEqual(0);
        expect(e.k).toBeLessThanOrEqual(1);
      }
      w.events.length = 0;
    }
    expect(vents).toBeGreaterThan(5);
    expect(room.pressure).toBeLessThan(1);
  });

  it('stops when the room is empty, and when the hole is patched', () => {
    const { w, room } = breached();
    room.pressure = COMPARTMENTS.ventMinPressure / 2;
    w.step(DT);
    w.events.length = 0;
    for (let t = 0; t < 30; t++) w.step(DT);
    expect(w.events.some((e) => e.t === 'vent')).toBe(false);
    room.pressure = 0.8;
    room.patched = true;
    room.patchHoles = room.holes;
    for (let t = 0; t < 30; t++) w.step(DT);
    expect(w.events.some((e) => e.t === 'vent')).toBe(false);
  });
});
