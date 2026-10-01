export type CelestialKind = 'planet' | 'moon' | 'star' | 'blackhole';

export interface Celestial {
  kind: CelestialKind;
  x: number;
  y: number;
  radius: number;
  mu: number;
  soft: number;
  seed: number;
  /** A planet's type (see sim/space.ts); planets without one keep the old plain look. */
  variant?: string;
  /** A planet with rings. */
  ring?: boolean;
}

export function isSolid(c: Celestial): boolean {
  return c.kind !== 'blackhole';
}

export function gravityAt(cels: Celestial[], x: number, y: number, out: { ax: number; ay: number }): void {
  let ax = 0;
  let ay = 0;
  for (const c of cels) {
    const dx = c.x - x;
    const dy = c.y - y;
    const d2 = dx * dx + dy * dy + c.soft * c.soft;
    const inv = c.mu / (d2 * Math.sqrt(d2));
    ax += dx * inv;
    ay += dy * inv;
  }
  out.ax = ax;
  out.ay = ay;
}
