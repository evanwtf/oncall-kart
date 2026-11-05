import { describe, expect, it } from 'vitest';
import { formatClock, panelLabel } from '../../src/shooter/ui/hud';

describe('shooter hud', () => {
  it('shows the clock as m:ss, rounded up', () => {
    expect(formatClock(180)).toBe('3:00');
    expect(formatClock(179.2)).toBe('3:00');
    expect(formatClock(61)).toBe('1:01');
    expect(formatClock(0.4)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('labels the hands-on step with the ticket work', () => {
    expect(panelLabel('PIT', 'swap the disk')).toBe('Hands-on: swap the disk');
    expect(panelLabel('MAINT', 'swap the disk')).toBe('MAINT');
  });
});
