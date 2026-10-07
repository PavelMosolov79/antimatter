import { Container, Sprite, Texture } from 'pixi.js';
import type { CrewRole } from '../sim/crew';
import type { World } from '../sim/world';
import { ASTRO_H, ASTRO_W, astronautCanvas } from './astronaut';
import { CREW_LOOK, facing, turnToward } from './crewMotion';

/** How wide an astronaut is on the deck, in cells of the ship (the drawing is 41×20 pixels, arms spread). */
const ASTRO_CELLS = 2;

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

interface Seen {
  x: number;
  y: number;
  turn: number;
  /** Where the step is (radians), whether it was walking last frame, and when it was last drawn (s). */
  phase: number;
  walking: boolean;
  t: number;
}

/**
 * Crew on the deck being viewed, drawn as astronauts. They glide with the simulation from cell to cell, turn
 * smoothly to where they walk (any angle, the helmet is round from above), sway a little with each step, and
 * stand facing the consoles (up) when they are at their post. The sprite does not inherit the ship's rotation,
 * so it is added here.
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
      const wp = body.localToWorld(c.x, c.y, { x: 0, y: 0 });
      s.position.set(wp.x, wp.y);
      const now = performance.now() / 1000;
      let st = this.seen.get(c.id);
      if (!st) {
        st = { x: c.x, y: c.y, turn: Math.PI, phase: 0, walking: false, t: now };
        this.seen.set(c.id, st);
      }
      const dt = Math.min(0.1, Math.max(0, now - st.t));
      st.t = now;
      const mx = c.x - st.x;
      const my = c.y - st.y;
      const moved = Math.hypot(mx, my);
      st.x = c.x;
      st.y = c.y;
      st.walking = moved > 0.002;
      let want = st.turn;
      if (st.walking) {
        want = facing(mx, my);
        st.phase += moved * CREW_LOOK.stridePerCell * Math.PI;
      } else if (c.task === 'atPost') want = Math.PI;
      st.turn = turnToward(st.turn, want, CREW_LOOK.turnRate * dt);
      // a step: the shoulders sway and the body dips a little; standing still, neither
      const step = st.walking ? Math.sin(st.phase) : 0;
      s.rotation = body.angle + st.turn + step * CREW_LOOK.sway;
      s.width = ASTRO_CELLS;
      s.height = ((ASTRO_CELLS * ASTRO_H) / ASTRO_W) * (1 - CREW_LOOK.bob * Math.abs(step));
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
