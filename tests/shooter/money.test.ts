import { describe, expect, it } from 'vitest';
import { TICKET_TYPES } from '../../src/logic/runbooks';
import { nextStep } from '../../src/logic/ticket';
import { FLOOR, frontPoint, solidBoxes } from '../../src/shooter/logic/floor';
import { PO_SPOTS, distract } from '../../src/shooter/logic/money';
import { cellAt } from '../../src/shooter/logic/nav';
import { NO_MOVE } from '../../src/shooter/logic/player';
import {
  breakRack,
  createShift,
  stepShift,
  yawToward,
  type Shift,
  type ShiftEvent,
  type ShiftInput,
} from '../../src/shooter/logic/shift';
import { SHOOTER_TUNING } from '../../src/shooter/logic/tuning';
import { closeVendors, spawnVendor, type Vendor } from '../../src/shooter/logic/vendors';

const T = SHOOTER_TUNING;
const DT = 1 / 120;
const ticks = (seconds: number) => Math.round(seconds / DT);

const idle = (s: Shift): ShiftInput => ({
  move: NO_MOVE,
  yaw: s.player.yaw,
  pitch: 0,
  work: false,
  pick: null,
  fire: false,
});

function run(s: Shift, n: number, input: (s: Shift) => Partial<ShiftInput> = () => ({})) {
  const events: ShiftEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...stepShift(s, { ...idle(s), ...input(s) }, DT));
  return events;
}
const fire = () => ({ fire: true });
const count = (events: ShiftEvent[], type: ShiftEvent['type']) =>
  events.filter((e) => e.type === type).length;

/** A quiet shift (no arrivals, no breaks) with the player in the corridor at (30, 18), looking east. */
function corridor(): Shift {
  const s = createShift(1);
  s.arrivals = [];
  s.nextBreak = s.schedule.length;
  s.player.x = 30;
  s.player.z = 18;
  s.player.yaw = -Math.PI / 2;
  return s;
}

/** The south-facing rack row whose fronts sit at z = 11, first segment. */
const southRow = FLOOR.racks.filter((r) => r.fz === 1 && Math.abs(r.box.maxZ - 11) < 1e-6);
const segment = southRow.slice(0, 8);
const segMinX = Math.min(...segment.map((r) => r.box.minX));
const segMaxX = Math.max(...segment.map((r) => r.box.maxX));

