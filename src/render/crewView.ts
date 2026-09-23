import { Container, Sprite, Texture } from 'pixi.js';
import type { CrewRole } from '../sim/crew';
import type { World } from '../sim/world';

const ROLE_COLOR: Record<CrewRole, number> = {
  pilot: 0xff3ea6,
  gunner: 0xffb347,
  shieldop: 0x59e6ff,
  engineer: 0xffe066,
};

/**
 * A crew member's post is often the same material color the fill would be on its own
 * (e.g. the shieldop stands right on a shield generator, which is the same blue a plain
 * fill would use) — a single-color badge with only one border can disappear against a
 * background that happens to match it. A white halo plus a dark ring around the role
 * color, like a map pin, always has at least one ring that contrasts with whatever
 * material is underneath. `Sprite.tint` multiplies every pixel uniformly, which would
 * also tint the white halo away from white, so instead of one tintable texture this
 * bakes one full-color texture per role directly (only 4 of them, built once) — the
 * same nearest-scaled canvas-texture technique as the turret barrels in combatFx.ts
 * (the shared, untinted `Texture.WHITE` this used originally defaults to linear
 * filtering, which at this zoom level sampled padding from its shared atlas into a
 * blurred, hollow-looking ring instead of a solid badge).
 */
const badgeTextures = new Map<CrewRole, Texture>();

function getBadgeTexture(role: CrewRole): Texture {
  let tex = badgeTextures.get(role);
  if (tex) return tex;
  const art = ['WWWWWWW', 'WDDDDDW', 'WDRRRDW', 'WDRRRDW', 'WDRRRDW', 'WDDDDDW', 'WWWWWWW'];
  const canvas = document.createElement('canvas');
  canvas.width = 7;
  canvas.height = 7;
  const ctx = canvas.getContext('2d')!;
  const roleHex = `#${ROLE_COLOR[role].toString(16).padStart(6, '0')}`;
  const color: Record<string, string> = { W: '#f2f6ff', D: '#0c0f18', R: roleHex };
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      ctx.fillStyle = color[art[y][x]];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  badgeTextures.set(role, tex);
  return tex;
}

/**
 * Small pixel-block badges for crew, drawn only on the matching interior deck view — the
 * opposite gating from turrets, which only show on the hull/outer view.
 *
 * Two things made a dot on top of the hull texture read badly at this scale: smoothly
 * gliding through fractional ship-grid positions made it look like it was drifting loose
 * from the pixel grid instead of belonging to it, and a flat color with no border blends
 * right into a module of a similar hue. Snapping the render position to the cell the
 * crew member currently occupies — never the smooth in-between position the sim uses for
 * movement timing — and baking a dark outline into the badge texture fixes both.
 */
export class CrewView {
  readonly container = new Container();
  private sprites = new Map<number, Sprite>();

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
        s = new Sprite(getBadgeTexture(c.role));
        s.anchor.set(0.5);
        s.width = 1;
        s.height = 1;
        this.container.addChild(s);
        this.sprites.set(c.id, s);
      }
      s.visible = true;
      s.texture = getBadgeTexture(c.role);
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
      s.rotation = body.angle;
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
  }
}
