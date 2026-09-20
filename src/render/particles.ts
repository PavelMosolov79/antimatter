import { Container, Sprite, Texture } from 'pixi.js';
import type { SimEvent } from '../sim/world';

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  drag: number;
  active: boolean;
}

const MAX_PARTICLES = 2500;

export class Particles {
  readonly container = new Container();
  private pool: Particle[] = [];
  private live: Particle[] = [];

  private acquire(): Particle | null {
    if (this.live.length >= MAX_PARTICLES) return null;
    let p = this.pool.pop();
    if (!p) {
      const sprite = new Sprite(Texture.WHITE);
      sprite.anchor.set(0.5);
      p = { sprite, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, drag: 0, active: false };
    }
    p.active = true;
    this.container.addChild(p.sprite);
    this.live.push(p);
    return p;
  }

  emit(x: number, y: number, vx: number, vy: number, life: number, size: number, color: number, additive: boolean, drag = 0): void {
    const p = this.acquire();
    if (!p) return;
    p.sprite.position.set(x, y);
    p.sprite.tint = color;
    p.sprite.blendMode = additive ? 'add' : 'normal';
    p.sprite.alpha = 1;
    p.sprite.width = size;
    p.sprite.height = size;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.drag = drag;
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.container.removeChild(p.sprite);
        p.active = false;
        this.pool.push(p);
        this.live[i] = this.live[this.live.length - 1];
        this.live.pop();
        continue;
      }
      const k = p.life / p.maxLife;
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.sprite.alpha = k;
      const s = p.size * (0.4 + 0.6 * k);
      p.sprite.width = s;
      p.sprite.height = s;
    }
  }

  handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.t === 'cell') {
        const n = 2;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 3 + Math.random() * 12;
          this.emit(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.7, 0.7 + Math.random() * 0.7, e.color, false, 1.2);
        }
        const a = Math.random() * Math.PI * 2;
        const sp = 6 + Math.random() * 20;
        this.emit(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + Math.random() * 0.25, 0.9, 0xffc060, true, 2);
      } else if (e.t === 'impact') {
        const n = Math.min(40, 6 + Math.floor(Math.sqrt(e.energy) * 0.15));
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 8 + Math.random() * 40;
          this.emit(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.2 + Math.random() * 0.4, 1 + Math.random() * 1.6, 0xfff0c0, true, 3);
        }
        this.emit(e.x, e.y, 0, 0, 0.18, 3 + Math.min(10, Math.sqrt(e.energy) * 0.05), 0xffffff, true);
      }
    }
  }

  clear(): void {
    for (const p of this.live) {
      this.container.removeChild(p.sprite);
      this.pool.push(p);
    }
    this.live.length = 0;
  }
}
