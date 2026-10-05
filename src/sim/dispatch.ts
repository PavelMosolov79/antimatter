import { ensureRooms, type Room } from './compartments';
import type { Crew } from './crew';
import type { GridBody } from './body';
import { MODULE_INFO } from './layout';
import type { Module, ShipGrid } from './grid';
import type { World } from './world';

/**
 * The dispatcher: short messages about what happens to the player's ship and round it, made by watching the world
 * from tick to tick (a module lost, someone killed or hurt, a hole in a compartment, a fire, the shield down, an
 * enemy destroyed…). It only reads the world. The screen shows one message at a time and keeps all of them in the log.
 */

export type Severity = 'crit' | 'warn' | 'good' | 'info';
export type DispatchIcon = 'module' | 'killed' | 'hurt' | 'fire' | 'breach' | 'shield' | 'ok' | 'energy' | 'wreck' | 'foe' | 'hull' | 'reactor';

export interface DispatchMsg {
  id: number;
  sev: Severity;
  icon: DispatchIcon;
  title: string;
  sub: string;
  /** World time (seconds) of the first and of the latest of the same messages. */
  at: number;
  lastAt: number;
  /** How many times in a row the same thing was said. */
  n: number;
}

export const DISPATCH = {
  /** Messages with the same title closer than this (seconds) are one message, counted. */
  mergeWithin: 5,
  /** Hull fractions at which the dispatcher says so. */
  hullWarn: [0.5, 0.25],
  /** Energy fraction under which it warns, and over which it warns again next time. */
  energyLow: 0.12,
  energyRearm: 0.3,
  /** A room at or above this pressure after a hole counts as sealed again. */
  repressed: 0.97,
  logMax: 300,
};

const KIND_LABEL: Record<string, string> = {
  engine: 'Двигатель',
  thruster: 'Сопло',
  brake: 'Сопло',
  turn: 'Сопло',
  reactor: 'Реактор',
  shield: 'Генератор щита',
  bridge: 'Мостик',
  generic: 'Модуль',
};

/** What a module is called to the player. */
export function moduleLabel(m: Module): string {
  if (m.weapon) return `Орудие ${m.weapon.name}`;
  if (m.pool && m.pool in MODULE_INFO) return MODULE_INFO[m.pool as keyof typeof MODULE_INFO].name;
  return KIND_LABEL[m.kind] ?? 'Модуль';
}

const ROLE_LABEL: Record<string, string> = { pilot: 'пилот', gunner: 'артиллерист', shieldop: 'оператор щита', engineer: 'инженер' };

/** The deck number a cell is on (the first deck is 1; layer 0 is the hull). */
const deckOf = (grid: ShipGrid, i: number): number => grid.zOf(i);

/** What a compartment is: the module in it, or a corridor. */
export function roomLabel(grid: ShipGrid, room: Room): string {
  for (let k = 0; k < room.cells.length; k += 3) {
    const id = grid.mod[room.cells[k]];
    if (id !== 0 && grid.modules[id - 1]) return moduleLabel(grid.modules[id - 1]);
  }
  return 'Коридор';
}

export class Dispatcher {
  /** Everything said so far, oldest first. */
  readonly log: DispatchMsg[] = [];
  /** Bumped at every new message or counted repeat; the screen compares it to know there is news. */
  version = 0;
  private nextId = 1;
  private seeded = false;
  private modules = new Map<number, { dead: boolean; label: string; z: number }>();
  private crew = new Map<number, { dead: boolean; hurt: boolean }>();
  private rooms = new Map<number, { breach: boolean; fire: boolean }>();
  private enemies = new Map<number, { dead: boolean; name: string }>();
  private shieldDown = false;
  private hullStep = 0;
  private energyLow = false;
  private countdown = false;

  say(sev: Severity, icon: DispatchIcon, title: string, sub: string, time: number): DispatchMsg {
    const last = this.log[this.log.length - 1];
    if (last && last.title === title && time - last.lastAt < DISPATCH.mergeWithin) {
      last.n++;
      last.lastAt = time;
      last.sub = sub;
      this.version++;
      return last;
    }
    const m: DispatchMsg = { id: this.nextId++, sev, icon, title, sub, at: time, lastAt: time, n: 1 };
    this.log.push(m);
    if (this.log.length > DISPATCH.logMax) this.log.shift();
    this.version++;
    return m;
  }

  /** Looks at the world once and says what changed since the last look. */
  observe(world: World): void {
    const p = world.player;
    const t = world.time;
    this.observeEnemies(world, t);
    if (!p || !p.sys) return;
    const first = !this.seeded;
    this.observeModules(p, t, first);
    this.observeCrew(p.sys.crew ?? [], p, t, first);
    this.observeRooms(p, t, first);
    this.observeShip(p, t, first);
    this.seeded = true;
  }

  private observeModules(p: GridBody, t: number, first: boolean): void {
    const g = p.grid;
    const seen = new Set<number>();
    for (const m of g.modules) {
      seen.add(m.key);
      const dead = m.alive <= 0 || !m.coreAlive;
      const prev = this.modules.get(m.key);
      const z = m.cells.length > 0 ? deckOf(g, m.cells[0]) : 0;
      if (!first && prev && !prev.dead && dead) {
        this.say('crit', 'module', `Разрушено: ${prev.label}`, z > 0 ? `Палуба ${z} · модуль выведен из строя` : 'Снаружи · модуль выведен из строя', t);
      }
      this.modules.set(m.key, { dead, label: moduleLabel(m), z });
    }
    // a module that is no longer in the list went with a piece of the hull torn away
    for (const [key, v] of this.modules) {
      if (seen.has(key)) continue;
      this.modules.delete(key);
      if (!first && !v.dead) this.say('crit', 'module', `Оторвало: ${v.label}`, 'Часть корпуса потеряна', t);
    }
  }

