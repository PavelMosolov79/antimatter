import type { RoadPoint } from './road';

/**
 * What the player earns on the road and what they can lose. Winnings go into the ship's
 * hold; only a dock turns them into the player's own resources. Credits are money and take
 * no room, metal does — so the hold's size is a limit on metal alone.
 */

export interface Cargo {
  credits: number;
  metal: number;
}

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
  return emptyCargo();
}

export interface HoldResult {
  gained: Cargo;
  /** Metal that didn't fit and stayed in space. */
  lostMetal: number;
}

/** What `reward` would add to `hold` with room for `cap` metal. */
export function previewAdd(hold: Cargo, cap: number, reward: Cargo): HoldResult {
  const room = Math.max(0, cap - hold.metal);
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
export function deposit(hold: Cargo, wallet: Cargo): Cargo {
  const moved = { credits: hold.credits, metal: hold.metal };
  wallet.credits += moved.credits;
  wallet.metal += moved.metal;
  hold.credits = 0;
  hold.metal = 0;
  return moved;
}
