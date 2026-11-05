/**
 * The kart engine: two oscillators through a low-pass filter. The nodes are
 * made once; each frame only moves their parameters.
 */
export interface EngineSound {
  /** speed in m/s. onRoad false: a muffled, rougher note off the road. */
  set(speed: number, onRoad: boolean): void;
  /** Fade the engine out (pause, finish) or back in. */
  setOn(on: boolean): void;
  dispose(): void;
}

/** Gain of the engine at rest and at top speed. */
const IDLE_GAIN = 0.05;
const TOP_GAIN = 0.09;
/** Seconds for a parameter to settle: smooth, with no clicks. */
const GLIDE = 0.06;

export function engineFreq(speed: number): number {
  return 42 + Math.min(Math.abs(speed), 40) * 3.2;
}

export function createEngineSound(ctx: BaseAudioContext, out: AudioNode): EngineSound {
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  const sub = ctx.createOscillator();
  sub.type = 'square';
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.Q.value = 2;
  const g = ctx.createGain();
  g.gain.value = 0;
  saw.connect(filt);
  sub.connect(filt);
  filt.connect(g);
  g.connect(out);
  const t0 = ctx.currentTime;
  saw.frequency.setValueAtTime(engineFreq(0), t0);
  sub.frequency.setValueAtTime(engineFreq(0) / 2, t0);
  filt.frequency.setValueAtTime(300, t0);
  saw.start();
  sub.start();

  let on = false;
  let level = IDLE_GAIN;
  let lastF = -1;
  let lastRoad = true;

  return {
    set(speed, onRoad) {
      const f = engineFreq(speed);
      const share = Math.min(Math.abs(speed), 40) / 40;
      level = IDLE_GAIN + (TOP_GAIN - IDLE_GAIN) * share;
      // Skip tiny changes: fewer automation events, the same sound.
      if (Math.abs(f - lastF) < 0.5 && onRoad === lastRoad) return;
      lastF = f;
      lastRoad = onRoad;
      const t = ctx.currentTime;
      saw.frequency.setTargetAtTime(f, t, GLIDE);
      sub.frequency.setTargetAtTime(f / 2 + (onRoad ? 0 : 3), t, GLIDE);
      filt.frequency.setTargetAtTime((onRoad ? 500 : 260) + share * 1400, t, GLIDE);
      if (on) g.gain.setTargetAtTime(level, t, GLIDE);
    },
    setOn(next) {
      if (next === on) return;
      on = next;
      g.gain.setTargetAtTime(on ? level : 0, ctx.currentTime, GLIDE);
    },
    dispose() {
      try {
        saw.stop();
        sub.stop();
      } catch {
        // Already stopped.
      }
      for (const n of [saw, sub, filt, g]) n.disconnect();
    },
  };
}
