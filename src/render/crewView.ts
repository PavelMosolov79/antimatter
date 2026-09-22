import { Container, Sprite, Texture } from 'pixi.js';
import type { CrewRole } from '../sim/crew';
import type { World } from '../sim/world';

const ROLE_COLOR: Record<CrewRole, number> = {
  pilot: 0xffffff,
  gunner: 0xffb347,
  shieldop: 0x6a86ff,
  engineer: 0xffe066,
};

/** Small pixel-block dots for crew, drawn only on the matching interior deck view — the
 * opposite gating from turrets, which only show on the hull/outer view. */
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
        s = new Sprite(Texture.WHITE);
        s.anchor.set(0.5);
        s.width = 0.8;
        s.height = 0.8;
        this.container.addChild(s);
        this.sprites.set(c.id, s);
      }
      s.visible = true;
      s.tint = ROLE_COLOR[c.role];
      const wp = body.localToWorld(c.x, c.y, { x: 0, y: 0 });
      s.position.set(wp.x, wp.y);
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
