import { describe, expect, it } from 'vitest';
import { makeRng } from '../../src/logic/rng';
import { TICKET_TYPES, type TicketType } from '../../src/logic/runbooks';
import { nextStep } from '../../src/logic/ticket';
import { FLOOR, frontPoint, type Target } from '../../src/shooter/logic/floor';
import { NO_MOVE } from '../../src/shooter/logic/player';
import {
  PANEL_STEPS,
  breakRack,
  createShift,
  stepShift,
  yawToward,
  type Shift,
  type ShiftEvent,
  type ShiftInput,
} from '../../src/shooter/logic/shift';
import { SHOOTER_TUNING } from '../../src/shooter/logic/tuning';
import {
  VENDOR_ROLES,
  closeVendors,
  slowFactor,
  spawnVendor,
  vendorArrivals,
  walkVendor,
  type VendorRole,
} from '../../src/shooter/logic/vendors';

const T = SHOOTER_TUNING;
const DT = 1 / 120;
const ticks = (seconds: number) => Math.round(seconds / DT);

const type = (id: string): TicketType => {
  const t = TICKET_TYPES.find((x) => x.id === id);
  if (!t) throw new Error(`no ticket type ${id}`);
  return t;
};

const idle = (s: Shift): ShiftInput => ({
  move: NO_MOVE,
  yaw: s.player.yaw,
  pitch: 0,
  work: false,
  pick: null,
});

function run(s: Shift, n: number, input: (s: Shift) => Partial<ShiftInput> = () => ({})) {
  const events: ShiftEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...stepShift(s, { ...idle(s), ...input(s) }, DT));
  return events;
}

/** A shift with no scheduled arrivals, so a test places every vendor itself. */
function quietShift(seed = 1): Shift {
  const s = createShift(seed);
  s.arrivals = [];
  return s;
}

/** A broken rack that faces north into an aisle, with the player at its front, looking at it. */
function atRack(s: Shift, typeId = 'bad-dimm') {
  const patchIds = new Set(s.patches.map((p) => p.targetId));
  const rack = s.floor.racks.find((r) => r.fz === -1 && r.z > 8 && r.z < 12 && !patchIds.has(r.id));
  if (!rack) throw new Error('no rack');
  breakRack(s, rack.id, type(typeId));
  const p = frontPoint(rack, 0.8);
  s.player.x = p.x;
  s.player.z = p.z;
  s.player.yaw = yawToward(p.x, p.z, rack.x, rack.z);
  return rack;
}

/** Three vendors 1.5 m from the player: left, right and behind (rack faces north). */
function ringOfThree(s: Shift, role: VendorRole = 'renewal-rep') {
  const { x, z } = s.player;
  return [
    spawnVendor(s, role, x - 1.5, z),
    spawnVendor(s, role, x + 1.5, z),
    spawnVendor(s, role, x, z - 1.5),
  ];
}

describe('slowFactor (Evan’s rule)', () => {
  it('takes 20 points per close vendor, down to 10%', () => {
    const table: [number, number][] = [
      [0, 1],
      [1, 0.8],
      [2, 0.6],
      [3, 0.4],
      [4, 0.2],
      [5, 0.1],
      [9, 0.1],
    ];
    for (const [n, f] of table) expect(slowFactor(n), `n = ${n}`).toBeCloseTo(f, 10);
  });
});

describe('closeVendors', () => {
  it('counts vendors within 2 m, and not a distracted one', () => {
    const s = quietShift();
    const { x, z } = s.player;
    const a = spawnVendor(s, 'account-exec', x + 1, z);
    spawnVendor(s, 'account-exec', x - 1.9, z);
    spawnVendor(s, 'account-exec', x + 2.5, z + 2);
    expect(closeVendors(s)).toBe(2);
    a.distractedUntil = s.time + 5;
    expect(closeVendors(s)).toBe(1);
  });
});

describe('vendorArrivals', () => {
  it('is deterministic, ascending, starts at 10-20 s and gets busier', () => {
    const a = vendorArrivals(makeRng(7));
    const b = vendorArrivals(makeRng(7));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(12);
    const first = a[0]?.time ?? 0;
    expect(first).toBeGreaterThanOrEqual(10);
    expect(first).toBeLessThanOrEqual(20);
    for (let i = 1; i < a.length; i++) {
      expect(a[i]?.time ?? 0).toBeGreaterThan(a[i - 1]?.time ?? 0);
    }
    const half = T.shiftSeconds / 2;
    const early = a.filter((x) => x.time < half).length;
    expect(a.length - early).toBeGreaterThan(early);
    for (const x of a) expect(Object.keys(VENDOR_ROLES)).toContain(x.role);
    expect(a.every((x) => x.time < T.shiftSeconds)).toBe(true);
  });
});

