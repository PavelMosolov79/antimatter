import type { AudioEv } from './shots';

/**
 * The film's sound, made from nothing: a 120 beats a minute pulse in E minor, and under it the sounds of what really
 * happens in the film (every blast, hit and shot the world reported, with the time it was reported at), drawn
 * into a buffer with an offline audio context.
 */
export const SAMPLE_RATE = 48000;
const BEAT = 0.5;
const E = (n: number): number => 41.2 * Math.pow(2, n / 12); // E1 and up, in semitones

export async function renderAudio(events: AudioEv[], seconds: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const master = ctx.createGain();
  master.gain.value = 0.6;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  master.connect(comp);
  comp.connect(ctx.destination);
  // the hall: a tail of decaying noise
  const verb = ctx.createConvolver();
  const len = Math.floor(SAMPLE_RATE * 1.8);
  const ir = ctx.createBuffer(2, len, SAMPLE_RATE);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  verb.buffer = ir;
  const verbGain = ctx.createGain();
  verbGain.gain.value = 0.32;
  verb.connect(verbGain);
  verbGain.connect(master);

  const noise = ctx.createBuffer(1, SAMPLE_RATE * 3, SAMPLE_RATE);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const out = (node: AudioNode, wet = 0): void => {
    node.connect(master);
    if (wet > 0) {
      const g = ctx.createGain();
      g.gain.value = wet;
      node.connect(g);
      g.connect(verb);
    }
  };

  const env = (g: GainNode, t: number, peak: number, attack: number, decay: number): void => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };

  const tone = (t: number, f0: number, f1: number, dur: number, type: OscillatorType, peak: number, wet = 0, cutoff = 0): void => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    env(g, t, peak, 0.004, dur);
    let node: AudioNode = o;
    if (cutoff > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
    out(g, wet);
  };

  const hiss = (t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number, attack = 0.005, wet = 0, q = 0.7): void => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    env(g, t, peak, attack, dur);
    s.connect(f);
    f.connect(g);
    s.start(t, Math.random() * 2);
    s.stop(t + attack + dur + 0.05);
    out(g, wet);
  };

  const kick = (t: number, v = 1): void => {
    tone(t, 165, 44, 0.28, 'sine', 0.95 * v);
    hiss(t, 0.03, 'highpass', 3000, 3000, 0.25 * v);
  };
  const clap = (t: number, v = 1): void => {
    for (let i = 0; i < 3; i++) hiss(t + i * 0.012, 0.09, 'bandpass', 1700, 1500, 0.35 * v, 0.002, 0.25, 0.9);
  };
  const hat = (t: number, v = 1): void => hiss(t, 0.045, 'highpass', 8500, 8500, 0.16 * v);
  const bass = (t: number, f: number, dur: number): void => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.setValueAtTime(900, t);
    f2.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.01);
    g.gain.setValueAtTime(0.4, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f2);
    f2.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
    out(g);
  };
  const pluck = (t: number, f: number, v = 1): void => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = f * 1.004;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.16);
    const g = ctx.createGain();
    env(g, t, 0.09 * v, 0.003, 0.2);
    o.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    o.start(t);
    o2.start(t);
    o.stop(t + 0.3);
    o2.stop(t + 0.3);
    out(g, 0.5);
  };
  const boom = (t: number, v = 1): void => {
    tone(t, 74, 24, 1.7, 'sine', 1.1 * v, 0.2);
    tone(t, 150, 40, 0.5, 'triangle', 0.6 * v);
    hiss(t, 1.6, 'lowpass', 5200, 90, 1.0 * v, 0.003, 0.35);
    hiss(t, 0.18, 'highpass', 1200, 1200, 0.6 * v, 0.001);
  };
  const thump = (t: number, v = 1): void => {
    tone(t, 120, 42, 0.2, 'sine', 0.5 * v);
    hiss(t, 0.22, 'lowpass', 2200, 140, 0.55 * v, 0.002, 0.12);
  };
  const zap = (t: number): void => tone(t, 2100, 260, 0.09, 'sawtooth', 0.05, 0.1, 5000);
  const whoosh = (t: number, dur: number, up: boolean, v = 1): void => hiss(t, dur, 'bandpass', up ? 300 : 5000, up ? 6000 : 300, 0.5 * v, dur * 0.45, 0.3, 0.6);
  const ping = (t: number, f: number, v = 1): void => {
    tone(t, f, f * 0.996, 0.35, 'sine', 0.22 * v, 0.5);
    tone(t, f * 2.005, f * 2.005, 0.2, 'sine', 0.06 * v, 0.5);
  };
  const siren = (t0: number, t1: number): void => {
    for (let t = t0; t < t1; t += 0.25) tone(t, Math.floor((t - t0) / 0.25) % 2 === 0 ? 640 : 860, 640, 0.22, 'square', 0.05, 0.1, 1800);
  };
  const pad = (t: number, dur: number, notes: number[], v: number): void => {
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = E(n) * 4;
        o.detune.value = det;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(500, t);
        lp.frequency.exponentialRampToValueAtTime(3500, t + dur * 0.6);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.06 * v, t + dur * 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(lp);
        lp.connect(g);
        o.start(t);
        o.stop(t + dur + 0.1);
        out(g, 0.6);
      }
    }
  };

  // ---------------------------------------------------------------- the pulse (120 bpm: boundaries of the shots fall on beats)
  const beats = Math.floor(seconds / BEAT);
  const bassLine = [0, 0, 3, 0, 5, 3, 0, 7]; // semitones above E1, per eighth
  const arpNotes = [24, 27, 31, 36, 31, 27, 24, 31]; // E3 G3 B3 E4 ...
  const sections: Array<{ t0: number; t1: number; kick: boolean; hat: boolean; bass: boolean; arp: boolean; clap: boolean }> = [
    { t0: 1.0, t1: 3.0, kick: true, hat: false, bass: true, arp: false, clap: false },
    { t0: 3.0, t1: 6.0, kick: true, hat: true, bass: true, arp: true, clap: true },
    { t0: 6.0, t1: 7.5, kick: true, hat: false, bass: true, arp: false, clap: false },
    { t0: 9.0, t1: 13.0, kick: true, hat: true, bass: true, arp: true, clap: true },
  ];
  for (const sec of sections) {
    for (let b = Math.ceil(sec.t0 / BEAT); b * BEAT < sec.t1 && b < beats; b++) {
      const t = b * BEAT;
      if (sec.kick) kick(t, b % 4 === 0 ? 1 : 0.9);
      if (sec.clap && b % 2 === 1) clap(t);
      for (let h = 0; h < 2; h++) {
        const e = b * 2 + h;
        const te = e * BEAT * 0.5;
        if (sec.hat && h === 1) hat(te, 1);
        if (sec.bass) bass(te, E(bassLine[e % 8]), BEAT * 0.45);
      }
      if (sec.arp) for (let q = 0; q < 4; q++) pluck(t + q * BEAT * 0.25, E(arpNotes[(b * 4 + q) % 8]), q === 0 ? 1 : 0.8);
    }
  }
  // the opening riser, the hush before the wreck goes up, the pad over the end
  whoosh(0.0, 1.0, true, 1.1);
  tone(0.0, 80, 640, 1.0, 'sawtooth', 0.05, 0.2, 1400);
  siren(8.0, 8.5);
  [0, 0.2, 0.36, 0.48, 0.58, 0.66, 0.73, 0.79].forEach((d, i) => ping(7.45 + d, 1500 + i * 60, 0.8));
  whoosh(8.9, 0.15, false, 0.6);
  // the end: a riser into the annihilation, then the chord
  whoosh(12.95, 0.3, true, 1.2);
  tone(13.0, 120, 900, 0.25, 'sawtooth', 0.06, 0.2, 2500);
  pad(13.25, 1.9, [0, 7, 12, 15], 1.2);
  tone(13.25, 110, 30, 1.7, 'sine', 0.9, 0.25);
  hiss(13.25, 1.4, 'lowpass', 6000, 160, 0.7, 0.002, 0.4);
  for (let i = 0; i < 6; i++) pluck(13.55 + i * BEAT * 0.5, E(arpNotes[i % 8] + 12), 0.9);

  // ---------------------------------------------------------------- what happens in the film
  let lastThump = -1;
  let lastZap = -1;
  let lastBoom = -1;
  for (const e of events) {
    if (e.kind === 'boom') {
      if (e.t - lastBoom < 0.2) continue;
      lastBoom = e.t;
      boom(e.t, 0.6 + 0.4 * e.v);
    } else if (e.kind === 'thump') {
      if (e.t - lastThump < 0.06) continue;
      lastThump = e.t;
      thump(e.t, 0.35 + 0.65 * e.v);
    } else if (e.kind === 'zap') {
      if (e.t - lastZap < 0.11) continue;
      lastZap = e.t;
      zap(e.t);
    } else if (e.kind === 'swish') whoosh(e.t - 0.05, 0.22, e.v > 0, 0.6);
    else if (e.kind === 'weld') {
      tone(e.t, 500 + e.v * 1500, 500 + e.v * 1500, 0.06, 'square', 0.04, 0.2, 3000);
      hiss(e.t, 0.05, 'highpass', 5000, 5000, 0.08);
    } else if (e.kind === 'tap') ping(e.t, 1100, 0.7);
    else if (e.kind === 'fly') whoosh(e.t, 0.5, true, 0.5);
    else if (e.kind === 'land') {
      ping(e.t, 880, 1);
      ping(e.t + 0.07, 1320, 0.8);
      thump(e.t, 0.4);
    } else if (e.kind === 'pop') {
      ping(e.t, 1568, 0.9);
      ping(e.t + 0.08, 2093, 0.7);
    } else if (e.kind === 'hit') {
      boom(e.t, e.v);
      clap(e.t, 1);
    }
  }
  // the end: fade the last 0.3 s so nothing clicks
  const fadeStart = seconds - 0.3;
  master.gain.setValueAtTime(0.6, fadeStart);
  master.gain.linearRampToValueAtTime(0.0001, seconds);
  return ctx.startRendering();
}
