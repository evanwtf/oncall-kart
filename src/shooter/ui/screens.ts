import type { Ending, Shift } from '../logic/shift';
import { SHOOTER_TUNING } from '../logic/tuning';

export type ShooterScreen = 'briefing' | 'playing' | 'paused' | 'ended';

export const PAUSE_ITEMS = [
  'Resume',
  'Restart shift',
  'Mouse sensitivity',
  'Back to start screen',
] as const;
export type PauseItem = (typeof PAUSE_ITEMS)[number];

export const END_ITEMS = ['Play again', 'Start screen'] as const;
export type EndItem = (typeof END_ITEMS)[number];

/** Mouse sensitivity steps, as a multiple of SHOOTER_TUNING.mouseSensitivity. */
export const SENSITIVITY_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;

export const ENDINGS: Record<Ending, { title: string; line: string }> = {
  clean: {
    title: 'Clean shift',
    line: 'Zero down. Every patch in, every server up. Nobody will ever know how hard that was.',
  },
  rough: {
    title: 'Rough shift',
    line: 'The patches are in, but servers are still down. Write a long handover note.',
  },
  fired: {
    title: 'Fired',
    line: 'A patch was missed. Security has your badge. Security also has your stapler.',
  },
};

export interface ScreensState {
  screen: ShooterScreen;
  shift: Shift;
  pauseIndex: number;
  endIndex: number;
  sensitivityIndex: number;
  /** The mouse is locked to the game. */
  locked: boolean;
}

export interface ScreensHandlers {
  start(): void;
  pauseItem(item: PauseItem): void;
  endItem(item: EndItem): void;
  /** -1 or +1 on the sensitivity steps. */
  sensitivity(delta: number): void;
  toStartScreen(): void;
}

export interface ShooterScreens {
  render(state: ScreensState): void;
  dispose(): void;
}

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

/** A menu button: out of the tab order (the arrows drive the menus), and a click never leaves it focused. */
function button(cls: string, text: string, parent: HTMLElement, fn: () => void): HTMLButtonElement {
  const b = el('button', cls, text, parent);
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    b.blur();
    fn();
  });
  return b;
}

/** Write text only when it changes: a same-value write still churns the DOM. */
function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

function setHidden(e: HTMLElement, hidden: boolean): void {
  if (e.hidden !== hidden) e.hidden = hidden;
}

function setSelected(e: HTMLElement, on: boolean): void {
  if (e.classList.contains('selected') !== on) e.classList.toggle('selected', on);
}

const CONTROLS: readonly [string, string][] = [
  ['W A S D / arrows', 'Move and strafe'],
  ['Mouse', 'Look'],
  ['1-9', 'Pick a step at a broken rack'],
  ['E (hold)', 'Work: a runbook step or a patch'],
  ['P / Esc', 'Pause'],
];

export function sensitivityText(index: number): string {
  const v = SENSITIVITY_STEPS[index] ?? 1;
  return `Mouse sensitivity: ${v.toFixed(2)}×`;
}

