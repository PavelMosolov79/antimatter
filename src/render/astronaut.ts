import type { CrewRole } from '../sim/crew';

/**
 * The astronaut as seen from above, 41×20 pixels, facing down (the +y side of the ship). The drawing is
 * the one the dock's crew document shows: the suit is recoloured by profession and each profession has
 * its own gear in the left hand and something on the head, so they can be told apart by the outline too.
 * Pixels are built here without a canvas so the drawing can be tested; `astronautCanvas` makes the canvas.
 */
export const ASTRO_W = 41;
export const ASTRO_H = 20;

// the template, one letter per colour (the palette below); a dot is empty
const ROWS = [
  '.........AAAAAAAAAAAAAAAAAAAAAAA.........',
  '..BAAAAAACCCDAEAFFFFFFFFFAEGACCCHAAAAAA..',
  '.IJCCCCCCEEKLEAFFFFFFFFFFFAMEKEECCCCCCCI.',
  '.ADCCCCCCEEALEAFFFFFFFFFFFAMEAEECCCCCCCA.',
  'ACCCEEEEEEAENAFFFFFOOOFFFFFPAEAEEEEEECCCA',
  'ACQEEEELAEAENAFFOOOOOOOOOFFPAEAERAEEEEECA',
  'AANEEEANEEAENAFOOOOOOOOOOOFPAEAEEEAEEEEAA',
  'ACSHHHANEEAENAFOOOOOOOOOOOFPAEAEEEAHHHHCA',
  'ACSTTTTNEEAENAFOOOOOOOOOOOFPAEAEEETTTTTCA',
  'AEEEECCSAEAENAFFFFFOOOFFFFFPAEAERACCEEEEA',
  'AAAAAEELAEAENAFFUUUFFFVUUFFPAEAERAAAAAAAA',
  'WWWWAAAAAEAENAFUUUUUUUUUUUFPAEAERAAXXXXXA',
  'WIIIYIWWWEETTAXUUUUUUUUUUUXZATEERAXXUUUUA',
  'WIIIaIWWWEEAAAXUUUUUUUUUUUXZAAEERAXXUUUUA',
  '.WWWWIIIWCEALEAUUUUUUUUUUUAMEAECHAXUUUUA.',
  '..bAXWWWWACALEAXUUUUUUUUUXAMEACAcXUUUdA..',
  '....AXUUUXAASCAAXXUUUUUUXAASCAAXUUUXAe...',
  '.....ffgXXAASCA.fhXXXXXXf.ASCAAXXXff.....',
  '.....TTgXXTTSCT.ThXXXXXXT.TiCTTXXXTT.....',
  '.......eAA..jA...kAAAAAA...kA..AAA.......',
];
const PAL: Record<string, string> = { A: '#2e0501', B: '#aca6a6', C: '#e14417', D: '#87270d', E: '#ff6000', F: '#514d46', G: '#812e01', H: '#641c09', I: '#353535', J: '#963925', K: '#2f0f0e', L: '#b54201', M: '#c84b01', N: '#9a3701', O: '#625a50', P: '#382522', Q: '#e35700', R: '#6c2501', S: '#a33010', T: '#0f0001', U: '#ffb568', V: '#d69b59', W: '#1b1b1b', X: '#ee9954', Y: '#00eb00', Z: '#754b29', a: '#00d300', b: '#8b8a8a', c: '#ca8046', d: '#563b1d', e: '#b9b6b6', f: '#432112', g: '#a26437', h: '#b77540', i: '#b42700', j: '#9e9e9e', k: '#7d7373' };
// which letters are the suit (recoloured), the rest keep their colour
const SUIT = 'CEQLMNSHRDGJi';
const HUE: Record<CrewRole, number> = { pilot: 192, gunner: 6, shieldop: 282, engineer: 36 };
const SAT: Record<CrewRole, number> = { pilot: 0.85, gunner: 0.78, shieldop: 0.72, engineer: 0.95 };

type Rgb = [number, number, number];
const parse = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function rgb2hsl(c: Rgb): Rgb {
  const r = c[0] / 255;
  const g = c[1] / 255;
  const b = c[2] / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hsl2rgb(h: number, s: number, l: number): Rgb {
  const hh = (((h % 360) + 360) % 360) / 360;
  const f = (p: number, q: number, t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [Math.round(f(p, q, hh + 1 / 3) * 255), Math.round(f(p, q, hh) * 255), Math.round(f(p, q, hh - 1 / 3) * 255)];
}

/** The suit colour of one pixel of the template in the colour of a profession: brightness from the template, hue from the role. */
function suitColor(hex: string, role: CrewRole): Rgb {
  const hsl = rgb2hsl(parse(hex));
  return hsl2rgb(HUE[role], Math.min(1, SAT[role] * (0.55 + hsl[1] * 0.45)), role === 'pilot' ? Math.min(0.78, hsl[2] * 1.12 + 0.03) : hsl[2]);
}

class Pixels {
  readonly data = new Uint8ClampedArray(ASTRO_W * ASTRO_H * 4);
  set(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= ASTRO_W || y >= ASTRO_H) return;
    const o = (y * ASTRO_W + x) * 4;
    this.data[o] = c[0];
    this.data[o + 1] = c[1];
    this.data[o + 2] = c[2];
    this.data[o + 3] = 255;
  }
  clear(x0: number, y0: number, w: number, h: number): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < ASTRO_W && y < ASTRO_H) this.data[(y * ASTRO_W + x) * 4 + 3] = 0;
  }
  rect(x0: number, y0: number, w: number, h: number, hex: string): void {
    const c = parse(hex);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c);
  }
}

