import type { CrewRole } from '../sim/crew';
import { mulberry32 } from '../sim/rng';

/**
 * The portraits of the crew, painted pixel by pixel from the name: a 24×24 bust on a noisy dark
 * backdrop, in a suit of the profession's colours with its badge on the shoulder. Three kinds: a closed
 * helmet with the sky in its visor, a helmet with the visor up and the face showing, no helmet at all
 * (hair, gear, a scar or a beard). Rarer people wear showier things. The same person always looks the same.
 */

type RGB = [number, number, number];
export const PORTRAIT_SIZE = 24;
const PW = PORTRAIT_SIZE;

const hex3 = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const cmul = (c: RGB, f: number): RGB => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
const cmix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SKIN = ['#f1c8a5', '#dfae85', '#c08a60', '#8f5e3e', '#5e3d29'].map(hex3);
const HAIR = ['#2a1d17', '#5b3a22', '#caa24a', '#b4452c', '#c8ccd6', '#3a5bd9', '#9a3fe0', '#1e1e24'].map(hex3);
const HELM = ['#eef2fa', '#d3dbea', '#f3ecdc', '#e4e8f2'].map(hex3);
const SUITS: Record<CrewRole, Array<[string, string]>> = {
  pilot: [['#e28028', '#f4c07a'], ['#d9d3c4', '#59a8ff']],
  gunner: [['#b8342c', '#e8c450'], ['#4a5266', '#ff6a5a']],
  shieldop: [['#6a3fd0', '#59e6ff'], ['#2f5fb8', '#b9a0ff']],
  engineer: [['#d8b030', '#2caaa0'], ['#2a8f86', '#e8c450']],
};
export const ROLE_COLOR: Record<CrewRole, string> = { pilot: '#59e6ff', gunner: '#ff6a5a', shieldop: '#b43cff', engineer: '#e8c450' };
const ICON: Record<CrewRole, string[]> = { pilot: ['101', '010', '111'], gunner: ['010', '111', '010'], shieldop: ['111', '111', '010'], engineer: ['101', '111', '010'] };
const BGPAL = ['#2a1840', '#3c2060', '#1d2a5c', '#5a2a6a', '#274a8a', '#1c3a4a', '#4a2050'].map(hex3);

export type PortraitKind = 'closed' | 'open' | 'bare';

export function portraitKind(name: string, role: string): PortraitKind {
  const r = hash(`${name}|${role}`) % 100;
  return r < 34 ? 'closed' : r < 58 ? 'open' : 'bare';
}

