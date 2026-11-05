import type { KartInput } from './logic/kart';

/** One-shot actions for menus and the race. Each fires once per key press. */
export type Action = 'confirm' | 'back' | 'pause' | 'respawn' | 'up' | 'down' | 'left' | 'right';

export interface Keyboard {
  /** Held keys as kart input. */
  read(): KartInput;
  /** Actions since the last call. The queue is then empty. */
  takeActions(): Action[];
  dispose(): void;
}

const THROTTLE = ['ArrowUp', 'KeyW'];
const BRAKE = ['ArrowDown', 'KeyS'];
const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const DRIFT = ['Space'];

const ACTIONS: Record<string, Action> = {
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Backspace: 'back',
  KeyP: 'pause',
  Escape: 'pause',
  KeyR: 'respawn',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

/** Keys the page must not act on (scroll, button press). */
const PREVENT = new Set([...THROTTLE, ...BRAKE, ...LEFT, ...RIGHT, ...DRIFT, 'Backspace']);

export function createKeyboard(target: Window): Keyboard {
  const held = new Set<string>();
  let queue: Action[] = [];
  const any = (codes: readonly string[]) => codes.some((c) => held.has(c));

  const onDown = (e: KeyboardEvent) => {
    if (PREVENT.has(e.code)) e.preventDefault();
    held.add(e.code);
    if (e.repeat) return;
    const action = ACTIONS[e.code];
    if (action) queue.push(action);
  };
  const onUp = (e: KeyboardEvent) => {
    // macOS sends no keyup for keys released while Cmd is down: clear them all.
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') held.clear();
    else held.delete(e.code);
  };
  // A key released while the window has no focus never sends keyup: clear all.
  const clear = () => held.clear();
  const onVisibility = () => {
    if (target.document.visibilityState === 'hidden') clear();
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', clear);
  target.document.addEventListener('visibilitychange', onVisibility);

  return {
    read: () => ({
      throttle: any(THROTTLE) ? 1 : 0,
      brake: any(BRAKE) ? 1 : 0,
      steer: (any(LEFT) ? 1 : 0) - (any(RIGHT) ? 1 : 0),
      drift: any(DRIFT),
    }),
    takeActions: () => {
      const out = queue;
      queue = [];
      return out;
    },
    dispose: () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', clear);
      target.document.removeEventListener('visibilitychange', onVisibility);
      held.clear();
      queue = [];
    },
  };
}
