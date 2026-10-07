import type { Cargo } from './cargo';
import { LV_MAX, upgradeCost } from './levels';
import { POOL, type PoolModuleId } from './layout';
import { hirePrice, makeMember, type Member, type Roster } from './roster';
import { hashInt, type RoadPoint } from './road';
import { mulberry32 } from './rng';

/**
 * The trader: a peaceful point where the offer comes by the point's seed, and the player pays out of the hold
 * (not the stash, so what was mined on the road is spent before it is safe). Modules come with a higher level than
 * the dock's shop sells; people come with a better rank than the barracks' candidates. They are bought for the
 * hold's credits and metal, and what is bought goes into the ship's stock and the barracks.
 */
export const TRADER = {
  modules: 3,
  crew: 2,
  /** What the trader asks over the dock's price. */
  markup: 1.4,
  /** …and for people (the same as at the dock: their rank is what is rare). */
  crewMarkup: 1,
  /** The levels the modules are: from this, one more with a chance, one more every this many tiers. */
  baseLevel: 2,
  levelEveryTiers: 5,
  moreChance: 0.3,
};

export interface ModuleOffer {
  id: string;
  kind: 'module';
  type: PoolModuleId;
  lv: number;
  price: Cargo;
}

export interface CrewOffer {
  id: string;
  kind: 'crew';
  member: Member;
  price: Cargo;
}

export type Offer = ModuleOffer | CrewOffer;

export function moduleOffers(point: RoadPoint): ModuleOffer[] {
  const rng = mulberry32(hashInt(point.seed, 401));
  const types = POOL.slice();
  const out: ModuleOffer[] = [];
  for (let i = 0; i < TRADER.modules && types.length; i++) {
    const type = types.splice(Math.floor(rng() * types.length), 1)[0];
    const lv = Math.min(LV_MAX, TRADER.baseLevel + Math.floor(point.tier / TRADER.levelEveryTiers) + (rng() < TRADER.moreChance ? 1 : 0));
    const base = upgradeCost(1, 1, lv);
    out.push({ id: `m${i}`, kind: 'module', type, lv, price: { credits: Math.round(base.credits * TRADER.markup), metal: Math.round(base.metal * TRADER.markup) } });
  }
  return out;
}

/** The people the trader brings: not in the roster yet, so a visit that is not bought from leaves nobody behind. */
export function crewOffers(point: RoadPoint, roster: Roster): CrewOffer[] {
  const rng = mulberry32(hashInt(point.seed, 403));
  const roles = ['pilot', 'gunner', 'shieldop', 'engineer'] as const;
  const out: CrewOffer[] = [];
  for (let i = 0; i < TRADER.crew; i++) {
    const rar = 3 + (rng() < 0.3 ? 1 : 0);
    const lv = Math.min(10, rar * 2 - 1 + Math.floor(rng() * 2));
    const member = makeMember(roster, rng, roles[Math.floor(rng() * roles.length)], lv, rar);
    if (out.some((o) => o.member.name === member.name)) member.name += ' II';
    out.push({ id: `c${i}`, kind: 'crew', member, price: { credits: Math.round(hirePrice(member) * TRADER.crewMarkup), metal: 0 } });
  }
  return out;
}
