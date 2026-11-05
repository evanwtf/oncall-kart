import type { Action } from '../input';
import { DRIVERS } from '../logic/drivers';
import type { Race, RaceEvent } from '../logic/race';
import { createHud, formatTime } from './hud';

export type Screen = 'title' | 'setup' | 'countdown' | 'racing' | 'paused' | 'results';

export interface SetupState {
  lapIndex: number;
  colorIndex: number;
}

export interface UiState {
  screen: Screen;
  setup: SetupState;
  pauseIndex: number;
  race: Race | null;
  /** The touch controls are on: show tap prompts and the touch-only pause items. */
  touch: boolean;
  autoGas: boolean;
}

/** What a tap or a click on a menu asks the game to do. */
export interface UiHandlers {
  action(a: Action): void;
  selectLap(i: number): void;
  selectDriver(i: number): void;
  selectPause(i: number): void;
}

export interface Ui {
  render(state: UiState): void;
  onEvents(events: RaceEvent[], race: Race): void;
  dispose(): void;
}

export const LAP_LABELS = ['1', '3', '10'] as const;
export type PauseItem = 'Resume' | 'Restart' | 'Respawn' | 'Auto-gas' | 'Quit to setup';
const ALL_PAUSE_ITEMS: readonly PauseItem[] = [
  'Resume',
  'Restart',
  'Respawn',
  'Auto-gas',
  'Quit to setup',
];
/** Touch has no R key and needs the auto-gas switch: those items are touch-only. */
const TOUCH_ONLY: ReadonlySet<PauseItem> = new Set(['Respawn', 'Auto-gas']);

/** The pause menu, in order. */
export function pauseItems(touch: boolean): PauseItem[] {
  return ALL_PAUSE_ITEMS.filter((i) => touch || !TOUCH_ONLY.has(i));
}

const pauseText = (item: PauseItem, autoGas: boolean) =>
  item === 'Auto-gas' ? `Auto-gas: ${autoGas ? 'On' : 'Off'}` : item;

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** One line for the shift report. */
export function shiftCaption(s: {
  ticketsClosed: number;
  wrongGates: number;
  slaBreaches: number;
}): string {
  if (s.slaBreaches >= 3) return 'Paged all shift. The postmortem writes itself.';
  if (s.slaBreaches > 0) return 'Paged at least once. Add it to the handover notes.';
  if (s.wrongGates >= 5) return 'The change board would like a word.';
  if (s.ticketsClosed >= 4) return 'Queue cleared. Take the rest of the day off.';
  if (s.ticketsClosed === 0) return 'No tickets closed. At least nothing broke. Probably.';
  if (s.wrongGates === 0) return 'By the book. Every step in order.';
  return 'Solid shift. Hand over and log off.';
}

/** A click or a tap runs fn. The button gives up focus, so Enter and Space stay with the keyboard handler. */
function onTap(e: HTMLElement, fn: () => void): void {
  e.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    e.blur();
    fn();
  });
}

function button(cls: string, text: string | undefined, parent: HTMLElement): HTMLButtonElement {
  const b = el('button', cls, text, parent);
  b.type = 'button';
  // Out of the tab order: the arrow keys drive the menus, and a focused button
  // would also act on Enter, doubling the keyboard's confirm.
  b.tabIndex = -1;
  // A press dragged off the button gives no click, and must not leave it focused either.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  return b;
}