describe('the money gun', () => {
  it('distracts a vendor 8 m dead ahead, and it stops counting as close', () => {
    const s = corridor();
    const v = spawnVendor(s, 'renewal-rep', 38, 18);
    const events = run(s, 1, fire);
    events.push(...run(s, ticks(1)));
    expect(count(events, 'fired')).toBe(1);
    const hits = events.filter((e) => e.type === 'vendor-distracted');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: v.id, role: 'renewal-rep' });
    expect(s.stats.vendorsDistracted).toBe(1);
    // Bring it right up to the player: it still does not count.
    v.x = 31;
    v.z = 18;
    expect(closeVendors(s)).toBe(0);
    const left = v.distractedUntil - s.time;
    expect(left).toBeGreaterThan(T.distractSeconds - 1);
    expect(left).toBeLessThanOrEqual(T.distractSeconds);
    run(s, ticks(left) + 1);
    expect(closeVendors(s)).toBe(1);
  });

  it('distracts a license auditor for distractSeconds × 0.4', () => {
    const s = corridor();
    const v = spawnVendor(s, 'license-auditor', 38, 18);
    let hitAt = -1;
    run(s, 1, fire);
    for (let i = 0; i < ticks(1) && hitAt < 0; i++) {
      if (run(s, 1).some((e) => e.type === 'vendor-distracted')) hitAt = s.time;
    }
    expect(hitAt).toBeGreaterThan(0);
    expect(v.distractedUntil - hitAt).toBeCloseTo(T.distractSeconds * 0.4, 9);
  });

  it('a second hit sets the timer to the larger of the time left and a fresh distraction', () => {
    const s = corridor();
    const v = spawnVendor(s, 'renewal-rep', 38, 18);
    run(s, 1, fire);
    run(s, ticks(1));
    // A second shot about 1 s into the distraction: a fresh 5 s beats the 4 s left.
    run(s, 1, fire);
    let hitAt = -1;
    for (let i = 0; i < ticks(1) && hitAt < 0; i++) {
      if (run(s, 1).some((e) => e.type === 'vendor-distracted')) hitAt = s.time;
    }
    expect(v.distractedUntil).toBeCloseTo(hitAt + T.distractSeconds, 9);
    expect(s.stats.vendorsDistracted).toBe(2);
    // A long distraction is not cut short by a hit.
    v.distractedUntil = s.time + 30;
    const long = v.distractedUntil;
    run(s, 1, fire);
    run(s, ticks(1));
    expect(v.distractedUntil).toBe(long);
  });

  it('counts several bills of one shot on one vendor as one hit', () => {
    const s = corridor();
    // Close enough that every bill of the spread meets it.
    spawnVendor(s, 'renewal-rep', 31.3, 18);
    const events = run(s, 1, fire);
    events.push(...run(s, ticks(0.5)));
    expect(count(events, 'vendor-distracted')).toBe(1);
    expect(s.stats.vendorsDistracted).toBe(1);
  });

  it('fires 4 shots in 1 s of holding, and spends 2000', () => {
    const s = corridor();
    const events = run(s, ticks(1), fire);
    expect(count(events, 'fired')).toBe(4);
    expect(s.budget).toBe(T.startBudget - 4 * T.shotCost);
    expect(s.stats.moneySpent).toBe(4 * T.shotCost);
  });

  it('clicks when the budget runs out, and never goes below 0', () => {
    const s = corridor();
    s.budget = 600;
    const events = run(s, ticks(1), fire);
    expect(count(events, 'fired')).toBe(1);
    expect(s.budget).toBe(100);
    const dry = count(events, 'dry-fire');
    expect(dry).toBeGreaterThanOrEqual(1);
    expect(dry).toBeLessThanOrEqual(2);
    s.budget = 0;
    const more = run(s, ticks(2), fire);
    expect(count(more, 'fired')).toBe(0);
    expect(count(more, 'dry-fire')).toBeLessThanOrEqual(4);
    expect(s.budget).toBe(0);
  });

  it('does nothing while working', () => {
    const s = corridor();
    const type = TICKET_TYPES.find((t) => t.id === 'bad-dimm');
    const rack = southRow[2];
    if (!type || !rack) throw new Error('setup');
    breakRack(s, rack.id, type);
    const p = frontPoint(rack, 0.8);
    s.player.x = p.x;
    s.player.z = p.z;
    s.player.yaw = yawToward(p.x, p.z, rack.x, rack.z);
    const step = nextStep(s.open[0]?.ticket ?? ({} as never));
    run(s, 1, () => ({ pick: step }));
    const events = run(s, ticks(1), () => ({ work: true, fire: true }));
    expect(s.work).not.toBeNull();
    expect(count(events, 'fired')).toBe(0);
    expect(count(events, 'dry-fire')).toBe(0);
    expect(s.budget).toBe(T.startBudget);
    expect(s.bills).toHaveLength(0);
  });
});

