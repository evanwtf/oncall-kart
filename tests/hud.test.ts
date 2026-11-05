import { describe, expect, it } from 'vitest';
import { DRIVERS } from '../src/logic/drivers';
import { createRace, type RaceEvent } from '../src/logic/race';
import { buildTrack } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';
import { formatTime, hitToast, MAX_TAGS, ordinal, pickTags, TAG_TRACK_RANGE } from '../src/ui/hud';
import { shiftCaption } from '../src/ui/screens';

describe('hud', () => {
  it('formats race time as m:ss.t', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(5.04)).toBe('0:05.0');
    expect(formatTime(61.25)).toBe('1:01.3');
    expect(formatTime(-3)).toBe('0:00.0');
    expect(formatTime(59.96)).toBe('1:00.0');
  });

  it('captions the shift report, worst news first', () => {
    expect(shiftCaption({ ticketsClosed: 5, wrongGates: 0, slaBreaches: 3 })).toMatch(/postmortem/);
    expect(shiftCaption({ ticketsClosed: 5, wrongGates: 0, slaBreaches: 0 })).toMatch(
      /Queue cleared/,
    );
    expect(shiftCaption({ ticketsClosed: 0, wrongGates: 0, slaBreaches: 0 })).toMatch(/No tickets/);
  });
});

describe('hud place and toasts', () => {
  it('writes places as ordinals', () => {
    expect([1, 2, 3, 4, 8, 11, 12, 13, 21].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '8th',
      '11th',
      '12th',
      '13th',
      '21st',
    ]);
  });

  it('names who paged the player, and says when an item saved it', () => {
    const race = createRace({ laps: 1, seed: 1, driverColor: 0, bots: 7 }, buildTrack(HALL));
    const by = DRIVERS[race.karts[3]?.driverIndex ?? -1]?.name.toUpperCase();
    const hit = (o: Partial<Extract<RaceEvent, { type: 'hit' }>>) =>
      hitToast({ type: 'hit', kartId: 0, kind: 'page', outcome: 'spun', byId: 3, ...o }, race)
        ?.text;
    expect(hit({})).toBe(`PAGED BY ${by}`);
    expect(hit({ outcome: 'blocked' })).toBe('FIREWALL HELD');
    expect(hit({ outcome: 'rolled-back', kind: 'wrong-gate', byId: null })).toBe('ROLLED BACK');
    expect(hit({ kind: 'cron', byId: null })).toBe('ROGUE CRON JOB');
    expect(hit({ kind: 'wrong-gate', byId: null })).toBeUndefined();
    // Hits between bots make no toast; the player's own hits do.
    expect(hit({ kartId: 2 })).toBeUndefined();
    expect(hit({ kartId: 3, byId: 0 })).toBe(`YOU PAGED ${by}`);
  });
});

describe('name tags', () => {
  const track = buildTrack(HALL);
  const size = () => ({ w: 80, h: 16 });
  const racing = () => {
    const r = createRace({ laps: 1, seed: 1, driverColor: 0, bots: 7 }, track);
    r.phase = 'racing';
    r.time = 5;
    return r;
  };
  /** Every kart on screen, spread out, at distance 10 + id. */
  const spread = (r: ReturnType<typeof racing>) =>
    r.karts.map((k) => ({ x: 100 + k.id * 120, y: 300, dist: 10 + k.id }));

  it('shows none in the countdown or the first second', () => {
    const r = racing();
    r.phase = 'countdown';
    expect(pickTags(r, spread(r), size)).toEqual([]);
    r.phase = 'racing';
    r.time = 0.5;
    expect(pickTags(r, spread(r), size)).toEqual([]);
  });

  it('shows at most 3, the nearest, never the player', () => {
    const r = racing();
    expect(pickTags(r, spread(r), size).map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it('skips a tag that overlaps a nearer one', () => {
    const r = racing();
    const tags = spread(r);
    // Kart 2's tag sits on kart 1's.
    tags[2] = { x: 220 + 20, y: 305, dist: 12 };
    tags[1] = { x: 220, y: 300, dist: 11 };
    expect(pickTags(r, tags, size).map((t) => t.id)).toEqual([1, 3, 4]);
  });

  it('drops karts more than TAG_TRACK_RANGE m away along the track', () => {
    const r = racing();
    const far = r.karts[1];
    if (!far) throw new Error('kart');
    far.proj = { s: (r.karts[0]?.proj.s ?? 0) + TAG_TRACK_RANGE + 5, lateral: 0 };
    expect(pickTags(r, spread(r), size).map((t) => t.id)).toEqual([2, 3, 4]);
  });
});

describe('MAX_TAGS', () => {
  it('is 3', () => expect(MAX_TAGS).toBe(3));
});
