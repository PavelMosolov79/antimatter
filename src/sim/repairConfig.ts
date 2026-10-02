/**
 * Every number of the repair in one place, so they can be changed fast. They are for tests
 * and not balanced yet (balance comes last): `timeScale` shortens every repair — 1 is the
 * time as designed, 0.1 makes it ten times quicker for checking by hand.
 */
export const REPAIR = {
  /** 1 = as designed; below 1 = quicker, for tests. */
  timeScale: 0.1,
  /** Designed seconds per cell that is gone, per cell that is only hurt, per module out of action. */
  secPerCell: 0.15,
  secPerHurtCell: 0.03,
  secPerModule: 25,
  /** No repair takes longer than this (the designed minutes), even a wreck. */
  maxMinutes: 30,
  /** Metal per cell gone, per hurt cell, per module. */
  metalPerCell: 0.5,
  metalPerHurtCell: 0.1,
  metalPerModule: 12,
  /** Time multiplier by ship class. */
  classTime: { fighter: 1, cruiser: 1, battleship: 2 } as Record<string, number>,
  /** The spare fighter: a repair from nothing takes this long (designed seconds), and costs nothing. */
  spareSeconds: 30,
  /** The dock on the road is quicker and cheaper than the dock at home. */
  roadTime: 0.5,
  roadCost: 0.5,
  /** Premium currency per designed minute left, to speed a repair up. */
  quantaPerMinute: 1,
  /** A repair started in a dock takes at least this many real seconds, so it is seen. */
  minSeconds: 2,
};

/** The ship that is always there: its repair is free and short, so a run is never blocked. */
export const SPARE_SHIP = 'fighter';

/** Premium currency (a stand-in until real payments): a new player has this many. */
export const QUANTA_START = 10;
/** Each new run tops the wallet up to this (until a tutorial hands them out). */
export const QUANTA_PER_RUN = 10;
/** One for every boss destroyed. */
export const QUANTA_PER_BOSS = 1;
