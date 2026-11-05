/**
 * Vendors: they walk in from the loading dock and crowd the player. Each
 * close vendor slows the player and the work bar (Evan's rule). They never
 * block the player, and nobody gets hurt: a hit only distracts them.
 *
 * Every vendor is a job role, never a company, and none is modelled on a
 * real person. The lines are original.
 */
import { intBetween, pick, type Rng } from '../../logic/rng';
import { frontPoint } from './floor';
import { cellAt, flowDir, flowField, nearestOpen, segmentClear, type FlowField } from './nav';
import { moveWithCollision } from './player';
import type { Shift, ShiftEvent } from './shift';
import { SHOOTER_TUNING } from './tuning';

export type VendorRole =
  'account-exec' | 'renewal-rep' | 'license-auditor' | 'support-agent' | 'solutions-architect';

export interface VendorRoleDef {
  title: string;
  /** Walking speed (m/s). Every role is slower than the player. */
  speed: number;
  /** Multiplies the time a hit distracts this role. */
  distractScale: number;
  lines: readonly string[];
}

export const VENDOR_ROLES: Record<VendorRole, VendorRoleDef> = {
  'account-exec': {
    title: 'Account exec',
    speed: 4.5,
    distractScale: 1,
    lines: [
      'Got five minutes?',
      'Quick intro, I promise.',
      'Are you the decision maker?',
      'Can we put fifteen minutes on your calendar?',
      'I was just in the area.',
    ],
  },
  'renewal-rep': {
    title: 'Renewal rep',
    speed: 3,
    distractScale: 1,
    lines: [
      'Your contract ends in 30 days.',
      'Multi-year saves you more.',
      'Pricing changes next quarter.',
      'Did you get my last seven emails?',
    ],
  },
  'license-auditor': {
    title: 'License auditor',
    speed: 2.2,
    distractScale: 0.4,
    lines: [
      'How many cores is that?',
      'Can I see your entitlements?',
      'Is this box dev or prod?',
      'Just a routine true-up.',
    ],
  },
  'support-agent': {
    title: 'Support agent',
    speed: 3,
    distractScale: 1,
    lines: [
      'Can you send the logs again?',
      'Which version is that?',
      'Did you try a reboot?',
      'I will escalate to tier two.',
    ],
  },
  'solutions-architect': {
    title: 'Solutions architect',
    speed: 3,
    distractScale: 1,
    lines: [
      'Have you thought about a platform?',
      'Let me whiteboard this for you.',
      'It all fits in one reference diagram.',
      'Picture this, but as a service.',
    ],
  },
};

/** Arrival weights: sales calls are common, audits are rare. */
const ROLE_BAG: readonly VendorRole[] = [
  'account-exec',
  'account-exec',
  'account-exec',
  'renewal-rep',
  'renewal-rep',
  'renewal-rep',
  'support-agent',
  'support-agent',
  'solutions-architect',
  'solutions-architect',
  'license-auditor',
];

export type VendorGoal = 'player' | { alarm: string; until: number } | { lure: number };

export interface Vendor {
  id: number;
  role: VendorRole;
  x: number;
  z: number;
  /** Shift time until which the vendor is busy with money. */
  distractedUntil: number;
  goal: VendorGoal;
  /** Seconds without progress while it wants to walk. */
  stuckFor: number;
  /** Where the vendor stood when it last made progress. */
  markX: number;
  markZ: number;
  /** A side-step that frees a stuck vendor: direction and end time. */
  nudgeX: number;
  nudgeZ: number;
  nudgeUntil: number;
  /** Within closeRange of the player on the last step. */
  close: boolean;
  /** Walked on the last step (for the walk bob). */
  walking: boolean;
  /** The shot that last hit it: more bills of one shot are one hit. */
  lastHitShot: number;
}

/**
 * When vendors arrive in one shift, ascending. The first comes at
 * firstArrivalMin-firstArrivalMax s. The rest spread to lastArrival on a
 * square-root curve, so they come closer together as the shift goes on.
 */
export function vendorArrivals(rng: Rng): { time: number; role: VendorRole }[] {
  const t = SHOOTER_TUNING;
  const n = t.vendorArrivals;
  const first = t.firstArrivalMin + rng() * (t.firstArrivalMax - t.firstArrivalMin);
  const out: { time: number; role: VendorRole }[] = [{ time: first, role: pick(rng, ROLE_BAG) }];
  for (let i = 1; i < n; i++) {
    // Jitter below half a slot keeps the times in order.
    const u = Math.min(1, (i + (rng() - 0.5) * 0.6) / (n - 1));
    out.push({
      time: first + (t.lastArrival - first) * Math.sqrt(u),
      role: pick(rng, ROLE_BAG),
    });
  }
  return out;
}

/** Evan's rule: 20 points off per close vendor, down to a floor of 10%. */
export function slowFactor(closeCount: number): number {
  const t = SHOOTER_TUNING;
  return Math.max(t.slowFloor, 1 - t.slowPerVendor * closeCount);
}

export const isDistracted = (s: Shift, v: Vendor): boolean => s.time < v.distractedUntil;

