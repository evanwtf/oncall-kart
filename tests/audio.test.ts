import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCueState, cuesFor, type Cue } from '../src/audio/cues';
import { createAudio, MASTER_GAIN, MUSIC_GAIN } from '../src/audio/engine';
import { FINAL_LAP, GATE_OK, LAP } from '../src/audio/sfx';
import { BASS, DRUMS, LEAD, LOOP_STEPS, parseDrums, parseVoice, TEMPO } from '../src/audio/music';
import { botInput } from '../src/logic/bot';
import { ITEM_KINDS } from '../src/logic/items';
import { createRace, stepRace } from '../src/logic/race';
import { buildTrack } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';

/** Automation calls on every fake param: setTargetAtTime and the ramps. */
let automations = 0;

/** A fake AudioParam: it keeps the last value set by any method. */
class FakeParam {
  value: number;
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number) {
    automations++;
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    automations++;
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number) {
    automations++;
    this.value = v;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

/** A fake node. It counts itself live while it has a connection. */
class FakeNode {
  connected = false;
  /** Where this node sends its output. */
  dests: FakeNode[] = [];
  constructor(protected ctx: FakeContext) {
    ctx.created++;
  }
  connect(dest: FakeNode) {
    if (!this.connected) this.ctx.live++;
    this.connected = true;
    this.dests.push(dest);
    this.ctx.connects++;
    return dest;
  }
  disconnect() {
    if (this.connected) this.ctx.live--;
    this.connected = false;
    this.dests = [];
    this.ctx.disconnects++;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  stopAt = Infinity;
  started = false;
  buffer: unknown = null;
  loop = false;
  type = 'sine';
  frequency = new FakeParam(440);
  start() {
    this.started = true;
    this.ctx.sources.add(this);
  }
  stop(t?: number) {
    this.stopAt = t ?? this.ctx.currentTime;
  }
}

class FakeContext {
  state: string = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination: FakeNode;
  created = 0;
  connects = 0;
  disconnects = 0;
  live = 0;
  resumes = 0;
  suspends = 0;
  /** true: resume() leaves the context suspended, as outside a gesture. */
  refuseResume = false;
  sources = new Set<FakeSource>();
  constructor() {
    this.destination = new FakeNode(this);
  }
  resume() {
    this.resumes++;
    if (!this.refuseResume) this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  gains: FakeGain[] = [];
  createGain() {
    const g = new FakeGain(this);
    this.gains.push(g);
    return g;
  }
  createBiquadFilter() {
    return new FakeFilter(this);
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this);
  }
  createOscillator() {
    return new FakeSource(this);
  }
  createBufferSource() {
    return new FakeSource(this);
  }
  createBuffer(_ch: number, len: number) {
    return { getChannelData: () => new Float32Array(len) };
  }
  /** Move the clock; sources whose stop time has passed fire onended. */
  advance(t: number) {
    this.currentTime += t;
    for (const s of this.sources) {
      if (s.stopAt <= this.currentTime) {
        this.sources.delete(s);
        s.onended?.();
      }
    }
  }
}

function fakeAudio() {
  const ctx = new FakeContext();
  let made = 0;
  const audio = createAudio(() => {
    made++;
    return ctx as unknown as AudioContext;
  });
  return { ctx, audio, made: () => made };
}

/** Every cue kind, with each variant. */
const ALL_CUES: Cue[] = [
  { kind: 'countdown', n: 3 },
  { kind: 'go' },
  { kind: 'gate-ok' },
  { kind: 'gate-wrong' },
  { kind: 'ticket-closed' },
  { kind: 'sla-breach' },
  { kind: 'pit' },
  { kind: 'lap' },
  { kind: 'final-lap' },
  { kind: 'finish', place: 1 },
  { kind: 'finish', place: 8 },
  { kind: 'drift-stage', stage: 1 },
  { kind: 'drift-stage', stage: 3 },
  { kind: 'boost' },
  { kind: 'item-pick' },
  ...ITEM_KINDS.map((item): Cue => ({ kind: 'item-use', item })),
  { kind: 'hit', outcome: 'spun', gain: 1 },
  { kind: 'hit', outcome: 'blocked', gain: 0.5 },
  { kind: 'hit', outcome: 'rolled-back', gain: 0.5 },
];

describe('createAudio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates nothing before unlock()', () => {
    const { ctx, audio, made } = fakeAudio();
    audio.play(ALL_CUES);
    audio.setMusic('race');
    audio.setEngine(20, true);
    vi.advanceTimersByTime(1000);
    expect(made()).toBe(0);
    expect(ctx.created).toBe(1); // the fake's own destination
    expect(audio.state()).toBe('locked');
  });

  it('creates the context once and resumes it when suspended', () => {
    const { ctx, audio, made } = fakeAudio();
    audio.unlock();
    audio.unlock();
    expect(made()).toBe(1);
    expect(ctx.resumes).toBe(1);
    expect(audio.state()).toBe('running');
    // An iOS app switch: the next gesture resumes it.
    ctx.state = 'interrupted';
    expect(audio.state()).toBe('suspended');
    audio.unlock();
    expect(made()).toBe(1);
    expect(ctx.resumes).toBe(2);
    expect(audio.state()).toBe('running');
  });

  it('frees every one-shot node after 1,000 plays of every cue', () => {
    const { ctx, audio } = fakeAudio();
    audio.unlock();
    audio.setMusic('off');
    ctx.advance(0.1);
    const base = ctx.live;
    for (let i = 0; i < 1000; i++) {
      audio.play(ALL_CUES);
      ctx.advance(0.01);
    }
    expect(audio.liveNodes()).toBeGreaterThan(0);
    ctx.advance(5);
    expect(audio.liveNodes()).toBe(0);
    expect(ctx.live).toBe(base);
  });

  it('mutes the master gain at once, and plays nothing new while muted', () => {
    const { ctx, audio } = fakeAudio();
    audio.unlock();
    audio.play(ALL_CUES);
    // The master gain is the one gain that feeds the output.
    const masters = ctx.gains.filter((g) => g.dests.includes(ctx.destination));
    expect(masters).toHaveLength(1);
    const master = masters[0] as FakeGain;
    expect(master.gain.value).toBe(MASTER_GAIN);
    audio.setMuted(true);
    expect(audio.muted()).toBe(true);
    expect(master.gain.value).toBe(0);
    ctx.advance(5);
    const before = ctx.created;
    audio.play(ALL_CUES);
    audio.setMusic('race');
    vi.advanceTimersByTime(2000);
    ctx.advance(2);
    vi.advanceTimersByTime(100);
    expect(ctx.created).toBe(before);
    audio.setMuted(false);
    expect(audio.muted()).toBe(false);
    expect(master.gain.value).toBe(MASTER_GAIN);
  });

  it('schedules no engine automation while the context is suspended', () => {
    const { ctx, audio } = fakeAudio();
    ctx.refuseResume = true;
    audio.unlock();
    audio.setMusic('race');
    expect(audio.state()).toBe('suspended');
    const before = automations;
    for (let i = 0; i < 100; i++) audio.setEngine(i % 40, i % 2 === 0);
    expect(automations).toBe(before);
    ctx.refuseResume = false;
    audio.unlock();
    audio.setEngine(20, true);
    expect(automations).toBeGreaterThan(before);
  });

  it('suspends the context in a hidden tab and resumes it when visible', () => {
    const { ctx, audio } = fakeAudio();
    audio.unlock();
    expect(audio.state()).toBe('running');
    audio.setHidden(true);
    expect(ctx.suspends).toBe(1);
    expect(audio.state()).toBe('suspended');
    // A gesture while hidden (a key in another window) does not resume it.
    audio.unlock();
    expect(audio.state()).toBe('suspended');
    audio.setHidden(false);
    expect(audio.state()).toBe('running');
    // The browser refused the resume: the next gesture resumes it.
    audio.setHidden(true);
    ctx.refuseResume = true;
    audio.setHidden(false);
    expect(audio.state()).toBe('suspended');
    ctx.refuseResume = false;
    audio.unlock();
    expect(audio.state()).toBe('running');
  });

  it('keeps the mute across an unlock that happens later', () => {
    const { audio } = fakeAudio();
    audio.setMuted(true);
    audio.unlock();
    expect(audio.muted()).toBe(true);
  });

  it('runs silent when the factory returns null or throws', () => {
    for (const factory of [
      () => null,
      () => {
        throw new Error('no audio');
      },
    ]) {
      const audio = createAudio(factory);
      expect(() => {
        audio.unlock();
        audio.play(ALL_CUES);
        audio.setMusic('race');
        audio.setEngine(10, true);
        audio.setPaused(true);
        audio.setHidden(true);
        audio.setMuted(true);
        audio.dispose();
      }).not.toThrow();
      expect(audio.state()).toBe('unsupported');
    }
  });

  it('ducks the music on pause and restores it on resume', () => {
    const { ctx, audio } = fakeAudio();
    audio.unlock();
    audio.setMusic('race');
    const musicBus = () => ctx.gains.map((g) => g.gain.value);
    audio.setPaused(true);
    expect(musicBus()).toContain(MUSIC_GAIN * 0.25);
    audio.setPaused(false);
    expect(musicBus()).toContain(MUSIC_GAIN);
  });

  it('keeps the live nodes bounded over a 10-lap race with 8 karts', () => {
    const { ctx, audio } = fakeAudio();
    audio.unlock();
    audio.setMusic('race');
    const race = createRace({ laps: 10, seed: 7, driverColor: 0, bots: 7 }, buildTrack(HALL));
    const state = createCueState();
    const dt = 1 / 60;
    let max = 0;
    let cues = 0;
    let frames = 0;
    while (race.phase !== 'finished' && frames < 60 * 60 * 20) {
      const events = stepRace(race, [botInput(race, race.playerId)], dt);
      const list = cuesFor(race, events, state, ctx.currentTime);
      cues += list.length;
      audio.play(list);
      if (race.karts[0]?.lap.completed === 9) audio.setMusic('final-lap');
      ctx.advance(dt);
      vi.advanceTimersByTime(1000 * dt);
      max = Math.max(max, audio.liveNodes());
      frames++;
    }
    expect(race.phase).toBe('finished');
    expect(cues).toBeGreaterThan(50);
    // About a second of notes and effects at most.
    expect(max).toBeLessThan(120);
    audio.setMusic('off');
    ctx.advance(5);
    expect(audio.liveNodes()).toBe(0);
    console.info(`10-lap race: ${frames} frames, ${cues} cues, max live one-shot nodes ${max}`);
  }, 60_000);
});

