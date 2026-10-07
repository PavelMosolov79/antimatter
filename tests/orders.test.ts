import { describe, expect, it } from 'vitest';
import { isOre } from '../src/sim/mining';
import { attackOrder, attackRange, inspectOrder, mineOrder, pickAt, stepOrder, type Order } from '../src/sim/orders';
import { makeRock } from '../src/sim/rocks';
import { buildFighter, playerShip } from '../src/sim/ships';
import { wreckBody } from '../src/sim/wrecks';
import { World } from '../src/sim/world';

const DT = 1 / 60;

/** Runs the world with an order, as the game does: the order steers, then the world steps. */
function run(w: World, order: Order | null, seconds: number): Order | null {
  for (let i = 0; i < seconds * 60; i++) {
    if (order) {
      order = stepOrder(w, order, DT);
      if (!order) {
        w.hold = false;
        w.holdFace = null;
      }
    }
    w.step(DT);
    w.notes.length = 0;
    w.events.length = 0;
  }
  return order;
}

function oreLeft(g: { mat: Uint8Array }): number {
  let n = 0;
  for (let i = 0; i < g.mat.length; i++) if (isOre(g.mat[i])) n++;
  return n;
}

describe('what a click is on', () => {
  it('tells an enemy, a rock with ore, a wreck to look over and empty space apart', () => {
    const w = new World(2);
    w.spawnShip(playerShip('cruiser'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const foe = w.spawnShip(buildFighter('raider'), 300, 0, 0, { name: 'E', team: 1 });
    const rock = w.spawn(makeRock(12, 16, 1, 0.5), -300, 0, 0, 'debris');
    rock.anchored = true;
    const bare = w.spawn(makeRock(7, 14, 0), 0, 300, 0, 'debris');
    bare.anchored = true;
    w.addCelestial(wreckBody(0, -500, 4, 'enemy'));
    const wreck = w.inspectable()[0];
    expect(pickAt(w, foe.x, foe.y).kind).toBe('enemy');
    expect(pickAt(w, rock.x, rock.y).kind).toBe('ore');
    // a rock with no ore in it is just a place to fly to
    expect(pickAt(w, bare.x, bare.y).kind).toBe('space');
    expect(pickAt(w, wreck.x, wreck.y).kind).toBe('wreck');
    expect(pickAt(w, 900, 900).kind).toBe('space');
  });
});

describe('orders', () => {
  it('an attack keeps the guns\' range round its target and ends when the target is dead', () => {
    const w = new World(5);
    const p = w.spawnShip(playerShip('cruiser'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const foe = w.spawnShip(buildFighter('raider'), 600, 0, 0, { name: 'E', team: 1 });
    foe.anchored = true;
    w.autopilot = false;
    let order: Order | null = attackOrder(w, foe);
    order = run(w, order, 25);
    const ship = w.findShip(foe.shipId);
    if (ship && !ship.sys!.dead) {
      expect(order).not.toBeNull();
      const d = Math.hypot(p.x - ship.x, p.y - ship.y);
      const r = attackRange(p);
      expect(d).toBeGreaterThan(r * 0.6);
      expect(d).toBeLessThan(r * 1.5);
      ship.sys!.dead = true;
    }
    expect(stepOrder(w, order ?? attackOrder(w, foe), DT)).toBeNull();
  });

  it('mining comes to the chosen rock, stops and burns only its veins', () => {
    const w = new World(3);
    const p = w.spawnShip(playerShip('cruiser'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const hull = p.grid.cells;
    const chosen = w.spawn(makeRock(12, 16, 1, 0.5), 420, -60, 0, 'debris');
    chosen.anchored = true;
    // another rock with ore on the way, nearer to the ship
    const other = w.spawn(makeRock(31, 14, 1, 0.5), 200, 60, 0, 'debris');
    other.anchored = true;
    const before = oreLeft(chosen.grid);
    const otherBefore = oreLeft(other.grid);
    w.autopilot = false;
    w.mineTarget = chosen.id;
    const order = run(w, mineOrder(chosen), 40);
    expect(oreLeft(chosen.grid)).toBeLessThan(before - 3);
    expect(oreLeft(other.grid)).toBe(otherBefore);
    // it stood off the rock: no cell of the ship lost to a bump
    expect(p.grid.cells).toBe(hull);
    expect(order === null || order.kind === 'mine').toBe(true);
  });

  it('looking a wreck over brings the ship close and slow until it is done', () => {
    const w = new World(1);
    w.addCelestial(wreckBody(0, 0, 7, 'enemy'));
    const hull = w.inspectable()[0];
    w.spawnShip(buildFighter('strike'), hull.x + hull.radius + 500, hull.y, 0, { name: 'P', team: 0, player: true });
    w.autopilot = false;
    const order = run(w, inspectOrder(hull), 30);
    expect(order).toBeNull();
    expect(w.inspectable().length).toBe(0);
  });

  it('holding stops the ship on the point even with the autopilot off', () => {
    const w = new World(1);
    const p = w.spawnShip(buildFighter('strike'), 0, 0, 0, { name: 'P', team: 0, player: true });
    w.autopilot = false;
    w.hold = true;
    w.target = { x: 0, y: -300 };
    run(w, null, 20);
    expect(Math.hypot(p.x, p.y + 300)).toBeLessThan(12);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThan(3);
  });
});
