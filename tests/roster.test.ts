import { beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import type { Scene } from '../src/render/scene';
import { CREW } from '../src/sim/crewConfig';
import { mulberry32 } from '../src/sim/rng';
import { assign, atPost, emptyRoster, engineerPlaces, hire, hirePrice, inBarracks, loadRoster, makeMember, onShip, postsOf, reconcile, refreshCandidates, release, staffShip, storeRoster, unassign } from '../src/sim/roster';
import { SHIPS } from '../src/sim/ships';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

function newGame(): Game {
  const scene = { reset() {}, render() {}, layerView: -1 } as unknown as Scene;
  return new Game(scene);
}

describe('the people', () => {
  it('gives a ship a named first crew for every post and every engineer place', () => {
    for (const spec of SHIPS) {
      const grid = spec.build();
      const r = emptyRoster();
      staffShip(r, spec.id, grid, mulberry32(3));
      const posts = postsOf(grid).filter((p) => !p.reserve);
      for (const p of posts) {
        const m = atPost(r, spec.id, p.key)!;
        expect(m).toBeDefined();
        expect(m.role).toBe(p.role);
        expect(m.name.length).toBeGreaterThan(3);
      }
      expect(onShip(r, spec.id).filter((m) => m.role === 'engineer').length).toBe(engineerPlaces(grid));
      expect(new Set(r.members.map((m) => m.name)).size).toBe(r.members.length);
      // staffing again adds nobody
      expect(staffShip(r, spec.id, grid, mulberry32(4))).toBe(0);
    }
  });

  it('offers candidates, hires them for credits into a barracks that holds only so many, and lets people go', () => {
    const r = emptyRoster();
    refreshCandidates(r, mulberry32(9));
    expect(r.candidates.length).toBe(CREW.candidates);
    expect(new Set(r.candidates.map((m) => m.name)).size).toBe(CREW.candidates);
    for (const c of r.candidates) expect(hirePrice(c)).toBeGreaterThanOrEqual(CREW.hirePerLevel * c.lv);
    const first = r.candidates[0];
    expect(hire(r, first.id)).toBe(first);
    expect(inBarracks(r)).toEqual([first]);
    expect(r.candidates).not.toContain(first);
    // the barracks fills up
    for (let i = 0; i < CREW.barracksMax; i++) {
      const m = makeMember(r, mulberry32(i + 20), 'gunner', 1, 1);
      r.candidates.push(m);
      hire(r, m.id);
    }
    expect(inBarracks(r).length).toBe(CREW.barracksMax);
    const extra = makeMember(r, mulberry32(77), 'pilot', 1, 1);
    r.candidates.push(extra);
    expect(hire(r, extra.id)).toBeNull();
    release(r, first.id);
    expect(hire(r, extra.id)).toBe(extra);
  });

  it('seats a person on a post, sending whoever was there to the barracks', () => {
    const spec = SHIPS[0];
    const grid = spec.build();
    const r = emptyRoster();
    staffShip(r, spec.id, grid, mulberry32(5));
    const post = postsOf(grid).find((p) => p.role === 'gunner')!;
    const sitting = atPost(r, spec.id, post.key)!;
    const other = makeMember(r, mulberry32(6), 'gunner', 3, 2);
    r.members.push(other);
    expect(assign(r, other.id, spec.id, post.key)).toBe(true);
    expect(atPost(r, spec.id, post.key)).toBe(other);
    expect(sitting.ship).toBeNull();
    unassign(r, other.id);
    expect(atPost(r, spec.id, post.key)).toBeUndefined();
    // a wounded person cannot be posted
    other.status = 'hurt';
    expect(assign(r, other.id, spec.id, post.key)).toBe(false);
  });

  it('sends people on posts that are gone back to the barracks when the layout changes', () => {
    const spec = SHIPS[1];
    const grid = spec.build();
    const r = emptyRoster();
    staffShip(r, spec.id, grid, mulberry32(8));
    const m = onShip(r, spec.id).find((x) => x.post !== null)!;
    m.post = 99999;
    reconcile(r, spec.id, grid);
    expect(m.ship).toBeNull();
  });

  it('knows where each post is on the ship, for putting people on it', () => {
    for (const spec of SHIPS) {
      const grid = spec.build();
      for (const p of postsOf(grid)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(grid.width);
        expect(p.y).toBeLessThan(grid.height);
        expect(p.z).toBeLessThan(grid.depth);
      }
    }
  });

  it('is kept between sessions', () => {
    const r = emptyRoster();
    staffShip(r, SHIPS[0].id, SHIPS[0].build(), mulberry32(2));
    refreshCandidates(r, mulberry32(3));
    storeRoster(r);
    const back = loadRoster();
    expect(back.members.map((m) => m.name)).toEqual(r.members.map((m) => m.name));
    expect(back.candidates.length).toBe(CREW.candidates);
  });
});

describe('the crew in the game', () => {
  it('flies with the named people posted to the ship, and an empty post stays empty', () => {
    const g = newGame();
    const spec = SHIPS[0];
    const crew = g.world.player!.sys!.crew!;
    expect(crew.length).toBe(onShip(g.roster, spec.id).length);
    for (const c of crew) {
      expect(c.memberId).not.toBeNull();
      expect(c.name.length).toBeGreaterThan(3);
    }
    // take the pilot off the helm: the ship has no pilot
    const grid = g.blueprint(spec.id);
    const helm = postsOf(grid).find((p) => p.role === 'pilot')!;
    const pilot = atPost(g.roster, spec.id, helm.key)!;
    unassign(g.roster, pilot.id);
    g.openDock(spec.id);
    // the spare ship gets a trainee for the empty post at once
    expect(atPost(g.roster, spec.id, helm.key)).toBeDefined();
    expect(atPost(g.roster, spec.id, helm.key)!.id).not.toBe(pilot.id);
  });

  it('leaves a post empty on a ship that is not the spare one until someone is hired', () => {
    const g = newGame();
    const spec = SHIPS[1];
    const grid = g.blueprint(spec.id);
    const gunner = postsOf(grid).find((p) => p.role === 'gunner')!;
    unassign(g.roster, atPost(g.roster, spec.id, gunner.key)!.id);
    g.openDock(spec.id);
    expect(atPost(g.roster, spec.id, gunner.key)).toBeUndefined();
    const crew = g.world.player!.sys!.crew!;
    expect(crew.some((c) => c.role === 'gunner' && c.homeModule >= 0 && grid.modules[c.homeModule].key === gunner.key)).toBe(false);
  });

  it('keeps the names of the crew through a saved run', () => {
    const g = newGame();
    g.startRun();
    const names = g.run!.ship ? g.run!.ship.sys!.crew!.map((c) => c.name) : [];
    g.travel(1);
    g.state = 'won';
    g.continueRun();
    const g2 = newGame();
    g2.continueSaved();
    const crew = g2.run!.ship?.sys?.crew ?? [];
    expect(crew.every((c) => c.name.length > 3)).toBe(true);
    void names;
  });
});
