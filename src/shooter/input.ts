import type { Step } from '../logic/ops';
import type { ShiftInput } from './logic/shift';
import { PANEL_STEPS } from './logic/shift';
import { SHOOTER_TUNING } from './logic/tuning';

/**
 * One-shot actions for the menus and the pause. Each fires once per key
 * press. 'lock-lost' comes from the browser, not a key: the mouse lock ended
 * without the game asking. It only ever pauses, never resumes.
 */
export type ShooterAction = 'pause' | 'confirm' | 'up' | 'down' | 'left' | 'right' | 'lock-lost';

export interface ShooterInputOptions {
  /**
   * Called inside the keydown handler for each action. True: the action will
   * start play, so the lock is asked for now, while the key press still counts
   * as a user gesture (Safari refuses a lock asked for later, from a frame).
   */
  lockOnAction?(a: ShooterAction): boolean;
}

export interface ShooterInput {
  /** Held keys, the fire button, the view and the last pick. A pick is returned once. */
  read(): ShiftInput;
  /** Actions since the last call. The queue is then empty. */
  takeActions(): ShooterAction[];
  /** Ask for the pointer lock. A refusal is caught and ignored. */
  requestLock(): void;
  /** Give up the pointer lock on purpose: no pause is queued for it. */
  releaseLock(): void;
  locked(): boolean;
  setSensitivity(v: number): void;
  /** Set the view, for a new shift or a debug jump. */
  setView(yaw: number, pitch: number): void;
  /** The live view, between logic steps too, for the camera. */
  view(): { yaw: number; pitch: number };
  dispose(): void;
}

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const WORK = ['KeyE'];

const ACTIONS: Record<string, ShooterAction> = {
  KeyP: 'pause',
  Escape: 'pause',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** Digit1-9 and Numpad1-9 pick PANEL_STEPS[n - 1]. */
function stepForKey(code: string): Step | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (!m) return null;
  return PANEL_STEPS[Number(m[1]) - 1] ?? null;
}

const PREVENT = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...WORK, 'Space']);

/** An Esc keydown this soon (ms) after a lost lock is the Esc that released it. */
const ESC_AFTER_UNLOCK_MS = 250;

export function createShooterInput(
  win: Window,
  canvas: HTMLCanvasElement,
  options: ShooterInputOptions = {},
): ShooterInput {
  const doc = win.document;
  const held = new Set<string>();
  let queue: ShooterAction[] = [];
  let pick: Step | null = null;
  let yaw = 0;
  let pitch = 0;
  let sensitivity: number = SHOOTER_TUNING.mouseSensitivity;
  const pitchLimit = (SHOOTER_TUNING.pitchLimitDeg * Math.PI) / 180;
  let wasLocked = false;
  let releasing = false;
  let unlockedAt = -Infinity;
  /** The left button, pressed while locked. A press that asked for the lock never fires. */
  let firing = false;
  const any = (codes: readonly string[]) => codes.some((c) => held.has(c));
  const isLocked = () => doc.pointerLockElement === canvas;

  const clear = () => {
    held.clear();
    firing = false;
  };

  /** Ask for the lock. A refusal, thrown or rejected, is caught and logs nothing. */
  const requestLock = () => {
    if (isLocked()) return;
    try {
      // Chrome returns a promise; Safari returns undefined. Either may refuse.
      const r = canvas.requestPointerLock?.() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Refused: the shift goes on, and a click on the floor tries again.
    }
  };

  const onDown = (e: KeyboardEvent) => {
    if (PREVENT.has(e.code)) e.preventDefault();
    held.add(e.code);
    if (e.repeat) return;
    // A browser or system shortcut (Cmd+R, Ctrl+1) is not a game action.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step = stepForKey(e.code);
    if (step) {
      pick = step;
      return;
    }
    const action = ACTIONS[e.code];
    if (!action) return;
    if (
      e.code === 'Escape' &&
      (isLocked() || performance.now() - unlockedAt < ESC_AFTER_UNLOCK_MS)
    ) {
      // The lock change pauses; this Esc must not pause (or resume) again.
      return;
    }
    queue.push(action);
    if (options.lockOnAction?.(action)) requestLock();
  };
  const onUp = (e: KeyboardEvent) => {
    // macOS sends no keyup for keys released while Cmd is down: clear them all.
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') held.clear();
    else held.delete(e.code);
  };
  const onMouse = (e: MouseEvent) => {
    if (!isLocked()) return;
    yaw -= (e.movementX || 0) * sensitivity;
    pitch -= (e.movementY || 0) * sensitivity;
    pitch = Math.max(-pitchLimit, Math.min(pitchLimit, pitch));
  };
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && isLocked()) firing = true;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) firing = false;
  };
  const onLockChange = () => {
    const now = isLocked();
    if (wasLocked && !now) {
      unlockedAt = performance.now();
      clear();
      if (!releasing) queue.push('lock-lost');
    }
    if (!now) releasing = false;
    wasLocked = now;
  };
  // A refused lock also fires this; the game carries on without the lock.
  const onLockError = () => {
    releasing = false;
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') clear();
  };

  win.addEventListener('keydown', onDown);
  win.addEventListener('keyup', onUp);
  win.addEventListener('blur', clear);
  doc.addEventListener('mousemove', onMouse);
  doc.addEventListener('mousedown', onMouseDown);
  doc.addEventListener('mouseup', onMouseUp);
  doc.addEventListener('pointerlockchange', onLockChange);
  doc.addEventListener('pointerlockerror', onLockError);
  doc.addEventListener('visibilitychange', onVisibility);

  return {
    read() {
      const forward = (any(FORWARD) ? 1 : 0) - (any(BACK) ? 1 : 0);
      const strafe = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0);
      const out: ShiftInput = {
        move: { forward, strafe },
        yaw,
        pitch,
        work: any(WORK),
        pick,
        fire: firing && isLocked(),
      };
      pick = null;
      return out;
    },
    takeActions() {
      const out = queue;
      queue = [];
      return out;
    },
    requestLock,
    releaseLock() {
      if (!isLocked()) return;
      releasing = true;
      doc.exitPointerLock?.();
    },
    locked: isLocked,
    setSensitivity(v) {
      sensitivity = v;
    },
    setView(y, p) {
      yaw = y;
      pitch = Math.max(-pitchLimit, Math.min(pitchLimit, p));
    },
    view: () => ({ yaw, pitch }),
    dispose() {
      win.removeEventListener('keydown', onDown);
      win.removeEventListener('keyup', onUp);
      win.removeEventListener('blur', clear);
      doc.removeEventListener('mousemove', onMouse);
      doc.removeEventListener('mousedown', onMouseDown);
      doc.removeEventListener('mouseup', onMouseUp);
      doc.removeEventListener('pointerlockchange', onLockChange);
      doc.removeEventListener('pointerlockerror', onLockError);
      doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
