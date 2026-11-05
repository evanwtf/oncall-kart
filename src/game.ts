import { createKeyboard, type Action } from './input';
import { NO_INPUT } from './logic/kart';
import {
  createRace,
  respawn,
  stepRace,
  type LapCount,
  type Race,
  type RaceEvent,
} from './logic/race';
import { nextStep } from './logic/ticket';
import { buildTrack } from './logic/track';
import { HALL } from './logic/tracks/hall';
import { TUNING } from './logic/tuning';
import { DRIVERS } from './logic/drivers';
import { createScene } from './render/scene';
import { createUi, type Screen, type UiState } from './ui/screens';

export const LAP_CHOICES: readonly LapCount[] = [1, 3, 10];
export const PAUSE_ITEMS = ['Resume', 'Restart', 'Quit to setup'] as const;
/** Seconds the results wait after the player crosses the line. */
const FINISH_DELAY = 1.5;

export interface DebugHooks {
  version: string;
  phase(): string | null;
  screen(): Screen;
  playerSpeed(): number;
  playerLap(): number;
  playerTicket(): { number: number; title: string; next: string | null } | null;
  /** Draw calls and triangles in the last frame. */
  renderInfo(): { calls: number; triangles: number };
}

declare global {
  interface Window {
    __oncallKart?: DebugHooks;
  }
}

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function startGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void {
  const track = buildTrack(HALL);
  const fixedSeed = seedFromUrl();
  const newSeed = () => fixedSeed ?? Math.floor(Math.random() * 2 ** 31);
  const keyboard = createKeyboard(window);
  const ui = createUi(uiRoot);

  const state: UiState = {
    screen: 'title',
    setup: { lapIndex: 0, colorIndex: 0 },
    pauseIndex: 0,
    race: null,
  };
  // The title and setup screens show the hall behind them: a race that never starts.
  let race: Race = createRace({ laps: 1, seed: newSeed(), driverColor: 0 }, track);
  const scene = createScene(canvas, race);
  let acc = 0;
  let finishTimer = 0;
  let last = performance.now();

  const startRace = () => {
    race = createRace(
      {
        laps: LAP_CHOICES[state.setup.lapIndex] ?? 1,
        seed: newSeed(),
        driverColor: state.setup.colorIndex,
      },
      track,
    );
    scene.reset(race);
    state.race = race;
    state.screen = 'countdown';
    state.pauseIndex = 0;
    acc = 0;
    finishTimer = 0;
  };

  /** The screen a pause returns to. */
  let pausedFrom: Screen = 'racing';

  const toSetup = () => {
    state.screen = 'setup';
    state.race = null;
  };

  const handle = (a: Action) => {
    switch (state.screen) {
      case 'title':
        if (a === 'confirm') state.screen = 'setup';
        break;
      case 'setup': {
        const s = state.setup;
        if (a === 'left') s.lapIndex = (s.lapIndex + LAP_CHOICES.length - 1) % LAP_CHOICES.length;
        if (a === 'right') s.lapIndex = (s.lapIndex + 1) % LAP_CHOICES.length;
        if (a === 'up') s.colorIndex = (s.colorIndex + DRIVERS.length - 1) % DRIVERS.length;
        if (a === 'down') s.colorIndex = (s.colorIndex + 1) % DRIVERS.length;
        if (a === 'confirm') startRace();
        if (a === 'pause' || a === 'back') state.screen = 'title';
        break;
      }
      case 'countdown':
      case 'racing':
        if (a === 'pause') {
          pausedFrom = state.screen;
          state.screen = 'paused';
          state.pauseIndex = 0;
          break;
        }
        if (a === 'respawn' && state.screen === 'racing') {
          ui.onEvents(respawn(race, race.playerId), race);
        }
        break;
      case 'paused':
        if (a === 'pause') state.screen = pausedFrom;
        if (a === 'up')
          state.pauseIndex = (state.pauseIndex + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length;
        if (a === 'down') state.pauseIndex = (state.pauseIndex + 1) % PAUSE_ITEMS.length;
        if (a === 'back') state.screen = pausedFrom;
        if (a === 'confirm') {
          const item = PAUSE_ITEMS[state.pauseIndex];
          if (item === 'Resume') state.screen = pausedFrom;
          if (item === 'Restart') startRace();
          if (item === 'Quit to setup') toSetup();
        }
        break;
      case 'results':
        if (a === 'confirm') startRace();
        if (a === 'pause' || a === 'back') toSetup();
        break;
    }
  };

  const onEvents = (events: RaceEvent[]) => {
    if (events.length === 0) return;
    scene.onEvents(events);
    ui.onEvents(events, race);
    for (const e of events) {
      if (e.type === 'go' && state.screen === 'countdown') state.screen = 'racing';
    }
  };

  const onVisibility = () => {
    if (
      document.visibilityState === 'hidden' &&
      (state.screen === 'racing' || state.screen === 'countdown')
    ) {
      pausedFrom = state.screen;
      state.screen = 'paused';
      state.pauseIndex = 0;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const frame = (now: number) => {
    const dt = Math.min(TUNING.maxFrame, Math.max(0, (now - last) / 1000));
    last = now;

    for (const a of keyboard.takeActions()) handle(a);

    if (state.screen === 'countdown' || state.screen === 'racing') {
      acc += dt;
      const input = state.screen === 'racing' ? keyboard.read() : NO_INPUT;
      while (acc >= TUNING.step) {
        scene.capture(race);
        onEvents(stepRace(race, [input], TUNING.step));
        acc -= TUNING.step;
      }
      if (race.phase === 'finished') {
        finishTimer += dt;
        if (finishTimer >= FINISH_DELAY) state.screen = 'results';
      }
    }

    scene.render(race, state.screen === 'paused' ? 1 : acc / TUNING.step);
    ui.render(state);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const player = () => race.karts[race.playerId];
  window.__oncallKart = {
    version: __APP_VERSION__,
    phase: () => (state.race ? race.phase : null),
    screen: () => state.screen,
    playerSpeed: () => player()?.kart.speed ?? 0,
    playerLap: () => player()?.lap.completed ?? 0,
    playerTicket: () => {
      const t = player()?.ticket;
      return t ? { number: t.number, title: t.type.title, next: nextStep(t) } : null;
    },
    renderInfo: () => ({
      calls: scene.renderer.info.render.calls,
      triangles: scene.renderer.info.render.triangles,
    }),
  };
}
