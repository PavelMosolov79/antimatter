/**
 * What there is in space: bodies you can fly into (planet, moon, star, pulsar, comet), the hole that swallows,
 * places with an effect on whoever is in them or under them (pulsar beams, ion storm), a landmark (gate), and
 * a field of rocks (the rocks themselves are bodies of the world; the field only says where they are), and a wreck
 * (a hull that lies where it was left; `variant` says which kind, see sim/wrecks.ts).
 */
export type CelestialKind = 'planet' | 'moon' | 'star' | 'blackhole' | 'pulsar' | 'storm' | 'comet' | 'gate' | 'asteroids' | 'wreck';

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
  /** A storm is an ellipse of radius `radius` by `ry`. */
  ry?: number;
  /** A comet's velocity, cells per second; it flies straight on. */
  vx?: number;
  vy?: number;
  /** The chunk of the sky it belongs to (see sim/sky.ts); the arena's own bodies have none. */
  chunk?: string;
}

/** Whether a ship flying into it is stopped. */
export function isSolid(c: Celestial): boolean {
  return c.kind === 'planet' || c.kind === 'moon' || c.kind === 'star' || c.kind === 'pulsar' || c.kind === 'comet';
}

/** Whether it swallows what comes into it. */
export function swallows(c: Celestial): boolean {
  return c.kind === 'blackhole';
}

export function gravityAt(cels: Celestial[], x: number, y: number, out: { ax: number; ay: number }): void {
  let ax = 0;
  let ay = 0;
  for (const c of cels) {
    if (c.mu === 0) continue;
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

/**
 * The circle round a body that nothing else may enter when the sky is laid out: a planet's rings and air, a hole's disk,
 * the reach of a pulsar's light. Placing by these keeps one thing from lying over another.
 */
export function exclusion(c: Celestial): number {
  switch (c.kind) {
    case 'planet':
      return c.radius * (c.ring ? 2.3 : 1.2) + 150;
    case 'moon':
      return c.radius + 100;
    case 'star':
      return c.radius * 2 + 100;
    case 'blackhole':
      return c.radius * 5.6 + 100;
    case 'pulsar':
      return 600;
    case 'storm':
      return Math.max(c.radius, c.ry ?? c.radius) + 80;
    case 'comet':
      return 200;
    case 'gate':
      return 260;
    case 'asteroids':
      return c.radius + 80;
    case 'wreck':
      return c.radius + 160;
  }
}

/** Whether a circle at (x, y) with this radius is clear of all of these bodies. */
export function clearOf(cels: Celestial[], x: number, y: number, radius: number): boolean {
  return cels.every((c) => Math.hypot(c.x - x, c.y - y) >= exclusion(c) + radius);
}