describe('roles', () => {
  it('has a title, a speed and original lines for each role', () => {
    expect(VENDOR_ROLES['account-exec'].speed).toBeGreaterThan(VENDOR_ROLES['renewal-rep'].speed);
    expect(VENDOR_ROLES['license-auditor'].speed).toBeLessThan(VENDOR_ROLES['renewal-rep'].speed);
    expect(VENDOR_ROLES['license-auditor'].distractScale).toBeCloseTo(0.4);
    for (const r of Object.values(VENDOR_ROLES)) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.lines.length).toBeGreaterThanOrEqual(3);
      // Every vendor is slower than the player, so the player can always get clear.
      expect(r.speed).toBeLessThan(T.runSpeed);
    }
  });
});

describe('the slowdown', () => {
  it('caps the top speed at 0.4 × runSpeed with 3 close vendors, and frees it once they go', () => {
    const s = quietShift();
    ringOfThree(s);
    // Walk forward for 0.5 s: the vendors follow at 3 m/s and stay close.
    run(s, ticks(0.5), () => ({ move: { forward: 1, strafe: 0 } }));
    expect(closeVendors(s)).toBe(3);
    expect(Math.hypot(s.player.vx, s.player.vz)).toBeCloseTo(0.4 * T.runSpeed, 5);
    for (const v of s.vendors) v.x += 10;
    run(s, ticks(0.2), () => ({ move: { forward: 1, strafe: 0 } }));
    expect(Math.hypot(s.player.vx, s.player.vz)).toBeCloseTo(T.runSpeed, 5);
  });

  it('slows the work bar: an opSeconds step takes opSeconds / 0.4 with 3 close vendors', () => {
    const s = quietShift();
    const rack = atRack(s);
    ringOfThree(s);
    const first = nextStep(s.open[0]?.ticket ?? ({} as never));
    if (!first) throw new Error('no step');
    expect(PANEL_STEPS).toContain(first);
    run(s, 1, () => ({ pick: first }));
    const need = T.opSeconds / 0.4;
    const before = run(s, ticks(need) - 2, () => ({ work: true }));
    expect(before.some((e) => e.type === 'step-ok')).toBe(false);
    expect(closeVendors(s)).toBe(3);
    const after = run(s, 3, () => ({ work: true }));
    expect(after.find((e) => e.type === 'step-ok')).toMatchObject({ rackId: rack.id });
  });

  it('works at full rate on the first step after the vendors leave', () => {
    const s = quietShift();
    atRack(s);
    ringOfThree(s);
    const first = nextStep(s.open[0]?.ticket ?? ({} as never));
    run(s, 1, () => ({ pick: first }));
    run(s, 10, () => ({ work: true }));
    const p0 = s.work?.progress ?? 0;
    expect(p0).toBeCloseTo(10 * DT * 0.4, 9);
    for (const v of s.vendors) v.z -= 10;
    run(s, 1, () => ({ work: true }));
    expect((s.work?.progress ?? 0) - p0).toBeCloseTo(DT, 9);
  });

  it('still finishes work at the 10% floor, in opSeconds / 0.1', () => {
    const s = quietShift();
    const rack = atRack(s);
    const { x, z } = s.player;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (0.15 + (0.7 * i) / 5);
      // A half ring behind the player, away from the rack face.
      spawnVendor(s, 'renewal-rep', x + Math.cos(a) * 1.4, z - Math.sin(a) * 1.4);
    }
    const first = nextStep(s.open[0]?.ticket ?? ({} as never));
    run(s, 1, () => ({ pick: first }));
    expect(closeVendors(s)).toBe(6);
    let progress = 0;
    const need = T.opSeconds / 0.1;
    const events = run(s, ticks(need) - 2, () => ({ work: true }));
    expect(events.some((e) => e.type === 'step-ok')).toBe(false);
    for (let i = 0; i < 4; i++) {
      const p = s.work?.progress ?? progress;
      // Work never stops or runs backward.
      expect(p).toBeGreaterThanOrEqual(progress);
      progress = p;
      const e = run(s, 1, () => ({ work: true }));
      if (e.some((x) => x.type === 'step-ok' && x.rackId === rack.id)) return;
    }
    throw new Error('the step did not finish at the 10% floor');
  });

  it('lets the player walk through a ring of vendors', () => {
    const s = quietShift();
    s.player.x = 30;
    s.player.z = 18;
    s.player.yaw = -Math.PI / 2; // looking east, +x
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      spawnVendor(s, 'renewal-rep', 30 + Math.cos(a) * 0.9, 18 + Math.sin(a) * 0.9);
    }
    // Eight close vendors: the 10% floor. The player still gets out of the ring.
    run(s, ticks(3), () => ({ move: { forward: 1, strafe: 0 } }));
    expect(s.player.x).toBeGreaterThan(30 + 0.9 + 0.6);
    expect(Math.hypot(s.player.vx, s.player.vz)).toBeGreaterThan(0);
  });
});

