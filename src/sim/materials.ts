export const Mat = {
  EMPTY: 0,
  HULL: 1,
  ARMOR: 2,
  DECK: 3,
  ENGINE: 4,
  MODULE: 5,
  THRUSTER: 6,
  TURRET: 7,
  REACTOR: 8,
  SHIELDGEN: 9,
  WALL: 10,
  DOOR: 11,
  LADDER: 12,
  BRIDGE: 13,
  SEAT: 14,
  CONSOLE: 15,
  CORE: 16,
  CRUISE: 17,
  BRAKE: 18,
  TURN: 19,
  ROCK: 20,
  /** Ore in a rock's vein (sim/mining.ts): gold gives metal, the violet one antimatter ore. */
  ORE: 21,
  ORE2: 22,
} as const;

export interface MaterialDef {
  name: string;
  hp: number;
  mass: number;
  color: number;
}

export const MATERIALS: MaterialDef[] = [
  { name: 'empty', hp: 0, mass: 0, color: 0x000000 },
  { name: 'hull', hp: 30, mass: 1, color: 0x8c96a8 },
  { name: 'armor', hp: 80, mass: 2, color: 0x5d6b82 },
  { name: 'deck', hp: 14, mass: 0.5, color: 0x9a8f7c },
  { name: 'engine', hp: 45, mass: 3, color: 0xf2cf3a }, // impulse drive
  { name: 'module', hp: 24, mass: 1.5, color: 0x3fb8a6 },
  { name: 'thruster', hp: 22, mass: 0.8, color: 0x52d4ee },
  { name: 'turret', hp: 35, mass: 1.5, color: 0x5b6478 },
  { name: 'reactor', hp: 120, mass: 4, color: 0xe0507a },
  { name: 'shieldgen', hp: 30, mass: 2, color: 0x6a86ff },
  { name: 'wall', hp: 26, mass: 1.2, color: 0x596273 },
  { name: 'door', hp: 20, mass: 0.6, color: 0xe0b34e },
  { name: 'ladder', hp: 14, mass: 0.5, color: 0x4fae7a },
  { name: 'bridge', hp: 24, mass: 1.5, color: 0xd8e6ff },
  // Interior decor: fixtures a room is furnished with rather than systems it runs.
  // Flimsy and light — they die to the same hits the deck under them would.
  { name: 'seat', hp: 10, mass: 0.4, color: 0x7a8296 },
  { name: 'console', hp: 12, mass: 0.6, color: 0x2c333d },
  { name: 'core', hp: 120, mass: 4, color: 0xff6fa0 },
  // Drive family (see propulsion.ts): cruise main drive, nose brakes, turning nozzles.
  { name: 'cruise', hp: 55, mass: 4, color: 0xd8423a },
  { name: 'brake', hp: 22, mass: 0.8, color: 0xeef2f6 },
  { name: 'turn', hp: 22, mass: 0.8, color: 0xa362e8 },
  // Space rock: the asteroids (sim/rocks.ts); tough and heavy, and its veins are painted on it.
  { name: 'rock', hp: 45, mass: 1.6, color: 0x7a7064 },
  { name: 'ore', hp: 22, mass: 1.7, color: 0xd9a830 },
  { name: 'ore2', hp: 36, mass: 1.8, color: 0xc060e0 },
];
