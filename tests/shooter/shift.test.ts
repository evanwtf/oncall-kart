import { describe, expect, it } from 'vitest';
import type { Step } from '../../src/logic/ops';
import { TICKET_TYPES, type TicketType } from '../../src/logic/runbooks';
import { nextStep } from '../../src/logic/ticket';
import { FLOOR, frontPoint, type FloorDef, type Target } from '../../src/shooter/logic/floor';
import { NO_MOVE } from '../../src/shooter/logic/player';
import {
  PANEL_STEPS,
  breakRack,
  createShift,
  endingFor,
  facingTarget,
  stepShift,
  yawToward,
  type Shift,
  type ShiftEvent,
  type ShiftInput,
} from '../../src/shooter/logic/shift';
import { SHOOTER_TUNING } from '../../src/shooter/logic/tuning';

const T = SHOOTER_TUNING;
const DT = 1 / 120;

const type = (id: string): TicketType => {
  const t = TICKET_TYPES.find((x) => x.id === id);
  if (!t) throw new Error(`no ticket type ${id}`);
  return t;
};

const allTargets = (f: FloorDef) => [...f.racks, ...f.devices];
const targetOf = (s: Shift, id: string): Target => {
  const t = allTargets(s.floor).find((x) => x.id === id);
  if (!t) throw new Error(`no target ${id}`);
  return t;
};

/** Put the player 0.8 m in front of a target, looking at it. */
function stand(s: Shift, id: string, distance = 0.8): void {
  const t = targetOf(s, id);
  const p = frontPoint(t, distance);
  s.player.x = p.x;
  s.player.z = p.z;
  s.player.vx = 0;
  s.player.vz = 0;
  s.player.yaw = yawToward(p.x, p.z, t.x, t.z);
}

const idle = (s: Shift): ShiftInput => ({
  move: NO_MOVE,
  yaw: s.player.yaw,
  pitch: 0,
  work: false,
  pick: null,
});

/** Run n ticks with an input built per tick. */
function run(s: Shift, n: number, input: (s: Shift) => Partial<ShiftInput> = () => ({})) {
  const events: ShiftEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...stepShift(s, { ...idle(s), ...input(s) }, DT));
  return events;
}

const ticks = (seconds: number) => Math.round(seconds / DT);

/** A healthy rack that is not a patch target. */
function freeRack(s: Shift, skip: string[] = []): string {
  const patchIds = new Set(s.patches.map((p) => p.targetId));
  const r = s.floor.racks.find(
    (x) => !patchIds.has(x.id) && !skip.includes(x.id) && !s.open.some((o) => o.rackId === x.id),
  );
  if (!r) throw new Error('no free rack');
  return r.id;
}

/** A shift with one broken rack of the given type, the player in front of it, and the clock at 0. */
function brokenAt(typeId: string, seed = 1) {
  const s = createShift(seed);
  const rackId = freeRack(s);
  breakRack(s, rackId, type(typeId));
  stand(s, rackId);
  return { s, rackId };
}

/** Pick a step, then hold E for `seconds`. */
function work(s: Shift, step: Step, seconds: number) {
  const events = run(s, 1, () => ({ pick: step }));
  events.push(...run(s, ticks(seconds), () => ({ work: true })));
  return events;
}

const types = (events: ShiftEvent[]) => events.map((e) => e.type);

describe('createShift', () => {
  it('starts at the spawn point with 3 patches and nothing broken', () => {
    const s = createShift(1);
    expect(s.time).toBe(0);
    expect(s.player.x).toBe(FLOOR.spawn.x);
    expect(s.open).toEqual([]);
    expect(s.patches).toHaveLength(3);
    expect(s.ended).toBeNull();
  });

  it('PANEL_STEPS are the operations then PIT', () => {
    expect(PANEL_STEPS).toEqual([
      'MAINT',
      'TAKEDOWN',
      'POWERON',
      'REINSTATE',
      'FW-ISO',
      'LOGCOLLECT',
      'META-SYNC',
      'REIMAGE',
      'PIT',
    ]);
  });
});

