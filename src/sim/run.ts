import type { GridBody } from './body';
import { ensureRooms } from './compartments';
import { findComponents } from './fragment';
import type { Celestial } from './gravity';
import type { ShipGrid } from './grid';
import { MATERIALS, Mat } from './materials';
import { mulberry32, type Rng } from './rng';

/**
 * One run: a seeded map of nodes from a start column to a single boss at the end. The
 * player picks a path column by column; the ship they fly carries every bit of damage
 * from node to node, with repair stations the only way to patch it up along the way.
 */

export type NodeKind = 'start' | 'combat' | 'elite' | 'repair' | 'boss';

export interface MapNode {
  id: number;
  col: number;
  /** Vertical position within the column, 0..1, for drawing and non-crossing edges. */
  row: number;
  kind: NodeKind;
  next: number[];
}

export interface RunMap {
  seed: number;
  cols: number;
  nodes: MapNode[];
}

export const RUN = {
  cols: 8,
  minPerCol: 2,
  maxPerCol: 4,
  eliteFromCol: 3,
  eliteChance: 0.25,
  /** Share of the hull lost so far that one repair station patches back. */
  repairShare: 0.5,
};

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

export function generateMap(seed: number, cols = RUN.cols): RunMap {
  const rng = mulberry32(seed);
  const nodes: MapNode[] = [];
  const byCol: MapNode[][] = [];
  for (let c = 0; c < cols; c++) {
    const n = c === 0 || c === cols - 1 ? 1 : RUN.minPerCol + Math.floor(rng() * (RUN.maxPerCol - RUN.minPerCol + 1));
    const col: MapNode[] = [];
    for (let r = 0; r < n; r++) {
      const row = n === 1 ? 0.5 : (r + 0.5) / n;
      const node: MapNode = { id: nodes.length, col: c, row, kind: 'combat', next: [] };
      nodes.push(node);
      col.push(node);
    }
    byCol.push(col);
  }
  byCol[0][0].kind = 'start';
  byCol[cols - 1][0].kind = 'boss';

  // Edges only ever go one column right, to the nearest node(s) by row, so paths fan out
  // and merge without tangling; then every node that ended up with no way in gets one.
  for (let c = 0; c < cols - 1; c++) {
    const a = byCol[c];
    const b = byCol[c + 1];
    const link = (from: MapNode, to: MapNode) => {
      if (!from.next.includes(to.id)) from.next.push(to.id);
    };
    for (let i = 0; i < a.length; i++) {
      if (a.length === 1) {
        for (const t of b) link(a[i], t);
        continue;
      }
      const j = Math.round((i * (b.length - 1)) / (a.length - 1));
      link(a[i], b[j]);
      if (j + 1 < b.length && rng() < 0.35) link(a[i], b[j + 1]);
      else if (j - 1 >= 0 && rng() < 0.35) link(a[i], b[j - 1]);
    }
    for (let j = 0; j < b.length; j++) {
      if (a.some((n) => n.next.includes(b[j].id))) continue;
      const i = a.length === 1 ? 0 : Math.round((j * (a.length - 1)) / Math.max(1, b.length - 1));
      link(a[i], b[j]);
    }
    for (const n of a) n.next.sort((p, q) => nodes[p].row - nodes[q].row);
  }

  // Node kinds: a repair station midway and one right before the boss; elites only
  // once the player has had a few fights to find their feet.
  const mid = Math.floor((cols - 1) / 2);
  pick(rng, byCol[mid]).kind = 'repair';
  pick(rng, byCol[cols - 2]).kind = 'repair';
  for (let c = RUN.eliteFromCol; c < cols - 1; c++) {
    for (const n of byCol[c]) if (n.kind === 'combat' && rng() < RUN.eliteChance) n.kind = 'elite';
  }
  return { seed, cols, nodes };
}

export interface Encounter {
  enemies: string[];
  celestials: Celestial[];
}

