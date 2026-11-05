import { OPS, type Step } from '../../logic/ops';
import { intBetween, makeRng, pick, type Rng } from '../../logic/rng';
import type { TicketType } from '../../logic/runbooks';
import { applyStep, issueTicket, type Ticket } from '../../logic/ticket';
import { breakTimes, shooterSla } from './breaks';
import { FLOOR, solidBoxes, type Box, type FloorDef, type Target } from './floor';
import { rollPatches, type Patch } from './patches';
import { NO_MOVE, stepPlayer, type MoveInput, type Player } from './player';
import { SHOOTER_TUNING } from './tuning';

/** The steps on the rack panel. Number key n picks PANEL_STEPS[n - 1]. */
export const PANEL_STEPS: readonly Step[] = [...OPS, 'PIT'];

export type Ending = 'clean' | 'rough' | 'fired';

export interface OpenTicket {
  rackId: string;
  ticket: Ticket;
  breached: boolean;
}

/** Work in progress at a target. step null = a patch. */
export interface Work {
  targetId: string;
  step: Step | null;
  /** Seconds of work done. */
  progress: number;
  /** Seconds the work takes. */
  duration: number;
}

export interface ShiftStats {
  ticketsClosed: number;
  slaBreaches: number;
  wrongSteps: number;
  patchesApplied: number;
}

export interface Shift {
  /** Seconds since the shift started. */
  time: number;
  floor: FloorDef;
  player: Player;
  open: OpenTicket[];
  patches: Patch[];
  /** The step picked on the rack panel. */
  selected: Step | null;
  work: Work | null;
  stats: ShiftStats;
  ended: Ending | null;
  rng: Rng;
  /** Break times, ascending. */
  schedule: number[];
  /** Index of the next break in schedule. */
  nextBreak: number;
  /** The last ticket number issued. */
  ticketNumber: number;
  /** Every box the player collides with. */
  boxes: Box[];
  /** Racks and devices by id. */
  targets: Map<string, Target>;
}

export interface ShiftInput {
  move: MoveInput;
  /** The view, set by the mouse. */
  yaw: number;
  pitch: number;
  /** E is held. */
  work: boolean;
  /** A step picked with a number key this tick. */
  pick: Step | null;
}

export type ShiftEvent =
  | { type: 'break'; rackId: string; ticket: Ticket }
  | { type: 'step-ok'; rackId: string; step: Step }
  | { type: 'step-wrong'; rackId: string; step: Step }
  | { type: 'alarm'; rackId: string }
  | { type: 'ticket-closed'; rackId: string }
  | { type: 'patch-applied'; patchId: string }
  | { type: 'work-cancelled'; targetId: string }
  | { type: 'sla-breach'; rackId: string }
  | { type: 'shift-end'; ending: Ending };

/** Slack for float sums of fixed steps: 1/120 does not add up exactly. */
const EPS = 1e-9;

export function createShift(seed: number, floor: FloorDef = FLOOR): Shift {
  const rng = makeRng(seed);
  const schedule = breakTimes(rng);
  const patches = rollPatches(rng, floor);
  return {
    time: 0,
    floor,
    player: {
      x: floor.spawn.x,
      z: floor.spawn.z,
      vx: 0,
      vz: 0,
      yaw: floor.spawn.yaw,
      pitch: 0,
    },
    open: [],
    patches,
    selected: null,
    work: null,
    stats: { ticketsClosed: 0, slaBreaches: 0, wrongSteps: 0, patchesApplied: 0 },
    ended: null,
    rng,
    schedule,
    nextBreak: 0,
    ticketNumber: 0,
    boxes: solidBoxes(floor),
    targets: new Map([...floor.racks, ...floor.devices].map((t) => [t.id, t])),
  };
}

/** The yaw that looks from one point toward another. */
export function yawToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

const isPatchTarget = (s: Shift, id: string) => s.patches.some((p) => p.targetId === id);
const openAt = (s: Shift, rackId: string) => s.open.find((o) => o.rackId === rackId);
const unappliedAt = (s: Shift, id: string) =>
  s.patches.find((p) => p.targetId === id && !p.applied);

/**
 * Break one rack now, with a ticket of the given type. Returns the event, or
 * null when the rack is unknown, already broken or a patch target.
 */
export function breakRack(s: Shift, rackId: string, type: TicketType): ShiftEvent | null {
  const rack = s.targets.get(rackId);
  if (!rack || rack.kind !== 'rack' || openAt(s, rackId) || isPatchTarget(s, rackId)) return null;
  s.ticketNumber += 1;
  const base = issueTicket(s.rng, s.ticketNumber, s.time);
  const unit = intBetween(s.rng, 1, 42);
  const ticket: Ticket = {
    ...base,
    type,
    location: `${rackId}-u${String(unit).padStart(2, '0')}`,
    deadline: s.time + shooterSla(type),
  };
  s.open.push({ rackId, ticket, breached: false });
  return { type: 'break', rackId, ticket };
}

/** A scheduled break: a random healthy rack that is not a patch target; none left, no break. */
function randomBreak(s: Shift): ShiftEvent | null {
  const candidates = s.floor.racks.filter((r) => !openAt(s, r.id) && !isPatchTarget(s, r.id));
  if (candidates.length === 0) return null;
  const rack = pick(s.rng, candidates);
  // The ticket type comes from issueTicket's own pick, so one file drives both games.
  const type = issueTicket(s.rng, 0, s.time).type;
  return breakRack(s, rack.id, type);
}

