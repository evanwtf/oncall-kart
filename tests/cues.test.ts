import { describe, expect, it } from 'vitest';
import {
  createCueState,
  cuesFor,
  HEAR_RANGE,
  MAX_PER_KIND,
  type Cue,
  type CueState,
} from '../src/audio/cues';
import { NO_INPUT, spawnKart } from '../src/logic/kart';
import { createRace, stepRace, type Race, type RaceEvent } from '../src/logic/race';
import { buildTrack } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';
import { TUNING } from '../src/logic/tuning';

const track = buildTrack(HALL);

/** A race past its countdown, so no countdown cue joins the cues under test. */
function newRace(laps: 1 | 3 | 10 = 3, bots = 1): Race {
  const race = createRace({ laps, seed: 1, driverColor: 0, bots }, track);
  race.phase = 'racing';
  race.countdown = 0;
  return race;
}

function kinds(cues: readonly Cue[]): string[] {
  return cues.map((c) => c.kind);
}

/** Put kart id at s on the centerline. */
function place(race: Race, id: number, s: number): void {
  const k = race.karts[id];
  if (!k) throw new Error(`no kart ${id}`);
  k.kart = spawnKart(track, s, 0);
  k.proj = { s, lateral: 0 };
}

/** Run the countdown at 60 fps and collect every cue. */
function countdownCues(race: Race, state: CueState): Cue[] {
  const out: Cue[] = [];
  let now = 0;
  out.push(...cuesFor(race, [], state, now));
  while (race.phase === 'countdown') {
    now += 1 / 60;
    out.push(...cuesFor(race, stepRace(race, [NO_INPUT], 1 / 60), state, now));
  }
  return out;
}

