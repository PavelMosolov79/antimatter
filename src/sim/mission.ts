import type { Celestial } from './gravity';
import { isSolid } from './gravity';
import { hashInt, type RoadPoint, type SignalKind } from './road';
import { mulberry32 } from './rng';
import { SECTORS } from './space';

/**
 * The frame of a mission (GDD 9.3.2): what General Stone says it is for, the tasks on the screen (the main ones
 * in order, the extra ones on the side) and the exit beacon. A mission is over when the ship is on the beacon
 * with every main task done; leaving before that is a retreat. Pure: the game tells it the facts every tick.
 */

export const MISSION = {
  /** How far the beacon is from the start (cells), and its radius: on it is inside this. */
  beaconMin: 2500,
  beaconMax: 3200,
  beaconR: 70,
  /** The beacon keeps this far off anything solid or a field of rocks (on top of its radius). */
  beaconClear: 220,
  /** Ore a mining mission asks for: pieces brought aboard (gold and violet alike), growing with the road. Not balanced. */
  oreGoal: (tier: number): number => 40 + 5 * tier,
};

export type TaskKind =
  | 'find'
  | 'reach'
  | 'kill'
  | 'ore'
  | 'antimatter'
  | 'inspect'
  | 'defend'
  | 'escort'
  | 'ally'
  | 'crate'
  | 'convoy'
  | 'convoyAll'
  | 'shield'
  | 'turrets'
  | 'ace'
  | 'wing'
  | 'beacon';

/** What kind of fight a combat point is (by its seed; an elite is always the ace's hunt). */
export type FightVariant = 'intercept' | 'convoy' | 'outpost' | 'ace';

/** The share of combat points of each kind: the first fight of a run is always an intercept. Not balanced. */
export const VARIANT_SHARE = { convoy: 0.25, outpost: 0.25 };

export function fightVariant(point: RoadPoint): FightVariant | null {
  if (point.kind === 'elite') return 'ace';
  if (point.kind !== 'combat') return null;
  if (point.mission <= 1) return 'intercept';
  const r = (hashInt(point.seed, 937) % 1000) / 1000;
  return r < VARIANT_SHARE.convoy ? 'convoy' : r < VARIANT_SHARE.convoy + VARIANT_SHARE.outpost ? 'outpost' : 'intercept';
}
export type TaskState = 'wait' | 'active' | 'done' | 'failed';

export interface Task {
  kind: TaskKind;
  text: string;
  /** An extra task: a reward on top, it does not hold the mission up. */
  opt: boolean;
  state: TaskState;
  /** Progress, for a counter ("0/3"). */
  n?: number;
  of?: number;
}

export interface MissionPlan {
  /** Mission number across the run, its type and the kind of point it is, as the screen shows them. */
  number: number;
  type: string;
  kindLabel: string;
  link: number;
  sector: string;
  /** What General Stone says. */
  brief: string;
  tasks: Task[];
  beacon: { x: number; y: number; r: number };
  /** Where the task is (the enemies, the field, the wreck), for the route bar; null where there is no one place. */
  site: { x: number; y: number } | null;
  /** How far the beacon was from the start, for the route bar. */
  startDist: number;
  /** All the main tasks done and the ship on the beacon. */
  done: boolean;
  /** A main task failed (the freighter lost): the beacon still opens, but the mission pays nothing. */
  failed: boolean;
  /** Where the scanner puts the patrol before it is found (rough), for the mark on the edge of the screen. */
  trail: { x: number; y: number } | null;
}

