import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { GridBody } from '../sim/body';
import { moduleEfficiency, type WeaponType } from '../sim/grid';
import { shieldRadius } from '../sim/raycast';
import { shieldActive } from '../sim/systems';
import { WEAPONS } from '../sim/weapons';
import type { SimEvent, World } from '../sim/world';
import type { Particles } from './particles';
import { OUTER_VIEW } from './shipView';

const TEAM_COLORS: Record<number, number> = { 0: 0x59b8ff, 1: 0xff6a5a };

interface Wave {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
}

interface ShieldHit {
  x: number;
  y: number;
  life: number;
}

function teamColor(team: number): number {
  return TEAM_COLORS[team] ?? 0xcccccc;
}

// Pixel art for the barrel that sticks out past a turret's own hull cell, drawn at
// exactly 1 texture pixel = 1 world unit so it reads at the same resolution as the
// ship's own hull texture instead of a smooth vector shape sitting on top of it.
// 'W' pixels are white so a Sprite tint can recolor them per weapon/enabled state;
// 'D' pixels are baked as a fixed dark mount color. Row 0 is the muzzle end, the
// last row is the mount end (anchored to the turret's cell).
const BARREL_ART: Record<WeaponType, string[]> = {
  pulse: ['.W.W.', '.W.W.', '.W.W.', 'DDDDD'],
  heavy: ['..W..', '.WWW.', '.WWW.', 'WWWWW', '.DDD.'],
  beam: ['.W.', '.W.', '.W.', 'DDD'],
};

const barrelTextureCache = new Map<WeaponType, Texture>();

function getBarrelTexture(type: WeaponType): Texture {
  let tex = barrelTextureCache.get(type);
  if (tex) return tex;
  const art = BARREL_ART[type];
  const cols = art[0].length;
  const rows = art.length;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = art[y][x];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'D' ? '#2a3140' : '#ffffff';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  barrelTextureCache.set(type, tex);
  return tex;
}

interface BarrelDraw {
  x: number;
  y: number;
  angle: number;
  type: WeaponType;
  color: number;
  firing: boolean;
  tipX: number;
  tipY: number;
}

export class CombatFx {
  readonly container = new Container();
  private readonly gfx = new Graphics();
  private readonly boltLayer = new Container();
  private readonly barrelLayer = new Container();
  private readonly textLayer = new Container();
  private bolts: Sprite[] = [];
  private barrelSprites: Sprite[] = [];
  private muzzleSprites: Sprite[] = [];
  private texts = new Map<number, Text>();
  private waves: Wave[] = [];
  private hits: ShieldHit[] = [];
  private barrelDraws: BarrelDraw[] = [];

  constructor() {
    this.container.addChild(this.gfx, this.barrelLayer, this.boltLayer, this.textLayer);
  }

  reset(): void {
    this.waves.length = 0;
    this.hits.length = 0;
    for (const t of this.texts.values()) t.destroy();
    this.texts.clear();
    this.gfx.clear();
  }

