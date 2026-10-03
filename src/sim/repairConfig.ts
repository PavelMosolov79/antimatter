/**
 * Every number of the repair in one place, so they can be changed fast. They are for tests
 * and not balanced yet (balance comes last): the times are set for tests (10, 15 and 20
 * seconds by how bad the damage is); `timeScale` stretches or shortens all of them.
 */
export const REPAIR = {
  /** 1 = the times below as they are; below 1 = quicker, for tests. */
  timeScale: 1,
  /** How long a repair takes, in seconds, by how bad the damage is. */
  tierSeconds: { light: 10, medium: 15, heavy: 20 },
  /** Light damage: under this share of the hull lost and under this share of the modules out of action. */
  lightMaxLoss: 0.08,
  lightMaxModules: 0.25,
  /** Medium damage: under these; anything worse, or a wreck, is heavy. */
  mediumMaxLoss: 0.25,
  mediumMaxModules: 0.6,
  /** Time multiplier by ship class (all alike for now). */
  classTime: { fighter: 1, cruiser: 1, battleship: 1 } as Record<string, number>,
  /** Metal per cell gone, per hurt cell, per module (the spare ship repairs for nothing). */
  metalPerCell: 0.5,
  metalPerHurtCell: 0.1,
  metalPerModule: 12,
  /** The dock on the road is quicker and cheaper than the dock at home. */
  roadTime: 0.5,
  roadCost: 0.5,
  /** Premium currency per minute of repair left, to speed a repair up (at least one). */
  quantaPerMinute: 6,
  /** A repair started in a dock takes at least this many real seconds, so it is seen. */
  minSeconds: 2,
  /** After the button the drones need this long to fly to the ship; the clock starts when they get there. */
  droneLead: 1.6,
};

/** The ship that is always there: its repair is free and short, so a run is never blocked. */
export const SPARE_SHIP = 'fighter';

/** Premium currency (a stand-in until real payments): a new player has this many. */
export const QUANTA_START = 10;
/** Each new run tops the wallet up to this (until a tutorial hands them out). */
export const QUANTA_PER_RUN = 10;
/** One for every boss destroyed. */
export const QUANTA_PER_BOSS = 1;