/** What only the game knows, told to the plan every tick. */
export interface MissionFacts {
  /** Enemy ships ever seen at the point, and how many of them are gone. */
  enemies: number;
  killed: number;
  /** Ore brought aboard at this point: all pieces, and the violet ones. */
  ore: number;
  antimatter: number;
  inspected: boolean;
  /** The patrol is found (seen near or fighting), the place of the task is reached, the container picked up. */
  found: boolean;
  reached: boolean;
  crate: boolean;
  /** The ship to protect is still there (null: there is none), how whole it is (0…1), and whether it is on the beacon. */
  allyAlive: boolean | null;
  allyHull?: number;
  escorted?: boolean;
  /** A convoy: its freighters, how many are destroyed and how many got away. */
  convoy?: { total: number; destroyed: number; escaped: number };
  /** An outpost: its shield generator down, its turrets destroyed of all. */
  outpost?: { shieldDown: boolean; turretsDead: number; turrets: number };
  /** The ace's hunt: the ace gone, its wingmen gone of all. */
  ace?: { dead: boolean; wingDead: number; wing: number };
  /** Where the player's ship is and how big (null: it is gone). */
  ship: { x: number; y: number; r?: number } | null;
}

const KIND_LABEL: Record<string, string> = { combat: 'БОЙ', elite: 'ЭЛИТНЫЙ БОЙ', boss: 'БОСС', mining: 'ДОБЫЧА', event: 'СИГНАЛ' };

/** Three ways General Stone can say each thing; the point's seed picks one. */
const BRIEFS: Record<string, string[]> = {
  combat: [
    'Пилот, в секторе ходит патруль противника. Сканер держит след их двигателей. Найдите их и уничтожьте, потом уходите к маяку прыжка.',
    'Разведка видит след патруля у вас на пути. Выследите их, расчистите дорогу и выходите к маяку. Подойдёте тихо, первый залп ваш.',
    'Патруль противника где-то впереди, сканер даёт только направление. Найдите, уничтожьте, не дайте уйти с данными о флоте. Потом к маяку.',
  ],
  elite: [
    'Осторожно: здесь ходит опытный экипаж на усиленных кораблях. Уничтожьте их, это откроет нам сектор. Маяк за ними.',
    'Против вас лучшие пилоты этого сектора. Бейте по двигателям и не подставляйтесь. Потом к маяку.',
    'Элитное звено противника. Если справитесь, штаб это запомнит. Маяк прыжка за их строем.',
  ],
  boss: [
    'Это их флагман, он держит рубеж. Уничтожьте его, и сектор наш. После боя к маяку.',
    'Флагман противника у вас на пути. Ядро у него в середине корпуса, щит держат генераторы. Удачи, пилот.',
    'Рубеж держит тяжёлый корабль. Его нужно уничтожить, иначе флот не пройдёт. Маяк за ним.',
  ],
  mining: [
    'Флоту нужен металл. В поле впереди богатые жилы. Наберите руды и выходите к маяку. На шум луча слетаются патрули.',
    'Здесь богатое поле астероидов. Набейте трюм рудой, но не жадничайте: патрули близко. Потом к маяку.',
    'Нам нужна руда для ремонта флота. Поле на сканере. Добудьте, сколько сказано, и к маяку.',
  ],
  derelict: [
    'Сканер видит остов корабля. Осмотрите его: там может быть что-то полезное. Или ловушка. Потом к маяку.',
    'На пути обломки старого боя. Облетите и осмотрите остов, потом к маяку прыжка.',
    'Сигнал идёт от разбитого корабля. Проверьте, что там, и уходите к маяку.',
  ],
  distress: [
    'Грузовик союзников подаёт сигнал бедствия, на него напали. Отбейте нападающих и доведите грузовик до маяка. Он медленный, держитесь рядом.',
    'Наш грузовик под обстрелом. Уничтожьте нападающих и проводите его к маяку прыжка: без вас он не пойдёт.',
    'Сигнал бедствия от своих. Помогите им отбиться и доведите грузовик до маяка. По пути могут встретить ещё.',
  ],
};

