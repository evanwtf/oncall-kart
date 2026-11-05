import { createInput, createKeyboard, isDriveKey, type Action } from './input';
import { botInput } from './logic/bot';
import type { ItemKind } from './logic/items';
import { NO_INPUT, spawnKart } from './logic/kart';
import {
  createRace,
  respawn,
  standings,
  stepRace,
  type LapCount,
  type Race,
  type RaceEvent,
} from './logic/race';
import { nextStep } from './logic/ticket';
import type { TicketType } from './logic/runbooks';
import { buildTrack } from './logic/track';
import { HALL } from './logic/tracks/hall';
import { TUNING } from './logic/tuning';
import { DRIVERS } from './logic/drivers';
import { createScene } from './render/scene';
import { createTouch, loadAutoGas, saveAutoGas } from './touchInput';
import { createUi, pauseItems, type Screen, type UiState } from './ui/screens';

export const LAP_CHOICES: readonly LapCount[] = [1, 3, 10];
/** Bot rivals in every race: with the player, 8 karts. */
const BOTS = 7;
/**
 * Longest frame the loop catches up on, in fixed steps. Longer than
 * TUNING.maxFrame so a slow machine (software GL at 4-10 fps) still runs the race
 * in real time; each step is still 1/120 s, so nothing tunnels.
 */
const MAX_CATCH_UP = 0.25;
/** Seconds the results wait after the player crosses the line. */
const FINISH_DELAY = 1.5;

export interface DebugHooks {
  version: string;
  phase(): string | null;
  screen(): Screen;
  playerSpeed(): number;
  /** Player heading in radians. */
  playerHeading(): number;
  /** The on-screen touch controls are showing. */
  touchControls(): boolean;
  playerLap(): number;
  playerTicket(): { number: number; title: string; next: string | null } | null;
  /** Race clock in seconds. */
  raceTime(): number;
  /** Draw calls and triangles in the last frame; live geometries and textures. */
  renderInfo(): { calls: number; triangles: number; geometries: number; textures: number };
  /** Gate row positions (s, metres). */
  rowS(): number[];
  /** Karts in the race. */
  kartCount(): number;
  /** The player's race place, 1 to kartCount(). */
  place(): number;
  /** Only with ?debug=1: give the player an item (replacing any held item). */
  giveItem?(item: ItemKind): void;
  /** Only with ?debug=1: the bot driver drives the player kart, for screenshots and tests. */
  autopilot?(on: boolean): void;
  /** Only with ?debug=1: put the player at s on the centerline, at rest. */
  placePlayer?(s: number): void;
  /** Only with ?debug=1: give the player a ticket of this type, at this step. */
  setTicket?(type: TicketType, stepIndex: number): void;
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
  const touch = createTouch(uiRoot);
  const input = createInput([keyboard, touch]);
  // A phone or a tablet: lighter rendering, touch controls from the start.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

