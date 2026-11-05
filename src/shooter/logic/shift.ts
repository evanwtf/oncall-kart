import { OPS, type Step } from '../../logic/ops';
import { intBetween, makeRng, pick, type Rng } from '../../logic/rng';
import type { TicketType } from '../../logic/runbooks';
import { applyStep, issueTicket, type Ticket } from '../../logic/ticket';
import { breakTimes, shooterSla } from './breaks';
import { placePickups, stepMoney, type Bill, type Lure, type Pickup } from './money';
import { FLOOR, solidBoxes, type Box, type FloorDef, type Target } from './floor';
import { buildNavGrid, flowField, type FlowField, type NavGrid } from './nav';
import { rollPatches, type Patch } from './patches';
import { stepPlayer, type MoveInput, type Player } from './player';
import { SHOOTER_TUNING } from './tuning';
import {
  closeVendors,
  slowFactor,
  soundAlarm,
  stepVendors,
  updatePlayerField,
  vendorArrivals,
  type Vendor,
  type VendorRole,
} from './vendors';

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

/** A pick belongs to one rack: it never starts work at another. */
export interface Pick {
  rackId: string;
  step: Step;
}

export interface ShiftStats {
  ticketsClosed: number;
  slaBreaches: number;
  wrongSteps: number;
  patchesApplied: number;
  /** Hits on vendors and lures taken. */
  vendorsDistracted: number;
  moneySpent: number;
}

export interface Shift {
  /** Seconds since the shift started. */
  time: number;
  floor: FloorDef;
  player: Player;
  open: OpenTicket[];
  patches: Patch[];
  /** The step picked on the rack panel, bound to the rack it was picked at. */
  selected: Pick | null;
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

  // Vendors (phase 2).
  vendors: Vendor[];
  /** Vendors' own random source, derived from the seed: phase 1 draws stay the same. */
  vendorRng: Rng;
  /** Arrival times, ascending. */
  arrivals: { time: number; role: VendorRole }[];
  /** Index of the next arrival. */
  nextArrival: number;
  nextVendorId: number;
  nav: NavGrid;
  /** The field toward the player, rebuilt when the player enters a new cell. */
  playerField: FlowField;
  playerCell: number;
  /** The field toward each alarmed rack, built once per alarm. */
  alarmFields: Map<string, FlowField>;
  /** No vendor line before this time. */
  nextLineAt: number;
  /** Side-steps given to stuck vendors (a debug count). */
  vendorNudges: number;

