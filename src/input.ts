import type { KartInput } from './logic/kart';

/** One-shot actions for menus and the race. Each fires once per key press. */
export type Action =
  'confirm' | 'back' | 'pause' | 'respawn' | 'mute' | 'up' | 'down' | 'left' | 'right';

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
const ITEM = ['ShiftLeft', 'ShiftRight', 'KeyE'];

const ACTIONS: Record<string, Action> = {
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Backspace: 'back',
  KeyP: 'pause',
  Escape: 'pause',
  KeyR: 'respawn',
  KeyM: 'mute',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

const DRIVE = new Set([...THROTTLE, ...BRAKE, ...LEFT, ...RIGHT, ...DRIFT, ...ITEM]);

/** A key that drives the kart. A press means the player is on the keyboard now. */
export function isDriveKey(code: string): boolean {
  return DRIVE.has(code);
}

/** Keys the page must not act on (scroll, button press). */
const PREVENT = new Set([...DRIVE, 'Backspace']);

export function createKeyboard(target: Window): Keyboard {
  const held = new Set<string>();
  let queue: Action[] = [];
  // A tap of the item key shorter than a frame still counts: it reads as held once.
  let itemTap = false;
  const any = (codes: readonly string[]) => codes.some((c) => held.has(c));

  const onDown = (e: KeyboardEvent) => {
    if (PREVENT.has(e.code)) e.preventDefault();
    held.add(e.code);
    if (e.repeat) return;
    if (ITEM.includes(e.code)) itemTap = true;
    // A browser or system shortcut (Cmd+M, Ctrl+R, Alt+P) is not a game action.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const action = ACTIONS[e.code];
    if (action) queue.push(action);
  };
  const onUp = (e: KeyboardEvent) => {
    // macOS sends no keyup for keys released while Cmd is down: clear them all.
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') held.clear();
    else held.delete(e.code);
  };
  // A key released while the window has no focus never sends keyup: clear all.
  const clear = () => {
    held.clear();
    itemTap = false;
  };
  const onVisibility = () => {
    if (target.document.visibilityState === 'hidden') clear();
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', clear);
  target.document.addEventListener('visibilitychange', onVisibility);

  return {
    read: () => {
      const item = any(ITEM) || itemTap;
      itemTap = false;
      return {
        throttle: any(THROTTLE) ? 1 : 0,
        brake: any(BRAKE) ? 1 : 0,
        steer: (any(LEFT) ? 1 : 0) - (any(RIGHT) ? 1 : 0),
        drift: any(DRIFT),
        item,
      };
    },
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

/** Anything that gives kart input and actions: the keyboard, the touch controls. */
export interface InputSource {
  read(): KartInput;
  takeActions(): Action[];
  dispose(): void;
}

/**
 * Merge input sources. steer: the largest magnitude wins. throttle and brake:
 * the max. drift and item: any source. Actions keep source order.
 */
export function createInput(sources: readonly InputSource[]): InputSource {
  return {
    read: () => {
      const out: KartInput = { throttle: 0, brake: 0, steer: 0, drift: false };
      for (const s of sources) {
        const i = s.read();
        if (Math.abs(i.steer) > Math.abs(out.steer)) out.steer = i.steer;
        out.throttle = Math.max(out.throttle, i.throttle);
        out.brake = Math.max(out.brake, i.brake);
        out.drift ||= i.drift;
        if (i.item) out.item = true;
      }
      return out;
    },
    takeActions: () => sources.flatMap((s) => s.takeActions()),
    dispose: () => {
      for (const s of sources) s.dispose();
    },
  };
}
