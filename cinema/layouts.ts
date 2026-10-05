import { TILE, canPlaceModule, defaultLayout, putModule, type PoolModuleId, type ShipLayout } from '../src/sim/layout';
import { saveLayout } from '../src/sim/layoutStore';
import { shipDeckGeo } from '../src/sim/ships';

/** A ship the way a keen player would have built it: every deck filled with posts and services, around the base modules. */
const ORDER: PoolModuleId[] = ['gun', 'eng', 'rcs', 'gun', 'work', 'med', 'crew', 'store', 'pod', 'helm', 'gun', 'work', 'crew', 'gun', 'med', 'eng', 'rcs', 'store'];

export function equip(shipId: string, perDeck: number): ShipLayout {
  const geo = shipDeckGeo(shipId);
  const layout = defaultLayout(geo);
  let n = 0;
  for (let z = 1; z < geo.depth; z++) {
    let placed = 0;
    for (let guard = 0; guard < 200 && placed < perDeck; guard++) {
      const here = layout.mods.filter((m) => m.deck === z);
      let done = false;
      // next to a module already on the deck, nearest the middle first
      const cand: Array<{ i: number; j: number; d: number }> = [];
      for (const m of here) {
        for (const [di, dj] of [[m.tw, 0], [-1, 0], [0, m.th], [0, -1]]) cand.push({ i: m.i + di, j: m.j + dj, d: 0 });
      }
      const cx = geo.w / 2;
      const cy = geo.h / 2;
      for (const c of cand) {
        const o = geo.org[z];
        c.d = Math.hypot(o.ox + TILE * c.i + 5 - cx, o.oy + TILE * c.j + 5 - cy);
      }
      cand.sort((a, b) => a.d - b.d);
      for (const c of cand) {
        if (!canPlaceModule(geo, layout, z, c.i, c.j, 1, 1, null)) continue;
        if (putModule(geo, layout, ORDER[n % ORDER.length], z, c.i, c.j, 1, 1, null)) {
          n++;
          placed++;
          done = true;
          break;
        }
      }
      if (!done) break;
    }
  }
  saveLayout(shipId, layout);
  return layout;
}

export function equipAll(): void {
  equip('fighter', 3);
  equip('cruiser', 7);
  equip('battleship', 9);
}
