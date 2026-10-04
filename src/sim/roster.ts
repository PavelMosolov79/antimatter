import { CREW, RARITY } from './crewConfig';
import { GIVEN_NAMES, SURNAMES } from './crewNames';
import type { CrewRole } from './crew';
import { crewPlaces } from './levels';
import type { ShipGrid } from './grid';
import { mulberry32, type Rng } from './rng';

/**
 * The people. Every astronaut is a named person with a profession, a level, a rarity and a
 * few traits; the dock remembers all of them. Each ship has its own crew: a person is on a
 * post of a ship, or waits in the barracks. A post is a module of the ship's layout (its
 * `key`), so the crew can be matched to the ship again whenever it is built.
 */

export interface Trait {
  id: string;
  title: string;
  desc: string;
  bad: boolean;
}

export const TRAITS: Trait[] = [
  { id: 'calm', title: 'Спокойный', desc: 'не бежит с поста, пока не станет по-настоящему страшно', bad: false },
  { id: 'lucky', title: 'Везучий', desc: '+15% шанс выжить', bad: false },
  { id: 'keen', title: 'Меткий', desc: '+10% к бонусу профессии', bad: false },
  { id: 'vet', title: 'Ветеран', desc: '+15% опыта', bad: false },
  { id: 'tough', title: 'Живучий', desc: 'лечится на треть быстрее', bad: false },
  { id: 'nervy', title: 'Нервный', desc: '−10% к бонусу профессии', bad: true },
  { id: 'frail', title: 'Хрупкий', desc: '+10% к шансу ранения', bad: true },
];
export const traitOf = (id: string): Trait | undefined => TRAITS.find((t) => t.id === id);

export const ROLE_NAMES: Record<CrewRole, string> = { pilot: 'Пилот', gunner: 'Артиллерист', shieldop: 'Оператор щита', engineer: 'Инженер' };
export const ROLES: CrewRole[] = ['pilot', 'gunner', 'shieldop', 'engineer'];

export interface Member {
  id: number;
  name: string;
  role: CrewRole;
  /** 1..10. */
  lv: number;
  xp: number;
  /** 1..5, an index into RARITY plus one. */
  rar: number;
  traits: string[];
  status: 'ok' | 'hurt';
  /** The ship the person serves on (null: in the barracks) and the post (a module key; null: an engineer, who has no post). */
  ship: string | null;
  post: number | null;
  fights: number;
  /** While wounded: when the healing is done (ms), or nothing until it has been paid for. */
  healEnd?: number | null;
}

/** Somebody who is gone for good: what the «Память» list shows. */
export interface Fallen {
  name: string;
  role: CrewRole;
  lv: number;
  rar: number;
  fights: number;
  /** The ship they served on. */
  ship: string | null;
  /** How: in battle, or lost with the ship. */
  how: 'battle' | 'ship';
}

export interface Roster {
  v: 1;
  nextId: number;
  members: Member[];
  candidates: Member[];
  /** Those who died, newest last. */
  memory: Fallen[];
  /** Ships whose first crew has been given (a ship is staffed once; after that people are hired). */
  staffed: Record<string, boolean>;
  seed: number;
}

export const emptyRoster = (): Roster => ({ v: 1, nextId: 1, members: [], candidates: [], memory: [], staffed: {}, seed: (Math.random() * 2 ** 31) >>> 0 });

// ------------------------------------------------------------------ storage

const KEY = 'antimatter-crew-v1';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRoster(): Roster {
  try {
    const d = JSON.parse(storage()?.getItem(KEY) ?? 'null') as Roster | null;
    if (d && d.v === 1 && Array.isArray(d.members) && Array.isArray(d.candidates)) return { ...emptyRoster(), ...d };
  } catch {
    /* an unreadable save is an empty roster */
  }
  return emptyRoster();
}

export function storeRoster(r: Roster): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(r));
  } catch {
    /* a full or blocked storage just means no save */
  }
}

// ------------------------------------------------------------------ people

function freeName(r: Roster, rng: Rng): string {
  const taken = new Set([...r.members, ...r.candidates].map((m) => m.name));
  for (let i = 0; i < 40; i++) {
    const n = `${GIVEN_NAMES[Math.floor(rng() * GIVEN_NAMES.length)]} ${SURNAMES[Math.floor(rng() * SURNAMES.length)]}`;
    if (!taken.has(n)) return n;
  }
  return `${GIVEN_NAMES[0]} ${SURNAMES[0]} ${r.nextId}`;
}

