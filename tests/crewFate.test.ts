import { beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import type { Scene } from '../src/render/scene';
import type { Crew } from '../src/sim/crew';
import { CREW } from '../src/sim/crewConfig';
import { mulberry32 } from '../src/sim/rng';
import { abandonShip, applyBattle, autoFill, emptyRoster, fall, healLeft, healPrice, healSeconds, healSpeedUpPrice, inBarracks, makeMember, onShip, settleHealing, startHeal, staffShip, wound } from '../src/sim/roster';
import { ROAD } from '../src/sim/road';
import { captureShip, restoreShip } from '../src/sim/runSave';
import { SHIPS } from '../src/sim/ships';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

const fighter = SHIPS[0];

function crewed() {
  const r = emptyRoster();
  const grid = fighter.build();
  staffShip(r, fighter.id, grid, mulberry32(1));
  return { r, grid };
}

describe('the people after a battle', () => {
  it('sends the dead and those lost with a piece of the hull to the memory, wounds the hurt, and counts the battle for everyone', () => {
    const { r } = crewed();
    const crew = onShip(r, fighter.id);
    const [a, b, c, d, ...rest] = crew;
    const out = applyBattle(r, fighter.id, [
      { memberId: a.id, dead: true, hurt: false },
      { memberId: b.id, dead: false, hurt: true },
      { memberId: c.id, dead: false, hurt: false },
      ...rest.map((m) => ({ memberId: m.id, dead: false, hurt: false })),
      // d is missing from the crew: it went with a piece of the hull
    ]);
    expect(out.died.map((f) => f.name).sort()).toEqual([a.name, d.name].sort());
    expect(r.members.find((m) => m.id === a.id)).toBeUndefined();
    expect(r.memory.map((f) => f.name)).toContain(a.name);
    expect(b.status).toBe('hurt');
    expect(b.ship).toBeNull();
    expect(b.post).toBeNull();
    expect(c.fights).toBe(1);
    expect(b.fights).toBe(1);
  });

  it('does not blame somebody who was not in the battle', () => {
    const { r } = crewed();
    const [a, b] = onShip(r, fighter.id);
    const out = applyBattle(r, fighter.id, [{ memberId: a.id, dead: false, hurt: false }], new Set([a.id]));
    expect(out.died).toEqual([]);
    expect(r.members.find((m) => m.id === b.id)).toBeDefined();
    expect(b.fights).toBe(0);
  });

  it('puts the best healthy people of the barracks on the empty posts, never a wounded one', () => {
    const { r, grid } = crewed();
    const rng = mulberry32(5);
    const pilot = onShip(r, fighter.id).find((m) => m.role === 'pilot')!;
    fall(r, pilot.id, 'battle');
    const weak = makeMember(r, rng, 'pilot', 2, 1);
    const strong = makeMember(r, rng, 'pilot', 6, 2);
    const hurtBest = makeMember(r, rng, 'pilot', 9, 3);
    r.members.push(weak, strong, hurtBest);
    wound(r, hurtBest.id);
    const placed = autoFill(r, fighter.id, grid);
    expect(placed.map((m) => m.id)).toEqual([strong.id]);
    expect(inBarracks(r).map((m) => m.id).sort()).toEqual([weak.id, hurtBest.id].sort());
  });
});

describe('healing the wounded', () => {
  it('takes time and credits, is shorter for the tough, and can be bought off with quanta', () => {
    const r = emptyRoster();
    const rng = mulberry32(2);
    const m = makeMember(r, rng, 'gunner', 3, 2);
    m.traits = [];
    r.members.push(m);
    wound(r, m.id);
    expect(m.status).toBe('hurt');
    expect(healPrice(m)).toBeGreaterThan(0);
    const t = healSeconds(m);
    expect(healLeft(m, 0)).toBe(t);
    expect(startHeal(r, m.id, 1000)).toBe(true);
    expect(startHeal(r, m.id, 1000)).toBe(false);
    expect(healLeft(m, 1000)).toBe(t);
    expect(healSpeedUpPrice(m, 1000)).toBe(Math.ceil(t / CREW.healQuantaSeconds));
    expect(settleHealing(r, 1000 + (t - 1) * 1000)).toBe(0);
    expect(settleHealing(r, 1000 + t * 1000)).toBe(1);
    expect(m.status).toBe('ok');
    const tough = makeMember(r, rng, 'gunner', 3, 2);
    tough.traits = ['tough'];
    expect(healSeconds(tough)).toBeLessThan(t);
  });
});

describe('a lost ship and its escape pods', () => {
  it('kills everybody when there are no pods', () => {
    const { r } = crewed();
    const n = onShip(r, fighter.id).length;
    const out = abandonShip(r, fighter.id, { seats: 0, chance: 0, med: 0 }, () => 0);
    expect(out.saved.length).toBe(0);
    expect(out.lost.length).toBe(n);
    expect(r.memory.length).toBe(n);
    expect(onShip(r, fighter.id).length).toBe(0);
  });

  it('gets the most experienced into the seats there are, wounded, and the rest die', () => {
    const { r } = crewed();
    const crew = onShip(r, fighter.id);
    crew.forEach((m, i) => (m.lv = i + 1));
    const top = [...crew].sort((a, b) => b.lv - a.lv).slice(0, 2).map((m) => m.id);
    const out = abandonShip(r, fighter.id, { seats: 2, chance: 1, med: 0 }, () => 0.5);
    expect(out.saved.map((m) => m.id).sort()).toEqual(top.sort());
    for (const m of out.saved) {
      expect(m.status).toBe('hurt');
      expect(m.ship).toBeNull();
    }
    expect(out.lost.length).toBe(crew.length - 2);
  });

  it('lets the dice decide at the chance given, with lucky people and the medical bay helping', () => {
    const { r } = crewed();
    const crew = onShip(r, fighter.id);
    crew.forEach((m) => (m.traits = []));
    // 0.55 fails at 50%, passes at 50% + a medical bay's half of 0.2
    const out = abandonShip(r, fighter.id, { seats: 99, chance: 0.5, med: 0.2 }, () => 0.59);
    expect(out.saved.length).toBe(crew.length);
    const { r: r2 } = crewed();
    onShip(r2, fighter.id).forEach((m) => (m.traits = []));
    expect(abandonShip(r2, fighter.id, { seats: 99, chance: 0.5, med: 0 }, () => 0.59).saved.length).toBe(0);
  });
});

describe('the run after the battle', () => {
  function newGame(): Game {
    const scene = { reset() {}, render() {}, layerView: -1 } as unknown as Scene;
    return new Game(scene);
  }

  function fight(g: Game, mutate: (crew: Crew[]) => void): void {
    g.travel(1);
    expect(g.runPhase).toBe('battle');
    mutate(g.world.player!.sys!.crew!);
    g.state = 'won';
    g.continueRun();
  }

  it('writes down who died and who was hurt, and does not replace anybody on the way', () => {
    const g = newGame();
    g.startRun();
    const shipId = g.run!.shipId;
    const gunner = g.roster.members.find((m) => m.ship === shipId && m.role === 'gunner')!;
    const reserve = makeMember(g.roster, mulberry32(9), 'gunner', 4, 2);
    g.roster.members.push(reserve);
    const medic = g.roster.members.find((m) => m.ship === shipId && m.role === 'engineer')!;
    const post = gunner.post;
    fight(g, (crew) => {
      crew.find((c) => c.memberId === gunner.id)!.dead = true;
      crew.find((c) => c.memberId === medic.id)!.hurt = true;
    });
    expect(g.roster.members.find((m) => m.id === gunner.id)).toBeUndefined();
    expect(g.roster.memory.some((f) => f.name === gunner.name)).toBe(true);
    expect(medic.status).toBe('hurt');
    expect(medic.ship).toBeNull();
    // the reserve gunner waits in the barracks: people are posted at a dock, not on the road
    expect(reserve.ship).toBeNull();
    expect(g.roster.members.some((m) => m.ship === shipId && m.post === post)).toBe(false);
    expect(g.run!.ship!.sys!.crew!.some((c) => c.memberId === reserve.id)).toBe(false);
    expect(g.run!.ship!.sys!.crew!.some((c) => c.memberId === gunner.id)).toBe(false);
    const rep = g.run!.report!;
    expect(rep.rows.find((r) => r.id === gunner.id)!.fate).toBe('dead');
    expect(rep.rows.find((r) => r.id === medic.id)!.fate).toBe('hurt');
    expect(g.run!.note).toContain('опустели');
    // and in the next battle the post is still empty: nobody comes out of nowhere to die
    g.travel(2);
    expect(g.world.player!.sys!.crew!.filter((c) => c.role === 'gunner' && c.homeModule >= 0 && g.world.player!.grid.modules[c.homeModule].key === post).length).toBe(0);
    expect(g.roster.members.some((m) => m.ship === shipId && m.post === post)).toBe(false);
  });

  it('keeps a wrecked post empty until the ship is mended', () => {
    const g = newGame();
    g.startRun();
    const shipId = g.run!.shipId;
    g.travel(1);
    const grid = g.world.player!.grid;
    const turret = grid.modules.find((m) => m.kind === 'turret')!;
    for (const c of [...turret.cells]) grid.removeCell(c);
    g.state = 'won';
    g.continueRun();
    // on to a dock on the road
    g.run!.cleared = ROAD.dockSlot - 1;
    g.travel(ROAD.dockSlot);
    expect(g.runPhase).toBe('roaddock');
    expect(g.brokenPosts(shipId).has(turret.key)).toBe(true);
    const reserve = makeMember(g.roster, mulberry32(4), 'gunner', 3, 2);
    g.roster.members.push(reserve);
    expect(g.postMember(reserve.id, shipId, turret.key)).toBe(false);
    expect(reserve.ship).toBeNull();
    // a post that stands can be filled
    const other = grid.modules.find((m) => m.kind === 'turret' && m.key !== turret.key && !g.brokenPosts(shipId).has(m.key))!;
    g.roster.members.filter((m) => m.post === other.key).forEach((m) => g.unpostMember(m.id));
    expect(g.postMember(reserve.id, shipId, other.key)).toBe(true);
    // 'best on the posts' leaves the wrecked one alone as well
    const second = makeMember(g.roster, mulberry32(5), 'gunner', 5, 3);
    g.roster.members.push(second);
    g.autoPost(shipId);
    expect(second.post).not.toBe(turret.key);
    expect(reserve.post).not.toBe(turret.key);
  });

  it('puts nobody on the wrecked post when a damaged ship is built again, and does not kill the new man for the old one', () => {
    const g = newGame();
    g.startRun();
    const shipId = g.run!.shipId;
    g.travel(1);
    const grid = g.world.player!.grid;
    const turret = grid.modules.find((m) => m.kind === 'turret')!;
    const before = g.roster.members.find((m) => m.ship === shipId && m.post === turret.key)!;
    for (const c of [...turret.cells]) grid.removeCell(c);
    g.world.player!.sys!.crew!.find((c) => c.memberId === before.id)!.dead = true;
    g.state = 'won';
    g.continueRun();
    // a new man stands where the dead one stood (as the player does at a dock), then the ship is built again from its damage
    const fresh = makeMember(g.roster, mulberry32(8), 'gunner', 2, 1);
    fresh.ship = shipId;
    fresh.post = turret.key;
    g.roster.members.push(fresh);
    g.syncRunCrew();
    expect(g.run!.ship!.sys!.crew!.some((c) => c.memberId === fresh.id)).toBe(false);
    const rebuilt = restoreShip(shipId, g.run!.diff ?? captureShip(g.run!.ship!, g.run!.blueprint), g.duty(shipId));
    expect(rebuilt.sys!.crew!.some((c) => c.memberId === fresh.id)).toBe(false);
    expect(rebuilt.sys!.crew!.every((c) => !c.dead)).toBe(true);
  });

  it('will not leave without a pilot, and says so', () => {
    const g = newGame();
    g.openDock('cruiser'); // the spare fighter gets trainees whenever it needs them, a cruiser does not
    expect(g.startRun()).toBe(true);
    const shipId = g.run!.shipId;
    const pilot = g.roster.members.find((m) => m.ship === shipId && m.role === 'pilot')!;
    fight(g, (crew) => {
      crew.find((c) => c.memberId === pilot.id)!.dead = true;
    });
    expect(g.noPilot(shipId)).toBe(true);
    expect(g.flightBlock()).toContain('Нет пилота');
    expect(g.canTravel(2)).toBe(false);
  });

  it('on losing a ship without pods takes the whole crew, and the new ship has nobody but a lent pilot', () => {
    const g = newGame();
    g.startRun();
    const shipId = g.run!.shipId;
    const before = g.roster.members.filter((m) => m.ship === shipId).length;
    expect(before).toBeGreaterThan(0);
    g.travel(1);
    g.state = 'lost';
    g.continueRun();
    expect(g.runPhase).toBe('over');
    expect(g.roster.memory.length).toBe(before);
    expect(g.run!.fate.join(' ')).toContain('Погибли с кораблём');
    expect(g.run!.fate.join(' ')).toContain('капсул');
    // the replacement comes empty: nobody is made up for it
    expect(g.roster.members.filter((m) => m.ship === g.run!.shipId).length).toBe(0);
    // with no pilot, no credits and nobody to hire the dock lends one pilot, and only him
    const people = g.roster.members.length;
    g.resumeAfterLoss();
    expect(g.roster.members.length).toBe(people + 1);
    expect(g.noPilot(g.run!.shipId)).toBe(false);
    expect(g.roster.members.filter((m) => m.ship === g.run!.shipId).map((m) => m.role)).toEqual(['pilot']);
  });

  it('adds nobody at a dock on the road, whoever is missing', () => {
    const g = newGame();
    g.startRun();
    const shipId = g.run!.shipId;
    g.wallet.credits = 500;
    // two of the crew are gone and the ship has others: coming to the dock must not make up new ones
    const mine = g.roster.members.filter((m) => m.ship === shipId);
    g.roster.members = g.roster.members.filter((m) => m !== mine[0] && m !== mine[1]);
    const count = g.roster.members.length;
    g.run!.cleared = ROAD.dockSlot - 1;
    g.travel(ROAD.dockSlot);
    expect(g.runPhase).toBe('roaddock');
    expect(g.roster.members.length).toBe(count);
  });

  it('heals for credits and for quanta', () => {
    const g = newGame();
    const m = g.roster.members[0];
    wound(g.roster, m.id);
    g.wallet.credits = 1000;
    g.wallet.quanta = 100;
    expect(g.healMember(m.id)).toBe('ok');
    expect(g.wallet.credits).toBe(1000 - healPrice(m));
    expect(g.healMember(m.id)).toBe('none');
    expect(g.speedUpHealing(m.id)).toBe('ok');
    expect(m.status).toBe('ok');
  });
});