const COMBAT_EARLY = [['scout'], ['scout', 'scout'], ['raider']];
const COMBAT_MID = [['raider', 'scout'], ['hunter'], ['scout', 'scout', 'scout']];
const COMBAT_LATE = [['raider', 'hunter'], ['hunter', 'scout', 'scout'], ['raider', 'raider']];
const ELITE = [['raider', 'raider', 'scout'], ['hunter', 'raider'], ['hunter', 'hunter', 'scout']];

/** What waits at a node: its enemies and the bodies of its arena, both from the map's seed. */
export function encounterFor(map: RunMap, node: MapNode): Encounter {
  const rng = mulberry32((map.seed * 7919 + node.id * 104729) >>> 0);
  let enemies: string[] = [];
  const depth = node.col / (map.cols - 1);
  if (node.kind === 'boss') enemies = ['boss'];
  else if (node.kind === 'elite') enemies = pick(rng, ELITE);
  else if (node.kind === 'combat') enemies = pick(rng, depth < 0.34 ? COMBAT_EARLY : depth < 0.67 ? COMBAT_MID : COMBAT_LATE);
  return { enemies, celestials: arenaFor(rng, node) };
}

/** A planet (sometimes with a moon), a distant star, and deeper in the run the odd black hole. */
function arenaFor(rng: Rng, node: MapNode): Celestial[] {
  const out: Celestial[] = [];
  // The player spawns at the origin facing up and the enemies come from above, so the
  // planet goes somewhere in the lower half and its moon on the planet's far side.
  const pa = Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.2;
  const pd = 620 + rng() * 380;
  const pr = 70 + rng() * 60;
  const px = Math.cos(pa) * pd;
  const py = Math.sin(pa) * pd;
  out.push({ kind: 'planet', x: px, y: py, radius: pr, mu: pr * pr * 9, soft: 2, seed: Math.floor(rng() * 1000) });
  if (rng() < 0.6) {
    const ma = pa + (rng() - 0.5) * Math.PI;
    const md = pr + 90 + rng() * 80;
    out.push({ kind: 'moon', x: px + Math.cos(ma) * md, y: py + Math.sin(ma) * md, radius: 22 + rng() * 10, mu: 6000, soft: 1, seed: Math.floor(rng() * 1000) });
  }
  const sa = rng() * Math.PI * 2;
  out.push({ kind: 'star', x: Math.cos(sa) * 2800, y: Math.sin(sa) * 2800, radius: 220, mu: 677000, soft: 5, seed: Math.floor(rng() * 1000) });
  if (node.col >= 4 && rng() < 0.35) {
    const ba = sa + Math.PI * (0.6 + rng() * 0.8);
    out.push({ kind: 'blackhole', x: Math.cos(ba) * 2300, y: Math.sin(ba) * 2300, radius: 22, mu: 160000, soft: 8, seed: Math.floor(rng() * 1000) });
  }
  return out;
}

/**
 * Between battles the crew get the air back into every compartment whose hull is still
 * whole and put out what's left burning; a room open to space stays vented until the
 * hole itself is patched.
 */
export function restAfterBattle(body: GridBody): void {
  const sys = body.sys;
  if (!sys) return;
  if (sys.rooms) {
    const g = body.grid;
    const graph = ensureRooms(body);
    for (const room of graph.rooms) {
      let breached = false;
      for (const i of room.cells) {
        const top = g.topLayer(g.xOf(i), g.yOf(i));
        if (top === -1 || top >= room.z) {
          breached = true;
          break;
        }
      }
      room.breached = breached;
      if (!breached) room.pressure = 1;
      room.fire = 0;
    }
  }
  sys.energy = sys.energyMax;
  sys.shield = sys.shieldMax;
  sys.shieldDown = false;
}

export interface RepairReport {
  healed: number;
  /** Cell indices rebuilt from the blueprint. */
  rebuilt: number[];
  lostForGood: number;
}