describe('the jingles', () => {
  it("opens the final-lap call with the tune's first four notes, an octave up", () => {
    const tune = parseVoice(LEAD)
      .notes.slice(0, 4)
      .map((n) => n.midi + 12);
    expect(FINAL_LAP.slice(0, 4).map((n) => n.midi)).toEqual(tune);
    // It comes home to D.
    expect((FINAL_LAP.at(-1)?.midi ?? 0) % 12).toBe(2);
  });

  it('has no two-note rising leap: gate-ok is one dyad, the lap has three notes', () => {
    expect(GATE_OK).toHaveLength(2);
    expect(LAP).toHaveLength(3);
    const steps = LAP.slice(1).map((n, i) => n.midi - (LAP[i]?.midi ?? 0));
    expect(steps).toEqual([4, 5]);
  });
});

describe('the tune', () => {
  it('has 16 bars of eighths in every voice', () => {
    expect(LOOP_STEPS).toBe(128);
    expect(parseVoice(LEAD).steps).toBe(128);
    expect(parseVoice(BASS).steps).toBe(128);
    expect(parseDrums(DRUMS).steps).toBe(128);
  });

  it('plays the final lap about 8% faster', () => {
    expect(TEMPO['final-lap'] / TEMPO.race).toBeCloseTo(1.08, 1);
    expect(TEMPO.title).toBeLessThan(TEMPO.race);
  });

  it('keeps every note in a playable range', () => {
    for (const v of [LEAD, BASS]) {
      for (const n of parseVoice(v).notes) {
        expect(n.midi).toBeGreaterThanOrEqual(36);
        expect(n.midi).toBeLessThanOrEqual(90);
      }
    }
  });
});
