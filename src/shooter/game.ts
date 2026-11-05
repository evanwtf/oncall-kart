import type { Step } from '../logic/ops';
import { TICKET_TYPES } from '../logic/runbooks';
import { nextStep } from '../logic/ticket';
import { gameUrl } from '../picker';
import { createShooterInput, type ShooterAction } from './input';
import { FLOOR, frontPoint } from './logic/floor';
import {
  breakRack,
  createShift,
  facingTarget,
  stepShift,
  yawToward,
  type Ending,
  type Shift,
  type ShiftEvent,
  type ShiftInput,
  type ShiftStats,
} from './logic/shift';
import { SHOOTER_TUNING } from './logic/tuning';
import {
  VENDOR_ROLES,
  closeVendors,
  slowFactor,
  spawnVendor,
  type VendorRole,
} from './logic/vendors';
import { createShooterScene } from './render/scene';
import { createShooterHud } from './ui/hud';
import {
  END_ITEMS,
  PAUSE_ITEMS,
  SENSITIVITY_STEPS,
  createShooterScreens,
  type EndItem,
  type PauseItem,
  type ShooterScreen,
} from './ui/screens';
import './ui/shooter.css';

/** Fixed logic step, as in the kart game. */
const STEP = 1 / 120;
/** Longest frame the loop catches up on (s), as in the kart game. */
const MAX_CATCH_UP = 0.25;
const SENS_KEY = 'zero-down-sensitivity';
const DEFAULT_SENS_INDEX = 3;

export interface ShooterHooks {
  version: string;
  screen(): ShooterScreen;
  /** Seconds left on the shift clock. */
  clockLeft(): number;
  openTickets(): { rackId: string; title: string; next: Step | null }[];
  patches(): { id: string; targetId: string; applied: boolean }[];
  stats(): ShiftStats;
  ending(): Ending | null;
  player(): { x: number; z: number; yaw: number };
  /** Draw calls and triangles in the last frame. */
  renderInfo(): { calls: number; triangles: number };
  vendors(): { id: number; role: VendorRole; x: number; z: number; distracted: boolean }[];
  budget(): number;
  /** The slowdown now: 1 with nobody close, down to 0.1. */
  speedFactor(): number;
  /** Only with ?debug=1: put a vendor on the floor. */
  spawnVendor?(role: VendorRole, x: number, z: number): void;
  /** Only with ?debug=1: set the budget. */
  setBudget?(n: number): void;
  /** Only with ?debug=1: hold the fire button (true) or let go (false), as the mouse does. */
  fire?(on: boolean): void;
  /** Only with ?debug=1: turn the view to look at a point on the floor. */
  lookAt?(x: number, z: number): void;
  /** Only with ?debug=1: stand 0.8 m in front of a target, looking at it. */
  faceTarget?(id: string): void;
  /** Only with ?debug=1: break a rack now with a ticket of this type. */
  breakNow?(rackId: string, typeId: string): void;
  /** Only with ?debug=1: set the seconds left on the clock. */
  setClockLeft?(s: number): void;
  /** Only with ?debug=1: start the shift, as the briefing click does. */
  start?(): void;
}

