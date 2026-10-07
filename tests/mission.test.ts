import { beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import type { Scene } from '../src/render/scene';
import { emptyCargo, rewardFor } from '../src/sim/cargo';
import { MISSION, beaconOpen, fightVariant, placeBeacon, planMission, tasksFor, updateMission, type MissionFacts } from '../src/sim/mission';
import { genLink, signalKind, type RoadPoint } from '../src/sim/road';
import { planetBody } from '../src/sim/space';

const DT = 1 / 60;

function point(kind: RoadPoint['kind'], enemies: string[] = ['scout', 'raider']): RoadPoint {
  const p = { ...genLink(0, 5)[2] };
  p.kind = kind;
  p.enemies = enemies;
  // the first mission of a run: a combat point is always an intercept
  p.mission = 1;
  return p;
}

const facts = (o: Partial<MissionFacts> = {}): MissionFacts => ({ enemies: 2, killed: 0, ore: 0, antimatter: 0, inspected: false, found: false, reached: false, crate: false, allyAlive: null, ship: { x: 0, y: 0 }, ...o });

describe('the tasks of a mission', () => {
  it('are what the point is for, then the beacon; the extras on the side', () => {
    expect(tasksFor(point('combat')).map((t) => [t.kind, t.opt])).toEqual([['find', false], ['kill', false], ['beacon', false], ['crate', true]]);
    expect(tasksFor(point('boss')).map((t) => t.kind)).toEqual(['kill', 'beacon']);
    expect(tasksFor(point('mining')).map((t) => [t.kind, t.opt])).toEqual([['reach', false], ['ore', false], ['beacon', false], ['antimatter', true]]);
    expect(tasksFor(point('event'), 'derelict').map((t) => t.kind)).toEqual(['inspect', 'beacon']);
    expect(tasksFor(point('event'), 'distress').map((t) => [t.kind, t.opt])).toEqual([['reach', false], ['defend', false], ['escort', false], ['beacon', false], ['ally', true]]);
    // the ore asked for never goes over what the hold can take
    expect(tasksFor(point('mining'), undefined, 24)[1].of).toBe(24);
  });

  it('go one after another, and the beacon opens only when the tasks are done', () => {
    const plan = planMission(point('combat'), [], { x: 0, y: -400 });
    updateMission(plan, facts());
    expect(plan.tasks.map((t) => t.state)).toEqual(['active', 'wait', 'wait', 'active']);
    expect(plan.tasks[1].of).toBe(2);
    updateMission(plan, facts({ found: true }));
    expect(plan.tasks.map((t) => t.state)).toEqual(['done', 'active', 'wait', 'active']);
    // on the beacon too early: nothing
    expect(updateMission(plan, facts({ found: true, killed: 1, ship: plan.beacon }))).toBe(false);
    expect(beaconOpen(plan)).toBe(false);
    updateMission(plan, facts({ found: true, killed: 2, crate: true }));
    expect(plan.tasks.map((t) => t.state)).toEqual(['done', 'done', 'active', 'done']);
    expect(beaconOpen(plan)).toBe(true);
    expect(updateMission(plan, facts({ found: true, killed: 2, ship: { x: plan.beacon.x + 30, y: plan.beacon.y } }))).toBe(true);
    expect(plan.done).toBe(true);
    expect(plan.failed).toBe(false);
  });

  it('an escort: the freighter led to the beacon is the task; lost, the mission is failed but the beacon opens', () => {
    const plan = planMission(point('event'), [], { x: 0, y: -800 }, 'distress');
    updateMission(plan, facts({ enemies: 3, killed: 1, allyAlive: true, allyHull: 0.8, reached: true }));
    expect(plan.tasks.map((t) => t.state)).toEqual(['done', 'active', 'wait', 'wait', 'active']);
    expect(plan.tasks[1].of).toBe(3);
    updateMission(plan, facts({ enemies: 3, killed: 3, allyAlive: true, allyHull: 0.8, reached: true }));
    expect(plan.tasks[2].state).toBe('active');
    // the freighter gets there: the escort is done, then the player on the beacon ends it
    updateMission(plan, facts({ enemies: 3, killed: 3, allyAlive: true, allyHull: 0.8, reached: true, escorted: true }));
    expect(plan.tasks[2].state).toBe('done');
    expect(updateMission(plan, facts({ enemies: 3, killed: 3, allyAlive: true, allyHull: 0.8, reached: true, escorted: true, ship: plan.beacon }))).toBe(true);
    expect(plan.tasks[4].state).toBe('done');

    const lost = planMission(point('event'), [], { x: 0, y: -800 }, 'distress');
    updateMission(lost, facts({ enemies: 2, killed: 1, allyAlive: false, reached: true }));
    expect(lost.failed).toBe(true);
    expect(lost.tasks.filter((t) => !t.opt && t.kind !== 'beacon').map((t) => t.state)).toEqual(['done', 'failed', 'failed']);
    expect(lost.tasks[4].state).toBe('failed');
    expect(beaconOpen(lost)).toBe(true);
  });

  it('a whole half of the freighter is the extra, failed for good once below', () => {
    const plan = planMission(point('event'), [], { x: 0, y: -800 }, 'distress');
    updateMission(plan, facts({ allyAlive: true, allyHull: 0.4 }));
    expect(plan.tasks[4].state).toBe('failed');
    updateMission(plan, facts({ allyAlive: true, allyHull: 0.9 }));
    expect(plan.tasks[4].state).toBe('failed');
  });
});

describe('the beacon', () => {
  it('stands beyond the task, at the distance of a mission, and off anything solid', () => {
    for (let seed = 1; seed < 40; seed++) {
      const site = { x: 0, y: -400 };
      const planet = planetBody(0, -2800, seed, 'rocky');
      const b = placeBeacon(seed, site, [planet]);
      const d = Math.hypot(b.x, b.y);
      expect(d).toBeGreaterThanOrEqual(MISSION.beaconMin - 1);
      expect(d).toBeLessThanOrEqual(MISSION.beaconMax + 1);
      expect(Math.hypot(b.x - planet.x, b.y - planet.y)).toBeGreaterThan(planet.radius + MISSION.beaconR);
      // roughly the way of the task
      expect(b.y).toBeLessThan(0);
    }
  });
});

describe('a mission in the game', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  function fight(): Game {
    const g = new Game({ reset() {}, render() {}, layerView: -1 } as unknown as Scene);
    g.screen = 'game';
    g.startRun();
    const p = g.run!.road.points[1];
    p.kind = 'combat';
    p.enemies = ['scout'];
    g.travel(1);
    return g;
  }

  it('starts with the briefing over a world that stands still', () => {
    const g = fight();
    expect(g.plan).not.toBeNull();
    expect(g.briefing).toBe('intro');
    const t = g.world.time;
    g.tick(DT);
    expect(g.world.time).toBe(t);
    g.endBriefing();
    g.tick(DT);
    expect(g.world.time).toBeGreaterThan(t);
  });

  it('is won on the beacon after the fight, with the reward', () => {
    const g = fight();
    g.endBriefing();
    for (const b of g.world.bodies) if (b.sys?.team === 1) b.sys.dead = true;
    g.tick(DT);
    // the enemies are gone but the mission goes on to the beacon
    expect(g.state).toBe('playing');
    const p = g.world.player!;
    p.x = g.plan!.beacon.x;
    p.y = g.plan!.beacon.y;
    g.tick(DT);
    expect(g.state).toBe('won');
    const reward = rewardFor(g.run!.fighting!);
    g.continueRun();
    expect(g.run!.cargo.credits).toBe(reward.credits);
  });

  it('puts the enemies of a fight on patrol further on, not seeing the player at the start', () => {
    const g = fight();
    g.endBriefing();
    const foes = g.world.bodies.filter((b) => b.sys?.team === 1);
    expect(foes.length).toBeGreaterThan(0);
    for (const f of foes) {
      expect(f.sys!.ai!.aware).toBe('patrol');
      expect(Math.hypot(f.x, f.y)).toBeGreaterThan(900);
    }
    for (let i = 0; i < 60; i++) g.tick(DT);
    expect(foes.every((f) => f.sys!.ai!.aware === 'patrol')).toBe(true);
  });

  it('an intercept: the scanner has a rough fix on the patrol, and a container lies where it goes round', () => {
    const g = fight();
    g.endBriefing();
    const plan = g.plan!;
    expect(plan.trail).not.toBeNull();
    const foes = g.world.bodies.filter((b) => b.sys?.team === 1);
    const cx = foes.reduce((n, b) => n + b.x, 0) / foes.length;
    const cy = foes.reduce((n, b) => n + b.y, 0) / foes.length;
    expect(Math.hypot(plan.trail!.x - cx, plan.trail!.y - cy)).toBeLessThan(500);
    const taskLoot = () => g.world.loot.filter((l) => l.task);
    expect(taskLoot().length).toBe(1);
    // flying into it picks it up: the extra task is done and its money in the hold
    const l = taskLoot()[0];
    const p = g.world.player!;
    p.x = l.x;
    p.y = l.y;
    g.tick(DT);
    g.tick(DT);
    expect(taskLoot().length).toBe(0);
    expect(plan.tasks.find((t) => t.kind === 'crate')!.state).toBe('done');
    expect(g.run!.cargo.credits).toBeGreaterThan(0);
  });

  it('an escort: the freighter waits for the player, then heads for the beacon', () => {
    const g = new Game({ reset() {}, render() {}, layerView: -1 } as unknown as Scene);
    g.screen = 'game';
    g.startRun();
    const pt = g.run!.road.points[1];
    pt.kind = 'event';
    for (let s = 1; signalKind(pt) !== 'distress'; s++) pt.seed = s;
    g.travel(1);
    g.endBriefing();
    const ally = g.mission!.ally!;
    expect(Math.hypot(ally.x, ally.y)).toBeGreaterThan(600);
    const plan = g.plan!;
    expect(plan.type).toBe('ЭСКОРТ');
    for (const b of g.world.bodies) if (b.sys?.team === 1) b.sys.dead = true;
    const p = g.world.player!;
    // the player comes to it: the source is found, the attackers are gone, it goes for the beacon
    p.x = ally.x + 150;
    p.y = ally.y;
    g.tick(DT);
    g.tick(DT);
    expect(plan.tasks.find((t) => t.kind === 'escort')!.state).toBe('active');
    expect(ally.sys!.nav.target).toEqual({ x: plan.beacon.x, y: plan.beacon.y });
    // the player off and away: it waits where it is
    p.x = ally.x + 2000;
    g.tick(DT);
    expect(ally.sys!.nav.target).toEqual({ x: ally.x, y: ally.y });
  });

  it('can be left at any time as a retreat: no reward, the hold kept', () => {
    const g = fight();
    g.endBriefing();
    g.run!.cargo = { credits: 33, metal: 5 };
    expect(g.canLeave).toBe(true);
    g.leavePoint();
    expect(g.state).toBe('won');
    expect(g.retreated).toBe(true);
    expect(g.pendingReward()).toBeNull();
    g.continueRun();
    expect(g.run!.cargo).toEqual({ ...emptyCargo(), credits: 33, metal: 5 });
    expect(g.run!.note).toContain('Отступление');
  });
});