  const state: UiState = {
    screen: 'title',
    setup: { lapIndex: 0, colorIndex: 0 },
    pauseIndex: 0,
    race: null,
    touch: coarse,
    autoGas: loadAutoGas(),
  };
  touch.setAutoGas(state.autoGas);
  // The last device used wins. A touch shows the controls (a touchscreen laptop
  // reports a fine pointer). A driving key hides them, which also stops
  // auto-gas, so the keyboard brake works on a tablet with a keyboard.
  const setTouch = (on: boolean) => {
    if (state.touch === on) return;
    state.touch = on;
    touch.setVisible(on && (state.screen === 'countdown' || state.screen === 'racing'));
    state.pauseIndex = Math.min(state.pauseIndex, pauseItems(on).length - 1);
  };
  window.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (e.pointerType === 'touch') setTouch(true);
    },
    true,
  );
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (isDriveKey(e.code)) setTouch(false);
  });
  // iOS: no pinch zoom, no double-tap zoom, no page scroll during play.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  // The title and setup screens show the hall behind them: a race that never starts.
  let race: Race = createRace({ laps: 1, seed: newSeed(), driverColor: 0, bots: BOTS }, track);
  const scene = createScene(canvas, race, { lowPower: coarse });
  let acc = 0;
  let finishTimer = 0;
  let autopilot = false;
  let last = performance.now();

  const startRace = () => {
    race = createRace(
      {
        laps: LAP_CHOICES[state.setup.lapIndex] ?? 1,
        seed: newSeed(),
        driverColor: state.setup.colorIndex,
        bots: BOTS,
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

  const resume = () => {
    state.screen = pausedFrom;
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
      case 'paused': {
        const items = pauseItems(state.touch);
        // The item list changes length when the player switches device.
        state.pauseIndex = Math.min(state.pauseIndex, items.length - 1);
        if (a === 'pause' || a === 'back') resume();
        if (a === 'up') state.pauseIndex = (state.pauseIndex + items.length - 1) % items.length;
        if (a === 'down') state.pauseIndex = (state.pauseIndex + 1) % items.length;
        if (a === 'confirm') {
          const item = items[state.pauseIndex];
          if (item === 'Resume') resume();
          if (item === 'Restart') startRace();
          if (item === 'Respawn') {
            // A respawn in the countdown would do nothing: it only resumes.
            if (pausedFrom === 'racing') ui.onEvents(respawn(race, race.playerId), race);
            resume();
          }
          if (item === 'Auto-gas') {
            state.autoGas = !state.autoGas;
            touch.setAutoGas(state.autoGas);
            saveAutoGas(state.autoGas);
          }
          if (item === 'Quit to setup') toSetup();
        }
        break;
      }
      case 'results':
        if (a === 'confirm') startRace();
        if (a === 'pause' || a === 'back') toSetup();
        break;
    }
  };

  const ui = createUi(uiRoot, {
    action: handle,
    selectLap: (i) => {
      if (state.screen === 'setup') state.setup.lapIndex = i;
    },
    selectDriver: (i) => {
      if (state.screen === 'setup') state.setup.colorIndex = i;
    },
    selectPause: (i) => {
      if (state.screen === 'paused') state.pauseIndex = i;
    },
  });

  const onEvents = (events: RaceEvent[]) => {
    if (events.length === 0) return;
    scene.onEvents(events);
    ui.onEvents(events, race);
    for (const e of events) {
      if (e.type === 'go' && state.screen === 'countdown') state.screen = 'racing';
    }
  };

  const autoPause = () => {
    if (state.screen === 'racing' || state.screen === 'countdown') {
      pausedFrom = state.screen;
      state.screen = 'paused';
      state.pauseIndex = 0;
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') autoPause();
  };
  document.addEventListener('visibilitychange', onVisibility);
  // A window that loses focus gets no key events: pause rather than coast.
  window.addEventListener('blur', autoPause);

  const frame = (now: number) => {
    const dt = Math.min(MAX_CATCH_UP, Math.max(0, (now - last) / 1000));
    last = now;

    // The touch layer shows on the track only; the menus take taps themselves.
    touch.setVisible(state.touch && (state.screen === 'countdown' || state.screen === 'racing'));
    for (const a of input.takeActions()) handle(a);

    if (state.screen === 'countdown' || state.screen === 'racing') {
      acc += dt;
      const kartInput = state.screen === 'racing' ? input.read() : NO_INPUT;
      while (acc >= TUNING.step) {
        scene.capture(race);
        // The autopilot drives; the item key still works.
        const auto = autopilot && state.screen === 'racing';
        const pilot = auto ? botInput(race, race.playerId) : null;
        const use = pilot ? { ...pilot, item: kartInput.item === true } : kartInput;
        onEvents(stepRace(race, [use], TUNING.step));
        acc -= TUNING.step;
      }
      if (race.phase === 'finished') {
        finishTimer += dt;
        if (finishTimer >= FINISH_DELAY) state.screen = 'results';
      }
    }

    scene.render(race, state.screen === 'paused' ? 1 : acc / TUNING.step);
    state.tags = scene.tags();
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
    playerHeading: () => player()?.kart.heading ?? 0,
    touchControls: () => !touch.el.hidden,
    playerLap: () => player()?.lap.completed ?? 0,
    playerTicket: () => {
      const t = player()?.ticket;
      return t ? { number: t.number, title: t.type.title, next: nextStep(t) } : null;
    },
    raceTime: () => race.time,
    renderInfo: () => ({
      calls: scene.renderer.info.render.calls,
      triangles: scene.renderer.info.render.triangles,
      geometries: scene.renderer.info.memory.geometries,
      textures: scene.renderer.info.memory.textures,
    }),
    rowS: () => race.board.map((r) => r.s),
    kartCount: () => race.karts.length,
    place: () => (race.finalOrder ?? standings(race)).indexOf(race.playerId) + 1,
  };
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    window.__oncallKart.setTicket = (type: TicketType, stepIndex: number) => {
      const k = player();
      if (k) k.ticket = { ...k.ticket, type, stepIndex };
    };
    window.__oncallKart.autopilot = (on: boolean) => {
      autopilot = on;
    };
    window.__oncallKart.giveItem = (item: ItemKind) => {
      const k = player();
      if (k) {
        k.item = item;
        k.itemAt = race.time;
      }
    };
    window.__oncallKart.placePlayer = (s: number) => {
      const k = player();
      if (!k) return;
      k.kart = spawnKart(track, s, 0);
      k.proj = { s, lateral: 0 };
      scene.capture(race);
    };
  }
}