export function createUi(root: HTMLElement, handlers: UiHandlers): Ui {
  const panels = el('div', 'screens', undefined, root);
  let current: UiState | null = null;

  // Title.
  const title = el('div', 'screen title', undefined, panels);
  el('h1', 'logo', 'oncall-kart', title);
  el('p', 'tagline', 'The race is the queue.', title);
  el('p', 'prompt no-touch', 'Press Enter', title);
  el('p', 'prompt only-touch', 'Tap to start', title);
  el('p', 'hint', 'Close tickets: drive through the gates in runbook order.', title);
  el('p', 'hint no-touch', '↑ drive · ← → steer · Space drift · R respawn · P pause', title);
  el('p', 'hint only-touch', 'Left thumb steers · DRIFT and BRAKE on the right', title);
  el('p', 'version', `v${__APP_VERSION__}`, title);
  onTap(title, () => handlers.action('confirm'));

  // Setup.
  const setup = el('div', 'screen setup', undefined, panels);
  el('h2', '', 'Shift setup', setup);
  el('div', 'label', 'Laps', setup);
  const lapRow = el('div', 'laps', undefined, setup);
  const lapEls = LAP_LABELS.map((l, i) => {
    const b = button('chip', l, lapRow);
    onTap(b, () => handlers.selectLap(i));
    return b;
  });
  el('div', 'label', 'On call', setup);
  const driverList = el('div', 'drivers', undefined, setup);
  const driverEls = DRIVERS.map((d, i) => {
    const b = button('driver', undefined, driverList);
    const sw = el('span', 'swatch', undefined, b);
    sw.style.background = hex(d.color);
    el('span', 'name', d.name, b);
    onTap(b, () => handlers.selectDriver(i));
    return b;
  });
  const setupActions = el('div', 'actions', undefined, setup);
  onTap(button('action', 'Back', setupActions), () => handlers.action('back'));
  onTap(button('action primary', 'Start', setupActions), () => handlers.action('confirm'));
  el('p', 'hint no-touch', '← → laps · ↑ ↓ driver · Enter to start · Esc to go back', setup);

  // Countdown.
  const countdown = el('div', 'countdown', undefined, panels);

  // Pause.
  const pause = el('div', 'screen pause', undefined, panels);
  const pauseMenu = el('div', 'menu', undefined, pause);
  el('h2', '', 'Paused', pauseMenu);
  const pauseEls = new Map<PauseItem, HTMLButtonElement>(
    ALL_PAUSE_ITEMS.map((item) => {
      const b = button('menu-item', item, pauseMenu);
      onTap(b, () => {
        const items = pauseItems(current?.touch ?? false);
        const i = items.indexOf(item);
        if (i < 0 || !current) return;
        // Tap an item to select it; tap the selected item to confirm it.
        if (i === current.pauseIndex) handlers.action('confirm');
        else handlers.selectPause(i);
      });
      return [item, b] as const;
    }),
  );
  el('p', 'hint no-touch', '↑ ↓ and Enter · P or Esc resumes', pause);

  // Results.
  const results = el('div', 'screen results', undefined, panels);
  el('h2', '', 'Shift report', results);
  const table = el('dl', 'report', undefined, results);
  const row = (label: string) => {
    el('dt', '', label, table);
    return el('dd', '', '', table);
  };
  const rows = {
    time: row('Finish time'),
    best: row('Best lap'),
    closed: row('Tickets closed'),
    wrong: row('Wrong gates'),
    breaches: row('SLA breaches'),
  };
  const caption = el('p', 'caption', '', results);
  const resultActions = el('div', 'actions', undefined, results);
  onTap(button('action', 'Setup', resultActions), () => handlers.action('back'));
  onTap(button('action primary', 'Race again', resultActions), () => handlers.action('confirm'));
  el('p', 'hint no-touch', 'Enter to race again · Esc for setup', results);

  // Portrait hint, for touch only (CSS shows it in portrait). Dismissed for the page.
  const rotate = el('div', 'rotate-hint', undefined, root);
  el('span', '', 'Turn your screen sideways for the best view', rotate);
  const rotateClose = button('rotate-close', '✕', rotate);
  rotateClose.setAttribute('aria-label', 'Dismiss');
  onTap(rotateClose, () => {
    rotate.hidden = true;
  });

  const hud = createHud(root);
  let lastScreen: Screen | null = null;
  let lastRace: Race | null = null;

  const show = (screen: Screen) => {
    title.hidden = screen !== 'title';
    setup.hidden = screen !== 'setup';
    pause.hidden = screen !== 'paused';
    results.hidden = screen !== 'results';
    countdown.hidden = screen !== 'countdown' && screen !== 'racing';
    hud.el.hidden = !(screen === 'countdown' || screen === 'racing' || screen === 'paused');
  };

  return {
    render(state) {
      current = state;
      root.classList.toggle('touch-on', state.touch);
      if (state.screen !== lastScreen) {
        show(state.screen);
        lastScreen = state.screen;
      }
      const race = state.race;
      if (race !== lastRace) {
        hud.clear();
        lastRace = race;
      }
      root.dataset.screen = state.screen;

      if (state.screen === 'setup') {
        lapEls.forEach((e, i) => e.classList.toggle('selected', i === state.setup.lapIndex));
        driverEls.forEach((e, i) => e.classList.toggle('selected', i === state.setup.colorIndex));
      }
      if (state.screen === 'paused') {
        const items = pauseItems(state.touch);
        for (const [item, e] of pauseEls) {
          const i = items.indexOf(item);
          e.hidden = i < 0;
          e.classList.toggle('selected', i === state.pauseIndex);
          const text = pauseText(item, state.autoGas);
          if (e.textContent !== text) e.textContent = text;
        }
      }
      if (race && !hud.el.hidden) hud.update(race);

      if (race && (state.screen === 'countdown' || state.screen === 'racing')) {
        const text =
          race.phase === 'countdown'
            ? String(Math.ceil(race.countdown))
            : race.time < 0.8
              ? 'GO'
              : '';
        if (countdown.textContent !== text) countdown.textContent = text;
      }

      if (race && state.screen === 'results') {
        const k = race.karts[race.playerId];
        if (k) {
          rows.time.textContent = formatTime(k.finishedAt ?? race.time);
          rows.best.textContent = k.lap.bestLap === null ? '-' : formatTime(k.lap.bestLap);
          rows.closed.textContent = String(k.stats.ticketsClosed);
          rows.wrong.textContent = String(k.stats.wrongGates);
          rows.breaches.textContent = String(k.stats.slaBreaches);
          caption.textContent = shiftCaption(k.stats);
        }
      }
    },
    onEvents(events, race) {
      hud.onEvents(events, race);
    },
    dispose() {
      panels.remove();
      hud.el.remove();
      rotate.remove();
    },
  };
}

/** The "oncall-kart needs WebGL 2" screen. */
export function showNoWebGl(root: HTMLElement): void {
  const box = el('div', 'screen no-webgl', undefined, root);
  el('h1', 'logo', 'oncall-kart', box);
  el('p', '', 'oncall-kart needs WebGL 2. Try current Chrome or Safari.', box);
}
