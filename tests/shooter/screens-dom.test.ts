// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createShift } from '../../src/shooter/logic/shift';
import { createShooterScreens, type ScreensState } from '../../src/shooter/ui/screens';

afterEach(() => document.body.replaceChildren());

const noop = () => undefined;

describe('shooter screens in the DOM', () => {
  it('changes nothing when the same state renders twice', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const screens = createShooterScreens(root, {
      start: noop,
      pauseItem: noop,
      endItem: noop,
      sensitivity: noop,
      toStartScreen: noop,
    });
    const shift = createShift(1);
    shift.ended = 'fired';
    for (const screen of ['ended', 'playing', 'paused', 'briefing'] as const) {
      const state: ScreensState = {
        screen,
        shift,
        pauseIndex: 0,
        endIndex: 0,
        sensitivityIndex: 3,
        locked: false,
      };
      screens.render(state);
      const obs = new MutationObserver(noop);
      obs.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      screens.render(state);
      const records = obs.takeRecords();
      obs.disconnect();
      expect(records.map((r) => `${screen}:${r.type}:${(r.target as Element).className}`)).toEqual(
        [],
      );
    }
  });

  it('reports vendors distracted and money spent, and lists the fire control', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const screens = createShooterScreens(root, {
      start: noop,
      pauseItem: noop,
      endItem: noop,
      sensitivity: noop,
      toStartScreen: noop,
    });
    const shift = createShift(1);
    shift.ended = 'rough';
    shift.stats.vendorsDistracted = 7;
    shift.stats.moneySpent = 12500;
    screens.render({
      screen: 'ended',
      shift,
      pauseIndex: 0,
      endIndex: 0,
      sensitivityIndex: 3,
      locked: false,
    });
    const text = root.querySelector('.zd-report')?.textContent ?? '';
    expect(text).toContain('Distractions7');
    expect(text).not.toContain('Vendors distracted');
    expect(text).toContain('Money spent$12,500');
    expect(root.querySelector('.zd-controls')?.textContent).toContain('Left click');
  });
});