describe('lures', () => {
  /** The player 5 m south of a rack face, looking north at it. */
  function atWall() {
    const s = createShift(1);
    s.arrivals = [];
    s.nextBreak = s.schedule.length;
    const x = (segMinX + segMaxX) / 2;
    s.player.x = x;
    s.player.z = 16;
    s.player.yaw = 0;
    return { s, x };
  }

  it('turns a shot at a wall 5 m away into one lure', () => {
    const { s } = atWall();
    const events = run(s, 1, fire);
    events.push(...run(s, ticks(0.5)));
    expect(count(events, 'lure-dropped')).toBe(1);
    expect(s.lures).toHaveLength(1);
    expect(s.lures[0]?.z ?? 0).toBeGreaterThanOrEqual(11);
    expect(s.lures[0]?.z ?? 99).toBeLessThan(12);
  });

  it('is taken by exactly one vendor', () => {
    const { s, x } = atWall();
    run(s, 1, fire);
    run(s, ticks(0.5));
    const lure = s.lures[0];
    if (!lure) throw new Error('no lure');
    const a = spawnVendor(s, 'renewal-rep', x - 0.3, 15);
    const b = spawnVendor(s, 'renewal-rep', x + 0.4, 15);
    const events = run(s, ticks(3));
    const taken = events.filter((e) => e.type === 'lure-taken');
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ id: lure.id, vendorId: a.id });
    expect(s.lures).toHaveLength(0);
    expect(s.time < a.distractedUntil || a.distractedUntil > 0).toBe(true);
    expect(b.goal).toBe('player');
    expect(s.stats.vendorsDistracted).toBe(1);
  });

  it('distracts the vendor that takes it for pickupSeconds', () => {
    const { s, x } = atWall();
    run(s, 1, fire);
    run(s, ticks(0.5));
    const a = spawnVendor(s, 'renewal-rep', x, 14);
    let takenAt = -1;
    for (let i = 0; i < ticks(3) && takenAt < 0; i++) {
      if (run(s, 1).some((e) => e.type === 'lure-taken')) takenAt = s.time;
    }
    expect(a.distractedUntil - takenAt).toBeCloseTo(T.pickupSeconds, 9);
  });

  it('goes after lureSeconds when nobody takes it', () => {
    const { s } = atWall();
    run(s, 1, fire);
    run(s, ticks(0.5));
    expect(s.lures).toHaveLength(1);
    run(s, ticks(T.lureSeconds - 1));
    expect(s.lures).toHaveLength(1);
    run(s, ticks(1));
    expect(s.lures).toHaveLength(0);
  });

  it('lands no bill behind a rack: 100 bills for 1 s at 1/120', () => {
    const s = corridor();
    for (let i = 0; i < 100; i++) {
      const x = segMinX + 0.1 + ((segMaxX - segMinX - 0.2) * i) / 99;
      s.nextBillId += 1;
      s.bills.push({
        id: s.nextBillId,
        shot: 1000 + i,
        x,
        z: 12 + (i % 5),
        vx: 0,
        vz: -T.billSpeed,
        life: 1,
      });
    }
    run(s, ticks(1));
    expect(s.bills).toHaveLength(0);
    expect(s.lures.length).toBeGreaterThan(0);
    for (const l of s.lures) expect(l.z).toBeGreaterThanOrEqual(11);
  });
});

describe('pickups', () => {
  it('places a PO in each area but the break room, on open floor, and a toolkit in a hall', () => {
    const s = createShift(3);
    const pos = s.pickups.filter((p) => p.kind === 'po');
    expect(pos).toHaveLength(4);
    expect(PO_SPOTS).toHaveLength(4);
    const areaOf = (x: number) => FLOOR.areas.find((a) => x >= a.box.minX && x < a.box.maxX)?.name;
    expect(pos.map((p) => areaOf(p.x)).sort()).toEqual(
      ['Data hall A', 'Data hall B', 'Loading dock', 'Network room'].sort(),
    );
    const kits = s.pickups.filter((p) => p.kind === 'toolkit');
    expect(kits).toHaveLength(1);
    expect(['Data hall A', 'Data hall B']).toContain(areaOf(kits[0]?.x ?? 0));
    for (const p of s.pickups) expect(s.nav.open[cellAt(s.nav, p.x, p.z)], `${p.kind}`).toBe(1);
    // Seeded: the same seed gives the same toolkit spot.
    expect(createShift(3).pickups).toEqual(s.pickups);
    for (const p of s.pickups) {
      for (const b of solidBoxes(FLOOR)) {
        const inside = p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ;
        expect(inside).toBe(false);
      }
    }
  });

  it('pays a PO once, and brings it back after poRespawn', () => {
    const s = corridor();
    s.budget = 1000;
    const po = s.pickups.find((p) => p.kind === 'po');
    if (!po) throw new Error('no PO');
    s.player.x = po.x;
    s.player.z = po.z;
    const events = run(s, ticks(5));
    expect(events.filter((e) => e.type === 'picked-up')).toEqual([
      { type: 'picked-up', kind: 'po' },
    ]);
    expect(s.budget).toBe(1000 + T.poAmount);
    expect(po.respawnAt).not.toBeNull();
    s.player.x = 30;
    s.player.z = 18;
    run(s, ticks(T.poRespawn - 5) + 1);
    expect(po.respawnAt).toBeNull();
    s.player.x = po.x;
    s.player.z = po.z;
    run(s, 1);
    expect(s.budget).toBe(1000 + 2 * T.poAmount);
  });

  it('takes the toolkit, and then each step takes opSeconds × 0.7', () => {
    const s = corridor();
    const kit = s.pickups.find((p) => p.kind === 'toolkit');
    if (!kit) throw new Error('no toolkit');
    s.player.x = kit.x;
    s.player.z = kit.z;
    const events = run(s, 1);
    expect(events).toContainEqual({ type: 'picked-up', kind: 'toolkit' });
    expect(s.toolkit).toBe(true);
    run(s, ticks(1));
    expect(s.pickups.filter((p) => p.kind === 'toolkit' && p.respawnAt === null)).toHaveLength(0);

    const type = TICKET_TYPES.find((t) => t.id === 'bad-dimm');
    const rack = southRow[3];
    if (!type || !rack) throw new Error('setup');
    breakRack(s, rack.id, type);
    const p = frontPoint(rack, 0.8);
    s.player.x = p.x;
    s.player.z = p.z;
    s.player.yaw = yawToward(p.x, p.z, rack.x, rack.z);
    const step = nextStep(s.open[0]?.ticket ?? ({} as never));
    run(s, 1, () => ({ pick: step }));
    const need = T.opSeconds * T.toolkitScale;
    const before = run(s, ticks(need) - 2, () => ({ work: true }));
    expect(before.some((e) => e.type === 'step-ok')).toBe(false);
    const after = run(s, 3, () => ({ work: true }));
    expect(after.some((e) => e.type === 'step-ok')).toBe(true);
  });
});