export function createShooterScreens(root: HTMLElement, h: ScreensHandlers): ShooterScreens {
  const panels = el('div', 'zd-screens', undefined, root);

  // Briefing.
  const briefing = el('div', 'screen zd-briefing', undefined, panels);
  el('h1', 'logo zd-logo', 'Zero Down', briefing);
  el(
    'p',
    'tagline',
    `Your shift: ${Math.round(SHOOTER_TUNING.shiftSeconds / 60)} minutes. Servers will break. Fix them. Apply every patch, or you are fired.`,
    briefing,
  );
  const cols = el('div', 'zd-brief-cols', undefined, briefing);
  const patchCol = el('div', 'zd-brief-col', undefined, cols);
  el('h2', '', 'Patches due this shift', patchCol);
  const briefPatches = el('ul', 'zd-brief-patches', undefined, patchCol);
  const controlCol = el('div', 'zd-brief-col', undefined, cols);
  el('h2', '', 'Controls', controlCol);
  const table = el('table', 'zd-controls', undefined, controlCol);
  for (const [key, what] of CONTROLS) {
    const tr = el('tr', '', undefined, table);
    el('th', '', key, tr);
    el('td', '', what, tr);
  }
  const briefActions = el('div', 'actions', undefined, briefing);
  button('action', 'Start screen', briefActions, () => h.toStartScreen());
  button('action primary', 'Click to start', briefActions, () => h.start());
  el(
    'p',
    'hint',
    'Click or press Enter to start. The game takes the mouse; Esc gives it back.',
    briefing,
  );
  el('p', 'version', `v${__APP_VERSION__}`, briefing);
  // A click anywhere on the briefing starts too: the click lets the game lock the mouse.
  briefing.addEventListener('click', () => h.start());

  // Playing, without the mouse: a hint to click.
  const lockHint = el('div', 'zd-lock-hint', 'Click to look around', panels);

  // Pause.
  const pause = el('div', 'screen zd-pause', undefined, panels);
  const menu = el('div', 'menu', undefined, pause);
  el('h2', '', 'Paused', menu);
  const pauseEls = PAUSE_ITEMS.map((item) => {
    if (item !== 'Mouse sensitivity') {
      return { item, b: button('menu-item', item, menu, () => h.pauseItem(item)), label: null };
    }
    const row = el('div', 'menu-item zd-sens', undefined, menu);
    button('zd-sens-btn', '−', row, () => h.sensitivity(-1));
    const label = el('span', 'zd-sens-label', sensitivityText(3), row);
    button('zd-sens-btn', '+', row, () => h.sensitivity(1));
    return { item, b: row, label };
  });
  el('p', 'hint', '↑ ↓ and Enter · ← → sensitivity · P resumes', pause);

  // Ended.
  const ended = el('div', 'screen zd-ended', undefined, panels);
  const endTitle = el('h1', 'logo zd-end-title', '', ended);
  const endLine = el('p', 'tagline', '', ended);
  el('h2', '', 'Shift report', ended);
  const report = el('dl', 'report zd-report', undefined, ended);
  const row = (label: string) => {
    el('dt', '', label, report);
    return el('dd', '', '', report);
  };
  const rows = {
    closed: row('Tickets closed'),
    breaches: row('SLA breaches'),
    wrong: row('Wrong steps'),
    patches: row('Patches applied'),
  };
  const endPatches = el('ul', 'zd-end-patches', undefined, ended);
  const endActions = el('div', 'actions', undefined, ended);
  const endEls = END_ITEMS.map((item) =>
    button(item === 'Play again' ? 'action primary' : 'action', item, endActions, () =>
      h.endItem(item),
    ),
  );
  el('p', 'hint', '← → and Enter', ended);

  let lastScreen: ShooterScreen | null = null;
  let lastShift: Shift | null = null;

  return {
    render(state) {
      const { screen, shift } = state;
      if (root.dataset.screen !== screen) root.dataset.screen = screen;
      if (screen !== lastScreen) {
        setHidden(briefing, screen !== 'briefing');
        setHidden(pause, screen !== 'paused');
        setHidden(ended, screen !== 'ended');
        lastScreen = screen;
      }
      setHidden(lockHint, !(screen === 'playing' && !state.locked));
      if (screen === 'briefing' && shift !== lastShift) {
        lastShift = shift;
        briefPatches.replaceChildren(
          ...shift.patches.map((p) => {
            const li = el('li', 'zd-brief-patch');
            el('span', 'zd-patch-name', p.name, li);
            el('span', 'zd-patch-id', p.id, li);
            const t =
              shift.floor.devices.find((d) => d.id === p.targetId) ??
              shift.floor.racks.find((r) => r.id === p.targetId);
            el('span', 'zd-patch-target', `${t?.kind ?? 'device'} ${p.targetId}`, li);
            return li;
          }),
        );
      }
      if (screen === 'paused') {
        pauseEls.forEach(({ b, label }, i) => {
          setSelected(b, i === state.pauseIndex);
          if (label) setText(label, sensitivityText(state.sensitivityIndex));
        });
      }
      if (screen === 'ended') {
        const ending = shift.ended ?? 'fired';
        setText(endTitle, ENDINGS[ending].title);
        if (endTitle.dataset.ending !== ending) endTitle.dataset.ending = ending;
        setText(endLine, ENDINGS[ending].line);
        setText(rows.closed, String(shift.stats.ticketsClosed));
        setText(rows.breaches, String(shift.stats.slaBreaches));
        setText(rows.wrong, String(shift.stats.wrongSteps));
        const applied = shift.patches.filter((p) => p.applied).length;
        setText(rows.patches, `${applied} / ${shift.patches.length}`);
        const key = shift.patches.map((p) => `${p.id}:${p.applied}`).join('|');
        if (endPatches.dataset.key !== key) {
          endPatches.dataset.key = key;
          endPatches.replaceChildren(
            ...shift.patches.map((p) =>
              el(
                'li',
                p.applied ? 'applied' : 'missed',
                `${p.applied ? '✔' : '✘'} ${p.name} (${p.id}) on ${p.targetId}`,
              ),
            ),
          );
        }
        endEls.forEach((b, i) => setSelected(b, i === state.endIndex));
      }
    },
    dispose() {
      panels.remove();
    },
  };
}