function pickTraits(rar: number, rng: Rng): string[] {
  const want = rar >= 3 ? 2 : rng() < RARITY[rar - 1].traits ? 1 : 0;
  const pool = TRAITS.slice();
  const out: string[] = [];
  while (out.length < want && pool.length) {
    const t = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    // two bad traits would make a person nobody hires
    if (t.bad && out.some((id) => traitOf(id)?.bad)) continue;
    out.push(t.id);
  }
  return out;
}

export function makeMember(r: Roster, rng: Rng, role: CrewRole, lv: number, rar: number): Member {
  return { id: r.nextId++, name: freeName(r, rng), role, lv, xp: 0, rar, traits: pickTraits(rar, rng), status: 'ok', ship: null, post: null, fights: 0 };
}

/** Replaces the list of people the dock offers to hire: mostly ordinary, now and then a rare one. */
export function refreshCandidates(r: Roster, rng: Rng = mulberry32((r.seed = (r.seed * 1664525 + 1013904223) >>> 0))): void {
  r.candidates = [];
  for (let i = 0; i < CREW.candidates; i++) {
    const t = rng();
    const rar = t < 0.55 ? 1 : t < 0.8 ? 2 : t < 0.93 ? 3 : t < 0.985 ? 4 : 5;
    const lv = Math.min(10, Math.max(1, rar * 2 - 1 + Math.floor(rng() * 2)));
    r.candidates.push(makeMember(r, rng, ROLES[Math.floor(rng() * ROLES.length)], lv, rar));
  }
}

export const hirePrice = (m: Member): number => Math.round(CREW.hirePerLevel * m.lv * RARITY[m.rar - 1].price);

// ------------------------------------------------------------------ posts

export interface Post {
  /** The module's key. */
  key: number;
  role: CrewRole;
  label: string;
  /** A second place at the helm: nobody sits there to begin with. */
  reserve: boolean;
  /** Where the module's core is on the ship (cell column, row and deck). */
  x: number;
  y: number;
  z: number;
}

/** The manned places of a ship as built: the helm, every turret, the shield. */
export function postsOf(grid: ShipGrid): Post[] {
  const out: Post[] = [];
  let helm = 0;
  let turret = 0;
  grid.modules.forEach((m) => {
    const at = { x: grid.xOf(m.core), y: grid.yOf(m.core), z: grid.zOf(m.core) };
    if (m.kind === 'bridge') out.push({ key: m.key, role: 'pilot', label: helm++ === 0 ? 'Мостик' : 'Резервный пост', reserve: helm > 1, ...at });
    else if (m.kind === 'turret') out.push({ key: m.key, role: 'gunner', label: `Турель ${++turret}`, reserve: false, ...at });
    else if (m.kind === 'shield') out.push({ key: m.key, role: 'shieldop', label: 'Щит', reserve: false, ...at });
  });
  return out;
}

/** How many roaming engineers the ship has places for: one in three posts, and the quarters' places on top. */
export function engineerPlaces(grid: ShipGrid): number {
  const posts = postsOf(grid).length;
  return Math.max(1, Math.round(posts / 3)) + crewPlaces(grid.modules);
}

export const onShip = (r: Roster, shipId: string): Member[] => r.members.filter((m) => m.ship === shipId);
export const inBarracks = (r: Roster): Member[] => r.members.filter((m) => !m.ship);
export const atPost = (r: Roster, shipId: string, key: number): Member | undefined => r.members.find((m) => m.ship === shipId && m.post === key);

// ------------------------------------------------------------------ changes

export function unassign(r: Roster, id: number): void {
  const m = r.members.find((x) => x.id === id);
  if (m) {
    m.ship = null;
    m.post = null;
  }
}

/** Puts a person on a post of a ship (post null: an engineer's place); whoever was there goes to the barracks. */
export function assign(r: Roster, id: number, shipId: string, post: number | null): boolean {
  const m = r.members.find((x) => x.id === id);
  if (!m || m.status !== 'ok') return false;
  if (post !== null) {
    const old = atPost(r, shipId, post);
    if (old && old !== m) {
      old.ship = null;
      old.post = null;
    }
  }
  m.ship = shipId;
  m.post = post;
  return true;
}

/** A person leaves for good. */
export function release(r: Roster, id: number): void {
  r.members = r.members.filter((m) => m.id !== id);
}

