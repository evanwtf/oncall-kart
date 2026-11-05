import { describe, expect, it } from 'vitest';
import { DRIVERS } from '../src/logic/drivers';
import { createRace, type RaceEvent } from '../src/logic/race';
import { buildTrack } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';
import { formatTime, hitToast, ordinal } from '../src/ui/hud';
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