declare global {
  interface Window {
    __oncallShooter?: ShooterHooks;
  }
}

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function loadSensitivity(): number {
  try {
    const raw = window.localStorage.getItem(SENS_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 && n < SENSITIVITY_STEPS.length ? n : DEFAULT_SENS_INDEX;
  } catch {
    return DEFAULT_SENS_INDEX;
  }
}

function saveSensitivity(i: number): void {
  try {
    window.localStorage.setItem(SENS_KEY, String(i));
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

/** Zero Down: one on-call shift on the data-centre floor. */
export function startShooter(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void {
  const fixedSeed = seedFromUrl();
  const newSeed = () => fixedSeed ?? Math.floor(Math.random() * 2 ** 31);
  let screen: ShooterScreen = 'briefing';
  let pauseIndex = 0;
  // Ask for the lock inside the keydown that starts play: Safari refuses one
  // asked for later, from the frame loop.
  const input = createShooterInput(window, canvas, {
    lockOnAction: (a) =>
      (screen === 'briefing' && a === 'confirm') ||
      (screen === 'paused' &&
        (a === 'pause' || (a === 'confirm' && PAUSE_ITEMS[pauseIndex] === 'Resume'))),
  });
  const scene = createShooterScene(canvas, FLOOR);
  const hud = createShooterHud(uiRoot);
  uiRoot.classList.add('zd');

  let shift: Shift = createShift(newSeed());
  let endIndex = 0;
  let sensitivityIndex = loadSensitivity();
  let acc = 0;
  /** A pick waits for the next fixed step: a frame shorter than one step runs none. */
  let pendingPick: Step | null = null;
  /** The debug fire hook holds the button down. */
  let heldFire = false;
  let last = performance.now();

  const applySensitivity = () =>
    input.setSensitivity(
      SHOOTER_TUNING.mouseSensitivity * (SENSITIVITY_STEPS[sensitivityIndex] ?? 1),
    );
  applySensitivity();

  /** Set up the view, the scene and the HUD for `shift`. */
  const adopt = () => {
    input.setView(shift.player.yaw, 0);
    scene.reset(shift);
    hud.clear();
    acc = 0;
    pendingPick = null;
  };
  adopt();
  const newShift = () => {
    shift = createShift(newSeed());
    adopt();
  };

  /**
   * Start or resume the shift. `lock`: ask for the mouse lock here (a click).
   * A key press asked for it already, in its own handler. The shift starts
   * even if the browser refuses the lock; a click on the floor tries again.
   */
  const play = (lock = true) => {
    screen = 'playing';
    last = performance.now();
    acc = 0;
    if (lock) input.requestLock();
  };
  const pauseGame = () => {
    if (screen !== 'playing') return;
    screen = 'paused';
    pauseIndex = 0;
    input.releaseLock();
  };
  const toStartScreen = () => {
    input.releaseLock();
    window.location.assign(gameUrl(window.location.href, null));
  };
  const toBriefing = () => {
    input.releaseLock();
    newShift();
    screen = 'briefing';
  };

  const pauseItem = (item: PauseItem) => {
    if (screen !== 'paused') return;
    if (item === 'Resume') play();
    if (item === 'Restart shift') toBriefing();
    if (item === 'Back to start screen') toStartScreen();
    if (item === 'Mouse sensitivity') sensitivity(1);
  };
  const endItem = (item: EndItem) => {
    if (screen !== 'ended') return;
    if (item === 'Play again') toBriefing();
    if (item === 'Start screen') toStartScreen();
  };
  const sensitivity = (delta: number) => {
    sensitivityIndex = Math.max(
      0,
      Math.min(SENSITIVITY_STEPS.length - 1, sensitivityIndex + delta),
    );
    applySensitivity();
    saveSensitivity(sensitivityIndex);
  };

  const screens = createShooterScreens(uiRoot, {
    start: () => {
      if (screen === 'briefing') play();
    },
    pauseItem: (item) => {
      pauseIndex = PAUSE_ITEMS.indexOf(item);
      pauseItem(item);
    },
    endItem: (item) => {
      endIndex = END_ITEMS.indexOf(item);
      endItem(item);
    },
    sensitivity: (d) => {
      pauseIndex = PAUSE_ITEMS.indexOf('Mouse sensitivity');
      sensitivity(d);
    },
    toStartScreen,
  });

  const handle = (a: ShooterAction) => {
    switch (screen) {
      case 'briefing':
        if (a === 'confirm') play(false);
        break;
      case 'playing':
        if (a === 'pause' || a === 'lock-lost') pauseGame();
        break;
      case 'paused': {
        const n = PAUSE_ITEMS.length;
        // Only a key resumes. A lost lock never does.
        if (a === 'pause') play(false);
        if (a === 'up') pauseIndex = (pauseIndex + n - 1) % n;
        if (a === 'down') pauseIndex = (pauseIndex + 1) % n;
        const item = PAUSE_ITEMS[pauseIndex];
        if (item === 'Mouse sensitivity' && (a === 'left' || a === 'right')) {
          sensitivity(a === 'left' ? -1 : 1);
        }
        if (a === 'confirm' && item) {
          if (item === 'Resume') play(false);
          else pauseItem(item);
        }
        break;
      }
      case 'ended': {
        const n = END_ITEMS.length;
        if (a === 'left' || a === 'up') endIndex = (endIndex + n - 1) % n;
        if (a === 'right' || a === 'down') endIndex = (endIndex + 1) % n;
        const item = END_ITEMS[endIndex];
        if (a === 'confirm' && item) endItem(item);
        break;
      }
    }
  };

  // A click on the floor while playing takes the mouse back (after Esc, or a refused lock).
  canvas.addEventListener('click', () => {
    if (screen === 'playing') input.requestLock();
  });
  // A hidden tab or a window that loses focus pauses: the clock must not run out unseen.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') pauseGame();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', pauseGame);

  const onEvents = (events: ShiftEvent[]) => {
    if (events.length === 0) return;
    hud.onEvents(events, shift);
    for (const e of events) {
      if (e.type === 'ticket-closed') scene.flashGreen(e.rackId);
      if (e.type === 'fired') scene.kick();
      if (e.type === 'shift-end') {
        screen = 'ended';
        endIndex = 0;
        input.releaseLock();
      }
    }
  };

  const frame = (now: number) => {
    const dt = Math.min(MAX_CATCH_UP, Math.max(0, (now - last) / 1000));
    last = now;
    for (const a of input.takeActions()) handle(a);
    // A lock that lands while the shift is not running (asked for, then P) is given back.
    if (screen !== 'playing' && input.locked()) input.releaseLock();

    if (screen === 'playing') {
      acc += dt;
      const read: ShiftInput = input.read();
      if (heldFire) read.fire = true;
      pendingPick = read.pick ?? pendingPick;
      while (acc >= STEP && screen === 'playing') {
        scene.capture(shift);
        onEvents(stepShift(shift, { ...read, pick: pendingPick }, STEP));
        pendingPick = null;
        acc -= STEP;
      }
    } else {
      // Drop keys and picks made in a menu.
      input.read();
    }

    const facing = screen === 'playing' || screen === 'paused' ? facingTarget(shift) : null;
    hud.el.hidden = !(screen === 'playing' || screen === 'paused');
    if (!hud.el.hidden) hud.update(shift, facing);
    screens.render({
      screen,
      shift,
      pauseIndex,
      endIndex,
      sensitivityIndex,
      locked: input.locked(),
    });
    const paused = screen !== 'playing';
    // The camera turns with the live mouse, not only on logic steps: no stutter at 120 Hz.
    scene.render(shift, paused ? 1 : acc / STEP, paused, input.view());
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.__oncallShooter = {
    version: __APP_VERSION__,
    screen: () => screen,
    clockLeft: () => Math.max(0, SHOOTER_TUNING.shiftSeconds - shift.time),
    openTickets: () =>
      shift.open.map((o) => ({
        rackId: o.rackId,
        title: o.ticket.type.title,
        next: nextStep(o.ticket),
      })),
    patches: () =>
      shift.patches.map((p) => ({ id: p.id, targetId: p.targetId, applied: p.applied })),
    stats: () => ({ ...shift.stats }),
    ending: () => shift.ended,
    player: () => ({ x: shift.player.x, z: shift.player.z, yaw: shift.player.yaw }),
    renderInfo: () => ({
      calls: scene.renderer.info.render.calls,
      triangles: scene.renderer.info.render.triangles,
    }),
    vendors: () =>
      shift.vendors.map((v) => ({
        id: v.id,
        role: v.role,
        x: v.x,
        z: v.z,
        distracted: shift.time < v.distractedUntil,
      })),
    budget: () => shift.budget,
    speedFactor: () => slowFactor(closeVendors(shift)),
  };
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    const hooks = window.__oncallShooter;
    hooks.start = () => {
      if (screen === 'briefing') play();
    };
    hooks.faceTarget = (id: string) => {
      const t = shift.targets.get(id);
      if (!t) return;
      const p = frontPoint(t, 0.8);
      shift.player.x = p.x;
      shift.player.z = p.z;
      shift.player.vx = 0;
      shift.player.vz = 0;
      const yaw = yawToward(p.x, p.z, t.x, t.z);
      shift.player.yaw = yaw;
      input.setView(yaw, -0.15);
      scene.capture(shift);
    };
    hooks.breakNow = (rackId: string, typeId: string) => {
      const type = TICKET_TYPES.find((t) => t.id === typeId);
      if (!type) return;
      const e = breakRack(shift, rackId, type);
      if (e) onEvents([e]);
    };
    hooks.setClockLeft = (s: number) => {
      shift.time = Math.max(0, SHOOTER_TUNING.shiftSeconds - s);
      // A jump of the clock skips the breaks it passes over, rather than firing them all at once.
      while (
        shift.nextBreak < shift.schedule.length &&
        (shift.schedule[shift.nextBreak] ?? 0) <= shift.time
      ) {
        shift.nextBreak += 1;
      }
      // The same for vendor arrivals: a jump does not bring a crowd at once.
      while (
        shift.nextArrival < shift.arrivals.length &&
        (shift.arrivals[shift.nextArrival]?.time ?? 0) <= shift.time
      ) {
        shift.nextArrival += 1;
      }
    };
    hooks.spawnVendor = (role: VendorRole, x: number, z: number) => {
      if (!(role in VENDOR_ROLES)) return;
      spawnVendor(shift, role, x, z);
    };
    hooks.setBudget = (n: number) => {
      shift.budget = Math.max(0, n);
    };
    hooks.fire = (on: boolean) => {
      heldFire = on;
    };
    hooks.lookAt = (x: number, z: number) => {
      const yaw = yawToward(shift.player.x, shift.player.z, x, z);
      shift.player.yaw = yaw;
      input.setView(yaw, 0);
    };
  }
}