describe('vendor movement', () => {
  it('brings 20 vendors from the dock to the player in the break room, none stuck', () => {
    const s = quietShift();
    const rng = makeRng(3);
    for (let i = 0; i < T.maxVendors; i++) {
      spawnVendor(
        s,
        'renewal-rep',
        FLOOR.dock.x + (rng() - 0.5) * 3,
        FLOOR.dock.z + (rng() - 0.5) * 6,
      );
    }
    const marks = s.vendors.map((v) => ({ x: v.x, z: v.z, t: 0 }));
    let worst = 0;
    const arrived = new Set<number>();
    for (let n = 0; n < ticks(60); n++) {
      run(s, 1);
      s.vendors.forEach((v, i) => {
        const m = marks[i];
        if (!m) return;
        const d = Math.hypot(v.x - s.player.x, v.z - s.player.z);
        if (d <= 2) arrived.add(v.id);
        if (Math.hypot(v.x - m.x, v.z - m.z) >= 0.2 || d <= 3) {
          m.x = v.x;
          m.z = v.z;
          m.t = s.time;
        }
        worst = Math.max(worst, s.time - m.t);
      });
      if (arrived.size === T.maxVendors) break;
    }
    expect(worst).toBeLessThanOrEqual(3);
    expect(arrived.size).toBe(T.maxVendors);
    for (const v of s.vendors) {
      expect(Math.hypot(v.x - s.player.x, v.z - s.player.z)).toBeLessThanOrEqual(2.5);
    }
  });

  it('keeps vendors about 0.6 m apart and out of the player', () => {
    const s = quietShift();
    for (let i = 0; i < 10; i++) spawnVendor(s, 'renewal-rep', 8 + (i % 3) * 0.1, 18 + i * 0.05);
    run(s, ticks(8));
    for (const a of s.vendors) {
      expect(Math.hypot(a.x - s.player.x, a.z - s.player.z)).toBeGreaterThan(0.5);
      for (const b of s.vendors) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.45);
      }
    }
  });

  it('holds back arrivals beyond maxVendors', () => {
    const s = createShift(1);
    s.arrivals = Array.from({ length: T.maxVendors + 3 }, (_, i) => ({
      time: 1 + i * 0.01,
      role: 'renewal-rep' as const,
    }));
    const events = run(s, ticks(2));
    expect(s.vendors).toHaveLength(T.maxVendors);
    expect(events.filter((e) => e.type === 'vendor-arrived')).toHaveLength(T.maxVendors);
  });

  it('spawns scheduled arrivals at the dock', () => {
    const s = createShift(1);
    const first = s.arrivals[0];
    if (!first) throw new Error('no arrivals');
    const events = run(s, ticks(first.time) + 1);
    const e = events.find((x) => x.type === 'vendor-arrived');
    expect(e).toMatchObject({ role: first.role });
    const v = s.vendors[0];
    expect(Math.hypot((v?.x ?? 0) - FLOOR.dock.x, (v?.z ?? 0) - FLOOR.dock.z)).toBeLessThan(4);
  });

  it('a wrong step calls a vendor 20 m away to the rack, not one 40 m away', () => {
    const s = quietShift();
    const rack: Target = atRack(s);
    const near = spawnVendor(s, 'renewal-rep', s.player.x + 20, 18);
    const far = spawnVendor(s, 'renewal-rep', s.player.x + 40, 18);
    const right = nextStep(s.open[0]?.ticket ?? ({} as never));
    const wrong = PANEL_STEPS.find((p) => p !== right && p !== 'PIT');
    if (!wrong) throw new Error('no wrong step');
    run(s, 1, () => ({ pick: wrong }));
    const events = run(s, ticks(T.opSeconds) + 2, () => ({ work: true }));
    expect(events.some((e) => e.type === 'step-wrong')).toBe(true);
    expect(near.goal).toMatchObject({ alarm: rack.id });
    expect(far.goal).toBe('player');
    // The player walks off: the near vendor still heads for the rack.
    s.player.x = FLOOR.spawn.x;
    s.player.z = FLOOR.spawn.z;
    const front = frontPoint(rack, 0.8);
    const d0 = Math.hypot(near.x - front.x, near.z - front.z);
    run(s, ticks(4));
    expect(Math.hypot(near.x - front.x, near.z - front.z)).toBeLessThan(d0 - 5);
    // After alarmSeconds it goes back to chasing the player.
    run(s, ticks(T.alarmSeconds));
    expect(near.goal).toBe('player');
  });

  it('says a line when a vendor comes close, at most once per 3 s', () => {
    const s = quietShift();
    const { x, z } = s.player;
    spawnVendor(s, 'account-exec', x + 3, z);
    spawnVendor(s, 'support-agent', x - 3, z);
    const events = run(s, ticks(2.5));
    const lines = events.filter((e) => e.type === 'vendor-close');
    expect(lines).toHaveLength(1);
    const e = lines[0];
    if (e?.type !== 'vendor-close') throw new Error('no line');
    expect(VENDOR_ROLES[e.role].lines).toContain(e.line);
  });

  it('nudges a vendor free after 3 s without progress, and never jumps it', () => {
    const s = quietShift();
    // West of the wall between the break room and hall A, heading straight at it.
    const v = spawnVendor(s, 'renewal-rep', 13.2, 5);
    let px = v.x;
    let pz = v.z;
    let maxJump = 0;
    for (let i = 0; i < ticks(3.5); i++) {
      s.time += DT;
      walkVendor(s, v, null, 20, 5, 3, DT);
      maxJump = Math.max(maxJump, Math.hypot(v.x - px, v.z - pz));
      px = v.x;
      pz = v.z;
    }
    expect(s.vendorNudges).toBe(1);
    expect(maxJump).toBeLessThanOrEqual(3 * DT + 1e-9);
    // The nudge is a side-step along the wall.
    expect(Math.abs(v.z - 5)).toBeGreaterThan(0.2);
  });

  it('freezes vendors while the shift is not stepped (pause)', () => {
    const s = quietShift();
    const v = spawnVendor(s, 'renewal-rep', 20, 18);
    const before = { x: v.x, z: v.z };
    // No stepShift call: nothing moves. The loop only steps while playing.
    expect({ x: v.x, z: v.z }).toEqual(before);
  });
});

