/**
 * The money gun: a cartoon cash blower. Budget is its ammo. A bill that
 * meets a vendor distracts it; a bill that misses lands on the floor as a
 * lure. Nobody gets hurt: vendors only stop to pick up the money.
 *
 * Also the pickups on the floor: approved POs (budget) and the toolkit.
 */
import { pick, type Rng } from '../../logic/rng';
import { frontPoint, type FloorDef } from './floor';
import { cellAt, segmentClear, type NavGrid } from './nav';
import { moveWithCollision } from './player';
import type { Shift, ShiftEvent, ShiftInput } from './shift';
import { SHOOTER_TUNING } from './tuning';
import { VENDOR_ROLES, isDistracted, releaseLure, walkVendor, type Vendor } from './vendors';

/** A bill in flight. */
export interface Bill {
  id: number;
  /** The shot it came from. */
  shot: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Seconds of flight left before it reaches billRange. */
  life: number;
}

/** Bills on the floor. */
export interface Lure {
  id: number;
  shot: number;
  x: number;
  z: number;
  /** Shift time it goes away. */
  until: number;
  /** The vendor that claimed it, or null. */
  takenBy: number | null;
}

export interface Pickup {
  id: number;
  kind: 'po' | 'toolkit';
  x: number;
  z: number;
  /** Shift time it comes back; null = on the floor now. The toolkit never comes back. */
  respawnAt: number | null;
}

/** Fixed PO spots, one per area but the break room: aisles and open floor. */
export const PO_SPOTS: readonly { x: number; z: number }[] = [
  { x: 33, z: 7.1 }, // Data hall A, an aisle
  { x: 59, z: 12 }, // Network room
  { x: 85, z: 28.9 }, // Data hall B, an aisle
  { x: 115.5, z: 32 }, // Loading dock
];

/** The shift's pickups: the 4 POs and one toolkit in front of a random hall rack. */
export function placePickups(rng: Rng, floor: FloorDef, nav: NavGrid): Pickup[] {
  const out: Pickup[] = PO_SPOTS.map((p, i) => ({
    id: i + 1,
    kind: 'po',
    x: p.x,
    z: p.z,
    respawnAt: null,
  }));
  const spots = floor.racks
    .map((r) => frontPoint(r, 1.4))
    .filter((p) => nav.open[cellAt(nav, p.x, p.z)] === 1);
  const k = pick(rng, spots);
  out.push({ id: out.length + 1, kind: 'toolkit', x: k.x, z: k.z, respawnAt: null });
  return out;
}

/** Scratch: stepMoney allocates nothing per bill or vendor, except new bills and lures. */
const POS = { x: 0, z: 0 };
/** Slack for float sums of fixed steps. */
const EPS = 1e-9;

/**
 * A vendor can walk straight to a lure: the segment from the vendor to the
 * point lureReach short of the lure clears every box grown by vendorRadius.
 * The lure itself may lie against a face, inside the grown box; the vendor
 * only needs to get within lureReach of it.
 */
function canReach(s: Shift, v: Vendor, l: Lure): boolean {
  const t = SHOOTER_TUNING;
  const dx = l.x - v.x;
  const dz = l.z - v.z;
  const d = Math.hypot(dx, dz);
  if (d <= t.lureReach) return true;
  const k = (d - t.lureReach) / d;
  return segmentClear(s.boxes, v.x, v.z, v.x + dx * k, v.z + dz * k, t.vendorRadius);
}