describe('breaks', () => {
  it('breaks a rack at t = 10, with a location on that rack, never a patch target', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = createShift(seed);
      const before = run(s, ticks(10) - 1);
      expect(before.filter((e) => e.type === 'break')).toEqual([]);
      const events = run(s, 1);
      const br = events.find((e) => e.type === 'break');
      if (br?.type !== 'break') throw new Error('no break at t = 10');
      expect(s.open).toHaveLength(1);
      const open = s.open[0];
      expect(open?.rackId).toBe(br.rackId);
      expect(open?.ticket.location).toMatch(new RegExp(`^${br.rackId}-u\\d{2}$`));
      expect(open?.ticket.deadline).toBeCloseTo(
        s.time + T.slaBase + T.slaPerStep * br.ticket.type.steps.length,
      );
      expect(s.patches.map((p) => p.targetId)).not.toContain(br.rackId);
    }
  });

  it('refuses to break a patch target or a broken rack', () => {
    const s = createShift(1);
    const patchRack = s.patches.find((p) => s.floor.racks.some((r) => r.id === p.targetId));
    if (!patchRack) throw new Error('no rack patch');
    expect(breakRack(s, patchRack.targetId, type('bad-dimm'))).toBeNull();
    const id = freeRack(s);
    expect(breakRack(s, id, type('bad-dimm'))).not.toBeNull();
    expect(breakRack(s, id, type('bad-dimm'))).toBeNull();
    expect(s.open).toHaveLength(1);
  });

  it('skips a break when every candidate rack is broken', () => {
    const tiny: FloorDef = {
      ...FLOOR,
      racks: FLOOR.racks.slice(0, 2),
      devices: [
        FLOOR.devices.find((d) => d.kind === 'switch') as Target,
        FLOOR.devices.find((d) => d.kind === 'firewall') as Target,
      ],
    };
    const s = createShift(1, tiny);
    // Every scheduled break after the first finds no candidate.
    const events = run(s, ticks(T.shiftSeconds - 1));
    expect(events.filter((e) => e.type === 'break')).toHaveLength(1);
    expect(s.open).toHaveLength(1);
  });
});

describe('facingTarget', () => {
  it('finds a broken rack in front, and nothing turned away or 3 m back', () => {
    const { s, rackId } = brokenAt('bad-dimm');
    expect(facingTarget(s)?.id).toBe(rackId);
    s.player.yaw += Math.PI / 2;
    expect(facingTarget(s)).toBeNull();
    stand(s, rackId, 3.8);
    expect(facingTarget(s)).toBeNull();
  });

  it('ignores a healthy rack', () => {
    const s = createShift(1);
    stand(s, freeRack(s));
    expect(facingTarget(s)).toBeNull();
  });

  it('picks the rack in front when two broken racks stand side by side', () => {
    const s = createShift(1);
    const patchIds = new Set(s.patches.map((p) => p.targetId));
    const pair = s.floor.racks.findIndex((r, i) => {
      const next = s.floor.racks[i + 1];
      return !!next && !patchIds.has(r.id) && !patchIds.has(next.id) && next.z === r.z;
    });
    const a = s.floor.racks[pair] as Target;
    const b = s.floor.racks[pair + 1] as Target;
    breakRack(s, a.id, type('bad-dimm'));
    breakRack(s, b.id, type('failed-disk'));
    stand(s, a.id);
    expect(facingTarget(s)?.id).toBe(a.id);
    stand(s, b.id);
    expect(facingTarget(s)?.id).toBe(b.id);
  });

  it('finds an unapplied patch target', () => {
    const s = createShift(1);
    const p = s.patches[0];
    if (!p) throw new Error('no patch');
    stand(s, p.targetId);
    expect(facingTarget(s)?.id).toBe(p.targetId);
  });
});