/** What the astronaut holds in the left hand (the hand itself stays under it). */
function gear(p: Pixels, role: CrewRole): void {
  p.clear(0, 10, 9, 5);
  const O = '#0f0001';
  p.rect(0, 10, 9, 5, O);
  if (role === 'gunner') {
    // a rifle: black barrel, red light
    p.rect(1, 11, 7, 3, '#1b1b1b');
    p.rect(1, 12, 5, 1, '#353535');
    p.rect(2, 12, 1, 1, '#ff3030');
    p.rect(6, 11, 2, 3, '#353535');
    p.rect(0, 11, 1, 3, '#7d7373');
  } else if (role === 'pilot') {
    // a tablet with a blue screen
    p.rect(1, 11, 7, 3, '#1b1b1b');
    p.rect(2, 11, 5, 2, '#59e6ff');
    p.rect(3, 11, 3, 1, '#c8f7ff');
    p.rect(2, 13, 1, 1, '#00eb00');
  } else if (role === 'shieldop') {
    // an emitter with a crystal
    p.rect(1, 11, 5, 3, '#4a4f60');
    p.rect(2, 10, 3, 4, '#b43cff');
    p.rect(3, 10, 1, 2, '#f1d6ff');
    p.rect(6, 11, 2, 3, '#ffd36b');
  } else {
    // a wrench
    p.rect(1, 11, 3, 3, '#aab4c8');
    p.rect(2, 12, 1, 1, O);
    p.rect(4, 12, 4, 1, '#cfd5e2');
    p.rect(4, 13, 4, 1, '#8a94a8');
    p.rect(1, 11, 3, 1, '#e8edf8');
  }
}

/** Something on the head: the pilot's headset, the gunner's band, the shield operator's visor, the engineer's hard hat. */
function head(p: Pixels, role: CrewRole): void {
  if (role === 'pilot') {
    p.rect(13, 5, 1, 4, '#0f0001');
    p.rect(14, 6, 1, 2, '#59e6ff');
    p.rect(27, 5, 1, 4, '#0f0001');
    p.rect(26, 6, 1, 2, '#59e6ff');
    p.rect(15, 3, 11, 1, '#59e6ff');
  } else if (role === 'engineer') {
    p.rect(15, 2, 11, 3, '#f6c445');
    p.rect(15, 2, 11, 1, '#fff3b0');
    p.rect(15, 4, 11, 1, '#b8860b');
    p.rect(19, 1, 3, 1, '#0f0001');
    p.rect(20, 3, 1, 1, '#fff3b0');
  } else if (role === 'shieldop') {
    p.rect(16, 9, 9, 1, '#b43cff');
    p.rect(17, 10, 7, 1, '#7a2fc0');
  } else {
    p.rect(15, 3, 11, 1, '#e23b3b');
    p.rect(17, 9, 7, 1, '#0f0001');
  }
}

/** RGBA pixels (41×20) of the astronaut of a profession, facing down. */
export function astronautPixels(role: CrewRole): Uint8ClampedArray {
  const p = new Pixels();
  for (let y = 0; y < ASTRO_H; y++) {
    for (let x = 0; x < ASTRO_W; x++) {
      const ch = ROWS[y][x];
      if (ch === '.') continue;
      const hex = PAL[ch];
      p.set(x, y, SUIT.includes(ch) ? suitColor(hex, role) : parse(hex));
    }
  }
  // the left hand is the right one mirrored (the template had a gun over it)
  p.clear(0, 15, 10, 5);
  for (let y = 13; y < ASTRO_H; y++) {
    for (let x = 31; x < ASTRO_W; x++) {
      const ch = ROWS[y][x];
      if (ch === '.' || SUIT.includes(ch)) continue;
      p.set(ASTRO_W - 1 - x, y, parse(PAL[ch]));
    }
  }
  gear(p, role);
  head(p, role);
  return p.data;
}

/** The same as a canvas, for drawing. */
export function astronautCanvas(role: CrewRole): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ASTRO_W;
  c.height = ASTRO_H;
  const g = c.getContext('2d')!;
  g.putImageData(new ImageData(astronautPixels(role) as unknown as Uint8ClampedArray<ArrayBuffer>, ASTRO_W, ASTRO_H), 0, 0);
  return c;
}