const TYPE_VARIANT: Record<string, string> = { convoy: 'ЗАСАДА НА КОНВОЙ', outpost: 'АВАНПОСТ', ace: 'ОХОТА НА АСА' };
const BRIEFS_VARIANT: Record<string, string[]> = {
  convoy: [
    'Через сектор идёт грузовой конвой противника: два грузовика и охрана. Догоните их и не дайте уйти к их маяку. Груз из обломков ваш.',
    'Разведка засекла конвой. Грузовики медленные, но если поднимут тревогу, побегут к своему маяку. Перехватите их, потом к нашему маяку.',
    'Конвой везёт припасы их флоту. Уничтожьте грузовики, охрана по возможности. Уйдёт хоть один, будет хуже.',
  ],
  outpost: [
    'На пути аванпост противника: турели и генератор щита. Сначала генератор, потом турели. Их радар видит далеко, подходите с умом.',
    'Аванпост держит этот проход. Разбейте генератор щита, затем турели, и путь к маяку открыт. На складе станции может быть что-то ценное.',
    'Станция противника с турелями. Пока стоит щит, бить по ней бесполезно: сначала генератор. Потом турели и к маяку.',
  ],
  ace: [
    'Осторожно, пилот: в секторе их ас с двумя ведомыми. Он сам будет вас искать. Уничтожьте его, и сектор спокойнее. Маяк дальше по курсу.',
    'Нас предупредили: за вами охотится ас противника. Не дайте ему зайти в хвост. Ведомых можно оставить, главное ас.',
    'Лучший пилот противника в этом секторе вышел на охоту. Встретьте его на своих условиях. Потом к маяку.',
  ],
};

const TYPE: Record<string, string> = { combat: 'ПЕРЕХВАТ', elite: 'ЭЛИТНОЕ ЗВЕНО', boss: 'ФЛАГМАН', mining: 'ПЛАН ПО РУДЕ', derelict: 'ОСТОВ', distress: 'ЭСКОРТ' };

/** The tasks of a point, in order (the main ones first, then the extras; the beacon last of the main ones). */
export function tasksFor(point: RoadPoint, signal?: SignalKind, oreCap = Infinity, variant: FightVariant | null = fightVariant(point)): Task[] {
  const t = (kind: TaskKind, text: string, opt = false, of?: number): Task => ({ kind, text, opt, state: 'wait', ...(of !== undefined ? { n: 0, of } : {}) });
  const out: Task[] = [];
  if (variant === 'convoy') {
    out.push(t('find', 'Догнать конвой'));
    out.push(t('convoy', 'Уничтожить грузовики', false, 2));
    out.push(t('beacon', 'Дойти до маяка'));
    out.push(t('convoyAll', 'Ни один грузовик не ушёл', true));
    out.push(t('crate', 'Подобрать груз', true));
    return out;
  }
  if (variant === 'outpost') {
    out.push(t('find', 'Подойти к аванпосту'));
    out.push(t('shield', 'Разбить генератор щита'));
    out.push(t('turrets', 'Уничтожить турели', false, 4));
    out.push(t('beacon', 'Дойти до маяка'));
    out.push(t('crate', 'Обыскать склад станции', true));
    return out;
  }
  if (variant === 'ace') {
    out.push(t('ace', 'Уничтожить аса'));
    out.push(t('beacon', 'Дойти до маяка'));
    out.push(t('wing', 'Уничтожить ведомых', true, Math.max(0, point.enemies.length - 1)));
    return out;
  }
  if (point.kind === 'combat' || point.kind === 'elite') {
    out.push(t('find', 'Найти патруль'));
    out.push(t('kill', 'Уничтожить патруль', false, point.enemies.length));
  } else if (point.kind === 'boss') out.push(t('kill', 'Уничтожить флагман и охрану', false, point.enemies.length));
  else if (point.kind === 'mining') {
    out.push(t('reach', 'Долететь до поля'));
    out.push(t('ore', 'Добыть руду', false, Math.max(8, Math.min(MISSION.oreGoal(point.tier), oreCap))));
  } else if (point.kind === 'event' && signal === 'distress') {
    out.push(t('reach', 'Найти источник сигнала'));
    out.push(t('defend', 'Отбить нападение'));
    out.push(t('escort', 'Довести грузовик до маяка'));
  } else if (point.kind === 'event') out.push(t('inspect', 'Осмотреть остов'));
  out.push(t('beacon', 'Дойти до маяка'));
  if (point.kind === 'combat' || point.kind === 'elite') out.push(t('crate', 'Подобрать контейнер', true));
  if (point.kind === 'mining') out.push(t('antimatter', 'Руда антиматерии', true));
  if (point.kind === 'event' && signal === 'distress') out.push(t('ally', 'Грузовик цел больше чем наполовину', true));
  return out;
}