describe('the second pass of fights', () => {
  it('a combat point is an intercept, a convoy or an outpost by its seed (the first of a run an intercept); an elite is the ace', () => {
    const seen = new Set<string>();
    for (let s = 1; s < 200; s++) {
      const p = { ...genLink(0, 5)[2], kind: 'combat' as const, mission: 3, seed: s };
      seen.add(fightVariant(p)!);
    }
    expect([...seen].sort()).toEqual(['convoy', 'intercept', 'outpost']);
    expect(fightVariant({ ...genLink(0, 5)[2], kind: 'combat', mission: 1, seed: 7 })).toBe('intercept');
    expect(fightVariant({ ...genLink(0, 5)[2], kind: 'elite', mission: 6, seed: 7 })).toBe('ace');
  });

  it('a convoy: done with one freighter destroyed, failed with both gone away; the extra wants none away', () => {
    const p = point('combat');
    const plan = { ...planMission(p, [], { x: 0, y: -1300 }), tasks: tasksFor(p, undefined, Infinity, 'convoy') };
    updateMission(plan, facts({ found: true, convoy: { total: 2, destroyed: 1, escaped: 1 } }));
    expect(plan.tasks.map((t) => [t.kind, t.state])).toEqual([['find', 'done'], ['convoy', 'done'], ['beacon', 'active'], ['convoyAll', 'failed'], ['crate', 'active']]);
    const lost = { ...planMission(p, [], { x: 0, y: -1300 }), tasks: tasksFor(p, undefined, Infinity, 'convoy') };
    updateMission(lost, facts({ found: true, convoy: { total: 2, destroyed: 0, escaped: 2 } }));
    expect(lost.failed).toBe(true);
  });

  it('an outpost: the shield first, then the turrets; an ace: the ace, the wingmen on the side', () => {
    const p = point('combat');
    const plan = { ...planMission(p, [], { x: 0, y: -1300 }), tasks: tasksFor(p, undefined, Infinity, 'outpost') };
    updateMission(plan, facts({ found: true, outpost: { shieldDown: false, turretsDead: 1, turrets: 4 } }));
    expect(plan.tasks.slice(0, 3).map((t) => t.state)).toEqual(['done', 'active', 'wait']);
    expect(plan.tasks[2].n).toBe(1);
    updateMission(plan, facts({ found: true, outpost: { shieldDown: true, turretsDead: 4, turrets: 4 } }));
    expect(beaconOpen(plan)).toBe(true);
    const e = point('elite', ['hunter', 'raider', 'scout']);
    const ace = { ...planMission(e, [], { x: 0, y: -1300 }), tasks: tasksFor(e, undefined, Infinity, 'ace') };
    expect(ace.tasks.map((t) => [t.kind, t.opt, t.of])).toEqual([['ace', false, undefined], ['beacon', false, undefined], ['wing', true, 2]]);
    updateMission(ace, facts({ ace: { dead: true, wing: 2, wingDead: 1 } }));
    expect(beaconOpen(ace)).toBe(true);
    expect(ace.tasks[2].state).toBe('active');
  });
});

