// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShooterInput, type ShooterInput } from '../../src/shooter/input';
import { SHOOTER_TUNING } from '../../src/shooter/logic/tuning';

let input: ShooterInput | null = null;
let canvas: HTMLCanvasElement;
let lockEl: Element | null = null;

const down = (code: string, repeat = false) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { code, repeat, bubbles: true }));
const up = (code: string) =>
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
const mouse = (movementX: number, movementY: number) => {
  const e = new MouseEvent('mousemove', { bubbles: true });
  Object.defineProperty(e, 'movementX', { value: movementX });
  Object.defineProperty(e, 'movementY', { value: movementY });
  document.dispatchEvent(e);
};
const setLock = (el: Element | null) => {
  lockEl = el;
  document.dispatchEvent(new Event('pointerlockchange'));
};

beforeEach(() => {
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  lockEl = null;
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => lockEl,
  });
});

afterEach(() => {
  input?.dispose();
  input = null;
  canvas.remove();
  vi.restoreAllMocks();
});

describe('shooter input', () => {
  it('maps W A S D and the arrows to movement', () => {
    input = createShooterInput(window, canvas);
    down('KeyW');
    expect(input.read().move).toEqual({ forward: 1, strafe: 0 });
    down('KeyD');
    expect(input.read().move).toEqual({ forward: 1, strafe: 1 });
    up('KeyW');
    up('KeyD');
    down('ArrowDown');
    down('ArrowLeft');
    expect(input.read().move).toEqual({ forward: -1, strafe: -1 });
    up('ArrowDown');
    up('ArrowLeft');
    expect(input.read().move).toEqual({ forward: 0, strafe: 0 });
  });

  it('holds E to work', () => {
    input = createShooterInput(window, canvas);
    down('KeyE');
    expect(input.read().work).toBe(true);
    up('KeyE');
    expect(input.read().work).toBe(false);
  });

  it('picks the panel step with the number keys, once per press', () => {
    input = createShooterInput(window, canvas);
    down('Digit5');
    expect(input.read().pick).toBe('FW-ISO');
    expect(input.read().pick).toBeNull();
    down('Numpad9');
    expect(input.read().pick).toBe('PIT');
    down('Digit1');
    expect(input.read().pick).toBe('MAINT');
  });

  it('queues pause for P and Esc', () => {
    input = createShooterInput(window, canvas);
    down('KeyP');
    down('Escape');
    expect(input.takeActions()).toEqual(['pause', 'pause']);
    expect(input.takeActions()).toEqual([]);
  });

  it('turns with the mouse only while locked, and clamps the pitch', () => {
    input = createShooterInput(window, canvas);
    input.setView(0, 0);
    mouse(100, 0);
    expect(input.read().yaw).toBe(0);
    setLock(canvas);
    mouse(100, 0);
    // Mouse right turns right: yaw goes down.
    expect(input.read().yaw).toBeCloseTo(-100 * SHOOTER_TUNING.mouseSensitivity);
    mouse(0, -100000);
    expect(input.read().pitch).toBeCloseTo((SHOOTER_TUNING.pitchLimitDeg * Math.PI) / 180);
    mouse(0, 100000);
    expect(input.read().pitch).toBeCloseTo((-SHOOTER_TUNING.pitchLimitDeg * Math.PI) / 180);
  });

  it('uses the sensitivity it is given', () => {
    input = createShooterInput(window, canvas);
    input.setView(0, 0);
    input.setSensitivity(0.01);
    setLock(canvas);
    mouse(10, 0);
    expect(input.read().yaw).toBeCloseTo(-0.1);
  });

  it('releases every key on blur', () => {
    input = createShooterInput(window, canvas);
    down('KeyW');
    down('KeyE');
    window.dispatchEvent(new Event('blur'));
    const r = input.read();
    expect(r.move).toEqual({ forward: 0, strafe: 0 });
    expect(r.work).toBe(false);
  });

  it('queues lock-lost, not pause, when the lock is lost, even with the Esc that caused it', () => {
    input = createShooterInput(window, canvas);
    setLock(canvas);
    expect(input.locked()).toBe(true);
    setLock(null);
    down('Escape');
    expect(input.locked()).toBe(false);
    expect(input.takeActions()).toEqual(['lock-lost']);
  });

  it('ignores an Esc keydown while locked: only the lock change counts', () => {
    input = createShooterInput(window, canvas);
    setLock(canvas);
    down('Escape');
    expect(input.takeActions()).toEqual([]);
    setLock(null);
    expect(input.takeActions()).toEqual(['lock-lost']);
  });

  it('queues nothing when the game gives up the lock itself', () => {
    input = createShooterInput(window, canvas);
    setLock(canvas);
    input.releaseLock();
    setLock(null);
    expect(input.takeActions()).toEqual([]);
    // The next loss, not asked for, counts again.
    setLock(canvas);
    setLock(null);
    expect(input.takeActions()).toEqual(['lock-lost']);
  });

  it('asks for the lock inside the key handler when the action will start play', () => {
    const request = vi.fn();
    canvas.requestPointerLock = request as unknown as HTMLCanvasElement['requestPointerLock'];
    input = createShooterInput(window, canvas, { lockOnAction: (a) => a === 'confirm' });
    down('KeyP');
    expect(request).not.toHaveBeenCalled();
    down('Enter');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports the live view without taking the pick', () => {
    input = createShooterInput(window, canvas);
    input.setView(0, 0);
    setLock(canvas);
    down('Digit2');
    mouse(10, 0);
    expect(input.view().yaw).toBeCloseTo(-10 * SHOOTER_TUNING.mouseSensitivity);
    expect(input.read().pick).toBe('TAKEDOWN');
  });

  it('releases every key when the lock is lost', () => {
    input = createShooterInput(window, canvas);
    setLock(canvas);
    down('KeyE');
    setLock(null);
    expect(input.read().work).toBe(false);
  });

  it('catches a refused lock that throws, without logging', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    canvas.requestPointerLock = () => {
      throw new Error('refused');
    };
    input = createShooterInput(window, canvas);
    expect(() => input?.requestLock()).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it('catches a refused lock that rejects, without logging', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    canvas.requestPointerLock = () => Promise.reject(new Error('refused'));
    input = createShooterInput(window, canvas);
    input.requestLock();
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  const button = (type: 'mousedown' | 'mouseup', b = 0) =>
    canvas.dispatchEvent(new MouseEvent(type, { button: b, bubbles: true }));

  it('fires while the left button is held and the mouse is locked', () => {
    input = createShooterInput(window, canvas);
    setLock(canvas);
    expect(input.read().fire).toBe(false);
    button('mousedown');
    expect(input.read().fire).toBe(true);
    expect(input.read().fire).toBe(true);
    button('mouseup');
    expect(input.read().fire).toBe(false);
    // The right button does not fire.
    button('mousedown', 2);
    expect(input.read().fire).toBe(false);
  });

  it('does not fire on a click while unlocked: that click only asks for the lock', () => {
    input = createShooterInput(window, canvas);
    button('mousedown');
    expect(input.read().fire).toBe(false);
    // The lock lands while the button is still down: still no fire until a new press.
    setLock(canvas);
    expect(input.read().fire).toBe(false);
    button('mouseup');
    button('mousedown');
    expect(input.read().fire).toBe(true);
  });

  it('fires once for a click that starts and ends between two reads', () => {
    input = createShooterInput(window, canvas);
    setLock(canvas);
    button('mousedown');
    button('mouseup');
    expect(input.read().fire).toBe(true);
    expect(input.read().fire).toBe(false);
  });

  it('does not latch a click made while unlocked', () => {
    input = createShooterInput(window, canvas);
    button('mousedown');
    button('mouseup');
    setLock(canvas);
    expect(input.read().fire).toBe(false);
  });

  it('stops firing when the lock is lost or the window blurs', () => {
    input = createShooterInput(window, canvas);
    setLock(canvas);
    button('mousedown');
    setLock(null);
    expect(input.read().fire).toBe(false);
    setLock(canvas);
    button('mousedown');
    window.dispatchEvent(new Event('blur'));
    expect(input.read().fire).toBe(false);
  });

  it('queues menu actions for Enter and the arrows', () => {
    input = createShooterInput(window, canvas);
    down('Enter');
    down('ArrowUp');
    down('ArrowDown', true);
    expect(input.takeActions()).toEqual(['confirm', 'up']);
  });
});