function fireShot(s: Shift, events: ShiftEvent[]): void {
  const t = SHOOTER_TUNING;
  s.budget -= t.shotCost;
  s.stats.moneySpent += t.shotCost;
  s.shotNumber += 1;
  const p = s.player;
  const spread = (t.spreadDeg * Math.PI) / 180;
  const life = t.billRange / t.billSpeed;
  const n: number = t.billsPerShot;
  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : spread * ((2 * i) / (n - 1) - 1);
    const yaw = p.yaw + off;
    // Forward is (-sin yaw, -cos yaw).
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    s.nextBillId += 1;
    s.bills.push({
      id: s.nextBillId,
      shot: s.shotNumber,
      x: p.x + dx * 0.3,
      z: p.z + dz * 0.3,
      vx: dx * t.billSpeed,
      vz: dz * t.billSpeed,
      life,
    });
  }
  events.push({ type: 'fired' });
}

/** The trigger: fire at fireRate while held, with budget, and not while working. */
function trigger(s: Shift, input: ShiftInput, dt: number, events: ShiftEvent[]): void {
  const t = SHOOTER_TUNING;
  s.fireCooldown = Math.max(0, s.fireCooldown - dt);
  s.dryCooldown = Math.max(0, s.dryCooldown - dt);
  if (!input.fire || s.work) return;
  if (s.fireCooldown > EPS) return;
  if (s.budget >= t.shotCost) {
    fireShot(s, events);
    s.fireCooldown = 1 / t.fireRate;
  } else if (s.dryCooldown <= EPS) {
    events.push({ type: 'dry-fire' });
    s.dryCooldown = 1 / t.dryFireRate;
  }
}

/** A hit: the vendor stops for the money. The longer of the time left and a fresh distraction wins. */
export function distract(s: Shift, v: Vendor, seconds: number, events: ShiftEvent[]): void {
  v.distractedUntil = Math.max(v.distractedUntil, s.time + seconds);
  s.stats.vendorsDistracted += 1;
  // It drops its claim; another vendor may take that lure.
  releaseLure(s, v);
  events.push({ type: 'vendor-distracted', id: v.id, role: v.role });
}

/** Take lure `index` off the floor; a vendor on its way to it goes back to the player. */
function dropLure(s: Shift, index: number): void {
  const l = s.lures[index];
  if (!l) return;
  for (const v of s.vendors) {
    const g = v.goal;
    if (typeof g === 'object' && 'lure' in g && g.lure === l.id) v.goal = 'player';
  }
  s.lures.splice(index, 1);
}

/** Bills land: join a lure of the same shot within lureMerge, or drop a new one. */
function land(s: Shift, b: Bill, events: ShiftEvent[]): void {
  const t = SHOOTER_TUNING;
  for (const l of s.lures) {
    if (l.shot === b.shot && Math.hypot(l.x - b.x, l.z - b.z) <= t.lureMerge) return;
  }
  // At the cap the oldest lure goes, and the vendor on its way to it goes back to the player.
  if (s.lures.length >= t.maxLures) dropLure(s, 0);
  s.nextLureId += 1;
  s.lures.push({
    id: s.nextLureId,
    shot: b.shot,
    x: b.x,
    z: b.z,
    until: s.time + t.lureSeconds,
    takenBy: null,
  });
  events.push({ type: 'lure-dropped', id: s.nextLureId });
}

function stepBills(s: Shift, dt: number, events: ShiftEvent[]): void {
  const t = SHOOTER_TUNING;
  const hitR = t.vendorRadius + 0.1;
  let keep = 0;
  for (const b of s.bills) {
    const flight = Math.min(dt, b.life);
    const wantX = b.vx * flight;
    const wantZ = b.vz * flight;
    // Swept against the boxes, so a bill never passes through a rack.
    moveWithCollision(b, wantX, wantZ, t.billRadius, s.boxes, POS);
    const blocked = Math.abs(POS.x - b.x - wantX) > 1e-9 || Math.abs(POS.z - b.z - wantZ) > 1e-9;
    b.x = POS.x;
    b.z = POS.z;
    b.life -= flight;
    let gone = false;
    for (const v of s.vendors) {
      if (Math.hypot(v.x - b.x, v.z - b.z) > hitR) continue;
      gone = true;
      if (v.lastHitShot !== b.shot) {
        v.lastHitShot = b.shot;
        distract(s, v, t.distractSeconds * VENDOR_ROLES[v.role].distractScale, events);
      }
      break;
    }
    if (!gone && (blocked || b.life <= EPS)) {
      land(s, b, events);
      gone = true;
    }
    if (!gone) s.bills[keep++] = b;
  }
  s.bills.length = keep;
}

