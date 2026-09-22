import { describe, expect, it } from 'vitest';
import { paintGrid } from '../src/render/shipView';
import { ShipGrid } from '../src/sim/grid';
import { Mat } from '../src/sim/materials';

describe('paintGrid', () => {
  it('does not throw when asked for a deck layer beyond the ship depth', () => {
    const grid = new ShipGrid(4, 4, 3);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) grid.setCell(x, y, 0, Mat.HULL);
    const buf = new Uint8Array(4 * 4 * 4).fill(123);
    expect(() => paintGrid(grid, buf, 3)).not.toThrow();
    expect(() => paintGrid(grid, buf, 99)).not.toThrow();
    expect(buf.every((v) => v === 0)).toBe(true);
  });

  it('still renders a valid in-range layer normally', () => {
    const grid = new ShipGrid(2, 2, 2);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) grid.setCell(x, y, 0, Mat.HULL);
    const buf = new Uint8Array(2 * 2 * 4);
    paintGrid(grid, buf, 0);
    expect(buf[3]).toBe(255);
  });
});