/** A quiet shift, nobody near: the player stays in the break room. */
function quiet(): Shift {
  const s = createShift(1);
  s.arrivals = [];
  s.nextBreak = s.schedule.length;
  return s;
}

/** Put a lure on the floor at (x, z). */
function dropLure(s: Shift, x: number, z: number) {
  s.nextLureId += 1;
  const lure = {
    id: s.nextLureId,
    shot: -s.nextLureId,
    x,
    z,
    until: s.time + T.lureSeconds,
    takenBy: null,
  };
  s.lures.push(lure);
  return lure;
}

/** Run until `v` takes a lure; true if it did within `seconds`. */
function takes(s: Shift, v: Vendor, seconds: number): boolean {
  for (let i = 0; i < ticks(seconds); i++) {
    if (run(s, 1).some((e) => e.type === 'lure-taken' && e.vendorId === v.id)) return true;
  }
  return false;
}

/** Each rack-face line once per hall: the face z, the way it faces, and a rack in its middle. */
function faceRows() {
  const rows = new Map<string, { faceZ: number; fz: number; x: number }>();
  for (const r of FLOOR.racks) {
    const faceZ = r.fz < 0 ? r.box.minZ : r.box.maxZ;
    const hall = r.x < 60 ? 'A' : 'B';
    const key = `${hall}:${faceZ.toFixed(2)}:${r.fz}`;
    const seg = FLOOR.racks.filter(
      (q) =>
        (q.x < 60 ? 'A' : 'B') === hall &&
        Math.abs((q.fz < 0 ? q.box.minZ : q.box.maxZ) - faceZ) < 1e-6,
    );
    const mid = seg[Math.floor(seg.length / 2) + 3];
    if (mid && !rows.has(key)) rows.set(key, { faceZ, fz: r.fz, x: mid.x });
  }
  return [...rows.values()];
}

/** Free floor (m) out from a face before the next box, for a vendor's radius. */
function freeOut(x: number, faceZ: number, fz: number): number {
  const boxes = solidBoxes(FLOOR);
  for (let d = 0.35; d < 12; d += 0.05) {
    const z = faceZ + fz * d;
    const hit = boxes.some(
      (b) =>
        x > b.minX - T.vendorRadius &&
        x < b.maxX + T.vendorRadius &&
        z > b.minZ - T.vendorRadius &&
        z < b.maxZ + T.vendorRadius,
    );
    if (hit) return d - 0.05;
  }
  return 12;
}

