// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInput, type InputSource } from '../src/input';
import { NO_INPUT, type KartInput } from '../src/logic/kart';
import {
  createTouch,
  loadAutoGas,
  saveAutoGas,
  steerFromDrag,
  type TouchControls,
} from '../src/touchInput';

describe('steerFromDrag', () => {
  it('is 0 at rest and inside the dead zone', () => {
    expect(steerFromDrag(0)).toBe(0);
    expect(steerFromDrag(5)).toBe(0);
    expect(steerFromDrag(-8)).toBe(0);
  });

  it('is full lock at 70 px and clamps beyond it', () => {
    expect(steerFromDrag(70)).toBe(-1);
    expect(steerFromDrag(-70)).toBe(1);
    expect(steerFromDrag(-200)).toBe(1);
    expect(steerFromDrag(500)).toBe(-1);
  });

  it('drags right steer right (negative), the same sign as the keyboard', () => {
    expect(steerFromDrag(40)).toBeLessThan(0);
    expect(steerFromDrag(-40)).toBeGreaterThan(0);
  });

  it('is monotonic between the dead zone and full lock', () => {
    let prev = 0;
    for (let dx = 0; dx <= 80; dx += 1) {
      const v = steerFromDrag(dx);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('takes a custom dead zone and full-lock distance', () => {
    expect(steerFromDrag(10, 10, 30)).toBe(0);
    expect(steerFromDrag(30, 10, 30)).toBe(-1);
    expect(steerFromDrag(20, 10, 30)).toBeCloseTo(-0.5);
  });
});

let root: HTMLElement;
let touch: TouchControls | null = null;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  touch?.dispose();
  touch = null;
  root.remove();
});

function make(): TouchControls {
  touch = createTouch(root);
  touch.setVisible(true);
  return touch;
}

const q = (sel: string): HTMLElement => {
  const e = root.querySelector<HTMLElement>(sel);
  if (!e) throw new Error(`no ${sel}`);
  return e;
};

function ptr(target: EventTarget, type: string, id: number, x = 0, y = 0) {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: id,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe('createTouch', () => {
  it('builds the pad, the buttons and the pause button', () => {
    make();
    for (const sel of ['.touch-pad', '.touch-drift', '.touch-brake', '.touch-gas', '.touch-pause'])
      expect(root.querySelector(sel)).not.toBeNull();
  });

  it('reads no input while hidden, even with auto-gas on', () => {
    touch = createTouch(root);
    expect(touch.read()).toEqual(NO_INPUT);
    ptr(q('.touch-drift'), 'pointerdown', 1);
    expect(touch.read()).toEqual(NO_INPUT);
    expect(touch.takeActions()).toEqual([]);
  });

  it('steers full right after a 70 px drag right on the pad', () => {
    const t = make();
    const pad = q('.touch-pad');
    ptr(pad, 'pointerdown', 1, 100, 300);
    expect(t.read().steer).toBe(0);
    ptr(pad, 'pointermove', 1, 170, 290);
    expect(t.read().steer).toBe(-1);
    ptr(pad, 'pointermove', 1, 60, 300);
    expect(t.read().steer).toBeGreaterThan(0);
    ptr(pad, 'pointerup', 1, 60, 300);
    expect(t.read().steer).toBe(0);
  });

  it('follows a pad drag that leaves the pad element (moves reach the window)', () => {
    const t = make();
    ptr(q('.touch-pad'), 'pointerdown', 1, 100, 300);
    ptr(window, 'pointermove', 1, 30, 300);
    expect(t.read().steer).toBe(1);
  });

  it('ignores moves from other pointers', () => {
    const t = make();
    ptr(q('.touch-pad'), 'pointerdown', 1, 100, 300);
    ptr(window, 'pointermove', 2, 300, 300);
    expect(t.read().steer).toBe(0);
  });

  it('holds drift while DRIFT is down', () => {
    const t = make();
    const drift = q('.touch-drift');
    ptr(drift, 'pointerdown', 2);
    expect(t.read().drift).toBe(true);
    ptr(drift, 'pointerup', 2);
    expect(t.read().drift).toBe(false);
  });

  it('keeps steering when the drift thumb lifts, and the reverse', () => {
    const t = make();
    const pad = q('.touch-pad');
    const drift = q('.touch-drift');
    ptr(pad, 'pointerdown', 1, 100, 300);
    ptr(pad, 'pointermove', 1, 30, 300);
    ptr(drift, 'pointerdown', 2);
    expect(t.read()).toMatchObject({ steer: 1, drift: true });
    ptr(drift, 'pointerup', 2);
    expect(t.read()).toMatchObject({ steer: 1, drift: false });

    ptr(drift, 'pointerdown', 3);
    ptr(pad, 'pointerup', 1);
    expect(t.read()).toMatchObject({ steer: 0, drift: true });
  });

  it('releases the pad on pointercancel and on lostpointercapture', () => {
    const t = make();
    const pad = q('.touch-pad');
    ptr(pad, 'pointerdown', 1, 100, 300);
    ptr(pad, 'pointermove', 1, 170, 300);
    ptr(pad, 'pointercancel', 1);
    expect(t.read().steer).toBe(0);

    ptr(pad, 'pointerdown', 4, 100, 300);
    ptr(pad, 'pointermove', 4, 170, 300);
    ptr(pad, 'lostpointercapture', 4);
    expect(t.read().steer).toBe(0);
  });

  it('releases a button on pointercancel', () => {
    const t = make();
    const drift = q('.touch-drift');
    ptr(drift, 'pointerdown', 2);
    ptr(drift, 'pointercancel', 2);
    expect(t.read().drift).toBe(false);
  });

  it('a new pad touch after a cancel steers from its own centre', () => {
    const t = make();
    const pad = q('.touch-pad');
    ptr(pad, 'pointerdown', 1, 100, 300);
    ptr(pad, 'pointercancel', 1);
    ptr(pad, 'pointerdown', 5, 400, 300);
    expect(t.read().steer).toBe(0);
  });

  it('holds the item while the ITEM button is down', () => {
    const t = make();
    const item = q('.touch-item');
    expect(item.textContent).toBe('ITEM');
    ptr(item, 'pointerdown', 7);
    expect(t.read().item).toBe(true);
    ptr(window, 'pointerup', 7);
    expect(t.read().item).toBe(false);
  });

  it('reads a tap on ITEM shorter than a frame once', () => {
    const t = make();
    ptr(q('.touch-item'), 'pointerdown', 8);
    ptr(window, 'pointerup', 8);
    expect(t.read().item).toBe(true);
    expect(t.read().item).toBe(false);
  });

  it('releases everything on window blur', () => {
    const t = make();
    ptr(q('.touch-pad'), 'pointerdown', 1, 100, 300);
    ptr(window, 'pointermove', 1, 170, 300);
    ptr(q('.touch-drift'), 'pointerdown', 2);
    ptr(q('.touch-brake'), 'pointerdown', 3);
    window.dispatchEvent(new Event('blur'));
    expect(t.read()).toEqual({ throttle: 1, brake: 0, steer: 0, drift: false, item: false });
  });

  it('releases everything when the tab hides', () => {
    const t = make();
    ptr(q('.touch-drift'), 'pointerdown', 2);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    expect(t.read().drift).toBe(false);
  });

  it('auto-gas: full throttle unless BRAKE is held', () => {
    const t = make();
    expect(t.read()).toMatchObject({ throttle: 1, brake: 0 });
    ptr(q('.touch-brake'), 'pointerdown', 3);
    expect(t.read()).toMatchObject({ throttle: 0, brake: 1 });
    ptr(q('.touch-brake'), 'pointerup', 3);
    expect(t.read()).toMatchObject({ throttle: 1, brake: 0 });
  });

  it('auto-gas off: no throttle until GAS is held', () => {
    const t = make();
    t.setAutoGas(false);
    expect(t.read().throttle).toBe(0);
    const gas = q('.touch-gas');
    ptr(gas, 'pointerdown', 6);
    expect(t.read().throttle).toBe(1);
    ptr(gas, 'pointerup', 6);
    expect(t.read().throttle).toBe(0);
  });

  it('hides GAS while auto-gas is on', () => {
    const t = make();
    expect(q('.touch-gas').hidden).toBe(true);
    t.setAutoGas(false);
    expect(q('.touch-gas').hidden).toBe(false);
  });

  it('queues pause once per press of the pause button', () => {
    const t = make();
    const pause = q('.touch-pause');
    ptr(pause, 'pointerdown', 7);
    ptr(pause, 'pointerup', 7);
    expect(t.takeActions()).toEqual(['pause']);
    expect(t.takeActions()).toEqual([]);
  });

  it('releases held controls when hidden', () => {
    const t = make();
    ptr(q('.touch-drift'), 'pointerdown', 2);
    t.setVisible(false);
    t.setVisible(true);
    expect(t.read().drift).toBe(false);
  });

  it('releases the pad on resize and on orientationchange', () => {
    const t = make();
    for (const type of ['resize', 'orientationchange']) {
      ptr(q('.touch-pad'), 'pointerdown', 1, 100, 300);
      ptr(window, 'pointermove', 1, 170, 300);
      expect(t.read().steer).toBe(-1);
      window.dispatchEvent(new Event(type));
      expect(t.read().steer, type).toBe(0);
    }
  });

  it('removes every window and document listener it adds, and its DOM, on dispose', () => {
    const targets = [window, document] as const;
    const added: [EventTarget, string, unknown, boolean][] = [];
    const removed: [EventTarget, string, unknown, boolean][] = [];
    const capture = (o: unknown) =>
      typeof o === 'boolean' ? o : !!(o as AddEventListenerOptions)?.capture;
    const spies = targets.flatMap((tg) => [
      vi.spyOn(tg, 'addEventListener').mockImplementation(function (
        this: EventTarget,
        type,
        fn,
        o,
      ) {
        added.push([tg, type, fn, capture(o)]);
      }),
      vi.spyOn(tg, 'removeEventListener').mockImplementation(function (
        this: EventTarget,
        type,
        fn,
        o,
      ) {
        removed.push([tg, type, fn, capture(o)]);
      }),
    ]);
    try {
      const t = createTouch(root);
      expect(added.length).toBeGreaterThan(0);
      t.dispose();
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(root.querySelector('.touch-pad')).toBeNull();
    for (const a of added) {
      const match = removed.some(
        (r) => r[0] === a[0] && r[1] === a[1] && r[2] === a[2] && r[3] === a[3],
      );
      expect(match, `${a[1]} still attached`).toBe(true);
    }
  });
});

describe('auto-gas preference', () => {
  afterEach(() => localStorage.clear());

  it('defaults to on and remembers off', () => {
    expect(loadAutoGas()).toBe(true);
    saveAutoGas(false);
    expect(loadAutoGas()).toBe(false);
    saveAutoGas(true);
    expect(loadAutoGas()).toBe(true);
  });
});

function fixed(input: KartInput, actions: string[] = []): InputSource & { disposed: boolean } {
  const s = {
    disposed: false,
    read: () => input,
    takeActions: () => actions.splice(0) as never[],
    dispose: () => {
      s.disposed = true;
    },
  };
  return s;
}

describe('createInput', () => {
  it('steer: the largest magnitude wins', () => {
    const kb = fixed({ ...NO_INPUT, steer: 1 });
    const tc = fixed({ ...NO_INPUT, steer: -0.3 });
    expect(createInput([kb, tc]).read().steer).toBe(1);
    expect(createInput([fixed({ ...NO_INPUT, steer: 0.2 }), tc]).read().steer).toBe(-0.3);
  });

  it('throttle and brake: max; drift: any', () => {
    const a = fixed({ throttle: 1, brake: 0, steer: 0, drift: false });
    const b = fixed({ throttle: 0, brake: 1, steer: 0, drift: true });
    expect(createInput([a, b]).read()).toEqual({ throttle: 1, brake: 1, steer: 0, drift: true });
  });

  it('item: any source', () => {
    const a = fixed({ ...NO_INPUT, item: true });
    expect(createInput([fixed(NO_INPUT), a]).read().item).toBe(true);
    expect(createInput([fixed(NO_INPUT)]).read().item).toBeUndefined();
  });

  it('no sources read as no input', () => {
    expect(createInput([]).read()).toEqual(NO_INPUT);
  });

  it('concatenates actions in source order and disposes every source', () => {
    const a = fixed(NO_INPUT, ['confirm']);
    const b = fixed(NO_INPUT, ['pause']);
    const merged = createInput([a, b]);
    expect(merged.takeActions()).toEqual(['confirm', 'pause']);
    expect(merged.takeActions()).toEqual([]);
    merged.dispose();
    expect(a.disposed && b.disposed).toBe(true);
  });
});