/** Where to put the beacon: beyond the place of the task, as seen from the start, clear of anything solid and of rocks. */
export function placeBeacon(seed: number, site: { x: number; y: number } | null, celestials: Celestial[]): { x: number; y: number } {
  const rng = mulberry32(hashInt(seed, 907));
  const base = site && Math.hypot(site.x, site.y) > 1 ? Math.atan2(site.y, site.x) : rng() * Math.PI * 2;
  const d = MISSION.beaconMin + rng() * (MISSION.beaconMax - MISSION.beaconMin);
  const jitter = (rng() - 0.5) * 0.7;
  for (let k = 0; k < 24; k++) {
    // try round the first direction, a little further each way
    const a = base + jitter + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.26;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    const clear = celestials.every((c) => {
      const big = isSolid(c) || c.kind === 'asteroids' || c.kind === 'blackhole' || c.kind === 'wreck';
      return !big || Math.hypot(c.x - x, c.y - y) > c.radius + MISSION.beaconR + MISSION.beaconClear;
    });
    if (clear) return { x, y };
  }
  return { x: Math.cos(base) * d, y: Math.sin(base) * d };
}

export function planMission(point: RoadPoint, celestials: Celestial[], site: { x: number; y: number } | null, signal?: SignalKind, oreCap = Infinity): MissionPlan {
  const variant = fightVariant(point);
  const key = point.kind === 'event' ? (signal ?? 'derelict') : variant && variant !== 'intercept' ? variant : point.kind;
  const lines = BRIEFS_VARIANT[key] ?? BRIEFS[key] ?? BRIEFS.combat;
  const b = placeBeacon(point.seed, site, celestials);
  return {
    number: point.mission,
    type: TYPE_VARIANT[key] ?? TYPE[key] ?? 'МИССИЯ',
    kindLabel: KIND_LABEL[point.kind] ?? '',
    link: point.link,
    sector: SECTORS[point.sector]?.name ?? '',
    brief: lines[hashInt(point.seed, 911) % lines.length],
    tasks: tasksFor(point, signal, oreCap, variant),
    beacon: { x: b.x, y: b.y, r: MISSION.beaconR },
    site,
    startDist: Math.hypot(b.x, b.y),
    done: false,
    failed: false,
    trail: null,
  };
}

/** Whether every main task before the beacon is over, done or failed (the beacon is open). */
export function beaconOpen(plan: MissionPlan): boolean {
  return plan.tasks.every((t) => t.opt || t.kind === 'beacon' || t.state === 'done' || t.state === 'failed');
}

/**
 * Brings the tasks up to date with the facts: counters, done and failed, which main task is the one now (the
 * others wait their turn). Returns true the moment the mission is done (the ship on an open beacon).
 */
