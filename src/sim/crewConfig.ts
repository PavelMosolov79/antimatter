/**
 * Every number of the crew in one place, so they can be changed fast. They are for tests and
 * not balanced yet (balance comes last).
 */
export const CREW = {
  /** Most people the barracks keeps in reserve. */
  barracksMax: 8,
  /** How many candidates the dock offers at a time. */
  candidates: 5,
  /** Credits to hire a candidate: this × level × the rarity's multiplier. */
  hirePerLevel: 60,
  /** Credits to refresh the list of candidates. */
  refreshPrice: 25,
  /** The free starting crew of a ship, level and rarity. */
  starterLevel: 1,
  /** Nobody to fly the ship and fewer credits than this: the dock lends a trainee pilot (the only people who come from nowhere). */
  emergencyCredits: 100,
  /** Seconds to heal a wounded person at the dock: this, grown by a tenth for every level above the first (a tough one heals in two thirds). */
  healSeconds: 25,
  /** Credits to start the healing: this × level × the rarity's multiplier. */
  healPerLevel: 20,
  /** A quantum speeds the healing up by this many seconds. */
  healQuantaSeconds: 15,
  /** Escape pods (the module): seats at the first level and for every level above it. */
  podSeatsBase: 3,
  podSeatsPerLevel: 2,
  /** A person in a pod gets away with this chance at the first level, plus this for every level above it. */
  podChanceBase: 0.5,
  podChancePerLevel: 0.05,
  /** A lucky one adds this to the chance, and the medical bay this share of its rescue chance. */
  podLuckyBonus: 0.15,
  podMedShare: 0.5,
};

/** How rare a person is: the name, the price multiplier, how many traits they tend to have. */
export const RARITY = [
  { name: 'Обычный', price: 1, traits: 0.6 },
  { name: 'Необычный', price: 1.5, traits: 1 },
  { name: 'Редкий', price: 2.2, traits: 2 },
  { name: 'Эпический', price: 3.5, traits: 2 },
  { name: 'Легендарный', price: 6, traits: 2 },
];
