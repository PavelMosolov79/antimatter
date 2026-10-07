/** How people are drawn moving on the deck (crewView.ts): the turn, the sway of a step. Kept apart from the drawing so it can be tested. */

/** How people move on the deck as drawn: the turn (rad/s at most), the sway of a step (rad) and the steps per cell walked. */
export const CREW_LOOK = {
  turnRate: Math.PI * 4,
  sway: 0.09,
  bob: 0.05,
  stridePerCell: 2.2,
};

/** The turn (in radians, clockwise) that makes the downward-facing drawing look along (dx, dy) in ship coordinates. */
export function facing(dx: number, dy: number): number {
  return Math.atan2(-dx, dy);
}

/** One step of a turn towards an angle, the short way round, at most `max` radians. */
export function turnToward(from: number, to: number, max: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-max, Math.min(max, d));
}