describe('work at a rack', () => {
  it('completes the right step after opSeconds', () => {
    const { s, rackId } = brokenAt('bad-dimm');
    const events = work(s, 'LOGCOLLECT', T.opSeconds + DT);
    expect(events).toContainEqual({ type: 'step-ok', rackId, step: 'LOGCOLLECT' });
    expect(s.open[0]?.ticket.stepIndex).toBe(1);
    expect(s.selected).toBeNull();
    expect(s.work).toBeNull();
  });

  it('does nothing if E is let go just before the bar fills', () => {
    const { s } = brokenAt('bad-dimm');
    const events = work(s, 'LOGCOLLECT', T.opSeconds - 0.05);
    expect(s.work).not.toBeNull();
    events.push(...run(s, 1));
    expect(types(events)).not.toContain('step-ok');
    expect(types(events)).toContain('work-cancelled');
    expect(s.work).toBeNull();
    expect(s.open[0]?.ticket.stepIndex).toBe(0);
    // The pick stays, so the next hold starts again from zero.
    expect(s.selected).toBe('LOGCOLLECT');
  });

  it('starts no work while E is held before a step is picked', () => {
    const { s } = brokenAt('bad-dimm');
    const events = run(s, ticks(3), () => ({ work: true }));
    expect(s.work).toBeNull();
    expect(events.filter((e) => e.type.startsWith('step'))).toEqual([]);
  });

  it('starts work when a step is picked with E already held', () => {
    const { s, rackId } = brokenAt('bad-dimm');
    run(s, ticks(1), () => ({ work: true }));
    const events = run(s, 1, () => ({ work: true, pick: 'LOGCOLLECT' }));
    events.push(...run(s, ticks(T.opSeconds), () => ({ work: true })));
    expect(events).toContainEqual({ type: 'step-ok', rackId, step: 'LOGCOLLECT' });
  });

  it('cancels on movement input', () => {
    const { s, rackId } = brokenAt('bad-dimm');
    const events = work(s, 'LOGCOLLECT', 1);
    const x = s.player.x;
    events.push(...run(s, 1, () => ({ work: true, move: { forward: 0, strafe: 1 } })));
    expect(events).toContainEqual({ type: 'work-cancelled', targetId: rackId });
    expect(s.work).toBeNull();
    expect(s.player.x).not.toBe(x);
  });

  it('cancels when the faced target changes', () => {
    const { s, rackId } = brokenAt('bad-dimm');
    const events = work(s, 'LOGCOLLECT', 1);
    events.push(...run(s, 1, (sh) => ({ work: true, yaw: sh.player.yaw + Math.PI / 2 })));
    expect(events).toContainEqual({ type: 'work-cancelled', targetId: rackId });
    expect(s.work).toBeNull();
  });

  it('ignores movement while working: the player stays put', () => {
    const { s } = brokenAt('bad-dimm');
    const { x, z } = s.player;
    work(s, 'LOGCOLLECT', 1);
    expect(s.player.x).toBe(x);
    expect(s.player.z).toBe(z);
  });

  it('takes handsOnSeconds for PIT', () => {
    const { s, rackId } = brokenAt('bad-dimm');
    work(s, 'LOGCOLLECT', T.opSeconds + DT);
    work(s, 'TAKEDOWN', T.opSeconds + DT);
    expect(nextStep(s.open[0]?.ticket ?? (null as never))).toBe('PIT');
    let events = work(s, 'PIT', T.opSeconds + DT);
    expect(types(events)).not.toContain('step-ok');
    events = run(s, ticks(T.handsOnSeconds - T.opSeconds), () => ({ work: true }));
    expect(events).toContainEqual({ type: 'step-ok', rackId, step: 'PIT' });
  });

  it('a wrong step fills the bar, then fails and sounds the alarm', () => {
    const { s, rackId } = brokenAt('bad-dimm');
    const events = work(s, 'REIMAGE', T.opSeconds + DT);
    expect(events).toContainEqual({ type: 'step-wrong', rackId, step: 'REIMAGE' });
    expect(events).toContainEqual({ type: 'alarm', rackId });
    expect(s.stats.wrongSteps).toBe(1);
    expect(s.open[0]?.ticket.stepIndex).toBe(0);
    expect(s.selected).toBeNull();
  });

  it('closes the ticket after the full runbook', () => {
    const { s, rackId } = brokenAt('bad-dimm');
    const events: ShiftEvent[] = [];
    for (const step of type('bad-dimm').steps) {
      events.push(...work(s, step, (step === 'PIT' ? T.handsOnSeconds : T.opSeconds) + DT));
    }
    expect(events).toContainEqual({ type: 'ticket-closed', rackId });
    expect(s.open.find((o) => o.rackId === rackId)).toBeUndefined();
    expect(s.stats.ticketsClosed).toBe(1);
    expect(s.stats.wrongSteps).toBe(0);
  });
});

