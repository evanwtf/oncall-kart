import type { Race, RaceEvent } from '../logic/race';

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

/** Placeholder overlay (phase 1, Task 6): the screen name and the version. */
export function createUi(root: HTMLElement): Ui {
  const el = document.createElement('div');
  el.className = 'status';
  root.appendChild(el);
  return {
    render(state) {
      el.textContent = `oncall-kart v${__APP_VERSION__} · ${state.screen}`;
    },
    onEvents() {},
    dispose() {
      el.remove();
    },
  };
}

/** The "oncall-kart needs WebGL 2" screen. */
export function showNoWebGl(root: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'screen no-webgl';
  const h = document.createElement('h1');
  h.textContent = 'oncall-kart';
  const p = document.createElement('p');
  p.textContent = 'oncall-kart needs WebGL 2. Try current Chrome or Safari.';
  box.append(h, p);
  root.appendChild(box);
}
