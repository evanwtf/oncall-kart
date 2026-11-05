import { describe, expect, it } from 'vitest';
import { pauseItems, pauseText } from '../src/ui/screens';

describe('pause menu', () => {
  it('lists Sound on every device, and the touch-only items on touch', () => {
    expect(pauseItems(false)).toEqual(['Resume', 'Restart', 'Sound', 'Quit to setup']);
    expect(pauseItems(true)).toEqual([
      'Resume',
      'Restart',
      'Respawn',
      'Auto-gas',
      'Sound',
      'Quit to setup',
    ]);
  });

  it('shows the sound and auto-gas state', () => {
    expect(pauseText('Sound', { autoGas: true, muted: false })).toBe('Sound: On');
    expect(pauseText('Sound', { autoGas: true, muted: true })).toBe('Sound: Off');
    expect(pauseText('Auto-gas', { autoGas: false, muted: false })).toBe('Auto-gas: Off');
    expect(pauseText('Resume', { autoGas: true, muted: true })).toBe('Resume');
  });
});