export function updateMission(plan: MissionPlan, f: MissionFacts): boolean {
  if (plan.done) return false;
  for (const t of plan.tasks) {
    if (t.state === 'done' || t.state === 'failed') continue;
    switch (t.kind) {
      case 'find':
        if (f.found) t.state = 'done';
        break;
      case 'reach':
        if (f.reached) t.state = 'done';
        break;
      case 'crate':
        if (f.crate) t.state = 'done';
        break;
      case 'escort':
        if (f.allyAlive === false) t.state = 'failed';
        else if (f.escorted) t.state = 'done';
        break;
      case 'convoy': {
        const c = f.convoy;
        if (!c) break;
        t.of = c.total;
        t.n = c.destroyed;
        if (c.destroyed + c.escaped >= c.total) t.state = c.destroyed > 0 ? 'done' : 'failed';
        break;
      }
      case 'convoyAll': {
        const c = f.convoy;
        if (!c) break;
        if (c.escaped > 0) t.state = 'failed';
        else if (c.destroyed >= c.total) t.state = 'done';
        break;
      }
      case 'shield':
        if (f.outpost?.shieldDown) t.state = 'done';
        break;
      case 'turrets': {
        const o = f.outpost;
        if (!o) break;
        t.of = o.turrets;
        t.n = o.turretsDead;
        if (o.turretsDead >= o.turrets) t.state = 'done';
        break;
      }
      case 'ace':
        if (f.ace?.dead) t.state = 'done';
        break;
      case 'wing': {
        const a = f.ace;
        if (!a) break;
        t.of = a.wing;
        t.n = a.wingDead;
        if (a.wing === 0 || a.wingDead >= a.wing) t.state = 'done';
        break;
      }
      case 'kill':
      case 'defend':
        t.of = Math.max(t.of ?? 0, f.enemies);
        t.n = f.killed;
        if (f.enemies > 0 && f.killed >= f.enemies) t.state = 'done';
        break;
      case 'ore':
        t.n = Math.min(f.ore, t.of ?? 0);
        if (f.ore >= (t.of ?? 0)) t.state = 'done';
        break;
      case 'antimatter':
        if (f.antimatter > 0) t.state = 'done';
        break;
      case 'inspect':
        if (f.inspected) t.state = 'done';
        break;
      case 'ally':
        if (f.allyAlive === false || (f.allyHull !== undefined && f.allyHull < 0.5)) t.state = 'failed';
        break;
      case 'beacon':
        break;
    }
  }
  // a task found in passing: whatever comes after «find it» is under way, so it was found
  const fi = plan.tasks.findIndex((t) => t.kind === 'find' && t.state !== 'done');
  if (fi >= 0 && plan.tasks.some((t, i) => i > fi && !t.opt && t.kind !== 'beacon' && (t.state === 'done' || (t.n ?? 0) > 0))) plan.tasks[fi].state = 'done';
  // the main tasks are done one after another: the first not done is the one now
  let current = false;
  for (const t of plan.tasks) {
    if (t.opt) {
      if (t.state === 'wait') t.state = 'active';
      continue;
    }
    if (t.state === 'done' || t.state === 'failed') continue;
    t.state = current ? 'wait' : 'active';
    current = true;
  }
  // a main task that can no longer be done: the mission is failed (the defence too goes with the freighter)
  if (plan.tasks.some((t) => !t.opt && t.state === 'failed')) {
    plan.failed = true;
    for (const t of plan.tasks) if (!t.opt && t.kind !== 'beacon' && t.state !== 'done') t.state = 'failed';
  }
  const open = beaconOpen(plan);
  const s = f.ship;
  const on = !!s && onBeacon(plan, s);
  if (open && on) {
    for (const t of plan.tasks) {
      if (t.kind === 'beacon') t.state = 'done';
      // the ally still with us at the end is the extra task done
      if (t.kind === 'ally' && t.state !== 'failed' && f.allyAlive) t.state = 'done';
    }
    plan.done = true;
    return true;
  }
  return false;
}

/** Whether a ship is on the beacon: its middle inside the ring, give or take half its size (a big ship need not centre on it). */
export function onBeacon(plan: MissionPlan, s: { x: number; y: number; r?: number }): boolean {
  return Math.hypot(s.x - plan.beacon.x, s.y - plan.beacon.y) <= plan.beacon.r + (s.r ?? 0) * 0.5;
}

/** The counter of main tasks: done and all. */
export function mainCount(plan: MissionPlan): { done: number; all: number } {
  const main = plan.tasks.filter((t) => !t.opt);
  return { done: main.filter((t) => t.state === 'done').length, all: main.length };
}
