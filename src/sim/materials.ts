export const Mat = {
  EMPTY: 0,
  HULL: 1,
  ARMOR: 2,
  DECK: 3,
  ENGINE: 4,
  MODULE: 5,
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
  { name: 'engine', hp: 45, mass: 3, color: 0xd9822b },
  { name: 'module', hp: 24, mass: 1.5, color: 0x3fb8a6 },
];