describe('cuesFor', () => {
  it('gives each countdown number once, then go once', () => {
    const race = createRace({ laps: 3, seed: 1, driverColor: 0, bots: 1 }, track);
    const state = createCueState();
    const cues = countdownCues(race, state);
    expect(cues).toEqual([
      { kind: 'countdown', n: 3 },
      { kind: 'countdown', n: 2 },
      { kind: 'countdown', n: 1 },
      { kind: 'go' },
    ]);
    // Later frames add no countdown cue.
    expect(cuesFor(race, [], state, 10)).toEqual([]);
  });

  it('gives gate-ok for the player step and nothing for a bot step', () => {
    const race = newRace();
    const state = createCueState();
    const step = race.karts[0]?.ticket.type.steps[0];
    if (!step) throw new Error('no step');
    expect(kinds(cuesFor(race, [{ type: 'step-ok', kartId: 0, step }], state, 1))).toEqual([
      'gate-ok',
    ]);
    expect(cuesFor(race, [{ type: 'step-ok', kartId: 1, step }], state, 2)).toEqual([]);
  });

  it('gives ticket-closed, not gate-ok, for the step that closes a ticket', () => {
    const race = newRace();
    const state = createCueState();
    const k = race.karts[0];
    if (!k) throw new Error('no player');
    const events: RaceEvent[] = [
      { type: 'step-ok', kartId: 0, step: 'REINSTATE' },
      { type: 'ticket-closed', kartId: 0, ticket: k.ticket },
    ];
    expect(kinds(cuesFor(race, events, state, 1))).toEqual(['ticket-closed']);
  });

  it('maps the player events to their cues', () => {
    const race = newRace();
    const state = createCueState();
    const k = race.karts[0];
    if (!k) throw new Error('no player');
    const events: RaceEvent[] = [
      { type: 'wrong-gate', kartId: 0, op: 'MAINT' },
      { type: 'sla-breach', kartId: 0, ticket: k.ticket },
      { type: 'pit-service', kartId: 0, work: 'reseat' },
      { type: 'item-picked', kartId: 0, item: 'page' },
      { type: 'item-used', kartId: 0, item: 'spill' },
      { type: 'item-used', kartId: 1, item: 'page' },
    ];
    expect(cuesFor(race, events, state, 1)).toEqual([
      { kind: 'gate-wrong' },
      { kind: 'sla-breach' },
      { kind: 'pit' },
      { kind: 'item-pick' },
      { kind: 'item-use', item: 'spill' },
    ]);
  });

  it('gives a hit on the player full gain, and drops an ignored hit', () => {
    const race = newRace();
    const state = createCueState();
    const cues = cuesFor(
      race,
      [
        { type: 'hit', kartId: 0, kind: 'cable', outcome: 'spun', byId: null },
        { type: 'hit', kartId: 0, kind: 'cable', outcome: 'ignored', byId: null },
      ],
      state,
      1,
    );
    expect(cues).toEqual([{ kind: 'hit', outcome: 'spun', gain: 1 }]);
  });

  it('fades a hit on a bot by distance, and drops it past HEAR_RANGE', () => {
    const race = newRace();
    const hit: RaceEvent = { type: 'hit', kartId: 1, kind: 'page', outcome: 'spun', byId: 0 };
    place(race, 0, 200);
    place(race, 1, 210);
    const near = cuesFor(race, [hit], createCueState(), 1);
    expect(near).toHaveLength(1);
    const c = near[0];
    if (c?.kind !== 'hit') throw new Error('not a hit');
    expect(c.gain).toBeGreaterThan(0);
    expect(c.gain).toBeLessThan(1);

    place(race, 1, 200 + HEAR_RANGE + 1);
    expect(cuesFor(race, [hit], createCueState(), 1)).toEqual([]);
  });

  it('gives lap for a middle lap and final-lap when the last lap starts', () => {
    const race = newRace(3);
    const state = createCueState();
    const lap = (completed: number, kartId = 0): RaceEvent => ({
      type: 'lap',
      kartId,
      completed,
      lapTime: 30,
    });
    expect(kinds(cuesFor(race, [lap(1)], state, 1))).toEqual(['lap']);
    expect(kinds(cuesFor(race, [lap(2)], state, 2))).toEqual(['final-lap']);
    // A bot lap gives nothing.
    expect(cuesFor(race, [lap(1, 1)], state, 3)).toEqual([]);
  });

  it('gives finish with the player place, and no lap cue on the finish line', () => {
    const race = newRace(1);
    race.finalOrder = [1, 0];
    const state = createCueState();
    const events: RaceEvent[] = [
      { type: 'lap', kartId: 0, completed: 1, lapTime: 30 },
      { type: 'finished', kartId: 0, time: 30 },
    ];
    expect(cuesFor(race, events, state, 1)).toEqual([{ kind: 'finish', place: 2 }]);
  });

  it('gives one drift-stage cue per stage reached', () => {
    const race = newRace();
    const state = createCueState();
    const k = race.karts[0];
    if (!k) throw new Error('no player');
    const out: Cue[] = [];
    let now = 0;
    for (let t = 0; t <= 2.5; t += 1 / 60) {
      k.kart = { ...k.kart, driftDir: 1, driftTime: t };
      now += 1 / 60;
      out.push(...cuesFor(race, [], state, now));
    }
    expect(out).toEqual([
      { kind: 'drift-stage', stage: 1 },
      { kind: 'drift-stage', stage: 2 },
      { kind: 'drift-stage', stage: 3 },
    ]);
    // A new drift starts the stages again.
    k.kart = { ...k.kart, driftDir: 0, driftTime: 0 };
    cuesFor(race, [], state, (now += 1));
    k.kart = { ...k.kart, driftDir: -1, driftTime: TUNING.driftStages[1] };
    expect(cuesFor(race, [], state, now + 2)).toEqual([{ kind: 'drift-stage', stage: 1 }]);
  });

  it('gives boost when the player boost time rises', () => {
    const race = newRace();
    const state = createCueState();
    const k = race.karts[0];
    if (!k) throw new Error('no player');
    expect(cuesFor(race, [], state, 0)).toEqual([]);
    k.kart = { ...k.kart, boostTime: 1 };
    expect(cuesFor(race, [], state, 1)).toEqual([{ kind: 'boost' }]);
    // A boost that runs down gives nothing.
    k.kart = { ...k.kart, boostTime: 0.5 };
    expect(cuesFor(race, [], state, 2)).toEqual([]);
  });

  it('caps each cue kind at MAX_PER_KIND per 100 ms (an event storm)', () => {
    const race = newRace(3, 7);
    const state = createCueState();
    cuesFor(race, [], state, 0);
    for (const k of race.karts) place(race, k.id, 300 + k.id);
    const storm: RaceEvent[] = Array.from({ length: 20 }, (_, i) => ({
      type: 'hit',
      kartId: i % race.karts.length,
      kind: 'page',
      outcome: 'spun',
      byId: null,
    }));
    const first = cuesFor(race, storm, state, 1);
    expect(first.filter((c) => c.kind === 'hit').length).toBeLessThanOrEqual(MAX_PER_KIND);
    expect(first.length).toBeGreaterThan(0);
    // 50 ms later the window is still full.
    expect(cuesFor(race, storm, state, 1.05)).toEqual([]);
    // 100 ms after the first burst the window is open again.
    expect(cuesFor(race, storm, state, 1.1).length).toBeGreaterThan(0);
  });
});