describe('the second pass in the game', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  function at(variant: 'convoy' | 'outpost' | 'ace'): Game {
    const g = new Game({ reset() {}, render() {}, layerView: -1 } as unknown as Scene);
    g.screen = 'game';
    g.startRun();
    const p = g.run!.road.points[1];
    p.kind = variant === 'ace' ? 'elite' : 'combat';
    p.enemies = variant === 'ace' ? ['hunter', 'raider', 'scout'] : ['raider', 'scout'];
    p.mission = 5;
    for (let s = 1; fightVariant(p) !== variant; s++) p.seed = s;
    g.travel(1);
    g.endBriefing();
    return g;
  }

  it('a convoy crosses to its beacon; a freighter destroyed leaves its cargo, one at its beacon is gone', () => {
    const g = at('convoy');
    const c = g.convoy!;
    const [a, b] = c.ids.map((id) => g.world.findShip(id)!);
    const d0 = Math.hypot(a.x - c.exit.x, a.y - c.exit.y);
    for (let i = 0; i < 60 * 5; i++) g.tick(DT);
    expect(Math.hypot(a.x - c.exit.x, a.y - c.exit.y)).toBeLessThan(d0 - 20);
    a.sys!.dead = true;
    b.x = c.exit.x;
    b.y = c.exit.y;
    g.tick(DT);
    g.tick(DT);
    expect(c.destroyed.size).toBe(1);
    expect(c.escaped.size).toBe(1);
    expect(g.world.loot.filter((l) => l.task).length).toBe(1);
    expect(g.plan!.tasks.find((t) => t.kind === 'convoy')!.state).toBe('done');
  });

  it('an outpost stands still; with its turrets gone its store opens', () => {
    const g = at('outpost');
    const st = g.world.findShip(g.outpost!.id)!;
    expect(st.anchored).toBe(true);
    for (const m of st.grid.modules) if (m.kind === 'turret' || m.kind === 'shield') m.alive = 0;
    g.tick(DT);
    g.tick(DT);
    expect(g.outpost!.opened).toBe(true);
    expect(g.world.loot.filter((l) => l.task).length).toBe(1);
    expect(g.plan!.tasks.filter((t) => !t.opt && t.kind !== 'beacon').every((t) => t.state === 'done')).toBe(true);
  });

  it('the ace comes hunting after a while', () => {
    const g = at('ace');
    const aceShip = g.world.findShip(g.ace!.id)!;
    expect(aceShip.sys!.name).toContain('Ас');
    expect(g.ace!.hunting).toBe(false);
    const p = g.world.player!;
    p.anchored = true;
    const d0 = Math.hypot(aceShip.x - p.x, aceShip.y - p.y);
    for (let i = 0; i < 60 * 40; i++) g.tick(DT);
    expect(g.ace!.hunting).toBe(true);
    const now = g.world.findShip(g.ace!.id);
    if (now) expect(Math.hypot(now.x - p.x, now.y - p.y)).toBeLessThan(d0);
  });
});