  handleEvents(events: SimEvent[], particles: Particles): void {
    for (const e of events) {
      if (e.t === 'shot') {
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          particles.emit(e.x, e.y, Math.cos(a) * 10, Math.sin(a) * 10, 0.1, 1.1, e.color, true, 3);
        }
      } else if (e.t === 'shield') {
        this.hits.push({ x: e.x, y: e.y, life: 0.35 });
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2;
          particles.emit(e.x, e.y, Math.cos(a) * 18, Math.sin(a) * 18, 0.25, 0.9, 0x9fd8ff, true, 2);
        }
      } else if (e.t === 'detonate') {
        this.waves.push({ x: e.x, y: e.y, r: e.r, life: 1, maxLife: 1 });
        for (let i = 0; i < 160; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 10 + Math.random() * Math.min(120, e.r * 2.2);
          const c = i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xffb347 : 0xff5a3a;
          particles.emit(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.9, 1.4 + Math.random() * 2.4, c, true, 1.2);
        }
      } else if (e.t === 'dead') {
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 6 + Math.random() * 30;
          particles.emit(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.4 + Math.random() * 0.6, 1 + Math.random() * 1.6, 0xffa050, true, 1.5);
        }
      } else if (e.t === 'crewLost') {
        // A small pale vapor puff — the last trace of air going out with them — rather
        // than a fiery burst, to read as a person lost, not a ship dying.
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 2 + Math.random() * 8;
          const c = i % 3 === 0 ? 0xffffff : 0xdfefff;
          particles.emit(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.5, 0.5 + Math.random() * 0.7, c, true, 1.8);
        }
      }
    }
  }

  update(world: World, dt: number, scale: number, layerView: number): void {
    const g = this.gfx;
    g.clear();
    const px = 1.5 / scale;
    const time = performance.now() / 1000;
    this.barrelDraws.length = 0;

    for (const bm of world.beams) {
      g.moveTo(bm.x0, bm.y0).lineTo(bm.x1, bm.y1).stroke({ width: 2.4, color: bm.color, alpha: 0.28 });
      g.moveTo(bm.x0, bm.y0).lineTo(bm.x1, bm.y1).stroke({ width: 0.9, color: 0xffffff, alpha: 0.95 });
    }

    const focus = world.player?.sys?.focus;
    const locked = focus ? world.findShip(focus.shipId) : null;
    if (locked && world.player) {
      const r = locked.radius + 3;
      const pulse = 0.75 + 0.25 * Math.sin(time * 6);
      const c = 0xffd24a;
      const k = Math.min(6, r * 0.45);
      const w = px * 1.6;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const cx = locked.x + sx * r;
          const cy = locked.y + sy * r;
          g.moveTo(cx, cy - sy * k).lineTo(cx, cy).lineTo(cx - sx * k, cy).stroke({ width: w, color: c, alpha: pulse });
        }
      }
      const p = world.player;
      const dx = locked.x - p.x;
      const dy = locked.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      g.moveTo(p.x + (dx / d) * (p.radius + 4), p.y + (dy / d) * (p.radius + 4))
        .lineTo(locked.x - (dx / d) * (r + 1), locked.y - (dy / d) * (r + 1))
        .stroke({ width: px, color: c, alpha: 0.18 });
    }

    const warned = new Set<number>();
    for (const b of world.bodies) {
      const sys = b.sys;
      if (b.removed || !sys || sys.dead) continue;

      if (shieldActive(sys)) {
        const R = shieldRadius(b);
        const frac = sys.shield / Math.max(sys.shieldMax, 1);
        const col = teamColor(sys.team);
        g.circle(b.x, b.y, R).fill({ color: col, alpha: 0.03 + 0.1 * sys.shieldFlash });
        g.circle(b.x, b.y, R).stroke({ width: px * (1 + sys.shieldFlash), color: col, alpha: 0.14 + 0.28 * frac + 0.55 * sys.shieldFlash });
      }

      if (layerView === OUTER_VIEW || layerView === 0) this.collectBarrels(b);

      if (!b.isPlayer) this.drawBars(b);

      if (sys.countdown >= 0) {
        warned.add(b.shipId);
        const pulse = 0.5 + 0.5 * Math.sin(time * 14);
        g.circle(b.x, b.y, b.radius + 2 + pulse * 2).stroke({ width: px * 2, color: 0xff3a2a, alpha: 0.5 + 0.4 * pulse });
        let t = this.texts.get(b.shipId);
        if (!t) {
          t = new Text({ text: '', style: { fill: '#ff5a4a', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 30, fontWeight: '700', stroke: { color: '#200000', width: 5 } } });
          t.anchor.set(0.5);
          this.textLayer.addChild(t);
          this.texts.set(b.shipId, t);
        }
        t.text = `РЕАКТОР ${Math.max(0, sys.countdown).toFixed(1)}`;
        t.scale.set(0.5 / scale);
        t.position.set(b.x, b.y - b.radius - 9);
      }
    }
    for (const [id, t] of this.texts) {
      if (!warned.has(id)) {
        t.destroy();
        this.texts.delete(id);
      }
    }

    for (const h of this.hits) g.circle(h.x, h.y, 1.4 + (0.35 - h.life) * 6).fill({ color: 0xcfeaff, alpha: Math.max(0, h.life / 0.35) * 0.8 });
    this.hits = this.hits.filter((h) => (h.life -= dt) > 0);

    for (const w of this.waves) {
      w.life -= dt;
      const k = 1 - w.life / w.maxLife;
      const r = w.r * (1 - Math.pow(1 - Math.min(1, k), 3));
      g.circle(w.x, w.y, r).stroke({ width: 1.8 * (1 - k) + 0.3, color: 0xffd9a0, alpha: Math.max(0, 1 - k) });
      g.circle(w.x, w.y, r * 0.96).fill({ color: 0xff8a40, alpha: Math.max(0, 0.22 * (1 - k)) });
    }
    this.waves = this.waves.filter((w) => w.life > 0);

    this.syncBolts(world);
    this.syncBarrels(this.barrelDraws);
  }

  private collectBarrels(b: GridBody): void {
    const grid = b.grid;
    for (const m of grid.modules) {
      const w = m.weapon;
      if (m.kind !== 'turret' || !w || moduleEfficiency(m) <= 0) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const i of m.cells) {
        if (grid.mat[i] === 0) continue;
        sx += grid.xOf(i) + 0.5;
        sy += grid.yOf(i) + 0.5;
        n++;
      }
      if (n === 0) continue;
      const wp = b.localToWorld(sx / n, sy / n, { x: 0, y: 0 });
      const ang = b.angle + w.arcCenter + w.off;
      const fx = Math.sin(ang);
      const fy = -Math.cos(ang);
      const reach = BARREL_ART[w.type].length;
      this.barrelDraws.push({
        x: wp.x,
        y: wp.y,
        angle: ang,
        type: w.type,
        color: w.enabled ? WEAPONS[w.type].color : 0x6a6a6a,
        firing: w.firing,
        tipX: wp.x + fx * (reach - 0.5),
        tipY: wp.y + fy * (reach - 0.5),
      });
    }
  }

  private syncBarrels(list: BarrelDraw[]): void {
    while (this.barrelSprites.length < list.length) {
      const s = new Sprite();
      s.anchor.set(0.5, 1);
      this.barrelLayer.addChild(s);
      this.barrelSprites.push(s);
    }
    while (this.muzzleSprites.length < list.length) {
      const s = new Sprite(Texture.WHITE);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      this.barrelLayer.addChild(s);
      this.muzzleSprites.push(s);
    }
    for (let i = 0; i < this.barrelSprites.length; i++) {
      const s = this.barrelSprites[i];
      const m = this.muzzleSprites[i];
      if (i >= list.length) {
        s.visible = false;
        m.visible = false;
        continue;
      }
      const d = list[i];
      s.visible = true;
      s.texture = getBarrelTexture(d.type);
      s.tint = d.color;
      s.position.set(d.x, d.y);
      s.rotation = d.angle;
      m.visible = d.firing;
      if (d.firing) {
        m.tint = 0xfff3d0;
        m.width = m.height = d.type === 'heavy' ? 1.6 : d.type === 'beam' ? 1.1 : 0.8;
        m.position.set(d.tipX, d.tipY);
      }
    }
  }

  private drawBars(b: GridBody): void {
    const sys = b.sys!;
    const g = this.gfx;
    const w = 16;
    const x = b.x - w / 2;
    const y = b.y - b.radius - 5;
    const hull = Math.max(0, Math.min(1, b.grid.cells / sys.cellsMax));
    g.rect(x - 0.4, y - 0.4, w + 0.8, sys.shieldMax > 0 ? 3.3 : 1.7).fill({ color: 0x000000, alpha: 0.55 });
    g.rect(x, y, w * hull, 1).fill({ color: hull > 0.5 ? 0x63e07a : hull > 0.3 ? 0xf2c14e : 0xff5a4a });
    if (sys.shieldMax > 0) {
      g.rect(x, y + 1.5, (w * sys.shield) / sys.shieldMax, 1).fill({ color: sys.shieldDown ? 0xff7a6a : 0x59b8ff });
    }
  }

  private syncBolts(world: World): void {
    const list = world.projectiles;
    while (this.bolts.length < list.length) {
      const s = new Sprite(Texture.WHITE);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      this.boltLayer.addChild(s);
      this.bolts.push(s);
    }
    for (let i = 0; i < this.bolts.length; i++) {
      const s = this.bolts[i];
      if (i >= list.length) {
        s.visible = false;
        continue;
      }
      const p = list[i];
      s.visible = true;
      s.tint = p.color;
      s.width = p.type === 'heavy' ? 2.2 : 0.9;
      s.height = p.type === 'heavy' ? 7 : 4.5;
      s.position.set(p.x, p.y);
      s.rotation = Math.atan2(p.vx, -p.vy);
    }
  }
}
