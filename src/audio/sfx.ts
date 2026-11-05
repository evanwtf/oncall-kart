import type { ItemKind } from '../logic/items';
import type { Cue } from './cues';

/**
 * What a sound needs: the context, the bus to play into, a shared noise
 * buffer, and track(), which disconnects a sound's nodes when its source ends.
 */
export interface Synth {
  ctx: BaseAudioContext;
  noise: AudioBuffer;
  track(source: AudioScheduledSourceNode, nodes: readonly AudioNode[]): void;
}

/** Peak gain of the loudest sound effect, before the effects bus. */
export const SFX_PEAK = 0.32;
/** Gain that counts as silent at the end of an envelope. */
const FLOOR = 0.0001;

export interface ToneSpec {
  type: OscillatorType;
  /** Start frequency, Hz. */
  f0: number;
  /** End frequency, Hz: an exponential glide over dur. */
  f1?: number;
  t: number;
  dur: number;
  peak: number;
  /** Rise time, s. A long attack makes a reverse sound. */
  attack?: number;
}

/** One oscillator with a gain envelope. Its nodes disconnect when it ends. */
export function tone(s: Synth, out: AudioNode, spec: ToneSpec): void {
  const { ctx } = s;
  const { t, dur, peak } = spec;
  const attack = Math.min(spec.attack ?? 0.004, dur * 0.9);
  const osc = ctx.createOscillator();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.f0, t);
  if (spec.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(spec.f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  s.track(osc, [osc, g]);
}

export interface NoiseSpec {
  t: number;
  dur: number;
  peak: number;
  filter: BiquadFilterType;
  /** Filter frequency at the start, Hz. */
  f0: number;
  /** Filter frequency at the end, Hz. */
  f1?: number;
  q?: number;
  attack?: number;
}

/** Filtered white noise with a gain envelope. Its nodes disconnect when it ends. */
export function noise(s: Synth, out: AudioNode, spec: NoiseSpec): void {
  const { ctx } = s;
  const { t, dur, peak } = spec;
  const attack = Math.min(spec.attack ?? 0.003, dur * 0.9);
  const src = ctx.createBufferSource();
  src.buffer = s.noise;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = spec.filter;
  filt.Q.value = spec.q ?? 1;
  filt.frequency.setValueAtTime(spec.f0, t);
  if (spec.f1 !== undefined) filt.frequency.exponentialRampToValueAtTime(spec.f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
  src.connect(filt);
  filt.connect(g);
  g.connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
  s.track(src, [src, filt, g]);
}

/** Hz of a MIDI note number. */
export const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const P = SFX_PEAK;

/** Play one cue at time t into out. */
export function playCue(s: Synth, out: AudioNode, cue: Cue, t: number): void {
  switch (cue.kind) {
    case 'countdown':
      tone(s, out, { type: 'square', f0: hz(69), t, dur: 0.14, peak: P * 0.6 });
      break;
    case 'go':
      tone(s, out, { type: 'square', f0: hz(81), t, dur: 0.4, peak: P * 0.6 });
      tone(s, out, { type: 'triangle', f0: hz(69), t, dur: 0.4, peak: P * 0.5 });
      break;
    case 'gate-ok':
      tone(s, out, { type: 'triangle', f0: hz(84), t, dur: 0.09, peak: P * 0.8 });
      tone(s, out, { type: 'triangle', f0: hz(91), t: t + 0.07, dur: 0.18, peak: P * 0.8 });
      break;
    case 'gate-wrong':
      tone(s, out, { type: 'sawtooth', f0: 98, f1: 82, t, dur: 0.32, peak: P * 0.45 });
      tone(s, out, { type: 'square', f0: 104, f1: 87, t, dur: 0.32, peak: P * 0.35 });
      break;
    case 'ticket-closed':
      [74, 78, 81, 86].forEach((m, i) =>
        tone(s, out, { type: 'square', f0: hz(m), t: t + i * 0.055, dur: 0.12, peak: P * 0.45 }),
      );
      break;
    case 'sla-breach':
      // Two short high-low pairs, then a long low beep.
      [0, 0.16].forEach((dt) => {
        tone(s, out, { type: 'square', f0: 1480, t: t + dt, dur: 0.06, peak: P * 0.4 });
        tone(s, out, { type: 'square', f0: 1110, t: t + dt + 0.07, dur: 0.06, peak: P * 0.4 });
      });
      tone(s, out, { type: 'square', f0: 1110, t: t + 0.34, dur: 0.22, peak: P * 0.4 });
      break;
    case 'pit':
      for (let i = 0; i < 6; i++) {
        noise(s, out, {
          t: t + i * 0.05,
          dur: 0.025,
          peak: P * 0.45,
          filter: 'highpass',
          f0: 2500 + i * 300,
        });
      }
      break;
    case 'lap':
      tone(s, out, { type: 'triangle', f0: hz(88), t, dur: 0.5, peak: P * 0.6 });
      tone(s, out, { type: 'triangle', f0: hz(93), t: t + 0.09, dur: 0.6, peak: P * 0.5 });
      break;
    case 'final-lap':
      // A short call: low, low, up a fourth, up a sixth, held.
      [
        [69, 0, 0.1],
        [69, 0.12, 0.1],
        [74, 0.24, 0.1],
        [78, 0.36, 0.45],
      ].forEach(([m, dt, d]) =>
        tone(s, out, {
          type: 'square',
          f0: hz(m as number),
          t: t + (dt as number),
          dur: d as number,
          peak: P * 0.45,
        }),
      );
      break;
    case 'finish': {
      // More notes for a better place. A place in the back half ends on a minor third.
      const steps = Math.max(2, Math.min(5, 6 - cue.place));
      const major = cue.place <= 4;
      const scale = major ? [62, 66, 69, 74, 78] : [62, 65, 69, 74, 77];
      for (let i = 0; i < steps; i++) {
        const last = i === steps - 1;
        tone(s, out, {
          type: 'square',
          f0: hz(scale[i] ?? 62),
          t: t + i * 0.11,
          dur: last ? 0.8 : 0.12,
          peak: P * 0.4,
        });
      }
      tone(s, out, {
        type: 'triangle',
        f0: hz(50),
        t: t + (steps - 1) * 0.11,
        dur: 0.8,
        peak: P * 0.6,
      });
      break;
    }
    case 'drift-stage':
      tone(s, out, {
        type: 'square',
        f0: [0, 900, 1250, 1700][cue.stage] ?? 900,
        t,
        dur: 0.05,
        peak: P * 0.5,
      });
      break;
    case 'boost':
      noise(s, out, {
        t,
        dur: 0.55,
        peak: P * 2,
        filter: 'bandpass',
        f0: 600,
        f1: 4000,
        q: 1.5,
        attack: 0.04,
      });
      break;
    case 'item-pick':
      tone(s, out, { type: 'square', f0: 1200, f1: 1900, t, dur: 0.08, peak: P * 0.6 });
      break;
    case 'item-use':
      playItem(s, out, cue.item, t);
      break;
    case 'hit': {
      const g = Math.max(0, Math.min(1, cue.gain));
      if (cue.outcome === 'blocked') {
        tone(s, out, { type: 'triangle', f0: 1568, t, dur: 0.3, peak: P * 0.6 * g });
        tone(s, out, { type: 'triangle', f0: 2093, t, dur: 0.25, peak: P * 0.4 * g });
      } else if (cue.outcome === 'rolled-back') {
        tone(s, out, {
          type: 'sine',
          f0: 300,
          f1: 1400,
          t,
          dur: 0.3,
          peak: P * 0.7 * g,
          attack: 0.25,
        });
      } else {
        tone(s, out, { type: 'sine', f0: 130, f1: 45, t, dur: 0.3, peak: P * g });
        noise(s, out, { t, dur: 0.1, peak: P * 0.7 * g, filter: 'lowpass', f0: 500 });
      }
      break;
    }
  }
}

function playItem(s: Synth, out: AudioNode, item: ItemKind, t: number): void {
  switch (item) {
    case 'coffee':
      noise(s, out, {
        t,
        dur: 0.4,
        peak: P * 2,
        filter: 'bandpass',
        f0: 400,
        f1: 3000,
        q: 2,
        attack: 0.05,
      });
      break;
    case 'rollback':
      // A reverse sweep: down in pitch, rising in level.
      tone(s, out, {
        type: 'sawtooth',
        f0: 1600,
        f1: 250,
        t,
        dur: 0.4,
        peak: P * 0.3,
        attack: 0.35,
      });
      break;
    case 'firewall':
      [88, 92, 95, 100].forEach((m, i) =>
        tone(s, out, { type: 'sine', f0: hz(m), t: t + i * 0.03, dur: 0.5, peak: P * 0.3 }),
      );
      break;
    case 'page':
      tone(s, out, { type: 'square', f0: 1900, f1: 2900, t, dur: 0.06, peak: P * 0.4 });
      tone(s, out, { type: 'square', f0: 1900, f1: 2900, t: t + 0.08, dur: 0.06, peak: P * 0.4 });
      break;
    case 'spill':
      noise(s, out, { t, dur: 0.22, peak: P * 0.8, filter: 'lowpass', f0: 1200, f1: 200 });
      tone(s, out, { type: 'sine', f0: 220, f1: 70, t, dur: 0.18, peak: P * 0.6 });
      break;
  }
}
