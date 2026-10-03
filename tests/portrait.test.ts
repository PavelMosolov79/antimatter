import { describe, expect, it } from 'vitest';
import { PORTRAIT_SIZE, portraitKind, portraitPixels } from '../src/render/portrait';
import { GIVEN_NAMES, SURNAMES } from '../src/sim/crewNames';
import type { CrewRole } from '../src/sim/crew';

const ROLES: CrewRole[] = ['pilot', 'gunner', 'shieldop', 'engineer'];

describe('crew portraits', () => {
  it('paints the same person the same way every time, a different person differently', () => {
    const a = portraitPixels('Рэн Касуми', 'pilot', 2);
    const b = portraitPixels('Рэн Касуми', 'pilot', 2);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(PORTRAIT_SIZE * PORTRAIT_SIZE * 4);
    const c = portraitPixels('Ольга Вереск', 'gunner', 2);
    expect(Array.from(c)).not.toEqual(Array.from(a));
  });

  it('draws all three kinds, in a mix, for the names the game uses', () => {
    const kinds = { closed: 0, open: 0, bare: 0 };
    for (let i = 0; i < 200; i++) kinds[portraitKind(`${GIVEN_NAMES[i % GIVEN_NAMES.length]} ${SURNAMES[(i * 7) % SURNAMES.length]}`, ROLES[i % 4])]++;
    for (const n of Object.values(kinds)) expect(n).toBeGreaterThan(30);
  });

  it('is opaque everywhere, and rarer people look showier', () => {
    const p = portraitPixels('Тео Валь', 'shieldop', 5, 'bare');
    for (let i = 3; i < p.length; i += 4) expect(p[i]).toBe(255);
    expect(Array.from(portraitPixels('Тео Валь', 'shieldop', 1, 'bare'))).not.toEqual(Array.from(p));
  });
});