describe('review fixes: lures', () => {
  it('lures a vendor 3 m straight out, and one at 45°, on every rack-face row', () => {
    const rows = faceRows();
    expect(rows.length).toBe(16);
    for (const row of rows) {
      const free = freeOut(row.x, row.faceZ, row.fz);
      // 3 m out, or as far as the aisle allows.
      const d = Math.min(3, free - 0.4);
      const lz = row.faceZ + row.fz * 0.05;
      const a = quiet();
      dropLure(a, row.x, lz);
      const straight = spawnVendor(a, 'renewal-rep', row.x, row.faceZ + row.fz * d);
      // Claimed on the first step, from where the vendor stands.
      run(a, 1);
      expect(a.lures[0]?.takenBy, `straight claim, face ${row.faceZ} ${row.fz}`).toBe(straight.id);
      expect(takes(a, straight, 4), `straight, face ${row.faceZ} ${row.fz}`).toBe(true);
      const b = quiet();
      dropLure(b, row.x, lz);
      const k = d / Math.SQRT2;
      const diag = spawnVendor(b, 'renewal-rep', row.x + k, row.faceZ + row.fz * k);
      run(b, 1);
      expect(b.lures[0]?.takenBy, `45° claim, face ${row.faceZ} ${row.fz}`).toBe(diag.id);
      expect(takes(b, diag, 4), `45°, face ${row.faceZ} ${row.fz}`).toBe(true);
    }
  });

  it('does not lure a vendor through a rack row', () => {
    const s = quiet();
    const rack = segment[3];
    if (!rack) throw new Error('setup');
    // Lure on the south face (z = 11), vendor in the aisle north of the row: 3 m, racks between.
    const lure = dropLure(s, rack.x, 11.05);
    spawnVendor(s, 'renewal-rep', rack.x, 8.0);
    run(s, ticks(1));
    expect(lure.takenBy).toBeNull();
  });

  it('does not let a distracted vendor claim a lure', () => {
    const s = quiet();
    const lure = dropLure(s, 30, 18);
    const v = spawnVendor(s, 'renewal-rep', 32, 18);
    v.distractedUntil = 100;
    run(s, ticks(1));
    expect(lure.takenBy).toBeNull();
  });

  it('frees the lure when its claimant is hit, and another vendor takes it', () => {
    const s = quiet();
    const lure = dropLure(s, 30, 18);
    const a = spawnVendor(s, 'renewal-rep', 31.5, 18);
    const b = spawnVendor(s, 'renewal-rep', 33, 18.5);
    run(s, 1);
    expect(lure.takenBy).toBe(a.id);
    distract(s, a, 5, []);
    expect(lure.takenBy).toBeNull();
    expect(a.goal).toBe('player');
    expect(takes(s, b, 3)).toBe(true);
  });

  it('keeps at most maxLures on the floor, dropping the oldest', () => {
    const s = quiet();
    s.budget = 1e6;
    // Down the corridor: the bills reach their range and land as separate lures.
    s.player.x = 20;
    s.player.z = 18;
    s.player.yaw = -Math.PI / 2;
    let most = 0;
    let lastId = 0;
    for (let i = 0; i < ticks(12); i++) {
      for (const e of run(s, 1, fire)) if (e.type === 'lure-dropped') lastId = e.id;
      most = Math.max(most, s.lures.length);
    }
    expect(most).toBeLessThanOrEqual(T.maxLures);
    expect(s.lures.some((l) => l.id === lastId)).toBe(true);
  });
});

describe('review fixes: the toolkit on every kind of work', () => {
  it('scales hands-on work and patches by toolkitScale', () => {
    const s = quiet();
    s.toolkit = true;
    const type = TICKET_TYPES.find((t) => t.steps.includes('PIT'));
    const rack = southRow[4];
    if (!type || !rack) throw new Error('setup');
    breakRack(s, rack.id, type);
    const p = frontPoint(rack, 0.8);
    s.player.x = p.x;
    s.player.z = p.z;
    s.player.yaw = yawToward(p.x, p.z, rack.x, rack.z);
    run(s, 1, () => ({ pick: 'PIT' }));
    run(s, 2, () => ({ work: true }));
    expect(s.work?.duration).toBeCloseTo(T.handsOnSeconds * T.toolkitScale, 9);

    const patch = s.patches[0];
    if (!patch) throw new Error('no patch');
    const t = s.targets.get(patch.targetId);
    if (!t) throw new Error('no target');
    const q = frontPoint(t, 0.8);
    s.player.x = q.x;
    s.player.z = q.z;
    s.player.yaw = yawToward(q.x, q.z, t.x, t.z);
    run(s, 2, () => ({ work: true }));
    expect(s.work?.step).toBeNull();
    expect(s.work?.duration).toBeCloseTo(T.patchSeconds * T.toolkitScale, 9);
  });
});