/** The picture as RGBA bytes. */
export function portraitPixels(name: string, role: CrewRole, rar: number, forceKind?: PortraitKind): Uint8ClampedArray {
  const h = hash(`${name}|${role}`);
  const rng = mulberry32(h);
  const kind = forceKind ?? portraitKind(name, role);
  const g: Array<RGB | undefined> = new Array(PW * PW);
  const px = (x: number, y: number, col: RGB) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= PW || y >= PW) return;
    g[y * PW + x] = col;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, col: RGB) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, col);
  };
  const ell = (cx: number, cy: number, rx: number, ry: number, fn: (dx: number, dy: number, d: number, x: number, y: number) => RGB | null) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        const col = fn(dx, dy, d, x, y);
        if (col) px(x, y, col);
      }
    }
  };
  // the dark noisy backdrop
  const bgA = BGPAL[Math.floor(rng() * BGPAL.length)];
  const bgB = BGPAL[Math.floor(rng() * BGPAL.length)];
  for (let y = 0; y < PW; y++) {
    for (let x = 0; x < PW; x++) {
      const t = rng();
      let col = t < 0.55 ? bgA : t < 0.85 ? bgB : cmix(bgA, [255, 120, 80], 0.35);
      if (t > 0.97) col = [60, 150, 255];
      g[y * PW + x] = cmul(col, 0.7 + rng() * 0.45);
    }
  }
  // the suit and shoulders
  const suit = SUITS[role][Math.floor(rng() * 2)];
  const sb = hex3(suit[0]);
  const sa = hex3(suit[1]);
  for (let yy = 17; yy < PW; yy++) {
    const hw = Math.min(11.5, 7 + (yy - 16));
    for (let xx = Math.ceil(12 - hw); xx < 12 + hw; xx++) {
      let c = sb;
      if (xx < 9) c = cmul(sb, 1.2);
      else if (xx > 15) c = cmul(sb, 0.72);
      if (yy === 17) c = cmul(c, 1.25);
      if (xx < 12 - hw + 1 || xx >= 12 + hw - 1) c = cmul(sb, 0.5);
      if ((xx + yy) % 5 === 0 && xx > 4 && xx < 20) c = cmul(c, 0.92);
      px(xx, yy, c);
    }
  }
  rect(3, 19, 4, 22, sa);
  rect(19, 19, 20, 22, cmul(sa, 0.75));
  // the chest panel with its lights
  rect(9, 19, 14, 22, [24, 32, 50]);
  rect(9, 19, 14, 19, [120, 145, 185]);
  rect(9, 21, 14, 21, [120, 145, 185]);
  px(10, 22, [89, 230, 255]);
  px(13, 22, rng() < 0.5 ? [255, 90, 80] : [232, 196, 80]);
  // the role badge on the left shoulder
  const rc = hex3(ROLE_COLOR[role]);
  rect(5, 19, 7, 21, cmul(rc, 0.45));
  const ic = ICON[role];
  for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 3; ix++) if (ic[iy][ix] === '1') px(5 + ix, 19 + iy, [250, 250, 255]);
  if (rar >= 4) {
    px(16, 20, [255, 230, 120]);
    px(17, 21, [255, 230, 120]);
    px(16, 22, [255, 230, 120]);
  }
  // the neck ring
  ell(12, 17, 7, 2.2, (_dx, dy, d) => (d > 0.85 ? [110, 120, 140] : cmul([200, 208, 222], 1 - 0.2 * dy)));

  const skin = SKIN[Math.floor(rng() * SKIN.length)];
  const helm = HELM[Math.floor(rng() * HELM.length)];
  const visorBases: RGB[][] = [[[20, 50, 150], [60, 130, 235], [140, 205, 255]], [[60, 30, 140], [150, 70, 220], [235, 150, 255]], [[10, 70, 90], [30, 160, 170], [140, 250, 235]]];
  const vis = visorBases[Math.floor(rng() * visorBases.length)];
  const hair = HAIR[Math.floor(rng() * HAIR.length)];
  const dome = (cx: number, cy: number, rx: number, ry: number, col: RGB) => {
    ell(cx, cy, rx, ry, (dx, dy, d) => (d > 0.88 ? cmul(col, 0.5) : cmul(col, 1 - 0.18 * dx - 0.2 * dy)));
  };
  const drawFace = () => {
    ell(12, 10.5, 5, 5.8, (dx, dy, d) => cmul(skin, d > 0.9 ? 0.82 : 1 - 0.1 * dx + (dy > 0.4 ? -0.06 : 0)));
    const ey = 9;
    for (const x of [9, 10, 13, 14]) px(x, ey, [250, 250, 255]);
    const pup: RGB = rng() < 0.5 ? [40, 30, 30] : [30, 90, 170];
    px(10, ey, pup);
    px(13, ey, pup);
    rect(9, ey - 1, 10, ey - 1, cmul(skin, 0.55));
    rect(13, ey - 1, 14, ey - 1, cmul(skin, 0.55));
    px(12, 11, cmul(skin, 0.8));
    const m = rng();
    rect(11, 13, 13, 13, cmul(skin, 0.5));
    if (m < 0.3) {
      px(10, 12, cmul(skin, 0.6));
      px(14, 12, cmul(skin, 0.6));
    } else if (m < 0.5) {
      px(10, 14, cmul(skin, 0.6));
      px(14, 14, cmul(skin, 0.6));
    }
    const f = rng();
    if (f < 0.18) {
      px(14, 11, [200, 80, 80]);
      px(14, 12, [200, 80, 80]);
    } else if (f < 0.34) {
      rect(10, 13, 14, 15, cmul(hair, 0.9));
      rect(11, 13, 13, 13, cmul(skin, 0.5));
    } else if (f < 0.46) rect(10, 12, 14, 12, cmul(hair, 0.9));
    else if (f < 0.56) {
      rect(8, 8, 11, 10, [20, 20, 28]);
      px(10, 9, [60, 60, 70]);
    } else if (f < 0.66) {
      px(13, 9, [89, 230, 255]);
      px(14, 9, [60, 200, 230]);
    } else if (f < 0.74) {
      px(10, 11, cmul(skin, 0.85));
      px(13, 11, cmul(skin, 0.85));
      px(11, 11, cmul(skin, 0.9));
    }
  };

  if (kind === 'closed') {
    dome(12, 9.5, 8.5, 8.2, helm);
    ell(12, 10, 6.2, 5.6, (_dx, dy, d, x, y) => {
      if (d > 0.9) return [20, 24, 40];
      const k = Math.min(2, Math.max(0, Math.floor((dy + 1) * 1.6)));
      return cmul(vis[k], 0.8 + 0.25 * Math.sin(x * 0.7 + y * 0.5));
    });
    // the reflection: the glare, a distant planet and stars
    px(8, 6, [255, 255, 255]);
    px(9, 6, [230, 245, 255]);
    px(8, 7, [210, 235, 255]);
    px(9, 5, [200, 225, 255]);
    if (rng() < 0.6) ell(15, 12.5, 1.6, 1.6, (_dx, _dy, d) => cmul(vis[2], 0.9 - 0.3 * d));
    px(14, 7, [255, 255, 255]);
    px(7, 11, [200, 230, 255]);
    rect(3, 9, 3, 10, [89, 230, 255]);
    rect(20, 9, 20, 10, [89, 230, 255]);
    rect(10, 2, 13, 2, cmul(rc, 1.1));
  } else if (kind === 'open') {
    dome(12, 9.5, 8.5, 8.2, helm);
    ell(12, 10.5, 6, 6.4, () => [26, 32, 50]);
    drawFace();
    // the visor lifted: a glass band across the top of the helmet
    for (let vx = 6; vx < 18; vx++) {
      const vy = 3 + (Math.abs(vx - 11.5) > 4 ? 1 : 0);
      px(vx, vy, vis[1]);
      px(vx, vy + 1, cmul(vis[0], 0.9));
    }
    px(8, 3, [255, 255, 255]);
    px(9, 3, vis[2]);
    rect(3, 9, 3, 10, [89, 230, 255]);
    rect(20, 9, 20, 10, [89, 230, 255]);
    rect(10, 15, 13, 15, cmul(skin, 0.6));
  } else {
    // no helmet: ears, head, neck, hair and a bit of gear
    rect(10, 15, 13, 17, cmul(skin, 0.75));
    px(6, 10, cmul(skin, 0.85));
    px(6, 11, cmul(skin, 0.85));
    px(17, 10, cmul(skin, 0.85));
    px(17, 11, cmul(skin, 0.85));
    const style = Math.floor(rng() * 6);
    const hs = hair;
    if (style === 0) ell(12, 7, 6.2, 4.2, (dx, _dy, d) => (d > 0.9 ? cmul(hs, 0.6) : cmul(hs, 1 - 0.15 * dx)));
    if (style === 1) {
      rect(8, 4, 15, 5, hs);
      rect(7, 5, 16, 6, hs);
    }
    if (style === 2) {
      ell(12, 7, 6.4, 4.6, () => hs);
      rect(5, 7, 7, 17, hs);
      rect(16, 7, 18, 17, cmul(hs, 0.85));
    }
    if (style === 3) {
      rect(11, 0, 12, 5, [255, 80, 160]);
      rect(10, 3, 13, 5, [255, 80, 160]);
    }
    if (style === 4) {
      px(10, 5, [255, 255, 255]);
      px(11, 5, [255, 255, 255]);
    }
    if (style === 5) {
      ell(12, 6.6, 6, 3.8, () => hs);
      ell(12, 2.4, 2.4, 2.4, () => cmul(hs, 1.1));
    }
    ell(12, 10.5, 5.2, 6.2, (dx, dy, d, x, y) => {
      if (g[y * PW + x] && dy < -0.5 && style !== 4 && style !== 3) return null;
      return cmul(skin, d > 0.9 ? 0.82 : 1 - 0.1 * dx + (dy > 0.4 ? -0.06 : 0));
    });
    if (style === 0 || style === 5) rect(8, 5, 15, 6, hs);
    if (style === 1) rect(8, 5, 15, 5, hs);
    if (style === 2) {
      rect(8, 5, 15, 6, hs);
      px(8, 7, hs);
      px(15, 7, hs);
    }
    const ey = 9;
    for (const x of [9, 10, 13, 14]) px(x, ey, [250, 250, 255]);
    const pup: RGB = rng() < 0.5 ? [40, 30, 30] : [30, 90, 170];
    px(10, ey, pup);
    px(13, ey, pup);
    rect(9, 8, 10, 8, cmul(hair, 0.8));
    rect(13, 8, 14, 8, cmul(hair, 0.8));
    px(12, 11, cmul(skin, 0.8));
    rect(11, 13, 13, 13, cmul(skin, 0.5));
    const f2 = rng();
    if (f2 < 0.2) {
      px(14, 10, [200, 80, 80]);
      px(14, 11, [200, 80, 80]);
      px(15, 12, [200, 80, 80]);
    } else if (f2 < 0.4) {
      rect(9, 13, 14, 15, cmul(hair, 0.9));
      rect(11, 13, 13, 13, cmul(skin, 0.5));
      px(8, 12, cmul(hair, 0.9));
      px(15, 12, cmul(hair, 0.9));
    } else if (f2 < 0.55) rect(10, 12, 13, 12, cmul(hair, 0.9));
    else if (f2 < 0.67) {
      rect(8, 8, 11, 10, [20, 20, 28]);
      px(10, 9, [60, 60, 70]);
      rect(7, 7, 8, 7, [20, 20, 28]);
    } else if (f2 < 0.8) {
      px(13, 9, [89, 230, 255]);
      px(14, 9, [60, 200, 230]);
      px(15, 9, [60, 200, 230]);
    }
    // gear by profession: a headset, goggles on the brow, a cap, a band
    const gear = rng();
    if (role === 'pilot' && gear < 0.6) {
      rect(8, 6, 15, 6, [60, 60, 80]);
      px(7, 10, [89, 230, 255]);
      px(7, 11, [89, 230, 255]);
      rect(8, 3, 15, 4, [60, 70, 100]);
    } else if (role === 'engineer' && gear < 0.7) {
      ell(9.5, 5.5, 1.6, 1.6, () => [232, 176, 48]);
      ell(14.5, 5.5, 1.6, 1.6, () => [232, 176, 48]);
      rect(11, 5, 13, 5, [90, 80, 60]);
      px(9, 5, [255, 240, 180]);
      px(14, 5, [255, 240, 180]);
    } else if (role === 'gunner' && gear < 0.6) {
      rect(7, 6, 16, 6, [180, 50, 44]);
      px(17, 7, [180, 50, 44]);
      px(17, 8, [180, 50, 44]);
    } else if (role === 'shieldop' && gear < 0.7) {
      rect(8, 8, 15, 8, [150, 110, 255]);
      px(7, 10, [89, 230, 255]);
      px(7, 11, [89, 230, 255]);
    }
  }
  if (rar >= 3) {
    rect(3, 17, 3, 18, [89, 230, 255]);
    rect(20, 17, 20, 18, [89, 230, 255]);
  }
  if (rar >= 5) rect(4, 17, 19, 17, [255, 220, 110]);
  const out = new Uint8ClampedArray(PW * PW * 4);
  for (let i = 0; i < g.length; i++) {
    const col = g[i] ?? [10, 14, 28];
    out[i * 4] = col[0];
    out[i * 4 + 1] = col[1];
    out[i * 4 + 2] = col[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

const urls = new Map<string, string>();

/** The portrait as a picture the page can show (kept, so each person is painted once). */
export function portraitURL(name: string, role: CrewRole, rar: number): string {
  const key = `${name}|${role}|${rar}`;
  let u = urls.get(key);
  if (!u) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = PW;
    cv.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(portraitPixels(name, role, rar)), PW, PW), 0, 0);
    u = cv.toDataURL();
    urls.set(key, u);
  }
  return u;
}
