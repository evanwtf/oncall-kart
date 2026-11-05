// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createKeyboard, type Keyboard } from '../src/input';

let kb: Keyboard | null = null;
afterEach(() => kb?.dispose());

const down = (code: string, repeat = false) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { code, repeat, bubbles: true }));
const up = (code: string) =>
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('keyboard', () => {
  it('maps ArrowUp and W to throttle', () => {
    kb = createKeyboard(window);
    down('ArrowUp');
    expect(kb.read().throttle).toBe(1);
    up('ArrowUp');
    expect(kb.read().throttle).toBe(0);
    down('KeyW');
    expect(kb.read().throttle).toBe(1);
  });

  it('maps ArrowDown and S to brake', () => {
    kb = createKeyboard(window);
    down('KeyS');
    expect(kb.read().brake).toBe(1);
  });

  it('maps Left and A to steer +1, Right and D to steer -1', () => {
    kb = createKeyboard(window);
    down('ArrowLeft');
    expect(kb.read().steer).toBe(1);
    up('ArrowLeft');
    down('KeyA');
    expect(kb.read().steer).toBe(1);
    up('KeyA');
    down('KeyD');
    expect(kb.read().steer).toBe(-1);
    down('ArrowLeft');
    expect(kb.read().steer).toBe(0);
  });

  it('maps Space to drift', () => {
    kb = createKeyboard(window);
    down('Space');
    expect(kb.read().drift).toBe(true);
  });

  it('clears held keys on window blur', () => {
    kb = createKeyboard(window);
    down('ArrowUp');
    down('ArrowLeft');
    down('Space');
    window.dispatchEvent(new Event('blur'));
    expect(kb.read()).toEqual({ throttle: 0, brake: 0, steer: 0, drift: false });
  });

  it('clears held keys when the tab hides', () => {
    kb = createKeyboard(window);
    down('ArrowUp');
    setHidden(true);
    expect(kb.read().throttle).toBe(0);
    setHidden(false);
  });

  it('queues confirm once per Enter press, not on repeat', () => {
    kb = createKeyboard(window);
    down('Enter');
    down('Enter', true);
    down('Enter', true);
    expect(kb.takeActions()).toEqual(['confirm']);
    expect(kb.takeActions()).toEqual([]);
  });

  it('maps P and Escape to pause, R to respawn', () => {
    kb = createKeyboard(window);
    down('KeyP');
    down('Escape');
    down('KeyR');
    expect(kb.takeActions()).toEqual(['pause', 'pause', 'respawn']);
  });

  it('queues menu directions', () => {
    kb = createKeyboard(window);
    down('ArrowUp');
    down('ArrowDown');
    down('KeyA');
    down('KeyD');
    expect(kb.takeActions()).toEqual(['up', 'down', 'left', 'right']);
  });

  it('stops listening after dispose', () => {
    kb = createKeyboard(window);
    kb.dispose();
    down('ArrowUp');
    down('Enter');
    expect(kb.read().throttle).toBe(0);
    expect(kb.takeActions()).toEqual([]);
  });
});
