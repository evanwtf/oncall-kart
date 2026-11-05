import { describe, expect, it } from 'vitest';
import {
  eventToast,
  formatBudget,
  formatClock,
  panelLabel,
  speedText,
} from '../../src/shooter/ui/hud';
import { createShift } from '../../src/shooter/logic/shift';

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

  it('shows the budget in dollars', () => {
    expect(formatBudget(20000)).toBe('$20,000');
    expect(formatBudget(500)).toBe('$500');
    expect(formatBudget(0)).toBe('$0');
  });

  it('shows the slowdown only when vendors are close', () => {
    expect(speedText(0)).toBe('');
    expect(speedText(1)).toBe('Speed 80% · 1 vendor close');
    expect(speedText(3)).toBe('Speed 40% · 3 vendors close');
    expect(speedText(7)).toBe('Speed 10% · 7 vendors close');
  });

  it('shows a vendor line as a toast with the role', () => {
    const s = createShift(1);
    expect(
      eventToast(
        { type: 'vendor-close', id: 1, role: 'account-exec', line: 'Got five minutes?' },
        s,
      ),
    ).toEqual({ text: 'Account exec: Got five minutes?', kind: 'vendor' });
  });
});
