import type { Action } from './input';
import { NO_INPUT, type KartInput } from './logic/kart';

/** Drag distance, in CSS px, that steers nothing. */
export const DEAD_ZONE_PX = 8;
/** Drag distance, in CSS px, for full lock. */
export const FULL_LOCK_PX = 70;

/**
 * Horizontal drag on the pad to steer in [-1, 1]. A drag to the right gives a
 * negative value (steer right), the same sign as the keyboard.
 */
export function steerFromDrag(
  dxPx: number,
  deadZonePx = DEAD_ZONE_PX,
  fullPx = FULL_LOCK_PX,
): number {
  const mag = Math.abs(dxPx);
  if (mag <= deadZonePx) return 0;
  const share = Math.min(1, (mag - deadZonePx) / Math.max(1e-6, fullPx - deadZonePx));
  return dxPx > 0 ? -share : share;
}

const AUTO_GAS_KEY = 'oncall-kart.autoGas';

/** The saved auto-gas choice. On when nothing is saved or storage is blocked. */
export function loadAutoGas(): boolean {
  try {
    return window.localStorage.getItem(AUTO_GAS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveAutoGas(on: boolean): void {
  try {
    window.localStorage.setItem(AUTO_GAS_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

export interface TouchControls {
  /** The control layer. Hidden until setVisible(true). */
  readonly el: HTMLElement;
  /** Held controls as kart input. No input while hidden. */
  read(): KartInput;
  /** Actions since the last call. The queue is then empty. */
  takeActions(): Action[];
  setAutoGas(on: boolean): void;
  /** Show or hide the layer. Hiding releases every held control. */
  setVisible(on: boolean): void;
  dispose(): void;
}

type Hold = 'drift' | 'brake' | 'gas';

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** Capture the pointer, so its moves and its release reach the control. */
function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture?.(id);
  } catch {
    // A synthetic or already-released pointer cannot be captured.
  }
}

/**
 * On-screen controls: a steering pad on the left half, hold buttons on the
 * right, and a pause button at the top right. Each pointer is tracked by its
 * pointerId, so steering and drift work at the same time.
 */
export function createTouch(root: HTMLElement): TouchControls {
  const el = make('div', 'touch', root);
  el.hidden = true;

  const pad = make('div', 'touch-pad', el);
  const ring = make('div', 'touch-ring', pad);
  const knob = make('div', 'touch-knob', ring);

  const buttons = make('div', 'touch-buttons', el);
  const holdEls: Record<Hold, HTMLElement> = {
    gas: make('div', 'touch-btn touch-gas', buttons, 'GAS'),
    brake: make('div', 'touch-btn touch-brake', buttons, 'BRAKE'),
    drift: make('div', 'touch-btn touch-drift', buttons, 'DRIFT'),
  };
  const pauseEl = make('div', 'touch-pause', el, 'II');
  pauseEl.setAttribute('aria-label', 'Pause');
  pauseEl.setAttribute('role', 'button');

  let visible = false;
  let autoGas = true;
  let queue: Action[] = [];
  let padId: number | null = null;
  let padX = 0;
  let padY = 0;
  let steer = 0;
  const held: Record<Hold, Set<number>> = { drift: new Set(), brake: new Set(), gas: new Set() };

  const drawKnob = (dx: number) => {
    const shown = Math.max(-FULL_LOCK_PX, Math.min(FULL_LOCK_PX, dx));
    knob.style.transform = `translate(${shown.toFixed(0)}px, 0)`;
  };

  const releasePad = () => {
    padId = null;
    steer = 0;
    pad.classList.remove('active');
    ring.style.removeProperty('left');
    ring.style.removeProperty('top');
    drawKnob(0);
  };

  const refresh = () => {
    for (const k of Object.keys(holdEls) as Hold[])
      holdEls[k].classList.toggle('active', held[k].size > 0);
  };

  const releaseAll = () => {
    releasePad();
    for (const s of Object.values(held)) s.clear();
    refresh();
  };

  const release = (id: number) => {
    if (id === padId) releasePad();
    for (const s of Object.values(held)) s.delete(id);
    refresh();
  };

  const onPadDown = (e: PointerEvent) => {
    e.preventDefault();
    if (padId !== null) return;
    padId = e.pointerId;
    padX = e.clientX;
    padY = e.clientY;
    steer = 0;
    capture(pad, e.pointerId);
    pad.classList.add('active');
    const box = pad.getBoundingClientRect();
    ring.style.left = `${(padX - box.left).toFixed(0)}px`;
    ring.style.top = `${(padY - box.top).toFixed(0)}px`;
    drawKnob(0);
  };

  const holdDown = (k: Hold) => (e: PointerEvent) => {
    e.preventDefault();
    held[k].add(e.pointerId);
    capture(holdEls[k], e.pointerId);
    refresh();
  };
  const holdHandlers = (Object.keys(holdEls) as Hold[]).map((k) => {
    const h = holdDown(k);
    holdEls[k].addEventListener('pointerdown', h);
    return [k, h] as const;
  });

  const onPauseDown = (e: PointerEvent) => {
    e.preventDefault();
    capture(pauseEl, e.pointerId);
    if (visible) queue.push('pause');
  };

  // Moves and releases are read on the window: a capture that fails (or a
  // browser that ignores it) still ends the touch on the control that began it.
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== padId) return;
    const dx = e.clientX - padX;
    steer = steerFromDrag(dx);
    drawKnob(dx);
  };
  const onEnd = (e: PointerEvent) => release(e.pointerId);
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') releaseAll();
  };

  pad.addEventListener('pointerdown', onPadDown);
  pauseEl.addEventListener('pointerdown', onPauseDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
  // lostpointercapture does not bubble: listen in the capture phase.
  window.addEventListener('lostpointercapture', onEnd, true);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onVisibility);
  // No context menu or callout on a long press.
  const noMenu = (e: Event) => e.preventDefault();
  el.addEventListener('contextmenu', noMenu);

  const setAutoGas = (on: boolean) => {
    autoGas = on;
    holdEls.gas.hidden = on;
    if (on) held.gas.clear();
    refresh();
  };
  setAutoGas(true);

  return {
    el,
    read: () => {
      if (!visible) return NO_INPUT;
      const brake = held.brake.size > 0;
      const gas = autoGas ? !brake : held.gas.size > 0;
      return {
        throttle: gas ? 1 : 0,
        brake: brake ? 1 : 0,
        steer,
        drift: held.drift.size > 0,
      };
    },
    takeActions: () => {
      const out = queue;
      queue = [];
      return out;
    },
    setAutoGas,
    setVisible: (on) => {
      if (on === visible) return;
      visible = on;
      el.hidden = !on;
      releaseAll();
      queue = [];
    },
    dispose: () => {
      pad.removeEventListener('pointerdown', onPadDown);
      pauseEl.removeEventListener('pointerdown', onPauseDown);
      for (const [k, h] of holdHandlers) holdEls[k].removeEventListener('pointerdown', h);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('lostpointercapture', onEnd, true);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      el.removeEventListener('contextmenu', noMenu);
      visible = false;
      releaseAll();
      queue = [];
      el.remove();
    },
  };
}
