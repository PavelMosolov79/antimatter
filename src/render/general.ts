import { mulberry32 } from '../sim/rng';

/**
 * General Stone, of the fleet's staff, in the manner of the crew's portraits (portrait.ts): a 24×24 bust on the
 * same dark noisy backdrop. A dark blue coat with gold on the shoulders and ribbons on the chest, a peaked cap
 * with the fleet's badge, grey at the temples, a scar over the right eye. Two things move: the eyes blink and
 * the mouth opens while the general speaks.
 */

type RGB = [number, number, number];
export const GENERAL_SIZE = 24;
const W = GENERAL_SIZE;

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mul = (c: RGB, f: number): RGB => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];

const BG_A = hex('#1d2a5c');
const BG_B = hex('#2a1840');
const COAT = hex('#1b2a4a');
const COAT_HI = hex('#2a4070');
const GOLD = hex('#ffd24a');
const SKIN = hex('#c99a7a');
const GREY = hex('#9aa3b2');
const CAP = hex('#16223e');

/** The picture as RGBA bytes; `blink` closes the eyes, `mouth` 0 closed, 1 half open, 2 open. */
export function generalPixels(blink: boolean, mouth: 0 | 1 | 2): Uint8ClampedArray<ArrayBuffer> {
  const g: RGB[] = new Array(W * W);
  const rng = mulberry32(7331);
  for (let i = 0; i < W * W; i++) {
    const t = rng();
    let c = t < 0.6 ? BG_A : t < 0.88 ? BG_B : mul(BG_A, 1.35);
    if (t > 0.975) c = [60, 150, 255];
    g[i] = mul(c, 0.68 + rng() * 0.4);
  }
  const px = (x: number, y: number, c: RGB): void => {
    if (x >= 0 && y >= 0 && x < W && y < W) g[y * W + x] = c;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: RGB): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c);
  };
  // the coat, lit from the left
  for (let y = 17; y < W; y++) {
    const hw = Math.min(11.5, 7 + (y - 16));
    for (let x = Math.ceil(12 - hw); x < 12 + hw; x++) {
      let c = x < 9 ? mul(COAT, 1.25) : x > 15 ? mul(COAT, 0.75) : COAT;
      if (y === 17) c = mul(c, 1.3);
      if (x < 12 - hw + 1 || x >= 12 + hw - 1) c = mul(COAT, 0.5);
      px(x, y, c);
    }
  }
  // the collar and the front of the coat
  rect(10, 17, 13, 18, COAT_HI);
  rect(11, 19, 12, 23, mul(COAT, 0.6));
  px(11, 20, GOLD);
  px(11, 22, GOLD);
  // gold on the shoulders, ribbons on the chest
  rect(2, 19, 6, 19, GOLD);
  rect(3, 20, 5, 20, mul(GOLD, 0.7));
  rect(17, 19, 21, 19, mul(GOLD, 0.85));
  rect(18, 20, 20, 20, mul(GOLD, 0.6));
  rect(14, 20, 15, 20, hex('#c94040'));
  rect(16, 20, 16, 20, hex('#59e6ff'));
  rect(14, 21, 15, 21, hex('#63e07a'));
  px(16, 21, GOLD);
  // the neck and the head
  rect(10, 15, 13, 16, mul(SKIN, 0.82));
  for (let y = 6; y <= 15; y++) {
    for (let x = 7; x <= 16; x++) {
      const dx = (x + 0.5 - 12) / 5;
      const dy = (y + 0.5 - 10.8) / 5.6;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) continue;
      px(x, y, mul(SKIN, d > 0.9 ? 0.8 : 1 - 0.1 * dx + (dy > 0.45 ? -0.08 : 0)));
    }
  }
  // grey at the temples and the ears
  rect(7, 8, 7, 11, GREY);
  rect(16, 8, 16, 11, mul(GREY, 0.85));
  px(6, 10, mul(SKIN, 0.85));
  px(17, 10, mul(SKIN, 0.75));
  // the cap: crown, gold band, peak, badge
  rect(6, 3, 17, 6, CAP);
  rect(7, 2, 16, 2, mul(CAP, 1.25));
  rect(6, 6, 17, 6, GOLD);
  rect(5, 7, 18, 7, mul(CAP, 0.55));
  rect(10, 3, 13, 5, GOLD);
  rect(11, 4, 12, 4, hex('#59e6ff'));
  // the brows, heavy
  rect(9, 9, 10, 9, hex('#5a4a40'));
  rect(13, 9, 14, 9, hex('#5a4a40'));
  // the eyes
  if (blink) {
    rect(9, 10, 10, 10, mul(SKIN, 0.6));
    rect(13, 10, 14, 10, mul(SKIN, 0.6));
  } else {
    for (const x of [9, 10, 13, 14]) px(x, 10, [240, 244, 250]);
    px(10, 10, [36, 48, 70]);
    px(13, 10, [36, 48, 70]);
  }
  // the scar over the right eye, the nose, the lines of the face
  px(14, 8, hex('#a87660'));
  px(15, 9, hex('#a87660'));
  px(15, 11, hex('#a87660'));
  rect(11, 11, 12, 12, mul(SKIN, 0.85));
  px(9, 13, mul(SKIN, 0.75));
  px(14, 13, mul(SKIN, 0.75));
  // the mouth
  if (mouth === 0) rect(10, 14, 13, 14, mul(SKIN, 0.5));
  else {
    rect(10, 14, 13, 14, [70, 30, 30]);
    if (mouth === 2) rect(10, 15, 13, 15, [70, 30, 30]);
    px(11, 14, [230, 225, 220]);
    px(12, 14, [230, 225, 220]);
  }
  const out = new Uint8ClampedArray(new ArrayBuffer(W * W * 4));
  for (let i = 0; i < W * W; i++) {
    out[i * 4] = Math.round(g[i][0]);
    out[i * 4 + 1] = Math.round(g[i][1]);
    out[i * 4 + 2] = Math.round(g[i][2]);
    out[i * 4 + 3] = 255;
  }
  return out;
}
