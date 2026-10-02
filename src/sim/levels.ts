import { holdCap, type Cargo } from './cargo';
import type { ModuleId, PlacedModule, ShipLayout } from './layout';

/**
 * Module levels, as designed in «Док Antimatter» (section «Уровни модулей»): five levels
 * for every module, an instant upgrade paid in Кредиты and Металл, the level belonging to
 * the module — it stays when the module is moved, repaired or put back in the pool. A
 * module whose effect is not in the game yet cannot be upgraded (`live: false`).
 */

export const LV_MAX = 5;

export interface LevelDef {
  /** What the effect is, to finish with the value. */
  title: string;
  values: number[];
  unit: 'pct' | 'plus' | 'times' | 'sec';
  /** The effect is really in the game. */
  live: boolean;
}

export const LEVELS: Record<ModuleId, LevelDef> = {
  gun: { title: 'Орудия стреляют быстрее', values: [0, 10, 20, 30, 45], unit: 'pct', live: false },
  eng: { title: 'Раскрутка маршевых короче', values: [0, 15, 30, 45, 60], unit: 'pct', live: false },
  rcs: { title: 'Поворот и сдвиг мощнее', values: [0, 10, 20, 30, 40], unit: 'pct', live: false },
  work: { title: 'Пробоины герметизируют быстрее', values: [1, 1.25, 1.5, 1.75, 2], unit: 'times', live: false },
  med: { title: 'Шанс космонавта пережить гибель модуля', values: [0, 15, 30, 45, 60], unit: 'pct', live: false },
  crew: { title: 'Места для космонавтов', values: [2, 3, 4, 5, 6], unit: 'plus', live: true },
  store: { title: 'Трюм больше на', values: [50, 75, 100, 130, 170], unit: 'pct', live: true },
  helm: { title: 'Пилот пересаживается за', values: [6, 5, 4, 3, 2], unit: 'sec', live: false },
  core: { title: 'Мощность реактора', values: [0, 10, 20, 30, 40], unit: 'pct', live: false },
  shield: { title: 'Ёмкость щита', values: [0, 15, 30, 45, 60], unit: 'pct', live: false },
  bridge: { title: 'Дальность захвата цели', values: [0, 10, 20, 30, 40], unit: 'pct', live: false },
};

export const levelOf = (m: { lv?: number }): number => Math.max(1, Math.min(LV_MAX, m.lv ?? 1));

export function effectValue(type: ModuleId, lv: number): number {
  return LEVELS[type].values[Math.max(1, Math.min(LV_MAX, lv)) - 1];
}

/** The effect of a module at a level as a short phrase («+20%», «×1,5», «база»). */
export function shortEffect(type: ModuleId, lv: number): string {
  const d = LEVELS[type];
  const x = effectValue(type, lv);
  if (d.unit === 'times') return '×' + String(x).replace('.', ',');
  if (d.unit === 'plus') return '+' + x;
  if (d.unit === 'sec') return x + ' с';
  return x ? '+' + x + '%' : 'база';
}

/** The effect as a sentence for the module card; the hold's size gets its figures for the ship. */
export function effectText(type: ModuleId, lv: number, shipId: string): string {
  const d = LEVELS[type];
  let s = shortEffect(type, lv);
  if (type === 'store') s += ` (${holdCap(shipId)} → ${Math.round(holdCap(shipId) * (1 + effectValue(type, lv) / 100))} мет.)`;
  if (type === 'core' && effectValue(type, lv) > 0) s += `, радиус взрыва +${Math.round(effectValue(type, lv) * 0.8)}%`;
  if (type === 'shield' && effectValue(type, lv) > 0) s += `, перезарядка +${Math.round(effectValue(type, lv) * 0.7)}%`;
  return `${d.title} ${s}`;
}

const COST_CREDITS = [0, 60, 140, 280, 520];
const COST_METAL = [0, 12, 30, 60, 110];

/** A bigger module costs more: ×1 for 1×1, ×1,5 for 2×1, ×2,5 for 2×2, ×3,5 for 3×2, ×5 for 3×3. */
export function sizeFactor(tw: number, th: number): number {
  return 1 + 0.5 * (tw * th - 1);
}

/** What it costs to bring a module of this size up to `toLv`. */
export function upgradeCost(tw: number, th: number, toLv: number): Cargo {
  const f = sizeFactor(tw, th);
  const lv = Math.max(2, Math.min(LV_MAX, toLv));
  return { credits: Math.round(COST_CREDITS[lv - 1] * f), metal: Math.round(COST_METAL[lv - 1] * f) };
}

/** How much metal the hold takes: the class's own, grown by every storeroom on the ship. */
export function holdCapacity(shipId: string, layout: ShipLayout): number {
  let pct = 0;
  for (const m of layout.mods) if (m.type === 'store') pct += effectValue('store', levelOf(m));
  return Math.round(holdCap(shipId) * (1 + pct / 100));
}

/** Extra crew the quarters give: each one adds places by its level. */
export function crewPlaces(mods: Array<{ type?: string; pool?: string; lv?: number }>): number {
  let n = 0;
  for (const m of mods) if ((m.type ?? m.pool) === 'crew') n += effectValue('crew', levelOf(m));
  return n;
}

export type { PlacedModule };