/** Nothing solid (a wall, a rack) stands between the vendor and (x, z). */
export const inSight = (s: Shift, v: Vendor, x: number, z: number): boolean =>
  segmentClear(s.boxes, v.x, v.z, x, z, 0);

/**
 * Close (Evan's rule): within closeRange of the player, not distracted,
 * and with nothing solid between them. A vendor behind a wall is not close.
 */
export function isClose(s: Shift, v: Vendor): boolean {
  if (isDistracted(s, v)) return false;
  if (Math.hypot(v.x - s.player.x, v.z - s.player.z) > SHOOTER_TUNING.closeRange) return false;
  return inSight(s, v, s.player.x, s.player.z);
}

/** Vendors that are close to the player now. */
export function closeVendors(s: Shift): number {
  let n = 0;
  for (const v of s.vendors) if (isClose(s, v)) n += 1;
  return n;
}

/** A vendor gives up its lure: the lure is free again, and the vendor goes back to the player. */
export function releaseLure(s: Shift, v: Vendor): void {
  const g = v.goal;
  if (typeof g !== 'object' || !('lure' in g)) return;
  for (const l of s.lures) if (l.id === g.lure && l.takenBy === v.id) l.takenBy = null;
  v.goal = 'player';
}

/** Put a vendor on the floor at (x, z), or at the nearest open cell. */
export function spawnVendor(s: Shift, role: VendorRole, x: number, z: number): Vendor {
  const g = s.nav;
  let px = x;
  let pz = z;
  if (g.open[cellAt(g, x, z)] !== 1) {
    const c = nearestOpen(g, x, z);
    if (c >= 0) {
      const col = c % g.cols;
      px = (col + 0.5) * g.cell;
      pz = ((c - col) / g.cols + 0.5) * g.cell;
    }
  }
  s.nextVendorId += 1;
  const v: Vendor = {
    id: s.nextVendorId,
    role,
    x: px,
    z: pz,
    distractedUntil: 0,
    goal: 'player',
    stuckFor: 0,
    markX: px,
    markZ: pz,
    nudgeX: 0,
    nudgeZ: 0,
    nudgeUntil: 0,
    close: false,
    walking: false,
    lastHitShot: -1,
  };
  s.vendors.push(v);
  return v;
}

/** A wrong step at `rackId`: vendors within alarmRange go to the rack for alarmSeconds. */
export function soundAlarm(s: Shift, rackId: string): void {
  const t = SHOOTER_TUNING;
  const rack = s.targets.get(rackId);
  if (!rack) return;
  const front = frontPoint(rack, 0.8);
  // One build per alarm; a second alarm at the same rack reuses the buffers.
  s.alarmFields.set(rackId, flowField(s.nav, front.x, front.z, s.alarmFields.get(rackId)));
  for (const v of s.vendors) {
    if (Math.hypot(v.x - rack.x, v.z - rack.z) > t.alarmRange) continue;
    releaseLure(s, v);
    v.goal = { alarm: rackId, until: s.time + t.alarmSeconds };
  }
}

/** Scratch vectors: stepVendors allocates nothing per vendor. */
const DIR = { x: 0, z: 0 };
const POS = { x: 0, z: 0 };

/** The goal point and field of a vendor, or null for a lure (money.ts moves those). */
function fieldFor(s: Shift, v: Vendor): FlowField | null {
  const g = v.goal;
  if (g === 'player') return s.playerField;
  if ('alarm' in g) return s.alarmFields.get(g.alarm) ?? s.playerField;
  return null;
}

/** Keep the player's field current: rebuild only when the player enters a new cell. */
export function updatePlayerField(s: Shift): void {
  const c = cellAt(s.nav, s.player.x, s.player.z);
  if (c === s.playerCell) return;
  s.playerCell = c;
  flowField(s.nav, s.player.x, s.player.z, s.playerField);
  s.playerFieldBuilds += 1;
}

/** Move a vendor by (dx, dz) against the walls and racks. */
function shove(s: Shift, v: Vendor, dx: number, dz: number): void {
  moveWithCollision(v, dx, dz, SHOOTER_TUNING.vendorRadius, s.boxes, POS);
  v.x = POS.x;
  v.z = POS.z;
}

/**
 * Walk a vendor toward the goal point of `field` (or (gx, gz) directly when
 * the field gives no direction), at `speed`, and stop `stop` metres short.
 * With `sight`, it stops only when nothing solid stands between it and the
 * goal, so a vendor never parks behind a wall. Returns true when it walked.
 */
