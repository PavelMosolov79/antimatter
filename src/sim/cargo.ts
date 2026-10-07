import type { RoadPoint } from './road';

/**
 * What the player earns on the road and what they can lose. Winnings go into the ship's
 * hold; only a dock turns them into the player's own resources. Credits are money and take
 * no room, metal does — so the hold's size is a limit on metal alone.
 */

export interface Cargo {
  credits: number;
  metal: number;
  /** Antimatter ore (a violet vein's); it takes `ORE_ROOM` places in the hold each. In the wallet it is only what is left over from the quanta it was turned into. */
  ore?: number;
}

/** Places a piece of antimatter ore takes in the hold (a piece of metal takes one), and how many are a quantum. */
export const ORE_ROOM = 3;
export const ORE_PER_QUANTUM = 5;

/** The places in the hold that metal and ore take (credits take none). */
export const holdUsed = (c: Cargo): number => c.metal + (c.ore ?? 0) * ORE_ROOM;

/** Room for metal in the hold, by ship class. */
export const HOLD_CAP: Record<string, number> = { fighter: 40, cruiser: 120, battleship: 400 };

export function holdCap(shipId: string): number {
  return HOLD_CAP[shipId] ?? HOLD_CAP.fighter;
}

export const emptyCargo = (): Cargo => ({ credits: 0, metal: 0 });

export const cargoSize = (c: Cargo): number => c.credits + c.metal;

/** The winnings of a fight, from how dangerous the point is. */
export function rewardFor(point: RoadPoint): Cargo {
  const t = point.tier;
  if (point.kind === 'boss') return { credits: 160 + 15 * t, metal: 30 + 5 * t };
  if (point.kind === 'elite') return { credits: 50 + 12 * t, metal: 10 + 3 * t };
  if (point.kind === 'combat') return { credits: 18 + 7 * t, metal: 4 + 2 * t };
  // a mining or a signal mission done to the beacon pays a little on top of what was picked up (not balanced)
  if (point.kind === 'mining') return { credits: 20 + 5 * t, metal: 0 };
  if (point.kind === 'event') return { credits: 15 + 5 * t, metal: 0 };
  return emptyCargo();
}

export interface HoldResult {
  gained: Cargo;
  /** Metal that didn't fit and stayed in space. */
  lostMetal: number;
}

/** What `reward` would add to `hold` with room for `cap` metal. */
export function previewAdd(hold: Cargo, cap: number, reward: Cargo): HoldResult {
  const room = Math.max(0, cap - holdUsed(hold));
  const metal = Math.min(reward.metal, room);
  return { gained: { credits: reward.credits, metal }, lostMetal: reward.metal - metal };
}

export function addToHold(hold: Cargo, cap: number, reward: Cargo): HoldResult {
  const r = previewAdd(hold, cap, reward);
  hold.credits += r.gained.credits;
  hold.metal += r.gained.metal;
  return r;
}

/** Moves everything in the hold into `wallet`; returns what moved. */
export function deposit(hold: Cargo, wallet: Cargo & { quanta?: number }): Cargo & { quanta?: number } {
  const moved: Cargo & { quanta?: number } = { credits: hold.credits, metal: hold.metal };
  wallet.credits += moved.credits;
  wallet.metal += moved.metal;
  // antimatter ore turns into quanta, every fifth piece; what is left waits for the next time
  const got = hold.ore ?? 0;
  if (got > 0 || (wallet.ore ?? 0) > 0) {
    const ore = (wallet.ore ?? 0) + got;
    const q = Math.floor(ore / ORE_PER_QUANTUM);
    wallet.ore = ore - q * ORE_PER_QUANTUM;
    if (wallet.quanta !== undefined) wallet.quanta += q;
    if (got > 0) moved.ore = got;
    if (q > 0) moved.quanta = q;
  }
  hold.credits = 0;
  hold.metal = 0;
  if (hold.ore) hold.ore = 0;
  return moved;
}

/** Puts one piece of ore in the hold (1: gold gives a metal, 2: violet gives antimatter ore); false when there is no room for it. */
export function addOre(hold: Cargo, cap: number, kind: 1 | 2): boolean {
  const need = kind === 2 ? ORE_ROOM : 1;
  if (cap - holdUsed(hold) < need) return false;
  if (kind === 2) hold.ore = (hold.ore ?? 0) + 1;
  else hold.metal += 1;
  return true;
}
