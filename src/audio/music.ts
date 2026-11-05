import { hz, noise, tone, type Synth } from './sfx';

/*
 * "Queue Runner": an original 16-bar loop in D minor, written for this game.
 * Form A A' B A'', one bar per line. Chords: Dm C Bb C | Dm C Bb A |
 * F C G A | Dm C Bb-C Dm. The grid is the eighth note: 8 steps a bar.
 *
 * A token is NOTE:STEPS, for example "C#5:2". "-:1" is a rest.
 */
export const LEAD = `
A4:2 D5:1 F5:1 E5:2 D5:1 C5:1
E5:3 G5:1 E5:2 C5:2
D5:2 F5:1 D5:1 Bb4:2 A4:1 Bb4:1
C5:4 G4:2 -:2
A4:2 D5:1 F5:1 A5:2 G5:1 F5:1
E5:2 G5:1 E5:1 C5:2 E5:2
F5:2 D5:1 Bb4:1 D5:2 F5:2
E5:4 C#5:2 -:2
C6:2 A5:1 F5:1 C5:2 F5:2
E5:2 G5:2 C6:3 -:1
B5:2 G5:1 D5:1 B4:2 D5:2
C#5:2 E5:2 A5:3 -:1
D6:2 A5:1 F5:1 D5:2 F5:1 A5:1
G5:2 E5:1 C5:1 E5:2 G5:2
F5:2 D5:2 E5:2 G5:2
D5:4 -:2 A4:2
`;

export const BASS = `
D3:1 D3:1 D4:1 D3:1 -:1 D3:1 D4:1 A3:1
C3:1 C3:1 C4:1 C3:1 -:1 C3:1 C4:1 G3:1
Bb2:1 Bb2:1 Bb3:1 Bb2:1 -:1 Bb2:1 Bb3:1 F3:1
C3:1 C3:1 C4:1 C3:1 -:1 C3:1 C4:1 G3:1
D3:1 D3:1 D4:1 D3:1 -:1 D3:1 D4:1 A3:1
C3:1 C3:1 C4:1 C3:1 -:1 C3:1 C4:1 G3:1
Bb2:1 Bb2:1 Bb3:1 Bb2:1 -:1 Bb2:1 Bb3:1 F3:1
A2:1 A2:1 A3:1 A2:1 -:1 A2:1 A3:1 E3:1
F3:1 F3:1 F4:1 F3:1 -:1 F3:1 F4:1 C4:1
C3:1 C3:1 C4:1 C3:1 -:1 C3:1 C4:1 G3:1
G2:1 G2:1 G3:1 G2:1 -:1 G2:1 G3:1 D3:1
A2:1 A2:1 A3:1 A2:1 -:1 A2:1 A3:1 E3:1
D3:1 D3:1 D4:1 D3:1 -:1 D3:1 D4:1 A3:1
C3:1 C3:1 C4:1 C3:1 -:1 C3:1 C4:1 G3:1
Bb2:1 Bb2:1 Bb3:1 Bb2:1 C3:1 C3:1 C4:1 G3:1
D3:1 D3:1 D4:1 D3:1 -:1 D3:1 D4:1 A3:1
`;

/** Noise drums, one character a step: k kick, s snare, h hat, - rest. */
export const DRUMS = `
khshkhsh
khshkhsh
khshkhsh
khshkkss
khshkhsh
khshkhsh
khshkhsh
khshkkss
khshkhsh
khshkhsh
khshkhsh
khshkkss
khshkhsh
khshkhsh
khshkhsh
kskskss-
`;

export const BARS = 16;
export const STEPS_PER_BAR = 8;
export const LOOP_STEPS = BARS * STEPS_PER_BAR;

export type Variant = 'title' | 'race' | 'final-lap';
/** Beats a minute. The final lap is 8% faster; the title is calmer. */
export const TEMPO: Record<Variant, number> = { title: 112, race: 140, 'final-lap': 151 };

/** Seconds per step (an eighth note) at a tempo. */
export const stepSeconds = (bpm: number): number => 60 / bpm / 2;

