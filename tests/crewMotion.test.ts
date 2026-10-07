import { describe, expect, it } from 'vitest';
import { facing, turnToward } from '../src/render/crewMotion';

const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-6;

describe('people on the deck as drawn', () => {
  it('face the way they walk at any angle (the drawing faces down at no turn)', () => {
    expect(near(facing(0, 1), 0)).toBe(true);
    expect(near(facing(1, 0), -Math.PI / 2)).toBe(true);
    expect(near(facing(-1, 0), Math.PI / 2)).toBe(true);
    expect(near(facing(0, -1), Math.PI)).toBe(true);
    // a diagonal is a diagonal, not snapped to a quarter turn
    expect(near(facing(1, 1), -Math.PI / 4)).toBe(true);
  });

  it('turn the short way round, no faster than allowed', () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(0, 0.1, 0.25)).toBeCloseTo(0.1);
    // from just under a full turn to just over zero: forward across zero, not back round
    const t = turnToward(Math.PI * 2 - 0.1, 0.1, 0.05);
    expect(t).toBeCloseTo(Math.PI * 2 - 0.05);
  });
});