describe('SLA', () => {
  it('breaches once, and the ticket stays open', () => {
    const { s, rackId } = brokenAt('wrong-hostname');
    const sla = T.slaBase + T.slaPerStep;
    // The scheduled breaks may add tickets; count only this rack.
    const events = run(s, ticks(sla + 20)).filter(
      (e) => e.type === 'sla-breach' && e.rackId === rackId,
    );
    expect(events).toHaveLength(1);
    expect(s.open.find((o) => o.rackId === rackId)?.breached).toBe(true);
    expect(s.stats.slaBreaches).toBeGreaterThanOrEqual(1);
  });

  it('counts one breach per ticket', () => {
    const { s } = brokenAt('wrong-hostname');
    run(s, ticks(T.slaBase + T.slaPerStep + 1));
    expect(s.stats.slaBreaches).toBe(1);
  });
});

describe('patches', () => {
  it('applies a patch after patchSeconds of E, with no pick', () => {
    const s = createShift(1);
    const p = s.patches[0];
    if (!p) throw new Error('no patch');
    stand(s, p.targetId);
    const events = run(s, ticks(T.patchSeconds) + 1, () => ({ work: true }));
    expect(events).toContainEqual({ type: 'patch-applied', patchId: p.id });
    expect(p.applied).toBe(true);
    expect(s.stats.patchesApplied).toBe(1);
    // An applied patch target is no longer a target.
    expect(facingTarget(s)).toBeNull();
  });
});

describe('the end of the shift', () => {
  const ending = (applied: number, broken: number) => {
    const s = createShift(1);
    s.patches.forEach((p, i) => (p.applied = i < applied));
    for (let i = 0; i < broken; i++) breakRack(s, freeRack(s), type('bad-dimm'));
    return endingFor(s);
  };

  it('picks the ending from the patches and the broken racks', () => {
    expect(ending(3, 0)).toBe('clean');
    expect(ending(3, 1)).toBe('rough');
    expect(ending(2, 0)).toBe('fired');
    expect(ending(2, 1)).toBe('fired');
  });

  it('ends once at 180 s; later steps change nothing', () => {
    const s = createShift(1);
    const events = run(s, ticks(T.shiftSeconds));
    expect(events.filter((e) => e.type === 'shift-end')).toEqual([
      { type: 'shift-end', ending: 'fired' },
    ]);
    expect(s.ended).toBe('fired');
    const snapshot = JSON.stringify({ t: s.time, p: s.player, o: s.open });
    expect(run(s, 120, () => ({ move: { forward: 1, strafe: 0 } }))).toEqual([]);
    expect(JSON.stringify({ t: s.time, p: s.player, o: s.open })).toBe(snapshot);
  });

  it('counts a step that completes on the final tick', () => {
    const s = createShift(1);
    // Two patches done; the third completes on the very last tick.
    const [a, b, c] = s.patches;
    if (!a || !b || !c) throw new Error('need 3 patches');
    a.applied = true;
    b.applied = true;
    s.stats.patchesApplied = 2;
    stand(s, c.targetId);
    // Skip ahead so the patch fills exactly on the last tick, and stop the breaks.
    s.time = T.shiftSeconds - T.patchSeconds;
    s.nextBreak = s.schedule.length;
    const events = run(s, ticks(T.patchSeconds), () => ({ work: true }));
    expect(types(events)).toEqual(['patch-applied', 'shift-end']);
    expect(s.ended).toBe('clean');
  });
});

describe('determinism', () => {
  it('gives the same events for the same seed and inputs', () => {
    const play = () => {
      const s = createShift(7);
      const out: ShiftEvent[] = [];
      for (let i = 0; i < ticks(T.shiftSeconds) + 10; i++) {
        const input: ShiftInput = {
          move: { forward: Math.sin(i / 50), strafe: Math.cos(i / 70) },
          yaw: i / 300,
          pitch: 0,
          work: i % 400 > 200,
          pick: i % 400 === 150 ? 'MAINT' : null,
        };
        out.push(...stepShift(s, input, DT));
      }
      return out;
    };
    const a = play();
    expect(a.filter((e) => e.type === 'break').length).toBeGreaterThan(1);
    expect(play()).toEqual(a);
  });
});