export interface Note {
  step: number;
  /** MIDI note number. */
  midi: number;
  /** Length in steps. */
  len: number;
}

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number of a name such as "C#5" or "Bb2". */
export function midiOf(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  const base = m ? PITCH[m[1] ?? ''] : undefined;
  if (!m || base === undefined) throw new Error(`bad note ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

/** Parse a voice. Returns its notes (rests dropped) and its length in steps. */
export function parseVoice(src: string): { notes: Note[]; steps: number } {
  const notes: Note[] = [];
  let step = 0;
  for (const tok of src.split(/\s+/).filter(Boolean)) {
    const [name, lenText] = tok.split(':');
    const len = Number(lenText);
    if (!name || !Number.isInteger(len) || len < 1) throw new Error(`bad token ${tok}`);
    if (name !== '-') notes.push({ step, midi: midiOf(name), len });
    step += len;
  }
  return { notes, steps: step };
}

export type Drum = 'k' | 's' | 'h';

export function parseDrums(src: string): {
  hits: Array<{ step: number; drum: Drum }>;
  steps: number;
} {
  const chars = src.replace(/\s+/g, '');
  const hits: Array<{ step: number; drum: Drum }> = [];
  [...chars].forEach((c, step) => {
    if (c === 'k' || c === 's' || c === 'h') hits.push({ step, drum: c });
    else if (c !== '-') throw new Error(`bad drum ${c}`);
  });
  return { hits, steps: chars.length };
}

/** The song by step: what starts on each step of the loop. */
export interface Song {
  lead: Array<Note | undefined>;
  bass: Array<Note | undefined>;
  drums: Array<Drum | undefined>;
}

export function buildSong(): Song {
  const lead: Array<Note | undefined> = new Array(LOOP_STEPS);
  const bass: Array<Note | undefined> = new Array(LOOP_STEPS);
  const drums: Array<Drum | undefined> = new Array(LOOP_STEPS);
  for (const n of parseVoice(LEAD).notes) lead[n.step] = n;
  for (const n of parseVoice(BASS).notes) bass[n.step] = n;
  for (const h of parseDrums(DRUMS).hits) drums[h.step] = h.drum;
  return { lead, bass, drums };
}

const SONG = buildSong();

/** Schedule what starts on one step of the loop, at time t. */
export function playStep(
  s: Synth,
  out: AudioNode,
  variant: Variant,
  step: number,
  t: number,
): void {
  const sp = stepSeconds(TEMPO[variant]);
  const i = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const calm = variant === 'title';
  const lead = SONG.lead[i];
  if (lead) {
    tone(s, out, {
      type: calm ? 'triangle' : 'square',
      f0: hz(lead.midi),
      t,
      dur: lead.len * sp * 0.9,
      peak: calm ? 0.2 : 0.09,
      attack: 0.01,
    });
  }
  const bass = SONG.bass[i];
  if (bass && (!calm || i % 2 === 0)) {
    tone(s, out, {
      type: 'triangle',
      f0: hz(bass.midi),
      t,
      dur: (calm ? 2 : bass.len) * sp * 0.85,
      peak: calm ? 0.22 : 0.3,
      attack: 0.005,
    });
  }
  const drum = SONG.drums[i];
  if (drum && !calm) {
    if (drum === 'k') {
      noise(s, out, { t, dur: 0.12, peak: 0.45, filter: 'lowpass', f0: 260, f1: 60 });
    } else if (drum === 's') {
      noise(s, out, { t, dur: 0.14, peak: 0.22, filter: 'bandpass', f0: 1800, q: 0.8 });
    } else {
      noise(s, out, { t, dur: 0.04, peak: 0.1, filter: 'highpass', f0: 7000 });
    }
  } else if (calm && i % 4 === 2) {
    noise(s, out, { t, dur: 0.03, peak: 0.05, filter: 'highpass', f0: 8000 });
  }
}

/** Seconds of music scheduled ahead of the clock. */
export const LOOKAHEAD = 0.15;
/** Milliseconds between scheduler runs. */
export const TICK_MS = 30;

export interface Sequencer {
  /** null stops the music. A change between race and final-lap keeps the bar. */
  setVariant(v: Variant | null): void;
  variant(): Variant | null;
  /** Schedule notes up to the lookahead. The timer calls it; tests may too. */
  tick(): void;
  dispose(): void;
}

export interface SequencerDeps {
  synth: Synth;
  out: AudioNode;
  /** false: the clock is stopped, so schedule nothing. */
  running(): boolean;
  /** true: keep time but create no nodes. */
  silent(): boolean;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

/** A lookahead scheduler: a timer schedules each note on the audio clock. */
export function createSequencer(deps: SequencerDeps): Sequencer {
  const { ctx } = deps.synth;
  const setI = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearI =
    deps.clearInterval ?? ((id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>));
  let variant: Variant | null = null;
  let step = 0;
  let next = 0;
  let timer: unknown = null;

  const tick = () => {
    if (variant === null || !deps.running()) return;
    const now = ctx.currentTime;
    // After a stall (a suspended clock, a throttled timer), restart near now
    // instead of firing every missed note at once.
    if (next < now) next = now + 0.05;
    while (next < now + LOOKAHEAD) {
      if (!deps.silent()) playStep(deps.synth, deps.out, variant, step, next);
      next += stepSeconds(TEMPO[variant]);
      step = (step + 1) % LOOP_STEPS;
    }
  };

  return {
    setVariant(v) {
      if (v === variant) return;
      const keepBar = v !== null && variant !== null && v !== 'title' && variant !== 'title';
      variant = v;
      if (!keepBar) {
        step = 0;
        next = 0;
      }
      if (v === null) {
        if (timer !== null) clearI(timer);
        timer = null;
        return;
      }
      if (timer === null) timer = setI(tick, TICK_MS);
      tick();
    },
    variant: () => variant,
    tick,
    dispose() {
      if (timer !== null) clearI(timer);
      timer = null;
      variant = null;
    },
  };
}