/** A vendor that is free for a lure: not distracted, not alarmed, not already on a lure. */
const isFree = (s: Shift, v: Vendor) => v.goal === 'player' && !isDistracted(s, v);

function stepLures(s: Shift, dt: number, events: ShiftEvent[]): void {
  const t = SHOOTER_TUNING;
  // Expire: a vendor on its way goes back to the player.
  let keep = 0;
  for (const l of s.lures) {
    if (s.time >= l.until - EPS) {
      for (const v of s.vendors) {
        const g = v.goal;
        if (typeof g === 'object' && 'lure' in g && g.lure === l.id) v.goal = 'player';
      }
      continue;
    }
    s.lures[keep++] = l;
  }
  s.lures.length = keep;
  if (s.lures.length === 0) return;

  // Claims: each free vendor takes the nearest free lure in range with a clear way to it.
  for (const v of s.vendors) {
    if (!isFree(s, v)) continue;
    let best: Lure | null = null;
    let bestD: number = t.lureRange;
    for (const l of s.lures) {
      if (l.takenBy !== null) continue;
      const d = Math.hypot(l.x - v.x, l.z - v.z);
      if (d > bestD) continue;
      if (!canReach(s, v, l)) continue;
      best = l;
      bestD = d;
    }
    if (best) {
      best.takenBy = v.id;
      v.goal = { lure: best.id };
    }
  }

  // Walk to the lure; at it, pick it up.
  for (const v of s.vendors) {
    const g = v.goal;
    if (typeof g !== 'object' || !('lure' in g) || isDistracted(s, v)) continue;
    // A plain loop, not findIndex: no closure per vendor per step.
    let idx = -1;
    for (let i = 0; i < s.lures.length; i++) {
      if (s.lures[i]?.id === g.lure) {
        idx = i;
        break;
      }
    }
    const l = s.lures[idx];
    if (!l) {
      v.goal = 'player';
      continue;
    }
    if (Math.hypot(l.x - v.x, l.z - v.z) <= t.lureReach) {
      s.lures.splice(idx, 1);
      v.goal = 'player';
      v.distractedUntil = Math.max(v.distractedUntil, s.time + t.pickupSeconds);
      s.stats.vendorsDistracted += 1;
      events.push({ type: 'lure-taken', id: l.id, vendorId: v.id });
      continue;
    }
    v.walking = walkVendor(s, v, null, l.x, l.z, VENDOR_ROLES[v.role].speed, dt, t.lureReach - 0.1);
  }
}

function stepPickups(s: Shift, events: ShiftEvent[]): void {
  const t = SHOOTER_TUNING;
  for (const p of s.pickups) {
    if (p.respawnAt !== null) {
      if (s.time < p.respawnAt - EPS) continue;
      p.respawnAt = null;
    }
    if (Math.hypot(p.x - s.player.x, p.z - s.player.z) > t.pickupRadius) continue;
    if (p.kind === 'po') {
      s.budget += t.poAmount;
      p.respawnAt = s.time + t.poRespawn;
    } else {
      s.toolkit = true;
      p.respawnAt = Infinity;
    }
    events.push({ type: 'picked-up', kind: p.kind });
  }
}

/** One fixed step of the gun, the bills, the lures and the pickups. Runs before stepVendors. */
export function stepMoney(s: Shift, input: ShiftInput, dt: number, events: ShiftEvent[]): void {
  trigger(s, input, dt, events);
  stepBills(s, dt, events);
  stepLures(s, dt, events);
  stepPickups(s, events);
}
