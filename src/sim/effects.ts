import { moduleEfficiency, type ShipGrid } from './grid';
import { FIELD_REPAIR_BASE, LEVELS, effectValue, levelOf } from './levels';
import type { ModuleId } from './layout';

/**
 * What the player's upgraded modules do for the ship, read from the ship itself so a
 * damaged module counts for what is left of it (a module works in proportion to its
 * surviving cells and not at all once its core is gone). Modules of the pool carry their
 * kind in `pool` and their level in `lv`; a ship without any (the enemies) gets all ones.
 */

export interface ShipEffects {
  /** Orders to fire come sooner, ×. */
  fireRate: number;
  /** Weapons reach further, ×. */
  range: number;
  /** Main drives wind up in this much less time, 0…0.9. */
  spoolCut: number;
  /** Turning and maneuvering nozzles push harder, ×. */
  steer: number;
  /** Hit points per second an engineer patching a room restores to its damaged cells; 0 without a workshop. */
  fieldRepair: number;
  /** Chance that a crew member standing in a module being destroyed gets out alive. */
  rescue: number;
  /** Seconds a pilot needs to take over a reserve helm, or null if the ship has no upgraded one. */
  helmSeconds: number | null;
}

const NONE: ShipEffects = { fireRate: 1, range: 1, spoolCut: 0, steer: 1, fieldRepair: 0, rescue: 0, helmSeconds: null };

export function shipEffects(grid: ShipGrid): ShipEffects {
  let any = false;
  const out: ShipEffects = { ...NONE };
  let workshop = 0;
  let helm: number | null = null;
  for (const m of grid.modules) {
    const type = m.pool as ModuleId | undefined;
    if (!type || !LEVELS[type]) continue;
    any = true;
    const eff = moduleEfficiency(m);
    const lv = levelOf(m);
    const v = effectValue(type, lv);
    if (type === 'gun') out.fireRate += (v / 100) * eff;
    else if (type === 'bridge') out.range += (v / 100) * eff;
    else if (type === 'eng') out.spoolCut = Math.min(0.9, out.spoolCut + (v / 100) * eff);
    else if (type === 'rcs') out.steer += (v / 100) * eff;
    else if (type === 'med') out.rescue = Math.min(0.95, out.rescue + (v / 100) * eff);
    else if (type === 'work') workshop += v * eff;
    else if (type === 'helm' && eff > 0) helm = helm === null ? v : Math.min(helm, v);
  }
  if (!any) return NONE;
  out.fieldRepair = FIELD_REPAIR_BASE * workshop;
  out.helmSeconds = helm;
  return out;
}
