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
}

export interface Ui {
  render(state: UiState): void;
  onEvents(events: RaceEvent[], race: Race): void;
  dispose(): void;
}

export const LAP_LABELS = ['1', '3', '10'] as const;
export const PAUSE_LABELS = ['Resume', 'Restart', 'Quit to setup'] as const;

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

export function createUi(root: HTMLElement): Ui {
  const panels = el('div', 'screens', undefined, root);

  // Title.
  const title = el('div', 'screen title', undefined, panels);
  el('h1', 'logo', 'oncall-kart', title);
  el('p', 'tagline', 'The race is the queue.', title);
  el('p', 'prompt', 'Press Enter', title);
  el('p', 'hint', 'Close tickets: drive through the gates in runbook order.', title);
  el('p', 'hint', '↑ drive · ← → steer · Space drift · R respawn · P pause', title);
  el('p', 'version', `v${__APP_VERSION__}`, title);

  // Setup.
  const setup = el('div', 'screen setup', undefined, panels);
  el('h2', '', 'Shift setup', setup);
  el('div', 'label', 'Laps  ← →', setup);
  const lapRow = el('div', 'laps', undefined, setup);
  const lapEls = LAP_LABELS.map((l) => el('span', 'chip', l, lapRow));
  el('div', 'label', 'On call  ↑ ↓', setup);
  const driverList = el('ul', 'drivers', undefined, setup);
  const driverEls = DRIVERS.map((d) => {
    const li = el('li', 'driver', undefined, driverList);
    const sw = el('span', 'swatch', undefined, li);
    sw.style.background = hex(d.color);
    el('span', 'name', d.name, li);
    return li;
  });
  el('p', 'hint', 'Enter to start · Esc to go back', setup);

  // Countdown.
  const countdown = el('div', 'countdown', undefined, panels);

  // Pause.
  const pause = el('div', 'screen pause', undefined, panels);
  el('h2', '', 'Paused', pause);
  const pauseEls = PAUSE_LABELS.map((l) => el('div', 'menu-item', l, pause));
  el('p', 'hint', '↑ ↓ and Enter · P or Esc resumes', pause);

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
  el('p', 'hint', 'Enter to race again · Esc for setup', results);

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
        pauseEls.forEach((e, i) => e.classList.toggle('selected', i === state.pauseIndex));
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
    },
  };
}

/** The "oncall-kart needs WebGL 2" screen. */
export function showNoWebGl(root: HTMLElement): void {
  const box = el('div', 'screen no-webgl', undefined, root);
  el('h1', 'logo', 'oncall-kart', box);
  el('p', '', 'oncall-kart needs WebGL 2. Try current Chrome or Safari.', box);
}
