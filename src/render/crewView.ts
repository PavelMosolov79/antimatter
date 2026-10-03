import { Container, Sprite, Texture } from 'pixi.js';
import type { CrewRole } from '../sim/crew';
import type { World } from '../sim/world';
import { ASTRO_H, ASTRO_W, astronautCanvas } from './astronaut';

/** How wide an astronaut is on the deck, in cells of the ship (the drawing is 41×20 pixels, arms spread). */
const ASTRO_CELLS = 3.2;

/**
 * One texture per profession, made once: the astronaut seen from above, the suit in the colour of the
 * profession (see astronaut.ts). Smoothed when shrunk, so a person stays readable at any zoom.
 */
const textures = new Map<CrewRole, Texture>();

function getTexture(role: CrewRole): Texture {
  let tex = textures.get(role);
  if (tex) return tex;
  tex = Texture.from(astronautCanvas(role));
  tex.source.scaleMode = 'linear';
  textures.set(role, tex);
  return tex;
}

/** The turn (in radians, clockwise) that makes the downward-facing drawing look along (dx, dy) in ship coordinates, snapped to a quarter turn. */
function quarterTurn(dx: number, dy: number): number {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? Math.PI / 2 : -Math.PI / 2;
  return dy < 0 ? Math.PI : 0;
}

interface Seen {
  x: number;
  y: number;
  turn: number;
}

/**
 * Crew on the deck being viewed, drawn as astronauts. They hop from cell to cell with the rest of the
 * ship's blocky art (never glide), turn to face where they walk, and stand facing the consoles (up)
 * when they are at their post. The sprite does not inherit the ship's rotation, so it is added here.
 */
export class CrewView {
  readonly container = new Container();
  private sprites = new Map<number, Sprite>();
  private seen = new Map<number, Seen>();

  update(world: World, layerView: number): void {
    const crew = world.player?.sys?.crew;
    const body = world.player;
    if (!crew || !body || layerView < 0) {
      this.hideAll();
      return;
    }
    const seen = new Set<number>();
    for (const c of crew) {
      if (c.dead || c.z !== layerView) continue;
      seen.add(c.id);
      let s = this.sprites.get(c.id);
      if (!s) {
        s = new Sprite(getTexture(c.role));
        s.anchor.set(0.5);
        s.width = ASTRO_CELLS;
        s.height = (ASTRO_CELLS * ASTRO_H) / ASTRO_W;
        this.container.addChild(s);
        this.sprites.set(c.id, s);
      }
      s.visible = true;
      s.texture = getTexture(c.role);
      // Snap to the exact ship cell the crew member currently occupies rather than the
      // smooth sub-cell position the simulation moves through — the badge should hop
      // pixel to pixel with the rest of the ship's own blocky art, not glide.
      const cx = Math.floor(c.x) + 0.5;
      const cy = Math.floor(c.y) + 0.5;
      const wp = body.localToWorld(cx, cy, { x: 0, y: 0 });
      s.position.set(wp.x, wp.y);
      // The badge's position already orbits with the hull via localToWorld, but the
      // sprite itself doesn't inherit the ship's rotation the way BodyView's hull
      // sprite does — without this it stays screen-upright while the ship turns under
      // it, reading as pinned to the screen instead of standing on the deck.
      let st = this.seen.get(c.id);
      if (!st) {
        st = { x: c.x, y: c.y, turn: Math.PI };
        this.seen.set(c.id, st);
      }
      const mx = c.x - st.x;
      const my = c.y - st.y;
      if (Math.hypot(mx, my) > 0.02) {
        st.turn = quarterTurn(mx, my);
        st.x = c.x;
        st.y = c.y;
      } else if (c.task === 'atPost') st.turn = Math.PI;
      s.rotation = body.angle + st.turn;
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) s.visible = false;
    }
  }

  private hideAll(): void {
    for (const s of this.sprites.values()) s.visible = false;
  }

  reset(): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.seen.clear();
  }
}
