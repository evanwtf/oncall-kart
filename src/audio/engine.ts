import type { Cue } from './cues';
import { createEngineSound, type EngineSound } from './engineSound';
import { createSequencer, type Sequencer, type Variant } from './music';
import { playCue, type Synth } from './sfx';

export type MusicState = Variant | 'off';
export type AudioState = 'locked' | 'running' | 'suspended' | 'unsupported';

export interface Audio {
  /** Create or resume the context. Call it inside a real key or pointer handler. */
  unlock(): void;
  play(cues: readonly Cue[]): void;
  /** speed in m/s. The engine sounds only while race music plays and the game runs. */
  setEngine(speed: number, onRoad: boolean): void;
  setMusic(state: MusicState): void;
  /** A pause ducks the music and stops the engine. */
  setPaused(p: boolean): void;
  /**
   * A hidden tab suspends the context: no sound and no work. Visible again,
   * it resumes; if the browser refuses, the next gesture resumes it.
   */
  setHidden(h: boolean): void;
  setMuted(m: boolean): void;
  muted(): boolean;
  state(): AudioState;
  /** One-shot nodes not yet disconnected: notes and sound effects still sounding. */
  liveNodes(): number;
  dispose(): void;
}

/** Bus gains. The music sits 6 dB under the effects. */
export const SFX_GAIN = 1;
export const MUSIC_GAIN = 0.5;
/**
 * Master gain when the sound is on. The limiter adds make-up gain, so this
 * trims the output back to leave headroom under 0 dBFS.
 */
export const MASTER_GAIN = 0.6;
/** The music under a pause, as a share of MUSIC_GAIN. */
export const DUCK = 0.25;

const MUTE_KEY = 'oncall-kart.muted';

export function loadMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveMuted(m: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, m ? 'on' : 'off');
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

function defaultFactory(): AudioContext | null {
  const w = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const C = w.AudioContext ?? w.webkitAudioContext;
  return C ? new C({ latencyHint: 'interactive' }) : null;
}

/** Set a gain now, dropping any ramp in progress. */
function setNow(p: AudioParam, v: number, t: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(v, t);
}

/** The master chain: both buses into a limiter, then the master (mute) gain. */
export interface Graph {
  sfx: GainNode;
  music: GainNode;
  master: GainNode;
}

export function buildGraph(ctx: BaseAudioContext, muted: boolean): Graph {
  const sfx = ctx.createGain();
  sfx.gain.value = SFX_GAIN;
  const music = ctx.createGain();
  music.gain.value = MUSIC_GAIN;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_GAIN;
  sfx.connect(limiter);
  music.connect(limiter);
  limiter.connect(master);
  master.connect(ctx.destination);
  return { sfx, music, master };
}

/** One second of white noise, shared by every noise sound. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

const NOOP: Audio = {
  unlock() {},
  play() {},
  setEngine() {},
  setMusic() {},
  setPaused() {},
  setHidden() {},
  setMuted() {},
  muted: () => false,
  state: () => 'unsupported',
  liveNodes: () => 0,
  dispose() {},
};

/**
 * The game's sound. Nothing is created before unlock(). The factory is
 * injectable for tests; it returns null (or throws) when Web Audio is missing,
 * and the game then runs silent.
 */
export function createAudio(factory: () => AudioContext | null = defaultFactory): Audio {
  let ctx: AudioContext | null = null;
  let unsupported = false;
  let graph: Graph | null = null;
  let synth: Synth | null = null;
  let seq: Sequencer | null = null;
  let engine: EngineSound | null = null;
  let muted = false;
  let paused = false;
  let hidden = false;
  let music: MusicState = 'off';
  let live = 0;

  const running = () => ctx !== null && ctx.state === 'running';
  const raceMusic = () => music === 'race' || music === 'final-lap';
  const engineOn = () => raceMusic() && !paused && !muted;
  const applyMusic = () => {
    if (!seq) return;
    seq.setVariant(music === 'off' ? null : music);
    engine?.setOn(engineOn());
  };

  const start = (c: AudioContext) => {
    const g = buildGraph(c, muted);
    graph = g;
    const s: Synth = {
      ctx: c,
      noise: noiseBuffer(c),
      track(source, nodes) {
        live += nodes.length;
        source.onended = () => {
          for (const n of nodes) n.disconnect();
          live -= nodes.length;
          source.onended = null;
        };
      },
    };
    synth = s;
    engine = createEngineSound(c, g.sfx);
    seq = createSequencer({ synth: s, out: g.music, running, silent: () => muted });
    if (paused) setNow(g.music.gain, MUSIC_GAIN * DUCK, c.currentTime);
    applyMusic();
  };

  /** Resume a suspended context. Safari reports 'interrupted' after an app switch or a call. */
  const resume = () => {
    const st = ctx?.state as string | undefined;
    if (st === 'suspended' || st === 'interrupted') {
      ctx?.resume().catch(() => {
        // A resume outside a gesture can fail; the next gesture tries again.
      });
    }
  };

  const audio: Audio = {
    unlock() {
      if (unsupported) return;
      if (!ctx) {
        try {
          ctx = factory();
        } catch {
          ctx = null;
        }
        if (!ctx) {
          unsupported = true;
          return;
        }
        try {
          start(ctx);
        } catch {
          unsupported = true;
          ctx = null;
          return;
        }
      }
      if (!hidden) resume();
    },
    play(cues) {
      if (!ctx || !graph || !synth || muted || !running() || cues.length === 0) return;
      const t = ctx.currentTime + 0.005;
      for (const c of cues) playCue(synth, graph.sfx, c, t);
    },
    setEngine(speed, onRoad) {
      // A stopped clock would pile up automation events for no sound.
      if (!running()) return;
      engine?.set(speed, onRoad);
    },
    setMusic(state) {
      if (state === music) return;
      music = state;
      applyMusic();
    },
    setPaused(p) {
      if (p === paused) return;
      paused = p;
      if (ctx && graph) {
        const t = ctx.currentTime;
        graph.music.gain.cancelScheduledValues(t);
        graph.music.gain.setTargetAtTime(MUSIC_GAIN * (p ? DUCK : 1), t, 0.08);
      }
      engine?.setOn(engineOn());
    },
    setHidden(h) {
      if (h === hidden) return;
      hidden = h;
      if (!ctx) return;
      if (h) {
        if (ctx.state === 'running') {
          ctx.suspend().catch(() => {
            // Nothing to do: a context that will not suspend keeps playing ducked.
          });
        }
      } else {
        resume();
      }
    },
    setMuted(m) {
      muted = m;
      if (ctx && graph) setNow(graph.master.gain, m ? 0 : MASTER_GAIN, ctx.currentTime);
      engine?.setOn(engineOn());
    },
    muted: () => muted,
    state() {
      if (unsupported) return 'unsupported';
      if (!ctx) return 'locked';
      return ctx.state === 'running' ? 'running' : 'suspended';
    },
    liveNodes: () => live,
    dispose() {
      seq?.dispose();
      engine?.dispose();
      graph?.master.disconnect();
      void ctx?.close().catch(() => {});
      ctx = null;
      graph = null;
      synth = null;
      seq = null;
      engine = null;
    },
  };
  return audio;
}

/** An Audio that does nothing: for pages and tests with no sound. */
export function silentAudio(): Audio {
  return NOOP;
}