export function walkVendor(
  s: Shift,
  v: Vendor,
  field: FlowField | null,
  gx: number,
  gz: number,
  speed: number,
  dt: number,
  stop: number = SHOOTER_TUNING.vendorStopRange,
  sight = false,
): boolean {
  const t = SHOOTER_TUNING;
  const dist = Math.hypot(gx - v.x, gz - v.z);
  // Line of sight is tested only near the goal, where it matters.
  const seen = !sight || dist > 3 || inSight(s, v, gx, gz);
  if (dist <= stop && seen) {
    v.stuckFor = 0;
    v.markX = v.x;
    v.markZ = v.z;
    return false;
  }
  if (s.time < v.nudgeUntil) {
    DIR.x = v.nudgeX;
    DIR.z = v.nudgeZ;
  } else {
    if (field) flowDir(s.nav, field, v.x, v.z, DIR);
    else DIR.x = DIR.z = 0;
    if (DIR.x === 0 && DIR.z === 0) {
      // On the goal cell, or no field: head straight for the goal.
      DIR.x = (gx - v.x) / dist;
      DIR.z = (gz - v.z) / dist;
    }
  }
  const step = dist > stop ? Math.min(speed * dt, dist - stop) : speed * dt;
  shove(s, v, DIR.x * step, DIR.z * step);

  // Stuck: no 0.2 m of progress in 3 s while still far from the goal. A
  // vendor in the crowd round its goal waits there and is not stuck.
  if (Math.hypot(v.x - v.markX, v.z - v.markZ) >= t.vendorStuckProgress || (dist <= 3 && seen)) {
    v.markX = v.x;
    v.markZ = v.z;
    v.stuckFor = 0;
  } else {
    v.stuckFor += dt;
    if (v.stuckFor >= t.vendorStuckSeconds) {
      // A side-step across the way it was heading, to a random side.
      const side = s.vendorRng() < 0.5 ? 1 : -1;
      v.nudgeX = -DIR.z * side;
      v.nudgeZ = DIR.x * side;
      v.nudgeUntil = s.time + t.vendorNudgeSeconds;
      v.stuckFor = 0;
      v.markX = v.x;
      v.markZ = v.z;
      s.vendorNudges += 1;
    }
  }
  return true;
}

/** Push vendors apart, and out of the player, to vendorGap. Position-based, in id order. */
function separate(s: Shift): void {
  const gap = SHOOTER_TUNING.vendorGap;
  const vs = s.vendors;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i] as Vendor;
    for (let j = i + 1; j < vs.length; j++) {
      const b = vs[j] as Vendor;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= gap) continue;
      if (d < 1e-6) {
        // Exactly on top of each other: split along a direction fixed by the ids.
        const ang = (a.id * 2.399 + b.id) % (Math.PI * 2);
        dx = Math.cos(ang);
        dz = Math.sin(ang);
      } else {
        dx /= d;
        dz /= d;
      }
      const push = (gap - d) / 2;
      shove(s, a, -dx * push, -dz * push);
      shove(s, b, dx * push, dz * push);
    }
    const px = a.x - s.player.x;
    const pz = a.z - s.player.z;
    const pd = Math.hypot(px, pz);
    if (pd < gap && pd > 1e-6) shove(s, a, (px / pd) * (gap - pd), (pz / pd) * (gap - pd));
  }
}

/** Arrivals that are due, while there is room on the floor. */
function admit(s: Shift, events: ShiftEvent[]): void {
  const t = SHOOTER_TUNING;
  while (s.nextArrival < s.arrivals.length && s.vendors.length < t.maxVendors) {
    const a = s.arrivals[s.nextArrival];
    if (!a || a.time > s.time) break;
    s.nextArrival += 1;
    const v = spawnVendor(
      s,
      a.role,
      s.floor.dock.x + (s.vendorRng() - 0.5) * 3,
      s.floor.dock.z + (s.vendorRng() - 0.5) * 4,
    );
    events.push({ type: 'vendor-arrived', id: v.id, role: v.role });
  }
}

/**
 * One fixed step for every vendor: arrivals, goals, walking, the gap, and
 * the line a vendor says on coming close. Lures are walked by money.ts,
 * which runs before this.
 */
export function stepVendors(s: Shift, dt: number, events: ShiftEvent[]): void {
  const t = SHOOTER_TUNING;
  admit(s, events);
  updatePlayerField(s);
  for (const v of s.vendors) {
    const g = v.goal;
    // A vendor on its way to a lure was walked by stepMoney.
    if (typeof g === 'object' && 'lure' in g && !isDistracted(s, v)) continue;
    v.walking = false;
    if (typeof g === 'object' && 'alarm' in g && s.time >= g.until) v.goal = 'player';
    if (isDistracted(s, v)) continue;
    const goal = v.goal;
    if (typeof goal === 'object' && 'lure' in goal) continue;
    const field = fieldFor(s, v);
    if (!field) continue;
    const gx = goal === 'player' ? s.player.x : field.goal.x;
    const gz = goal === 'player' ? s.player.z : field.goal.z;
    const speed = VENDOR_ROLES[v.role].speed;
    v.walking = walkVendor(s, v, field, gx, gz, speed, dt, t.vendorStopRange, true);
  }
  separate(s);
  for (const v of s.vendors) {
    const close = isClose(s, v);
    if (close && !v.close && s.time >= s.nextLineAt) {
      const lines = VENDOR_ROLES[v.role].lines;
      const line = lines[intBetween(s.vendorRng, 0, lines.length - 1)] ?? '';
      events.push({ type: 'vendor-close', id: v.id, role: v.role, line });
      s.nextLineAt = s.time + t.vendorLineGap;
    }
    v.close = close;
  }
}
