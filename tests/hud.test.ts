import { describe, expect, it } from 'vitest';
import { formatTime } from '../src/ui/hud';
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
