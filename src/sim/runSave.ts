import type { GridBody } from './body';
import type { Cargo } from './cargo';
import type { RepairJob } from './garage';
import type { ShipGrid } from './grid';
import { MATERIALS } from './materials';
import { QUANTA_START } from './repairConfig';
import type { DutyCrew } from './roster';
import { restAfterBattle } from './run';
import { SHIPS } from './ships';
import { World } from './world';

/**
 * A run on disk: the road is rebuilt from its seed, so the save holds only how far the
 * player got, what is in the hold and what state the ship is in. The ship is written as
 * its difference from the blueprint it was built from — which cells are gone, which are
 * hurt, who on the crew is dead — everything else (air, fire, shields) is refilled between
 * points anyway.
 */

export interface SavedShip {
  /** Bitmap over the blueprint's cells: 1 where the blueprint has a cell but the ship no longer does. */
  gone: string;
  /** Surviving cells that are hurt: blueprint cell index and hit points. */
  hp: Array<[number, number]>;
  /** The crew who are dead, each by role and the key of the module they were posted to (-1 for roaming ones). */
  dead: Array<[string, number]>;
  /** The whole crew is dead (a wreck). */
  allDead?: boolean;
}

export interface SavedRun {
  v: 1;
  seed: number;
  links: number;
  regens: number[];
  shipId: string;
  cleared: number;
  cargo: Cargo;
  battlesWon: number;
  phase: 'map' | 'roaddock';
  note: string;
  ship: SavedShip | null;
  /** A repair under way at the dock the run stopped at. */
  job?: RepairJob | null;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The carried ship as a difference from its blueprint. */
export function captureShip(ship: GridBody, blueprint: ShipGrid): SavedShip {
  const g = ship.grid;
  const bytes = new Uint8Array(Math.ceil((blueprint.width * blueprint.height * blueprint.depth) / 8));
  const hp: Array<[number, number]> = [];
  for (let z = 0; z < blueprint.depth; z++) {
    for (let by = 0; by < blueprint.height; by++) {
      for (let bx = 0; bx < blueprint.width; bx++) {
        const bi = blueprint.idx(bx, by, z);
        const m = blueprint.mat[bi];
        if (m === 0) continue;
        const x = bx - ship.frameX;
        const y = by - ship.frameY;
        const inside = x >= 0 && y >= 0 && x < g.width && y < g.height;
        const i = inside ? g.idx(x, y, z) : -1;
        if (i < 0 || g.mat[i] === 0) bytes[bi >> 3] |= 1 << (bi & 7);
        else if (g.hp[i] < MATERIALS[g.mat[i]].hp - 0.05) hp.push([bi, Math.round(g.hp[i] * 10) / 10]);
      }
    }
  }
  const dead: Array<[string, number]> = (ship.sys?.crew ?? []).filter((c) => c.dead).map((c) => [c.role, c.homeModule >= 0 ? (g.modules[c.homeModule]?.key ?? -2) : -1]);
  return { gone: toBase64(bytes), hp, dead };
}

/** A fresh ship of the class with the saved damage put back on it. */
export function restoreShip(shipId: string, saved: SavedShip, duty?: DutyCrew[]): GridBody {
  const spec = SHIPS.find((s) => s.id === shipId) ?? SHIPS[0];
  const world = new World(1);
  const body = world.spawnShip(spec.build(), 0, 0, 0, { name: spec.label, team: 0, player: true, duty });
  const g = body.grid;
  const bytes = fromBase64(saved.gone);
  const total = g.width * g.height * g.depth;
  for (let bi = 0; bi < total; bi++) if (bytes[bi >> 3] & (1 << (bi & 7)) && g.mat[bi] !== 0) g.removeCell(bi);
  for (const [bi, hp] of saved.hp) if (g.mat[bi] !== 0) g.hp[bi] = hp;
  g.version++;
  // Crew ids are handed out afresh with every ship, so the dead are found again by role and post.
  const crew = body.sys?.crew ?? [];
  if (saved.allDead) for (const c of crew) c.dead = true;
  for (const [role, key] of saved.dead) {
    const c = crew.find((x) => !x.dead && x.role === role && (x.homeModule >= 0 ? (g.modules[x.homeModule]?.key ?? -2) : -1) === key);
    if (c) c.dead = true;
  }
  body.syncMassProps();
  restAfterBattle(body);
  return body;
}

// ------------------------------------------------------------------ browser storage

const RUN_KEY = 'antimatter-run-v1';
const PROFILE_KEY = 'antimatter-profile-v1';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRun(): SavedRun | null {
  try {
    const raw = storage()?.getItem(RUN_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedRun;
    return d && d.v === 1 && typeof d.seed === 'number' && typeof d.cleared === 'number' ? d : null;
  } catch {
    return null;
  }
}

export function storeRun(run: SavedRun | null): void {
  try {
    if (run) storage()?.setItem(RUN_KEY, JSON.stringify(run));
    else storage()?.removeItem(RUN_KEY);
  } catch {
    /* a full or blocked storage just means no save */
  }
}

/** What the player owns outside any run: it survives deaths and new runs. Quanta are the premium stand-in currency. */
export interface Wallet extends Cargo {
  quanta: number;
}

export function loadWallet(): Wallet {
  try {
    const d = JSON.parse(storage()?.getItem(PROFILE_KEY) ?? 'null') as Partial<Wallet> | null;
    return {
      credits: Math.max(0, Number(d?.credits) || 0),
      metal: Math.max(0, Number(d?.metal) || 0),
      // a profile from before quanta existed starts with the starting amount
      quanta: d && d.quanta !== undefined ? Math.max(0, Number(d.quanta) || 0) : QUANTA_START,
    };
  } catch {
    return { credits: 0, metal: 0, quanta: QUANTA_START };
  }
}

export function storeWallet(w: Wallet): void {
  try {
    storage()?.setItem(PROFILE_KEY, JSON.stringify(w));
  } catch {
    /* ignore */
  }
}