  private observeCrew(crew: Crew[], p: GridBody, t: number, first: boolean): void {
    for (const c of crew) {
      const prev = this.crew.get(c.id);
      const who = c.name || ROLE_LABEL[c.role] || 'космонавт';
      const role = ROLE_LABEL[c.role] ?? '';
      if (!first && prev) {
        if (c.dead && !prev.dead) this.say('crit', 'killed', `Погиб ${who}`, role ? `${role} · пост опустел` : 'пост опустел', t);
        else if (c.hurt && !prev.hurt && !c.dead) this.say('warn', 'hurt', `Ранен ${who}`, role ? `${role} · вынесен с поста` : 'вынесен с поста', t);
      }
      this.crew.set(c.id, { dead: c.dead, hurt: c.hurt });
    }
    void p;
  }

  private observeRooms(p: GridBody, t: number, first: boolean): void {
    const graph = ensureRooms(p);
    const seen = new Set<number>();
    for (const r of graph.rooms) {
      if (r.cells.length === 0) continue;
      const sig = r.cells[0];
      seen.add(sig);
      const breach = r.holes > 0 && !r.patched;
      const fire = r.fire > 0.05;
      const prev = this.rooms.get(sig);
      const name = roomLabel(p.grid, r);
      const deck = r.z;
      if (!first && prev) {
        if (breach && !prev.breach) this.say('crit', 'breach', `Разгерметизация: ${name}`, `Палуба ${deck} · воздух уходит, двери запираются`, t);
        else if (!breach && prev.breach && r.pressure >= DISPATCH.repressed) this.say('good', 'ok', `Пробоина закрыта: ${name}`, `Палуба ${deck} · воздух вернулся`, t);
        if (fire && !prev.fire) this.say('warn', 'fire', `Пожар: ${name}`, `Палуба ${deck} · инженеры на пути`, t);
        else if (!fire && prev.fire && r.pressure > 0.2) this.say('good', 'ok', `Пожар потушен: ${name}`, `Палуба ${deck}`, t);
      }
      this.rooms.set(sig, { breach, fire });
    }
    for (const sig of this.rooms.keys()) if (!seen.has(sig)) this.rooms.delete(sig);
  }

  private observeShip(p: GridBody, t: number, first: boolean): void {
    const sys = p.sys!;
    const hull = p.grid.cells / Math.max(1, sys.cellsMax);
    // the hull steps: say each one once as it falls under
    let step = 0;
    for (let i = 0; i < DISPATCH.hullWarn.length; i++) if (hull <= DISPATCH.hullWarn[i]) step = i + 1;
    if (!first && step > this.hullStep) {
      const pct = Math.round(DISPATCH.hullWarn[step - 1] * 100);
      this.say(step >= 2 ? 'crit' : 'warn', 'hull', `Корпус ниже ${pct}%`, step >= 2 ? 'Корабль на грани гибели' : 'Тяжёлые повреждения', t);
    }
    this.hullStep = first ? step : Math.max(step, this.hullStep);
    if (hull > 0.55) this.hullStep = 0;

    if (!first && sys.shieldDown && !this.shieldDown) this.say('warn', 'shield', 'Щит упал', 'Пока он не поднимется, удары идут в корпус', t);
    else if (!first && !sys.shieldDown && this.shieldDown && sys.shieldMax > 0) this.say('info', 'shield', 'Щит восстановлен', '', t);
    this.shieldDown = sys.shieldDown;

    const eFrac = sys.energyMax > 0 ? sys.energy / sys.energyMax : 1;
    if (!first && !this.energyLow && sys.energyMax > 0 && eFrac < DISPATCH.energyLow) {
      this.energyLow = true;
      this.say('warn', 'energy', 'Мало энергии', 'Орудия и щит замедляются', t);
    } else if (eFrac > DISPATCH.energyRearm) this.energyLow = false;

    const counting = sys.countdown >= 0 && !sys.dead;
    if (!first && counting && !this.countdown) this.say('crit', 'reactor', 'Реактор нестабилен', 'Скоро взрыв: покиньте корабль или заглушите ядро', t);
    this.countdown = counting;
  }

  private observeEnemies(world: World, t: number): void {
    for (const b of world.bodies) {
      if (b.removed || b.kind !== 'ship' || !b.sys || b.sys.team !== 1) continue;
      const prev = this.enemies.get(b.shipId);
      const dead = b.sys.dead;
      if (!prev) {
        this.enemies.set(b.shipId, { dead, name: b.sys.name });
        if (this.seeded && t > 3 && !dead) this.say('warn', 'foe', `Новый противник: ${b.sys.name}`, 'Появился в зоне боя', t);
      } else if (dead && !prev.dead) {
        prev.dead = true;
        this.say('good', 'ok', `Противник уничтожен: ${b.sys.name}`, '', t);
      }
    }
  }
}