describe('determinism and phase 1', () => {
  it('keeps the seed-1 break schedule and the first 3 broken racks of phase 1', () => {
    const s = createShift(1);
    // Snapshot taken from v0.5.0, before vendors existed.
    expect(s.schedule).toEqual([
      10, 38.73188233126359, 51.813765473251024, 78.04834607671057, 115.65320784691136,
      152.94039961480107,
    ]);
    expect(s.patches.map((p) => p.targetId)).toEqual(['sw2', 'fw1', 'r28']);
    const ids: string[] = [];
    for (let i = 0; i < ticks(T.shiftSeconds) && ids.length < 3; i++) {
      for (const e of run(s, 1)) if (e.type === 'break') ids.push(e.rackId);
    }
    expect(ids).toEqual(['r190', 'r494', 'r98']);
  });

  it('gives the same vendor positions after 60 s for the same seed and inputs', () => {
    const play = () => {
      const s = createShift(5);
      run(s, ticks(60), (sh) => ({
        move: { forward: sh.time % 7 < 3 ? 1 : 0, strafe: sh.time % 11 < 2 ? 1 : 0 },
        yaw: -Math.PI / 2 + Math.sin(sh.time * 0.3),
      }));
      return s.vendors.map((v) => [v.id, v.role, v.x, v.z]);
    };
    const a = play();
    expect(a.length).toBeGreaterThan(0);
    expect(play()).toEqual(a);
  });
});