/**
 * A repair station patches the hull against the ship's own blueprint: every surviving
 * cell back to full strength, and up to `share` of the missing cells rebuilt, outer hull
 * first so breaches close before interiors get refitted. What it can't do is conjure back
 * a module whose core was destroyed or a piece that broke off and drifted away — that is
 * dock work.
 */
export function repairShip(body: GridBody, blueprint: ShipGrid, share = RUN.repairShare): RepairReport {
  const g = body.grid;
  const ox = body.frameX;
  const oy = body.frameY;
  const report: RepairReport = { healed: 0, rebuilt: [], lostForGood: 0 };
  const byKey = new Map<number, number>();
  g.modules.forEach((m, i) => byKey.set(m.key, i));
  const candidates: number[] = [];
  let missing = 0;
  for (let z = 0; z < blueprint.depth; z++) {
    for (let by = 0; by < blueprint.height; by++) {
      for (let bx = 0; bx < blueprint.width; bx++) {
        const bi = blueprint.idx(bx, by, z);
        const m = blueprint.mat[bi];
        if (m === 0) continue;
        const x = bx - ox;
        const y = by - oy;
        if (x < 0 || y < 0 || x >= g.width || y >= g.height) {
          report.lostForGood++;
          continue;
        }
        const i = g.idx(x, y, z);
        if (g.mat[i] !== 0) {
          if (g.mat[i] === m && g.hp[i] < MATERIALS[m].hp) {
            g.hp[i] = MATERIALS[m].hp;
            g.version++;
            report.healed++;
          }
          continue;
        }
        missing++;
        const bm = blueprint.mod[bi];
        if (bm !== 0) {
          const cur = byKey.get(blueprint.modules[bm - 1].key);
          if (cur === undefined || !g.modules[cur].coreAlive) {
            report.lostForGood++;
            continue;
          }
        }
        candidates.push(bi);
      }
    }
  }
  const budget = Math.round(missing * share);
  for (const bi of candidates.slice(0, budget)) {
    const x = blueprint.xOf(bi) - ox;
    const y = blueprint.yOf(bi) - oy;
    const z = blueprint.zOf(bi);
    const i = g.idx(x, y, z);
    const m = blueprint.mat[bi];
    if (m === Mat.DOOR) {
      const did = g.doorIdx[i];
      if (did !== 0) {
        g.setCell(x, y, z, Mat.DOOR);
        g.doors[did - 1].destroyed = false;
      } else g.addDoor(x, y, z);
    } else g.setCell(x, y, z, m);
    if (blueprint.paintFlags && blueprint.paintFlags[bi]) {
      const p = blueprint.paintRGB!;
      g.setPaint(i, p[bi * 3], p[bi * 3 + 1], p[bi * 3 + 2], (blueprint.paintFlags[bi] & 2) !== 0);
    }
    const bm = blueprint.mod[bi];
    if (bm !== 0) {
      const cur = byKey.get(blueprint.modules[bm - 1].key)!;
      const mod = g.modules[cur];
      g.mod[i] = cur + 1;
      mod.alive++;
      if (!mod.cells.includes(i)) mod.cells.push(i);
    }
    report.rebuilt.push(i);
  }
  // Rebuilding stays attached to the ship: a patch that ended up floating on its own
  // (inside the frame where a broken-off piece used to be) is taken back out again.
  const comps = findComponents(g);
  if (comps.count > 1) {
    let main = 0;
    for (let k = 1; k < comps.count; k++) if (comps.mass[k] > comps.mass[main]) main = k;
    const kept: number[] = [];
    for (const i of report.rebuilt) {
      if (comps.labels[i % g.layerSize] === main) kept.push(i);
      else {
        g.removeCell(i);
        report.lostForGood++;
      }
    }
    report.rebuilt = kept;
  }
  body.syncMassProps();
  return report;
}