  // The money gun (phase 2).
  /** The gun's ammo. Never below 0. */
  budget: number;
  bills: Bill[];
  lures: Lure[];
  pickups: Pickup[];
  /** The toolkit is taken: every step is faster. */
  toolkit: boolean;
  /** Seconds before the next shot, and before the next dry click. */
  fireCooldown: number;
  dryCooldown: number;
  shotNumber: number;
  nextBillId: number;
  nextLureId: number;
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
  /** The fire button is held. Absent = not held. */
  fire?: boolean;
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
  | { type: 'shift-end'; ending: Ending }
  | { type: 'vendor-arrived'; id: number; role: VendorRole }
  | { type: 'vendor-close'; id: number; role: VendorRole; line: string }
  | { type: 'fired' }
  | { type: 'dry-fire' }
  | { type: 'vendor-distracted'; id: number; role: VendorRole }
  | { type: 'lure-dropped'; id: number }
  | { type: 'lure-taken'; id: number; vendorId: number }
  | { type: 'picked-up'; kind: 'po' | 'toolkit' };

/** Slack for float sums of fixed steps: 1/120 does not add up exactly. */
const EPS = 1e-9;

/** Salt for the vendors' seed, so their draws never touch the phase 1 stream. */
const VENDOR_SALT = 0x6a09e667;

export function createShift(seed: number, floor: FloorDef = FLOOR): Shift {
  const rng = makeRng(seed);
  const schedule = breakTimes(rng);
  const patches = rollPatches(rng, floor);
  const vendorRng = makeRng((seed ^ VENDOR_SALT) >>> 0);
  const nav = buildNavGrid(floor, SHOOTER_TUNING.navCell, SHOOTER_TUNING.vendorRadius);
  const s: Shift = {
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
    stats: {
      ticketsClosed: 0,
      slaBreaches: 0,
      wrongSteps: 0,
      patchesApplied: 0,
      vendorsDistracted: 0,
      moneySpent: 0,
    },
    ended: null,
    rng,
    schedule,
    nextBreak: 0,
    ticketNumber: 0,
    boxes: solidBoxes(floor),
    targets: new Map([...floor.racks, ...floor.devices].map((t) => [t.id, t])),
    vendors: [],
    vendorRng,
    arrivals: vendorArrivals(vendorRng),
    nextArrival: 0,
    nextVendorId: 0,
    nav,
    playerField: flowField(nav, floor.spawn.x, floor.spawn.z),
    playerCell: -1,
    alarmFields: new Map(),
    nextLineAt: 0,
    vendorNudges: 0,
    budget: SHOOTER_TUNING.startBudget,
    bills: [],
    lures: [],
    pickups: placePickups(vendorRng, floor, nav),
    toolkit: false,
    fireCooldown: 0,
    dryCooldown: 0,
    shotNumber: 0,
    nextBillId: 0,
    nextLureId: 0,
  };
  updatePlayerField(s);
  return s;
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

/** The cosine of the angle between the view and a target's front face, or null when it is out of reach, behind or outside the cone. */
function faceScore(s: Shift, t: Target): number | null {
  const p = s.player;
  if (distanceToBox(p.x, p.z, t.box) > SHOOTER_TUNING.reach) return null;
  const half = t.fx !== 0 ? (t.box.maxX - t.box.minX) / 2 : (t.box.maxZ - t.box.minZ) / 2;
  const faceX = t.x + t.fx * half;
  const faceZ = t.z + t.fz * half;
  // The player stands on the front side of the face.
  if ((p.x - faceX) * t.fx + (p.z - faceZ) * t.fz <= 0) return null;
  const tx = faceX - p.x;
  const tz = faceZ - p.z;
  const len = Math.hypot(tx, tz);
  if (len === 0) return null;
  const c = (tx * -Math.sin(p.yaw) + tz * -Math.cos(p.yaw)) / len;
  return c < Math.cos((SHOOTER_TUNING.faceAngleDeg * Math.PI) / 180) ? null : c;
}

/** The target still needs work: a broken rack, or a patch target not yet patched. */
const needsWork = (s: Shift, id: string) => !!openAt(s, id) || !!unappliedAt(s, id);

/**
 * The broken rack or unapplied patch target the player works on: within
 * reach, in front of its face, and within faceAngleDeg of the view. Of
 * several, the one nearest the center of the view.
 */
export function facingTarget(s: Shift): Target | null {
  let best: Target | null = null;
  let bestCos = -Infinity;
  const consider = (t: Target | undefined) => {
    if (!t) return;
    const c = faceScore(s, t);
    if (c === null || c <= bestCos) return;
    best = t;
    bestCos = c;
  };
  for (const o of s.open) consider(s.targets.get(o.rackId));
  for (const patch of s.patches) if (!patch.applied) consider(s.targets.get(patch.targetId));
  return best;
}

/**
 * The target the player works on now. Work in progress keeps its target
 * while that target stays in reach and in the cone, even if another one
 * comes nearer the view center; otherwise, facingTarget.
 */
export function workTarget(s: Shift): Target | null {
  const w = s.work;
  if (w) {
    const t = s.targets.get(w.targetId);
    if (t && needsWork(s, t.id) && faceScore(s, t) !== null) return t;
  }
  return facingTarget(s);
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
    soundAlarm(s, w.targetId);
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
  // The toolkit makes every step faster for the rest of the shift.
  const scale = s.toolkit ? T.toolkitScale : 1;
  if (openAt(s, t.id)) {
    const sel = s.selected;
    if (sel === null || sel.rackId !== t.id) return null;
    const duration = (sel.step === 'PIT' ? T.handsOnSeconds : T.opSeconds) * scale;
    return { targetId: t.id, step: sel.step, progress: 0, duration };
  }
  if (unappliedAt(s, t.id)) {
    return { targetId: t.id, step: null, progress: 0, duration: T.patchSeconds * scale };
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

  // Work: hold E, stand still, face the target. Anything else cancels it.
  const moving = input.move.forward !== 0 || input.move.strafe !== 0;
  const facing = workTarget(s);
  // A pick binds to the broken rack in view. Facing another target drops it.
  if (facing && s.selected && s.selected.rackId !== facing.id) s.selected = null;
  if (input.pick !== null && facing && openAt(s, facing.id)) {
    s.selected = { rackId: facing.id, step: input.pick };
  }
  const w = s.work;
  if (w) {
    const stillOn =
      input.work &&
      !moving &&
      facing?.id === w.targetId &&
      (w.step === null || w.step === s.selected?.step);
    if (!stillOn) {
      s.work = null;
      events.push({ type: 'work-cancelled', targetId: w.targetId });
    }
  }
  if (!s.work && input.work && !moving && facing) s.work = workFor(s, facing);
  // Evan's rule: close vendors slow both the walk and the work bar.
  const factor = slowFactor(closeVendors(s));
  if (s.work) {
    s.work.progress += dt * factor;
    // Feet planted: speed left over from walking does not carry the player off.
    s.player.vx = 0;
    s.player.vz = 0;
    if (s.work.progress >= s.work.duration - EPS) complete(s, s.work, events);
  } else {
    stepPlayer(s.player, input.move, dt, s.boxes, factor);
  }

  stepMoney(s, input, dt, events);
  stepVendors(s, dt, events);

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