/** Hires a candidate into the barracks for credits the caller has already taken; false when the barracks is full. */
export function hire(r: Roster, id: number): Member | null {
  const m = r.candidates.find((x) => x.id === id);
  if (!m || inBarracks(r).length >= CREW.barracksMax) return null;
  r.candidates = r.candidates.filter((x) => x !== m);
  r.members.push(m);
  return m;
}

/**
 * Puts a ship's crew in order after its layout changed: people on posts that are no longer
 * there, or more engineers than places, go back to the barracks.
 */
export function reconcile(r: Roster, shipId: string, grid: ShipGrid): void {
  const posts = postsOf(grid).filter((p) => !p.reserve);
  const engineers: Member[] = [];
  for (const m of onShip(r, shipId)) {
    if (m.role === 'engineer') {
      engineers.push(m);
      m.post = null;
      continue;
    }
    const p = posts.find((x) => x.key === m.post && x.role === m.role);
    if (!p) {
      m.ship = null;
      m.post = null;
    }
  }
  engineers.slice(engineerPlaces(grid)).forEach((m) => (m.ship = null));
}

/**
 * Gives a ship people for every empty post and place from nothing: its first crew, and the
 * spare ship's trainees whenever it needs them. They are first-level and ordinary.
 */
export function staffShip(r: Roster, shipId: string, grid: ShipGrid, rng: Rng, wrecked?: Set<number>): number {
  let added = 0;
  const fill = (role: CrewRole, post: number | null) => {
    const m = makeMember(r, rng, role, CREW.starterLevel, 1);
    m.ship = shipId;
    m.post = post;
    r.members.push(m);
    added++;
  };
  for (const p of postsOf(grid)) if (!p.reserve && !atPost(r, shipId, p.key) && !wrecked?.has(p.key)) fill(p.role, p.key);
  const have = onShip(r, shipId).filter((m) => m.role === 'engineer').length;
  for (let i = have; i < engineerPlaces(grid); i++) fill('engineer', null);
  return added;
}

/** The crew of a ship as the simulation needs it: who stands where. Wounded people are not on duty. */
export function dutyOf(r: Roster, shipId: string): DutyCrew[] {
  return onShip(r, shipId)
    .filter((m) => m.status === 'ok')
    .map((m) => ({ id: m.id, name: m.name, lv: m.lv, role: m.role, post: m.post }));
}
export interface DutyCrew {
  id: number;
  name: string;
  lv: number;
  role: CrewRole;
  post: number | null;
}

// ------------------------------------------------------------------ battle, wounds and death

/** What the battle says about one person of the crew. */
export interface BattleCrew {
  memberId: number | null;
  dead: boolean;
  hurt: boolean;
}

/** A person who died: out of the people, into the memory list. */
export function fall(r: Roster, id: number, how: Fallen['how']): Fallen | null {
  const m = r.members.find((x) => x.id === id);
  if (!m) return null;
  r.members = r.members.filter((x) => x !== m);
  const f: Fallen = { name: m.name, role: m.role, lv: m.lv, rar: m.rar, fights: m.fights, ship: m.ship, how };
  r.memory.push(f);
  return f;
}

/** A wounded person leaves the post and waits in the barracks to be healed. */
export function wound(r: Roster, id: number): void {
  const m = r.members.find((x) => x.id === id);
  if (!m) return;
  m.status = 'hurt';
  m.healEnd = null;
  m.ship = null;
  m.post = null;
}

/**
 * After a battle: whoever of the ship's crew is dead, or was lost with a piece of the hull (no longer in the
 * crew), goes to the memory; whoever lived through fire, vacuum or a wrecked module is wounded. Everybody who
 * went out gets a battle on the record. `went` lists who was in the battle (somebody whose post was already
 * wrecked before it is not lost in it).
 */
export function applyBattle(r: Roster, shipId: string, crew: BattleCrew[], went?: Set<number>): { died: Fallen[]; hurt: Member[] } {
  const byId = new Map<number, BattleCrew>();
  for (const c of crew) if (c.memberId !== null) byId.set(c.memberId, c);
  const died: Fallen[] = [];
  const hurt: Member[] = [];
  for (const m of onShip(r, shipId).filter((x) => x.status === 'ok' && (!went || went.has(x.id)))) {
    m.fights++;
    const c = byId.get(m.id);
    if (!c || c.dead) {
      const f = fall(r, m.id, 'battle');
      if (f) died.push(f);
    } else if (c.hurt) {
      wound(r, m.id);
      hurt.push(m);
    }
  }
  return { died, hurt };
}

