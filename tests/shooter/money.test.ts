import { describe, expect, it } from 'vitest';
import { TICKET_TYPES } from '../../src/logic/runbooks';
import { nextStep } from '../../src/logic/ticket';
import { FLOOR, frontPoint, solidBoxes } from '../../src/shooter/logic/floor';
import { PO_SPOTS } from '../../src/shooter/logic/money';
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
import { closeVendors, spawnVendor } from '../../src/shooter/logic/vendors';

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
