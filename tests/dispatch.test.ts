import { describe, expect, it } from 'vitest';
import { ensureRooms } from '../src/sim/compartments';
import { DISPATCH, Dispatcher, moduleLabel } from '../src/sim/dispatch';
import { buildFighter, playerShip } from '../src/sim/ships';
import { World } from '../src/sim/world';

function setup(): { w: World; d: Dispatcher } {
  const w = new World(1);
  w.spawnShip(playerShip('cruiser'), 0, 0, 0, { name: 'P', team: 0, player: true });
  const d = new Dispatcher();
  d.observe(w);
  return { w, d };
}

const last = (d: Dispatcher) => d.log[d.log.length - 1];

describe('the dispatcher', () => {
  it('says nothing about how things stand when it first looks', () => {
    const { d } = setup();
    expect(d.log.length).toBe(0);
  });

  it('reports a module that is lost, by its name and deck, once', () => {
    const { w, d } = setup();
    const p = w.player!;
    const m = p.grid.modules.find((q) => q.kind === 'turret')!;
    const label = moduleLabel(m);
    for (const i of m.cells) p.grid.removeCell(i);
    w.time += 1;
    d.observe(w);
    expect(last(d).sev).toBe('crit');
    expect(last(d).title).toBe(`Разрушено: ${label}`);
    const n = d.log.length;
    d.observe(w);
    expect(d.log.length).toBe(n);
  });

  it('reports a person killed or hurt, with the name', () => {
    const { w, d } = setup();
    const crew = w.player!.sys!.crew!;
    const [a, b] = crew.filter((c) => !c.mobile);
    a.name = 'Лена Корвин';
    b.name = 'Ян Дрозд';
    a.dead = true;
    b.hurt = true;
    w.time += 1;
    d.observe(w);
    const titles = d.log.map((m) => m.title);
    expect(titles).toContain('Погиб Лена Корвин');
    expect(titles).toContain('Ранен Ян Дрозд');
    expect(d.log.find((m) => m.title === 'Погиб Лена Корвин')!.sev).toBe('crit');
    expect(d.log.find((m) => m.title === 'Ранен Ян Дрозд')!.sev).toBe('warn');
  });

  it('reports a hole in a compartment and when it is closed, and a fire and when it is out', () => {
    const { w, d } = setup();
    const graph = ensureRooms(w.player!);
    const room = graph.rooms.find((r) => r.z > 0 && r.cells.length > 20)!;
    room.holes = 2;
    w.time += 1;
    d.observe(w);
    expect(last(d).icon).toBe('breach');
    expect(last(d).title.startsWith('Разгерметизация')).toBe(true);
    room.fire = 0.4;
    w.time += 1;
    d.observe(w);
    expect(d.log.some((m) => m.icon === 'fire')).toBe(true);
    room.holes = 0;
    room.patched = true;
    room.pressure = 1;
    room.fire = 0;
    w.time += 1;
    d.observe(w);
    expect(d.log.some((m) => m.title.startsWith('Пробоина закрыта'))).toBe(true);
    expect(d.log.some((m) => m.title.startsWith('Пожар потушен'))).toBe(true);
  });

  it('reports the shield going down and coming back, low energy once, and the hull falling under half and a quarter', () => {
    const { w, d } = setup();
    const sys = w.player!.sys!;
    sys.shieldDown = true;
    w.time += 1;
    d.observe(w);
    expect(last(d).title).toBe('Щит упал');
    sys.shieldDown = false;
    w.time += 1;
    d.observe(w);
    expect(last(d).title).toBe('Щит восстановлен');
    sys.energy = sys.energyMax * 0.05;
    for (let i = 0; i < 3; i++) {
      w.time += 1;
      d.observe(w);
    }
    expect(d.log.filter((m) => m.title === 'Мало энергии').length).toBe(1);
    sys.cellsMax = Math.round(w.player!.grid.cells / 0.45);
    w.time += 1;
    d.observe(w);
    expect(last(d).title).toBe('Корпус ниже 50%');
    sys.cellsMax = Math.round(w.player!.grid.cells / 0.2);
    w.time += 1;
    d.observe(w);
    expect(last(d).title).toBe('Корпус ниже 25%');
    expect(last(d).sev).toBe('crit');
  });

  it('reports an enemy destroyed and a new one arriving later, but not the ones there from the start', () => {
    const w = new World(1);
    w.spawnShip(playerShip('cruiser'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const e = w.spawnShip(buildFighter('raider'), 0, -300, 0, { name: 'Налётчик', team: 1, ai: 'raider' });
    const d = new Dispatcher();
    d.observe(w);
    expect(d.log.length).toBe(0);
    e.sys!.dead = true;
    w.time = 20;
    d.observe(w);
    expect(last(d).title).toBe('Противник уничтожен: Налётчик');
    expect(last(d).sev).toBe('good');
    w.spawnShip(buildFighter('hunter'), 200, -300, 0, { name: 'Охотник', team: 1, ai: 'hunter' });
    w.time = 25;
    d.observe(w);
    expect(last(d).title).toBe('Новый противник: Охотник');
  });

  it('counts the same message said again within a few seconds instead of repeating it', () => {
    const d = new Dispatcher();
    d.say('warn', 'fire', 'Пожар: Кубрик', 'a', 10);
    d.say('warn', 'fire', 'Пожар: Кубрик', 'b', 12);
    d.say('warn', 'fire', 'Пожар: Кубрик', 'c', 12 + DISPATCH.mergeWithin + 1);
    expect(d.log.length).toBe(2);
    expect(d.log[0].n).toBe(2);
    expect(d.log[1].n).toBe(1);
  });
});

describe('the dispatcher and a ship that splits', () => {
  it('does not take the main piece of a damaged enemy for a new arrival', () => {
    const w = new World(1);
    w.spawnShip(playerShip('cruiser'), 0, 0, 0, { name: 'P', team: 0, player: true });
    const e = w.spawnShip(buildFighter('raider'), 0, -200, 0, { name: 'Налётчик', team: 1, ai: 'raider' });
    const d = new Dispatcher();
    d.observe(w);
    // the same ship under a new body id, as after the hull splits (the ship id stays)
    e.sys!.name = 'Налётчик';
    w.time = 30;
    const other = w.spawnShip(buildFighter('raider'), 0, -210, 0, { name: 'Налётчик', team: 1, ai: 'raider' });
    other.shipId = e.shipId;
    e.removed = true;
    d.observe(w);
    expect(d.log.length).toBe(0);
  });
});
