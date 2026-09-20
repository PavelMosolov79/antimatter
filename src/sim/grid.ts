import { MATERIALS } from './materials';

export type ModuleKind = 'engine' | 'generic';

export interface Module {
  kind: ModuleKind;
  cells: number[];
  total: number;
  alive: number;
  core: number;
  coreAlive: boolean;
  thrust: number;
  rcs: number;
  maneuver: number;
  dirX: number;
  dirY: number;
}

export interface MassProps {
  mass: number;
  comX: number;
  comY: number;
  inertia: number;
}

export interface ModuleOptions {
  core?: [number, number, number];
  thrust?: number;
  rcs?: number;
  maneuver?: number;
  dirX?: number;
  dirY?: number;
}

export function moduleEfficiency(m: Module): number {
  return m.coreAlive && m.total > 0 ? m.alive / m.total : 0;
}

export class ShipGrid {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly layerSize: number;
  readonly mat: Uint8Array;
  readonly hp: Float32Array;
  readonly mod: Uint16Array;
  readonly colCount: Uint8Array;
  modules: Module[] = [];
  mass = 0;
  columns = 0;
  cells = 0;
  version = 0;
  lastAbsorbed = 0;
  private sumMx = 0;
  private sumMy = 0;
  private sumMr2 = 0;

  constructor(width: number, height: number, depth: number) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.layerSize = width * height;
    const n = this.layerSize * depth;
    this.mat = new Uint8Array(n);
    this.hp = new Float32Array(n);
    this.mod = new Uint16Array(n);
    this.colCount = new Uint8Array(this.layerSize);
  }

  idx(x: number, y: number, z: number): number {
    return z * this.layerSize + y * this.width + x;
  }

  xOf(idx: number): number {
    return (idx % this.layerSize) % this.width;
  }

  yOf(idx: number): number {
    return Math.floor((idx % this.layerSize) / this.width);
  }

  zOf(idx: number): number {
    return Math.floor(idx / this.layerSize);
  }

  isOccupied(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.colCount[y * this.width + x] > 0;
  }

  topLayer(x: number, y: number): number {
    for (let z = 0; z < this.depth; z++) {
      if (this.mat[this.idx(x, y, z)] !== 0) return z;
    }
    return -1;
  }

  private accumulate(x: number, y: number, m: number, sign: 1 | -1): void {
    const d = MATERIALS[m];
    const cx = x + 0.5;
    const cy = y + 0.5;
    this.mass += sign * d.mass;
    this.sumMx += sign * d.mass * cx;
    this.sumMy += sign * d.mass * cy;
    this.sumMr2 += sign * d.mass * (cx * cx + cy * cy);
  }

  setCell(x: number, y: number, z: number, m: number): void {
    const i = this.idx(x, y, z);
    if (this.mat[i] !== 0) this.removeCell(i);
    if (m === 0) return;
    this.mat[i] = m;
    this.hp[i] = MATERIALS[m].hp;
    const col = y * this.width + x;
    if (this.colCount[col]++ === 0) this.columns++;
    this.cells++;
    this.accumulate(x, y, m, 1);
    this.version++;
  }

  copyCellFrom(src: ShipGrid, sidx: number, x: number, y: number, z: number): void {
    const m = src.mat[sidx];
    if (m === 0) return;
    const i = this.idx(x, y, z);
    this.mat[i] = m;
    this.hp[i] = src.hp[sidx];
    const col = y * this.width + x;
    if (this.colCount[col]++ === 0) this.columns++;
    this.cells++;
    this.accumulate(x, y, m, 1);
    this.version++;
  }

  removeCell(i: number): number {
    const m = this.mat[i];
    if (m === 0) return 0;
    const rem = i % this.layerSize;
    const y = Math.floor(rem / this.width);
    const x = rem - y * this.width;
    this.accumulate(x, y, m, -1);
    this.mat[i] = 0;
    this.hp[i] = 0;
    if (--this.colCount[rem] === 0) this.columns--;
    this.cells--;
    const mid = this.mod[i];
    if (mid !== 0) {
      const mod = this.modules[mid - 1];
      mod.alive--;
      if (i === mod.core) mod.coreAlive = false;
      this.mod[i] = 0;
    }
    this.version++;
    return m;
  }

  damageColumn(x: number, y: number, dmg: number, pen: number, out?: number[]): number {
    let remaining = dmg;
    let destroyed = 0;
    let absorbed = 0;
    for (let z = 0; z < this.depth; z++) {
      const i = this.idx(x, y, z);
      const m = this.mat[i];
      if (m === 0) continue;
      const h = this.hp[i];
      if (remaining >= h) {
        absorbed += h;
        remaining = (remaining - h) * pen;
        this.removeCell(i);
        if (out) out.push(x, y, z, m);
        destroyed++;
        if (remaining <= 0.01) break;
      } else {
        absorbed += remaining;
        this.hp[i] = h - remaining;
        this.version++;
        break;
      }
    }
    this.lastAbsorbed = absorbed;
    return destroyed;
  }

  applyCrater(lx: number, ly: number, radius: number, dmg: number, pen: number, out?: number[]): number {
    const x0 = Math.max(0, Math.floor(lx - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(lx + radius));
    const y0 = Math.max(0, Math.floor(ly - radius));
    const y1 = Math.min(this.height - 1, Math.ceil(ly + radius));
    let destroyed = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.colCount[y * this.width + x] === 0) continue;
        const dx = x + 0.5 - lx;
        const dy = y + 0.5 - ly;
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius) continue;
        const fall = 1 - d2 / (radius * radius);
        destroyed += this.damageColumn(x, y, dmg * fall, pen, out);
      }
    }
    return destroyed;
  }

  massProps(): MassProps {
    if (this.mass <= 1e-9) return { mass: 0, comX: this.width / 2, comY: this.height / 2, inertia: 1 };
    const comX = this.sumMx / this.mass;
    const comY = this.sumMy / this.mass;
    const inertia = this.sumMr2 + this.mass / 6 - this.mass * (comX * comX + comY * comY);
    return { mass: this.mass, comX, comY, inertia: Math.max(inertia, 1e-3) };
  }

  addModule(kind: ModuleKind, cells: Array<[number, number, number]>, opts: ModuleOptions = {}): number {
    const idxs = cells.map(([x, y, z]) => this.idx(x, y, z));
    const core = opts.core ? this.idx(opts.core[0], opts.core[1], opts.core[2]) : idxs[0];
    const module: Module = {
      kind,
      cells: idxs,
      total: idxs.length,
      alive: idxs.length,
      core,
      coreAlive: true,
      thrust: opts.thrust ?? 0,
      rcs: opts.rcs ?? 0,
      maneuver: opts.maneuver ?? 0,
      dirX: opts.dirX ?? 0,
      dirY: opts.dirY ?? -1,
    };
    this.modules.push(module);
    const id = this.modules.length;
    for (const i of idxs) this.mod[i] = id;
    return id;
  }
}
