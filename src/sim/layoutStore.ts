import type { ShipLayout } from './layout';

/**
 * The layouts the player has saved in the dock's module menu, one per ship, kept in the
 * browser. Whatever isn't saved here is the ship as it comes from the yard.
 */

const KEY = 'antimatter-layouts-v1';
const saved = new Map<string, ShipLayout>();
let loaded = false;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, ShipLayout>;
    for (const [id, l] of Object.entries(data)) if (l && Array.isArray(l.mods) && Array.isArray(l.lads)) saved.set(id, l);
  } catch {
    /* a broken save is as good as none */
  }
}

export function savedLayout(shipId: string): ShipLayout | null {
  load();
  return saved.get(shipId) ?? null;
}

export function saveLayout(shipId: string, layout: ShipLayout | null): void {
  load();
  if (layout) saved.set(shipId, layout);
  else saved.delete(shipId);
  try {
    storage()?.setItem(KEY, JSON.stringify(Object.fromEntries(saved)));
  } catch {
    /* no storage: the layout lives until the page closes */
  }
}

/** Forgets every saved layout: all ships go back to the yard's own (a new game). */
export function clearLayouts(): void {
  load();
  saved.clear();
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