/** Distance from a point to a box on the ground plane. */
function distanceToBox(x: number, z: number, b: Box): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * The broken rack or unapplied patch target the player works on: within
 * reach, in front of its face, and within faceAngleDeg of the view. Of
 * several, the one nearest the center of the view.
 */
export function facingTarget(s: Shift): Target | null {
  const p = s.player;
  const vx = -Math.sin(p.yaw);
  const vz = -Math.cos(p.yaw);
  const cosLimit = Math.cos((SHOOTER_TUNING.faceAngleDeg * Math.PI) / 180);
  let best: Target | null = null;
  let bestCos = -Infinity;
  const consider = (t: Target | undefined) => {
    if (!t) return;
    if (distanceToBox(p.x, p.z, t.box) > SHOOTER_TUNING.reach) return;
    const half = t.fx !== 0 ? (t.box.maxX - t.box.minX) / 2 : (t.box.maxZ - t.box.minZ) / 2;
    const faceX = t.x + t.fx * half;
    const faceZ = t.z + t.fz * half;
    // The player stands on the front side of the face.
    if ((p.x - faceX) * t.fx + (p.z - faceZ) * t.fz <= 0) return;
    const tx = faceX - p.x;
    const tz = faceZ - p.z;
    const len = Math.hypot(tx, tz);
    if (len === 0) return;
    const c = (tx * vx + tz * vz) / len;
    if (c < cosLimit || c <= bestCos) return;
    best = t;
    bestCos = c;
  };
  for (const o of s.open) consider(s.targets.get(o.rackId));
  for (const patch of s.patches) if (!patch.applied) consider(s.targets.get(patch.targetId));
  return best;
}

/** Clean: every patch and no broken rack. Rough: every patch, a rack still broken. Fired: a patch missed. */
export function endingFor(s: Shift): Ending {
  if (s.patches.some((p) => !p.applied)) return 'fired';
  return s.open.length === 0 ? 'clean' : 'rough';
}

/** Finish the work in progress. */
function complete(s: Shift, w: Work, events: ShiftEvent[]): void {
  s.work = null;
  if (w.step === null) {
    const patch = unappliedAt(s, w.targetId);
    if (patch) {
      patch.applied = true;
      s.stats.patchesApplied += 1;
      events.push({ type: 'patch-applied', patchId: patch.id });
    }
    return;
  }
  s.selected = null;
  const open = openAt(s, w.targetId);
  if (!open) return;
  const { ticket, result } = applyStep(open.ticket, w.step);
  open.ticket = ticket;
  if (result === 'wrong') {
    s.stats.wrongSteps += 1;
    events.push({ type: 'step-wrong', rackId: w.targetId, step: w.step });
    events.push({ type: 'alarm', rackId: w.targetId });
    return;
  }
  events.push({ type: 'step-ok', rackId: w.targetId, step: w.step });
  if (result === 'closed') {
    s.open = s.open.filter((o) => o !== open);
    s.stats.ticketsClosed += 1;
    events.push({ type: 'ticket-closed', rackId: w.targetId });
  }
}

/** Duration of the work a target needs now, or null when there is nothing to do. */
function workFor(s: Shift, t: Target): Work | null {
  const T = SHOOTER_TUNING;
  if (openAt(s, t.id)) {
    if (s.selected === null) return null;
    const duration = s.selected === 'PIT' ? T.handsOnSeconds : T.opSeconds;
    return { targetId: t.id, step: s.selected, progress: 0, duration };
  }
  if (unappliedAt(s, t.id)) {
    return { targetId: t.id, step: null, progress: 0, duration: T.patchSeconds };
  }
  return null;
}

/** Advance the shift by one fixed step. Mutates s, like stepRace. */
export function stepShift(s: Shift, input: ShiftInput, dt: number): ShiftEvent[] {
  if (s.ended) return [];
  const events: ShiftEvent[] = [];
  s.time += dt;
  s.player.yaw = input.yaw;
  s.player.pitch = input.pitch;

  if (input.pick !== null) s.selected = input.pick;

  // Work: hold E, stand still, face the target. Anything else cancels it.
  const moving = input.move.forward !== 0 || input.move.strafe !== 0;
  const facing = facingTarget(s);
  const w = s.work;
  if (w) {
    const stillOn =
      input.work &&
      !moving &&
      facing?.id === w.targetId &&
      (w.step === null || w.step === s.selected);
    if (!stillOn) {
      s.work = null;
      events.push({ type: 'work-cancelled', targetId: w.targetId });
    }
  }
  if (!s.work && input.work && !moving && facing) s.work = workFor(s, facing);
  if (s.work) {
    s.work.progress += dt;
    if (s.work.progress >= s.work.duration - EPS) complete(s, s.work, events);
  }

  // Movement: none while working.
  stepPlayer(s.player, s.work ? NO_MOVE : input.move, dt, s.boxes);

  for (const o of s.open) {
    if (!o.breached && s.time >= o.ticket.deadline - EPS) {
      o.breached = true;
      s.stats.slaBreaches += 1;
      events.push({ type: 'sla-breach', rackId: o.rackId });
    }
  }

  while (s.nextBreak < s.schedule.length && s.time >= (s.schedule[s.nextBreak] ?? 0) - EPS) {
    s.nextBreak += 1;
    const e = randomBreak(s);
    if (e) events.push(e);
  }

  if (s.time >= SHOOTER_TUNING.shiftSeconds - EPS) {
    s.ended = endingFor(s);
    events.push({ type: 'shift-end', ending: s.ended });
  }
  return events;
}