/** Seconds a wounded person needs at the dock. */
export const healSeconds = (m: Member): number => Math.round(CREW.healSeconds * (1 + 0.1 * (m.lv - 1)) * (m.traits.includes('tough') ? 2 / 3 : 1));
export const healPrice = (m: Member): number => Math.round(CREW.healPerLevel * m.lv * RARITY[m.rar - 1].price);
export const hurtOf = (r: Roster): Member[] => r.members.filter((m) => m.status === 'hurt');

/** Seconds of healing left (the full time while it has not been started). */
export function healLeft(m: Member, now: number): number {
  if (m.status !== 'hurt') return 0;
  return m.healEnd ? Math.max(0, Math.ceil((m.healEnd - now) / 1000)) : healSeconds(m);
}

/** Quanta to finish the healing at once. */
export const healSpeedUpPrice = (m: Member, now: number): number => Math.max(1, Math.ceil(healLeft(m, now) / CREW.healQuantaSeconds));

/** Starts the healing of a wounded person (the caller takes the credits). */
export function startHeal(r: Roster, id: number, now: number): boolean {
  const m = r.members.find((x) => x.id === id);
  if (!m || m.status !== 'hurt' || m.healEnd) return false;
  m.healEnd = now + healSeconds(m) * 1000;
  return true;
}

/** Makes a person well at once. */
export function cure(r: Roster, id: number): boolean {
  const m = r.members.find((x) => x.id === id);
  if (!m || m.status !== 'hurt') return false;
  m.status = 'ok';
  m.healEnd = undefined;
  return true;
}

/** The people whose healing has run out are well again; how many. */
export function settleHealing(r: Roster, now: number): number {
  let n = 0;
  for (const m of r.members) if (m.status === 'hurt' && m.healEnd && m.healEnd <= now) n += cure(r, m.id) ? 1 : 0;
  return n;
}

/**
 * Puts the best healthy people of the barracks on the empty posts of a ship (and engineers' places), the most
 * experienced first, never on a post in a wrecked module (`wrecked`: the keys of those modules). Only at a dock.
 */
export function autoFill(r: Roster, shipId: string, grid: ShipGrid, wrecked?: Set<number>): Member[] {
  const placed: Member[] = [];
  const spare = (role: CrewRole): Member | undefined =>
    inBarracks(r)
      .filter((m) => m.status === 'ok' && m.role === role)
      .sort((a, b) => b.lv - a.lv || b.rar - a.rar)[0];
  for (const p of postsOf(grid).filter((x) => !x.reserve)) {
    if (atPost(r, shipId, p.key) || wrecked?.has(p.key)) continue;
    const m = spare(p.role);
    if (m && assign(r, m.id, shipId, p.key)) placed.push(m);
  }
  for (let have = onShip(r, shipId).filter((m) => m.role === 'engineer').length; have < engineerPlaces(grid); have++) {
    const m = spare('engineer');
    if (!m || !assign(r, m.id, shipId, null)) break;
    placed.push(m);
  }
  return placed;
}

/** What the escape pods of a ship are worth: the seats they have, and each one's chance to get away. */
export interface PodStats {
  seats: number;
  chance: number;
  /** The medical bay's rescue chance (0…0.95) for the bonus. */
  med: number;
}

/**
 * The ship is lost: with escape pods some of the crew get away (the most experienced take the seats), each
 * with a chance, wounded; the rest die. Without pods nobody does. `random` gives numbers in 0…1.
 */
export function abandonShip(r: Roster, shipId: string, pods: PodStats, random: () => number): { saved: Member[]; lost: Fallen[] } {
  const crew = onShip(r, shipId)
    .filter((m) => m.status === 'ok')
    .sort((a, b) => b.lv - a.lv || b.rar - a.rar);
  const saved: Member[] = [];
  const lost: Fallen[] = [];
  crew.forEach((m, i) => {
    m.fights++;
    const p = Math.min(0.95, pods.chance + (m.traits.includes('lucky') ? CREW.podLuckyBonus : 0) + pods.med * CREW.podMedShare);
    if (i < pods.seats && random() < p) {
      wound(r, m.id);
      saved.push(m);
    } else {
      const f = fall(r, m.id, 'ship');
      if (f) lost.push(f);
    }
  });
  return { saved, lost };
}
