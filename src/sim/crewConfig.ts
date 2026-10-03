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
};

/** How rare a person is: the name, the price multiplier, how many traits they tend to have. */
export const RARITY = [
  { name: 'Обычный', price: 1, traits: 0.6 },
  { name: 'Необычный', price: 1.5, traits: 1 },
  { name: 'Редкий', price: 2.2, traits: 2 },
  { name: 'Эпический', price: 3.5, traits: 2 },
  { name: 'Легендарный', price: 6, traits: 2 },
];
